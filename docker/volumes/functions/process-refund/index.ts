import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";

/**
 * Process Refund Edge Function
 * 
 * Handles refund processing for marketplace disputes with:
 * - Eligibility validation (30-day window, valid reasons)
 * - Full or partial refund support
 * - Automatic dispute resolution
 * - Notification dispatch to buyer and seller
 * 
 * Required env vars:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * - STRIPE_SECRET_KEY
 */

interface RefundRequest {
  disputeId: string;
  refundType: 'full' | 'partial';
  amount?: number; // Required for partial refunds (in dollars)
  reason: string;
  adminNotes?: string;
}

interface DisputeRecord {
  id: string;
  order_id: string;
  buyer_id: string;
  seller_id: string;
  status: string;
  reason: string;
  amount: number;
  created_at: string;
}

interface PurchaseRecord {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  amount: string;
  currency: string;
  platform_fee: string;
  stripe_payment_intent_id: string;
  status: string;
  completed_at: string;
}

// Valid dispute reasons that qualify for refund
const VALID_REFUND_REASONS = [
  'item_not_received',
  'item_not_as_described',
  'item_damaged',
  'wrong_item',
  'counterfeit',
  'missing_parts',
  'seller_cancelled',
  'admin_override',
];

// Refund eligibility window in days
const REFUND_WINDOW_DAYS = 30;

// Create admin client for service operations
function createAdminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

// Create user-authenticated client
function createUserClient(authHeader: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    {
      global: {
        headers: { Authorization: authHeader },
      },
    }
  );
}

// Validate refund eligibility
function validateRefundEligibility(
  dispute: DisputeRecord,
  purchase: PurchaseRecord,
  refundType: 'full' | 'partial',
  amount?: number
): { eligible: boolean; reason: string } {
  // Check dispute status
  if (dispute.status === 'resolved' || dispute.status === 'closed') {
    return { eligible: false, reason: 'Dispute has already been resolved or closed' };
  }

  // Check purchase status
  if (purchase.status === 'refunded') {
    return { eligible: false, reason: 'This purchase has already been refunded' };
  }

  if (purchase.status !== 'completed') {
    return { eligible: false, reason: 'Only completed purchases can be refunded' };
  }

  // Check if purchase is within refund window
  const purchaseDate = new Date(purchase.completed_at);
  const now = new Date();
  const daysSincePurchase = Math.floor(
    (now.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSincePurchase > REFUND_WINDOW_DAYS) {
    return {
      eligible: false,
      reason: `Refund window has expired. Purchases must be within ${REFUND_WINDOW_DAYS} days. This purchase was ${daysSincePurchase} days ago.`,
    };
  }

  // Validate dispute reason
  if (!VALID_REFUND_REASONS.includes(dispute.reason)) {
    return {
      eligible: false,
      reason: `Invalid refund reason: ${dispute.reason}. Valid reasons are: ${VALID_REFUND_REASONS.join(', ')}`,
    };
  }

  // Validate partial refund amount
  if (refundType === 'partial') {
    if (!amount || amount <= 0) {
      return { eligible: false, reason: 'Partial refund requires a valid positive amount' };
    }
    const purchaseAmount = parseFloat(purchase.amount);
    if (amount > purchaseAmount) {
      return {
        eligible: false,
        reason: `Refund amount ($${amount}) cannot exceed purchase amount ($${purchaseAmount})`,
      };
    }
  }

  // Check for Stripe payment intent
  if (!purchase.stripe_payment_intent_id) {
    return { eligible: false, reason: 'No payment record found for this purchase' };
  }

  return { eligible: true, reason: 'Refund eligible' };
}

// Process the refund through Stripe
async function processStripeRefund(
  paymentIntentId: string,
  amount: number, // Amount in dollars
  reason: string
): Promise<{ success: boolean; refundId?: string; error?: string }> {
  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
    apiVersion: "2023-10-16",
  });

  try {
    // Get the payment intent to find charges
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (!paymentIntent.latest_charge) {
      return { success: false, error: 'No charge found for this payment' };
    }

    const chargeId = typeof paymentIntent.latest_charge === 'string'
      ? paymentIntent.latest_charge
      : paymentIntent.latest_charge.id;

    // Map our reason to Stripe's reason enum
    const stripeReason = reason.includes('fraud') || reason === 'counterfeit'
      ? 'fraudulent'
      : reason === 'item_not_received' || reason === 'item_damaged'
        ? 'requested_by_customer'
        : 'duplicate';

    // Create the refund
    const refund = await stripe.refunds.create({
      charge: chargeId,
      amount: Math.round(amount * 100), // Convert to cents
      reason: stripeReason,
      metadata: {
        dispute_reason: reason,
        refund_type: amount === parseFloat(String(paymentIntent.amount / 100)) ? 'full' : 'partial',
      },
    });

    return {
      success: true,
      refundId: refund.id,
    };
  } catch (error) {
    console.error('Stripe refund error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown Stripe error',
    };
  }
}

// Create notification record
async function createNotification(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  type: string,
  title: string,
  message: string,
  link?: string
): Promise<void> {
  try {
    await supabase.from("user_notifications").insert({
      user_id: userId,
      type,
      title,
      message,
      link,
      read: false,
    });
  } catch (err) {
    // Non-critical - just log
    console.log("Failed to create notification:", err);
  }
}

// Add timeline event to dispute
async function addDisputeTimelineEvent(
  supabase: ReturnType<typeof createAdminClient>,
  disputeId: string,
  eventType: string,
  description: string,
  performedBy: string
): Promise<void> {
  try {
    // Get current timeline events
    const { data: dispute } = await supabase
      .from("marketplace_disputes")
      .select("timeline_events")
      .eq("id", disputeId)
      .single();

    const timelineEvents = dispute?.timeline_events || [];
    
    timelineEvents.push({
      id: crypto.randomUUID(),
      type: eventType,
      description,
      performed_by: performedBy,
      timestamp: new Date().toISOString(),
    });

    await supabase
      .from("marketplace_disputes")
      .update({ timeline_events: timelineEvents })
      .eq("id", disputeId);
  } catch (err) {
    console.error("Failed to add timeline event:", err);
  }
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

    // Create clients
    const userClient = createUserClient(authHeader);
    const adminClient = createAdminClient();

    // Verify user is authenticated
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request body
    const body: RefundRequest = await req.json();
    const { disputeId, refundType, amount, reason, adminNotes } = body;

    // Validate required fields
    if (!disputeId || !refundType || !reason) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: disputeId, refundType, reason" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check if user is admin (for now, check a user metadata field or role)
    const { data: userProfile } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const isAdmin = userProfile?.role === "admin";

    // Get dispute details
    const { data: dispute, error: disputeError } = await adminClient
      .from("marketplace_disputes")
      .select("*")
      .eq("id", disputeId)
      .single();

    if (disputeError || !dispute) {
      return new Response(
        JSON.stringify({ error: "Dispute not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check authorization - only admin or seller can process refunds
    const isSeller = dispute.seller_id === user.id;
    if (!isAdmin && !isSeller) {
      return new Response(
        JSON.stringify({ error: "Only admins or the seller can process refunds" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get purchase details
    const { data: purchase, error: purchaseError } = await adminClient
      .from("marketplace_purchases")
      .select("*")
      .eq("id", dispute.order_id)
      .single();

    if (purchaseError || !purchase) {
      return new Response(
        JSON.stringify({ error: "Associated purchase not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate refund eligibility
    const eligibility = validateRefundEligibility(
      dispute as DisputeRecord,
      purchase as PurchaseRecord,
      refundType,
      amount
    );

    if (!eligibility.eligible) {
      return new Response(
        JSON.stringify({ error: eligibility.reason, code: "REFUND_INELIGIBLE" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Calculate refund amount
    const purchaseAmount = parseFloat(purchase.amount);
    const refundAmount = refundType === 'full' ? purchaseAmount : (amount || 0);

    console.log("Processing refund:", {
      disputeId,
      purchaseId: purchase.id,
      refundType,
      refundAmount,
      paymentIntentId: purchase.stripe_payment_intent_id,
    });

    // Process the refund through Stripe
    const stripeResult = await processStripeRefund(
      purchase.stripe_payment_intent_id,
      refundAmount,
      dispute.reason
    );

    if (!stripeResult.success) {
      console.error("Stripe refund failed:", stripeResult.error);
      return new Response(
        JSON.stringify({
          error: `Refund processing failed: ${stripeResult.error}`,
          code: "STRIPE_ERROR",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Update dispute status to resolved
    const resolution = refundType === 'full' 
      ? 'full_refund' 
      : 'partial_refund';

    const { error: updateDisputeError } = await adminClient
      .from("marketplace_disputes")
      .update({
        status: "resolved",
        resolution,
        resolution_date: new Date().toISOString(),
        refund_amount: refundAmount,
        stripe_refund_id: stripeResult.refundId,
        admin_notes: adminNotes ? [
          ...(dispute.admin_notes || []),
          {
            id: crypto.randomUUID(),
            note: adminNotes,
            created_by: user.id,
            created_at: new Date().toISOString(),
            internal: true,
          }
        ] : dispute.admin_notes,
      })
      .eq("id", disputeId);

    if (updateDisputeError) {
      console.error("Failed to update dispute:", updateDisputeError);
      // Refund was processed but DB update failed - log for manual resolution
    }

    // Update purchase status
    const purchaseStatus = refundType === 'full' ? 'refunded' : 'partial_refund';
    await adminClient
      .from("marketplace_purchases")
      .update({
        status: purchaseStatus,
        refund_amount: refundAmount.toString(),
      })
      .eq("id", purchase.id);

    // Re-activate listing if full refund (item returns to seller)
    if (refundType === 'full') {
      await adminClient
        .from("marketplace_listings")
        .update({ status: "active" })
        .eq("id", purchase.listing_id);
    }

    // Add timeline event
    await addDisputeTimelineEvent(
      adminClient,
      disputeId,
      "refund_processed",
      `${refundType === 'full' ? 'Full' : 'Partial'} refund of $${refundAmount.toFixed(2)} processed`,
      user.id
    );

    // Send notifications
    const formattedAmount = `$${refundAmount.toFixed(2)}`;

    // Notify buyer
    await createNotification(
      adminClient,
      dispute.buyer_id,
      "refund_processed",
      "Refund Processed",
      `Your refund of ${formattedAmount} has been processed for dispute #${disputeId.slice(0, 8)}. The funds should appear in your account within 5-10 business days.`,
      `/my-disputes`
    );

    // Notify seller
    await createNotification(
      adminClient,
      dispute.seller_id,
      "refund_processed",
      "Refund Issued",
      `A refund of ${formattedAmount} has been issued for dispute #${disputeId.slice(0, 8)}.`,
      `/seller/disputes`
    );

    console.log("Refund processed successfully:", {
      disputeId,
      refundId: stripeResult.refundId,
      amount: refundAmount,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: `Refund of ${formattedAmount} processed successfully`,
        data: {
          disputeId,
          refundId: stripeResult.refundId,
          amount: refundAmount,
          type: refundType,
          resolution,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Process refund error:", error);
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
