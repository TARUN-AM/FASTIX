import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  MapPin,
  QrCode,
  RefreshCw,
  Repeat,
  ShieldCheck,
  Sparkles,
  Ticket,
  Users,
} from "lucide-react";
import {
  DEFAULT_HOLD_MINUTES,
  MAX_ACTIVE_TICKETS,
  QR_TOKEN_TTL_SECONDS,
  RESALE_CAP_PERCENT,
} from "../config/constants";
import { useServerHealth } from "../hooks/useServerHealth";
import {
  calculateMaxResalePricePaise,
  formatRupees,
} from "../utils/formatMoney";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Spinner,
  Stepper,
} from "../components/ui";

const HOW_IT_WORKS_STEPS = [
  {
    label: "Verify Identity",
    description: "OTP, simulated ID check, and MetaMask wallet proof.",
    status: "completed",
  },
  {
    label: "Randomized Queue",
    description: "Every verified fan gets a fair, bot-resistant slot.",
    status: "current",
  },
  {
    label: "Timed Hold",
    description: `${DEFAULT_HOLD_MINUTES}-minute server-backed hold with CAPTCHA.`,
    status: "upcoming",
  },
  {
    label: "Verified Gate Entry",
    description: `Rotating ${QR_TOKEN_TTL_SECONDS}s signed QR blocks fake screenshots.`,
    status: "upcoming",
  },
];

const PROTECTION_PILLARS = [
  {
    title: "Fair Ticket Booking",
    icon: Users,
    badge: `Max ${MAX_ACTIVE_TICKETS} per event`,
    description:
      "Verified human identities, randomized queues, CAPTCHA checks, and strict per-event ticket limits stop bots and bulk scalpers before checkout.",
  },
  {
    title: "Controlled Official Resale",
    icon: Repeat,
    badge: `Capped at ${RESALE_CAP_PERCENT}%`,
    description:
      "Plans changed? Resell safely inside FairTicket at no more than 110% of face value, enforced both in backend checks and on-chain smart contract rules.",
  },
  {
    title: "Fake-Ticket Prevention",
    icon: QrCode,
    badge: `${QR_TOKEN_TTL_SECONDS}s rotating QR`,
    description:
      "Every ticket is backed by a cryptographic on-chain ownership record and a short-lived signed QR token so screenshots and counterfeit passes fail at the gate.",
  },
];

// Clearly marked Demo preview cards using neutral event names (no real artists or brands)
const DEMO_PREVIEW_EVENTS = [
  {
    id: "demo-concert",
    category: "Live Concert",
    title: "National Stadium Music Night",
    venue: "DY Patil Sports Arena, Navi Mumbai",
    dateLabel: "18 Dec 2026, 7:00 PM IST",
    faceValuePaise: 450000,
  },
  {
    id: "demo-cricket",
    category: "Championship Match",
    title: "Premier T20 Finals Evening",
    venue: "Chinnaswamy Ground, Bengaluru",
    dateLabel: "24 Jan 2027, 7:30 PM IST",
    faceValuePaise: 250000,
  },
  {
    id: "demo-festival",
    category: "Performing Arts",
    title: "Winter Symphony & Indie Showcase",
    venue: "JLN Open Amphitheatre, New Delhi",
    dateLabel: "14 Feb 2027, 6:30 PM IST",
    faceValuePaise: 300000,
  },
];

export default function HomePage() {
  const { status, data: healthData, error: healthError, retry } =
    useServerHealth();

  return (
    <div className="space-y-12">
      {/* Commercial Hero Section */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <div className="max-w-3xl">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge tone="info">Verified Fan Ticketing</Badge>
            <Badge tone="neutral">Blockchain &amp; Cybersecurity Platform</Badge>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-navy sm:text-4xl lg:text-5xl">
            Every Fan Deserves a Fair Ticket.
          </h1>

          <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
            When a major concert sells out in minutes, bots hoard seats, resellers
            demand extreme markups, and counterfeit screenshots flood messaging
            apps. FairTicket combines verified fan identity, randomized queues,
            110% capped official resale, and cryptographic gate verification to
            put real fans first.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              to="/events"
              variant="primary"
              size="lg"
              rightIcon={<ArrowRight className="h-4 w-4" />}
            >
              Browse Events
            </Button>
            <Button to="/resale" variant="secondary" size="lg">
              Resale Marketplace
            </Button>
            <Button to="/verify-identity" variant="ghost" size="lg">
              Verify Identity
            </Button>
          </div>
        </div>

        {/* Key Platform Guarantees */}
        <dl className="mt-8 grid grid-cols-1 gap-4 border-t border-slate-100 pt-6 sm:grid-cols-3">
          <div className="rounded-lg bg-offwhite px-4 py-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Anti-Bulk Limit
            </dt>
            <dd className="mt-1 text-lg font-bold text-navy">
              Max {MAX_ACTIVE_TICKETS} tickets / event
            </dd>
          </div>
          <div className="rounded-lg bg-offwhite px-4 py-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Official Resale Cap
            </dt>
            <dd className="mt-1 text-lg font-bold text-navy">
              {RESALE_CAP_PERCENT}% of face value
            </dd>
          </div>
          <div className="rounded-lg bg-offwhite px-4 py-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Gate QR Refresh
            </dt>
            <dd className="mt-1 text-lg font-bold text-navy">
              Every {QR_TOKEN_TTL_SECONDS} seconds
            </dd>
          </div>
        </dl>
      </section>

      {/* Three Mandatory Protection Pillars */}
      <section aria-labelledby="pillars-heading">
        <div className="mb-5">
          <h2
            id="pillars-heading"
            className="text-xl font-bold tracking-tight text-navy sm:text-2xl"
          >
            Built to stop bots, scalpers, and fake tickets
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Three layers of protection across booking, resale, and venue entry.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {PROTECTION_PILLARS.map((pillar) => {
            const IconComponent = pillar.icon;
            return (
              <Card key={pillar.title} className="flex flex-col">
                <CardBody className="flex flex-1 flex-col">
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-skylight text-navy">
                      <IconComponent className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <Badge tone="info">{pillar.badge}</Badge>
                  </div>
                  <h3 className="text-base font-semibold text-navy">
                    {pillar.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    {pillar.description}
                  </p>
                </CardBody>
              </Card>
            );
          })}
        </div>
      </section>

      {/* How FairTicket Works */}
      <section aria-labelledby="how-it-works-heading">
        <Card>
          <CardHeader>
            <h2
              id="how-it-works-heading"
              className="text-lg font-bold text-navy"
            >
              How FairTicket works
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              From identity verification to scanned venue entry in four transparent
              steps.
            </p>
          </CardHeader>
          <CardBody className="py-6">
            <Stepper steps={HOW_IT_WORKS_STEPS} />
          </CardBody>
        </Card>
      </section>

      {/* FairTicket Trust Guardian Feature Highlight */}
      <section aria-labelledby="trust-guardian-heading">
        <Card className="border-sky/40 bg-skylight/30">
          <CardBody className="flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-navy">
                <ShieldCheck className="h-4 w-4 text-navy" aria-hidden="true" />
                <span>FairTicket Trust Guardian</span>
              </div>
              <h2
                id="trust-guardian-heading"
                className="text-xl font-bold text-navy"
              >
                Understand every MetaMask transaction before you sign
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-700">
                Before any wallet signature, Trust Guardian translates contract
                calls into plain English, verifies the official FairTicket contract
                address, checks ticket pricing against face value, and warns you
                about scalping or suspicious requests.
              </p>
            </div>
            <div className="shrink-0">
              <Button
                to="/trust-guardian/review"
                variant="primary"
                rightIcon={<ArrowRight className="h-4 w-4" />}
              >
                Open Trust Guardian
              </Button>
            </div>
          </CardBody>
        </Card>
      </section>

      {/* Demo Upcoming Events Preview */}
      <section aria-labelledby="demo-events-heading">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <Badge tone="info">Demo</Badge>
              <span className="text-xs font-medium text-slate-500">
                Sample preview cards — live events load in Prompt 10
              </span>
            </div>
            <h2
              id="demo-events-heading"
              className="text-xl font-bold tracking-tight text-navy sm:text-2xl"
            >
              Featured upcoming events
            </h2>
          </div>
          <Button
            to="/events"
            variant="secondary"
            size="sm"
            rightIcon={<ArrowRight className="h-4 w-4" />}
          >
            View all events
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {DEMO_PREVIEW_EVENTS.map((eventItem) => {
            const maxResalePaise = calculateMaxResalePricePaise(
              eventItem.faceValuePaise
            );

            return (
              <Card key={eventItem.id} className="flex flex-col">
                <CardHeader className="flex items-center justify-between gap-2">
                  <Badge tone="neutral">{eventItem.category}</Badge>
                  <Badge tone="info">Demo</Badge>
                </CardHeader>
                <CardBody className="flex flex-1 flex-col gap-3">
                  <h3 className="text-base font-semibold text-navy">
                    {eventItem.title}
                  </h3>
                  <div className="space-y-1.5 text-xs text-slate-600">
                    <p className="flex items-center gap-2">
                      <Calendar
                        className="h-3.5 w-3.5 shrink-0 text-slate-400"
                        aria-hidden="true"
                      />
                      <span>{eventItem.dateLabel}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <MapPin
                        className="h-3.5 w-3.5 shrink-0 text-slate-400"
                        aria-hidden="true"
                      />
                      <span>{eventItem.venue}</span>
                    </p>
                  </div>
                  <div className="mt-auto rounded-lg bg-offwhite px-3 py-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">Face value</span>
                      <span className="font-semibold text-navy">
                        {formatRupees(eventItem.faceValuePaise)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-slate-500">
                        Max resale ({RESALE_CAP_PERCENT}%)
                      </span>
                      <span className="font-medium text-slate-700">
                        {formatRupees(maxResalePaise)}
                      </span>
                    </div>
                  </div>
                </CardBody>
                <CardFooter>
                  <Button
                    to="/events"
                    variant="secondary"
                    size="sm"
                    fullWidth
                    leftIcon={<Ticket className="h-4 w-4" />}
                  >
                    Explore Event Listing
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Preserved Backend Health Check Section */}
      <section aria-labelledby="backend-status-heading">
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-navy" aria-hidden="true" />
              <h2
                id="backend-status-heading"
                className="text-sm font-semibold uppercase tracking-wide text-navy"
              >
                Backend Connection Status
              </h2>
            </div>
            <span className="font-mono text-xs text-slate-500">
              GET /api/v1/health
            </span>
          </CardHeader>

          <CardBody>
            {status === "loading" && (
              <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-4 text-slate-700">
                <Spinner size="sm" label="Checking FairTicket backend" />
                <p className="text-sm font-medium">
                  Checking connection to FairTicket backend...
                </p>
              </div>
            )}

            {status === "connected" && healthData && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-success">
                    <CheckCircle2
                      className="h-5 w-5 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="text-sm font-semibold">
                      Backend connected
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={retry}
                    leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                  >
                    Re-check
                  </Button>
                </div>

                <dl className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-700 sm:grid-cols-3">
                  <div>
                    <dt className="text-slate-500">Service</dt>
                    <dd className="font-mono font-medium text-navy">
                      {healthData.service}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Server Time (ISO)</dt>
                    <dd className="font-mono text-navy">{healthData.time}</dd>
                  </div>
                  {healthData.database && (
                    <div>
                      <dt className="text-slate-500">Database</dt>
                      <dd className="font-mono font-medium text-navy">
                        {healthData.database}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            {status === "error" && (
              <Alert variant="danger" title="Backend connection failed">
                <p>{healthError}</p>
                <div className="mt-3">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={retry}
                    leftIcon={<RefreshCw className="h-4 w-4" />}
                  >
                    Retry Connection
                  </Button>
                </div>
              </Alert>
            )}
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
