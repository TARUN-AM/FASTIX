import { Navigate, useLocation } from "react-router-dom";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { Badge, Button, Card, CardBody, Spinner } from "../ui";

/**
 * Route guard enforcing authentication and optional role-based access control.
 * - Unauthenticated visitors are redirected to /auth with `state.from` preserved.
 * - Authenticated users lacking a permitted role see an accessible 403 screen.
 */
export default function ProtectedRoute({ allowedRoles = null, children }) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading && !isAuthenticated) {
    return (
      <div className="mx-auto max-w-lg py-12">
        <Card>
          <CardBody className="flex items-center justify-center gap-3 py-10">
            <Spinner size="sm" label="Checking your session" />
            <p className="text-sm text-slate-600">Checking your session...</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/auth" replace state={{ from: location }} />;
  }

  if (
    Array.isArray(allowedRoles) &&
    allowedRoles.length > 0 &&
    !allowedRoles.includes(user.role)
  ) {
    return (
      <div className="mx-auto max-w-lg py-12" role="alert">
        <Card>
          <CardBody className="space-y-4 py-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-danger">
              <ShieldAlert className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <Badge tone="danger">403 Forbidden</Badge>
              <h1 className="text-xl font-bold text-navy">Access Denied</h1>
              <p className="text-sm text-slate-600">
                Your account role (
                <span className="font-semibold text-navy">{user.role}</span>)
                does not have permission to view this page.
              </p>
            </div>
            <div className="pt-2">
              <Button
                to="/"
                variant="primary"
                leftIcon={<ArrowLeft className="h-4 w-4" />}
              >
                Back to Home
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  return children;
}
