import { useEffect, useState } from "react";
import { getAddress } from "ethers";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Lock,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import useWallet from "../../hooks/useWallet";
import {
  requestWalletChallenge,
  verifyWalletSignature,
} from "../../services/verificationApi";
import { formatShortAddress, mapWalletError } from "../../utils/ethereum";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CountdownDisplay,
  Spinner,
  useToast,
} from "../ui";

function safeChecksum(address) {
  if (typeof address !== "string" || !address.trim()) {
    return "";
  }
  try {
    return getAddress(address.trim());
  } catch (_err) {
    return address.trim();
  }
}

function formatLinkedTimestamp(isoString) {
  if (!isoString) {
    return "";
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function mapBackendWalletError(err) {
  const code = err?.code;
  const details = err?.details || {};

  if (code === "WALLET_ALREADY_LINKED") {
    return {
      variant: "danger",
      title: "Wallet already in use",
      message:
        "This wallet is already linked to another FairTicket account. Switch to a different MetaMask account and try again.",
    };
  }

  if (code === "ACCOUNT_ALREADY_HAS_WALLET") {
    return {
      variant: "info",
      title: "Wallet already linked",
      message: "Your FairTicket account already has a linked wallet.",
    };
  }

  if (code === "WALLET_SIGNATURE_INVALID") {
    const remaining =
      typeof details.attemptsRemaining === "number"
        ? ` (${details.attemptsRemaining} ${
            details.attemptsRemaining === 1 ? "attempt" : "attempts"
          } remaining)`
        : "";
    return {
      variant: "danger",
      title: "Signature did not match",
      message: `The wallet signature could not be verified${remaining}. Make sure you sign with the connected MetaMask account.`,
    };
  }

  if (code === "WALLET_CHALLENGE_EXPIRED") {
    return {
      variant: "warning",
      title: "Signing message expired",
      message:
        "This signing message has expired or was already used. Request a new message to continue.",
    };
  }

  if (code === "WALLET_CHALLENGE_LOCKED") {
    return {
      variant: "warning",
      title: "Too many failed attempts",
      message:
        "Too many failed verification attempts were made on this message. Request a new signing message to try again.",
    };
  }

  if (code === "WALLET_CHALLENGE_MISMATCH") {
    return {
      variant: "warning",
      title: "MetaMask account changed",
      message:
        "Your active MetaMask account does not match the signing message. Request a fresh message for the current account.",
    };
  }

  if (code === "WALLET_CHALLENGE_LIMIT" || code === "RATE_LIMITED") {
    return {
      variant: "warning",
      title: "Too many requests",
      message:
        err?.message ||
        "You have made too many wallet verification requests. Please wait a few minutes before trying again.",
    };
  }

  return {
    variant: "danger",
    title: "Wallet verification failed",
    message:
      err?.message ||
      "Unable to verify your wallet signature right now. Please try again.",
  };
}

export default function WalletStep({
  identityVerified = false,
  walletLinked = false,
  walletAddress = null,
  walletLinkedAt = null,
  onLinked = null,
  refreshUser = null,
}) {
  const { addToast } = useToast();
  const {
    isInstalled,
    account,
    chainId,
    isCorrectChain,
    requiredChain,
    isConnecting,
    isSwitchingChain,
    error: walletHookError,
    connect,
    switchToRequiredChain,
    signMessage,
    resetError,
  } = useWallet();

  const [challenge, setChallenge] = useState(null);
  const [expiresSeconds, setExpiresSeconds] = useState(0);
  const [requestingChallenge, setRequestingChallenge] = useState(false);
  const [signingAndVerifying, setSigningAndVerifying] = useState(false);
  const [signingPhase, setSigningPhase] = useState("");
  const [banner, setBanner] = useState(null);

  // Display-only 1-second tick for challenge expiration countdown.
  // The backend enforces the real expiration timestamp.
  useEffect(() => {
    if (expiresSeconds <= 0) {
      return undefined;
    }
    const timer = setInterval(() => {
      setExpiresSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresSeconds > 0]);

  // Discard any pending challenge immediately if the user switches accounts in MetaMask
  useEffect(() => {
    if (!challenge) {
      return;
    }
    const challengeAddr = challenge.walletAddress?.toLowerCase();
    const activeAddr = account?.toLowerCase();
    if (!activeAddr || (challengeAddr && activeAddr !== challengeAddr)) {
      setChallenge(null);
      setExpiresSeconds(0);
      setBanner({
        variant: "info",
        title: "MetaMask account changed",
        message:
          "Your selected MetaMask account changed. Request a new signing message for the active account to continue.",
      });
    }
  }, [account, challenge]);

  // Locked state until identity verification is complete
  if (!identityVerified && !walletLinked) {
    return (
      <Card className="bg-slate-50/70">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-slate-600">
            <Lock className="h-4 w-4" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-700">
              Step 3: Connect Wallet
            </h2>
          </div>
          <Badge tone="neutral">Locked</Badge>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-slate-600">
            Verify your identity first to unlock MetaMask wallet authentication.
          </p>
        </CardBody>
      </Card>
    );
  }

  // Linked state (Step 3 complete)
  if (walletLinked && walletAddress) {
    const checksumLinked = safeChecksum(walletAddress);
    const linkedTimeLabel = formatLinkedTimestamp(walletLinkedAt);
    const isMetaMaskMismatch =
      Boolean(account) &&
      account.toLowerCase() !== walletAddress.toLowerCase();

    return (
      <Card className="border-green-200 bg-white">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2
              className="h-5 w-5 text-success"
              aria-hidden="true"
            />
            <h2 className="text-base font-semibold text-navy">
              Step 3: Connect Wallet
            </h2>
          </div>
          <Badge tone="success">Wallet linked</Badge>
        </CardHeader>

        <CardBody className="space-y-4">
          <div className="rounded-lg border border-green-200 bg-green-50/70 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-600">
              Linked MetaMask wallet
            </p>
            <p
              className="mt-1 break-all font-mono text-sm font-semibold text-navy"
              title={checksumLinked}
            >
              {checksumLinked}
            </p>
            {linkedTimeLabel && (
              <p className="mt-1.5 text-xs text-slate-600">
                Linked on {linkedTimeLabel}
              </p>
            )}
          </div>

          {isMetaMaskMismatch && (
            <Alert
              variant="warning"
              title="Switch to your linked wallet in MetaMask before booking"
            >
              MetaMask is currently connected to{" "}
              <span className="font-mono font-semibold">
                {formatShortAddress(account)}
              </span>
              , but your FairTicket account is linked to{" "}
              <span className="font-mono font-semibold">
                {formatShortAddress(checksumLinked)}
              </span>
              . Switch to your linked wallet in MetaMask before booking or
              reselling tickets.
            </Alert>
          )}
        </CardBody>
      </Card>
    );
  }

  async function handleRequestChallenge() {
    if (!account) {
      return;
    }
    resetError();
    setBanner(null);
    setRequestingChallenge(true);

    try {
      const data = await requestWalletChallenge(account);
      setChallenge(data);

      const ttlSeconds =
        typeof data?.expiresInSeconds === "number" && data.expiresInSeconds > 0
          ? data.expiresInSeconds
          : 300;
      setExpiresSeconds(ttlSeconds);
    } catch (err) {
      setBanner(mapBackendWalletError(err));
    } finally {
      setRequestingChallenge(false);
    }
  }

  async function handleSignAndVerify() {
    if (!challenge || !account) {
      return;
    }
    resetError();
    setBanner(null);

    // Client-side UX sanity check before prompting MetaMask.
    // The backend is the real security authority and rebuilds/validates the message independently.
    const expectedHost =
      typeof window !== "undefined" ? window.location.host : "";
    const checksumAccount = safeChecksum(account);
    const messageText = String(challenge.message || "");

    const hasAccount = messageText.includes(checksumAccount);
    const hasChainId = messageText.includes(`Chain ID: ${requiredChain.chainId}`);
    const hasDomain = !expectedHost || messageText.includes(expectedHost);

    if (!hasAccount || !hasChainId || !hasDomain) {
      setBanner({
        variant: "warning",
        title: "Signing message mismatch",
        message:
          "The signing message did not match your connected wallet, network, or site domain. Request a fresh signing message before signing.",
      });
      return;
    }

    setSigningAndVerifying(true);
    setSigningPhase("Waiting for MetaMask signature...");

    let signature;
    try {
      signature = await signMessage(messageText);
    } catch (signErr) {
      setSigningAndVerifying(false);
      setSigningPhase("");
      setBanner({
        variant: "warning",
        title: "Signature not completed",
        message: mapWalletError(signErr),
      });
      return;
    }

    setSigningPhase("Verifying wallet signature...");
    try {
      const result = await verifyWalletSignature({
        walletAddress: checksumAccount,
        signature,
      });

      setChallenge(null);
      setExpiresSeconds(0);
      addToast({
        variant: "success",
        title: "Wallet linked",
        description: `MetaMask wallet ${formatShortAddress(
          checksumAccount
        )} is now linked to your account.`,
      });

      if (typeof onLinked === "function") {
        onLinked(result);
      }
      if (typeof refreshUser === "function") {
        await refreshUser();
      }
    } catch (verifyErr) {
      const mapped = mapBackendWalletError(verifyErr);
      setBanner(mapped);
      if (
        verifyErr?.code === "WALLET_CHALLENGE_EXPIRED" ||
        verifyErr?.code === "WALLET_CHALLENGE_LOCKED" ||
        verifyErr?.code === "WALLET_CHALLENGE_MISMATCH"
      ) {
        setChallenge(null);
        setExpiresSeconds(0);
      }
    } finally {
      setSigningAndVerifying(false);
      setSigningPhase("");
    }
  }

  const isChallengeExpired = Boolean(challenge) && expiresSeconds === 0;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-navy" aria-hidden="true" />
          <h2 className="text-base font-semibold text-navy">
            Step 3: Connect Wallet
          </h2>
        </div>
        <Badge tone="info">Required for booking</Badge>
      </CardHeader>

      <CardBody className="space-y-5">
        <p className="text-sm text-slate-600">
          Connect your MetaMask wallet and sign a free one-time message to prove
          you control this address. One wallet can be linked to one verified
          FairTicket account.
        </p>

        {walletHookError && (
          <Alert variant="warning" title="MetaMask notice">
            {walletHookError}
          </Alert>
        )}

        {banner && (
          <Alert variant={banner.variant} title={banner.title}>
            {banner.message}
          </Alert>
        )}

        {/* State 1: MetaMask not installed */}
        {!isInstalled && (
          <div className="space-y-4 rounded-lg border border-slate-200 bg-offwhite p-4">
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-navy">
                MetaMask browser extension not detected
              </p>
              <p className="text-xs leading-relaxed text-slate-600">
                Install MetaMask in your browser to link a wallet to your
                FairTicket account. If you are running a local demo, open this
                page in a Chrome, Firefox, or Brave profile with the MetaMask
                extension enabled.
              </p>
            </div>
            <div>
              <a
                href="https://metamask.io/download"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy/90"
              >
                <span>Install MetaMask</span>
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          </div>
        )}

        {/* State 2: Installed, not connected */}
        {isInstalled && !account && (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-offwhite p-4">
            <p className="text-sm text-slate-700">
              Click below to choose the MetaMask account you want to link to
              FairTicket.
            </p>
            <Button
              variant="primary"
              onClick={connect}
              loading={isConnecting}
              leftIcon={<Wallet className="h-4 w-4" />}
            >
              Connect MetaMask
            </Button>
          </div>
        )}

        {/* State 3: Connected, wrong network */}
        {isInstalled && account && !isCorrectChain && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-offwhite p-3.5">
              <p className="text-xs font-medium text-slate-500">
                Connected MetaMask account
              </p>
              <p className="mt-0.5 break-all font-mono text-sm font-semibold text-navy">
                {account}
              </p>
            </div>

            <Alert
              variant="warning"
              title={`Switch MetaMask to ${requiredChain.chainName}`}
            >
              <p>
                MetaMask is currently connected to Chain ID{" "}
                <span className="font-mono font-semibold">
                  {chainId ?? "unknown"}
                </span>
                , but FairTicket requires{" "}
                <span className="font-semibold">{requiredChain.chainName}</span>{" "}
                (Chain ID{" "}
                <span className="font-mono font-semibold">
                  {requiredChain.chainId}
                </span>
                ).
              </p>
              <div className="mt-3">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={switchToRequiredChain}
                  loading={isSwitchingChain}
                >
                  Switch network
                </Button>
              </div>
            </Alert>
          </div>
        )}

        {/* State 4 & 5: Connected on correct network -> Request / Review / Sign */}
        {isInstalled && account && isCorrectChain && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-offwhite px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">
                  Connected MetaMask account
                </p>
                <p className="mt-0.5 break-all font-mono text-sm font-semibold text-navy">
                  {account}
                </p>
              </div>
              <Badge tone="success">{requiredChain.chainName}</Badge>
            </div>

            {!challenge ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  onClick={handleRequestChallenge}
                  loading={requestingChallenge}
                  leftIcon={<ShieldCheck className="h-4 w-4" />}
                >
                  Get signing message
                </Button>
              </div>
            ) : (
              <div className="space-y-4 rounded-lg border border-sky/40 bg-skylight/25 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-navy">
                    What you are signing
                  </h3>
                  <CountdownDisplay
                    remainingSeconds={expiresSeconds}
                    label="Signing message expires in"
                  />
                </div>

                {/* Read-only plain text only; never use dangerouslySetInnerHTML */}
                <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-3.5 font-mono text-xs leading-relaxed text-slate-800">
                  {challenge.message}
                </pre>

                <ul className="space-y-1.5 text-xs text-slate-700">
                  <li className="flex items-start gap-2">
                    <CheckCircle2
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success"
                      aria-hidden="true"
                    />
                    <span>No gas fee — signing this message is completely free.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success"
                      aria-hidden="true"
                    />
                    <span>
                      Cannot move money or give anyone permission to spend your
                      assets.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success"
                      aria-hidden="true"
                    />
                    <span>Only proves you own this MetaMask wallet.</span>
                  </li>
                </ul>

                {signingAndVerifying && (
                  <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-navy">
                    <Spinner size="sm" label={signingPhase || "Signing"} />
                    <span>{signingPhase || "Waiting for MetaMask..."}</span>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  {!isChallengeExpired ? (
                    <>
                      <Button
                        variant="primary"
                        onClick={handleSignAndVerify}
                        loading={signingAndVerifying}
                        disabled={requestingChallenge}
                        leftIcon={<Wallet className="h-4 w-4" />}
                      >
                        Sign with MetaMask
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleRequestChallenge}
                        loading={requestingChallenge}
                        disabled={signingAndVerifying}
                        leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                      >
                        Get a new message
                      </Button>
                    </>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs font-medium text-warning">
                        This message has expired.
                      </span>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleRequestChallenge}
                        loading={requestingChallenge}
                        leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                      >
                        Get a new message
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Demo local test network helper box */}
        <details className="rounded-lg border border-slate-200 bg-offwhite px-4 py-3 text-xs text-slate-600">
          <summary className="cursor-pointer font-semibold text-navy">
            Demo: local test network settings
          </summary>
          <div className="mt-3 space-y-2">
            <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Network name</dt>
                <dd className="font-mono font-medium text-navy">
                  {requiredChain.chainName}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Chain ID</dt>
                <dd className="font-mono font-medium text-navy">
                  {requiredChain.chainId}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">RPC URL</dt>
                <dd className="font-mono font-medium text-navy">
                  {requiredChain.rpcUrl}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Currency symbol</dt>
                <dd className="font-mono font-medium text-navy">
                  {requiredChain.currencySymbol}
                </dd>
              </div>
            </dl>
            <p className="flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 p-2 text-amber-900">
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
              <span>
                Local Hardhat demo accounts use publicly known test keys. Never
                send real ETH or real funds to any local Hardhat test address.
              </span>
            </p>
          </div>
        </details>
      </CardBody>
    </Card>
  );
}
