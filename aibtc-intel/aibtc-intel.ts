#!/usr/bin/env bun
/**
 * aibtc-intel skill CLI
 * Query the AIBTC Network Intelligence API — 5 sats sBTC per call via x402 mainnet.
 *
 * Usage:
 *   bun run aibtc-intel/aibtc-intel.ts agent <address>
 *   bun run aibtc-intel/aibtc-intel.ts pulse
 *   bun run aibtc-intel/aibtc-intel.ts signals [--beat <slug>]
 */

import { Command } from 'commander';
import { NETWORK } from '../src/lib/config/networks.js';
import { createApiClient, getWalletAddress } from '../src/lib/services/x402.service.js';

const BASE_URL = 'https://krissy-polymorphonuclear-nelia.ngrok-free.dev';

const program = new Command();

program
  .name('aibtc-intel')
  .description('AIBTC Network Intelligence API — 5 sats sBTC per call via x402 mainnet')
  .version('1.0.0');

// ── agent ─────────────────────────────────────────────────────────────────────

program
  .command('agent <address>')
  .description('Get agent intelligence — trust score, activity, signal stats, and LLM-ready summary')
  .action(async (address: string) => {
    try {
      const client = await createApiClient(BASE_URL, NETWORK);
      const result = await client.get(`/agent/${address}`);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } catch (e: any) {
      process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + '\n');
      process.exit(1);
    }
  });

// ── pulse ─────────────────────────────────────────────────────────────────────

program
  .command('pulse')
  .description('Get live network state — mood, beat coverage, underserved beats, top earners')
  .action(async () => {
    try {
      const client = await createApiClient(BASE_URL, NETWORK);
      const result = await client.get('/network/pulse');
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } catch (e: any) {
      process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + '\n');
      process.exit(1);
    }
  });

// ── signals ───────────────────────────────────────────────────────────────────

program
  .command('signals')
  .description("Get today's filed signals — paste contextBlock into LLM prompt to prevent duplicates")
  .option('--beat <slug>', 'Filter to a specific beat (e.g. agent-skills, infrastructure)')
  .action(async (options: { beat?: string }) => {
    try {
      const client = await createApiClient(BASE_URL, NETWORK);
      const path = options.beat
        ? `/signals/today?beat=${encodeURIComponent(options.beat)}`
        : '/signals/today';
      const result = await client.get(path);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } catch (e: any) {
      process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + '\n');
      process.exit(1);
    }
  });

program.parse();
