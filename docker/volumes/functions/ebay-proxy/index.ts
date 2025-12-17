// eBay Proxy Edge Function
// Scrapes eBay sold listings for card sales data

import { DOMParser } from 'https://deno.land/x/deno_dom/deno-dom-wasm.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    let cardName: string | null;
    let cardNumber: string | null;
    let limit: number;

    // Support both GET (query params) and POST (body)
    if (req.method === 'POST') {
      const body = await req.json();
      cardName = body.cardName;
      cardNumber = body.cardNumber;
      limit = parseInt(body.limit || '10');
    } else {
      const url = new URL(req.url);
      cardName = url.searchParams.get('cardName');
      cardNumber = url.searchParams.get('cardNumber');
      limit = parseInt(url.searchParams.get('limit') || '10');
    }

    if (!cardName) {
      return new Response(
        JSON.stringify({ error: 'Missing cardName parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let query = cardName;
    if (cardNumber) {
      query = `${cardName} #${cardNumber}`;
    }

    const encodedQuery = encodeURIComponent(query);
    const ebayUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodedQuery}&LH_Sold=1&LH_Complete=1&rt=nc&_trksid=p2045573.m1684`;

    console.log(`Fetching eBay sales for: ${query}`);

    const response = await fetch(ebayUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`eBay returned ${response.status}`);
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    if (!doc) {
      throw new Error('Failed to parse eBay HTML');
    }

    interface Sale {
      itemId: string;
      title: string;
      salePrice: number;
      condition: string;
      soldDate: string;
      url: string;
      source: string;
    }

    const sales: Sale[] = [];
    const items = doc.querySelectorAll('.s-item__wrapper');

    for (const item of items) {
      if (sales.length >= limit) break;

      const titleElement = item.querySelector('.s-item__title');
      const priceElement = item.querySelector('.s-item__price');
      const dateElement = item.querySelector('.s-item__title--tagblock .POSITIVE');
      const linkElement = item.querySelector('.s-item__link');

      if (titleElement && priceElement) {
        const title = (titleElement.textContent || '').replace('New Listing', '').trim();
        const priceText = (priceElement.textContent || '').trim();
        const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));
        const soldDate = dateElement ? (dateElement.textContent || '').trim() : new Date().toISOString();
        const url = linkElement ? linkElement.getAttribute('href') : '';

        if (!isNaN(price) && price > 0) {
          sales.push({
            itemId: `ebay_${Date.now()}_${sales.length}`,
            title,
            salePrice: price,
            condition: 'Unknown',
            soldDate,
            url: url || '',
            source: 'ebay'
          });
        }
      }
    }

    // Calculate stats
    const prices = sales.map(s => s.salePrice);
    const stats = prices.length > 0 ? {
      average: prices.reduce((a, b) => a + b, 0) / prices.length,
      min: Math.min(...prices),
      max: Math.max(...prices),
      count: prices.length,
    } : null;

    return new Response(
      JSON.stringify({ sales, stats, query }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('eBay proxy error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
