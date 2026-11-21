import { BrowserRouter, Route, Routes } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout";
import ProtectedRoute from "./components/common/ProtectedRoute";
import { ErrorBoundary, ToastProvider } from "./components/ui";
import { ALL_AUTHENTICATED_ROLES, USER_ROLES } from "./config/constants";
import { AuthProvider } from "./context/AuthContext";
import HomePage from "./pages/HomePage";
import AuthPage from "./pages/AuthPage";
import IdentityVerificationPage from "./pages/IdentityVerificationPage";
import EventListingPage from "./pages/EventListingPage";
import EventDetailsPage from "./pages/EventDetailsPage";
import RandomizedQueuePage from "./pages/RandomizedQueuePage";
import TimedBookingPage from "./pages/TimedBookingPage";
import BookingConfirmationPage from "./pages/BookingConfirmationPage";
import MyTicketsPage from "./pages/MyTicketsPage";
import ResaleMarketplacePage from "./pages/ResaleMarketplacePage";
import TicketOwnershipHistoryPage from "./pages/TicketOwnershipHistoryPage";
import TicketPriceHistoryPage from "./pages/TicketPriceHistoryPage";
import TrustGuardianReviewPage from "./pages/TrustGuardianReviewPage";
import QRScannerPage from "./pages/QRScannerPage";
import GateVerificationPage from "./pages/GateVerificationPage";
import AdminDashboardPage from "./pages/AdminDashboardPage";
import OrganizerDashboardPage from "./pages/OrganizerDashboardPage";
import OrganizerEventFormPage from "./pages/OrganizerEventFormPage";
import DesignSystemPage from "./pages/DesignSystemPage";
import NotFoundPage from "./pages/NotFoundPage";

/**
 * Root router mounting all FairTicket pages from ARCHITECTURE.md section 8 plus 404 fallback,
 * wrapped in ErrorBoundary, ToastProvider, AuthProvider, and AppLayout with role-based
 * ProtectedRoute guards.
 */
export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<AppLayout />}>
                {/* Public routes */}
                <Route path="/" element={<HomePage />} />
                <Route path="/auth" element={<AuthPage />} />
                <Route path="/events" element={<EventListingPage />} />
                <Route path="/events/:eventId" element={<EventDetailsPage />} />
                <Route path="/resale" element={<ResaleMarketplacePage />} />

                {/* All authenticated roles */}
                <Route
                  path="/verify-identity"
                  element={
                    <ProtectedRoute allowedRoles={ALL_AUTHENTICATED_ROLES}>
                      <IdentityVerificationPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/my-tickets"
                  element={
                    <ProtectedRoute allowedRoles={ALL_AUTHENTICATED_ROLES}>
                      <MyTicketsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/tickets/:ticketId/ownership-history"
                  element={
                    <ProtectedRoute allowedRoles={ALL_AUTHENTICATED_ROLES}>
                      <TicketOwnershipHistoryPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/tickets/:ticketId/price-history"
                  element={
                    <ProtectedRoute allowedRoles={ALL_AUTHENTICATED_ROLES}>
                      <TicketPriceHistoryPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/trust-guardian/review"
                  element={
                    <ProtectedRoute allowedRoles={ALL_AUTHENTICATED_ROLES}>
                      <TrustGuardianReviewPage />
                    </ProtectedRoute>
                  }
                />

                {/* Customer booking routes */}
                <Route
                  path="/events/:eventId/queue"
                  element={
                    <ProtectedRoute allowedRoles={[USER_ROLES.CUSTOMER]}>
                      <RandomizedQueuePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/booking/:holdId"
                  element={
                    <ProtectedRoute allowedRoles={[USER_ROLES.CUSTOMER]}>
                      <TimedBookingPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/booking/:bookingId/confirmation"
                  element={
                    <ProtectedRoute
                      allowedRoles={[USER_ROLES.CUSTOMER, USER_ROLES.ADMIN]}
                    >
                      <BookingConfirmationPage />
                    </ProtectedRoute>
                  }
                />

                {/* Gate staff & admin routes */}
                <Route
                  path="/gate/scanner"
                  element={
                    <ProtectedRoute
                      allowedRoles={[USER_ROLES.GATE_STAFF, USER_ROLES.ADMIN]}
                    >
                      <QRScannerPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/gate/verify"
                  element={
                    <ProtectedRoute
                      allowedRoles={[USER_ROLES.GATE_STAFF, USER_ROLES.ADMIN]}
                    >
                      <GateVerificationPage />
                    </ProtectedRoute>
                  }
                />

                {/* Organizer routes */}
                <Route
                  path="/organizer"
                  element={
                    <ProtectedRoute allowedRoles={[USER_ROLES.ORGANIZER]}>
                      <OrganizerDashboardPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/organizer/new"
                  element={
                    <ProtectedRoute allowedRoles={[USER_ROLES.ORGANIZER]}>
                      <OrganizerEventFormPage mode="create" />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/organizer/:eventId/edit"
                  element={
                    <ProtectedRoute allowedRoles={[USER_ROLES.ORGANIZER]}>
                      <OrganizerEventFormPage mode="edit" />
                    </ProtectedRoute>
                  }
                />

                {/* Admin route */}
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute allowedRoles={[USER_ROLES.ADMIN]}>
                      <AdminDashboardPage />
                    </ProtectedRoute>
                  }
                />

                {import.meta.env.DEV && (
                  <Route
                    path="/dev/design-system"
                    element={<DesignSystemPage />}
                  />
                )}

                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
