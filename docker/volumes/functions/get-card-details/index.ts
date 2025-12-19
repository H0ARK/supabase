import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { parseCardId } from "../_shared/cardId.ts";

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

    const { productId, variantId } = parseCardId(cardId);

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

    // Fetch variant-specific pricing history
    const { data: priceHistory, error: priceError } = await supabaseClient
      .from('price_history')
      .select('variant_id, market_price, low_price, mid_price, high_price, recorded_at')
      .eq('product_id', productId)
      .eq('variant_id', variantId)
      .order('recorded_at', { ascending: false });

    if (priceError) throw priceError;

    // Get all available variants for selection
    const { data: variants, error: variantsError } = await supabaseClient
      .from('price_history')
      .select('variant_id')
      .eq('product_id', productId);
      
    const uniqueVariantIds = [...new Set(variants?.map(v => v.variant_id) || [])];
    const availableVariants = uniqueVariantIds.map(vid => ({
      id: vid,
      name: vid === 1 ? 'Normal' : vid === 2 ? 'Holofoil' : vid === 3 ? 'Reverse Holofoil' : `Variant ${vid}`,
      available: true,
      productId: productId.toString()
    }));

    const latestPricing = priceHistory?.[0] || null;
    const variantName = variantId === 1 ? 'Normal' : variantId === 2 ? 'Holofoil' : variantId === 3 ? 'Reverse Holofoil' : `Variant ${variantId}`;

    // Construct Supabase storage URL
    const categoryId = product.category?.id || 3;
    const groupId = product.group?.id;
    const imageUrl = groupId 
      ? `https://api.rippzz.com/storage/v1/object/public/card-images/${categoryId}/${groupId}/product_${productId}.webp`
      : product.local_image_url || '/404_IMAGE_NOT_FOUND.png';

    const enrichedProduct = {
      ...product,
      variantId,
      variantName,
      image: imageUrl,
      pricing: latestPricing ? {
        variant: { id: variantId, name: variantName },
        marketPrice: latestPricing.market_price,
        lowPrice: latestPricing.low_price,
        midPrice: latestPricing.mid_price,
        highPrice: latestPricing.high_price,
        lastUpdated: latestPricing.recorded_at
      } : null,
      priceHistory: priceHistory?.map(ph => ({
        date: ph.recorded_at,
        price: ph.market_price
      })) || []
    };

    return new Response(
      JSON.stringify({ 
        card: enrichedProduct,
        variants: availableVariants 
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
