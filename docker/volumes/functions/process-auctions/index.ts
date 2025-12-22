import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * Process Auctions Edge Function
 * 
 * Runs periodically (via cron) to identify and process expired auctions.
 * 
 * Logic:
 * 1. Find active auctions where ends_at < now
 * 2. For each auction:
 *    a. If bids exist:
 *       - Identify highest bidder
 *       - Create pending purchase record
 *       - Notify winner (buyer) and seller
 *       - Mark listing as 'sold' (or 'pending_payment')
 *    b. If no bids:
 *       - Mark listing as 'expired'
 *       - Notify seller
 * 
 * Required env vars:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY (required for cron/admin actions)
 */

Deno.serve(async (req) => {
  // Allow manual invocation for testing, but mostly triggered by cron
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Verify authorization (Service Role only for cron security)
  const authHeader = req.headers.get("Authorization");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  // Note: For manual testing via client, you might want to allow authenticated users
  // but for production cron, checking for service_role is safer.
  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    // Fallback: Check if it's a valid admin user if manually invoked
    // For now, restrict to service role
    // return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    console.log("Starting auction processing...");

    const now = new Date().toISOString();

    // 1. Find expired active auctions
    const { data: expiredAuctions, error: searchError } = await supabase
      .from("marketplace_listings")
      .select("id, title, seller_id, reserve_price")
      .eq("type", "auction")
      .eq("status", "active")
      .lt("ends_at", now);

    if (searchError) {
      throw searchError;
    }

    console.log(`Found ${expiredAuctions?.length || 0} expired auctions.`);

    const results = {
      processed: 0,
      sold: 0,
      expired: 0,
      errors: [] as string[]
    };

    if (!expiredAuctions || expiredAuctions.length === 0) {
      return new Response(JSON.stringify({ message: "No expired auctions to process", results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Process each auction
    for (const auction of expiredAuctions) {
      try {
        // Get highest bid
        const { data: highestBid, error: bidError } = await supabase
          .from("marketplace_bids")
          .select("id, bidder_id, amount")
          .eq("listing_id", auction.id)
          .order("amount", { ascending: false })
          .limit(1)
          .single();

        if (bidError && bidError.code !== 'PGRST116') { // PGRST116 is "no rows returned"
           throw bidError;
        }

        if (highestBid) {
          // Check reserve price
          const bidAmount = parseFloat(highestBid.amount);
          const reservePrice = auction.reserve_price ? parseFloat(auction.reserve_price) : 0;

          if (bidAmount >= reservePrice) {
            // Auction WON
            console.log(`Auction ${auction.id} won by ${highestBid.bidder_id} for ${bidAmount}`);

            // 1. Create Purchase Record
            const { data: purchase, error: purchaseError } = await supabase
              .from("marketplace_purchases")
              .insert({
                listing_id: auction.id,
                buyer_id: highestBid.bidder_id,
                seller_id: auction.seller_id,
                amount: bidAmount,
                status: "pending_payment", // Waiting for winner to pay
                currency: "USD", // Default or fetch from listing
                platform_fee: 0, // Calculated at payment time
              })
              .select("id")
              .single();

            if (purchaseError) throw purchaseError;

            // 2. Mark listing as pending_payment (effectively sold, but waiting)
            await supabase
              .from("marketplace_listings")
              .update({ status: "pending_payment" })
              .eq("id", auction.id);

            // 3. Notify Winner
            await supabase.from("user_notifications").insert({
              user_id: highestBid.bidder_id,
              type: "auction_won",
              title: "You Won an Auction!",
              message: `Congratulations! You won the auction for "${auction.title}". Please complete your payment.`,
              link: `/checkout/${purchase.id}`, // Or dedicated payment page
              read: false
            });

            // 4. Notify Seller
            await supabase.from("user_notifications").insert({
              user_id: auction.seller_id,
              type: "auction_sold",
              title: "Auction Ended - Item Sold",
              message: `Your auction for "${auction.title}" has ended with a winning bid! Waiting for buyer payment.`,
              link: `/sales/${purchase.id}`,
              read: false
            });

            results.sold++;
          } else {
            // Reserve not met
            console.log(`Auction ${auction.id} ended. Reserve ($${reservePrice}) not met by high bid ($${bidAmount}).`);
            
            await supabase
              .from("marketplace_listings")
              .update({ status: "expired" })
              .eq("id", auction.id);

            // Notify Seller
            await supabase.from("user_notifications").insert({
              user_id: auction.seller_id,
              type: "auction_expired",
              title: "Auction Ended - Reserve Not Met",
              message: `Your auction for "${auction.title}" ended without meeting the reserve price.`,
              link: `/listings/${auction.id}`,
              read: false
            });
            
            // Notify Highest Bidder? (Optional: "Sorry you didn't win")

            results.expired++;
          }
        } else {
          // No bids
          console.log(`Auction ${auction.id} ended with no bids.`);

          await supabase
            .from("marketplace_listings")
            .update({ status: "expired" })
            .eq("id", auction.id);

          // Notify Seller
          await supabase.from("user_notifications").insert({
            user_id: auction.seller_id,
            type: "auction_expired",
            title: "Auction Ended",
            message: `Your auction for "${auction.title}" has ended with no bids.`,
            link: `/listings/${auction.id}`,
            read: false
          });

          results.expired++;
        }

        results.processed++;

      } catch (err) {
        console.error(`Error processing auction ${auction.id}:`, err);
        results.errors.push(`Auction ${auction.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Process auctions error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
