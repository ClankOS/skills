import {
  makeSTXTokenTransfer,
  makeContractCall,
  makeContractDeploy,
  broadcastTransaction,
  ClarityValue,
  PostConditionMode,
  PostCondition,
} from "@stacks/transactions";
import { hexToBytes } from "@stacks/common";
import { getStacksNetwork, getApiBaseUrl, type Network } from "../config/networks.js";
import type { WalletAddresses } from "../utils/storage.js";
import { getHiroApi } from "../services/hiro-api.js";
import {
  getTrackedNonce,
  recordNonceUsed,
  resetTrackedNonce,
  reconcileWithChain,
} from "../services/nonce-tracker.js";

// ---------------------------------------------------------------------------
// Nonce tracking (unified via SharedNonceTracker, skills#240)
//
// All nonce state is managed by src/lib/services/nonce-tracker.ts which
// persists to ~/.aibtc/nonce-state.json. Shared with MCP server
// (aibtcdev/aibtc-mcp-server).
// ---------------------------------------------------------------------------

/**
 * Reset the pending nonce for an address (called on wallet unlock/lock/switch
 * so the counter re-syncs with the chain on the next transaction).
 */
export async function resetPendingNonce(address: string): Promise<void> {
  await resetTrackedNonce(address);
}

/**
 * Get the next nonce for an address.
 *
 * Algorithm:
 * 1. Check the shared nonce tracker (no network call).
 * 2. Fetch possible_next_nonce from Hiro and reconcile.
 * 3. Return max(chain, local) for strictly increasing nonces during rapid sends.
 */
export async function getNextNonce(address: string, network: Network): Promise<bigint> {
  const localNext = await getTrackedNonce(address);
  try {
    const hiroApi = getHiroApi(network);
    const nonceInfo = await hiroApi.getNonceInfo(address);
    const networkNext = BigInt(nonceInfo.possible_next_nonce);
    await reconcileWithChain(address, nonceInfo.possible_next_nonce);
    if (nonceInfo.detected_missing_nonces && nonceInfo.detected_missing_nonces.length > 0) {
      console.warn(
        `[nonce] detected_missing_nonces for ${address}: [${nonceInfo.detected_missing_nonces.join(", ")}]. ` +
          `Use 'wallet nonce-fill-gap --nonce <N>' to resolve.`
      );
    }
    const localNextBig = localNext !== null ? BigInt(localNext) : 0n;
    return networkNext > localNextBig ? networkNext : localNextBig;
  } catch (err) {
    if (localNext !== null && localNext > 0) {
      console.warn(`[nonce] API call failed, using local tracked nonce (${localNext}) for ${address}:`, err);
      return BigInt(localNext);
    }
    throw err;
  }
}

/**
 * Record that a nonce was used (fire-and-forget, non-blocking).
 */
export function advancePendingNonce(address: string, nonce: bigint, txid = ""): void {
  recordNonceUsed(address, Number(nonce), txid).catch((err) => {
    console.error(`[nonce] Failed to record nonce ${nonce} for ${address}:`, err);
  });
}

export interface Account extends WalletAddresses {
  privateKey: string;
  /**
   * Bitcoin private key as raw bytes (32 bytes) for signing BTC transactions.
   * SECURITY: Never serialize to WIF/hex. Only held in memory during session.
   */
  btcPrivateKey?: Uint8Array;
  /**
   * Bitcoin public key as raw bytes (33 bytes compressed) for building transactions.
   */
  btcPublicKey?: Uint8Array;
  /**
   * Taproot private key as raw bytes (32 bytes) for signing Taproot transactions.
   * SECURITY: Never serialize. Only held in memory during session.
   */
  taprootPrivateKey?: Uint8Array;
  /**
   * Taproot internal public key as raw bytes (32 bytes, x-only) for building Taproot transactions.
   */
  taprootPublicKey?: Uint8Array;
  /**
   * Nostr NIP-06 private key as raw bytes (32 bytes), derived at m/44'/1237'/0'/0/0.
   * SECURITY: Never serialize. Only held in memory during session.
   */
  nostrPrivateKey?: Uint8Array;
  /**
   * Nostr NIP-06 x-only public key as raw bytes (32 bytes).
   * Used as the Nostr pubkey for NIP-06 identity.
   */
  nostrPublicKey?: Uint8Array;
  network: Network;
}

export interface TransferResult {
  txid: string;
  rawTx: string;
}

export interface ContractCallOptions {
  contractAddress: string;
  contractName: string;
  functionName: string;
  functionArgs: ClarityValue[];
  postConditionMode?: PostConditionMode;
  postConditions?: PostCondition[];
  /** Optional fee in micro-STX. If omitted, fee is auto-estimated. */
  fee?: bigint;
}

export interface ContractDeployOptions {
  contractName: string;
  codeBody: string;
  /** Optional fee in micro-STX. If omitted, fee is auto-estimated. */
  fee?: bigint;
}

/**
 * Transfer STX tokens to a recipient
 * @param fee Optional fee in micro-STX. If omitted, fee is auto-estimated.
 * @param explicitNonce Optional nonce override (used by nonce-fill-gap to target a specific nonce).
 */
export async function transferStx(
  account: Account,
  recipient: string,
  amount: bigint,
  memo?: string,
  fee?: bigint,
  explicitNonce?: bigint
): Promise<TransferResult> {
  const networkName = getStacksNetwork(account.network);

  const nonce = explicitNonce !== undefined ? explicitNonce : await getNextNonce(account.address, account.network);

  const transaction = await makeSTXTokenTransfer({
    recipient,
    amount,
    senderKey: account.privateKey,
    network: networkName,
    memo: memo || "",
    nonce,
    ...(fee !== undefined && { fee }),
  });

  const broadcastResponse = await broadcastTransaction({
    transaction,
    network: networkName,
  });

  if ("error" in broadcastResponse) {
    throw new Error(
      `Broadcast failed: ${broadcastResponse.error} - ${broadcastResponse.reason}`
    );
  }

  advancePendingNonce(account.address, nonce, broadcastResponse.txid);

  return {
    txid: broadcastResponse.txid,
    rawTx: transaction.serialize(),
  };
}

/**
 * Call a smart contract function
 */
export async function callContract(
  account: Account,
  options: ContractCallOptions
): Promise<TransferResult> {
  const networkName = getStacksNetwork(account.network);

  const nonce = await getNextNonce(account.address, account.network);

  const transaction = await makeContractCall({
    contractAddress: options.contractAddress,
    contractName: options.contractName,
    functionName: options.functionName,
    functionArgs: options.functionArgs,
    senderKey: account.privateKey,
    network: networkName,
    nonce,
    postConditionMode: options.postConditionMode || PostConditionMode.Deny,
    postConditions: options.postConditions || [],
    ...(options.fee !== undefined && { fee: options.fee }),
  });

  const broadcastResponse = await broadcastTransaction({
    transaction,
    network: networkName,
  });

  if ("error" in broadcastResponse) {
    throw new Error(
      `Broadcast failed: ${broadcastResponse.error} - ${broadcastResponse.reason}`
    );
  }

  advancePendingNonce(account.address, nonce, broadcastResponse.txid);

  return {
    txid: broadcastResponse.txid,
    rawTx: transaction.serialize(),
  };
}

/**
 * Deploy a smart contract
 */
export async function deployContract(
  account: Account,
  options: ContractDeployOptions
): Promise<TransferResult> {
  const networkName = getStacksNetwork(account.network);

  const nonce = await getNextNonce(account.address, account.network);

  const transaction = await makeContractDeploy({
    contractName: options.contractName,
    codeBody: options.codeBody,
    senderKey: account.privateKey,
    network: networkName,
    nonce,
    ...(options.fee !== undefined && { fee: options.fee }),
  });

  const broadcastResponse = await broadcastTransaction({
    transaction,
    network: networkName,
  });

  if ("error" in broadcastResponse) {
    throw new Error(
      `Broadcast failed: ${broadcastResponse.error} - ${broadcastResponse.reason}`
    );
  }

  advancePendingNonce(account.address, nonce, broadcastResponse.txid);

  return {
    txid: broadcastResponse.txid,
    rawTx: transaction.serialize(),
  };
}

/**
 * Sign a transaction without broadcasting (for offline signing)
 */
export async function signStxTransfer(
  account: Account,
  recipient: string,
  amount: bigint,
  memo?: string,
  fee?: bigint
): Promise<{ signedTx: string; txid: string }> {
  const networkName = getStacksNetwork(account.network);

  const transaction = await makeSTXTokenTransfer({
    recipient,
    amount,
    senderKey: account.privateKey,
    network: networkName,
    memo: memo || "",
    ...(fee !== undefined && { fee }),
  });

  return {
    signedTx: transaction.serialize(),
    txid: transaction.txid(),
  };
}

/**
 * Sign a contract call without broadcasting
 */
export async function signContractCall(
  account: Account,
  options: ContractCallOptions
): Promise<{ signedTx: string; txid: string }> {
  const networkName = getStacksNetwork(account.network);

  const transaction = await makeContractCall({
    contractAddress: options.contractAddress,
    contractName: options.contractName,
    functionName: options.functionName,
    functionArgs: options.functionArgs,
    senderKey: account.privateKey,
    network: networkName,
    postConditionMode: options.postConditionMode || PostConditionMode.Deny,
    postConditions: options.postConditions || [],
    ...(options.fee !== undefined && { fee: options.fee }),
  });

  return {
    signedTx: transaction.serialize(),
    txid: transaction.txid(),
  };
}

/**
 * Broadcast a pre-signed transaction
 */
export async function broadcastSignedTransaction(
  signedTx: string,
  network: Network
): Promise<{ txid: string }> {
  const baseUrl = getApiBaseUrl(network);
  const txBytes = Buffer.from(hexToBytes(signedTx));

  const response = await fetch(`${baseUrl}/v2/transactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
    },
    body: txBytes,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Broadcast failed: ${response.statusText} - ${errorText}`);
  }

  const txid = await response.text();
  return { txid: txid.replace(/"/g, "") };
}

export * from "./sponsor-builder.js";
