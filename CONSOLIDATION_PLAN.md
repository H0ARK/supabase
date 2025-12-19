# Database Consolidation Plan

## 🎯 Goal: Simplify to 3 Core Tables

**Desired Structure:**
```
categories (Pokemon, Magic, YuGiOh, etc.)
    ↓
set_groups (Base Set, Fossil, Lost Origin, Scarlet & Violet, etc.)
    ↓
products (ALL items: cards, sealed products, synthetic cards, everything)
```

---

## 📊 Current State Analysis

### Products Tables (3 tables → 1 table)
| Table | Records | Size | Purpose | Status |
|-------|---------|------|---------|--------|
| **products** | 485,208 | 686 MB | Individual cards | ✅ **KEEP - Main table** |
| synthetic_products | 22,562 | 28 MB | Generated/synthetic cards | ⚠️ **MERGE** |
| sealed_products | 2,645 | 7.8 MB | Booster boxes, packs, etc. | ⚠️ **MERGE** |
| **TOTAL** | **510,415** | **722 MB** | | |

### Grouping Tables (3 tables → 1 table)
| Table | Records | Size | Purpose | Status |
|-------|---------|------|---------|--------|
| **groups** | 24,395 | 28 MB | TCGPlayer sets/groups | ✅ **KEEP - Rename to set_groups** |
| series | 22 | 320 KB | Pokemon series (SV, DP, etc.) | ⚠️ **MERGE as metadata** |
| sets | 193 | 1.3 MB | Pokemon individual sets | ⚠️ **MERGE** |
| **TOTAL** | **24,610** | **29.6 MB** | | |

### Categories
| Table | Records | Size | Purpose | Status |
|-------|---------|------|---------|--------|
| **categories** | ~90 | 136 KB | Top-level games | ✅ **KEEP as-is** |

---

## 🔧 Consolidation Strategy

### Phase 1: Consolidate Products Tables

#### Step 1.1: Add product_type column to products
```sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type TEXT DEFAULT 'card';
-- Values: 'card', 'sealed', 'synthetic'
```

#### Step 1.2: Add missing columns from sealed_products
```sql
ALTER TABLE products 
  ADD COLUMN IF NOT EXISTS pack_count INTEGER,
  ADD COLUMN IF NOT EXISTS cards_per_pack INTEGER,
  ADD COLUMN IF NOT EXISTS exclusive BOOLEAN,
  ADD COLUMN IF NOT EXISTS exclusive_retailer TEXT,
  ADD COLUMN IF NOT EXISTS set_id TEXT;
```

#### Step 1.3: Add missing columns from synthetic_products
```sql
ALTER TABLE products 
  ADD COLUMN IF NOT EXISTS source_data_path TEXT,
  ADD COLUMN IF NOT EXISTS is_synthetic BOOLEAN DEFAULT FALSE;
```

#### Step 1.4: Migrate sealed_products
```sql
-- Insert sealed products with product_type = 'sealed'
INSERT INTO products (
    id, category_id, group_id, name, clean_name,
    product_type, pack_count, cards_per_pack, exclusive,
    exclusive_retailer, set_id, image_url, url
)
SELECT 
    -- Generate new ID in the products sequence
    nextval('products_id_seq')::integer,
    -- Map game_id to category_id (need mapping logic)
    CASE game_id 
        WHEN 'pokemon' THEN 3
        WHEN 'magic' THEN 1
        WHEN 'yugioh' THEN 2
        ELSE NULL
    END,
    NULL as group_id, -- Will need to map set_id to group_id
    id as name, -- sealed_products.id is the product name
    id as clean_name,
    'sealed' as product_type,
    pack_count,
    cards_per_pack,
    exclusive,
    exclusive_retailer,
    set_id,
    image as image_url,
    NULL as url
FROM sealed_products;
```

#### Step 1.5: Migrate synthetic_products
```sql
-- Insert synthetic products with is_synthetic = TRUE
INSERT INTO products (
    id, category_id, group_id, name, clean_name,
    card_number, rarity_id, card_type_id, 
    is_synthetic, source_data_path, image_url,
    url
)
SELECT 
    id::integer,
    category_id,
    NULL as group_id, -- synthetic products may not have groups
    name,
    clean_name,
    card_number,
    rarity_id,
    card_type_id,
    TRUE as is_synthetic,
    source_data_path,
    image_url,
    url
FROM synthetic_products
ON CONFLICT (id) DO NOTHING; -- Skip if ID already exists
```

#### Step 1.6: Update references
```sql
-- Update user_collections if they reference synthetic_products
-- Check foreign keys and update accordingly
```

---

### Phase 2: Consolidate Grouping Tables

**Understanding the Pokemon structure:**
- **series** = "Scarlet & Violet", "Diamond & Pearl", "Sun & Moon" (22 records)
- **sets** = "Lost Origin", "Astral Radiance", "Crown Zenith" (193 records)
- **groups** = Everything including above + ALL other games (24,395 records)

**Decision:** 
- Keep `groups` as main table (has the most data)
- Rename it to `set_groups` for clarity
- Merge `sets` into `set_groups`
- Store `series` info as metadata in `set_groups`

#### Step 2.1: Add series_id column to groups
```sql
ALTER TABLE groups 
  ADD COLUMN IF NOT EXISTS series_id TEXT,
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS symbol TEXT,
  ADD COLUMN IF NOT EXISTS card_count JSONB,
  ADD COLUMN IF NOT EXISTS release_date DATE,
  ADD COLUMN IF NOT EXISTS metadata JSONB;
```

#### Step 2.2: Update groups with sets data
```sql
-- For Pokemon sets, preserve the series relationship
UPDATE groups g
SET 
    series_id = s.series_id,
    slug = s.slug,
    symbol = s.symbol,
    card_count = s.card_count,
    release_date = s.release_date::date,
    metadata = COALESCE(g.metadata, '{}'::jsonb) || COALESCE(s.metadata, '{}'::jsonb)
FROM sets s
WHERE g.name = s.name::text
  AND g.category_id = 3; -- Pokemon only
```

#### Step 2.3: Insert sets that don't exist in groups
```sql
-- Get max ID from groups to avoid conflicts
INSERT INTO groups (
    id, category_id, name, abbreviation, 
    series_id, slug, symbol, card_count,
    release_date, logo_url, metadata, published_on
)
SELECT 
    nextval('groups_id_seq')::integer,
    CASE game_id 
        WHEN 'pokemon' THEN 3
        ELSE 3
    END as category_id,
    name::text,
    slug as abbreviation,
    series_id,
    slug,
    symbol,
    card_count,
    release_date::date,
    logo as logo_url,
    metadata,
    release_date::date as published_on
FROM sets s
WHERE NOT EXISTS (
    SELECT 1 FROM groups g 
    WHERE g.name = s.name::text AND g.category_id = 3
);
```

#### Step 2.4: Rename groups → set_groups
```sql
ALTER TABLE groups RENAME TO set_groups;

-- Update all foreign key references
ALTER TABLE products RENAME COLUMN group_id TO set_group_id;
ALTER TABLE custom_collections RENAME COLUMN target_group_id TO target_set_group_id;
-- ... update other references
```

---

## 🗑️ Phase 3: Drop Old Tables

```sql
-- After verifying data migration
DROP TABLE tcgplayer_products;
DROP TABLE tcgplayer_groups;
DROP TABLE tcgplayer_categories;
DROP TABLE temp_prices_import;
DROP TABLE price_history_new_backup;

-- After consolidation complete
DROP TABLE synthetic_products;
DROP TABLE sealed_products;
DROP TABLE sets;
DROP TABLE series; -- Store as reference data in metadata if needed
```

---

## 📋 Migration Checklist

### Pre-Migration
- [ ] **Backup database** (full backup)
- [ ] Document all foreign key relationships
- [ ] Test migration on dev/staging environment
- [ ] Verify no data loss in test migration
- [ ] Check application code for hardcoded table references

### Products Consolidation
- [ ] Add product_type column to products
- [ ] Add sealed product columns to products
- [ ] Add synthetic product columns to products
- [ ] Migrate sealed_products data
- [ ] Migrate synthetic_products data
- [ ] Update user_collections references
- [ ] Verify all 510,415 products exist
- [ ] Drop synthetic_products table
- [ ] Drop sealed_products table

### Groups Consolidation
- [ ] Add series-related columns to groups
- [ ] Migrate sets data into groups
- [ ] Verify all 24,610 groups/sets exist
- [ ] Rename groups → set_groups
- [ ] Update products.group_id → set_group_id
- [ ] Update all other foreign key references
- [ ] Drop sets table
- [ ] Document series info (or keep series as reference table)

### Cleanup
- [ ] Drop tcgplayer_* tables (~6 MB)
- [ ] Drop temp/backup tables (~139 MB)
- [ ] Run VACUUM ANALYZE on consolidated tables
- [ ] Update application code
- [ ] Update API documentation
- [ ] Test all queries

---

## ⚠️ Risks & Considerations

### Data Loss Risks
1. **ID Conflicts**: synthetic_products and sealed_products may have overlapping IDs with products
   - **Solution**: Use sequences to generate new IDs or use UUID
   
2. **Foreign Key Constraints**: Many tables reference products/groups
   - **Solution**: Update all references before dropping tables

3. **Application Breakage**: Code may hardcode table names
   - **Solution**: Search codebase for table references first

### Performance Impact
1. **products table will grow**: 686 MB → ~722 MB (+5%)
   - **Solution**: Add indexes on product_type for filtering
   
2. **groups table will grow**: 28 MB → ~29.6 MB (minimal)
   - **Solution**: No action needed

---

## 🎯 Final Structure

```sql
-- 3 Core Tables

categories (
    id INTEGER PRIMARY KEY,
    name TEXT,
    display_name TEXT,
    logo_url TEXT,
    ...
)

set_groups (  -- Renamed from groups
    id INTEGER PRIMARY KEY,
    category_id INTEGER REFERENCES categories(id),
    name TEXT,
    abbreviation TEXT,
    series_id TEXT,  -- NEW: for Pokemon series grouping
    slug TEXT,       -- NEW: from sets
    symbol TEXT,     -- NEW: from sets
    logo_url TEXT,
    ...
)

products (
    id INTEGER PRIMARY KEY,
    category_id INTEGER REFERENCES categories(id),
    set_group_id INTEGER REFERENCES set_groups(id), -- Renamed from group_id
    name TEXT,
    clean_name TEXT,
    product_type TEXT,  -- NEW: 'card', 'sealed', 'synthetic'
    is_synthetic BOOLEAN, -- NEW: for synthetic products
    pack_count INTEGER,   -- NEW: for sealed products
    cards_per_pack INTEGER, -- NEW: for sealed products
    set_id TEXT,         -- NEW: for sealed products
    ...
)
```

---

## 📊 Space Reclamation

| Action | Space Saved |
|--------|-------------|
| Drop tcgplayer_* tables | 6 MB |
| Drop temp tables | 139 MB |
| Drop synthetic_products | 28 MB (after migration) |
| Drop sealed_products | 7.8 MB (after migration) |
| Drop sets | 1.3 MB (after migration) |
| Drop series | 320 KB (optional) |
| **TOTAL** | **182 MB** |

---

*Ready to execute? Review each phase and run step by step with verification between stages.*
