import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Calendar,
  Clock,
  MapPin,
  QrCode,
  ShieldCheck,
  Ticket,
  UserCheck,
} from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CountdownDisplay,
  EmptyState,
  PageHeader,
  Skeleton,
  StatusPill,
} from "../components/ui";
import VerificationGate from "../components/verification/VerificationGate";
import { USER_ROLES } from "../config/constants";
import { useAuth } from "../context/AuthContext";
import { getEvent } from "../services/eventsApi";
import { formatDateTime } from "../utils/formatDate";
import { formatRupees } from "../utils/formatMoney";

function formatLongDuration(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

export default function EventDetailsPage() {
  const { eventId } = useParams();
  const location = useLocation();
  const { user, isAuthenticated } = useAuth();

  const [event, setEvent] = useState(null);
  // Offset in ms between the HTTP response Date header and the browser clock.
  // Computed once per fetch so display-only countdowns do not rely on the local
  // browser clock alone. IMPORTANT: The server always decides real deadlines.
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let isActive = true;

    setLoading(true);
    setNotFound(false);
    setError("");

    getEvent(eventId, { signal: controller.signal })
      .then(({ event: loadedEvent, serverDateHeader }) => {
        if (!isActive) return;
        const browserNow = Date.now();
        if (serverDateHeader) {
          const parsedServerMs = Date.parse(serverDateHeader);
          if (Number.isFinite(parsedServerMs)) {
            setServerClockOffsetMs(parsedServerMs - browserNow);
          } else {
            setServerClockOffsetMs(0);
          }
        } else {
          setServerClockOffsetMs(0);
        }
        setNowMs(browserNow);
        setEvent(loadedEvent);
        setLoading(false);
      })
      .catch((err) => {
        if (
          !isActive ||
          err?.code === "ERR_CANCELED" ||
          err?.name === "CanceledError"
        ) {
          return;
        }
        if (err?.status === 404 || err?.code === "NOT_FOUND") {
          setNotFound(true);
        } else {
          setError(err?.message || "Unable to load event details.");
        }
        setLoading(false);
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [eventId, reloadTick]);

  // Display-only ticker: recomputes remaining time from stored server timestamps
  // plus the one-time server Date header offset. The backend enforces all real cutoffs.
  useEffect(() => {
    if (!event || event.status === "CANCELLED" || event.status === "DRAFT") {
      return undefined;
    }
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [event]);

  const countdownInfo = useMemo(() => {
    if (!event || event.status === "DRAFT" || event.status === "CANCELLED") {
      return null;
    }
    const estimatedServerNowMs = nowMs + serverClockOffsetMs;
    const openMs = Date.parse(event.registrationOpenAt);
    const closeMs = Date.parse(event.registrationCloseAt);

    if (Number.isFinite(openMs) && estimatedServerNowMs < openMs) {
      return {
        label: "Registration opens in",
        remainingSeconds: Math.max(
          0,
          Math.floor((openMs - estimatedServerNowMs) / 1000)
        ),
      };
    }
    if (Number.isFinite(closeMs) && estimatedServerNowMs < closeMs) {
      return {
        label: "Registration closes in",
        remainingSeconds: Math.max(
          0,
          Math.floor((closeMs - estimatedServerNowMs) / 1000)
        ),
      };
    }
    return null;
  }, [event, nowMs, serverClockOffsetMs]);

  if (loading) {
    return (
      <div className="space-y-6" aria-live="polite">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-2/3" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Skeleton className="h-44 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="space-y-6">
        <Button to="/events" variant="ghost" size="sm">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to events
        </Button>
        <EmptyState
          icon={Ticket}
          title="Event not found"
          description="This event may have been removed, is still an unpublished draft, or the link may be incorrect."
          action={
            <Button to="/events" variant="primary">
              Browse published events
            </Button>
          }
        />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="space-y-6">
        <Button to="/events" variant="ghost" size="sm">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to events
        </Button>
        <Alert
          variant="danger"
          title="Could not load event"
          actions={
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setReloadTick((n) => n + 1)}
            >
              Retry
            </Button>
          }
        >
          {error || "An unexpected error occurred."}
        </Alert>
      </div>
    );
  }

  const isDemo =
    typeof event.title === "string" && event.title.startsWith("Demo");
  const isCancelled = event.status === "CANCELLED";
  const isCustomer = isAuthenticated && user?.role === USER_ROLES.CUSTOMER;
  const isStaff =
    isAuthenticated &&
    [USER_ROLES.ORGANIZER, USER_ROLES.ADMIN, USER_ROLES.GATE_STAFF].includes(
      user?.role
    );

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/events"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-navy hover:text-sky"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to all events
        </Link>
      </div>

      <PageHeader
        breadcrumb="Event Details"
        title={event.title}
        subtitle={`${event.venueName} · ${event.city}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={event.phase} />
            {isDemo && <Badge tone="info">Demo</Badge>}
            {event.soldOut && <Badge tone="warning">Sold out</Badge>}
          </div>
        }
      />

      {isCancelled && (
        <Alert variant="danger" title="This event has been cancelled">
          <p className="font-medium">
            Reason: {event.cancelReason || "Cancelled by the event organizer."}
          </p>
          {event.cancelledAt && (
            <p className="mt-1 text-xs">
              Cancelled on {formatDateTime(event.cancelledAt)}.
            </p>
          )}
        </Alert>
      )}

      {event.status === "DRAFT" && (
        <Alert variant="info" title="Draft preview">
          This event is currently a draft and is hidden from public visitors
          until you publish it.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main Column */}
        <div className="space-y-6 lg:col-span-2">
          {/* Core Event Details */}
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-navy">
                About this event
              </h2>
            </CardHeader>
            <CardBody className="space-y-5">
              <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-offwhite p-4 sm:grid-cols-2">
                <div className="flex items-start gap-2.5">
                  <Calendar
                    className="mt-0.5 h-4 w-4 shrink-0 text-sky"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Event start
                    </p>
                    <p className="text-sm font-semibold text-navy">
                      {formatDateTime(event.eventDate)}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <MapPin
                    className="mt-0.5 h-4 w-4 shrink-0 text-sky"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Venue
                    </p>
                    <p className="text-sm font-semibold text-navy">
                      {event.venueName}
                    </p>
                    <p className="text-xs text-slate-600">{event.city}</p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <Ticket
                    className="mt-0.5 h-4 w-4 shrink-0 text-sky"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Ticket face value
                    </p>
                    <p className="text-base font-bold text-navy">
                      {formatRupees(event.basePricePaise)}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <Clock
                    className="mt-0.5 h-4 w-4 shrink-0 text-sky"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Booking hold time
                    </p>
                    <p className="text-sm font-semibold text-navy">
                      {event.holdDurationMinutes} minute
                      {event.holdDurationMinutes === 1 ? "" : "s"} per turn
                    </p>
                  </div>
                </div>
              </div>

              {event.organizerName && (
                <p className="text-xs text-slate-500">
                  Organized by{" "}
                  <span className="font-semibold text-navy">
                    {event.organizerName}
                  </span>
                </p>
              )}

              {/* Plain-text description rendering only; never dangerouslySetInnerHTML */}
              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold text-navy">Description</h3>
                {event.description ? (
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">
                    {event.description}
                  </p>
                ) : (
                  <p className="text-sm italic text-slate-500">
                    No additional description provided by the organizer.
                  </p>
                )}
              </div>
            </CardBody>
          </Card>

          {/* Fair-Ticket Rules Panel */}
          <Card>
            <CardHeader className="flex items-center gap-2">
              <ShieldCheck
                className="h-5 w-5 text-sky"
                aria-hidden="true"
              />
              <h2 className="text-base font-semibold text-navy">
                Fair-ticket rules
              </h2>
            </CardHeader>
            <CardBody>
              <ul className="space-y-3 text-sm text-slate-700">
                <li className="flex items-start gap-2.5">
                  <UserCheck
                    className="mt-0.5 h-4 w-4 shrink-0 text-success"
                    aria-hidden="true"
                  />
                  <span>
                    <strong className="font-semibold text-navy">
                      Verified identity required:
                    </strong>{" "}
                    Every fan completes phone, identity, and wallet verification
                    before joining the queue.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Ticket
                    className="mt-0.5 h-4 w-4 shrink-0 text-success"
                    aria-hidden="true"
                  />
                  <span>
                    <strong className="font-semibold text-navy">
                      Fair quantity cap:
                    </strong>{" "}
                    Maximum {event.maxTicketsPerIdentity} ticket
                    {event.maxTicketsPerIdentity === 1 ? "" : "s"} per verified
                    person across primary and resale purchases.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <ShieldCheck
                    className="mt-0.5 h-4 w-4 shrink-0 text-success"
                    aria-hidden="true"
                  />
                  <span>
                    <strong className="font-semibold text-navy">
                      Resale capped at 110%:
                    </strong>{" "}
                    Official resale cannot exceed{" "}
                    {formatRupees(event.maxResalePricePaise)} (enforced by
                    backend and smart contract).
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <QrCode
                    className="mt-0.5 h-4 w-4 shrink-0 text-success"
                    aria-hidden="true"
                  />
                  <span>
                    <strong className="font-semibold text-navy">
                      Signed QR gate entry:
                    </strong>{" "}
                    Tickets are checked at the venue gate with a short-lived,
                    cryptographically signed QR code.
                  </span>
                </li>
              </ul>
            </CardBody>
          </Card>
        </div>

        {/* Side Column: Timeline + Action Box */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-navy">
                Registration timeline
              </h2>
              <StatusPill status={event.phase} />
            </CardHeader>
            <CardBody className="space-y-4">
              {countdownInfo && (
                <div className="rounded-lg border border-sky/30 bg-skylight/40 p-3.5 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-navy">
                    {countdownInfo.label}
                  </p>
                  {countdownInfo.remainingSeconds < 3600 ? (
                    <CountdownDisplay
                      remainingSeconds={countdownInfo.remainingSeconds}
                      label={countdownInfo.label}
                    />
                  ) : (
                    <p className="inline-flex items-center gap-2 rounded-lg border border-sky/40 bg-white px-3 py-1.5 text-sm font-semibold tabular-nums text-navy">
                      <Clock className="h-4 w-4 shrink-0 text-sky" aria-hidden="true" />
                      <span>
                        {formatLongDuration(countdownInfo.remainingSeconds)}
                      </span>
                    </p>
                  )}
                  <p className="text-[11px] text-slate-600">
                    Informational countdown based on server timestamps. Exact
                    cutoffs are enforced by the server.
                  </p>
                </div>
              )}

              <ol className="space-y-3 border-l-2 border-slate-200 pl-4 text-sm">
                <li>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Registration opens
                  </p>
                  <p className="font-semibold text-navy">
                    {formatDateTime(event.registrationOpenAt)}
                  </p>
                </li>
                <li>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Registration closes
                  </p>
                  <p className="font-semibold text-navy">
                    {formatDateTime(event.registrationCloseAt)}
                  </p>
                </li>
                <li>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Event starts
                  </p>
                  <p className="font-semibold text-navy">
                    {formatDateTime(event.eventDate)}
                  </p>
                </li>
              </ol>
            </CardBody>
          </Card>

          {/* Role-Aware Action Box */}
          {!isCancelled && (
            <div>
              {!isAuthenticated && (
                <Card>
                  <CardBody className="space-y-3">
                    <h3 className="text-base font-semibold text-navy">
                      Ready to join the fair queue?
                    </h3>
                    <p className="text-sm text-slate-600">
                      Sign in or create a fan account to verify your identity
                      and join the queue once registration is open.
                    </p>
                    <Button
                      to="/auth"
                      state={{ from: location.pathname }}
                      variant="primary"
                      className="w-full"
                    >
                      Log in to join
                    </Button>
                  </CardBody>
                </Card>
              )}

              {isCustomer && (
                <VerificationGate requireWallet>
                  <Card>
                    <CardBody className="space-y-3">
                      <h3 className="text-base font-semibold text-navy">
                        You are verified for fair ticketing
                      </h3>
                      <p className="text-sm text-slate-600">
                        Your phone, identity, and wallet are verified. Queue
                        registration will be enabled in the next milestone.
                      </p>
                      <Button
                        type="button"
                        variant="primary"
                        disabled
                        className="w-full"
                      >
                        Join queue (coming in Prompt 11)
                      </Button>
                    </CardBody>
                  </Card>
                </VerificationGate>
              )}

              {isStaff && (
                <Alert variant="info" title="Staff account view">
                  You are signed in with a {user?.role} account. Only customer
                  accounts can join fan queues and purchase tickets.
                  {user?.role === USER_ROLES.ORGANIZER && (
                    <div className="mt-3">
                      <Button to="/organizer" variant="secondary" size="sm">
                        Go to My Events
                      </Button>
                    </div>
                  )}
                </Alert>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
