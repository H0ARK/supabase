// @ts-ignore: Deno import
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
// @ts-ignore: Deno import  
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface PriceResult {
  productId: number;
  groupId: number;
  name: string;
  prices: {
    lowPrice: number | null;
    midPrice: number | null;
    highPrice: number | null;
    marketPrice: number | null;
    directLowPrice: number | null;
    subTypeName: string;
  }[];
  timestamp: string;
}

interface TCGCSVProduct {
  productId: number;
  name: string;
  cleanName: string;
  imageUrl: string;
  categoryId: number;
  groupId: number;
  url: string;
  modifiedOn: string;
  imageCount: number;
  presaleInfo: any;
  extendedData: any[];
}

interface TCGCSVPrice {
  productId: number;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  marketPrice: number | null;
  directLowPrice: number | null;
  subTypeName: string;
}

const TCGCSV_BASE = "https://tcgcsv.com";
const POKEMON_CATEGORY_ID = 3;

async function fetchProductById(productId: number): Promise<TCGCSVProduct | null> {
  // First try to find which group has this product
  const groupsRes = await fetch(`${TCGCSV_BASE}/${POKEMON_CATEGORY_ID}/groups`);
  if (!groupsRes.ok) return null;
  
  const groups = await groupsRes.json();
  
  for (const group of groups.results || []) {
    const productsRes = await fetch(`${TCGCSV_BASE}/${POKEMON_CATEGORY_ID}/${group.groupId}/products`);
    if (!productsRes.ok) continue;
    
    const products = await productsRes.json();
    const found = products.results?.find((p: any) => p.productId === productId);
    if (found) return found;
  }
  
  return null;
}

async function fetchPricesByProductId(productId: number): Promise<TCGCSVPrice[]> {
  // We need to find the group first
  const groupsRes = await fetch(`${TCGCSV_BASE}/${POKEMON_CATEGORY_ID}/groups`);
  if (!groupsRes.ok) return [];
  
  const groups = await groupsRes.json();
  
  for (const group of groups.results || []) {
    const pricesRes = await fetch(`${TCGCSV_BASE}/${POKEMON_CATEGORY_ID}/${group.groupId}/prices`);
    if (!pricesRes.ok) continue;
    
    const prices = await pricesRes.json();
    const found = prices.results?.filter((p: any) => p.productId === productId);
    if (found && found.length > 0) return found;
  }
  
  return [];
}

async function searchProducts(query: string, limit = 10): Promise<TCGCSVProduct[]> {
  const groupsRes = await fetch(`${TCGCSV_BASE}/${POKEMON_CATEGORY_ID}/groups`);
  if (!groupsRes.ok) return [];
  
  const groups = await groupsRes.json();
  const results: TCGCSVProduct[] = [];
  const queryLower = query.toLowerCase();
  
  // Search through recent groups (limited to avoid timeout)
  const recentGroups = (groups.results || []).slice(-20);
  
  for (const group of recentGroups) {
    if (results.length >= limit) break;
    
    const productsRes = await fetch(`${TCGCSV_BASE}/${POKEMON_CATEGORY_ID}/${group.groupId}/products`);
    if (!productsRes.ok) continue;
    
    const products = await productsRes.json();
    const matches = (products.results || []).filter((p: any) => 
      p.name?.toLowerCase().includes(queryLower) || 
      p.cleanName?.toLowerCase().includes(queryLower)
    );
    
    results.push(...matches.slice(0, limit - results.length));
  }
  
  return results.slice(0, limit);
}

async function fetchGroupPrices(groupId: number): Promise<{products: TCGCSVProduct[], prices: TCGCSVPrice[]}> {
  const [productsRes, pricesRes] = await Promise.all([
    fetch(`${TCGCSV_BASE}/${POKEMON_CATEGORY_ID}/${groupId}/products`),
    fetch(`${TCGCSV_BASE}/${POKEMON_CATEGORY_ID}/${groupId}/prices`)
  ]);
  
  if (!productsRes.ok || !pricesRes.ok) {
    return { products: [], prices: [] };
  }
  
  const products = await productsRes.json();
  const prices = await pricesRes.json();
  
  return {
    products: products.results || [],
    prices: prices.results || []
  };
}

async function storeToDatabase(
  supabase: any, 
  results: PriceResult[],
  storeHistory: boolean = true
): Promise<number> {
  if (!storeHistory || results.length === 0) return 0;
  
  const today = new Date().toISOString().split('T')[0];
  let stored = 0;
  
  for (const result of results) {
    for (const price of result.prices) {
      const { error } = await supabase.from('price_history').upsert({
        product_id: result.productId,
        date: today,
        low_price: price.lowPrice,
        mid_price: price.midPrice,
        high_price: price.highPrice,
        market_price: price.marketPrice,
        direct_low_price: price.directLowPrice,
        sub_type_name: price.subTypeName
      }, {
        onConflict: 'product_id,date,sub_type_name'
      });
      
      if (!error) stored++;
    }
  }
  
  return stored;
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

    const body = await req.json();
    const { action, productId, groupId, search, limit = 10, storeHistory = true } = body;

    let results: PriceResult[] = [];
    let rawProducts: TCGCSVProduct[] = [];

    switch (action) {
      case "price": {
        // Get price for a specific product ID
        if (!productId) {
          return new Response(
            JSON.stringify({ error: "productId required for price action" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        const prices = await fetchPricesByProductId(productId);
        if (prices.length > 0) {
          results.push({
            productId,
            groupId: 0,
            name: `Product ${productId}`,
            prices: prices.map(p => ({
              lowPrice: p.lowPrice,
              midPrice: p.midPrice,
              highPrice: p.highPrice,
              marketPrice: p.marketPrice,
              directLowPrice: p.directLowPrice,
              subTypeName: p.subTypeName
            })),
            timestamp: new Date().toISOString()
          });
        }
        break;
      }

      case "search": {
        // Search for products and return with prices
        if (!search) {
          return new Response(
            JSON.stringify({ error: "search query required for search action" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        rawProducts = await searchProducts(search, limit);
        
        // Get prices for each product found
        for (const product of rawProducts) {
          const prices = await fetchPricesByProductId(product.productId);
          results.push({
            productId: product.productId,
            groupId: product.groupId,
            name: product.name,
            prices: prices.map(p => ({
              lowPrice: p.lowPrice,
              midPrice: p.midPrice,
              highPrice: p.highPrice,
              marketPrice: p.marketPrice,
              directLowPrice: p.directLowPrice,
              subTypeName: p.subTypeName
            })),
            timestamp: new Date().toISOString()
          });
        }
        break;
      }

      case "group": {
        // Get all products and prices for a group
        if (!groupId) {
          return new Response(
            JSON.stringify({ error: "groupId required for group action" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        const { products, prices } = await fetchGroupPrices(groupId);
        rawProducts = products;
        
        // Map prices to products
        const priceMap = new Map<number, TCGCSVPrice[]>();
        for (const price of prices) {
          if (!priceMap.has(price.productId)) {
            priceMap.set(price.productId, []);
          }
          priceMap.get(price.productId)!.push(price);
        }
        
        for (const product of products) {
          const productPrices = priceMap.get(product.productId) || [];
          results.push({
            productId: product.productId,
            groupId: product.groupId,
            name: product.name,
            prices: productPrices.map(p => ({
              lowPrice: p.lowPrice,
              midPrice: p.midPrice,
              highPrice: p.highPrice,
              marketPrice: p.marketPrice,
              directLowPrice: p.directLowPrice,
              subTypeName: p.subTypeName
            })),
            timestamp: new Date().toISOString()
          });
        }
        break;
      }

      default:
        return new Response(
          JSON.stringify({ error: "Invalid action. Use: price, search, or group" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    // Store to database if requested
    let storedCount = 0;
    if (storeHistory && results.length > 0) {
      storedCount = await storeToDatabase(supabase, results, storeHistory);
    }

    return new Response(
      JSON.stringify({
        success: true,
        action,
        count: results.length,
        storedCount,
        results,
        products: rawProducts.length > 0 ? rawProducts : undefined
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
