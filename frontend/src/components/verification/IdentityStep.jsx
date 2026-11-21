import { useEffect, useId, useRef, useState } from "react";
import {
  CheckCircle2,
  Lock,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { submitIdentity } from "../../services/verificationApi";
import { formatDateTime } from "../../utils/formatDate";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Select,
  useToast,
} from "../ui";

const DOCUMENT_TYPE_OPTIONS = [
  {
    value: "DEMO_ID",
    label: "Demo ID (not a real document)",
  },
];

function mapSubmitError(error) {
  const code = error?.code || "";
  const details = error?.details || null;
  const fieldErrors = {};

  if (code === "VALIDATION_ERROR" && details && typeof details === "object") {
    for (const key of [
      "documentType",
      "documentNumber",
      "fullNameOnDocument",
      "consent",
    ]) {
      if (typeof details[key] === "string") {
        fieldErrors[key] = details[key];
      }
    }
    return {
      variant: "danger",
      title: "Please check your details",
      message:
        error.message || "Some fields need attention before you can continue.",
      fieldErrors,
    };
  }

  if (code === "REAL_ID_NOT_ALLOWED") {
    return {
      variant: "danger",
      title: "Real ID numbers are not allowed",
      message:
        error.message ||
        "Please do not enter real ID numbers. Use a demo ID like DEMO-ABC12345.",
      fieldErrors,
    };
  }

  if (code === "IDENTITY_REJECTED") {
    const reasonCode = details?.reasonCode;
    if (reasonCode === "NAME_MISMATCH") {
      return {
        variant: "warning",
        title: "Name did not match your account",
        message:
          "The name you entered does not match your FairTicket account name. Check the spelling and try again.",
        fieldErrors: {
          fullNameOnDocument: "Must match your FairTicket account name.",
        },
      };
    }
    if (reasonCode === "DOCUMENT_REJECTED") {
      return {
        variant: "warning",
        title: "Demo document was rejected",
        message:
          "That demo ID is configured to fail verification (DEMO-REJECT...). Try DEMO-ABC12345 to see a successful check.",
        fieldErrors,
      };
    }
    return {
      variant: "warning",
      title: "Identity check could not be completed",
      message:
        error.message ||
        "Your simulated identity check was rejected. Please review your details and try again.",
      fieldErrors,
    };
  }

  if (code === "IDENTITY_ATTEMPT_LIMIT") {
    return {
      variant: "warning",
      title: "Daily attempt limit reached",
      message:
        "You have reached the maximum number of identity checks allowed in 24 hours. Please try again tomorrow.",
      fieldErrors,
    };
  }

  if (code === "IDENTITY_ALREADY_REGISTERED") {
    return {
      code,
      variant: "warning",
      title: "Identity already linked",
      message:
        error.message ||
        "This identity is already linked to an account. Contact support if you think this is a mistake.",
      fieldErrors,
    };
  }

  if (code === "PHONE_NOT_VERIFIED") {
    return {
      variant: "warning",
      title: "Phone verification required first",
      message:
        "Please complete Step 1 (Verify phone) before verifying your identity.",
      fieldErrors,
    };
  }

  if (code === "IDENTITY_ALREADY_VERIFIED") {
    return {
      variant: "info",
      title: "Identity already verified",
      message: "Your identity is already verified on this account.",
      fieldErrors,
    };
  }

  if (code === "RATE_LIMITED" || error?.status === 429) {
    return {
      variant: "warning",
      title: "Too many requests",
      message:
        "You have sent too many verification requests in a short time. Please wait a bit and try again.",
      fieldErrors,
    };
  }

  return {
    variant: "danger",
    title: "Verification request failed",
    message:
      error?.message ||
      "Something went wrong while checking your simulated identity. Please try again.",
    fieldErrors,
  };
}

/**
 * Step 2 of Identity Verification: Simulated Mock KYC.
 * PRIVACY: Document number lives only in local component state during entry,
 * is cleared immediately after every submit (success or failure), and is never
 * persisted to localStorage, sessionStorage, URL, or context.
 */
export default function IdentityStep({
  phoneVerified = false,
  identityStatus = "NOT_STARTED",
  verifiedAt = null,
  attemptsRemaining = null,
  accountName = "",
  onVerified = null,
  refreshUser = null,
}) {
  const toast = useToast();
  const consentId = useId();
  const consentErrorId = `${consentId}-error`;

  const [documentType, setDocumentType] = useState("DEMO_ID");
  const [documentNumber, setDocumentNumber] = useState("");
  const [fullNameOnDocument, setFullNameOnDocument] = useState(
    accountName || ""
  );
  const [consent, setConsent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [feedback, setFeedback] = useState(null);
  const [localVerifiedAt, setLocalVerifiedAt] = useState(verifiedAt);
  const [localStatus, setLocalStatus] = useState(identityStatus);

  const hasPrefilledNameRef = useRef(Boolean(accountName));

  useEffect(() => {
    setLocalStatus(identityStatus);
  }, [identityStatus]);

  useEffect(() => {
    setLocalVerifiedAt(verifiedAt);
  }, [verifiedAt]);

  useEffect(() => {
    if (accountName && !hasPrefilledNameRef.current) {
      hasPrefilledNameRef.current = true;
      setFullNameOnDocument(accountName);
    }
  }, [accountName]);

  const isVerified = localStatus === "VERIFIED";

  if (!phoneVerified && !isVerified) {
    return (
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-slate-500" aria-hidden="true" />
            <h2 className="text-base font-semibold text-navy">
              Step 2: Verify Identity
            </h2>
          </div>
          <Badge tone="neutral">Locked</Badge>
        </CardHeader>
        <CardBody className="space-y-3">
          <Alert variant="info" title="Verify your phone first">
            Complete Step 1 (Phone OTP verification) to unlock simulated
            identity verification.
          </Alert>
        </CardBody>
      </Card>
    );
  }

  if (isVerified) {
    return (
      <Card className="border-green-200">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck
              className="h-5 w-5 text-success"
              aria-hidden="true"
            />
            <h2 className="text-base font-semibold text-navy">
              Step 2: Identity Verification
            </h2>
          </div>
          <Badge tone="success">Verified</Badge>
        </CardHeader>
        <CardBody className="space-y-4">
          <div
            role="status"
            aria-live="polite"
            className="rounded-lg border border-green-200 bg-green-50 p-4"
          >
            <div className="flex items-start gap-3">
              <CheckCircle2
                className="mt-0.5 h-5 w-5 shrink-0 text-success"
                aria-hidden="true"
              />
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold text-navy">
                  Identity verified
                </p>
                {localVerifiedAt && (
                  <p className="text-xs text-slate-700">
                    Verified on {formatDateTime(localVerifiedAt)}
                  </p>
                )}
                <p className="text-xs text-slate-700">
                  Your ID number was not stored. Only a protected reference was
                  saved.
                </p>
              </div>
            </div>
          </div>

          <div
            aria-disabled="true"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-slate-500"
          >
            <div className="flex items-center gap-2.5 text-sm font-medium">
              <Wallet className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Next: Connect wallet (coming in Prompt 9)</span>
            </div>
            <Badge tone="neutral">Prompt 9</Badge>
          </div>
        </CardBody>
      </Card>
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setFeedback(null);
    setFieldErrors({});
    setIsSubmitting(true);

    const payload = {
      documentType,
      documentNumber,
      fullNameOnDocument,
      consent,
    };

    try {
      const result = await submitIdentity(payload);
      setLocalStatus("VERIFIED");
      setLocalVerifiedAt(result?.verifiedAt || new Date().toISOString());
      toast.success("Identity verified successfully.");
      if (typeof onVerified === "function") {
        onVerified(result);
      }
      if (typeof refreshUser === "function") {
        await refreshUser().catch(() => {});
      }
    } catch (error) {
      const mapped = mapSubmitError(error);
      setFieldErrors(mapped.fieldErrors || {});
      setFeedback({
        code: mapped.code || error?.code || "",
        variant: mapped.variant,
        title: mapped.title,
        message: mapped.message,
      });
      if (
        (error?.code === "IDENTITY_ALREADY_VERIFIED" ||
          error?.code === "IDENTITY_REJECTED" ||
          error?.code === "IDENTITY_ATTEMPT_LIMIT") &&
        typeof refreshUser === "function"
      ) {
        await refreshUser().catch(() => {});
      }
    } finally {
      // PRIVACY: Always clear the ID number from state after every submit.
      setDocumentNumber("");
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-navy">
            Step 2: Verify Identity
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Confirm one real fan per account using a simulated demo ID.
          </p>
        </div>
        <Badge tone="info">Demo: identity check is simulated</Badge>
      </CardHeader>

      <CardBody className="space-y-5">
        <Alert
          variant="warning"
          title="Do not enter your real Aadhaar, PAN or any real ID number. This is a demo."
        >
          FairTicket never requests real government ID numbers in demo mode.
          Only enter a fake demo ID starting with <span className="font-mono font-semibold">DEMO-</span>.
        </Alert>

        <div className="rounded-lg border border-sky/40 bg-skylight/40 px-4 py-3 text-xs text-navy">
          <p className="font-semibold">Demo testing guide</p>
          <p className="mt-1 text-slate-700">
            Use <span className="font-mono font-semibold text-navy">DEMO-ABC12345</span> to pass.
            Use <span className="font-mono font-semibold text-navy">DEMO-REJECT0001</span> to see a
            rejection. Name must match your account name.
          </p>
          {typeof attemptsRemaining === "number" &&
            feedback?.code !== "IDENTITY_ALREADY_REGISTERED" && (
              <p className="mt-1.5 text-slate-600">
                Attempts remaining today:{" "}
                <span className="font-semibold text-navy">
                  {attemptsRemaining}
                </span>
              </p>
            )}
        </div>

        <div aria-live="polite">
          {feedback && (
            <Alert variant={feedback.variant} title={feedback.title}>
              <p>{feedback.message}</p>
              {feedback.code === "IDENTITY_ALREADY_REGISTERED" && (
                <div className="mt-3 border-t border-amber-200/80 pt-2.5 text-xs">
                  <p className="font-semibold text-navy">What can I do?</p>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4 text-slate-700">
                    <li>
                      Check that you are logged into the account you used before.
                    </li>
                    <li>
                      Try a different demo ID if you are only testing.
                    </li>
                    <li>
                      Contact support if you believe this is a mistake.
                    </li>
                  </ul>
                </div>
              )}
            </Alert>
          )}
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <Select
            label="Document type"
            name="documentType"
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            options={DOCUMENT_TYPE_OPTIONS}
            error={fieldErrors.documentType || ""}
            disabled={isSubmitting}
            required
          />

          <Input
            label="Demo ID number"
            name="documentNumber"
            type="text"
            value={documentNumber}
            onChange={(e) => setDocumentNumber(e.target.value)}
            placeholder="DEMO-ABC12345"
            hint="Example: DEMO-ABC12345"
            error={fieldErrors.documentNumber || ""}
            autoComplete="off"
            spellCheck={false}
            disabled={isSubmitting}
            required
          />

          <Input
            label="Name on document"
            name="fullNameOnDocument"
            type="text"
            value={fullNameOnDocument}
            onChange={(e) => setFullNameOnDocument(e.target.value)}
            placeholder="Enter your account name"
            hint="Must match your FairTicket account name (case and extra spaces are ignored)."
            error={fieldErrors.fullNameOnDocument || ""}
            autoComplete="off"
            disabled={isSubmitting}
            required
          />

          <div>
            <label
              htmlFor={consentId}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-offwhite p-3.5 text-sm text-navy"
            >
              <input
                id={consentId}
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.consent) || undefined}
                aria-describedby={
                  fieldErrors.consent ? consentErrorId : undefined
                }
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-navy focus:ring-2 focus:ring-sky focus:ring-offset-1"
              />
              <span className="text-xs leading-relaxed text-slate-700 sm:text-sm">
                I agree to a simulated identity check. I understand no real ID is
                needed or stored.
              </span>
            </label>
            {fieldErrors.consent && (
              <p
                id={consentErrorId}
                role="alert"
                className="mt-1.5 text-xs font-medium text-danger"
              >
                {fieldErrors.consent}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
            <Button
              type="submit"
              variant="primary"
              size="md"
              isLoading={isSubmitting}
              disabled={isSubmitting}
            >
              Verify Demo Identity
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
