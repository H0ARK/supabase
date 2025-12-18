import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
    // We'll use the rpc call if we want to keep it clean, or just use the supabase client with a custom function
    
    // For now, let's assume we have a postgres function 'match_card_hashes'
    const { data, error } = await supabase.rpc('match_card_hashes', {
      input_hashes: hashes.map(h => h.toString())
    })

    if (error) throw error

    return new Response(
      JSON.stringify({ results: data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
