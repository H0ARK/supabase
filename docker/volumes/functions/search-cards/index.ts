// v2 - Robust joined fields
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const POKEMON_CATEGORY_IDS = [3, 85, 100086, 100087, 100088, 100089];

// Helper to create a composite ID for frontend use
const createCompositeId = (productId: number | string, variantId: number | string) => {
  return `${productId}_${variantId}`;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { 
      query = '', 
      limit = 20,
      page = 1,
      categoryId, 
      groupId, 
      rarityId, 
      languages = [],
      sortBy = 'name',
      sortOrder = 'asc'
    } = body;

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    // Initial search for products
    let queryBuilder = supabaseClient
      .from('products')
      .select(`
        id, name, clean_name, card_number, local_image_url, url,
        group:groups!products_group_id_fkey(id, name, abbreviation),
        category:categories(id, name),
        rarity:rarities(id, name)
      `, { count: 'exact' });

    // Apply search query
    if (query) {
      queryBuilder = queryBuilder.or(`name.ilike.%${query}%,clean_name.ilike.%${query}%,card_number.ilike.%${query}%`);
    }

    // Apply category filter
    if (categoryId) {
      queryBuilder = queryBuilder.eq('category_id', categoryId);
    } else if (languages && languages.length > 0) {
      // If no categoryId but languages provided, filter by language category IDs
      const languageCategoryIds: number[] = [];
      if (languages.includes('English')) languageCategoryIds.push(3);
      if (languages.includes('Japanese')) languageCategoryIds.push(85);
      if (languages.includes('Chinese (Simplified)')) languageCategoryIds.push(100086);
      if (languages.includes('Korean')) languageCategoryIds.push(100087);
      if (languages.includes('Chinese (Traditional)')) languageCategoryIds.push(100088);
      if (languages.includes('Thai')) languageCategoryIds.push(100089);
      
      if (languageCategoryIds.length > 0) {
        queryBuilder = queryBuilder.in('category_id', languageCategoryIds);
      }
    } else {
      // Default to Pokemon categories if nothing else specified
      queryBuilder = queryBuilder.in('category_id', POKEMON_CATEGORY_IDS);
    }

    // Apply other filters
    if (groupId) {
      queryBuilder = queryBuilder.eq('group_id', groupId);
    }
    if (rarityId) {
      queryBuilder = queryBuilder.eq('rarity_id', rarityId);
    }

    // Apply sorting
    if (sortBy === 'name') {
      queryBuilder = queryBuilder.order('name', { ascending: sortOrder === 'asc' });
    } else if (sortBy === 'released_on') {
      queryBuilder = queryBuilder.order('released_on', { ascending: sortOrder === 'asc', nullsLast: true });
    } else if (sortBy === 'card_number') {
      queryBuilder = queryBuilder.order('card_number', { ascending: sortOrder === 'asc', nullsLast: true });
    }

    // Add deterministic tie-breaker to prevent duplicate results across pages
    queryBuilder = queryBuilder.order('id', { ascending: true });

    // Apply pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    queryBuilder = queryBuilder.range(from, to);

    const { data: products, error, count } = await queryBuilder;

    if (error) {
      console.error('[search-cards] Database error:', error);
      throw error;
    }

    if (!products || products.length === 0) {
      return new Response(JSON.stringify({ results: [], totalResults: 0, page, hasMore: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Robustly handle joined fields that might be arrays or objects
    const getJoined = (val: any) => Array.isArray(val) ? val[0] : val;

    const productIds = products.map(p => Number(p.id));

    // Get latest pricing for each variant of these products using current_prices view
    const { data: pricingData, error: pricingError } = await supabaseClient
      .from('current_prices')
      .select('product_id, variant_id, market_price, low_price, mid_price, high_price, direct_low_price, recorded_at')
      .in('product_id', productIds);

    if (pricingError) {
      console.error('[search-cards] Pricing error:', pricingError);
    }

    // Group pricing by product_id and variant_id
    const latestPriceMap = new Map<string, any>();
    const variantsByProduct = new Map<number, Set<number>>();
    const variantIds = new Set<number>();
    if (pricingData) {
      for (const price of pricingData) {
        const productId = Number(price.product_id);
        const variantId = Number(price.variant_id);
        const key = `${productId}_${variantId}`;
        latestPriceMap.set(key, price);

        variantIds.add(variantId);
        let productVariants = variantsByProduct.get(productId);
        if (!productVariants) {
          productVariants = new Set<number>();
          variantsByProduct.set(productId, productVariants);
        }
        productVariants.add(variantId);
      }
    }

    const variantNameMap = new Map<number, string>();
    if (variantIds.size > 0) {
      const { data: variantRows, error: variantError } = await supabaseClient
        .from('variants')
        .select('id, name')
        .in('id', Array.from(variantIds));

      if (variantError) {
        console.error('[search-cards] Variant lookup error:', variantError);
      } else {
        for (const row of variantRows || []) {
          variantNameMap.set(row.id, row.name);
        }
      }
    }

    const getVariantName = (id: number) =>
      variantNameMap.get(id) ||
      (id === 1
        ? 'Normal'
        : id === 2
          ? 'Holofoil'
          : id === 3
            ? 'Reverse Holofoil'
            : `Variant ${id}`);

    // Expand variants
    const expandedResults: any[] = [];
    
    for (const product of products) {
      // Robustly handle joined fields
      const group = getJoined(product.group);
      const category = getJoined(product.category);
      const rarity = getJoined(product.rarity);

      const setName = group?.name || 'Unknown Set';
      const setAbbr = group?.abbreviation || 'unknown';
      const cardNumber = product.card_number || '';
      const productIdNum = Number(product.id);

      // Construct Supabase storage URL
      const categoryId = category?.id || 3;
      const groupId = group?.id;
      const productId = product.id;
      
      const imageUrl = groupId 
        ? `https://api.rippzz.com/storage/v1/object/public/card-images/${categoryId}/${groupId}/product_${productId}.webp`
        : product.local_image_url || '/404_IMAGE_NOT_FOUND.png';
      
      // Find all unique variants for this product from the latest price map
      const productVariants = variantsByProduct.get(productIdNum);
      const uniqueVariants = productVariants ? Array.from(productVariants.values()) : [];
      uniqueVariants.sort((a, b) => a - b);
      
      if (uniqueVariants.length > 0) {
        for (const variantId of uniqueVariants) {
          // Get the latest price for THIS SPECIFIC variant from our map
          const latestPrice = latestPriceMap.get(`${productIdNum}_${variantId}`);
          
          const variantName = getVariantName(variantId);
          const marketPrice = (latestPrice?.market_price || latestPrice?.low_price || 0) / 100;
          const lowPrice = (latestPrice?.low_price || latestPrice?.market_price || 0) / 100;
          
          expandedResults.push({
            id: createCompositeId(product.id, variantId),
            setName: setName,
            number: cardNumber,
            localId: cardNumber,
            currentPrice: marketPrice || lowPrice,
            marketPrice: marketPrice,
            ...product,
            image: imageUrl,
            local_image_url: imageUrl,
            variantId,
            variantName,
            set: {
              id: setAbbr,
              name: setName,
            },
            rarity: rarity?.name || 'Unknown',
            pricing: {
              variant: { id: variantId, name: variantName },
              marketPrice: marketPrice,
              lowPrice: lowPrice,
              midPrice: (latestPrice?.mid_price || 0) / 100,
              highPrice: (latestPrice?.high_price || 0) / 100,
              directLowPrice: (latestPrice?.direct_low_price || 0) / 100,
              lastUpdated: latestPrice?.recorded_at || new Date().toISOString()
            }
          });
        }
      } else {
        // Fallback for products with no pricing data
        const fallbackVariantId = 1;
        const fallbackVariantName = getVariantName(fallbackVariantId);

        expandedResults.push({
          id: createCompositeId(product.id, fallbackVariantId),
          setName: setName,
          number: cardNumber,
          localId: cardNumber,
          currentPrice: 0,
          marketPrice: 0,
          ...product,
          image: imageUrl,
          local_image_url: imageUrl,
          variantId: fallbackVariantId,
          variantName: fallbackVariantName,
          set: {
            id: setAbbr,
            name: setName,
          },
          rarity: rarity?.name || 'Unknown',
          pricing: {
            variant: { id: fallbackVariantId, name: fallbackVariantName },
            marketPrice: 0,
            lowPrice: 0,
            midPrice: 0,
            highPrice: 0,
            directLowPrice: 0,
            lastUpdated: new Date().toISOString()
          }
        });
      }
    }

    // Calculate hasMore based on total count of products
    const hasMore = (count || 0) > (page * limit);
    const totalPages = Math.ceil((count || 0) / limit);

    return new Response(
      JSON.stringify({ 
        results: expandedResults,
        totalResults: count || 0,
        totalPages,
        page,
        hasMore
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e: any) {
    console.error('[search-cards] Function error:', e);
    return new Response(
      JSON.stringify({ 
        error: e.message,
        details: e.details || e.hint || null
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
