import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { parseCompositeId } from "../_shared/cardId.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const body = await req.json();
    const { 
      compositeId,  // Format: "productId_variantId" (e.g., "620618_3")
      quantity = 1,
      condition,
      portfolioId,
      notes,
      acquiredDate
    } = body;

    if (!compositeId) {
      throw new Error('Missing compositeId parameter');
    }

    // Parse the composite ID to extract productId and variantId
    const { productId, variantId } = parseCompositeId(compositeId);

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: authHeader }
        }
      }
    );

    // Get the authenticated user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    // Check if this exact card (product + variant) already exists in the user's collection
    const { data: existing, error: checkError } = await supabaseClient
      .from('user_collections')
      .select('id, quantity')
      .eq('user_id', user.id)
      .eq('tcgplayer_product_id', productId)
      .eq('card_variant_id', variantId)
      .eq('portfolio_id', portfolioId || null)
      .maybeSingle();

    if (checkError) {
      console.error('[add-to-collection] Check error:', checkError);
      throw checkError;
    }

    let result;

    if (existing) {
      // Update existing entry - increment quantity
      const { data, error: updateError } = await supabaseClient
        .from('user_collections')
        .update({
          quantity: existing.quantity + quantity,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (updateError) {
        console.error('[add-to-collection] Update error:', updateError);
        throw updateError;
      }

      result = data;
    } else {
      // Insert new entry with BOTH productId AND variantId
      const { data, error: insertError } = await supabaseClient
        .from('user_collections')
        .insert({
          user_id: user.id,
          tcgplayer_product_id: productId,      // Numeric product ID
          card_variant_id: variantId,            // Numeric variant ID (1, 2, 3, etc.)
          quantity,
          condition,
          portfolio_id: portfolioId || null,
          notes,
          acquired_date: acquiredDate || null
        })
        .select()
        .single();

      if (insertError) {
        console.error('[add-to-collection] Insert error:', insertError);
        throw insertError;
      }

      result = data;
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        data: result,
        message: existing ? 'Quantity updated' : 'Card added to collection'
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e: any) {
    console.error('[add-to-collection] Function error:', e);
    return new Response(
      JSON.stringify({ 
        error: e.message,
        details: e.details || e.hint || null
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
