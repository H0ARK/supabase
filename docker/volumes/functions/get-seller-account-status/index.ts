import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";

/**
 * Get Seller Account Status Edge Function
 * 
 * Retrieves the current status of a seller's Stripe Connect account.
 * This includes verification status, charges/payouts enabled, and any
 * pending requirements.
 * 
 * Required env vars:
 * - SUPABASE_URL
 * - SUPABASE_ANON_KEY
 * - SUPABASE_SERVICE_ROLE_KEY
 * - STRIPE_SECRET_KEY
 */

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only accept GET or POST requests
  if (req.method !== "GET" && req.method !== "POST") {
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

    // Admin client for database operations
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

    // Get seller account from database
    const { data: sellerAccount, error: accountError } = await adminClient
      .from("seller_accounts")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (accountError || !sellerAccount) {
      return new Response(
        JSON.stringify({
          exists: false,
          message: "No seller account found",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // If no Stripe account ID, return database status only
    if (!sellerAccount.stripe_account_id) {
      return new Response(
        JSON.stringify({
          exists: true,
          stripeConnected: false,
          ...sellerAccount,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Initialize Stripe and get live status
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
      apiVersion: "2023-10-16",
    });

    try {
      const account = await stripe.accounts.retrieve(sellerAccount.stripe_account_id);

      // Determine verification status
      let verificationStatus: "unverified" | "pending" | "verified" | "rejected" = "unverified";
      
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

      // Update our database with latest status
      const { error: updateError } = await adminClient
        .from("seller_accounts")
        .update({
          onboarding_complete: account.details_submitted ?? false,
          charges_enabled: account.charges_enabled ?? false,
          payouts_enabled: account.payouts_enabled ?? false,
          verification_status: verificationStatus,
        })
        .eq("id", sellerAccount.id);

      if (updateError) {
        console.error("Error updating seller account:", updateError);
      }

      // Return comprehensive status
      return new Response(
        JSON.stringify({
          exists: true,
          stripeConnected: true,
          accountId: sellerAccount.stripe_account_id,
          onboardingComplete: account.details_submitted ?? false,
          chargesEnabled: account.charges_enabled ?? false,
          payoutsEnabled: account.payouts_enabled ?? false,
          verificationStatus,
          requirements: {
            currentlyDue: account.requirements?.currently_due ?? [],
            eventuallyDue: account.requirements?.eventually_due ?? [],
            pastDue: account.requirements?.past_due ?? [],
            disabledReason: account.requirements?.disabled_reason ?? null,
          },
          capabilities: {
            cardPayments: account.capabilities?.card_payments ?? "inactive",
            transfers: account.capabilities?.transfers ?? "inactive",
          },
          createdAt: sellerAccount.created_at,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } catch (stripeError) {
      // Stripe account may have been deleted or is invalid
      console.error("Error retrieving Stripe account:", stripeError);
      
      return new Response(
        JSON.stringify({
          exists: true,
          stripeConnected: false,
          error: "Unable to retrieve Stripe account status",
          ...sellerAccount,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  } catch (error) {
    console.error("Get seller account status error:", error);

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