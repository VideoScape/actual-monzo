import type { MonzoAccount } from '../types/monzo.js';

export function getMonzoAccountDisplayName(account: MonzoAccount): string {
  const ownerName = account.owners?.[0]?.preferred_name ?? 'Monzo';

  let accountType: string;
  if (account.type === 'uk_retail_joint') {
    accountType = 'Joint Account';
  } else if (account.type === 'uk_business') {
    accountType = account.description
      ? `Business Account (${account.description})`
      : 'Business Account';
  } else if (account.type === 'uk_rewards' || account.product_type === 'rewards') {
    accountType = 'Rewards';
  } else if (account.product_type === 'flex') {
    accountType = 'Flex';
  } else if (account.type === 'uk_retail') {
    accountType = 'Personal Current Account';
  } else {
    accountType = account.description || account.product_type || account.type || 'Account';
  }

  return `${ownerName} - ${accountType}`;
}
