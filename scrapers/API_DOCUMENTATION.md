# Supabase Scraper & API Documentation

## Overview

This document describes the API endpoints and scrapers available for the RippZZ trading card database.

## Base URL

```
http://147.135.4.131:8765
```

## Authentication

All API calls require the `Authorization` header with a Bearer token:

```
Authorization: Bearer <anon_key>
```

**Anon Key:**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
```

---

## API Endpoints

### 1. Get Prices

Retrieves current prices and optionally price history for products.

**Endpoint:** `GET/POST /functions/v1/get-prices`

#### GET Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `product_id` | number | Single product ID |
| `product_ids` | string | Comma-separated list of product IDs |
| `search` | string | Search query to find products by name |
| `include_history` | boolean | Include price history (default: false) |
| `days` | number | Number of days of history (default: 30) |

#### POST Body

```json
{
  "product_ids": [91614, 91615],
  "search": "charizard",
  "include_history": true,
  "days": 30
}
```

#### Example Requests

```bash
# Search for products
curl "http://147.135.4.131:8765/functions/v1/get-prices?search=charizard" \
  -H "Authorization: Bearer <anon_key>"

# Get specific product with history
curl "http://147.135.4.131:8765/functions/v1/get-prices?product_id=91614&include_history=true&days=7" \
  -H "Authorization: Bearer <anon_key>"

# Get multiple products
curl "http://147.135.4.131:8765/functions/v1/get-prices?product_ids=91614,91615,91616" \
  -H "Authorization: Bearer <anon_key>"
```

#### Response

```json
{
  "success": true,
  "as_of_date": "2025-11-25",
  "count": 1,
  "results": [
    {
      "product_id": 91614,
      "product_name": "Charizard EX - XY17 (XY Black Star Promos)",
      "set_name": "Jumbo Cards",
      "variants": [
        {
          "variant_name": "Holofoil",
          "low_price": 14.98,
          "mid_price": 17.00,
          "high_price": 34.90,
          "market_price": 16.89,
          "direct_low_price": null,
          "as_of_date": "2025-11-25"
        }
      ],
      "price_history": [
        {
          "date": "2025-11-19",
          "variant_name": "Holofoil",
          "market_price": 16.97
        }
      ]
    }
  ]
}
```

---

### 2. Direct Database Access

You can also query the database directly using Supabase client.

#### JavaScript/TypeScript Example

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'http://147.135.4.131:8765',
  '<anon_key>'
);

// Search products
const { data: products } = await supabase
  .from('products')
  .select('id, name, clean_name, groups(name)')
  .ilike('name', '%charizard%')
  .limit(20);

// Get latest prices for products
const { data: prices } = await supabase
  .from('price_history')
  .select('*')
  .in('product_id', [91614, 91615])
  .eq('recorded_at', '2025-11-25');

// Get price history
const { data: history } = await supabase
  .from('price_history')
  .select('product_id, variant_id, recorded_at, market_price')
  .eq('product_id', 91614)
  .gte('recorded_at', '2025-11-01')
  .order('recorded_at');
```

---

## Database Tables

### Products (`products`)

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Product ID (primary key) |
| `name` | text | Product name |
| `clean_name` | text | Cleaned/normalized name |
| `category_id` | integer | Category (3 = Pokemon) |
| `group_id` | integer | Set ID |
| `card_number` | text | Card number in set |
| `rarity_id` | smallint | Rarity ID |
| `card_type_id` | smallint | Card type ID |
| `url` | text | TCGPlayer URL |

### Groups/Sets (`groups`)

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Group/Set ID |
| `name` | text | Set name |
| `abbreviation` | text | Set abbreviation |
| `category_id` | integer | Category ID |
| `released_on` | date | Release date |

### Price History (`price_history`)

| Column | Type | Description |
|--------|------|-------------|
| `product_id` | integer | Product ID |
| `variant_id` | integer | Variant ID (FK to variants) |
| `recorded_at` | date | Price date |
| `low_price` | smallint | Low price in cents |
| `mid_price` | smallint | Mid price in cents |
| `high_price` | smallint | High price in cents |
| `market_price` | smallint | Market price in cents |
| `direct_low_price` | smallint | TCGDirect low price in cents |
| `*_usd` columns | numeric | USD values for prices over $327.67 |

### Variants (`variants`)

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Variant ID |
| `name` | text | Variant name (Normal, Holofoil, Reverse Holofoil, etc.) |

---

## Scraper Status

### Working ✅

1. **TCGCSV Daily Import** - Automatic price history import via cron
   - Daily at 4:00 AM UTC (imports previous day's prices)
   - Weekly backfill check on Sundays at 5:00 AM UTC

2. **Get-Prices API** - Retrieves stored prices from database
   - Works immediately
   - Returns data up to Nov 25, 2025

### Blocked/Needs Work ⚠️

1. **eBay Scraper** - JavaScript-heavy pages require browser automation
   - Created but needs Puppeteer/Playwright
   - `ebay_sales` table ready

2. **Fanatics Scraper** - API now requires authentication
   - Created but blocked (403 errors)
   - `fanatics_sales` table ready

3. **TCGCSV Live API** - IP temporarily blocked (rate limited)
   - Archive imports still work via cron
   - Direct API calls return 403

---

## Frontend Integration

### Configuration

```typescript
// config.ts
export const SUPABASE_URL = 'http://147.135.4.131:8765';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
```

### Quick Start

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Use the get-prices function
async function getPrices(search: string) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/get-prices?search=${encodeURIComponent(search)}`,
    {
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return response.json();
}

// Or use direct database queries
async function searchProducts(query: string) {
  const { data, error } = await supabase
    .from('products')
    .select(`
      id,
      name,
      clean_name,
      card_number,
      groups (
        name,
        abbreviation
      )
    `)
    .or(`name.ilike.%${query}%,clean_name.ilike.%${query}%`)
    .limit(50);
  
  return data;
}
```

---

## Data Statistics

- **Total Price Records:** ~258 million
- **Date Range:** March 2024 - November 2025
- **Daily Records:** ~490,000 per day
- **Products:** ~125,000+
- **Sets/Groups:** ~500+
- **Categories:** Pokemon (3), One Piece, etc.

---

## Support

For issues or questions, check the logs at:
- Edge Functions: `/home/ubuntu/supabase/docker/volumes/logs/`
- PostgreSQL: `docker logs supabase-db`
