#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { createSetupCommand } from './setup.js';
import { importCommand } from './import.js';
import { mapAccountsCommand } from './map-accounts.js';
import { mapPotsCommand } from './map-pots.js';
import { captureHistoryCommand } from './capture-history.js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Main CLI entry point using Commander.js
 */
async function createCLI(): Promise<Command> {
  const program = new Command();

  // Load package.json for version info
  let packageJson: { name?: string; version?: string; description?: string } = {};
  try {
    const packagePath = join(__dirname, '../package.json');
    const packageContent = await readFile(packagePath, 'utf8');
    packageJson = JSON.parse(packageContent);
  } catch (error) {
    // Fallback if package.json can't be read
    packageJson = {
      name: 'actual-monzo',
      version: '0.6.0-pot.4',
      description: 'CLI tool to import Monzo transactions into Actual Budget',
    };
  }

  // Configure main program
  program
    .name(packageJson.name ?? 'actual-monzo')
    .version(packageJson.version ?? '0.6.0-pot.4')
    .description(
      packageJson.description ?? 'CLI tool to import Monzo transactions into Actual Budget'
    )
    .configureHelp({
      sortSubcommands: true,
      subcommandTerm: cmd => cmd.name(),
    })
    .configureOutput({
      writeOut: str => process.stdout.write(chalk.cyan(str)),
      writeErr: str => process.stderr.write(chalk.red(str)),
    });

  // Add global options
  program
    .option('-v, --verbose', 'enable verbose logging', false)
    .option('-q, --quiet', 'suppress non-essential output', false)
    .option('--no-color', 'disable colored output')
    .option('--config <path>', 'path to configuration file');

  // Add setup command
  const setupCommand = createSetupCommand();
  program.addCommand(setupCommand);

  // Add account mapping command
  program.addCommand(mapAccountsCommand);

  // Add Monzo Pot mapping command
  program.addCommand(mapPotsCommand);

  // Add time-sensitive complete-history capture command
  program.addCommand(captureHistoryCommand);

  // Add import command
  program.addCommand(importCommand);

  // Error handling for unknown commands
  program.on('command:*', args => {
    console.error(chalk.red(`Unknown command: ${args[0]}`));
    console.log('Available commands:');
    program.commands.forEach(cmd => {
      console.log(`  ${chalk.cyan(cmd.name())} - ${cmd.description()}`);
    });
    process.exit(1);
  });

  return program;
}

/**
 * Main CLI execution function
 */
export async function main(argv?: string[]): Promise<void> {
  try {
    const program = await createCLI();

    // Parse command line arguments
    await program.parseAsync(argv ?? process.argv);
  } catch (error) {
    console.error(chalk.red('CLI Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Handle global error events
 */
process.on('uncaughtException', error => {
  console.error(chalk.red('Uncaught Exception:'), error.message);
  process.exit(1);
});

process.on('unhandledRejection', reason => {
  console.error(chalk.red('Unhandled Rejection:'), reason);
  process.exit(1);
});
