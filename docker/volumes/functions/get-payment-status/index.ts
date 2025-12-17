import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";

// Edge function to fetch payment intent status from Stripe
// Used by the syncOrderStatus utility for manual status reconciliation

interface GetPaymentStatusRequest {
  paymentIntentId: string;
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client with user auth
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
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

    const { paymentIntentId }: GetPaymentStatusRequest = await req.json();

    if (!paymentIntentId) {
      return new Response(
        JSON.stringify({ error: "Missing paymentIntentId" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Verify the user has permission to check this payment
    // The payment intent should be associated with an order where they are buyer or seller
    const { data: purchase, error: purchaseError } = await supabaseClient
      .from("marketplace_purchases")
      .select("buyer_id, seller_id")
      .or(
        `stripe_payment_intent_id.eq.${paymentIntentId},stripe_payment_intent_id.like.%${paymentIntentId}%`
      )
      .single();

    if (purchaseError || !purchase) {
      return new Response(
        JSON.stringify({ error: "Purchase not found for this payment" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check if user is buyer or seller
    if (purchase.buyer_id !== user.id && purchase.seller_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Not authorized to view this payment" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Initialize Stripe
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
      apiVersion: "2023-10-16",
    });

    // Determine if this is a checkout session ID or payment intent ID
    // Checkout session IDs start with "cs_" while payment intents start with "pi_"
    let paymentIntent: Stripe.PaymentIntent;

    if (paymentIntentId.startsWith("cs_")) {
      // This is a checkout session ID, retrieve the session first
      const session = await stripe.checkout.sessions.retrieve(paymentIntentId);
      
      if (!session.payment_intent) {
        return new Response(
          JSON.stringify({
            paymentIntent: {
              id: paymentIntentId,
              status: session.payment_status === "paid" ? "succeeded" : "requires_payment_method",
              amount: session.amount_total ?? 0,
              currency: session.currency ?? "usd",
              charges: { data: [] },
            },
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const piId = typeof session.payment_intent === "string" 
        ? session.payment_intent 
        : session.payment_intent.id;
      
      paymentIntent = await stripe.paymentIntents.retrieve(piId, {
        expand: ["charges"],
      });
    } else {
      // This is a payment intent ID
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ["charges"],
      });
    }

    // Return relevant payment intent information
    const response = {
      paymentIntent: {
        id: paymentIntent.id,
        status: paymentIntent.status,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        charges: paymentIntent.charges
          ? {
              data: paymentIntent.charges.data.map((charge) => ({
                refunded: charge.refunded,
                amount_refunded: charge.amount_refunded,
              })),
            }
          : { data: [] },
      },
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error fetching payment status:", error);

    // Handle specific Stripe errors
    if (error instanceof Stripe.errors.StripeError) {
      return new Response(
        JSON.stringify({
          error: "Stripe API error",
          message: error.message,
          code: error.code,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

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
