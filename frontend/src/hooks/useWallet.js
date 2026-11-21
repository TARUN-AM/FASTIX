import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserProvider, getAddress } from "ethers";
import {
  getEthereumProvider,
  getWalletNetworkConfig,
  mapWalletError,
  parseChainId,
} from "../utils/ethereum";

function toChecksumSafe(address) {
  if (typeof address !== "string" || !address.trim()) {
    return null;
  }
  try {
    return getAddress(address.trim());
  } catch (_err) {
    return address.trim();
  }
}

/**
 * React hook managing MetaMask connection, network switching, and personal_sign
 * message signing via Ethers v6 BrowserProvider.
 *
 * SECURITY:
 * - Only checks eth_accounts silently on mount (never triggers unsolicited popups).
 * - Uses signer.signMessage (EIP-191 personal_sign) exclusively; never uses eth_sign.
 * - Never handles or stores private keys or seed phrases.
 */
export default function useWallet() {
  const requiredChain = useMemo(() => getWalletNetworkConfig(), []);
  const [provider, setProvider] = useState(() => getEthereumProvider());
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSwitchingChain, setIsSwitchingChain] = useState(false);
  const [error, setError] = useState("");

  const isInstalled = Boolean(provider);
  const isCorrectChain = chainId !== null && chainId === requiredChain.chainId;

  // Detect already-authorized MetaMask account & chain silently on mount (no popup)
  useEffect(() => {
    const activeProvider = getEthereumProvider();
    setProvider(activeProvider);

    if (!activeProvider || typeof activeProvider.request !== "function") {
      return undefined;
    }

    let cancelled = false;

    async function syncInitialWalletState() {
      try {
        const [accounts, rawChainId] = await Promise.all([
          activeProvider.request({ method: "eth_accounts" }),
          activeProvider.request({ method: "eth_chainId" }),
        ]);

        if (cancelled) {
          return;
        }

        const firstAccount =
          Array.isArray(accounts) && accounts.length > 0 ? accounts[0] : null;
        setAccount(toChecksumSafe(firstAccount));
        setChainId(parseChainId(rawChainId));
      } catch (_err) {
        // Silent read failure on initial check should not block page load
      }
    }

    syncInitialWalletState();

    const handleAccountsChanged = (accounts) => {
      const next =
        Array.isArray(accounts) && accounts.length > 0 ? accounts[0] : null;
      setAccount(toChecksumSafe(next));
      setError("");
    };

    const handleChainChanged = (nextChainHex) => {
      setChainId(parseChainId(nextChainHex));
      setError("");
    };

    if (typeof activeProvider.on === "function") {
      activeProvider.on("accountsChanged", handleAccountsChanged);
      activeProvider.on("chainChanged", handleChainChanged);
    }

    return () => {
      cancelled = true;
      if (typeof activeProvider.removeListener === "function") {
        activeProvider.removeListener("accountsChanged", handleAccountsChanged);
        activeProvider.removeListener("chainChanged", handleChainChanged);
      }
    };
  }, []);

  const resetError = useCallback(() => {
    setError("");
  }, []);

  const connect = useCallback(async () => {
    const activeProvider = getEthereumProvider();
    setProvider(activeProvider);

    if (!activeProvider) {
      const msg =
        "MetaMask was not detected in this browser. Install MetaMask to connect your wallet.";
      setError(msg);
      return null;
    }

    setIsConnecting(true);
    setError("");
    try {
      const accounts = await activeProvider.request({
        method: "eth_requestAccounts",
      });
      const rawChainId = await activeProvider.request({
        method: "eth_chainId",
      });

      const firstAccount =
        Array.isArray(accounts) && accounts.length > 0 ? accounts[0] : null;
      const checksummed = toChecksumSafe(firstAccount);
      setAccount(checksummed);
      setChainId(parseChainId(rawChainId));
      return checksummed;
    } catch (err) {
      const friendly = mapWalletError(err);
      setError(friendly);
      return null;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const switchToRequiredChain = useCallback(async () => {
    const activeProvider = getEthereumProvider();
    setProvider(activeProvider);

    if (!activeProvider) {
      setError("MetaMask is not installed in this browser.");
      return false;
    }

    setIsSwitchingChain(true);
    setError("");
    try {
      await activeProvider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: requiredChain.chainIdHex }],
      });
      const rawChainId = await activeProvider.request({
        method: "eth_chainId",
      });
      setChainId(parseChainId(rawChainId));
      return true;
    } catch (err) {
      const code =
        err?.code ?? err?.data?.originalError?.code ?? err?.error?.code;

      if (code === 4902) {
        try {
          await activeProvider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: requiredChain.chainIdHex,
                chainName: requiredChain.chainName,
                rpcUrls: [requiredChain.rpcUrl],
                nativeCurrency: {
                  name: requiredChain.currencySymbol,
                  symbol: requiredChain.currencySymbol,
                  decimals: 18,
                },
              },
            ],
          });
          const rawChainId = await activeProvider.request({
            method: "eth_chainId",
          });
          setChainId(parseChainId(rawChainId));
          return true;
        } catch (addErr) {
          setError(mapWalletError(addErr));
          return false;
        }
      }

      setError(mapWalletError(err));
      return false;
    } finally {
      setIsSwitchingChain(false);
    }
  }, [requiredChain]);

  const signMessage = useCallback(async (message) => {
    const activeProvider = getEthereumProvider();
    if (!activeProvider) {
      throw new Error("MetaMask is not installed in this browser.");
    }
    if (typeof message !== "string" || !message.trim()) {
      throw new Error("Signing message is missing.");
    }

    const browserProvider = new BrowserProvider(activeProvider);
    const signer = await browserProvider.getSigner();
    // Uses EIP-191 personal_sign via Ethers v6 signer.signMessage (never eth_sign)
    return signer.signMessage(message);
  }, []);

  return {
    isInstalled,
    account,
    chainId,
    isCorrectChain,
    requiredChain,
    isConnecting,
    isSwitchingChain,
    error,
    connect,
    switchToRequiredChain,
    signMessage,
    resetError,
  };
}
