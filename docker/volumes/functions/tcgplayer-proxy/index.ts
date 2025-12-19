// TCGPlayer Proxy Edge Function
// REFACTORED: Check local price_history first, fallback to external API
// UPDATED: Supports composite variant IDs (productId_variantId)

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { parseCardId } from '../_shared/cardId.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    let productIdParam = url.searchParams.get('productId');
    let range = url.searchParams.get('range') || 'quarter'; // day, week, month, quarter, year, all

    // Try to parse body if params are missing and method is POST
    if (!productIdParam && req.method === 'POST') {
      try {
        const body = await req.json();
        productIdParam = body.productId;
        if (body.range) range = body.range;
      } catch {
        // Ignore body parsing error
      }
    }

    if (!productIdParam) {
      return new Response(
        JSON.stringify({ error: 'Missing productId parameter' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Parse composite ID if provided
    const parsed = parseCardId(productIdParam);
    const productId = parsed.productId;
    const variantId = parsed.variantId;

    // Create Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Calculate date range
    const now = new Date();
    let startDate: Date;
    switch (range) {
      case 'day':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'quarter':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
        startDate = new Date('2020-01-01');
        break;
      default:
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    }

    console.log(`Fetching price history for product ${productId}, variant ${variantId}, range: ${range}`);

    // First, try to get data from local database
    let priceQuery = supabase
      .from('price_history')
      .select('*')
      .eq('product_id', productId)
      .gte('recorded_at', startDate.toISOString().split('T')[0])
      .order('recorded_at', { ascending: true });

    // Filter by variant if composite ID was provided
    if (parsed.isComposite) {
      priceQuery = priceQuery.eq('variant_id', variantId);
    }

    const { data: localData, error: localError } = await priceQuery;

    if (!localError && localData && localData.length > 0) {
      console.log(`Found ${localData.length} local price records`);
      
      // Format data to match TCGPlayer API response format
      const formattedData = {
        productId: productId,
        variantId: parsed.isComposite ? variantId : undefined,
        priceHistory: localData.map(p => ({
          date: p.recorded_at,
          variantId: p.variant_id,
          marketPrice: p.market_price,
          lowPrice: p.low_price,
          midPrice: p.mid_price,
          highPrice: p.high_price,
          directLowPrice: p.direct_low_price,
        })),
        source: 'local',
        count: localData.length,
      };

      return new Response(JSON.stringify(formattedData), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });
    }

    // Fallback to external TCGPlayer API if local data not available
    console.log('Local data not found, fetching from TCGPlayer...');
    
    const tcgUrl = `https://infinite-api.tcgplayer.com/price/history/${productId}/detailed?range=${range}`;
    const response = await fetch(tcgUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br'
      }
    });

    if (!response.ok) {
      throw new Error(`TCGPlayer API responded with ${response.status}`);
    }

    const data = await response.json();
    
    // Optionally store this data in local DB for future requests
    // (could be done async or via a separate cron job)
    
    return new Response(JSON.stringify({ ...data, source: 'tcgplayer' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error('Error:', error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});
