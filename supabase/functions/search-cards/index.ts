import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { createCompositeId } from "../_shared/cardId.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const POKEMON_CATEGORY_IDS = [3, 85, 100086, 100087, 100088, 100089];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { 
      query = '', 
      limit = 20, 
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
      `);

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

    // Apply limit
    queryBuilder = queryBuilder.limit(limit);

    const { data: products, error } = await queryBuilder;

    if (error) {
      console.error('[search-cards] Database error:', error);
      throw error;
    }

    if (!products || products.length === 0) {
      return new Response(JSON.stringify({ results: [], totalResults: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const productIds = products.map(p => p.id);

    // Get latest pricing for each variant of these products using current_prices view
    const { data: pricingData, error: pricingError } = await supabaseClient
      .from('current_prices')
      .select('product_id, variant_id, market_price, recorded_at')
      .in('product_id', productIds);

    if (pricingError) {
      console.error('[search-cards] Pricing error:', pricingError);
    }

    // Expand variants
    const expandedResults: any[] = [];
    
    for (const product of products) {
      // Construct Supabase storage URL
      const categoryId = product.category?.id || 3;
      const groupId = product.group?.id;
      const productId = product.id;
      
      const imageUrl = groupId 
        ? `https://api.rippzz.com/storage/v1/object/public/card-images/${categoryId}/${groupId}/product_${productId}.webp`
        : product.local_image_url || '/404_IMAGE_NOT_FOUND.png';
      
      // Find all unique variants for this product from pricing data
      const productPricing = pricingData?.filter(ph => ph.product_id === product.id) || [];
      const uniqueVariants = [...new Set(productPricing.map(ph => ph.variant_id))];
      
      if (uniqueVariants.length > 0) {
        for (const variantId of uniqueVariants) {
          // Get the latest price for THIS SPECIFIC variant
          const latestPrice = productPricing.find(ph => ph.variant_id === variantId);
          
          const variantName = variantId === 1 ? 'Normal' : variantId === 2 ? 'Holofoil' : variantId === 3 ? 'Reverse Holofoil' : `Variant ${variantId}`;
          
          expandedResults.push({
            ...product,
            id: createCompositeId(product.id, variantId),
            productId: product.id,
            image: imageUrl,
            images: {
              small: imageUrl,
              normal: imageUrl,
              large: imageUrl,
            },
            variantId,
            variantName,
            pricing: {
              variant: { id: variantId, name: variantName },
              marketPrice: latestPrice?.market_price ? latestPrice.market_price / 100 : 0,
              lastUpdated: latestPrice?.recorded_at || new Date().toISOString()
            }
          });
        }
      } else {
        // Fallback for products with no pricing data
        expandedResults.push({
          ...product,
          id: createCompositeId(product.id, 1),
          image: imageUrl,
          images: {
            small: imageUrl,
            normal: imageUrl,
            large: imageUrl,
          },
          variantId: 1,
          variantName: 'Normal',
          pricing: {
            variant: { id: 1, name: 'Normal' },
            marketPrice: 0,
            lastUpdated: new Date().toISOString()
          }
        });
      }
    }

    return new Response(
      JSON.stringify({ 
        results: expandedResults,
        totalResults: expandedResults.length // Simple total for now
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
