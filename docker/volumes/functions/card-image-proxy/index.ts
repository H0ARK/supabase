// Card Image Proxy Edge Function
// Serves card images for synthetic Asian products with a "Japanese Example" overlay
// 
// Usage:
//   /card-image-proxy?id=<synthetic_product_id>  - Returns image with overlay
//   /card-image-proxy?id=<product_id>&overlay=false - Returns raw image (for regular products)
//
// For synthetic products (Korean/Chinese), the function looks up the Japanese source
// product and returns that image with a "JAPANESE EXAMPLE" overlay banner.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// Create the overlay SVG
function createOverlaySvg(width: number, height: number): string {
  const bannerHeight = Math.max(28, Math.floor(height * 0.06));
  const fontSize = Math.max(11, Math.floor(bannerHeight * 0.5));
  
  return `
    <!-- Semi-transparent banner at bottom -->
    <rect x="0" y="${height - bannerHeight}" width="${width}" height="${bannerHeight}" fill="rgba(0, 0, 0, 0.8)"/>
    <!-- Text -->
    <text 
      x="${width / 2}" 
      y="${height - bannerHeight / 2 + fontSize / 3}" 
      font-family="Arial, Helvetica, sans-serif" 
      font-size="${fontSize}" 
      font-weight="bold"
      fill="#FFD700" 
      text-anchor="middle"
      letter-spacing="1"
    >⚠ JAPANESE EXAMPLE</text>
  `;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const productId = url.searchParams.get('id');
    const size = url.searchParams.get('size') || '400'; // 200, 400, or original
    const forceOverlay = url.searchParams.get('overlay');

    if (!productId) {
      return new Response(
        JSON.stringify({ error: 'Missing id parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const numericId = parseInt(productId);
    let japaneseProductId: number | null = null;
    let needsOverlay = false;

    // Check if this is a synthetic product (ID >= 1,000,000,000)
    if (numericId >= 1000000000) {
      // Look up the Japanese source product
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      const { data: linkData } = await supabase
        .from('card_language_links')
        .select('japanese_product_id')
        .eq('synthetic_product_id', numericId)
        .single();

      if (linkData?.japanese_product_id) {
        japaneseProductId = linkData.japanese_product_id;
        needsOverlay = forceOverlay !== 'false'; // Default true for synthetic
      } else {
        // Try to get from synthetic_products.image_url directly
        const { data: spData } = await supabase
          .from('synthetic_products')
          .select('image_url')
          .eq('id', numericId)
          .single();
        
        if (spData?.image_url) {
          // Extract product ID from URL like "...product/573216_400w.jpg"
          const match = spData.image_url.match(/\/product\/(\d+)/);
          if (match) {
            japaneseProductId = parseInt(match[1]);
            needsOverlay = forceOverlay !== 'false';
          }
        }
      }
    }

    // Determine which product ID to use for the image
    const imageProductId = japaneseProductId || numericId;
    needsOverlay = needsOverlay || forceOverlay === 'true';

    // Build TCGPlayer CDN URL
    const sizeParam = size === 'original' ? '' : `_${size}w`;
    const tcgImageUrl = `https://tcgplayer-cdn.tcgplayer.com/product/${imageProductId}${sizeParam}.jpg`;

    // Fetch the original image
    const imageResponse = await fetch(tcgImageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': 'https://www.tcgplayer.com/',
      },
    });

    if (!imageResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Image not found', productId: imageProductId }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const imageBuffer = await imageResponse.arrayBuffer();

    // If no overlay needed, just return the image directly
    if (!needsOverlay) {
      return new Response(imageBuffer, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=86400',
          'X-Source-Product': imageProductId.toString(),
        },
      });
    }

    // For synthetic products, return SVG with embedded image + overlay
    const base64Image = btoa(
      new Uint8Array(imageBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );
    
    // Pokemon cards are roughly 2.5" x 3.5" = 1:1.4 ratio
    const width = parseInt(size) || 400;
    const height = Math.floor(width * 1.4);

    const svgWithOverlay = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <clipPath id="cardClip">
      <rect x="0" y="0" width="${width}" height="${height}" rx="12" ry="12"/>
    </clipPath>
  </defs>
  <g clip-path="url(#cardClip)">
    <image xlink:href="data:image/jpeg;base64,${base64Image}" 
           width="${width}" height="${height}" 
           preserveAspectRatio="xMidYMid slice"/>
    ${createOverlaySvg(width, height)}
  </g>
</svg>`;

    return new Response(svgWithOverlay, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=86400',
        'X-Source-Product': imageProductId.toString(),
        'X-Overlay-Applied': 'true',
      },
    });

  } catch (error) {
    console.error('Error:', error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
