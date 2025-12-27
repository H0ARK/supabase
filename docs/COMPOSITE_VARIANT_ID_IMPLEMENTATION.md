# Composite Variant ID Implementation

## Overview

The backend APIs have been updated to support the new Composite Variant ID system (`productId_variantId`) to fix quantity tracking errors where all card variants were sharing a single quantity count.

## Changes Made

### 1. Utility Functions (`/docker/volumes/functions/_shared/cardId.ts`)

Created comprehensive utility functions for parsing and handling composite card IDs:

- **`parseCardId(cardId)`**: Parses both composite (`"620618_3"`) and legacy (`"620618"`) ID formats
  - Returns `{ productId, variantId, isComposite }` 
  - Defaults to `variantId: 1` (Normal) for legacy format
  - Validates numeric IDs and throws descriptive errors

- **`createCompositeId(productId, variantId)`**: Creates composite ID string (`"620618_3"`)

- **`isValidCardId(cardId)`**: Validates card ID format

- **`extractProductIds(cardIds[])`**: Extracts unique product IDs from array of mixed ID formats

### 2. Search Cards API (`/docker/volumes/functions/search-cards/index.ts`)

**Updated to expand products into individual variant entries:**

- Each product now returns separate results for each variant (Normal, Holofoil, Reverse Holofoil, etc.)
- Results include composite IDs in format `"${productId}_${variantId}"`
- Fetches all variants from the `variants` table
- Joins with `price_history` to get variant-specific pricing
- Each result includes:
  - `id`: Composite ID (e.g., `"620618_3"`)
  - `productId`: TCGPlayer product ID
  - `variantId`: Variant ID (1=Normal, 3=Reverse Holofoil, etc.)
  - `variantName`: Human-readable variant name
  - `price`: Variant-specific market price

**Example Response:**
```json
{
  "results": [
    {
      "id": "620618_1",
      "productId": 620618,
      "variantId": 1,
      "variantName": "Normal",
      "name": "Absol",
      "price": 1500
    },
    {
      "id": "620618_3",
      "productId": 620618,
      "variantId": 3,
      "variantName": "Reverse Holofoil",
      "name": "Absol",
      "price": 3200
    }
  ]
}
```

### 3. Get Card Details API (`/docker/volumes/functions/get-card-details/index.ts`)

**Updated to parse and filter by composite IDs:**

- Accepts both legacy (`productId`) and composite (`"productId_variantId"`) formats
- When composite ID provided, returns only that specific variant's data
- When legacy ID provided, returns all variants
- Price history is filtered by `variant_id` when composite ID used
- Response includes composite IDs for all variants

**Example Usage:**
```javascript
// Get all variants for a product
{ "productId": 620618 }

// Get specific variant
{ "cardId": "620618_3" }
```

### 4. Get Prices API (`/docker/volumes/functions/get-prices/index.ts`)

**Updated to support composite IDs and variant filtering:**

- Accepts mixed array of composite and legacy IDs
- Uses `parseCardId()` to extract product IDs and variant filters
- When composite IDs provided, only returns prices for those specific variants
- When legacy IDs provided, returns prices for all variants
- Price history respects variant filters

**Example Usage:**
```javascript
// Get prices for specific variants
GET /get-prices?product_ids=620618_3,91614_1,91615

// Response includes composite IDs
{
  "results": [
    {
      "product_id": 620618,
      "variants": [
        {
          "composite_id": "620618_3",
          "variant_id": 3,
          "variant_name": "Reverse Holofoil",
          "market_price": 32.00
        }
      ]
    }
  ]
}
```

### 5. TCGPlayer Proxy API (`/docker/volumes/functions/tcgplayer-proxy/index.ts`)

**Updated to filter price history by variant:**

- Parses composite IDs using `parseCardId()`
- When composite ID provided (`"620618_3"`), filters `price_history` by both `product_id` AND `variant_id`
- When legacy ID provided (`620618`), returns all variants' price history
- Response includes `variantId` field when composite ID used

**Example Usage:**
```javascript
// Get price history for specific variant
GET /tcgplayer-proxy?productId=620618_3&range=quarter

// Response
{
  "productId": 620618,
  "variantId": 3,
  "priceHistory": [
    { "date": "2025-12-01", "variantId": 3, "marketPrice": 3200 }
  ]
}
```

### 6. Database Functions (Already Correct)

The existing `get_user_collection_cards_secure()` function already correctly handles variant-level isolation:

- Stores both `tcgplayer_product_id` and `card_variant_id` in `user_collections` table
- Joins with `price_history` filtering by BOTH `product_id` AND `variant_id`
- Ensures each variant's quantity and price are tracked independently
- No changes needed ✓

## Database Schema (Existing, Correct)

### `user_collections` Table
```sql
CREATE TABLE user_collections (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  tcgplayer_product_id integer,    -- TCGPlayer product ID
  card_variant_id integer NOT NULL, -- Variant ID (1=Normal, 3=Reverse Holofoil, etc.)
  quantity integer DEFAULT 1,
  -- ... other fields
);
```

### `price_history` Table
```sql
CREATE TABLE price_history (
  product_id integer,    -- TCGPlayer product ID
  variant_id integer,    -- Variant ID
  recorded_at date,
  market_price smallint, -- Price in cents
  -- ... other price fields
  PRIMARY KEY (product_id, variant_id, recorded_at)
);
```

### `variants` Table
```sql
CREATE TABLE variants (
  id integer PRIMARY KEY,
  name text UNIQUE -- "Normal", "Holofoil", "Reverse Holofoil", etc.
);
```

## Frontend Integration

The frontend can now:

1. **Search for cards** and receive separate entries for each variant with unique IDs
2. **Add cards to collection** using composite IDs (e.g., `"620618_3"`)
3. **View card details** for specific variants by passing composite ID
4. **Track quantities independently** for Normal vs Holofoil vs Reverse Holofoil
5. **View price history** filtered to specific variants

## Backward Compatibility

All APIs maintain backward compatibility:

- Legacy product IDs (`620618`) still work
- When legacy ID used, APIs return all variants (as before)
- When composite ID used (`"620618_3"`), APIs filter to that specific variant
- Existing frontend code using legacy IDs will continue to work without changes

## Testing Recommendations

1. **Test search expanding variants**:
   ```bash
   curl -X POST http://localhost:8765/functions/v1/search-cards \
     -H "Content-Type: application/json" \
     -d '{"query": "Absol", "limit": 5}'
   ```

2. **Test composite ID parsing**:
   ```bash
   curl -X POST http://localhost:8765/functions/v1/get-card-details \
     -H "Content-Type: application/json" \
     -d '{"cardId": "620618_3"}'
   ```

3. **Test variant-filtered prices**:
   ```bash
   curl "http://localhost:8765/functions/v1/get-prices?product_ids=620618_3,620618_1"
   ```

4. **Test collection with variants**:
   - Add "Absol Normal" (620618_1) with quantity 2
   - Add "Absol Reverse Holofoil" (620618_3) with quantity 1
   - Verify both show independently in collection view
   - Verify quantities don't cross-contaminate

## Migration Notes

No database migrations required - the schema already supports variant-level tracking. The changes are purely in the API layer to expose and utilize the existing variant structure.

## Error Handling

All APIs now throw descriptive errors for invalid composite IDs:

```javascript
// Invalid format
"620618_" → Error: "Invalid composite card ID format: 620618_. Expected format: productId_variantId"

// Non-numeric
"abc_3" → Error: "Invalid composite card ID: abc_3. Both parts must be numeric."

// Negative values
"620618_-1" → Error: "Invalid composite card ID: 620618_-1. IDs must be positive integers."
```

## Summary

The backend now fully supports the Composite Variant ID system with:
- ✅ Utility functions for parsing/creating composite IDs
- ✅ Search API expanded to return variant-specific entries
- ✅ All APIs filter by both product_id AND variant_id
- ✅ Backward compatibility with legacy product IDs
- ✅ Proper variant-level quantity and price isolation
- ✅ Database schema already correct

The system is now aligned with the frontend to prevent quantity cross-contamination between card variants.
