import type { MonzoTransaction } from './monzo.js';

export interface HistorySnapshot {
  formatVersion: 1;
  capturedAt: string;
  start: string;
  end: string;
  transactionsByAccount: Record<string, MonzoTransaction[]>;
}
