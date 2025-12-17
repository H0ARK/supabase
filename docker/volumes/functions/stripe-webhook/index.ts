import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0";

// =============================================================================
// STRIPE WEBHOOK HANDLER - Card Trader Marketplace
// =============================================================================
// Handles: checkout.session.completed, payment_intent.succeeded,
// payment_intent.payment_failed, charge.refunded, account.updated
//
// TEST MODE: Set TEST_MODE=true to log events without database writes
// =============================================================================

// ⚠️ TEST MODE FLAG - Set to false for production
const TEST_MODE = Deno.env.get("STRIPE_TEST_MODE") === "true" || true; // Default to true for safety

// Log prefix for easy filtering
const LOG_PREFIX = TEST_MODE ? "[TEST MODE]" : "[PRODUCTION]";

interface WebhookEventMetadata {
  listing_id?: string;
  buyer_id?: string;
  seller_id?: string;
  platform_fee?: string;
  seller_amount?: string;
  purchase_id?: string;
}

// Create admin client for webhook operations (no user context)
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

// Verify Stripe webhook signature
async function verifyWebhookSignature(
  payload: string,
  signature: string,
  webhookSecret: string
): Promise<Stripe.Event | null> {
  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
    apiVersion: "2023-10-16",
  });

  try {
    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return null;
  }
}

// Handle checkout.session.completed event
// Creates or updates the purchase record when checkout completes
async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
  supabase: ReturnType<typeof createAdminClient>
): Promise<void> {
  const metadata = session.metadata as WebhookEventMetadata;

  console.log(`${LOG_PREFIX} Processing checkout.session.completed:`, {
    sessionId: session.id,
    paymentIntentId: session.payment_intent,
    paymentStatus: session.payment_status,
    amountTotal: session.amount_total,
    currency: session.currency,
    metadata,
  });

  if (!metadata?.listing_id || !metadata?.buyer_id || !metadata?.seller_id) {
    console.error(`${LOG_PREFIX} Missing required metadata in checkout session:`, metadata);
    return;
  }

  // In TEST MODE, just log what would happen
  if (TEST_MODE) {
    console.log(`${LOG_PREFIX} Would update/create purchase record for listing: ${metadata.listing_id}`);
    console.log(`${LOG_PREFIX} Buyer: ${metadata.buyer_id}, Seller: ${metadata.seller_id}`);
    console.log(`${LOG_PREFIX} Payment Status: ${session.payment_status}`);
    if (session.payment_status === "paid") {
      console.log(`${LOG_PREFIX} Would mark listing as sold and notify seller`);
    }
    return;
  }

  // Check if purchase already exists (created during checkout initiation)
  const { data: existingPurchase } = await supabase
    .from("marketplace_purchases")
    .select("id, status")
    .eq("stripe_payment_intent_id", session.id)
    .single();

  if (existingPurchase) {
    // Update existing purchase with payment intent ID and status
    const { error: updateError } = await supabase
      .from("marketplace_purchases")
      .update({
        status: session.payment_status === "paid" ? "completed" : "pending",
        stripe_payment_intent_id:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.id,
        completed_at:
          session.payment_status === "paid"
            ? new Date().toISOString()
            : null,
      })
      .eq("id", existingPurchase.id);

    if (updateError) {
      console.error("Error updating purchase record:", updateError);
      throw updateError;
    }

    console.log("Updated existing purchase:", existingPurchase.id);

    // If payment completed, mark listing as sold
    if (session.payment_status === "paid") {
      await markListingAsSold(metadata.listing_id, supabase);
      await createNotificationRecord(
        metadata.seller_id,
        "order_received",
        "New Order Received",
        `You have a new order for your listing`,
        `/order/${existingPurchase.id}`,
        supabase
      );
    }
  } else {
    // Create new purchase record (fallback if not created during checkout)
    const platformFee = metadata.platform_fee
      ? parseFloat(metadata.platform_fee) / 100
      : 0;
    const amount = session.amount_total ? session.amount_total / 100 : 0;

    // Extract shipping address from checkout session
    const shippingDetails = session.shipping_details;
    const shippingAddress = shippingDetails?.address;

    const { data: newPurchase, error: insertError } = await supabase
      .from("marketplace_purchases")
      .insert({
        listing_id: metadata.listing_id,
        buyer_id: metadata.buyer_id,
        seller_id: metadata.seller_id,
        amount: amount.toString(),
        currency: (session.currency?.toUpperCase() as "USD" | "EUR" | "GBP") || "USD",
        platform_fee: platformFee.toString(),
        stripe_payment_intent_id:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.id,
        status: session.payment_status === "paid" ? "completed" : "pending",
        shipping_name: shippingDetails?.name || null,
        shipping_address: shippingAddress?.line1 || null,
        shipping_city: shippingAddress?.city || null,
        shipping_state: shippingAddress?.state || null,
        shipping_zip_code: shippingAddress?.postal_code || null,
        shipping_country: shippingAddress?.country || null,
        completed_at:
          session.payment_status === "paid" ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error creating purchase record:", insertError);
      throw insertError;
    }

    console.log("Created new purchase:", newPurchase?.id);

    // If payment completed, mark listing as sold and notify seller
    if (session.payment_status === "paid" && newPurchase) {
      await markListingAsSold(metadata.listing_id, supabase);
      await createNotificationRecord(
        metadata.seller_id,
        "order_received",
        "New Order Received",
        `You have a new order for your listing`,
        `/order/${newPurchase.id}`,
        supabase
      );
    }
  }
}

// Handle payment_intent.succeeded event
// Updates purchase status to completed
async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent,
  supabase: ReturnType<typeof createAdminClient>
): Promise<void> {
  console.log(`${LOG_PREFIX} Processing payment_intent.succeeded:`, {
    paymentIntentId: paymentIntent.id,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    metadata: paymentIntent.metadata,
  });

  // In TEST MODE, just log what would happen
  if (TEST_MODE) {
    const metadata = paymentIntent.metadata as WebhookEventMetadata;
    console.log(`${LOG_PREFIX} Would find and update purchase for payment intent: ${paymentIntent.id}`);
    if (metadata?.seller_id) {
      console.log(`${LOG_PREFIX} Would record sale for seller: ${metadata.seller_id}`);
    }
    console.log(`${LOG_PREFIX} Would notify buyer of successful payment`);
    return;
  }

  // Find purchase by payment intent ID
  const { data: purchase, error: findError } = await supabase
    .from("marketplace_purchases")
    .select("id, status, seller_id, buyer_id")
    .or(
      `stripe_payment_intent_id.eq.${paymentIntent.id},stripe_payment_intent_id.like.%${paymentIntent.id}%`
    )
    .single();

  if (findError || !purchase) {
    console.log(
      "No matching purchase found for payment intent:",
      paymentIntent.id
    );
    return;
  }

  // Only update if not already completed (idempotency)
  if (purchase.status === "completed") {
    console.log("Purchase already completed, skipping update:", purchase.id);
    return;
  }

  const { error: updateError } = await supabase
    .from("marketplace_purchases")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", purchase.id);

  if (updateError) {
    console.error("Error updating purchase status:", updateError);
    throw updateError;
  }

  console.log("Updated purchase to completed:", purchase.id);

  // Record sale in seller annual sales (for progressive tier tracking)
  const metadata = paymentIntent.metadata as WebhookEventMetadata;
  if (metadata?.seller_id && metadata?.platform_fee && metadata?.seller_amount) {
    const saleAmount = parseFloat(metadata.seller_amount) / 100; // Convert from cents
    const feeAmount = parseFloat(metadata.platform_fee) / 100; // Convert from cents
    
    const { error: recordError } = await supabase.rpc('record_seller_sale', {
      p_seller_id: metadata.seller_id,
      p_sale_amount: saleAmount,
      p_fee_amount: feeAmount
    });
    
    if (recordError) {
      console.error("Error recording seller sale:", recordError);
    } else {
      console.log(`Recorded sale for seller ${metadata.seller_id}: $${saleAmount}, fee: $${feeAmount}`);
    }
  }

  // Notify buyer of successful payment
  await createNotificationRecord(
    purchase.buyer_id,
    "payment_received",
    "Payment Successful",
    "Your payment has been processed successfully",
    `/order/${purchase.id}`,
    supabase
  );

  // Mark listing as sold if metadata available
  if (metadata?.listing_id) {
    await markListingAsSold(metadata.listing_id, supabase);
  }
}

// Handle payment_intent.payment_failed event
// Updates purchase status to failed with error message
async function handlePaymentIntentFailed(
  paymentIntent: Stripe.PaymentIntent,
  supabase: ReturnType<typeof createAdminClient>
): Promise<void> {
  console.log(`${LOG_PREFIX} Processing payment_intent.payment_failed:`, {
    paymentIntentId: paymentIntent.id,
    lastPaymentError: paymentIntent.last_payment_error?.message,
    errorCode: paymentIntent.last_payment_error?.code,
  });

  // In TEST MODE, just log what would happen
  if (TEST_MODE) {
    console.log(`${LOG_PREFIX} Would find and mark purchase as failed for: ${paymentIntent.id}`);
    console.log(`${LOG_PREFIX} Error: ${paymentIntent.last_payment_error?.message || 'Unknown'}`);
    console.log(`${LOG_PREFIX} Would notify buyer of failed payment`);
    return;
  }

  // Find purchase by payment intent ID
  const { data: purchase, error: findError } = await supabase
    .from("marketplace_purchases")
    .select("id, status, buyer_id")
    .or(
      `stripe_payment_intent_id.eq.${paymentIntent.id},stripe_payment_intent_id.like.%${paymentIntent.id}%`
    )
    .single();

  if (findError || !purchase) {
    console.log(
      "No matching purchase found for failed payment:",
      paymentIntent.id
    );
    return;
  }

  // Only update if not already failed (idempotency)
  if (purchase.status === "failed") {
    console.log("Purchase already marked as failed, skipping:", purchase.id);
    return;
  }

  const errorMessage =
    paymentIntent.last_payment_error?.message || "Payment failed";

  const { error: updateError } = await supabase
    .from("marketplace_purchases")
    .update({
      status: "failed",
      // Store error message in a metadata column if available, otherwise log it
    })
    .eq("id", purchase.id);

  if (updateError) {
    console.error("Error updating purchase to failed:", updateError);
    throw updateError;
  }

  console.log("Updated purchase to failed:", purchase.id, "Error:", errorMessage);

  // Notify buyer of failed payment
  await createNotificationRecord(
    purchase.buyer_id,
    "payment_failed",
    "Payment Failed",
    errorMessage,
    `/order/${purchase.id}`,
    supabase
  );
}

// Handle charge.refunded event
// Updates purchase status to refunded
async function handleChargeRefunded(
  charge: Stripe.Charge,
  supabase: ReturnType<typeof createAdminClient>
): Promise<void> {
  console.log(`${LOG_PREFIX} Processing charge.refunded:`, {
    chargeId: charge.id,
    paymentIntentId: charge.payment_intent,
    amountRefunded: charge.amount_refunded,
    refundReason: charge.refunds?.data?.[0]?.reason,
  });

  const paymentIntentId = charge.payment_intent;
  if (!paymentIntentId) {
    console.error(`${LOG_PREFIX} No payment intent ID in refunded charge`);
    return;
  }

  // In TEST MODE, just log what would happen
  if (TEST_MODE) {
    console.log(`${LOG_PREFIX} Would find and mark purchase as refunded for: ${paymentIntentId}`);
    console.log(`${LOG_PREFIX} Amount refunded: ${charge.amount_refunded / 100} ${charge.currency?.toUpperCase()}`);
    console.log(`${LOG_PREFIX} Would notify buyer and seller of refund`);
    return;
  }

  // Find purchase by payment intent ID
  const { data: purchase, error: findError } = await supabase
    .from("marketplace_purchases")
    .select("id, status, buyer_id, seller_id")
    .or(
      `stripe_payment_intent_id.eq.${paymentIntentId},stripe_payment_intent_id.like.%${paymentIntentId}%`
    )
    .single();

  if (findError || !purchase) {
    console.log(
      "No matching purchase found for refunded charge:",
      paymentIntentId
    );
    return;
  }

  // Only update if not already refunded (idempotency)
  if (purchase.status === "refunded") {
    console.log("Purchase already refunded, skipping:", purchase.id);
    return;
  }

  const { error: updateError } = await supabase
    .from("marketplace_purchases")
    .update({
      status: "refunded",
    })
    .eq("id", purchase.id);

  if (updateError) {
    console.error("Error updating purchase to refunded:", updateError);
    throw updateError;
  }

  console.log("Updated purchase to refunded:", purchase.id);

  // Notify both buyer and seller
  const refundReason = charge.refunds?.data?.[0]?.reason || "Refund processed";

  await createNotificationRecord(
    purchase.buyer_id,
    "refund_processed",
    "Refund Processed",
    `Your refund has been processed: ${refundReason}`,
    `/order/${purchase.id}`,
    supabase
  );

  await createNotificationRecord(
    purchase.seller_id,
    "refund_processed",
    "Order Refunded",
    `An order has been refunded: ${refundReason}`,
    `/order/${purchase.id}`,
    supabase
  );
}

// Handle account.updated event
// Updates seller account verification status
async function handleAccountUpdated(
  account: Stripe.Account,
  supabase: ReturnType<typeof createAdminClient>
): Promise<void> {
  console.log(`${LOG_PREFIX} Processing account.updated:`, {
    accountId: account.id,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
    requirements: account.requirements?.currently_due,
  });

  // Determine verification status based on account state
  let verificationStatus: "unverified" | "pending" | "verified" | "rejected" =
    "unverified";

  if (account.charges_enabled && account.payouts_enabled) {
    verificationStatus = "verified";
  } else if (account.details_submitted) {
    verificationStatus = "pending";
  } else if (
    account.requirements?.disabled_reason &&
    account.requirements.disabled_reason.includes("rejected")
  ) {
    verificationStatus = "rejected";
  }

  // In TEST MODE, just log what would happen
  if (TEST_MODE) {
    console.log(`${LOG_PREFIX} Would update seller account: ${account.id}`);
    console.log(`${LOG_PREFIX} New verification status: ${verificationStatus}`);
    console.log(`${LOG_PREFIX} Charges enabled: ${account.charges_enabled}, Payouts enabled: ${account.payouts_enabled}`);
    return;
  }

  // Update seller account in database
  const { error: updateError } = await supabase
    .from("seller_accounts")
    .update({
      onboarding_complete: account.details_submitted ?? false,
      charges_enabled: account.charges_enabled ?? false,
      payouts_enabled: account.payouts_enabled ?? false,
      verification_status: verificationStatus,
    })
    .eq("stripe_account_id", account.id);

  if (updateError) {
    console.error("Error updating seller account:", updateError);
    throw updateError;
  }

  console.log(
    "Updated seller account:",
    account.id,
    "Status:",
    verificationStatus
  );
}

// Helper: Mark a listing as sold
async function markListingAsSold(
  listingId: string,
  supabase: ReturnType<typeof createAdminClient>
): Promise<void> {
  const { error } = await supabase
    .from("marketplace_listings")
    .update({ status: "sold" })
    .eq("id", listingId)
    .eq("status", "active"); // Only update if currently active

  if (error) {
    console.error("Error marking listing as sold:", error);
    // Don't throw - this is not critical to webhook processing
  } else {
    console.log("Marked listing as sold:", listingId);
  }
}

// Helper: Create a notification record
// Note: This creates a placeholder for the notification system (Phase 4)
async function createNotificationRecord(
  userId: string,
  type: string,
  title: string,
  message: string,
  link: string,
  supabase: ReturnType<typeof createAdminClient>
): Promise<void> {
  try {
    // Check if user_notifications table exists
    const { error: insertError } = await supabase
      .from("user_notifications")
      .insert({
        user_id: userId,
        type,
        title,
        message,
        link,
        read: false,
      });

    if (insertError) {
      // Table might not exist yet (Phase 4), just log for now
      console.log(
        "Notification not created (table may not exist):",
        insertError.message
      );
      console.log("Notification would be:", { userId, type, title, message, link });
    } else {
      console.log("Created notification for user:", userId, type);
    }
  } catch (err) {
    // Silently fail notification creation - not critical
    console.log("Failed to create notification:", err);
  }
}

// Main webhook handler
Deno.serve(async (req) => {
  // Log startup status
  console.log(`${LOG_PREFIX} Stripe Webhook Handler Active`);
  console.log(`${LOG_PREFIX} Test Mode: ${TEST_MODE ? 'ENABLED - No database writes' : 'DISABLED - Production mode'}`);

  // Only accept POST requests
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!webhookSecret) {
      console.error("STRIPE_WEBHOOK_SECRET not configured");
      return new Response(
        JSON.stringify({ error: "Webhook secret not configured" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      console.error("Missing stripe-signature header");
      return new Response(
        JSON.stringify({ error: "Missing signature header" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const payload = await req.text();
    const event = await verifyWebhookSignature(payload, signature, webhookSecret);

    if (!event) {
      return new Response(
        JSON.stringify({ error: "Invalid webhook signature" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    console.log(`${LOG_PREFIX} Received webhook event:`, event.type, "ID:", event.id);

    const supabase = createAdminClient();

    // Route event to appropriate handler
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(
          event.data.object as Stripe.Checkout.Session,
          supabase
        );
        break;

      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(
          event.data.object as Stripe.PaymentIntent,
          supabase
        );
        break;

      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(
          event.data.object as Stripe.PaymentIntent,
          supabase
        );
        break;

      case "charge.refunded":
        await handleChargeRefunded(
          event.data.object as Stripe.Charge,
          supabase
        );
        break;

      case "account.updated":
        await handleAccountUpdated(
          event.data.object as Stripe.Account,
          supabase
        );
        break;

      default:
        console.log(`${LOG_PREFIX} Unhandled event type:`, event.type);
    }

    return new Response(JSON.stringify({ 
      received: true, 
      type: event.type,
      test_mode: TEST_MODE,
      message: TEST_MODE ? "Event logged (test mode - no DB writes)" : "Event processed"
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
