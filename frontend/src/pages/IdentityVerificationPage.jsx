import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Info,
  LogIn,
  Phone,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import IdentityStep from "../components/verification/IdentityStep";
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

  const activeStatus = statusSnapshot || verificationStatus;
  const phoneVerified = Boolean(
    activeStatus?.phoneVerified ?? user?.phoneVerified ?? false
  );
  const identityStatus =
    activeStatus?.identity?.status ||
    user?.identityStatus ||
    (activeStatus?.identityVerified || user?.identityVerified
      ? "VERIFIED"
      : "NOT_STARTED");
  const identityVerifiedAt =
    activeStatus?.identity?.verifiedAt || user?.identityVerifiedAt || null;
  const attemptsRemaining =
    typeof activeStatus?.identity?.attemptsRemaining === "number"
      ? activeStatus.identity.attemptsRemaining
      : null;
  const accountName = activeStatus?.user?.fullName || user?.fullName || "";

  const isSignedIn = Boolean(activeStatus || user);
  const isIdentityVerified = identityStatus === "VERIFIED";

  const stepperSteps = [
    {
      label: "Verify phone",
      description: phoneVerified
        ? "Completed"
        : "Confirm your mobile number (Prompt 6)",
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
      description: "Coming in Prompt 9",
      status: "upcoming",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb="Account Verification"
        title="Identity Verification"
        subtitle="Complete phone, simulated identity, and wallet verification so every ticket goes to a real fan."
        actions={<Badge tone="info">Demo Mode</Badge>}
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
              Sign in to your customer account to view your phone status and
              complete simulated identity verification.
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

      {!loadingStatus && !loadError && isSignedIn && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {/* Step 1 Summary */}
            <Card>
              <CardHeader className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-navy" aria-hidden="true" />
                  <h2 className="text-base font-semibold text-navy">
                    Step 1: Verify Phone
                  </h2>
                </div>
                {phoneVerified ? (
                  <Badge tone="success">Verified</Badge>
                ) : (
                  <Badge tone="warning">Pending</Badge>
                )}
              </CardHeader>
              <CardBody>
                {phoneVerified ? (
                  <div className="flex items-center gap-2 text-sm text-slate-700">
                    <CheckCircle2
                      className="h-4 w-4 shrink-0 text-success"
                      aria-hidden="true"
                    />
                    <span>Your phone number is verified.</span>
                  </div>
                ) : (
                  <p className="text-sm text-slate-600">
                    Your phone number is not verified yet. Complete phone OTP
                    verification first to unlock identity verification.
                  </p>
                )}
              </CardBody>
            </Card>

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

            {/* Step 3: Connect Wallet (disabled until Prompt 9) */}
            <Card className="bg-slate-50/70">
              <CardHeader className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-slate-600">
                  <Wallet className="h-4 w-4" aria-hidden="true" />
                  <h2 className="text-base font-semibold text-slate-700">
                    Step 3: Connect Wallet
                  </h2>
                </div>
                <Badge tone="neutral">Coming in Prompt 9</Badge>
              </CardHeader>
              <CardBody>
                <p className="text-sm text-slate-500">
                  MetaMask wallet signature verification will be unlocked here
                  in Prompt 9.
                </p>
              </CardBody>
            </Card>
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
                    Confirms you control an active mobile number and slows down
                    automated fake account sign-ups.
                  </p>
                </div>

                <div>
                  <p className="font-semibold text-navy">
                    2. Identity verification (this step)
                  </p>
                  <p className="mt-1">
                    Confirms one real person maps to one FairTicket account so a
                    scalper cannot bypass the 2-ticket limit with multiple phone
                    numbers.
                  </p>
                </div>

                <div>
                  <p className="font-semibold text-navy">
                    3. Wallet verification (Prompt 9)
                  </p>
                  <p className="mt-1">
                    Proves you control your MetaMask wallet so your tickets and
                    resale caps can be tracked safely on-chain.
                  </p>
                </div>

                <div className="rounded-lg border border-sky/40 bg-skylight/40 p-3 text-navy">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold">
                    <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
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
      )}
    </div>
  );
}
