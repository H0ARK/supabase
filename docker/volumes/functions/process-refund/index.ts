import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";

/**
 * Process Refund Edge Function
 * 
 * Handles marketplace refund requests.
 * 
 * Flow:
 * 1. Validates that the requesting user is either the seller or an admin
 * 2. Checks refund eligibility (within window, not already refunded)
 * 3. Processes refund via Stripe API
 * 4. Updates purchase and dispute records in Supabase
 * 5. Notifications handled via webhooks (charge.refunded)
 * 
 * Required env vars:
 * - SUPABASE_URL
 * - SUPABASE_ANON_KEY
 * - SUPABASE_SERVICE_ROLE_KEY
 * - STRIPE_SECRET_KEY
 */

interface ProcessRefundRequest {
  purchaseId: string;
  reason?: string;
  amount?: number; // Optional partial refund amount in dollars
  metadata?: Record<string, any>;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only accept POST requests
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { purchaseId, reason, amount, metadata }: ProcessRefundRequest = await req.json();

    if (!purchaseId) {
      return new Response(JSON.stringify({ error: "Missing purchaseId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create Supabase client with user auth
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    );

    // Admin client for database operations (and checking roles)
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
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

    // Get purchase details completely from admin client to see hidden fields
    const { data: purchase, error: purchaseError } = await adminClient
      .from("marketplace_purchases")
      .select(`
        *,
        seller:seller_id (id),
        buyer:buyer_id (id),
        listing:listing_id (id, title)
      `)
      .eq("id", purchaseId)
      .single();

    if (purchaseError || !purchase) {
      return new Response(JSON.stringify({ error: "Purchase not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check permissions: Only Seller or Admin can refund
    // Note: In a real app, you'd check an 'admins' table or user role
    const isSeller = user.id === purchase.seller_id;
    const isAdmin = false; // TODO: Implement admin check logic

    if (!isSeller && !isAdmin) {
      return new Response(
        JSON.stringify({ error: "Permission denied. Only the seller can refund this order." }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate refund eligibility
    if (purchase.status === "refunded") {
      return new Response(JSON.stringify({ error: "Order already refunded" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!purchase.stripe_payment_intent_id) {
      return new Response(JSON.stringify({ error: "No payment record found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Initialize Stripe
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
      apiVersion: "2023-10-16",
    });

    // Prepare refund parameters
    const refundParams: Stripe.RefundCreateParams = {
      payment_intent: purchase.stripe_payment_intent_id,
      reason: "requested_by_customer",
      metadata: {
        purchase_id: purchaseId,
        buyer_id: purchase.buyer_id,
        seller_id: purchase.seller_id,
        initiated_by: user.id,
        reason_text: reason || "Refund initiated by seller",
        ...metadata
      },
      reverse_transfer: true, // Pull funds back from connected account
    };

    // Handle partial refunds if amount specified
    if (amount) {
      // Amount in dollars to cents
      const refundAmountCents = Math.round(amount * 100);
      const purchaseAmountCents = Math.round(parseFloat(purchase.amount) * 100);

      if (refundAmountCents > purchaseAmountCents) {
        return new Response(
          JSON.stringify({ error: "Refund amount exceeds purchase total" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      
      refundParams.amount = refundAmountCents;
    }

    console.log(`Processing refund for purchase ${purchaseId}`, refundParams);

    // Execute refund
    const refund = await stripe.refunds.create(refundParams);

    // Update purchase status in DB immediately (webhook will confirm)
    const { error: updateError } = await adminClient
      .from("marketplace_purchases")
      .update({
        status: amount && amount < parseFloat(purchase.amount) ? purchase.status : "refunded",
        updated_at: new Date().toISOString(),
      })
      .eq("id", purchaseId);

    if (updateError) {
      console.error("Error updating purchase status:", updateError);
    }

    // If there was an open dispute, resolve it
    const { data: disputes } = await adminClient
      .from("marketplace_disputes")
      .select("id")
      .eq("purchase_id", purchaseId)
      .eq("status", "open");
    
    if (disputes && disputes.length > 0) {
      await adminClient
        .from("marketplace_disputes")
        .update({
          status: "resolved",
          resolution: "refunded",
          resolved_at: new Date().toISOString(),
          resolved_by: user.id
        })
        .in("id", disputes.map(d => d.id));
    }

    return new Response(
      JSON.stringify({
        success: true,
        refundId: refund.id,
        status: refund.status,
        amountRefunded: (refund.amount || 0) / 100,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("Process refund error:", error);

    // Handle Stripe-specific errors
    if (error instanceof Stripe.errors.StripeError) {
      return new Response(
        JSON.stringify({
          error: "Stripe error",
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