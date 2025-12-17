#!/usr/bin/env npx tsx

/**
 * eBay Sold Listings Scraper using Playwright (Firefox)
 * 
 * Scrapes completed/sold listings from eBay for Pokemon trading cards,
 * stores results in Supabase, and returns the data.
 * 
 * Usage:
 *   npx tsx src/ebay-playwright.ts --search "charizard base set"
 *   npx tsx src/ebay-playwright.ts --search "pikachu vmax" --max-pages 3
 *   npx tsx src/ebay-playwright.ts --search "psa 10 charizard" --dry-run
 */

import { firefox, Browser, Page } from 'playwright';
import { config } from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

config();

// ============================================================================
// Types
// ============================================================================

export interface EbaySale {
  ebay_item_id: string;
  title: string;
  price: number;
  shipping_cost: number | null;
  total_price: number;
  condition: string | null;
  sold_date: string | null;
  url: string;
  image_url: string | null;
  seller: string | null;
  bids_count: number | null;
  buy_it_now: boolean;
  search_query: string;
}

export interface EbayScraperOptions {
  searchQuery: string;
  maxPages?: number;
  minPrice?: number;
  maxPrice?: number;
  dryRun?: boolean;
  headless?: boolean;
}

export interface EbayScraperResult {
  success: boolean;
  sales: EbaySale[];
  stats: {
    pages_scraped: number;
    total_found: number;
    total_stored: number;
    errors: string[];
  };
  error?: string;
}

// ============================================================================
// Supabase Client
// ============================================================================

function getSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  
  return createClient(url, key);
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(min: number, max: number): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return sleep(delay);
}

function parsePrice(priceText: string): number | null {
  if (!priceText) return null;
  const match = priceText.replace(/,/g, '').match(/[\d.]+/);
  return match ? parseFloat(match[0]) : null;
}

function parseDate(dateText: string): string | null {
  if (!dateText) return null;
  
  // "Sold Nov 24, 2025" or "Sold  Nov 24, 2025"
  const soldMatch = dateText.match(/Sold\s+(\w+\s+\d+,?\s*\d*)/i);
  if (soldMatch) {
    try {
      let dateStr = soldMatch[1].trim();
      // Add current year if not present
      if (!dateStr.match(/\d{4}/)) {
        dateStr += `, ${new Date().getFullYear()}`;
      }
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    } catch {}
  }
  
  return null;
}

// ============================================================================
// Scraper
// ============================================================================

async function scrapeEbayPage(page: Page, searchQuery: string): Promise<EbaySale[]> {
  const sales: EbaySale[] = [];
  
  // Wait for listings to load
  await page.waitForSelector('li[data-viewport]', { timeout: 10000 }).catch(() => null);
  
  // Extract all listing data using page.evaluate for efficiency
  const rawItems = await page.evaluate(() => {
    const items = document.querySelectorAll('li[data-viewport]');
    return Array.from(items).map(item => {
      const listingId = item.getAttribute('data-listingid');
      
      // Get all links and find the item link (not "Shop on eBay")
      const links = Array.from(item.querySelectorAll('a[href*="/itm/"]'));
      const itemLink = links.find(a => {
        const text = a.textContent || '';
        return !text.includes('Shop on eBay') && text.length > 10;
      });
      
      const url = itemLink?.getAttribute('href') || '';
      const title = itemLink?.textContent?.trim() || '';
      
      // Price - look for the s-card__price class
      const priceEl = item.querySelector('.s-card__price');
      const priceText = priceEl?.textContent || '';
      
      // Shipping - look for shipping info
      const shippingEl = item.querySelector('[class*="shipping"], [class*="delivery"]');
      const shippingText = shippingEl?.textContent || '';
      
      // Full item text for extracting sold date and condition
      const fullText = item.textContent || '';
      
      // Image
      const imgEl = item.querySelector('img[src*="ebayimg"]');
      const imageUrl = imgEl?.getAttribute('src') || '';
      
      // Bids
      const bidsMatch = fullText.match(/(\d+)\s*bid/i);
      const bidsText = bidsMatch ? bidsMatch[0] : '';
      
      return {
        listingId,
        url,
        title,
        priceText,
        shippingText,
        fullText,
        imageUrl,
        bidsText
      };
    });
  });
  
  for (const item of rawItems) {
    try {
      // Skip items without essential data or "Shop on eBay" items
      if (!item.title || item.title.length < 15 || !item.url) continue;
      if (item.title.includes('Shop on eBay')) continue;
      
      // Extract item ID from URL or data attribute
      let itemId = item.listingId;
      if (!itemId || itemId === '2500219655424533') { // Skip the placeholder listing ID
        const urlMatch = item.url.match(/\/itm\/(\d+)/i);
        itemId = urlMatch ? urlMatch[1] : null;
      }
      if (!itemId) continue;
      
      // Parse price
      const price = parsePrice(item.priceText);
      if (!price || price <= 0) continue;
      
      // Parse shipping from full text
      let shippingCost: number | null = null;
      if (item.shippingText.toLowerCase().includes('free') || item.fullText.toLowerCase().includes('free shipping')) {
        shippingCost = 0;
      } else {
        const shippingMatch = item.fullText.match(/\+\$?([\d.]+)\s*shipping/i);
        if (shippingMatch) {
          shippingCost = parseFloat(shippingMatch[1]);
        }
      }
      
      // Parse sold date from full text
      const soldMatch = item.fullText.match(/Sold\s+(\w+\s+\d+)/i);
      let soldDate: string | null = null;
      if (soldMatch) {
        soldDate = parseDate(soldMatch[0]);
      }
      
      // Parse bids
      const bidsMatch = item.bidsText.match(/(\d+)/);
      const bidsCount = bidsMatch ? parseInt(bidsMatch[1]) : null;
      
      // Extract condition from full text
      const conditionMatch = item.fullText.match(/(New|Used|Pre-Owned|Open Box|Refurbished|For Parts)/i);
      const condition = conditionMatch ? conditionMatch[1] : null;
      
      // Clean URL
      let cleanUrl = item.url;
      if (cleanUrl.includes('?')) {
        cleanUrl = cleanUrl.split('?')[0];
      }
      if (!cleanUrl.startsWith('http')) {
        cleanUrl = 'https://www.ebay.com' + cleanUrl;
      }
      
      sales.push({
        ebay_item_id: itemId,
        title: item.title,
        price,
        shipping_cost: shippingCost,
        total_price: price + (shippingCost || 0),
        condition,
        sold_date: soldDate,
        url: cleanUrl,
        image_url: item.imageUrl || null,
        seller: null,
        bids_count: bidsCount,
        buy_it_now: bidsCount === null || bidsCount === 0,
        search_query: searchQuery
      });
      
    } catch (err) {
      // Skip problematic items
      continue;
    }
  }
  
  return sales;
}

export async function scrapeEbaySales(options: EbayScraperOptions): Promise<EbayScraperResult> {
  const {
    searchQuery,
    maxPages = 3,
    minPrice,
    maxPrice,
    dryRun = false,
    headless = true
  } = options;
  
  const result: EbayScraperResult = {
    success: false,
    sales: [],
    stats: {
      pages_scraped: 0,
      total_found: 0,
      total_stored: 0,
      errors: []
    }
  };
  
  let browser: Browser | null = null;
  
  try {
    console.log(`🔍 Scraping eBay for: "${searchQuery}"`);
    console.log(`   Max pages: ${maxPages}, Headless: ${headless}`);
    
    // Launch Firefox (more reliable than Chromium for eBay)
    browser = await firefox.launch({
      headless
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US'
    });
    
    const page = await context.newPage();
    
    // Build search URL for completed/sold items
    let searchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(searchQuery)}&LH_Complete=1&LH_Sold=1&_sop=13`;
    
    // Add price filters if specified
    if (minPrice) searchUrl += `&_udlo=${minPrice}`;
    if (maxPrice) searchUrl += `&_udhi=${maxPrice}`;
    
    // Track seen item IDs to avoid duplicates
    const seenIds = new Set<string>();
    
    // Scrape pages
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const pageUrl = pageNum === 1 ? searchUrl : `${searchUrl}&_pgn=${pageNum}`;
      
      console.log(`\n📄 Scraping page ${pageNum}/${maxPages}`);
      
      try {
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // Random delay to avoid detection
        await randomDelay(2000, 4000);
        
        // Scroll to load lazy images
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await sleep(1000);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await sleep(1000);
        
        // Scrape the page
        const pageSales = await scrapeEbayPage(page, searchQuery);
        
        // Filter out duplicates
        const newSales = pageSales.filter(sale => {
          if (seenIds.has(sale.ebay_item_id)) return false;
          seenIds.add(sale.ebay_item_id);
          return true;
        });
        
        console.log(`   Found ${newSales.length} new sales on page ${pageNum}`);
        
        result.sales.push(...newSales);
        result.stats.pages_scraped++;
        
        // Check if there's a next page
        const nextButton = await page.$('a[aria-label="Go to next search page"], a.pagination__next');
        if (!nextButton && pageNum < maxPages) {
          console.log('   No more pages available');
          break;
        }
        
        // Random delay between pages
        if (pageNum < maxPages) {
          await randomDelay(3000, 6000);
        }
        
      } catch (pageError: any) {
        result.stats.errors.push(`Page ${pageNum}: ${pageError.message}`);
        console.error(`   Error on page ${pageNum}: ${pageError.message}`);
      }
    }
    
    await browser.close();
    browser = null;
    
    result.stats.total_found = result.sales.length;
    console.log(`\n✅ Scraped ${result.stats.total_found} total sales`);
    
    // Store to database
    if (!dryRun && result.sales.length > 0) {
      const supabase = getSupabase();
      
      console.log('\n💾 Storing to database...');
      
      for (const sale of result.sales) {
        const { error } = await supabase
          .from('ebay_sales')
          .upsert({
            ebay_item_id: sale.ebay_item_id,
            title: sale.title,
            price: sale.price,
            shipping_cost: sale.shipping_cost,
            total_price: sale.total_price,
            condition: sale.condition,
            sold_date: sale.sold_date,
            url: sale.url,
            image_url: sale.image_url,
            seller: sale.seller,
            bids_count: sale.bids_count,
            buy_it_now: sale.buy_it_now,
            search_query: sale.search_query,
            scraped_at: new Date().toISOString()
          }, {
            onConflict: 'ebay_item_id'
          });
        
        if (!error) {
          result.stats.total_stored++;
        } else {
          result.stats.errors.push(`DB error for ${sale.ebay_item_id}: ${error.message}`);
        }
      }
      
      console.log(`   Stored ${result.stats.total_stored} sales`);
    } else if (dryRun) {
      console.log('\n⏭️  Dry run - not storing to database');
    }
    
    result.success = true;
    
  } catch (error: any) {
    result.error = error.message;
    result.stats.errors.push(error.message);
    console.error('\n❌ Error:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
  
  return result;
}

// ============================================================================
// CLI
// ============================================================================

function parseCliArgs(): EbayScraperOptions {
  const args = process.argv.slice(2);
  const options: EbayScraperOptions = {
    searchQuery: '',
    maxPages: 3,
    headless: true,
    dryRun: false
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '-s':
      case '--search':
        options.searchQuery = args[++i] || '';
        break;
      case '-p':
      case '--max-pages':
        options.maxPages = parseInt(args[++i]) || 3;
        break;
      case '--min-price':
        options.minPrice = parseFloat(args[++i]);
        break;
      case '--max-price':
        options.maxPrice = parseFloat(args[++i]);
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--visible':
        options.headless = false;
        break;
      case '-h':
      case '--help':
        console.log(`
eBay Sold Listings Scraper (Playwright/Firefox)

Usage:
  npx tsx src/ebay-playwright.ts [options]

Options:
  -s, --search <query>    Search query (required)
  -p, --max-pages <n>     Maximum pages to scrape (default: 3)
  --min-price <n>         Minimum price filter
  --max-price <n>         Maximum price filter
  --dry-run               Don't store to database
  --visible               Run browser visibly (not headless)

Examples:
  npx tsx src/ebay-playwright.ts --search "charizard base set psa 10"
  npx tsx src/ebay-playwright.ts --search "pikachu vmax" --max-pages 5
  npx tsx src/ebay-playwright.ts --search "pokemon booster box" --min-price 100 --max-price 500
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
  
  if (!options.searchQuery) {
    console.error('Error: --search query is required');
    console.error('Use --help for usage information');
    process.exit(1);
  }
  
  const result = await scrapeEbaySales(options);
  
  if (result.success) {
    console.log('\n📊 Results Summary:');
    console.log(`   Pages scraped: ${result.stats.pages_scraped}`);
    console.log(`   Total found: ${result.stats.total_found}`);
    console.log(`   Total stored: ${result.stats.total_stored}`);
    
    if (result.stats.errors.length > 0) {
      console.log(`   Errors: ${result.stats.errors.length}`);
    }
    
    if (result.sales.length > 0) {
      console.log('\n📝 Sample sales:');
      result.sales.slice(0, 5).forEach(sale => {
        const dateStr = sale.sold_date ? ` (${sale.sold_date})` : '';
        console.log(`   • $${sale.total_price.toFixed(2)}${dateStr} - ${sale.title.slice(0, 50)}...`);
      });
    }
  } else {
    console.error('Scraping failed:', result.error);
    process.exit(1);
  }
}

// Run if executed directly
if (process.argv[1]?.includes('ebay-playwright')) {
  main().catch(console.error);
}
