import { Link } from "react-router-dom";
import { ShieldCheck, Ticket } from "lucide-react";
import PageContainer from "./PageContainer";
import ServerStatus from "./ServerStatus";

/**
 * Application footer with FairTicket tagline, demo disclaimer, quick links,
 * and shared backend ServerStatus indicator.
 */
export default function Footer() {
  return (
    <footer className="mt-auto border-t border-slate-200 bg-white">
      <PageContainer className="py-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-navy">
              <Ticket className="h-4 w-4 text-navy" aria-hidden="true" />
              <span className="text-sm font-bold tracking-tight">
                FairTicket
              </span>
              <span className="text-slate-300" aria-hidden="true">
                |
              </span>
              <span className="text-sm text-slate-600">
                Every Fan Deserves a Fair Ticket.
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Demo project. OTP, identity check and payments are simulated.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <nav
              aria-label="Footer navigation"
              className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-600"
            >
              <Link
                to="/events"
                className="transition-colors duration-150 hover:text-navy"
              >
                Events
              </Link>
              <Link
                to="/resale"
                className="transition-colors duration-150 hover:text-navy"
              >
                Resale
              </Link>
              <Link
                to="/trust-guardian/review"
                className="inline-flex items-center gap-1 transition-colors duration-150 hover:text-navy"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-navy" aria-hidden="true" />
                <span>Trust Guardian</span>
              </Link>
            </nav>
            <ServerStatus />
          </div>
        </div>
      </PageContainer>
    </footer>
  );
}
