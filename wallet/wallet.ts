#!/usr/bin/env bun
/**
 * Wallet skill CLI
 * Manages encrypted BIP39 wallets stored at ~/.aibtc/
 *
 * Usage: bun run wallet/wallet.ts <subcommand> [options]
 */

import { Command } from "commander";
import { getWalletManager } from "../src/lib/services/wallet-manager.js";
import { getStxBalance, getHiroApi } from "../src/lib/services/hiro-api.js";
import { getWalletAddress } from "../src/lib/services/x402.service.js";
import { NETWORK } from "../src/lib/config/networks.js";
import type { Network } from "../src/lib/config/networks.js";
import { printJson, handleError } from "../src/lib/utils/cli.js";
import {
  getAddressState,
} from "../src/lib/services/nonce-tracker.js";
import { getNextNonce, transferStx } from "../src/lib/transactions/builder.js";

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("wallet")
  .description("Manage encrypted BIP39 wallets stored at ~/.aibtc/")
  .version("0.1.0");

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

program
  .command("create")
  .description("Create a new wallet with a generated 24-word BIP39 mnemonic")
  .requiredOption("--name <name>", "Label for the wallet (e.g. 'main', 'trading')")
  .requiredOption("--password <password>", "Encryption password (min 8 chars, sensitive)")
  .option("--network <network>", "Network: mainnet or testnet", NETWORK)
  .action(async (opts: { name: string; password: string; network: string }) => {
    try {
      const walletManager = getWalletManager();
      const result = await walletManager.createWallet(
        opts.name,
        opts.password,
        opts.network as Network
      );

      printJson({
        success: true,
        message:
          "Wallet created successfully! Bitcoin L1 (SegWit + Taproot) and Stacks L2 addresses ready.",
        walletId: result.walletId,
        "Bitcoin (L1)": {
          "Native SegWit": `${result.btcAddress} (send/receive BTC)`,
          Taproot: `${result.taprootAddress} (receive inscriptions)`,
        },
        "Stacks (L2)": {
          Address: result.address,
          Tip: "Register a BNS name for on-chain identity",
        },
        network: opts.network,
        "---": "",
        mnemonic: result.mnemonic,
        warning:
          "CRITICAL: Save this mnemonic phrase securely! It will NOT be shown again. " +
          "This is the only way to recover the wallet if the password is forgotten.",
      });
    } catch (error) {
      handleError(error);
    }
  });

// ---------------------------------------------------------------------------
// import
// ---------------------------------------------------------------------------

program
  .command("import")
  .description("Import an existing wallet from a BIP39 mnemonic phrase")
  .requiredOption("--name <name>", "Label for the wallet")
  .requiredOption("--mnemonic <mnemonic>", "24-word BIP39 mnemonic (sensitive)")
  .requiredOption("--password <password>", "Encryption password (min 8 chars, sensitive)")
  .option("--network <network>", "Network: mainnet or testnet", NETWORK)
  .action(
    async (opts: { name: string; mnemonic: string; password: string; network: string }) => {
      try {
        const walletManager = getWalletManager();
        const result = await walletManager.importWallet(
          opts.name,
          opts.mnemonic,
          opts.password,
          opts.network as Network
        );

        printJson({
          success: true,
          message:
            "Wallet imported successfully! Bitcoin L1 (SegWit + Taproot) and Stacks L2 addresses ready.",
          walletId: result.walletId,
          "Bitcoin (L1)": {
            "Native SegWit": `${result.btcAddress} (send/receive BTC)`,
            Taproot: `${result.taprootAddress} (receive inscriptions)`,
          },
          "Stacks (L2)": {
            Address: result.address,
            Tip: "Register a BNS name for on-chain identity",
          },
          network: opts.network,
        });
      } catch (error) {
        handleError(error);
      }
    }
  );

// ---------------------------------------------------------------------------
// unlock
// ---------------------------------------------------------------------------

program
  .command("unlock")
  .description("Unlock a wallet to enable transactions")
  .requiredOption("--password <password>", "Wallet password (sensitive)")
  .option("--wallet-id <walletId>", "Wallet ID to unlock (uses active wallet if omitted)")
  .action(async (opts: { password: string; walletId?: string }) => {
    try {
      const walletManager = getWalletManager();

      const targetWalletId =
        opts.walletId ?? (await walletManager.getActiveWalletId());
      if (!targetWalletId) {
        handleError(
          new Error(
            "No active wallet found. Create or import a wallet first, or specify --wallet-id."
          )
        );
        return;
      }

      const account = await walletManager.unlock(targetWalletId, opts.password);

      printJson({
        success: true,
        message:
          "Wallet unlocked successfully! Bitcoin L1 (SegWit + Taproot) and Stacks L2 transactions enabled.",
        walletId: targetWalletId,
        "Bitcoin (L1)": {
          "Native SegWit": `${account.btcAddress} (send/receive BTC)`,
          Taproot: `${account.taprootAddress} (receive inscriptions)`,
        },
        "Stacks (L2)": {
          Address: account.address,
          Tip: "Register a BNS name for on-chain identity",
        },
        network: account.network,
      });
    } catch (error) {
      handleError(error);
    }
  });

// ---------------------------------------------------------------------------
// lock
// ---------------------------------------------------------------------------

program
  .command("lock")
  .description("Lock the wallet, clearing sensitive key material from memory")
  .action(() => {
    try {
      const walletManager = getWalletManager();
      const wasUnlocked = walletManager.isUnlocked();
      walletManager.lock();

      printJson({
        success: true,
        message: wasUnlocked
          ? "Wallet is now locked. Unlock again to perform transactions."
          : "Wallet was already locked.",
      });
    } catch (error) {
      handleError(error);
    }
  });

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

program
  .command("list")
  .description("List all available wallets with metadata")
  .action(async () => {
    try {
      const walletManager = getWalletManager();
      const wallets = await walletManager.listWallets();
      const activeWalletId = await walletManager.getActiveWalletId();
      const sessionInfo = walletManager.getSessionInfo();

      if (wallets.length === 0) {
        printJson({
          message: "No wallets found. Use the create subcommand to create one.",
          wallets: [],
          totalCount: 0,
        });
        return;
      }

      printJson({
        message: `${wallets.length} wallet(s) available.`,
        wallets: wallets.map((w) => ({
          id: w.id,
          name: w.name,
          btcAddress: w.btcAddress,
          address: w.address,
          network: w.network,
          createdAt: w.createdAt,
          lastUsed: w.lastUsed,
          isActive: w.id === activeWalletId,
          isUnlocked: sessionInfo?.walletId === w.id,
        })),
        totalCount: wallets.length,
      });
    } catch (error) {
      handleError(error);
    }
  });

// ---------------------------------------------------------------------------
// switch
// ---------------------------------------------------------------------------

program
  .command("switch")
  .description("Switch the active wallet (requires unlock after switching)")
  .requiredOption("--wallet-id <walletId>", "Wallet ID to activate")
  .action(async (opts: { walletId: string }) => {
    try {
      const walletManager = getWalletManager();
      await walletManager.switchWallet(opts.walletId);

      const wallets = await walletManager.listWallets();
      const wallet = wallets.find((w) => w.id === opts.walletId);

      printJson({
        success: true,
        message: "Switched wallet. Use the unlock subcommand to unlock it for transactions.",
        activeWalletId: opts.walletId,
        btcAddress: wallet?.btcAddress,
        address: wallet?.address,
        network: wallet?.network,
      });
    } catch (error) {
      handleError(error);
    }
  });

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

program
  .command("delete")
  .description("Permanently delete a wallet (requires password + confirmation)")
  .requiredOption("--wallet-id <walletId>", "Wallet ID to delete")
  .requiredOption("--password <password>", "Wallet password for verification (sensitive)")
  .requiredOption("--confirm <confirm>", "Must be exactly: DELETE")
  .action(async (opts: { walletId: string; password: string; confirm: string }) => {
    try {
      if (opts.confirm !== "DELETE") {
        handleError(new Error("Confirmation required: set --confirm to exactly 'DELETE'"));
      }

      const walletManager = getWalletManager();

      const wallets = await walletManager.listWallets();
      const wallet = wallets.find((w) => w.id === opts.walletId);

      await walletManager.deleteWallet(opts.walletId, opts.password);

      printJson({
        success: true,
        message: "Wallet deleted permanently.",
        deletedWalletId: opts.walletId,
        deletedBtcAddress: wallet?.btcAddress,
        deletedAddress: wallet?.address,
      });
    } catch (error) {
      handleError(error);
    }
  });

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

program
  .command("export")
  .description("Export the mnemonic phrase for a wallet (sensitive!)")
  .requiredOption("--password <password>", "Wallet password (sensitive)")
  .requiredOption("--confirm <confirm>", "Must be exactly: I_UNDERSTAND_THE_RISKS")
  .option("--wallet-id <walletId>", "Wallet ID to export (uses active wallet if omitted)")
  .action(async (opts: { password: string; confirm: string; walletId?: string }) => {
    try {
      if (opts.confirm !== "I_UNDERSTAND_THE_RISKS") {
        handleError(
          new Error(
            "Confirmation required: set --confirm to exactly 'I_UNDERSTAND_THE_RISKS'"
          )
        );
      }

      const walletManager = getWalletManager();

      const targetWalletId =
        opts.walletId ?? (await walletManager.getActiveWalletId());
      if (!targetWalletId) {
        handleError(new Error("No active wallet found. Specify --wallet-id."));
        return;
      }

      const mnemonic = await walletManager.exportMnemonic(targetWalletId, opts.password);

      printJson({
        walletId: targetWalletId,
        mnemonic,
        warning:
          "SECURITY WARNING: This mnemonic provides full access to your wallet. " +
          "Store it securely and never share it with anyone.",
      });
    } catch (error) {
      handleError(error);
    }
  });

// ---------------------------------------------------------------------------
// rotate-password
// ---------------------------------------------------------------------------

program
  .command("rotate-password")
  .description(
    "Change the wallet encryption password (atomic with backup/verify/rollback)"
  )
  .requiredOption("--old-password <oldPassword>", "Current wallet password (sensitive)")
  .requiredOption(
    "--new-password <newPassword>",
    "New password (min 8 chars, sensitive)"
  )
  .option(
    "--wallet-id <walletId>",
    "Wallet ID to rotate password for (uses active wallet if omitted)"
  )
  .action(
    async (opts: { oldPassword: string; newPassword: string; walletId?: string }) => {
      try {
        const walletManager = getWalletManager();

        const targetWalletId =
          opts.walletId ?? (await walletManager.getActiveWalletId());
        if (!targetWalletId) {
          handleError(new Error("No active wallet found. Specify --wallet-id."));
          return;
        }

        await walletManager.rotatePassword(
          targetWalletId,
          opts.oldPassword,
          opts.newPassword
        );

        printJson({
          success: true,
          message:
            "Password rotated successfully. The wallet has been locked — use unlock with the new password.",
          walletId: targetWalletId,
        });
      } catch (error) {
        handleError(error);
      }
    }
  );

// ---------------------------------------------------------------------------
// set-timeout
// ---------------------------------------------------------------------------

program
  .command("set-timeout")
  .description("Set the auto-lock timeout in minutes (0 = never auto-lock)")
  .requiredOption("--minutes <minutes>", "Minutes until auto-lock (0 = disabled)")
  .action(async (opts: { minutes: string }) => {
    try {
      const minutes = parseInt(opts.minutes, 10);
      if (isNaN(minutes) || minutes < 0) {
        handleError(new Error("--minutes must be a non-negative integer"));
      }

      const walletManager = getWalletManager();
      await walletManager.setAutoLockTimeout(minutes);

      const message =
        minutes === 0
          ? "Auto-lock disabled. Wallet will stay unlocked until manually locked."
          : `Auto-lock set to ${minutes} minutes.`;

      printJson({
        success: true,
        message,
        autoLockMinutes: minutes,
      });
    } catch (error) {
      handleError(error);
    }
  });

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

program
  .command("status")
  .description(
    "Get wallet readiness status: whether a wallet exists, is active, and is unlocked"
  )
  .action(async () => {
    try {
      const walletManager = getWalletManager();
      const sessionInfo = walletManager.getSessionInfo();
      const activeWalletId = await walletManager.getActiveWalletId();
      const hasWallets = await walletManager.hasWallets();
      const hasMnemonic = !!process.env.CLIENT_MNEMONIC;

      let readyForTransactions = false;
      let message: string;
      let nextAction: string | undefined;

      if (sessionInfo) {
        readyForTransactions = true;
        message = "Wallet is unlocked and ready for transactions.";
      } else if (hasMnemonic) {
        readyForTransactions = true;
        message = "Wallet configured via CLIENT_MNEMONIC environment variable and ready for transactions.";
      } else if (hasWallets) {
        message = "Wallet is locked. Use the unlock subcommand to enable transactions.";
        nextAction = "Run: bun run wallet/wallet.ts unlock --password <password>";
      } else {
        message =
          "No wallet found. Create or import a wallet to get started.";
        nextAction =
          "Run: bun run wallet/wallet.ts create --name main --password <password>";
      }

      let activeWallet = null;
      if (activeWalletId) {
        const wallets = await walletManager.listWallets();
        const wallet = wallets.find((w) => w.id === activeWalletId);
        if (wallet) {
          activeWallet = {
            id: wallet.id,
            name: wallet.name,
            btcAddress: wallet.btcAddress,
            address: wallet.address,
            network: wallet.network,
          };
        }
      }

      const response: Record<string, unknown> = {
        message,
        readyForTransactions,
        isUnlocked: !!sessionInfo,
        currentNetwork: NETWORK,
      };

      if (sessionInfo) {
        response.wallet = {
          id: sessionInfo.walletId,
          btcAddress: sessionInfo.btcAddress,
          address: sessionInfo.address,
          sessionExpiresAt: sessionInfo.expiresAt?.toISOString() ?? "never",
        };
      } else if (activeWallet) {
        response.wallet = activeWallet;
      }

      if (hasWallets && !sessionInfo && !hasMnemonic) {
        const wallets = await walletManager.listWallets();
        response.availableWallets = wallets.map((w) => ({
          id: w.id,
          name: w.name,
          btcAddress: w.btcAddress,
          address: w.address,
        }));
      }

      if (nextAction) {
        response.nextAction = nextAction;
      }

      printJson(response);
    } catch (error) {
      handleError(error);
    }
  });

// ---------------------------------------------------------------------------
// info
// ---------------------------------------------------------------------------

program
  .command("info")
  .description("Get the active wallet address and session info")
  .action(async () => {
    try {
      const walletManager = getWalletManager();
      const hasWallets = await walletManager.hasWallets();
      const sessionInfo = walletManager.getSessionInfo();

      try {
        const address = await getWalletAddress();
        const btcAddress = sessionInfo?.btcAddress;
        const taprootAddress = sessionInfo?.taprootAddress;

        const response: Record<string, unknown> = {
          status: "ready",
          message: btcAddress
            ? "Wallet ready. Bitcoin L1 (SegWit + Taproot) and Stacks L2 transactions enabled."
            : "Wallet ready. Stacks L2 transactions enabled.",
          network: NETWORK,
        };

        if (btcAddress && taprootAddress) {
          response["Bitcoin (L1)"] = {
            "Native SegWit": `${btcAddress} (send/receive BTC)`,
            Taproot: `${taprootAddress} (receive inscriptions)`,
          };
        }

        response["Stacks (L2)"] = {
          Address: address,
          Tip: "Register a BNS name for on-chain identity",
        };

        printJson(response);
      } catch {
        if (hasWallets) {
          const wallets = await walletManager.listWallets();
          printJson({
            status: "locked",
            message: "Wallet exists but is locked. Use the unlock subcommand.",
            wallets: wallets.map((w) => ({
              id: w.id,
              name: w.name,
              "Bitcoin (L1)": {
                "Native SegWit": w.btcAddress,
                Taproot: w.taprootAddress,
              },
              "Stacks (L2)": w.address,
              network: w.network,
            })),
            network: NETWORK,
            hint: "Run: bun run wallet/wallet.ts unlock --password <password>",
          });
        } else {
          printJson({
            status: "no_wallet",
            message: "No wallet found. Create or import one.",
            network: NETWORK,
            options: [
              {
                action: "create",
                description: "Create a new wallet (generates a secure 24-word mnemonic)",
              },
              {
                action: "import",
                description: "Import an existing wallet",
              },
            ],
            hint: "Run: bun run wallet/wallet.ts create --name main --password <password>",
          });
        }
      }
    } catch (error) {
      handleError(error);
    }
  });

// ---------------------------------------------------------------------------
// stx-balance
// ---------------------------------------------------------------------------

program
  .command("stx-balance")
  .description("Get the STX balance for a wallet address")
  .option("--address <address>", "Stacks address to check (uses active wallet if omitted)")
  .action(async (opts: { address?: string }) => {
    try {
      let walletAddress = opts.address;
      if (!walletAddress) {
        walletAddress = await getWalletAddress();
      }

      const balance = await getStxBalance(walletAddress, NETWORK);

      const stxBalance = (BigInt(balance.stx) / BigInt(1000000)).toString();
      const stxLocked = (BigInt(balance.stxLocked) / BigInt(1000000)).toString();

      printJson({
        address: walletAddress,
        network: NETWORK,
        balance: {
          stx: stxBalance + " STX",
          microStx: balance.stx,
        },
        locked: {
          stx: stxLocked + " STX",
          microStx: balance.stxLocked,
        },
      });
    } catch (error) {
      handleError(error);
    }
  });

// ---------------------------------------------------------------------------
// nonce-health
// ---------------------------------------------------------------------------

program
  .command("nonce-health")
  .description("Compare local nonce tracker state vs chain and diagnose gaps")
  .option("--address <address>", "Stacks address to check (uses active wallet if omitted)")
  .action(async (opts: { address?: string }) => {
    try {
      let address = opts.address;
      if (!address) {
        address = await getWalletAddress();
      }
      const localState = await getAddressState(address);
      const hiroApi = getHiroApi(NETWORK);
      const nonceInfo = await hiroApi.getNonceInfo(address);
      const isStale = localState
        ? Date.now() - new Date(localState.lastUpdated).getTime() > 90 * 1000
        : true;
      const issues: string[] = [];
      if (!localState) issues.push("No local nonce state — will sync from chain on next tx");
      if (isStale) issues.push("Local state is stale (>90s old) — will re-sync from chain");
      if (nonceInfo.detected_missing_nonces.length > 0) {
        issues.push(`Detected missing nonces: [${nonceInfo.detected_missing_nonces.join(", ")}] — use nonce-fill-gap to resolve`);
      }
      printJson({
        address,
        local: localState
          ? {
              lastUsedNonce: localState.lastUsedNonce,
              lastUpdated: localState.lastUpdated,
              pendingCount: localState.pending.length,
              isStale,
            }
          : null,
        chain: {
          possibleNextNonce: nonceInfo.possible_next_nonce,
          lastExecutedNonce: nonceInfo.last_executed_tx_nonce,
          lastMempoolNonce: nonceInfo.last_mempool_tx_nonce,
          missingNonces: nonceInfo.detected_missing_nonces,
          mempoolNonces: nonceInfo.mempool_nonces,
        },
        healthy: issues.length === 0,
        issues,
      });
    } catch (error) {
      handleError(error);
    }
  });

// ---------------------------------------------------------------------------
// nonce-fill-gap
// ---------------------------------------------------------------------------

// Standard gap-fill target (not self — Stacks rejects self-transfers).
// cant-be-evil.stx resolves to SP000000000000000000002Q6VF78 (Stacks burn address).
const GAP_FILL_TARGET = "SP000000000000000000002Q6VF78";

program
  .command("nonce-fill-gap")
  .description(
    "Send 1 uSTX at a specific nonce to unblock a stuck queue. Last-resort tool — Nakamoto blocks (3-5s) usually self-resolve gaps."
  )
  .requiredOption("--nonce <nonce>", "The missing nonce to fill (integer)")
  .option("--wallet <name>", "Wallet name (uses active wallet if omitted)")
  .option("--password <password>", "Wallet password (prompts if omitted)")
  .action(async (opts: { nonce: string; wallet?: string; password?: string }) => {
    try {
      const gapNonce = parseInt(opts.nonce, 10);
      if (isNaN(gapNonce) || gapNonce < 0) {
        throw new Error("--nonce must be a non-negative integer");
      }
      const walletManager = getWalletManager();
      const unlockedWallet = walletManager.getUnlockedWallet();
      if (!unlockedWallet) {
        throw new Error("No wallet unlocked. Run: wallet unlock --name <name> --password <pass>");
      }
      const result = await transferStx(
        unlockedWallet,
        GAP_FILL_TARGET,
        1n, // 1 uSTX
        "nonce-gap-fill",
        undefined, // auto-estimate fee
        BigInt(gapNonce) // explicit nonce override
      );
      printJson({
        success: true,
        message: `Gap-fill sent at nonce ${gapNonce}`,
        txid: result.txid,
        target: GAP_FILL_TARGET,
        amount: "1 uSTX",
        nonce: gapNonce,
      });
    } catch (error) {
      handleError(error);
    }
  });

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

program.parse(process.argv);
