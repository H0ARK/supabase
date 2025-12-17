#!/usr/bin/env node
/**
 * Import TCGCSV price history into Supabase price_history table
 * 
 * Usage: node import-price-history.js [--date YYYY-MM-DD] [--all]
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection (using Docker internal network or external)
const pool = new Pool({
  user: 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'SRLdx061MBZtm9BCbnJ9qJGSMh1wUuwH',
  host: 'localhost',
  database: 'postgres',
  port: 5432,  // Direct connection port
});

const PRICE_HISTORY_DIR = '/home/ubuntu/supabase/docker/tcgcsv/price-history';
const BATCH_SIZE = 1000;

// Variant cache
const variantCache = new Map();

async function loadVariantCache() {
  const result = await pool.query('SELECT id, name FROM variants');
  for (const row of result.rows) {
    variantCache.set(row.name, row.id);
  }
  console.log(`✅ Loaded ${variantCache.size} variants into cache`);
}

async function getOrCreateVariantId(variantName) {
  if (variantCache.has(variantName)) {
    return variantCache.get(variantName);
  }

  try {
    const result = await pool.query(
      'INSERT INTO variants (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id',
      [variantName]
    );
    const id = result.rows[0].id;
    variantCache.set(variantName, id);
    return id;
  } catch (error) {
    const result = await pool.query('SELECT id FROM variants WHERE name = $1', [variantName]);
    if (result.rows.length > 0) {
      const id = result.rows[0].id;
      variantCache.set(variantName, id);
      return id;
    }
    throw error;
  }
}

function priceToSmallInt(price) {
  if (price === null || price === undefined) return null;
  const cents = Math.round(price * 100);
  if (cents > 32767) return null; // SMALLINT max
  return cents;
}

function needsUsdPrices(product) {
  return (
    (product.lowPrice && product.lowPrice > 327.67) ||
    (product.midPrice && product.midPrice > 327.67) ||
    (product.highPrice && product.highPrice > 327.67) ||
    (product.marketPrice && product.marketPrice > 327.67)
  );
}

async function findPricesFiles(dateDir) {
  const files = [];
  
  function walkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.name === 'prices') {
        files.push(fullPath);
      }
    }
  }
  
  walkDir(dateDir);
  return files;
}

async function insertBatch(client, records) {
  if (records.length === 0) return 0;

  const values = [];
  const placeholders = [];
  let paramIndex = 1;

  for (const record of records) {
    placeholders.push(
      `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9}, $${paramIndex + 10}, $${paramIndex + 11})`
    );
    values.push(
      record.product_id,
      record.variant_id,
      record.recorded_at,
      record.low_price,
      record.mid_price,
      record.high_price,
      record.market_price,
      record.direct_low_price,
      record.low_price_usd,
      record.mid_price_usd,
      record.high_price_usd,
      record.market_price_usd
    );
    paramIndex += 12;
  }

  const query = `
    INSERT INTO price_history (
      product_id, variant_id, recorded_at,
      low_price, mid_price, high_price, market_price, direct_low_price,
      low_price_usd, mid_price_usd, high_price_usd, market_price_usd
    )
    VALUES ${placeholders.join(', ')}
    ON CONFLICT DO NOTHING
  `;

  const result = await client.query(query, values);
  return result.rowCount;
}

async function processDateFolder(dateFolder) {
  const datePath = path.join(PRICE_HISTORY_DIR, dateFolder);
  const recordedAt = dateFolder;

  console.log(`\n📅 Processing date: ${dateFolder}`);

  const pricesFiles = await findPricesFiles(datePath);
  console.log(`   Found ${pricesFiles.length} prices files`);

  let totalRecords = 0;
  let insertedRecords = 0;
  let filesProcessed = 0;
  let errors = 0;

  const client = await pool.connect();

  try {
    for (const pricesFile of pricesFiles) {
      try {
        const fileContent = fs.readFileSync(pricesFile, 'utf8');
        const data = JSON.parse(fileContent);

        if (!data.success || !Array.isArray(data.results)) {
          errors++;
          continue;
        }

        const records = [];

        for (const product of data.results) {
          const variantId = await getOrCreateVariantId(product.subTypeName || 'Normal');
          const needsUsd = needsUsdPrices(product);

          records.push({
            product_id: product.productId,
            variant_id: variantId,
            recorded_at: recordedAt,
            low_price: priceToSmallInt(product.lowPrice),
            mid_price: priceToSmallInt(product.midPrice),
            high_price: priceToSmallInt(product.highPrice),
            market_price: priceToSmallInt(product.marketPrice),
            direct_low_price: priceToSmallInt(product.directLowPrice),
            low_price_usd: needsUsd ? product.lowPrice : null,
            mid_price_usd: needsUsd ? product.midPrice : null,
            high_price_usd: needsUsd ? product.highPrice : null,
            market_price_usd: needsUsd ? product.marketPrice : null,
          });
        }

        // Insert in batches
        for (let i = 0; i < records.length; i += BATCH_SIZE) {
          const batch = records.slice(i, i + BATCH_SIZE);
          try {
            const inserted = await insertBatch(client, batch);
            insertedRecords += inserted;
          } catch (err) {
            // Ignore constraint violations
            if (!err.message.includes('violates')) {
              console.error(`   Error inserting batch: ${err.message}`);
            }
          }
        }

        totalRecords += records.length;
        filesProcessed++;

        if (filesProcessed % 100 === 0) {
          console.log(`   Processed ${filesProcessed}/${pricesFiles.length} files, ${insertedRecords} records inserted`);
        }

      } catch (err) {
        errors++;
      }
    }

  } finally {
    client.release();
  }

  console.log(`   ✅ Complete: ${filesProcessed} files, ${totalRecords} records processed, ${insertedRecords} inserted, ${errors} errors`);

  return { filesProcessed, totalRecords, insertedRecords, errors };
}

async function main() {
  const args = process.argv.slice(2);
  let specificDate = null;
  let processAll = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      specificDate = args[i + 1];
      i++;
    } else if (args[i] === '--all') {
      processAll = true;
    }
  }

  console.log('🚀 Starting price history import...');
  console.log(`   Source: ${PRICE_HISTORY_DIR}`);

  // Test database connection
  try {
    const testResult = await pool.query('SELECT NOW()');
    console.log(`✅ Database connected: ${testResult.rows[0].now}`);
  } catch (err) {
    console.error(`❌ Database connection failed: ${err.message}`);
    process.exit(1);
  }

  await loadVariantCache();

  // Find date folders
  let dateFolders;
  if (specificDate) {
    dateFolders = [specificDate];
  } else {
    const entries = fs.readdirSync(PRICE_HISTORY_DIR, { withFileTypes: true });
    dateFolders = entries
      .filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map(e => e.name)
      .sort();
  }

  console.log(`📁 Found ${dateFolders.length} date folders to process`);

  if (dateFolders.length === 0) {
    console.log('⚠️  No date folders found');
    await pool.end();
    return;
  }

  let totalStats = { filesProcessed: 0, totalRecords: 0, insertedRecords: 0, errors: 0 };

  for (const dateFolder of dateFolders) {
    const datePath = path.join(PRICE_HISTORY_DIR, dateFolder);
    if (!fs.existsSync(datePath)) {
      console.log(`⚠️  Skipping ${dateFolder} - directory not found`);
      continue;
    }

    const stats = await processDateFolder(dateFolder);
    totalStats.filesProcessed += stats.filesProcessed;
    totalStats.totalRecords += stats.totalRecords;
    totalStats.insertedRecords += stats.insertedRecords;
    totalStats.errors += stats.errors;

    // Optionally delete processed folder
    // fs.rmSync(datePath, { recursive: true, force: true });
    // console.log(`   🗑️  Deleted ${dateFolder}`);
  }

  console.log('\n🎉 Import Complete!');
  console.log(`   Total files: ${totalStats.filesProcessed}`);
  console.log(`   Total records: ${totalStats.totalRecords}`);
  console.log(`   Inserted: ${totalStats.insertedRecords}`);
  console.log(`   Errors: ${totalStats.errors}`);

  // Get final stats
  const dbStats = await pool.query(`
    SELECT
      COUNT(*) as total_records,
      MIN(recorded_at) as min_date,
      MAX(recorded_at) as max_date
    FROM price_history
  `);

  console.log('\n📊 Database Stats:');
  console.log(`   Total records: ${parseInt(dbStats.rows[0].total_records).toLocaleString()}`);
  console.log(`   Date range: ${dbStats.rows[0].min_date} to ${dbStats.rows[0].max_date}`);

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
