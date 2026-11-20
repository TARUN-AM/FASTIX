import { ArrowLeft, Wrench } from "lucide-react";
import { getRouteMeta } from "../../config/routes";
import { Badge, Button, EmptyState, PageHeader } from "../ui";

/**
 * Shared placeholder layout for upcoming FairTicket pages defined in
 * ARCHITECTURE.md section 8. Renders no fake data and no fake forms.
 */
export default function PlaceholderPage({ routeKey }) {
  const meta = getRouteMeta(routeKey);

  if (!meta) {
    return (
      <EmptyState
        title="Page configuration missing"
        description="This route is not registered in the FairTicket route table."
        action={
          <Button to="/" variant="secondary">
            Back to Home
          </Button>
        }
      />
    );
  }

  return (
    <div>
      <PageHeader
        breadcrumb={`Route ${meta.path}`}
        title={meta.name}
        subtitle={`Planned for Prompt ${meta.builtInPrompt} of the FairTicket build sequence.`}
        actions={<Badge tone="info">Prompt {meta.builtInPrompt}</Badge>}
      />

      <EmptyState
        icon={<Wrench className="h-6 w-6" aria-hidden="true" />}
        title={meta.name}
        description={`This page will be built in Prompt ${meta.builtInPrompt}.`}
        action={
          <div className="flex flex-col items-center gap-3">
            <Button
              to="/"
              variant="secondary"
              leftIcon={<ArrowLeft className="h-4 w-4" />}
            >
              Back to Home
            </Button>
            <p className="text-xs text-slate-500">
              Allowed access: {meta.accessLabel}
            </p>
          </div>
        }
      />
    </div>
  );
}
