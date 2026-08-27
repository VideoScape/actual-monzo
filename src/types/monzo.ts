/**
 * Monzo API Type Definitions
 * Types for Monzo API responses and data structures
 */

/**
 * Monzo Account
 * Represents a Monzo bank account (current account, pot, etc.)
 */
export interface MonzoAccount {
  id: string;
  description: string;
  type: string;
  owners?: Array<{
    user_id: string;
    preferred_name: string;
    preferred_first_name: string;
  }>;
  product_type?: string;
  created?: string;
  closed?: boolean;
  country_code?: string;
  currency?: string;
}

/**
 * A Monzo Pot belonging to a current account.
 */
export interface MonzoPot {
  id: string;
  name: string;
  balance: number;
  currency: string;
  created?: string;
  updated?: string;
  deleted?: boolean;
}

/**
 * Monzo Transaction
 * Represents a single transaction from the Monzo API
 */
export interface MonzoTransaction {
  id: string;
  account_id: string;
  amount: number;
  created: string;
  currency: string;
  description: string;
  merchant?: {
    name: string;
    category: string;
  } | null;
  notes?: string;
  metadata?: Record<string, string>;
  decline_reason?: string;
  settled?: string;
  category?: string;
  local_amount?: number;
  local_currency?: string;
}
