CREATE OR REPLACE FUNCTION get_user_collection_cards_secure(user_id_param uuid)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  portfolio_id uuid,
  tcgplayer_product_id integer,
  card_variant_id integer,
  quantity integer,
  condition text,
  acquired_date date,
  notes text,
  created_at timestamptz,
  updated_at timestamptz,
  is_graded boolean,
  grade numeric,
  grade_company text,
  grade_cert text,
  grade_date date,
  grade_notes text,
  purchase_price numeric,
  graded_market_price numeric,
  card_name text,
  clean_name text,
  card_number text,
  hp smallint,
  stage text,
  retreat_cost smallint,
  card_url text,
  image_count smallint,
  is_presale boolean,
  released_on date,
  card_text jsonb,
  group_id integer,
  set_name text,
  set_abbreviation text,
  set_release_date date,
  category_id integer,
  category_name text,
  rarity_name text,
  card_type_name text,
  variant_name text,
  market_price_cents smallint,
  low_price_cents smallint,
  mid_price_cents smallint,
  high_price_cents smallint,
  market_price numeric,
  low_price numeric,
  mid_price numeric,
  high_price numeric,
  price_updated_at date,
  image text
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    uc.id,
    uc.user_id,
    uc.portfolio_id,
    uc.tcgplayer_product_id,
    uc.card_variant_id,
    uc.quantity,
    uc.condition,
    uc.acquired_date,
    uc.notes,
    uc.created_at,
    uc.updated_at,
    -- Graded card fields
    uc.is_graded,
    uc.grade,
    uc.grade_company,
    uc.grade_cert,
    uc.grade_date,
    uc.grade_notes,
    uc.purchase_price,
    uc.market_price AS graded_market_price,
    -- Product fields
    p.name AS card_name,
    p.clean_name,
    p.card_number,
    p.hp,
    p.stage,
    p.retreat_cost,
    p.url AS card_url,
    p.image_count,
    p.is_presale,
    p.released_on,
    p.card_text,
    g.id AS group_id,
    g.name AS set_name,
    g.abbreviation AS set_abbreviation,
    g.published_on AS set_release_date,
    cat.id AS category_id,
    cat.name AS category_name,
    r.name AS rarity_name,
    ct.name AS card_type_name,
    v.name AS variant_name,
    COALESCE(variant_price.market_price, normal_price.market_price) AS market_price_cents,
    COALESCE(variant_price.low_price, normal_price.low_price) AS low_price_cents,
    COALESCE(variant_price.mid_price, normal_price.mid_price) AS mid_price_cents,
    COALESCE(variant_price.high_price, normal_price.high_price) AS high_price_cents,
    round(((COALESCE(variant_price.market_price, normal_price.market_price))::numeric / (100)::numeric), 2) AS market_price,
    round(((COALESCE(variant_price.low_price, normal_price.low_price))::numeric / (100)::numeric), 2) AS low_price,
    round(((COALESCE(variant_price.mid_price, normal_price.mid_price))::numeric / (100)::numeric), 2) AS mid_price,
    round(((COALESCE(variant_price.high_price, normal_price.high_price))::numeric / (100)::numeric), 2) AS high_price,
    COALESCE(variant_price.recorded_at, normal_price.recorded_at) AS price_updated_at,
    p.local_image_url AS image
  FROM user_collections uc
     LEFT JOIN products p ON p.id = uc.tcgplayer_product_id
     LEFT JOIN groups g ON g.id = p.group_id
     LEFT JOIN categories cat ON cat.id = p.category_id
     LEFT JOIN rarities r ON r.id = p.rarity_id
     LEFT JOIN card_types ct ON ct.id = p.card_type_id
     LEFT JOIN variants v ON v.id = uc.card_variant_id
     -- First try to get price for the specific variant
     LEFT JOIN LATERAL (
       SELECT ph.market_price, ph.low_price, ph.mid_price, ph.high_price, ph.recorded_at
       FROM price_history ph
       WHERE ph.product_id = uc.tcgplayer_product_id
         AND ph.variant_id = uc.card_variant_id
       ORDER BY ph.recorded_at DESC
       LIMIT 1
     ) variant_price ON true
     -- Fallback to variant 1 (Normal) if specific variant not found
     LEFT JOIN LATERAL (
       SELECT ph.market_price, ph.low_price, ph.mid_price, ph.high_price, ph.recorded_at
       FROM price_history ph
       WHERE ph.product_id = uc.tcgplayer_product_id
         AND ph.variant_id = 1
       ORDER BY ph.recorded_at DESC
       LIMIT 1
     ) normal_price ON true
  WHERE uc.user_id = user_id_param;
$$;
