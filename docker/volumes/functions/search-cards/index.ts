// Search Cards Edge Function
// REFACTORED: Full-text search on local database

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
    const { 
      query, 
      limit = 20, 
      offset = 0,
      category_id,  // 3 = Pokemon
      category_name,
      group_id,     // Set/expansion
      set_name,
      card_number,
      rarity,
      min_price,
      max_price,
      sort_by = 'name',
      sort_order = 'asc'
    } = await req.json();

    if (!query || query.length < 2) {
      throw new Error('Search query must be at least 2 characters');
    }

    // Create Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Resolve category_name to category_id if provided
    let targetCategoryId = category_id;
    if (category_name && !targetCategoryId) {
      const { data: catData } = await supabase
        .from('categories')
        .select('id')
        .ilike('name', category_name)
        .maybeSingle();
      if (catData) targetCategoryId = catData.id;
    }

    // Detect language hint in query (e.g. "(JP)")
    // If found, we might want to switch category to Japanese (85) if not strictly defined
    let cleanQuery = query;
    if (query.toUpperCase().includes('(JP)')) {
        cleanQuery = query.replace(/\s*\(JP\)\s*/i, '').trim();
        // If category is generic "Pokemon" (3) or undefined, prefer Japanese (85)
        if (!targetCategoryId || targetCategoryId === 3) {
            targetCategoryId = 85;
        }
    } else if (query.toUpperCase().includes('(CN)')) {
        cleanQuery = query.replace(/\s*\(CN\)\s*/i, '').trim();
        // If category is generic "Pokemon" (3) or undefined, prefer Chinese (100086)
        if (!targetCategoryId || targetCategoryId === 3) {
            targetCategoryId = 100086;
        }
    } else if (query.toUpperCase().includes('(KO)') || query.toUpperCase().includes('(KR)')) {
        cleanQuery = query.replace(/\s*\(KO\)\s*/i, '').replace(/\s*\(KR\)\s*/i, '').trim();
        // If category is generic "Pokemon" (3) or undefined, prefer Korean (100087)
        if (!targetCategoryId || targetCategoryId === 3) {
            targetCategoryId = 100087;
        }
    } else if (query.toUpperCase().includes('(TW)')) {
        cleanQuery = query.replace(/\s*\(TW\)\s*/i, '').trim();
        // If category is generic "Pokemon" (3) or undefined, prefer Taiwan (100088)
        if (!targetCategoryId || targetCategoryId === 3) {
            targetCategoryId = 100088;
        }
    }

    // Resolve set_name to group_id if provided
    let targetGroupId = group_id;
    if (set_name && !targetGroupId) {
      // First try to find set in the target category
      if (targetCategoryId) {
        // Try exact match first
        let { data: strictGroups } = await supabase
            .from('groups')
            .select('id, category_id')
            .ilike('name', set_name)
            .eq('category_id', targetCategoryId)
            .limit(1);
            
        // If no exact match, try partial match (e.g. "Ancient Roar" matching "SV4K: Ancient Roar")
        if (!strictGroups || strictGroups.length === 0) {
             const { data: partialGroups } = await supabase
                .from('groups')
                .select('id, category_id')
                .ilike('name', `%${set_name}%`)
                .eq('category_id', targetCategoryId)
                .limit(1);
             strictGroups = partialGroups;
        }

        if (strictGroups && strictGroups.length > 0) {
            targetGroupId = strictGroups[0].id;
        }
      }

      // If not found in the target category (specifically English), check if it's a known Japanese set
      // This handles cases where the user lists "Ancient Roar" (JP set) under "Pokemon" (English category)
      // but allows "Black Bolt" (which exists in both) to resolve correctly for both languages
      if (!targetGroupId && (!targetCategoryId || targetCategoryId === 3)) {
          const jpSets = [
              'Ancient Roar', 'Black Bolt', 'Future Flash', 'Cyber Judge', 
              'Wild Force', 'Crimson Haze', 'Mask of Change', 'Night Wanderer', 
              'Stellar Miracle', 'Paradise Dragona', 'Super Electric Breaker'
          ];
          
          if (jpSets.some(s => set_name.toUpperCase().includes(s.toUpperCase()))) {
              // Try finding in Japanese category (85)
              let { data: jpGroups } = await supabase
                .from('groups')
                .select('id, category_id')
                .ilike('name', `%${set_name}%`)
                .eq('category_id', 85)
                .limit(1);

              if (jpGroups && jpGroups.length > 0) {
                  targetGroupId = jpGroups[0].id;
                  targetCategoryId = 85; // Switch category to Japanese
              }
          }
      }
      
      // If not found, try broader search across all categories
      if (!targetGroupId) {
        // Try exact match first
        let { data: looseGroups } = await supabase
            .from('groups')
            .select('id, category_id')
            .ilike('name', set_name);

        // If no exact match, try partial match
        if (!looseGroups || looseGroups.length === 0) {
            const { data: partialLooseGroups } = await supabase
                .from('groups')
                .select('id, category_id')
                .ilike('name', `%${set_name}%`);
            looseGroups = partialLooseGroups;
        }
      
        if (looseGroups && looseGroups.length > 0) {
            // Filter out synthetic categories (100000+) unless specifically requested
            // This prevents accidental matching of Korean/Chinese sets when looking for English/Japanese
            const isSyntheticTarget = targetCategoryId && targetCategoryId >= 100000;
            if (!isSyntheticTarget) {
                const nonSynthetic = looseGroups.filter(g => g.category_id < 100000);
                if (nonSynthetic.length > 0) {
                    looseGroups = nonSynthetic;
                }
            }

            let preferredGroup = null;

            // 1. If we have a target category, try to find a group in that category
            if (targetCategoryId) {
                preferredGroup = looseGroups.find(g => g.category_id == targetCategoryId);
            }

            // 2. If not found, prioritize Japanese (85) and English (3)
            if (!preferredGroup) {
                preferredGroup = looseGroups.find(g => g.category_id == 85) || 
                                 looseGroups.find(g => g.category_id == 3);
            }

            // 3. Fallback to whatever we found
            if (!preferredGroup) {
                preferredGroup = looseGroups[0];
            }
            
            targetGroupId = preferredGroup.id;
            
            // Update category to match the found set
            targetCategoryId = preferredGroup.category_id;
        }
      }
    }

    // Build the query - search products table with full-text search
    let dbQuery = supabase
      .from('products')
      .select(`
        id,
        name,
        clean_name,
        image,
        category_id,
        group_id,
        groups!inner(name, category_id),
        prices(market_price, low_price)
      `, { count: 'exact' });

    // Full-text search on name (using pg_trgm for fuzzy matching)
    // Use cleanQuery to remove "(JP)" etc.
    dbQuery = dbQuery.or(`name.ilike.%${cleanQuery}%,clean_name.ilike.%${cleanQuery}%`);

    // Apply filters
    if (targetCategoryId) {
      dbQuery = dbQuery.eq('category_id', targetCategoryId);
    }

    if (targetGroupId) {
      dbQuery = dbQuery.eq('group_id', targetGroupId);
    }

    if (card_number) {
      dbQuery = dbQuery.eq('card_number', card_number);
    }

    // Price filters (join with prices table)
    if (min_price !== undefined) {
      dbQuery = dbQuery.gte('prices.market_price', min_price);
    }
    if (max_price !== undefined) {
      dbQuery = dbQuery.lte('prices.market_price', max_price);
    }

    // Sorting
    const validSortFields = ['name', 'clean_name', 'id'];
    const sortField = validSortFields.includes(sort_by) ? sort_by : 'name';
    dbQuery = dbQuery.order(sortField, { ascending: sort_order === 'asc' });
    
    // Secondary sort by category_id to prioritize English (3) and Japanese (85)
    // over Chinese/Korean (100086+) when names are identical
    dbQuery = dbQuery.order('category_id', { ascending: true });

    // Pagination
    dbQuery = dbQuery.range(offset, offset + limit - 1);

    const { data: products, error, count } = await dbQuery;

    if (error) throw error;

    // Combine and format results
    const results = [
      ...(products || []).map(p => ({
        id: p.id,
        type: 'product',
        name: p.name,
        cleanName: p.clean_name,
        image: p.image,
        set: p.groups?.name,
        categoryId: p.category_id,
        price: p.prices?.[0]?.market_price || null,
      }))
    ];

    return new Response(
      JSON.stringify({
        results: results,
        total: count || results.length,
        query,
        limit,
        offset,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Search error:', error);
    return new Response(
      JSON.stringify({ error: error.message, results: [] }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
