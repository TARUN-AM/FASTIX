import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Phone,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { sendPhoneOtp, verifyPhoneOtp } from "../../services/verificationApi";
import { formatCountdown } from "../../utils/formatDate";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CountdownDisplay,
  Input,
  useToast,
} from "../ui";

const OTP_LENGTH = 6;

function maskPhoneFallback(phone) {
  if (typeof phone !== "string" || !phone.trim()) {
    return "Account mobile number";
  }
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length <= 4) {
    return "****";
  }
  const hasPlus = trimmed.startsWith("+");
  const last4 = digits.slice(-4);
  if (hasPlus && digits.length > 6) {
    const prefixLen = digits.length >= 12 ? 2 : 1;
    return `+${digits.slice(0, prefixLen)}${"*".repeat(
      digits.length - prefixLen - 4
    )}${last4}`;
  }
  return `${hasPlus ? "+" : ""}${"*".repeat(digits.length - 4)}${last4}`;
}

export default function PhoneOtpStep({
  phoneVerified = false,
  maskedPhone = "",
  fallbackPhone = "",
  onVerified = null,
  refreshUser = null,
}) {
  const { addToast } = useToast();

  const [codeSent, setCodeSent] = useState(false);
  const [otpInput, setOtpInput] = useState("");
  const [demoOtp, setDemoOtp] = useState(null);
  const [displayMaskedPhone, setDisplayMaskedPhone] = useState(
    maskedPhone || maskPhoneFallback(fallbackPhone)
  );
  const [resendSeconds, setResendSeconds] = useState(0);
  const [expiresSeconds, setExpiresSeconds] = useState(0);

  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const [banner, setBanner] = useState(null);
  const [liveMessage, setLiveMessage] = useState("");

  useEffect(() => {
    if (maskedPhone) {
      setDisplayMaskedPhone(maskedPhone);
    } else if (fallbackPhone) {
      setDisplayMaskedPhone(maskPhoneFallback(fallbackPhone));
    }
  }, [maskedPhone, fallbackPhone]);

  // Display-only 1-second tick for resend cooldown and code expiry timers.
  // The backend enforces all real cooldowns and expiration deadlines.
  useEffect(() => {
    if (resendSeconds <= 0 && expiresSeconds <= 0) {
      return undefined;
    }

    const timer = setInterval(() => {
      setResendSeconds((prev) => (prev > 0 ? prev - 1 : 0));
      setExpiresSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [resendSeconds > 0, expiresSeconds > 0]);

  function handleOtpError(err) {
    const code = err?.code;
    const details = err?.details || {};

    if (code === "OTP_INVALID") {
      const remaining =
        typeof details.attemptsRemaining === "number"
          ? details.attemptsRemaining
          : null;
      const msg =
        remaining !== null
          ? `Incorrect code. You have ${remaining} ${
              remaining === 1 ? "attempt" : "attempts"
            } remaining.`
          : err.message || "Incorrect verification code. Please try again.";
      setFieldError(msg);
      setBanner({ variant: "danger", title: "Incorrect code", message: msg });
      setLiveMessage(msg);
      return;
    }

    if (code === "OTP_EXPIRED") {
      const msg =
        "This verification code has expired. Click Resend code to get a fresh code.";
      setExpiresSeconds(0);
      setBanner({ variant: "warning", title: "Code expired", message: msg });
      setLiveMessage(msg);
      return;
    }

    if (code === "OTP_MAX_ATTEMPTS" || code === "OTP_LOCKED") {
      const msg =
        "Too many incorrect attempts for this code. Please request a new verification code.";
      setBanner({
        variant: "warning",
        title: "Code locked after failed attempts",
        message: msg,
      });
      setLiveMessage(msg);
      return;
    }

    if (code === "OTP_COOLDOWN") {
      const waitSec =
        typeof details.retryAfterSeconds === "number"
          ? details.retryAfterSeconds
          : 30;
      setResendSeconds(waitSec);
      const msg = `Please wait ${waitSec} seconds before requesting another code.`;
      setBanner({
        variant: "warning",
        title: "Please wait before resending",
        message: msg,
      });
      setLiveMessage(msg);
      return;
    }

    if (code === "OTP_SEND_LIMIT") {
      const msg =
        "You have reached the hourly limit for verification codes. Please try again later.";
      setBanner({
        variant: "warning",
        title: "Hourly send limit reached",
        message: msg,
      });
      setLiveMessage(msg);
      return;
    }

    if (code === "RATE_LIMITED" || err?.status === 429) {
      const msg =
        err.message || "Too many requests. Please wait a few minutes and try again.";
      setBanner({
        variant: "warning",
        title: "Too many attempts",
        message: msg,
      });
      setLiveMessage(msg);
      return;
    }

    if (code === "PHONE_ALREADY_VERIFIED" || err?.status === 409) {
      if (refreshUser) {
        refreshUser().catch(() => {});
      }
      return;
    }

    const fallbackMsg =
      err?.message || "Unable to process phone verification right now.";
    setBanner({
      variant: "danger",
      title: "Verification error",
      message: fallbackMsg,
    });
    setLiveMessage(fallbackMsg);
  }

  async function handleSendOtp() {
    if (sending) return;
    setSending(true);
    setBanner(null);
    setFieldError("");

    try {
      const data = await sendPhoneOtp();
      setCodeSent(true);
      setOtpInput("");
      if (data?.maskedPhone) {
        setDisplayMaskedPhone(data.maskedPhone);
      }
      setExpiresSeconds(
        typeof data?.expiresInSeconds === "number" ? data.expiresInSeconds : 300
      );
      setResendSeconds(
        typeof data?.resendAfterSeconds === "number"
          ? data.resendAfterSeconds
          : 30
      );
      setDemoOtp(data?.demoOtp || null);
      setLiveMessage(
        `Verification code sent to ${
          data?.maskedPhone || displayMaskedPhone
        }.`
      );
      addToast({
        variant: "info",
        title: "Code sent",
        message: `A ${OTP_LENGTH}-digit verification code was sent to ${
          data?.maskedPhone || displayMaskedPhone
        }.`,
      });
    } catch (err) {
      handleOtpError(err);
    } finally {
      setSending(false);
    }
  }

  async function handleVerifySubmit(event) {
    event.preventDefault();
    if (verifying) return;

    setFieldError("");
    setBanner(null);

    if (otpInput.length !== OTP_LENGTH) {
      const msg = `Enter all ${OTP_LENGTH} digits from your verification code.`;
      setFieldError(msg);
      setLiveMessage(msg);
      return;
    }

    setVerifying(true);
    try {
      const data = await verifyPhoneOtp(otpInput);
      setDemoOtp(null);
      setOtpInput("");
      setResendSeconds(0);
      setExpiresSeconds(0);
      setLiveMessage("Phone number verified successfully.");

      addToast({
        variant: "success",
        title: "Phone verified",
        message: "Your mobile number is now verified. You can proceed to Step 2.",
      });

      if (onVerified) {
        onVerified(data);
      }
      if (refreshUser) {
        await refreshUser();
      }
    } catch (err) {
      handleOtpError(err);
    } finally {
      setVerifying(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-navy" aria-hidden="true" />
          <h2 className="text-base font-semibold text-navy">
            Step 1: Verify Phone
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="info">Demo: OTP is simulated</Badge>
          {phoneVerified ? (
            <Badge tone="success">Verified</Badge>
          ) : (
            <Badge tone="warning">Required</Badge>
          )}
        </div>
      </CardHeader>

      <CardBody className="space-y-4">
        {/* Polite screen-reader live region for status announcements */}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {liveMessage}
        </div>

        {/* Account masked phone display */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-surface px-3.5 py-2.5">
          <div>
            <p className="text-xs font-medium text-slate-500">
              Registered mobile number
            </p>
            <p className="mt-0.5 font-mono text-sm font-semibold text-navy">
              {displayMaskedPhone}
            </p>
          </div>
          <p className="text-xs text-slate-500">
            To change your number, contact support
          </p>
        </div>

        {phoneVerified ? (
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4">
              <CheckCircle2
                className="mt-0.5 h-5 w-5 shrink-0 text-success"
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-semibold text-navy">
                  Phone verified
                </p>
                <p className="mt-0.5 text-xs text-slate-700">
                  Your account phone number ({displayMaskedPhone}) has been
                  confirmed. Step 2 (Identity Verification) is now unlocked
                  below.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {banner && (
              <Alert
                variant={banner.variant}
                title={banner.title}
                onDismiss={() => setBanner(null)}
              >
                {banner.message}
              </Alert>
            )}

            {!codeSent ? (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  We will send a one-time {OTP_LENGTH}-digit verification code
                  to your registered mobile number to confirm you control this
                  phone and block automated account farms.
                </p>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  isLoading={sending}
                  disabled={sending}
                  onClick={handleSendOtp}
                  leftIcon={<Send className="h-4 w-4" />}
                >
                  Send code
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {demoOtp && (
                  <Alert variant="info" title="Demo mode">
                    <p className="font-semibold text-navy">
                      Simulated SMS: your code is{" "}
                      <span className="rounded bg-white px-1.5 py-0.5 font-mono tracking-widest">
                        {demoOtp}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      Real users in production would receive this code by SMS.
                    </p>
                  </Alert>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                  <span>
                    {expiresSeconds > 0
                      ? `Code expires in ${formatCountdown(expiresSeconds)}`
                      : "Code has expired — request a new code below."}
                  </span>
                  <CountdownDisplay
                    remainingSeconds={expiresSeconds}
                    label="Verification code expiry"
                  />
                </div>

                <form
                  onSubmit={handleVerifySubmit}
                  noValidate
                  className="space-y-4"
                >
                  <Input
                    label={`${OTP_LENGTH}-digit verification code`}
                    type="text"
                    name="otpCode"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={OTP_LENGTH}
                    placeholder="000000"
                    required
                    value={otpInput}
                    onChange={(e) => {
                      const digitsOnly = e.target.value
                        .replace(/\D/g, "")
                        .slice(0, OTP_LENGTH);
                      setOtpInput(digitsOnly);
                      if (fieldError) {
                        setFieldError("");
                      }
                    }}
                    error={fieldError}
                    hint="Enter the 6-digit numeric code."
                    inputClassName="font-mono text-base tracking-[0.35em]"
                    disabled={verifying}
                  />

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="submit"
                      variant="primary"
                      size="md"
                      isLoading={verifying}
                      disabled={verifying || otpInput.length !== OTP_LENGTH}
                      leftIcon={<ShieldCheck className="h-4 w-4" />}
                    >
                      Verify
                    </Button>

                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      isLoading={sending}
                      disabled={sending || resendSeconds > 0}
                      onClick={handleSendOtp}
                      leftIcon={<RefreshCw className="h-4 w-4" />}
                    >
                      {resendSeconds > 0
                        ? `Resend code (${formatCountdown(resendSeconds)})`
                        : "Resend code"}
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
