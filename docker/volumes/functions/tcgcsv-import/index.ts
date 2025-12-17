// TCGCSV Price History Import Edge Function
// Downloads price archives from TCGCSV and imports them into Supabase

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PriceRecord {
  productId: number;
  subTypeName: string;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  marketPrice: number | null;
  directLowPrice: number | null;
}

// Convert price to smallint cents (for values under $327.67)
function priceToSmallInt(price: number | null): number | null {
  if (price === null || price === undefined) return null;
  const cents = Math.round(price * 100);
  if (cents > 32767) return null; // SMALLINT max
  return cents;
}

// Check if any price exceeds the smallint limit
function needsUsdPrices(record: PriceRecord): boolean {
  return (
    (record.lowPrice && record.lowPrice > 327.67) ||
    (record.midPrice && record.midPrice > 327.67) ||
    (record.highPrice && record.highPrice > 327.67) ||
    (record.marketPrice && record.marketPrice > 327.67)
  );
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { date, category_id, group_id } = await req.json();
    
    if (!date) {
      return new Response(
        JSON.stringify({ error: "date parameter is required (YYYY-MM-DD)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "http://kong:8000";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get variant mapping
    const { data: variants } = await supabase.from("variants").select("id, name");
    const variantMap = new Map(variants?.map((v: any) => [v.name, v.id]) || []);

    // Get or create variant ID
    async function getOrCreateVariantId(name: string): Promise<number> {
      if (variantMap.has(name)) {
        return variantMap.get(name)!;
      }
      const { data, error } = await supabase
        .from("variants")
        .upsert({ name }, { onConflict: "name" })
        .select("id")
        .single();
      if (data) {
        variantMap.set(name, data.id);
        return data.id;
      }
      throw new Error(`Failed to get/create variant: ${name}`);
    }

    let totalRecords = 0;
    let totalInserted = 0;
    let errors: string[] = [];

    // If specific category/group provided, fetch just that
    if (category_id && group_id) {
      const result = await importGroupPrices(
        date,
        category_id,
        group_id,
        supabase,
        getOrCreateVariantId
      );
      totalRecords += result.records;
      totalInserted += result.inserted;
      if (result.error) errors.push(result.error);
    } else {
      // Fetch categories (skip comics 69-70)
      const { data: categories } = await supabase
        .from("categories")
        .select("id")
        .not("id", "in", "(69,70)");

      if (!categories || categories.length === 0) {
        return new Response(
          JSON.stringify({ error: "No categories found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Process each category
      for (const cat of categories) {
        // Get groups for this category
        const { data: groups } = await supabase
          .from("groups")
          .select("id")
          .eq("category_id", cat.id);

        if (!groups) continue;

        for (const group of groups) {
          const result = await importGroupPrices(
            date,
            cat.id,
            group.id,
            supabase,
            getOrCreateVariantId
          );
          totalRecords += result.records;
          totalInserted += result.inserted;
          if (result.error) errors.push(result.error);

          // Small delay to avoid overwhelming the API
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        date,
        totalRecords,
        totalInserted,
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function importGroupPrices(
  date: string,
  categoryId: number,
  groupId: number,
  supabase: any,
  getOrCreateVariantId: (name: string) => Promise<number>
): Promise<{ records: number; inserted: number; error?: string }> {
  try {
    // Fetch prices from TCGCSV archive
    const url = `https://tcgcsv.com/archive/tcgplayer/${date}/${categoryId}/${groupId}/prices`;
    const response = await fetch(url);
    
    if (!response.ok) {
      if (response.status === 404) {
        // No data for this group on this date - normal
        return { records: 0, inserted: 0 };
      }
      return { records: 0, inserted: 0, error: `HTTP ${response.status} for ${categoryId}/${groupId}` };
    }

    const data = await response.json();
    
    if (!data.success || !Array.isArray(data.results)) {
      return { records: 0, inserted: 0 };
    }

    const records = [];
    for (const product of data.results) {
      const variantId = await getOrCreateVariantId(product.subTypeName || "Normal");
      const needsUsd = needsUsdPrices(product);

      records.push({
        product_id: product.productId,
        variant_id: variantId,
        recorded_at: date,
        low_price: priceToSmallInt(product.lowPrice),
        mid_price: priceToSmallInt(product.midPrice),
        high_price: priceToSmallInt(product.highPrice),
        market_price: priceToSmallInt(product.marketPrice),
        direct_low_price: priceToSmallInt(product.directLowPrice),
        low_price_usd: needsUsd ? product.lowPrice : null,
        mid_price_usd: needsUsd ? product.midPrice : null,
        high_price_usd: needsUsd ? product.highPrice : null,
        market_price_usd: needsUsd ? product.marketPrice : null,
      });
    }

    if (records.length === 0) {
      return { records: 0, inserted: 0 };
    }

    // Batch insert
    const { error } = await supabase
      .from("price_history")
      .upsert(records, { 
        onConflict: "product_id,variant_id,recorded_at",
        ignoreDuplicates: true 
      });

    if (error) {
      // FK constraint errors are expected for products we don't have
      if (!error.message.includes("foreign key")) {
        return { records: records.length, inserted: 0, error: error.message };
      }
    }

    return { records: records.length, inserted: records.length };
  } catch (error) {
    return { records: 0, inserted: 0, error: error.message };
  }
}
