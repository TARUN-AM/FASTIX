import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Info,
  LogIn,
  ShieldCheck,
  Ticket,
} from "lucide-react";
import { USER_ROLES } from "../config/constants";
import { getRouteMeta } from "../config/routes";
import { useAuth } from "../context/AuthContext";
import PhoneOtpStep from "../components/verification/PhoneOtpStep";
import IdentityStep from "../components/verification/IdentityStep";
import WalletStep from "../components/verification/WalletStep";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Spinner,
  Stepper,
} from "../components/ui";

export default function IdentityVerificationPage() {
  const { user, verificationStatus, refreshUser } = useAuth();
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [statusSnapshot, setStatusSnapshot] = useState(verificationStatus);

  const loadVerificationStatus = useCallback(async () => {
    setLoadingStatus(true);
    setLoadError("");
    try {
      const data = await refreshUser();
      setStatusSnapshot(data);
    } catch (err) {
      setLoadError(
        err?.message || "Unable to load your verification status right now."
      );
    } finally {
      setLoadingStatus(false);
    }
  }, [refreshUser]);

  useEffect(() => {
    loadVerificationStatus();
  }, [loadVerificationStatus]);

  const activeStatus = verificationStatus || statusSnapshot;
  const currentUser = activeStatus?.user || user;
  const isSignedIn = Boolean(currentUser || activeStatus);
  const isCustomer = currentUser?.role === USER_ROLES.CUSTOMER;

  const phoneVerified = Boolean(
    activeStatus?.phone?.verified ??
      activeStatus?.phoneVerified ??
      currentUser?.phoneVerified ??
      false
  );
  const maskedPhone = activeStatus?.phone?.maskedPhone || "";
  const fallbackPhone = currentUser?.phone || "";

  const identityStatus =
    activeStatus?.identity?.status ||
    currentUser?.identityStatus ||
    (activeStatus?.identityVerified || currentUser?.identityVerified
      ? "VERIFIED"
      : "NOT_STARTED");
  const identityVerifiedAt =
    activeStatus?.identity?.verifiedAt ||
    currentUser?.identityVerifiedAt ||
    null;
  const attemptsRemaining =
    typeof activeStatus?.identity?.attemptsRemaining === "number"
      ? activeStatus.identity.attemptsRemaining
      : null;
  const accountName = currentUser?.fullName || "";

  const isIdentityVerified = identityStatus === "VERIFIED";

  const walletAddress =
    activeStatus?.wallet?.walletAddress ||
    activeStatus?.wallet?.address ||
    activeStatus?.walletAddress ||
    currentUser?.walletAddress ||
    null;
  const isWalletLinked = Boolean(
    (activeStatus?.wallet?.linked ??
      activeStatus?.walletLinked ??
      currentUser?.walletLinked) &&
      walletAddress
  );
  const walletLinkedAt =
    activeStatus?.wallet?.linkedAt || currentUser?.walletLinkedAt || null;

  const isAllComplete = phoneVerified && isIdentityVerified && isWalletLinked;
  const eventsRoute = getRouteMeta("events");
  const eventsPath = eventsRoute ? eventsRoute.path : "/events";

  const stepperSteps = [
    {
      label: "Verify phone",
      description: phoneVerified ? "Verified" : "Simulated SMS code",
      status: phoneVerified ? "completed" : "current",
    },
    {
      label: "Verify identity",
      description: isIdentityVerified
        ? "Verified"
        : phoneVerified
        ? "Simulated demo ID check"
        : "Unlocks after phone check",
      status: isIdentityVerified
        ? "completed"
        : phoneVerified
        ? "current"
        : "upcoming",
    },
    {
      label: "Connect wallet",
      description: isWalletLinked
        ? "Linked"
        : isIdentityVerified
        ? "MetaMask signature"
        : "Unlocks after identity check",
      status: isWalletLinked
        ? "completed"
        : isIdentityVerified
        ? "current"
        : "upcoming",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb="Account Verification"
        title="Identity Verification"
        subtitle="Complete phone, simulated identity, and wallet verification so every ticket goes to a real fan."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">Demo: OTP is simulated</Badge>
            <Badge tone="info">Demo: identity check is simulated</Badge>
          </div>
        }
      />

      {/* 3-Step Verification Progress Bar */}
      <Card>
        <CardBody className="py-5">
          <Stepper steps={stepperSteps} />
        </CardBody>
      </Card>

      {loadingStatus && (
        <Card>
          <CardBody className="flex items-center gap-3 py-6">
            <Spinner size="sm" label="Loading verification status" />
            <p className="text-sm text-slate-600">
              Loading your verification status...
            </p>
          </CardBody>
        </Card>
      )}

      {!loadingStatus && loadError && (
        <Alert variant="danger" title="Could not load verification status">
          <p>{loadError}</p>
          <div className="mt-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={loadVerificationStatus}
            >
              Retry
            </Button>
          </div>
        </Alert>
      )}

      {!loadingStatus && !loadError && !isSignedIn && (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-navy">
              Sign in required to verify your account
            </h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <Alert variant="info" title="Not signed in">
              Sign in to your customer account to verify your phone number,
              complete simulated identity verification, and connect your
              MetaMask wallet.
            </Alert>
            <Button
              to="/auth"
              variant="primary"
              leftIcon={<LogIn className="h-4 w-4" />}
            >
              Go to Register / Login
            </Button>
          </CardBody>
        </Card>
      )}

      {!loadingStatus && !loadError && isSignedIn && !isCustomer && (
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-navy">
              Fan verification not required for staff accounts
            </h2>
            <Badge tone="info">{currentUser?.role}</Badge>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-slate-600">
              Phone OTP, simulated identity checks, and fan wallet verification
              apply only to customer accounts purchasing or reselling event
              tickets.
            </p>
            <Button to="/" variant="secondary" size="sm">
              Back to Home
            </Button>
          </CardBody>
        </Card>
      )}

      {!loadingStatus && !loadError && isSignedIn && isCustomer && (
        <div className="space-y-6">
          {isAllComplete && (
            <Card className="border-green-200 bg-green-50/70">
              <CardBody className="flex flex-wrap items-center justify-between gap-4 py-5">
                <div className="flex items-start gap-3">
                  <CheckCircle2
                    className="mt-0.5 h-6 w-6 shrink-0 text-success"
                    aria-hidden="true"
                  />
                  <div className="space-y-1">
                    <h2 className="text-base font-semibold text-navy">
                      Verification complete
                    </h2>
                    <p className="text-sm text-slate-700">
                      Your phone, simulated identity, and MetaMask wallet are
                      all verified. You are ready to browse events and join fair
                      ticket queues.
                    </p>
                  </div>
                </div>
                <Button
                  to={eventsPath}
                  variant="primary"
                  leftIcon={<Ticket className="h-4 w-4" />}
                >
                  Browse events
                </Button>
              </CardBody>
            </Card>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              {/* Step 1: Simulated Phone OTP Verification */}
              <PhoneOtpStep
                phoneVerified={phoneVerified}
                maskedPhone={maskedPhone}
                fallbackPhone={fallbackPhone}
                onVerified={(result) => {
                  setStatusSnapshot((prev) => ({
                    ...(prev || {}),
                    phoneVerified: true,
                    phone: {
                      ...(prev?.phone || {}),
                      verified: true,
                      maskedPhone: prev?.phone?.maskedPhone || maskedPhone,
                    },
                    user: result?.user || prev?.user,
                  }));
                }}
                refreshUser={refreshUser}
              />

              {/* Step 2: Simulated Identity Verification */}
              <IdentityStep
                phoneVerified={phoneVerified}
                identityStatus={identityStatus}
                verifiedAt={identityVerifiedAt}
                attemptsRemaining={attemptsRemaining}
                accountName={accountName}
                onVerified={(result) => {
                  setStatusSnapshot((prev) => ({
                    ...(prev || {}),
                    identityVerified: true,
                    identity: {
                      ...(prev?.identity || {}),
                      status: "VERIFIED",
                      verifiedAt: result?.verifiedAt || new Date().toISOString(),
                    },
                  }));
                }}
                refreshUser={refreshUser}
              />

              {/* Step 3: MetaMask Wallet Signature Authentication */}
              <WalletStep
                identityVerified={isIdentityVerified}
                walletLinked={isWalletLinked}
                walletAddress={walletAddress}
                walletLinkedAt={walletLinkedAt}
                onLinked={(result) => {
                  setStatusSnapshot((prev) => ({
                    ...(prev || {}),
                    walletLinked: true,
                    walletAddress: result?.walletAddress || prev?.walletAddress,
                    wallet: {
                      linked: true,
                      walletAddress:
                        result?.walletAddress || prev?.wallet?.walletAddress,
                      address:
                        result?.walletAddress || prev?.wallet?.address,
                      linkedAt: result?.linkedAt || new Date().toISOString(),
                    },
                  }));
                }}
                refreshUser={refreshUser}
              />
            </div>

            {/* Right Column: What is this step? Info Box */}
            <aside className="space-y-4">
              <Card>
                <CardHeader className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-navy" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-navy">
                    What is this step?
                  </h2>
                </CardHeader>
                <CardBody className="space-y-4 text-xs leading-relaxed text-slate-600">
                  <div>
                    <p className="font-semibold text-navy">
                      1. Phone verification
                    </p>
                    <p className="mt-1">
                      Confirms you control an active mobile number and slows
                      down automated fake account sign-ups.
                    </p>
                  </div>

                  <div>
                    <p className="font-semibold text-navy">
                      2. Identity verification
                    </p>
                    <p className="mt-1">
                      Confirms one real person maps to one FairTicket account so
                      a scalper cannot bypass the 2-ticket limit with multiple
                      phone numbers.
                    </p>
                  </div>

                  <div>
                    <p className="font-semibold text-navy">
                      3. Wallet authentication
                    </p>
                    <p className="mt-1">
                      Proves you control your MetaMask wallet so your tickets
                      and resale caps stay tied to your verified account.
                      Signing a message proves you own the wallet. It is not a
                      payment.
                    </p>
                  </div>

                  <div className="rounded-lg border border-sky/40 bg-skylight/40 p-3 text-navy">
                    <div className="mb-1 flex items-center gap-1.5 font-semibold">
                      <ShieldCheck
                        className="h-4 w-4 shrink-0"
                        aria-hidden="true"
                      />
                      <span>What is a protected reference?</span>
                    </div>
                    <p className="text-slate-700">
                      A protected reference is a one-way scrambled code created
                      from your demo ID using a secret server key so FairTicket
                      can spot duplicate accounts without ever storing your ID
                      number.
                    </p>
                  </div>
                </CardBody>
              </Card>
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}
