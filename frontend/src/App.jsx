import { BrowserRouter, Route, Routes } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout";
import { ErrorBoundary, ToastProvider } from "./components/ui";
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
import NotFoundPage from "./pages/NotFoundPage";

/**
 * Root router mounting all 17 routes from ARCHITECTURE.md section 8 plus 404 fallback,
 * wrapped in ErrorBoundary, ToastProvider, and AppLayout.
 * Prompt 5 will add auth context and role-based ProtectedRoute guards.
 */
export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/auth" element={<AuthPage />} />
              <Route
                path="/verify-identity"
                element={<IdentityVerificationPage />}
              />
              <Route path="/events" element={<EventListingPage />} />
              <Route path="/events/:eventId" element={<EventDetailsPage />} />
              <Route
                path="/events/:eventId/queue"
                element={<RandomizedQueuePage />}
              />
              <Route path="/booking/:holdId" element={<TimedBookingPage />} />
              <Route
                path="/booking/:bookingId/confirmation"
                element={<BookingConfirmationPage />}
              />
              <Route path="/my-tickets" element={<MyTicketsPage />} />
              <Route path="/resale" element={<ResaleMarketplacePage />} />
              <Route
                path="/tickets/:ticketId/ownership-history"
                element={<TicketOwnershipHistoryPage />}
              />
              <Route
                path="/tickets/:ticketId/price-history"
                element={<TicketPriceHistoryPage />}
              />
              <Route
                path="/trust-guardian/review"
                element={<TrustGuardianReviewPage />}
              />
              <Route path="/gate/scanner" element={<QRScannerPage />} />
              <Route path="/gate/verify" element={<GateVerificationPage />} />
              <Route path="/admin" element={<AdminDashboardPage />} />
              <Route path="/organizer" element={<OrganizerDashboardPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
