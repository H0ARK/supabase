#!/usr/bin/env tsx

/**
 * eBay Sold Listings Scraper
 * 
 * Scrapes completed/sold listings from eBay for trading cards,
 * stores data in Supabase, and returns results.
 * 
 * Usage:
 *   tsx src/ebay-scraper.ts --query "charizard base set" --limit 50
 *   tsx src/ebay-scraper.ts --product-id 12345 --days 30
 */

import * as cheerio from 'cheerio';
import { config } from 'dotenv';
import {
  getSupabase,
  sleep,
  randomDelay,
  parsePrice,
  getHeaders,
  parseGradingInfo,
  normalizeCondition,
  retryWithBackoff,
} from '../lib/utils.js';

config();

// ============================================================================
// Types
// ============================================================================

export interface EbaySale {
  ebay_id: string;
  title: string;
  price: number;
  price_text: string;
  condition: string | null;
  sold_date: string;
  url: string;
  image_url: string | null;
  seller: string | null;
  location: string | null;
  shipping_cost: number;
  bids_count: number;
  grading_service: string | null;
  grade: number | null;
  scraped_at: string;
}

export interface EbayScraperOptions {
  query?: string;
  productId?: number;
  productName?: string;
  variantId?: number;
  variantName?: string;
  limit?: number;
  days?: number;
  dryRun?: boolean;
  region?: 'us' | 'uk' | 'ca';
}

export interface EbayScraperResult {
  success: boolean;
  query: string;
  sales: EbaySale[];
  stats: {
    total_fetched: number;
    total_stored: number;
    average_price: number;
    median_price: number;
    min_price: number;
    max_price: number;
    price_range: string;
  };
  error?: string;
}

// ============================================================================
// Configuration
// ============================================================================

const EBAY_REGIONS = {
  us: 'https://www.ebay.com',
  uk: 'https://www.ebay.co.uk',
  ca: 'https://www.ebay.ca',
};

const RATE_LIMIT_MS = parseInt(process.env.EBAY_RATE_LIMIT_MS || '2000');

// ============================================================================
// Scraper Functions
// ============================================================================

async function fetchEbayPage(url: string): Promise<string> {
  const response = await retryWithBackoff(async () => {
    const res = await fetch(url, {
      headers: getHeaders(),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    return res.text();
  });

  return response;
}

function buildSearchUrl(
  query: string,
  region: 'us' | 'uk' | 'ca' = 'us',
  page: number = 1
): string {
  const baseUrl = EBAY_REGIONS[region];
  const params = new URLSearchParams({
    _nkw: query,
    _sacat: '0',           // All categories
    LH_Sold: '1',          // Sold items only
    LH_Complete: '1',      // Completed listings
    _sop: '13',            // Sort by end date (newest first)
    _pgn: page.toString(), // Page number
  });

  return `${baseUrl}/sch/i.html?${params.toString()}`;
}

function parseListings(html: string): EbaySale[] {
  const $ = cheerio.load(html);
  const listings: EbaySale[] = [];

  // eBay uses different selectors, try multiple
  const items = $('li.s-item, div.s-item');

  items.each((_, element) => {
    try {
      const $item = $(element);

      // Skip sponsored/featured items
      if ($item.find('.s-item__ad').length > 0) return;

      // Extract title
      const titleElem = $item.find('.s-item__title span[role="heading"], .s-item__title').first();
      const title = titleElem.text().trim();
      
      if (!title || title.includes('Shop on eBay')) return;

      // Extract URL and ID
      const urlElem = $item.find('.s-item__link').attr('href');
      if (!urlElem) return;

      const url = urlElem.split('?')[0];
      const idMatch = url.match(/\/itm\/(\d+)/);
      const ebayId = idMatch ? idMatch[1] : null;
      if (!ebayId) return;

      // Extract price
      const priceText = $item.find('.s-item__price').text().trim();
      const price = parsePrice(priceText);
      if (price <= 0) return;

      // Extract sold date
      const soldDateElem = $item.find('.s-item__ended-date, .s-item__endedDate, .POSITIVE').text().trim();
      const soldDate = parseSoldDate(soldDateElem) || new Date().toISOString().split('T')[0];

      // Extract condition
      const conditionText = $item.find('.SECONDARY_INFO').text().trim();
      const condition = conditionText ? normalizeCondition(conditionText) : null;

      // Extract shipping
      const shippingText = $item.find('.s-item__shipping, .s-item__freeXDays').text().trim();
      const shippingCost = shippingText.toLowerCase().includes('free') ? 0 : parsePrice(shippingText);

      // Extract bids
      const bidsText = $item.find('.s-item__bidCount').text().trim();
      const bidsMatch = bidsText.match(/(\d+)/);
      const bidsCount = bidsMatch ? parseInt(bidsMatch[1]) : 0;

      // Extract image
      const imageUrl = $item.find('.s-item__image img').attr('src') || null;

      // Extract seller
      const seller = $item.find('.s-item__seller-info-text').text().trim() || null;

      // Extract location
      const location = $item.find('.s-item__location').text().replace(/^From\s+/i, '').trim() || null;

      // Parse grading info from title
      const { service: gradingService, grade } = parseGradingInfo(title);

      listings.push({
        ebay_id: ebayId,
        title,
        price,
        price_text: priceText,
        condition,
        sold_date: soldDate,
        url,
        image_url: imageUrl,
        seller,
        location,
        shipping_cost: shippingCost,
        bids_count: bidsCount,
        grading_service: gradingService,
        grade,
        scraped_at: new Date().toISOString(),
      });
    } catch (err) {
      // Skip problematic items
      console.warn('Error parsing item:', err);
    }
  });

  return listings;
}

function parseSoldDate(dateText: string): string | null {
  if (!dateText) return null;

  // Common formats: "Sold Nov 15, 2024", "Nov 15, 2024", "15 Nov 2024"
  const now = new Date();
  
  // Try to extract date parts
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  
  const monthMatch = dateText.toLowerCase().match(new RegExp(`(${monthNames.join('|')})`));
  const dayMatch = dateText.match(/\b(\d{1,2})\b/);
  const yearMatch = dateText.match(/\b(20\d{2})\b/);

  if (monthMatch && dayMatch) {
    const month = monthNames.indexOf(monthMatch[1]);
    const day = parseInt(dayMatch[1]);
    const year = yearMatch ? parseInt(yearMatch[1]) : now.getFullYear();

    const date = new Date(year, month, day);
    return date.toISOString().split('T')[0];
  }

  return null;
}

// ============================================================================
// Database Functions
// ============================================================================

async function storeEbaySales(
  sales: EbaySale[],
  productId?: number,
  variantId?: number
): Promise<number> {
  const supabase = getSupabase();
  let stored = 0;

  // Upsert sales in batches
  const batchSize = 100;
  for (let i = 0; i < sales.length; i += batchSize) {
    const batch = sales.slice(i, i + batchSize).map(sale => ({
      ebay_id: sale.ebay_id,
      product_id: productId || null,
      variant_id: variantId || null,
      title: sale.title,
      price: sale.price,
      price_text: sale.price_text,
      condition: sale.condition,
      sold_date: sale.sold_date,
      url: sale.url,
      image_url: sale.image_url,
      seller: sale.seller,
      location: sale.location,
      shipping_cost: sale.shipping_cost,
      bids_count: sale.bids_count,
      grading_service: sale.grading_service,
      grade: sale.grade,
      scraped_at: sale.scraped_at,
    }));

    const { error, count } = await supabase
      .from('ebay_sales')
      .upsert(batch, {
        onConflict: 'ebay_id',
        ignoreDuplicates: false,
      });

    if (error) {
      console.error('Error storing batch:', error);
    } else {
      stored += batch.length;
    }
  }

  return stored;
}

// ============================================================================
// Main Scraper Function
// ============================================================================

export async function scrapeEbaySales(options: EbayScraperOptions): Promise<EbayScraperResult> {
  const {
    query,
    productId,
    productName,
    variantId,
    variantName,
    limit = 100,
    days = 30,
    dryRun = false,
    region = 'us',
  } = options;

  // Build search query
  let searchQuery = query || '';
  
  if (!searchQuery && productName) {
    searchQuery = productName;
    if (variantName && variantName !== 'Normal') {
      searchQuery += ` ${variantName}`;
    }
  }

  if (!searchQuery) {
    return {
      success: false,
      query: '',
      sales: [],
      stats: {
        total_fetched: 0,
        total_stored: 0,
        average_price: 0,
        median_price: 0,
        min_price: 0,
        max_price: 0,
        price_range: 'N/A',
      },
      error: 'No search query or product name provided',
    };
  }

  console.log(`🔍 Scraping eBay for: "${searchQuery}"`);
  console.log(`   Region: ${region}, Limit: ${limit}, Days: ${days}`);

  const allSales: EbaySale[] = [];
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  let page = 1;
  let hasMore = true;

  while (hasMore && allSales.length < limit) {
    const url = buildSearchUrl(searchQuery, region, page);
    console.log(`   Page ${page}...`);

    try {
      const html = await fetchEbayPage(url);
      const listings = parseListings(html);

      if (listings.length === 0) {
        console.log(`   No more listings found`);
        hasMore = false;
        break;
      }

      // Filter by date and add to results
      for (const listing of listings) {
        const soldDate = new Date(listing.sold_date);
        if (soldDate < cutoffDate) {
          hasMore = false;
          break;
        }

        allSales.push(listing);
        if (allSales.length >= limit) {
          hasMore = false;
          break;
        }
      }

      page++;

      // Rate limiting
      if (hasMore) {
        await sleep(randomDelay(RATE_LIMIT_MS));
      }
    } catch (error) {
      console.error(`   Error on page ${page}:`, error);
      hasMore = false;
    }
  }

  console.log(`   Found ${allSales.length} sales`);

  // Calculate statistics
  const prices = allSales.map(s => s.price).filter(p => p > 0).sort((a, b) => a - b);
  const stats = {
    total_fetched: allSales.length,
    total_stored: 0,
    average_price: prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
    median_price: prices.length > 0 ? prices[Math.floor(prices.length / 2)] : 0,
    min_price: prices.length > 0 ? prices[0] : 0,
    max_price: prices.length > 0 ? prices[prices.length - 1] : 0,
    price_range: prices.length > 0 ? `$${prices[0].toFixed(2)} - $${prices[prices.length - 1].toFixed(2)}` : 'N/A',
  };

  // Store in database (unless dry run)
  if (!dryRun && allSales.length > 0) {
    console.log(`   Storing ${allSales.length} sales...`);
    stats.total_stored = await storeEbaySales(allSales, productId, variantId);
    console.log(`   ✓ Stored ${stats.total_stored} sales`);
  }

  return {
    success: true,
    query: searchQuery,
    sales: allSales,
    stats,
  };
}

// ============================================================================
// CLI Interface
// ============================================================================

function parseCliArgs(): EbayScraperOptions {
  const args = process.argv.slice(2);
  const options: EbayScraperOptions = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--query':
      case '-q':
        options.query = args[++i];
        break;
      case '--product-id':
        options.productId = parseInt(args[++i]);
        break;
      case '--product-name':
        options.productName = args[++i];
        break;
      case '--variant-id':
        options.variantId = parseInt(args[++i]);
        break;
      case '--variant-name':
        options.variantName = args[++i];
        break;
      case '--limit':
      case '-l':
        options.limit = parseInt(args[++i]);
        break;
      case '--days':
      case '-d':
        options.days = parseInt(args[++i]);
        break;
      case '--region':
      case '-r':
        options.region = args[++i] as 'us' | 'uk' | 'ca';
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
        console.log(`
eBay Sold Listings Scraper

Usage:
  tsx src/ebay-scraper.ts [options]

Options:
  -q, --query <search>      Search query
  --product-id <id>         TCGPlayer product ID to associate
  --product-name <name>     Product name to search for
  --variant-id <id>         Variant ID to associate
  --variant-name <name>     Variant name to add to search
  -l, --limit <number>      Max number of results (default: 100)
  -d, --days <number>       Max days back to search (default: 30)
  -r, --region <us|uk|ca>   eBay region (default: us)
  --dry-run                 Don't store to database

Examples:
  tsx src/ebay-scraper.ts -q "charizard base set" -l 50
  tsx src/ebay-scraper.ts --product-name "Pikachu" --variant-name "Holo" -d 7
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

  if (!options.query && !options.productName) {
    console.error('Error: Must provide --query or --product-name');
    process.exit(1);
  }

  const result = await scrapeEbaySales(options);

  if (result.success) {
    console.log('\n📊 Results:');
    console.log(`   Total fetched: ${result.stats.total_fetched}`);
    console.log(`   Total stored: ${result.stats.total_stored}`);
    console.log(`   Average price: $${result.stats.average_price.toFixed(2)}`);
    console.log(`   Median price: $${result.stats.median_price.toFixed(2)}`);
    console.log(`   Price range: ${result.stats.price_range}`);

    if (result.sales.length > 0) {
      console.log('\n📝 Sample sales:');
      result.sales.slice(0, 5).forEach(sale => {
        console.log(`   • $${sale.price.toFixed(2)} - ${sale.title.substring(0, 60)}...`);
      });
    }
  } else {
    console.error('Error:', result.error);
    process.exit(1);
  }
}

// Run if executed directly
if (process.argv[1]?.includes('ebay-scraper')) {
  main().catch(console.error);
}
