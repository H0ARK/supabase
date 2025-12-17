// @ts-ignore: Deno import
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
// @ts-ignore: Deno import  
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

/**
 * Get Prices API
 * 
 * Endpoints:
 * - GET /get-prices?product_id=123 - Get current price for a product
 * - GET /get-prices?product_ids=123,456,789 - Get prices for multiple products
 * - GET /get-prices?search=charizard - Search products and get their prices
 * - POST /get-prices { product_ids: [123, 456], include_history: true, days: 30 }
 */

interface PriceData {
  product_id: number;
  product_name?: string;
  set_name?: string;
  variants: {
    variant_name: string;
    low_price: number | null;
    mid_price: number | null;
    high_price: number | null;
    market_price: number | null;
    direct_low_price: number | null;
    as_of_date: string;
  }[];
  price_history?: {
    date: string;
    variant_name: string;
    market_price: number | null;
  }[];
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    let productIds: number[] = [];
    let search: string | null = null;
    let includeHistory = false;
    let historyDays = 30;

    // Handle both GET and POST
    if (req.method === "GET") {
      const productIdParam = url.searchParams.get("product_id");
      const productIdsParam = url.searchParams.get("product_ids");
      search = url.searchParams.get("search");
      includeHistory = url.searchParams.get("include_history") === "true";
      historyDays = parseInt(url.searchParams.get("days") || "30");

      if (productIdParam) {
        productIds = [parseInt(productIdParam)];
      } else if (productIdsParam) {
        productIds = productIdsParam.split(",").map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      }
    } else if (req.method === "POST") {
      const body = await req.json();
      productIds = body.product_ids || [];
      search = body.search || null;
      includeHistory = body.include_history || false;
      historyDays = body.days || 30;
    }

    // Search for products if search query provided
    if (search && productIds.length === 0) {
      const { data: searchResults, error: searchError } = await supabase
        .from("products")
        .select("id, name")
        .or(`name.ilike.%${search}%,clean_name.ilike.%${search}%`)
        .limit(20);

      if (searchError) {
        return new Response(
          JSON.stringify({ error: "Search failed", details: searchError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      productIds = (searchResults || []).map((p: any) => p.id);
    }

    if (productIds.length === 0) {
      return new Response(
        JSON.stringify({ error: "No products specified. Use product_id, product_ids, or search parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Limit to 100 products
    productIds = productIds.slice(0, 100);

    // Get product information
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select(`
        id,
        name,
        groups!inner (
          name
        )
      `)
      .in("id", productIds);

    if (productsError) {
      console.error("Products error:", productsError);
    }

    const productMap = new Map((products || []).map((p: any) => [
      p.id,
      { name: p.name, set_name: p.groups?.name }
    ]));

    // Get latest date with prices
    const { data: latestDate } = await supabase
      .from("price_history")
      .select("recorded_at")
      .order("recorded_at", { ascending: false })
      .limit(1)
      .single();

    const currentDate = latestDate?.recorded_at || new Date().toISOString().split('T')[0];

    // Get variant names
    const { data: variants } = await supabase
      .from("variants")
      .select("id, name");
    
    const variantMap = new Map((variants || []).map((v: any) => [v.id, v.name]));

    // Get current prices
    const { data: currentPrices, error: pricesError } = await supabase
      .from("price_history")
      .select("product_id, variant_id, recorded_at, low_price, mid_price, high_price, market_price, direct_low_price, low_price_usd, mid_price_usd, high_price_usd, market_price_usd")
      .in("product_id", productIds)
      .eq("recorded_at", currentDate);

    if (pricesError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch prices", details: pricesError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Helper to convert cents to dollars
    function centsToUsd(cents: number | null, usdValue: number | null): number | null {
      if (usdValue !== null) return usdValue;
      if (cents === null) return null;
      return cents / 100;
    }

    // Group prices by product
    const pricesByProduct = new Map<number, PriceData>();
    
    for (const price of currentPrices || []) {
      if (!pricesByProduct.has(price.product_id)) {
        const productInfo = productMap.get(price.product_id);
        pricesByProduct.set(price.product_id, {
          product_id: price.product_id,
          product_name: productInfo?.name,
          set_name: productInfo?.set_name,
          variants: []
        });
      }

      const productData = pricesByProduct.get(price.product_id)!;
      productData.variants.push({
        variant_name: variantMap.get(price.variant_id) || "Unknown",
        low_price: centsToUsd(price.low_price, price.low_price_usd),
        mid_price: centsToUsd(price.mid_price, price.mid_price_usd),
        high_price: centsToUsd(price.high_price, price.high_price_usd),
        market_price: centsToUsd(price.market_price, price.market_price_usd),
        direct_low_price: centsToUsd(price.direct_low_price, null),
        as_of_date: price.recorded_at
      });
    }

    // Get price history if requested
    if (includeHistory) {
      const historyStartDate = new Date();
      historyStartDate.setDate(historyStartDate.getDate() - historyDays);
      const startDateStr = historyStartDate.toISOString().split('T')[0];

      const { data: history, error: historyError } = await supabase
        .from("price_history")
        .select("product_id, variant_id, recorded_at, market_price, market_price_usd")
        .in("product_id", productIds)
        .gte("recorded_at", startDateStr)
        .order("recorded_at", { ascending: true });

      if (!historyError && history) {
        for (const record of history) {
          const productData = pricesByProduct.get(record.product_id);
          if (productData) {
            if (!productData.price_history) {
              productData.price_history = [];
            }
            productData.price_history.push({
              date: record.recorded_at,
              variant_name: variantMap.get(record.variant_id) || "Unknown",
              market_price: centsToUsd(record.market_price, record.market_price_usd)
            });
          }
        }
      }
    }

    // Convert map to array
    const results = Array.from(pricesByProduct.values());

    // Add products with no prices
    for (const productId of productIds) {
      if (!pricesByProduct.has(productId)) {
        const productInfo = productMap.get(productId);
        results.push({
          product_id: productId,
          product_name: productInfo?.name,
          set_name: productInfo?.set_name,
          variants: []
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        as_of_date: currentDate,
        count: results.length,
        results
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
