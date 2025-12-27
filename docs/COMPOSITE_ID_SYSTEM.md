# Composite Variant ID System

## Overview

The backend now supports a **Composite Variant ID** system to fix quantity tracking errors where all card variants were sharing a single quantity count. The system uses an underscore (`_`) as the identifier separator to ensure unique tracking for every variant (Normal vs Holofoil vs Reverse Holofoil).

## Format

```
{productId}_{variantId}
```

### Examples
- `620618_1` - Absol (Normal)
- `620618_2` - Absol (Holofoil)
- `620618_3` - Absol (Reverse Holofoil)

## Implementation

### 1. Shared Utilities (`_shared/cardId.ts`)

```typescript
import { createCompositeId, parseCompositeId, isValidCompositeId } from '../_shared/cardId.ts';

// Create composite ID
const id = createCompositeId(620618, 3); // Returns "620618_3"

// Parse composite ID
const { productId, variantId } = parseCompositeId("620618_3");
// productId = 620618, variantId = 3

// Validate composite ID
if (isValidCompositeId(someId)) {
  // Process valid ID
}
```

### 2. Search API (`search-cards/index.ts`)

The search function expands products into individual variant entries:

```typescript
// Each variant gets its own entry with composite ID
expandedResults.push({
  ...product,
  id: createCompositeId(product.id, variantId), // "620618_3"
  variantId: 3,
  variantName: 'Reverse Holofoil',
  pricing: {
    variant: { id: 3, name: 'Reverse Holofoil' },
    marketPrice: 1250, // Specific to THIS variant
    lastUpdated: '2025-12-19T00:00:00Z'
  }
});
```

**Key Features:**
- No minimum query length requirement (empty queries allowed)
- Returns separate entities for each variant
- Each variant has independent price tracking

### 3. Collection Management (`add-to-collection/index.ts`)

When adding cards, the composite ID is parsed and stored:

```typescript
// Frontend sends: { compositeId: "620618_3", quantity: 2 }

// Backend parses and stores:
const { productId, variantId } = parseCompositeId(compositeId);

await supabaseClient.from('user_collections').insert({
  tcgplayer_product_id: 620618,  // Numeric
  card_variant_id: 3,             // Numeric (NOT defaulting to 1!)
  quantity: 2
});
```

**Key Features:**
- Parses composite ID correctly
- Stores both `tcgplayer_product_id` AND `card_variant_id`
- Prevents cross-contamination between variants
- Updates existing entries by matching BOTH product AND variant

### 4. Database Schema

#### Indexes for Performance

```sql
-- Fast lookups by product + variant
CREATE INDEX idx_user_collections_product_variant 
ON user_collections(tcgplayer_product_id, card_variant_id);

-- Fast lookups by user + product + variant
CREATE INDEX idx_user_collections_user_product_variant 
ON user_collections(user_id, tcgplayer_product_id, card_variant_id);
```

#### Database Function

```sql
-- Returns collection with composite IDs
SELECT * FROM get_user_collection_cards_with_composite_ids(user_id);

-- Returns composite_id column: "620618_3"
```

### 5. Price History Queries

Price queries now filter by BOTH product_id AND variant_id:

```sql
-- CORRECT: Variant-specific pricing
SELECT market_price 
FROM price_history 
WHERE product_id = 620618 
  AND variant_id = 3  -- Critical for data isolation
ORDER BY recorded_at DESC 
LIMIT 1;

-- WRONG: Would mix all variants
SELECT market_price 
FROM price_history 
WHERE product_id = 620618  -- Missing variant_id filter!
```

## Migration Guide

### For Existing Data

If you have existing `user_collections` entries where `card_variant_id` is NULL or incorrectly set to 1 for all variants:

```sql
-- Audit existing data
SELECT 
  tcgplayer_product_id,
  card_variant_id,
  COUNT(*) as count
FROM user_collections
GROUP BY tcgplayer_product_id, card_variant_id
HAVING COUNT(*) > 1;

-- Fix entries that should be variant 1 (Normal)
UPDATE user_collections
SET card_variant_id = 1
WHERE card_variant_id IS NULL;
```

### For New Edge Functions

1. Import the shared utilities:
   ```typescript
   import { parseCompositeId, createCompositeId } from '../_shared/cardId.ts';
   ```

2. Parse incoming composite IDs:
   ```typescript
   const { productId, variantId } = parseCompositeId(req.body.cardId);
   ```

3. Generate composite IDs for responses:
   ```typescript
   return { id: createCompositeId(product.id, variant.id) };
   ```

## Testing

### Test Cases

```typescript
// Valid composite IDs
parseCompositeId("620618_1")  // ✓ Normal
parseCompositeId("620618_2")  // ✓ Holofoil
parseCompositeId("620618_3")  // ✓ Reverse Holofoil

// Invalid composite IDs
parseCompositeId("620618")     // ✗ Missing variant
parseCompositeId("620618_")    // ✗ Empty variant
parseCompositeId("_3")         // ✗ Missing product
parseCompositeId("abc_3")      // ✗ Non-numeric product
parseCompositeId("620618_xyz") // ✗ Non-numeric variant
```

### Integration Test

```bash
# Search for "Absol"
curl -X POST https://your-project.supabase.co/functions/v1/search-cards \
  -H "Content-Type: application/json" \
  -d '{"query": "Absol"}'

# Expected: Multiple results with IDs like:
# - "620618_1" (Normal)
# - "620618_3" (Reverse Holofoil)

# Add Reverse Holofoil to collection
curl -X POST https://your-project.supabase.co/functions/v1/add-to-collection \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"compositeId": "620618_3", "quantity": 1}'

# Verify it's stored with variant_id = 3
```

## Benefits

1. **Data Isolation**: Each variant has independent quantity and price tracking
2. **No Cross-Contamination**: Adding a Holofoil doesn't affect Normal variant count
3. **Accurate Pricing**: Each variant shows its own market price
4. **Frontend Compatibility**: Composite IDs work seamlessly with existing frontend code
5. **Database Integrity**: Proper indexes ensure fast queries

## Files Modified/Created

- ✅ `/supabase/functions/_shared/cardId.ts` - Utility functions
- ✅ `/supabase/functions/search-cards/index.ts` - Search with variant expansion
- ✅ `/supabase/functions/add-to-collection/index.ts` - Collection management
- ✅ `/supabase/migrations/20251219_add_composite_id_support.sql` - Database updates

## Next Steps

1. Run the migration: `supabase db push`
2. Deploy edge functions: `supabase functions deploy`
3. Update frontend to use composite IDs (if not already done)
4. Test with real data
5. Monitor for any edge cases

## Support

For questions or issues with the composite ID system, please refer to:
- Database schema: `/DATABASE_SCHEMA.md`
- Edge function docs: `/supabase/functions/README.md`
