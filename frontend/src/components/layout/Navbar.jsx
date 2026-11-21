import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { LogIn, LogOut, Menu, Ticket, X } from "lucide-react";
import { USER_ROLES } from "../../config/constants";
import { NAV_ITEMS } from "../../config/navigation";
import { useAuth } from "../../context/AuthContext";
import { Badge, Button, useToast } from "../ui";
import PageContainer from "./PageContainer";
import { cn } from "../../utils/classNames";

function getRoleBadgeMeta(role) {
  switch (role) {
    case USER_ROLES.ADMIN:
      return { label: "Admin", tone: "danger" };
    case USER_ROLES.ORGANIZER:
      return { label: "Organizer", tone: "info" };
    case USER_ROLES.GATE_STAFF:
      return { label: "Gate Staff", tone: "warning" };
    default:
      return { label: "Fan", tone: "neutral" };
  }
}

/**
 * Top navigation bar for FairTicket.
 * Dynamically filters navigation items based on the authenticated user's role
 * and provides sign-in / signed-in user + logout controls.
 */
export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuth();
  const { addToast } = useToast();

  const visibleNavItems = useMemo(() => {
    const activeRole =
      isAuthenticated && user?.role ? user.role : USER_ROLES.PUBLIC;
    return NAV_ITEMS.filter((item) => item.allowedRoles.includes(activeRole));
  }, [isAuthenticated, user]);

  const roleBadge = user ? getRoleBadgeMeta(user.role) : null;

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

  async function handleLogout() {
    await logout();
    setMobileMenuOpen(false);
    addToast({
      variant: "info",
      title: "Signed out",
      message: "You have been signed out of FairTicket.",
    });
    navigate("/", { replace: true });
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <PageContainer>
        <div className="flex h-16 items-center justify-between gap-4">
          <Link
            to="/"
            className="inline-flex shrink-0 items-center gap-2.5 rounded-md text-navy transition-colors duration-150 hover:text-slate-700"
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
            {visibleNavItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/"}
                className={({ isActive }) =>
                  cn(
                    "whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150",
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
            {isAuthenticated && user ? (
              <>
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-surface px-2.5 py-1.5">
                  <span className="max-w-[140px] truncate text-xs font-semibold text-navy">
                    {user.fullName}
                  </span>
                  {roleBadge && (
                    <Badge tone={roleBadge.tone}>{roleBadge.label}</Badge>
                  )}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleLogout}
                  leftIcon={<LogOut className="h-4 w-4" />}
                >
                  Logout
                </Button>
              </>
            ) : (
              <Button
                to="/auth"
                variant="primary"
                size="sm"
                leftIcon={<LogIn className="h-4 w-4" />}
              >
                Login
              </Button>
            )}
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
              {visibleNavItems.map((item) => (
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
                {isAuthenticated && user ? (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2">
                      <span className="truncate text-sm font-semibold text-navy">
                        {user.fullName}
                      </span>
                      {roleBadge && (
                        <Badge tone={roleBadge.tone}>{roleBadge.label}</Badge>
                      )}
                    </div>
                    <Button
                      variant="secondary"
                      size="md"
                      fullWidth
                      onClick={handleLogout}
                      leftIcon={<LogOut className="h-4 w-4" />}
                    >
                      Logout
                    </Button>
                  </div>
                ) : (
                  <Button
                    to="/auth"
                    variant="primary"
                    size="md"
                    fullWidth
                    leftIcon={<LogIn className="h-4 w-4" />}
                  >
                    Login
                  </Button>
                )}
              </div>
            </nav>
          </PageContainer>
        </div>
      )}
    </header>
  );
}
