import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";

/**
 * Create Seller Account Edge Function
 * 
 * Handles Stripe Connect account creation and onboarding link generation.
 * This is the first step in the seller onboarding flow.
 * 
 * Flow:
 * 1. Create a Stripe Connect Express account
 * 2. Store account ID in seller_accounts table
 * 3. Generate onboarding link for the seller
 * 4. Return the link for redirect
 * 
 * Required env vars:
 * - SUPABASE_URL
 * - SUPABASE_ANON_KEY
 * - SUPABASE_SERVICE_ROLE_KEY
 * - STRIPE_SECRET_KEY
 * - FRONTEND_URL (for return/refresh URLs)
 */

interface CreateSellerAccountRequest {
  refreshUrl?: string;
  returnUrl?: string;
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

    // Parse request body
    const body: CreateSellerAccountRequest = await req.json().catch(() => ({}));
    const frontendUrl = Deno.env.get("FRONTEND_URL") ?? "http://localhost:5173";
    const refreshUrl = body.refreshUrl ?? `${frontendUrl}/seller-onboarding`;
    const returnUrl = body.returnUrl ?? `${frontendUrl}/seller-dashboard`;

    // Check if user already has a seller account
    const { data: existingAccount } = await adminClient
      .from("seller_accounts")
      .select("id, stripe_account_id, onboarding_complete")
      .eq("user_id", user.id)
      .single();

    // Initialize Stripe
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
      apiVersion: "2023-10-16",
    });

    let stripeAccountId: string;

    if (existingAccount?.stripe_account_id) {
      // User already has a Stripe account
      stripeAccountId = existingAccount.stripe_account_id;

      // If onboarding is complete, just return the dashboard URL
      if (existingAccount.onboarding_complete) {
        return new Response(
          JSON.stringify({
            success: true,
            accountId: stripeAccountId,
            onboardingComplete: true,
            message: "Seller account already exists and is fully onboarded",
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    } else {
      // Create a new Stripe Connect Express account
      console.log("Creating new Stripe Connect account for user:", user.id);

      // Build the seller's store URL on our platform
      const platformUrl = Deno.env.get("FRONTEND_URL") ?? "https://rippzz.com";
      const sellerStoreUrl = `${platformUrl}/store/${user.id}`;

      const account = await stripe.accounts.create({
        type: "express",
        email: user.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: "individual",
        business_profile: {
          mcc: "5945", // Hobby, Toy, and Game Shops
          url: sellerStoreUrl,
          product_description: "Trading cards and collectibles sold through the Rippzz marketplace",
        },
        metadata: {
          user_id: user.id,
          platform: "card-trader",
        },
      });

      stripeAccountId = account.id;

      // Store the account in our database
      const { error: insertError } = await adminClient
        .from("seller_accounts")
        .upsert({
          user_id: user.id,
          stripe_account_id: stripeAccountId,
          onboarding_complete: false,
          charges_enabled: false,
          payouts_enabled: false,
          verification_status: "unverified",
          created_at: new Date().toISOString(),
        }, {
          onConflict: "user_id",
        });

      if (insertError) {
        console.error("Error storing seller account:", insertError);
        // Don't fail - the Stripe account was created, we can recover
      }

      console.log("Created Stripe Connect account:", stripeAccountId);
    }

    // Generate an Account Link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });

    console.log("Generated onboarding link for account:", stripeAccountId);

    return new Response(
      JSON.stringify({
        success: true,
        accountId: stripeAccountId,
        onboardingUrl: accountLink.url,
        expiresAt: new Date(accountLink.expires_at * 1000).toISOString(),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Create seller account error:", error);

    // Handle Stripe-specific errors
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
