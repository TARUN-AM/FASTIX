import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import {
  Alert,
  Button,
  EmptyState,
  PageHeader,
  Skeleton,
  useToast,
} from "../components/ui";
import EventForm from "../components/events/EventForm";
import { createEvent, getEvent, updateEvent } from "../services/eventsApi";

export default function OrganizerEventFormPage({ mode = "create" }) {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const isEdit = mode === "edit";
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(isEdit);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!isEdit || !eventId) {
      return undefined;
    }

    const controller = new AbortController();
    let isActive = true;

    setLoading(true);
    setNotFound(false);
    setLoadError("");

    getEvent(eventId, { signal: controller.signal })
      .then(({ event: loaded }) => {
        if (!isActive) return;
        setEvent(loaded);
        setLoading(false);
      })
      .catch((err) => {
        if (
          !isActive ||
          err?.code === "ERR_CANCELED" ||
          err?.name === "CanceledError"
        ) {
          return;
        }
        if (err?.status === 404 || err?.code === "NOT_FOUND") {
          setNotFound(true);
        } else {
          setLoadError(err?.message || "Unable to load event for editing.");
        }
        setLoading(false);
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [isEdit, eventId]);

  const handleSubmit = async (payload) => {
    if (isEdit) {
      const updated = await updateEvent(eventId, payload);
      showToast({
        variant: "success",
        title: "Event updated",
        message: `"${updated.title}" has been saved.`,
      });
      navigate("/organizer");
    } else {
      const created = await createEvent(payload);
      showToast({
        variant: "success",
        title: "Draft event created",
        message: `"${created.title}" is saved as a draft. Publish it when ready.`,
      });
      navigate("/organizer");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/organizer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-navy hover:text-sky"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to My Events
        </Link>
      </div>

      <PageHeader
        breadcrumb="Organizer"
        title={isEdit ? "Edit Event" : "Create New Event"}
        subtitle={
          isEdit
            ? "Update draft details or revise the description of a published event."
            : "New events start as private drafts until you explicitly publish them."
        }
      />

      {loading && (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {!loading && notFound && (
        <EmptyState
          title="Event not found"
          description="This event does not exist or does not belong to your organizer account."
          action={
            <Button to="/organizer" variant="primary">
              Return to My Events
            </Button>
          }
        />
      )}

      {!loading && loadError && (
        <Alert variant="danger" title="Could not load event">
          {loadError}
        </Alert>
      )}

      {!loading && !notFound && !loadError && (!isEdit || event) && (
        <EventForm
          mode={mode}
          initialEvent={isEdit ? event : null}
          onSubmit={handleSubmit}
          onCancel={() => navigate("/organizer")}
        />
      )}
    </div>
  );
}
