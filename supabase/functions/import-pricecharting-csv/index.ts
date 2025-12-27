import { createClient } from 'jsr:@supabase/supabase-js@2'
import { parse } from 'https://deno.land/std@0.224.0/csv/parse.ts'

const TCG_CATEGORIES = [
  'pokemon-cards',
  'magic-cards',
  'yugioh-cards',
  'lorcana-cards',
  'one-piece-cards',
  'digimon-cards',
  'dragon-ball-cards',
  'garbage-pail-cards',
  'marvel-cards',
  'star-wars-cards',
  'other-tcg-cards'
]

const getCsvUrl = (category: string) => `https://www.pricecharting.com/price-guide/download-custom?t=f8bc66d1b86abd89584e7ea12a3d8d6b788dedb9&category=${category}`

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const processTask = async () => {
    try {
      for (const category of TCG_CATEGORIES) {
        console.log(`Downloading PriceCharting CSV for ${category}...`)
        const response = await fetch(getCsvUrl(category))
        if (!response.ok) {
          console.error(`Failed to download CSV for ${category}: ${response.statusText}`)
          continue
        }
        const csvText = await response.text()

        console.log(`CSV size for ${category}: ${csvText.length} bytes`)

        console.log(`Parsing CSV for ${category}...`)
        const records = parse(csvText, {
          skipFirstRow: true,
          columns: [
            'id', 'console-name', 'product-name', 'loose-price', 'cib-price', 'new-price',
            'graded-price', 'box-only-price', 'manual-only-price', 'bgs-10-price',
            'condition-17-price', 'condition-18-price', 'gamestop-price', 'gamestop-trade-price',
            'retail-loose-buy', 'retail-loose-sell', 'retail-cib-buy', 'retail-cib-sell',
            'retail-new-buy', 'retail-new-sell', 'upc', 'sales-volume', 'genre', 'tcg-id',
            'asin', 'epid', 'release-date'
          ]
        })

        console.log(`Parsed ${records.length} records for ${category}. Processing...`)

        const pricesToUpsert: any[] = []
        const historyToInsert: any[] = []

        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        const recordedAt = yesterday.toISOString().split('T')[0]
        const updatedAt = new Date().toISOString()

        const parsePrice = (val: string) => {
          if (!val) return null
          // Remove '$' and ',' before parsing
          const cleanVal = val.replace(/[$,]/g, '')
          const num = parseFloat(cleanVal)
          return isNaN(num) ? null : num
        }

        const BATCH_SIZE = 5000

        const processBatch = async () => {
          if (pricesToUpsert.length > 0) {
            const { error: upsertError } = await supabase
              .from('pricecharting_prices')
              .upsert(pricesToUpsert, { onConflict: 'pricecharting_id' })
            if (upsertError) console.error('Error upserting prices:', upsertError)
            pricesToUpsert.length = 0
          }

          if (historyToInsert.length > 0) {
            const { error: insertError } = await supabase
              .from('pricecharting_price_history')
              .upsert(historyToInsert, { onConflict: 'pricecharting_id, recorded_at' })
            if (insertError) console.error('Error inserting history:', insertError)
            historyToInsert.length = 0
          }
        }

        let count = 0
        for (const record of records) {
          const r = record as any;
          // Column mapping note:
          // PriceCharting CSV for Pokemon cards reuses legacy column names for specific grades.
          // Based on data analysis:
          // 'loose-price'       -> Ungraded
          // 'cib-price'         -> Grade 7 (approx)
          // 'new-price'         -> Grade 8 (approx)
          // 'graded-price'      -> Grade 9
          // 'box-only-price'    -> Grade 9.5
          // 'manual-only-price' -> PSA 10
          // 'bgs-10-price'      -> BGS 10
          // 'condition-17-price'-> CGC 10
          // 'condition-18-price'-> SGC 10
          const priceData = {
            pricecharting_id: r['id'],
            console_name: r['console-name'],
            product_name: r['product-name'],
            ungraded_price: parsePrice(r['loose-price']),
            grade_7_price: parsePrice(r['cib-price']),
            grade_8_price: parsePrice(r['new-price']),
            grade_9_price: parsePrice(r['graded-price']),
            grade_9_5_price: parsePrice(r['box-only-price']),
            psa_10_price: parsePrice(r['manual-only-price']),
            bgs_10_price: parsePrice(r['bgs-10-price']),
            cgc_10_price: parsePrice(r['condition-17-price']),
            sgc_10_price: parsePrice(r['condition-18-price']),
            sales_volume: parseInt(r['sales-volume']) || 0,
            release_date: r['release-date'] || null,
            updated_at: updatedAt
          }

          pricesToUpsert.push(priceData)

          historyToInsert.push({
            pricecharting_id: r['id'],
            recorded_at: recordedAt,
            ungraded_price: parsePrice(r['loose-price']),
            grade_7_price: parsePrice(r['cib-price']),
            grade_8_price: parsePrice(r['new-price']),
            grade_9_price: parsePrice(r['graded-price']),
            grade_9_5_price: parsePrice(r['box-only-price']),
            psa_10_price: parsePrice(r['manual-only-price']),
            bgs_10_price: parsePrice(r['bgs-10-price']),
            cgc_10_price: parsePrice(r['condition-17-price']),
            sgc_10_price: parsePrice(r['condition-18-price']),
          })

          count++
          if (pricesToUpsert.length >= BATCH_SIZE) {
            await processBatch()
          }
        }

        await processBatch()
        console.log(`Successfully processed ${count} records for ${category}.`)
      }
    } catch (error) {
      console.error('Error in processTask:', error)
    }
  }

  // @ts-ignore
  if (typeof EdgeRuntime !== 'undefined' && typeof EdgeRuntime.waitUntil === 'function') {
    console.log('Starting background processing...');
    // @ts-ignore
    EdgeRuntime.waitUntil(processTask());
    return new Response(JSON.stringify({ success: true, message: "Processing started in background" }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } else {
    console.log('Processing in foreground...');
    await processTask();
    return new Response(JSON.stringify({ success: true, message: "Processing completed" }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
})
