/**
 * MetaMask / EIP-1193 provider detection, local network config, and friendly error mapping.
 * Never requests or handles private keys or seed phrases.
 */

const DEFAULT_CHAIN_ID = 31337;
const DEFAULT_CHAIN_NAME = "FairTicket Local (Hardhat)";
const DEFAULT_RPC_URL = "http://127.0.0.1:8545";
const DEFAULT_CURRENCY_SYMBOL = "ETH";

/**
 * Returns the injected MetaMask EIP-1193 provider when available.
 * When multiple browser wallet extensions are installed, prefers MetaMask from
 * window.ethereum.providers before falling back to window.ethereum.
 */
export function getEthereumProvider() {
  if (typeof window === "undefined" || !window.ethereum) {
    return null;
  }

  const { ethereum } = window;
  if (Array.isArray(ethereum.providers) && ethereum.providers.length > 0) {
    const metamaskExact = ethereum.providers.find(
      (provider) => provider?.isMetaMask && !provider?.isBraveWallet
    );
    if (metamaskExact) {
      return metamaskExact;
    }
    const metamaskAny = ethereum.providers.find(
      (provider) => provider?.isMetaMask
    );
    if (metamaskAny) {
      return metamaskAny;
    }
    return ethereum.providers[0];
  }

  return ethereum;
}

/**
 * Reads required Ethereum network settings from Vite env vars with safe local defaults.
 */
export function getWalletNetworkConfig() {
  const rawChainId = import.meta.env.VITE_CHAIN_ID;
  const parsedChainId = Number.parseInt(String(rawChainId || ""), 10);
  const chainId =
    Number.isSafeInteger(parsedChainId) && parsedChainId > 0
      ? parsedChainId
      : DEFAULT_CHAIN_ID;

  const chainName =
    (import.meta.env.VITE_CHAIN_NAME || "").trim() || DEFAULT_CHAIN_NAME;
  const rpcUrl = (import.meta.env.VITE_RPC_URL || "").trim() || DEFAULT_RPC_URL;
  const currencySymbol =
    (import.meta.env.VITE_CURRENCY_SYMBOL || "").trim() ||
    DEFAULT_CURRENCY_SYMBOL;

  return {
    chainId,
    chainIdHex: `0x${chainId.toString(16)}`,
    chainName,
    rpcUrl,
    currencySymbol,
  };
}

/**
 * Parses an EIP-1193 hex or decimal chain ID into a positive integer, or null.
 */
export function parseChainId(rawChainId) {
  if (typeof rawChainId === "number" && Number.isSafeInteger(rawChainId)) {
    return rawChainId;
  }
  if (typeof rawChainId === "bigint") {
    return Number(rawChainId);
  }
  if (typeof rawChainId === "string" && rawChainId.trim()) {
    const trimmed = rawChainId.trim();
    const parsed = trimmed.startsWith("0x")
      ? Number.parseInt(trimmed, 16)
      : Number.parseInt(trimmed, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Masks an Ethereum wallet address for compact display (e.g. 0x1234...abcd).
 */
export function formatShortAddress(address) {
  if (typeof address !== "string") {
    return "";
  }
  const trimmed = address.trim();
  if (trimmed.length <= 10) {
    return trimmed;
  }
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

/**
 * Maps EIP-1193, MetaMask, and Ethers v6 errors to calm, user-friendly messages.
 */
export function mapWalletError(err) {
  const code =
    err?.code ??
    err?.info?.error?.code ??
    err?.error?.code ??
    err?.data?.originalError?.code;

  if (code === 4001 || code === "ACTION_REJECTED") {
    return "You cancelled the MetaMask request. You can try again whenever you are ready.";
  }

  if (code === -32002) {
    return "A MetaMask request is already waiting for your approval. Please open your MetaMask extension window.";
  }

  if (code === 4902) {
    return "This network has not been added to MetaMask yet. Please approve adding the network in MetaMask.";
  }

  if (code === -32603) {
    return "MetaMask encountered a local network error. Make sure your local Hardhat node is running or try again.";
  }

  if (typeof err?.shortMessage === "string" && err.shortMessage.trim()) {
    return err.shortMessage.trim();
  }

  if (typeof err?.message === "string" && err.message.trim()) {
    return err.message.trim();
  }

  return "Unable to complete the MetaMask action. Please check your wallet extension and try again.";
}
