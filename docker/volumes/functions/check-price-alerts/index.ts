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

    console.log("Checking price alerts...");

    // 1. Get active price alerts
    const { data: alerts, error: alertsError } = await supabaseClient
      .from("user_price_alerts")
      .select("*")
      .eq("is_active", true);

    if (alertsError) throw alertsError;

    console.log(`Found ${alerts?.length || 0} active price alerts.`);

    const triggered = [];

    for (const alert of alerts || []) {
      // 2. Get latest price for the product
      const { data: latestPrice, error: priceError } = await supabaseClient
        .from("price_history")
        .select("*")
        .eq("product_id", alert.tcgplayer_product_id)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .single();

      if (priceError || !latestPrice) {
        console.log(`No price history found for product ${alert.tcgplayer_product_id}`);
        continue;
      }

      const currentPrice = latestPrice.market_price || latestPrice.mid_price;
      if (!currentPrice) continue;

      let isTriggered = false;
      if (alert.direction === "above" && currentPrice >= alert.threshold) {
        isTriggered = true;
      } else if (alert.direction === "below" && currentPrice <= alert.threshold) {
        isTriggered = true;
      }

      if (isTriggered) {
        console.log(`Alert triggered for user ${alert.user_id} on product ${alert.tcgplayer_product_id}`);
        
        // 3. Create notification
        await supabaseClient.from("user_notifications").insert({
          user_id: alert.user_id,
          type: "price_alert",
          triggered_by_user_id: alert.user_id, // Self-triggered
        });

        // 4. Update alert
        await supabaseClient
          .from("user_price_alerts")
          .update({
            last_triggered_at: new Date().toISOString(),
            is_active: false, // Deactivate after triggering
          })
          .eq("id", alert.id);

        triggered.push({ id: alert.id, productId: alert.tcgplayer_product_id, price: currentPrice });
      }
    }

    return new Response(JSON.stringify({ success: true, triggered }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error checking price alerts:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
