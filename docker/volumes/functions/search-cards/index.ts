// v2 - Robust joined fields
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { createCompositeId } from "../_shared/cardId.ts";

// Keep this tiny to avoid Edge Function bundle bloat.
const IMAGE_NOT_FOUND_DATA_URL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const POKEMON_CATEGORY_IDS = [3, 85, 100086, 100087, 100088, 100089];

// NOTE: `products.product_type` is not fully reliable in the current dataset.
// We classify "card-like" products using structured card fields.
const CARD_LIKE_OR = [
  'card_number.not.is.null',
  'rarity_id.not.is.null',
  'card_type_id.not.is.null',
  'hp.not.is.null',
  'stage.not.is.null',
  'retreat_cost.not.is.null',
].join(',');

const SEALED_LIKE_AND = [
  'card_number.is.null',
  'rarity_id.is.null',
  'card_type_id.is.null',
  'hp.is.null',
  'stage.is.null',
  'retreat_cost.is.null',
].join(',');

function toIlikePattern(input: string): string {
  // PostgREST `or()` filter is a mini-language. Keep values conservative to
  // avoid accidentally breaking the expression (e.g. commas split clauses).
  const cleaned = (input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[(),]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "%%";
  return `%${tokens.join("%")}%`;
}

function toOptionalInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    if (lower === 'undefined' || lower === 'null' || lower === 'nan') return null;
    const asNumber = Number(trimmed);
    return Number.isFinite(asNumber) ? Math.trunc(asNumber) : null;
  }

  return null;
}

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
      countMode,
      categoryId, 
      groupId, 
      rarityId, 
      languages = [],
      productTypes = [],
      sortBy = 'name',
      sortOrder = 'asc'
    } = body;

    const categoryIdInt = toOptionalInt(categoryId);
    const groupIdInt = toOptionalInt(groupId);
    const rarityIdInt = toOptionalInt(rarityId);

    const normalizedCountMode = (() => {
      const raw = String(countMode ?? '').trim().toLowerCase();
      if (raw === 'exact') return 'exact' as const;
      if (raw === 'planned') return 'planned' as const;
      if (raw === 'estimated') return 'estimated' as const;
      // Default: don't request counts (fastest + avoids wildly inaccurate estimates).
      return null;
    })();

    const selectOptions = normalizedCountMode ? { count: normalizedCountMode } : undefined;

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    // Initial search for products
    let queryBuilder = supabaseClient
      .from('products')
      .select(`
        id, name, clean_name, card_number, local_image_url, url, product_type,
        group:groups!products_group_id_fkey(id, name, abbreviation),
        category:categories(id, name),
        rarity:rarities(id, name)
      `, selectOptions as any);

    // Apply search query
    if (query) {
      const pattern = toIlikePattern(query);
      queryBuilder = queryBuilder.or(
        `name.ilike.${pattern},clean_name.ilike.${pattern},card_number.ilike.${pattern}`,
      );
    }

    // Apply category filter
    // IMPORTANT: do not default to Pokemon-only if no category is selected.
    // If the user did not choose a category or a language, return results across all games.
    if (categoryIdInt !== null) {
      queryBuilder = queryBuilder.eq('category_id', categoryIdInt);
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
    }

    // Apply other filters
    if (groupIdInt !== null) {
      queryBuilder = queryBuilder.eq('group_id', groupIdInt);
    }
    if (rarityIdInt !== null) {
      queryBuilder = queryBuilder.eq('rarity_id', rarityIdInt);
    }

    // Apply product type filter (default to Cards)
    // Cards-only: card-like rows (and explicitly not sealed).
    // Sealed-only: explicitly sealed OR not-card-like.
    {
      const raw = Array.isArray(productTypes) ? productTypes : [];
      const normalized = raw
        .map((t) => String(t).trim().toLowerCase())
        .filter(Boolean);

      const wantsCard =
        normalized.length === 0 ||
        normalized.includes('cards only') ||
        normalized.includes('cards') ||
        normalized.includes('card');

      const wantsSealed =
        normalized.includes('sealed only') ||
        normalized.includes('sealed');

      // If both are selected, don't filter.
      if (wantsCard && wantsSealed) {
        // no-op
      } else if (wantsSealed && !wantsCard) {
        // Sealed-only: product_type=sealed OR all card fields are null.
        queryBuilder = queryBuilder.or(
          `product_type.eq.sealed,and(${SEALED_LIKE_AND})`,
        );
      } else {
        // Cards-only (default): exclude explicit sealed, and require card_number.
        // The user specifically requested to filter out products without card numbers
        // to avoid sealed product leaks and save resources.
        queryBuilder = queryBuilder
          .neq('product_type', 'sealed')
          .not('card_number', 'is', null);
      }
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
      .select('product_id, variant_id, market_price, low_price, mid_price, high_price, direct_low_price, market_price_usd, low_price_usd, mid_price_usd, high_price_usd, recorded_at')
      .in('product_id', productIds);

    if (pricingError) {
      console.error('[search-cards] Pricing error:', pricingError);
      // Don't fail the whole request, just log and continue with empty pricing
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

      // Construct Supabase storage URL with validation
      const categoryId = category?.id || 3;
      const groupId = group?.id;
      const productId = product.id;
      
      // Use local_image_url from database if available, otherwise construct it
      let imageUrl = product.local_image_url;
      
      if (!imageUrl && groupId && groupId > 0) {
        imageUrl = `https://api.rippzz.com/storage/v1/object/public/card-images/${categoryId}/${groupId}/product_${productId}.webp`;
      } else if (!imageUrl) {
        // Fall back to placeholder
        imageUrl = IMAGE_NOT_FOUND_DATA_URL;
        console.warn(`[search-cards] No imageUrl or groupId for product ${productId}, using fallback`);
      }
      
      // Find all unique variants for this product from the latest price map
      const productVariants = variantsByProduct.get(productIdNum);
      const uniqueVariants = productVariants ? Array.from(productVariants.values()) : [];
      uniqueVariants.sort((a, b) => a - b);
      
      if (uniqueVariants.length > 0) {
        for (const variantId of uniqueVariants) {
          // Get the latest price for THIS SPECIFIC variant from our map
          const latestPrice = latestPriceMap.get(`${productIdNum}_${variantId}`);
          
          const variantName = getVariantName(variantId);
          const marketPrice = getPrice(latestPrice?.market_price, latestPrice?.market_price_usd);
          const lowPrice = getPrice(latestPrice?.low_price, latestPrice?.low_price_usd);
          
          expandedResults.push({
            ...product,
            id: createCompositeId(product.id, variantId),
            setName: setName,
            number: cardNumber,
            localId: cardNumber,
            currentPrice: marketPrice || lowPrice,
            marketPrice: marketPrice,
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
              midPrice: getPrice(latestPrice?.mid_price, latestPrice?.mid_price_usd),
              highPrice: getPrice(latestPrice?.high_price, latestPrice?.high_price_usd),
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
          ...product,
          id: createCompositeId(product.id, fallbackVariantId),
          setName: setName,
          number: cardNumber,
          localId: cardNumber,
          currentPrice: 0,
          marketPrice: 0,
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
    const hasCount = count !== null && count !== undefined;
    const hasMore = hasCount ? count > (page * limit) : products.length >= limit;
    const totalPages = hasCount ? Math.ceil(count / limit) : null;

    return new Response(
      JSON.stringify({ 
        results: expandedResults,
        totalResults: count ?? null,
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
