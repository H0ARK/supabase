// v3 - Robust joined fields
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { parseCardId, createCompositeId } from "../_shared/cardId.ts";

// Keep this tiny to avoid Edge Function bundle bloat.
const IMAGE_NOT_FOUND_DATA_URL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { cardId, language = "en" } = await req.json();

    if (!cardId) throw new Error("Card ID is required");

    const { productId, variantId, isComposite } = parseCardId(cardId);

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    // Fetch card details from database
    const { data: product, error: productError } = await supabaseClient
      .from('products')
      .select(`
        id, name, clean_name, card_number, hp, stage, retreat_cost, url, local_image_url,
        released_on, is_presale,
        group:groups!products_group_id_fkey(id, name, abbreviation, published_on),
        category:categories(id, name),
        rarity:rarities(id, name),
        card_type:card_types(id, name)
      `)
      .eq('id', productId)
      .single();

    if (productError) throw productError;

    // Robustly handle joined fields that might be arrays or objects
    const getJoined = (val: any) => Array.isArray(val) ? val[0] : val;
    const group = getJoined(product.group);
    const category = getJoined(product.category);
    const rarity = getJoined(product.rarity);
    const cardType = getJoined(product.card_type);

    const cardNumber = product.card_number || (product as any).cardNumber || '';
    const setName = group?.name || 'Unknown Set';
    const setAbbr = group?.abbreviation || 'unknown';

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

    // Fetch latest pricing for all variants
    const { data: pricingRows, error: pricingError } = await supabaseClient
      .from('current_prices')
      .select('variant_id, market_price, low_price, mid_price, high_price, direct_low_price, market_price_usd, low_price_usd, mid_price_usd, high_price_usd, recorded_at')
      .eq('product_id', productId);

    if (pricingError) {
      console.error('[get-card-details] Pricing error:', pricingError);
    }

    const pricingByVariant = new Map<number, any>();
    if (pricingRows) {
      for (const row of pricingRows) {
        if (!pricingByVariant.has(row.variant_id)) {
          pricingByVariant.set(row.variant_id, row);
        }
      }
    }

    let variantIds = pricingByVariant.size
      ? Array.from(pricingByVariant.keys())
      : [];
    if (variantIds.length === 0) {
      variantIds = [variantId];
    } else if (isComposite && !variantIds.includes(variantId)) {
      variantIds.push(variantId);
    }
    variantIds.sort((a, b) => a - b);

    const variantNameMap = new Map<number, string>();
    if (variantIds.length) {
      const { data: variantRows, error: variantError } = await supabaseClient
        .from('variants')
        .select('id, name')
        .in('id', variantIds);

      if (variantError) {
        console.error('[get-card-details] Variant lookup error:', variantError);
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

    const resolvedVariantId = isComposite
      ? variantId
      : variantIds[0] ?? variantId;

    // Fetch variant-specific pricing history
    const { data: priceHistory, error: priceError } = await supabaseClient
      .from('price_history')
      .select('variant_id, market_price, low_price, mid_price, high_price, market_price_usd, low_price_usd, mid_price_usd, high_price_usd, recorded_at')
      .eq('product_id', productId)
      .eq('variant_id', resolvedVariantId)
      .order('recorded_at', { ascending: false })
      .limit(90);

    if (priceError) throw priceError;

    // Construct Supabase storage URL with validation
    const categoryId = category?.id || 3;
    const groupId = group?.id;
    
    // Use local_image_url from database if available, otherwise construct it
    let imageUrl = product.local_image_url;
    
    if (!imageUrl && groupId && groupId > 0) {
      imageUrl = `https://api.rippzz.com/storage/v1/object/public/card-images/${categoryId}/${groupId}/product_${productId}.webp`;
      console.log(`[get-card-details] Built image URL for product ${productId}:`, imageUrl);
    } else if (!imageUrl) {
      // Fall back to placeholder
      imageUrl = IMAGE_NOT_FOUND_DATA_URL;
      console.warn(`[get-card-details] No imageUrl or groupId for product ${productId}, using fallback:`, imageUrl);
    }

    const availableVariants = variantIds.map((vid) => ({
      id: vid,
      name: getVariantName(vid),
      available: true,
      productId: productId.toString(),
    }));

    const variantCards = variantIds.map((vid) => {
      const pricing = pricingByVariant.get(vid);
      const name = getVariantName(vid);
      return {
        ...product,
        id: createCompositeId(productId, vid),
        tcgplayerId: productId,
        localId: cardNumber,
        number: cardNumber,
        setName: setName,
        rarity: rarity?.name || 'Unknown',
        set: {
          id: setAbbr,
          name: setName,
        },
        variantId: vid,
        variantName: name,
        images: {
          normal: imageUrl,
          thumbnail: imageUrl,
        },
        image: imageUrl,
        local_image_url: imageUrl,
        currentPrice: pricing ? (getPrice(pricing.market_price, pricing.market_price_usd) || getPrice(pricing.low_price, pricing.low_price_usd)) : 0,
        marketPrice: pricing ? getPrice(pricing.market_price, pricing.market_price_usd) : 0,
        pricing: pricing ? {
          variant: { id: vid, name },
          marketPrice: getPrice(pricing.market_price, pricing.market_price_usd),
          lowPrice: getPrice(pricing.low_price, pricing.low_price_usd),
          midPrice: getPrice(pricing.mid_price, pricing.mid_price_usd),
          highPrice: getPrice(pricing.high_price, pricing.high_price_usd),
          directLowPrice: (pricing.direct_low_price || 0) / 100,
          lastUpdated: pricing.recorded_at,
          tcg: {
            [name.toLowerCase()]: {
              market: getPrice(pricing.market_price, pricing.market_price_usd),
              low: getPrice(pricing.low_price, pricing.low_price_usd),
              mid: getPrice(pricing.mid_price, pricing.mid_price_usd),
              high: getPrice(pricing.high_price, pricing.high_price_usd),
              directLow: (pricing.direct_low_price || 0) / 100,
              variant: { id: vid, name },
            },
            variant: { id: vid, name },
            updatedAt: pricing.recorded_at
          }
        } : null
      };
    });

    const variantName = getVariantName(resolvedVariantId);
    const selectedPricing = pricingByVariant.get(resolvedVariantId);

    const detailedProduct = variantCards.find(vc => vc.variantId === resolvedVariantId) || {
      ...product,
      id: createCompositeId(productId, resolvedVariantId),
      tcgplayerId: productId,
      localId: cardNumber,
      number: cardNumber,
      setName: setName,
      rarity: rarity?.name || 'Unknown',
      set: {
        id: setAbbr,
        name: setName,
      },
      variantId: resolvedVariantId,
      variantName,
      images: {
        normal: imageUrl,
        thumbnail: imageUrl,
      },
      image: imageUrl,
      local_image_url: imageUrl,
      currentPrice: selectedPricing ? (getPrice(selectedPricing.market_price, selectedPricing.market_price_usd) || getPrice(selectedPricing.low_price, selectedPricing.low_price_usd)) : 0,
      marketPrice: selectedPricing ? getPrice(selectedPricing.market_price, selectedPricing.market_price_usd) : 0,
      pricing: selectedPricing ? {
        variant: { id: resolvedVariantId, name: variantName },
        marketPrice: getPrice(selectedPricing.market_price, selectedPricing.market_price_usd),
        lowPrice: getPrice(selectedPricing.low_price, selectedPricing.low_price_usd),
        midPrice: getPrice(selectedPricing.mid_price, selectedPricing.mid_price_usd),
        highPrice: getPrice(selectedPricing.high_price, selectedPricing.high_price_usd),
        directLowPrice: (selectedPricing.direct_low_price || 0) / 100,
        lastUpdated: selectedPricing.recorded_at,
        tcg: {
          [variantName.toLowerCase()]: {
            market: getPrice(selectedPricing.market_price, selectedPricing.market_price_usd),
            low: getPrice(selectedPricing.low_price, selectedPricing.low_price_usd),
            mid: getPrice(selectedPricing.mid_price, selectedPricing.mid_price_usd),
            high: getPrice(selectedPricing.high_price, selectedPricing.high_price_usd),
            directLow: (selectedPricing.direct_low_price || 0) / 100,
            variant: { id: resolvedVariantId, name: variantName },
          },
          variant: { id: resolvedVariantId, name: variantName },
          updatedAt: selectedPricing.recorded_at
        }
      } : null,
    };

    // Add price history to the detailed product
    (detailedProduct as any).priceHistory = priceHistory?.map(ph => ({
      date: ph.recorded_at,
      price: getPrice(ph.market_price, ph.market_price_usd)
    })) || [];

    return new Response(
      JSON.stringify({ 
        card: detailedProduct,
        variants: availableVariants,
        variantCards: variantCards,
        debug: {
          variantIds,
          productId,
          variantId,
          isComposite,
          pricingCount: pricingByVariant.size,
          setName,
          cardNumber
        }
      }),
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
