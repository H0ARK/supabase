#!/usr/bin/env tsx

/**
 * Fanatics Collect Sales Scraper
 * 
 * Scrapes sales data from Fanatics Collect API,
 * stores in Supabase, and returns results.
 * 
 * Usage:
 *   tsx src/fanatics-scraper.ts --category Pokemon --days 7
 *   tsx src/fanatics-scraper.ts --product-id 12345 --days 30
 */

import { config } from 'dotenv';
import {
  getSupabase,
  sleep,
  randomDelay,
  parseGradingInfo,
} from '../lib/utils.js';

config();

// ============================================================================
// Types
// ============================================================================

export interface FanaticsSale {
  fanatics_id: string;
  category: string;
  title: string;
  purchase_price: number;
  currency: string;
  sold_date: string;
  grading_service: string | null;
  grade: number | null;
  grade_label: string | null;
  year: number | null;
  set_name: string | null;
  card_name: string | null;
  card_number: string | null;
  parallel_type: string | null;
  image_url: string | null;
  image_urls: string[];
  raw_data: any;
  scraped_at: string;
}

export interface FanaticsScraperOptions {
  category?: string;
  productId?: number;
  productName?: string;
  variantId?: number;
  variantName?: string;
  days?: number;
  maxPages?: number;
  dryRun?: boolean;
  autoMatch?: boolean;
}

export interface FanaticsScraperResult {
  success: boolean;
  category: string;
  sales: FanaticsSale[];
  stats: {
    total_fetched: number;
    total_stored: number;
    matches_found: number;
    average_price: number;
    median_price: number;
    min_price: number;
    max_price: number;
  };
  error?: string;
}

// ============================================================================
// Configuration
// ============================================================================

const FANATICS_API_BASE = 'https://sales-history-api.services.fanaticscollect.com/api/v1/pub/sales';
const PAGE_SIZE = 20;
const RATE_LIMIT_MS = parseInt(process.env.FANATICS_RATE_LIMIT_MS || '1000');

// Map friendly names to API category names
const CATEGORY_MAP: Record<string, string> = {
  pokemon: 'Pokémon',
  Pokemon: 'Pokémon',
  'Pokémon': 'Pokémon',
  magic: 'Magic the Gathering',
  mtg: 'Magic the Gathering',
  yugioh: 'Yu-Gi-Oh!',
  'Yu-Gi-Oh': 'Yu-Gi-Oh!',
  sports: 'Sports',
};

// ============================================================================
// API Functions
// ============================================================================

async function fetchFanaticsPage(
  page: number,
  category?: string,
  startDate?: Date,
  endDate?: Date
): Promise<any[]> {
  const params = new URLSearchParams({
    page: page.toString(),
    size: PAGE_SIZE.toString(),
    sort: 'soldDate,desc',
  });

  if (category) {
    params.append('category', category);
  }

  const url = `${FANATICS_API_BASE}?${params.toString()}`;

  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data || !Array.isArray(data)) {
      console.warn(`Unexpected response format on page ${page}`);
      return [];
    }

    // Filter by date range if specified
    let sales = data;

    if (startDate || endDate) {
      sales = sales.filter((sale: any) => {
        const saleDate = new Date(sale.soldDate);
        if (startDate && saleDate < startDate) return false;
        if (endDate && saleDate > endDate) return false;
        return true;
      });
    }

    return sales;
  } catch (error) {
    console.error(`Error fetching page ${page}:`, error);
    return [];
  }
}

// ============================================================================
// Parsing Functions
// ============================================================================

function parseCardInfo(title: string): {
  year: number | null;
  setName: string | null;
  cardName: string | null;
  cardNumber: string | null;
  parallelType: string | null;
} {
  const info: any = {
    year: null,
    setName: null,
    cardName: null,
    cardNumber: null,
    parallelType: null,
  };

  // Extract year (4 digits at start)
  const yearMatch = title.match(/^(\d{4})\s+/);
  if (yearMatch) {
    info.year = parseInt(yearMatch[1]);
  }

  // Extract card number (e.g., "#156", "#001/165")
  const numberMatch = title.match(/#(\d+(?:\/\d+)?)/);
  if (numberMatch) {
    info.cardNumber = numberMatch[1].split('/')[0];
  }

  // Extract parallel/variant type
  const parallelPatterns = [
    /Full Art/i,
    /Rainbow Rare/i,
    /Secret Rare/i,
    /Ultra Rare/i,
    /Special Art Rare/i,
    /Illustration Rare/i,
    /Holo/i,
    /Reverse Holo/i,
    /First Edition/i,
    /Shadowless/i,
    /1st Edition/i,
  ];

  for (const pattern of parallelPatterns) {
    const match = title.match(pattern);
    if (match) {
      info.parallelType = match[0];
      break;
    }
  }

  // Extract set name - between year and card details
  const setPatterns = [
    /(?:Pokemon|Pokémon)\s+([A-Za-z0-9\s\-:]+?)(?:\s+(?:Full Art|Rainbow|Secret|Ultra|Holo|#|\d{1,3}(?:\/|$)))/i,
    /(?:20\d{2})\s+(?:Pokemon|Pokémon)\s+([A-Za-z0-9\s\-:]+?)(?:\s+[A-Z])/i,
  ];

  for (const pattern of setPatterns) {
    const match = title.match(pattern);
    if (match) {
      info.setName = match[1].trim();
      break;
    }
  }

  return info;
}

function transformFanaticsSale(rawSale: any): FanaticsSale {
  const parsedInfo = parseCardInfo(rawSale.title || '');
  const { service: gradingService, grade } = parseGradingInfo(rawSale.title || '');

  // Collect all image URLs
  const imageUrls: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const key = i === 1 ? 'mediumImage1' : `mediumImage${i}`;
    if (rawSale[key]) {
      imageUrls.push(rawSale[key]);
    }
  }

  return {
    fanatics_id: rawSale.id,
    category: rawSale.category || 'Unknown',
    title: rawSale.title || '',
    purchase_price: parseFloat(rawSale.purchasePrice) || 0,
    currency: 'USD',
    sold_date: rawSale.soldDate || new Date().toISOString(),
    grading_service: rawSale.gradingService || gradingService,
    grade: rawSale.grade || grade,
    grade_label: rawSale.gradeLabel || null,
    year: rawSale.year || parsedInfo.year,
    set_name: parsedInfo.setName,
    card_name: parsedInfo.cardName,
    card_number: parsedInfo.cardNumber,
    parallel_type: parsedInfo.parallelType,
    image_url: rawSale.mediumImage1 || rawSale.largeImage1 || null,
    image_urls: imageUrls,
    raw_data: rawSale,
    scraped_at: new Date().toISOString(),
  };
}

// ============================================================================
// Matching Functions
// ============================================================================

async function findProductMatch(
  sale: FanaticsSale
): Promise<{ productId: number; variantId: number; confidence: number } | null> {
  const supabase = getSupabase();

  // Try to match by set name and card number
  if (sale.set_name && sale.card_number) {
    const { data: products } = await supabase
      .from('products')
      .select('id, name, group_id')
      .ilike('name', `%${sale.card_number}%`)
      .limit(10);

    if (products && products.length > 0) {
      // Look for matching group (set)
      const { data: groups } = await supabase
        .from('groups')
        .select('id, name')
        .ilike('name', `%${sale.set_name}%`)
        .limit(5);

      if (groups && groups.length > 0) {
        const matchingProduct = products.find(p => 
          groups.some(g => g.id === p.group_id)
        );

        if (matchingProduct) {
          // Get default variant
          const { data: variants } = await supabase
            .from('variants')
            .select('id')
            .eq('name', 'Normal')
            .single();

          return {
            productId: matchingProduct.id,
            variantId: variants?.id || 1,
            confidence: 0.85,
          };
        }
      }
    }
  }

  return null;
}

// ============================================================================
// Database Functions
// ============================================================================

async function storeFanaticsSales(
  sales: FanaticsSale[],
  autoMatch: boolean = false
): Promise<{ stored: number; matched: number }> {
  const supabase = getSupabase();
  let stored = 0;
  let matched = 0;

  for (const sale of sales) {
    // Try to find a product match if auto-matching is enabled
    let productId: number | null = null;
    let variantId: number | null = null;
    let matchConfidence: number | null = null;
    let matchMethod: string | null = null;

    if (autoMatch) {
      const match = await findProductMatch(sale);
      if (match) {
        productId = match.productId;
        variantId = match.variantId;
        matchConfidence = match.confidence;
        matchMethod = 'auto_set_number';
        matched++;
      }
    }

    const { error } = await supabase
      .from('fanatics_sales')
      .upsert({
        fanatics_id: sale.fanatics_id,
        fanatics_url: `https://www.fanaticscollect.com/sales/${sale.fanatics_id}`,
        product_id: productId,
        variant_id: variantId,
        category: sale.category,
        title: sale.title,
        purchase_price: sale.purchase_price,
        currency: sale.currency,
        sold_date: sale.sold_date,
        grading_service: sale.grading_service,
        grade: sale.grade,
        grade_label: sale.grade_label,
        year: sale.year,
        set_name: sale.set_name,
        card_name: sale.card_name,
        card_number: sale.card_number,
        parallel_type: sale.parallel_type,
        image_url: sale.image_url,
        image_urls: sale.image_urls,
        raw_data: sale.raw_data,
        matched_at: matchConfidence ? new Date().toISOString() : null,
        match_confidence: matchConfidence,
        match_method: matchMethod,
        scraped_at: sale.scraped_at,
      }, {
        onConflict: 'fanatics_id',
      });

    if (!error) {
      stored++;
    } else {
      console.error('Error storing sale:', error);
    }
  }

  return { stored, matched };
}

// ============================================================================
// Main Scraper Function
// ============================================================================

export async function scrapeFanaticsSales(options: FanaticsScraperOptions): Promise<FanaticsScraperResult> {
  const {
    category,
    days = 7,
    maxPages = 100,
    dryRun = false,
    autoMatch = false,
  } = options;

  // Map category name
  const apiCategory = category ? (CATEGORY_MAP[category] || category) : undefined;

  console.log(`🔍 Scraping Fanatics Collect`);
  console.log(`   Category: ${apiCategory || 'all'}`);
  console.log(`   Days: ${days}, Max pages: ${maxPages}`);

  const allSales: FanaticsSale[] = [];
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  let page = 0;
  let hasMore = true;
  let consecutiveEmpty = 0;

  while (hasMore && page < maxPages) {
    console.log(`   Page ${page + 1}...`);

    const rawSales = await fetchFanaticsPage(page, apiCategory, startDate, endDate);

    if (rawSales.length === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 3) {
        console.log(`   No more data (3 consecutive empty pages)`);
        hasMore = false;
      }
    } else {
      consecutiveEmpty = 0;

      for (const rawSale of rawSales) {
        const sale = transformFanaticsSale(rawSale);
        
        // Check date cutoff
        const saleDate = new Date(sale.sold_date);
        if (saleDate < startDate) {
          hasMore = false;
          break;
        }

        allSales.push(sale);
      }
    }

    page++;

    // Rate limiting
    if (hasMore) {
      await sleep(randomDelay(RATE_LIMIT_MS));
    }
  }

  console.log(`   Found ${allSales.length} sales`);

  // Calculate statistics
  const prices = allSales.map(s => s.purchase_price).filter(p => p > 0).sort((a, b) => a - b);
  const stats = {
    total_fetched: allSales.length,
    total_stored: 0,
    matches_found: 0,
    average_price: prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
    median_price: prices.length > 0 ? prices[Math.floor(prices.length / 2)] : 0,
    min_price: prices.length > 0 ? prices[0] : 0,
    max_price: prices.length > 0 ? prices[prices.length - 1] : 0,
  };

  // Store in database (unless dry run)
  if (!dryRun && allSales.length > 0) {
    console.log(`   Storing ${allSales.length} sales...`);
    const { stored, matched } = await storeFanaticsSales(allSales, autoMatch);
    stats.total_stored = stored;
    stats.matches_found = matched;
    console.log(`   ✓ Stored ${stored} sales, ${matched} matched`);
  }

  return {
    success: true,
    category: apiCategory || 'all',
    sales: allSales,
    stats,
  };
}

// ============================================================================
// CLI Interface
// ============================================================================

function parseCliArgs(): FanaticsScraperOptions {
  const args = process.argv.slice(2);
  const options: FanaticsScraperOptions = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--category':
      case '-c':
        options.category = args[++i];
        break;
      case '--days':
      case '-d':
        options.days = parseInt(args[++i]);
        break;
      case '--max-pages':
        options.maxPages = parseInt(args[++i]);
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--auto-match':
        options.autoMatch = true;
        break;
      case '--help':
        console.log(`
Fanatics Collect Sales Scraper

Usage:
  tsx src/fanatics-scraper.ts [options]

Options:
  -c, --category <name>     Category (Pokemon, MTG, YuGiOh, Sports)
  -d, --days <number>       Days back to scrape (default: 7)
  --max-pages <number>      Max pages to fetch (default: 100)
  --auto-match              Try to match sales to products
  --dry-run                 Don't store to database

Examples:
  tsx src/fanatics-scraper.ts --category Pokemon --days 7
  tsx src/fanatics-scraper.ts -c MTG -d 30 --auto-match
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
  const result = await scrapeFanaticsSales(options);

  if (result.success) {
    console.log('\n📊 Results:');
    console.log(`   Category: ${result.category}`);
    console.log(`   Total fetched: ${result.stats.total_fetched}`);
    console.log(`   Total stored: ${result.stats.total_stored}`);
    console.log(`   Matches found: ${result.stats.matches_found}`);
    console.log(`   Average price: $${result.stats.average_price.toFixed(2)}`);
    console.log(`   Median price: $${result.stats.median_price.toFixed(2)}`);
    console.log(`   Price range: $${result.stats.min_price.toFixed(2)} - $${result.stats.max_price.toFixed(2)}`);

    if (result.sales.length > 0) {
      console.log('\n📝 Sample sales:');
      result.sales.slice(0, 5).forEach(sale => {
        console.log(`   • $${sale.purchase_price.toFixed(2)} - ${sale.title.substring(0, 60)}...`);
      });
    }
  } else {
    console.error('Error:', result.error);
    process.exit(1);
  }
}

// Run if executed directly
if (process.argv[1]?.includes('fanatics-scraper')) {
  main().catch(console.error);
}
