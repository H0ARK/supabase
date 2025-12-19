/**
 * Utility functions for handling composite card IDs
 * Format: {productId}_{variantId}
 * Example: "620618_3" represents product 620618, variant 3 (Reverse Holofoil)
 */

export interface ParsedCardId {
  productId: number;
  variantId: number;
}

/**
 * Creates a composite ID from product ID and variant ID
 * @param productId - The TCGPlayer product ID
 * @param variantId - The card variant ID (1=Normal, 2=Holofoil, 3=Reverse Holofoil, etc.)
 * @returns Composite ID string in format "productId_variantId"
 */
export function createCompositeId(productId: number, variantId: number): string {
  return `${productId}_${variantId}`;
}

/**
 * Parses a composite ID string into its component parts
 * @param compositeId - The composite ID string (e.g., "620618_3")
 * @returns Object with productId and variantId as numbers
 * @throws Error if the ID format is invalid
 */
export function parseCompositeId(compositeId: string): ParsedCardId {
  if (!compositeId || typeof compositeId !== 'string') {
    throw new Error('Invalid composite ID: must be a non-empty string');
  }

  const parts = compositeId.split('_');
  
  if (parts.length !== 2) {
    throw new Error(`Invalid composite ID format: "${compositeId}". Expected format: "productId_variantId"`);
  }

  const productId = parseInt(parts[0], 10);
  const variantId = parseInt(parts[1], 10);

  if (isNaN(productId) || isNaN(variantId)) {
    throw new Error(`Invalid composite ID: "${compositeId}". Both parts must be valid integers`);
  }

  if (productId <= 0 || variantId <= 0) {
    throw new Error(`Invalid composite ID: "${compositeId}". Both productId and variantId must be positive integers`);
  }

  return { productId, variantId };
}

/**
 * Validates whether a string is a valid composite ID
 * @param compositeId - The string to validate
 * @returns true if valid, false otherwise
 */
export function isValidCompositeId(compositeId: string): boolean {
  try {
    parseCompositeId(compositeId);
    return true;
  } catch {
    return false;
  }
}
