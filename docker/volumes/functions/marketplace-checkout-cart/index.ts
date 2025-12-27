import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CartItem {
  listingId: string;
  quantity: number;
}

interface CheckoutRequest {
  items: CartItem[];
  buyerId: string;
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      },
    );

    // Verify user is authenticated
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { items, buyerId }: CheckoutRequest = await req.json();

    // Validate request
    if (!items || items.length === 0 || !buyerId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Verify buyer is the authenticated user
    if (buyerId !== user.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get listing details for all items
    const listingIds = items.map(item => item.listingId);
    const { data: listings, error: listingsError } = await supabaseClient
      .from("marketplace_listings")
      .select(`
        *,
        seller:seller_id (
          id,
          username
        )
      `)
      .in("id", listingIds)
      .eq("status", "active");

    if (listingsError || !listings || listings.length === 0) {
      return new Response(
        JSON.stringify({ error: "Listings not found or unavailable" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Check if all items are from the same seller
    const sellerIds = new Set(listings.map(l => l.seller_id));
    if (sellerIds.size > 1) {
      return new Response(
        JSON.stringify({ error: "Checkout with multiple sellers is not yet supported. Please purchase items from each seller separately." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const sellerId = Array.from(sellerIds)[0];

    // Prevent self-purchase
    if (sellerId === buyerId) {
      return new Response(
        JSON.stringify({ error: "Cannot purchase your own listings" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Initialize Stripe
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
      apiVersion: "2023-10-16",
    });

    // Get seller's Stripe account
    const { data: sellerAccount, error: sellerError } = await supabaseClient
      .from("seller_accounts")
      .select("stripe_account_id")
      .eq("user_id", sellerId)
      .single();

    if (sellerError || !sellerAccount?.stripe_account_id) {
      return new Response(
        JSON.stringify({ error: "Seller payment setup incomplete" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Calculate total amount and platform fees
    let totalAmountCents = 0;
    let totalPlatformFeeCents = 0;
    const lineItems = [];

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    for (const listing of listings) {
      const itemQuantity = items.find(i => i.listingId === listing.id)?.quantity || 1;
      const itemAmountDollars = listing.price * itemQuantity;
      const itemAmountCents = Math.round(itemAmountDollars * 100);
      
      // Get seller's progressive fee
      const { data: feeData, error: feeError } = await adminClient
        .rpc('calculate_progressive_fee', {
          p_seller_id: sellerId,
          p_sale_amount: itemAmountDollars
        });
      
      let platformFeeDollars = itemAmountDollars * 0.08;
      if (!feeError && feeData && feeData.length > 0) {
        platformFeeDollars = parseFloat(feeData[0].total_fee) || (itemAmountDollars * 0.08);
      }
      
      const platformFeeCents = Math.round(platformFeeDollars * 100);
      
      totalAmountCents += itemAmountCents;
      totalPlatformFeeCents += platformFeeCents;

      lineItems.push({
        price_data: {
          currency: listing.currency.toLowerCase(),
          product_data: {
            name: `${listing.card_name} - ${listing.card_set}`,
            description: listing.description || `Condition: ${listing.condition}`,
            images: listing.card_image ? [listing.card_image] : undefined,
          },
          unit_amount: Math.round(listing.price * 100),
        },
        quantity: itemQuantity,
      });
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: lineItems,
      mode: "payment",
      success_url: `${Deno.env.get("FRONTEND_URL") ?? "http://localhost:5173"}/marketplace/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${Deno.env.get("FRONTEND_URL") ?? "http://localhost:5173"}/market/cart`,
      metadata: {
        buyer_id: buyerId,
        seller_id: sellerId,
        is_cart_checkout: "true",
        listing_ids: listingIds.join(","),
      },
      payment_intent_data: {
        application_fee_amount: totalPlatformFeeCents,
        transfer_data: {
          destination: sellerAccount.stripe_account_id,
        },
        metadata: {
          buyer_id: buyerId,
          seller_id: sellerId,
        },
      },
      customer_email: user.email,
    });

    // Create marketplace purchase records for each item
    for (const listing of listings) {
      const itemQuantity = items.find(i => i.listingId === listing.id)?.quantity || 1;
      const itemAmountDollars = listing.price * itemQuantity;
      
      const { error: purchaseError } = await supabaseClient
        .from("marketplace_purchases")
        .insert({
          listing_id: listing.id,
          buyer_id: buyerId,
          seller_id: sellerId,
          amount: itemAmountDollars.toString(),
          currency: listing.currency,
          status: "pending",
          stripe_payment_intent_id: session.id,
        });

      if (purchaseError) {
        console.error("Error creating purchase record:", purchaseError);
      }
    }

    return new Response(
      JSON.stringify({
        checkoutUrl: session.url,
        sessionId: session.id,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Marketplace cart checkout error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
