#!/usr/bin/env tsx

/**
 * TCGCSV Live Price Scraper
 * 
 * Fetches live price data from TCGCSV API for products,
 * stores in Supabase, and returns results.
 * 
 * This uses the public TCGCSV endpoints that provide real-time
 * TCGPlayer pricing data without needing to scrape.
 * 
 * Usage:
 *   tsx src/tcgcsv-scraper.ts --product-id 12345
 *   tsx src/tcgcsv-scraper.ts --category 3 --group 23568
 */

import { config } from 'dotenv';
import {
  getSupabase,
  sleep,
  randomDelay,
  retryWithBackoff,
} from '../lib/utils.js';

config();

// ============================================================================
// Types
// ============================================================================

export interface TCGCSVPrice {
  product_id: number;
  variant_name: string;
  low_price: number | null;
  mid_price: number | null;
  high_price: number | null;
  market_price: number | null;
  direct_low_price: number | null;
}

export interface TCGCSVScraperOptions {
  productId?: number;
  categoryId?: number;
  groupId?: number;
  dryRun?: boolean;
}

export interface TCGCSVScraperResult {
  success: boolean;
  prices: TCGCSVPrice[];
  stats: {
    total_fetched: number;
    total_stored: number;
    products_with_prices: number;
  };
  error?: string;
}

// ============================================================================
// Configuration
// ============================================================================

const TCGCSV_BASE = 'https://tcgcsv.com';
const RATE_LIMIT_MS = 500;

// ============================================================================
// API Functions
// ============================================================================

async function fetchProductPrices(
  categoryId: number,
  groupId: number,
  productId?: number
): Promise<TCGCSVPrice[]> {
  const url = productId
    ? `${TCGCSV_BASE}/${categoryId}/${groupId}/prices?productId=${productId}`
    : `${TCGCSV_BASE}/${categoryId}/${groupId}/prices`;

  const response = await retryWithBackoff(async () => {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'RippzzDB/1.0',
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    return res.json();
  });

  if (!response.success || !Array.isArray(response.results)) {
    return [];
  }

  return response.results.map((item: any) => ({
    product_id: item.productId,
    variant_name: item.subTypeName || 'Normal',
    low_price: item.lowPrice,
    mid_price: item.midPrice,
    high_price: item.highPrice,
    market_price: item.marketPrice,
    direct_low_price: item.directLowPrice,
  }));
}

async function fetchProductInfo(productId: number): Promise<{ categoryId: number; groupId: number } | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('products')
    .select('category_id, group_id')
    .eq('id', productId)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    categoryId: data.category_id,
    groupId: data.group_id,
  };
}

// ============================================================================
// Database Functions
// ============================================================================

async function storeLatestPrices(prices: TCGCSVPrice[]): Promise<number> {
  const supabase = getSupabase();
  let stored = 0;
  const today = new Date().toISOString().split('T')[0];

  // Get variant mapping
  const { data: variants } = await supabase
    .from('variants')
    .select('id, name');

  const variantMap = new Map(variants?.map(v => [v.name, v.id]) || []);

  // Process in batches
  const batchSize = 100;
  for (let i = 0; i < prices.length; i += batchSize) {
    const batch = prices.slice(i, i + batchSize);
    const records = [];

    for (const price of batch) {
      let variantId = variantMap.get(price.variant_name);

      // Create variant if it doesn't exist
      if (!variantId) {
        const { data: newVariant } = await supabase
          .from('variants')
          .upsert({ name: price.variant_name }, { onConflict: 'name' })
          .select('id')
          .single();

        if (newVariant) {
          variantId = newVariant.id;
          variantMap.set(price.variant_name, variantId);
        }
      }

      if (!variantId) continue;

      // Convert prices to smallint cents or USD
      const needsUsd = (price.market_price && price.market_price > 327.67) ||
                       (price.high_price && price.high_price > 327.67);

      records.push({
        product_id: price.product_id,
        variant_id: variantId,
        recorded_at: today,
        low_price: !needsUsd && price.low_price ? Math.round(price.low_price * 100) : null,
        mid_price: !needsUsd && price.mid_price ? Math.round(price.mid_price * 100) : null,
        high_price: !needsUsd && price.high_price ? Math.round(price.high_price * 100) : null,
        market_price: !needsUsd && price.market_price ? Math.round(price.market_price * 100) : null,
        direct_low_price: !needsUsd && price.direct_low_price ? Math.round(price.direct_low_price * 100) : null,
        low_price_usd: needsUsd ? price.low_price : null,
        mid_price_usd: needsUsd ? price.mid_price : null,
        high_price_usd: needsUsd ? price.high_price : null,
        market_price_usd: needsUsd ? price.market_price : null,
      });
    }

    if (records.length > 0) {
      const { error } = await supabase
        .from('price_history')
        .upsert(records, {
          onConflict: 'product_id,variant_id,recorded_at',
          ignoreDuplicates: true,
        });

      if (!error) {
        stored += records.length;
      }
    }
  }

  return stored;
}

// ============================================================================
// Main Scraper Function
// ============================================================================

export async function scrapeTCGCSVPrices(options: TCGCSVScraperOptions): Promise<TCGCSVScraperResult> {
  const {
    productId,
    categoryId,
    groupId,
    dryRun = false,
  } = options;

  let targetCategoryId = categoryId;
  let targetGroupId = groupId;

  // If only product ID given, look up category/group
  if (productId && (!categoryId || !groupId)) {
    const info = await fetchProductInfo(productId);
    if (!info) {
      return {
        success: false,
        prices: [],
        stats: { total_fetched: 0, total_stored: 0, products_with_prices: 0 },
        error: `Product ${productId} not found in database`,
      };
    }
    targetCategoryId = info.categoryId;
    targetGroupId = info.groupId;
  }

  if (!targetCategoryId || !targetGroupId) {
    return {
      success: false,
      prices: [],
      stats: { total_fetched: 0, total_stored: 0, products_with_prices: 0 },
      error: 'Must provide productId or both categoryId and groupId',
    };
  }

  console.log(`🔍 Fetching TCGCSV prices`);
  console.log(`   Category: ${targetCategoryId}, Group: ${targetGroupId}`);
  if (productId) console.log(`   Product: ${productId}`);

  const prices = await fetchProductPrices(targetCategoryId, targetGroupId, productId);

  const stats = {
    total_fetched: prices.length,
    total_stored: 0,
    products_with_prices: prices.filter(p => p.market_price !== null).length,
  };

  console.log(`   Found ${prices.length} price records`);

  // Store in database (unless dry run)
  if (!dryRun && prices.length > 0) {
    console.log(`   Storing prices...`);
    stats.total_stored = await storeLatestPrices(prices);
    console.log(`   ✓ Stored ${stats.total_stored} price records`);
  }

  return {
    success: true,
    prices,
    stats,
  };
}

// ============================================================================
// CLI Interface
// ============================================================================

function parseCliArgs(): TCGCSVScraperOptions {
  const args = process.argv.slice(2);
  const options: TCGCSVScraperOptions = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--product-id':
      case '-p':
        options.productId = parseInt(args[++i]);
        break;
      case '--category':
      case '-c':
        options.categoryId = parseInt(args[++i]);
        break;
      case '--group':
      case '-g':
        options.groupId = parseInt(args[++i]);
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
        console.log(`
TCGCSV Live Price Scraper

Usage:
  tsx src/tcgcsv-scraper.ts [options]

Options:
  -p, --product-id <id>     Product ID to fetch prices for
  -c, --category <id>       Category ID (e.g., 3 for Pokemon)
  -g, --group <id>          Group ID (set ID)
  --dry-run                 Don't store to database

Examples:
  tsx src/tcgcsv-scraper.ts --product-id 501527
  tsx src/tcgcsv-scraper.ts --category 3 --group 23568
`);
        process.exit(0);
    }
  }

  return options;
}

// ============================================================================
// Entry Point
// ============================================================================

async function main() {
  const options = parseCliArgs();

  if (!options.productId && (!options.categoryId || !options.groupId)) {
    console.error('Error: Must provide --product-id or both --category and --group');
    process.exit(1);
  }

  const result = await scrapeTCGCSVPrices(options);

  if (result.success) {
    console.log('\n📊 Results:');
    console.log(`   Total fetched: ${result.stats.total_fetched}`);
    console.log(`   Products with prices: ${result.stats.products_with_prices}`);
    console.log(`   Total stored: ${result.stats.total_stored}`);

    if (result.prices.length > 0) {
      console.log('\n📝 Sample prices:');
      result.prices.slice(0, 5).forEach(price => {
        console.log(`   • Product ${price.product_id} (${price.variant_name}): $${price.market_price?.toFixed(2) || 'N/A'}`);
      });
    }
  } else {
    console.error('Error:', result.error);
    process.exit(1);
  }
}

// Run if executed directly
if (process.argv[1]?.includes('tcgcsv-scraper')) {
  main().catch(console.error);
}
