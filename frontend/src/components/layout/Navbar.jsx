import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { LogIn, Menu, Ticket, X } from "lucide-react";
import { PUBLIC_CUSTOMER_NAV_ITEMS } from "../../config/navigation";
import { Button } from "../ui";
import PageContainer from "./PageContainer";
import { cn } from "../../utils/classNames";

/**
 * Top navigation bar for FairTicket.
 * Displays public/customer links and a placeholder Login button targeting /auth.
 * Prompt 5 will filter navigation items dynamically based on the logged-in user's role.
 */
export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  // Close mobile menu on route navigation
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Close mobile menu on Escape key
  useEffect(() => {
    if (!mobileMenuOpen) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileMenuOpen]);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <PageContainer>
        <div className="flex h-16 items-center justify-between gap-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2.5 rounded-md text-navy transition-colors duration-150 hover:text-slate-700"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy text-white">
              <Ticket className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="text-lg font-bold tracking-tight">FairTicket</span>
          </Link>

          <nav
            aria-label="Primary navigation"
            className="hidden items-center gap-1 md:flex"
          >
            {PUBLIC_CUSTOMER_NAV_ITEMS.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/"}
                className={({ isActive }) =>
                  cn(
                    "rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150",
                    isActive
                      ? "bg-skylight text-navy"
                      : "text-slate-600 hover:bg-slate-100 hover:text-navy"
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            {/* Prompt 5 replaces this placeholder button with authenticated user menu & role-filtered nav */}
            <Button
              to="/auth"
              variant="primary"
              size="sm"
              leftIcon={<LogIn className="h-4 w-4" />}
            >
              Login
            </Button>
          </div>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-nav-panel"
            aria-label={
              mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"
            }
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-2 text-navy transition-colors duration-150 hover:bg-slate-100 md:hidden"
          >
            {mobileMenuOpen ? (
              <X className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>
      </PageContainer>

      {mobileMenuOpen && (
        <div
          id="mobile-nav-panel"
          className="border-t border-slate-200 bg-white md:hidden"
        >
          <PageContainer className="py-3">
            <nav
              aria-label="Mobile navigation"
              className="flex flex-col gap-1"
            >
              {PUBLIC_CUSTOMER_NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === "/"}
                  className={({ isActive }) =>
                    cn(
                      "rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150",
                      isActive
                        ? "bg-skylight text-navy"
                        : "text-slate-600 hover:bg-slate-100 hover:text-navy"
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              <div className="mt-2 border-t border-slate-100 pt-3">
                <Button
                  to="/auth"
                  variant="primary"
                  size="md"
                  fullWidth
                  leftIcon={<LogIn className="h-4 w-4" />}
                >
                  Login
                </Button>
              </div>
            </nav>
          </PageContainer>
        </div>
      )}
    </header>
  );
}
