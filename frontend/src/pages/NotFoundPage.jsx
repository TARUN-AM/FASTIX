import { Compass } from "lucide-react";
import { Button, EmptyState, PageHeader } from "../components/ui";

export default function NotFoundPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Error 404"
        title="Page not found"
        subtitle="The address you opened does not match any FairTicket route."
      />

      <EmptyState
        icon={<Compass className="h-6 w-6" aria-hidden="true" />}
        title="We could not find that page"
        description="Check the URL or return to the FairTicket home page to browse events, official capped resale listings, and verified ticketing tools."
        action={
          <Button to="/" variant="primary">
            Go to Home
          </Button>
        }
      />
    </div>
  );
}
