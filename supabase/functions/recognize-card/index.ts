import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createCompositeId } from '../_shared/cardId.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { hashes } = await req.json()

    if (!hashes || !Array.isArray(hashes) || hashes.length !== 16) {
      return new Response(
        JSON.stringify({ error: 'Invalid input. Expected an array of 16 hashes.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )

    // We use a raw SQL query for the voting logic as it's more efficient than multiple Supabase calls
    const { data, error } = await supabase.rpc('match_card_hashes', {
      input_hashes_phash: hashes.map(h => h.toString()),
      input_hashes_dhash: null,
      input_global_hash: null,
    })

    if (error) throw error

    if (!data || data.length === 0) {
      return new Response(
        JSON.stringify({ results: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const productIds = data.map((p: any) => p.product_id)

    // Get latest pricing for each variant of these products using current_prices view
    const { data: pricingData, error: pricingError } = await supabase
      .from('current_prices')
      .select('product_id, variant_id, market_price, recorded_at')
      .in('product_id', productIds)

    if (pricingError) {
      console.error('[recognize-card] Pricing error:', pricingError)
    }

    // Expand variants
    const expandedResults: any[] = []
    
    for (const match of data) {
      const productPricing = pricingData?.filter(ph => ph.product_id === match.product_id) || []
      const uniqueVariants = [...new Set(productPricing.map(ph => ph.variant_id))]
      
      if (uniqueVariants.length > 0) {
        for (const variantId of uniqueVariants) {
          const latestPrice = productPricing.find(ph => ph.variant_id === variantId)
          
          const variantName = variantId === 1 ? 'Normal' : variantId === 2 ? 'Holofoil' : variantId === 3 ? 'Reverse Holofoil' : `Variant ${variantId}`
          
          expandedResults.push({
            ...match,
            id: createCompositeId(match.product_id, variantId),
            productId: match.product_id,
            variantId,
            variantName,
            pricing: {
              variant: { id: variantId, name: variantName },
              marketPrice: latestPrice?.market_price ? latestPrice.market_price / 100 : 0,
              lastUpdated: latestPrice?.recorded_at || new Date().toISOString()
            }
          })
        }
      } else {
        // Fallback for products with no pricing data
        expandedResults.push({
          ...match,
          id: createCompositeId(match.product_id, 1),
          variantId: 1,
          variantName: 'Normal',
          pricing: {
            variant: { id: 1, name: 'Normal' },
            marketPrice: 0,
            lastUpdated: new Date().toISOString()
          }
        })
      }
    }

    return new Response(
      JSON.stringify({ results: expandedResults }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
