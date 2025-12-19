/**
 * Utility functions for parsing and handling composite card IDs
 * Format: ${productId}_${variantId}
 * 
 * This supports the new frontend variant tracking system where each variant
 * (Normal, Holofoil, Reverse Holofoil) has a unique ID to prevent quantity
 * cross-contamination.
 */

export interface ParsedCardId {
  productId: number;
  variantId: number;
  isComposite: boolean;
}

/**
 * Parse a card ID string that may be in composite format (productId_variantId)
 * or legacy format (just productId).
 * 
 * @param cardId - String in format "620618_3" or "620618"
 * @returns ParsedCardId with productId, variantId, and isComposite flag
 * 
 * @example
 * parseCardId("620618_3") // { productId: 620618, variantId: 3, isComposite: true }
 * parseCardId("620618")   // { productId: 620618, variantId: 1, isComposite: false }
 */
export function parseCardId(cardId: string | number): ParsedCardId {
  // Handle numeric input
  if (typeof cardId === 'number') {
    return {
      productId: cardId,
      variantId: 1, // Default to Normal variant
      isComposite: false
    };
  }

  // Handle string input
  const cardIdStr = String(cardId).trim();
  
  // Check for composite format (contains underscore)
  if (cardIdStr.includes('_')) {
    const parts = cardIdStr.split('_');
    
    if (parts.length !== 2) {
      throw new Error(`Invalid composite card ID format: ${cardIdStr}. Expected format: productId_variantId`);
    }

    const productId = parseInt(parts[0], 10);
    const variantId = parseInt(parts[1], 10);

    if (isNaN(productId) || isNaN(variantId)) {
      throw new Error(`Invalid composite card ID: ${cardIdStr}. Both parts must be numeric.`);
    }

    if (productId <= 0 || variantId <= 0) {
      throw new Error(`Invalid composite card ID: ${cardIdStr}. IDs must be positive integers.`);
    }

    return {
      productId,
      variantId,
      isComposite: true
    };
  }

  // Legacy format (just product ID)
  const productId = parseInt(cardIdStr, 10);
  
  if (isNaN(productId)) {
    throw new Error(`Invalid card ID: ${cardIdStr}. Must be numeric or in format productId_variantId.`);
  }

  if (productId <= 0) {
    throw new Error(`Invalid card ID: ${cardIdStr}. ID must be a positive integer.`);
  }

  return {
    productId,
    variantId: 1, // Default to Normal variant (ID 1)
    isComposite: false
  };
}

/**
 * Create a composite card ID string from product ID and variant ID
 * 
 * @param productId - TCGPlayer product ID
 * @param variantId - Card variant ID (1=Normal, 3=Reverse Holofoil, etc.)
 * @returns Composite ID string in format "productId_variantId"
 * 
 * @example
 * createCompositeId(620618, 3) // "620618_3"
 */
export function createCompositeId(productId: number, variantId: number): string {
  if (!Number.isInteger(productId) || productId <= 0) {
    throw new Error(`Invalid productId: ${productId}. Must be a positive integer.`);
  }
  
  if (!Number.isInteger(variantId) || variantId <= 0) {
    throw new Error(`Invalid variantId: ${variantId}. Must be a positive integer.`);
  }

  return `${productId}_${variantId}`;
}

/**
 * Validate that a card ID is in the correct format
 * 
 * @param cardId - Card ID to validate
 * @returns true if valid, false otherwise
 */
export function isValidCardId(cardId: string | number): boolean {
  try {
    parseCardId(cardId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract product IDs from an array of card IDs (which may be composite)
 * This is useful for batch queries where you need all unique product IDs
 * 
 * @param cardIds - Array of card IDs (may be composite or simple)
 * @returns Array of unique product IDs
 * 
 * @example
 * extractProductIds(["620618_3", "620618_1", "91614"]) // [620618, 91614]
 */
export function extractProductIds(cardIds: (string | number)[]): number[] {
  const productIds = new Set<number>();
  
  for (const cardId of cardIds) {
    try {
      const parsed = parseCardId(cardId);
      productIds.add(parsed.productId);
    } catch {
      // Skip invalid IDs
      continue;
    }
  }
  
  return Array.from(productIds);
}
