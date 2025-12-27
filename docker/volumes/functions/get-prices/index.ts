import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { parseCardId, createCompositeId } from "../_shared/cardId.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { cardIds } = await req.json();

    if (!cardIds || !Array.isArray(cardIds)) {
      throw new Error("cardIds array is required");
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    const parsedIds = cardIds.map(id => parseCardId(id));
    const productIds = [...new Set(parsedIds.map(p => p.productId))];
    const variantIds = [...new Set(parsedIds.map(p => p.variantId))].filter(id => !isNaN(id));

    const getUsd = (value: unknown): number | null => {
      if (value === null || value === undefined) return null;
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    };

    const getPrice = (cents: number | null | undefined, usd: unknown): number => {
      const usdNum = getUsd(usd);
      if (usdNum != null) return usdNum;
      if (cents != null) return cents / 100;
      return 0;
    };

    // Fetch latest pricing for all products in the request
    let pricingQuery = supabaseClient
      .from('current_prices')
      .select('product_id, variant_id, market_price, low_price, mid_price, high_price, direct_low_price, market_price_usd, low_price_usd, mid_price_usd, high_price_usd, recorded_at')
      .in('product_id', productIds);

    if (variantIds.length > 0) {
      pricingQuery = pricingQuery.in('variant_id', variantIds);
    }

    const { data: pricingData, error } = await pricingQuery;

    if (error) throw error;

    // Group pricing by product and variant
    const pricingMap = new Map<string, any>();
    for (const pricing of pricingData || []) {
      const key = `${pricing.product_id}_${pricing.variant_id}`;
      if (!pricingMap.has(key)) {
        pricingMap.set(key, pricing);
      }
    }

    const results = parsedIds.map(p => {
      const key = createCompositeId(p.productId, p.variantId);
      const pricing = pricingMap.get(key);
      
      return {
        cardId: key,
        productId: p.productId,
        variantId: p.variantId,
        success: !!pricing,
        pricing: pricing ? {
          marketPrice: getPrice(pricing.market_price, pricing.market_price_usd),
          lowPrice: getPrice(pricing.low_price, pricing.low_price_usd),
          midPrice: getPrice(pricing.mid_price, pricing.mid_price_usd),
          highPrice: getPrice(pricing.high_price, pricing.high_price_usd),
          directLowPrice: (pricing.direct_low_price || 0) / 100,
          lastUpdated: pricing.recorded_at
        } : null
      };
    });

    return new Response(
      JSON.stringify({ results }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
