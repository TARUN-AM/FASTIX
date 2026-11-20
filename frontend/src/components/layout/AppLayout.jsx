import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Navbar from "./Navbar";
import Footer from "./Footer";
import PageContainer from "./PageContainer";

/**
 * Shared shell layout wrapping all FairTicket routes.
 * Includes an accessible skip-to-content link, scroll restoration on route change,
 * Navbar, main PageContainer, and Footer.
 */
export default function AppLayout() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-offwhite text-navy">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-navy focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to main content
      </a>

      <Navbar />

      <main id="main-content" className="flex-1 py-8">
        <PageContainer>
          <Outlet />
        </PageContainer>
      </main>

      <Footer />
    </div>
  );
}
