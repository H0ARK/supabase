# Ideal Database Architecture - Polymorphic Design

## 🎯 Core Concept: Products as Pointers

Products table becomes a **lightweight registry** that points to specialized tables based on product type.

```
products (pointer table - just metadata & references)
    ↓ (polymorphic reference)
    ├─> pokemon_cards
    ├─> magic_cards  
    ├─> yugioh_cards
    └─> sealed_products
```

---

## 🗂️ New Schema Design

### Level 1: Games & Categories
```sql
CREATE TABLE games (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display_name TEXT,
    logo_url TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE categories (
    id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    game_id TEXT REFERENCES games(id),
    name TEXT NOT NULL,
    display_name TEXT,
    logo_url TEXT,
    popularity INTEGER DEFAULT 0,
    is_scannable BOOLEAN DEFAULT false,
    is_direct BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Level 2: Set Groups (formerly "groups")
```sql
CREATE TABLE set_groups (
    id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    name TEXT NOT NULL,
    slug TEXT,
    abbreviation TEXT,
    
    -- Pokemon-specific (nullable for other games)
    series_id TEXT,  -- "sv", "sm", "dp", etc.
    series_name TEXT, -- "Scarlet & Violet", "Sun & Moon"
    
    -- Set information
    release_date DATE,
    card_count JSONB, -- {"official": 100, "total": 105}
    symbol_url TEXT,
    logo_url TEXT,
    
    -- Market data
    set_value NUMERIC(10,2),
    set_value_history JSONB DEFAULT '[]'::jsonb,
    
    -- Metadata
    is_supplemental BOOLEAN DEFAULT false,
    legal_formats JSONB DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(category_id, slug)
);

CREATE INDEX idx_set_groups_category ON set_groups(category_id);
CREATE INDEX idx_set_groups_series ON set_groups(series_id) WHERE series_id IS NOT NULL;
CREATE INDEX idx_set_groups_release ON set_groups(release_date);
```

### Level 3: Products (Pointer Table)
```sql
CREATE TABLE products (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    
    -- Classification
    category_id INTEGER NOT NULL REFERENCES categories(id),
    set_group_id INTEGER REFERENCES set_groups(id),
    product_type TEXT NOT NULL, -- 'pokemon_card', 'magic_card', 'yugioh_card', 'sealed'
    
    -- Polymorphic Reference
    source_table TEXT NOT NULL, -- 'pokemon_cards', 'magic_cards', 'yugioh_cards', 'sealed_products'
    source_id BIGINT NOT NULL,  -- ID in the source table
    
    -- Data Source Tracking
    data_source TEXT, -- 'tcgplayer', 'tcgdex', 'pokemontcg_api', 'manual', 'collectr', etc.
    source_product_id TEXT, -- External ID from the data source
    is_verified BOOLEAN DEFAULT false,
    verified_by UUID,
    verified_at TIMESTAMPTZ
    
    -- Basic Info (denormalized for quick access)
    name TEXT NOT NULL,
    clean_name TEXT,
    card_number TEXT,
    image_url TEXT,
    
    -- Market Data (denormalized)
    current_price NUMERIC(10,2),
    price_updated_at TIMESTAMPTZ,
    
    -- Flags
    is_active BOOLEAN DEFAULT true,
    is_presale BOOLEAN DEFAULT false,
    
    -- Search
    search_vector TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(card_number, '')), 'B')
    ) STORED,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(source_table, source_id)
);

CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_set_group ON products(set_group_id);
CREATE INDEX idx_products_type ON products(product_type);
CREATE INDEX idx_products_source ON products(source_table, source_id);
CREATE INDEX idx_products_search ON products USING GIN(search_vector);
CREATE INDEX idx_products_active ON products(is_active) WHERE is_active = true;
```

---

## 🎮 Specialized Product Tables

### Pokemon Cards
```sql
CREATE TABLE pokemon_cards (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    
    -- Basic Info
    name TEXT NOT NULL,
    clean_name TEXT,
    card_number TEXT,
    set_code TEXT,
    
    -- Pokemon-Specific
    pokemon_type TEXT[], -- ['Fire', 'Dragon']
    hp INTEGER,
    stage TEXT, -- 'Basic', 'Stage 1', 'Stage 2', 'VMAX', 'ex'
    evolution_from TEXT,
    retreat_cost INTEGER,
    regulation_mark TEXT, -- 'G', 'H', etc.
    
    -- Card Details
    rarity_id SMALLINT,
    card_type_id SMALLINT,
    illustrator TEXT,
    
    -- Variants
    is_holo BOOLEAN DEFAULT false,
    is_reverse_holo BOOLEAN DEFAULT false,
    is_full_art BOOLEAN DEFAULT false,
    is_secret_rare BOOLEAN DEFAULT false,
    variant_type TEXT, -- 'normal', 'reverse', 'holo', 'full_art', 'alt_art', etc.
    
    -- Attacks & Abilities
    attacks JSONB DEFAULT '[]'::jsonb,
    abilities JSONB DEFAULT '[]'::jsonb,
    weakness JSONB,
    resistance JSONB,
    
    -- Media
    image_url TEXT,
    image_small_url TEXT,
    image_large_url TEXT,
    
    -- External IDs
    tcgplayer_id INTEGER,
    cardmarket_id INTEGER,
    pokemon_tcg_id TEXT,
    
    -- Data Source (for imported/scraped cards)
    data_source TEXT, -- 'tcgplayer', 'tcgdex', 'pokemontcg_api', etc.
    source_id_external TEXT, -- ID from external source
    is_verified BOOLEAN DEFAULT true, -- False if needs manual verification
    
    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pokemon_cards_number ON pokemon_cards(card_number);
CREATE INDEX idx_pokemon_cards_rarity ON pokemon_cards(rarity_id);
CREATE INDEX idx_pokemon_cards_type ON pokemon_cards USING GIN(pokemon_type);
CREATE INDEX idx_pokemon_cards_stage ON pokemon_cards(stage);
```

### Magic Cards
```sql
CREATE TABLE magic_cards (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    
    -- Basic Info
    name TEXT NOT NULL,
    clean_name TEXT,
    card_number TEXT,
    set_code TEXT,
    
    -- Magic-Specific
    mana_cost TEXT, -- '{2}{R}{R}'
    cmc INTEGER, -- Converted mana cost
    colors TEXT[], -- ['R', 'G']
    color_identity TEXT[],
    card_type TEXT, -- 'Creature', 'Instant', 'Sorcery', etc.
    super_types TEXT[], -- ['Legendary', 'Snow']
    sub_types TEXT[], -- ['Dragon', 'Knight']
    
    -- Card Text
    oracle_text TEXT,
    flavor_text TEXT,
    
    -- Creature Stats
    power TEXT, -- Can be '2', '*', '1+*'
    toughness TEXT,
    loyalty TEXT, -- For planeswalkers
    
    -- Variants
    rarity_id SMALLINT,
    is_foil BOOLEAN DEFAULT false,
    is_full_art BOOLEAN DEFAULT false,
    frame_version TEXT,
    border_color TEXT,
    
    -- Media
    image_url TEXT,
    image_small_url TEXT,
    image_large_url TEXT,
    
    -- External IDs
    tcgplayer_id INTEGER,
    cardmarket_id INTEGER,
    scryfall_id UUID,
    multiverse_id INTEGER,
    
    -- Data Source
    data_source TEXT,
    source_id_external TEXT,
    is_verified BOOLEAN DEFAULT true,
    
    -- Legality
    legal_formats JSONB DEFAULT '{}'::jsonb,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_magic_cards_number ON magic_cards(card_number);
CREATE INDEX idx_magic_cards_colors ON magic_cards USING GIN(colors);
CREATE INDEX idx_magic_cards_type ON magic_cards(card_type);
```

### YuGiOh Cards
```sql
CREATE TABLE yugioh_cards (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    
    -- Basic Info
    name TEXT NOT NULL,
    clean_name TEXT,
    card_number TEXT,
    set_code TEXT,
    
    -- YuGiOh-Specific
    card_type TEXT, -- 'Monster', 'Spell', 'Trap'
    monster_type TEXT, -- 'Dragon', 'Spellcaster', etc.
    attribute TEXT, -- 'DARK', 'LIGHT', etc.
    level INTEGER,
    rank INTEGER, -- For Xyz
    link_value INTEGER, -- For Link monsters
    
    -- Monster Stats
    atk INTEGER,
    def INTEGER,
    link_markers TEXT[], -- For Link monsters
    
    -- Card Text
    effect_text TEXT,
    pendulum_effect TEXT,
    pendulum_scale INTEGER,
    
    -- Variants
    rarity_id SMALLINT,
    is_first_edition BOOLEAN DEFAULT false,
    is_limited_edition BOOLEAN DEFAULT false,
    
    -- Media
    image_url TEXT,
    image_small_url TEXT,
    
    -- External IDs
    tcgplayer_id INTEGER,
    cardmarket_id INTEGER,
    ygoprodeck_id TEXT,
    
    -- Data Source
    data_source TEXT,
    source_id_external TEXT,
    is_verified BOOLEAN DEFAULT true,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_yugioh_cards_number ON yugioh_cards(card_number);
CREATE INDEX idx_yugioh_cards_type ON yugioh_cards(card_type);
CREATE INDEX idx_yugioh_cards_attribute ON yugioh_cards(attribute);
```

### Sealed Products (Booster Boxes, Packs, etc.)
```sql
CREATE TABLE sealed_products (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    
    -- Basic Info
    name TEXT NOT NULL,
    clean_name TEXT,
    sku TEXT,
    
    -- Product Type
    product_type TEXT NOT NULL, -- 'booster_box', 'booster_pack', 'elite_trainer_box', 'bundle', etc.
    
    -- Contents
    pack_count INTEGER,
    cards_per_pack INTEGER,
    total_cards INTEGER,
    
    -- Set Information
    set_code TEXT,
    set_name TEXT,
    
    -- Availability
    is_exclusive BOOLEAN DEFAULT false,
    exclusive_retailer TEXT,
    release_date DATE,
    
    -- Media
    image_url TEXT,
    box_image_url TEXT,
    
    -- Dimensions & Weight
    dimensions JSONB, -- {"length": 10, "width": 7, "height": 3, "unit": "inches"}
    weight JSONB, -- {"value": 500, "unit": "grams"}
    
    -- External IDs
    tcgplayer_id INTEGER,
    upc TEXT,
    ean TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sealed_products_type ON sealed_products(product_type);
CREATE INDEX idx_sealed_products_release ON sealed_products(release_date);
```

---

## 🔗 Helper Tables

### Card Variants Linking
```sql
CREATE TABLE card_variants (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    base_product_id BIGINT NOT NULL REFERENCES products(id),
    variant_product_id BIGINT NOT NULL REFERENCES products(id),
    variant_type TEXT NOT NULL, -- 'holo', 'reverse_holo', 'full_art', etc.
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(base_product_id, variant_product_id)
);

CREATE INDEX idx_card_variants_base ON card_variants(base_product_id);
CREATE INDEX idx_card_variants_variant ON card_variants(variant_product_id);
```

### Multi-Language Cards
```sql
CREATE TABLE card_languages (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    base_product_id BIGINT NOT NULL REFERENCES products(id),
    language_code TEXT NOT NULL, -- 'en', 'ja', 'zh-Hans', etc.
    translated_name TEXT,
    product_id BIGINT REFERENCES products(id),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(base_product_id, language_code)
);

CREATE INDEX idx_card_languages_base ON card_languages(base_product_id);
CREATE INDEX idx_card_languages_lang ON card_languages(language_code);
```

---

## 📊 Views for Backward Compatibility

### Products View (Old Schema Compatibility)
```sql
CREATE VIEW products_legacy AS
SELECT 
    p.id,
    p.category_id,
    p.set_group_id as group_id,
    p.name,
    p.clean_name,
    p.card_number,
    p.image_url,
    p.current_price,
    
    -- Game-specific columns (NULL for non-matching types)
    CASE WHEN p.product_type = 'pokemon_card' THEN pc.rarity_id END as rarity_id,
    CASE WHEN p.product_type = 'pokemon_card' THEN pc.card_type_id END as card_type_id,
    CASE WHEN p.product_type = 'pokemon_card' THEN pc.hp END as hp,
    
    p.is_presale,
    p.created_at,
    p.updated_at
FROM products p
LEFT JOIN pokemon_cards pc ON p.source_table = 'pokemon_cards' AND p.source_id = pc.id;
```

---

## 🚀 Migration Strategy

### Phase 1: Build New Schema (Parallel)
```sql
-- Create all new tables with _v2 suffix
CREATE TABLE products_v2 (...);
CREATE TABLE pokemon_cards_v2 (...);
-- etc.
```

### Phase 2: Copy Data
```sql
-- Copy Pokemon products
WITH inserted_cards AS (
    INSERT INTO pokemon_cards_v2 (name, clean_name, card_number, ...)
    SELECT name, clean_name, card_number, ...
    FROM products
    WHERE category_id = 3
    RETURNING id, name
)
INSERT INTO products_v2 (category_id, set_group_id, product_type, source_table, source_id, name)
SELECT 3, NULL, 'pokemon_card', 'pokemon_cards_v2', ic.id, ic.name
FROM inserted_cards ic;
```

### Phase 3: Rename Tables
```sql
-- After validation period with no issues
ALTER TABLE products RENAME TO products_deprecated;
ALTER TABLE products_v2 RENAME TO products;

ALTER TABLE pokemon_cards_v2 RENAME TO pokemon_cards;
ALTER TABLE magic_cards_v2 RENAME TO magic_cards;
ALTER TABLE yugioh_cards_v2 RENAME TO yugioh_cards;
ALTER TABLE sealed_products_v2 RENAME TO sealed_products;
```

### Phase 4: Cleanup (After 20 days)
```sql
-- Log last access time
CREATE TABLE deprecated_table_access_log (
    table_name TEXT,
    last_accessed TIMESTAMPTZ,
    access_count INTEGER DEFAULT 0
);

-- Monitor for 20 days, then drop
DROP TABLE products_deprecated;
DROP TABLE groups_deprecated;
DROP TABLE sets_deprecated;
DROP TABLE series_deprecated;
```

---

## 🎯 Benefits of This Design

### 1. **Separation of Concerns**
- Each game has its own specialized table
- No NULL columns for unused fields
- Clear schema per product type

### 2. **Performance**
- Smaller, focused tables
- Better indexing strategies per type
- Faster queries (no scanning irrelevant columns)

### 3. **Flexibility**
- Easy to add new game types
- Can change Pokemon schema without affecting Magic
- Polymorphic pointer allows any product type

### 4. **Type Safety**
- Each table enforces its own constraints
- No mixing incompatible data types
- Better data validation

### 5. **Maintainability**
- Clear boundaries
- Easy to understand per-game logic
- Simpler to add game-specific features

---

## 📝 Usage Examples

### Query Pokemon Cards
```sql
-- Get full Pokemon card details
SELECT 
    p.*,
    pc.*,
    sg.name as set_name,
    c.display_name as category_name
FROM products p
JOIN pokemon_cards pc ON p.source_id = pc.id AND p.source_table = 'pokemon_cards'
JOIN set_groups sg ON p.set_group_id = sg.id
JOIN categories c ON p.category_id = c.id
WHERE p.id = 12345;
```

### Query Any Product (Polymorphic)
```sql
-- Dynamic query based on product_type
SELECT 
    p.*,
    CASE p.source_table
        WHEN 'pokemon_cards' THEN (SELECT row_to_json(pc.*) FROM pokemon_cards pc WHERE pc.id = p.source_id)
        WHEN 'magic_cards' THEN (SELECT row_to_json(mc.*) FROM magic_cards mc WHERE mc.id = p.source_id)
        WHEN 'yugioh_cards' THEN (SELECT row_to_json(yc.*) FROM yugioh_cards yc WHERE yc.id = p.source_id)
        WHEN 'sealed_products' THEN (SELECT row_to_json(sp.*) FROM sealed_products sp WHERE sp.id = p.source_id)
    END as product_details
FROM products p
WHERE p.id = 12345;
```

### Insert New Pokemon Card
```sql
-- 1. Insert into specialized table
INSERT INTO pokemon_cards (name, clean_name, hp, card_number, ...)
VALUES ('Charizard ex', 'charizard-ex', 180, '199/165', ...)
RETURNING id;

-- 2. Insert pointer in products
INSERT INTO products (category_id, set_group_id, product_type, source_table, source_id, name)
VALUES (3, 1000358, 'pokemon_card', 'pokemon_cards', <returned_id>, 'Charizard ex');
```

---

## 🔐 Security & RLS

```sql
-- Enable RLS on products
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Users can see all active products
CREATE POLICY "Public products are viewable by everyone"
ON products FOR SELECT
USING (is_active = true);

-- Only authenticated users can insert
CREATE POLICY "Authenticated users can insert products"
ON products FOR INSERT
TO authenticated
WITH CHECK (true);
```

---

**Ready to build this ideal structure?** This is a much cleaner, scalable, and maintainable design!
