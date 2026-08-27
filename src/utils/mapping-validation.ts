import type { AccountMapping, PotMapping } from '../types/import.js';

interface ActualAccountReference {
  id: string;
  name: string;
  closed?: boolean;
}

export function validateActualMappings(
  actualAccounts: ActualAccountReference[],
  accountMappings: AccountMapping[],
  potMappings: PotMapping[]
): void {
  const openAccountIds = new Set(
    actualAccounts.filter(account => !account.closed).map(account => account.id)
  );
  const staleAccounts = accountMappings.filter(
    mapping => !openAccountIds.has(mapping.actualAccountId)
  );
  const stalePots = potMappings.filter(mapping => !openAccountIds.has(mapping.actualAccountId));

  if (!staleAccounts.length && !stalePots.length) {
    return;
  }

  const details = [
    ...staleAccounts.map(
      mapping => `Monzo account "${mapping.monzoAccountName}" → "${mapping.actualAccountName}"`
    ),
    ...stalePots.map(
      mapping => `Monzo Pot "${mapping.monzoPotName}" → "${mapping.actualAccountName}"`
    ),
  ];

  throw new Error(
    `Saved mapping points to a missing or closed Actual account:\n${details
      .map(detail => `  - ${detail}`)
      .join('\n')}\nRun actual-monzo map-accounts and actual-monzo map-pots before importing.`
  );
}
