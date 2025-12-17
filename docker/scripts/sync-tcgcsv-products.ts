#!/usr/bin/env bun

/**
 * Incremental TCGPlayer Product Sync from TCGCSV.com
 * 
 * This script downloads products from TCGCSV.com and incrementally updates
 * the database - only inserting new products or updating changed ones.
 * 
 * Designed to run as part of the nightly cron job.
 * 
 * Usage:
 *   bun run scripts/sync-tcgcsv-products.ts [--full] [--category <id>] [--dry-run]
 * 
 * Options:
 *   --full         Force full sync of all products (not just changes)
 *   --category     Only sync a specific category ID
 *   --dry-run      Show what would be updated without making changes
 */

import { Pool } from 'pg';
import fs from 'fs/promises';
import path from 'path';

// Database connection
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD,
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'postgres',
  port: parseInt(process.env.DB_PORT || '5432'),
});

// TCGCSV API base URL
const TCGCSV_BASE_URL = 'https://tcgcsv.com';

// Categories to skip (comics, not trading cards)
const SKIP_CATEGORIES = [69, 70];

// Configuration
const TCGCSV_DIR = process.env.TCGCSV_PATH || path.resolve(process.cwd(), 'tcgcsv');
const LOG_FILE = path.join(process.cwd(), 'logs', `sync-products-${new Date().toISOString().split('T')[0]}.log`);

// Stats tracking
const stats = {
  categoriesChecked: 0,
  groupsChecked: 0,
  productsChecked: 0,
  productsInserted: 0,
  productsUpdated: 0,
  productsSkipped: 0,
  errors: 0,
  startTime: Date.now(),
};

// Caches for normalized lookups
const rarityCache = new Map<string, number>();
const cardTypeCache = new Map<string, number>();

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FULL_SYNC = args.includes('--full');
const categoryIndex = args.indexOf('--category');
const SPECIFIC_CATEGORY = categoryIndex !== -1 ? parseInt(args[categoryIndex + 1]) : null;

async function log(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  try {
    await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
    await fs.appendFile(LOG_FILE, logMessage + '\n');
  } catch (e) {
    // Ignore log write errors
  }
}

// Fetch JSON with retry logic
async function fetchWithRetry(url: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'RippzzDB-ProductSync/1.0',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const text = await response.text();
      
      // Check for XML error responses
      if (text.trim().startsWith('<?xml') || text.trim().startsWith('<Error>')) {
        return null;
      }

      return JSON.parse(text);
    } catch (error: any) {
      if (i === retries - 1) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

// Load lookup caches
async function loadCaches() {
  await log('📦 Loading lookup caches...');

  // Load rarities
  const rarities = await pool.query('SELECT id, name FROM rarities');
  for (const row of rarities.rows) {
    rarityCache.set(row.name, row.id);
  }

  // Load card types
  const cardTypes = await pool.query('SELECT id, category_id, name FROM card_types');
  for (const row of cardTypes.rows) {
    cardTypeCache.set(`${row.category_id}_${row.name}`, row.id);
  }

  await log(`✅ Loaded ${rarityCache.size} rarities, ${cardTypeCache.size} card types`);
}

// Get or create rarity ID
async function getOrCreateRarityId(rarityName: string | null): Promise<number | null> {
  if (!rarityName) return null;

  if (rarityCache.has(rarityName)) {
    return rarityCache.get(rarityName)!;
  }

  if (DRY_RUN) {
    return null;
  }

  try {
    const result = await pool.query(
      'INSERT INTO rarities (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id',
      [rarityName]
    );
    const id = result.rows[0].id;
    rarityCache.set(rarityName, id);
    return id;
  } catch (error) {
    const result = await pool.query('SELECT id FROM rarities WHERE name = $1', [rarityName]);
    if (result.rows.length > 0) {
      const id = result.rows[0].id;
      rarityCache.set(rarityName, id);
      return id;
    }
    return null;
  }
}

// Get or create card type ID
async function getOrCreateCardTypeId(categoryId: number, typeName: string | null): Promise<number | null> {
  if (!typeName) return null;

  const cacheKey = `${categoryId}_${typeName}`;
  if (cardTypeCache.has(cacheKey)) {
    return cardTypeCache.get(cacheKey)!;
  }

  if (DRY_RUN) {
    return null;
  }

  try {
    const result = await pool.query(
      'INSERT INTO card_types (category_id, name, display_name) VALUES ($1, $2, $3) ON CONFLICT (category_id, name) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id',
      [categoryId, typeName, typeName]
    );
    const id = result.rows[0].id;
    cardTypeCache.set(cacheKey, id);
    return id;
  } catch (error) {
    const result = await pool.query('SELECT id FROM card_types WHERE category_id = $1 AND name = $2', [categoryId, typeName]);
    if (result.rows.length > 0) {
      const id = result.rows[0].id;
      cardTypeCache.set(cacheKey, id);
      return id;
    }
    return null;
  }
}

// Extract value from extended data array
function getExtendedValue(extendedData: any[], fieldName: string): string | null {
  if (!Array.isArray(extendedData)) return null;
  const field = extendedData.find((item: any) => item.name === fieldName);
  return field?.value || null;
}

// Check if TCGCSV has been updated since our last sync
async function checkTcgcsvLastUpdated(): Promise<{ hasUpdates: boolean; lastUpdated: string | null }> {
  try {
    const response = await fetch(`${TCGCSV_BASE_URL}/last-updated.txt`);
    if (!response.ok) {
      return { hasUpdates: true, lastUpdated: null };
    }
    const lastUpdated = (await response.text()).trim();
    
    // Check our last sync time from the database or file
    const summaryPath = path.join(TCGCSV_DIR, 'product-sync-summary.json');
    try {
      const summary = JSON.parse(await fs.readFile(summaryPath, 'utf8'));
      const ourLastSync = new Date(summary.lastSync);
      const tcgcsvLastUpdate = new Date(lastUpdated);
      
      if (tcgcsvLastUpdate <= ourLastSync && !FULL_SYNC) {
        return { hasUpdates: false, lastUpdated };
      }
    } catch {
      // No previous sync, proceed with sync
    }
    
    return { hasUpdates: true, lastUpdated };
  } catch (error) {
    await log(`⚠️ Could not check TCGCSV last-updated: ${error}`);
    return { hasUpdates: true, lastUpdated: null };
  }
}

// Fetch categories from TCGCSV
async function fetchCategories(): Promise<any[]> {
  await log('📦 Fetching categories from TCGCSV...');
  
  const data = await fetchWithRetry(`${TCGCSV_BASE_URL}/tcgplayer/categories`);
  
  if (!data || !data.success || !Array.isArray(data.results)) {
    throw new Error('Failed to fetch categories');
  }
  
  // Filter out skipped categories
  const categories = data.results.filter((cat: any) => !SKIP_CATEGORIES.includes(cat.categoryId));
  
  await log(`✅ Found ${categories.length} categories (skipping ${SKIP_CATEGORIES.length} comic categories)`);
  return categories;
}

// Fetch groups for a category
async function fetchGroups(categoryId: number): Promise<any[]> {
  const data = await fetchWithRetry(`${TCGCSV_BASE_URL}/tcgplayer/${categoryId}/groups`);
  
  if (!data || !data.success || !Array.isArray(data.results)) {
    return [];
  }
  
  return data.results;
}

// Fetch products for a group
async function fetchProducts(categoryId: number, groupId: number): Promise<any[]> {
  const data = await fetchWithRetry(`${TCGCSV_BASE_URL}/tcgplayer/${categoryId}/${groupId}/products`);
  
  if (!data || !data.success || !Array.isArray(data.results)) {
    return [];
  }
  
  return data.results;
}

// Get existing product from database
async function getExistingProduct(productId: number): Promise<any | null> {
  const result = await pool.query(
    'SELECT id, modified_on FROM products WHERE id = $1',
    [productId]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

// Sync a single product
async function syncProduct(product: any, categoryId: number): Promise<'inserted' | 'updated' | 'skipped'> {
  const existingProduct = await getExistingProduct(product.productId);
  
  // Check if product needs updating (by comparing modified_on)
  if (existingProduct && !FULL_SYNC) {
    const existingModified = existingProduct.modified_on ? new Date(existingProduct.modified_on) : null;
    const newModified = product.modifiedOn ? new Date(product.modifiedOn) : null;
    
    // Skip if no changes
    if (existingModified && newModified && existingModified >= newModified) {
      return 'skipped';
    }
  }

  // Extract normalized fields from extended data
  const cardNumber = getExtendedValue(product.extendedData, 'Number');
  const rarityName = getExtendedValue(product.extendedData, 'Rarity');
  const cardType = getExtendedValue(product.extendedData, 'Card Type');
  const hp = getExtendedValue(product.extendedData, 'HP');
  const stage = getExtendedValue(product.extendedData, 'Stage');
  const retreatCost = getExtendedValue(product.extendedData, 'RetreatCost');

  // Get or create normalized IDs
  const rarityId = await getOrCreateRarityId(rarityName);
  const cardTypeId = await getOrCreateCardTypeId(categoryId, cardType);

  // Build card text JSONB
  const cardText: any = {};
  const cardTextField = getExtendedValue(product.extendedData, 'CardText');
  if (cardTextField) cardText.text = cardTextField;

  const attack1 = getExtendedValue(product.extendedData, 'Attack 1');
  if (attack1) cardText.attack1 = attack1;

  const attack2 = getExtendedValue(product.extendedData, 'Attack 2');
  if (attack2) cardText.attack2 = attack2;

  const attack3 = getExtendedValue(product.extendedData, 'Attack 3');
  if (attack3) cardText.attack3 = attack3;

  const weakness = getExtendedValue(product.extendedData, 'Weakness');
  if (weakness) cardText.weakness = weakness;

  const resistance = getExtendedValue(product.extendedData, 'Resistance');
  if (resistance) cardText.resistance = resistance;

  if (DRY_RUN) {
    return existingProduct ? 'updated' : 'inserted';
  }

  await pool.query(`
    INSERT INTO products (
      id, category_id, group_id, name, clean_name,
      card_number, rarity_id, card_type_id,
      hp, stage, retreat_cost,
      image_count, is_presale, released_on, url, modified_on,
      card_text, is_synthetic
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    ON CONFLICT (id) DO UPDATE SET
      category_id = EXCLUDED.category_id,
      group_id = EXCLUDED.group_id,
      name = EXCLUDED.name,
      clean_name = EXCLUDED.clean_name,
      card_number = EXCLUDED.card_number,
      rarity_id = EXCLUDED.rarity_id,
      card_type_id = EXCLUDED.card_type_id,
      hp = EXCLUDED.hp,
      stage = EXCLUDED.stage,
      retreat_cost = EXCLUDED.retreat_cost,
      image_count = EXCLUDED.image_count,
      is_presale = EXCLUDED.is_presale,
      released_on = EXCLUDED.released_on,
      url = EXCLUDED.url,
      modified_on = EXCLUDED.modified_on,
      card_text = EXCLUDED.card_text
  `, [
    product.productId,
    categoryId,
    product.groupId,
    product.name,
    product.cleanName,
    cardNumber,
    rarityId,
    cardTypeId,
    hp ? parseInt(hp) : null,
    stage,
    retreatCost ? parseInt(retreatCost) : null,
    product.imageCount || 0,
    product.presaleInfo?.isPresale || false,
    product.presaleInfo?.releasedOn ? new Date(product.presaleInfo.releasedOn) : null,
    product.url,
    product.modifiedOn ? new Date(product.modifiedOn) : null,
    Object.keys(cardText).length > 0 ? JSON.stringify(cardText) : null,
    false
  ]);

  return existingProduct ? 'updated' : 'inserted';
}

// Sync categories to database
async function syncCategories(categories: any[]) {
  await log('📦 Syncing categories...');
  
  if (DRY_RUN) {
    await log(`[DRY RUN] Would sync ${categories.length} categories`);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const category of categories) {
      await client.query(`
        INSERT INTO categories (
          id, name, display_name, popularity, is_scannable, is_direct, modified_on
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          display_name = EXCLUDED.display_name,
          popularity = EXCLUDED.popularity,
          is_scannable = EXCLUDED.is_scannable,
          is_direct = EXCLUDED.is_direct,
          modified_on = EXCLUDED.modified_on
      `, [
        category.categoryId,
        category.name,
        category.displayName,
        category.popularity || 0,
        category.isScannable || false,
        category.isDirect || false,
        category.modifiedOn ? new Date(category.modifiedOn) : null
      ]);
    }

    await client.query('COMMIT');
    await log(`✅ Synced ${categories.length} categories`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Sync groups to database
async function syncGroups(groups: any[], categoryId: number) {
  if (DRY_RUN) {
    await log(`[DRY RUN] Would sync ${groups.length} groups for category ${categoryId}`);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const group of groups) {
      await client.query(`
        INSERT INTO groups (
          id, category_id, name, abbreviation,
          is_supplemental, published_on, modified_on
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
          category_id = EXCLUDED.category_id,
          name = EXCLUDED.name,
          abbreviation = EXCLUDED.abbreviation,
          is_supplemental = EXCLUDED.is_supplemental,
          published_on = EXCLUDED.published_on,
          modified_on = EXCLUDED.modified_on
      `, [
        group.groupId,
        group.categoryId,
        group.name,
        group.abbreviation,
        group.isSupplemental || false,
        group.publishedOn ? new Date(group.publishedOn) : null,
        group.modifiedOn ? new Date(group.modifiedOn) : null
      ]);

      stats.groupsChecked++;
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Main sync function
async function syncProducts() {
  await log('╔════════════════════════════════════════════════════════╗');
  await log('║     Incremental TCGCSV Product Sync                    ║');
  await log('╚════════════════════════════════════════════════════════╝');
  await log('');

  if (DRY_RUN) {
    await log('🔍 DRY RUN MODE - No changes will be made');
  }

  if (FULL_SYNC) {
    await log('🔄 FULL SYNC MODE - Checking all products');
  }

  if (SPECIFIC_CATEGORY) {
    await log(`🎯 Syncing only category ${SPECIFIC_CATEGORY}`);
  }

  // Check if TCGCSV has been updated
  const { hasUpdates, lastUpdated } = await checkTcgcsvLastUpdated();
  
  if (!hasUpdates && !FULL_SYNC) {
    await log('✅ No updates from TCGCSV since last sync. Skipping.');
    return;
  }

  if (lastUpdated) {
    await log(`📅 TCGCSV last updated: ${lastUpdated}`);
  }

  // Load caches
  await loadCaches();

  // Fetch and sync categories
  let categories = await fetchCategories();
  
  if (SPECIFIC_CATEGORY) {
    categories = categories.filter((cat: any) => cat.categoryId === SPECIFIC_CATEGORY);
    if (categories.length === 0) {
      await log(`❌ Category ${SPECIFIC_CATEGORY} not found`);
      return;
    }
  }

  await syncCategories(categories);

  // Process each category
  for (const category of categories) {
    const categoryId = category.categoryId;
    await log(`\n📂 Processing category: ${category.name} (ID: ${categoryId})`);
    stats.categoriesChecked++;

    try {
      // Fetch groups for this category
      const groups = await fetchGroups(categoryId);
      await log(`  Found ${groups.length} groups`);

      await syncGroups(groups, categoryId);

      // Process each group
      for (const group of groups) {
        const groupId = group.groupId;

        try {
          // Fetch products for this group
          const products = await fetchProducts(categoryId, groupId);

          if (products.length === 0) {
            continue;
          }

          let groupInserted = 0;
          let groupUpdated = 0;
          let groupSkipped = 0;

          for (const product of products) {
            try {
              const result = await syncProduct(product, categoryId);
              stats.productsChecked++;

              if (result === 'inserted') {
                stats.productsInserted++;
                groupInserted++;
              } else if (result === 'updated') {
                stats.productsUpdated++;
                groupUpdated++;
              } else {
                stats.productsSkipped++;
                groupSkipped++;
              }
            } catch (error: any) {
              stats.errors++;
              await log(`    ❌ Error syncing product ${product.productId}: ${error.message}`);
            }
          }

          // Only log if something changed
          if (groupInserted > 0 || groupUpdated > 0) {
            await log(`  📦 ${group.name}: +${groupInserted} new, ~${groupUpdated} updated, ${groupSkipped} unchanged`);
          }

          // Small delay between groups to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error: any) {
          stats.errors++;
          await log(`  ❌ Error processing group ${group.name}: ${error.message}`);
        }
      }

      // Delay between categories
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error: any) {
      stats.errors++;
      await log(`❌ Error processing category ${category.name}: ${error.message}`);
    }
  }

  // Save sync summary
  if (!DRY_RUN) {
    const summary = {
      lastSync: new Date().toISOString(),
      tcgcsvLastUpdated: lastUpdated,
      stats: {
        categoriesChecked: stats.categoriesChecked,
        groupsChecked: stats.groupsChecked,
        productsChecked: stats.productsChecked,
        productsInserted: stats.productsInserted,
        productsUpdated: stats.productsUpdated,
        productsSkipped: stats.productsSkipped,
        errors: stats.errors,
        durationSeconds: Math.round((Date.now() - stats.startTime) / 1000),
      }
    };

    await fs.mkdir(TCGCSV_DIR, { recursive: true });
    await fs.writeFile(
      path.join(TCGCSV_DIR, 'product-sync-summary.json'),
      JSON.stringify(summary, null, 2)
    );
  }

  // Final summary
  const elapsed = Math.round((Date.now() - stats.startTime) / 1000);
  
  await log('');
  await log('╔════════════════════════════════════════════════════════╗');
  await log('║                    Sync Complete!                      ║');
  await log('╚════════════════════════════════════════════════════════╝');
  await log('');
  await log(`📊 Summary:`);
  await log(`   Categories checked: ${stats.categoriesChecked}`);
  await log(`   Groups checked: ${stats.groupsChecked}`);
  await log(`   Products checked: ${stats.productsChecked.toLocaleString()}`);
  await log(`   Products inserted: ${stats.productsInserted.toLocaleString()}`);
  await log(`   Products updated: ${stats.productsUpdated.toLocaleString()}`);
  await log(`   Products unchanged: ${stats.productsSkipped.toLocaleString()}`);
  await log(`   Errors: ${stats.errors}`);
  await log(`   Duration: ${elapsed}s (${(elapsed / 60).toFixed(1)} minutes)`);
  await log('');

  if (DRY_RUN) {
    await log('🔍 This was a DRY RUN - no changes were made to the database');
  }
}

// Main execution
async function main() {
  try {
    // Test database connection
    const testResult = await pool.query('SELECT NOW()');
    await log(`✅ Database connected: ${testResult.rows[0].now}`);

    await syncProducts();

  } catch (error: any) {
    await log(`💥 Fatal error: ${error.message}`);
    await log(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await log('\n⚠️ Received SIGINT, shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await log('\n⚠️ Received SIGTERM, shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

// Run sync
main();
