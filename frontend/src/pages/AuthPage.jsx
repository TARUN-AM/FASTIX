import { useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  LogIn,
  LogOut,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { USER_ROLES } from "../config/constants";
import { useAuth } from "../context/AuthContext";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  useToast,
} from "../components/ui";
import { cn } from "../utils/classNames";

function parseFieldErrors(details) {
  const mapped = {};
  if (Array.isArray(details)) {
    for (const item of details) {
      if (item && typeof item.field === "string" && item.message) {
        if (!mapped[item.field]) {
          mapped[item.field] = item.message;
        }
      }
    }
  } else if (details && typeof details === "object") {
    for (const [key, value] of Object.entries(details)) {
      if (typeof value === "string") {
        mapped[key] = value;
      }
    }
  }
  return mapped;
}

function getDefaultDestination(role, isNewRegistration) {
  if (role === USER_ROLES.ADMIN) return "/admin";
  if (role === USER_ROLES.ORGANIZER) return "/organizer";
  if (role === USER_ROLES.GATE_STAFF) return "/gate/scanner";
  return isNewRegistration ? "/verify-identity" : "/";
}

function formatRoleLabel(role) {
  switch (role) {
    case USER_ROLES.ADMIN:
      return "Admin";
    case USER_ROLES.ORGANIZER:
      return "Organizer";
    case USER_ROLES.GATE_STAFF:
      return "Gate Staff";
    default:
      return "Fan";
  }
}

export default function AuthPage() {
  const { user, isAuthenticated, login, register, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { addToast } = useToast();

  const initialMode =
    searchParams.get("mode") === "register" ? "register" : "login";
  const [activeTab, setActiveTab] = useState(initialMode);

  // Sign In state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Create Account state
  const [fullName, setFullName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [banner, setBanner] = useState(null);

  const redirectFrom =
    location.state?.from?.pathname && location.state.from.pathname !== "/auth"
      ? `${location.state.from.pathname}${location.state.from.search || ""}`
      : null;

  function switchTab(nextTab) {
    setActiveTab(nextTab);
    setFieldErrors({});
    setBanner(null);
    if (nextTab === "register") {
      setSearchParams({ mode: "register" }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  }

  function handleAuthError(err) {
    const parsedFields = parseFieldErrors(err?.details);
    setFieldErrors(parsedFields);

    if (err?.code === "ACCOUNT_LOCKED" || err?.status === 423) {
      setBanner({
        variant: "warning",
        title: "Account temporarily locked",
        message:
          err.message ||
          "Too many failed sign-in attempts. Please wait before trying again.",
      });
      return;
    }

    if (err?.code === "RATE_LIMITED" || err?.status === 429) {
      setBanner({
        variant: "warning",
        title: "Too many attempts",
        message:
          err.message || "Please wait a few minutes before trying again.",
      });
      return;
    }

    if (err?.code === "INVALID_CREDENTIALS") {
      setBanner({
        variant: "danger",
        title: "Sign in failed",
        message: err.message || "Invalid email or password.",
      });
      return;
    }

    if (err?.code === "ALREADY_EXISTS" || err?.status === 409) {
      setBanner({
        variant: "danger",
        title: "Account already exists",
        message:
          err.message ||
          "An account with these details already exists. Try signing in instead.",
      });
      return;
    }

    if (Object.keys(parsedFields).length > 0) {
      setBanner({
        variant: "danger",
        title: "Please review your details",
        message: err.message || "Fix the highlighted fields and try again.",
      });
      return;
    }

    setBanner({
      variant: "danger",
      title: "Unable to complete request",
      message: err?.message || "Something went wrong. Please try again.",
    });
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();
    setFieldErrors({});
    setBanner(null);

    const localErrors = {};
    if (!loginEmail.trim()) {
      localErrors.email = "Email is required.";
    }
    if (!loginPassword) {
      localErrors.password = "Password is required.";
    }
    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    setSubmitting(true);
    try {
      const result = await login({
        email: loginEmail.trim(),
        password: loginPassword,
      });
      const destination =
        redirectFrom || getDefaultDestination(result.user.role, false);
      addToast({
        variant: "success",
        title: "Welcome back",
        message: `Signed in as ${result.user.fullName}.`,
      });
      navigate(destination, { replace: true });
    } catch (err) {
      handleAuthError(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegisterSubmit(event) {
    event.preventDefault();
    setFieldErrors({});
    setBanner(null);

    const localErrors = {};
    if (fullName.trim().length < 2) {
      localErrors.fullName = "Full name must be at least 2 characters long.";
    }
    if (!regEmail.trim()) {
      localErrors.email = "Email is required.";
    }
    if (!phone.trim()) {
      localErrors.phone = "Mobile number is required.";
    }
    if (regPassword.length < 10) {
      localErrors.password = "Password must be at least 10 characters long.";
    }
    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      return;
    }

    setSubmitting(true);
    try {
      const result = await register({
        fullName: fullName.trim(),
        email: regEmail.trim(),
        phone: phone.trim(),
        password: regPassword,
      });
      const destination =
        redirectFrom || getDefaultDestination(result.user.role, true);
      addToast({
        variant: "success",
        title: "Account created",
        message: "Welcome to FairTicket! Continue by verifying your account.",
      });
      navigate(destination, { replace: true });
    } catch (err) {
      handleAuthError(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    await logout();
    addToast({
      variant: "info",
      title: "Signed out",
      message: "Your FairTicket session has ended.",
    });
  }

  if (isAuthenticated && user) {
    const homeForRole = getDefaultDestination(user.role, false);
    return (
      <div className="mx-auto max-w-lg py-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold text-navy">
                  You are signed in
                </h1>
                <p className="mt-0.5 text-sm text-slate-600">
                  Signed in as {user.fullName} ({user.email})
                </p>
              </div>
              <Badge tone="info">{formatRoleLabel(user.role)}</Badge>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                to={homeForRole}
                variant="primary"
                rightIcon={<ArrowRight className="h-4 w-4" />}
              >
                Continue to FairTicket
              </Button>
              <Button
                variant="secondary"
                onClick={handleSignOut}
                leftIcon={<LogOut className="h-4 w-4" />}
              >
                Sign Out
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-6 py-4 lg:grid-cols-12 lg:items-start">
      <div className="space-y-4 lg:col-span-5">
        <div className="inline-flex items-center gap-2 rounded-lg bg-skylight px-3 py-1.5 text-xs font-semibold text-navy">
          <ShieldCheck className="h-4 w-4 text-navy" aria-hidden="true" />
          Verified Fan Accounts
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-navy sm:text-3xl">
          Every fan deserves a fair shot at face-value tickets.
        </h1>
        <p className="text-sm leading-relaxed text-slate-600">
          Create your FairTicket account to verify your identity, join fair
          randomized event queues, buy face-value tickets, or trade safely on
          the capped resale marketplace.
        </p>

        <Card className="bg-skylight/30">
          <CardBody className="space-y-2.5 text-xs text-slate-700">
            <div className="flex items-start gap-2.5">
              <Lock
                className="mt-0.5 h-4 w-4 shrink-0 text-navy"
                aria-hidden="true"
              />
              <div>
                <p className="font-semibold text-navy">
                  Protected active-tab session
                </p>
                <p className="mt-0.5 text-slate-600">
                  Your sign-in session stays in memory while this tab is open
                  and clears automatically if you refresh or close the tab.
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="lg:col-span-7">
        <Card>
          <CardHeader className="pb-0">
            <div
              role="tablist"
              aria-label="Authentication options"
              className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1"
            >
              <button
                type="button"
                role="tab"
                id="tab-login"
                aria-selected={activeTab === "login"}
                aria-controls="panel-login"
                onClick={() => switchTab("login")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors duration-150",
                  activeTab === "login"
                    ? "bg-white text-navy shadow-sm"
                    : "text-slate-600 hover:text-navy"
                )}
              >
                <LogIn className="h-4 w-4" aria-hidden="true" />
                Sign In
              </button>
              <button
                type="button"
                role="tab"
                id="tab-register"
                aria-selected={activeTab === "register"}
                aria-controls="panel-register"
                onClick={() => switchTab("register")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors duration-150",
                  activeTab === "register"
                    ? "bg-white text-navy shadow-sm"
                    : "text-slate-600 hover:text-navy"
                )}
              >
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                Create Account
              </button>
            </div>
          </CardHeader>

          <CardBody className="space-y-4 pt-5">
            {redirectFrom && (
              <Alert variant="info" title="Sign in required">
                Please sign in or create an account to continue to{" "}
                <span className="font-mono text-xs">{redirectFrom}</span>.
              </Alert>
            )}

            {banner && (
              <Alert
                variant={banner.variant}
                title={banner.title}
                onDismiss={() => setBanner(null)}
              >
                {banner.message}
              </Alert>
            )}

            {activeTab === "login" ? (
              <form
                id="panel-login"
                role="tabpanel"
                aria-labelledby="tab-login"
                onSubmit={handleLoginSubmit}
                noValidate
                className="space-y-4"
              >
                <Input
                  label="Email address"
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder="fan@example.com"
                  required
                  value={loginEmail}
                  onChange={(e) => {
                    setLoginEmail(e.target.value);
                    if (fieldErrors.email) {
                      setFieldErrors((prev) => ({ ...prev, email: "" }));
                    }
                  }}
                  error={fieldErrors.email || ""}
                  disabled={submitting}
                />

                <div className="relative">
                  <Input
                    label="Password"
                    type={showLoginPassword ? "text" : "password"}
                    name="password"
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    required
                    value={loginPassword}
                    onChange={(e) => {
                      setLoginPassword(e.target.value);
                      if (fieldErrors.password) {
                        setFieldErrors((prev) => ({ ...prev, password: "" }));
                      }
                    }}
                    error={fieldErrors.password || ""}
                    inputClassName="pr-10"
                    disabled={submitting}
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword((prev) => !prev)}
                    aria-label={
                      showLoginPassword ? "Hide password" : "Show password"
                    }
                    className="absolute right-2.5 top-[34px] rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-navy"
                  >
                    {showLoginPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  fullWidth
                  isLoading={submitting}
                  leftIcon={<LogIn className="h-4 w-4" />}
                >
                  Sign In
                </Button>

                <p className="text-center text-xs text-slate-600">
                  New to FairTicket?{" "}
                  <button
                    type="button"
                    onClick={() => switchTab("register")}
                    className="font-semibold text-navy underline-offset-2 hover:underline"
                  >
                    Create a fan account
                  </button>
                </p>
              </form>
            ) : (
              <form
                id="panel-register"
                role="tabpanel"
                aria-labelledby="tab-register"
                onSubmit={handleRegisterSubmit}
                noValidate
                className="space-y-4"
              >
                <Input
                  label="Full name"
                  type="text"
                  name="fullName"
                  autoComplete="name"
                  placeholder="Aarav Sharma"
                  hint="Enter the same name you will use during identity verification."
                  required
                  value={fullName}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    if (fieldErrors.fullName) {
                      setFieldErrors((prev) => ({ ...prev, fullName: "" }));
                    }
                  }}
                  error={fieldErrors.fullName || ""}
                  disabled={submitting}
                />

                <Input
                  label="Email address"
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder="aarav@example.com"
                  required
                  value={regEmail}
                  onChange={(e) => {
                    setRegEmail(e.target.value);
                    if (fieldErrors.email) {
                      setFieldErrors((prev) => ({ ...prev, email: "" }));
                    }
                  }}
                  error={fieldErrors.email || ""}
                  disabled={submitting}
                />

                <Input
                  label="Mobile number"
                  type="tel"
                  name="phone"
                  autoComplete="tel"
                  placeholder="9876543210 or +919876543210"
                  hint="10-digit Indian mobile numbers are saved with +91 automatically."
                  required
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    if (fieldErrors.phone) {
                      setFieldErrors((prev) => ({ ...prev, phone: "" }));
                    }
                  }}
                  error={fieldErrors.phone || ""}
                  disabled={submitting}
                />

                <div className="relative">
                  <Input
                    label="Password"
                    type={showRegPassword ? "text" : "password"}
                    name="password"
                    autoComplete="new-password"
                    placeholder="At least 10 characters with a letter and number"
                    hint="Use 10 to 72 characters with at least one letter and one number. Avoid common passwords."
                    required
                    value={regPassword}
                    onChange={(e) => {
                      setRegPassword(e.target.value);
                      if (fieldErrors.password) {
                        setFieldErrors((prev) => ({ ...prev, password: "" }));
                      }
                    }}
                    error={fieldErrors.password || ""}
                    inputClassName="pr-10"
                    disabled={submitting}
                  />
                  <button
                    type="button"
                    onClick={() => setShowRegPassword((prev) => !prev)}
                    aria-label={
                      showRegPassword ? "Hide password" : "Show password"
                    }
                    className="absolute right-2.5 top-[34px] rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-navy"
                  >
                    {showRegPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  fullWidth
                  isLoading={submitting}
                  leftIcon={<UserPlus className="h-4 w-4" />}
                >
                  Create Account
                </Button>

                <p className="text-center text-xs text-slate-600">
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => switchTab("login")}
                    className="font-semibold text-navy underline-offset-2 hover:underline"
                  >
                    Sign in
                  </button>
                </p>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
