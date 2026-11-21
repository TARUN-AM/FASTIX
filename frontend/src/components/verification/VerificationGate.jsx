import { CheckCircle2, Circle, ShieldAlert } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { getRouteMeta } from "../../config/routes";
import { Button, Card, CardBody, CardHeader } from "../ui";

/**
 * Reusable verification gate component for customer-facing experiences.
 *
 * IMPORTANT: The backend `requireVerifiedUser` middleware enforces the real
 * security rule against live MongoDB state on every request. This frontend
 * component exists solely to provide a clear, helpful user experience before
 * a fan tries to join a queue, start a hold, or purchase a resale ticket.
 */
export default function VerificationGate({
  user: userOverride,
  requireWallet = false,
  children,
}) {
  const { user: authUser } = useAuth();
  const activeUser = userOverride !== undefined ? userOverride : authUser;

  const phoneDone = Boolean(activeUser?.phoneVerified);
  const identityDone =
    activeUser?.identityStatus === "VERIFIED" ||
    Boolean(activeUser?.identityVerified);
  const walletDone = Boolean(
    activeUser?.walletLinked && activeUser?.walletAddress
  );

  const isFullyVerified =
    phoneDone && identityDone && (!requireWallet || walletDone);

  if (isFullyVerified) {
    return <>{children}</>;
  }

  const verifyRoute = getRouteMeta("verify-identity");
  const verifyPath = verifyRoute ? verifyRoute.path : "/verify-identity";

  const requirements = [
    {
      key: "phone",
      label: "Phone verification",
      detail: phoneDone
        ? "Completed"
        : "Confirm your mobile number with a one-time code.",
      done: phoneDone,
    },
    {
      key: "identity",
      label: "Identity verification",
      detail: identityDone
        ? "Completed"
        : "Complete simulated identity verification to protect fair ticket limits.",
      done: identityDone,
    },
  ];

  if (requireWallet) {
    requirements.push({
      key: "wallet",
      label: "Wallet connection",
      detail: walletDone
        ? "Completed"
        : "Connect and verify your wallet to hold and resell tickets safely.",
      done: walletDone,
    });
  }

  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader className="flex flex-wrap items-center gap-2.5">
        <ShieldAlert
          className="h-5 w-5 shrink-0 text-navy"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-navy">
            Complete verification to continue
          </h3>
          <p className="text-xs text-slate-600">
            FairTicket verifies every fan before ticket access so bots and
            scalpers cannot bypass fair limits.
          </p>
        </div>
      </CardHeader>

      <CardBody className="space-y-4">
        <ul className="space-y-2.5" aria-label="Verification requirements">
          {requirements.map((item) => (
            <li
              key={item.key}
              className="flex items-start gap-3 rounded-lg border border-slate-200 bg-offwhite px-3.5 py-2.5"
            >
              {item.done ? (
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-success"
                  aria-label="Completed"
                />
              ) : (
                <Circle
                  className="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
                  aria-label="Not completed"
                />
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-navy">{item.label}</p>
                <p className="text-xs text-slate-600">{item.detail}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center justify-end pt-1">
          <Button to={verifyPath} variant="primary" size="md">
            Continue verification
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
