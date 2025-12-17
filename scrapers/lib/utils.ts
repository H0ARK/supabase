/**
 * Shared Supabase client and utilities for scrapers
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// Load environment variables
config();

// Singleton Supabase client
let supabaseClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
    }

    supabaseClient = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return supabaseClient;
}

/**
 * Utility to sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      const delay = baseDelay * Math.pow(2, i);
      console.warn(`Attempt ${i + 1} failed, retrying in ${delay}ms:`, error);
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Parse price from text (handles $1,234.56 format)
 */
export function parsePrice(priceText: string): number {
  if (!priceText) return 0;

  // Remove currency symbols and commas
  const cleaned = priceText.replace(/[$,£€¥]/g, '');
  // Extract first number (handles ranges)
  const match = cleaned.match(/(\d+(?:\.\d{2})?)/);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * Generate random delay with jitter for rate limiting
 */
export function randomDelay(baseMs: number, jitterMs: number = 500): number {
  return baseMs + Math.random() * jitterMs;
}

/**
 * Rotate through user agents for web scraping
 */
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

let userAgentIndex = 0;

export function getNextUserAgent(): string {
  const ua = USER_AGENTS[userAgentIndex];
  userAgentIndex = (userAgentIndex + 1) % USER_AGENTS.length;
  return ua;
}

/**
 * Standard headers for web requests
 */
export function getHeaders(): Record<string, string> {
  return {
    'User-Agent': getNextUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
  };
}

/**
 * Extract TCGPlayer product ID from various identifier formats
 */
export function extractProductId(identifier: string | number): number | null {
  if (typeof identifier === 'number') return identifier;
  
  // Handle URLs like https://www.tcgplayer.com/product/12345
  const urlMatch = identifier.match(/\/product\/(\d+)/);
  if (urlMatch) return parseInt(urlMatch[1]);
  
  // Handle plain numbers
  const numMatch = identifier.match(/^(\d+)$/);
  if (numMatch) return parseInt(numMatch[1]);
  
  return null;
}

/**
 * Normalize card condition strings
 */
export function normalizeCondition(condition: string): string {
  const conditionMap: Record<string, string> = {
    'near mint': 'Near Mint',
    'nm': 'Near Mint',
    'mint': 'Near Mint',
    'm': 'Near Mint',
    'lightly played': 'Lightly Played',
    'lp': 'Lightly Played',
    'excellent': 'Lightly Played',
    'moderately played': 'Moderately Played',
    'mp': 'Moderately Played',
    'good': 'Moderately Played',
    'heavily played': 'Heavily Played',
    'hp': 'Heavily Played',
    'damaged': 'Damaged',
    'poor': 'Damaged',
    'd': 'Damaged',
  };

  const lower = condition.toLowerCase().trim();
  return conditionMap[lower] || condition;
}

/**
 * Parse grading info from title
 */
export function parseGradingInfo(title: string): { service: string | null; grade: number | null } {
  const gradingPatterns = [
    { pattern: /PSA\s*(\d+(?:\.\d)?)/i, service: 'PSA' },
    { pattern: /BGS\s*(\d+(?:\.\d)?)/i, service: 'BGS' },
    { pattern: /CGC\s*(\d+(?:\.\d)?)/i, service: 'CGC' },
    { pattern: /SGC\s*(\d+(?:\.\d)?)/i, service: 'SGC' },
  ];

  for (const { pattern, service } of gradingPatterns) {
    const match = title.match(pattern);
    if (match) {
      return {
        service,
        grade: parseFloat(match[1]),
      };
    }
  }

  return { service: null, grade: null };
}
