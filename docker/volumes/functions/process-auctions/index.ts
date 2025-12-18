import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    console.log("Processing expired auctions...");

    // 1. Find expired active auctions
    const { data: expiredAuctions, error: fetchError } = await supabaseClient
      .from("marketplace_listings")
      .select("*")
      .eq("listing_type", "auction")
      .eq("status", "active")
      .lt("auction_end_date", new Date().toISOString());

    if (fetchError) throw fetchError;

    console.log(`Found ${expiredAuctions?.length || 0} expired auctions.`);

    const results = [];

    for (const auction of expiredAuctions || []) {
      if (auction.bid_count > 0) {
        // Auction has bids, mark as sold
        console.log(`Auction ${auction.id} has ${auction.bid_count} bids. Marking as sold.`);
        
        // Get the highest bid to find the buyer
        const { data: highestBid, error: bidError } = await supabaseClient
          .from("marketplace_bids")
          .select("*")
          .eq("listing_id", auction.id)
          .order("amount", { ascending: false })
          .limit(1)
          .single();

        if (bidError) {
          console.error(`Error fetching highest bid for auction ${auction.id}:`, bidError);
          continue;
        }

        // Update listing status
        const { error: updateError } = await supabaseClient
          .from("marketplace_listings")
          .update({ status: "sold" })
          .eq("id", auction.id);

        if (updateError) {
          console.error(`Error updating auction ${auction.id}:`, updateError);
          continue;
        }

        // Create purchase record
        const { error: purchaseError } = await supabaseClient
          .from("marketplace_purchases")
          .insert({
            listing_id: auction.id,
            buyer_id: highestBid.bidder_id,
            seller_id: auction.seller_id,
            amount: highestBid.amount,
            currency: auction.currency,
            platform_fee: (highestBid.amount * 0.05).toFixed(2), // Example 5% fee
            status: "pending",
          });

        if (purchaseError) {
          console.error(`Error creating purchase for auction ${auction.id}:`, purchaseError);
        }

        results.push({ id: auction.id, status: "sold", buyer: highestBid.bidder_id });
      } else {
        // No bids, mark as expired
        console.log(`Auction ${auction.id} has no bids. Marking as expired.`);
        const { error: updateError } = await supabaseClient
          .from("marketplace_listings")
          .update({ status: "expired" })
          .eq("id", auction.id);

        if (updateError) {
          console.error(`Error updating auction ${auction.id}:`, updateError);
          continue;
        }
        results.push({ id: auction.id, status: "expired" });
      }
    }

    return new Response(JSON.stringify({ success: true, processed: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error processing auctions:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
