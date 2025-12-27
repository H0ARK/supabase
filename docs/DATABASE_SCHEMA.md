# Database Schema Documentation

## Overview
Total tables: 115 (including partitions)
Total storage: ~24 GB
Schema: `public`

---

## 📊 Domain Organization

### 🎮 Core TCG Data (Card Trading Game)
**Purpose**: Primary product catalog and game data

#### Hierarchy
```
games (pokemon, magic, yugioh, etc.)
  ↓
categories (Pokemon, Magic: The Gathering, YuGiOh)
  ↓
groups (sets/expansions like "Scarlet & Violet", "Lost Origin")
  ↓  
products (individual cards)
  ↓
variants (holographic, reverse holo, etc.)
```

**Tables:**
- `games` - Base games (pokemon, magic, yugioh) [48 kB]
- `categories` - Top-level game categories [136 kB]
- `groups` - Card sets/expansions [28 MB, 12,816+ records]
- `series` - Pokemon series grouping (e.g., "Scarlet & Violet") [320 kB]
- `sets` - Individual sets within series [1.3 MB]
- `products` - Individual cards [686 MB - **LARGEST TABLE**]
- `synthetic_products` - Generated/synthetic cards [28 MB]
- `sealed_products` - Booster boxes, packs, etc. [7.8 MB]
- `card_types` - Type classifications [112 kB]
- `rarities` - Rarity levels [152 kB]
- `attributes` - Card attributes [40 kB]
- `variants` - Card variants (holo, reverse, etc.) [64 kB]

**Key Relationships:**
- `products.category_id` → `categories.id`
- `products.group_id` → `groups.id`
- `groups.category_id` → `categories.id`
- `sets.series_id` → `series.id`
- `series.game_id` → `games.id`

---

### 💰 Pricing & Market Data
**Purpose**: Track historical and current pricing, sales

**Tables:**
- `price_history` - Parent partitioned table [0 bytes - partitioned]
- `price_history_2024_02` through `price_history_2025_12` - Monthly partitions [~17 GB total]
- `price_history_2026_*` - Pre-created future partitions
- `ebay_sales` - eBay transaction data [64 kB]
- `fanatics_sales` - Fanatics marketplace sales [16 MB]
- `graded_sales` - Graded card sales (PSA, BGS) [208 MB]
- `pricecharting_prices` - PriceCharting.com data [41 MB]
- `pricecharting_price_history` - Historical pricing [100 MB]
- `pricecharting_csv_imports` - Raw CSV imports [179 MB]

**Note**: Price history is partitioned by month for performance. Each partition contains ~1-1.4 GB of data.

---

### 👤 User Management & Authentication
**Purpose**: User accounts, profiles, settings

**Tables:**
- `profiles` - User profiles (linked to Supabase Auth) [184 kB]
- `user_settings` - User preferences [48 kB]
- `user_notifications` - Notification system [24 kB]
- `user_follows` - User follow relationships [40 kB]

**Primary Key**: All use `uuid` (from Supabase Auth)

---

### 📚 Collections & Tracking
**Purpose**: User card collections and progress tracking

**Tables:**
- `user_collections` - User's owned cards [1.9 MB]
- `user_watchlist` - Cards users are watching [40 kB]
- `user_favorites` - Favorited items [16 kB]
- `user_price_alerts` - Price alert subscriptions [16 kB]
- `user_set_progress` - Progress completing sets [976 kB]
- `custom_collections` - User-created collections [64 kB]
- `custom_collection_cards` - Cards in custom collections [48 kB]
- `custom_collection_participants` - Collection collaborators [40 kB]
- `custom_collection_likes` - Collection likes [32 kB]
- `collection_value_history` - Historical collection values [80 kB]
- `portfolios` - User portfolios [64 kB]

---

### 🛒 Marketplace
**Purpose**: Buy/sell/trade functionality

**Tables:**
- `marketplace_listings` - Active listings [64 kB]
- `marketplace_offers` - Offers on listings [32 kB]
- `marketplace_bids` - Auction bids [16 kB]
- `marketplace_purchases` - Completed transactions [40 kB]
- `marketplace_disputes` - Dispute management [16 kB]
- `dispute_timeline` - Dispute event history [16 kB]
- `dispute_responses` - Dispute responses [16 kB]

**Seller Features:**
- `seller_accounts` - Seller registration [64 kB]
- `seller_reviews` - Seller feedback [40 kB]
- `seller_fee_tiers` - Fee structure [32 kB]
- `seller_tier_history` - Tier changes over time [24 kB]
- `seller_annual_sales` - Annual sales tracking [32 kB]

---

### 💬 Social Features
**Purpose**: Community engagement, discussions

**Activity Feed:**
- `activity_feed` - Main activity stream [48 kB]
- `activity_comments` - Comments on activities [24 kB]
- `activity_likes` - Activity likes [24 kB]
- `activity_reposts` - Reshares [24 kB]
- `activity_shares` - External shares [8 kB]
- `user_liked_activities` - User-activity like junction [24 kB]

**Posts & Social:**
- `posts` - User posts [48 kB]
- `post_likes` - Post likes [24 kB]
- `post_hashtags` - Hashtag associations [16 kB]
- `post_mentions` - User mentions [8 kB]
- `hashtags` - Hashtag index [24 kB]
- `user_liked_posts` - User-post like junction [24 kB]

**Messaging:**
- `conversations` - Message threads [16 kB]
- `messages` - Individual messages [40 kB]
- `conversation_participants` - Thread participants [40 kB]

**Groups:**
- `user_groups` - User's group memberships [32 kB]
- `group_members` - Group member roster [48 kB]
- `group_posts` - Posts within groups [32 kB]
- `group_post_replies` - Replies to group posts [16 kB]

**Gamification:**
- `leaderboards` - Ranking system [64 kB]

---

### 🔍 Search & Discovery
**Purpose**: Finding and identifying cards

**Tables:**
- `card_grid_hashes` - Image hashing for visual search [6.2 GB - **SECOND LARGEST**]
- `card_language_links` - Multi-language card connections [8 MB]
- `saved_searches` - User's saved search queries [16 kB]
- `holographic_variant_base_cards` - Links holo variants to base cards [256 kB]

---

### 🔗 Integration & Mapping Tables
**Purpose**: External data source integrations

**PriceCharting.com:**
- `pricecharting_card_mapping` - Maps PC IDs to products [32 kB]
- `pricecharting_group_mapping` - Maps PC groups [80 kB]

**Fanatics:**
- `fanatics_product_matches` - Product matching [144 kB]
- `fanatics_scrape_jobs` - Scraping job tracking [40 kB]

**Regional Mappings:**
- `set_region_mappings` - Maps sets across regions [200 kB]

**Synthetic IDs:**
- `synthetic_id_mappings` - ID translation table [1.9 MB]

---

## 🗑️ Tables to Delete (Duplicates/Temporary)

### ⚠️ TCGPlayer Duplicate Tables
**These are complete duplicates - safe to delete:**
- `tcgplayer_categories` [112 kB] - duplicates `categories`
- `tcgplayer_groups` [2.9 MB] - duplicates `groups`
- `tcgplayer_products` [2.9 MB] - duplicates `products`

**Total space to reclaim: ~5.9 MB**

### 🔧 Temporary/Import Tables
**Review and clean up:**
- `temp_prices_import` [30 MB] - temporary import table
- `price_history_new_backup` [109 MB] - backup table
- `tcgcsv_import_log` [48 kB] - import logging

**Total space to reclaim: ~139 MB**

---

## 📋 Naming Conventions

### Consistent Patterns
✅ **Good naming:**
- `user_*` - All user-related data prefixed (collections, watchlist, settings)
- `marketplace_*` - All marketplace features grouped
- `seller_*` - All seller features grouped
- `activity_*` - All activity feed features
- `custom_collection_*` - Custom collection features
- Junction tables clearly named (e.g., `user_liked_posts`)

### Inconsistencies Found
⚠️ **Naming issues:**
- `groups` - Very generic name for card sets/expansions (consider `card_sets` or `set_groups`)
- `posts` vs `group_posts` - Could be `social_posts` and `group_posts` for clarity
- `profiles` - Could be `user_profiles` for consistency
- `products` vs `synthetic_products` - Consider `cards` and `synthetic_cards`
- `sealed_products` - Consider `sealed_card_products` or `sealed_items`

---

## 🔑 Primary Key Patterns

### ID Type Breakdown:
- **UUID** (36 tables) - User-generated content, transactions, social features
- **integer** (30 tables) - Core catalog data (products, groups, categories)
- **text** (7 tables) - Natural keys (games, series, sets)
- **bigint** (3 tables) - High-volume data (card_grid_hashes, synthetic_products)
- **smallint** (3 tables) - Small reference tables (card_types, rarities, variants)
- **composite** (3 tables) - Junction tables with compound keys

### Recommendation:
✅ Pattern is good - UUIDs for user data, integers for catalog

---

## 🚀 Performance Considerations

### Largest Tables (by size):
1. **card_grid_hashes** - 6.2 GB (image hashing data)
2. **price_history partitions** - ~17 GB total (well partitioned ✅)
3. **products** - 686 MB (main card catalog)
4. **graded_sales** - 208 MB
5. **pricecharting_csv_imports** - 179 MB

### Indexing Recommendations:
- Verify indexes on frequently joined columns (category_id, group_id, product_id)
- Ensure composite indexes for common filter combinations
- Check for unused indexes (can slow down inserts)

---

## 🔐 Security Checklist

### RLS (Row Level Security):
- [ ] Verify RLS enabled on all `user_*` tables
- [ ] Check marketplace tables have proper buyer/seller policies
- [ ] Ensure private collections are protected
- [ ] Messages and conversations properly secured
- [ ] Admin tables like `maintenance_log` restricted

### Sensitive Data:
- [ ] No credit card data stored (use Stripe/payment processor)
- [ ] Email/personal data in `profiles` protected
- [ ] Seller financials in `seller_*` tables secured

---

## 📝 Recommended Actions

### Immediate:
1. ✅ **Delete duplicate tcgplayer tables** (~6 MB)
2. ⚠️ **Review and clean temp tables** (~139 MB)
3. 🔍 **Add indexes** on common join paths if missing
4. 📊 **Run VACUUM ANALYZE** on large tables

### Short-term:
1. 📛 **Rename generic tables** for clarity (groups → card_sets)
2. 📚 **Document business logic** for complex relationships
3. 🔐 **Audit RLS policies** on all user tables
4. 📈 **Set up monitoring** for partition growth

### Long-term:
1. 🗄️ **Archive old price_history partitions** (>2 years)
2. 🔄 **Review synthetic_products** generation process
3. 📊 **Optimize card_grid_hashes** table (6.2 GB)
4. 🌐 **Consider CDN** for image URLs in products

---

## 🎯 Table Relationship Diagram (Core)

```
                    games
                      ↓
                 categories ←─────────┐
                      ↓               │
     series ─→   groups               │
       ↓            ↓                 │
     sets        products ←───────────┤
                    ↓                 │
                 variants             │
                                      │
     profiles ──→ user_collections ───┘
        ↓
   (all user_* tables)
```

---

## 📊 Database Health Score: 8/10

### Strengths:
- ✅ Well-partitioned price history
- ✅ Clear domain separation
- ✅ Good use of foreign keys
- ✅ Consistent user table prefixing

### Areas for Improvement:
- ⚠️ Delete duplicate tcgplayer tables
- ⚠️ Clean up temporary tables
- ⚠️ Rename some generic tables
- ⚠️ Document complex relationships

---

*Generated: December 18, 2025*
*Database: Supabase @ api.rippzz.com*
