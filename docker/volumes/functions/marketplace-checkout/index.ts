import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CheckoutRequest {
  listingId: string;
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

    const { listingId, buyerId }: CheckoutRequest = await req.json();

    // Validate request
    if (!listingId || !buyerId) {
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

    // Get listing details
    const { data: listing, error: listingError } = await supabaseClient
      .from("marketplace_listings")
      .select(
        `
        *,
        seller:seller_id (
          id,
          username
        )
      `,
      )
      .eq("id", listingId)
      .eq("status", "active")
      .single();

    if (listingError || !listing) {
      return new Response(
        JSON.stringify({ error: "Listing not found or unavailable" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Prevent self-purchase
    if (listing.seller_id === buyerId) {
      return new Response(
        JSON.stringify({ error: "Cannot purchase your own listing" }),
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

    // Get seller's Stripe account first
    const { data: sellerAccount, error: sellerError } = await supabaseClient
      .from("seller_accounts")
      .select("stripe_account_id")
      .eq("user_id", listing.seller_id)
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

    // Calculate progressive platform fee based on seller's annual sales
    const itemAmount = Math.round(listing.price * 100); // Convert to cents
    const itemAmountDollars = listing.price;
    
    // Use service role for fee calculation
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    
    // Get seller's progressive fee (calculated across all tiers)
    const { data: feeData, error: feeError } = await adminClient
      .rpc('calculate_progressive_fee', {
        p_seller_id: listing.seller_id,
        p_sale_amount: itemAmountDollars
      });
    
    // Default to 8% (Starter tier) if fee calculation fails
    let platformFeeDollars = itemAmountDollars * 0.08;
    let effectiveRate = 0.08;
    let currentTier = 'Starter';
    
    if (!feeError && feeData && feeData.length > 0) {
      platformFeeDollars = parseFloat(feeData[0].total_fee) || (itemAmountDollars * 0.08);
      effectiveRate = parseFloat(feeData[0].effective_rate) || 0.08;
      currentTier = feeData[0].current_tier || 'Starter';
    }
    
    const platformFee = Math.round(platformFeeDollars * 100); // Convert to cents
    const sellerAmount = itemAmount - platformFee;
    const feePercentage = effectiveRate * 100; // human-readable percent for metadata

    console.log(`Checkout: Seller tier=${currentTier}, effective_rate=${(effectiveRate * 100).toFixed(2)}%, platformFee=$${platformFeeDollars.toFixed(2)}`);

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: listing.currency.toLowerCase(),
            product_data: {
              name: `${listing.card_name} - ${listing.card_set}`,
              description:
                listing.description ||
                `Grade: ${listing.grade ? `${listing.grade_company} ${listing.grade}` : "Not graded"}`,
              images: listing.card_image ? [listing.card_image] : undefined,
            },
            unit_amount: itemAmount,
          },
          quantity: listing.quantity,
        },
      ],
      mode: "payment",
      success_url: `${Deno.env.get("FRONTEND_URL") ?? "http://localhost:5173"}/marketplace/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${Deno.env.get("FRONTEND_URL") ?? "http://localhost:5173"}/marketplace`,
      metadata: {
        listing_id: listingId,
        buyer_id: buyerId,
        seller_id: listing.seller_id,
        platform_fee: platformFee.toString(),
        seller_amount: sellerAmount.toString(),
        fee_percentage: feePercentage.toString(),
        seller_tier: currentTier,
      },
      payment_intent_data: {
        application_fee_amount: platformFee,
        transfer_data: {
          destination: sellerAccount.stripe_account_id,
        },
        metadata: {
          listing_id: listingId,
          buyer_id: buyerId,
          seller_id: listing.seller_id,
        },
      },
      customer_email: user.email,
    });

    // Create marketplace purchase record
    const { error: purchaseError } = await supabaseClient
      .from("marketplace_purchases")
      .insert({
        listing_id: listingId,
        buyer_id: buyerId,
        seller_id: listing.seller_id,
        amount: listing.price.toString(),
        currency: listing.currency,
        platform_fee: (platformFee / 100).toString(), // Convert back to dollars
        stripe_payment_intent_id: session.id,
        status: "pending",
      });

    if (purchaseError) {
      console.error("Error creating purchase record:", purchaseError);
      // Don't fail the checkout, just log the error
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
    console.error("Marketplace checkout error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});