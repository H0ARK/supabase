// Get Card Details Edge Function
// REFACTORED: Now queries local database instead of external API

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { cardId, productId, language = 'en' } = await req.json();
    
    if (!cardId && !productId) {
      throw new Error('Card ID or Product ID is required');
    }

    // Create Supabase client with service role for direct DB access
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    let card = null;
    let prices = null;
    let variants = null;

    // Query by TCGPlayer product ID or card ID
    if (productId) {
      // Get product from products table
      const { data: product, error: productError } = await supabase
        .from('products')
        .select(`
          *,
          groups!inner(name, category_id),
          current_prices:prices(*)
        `)
        .eq('id', productId)
        .single();

      if (productError) throw productError;
      card = product;

      // Get variants for this product
      const { data: variantData } = await supabase
        .from('card_variants')
        .select('*')
        .eq('product_id', productId);
      variants = variantData;

      // Get recent price history
      const { data: priceHistory } = await supabase
        .from('price_history')
        .select('*')
        .eq('product_id', productId)
        .order('date', { ascending: false })
        .limit(30);
      prices = priceHistory;

    } else if (cardId) {
      // Query cards table by card ID (tcgdex format)
      const { data: cardData, error: cardError } = await supabase
        .from('cards')
        .select(`
          *,
          sets!inner(name, series_id),
          card_variants(*)
        `)
        .eq('id', cardId)
        .single();

      if (cardError) throw cardError;
      card = cardData;
      variants = cardData?.card_variants;

      // Get TCGPlayer product ID from third_party data
      const tcgplayerId = card?.third_party?.tcgplayer?.productId;
      if (tcgplayerId) {
        const { data: priceHistory } = await supabase
          .from('price_history')
          .select('*')
          .eq('product_id', tcgplayerId)
          .order('date', { ascending: false })
          .limit(30);
        prices = priceHistory;
      }
    }

    if (!card) {
      throw new Error('Card not found');
    }

    // Format response
    const response = {
      card: {
        id: card.id,
        name: typeof card.name === 'object' ? card.name[language] || card.name.en : card.name,
        image: card.image,
        rarity: card.rarity,
        category: card.category,
        set: card.sets?.name || card.groups?.name,
        attributes: card.attributes,
        third_party: card.third_party,
      },
      variants: variants?.map(v => ({
        id: v.id,
        name: v.name,
        type: v.variant_type,
      })),
      prices: prices?.map(p => ({
        date: p.date,
        market: p.market_price,
        low: p.low_price,
        mid: p.mid_price,
        high: p.high_price,
      })),
      currentPrice: card.current_prices?.[0] || null,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
