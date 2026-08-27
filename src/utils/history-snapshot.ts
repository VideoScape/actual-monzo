import { chmod, readFile, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { getAppDirectory } from './config-manager.js';
import type { HistorySnapshot } from '../types/history-snapshot.js';

function validateSnapshot(value: unknown): asserts value is HistorySnapshot {
  if (!value || typeof value !== 'object') {
    throw new Error('History snapshot must contain a JSON object');
  }
  const snapshot = value as Partial<HistorySnapshot>;
  if (
    snapshot.formatVersion !== 1 ||
    typeof snapshot.capturedAt !== 'string' ||
    typeof snapshot.start !== 'string' ||
    typeof snapshot.end !== 'string' ||
    !snapshot.transactionsByAccount ||
    typeof snapshot.transactionsByAccount !== 'object' ||
    !Object.values(snapshot.transactionsByAccount).every(Array.isArray)
  ) {
    throw new Error('Unsupported or malformed Monzo history snapshot');
  }
}

export async function saveHistorySnapshot(snapshot: HistorySnapshot): Promise<string> {
  const directory = await getAppDirectory();
  const timestamp = snapshot.capturedAt.replace(/[:.]/g, '-');
  const snapshotPath = path.join(directory, `monzo-history-${timestamp}.json`);
  await writeFile(snapshotPath, JSON.stringify(snapshot), {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  await chmod(snapshotPath, 0o600);
  return snapshotPath;
}

export async function loadHistorySnapshot(snapshotPath: string): Promise<HistorySnapshot> {
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as unknown;
  validateSnapshot(snapshot);
  return snapshot;
}

export async function removeHistorySnapshot(snapshotPath: string): Promise<void> {
  await unlink(snapshotPath);
}
