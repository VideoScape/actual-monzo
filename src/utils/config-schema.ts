/**
 * Zod schema definitions for config validation
 * Provides runtime validation with type inference
 */

import { z } from 'zod';

// Account Mapping Schema
export const AccountMappingSchema = z.object({
  monzoAccountId: z
    .string()
    .regex(/^acc_[a-zA-Z0-9]{16,}$/, 'Monzo account ID must match format acc_XXXXXXXX...'),

  monzoAccountName: z.string().min(1, 'Monzo account name cannot be empty'),

  actualAccountId: z.string().uuid('Actual Budget account ID must be valid UUID'),

  actualAccountName: z.string().min(1, 'Actual Budget account name cannot be empty'),
});

export const PotMappingSchema = z.object({
  monzoPotId: z.string().regex(/^pot_[a-zA-Z0-9]+$/, 'Monzo Pot ID must match format pot_...'),
  monzoPotName: z.string().min(1, 'Monzo Pot name cannot be empty'),
  monzoAccountId: z
    .string()
    .regex(/^acc_[a-zA-Z0-9]{16,}$/, 'Monzo account ID must match format acc_XXXXXXXX...'),
  actualAccountId: z.string().uuid('Actual Budget account ID must be valid UUID'),
  actualAccountName: z.string().min(1, 'Actual Budget account name cannot be empty'),
  deleted: z.boolean().optional(),
  balanceInitializedAt: z
    .string()
    .datetime({ message: 'balanceInitializedAt must be ISO 8601 format' })
    .optional(),
});

// Import history removed from config - now stored in logs/
// Schemas kept for backward compatibility during migration

// Monzo Configuration Schema
export const MonzoConfigSchema = z
  .object({
    clientId: z
      .string()
      .startsWith('oauth2client_', 'Client ID must start with oauth2client_')
      .min(20, 'Client ID appears invalid (too short)'),

    clientSecret: z
      .string()
      .regex(/^mnz(conf|pub)/, 'Client secret must start with mnzconf or mnzpub')
      .min(20, 'Client secret appears invalid (too short)'),

    accessToken: z.string().min(20).optional(),

    refreshToken: z.string().min(20).optional(),

    tokenExpiresAt: z
      .string()
      .datetime({ message: 'tokenExpiresAt must be ISO 8601 format' })
      .optional(),

    authorizedAt: z
      .string()
      .datetime({ message: 'authorizedAt must be ISO 8601 format' })
      .optional(),
  })
  .refine(
    data => {
      // If accessToken exists, refreshToken, tokenExpiresAt and authorizedAt must also exist
      if (data.accessToken) {
        return data.refreshToken && data.tokenExpiresAt && data.authorizedAt;
      }
      return true;
    },
    {
      message:
        'If accessToken is set, refreshToken, tokenExpiresAt, and authorizedAt must also be set',
      path: ['accessToken'],
    }
  );

// Actual Budget Configuration Schema
export const ActualBudgetConfigSchema = z.object({
  serverUrl: z
    .string()
    .url('Server URL must be valid HTTP/HTTPS URL')
    .regex(/^https?:\/\//, 'Server URL must start with http:// or https://')
    .refine(url => !url.endsWith('/'), 'Server URL should not end with trailing slash'),

  password: z.string().min(1, 'Password cannot be empty'),

  dataDirectory: z.string().min(1, 'Data directory cannot be empty'),

  budgetId: z.string().min(1, 'Budget ID cannot be empty').optional(),

  validatedAt: z.string().datetime({ message: 'validatedAt must be ISO 8601 format' }).optional(),
});

// Root Configuration Schema
export const ConfigSchema = z.object({
  configVersion: z.string().default('1.0.0').optional(),

  monzo: MonzoConfigSchema,

  actualBudget: ActualBudgetConfigSchema,

  setupCompletedAt: z
    .string()
    .datetime({ message: 'setupCompletedAt must be ISO 8601 format' })
    .optional(),

  accountMappings: z.array(AccountMappingSchema).optional(),

  potMappings: z.array(PotMappingSchema).optional(),
});

// TypeScript type inference
export type Config = z.infer<typeof ConfigSchema>;
export type MonzoConfig = z.infer<typeof MonzoConfigSchema>;
export type ActualBudgetConfig = z.infer<typeof ActualBudgetConfigSchema>;
export type AccountMapping = z.infer<typeof AccountMappingSchema>;
export type PotMapping = z.infer<typeof PotMappingSchema>;
