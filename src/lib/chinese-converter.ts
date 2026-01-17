import { Converter } from 'opencc-js';

// Create converter: Simplified Chinese → Traditional Chinese (Taiwan)
const converter = Converter({ from: 'cn', to: 'twp' });

/**
 * Convert Simplified Chinese text to Traditional Chinese (Taiwan variant)
 * Used for matching user input against game data which uses Traditional Chinese
 */
export function simplifiedToTraditional(text: string): string {
  if (!text) return text;
  return converter(text);
}

/**
 * Normalize search input by converting to Traditional Chinese
 * Returns both original and converted text for flexible matching
 */
export function normalizeSearchInput(input: string): {
  original: string;
  traditional: string;
  isConverted: boolean;
} {
  if (!input) {
    return { original: '', traditional: '', isConverted: false };
  }

  const traditional = simplifiedToTraditional(input.trim());
  const isConverted = traditional !== input.trim();

  return {
    original: input.trim(),
    traditional,
    isConverted,
  };
}

/**
 * Check if text contains Simplified Chinese characters
 * Useful for detecting if conversion is needed
 */
export function containsSimplifiedChinese(text: string): boolean {
  if (!text) return false;
  const converted = simplifiedToTraditional(text);
  return converted !== text;
}
