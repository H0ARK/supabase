// Scrape PriceCharting Edge Function  
// REFACTORED: Check local pricecharting_data first, then scrape if needed

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const { cardId, cardName, setName, productId } = await req.json();

    if (!cardId && !cardName && !productId) {
      return new Response(
        JSON.stringify({ error: 'Missing cardId, cardName, or productId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Check local pricecharting_data table first
    console.log(`[${cardId || productId}] Checking local database...`);
    
    let localQuery = supabase
      .from('pricecharting_data')
      .select('*');

    if (productId) {
      localQuery = localQuery.eq('tcgplayer_product_id', productId);
    } else if (cardId) {
      localQuery = localQuery.eq('card_id', cardId);
    }

    const { data: localData } = await localQuery.single();

    if (localData && localData.updated_at) {
      const updatedAt = new Date(localData.updated_at);
      const isStale = Date.now() - updatedAt.getTime() > CACHE_TTL;
      
      if (!isStale) {
        console.log(`[${cardId || productId}] ✅ Local cache hit`);
        return new Response(JSON.stringify(localData), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 2. Check pricecharting_ebay_sales table
    const { data: ebaySales } = await supabase
      .from('pricecharting_ebay_sales')
      .select('*')
      .eq(productId ? 'product_id' : 'card_id', productId || cardId)
      .order('sold_date', { ascending: false })
      .limit(50);

    if (ebaySales && ebaySales.length > 0) {
      console.log(`[${cardId || productId}] Found ${ebaySales.length} local eBay sales`);
      
      // Calculate stats from local data
      const prices = ebaySales.map(s => s.price);
      const stats = {
        average: prices.reduce((a, b) => a + b, 0) / prices.length,
        min: Math.min(...prices),
        max: Math.max(...prices),
        count: prices.length,
      };

      return new Response(JSON.stringify({
        sales: ebaySales,
        stats,
        source: 'local',
        lastUpdated: ebaySales[0].sold_date,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 3. Fallback: Scrape from PriceCharting
    if (!cardName) {
      throw new Error('cardName required for scraping');
    }

    console.log(`[${cardId || productId}] Scraping from PriceCharting...`);
    
    const searchQuery = setName ? `${cardName} ${setName}` : cardName;
    const url = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(searchQuery)}`;
    
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const sales: Array<{ price: number; date: string; condition: string }> = [];
    let totalPrice = 0;
    let minPrice = Infinity;
    let maxPrice = 0;

    // Parse sales listings
    const listingRows = doc?.querySelectorAll('tr[id^="ebay-"]') || [];
    listingRows.forEach((row: Element) => {
      try {
        const priceCell = row.querySelector('[data-price]');
        const dateCell = row.querySelector('[data-date]');
        const conditionCell = row.querySelector('[data-condition]');

        if (priceCell) {
          const price = parseFloat(priceCell.textContent || '0');
          sales.push({
            price,
            date: dateCell?.textContent || new Date().toISOString(),
            condition: conditionCell?.textContent || 'unknown'
          });
          totalPrice += price;
          minPrice = Math.min(minPrice, price);
          maxPrice = Math.max(maxPrice, price);
        }
      } catch (e) {
        console.error('Error parsing row:', e);
      }
    });

    const result = {
      sales,
      stats: {
        average: totalPrice / sales.length || 0,
        min: minPrice === Infinity ? 0 : minPrice,
        max: maxPrice || 0
      },
      source: 'scrape',
      lastUpdated: new Date().toISOString()
    };

    // 4. Cache results in local database
    if (cardId || productId) {
      await supabase.from('pricecharting_data').upsert({
        card_id: cardId,
        tcgplayer_product_id: productId,
        data: result,
        updated_at: new Date().toISOString(),
      });
    }

    return new Response(JSON.stringify(result), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600'
      }
    });

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to scrape', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
