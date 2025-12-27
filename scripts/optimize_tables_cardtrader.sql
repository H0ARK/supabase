-- 1. Add CardTrader Mapping Columns
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS cardtrader_game_id INTEGER;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS cardtrader_category_id INTEGER;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS cardtrader_expansion_id INTEGER;
ALTER TABLE public.products 
  ADD COLUMN IF NOT EXISTS cardtrader_blueprint_id INTEGER,
  ADD COLUMN IF NOT EXISTS properties JSONB DEFAULT '{}'::jsonb;

-- 2. Drop dependent views temporarily
DROP VIEW IF EXISTS public.cards_needing_review;

-- 3. Migrate missing groups from set_region_mappings to groups
-- This is necessary to satisfy foreign key constraints during product migration.
INSERT INTO public.groups (id, category_id, name, abbreviation, published_on)
SELECT DISTINCT 
    synthetic_group_id::integer, 
    3, -- Assuming Pokemon for these Asian sets
    COALESCE(set_name_english, set_name_local), 
    asian_set_id, 
    release_date_local::date
FROM public.set_region_mappings srm
WHERE synthetic_group_id IS NOT NULL 
AND NOT EXISTS (SELECT 1 FROM public.groups g WHERE g.id = srm.synthetic_group_id::integer)
ON CONFLICT (id) DO NOTHING;

-- 4. Migrate remaining data from synthetic_products to products
INSERT INTO public.products (
    id, category_id, group_id, name, clean_name, card_number, 
    rarity_id, card_type_id, hp, stage, retreat_cost, 
    image_count, url, modified_on, card_text, 
    is_synthetic, source_data_path
)
SELECT 
    id, category_id, group_id, name, clean_name, card_number, 
    rarity_id, card_type_id, hp, stage, retreat_cost, 
    image_count, url, modified_on, card_text, 
    is_synthetic, source_data_path
FROM public.synthetic_products s
WHERE NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = s.id)
ON CONFLICT (id) DO NOTHING;

-- 5. Drop the redundant synthetic_products table
DROP TABLE IF EXISTS public.synthetic_products;

-- 6. Recreate the view using the products table
CREATE OR REPLACE VIEW public.cards_needing_review AS
 SELECT cll.synthetic_product_id,
    cll.language_code,
    cll.link_type,
    p_local.name AS local_name,
    p_en.name AS english_name,
    srm.set_name_local,
    srm.set_name_english
   FROM public.card_language_links cll
     JOIN public.products p_local ON cll.synthetic_product_id = p_local.id
     LEFT JOIN public.products p_en ON cll.english_product_id = p_en.id
     LEFT JOIN public.set_region_mappings srm ON p_local.group_id = srm.synthetic_group_id
  WHERE cll.needs_review = true;

-- 7. Prepare products table for sealed products migration
ALTER TABLE public.products 
  ADD COLUMN IF NOT EXISTS product_type TEXT DEFAULT 'card',
  ADD COLUMN IF NOT EXISTS pack_count INTEGER,
  ADD COLUMN IF NOT EXISTS cards_per_pack INTEGER;

-- 8. Create indexes for the new CardTrader columns
CREATE INDEX IF NOT EXISTS idx_products_cardtrader_blueprint_id ON public.products(cardtrader_blueprint_id);
CREATE INDEX IF NOT EXISTS idx_groups_cardtrader_expansion_id ON public.groups(cardtrader_expansion_id);
