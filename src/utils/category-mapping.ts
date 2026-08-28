import type { CategoryMapping } from '../types/import.js';

export const MONZO_TRANSACTION_CATEGORIES = [
  'bills',
  'cash',
  'eating_out',
  'entertainment',
  'expenses',
  'family',
  'general',
  'gifts',
  'groceries',
  'holidays',
  'income',
  'personal_care',
  'shopping',
  'transport',
] as const;

/**
 * Monzo's generic `transfers` category is intentionally omitted. Money movement
 * must not be turned into spending merely because its counter-account is unknown.
 */
export function buildCategoryMapping(
  mappings: readonly CategoryMapping[] = []
): ReadonlyMap<string, string> {
  return new Map(mappings.map(mapping => [mapping.monzoCategory, mapping.actualCategoryId]));
}

export function getMonzoCategoryFromNotes(notes?: string | null): string | undefined {
  const match = notes?.match(/^Monzo:\s*([^|]+?)\s*\|\s*ID:/);
  return match?.[1]?.trim();
}

export function isImporterOpeningBalance(notes?: string | null): boolean {
  return ['One-time balance reconciliation', 'One-time balance adjustment'].some(prefix =>
    notes?.startsWith(prefix)
  );
}
