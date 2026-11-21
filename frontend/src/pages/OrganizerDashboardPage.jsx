import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Ban,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Send,
} from "lucide-react";
import {
  Alert,
  Button,
  EmptyState,
  Modal,
  PageHeader,
  Skeleton,
  StatusPill,
  Table,
  Textarea,
  useToast,
} from "../components/ui";
import {
  cancelEvent,
  listMyEvents,
  publishEvent,
} from "../services/eventsApi";
import { formatDateTime } from "../utils/formatDate";
import { formatRupees } from "../utils/formatMoney";

const PAGE_SIZE = 12;
const CANCELLABLE_STATUSES = new Set([
  "DRAFT",
  "PUBLISHED",
  "REGISTRATION_OPEN",
  "QUEUE_ALLOCATED",
  "BOOKING_OPEN",
]);

function getFriendlyConflictMessage(err, fallback) {
  switch (err?.code) {
    case "EVENT_LOCKED":
      return "This event is locked because it has already been published or cancelled.";
    case "INVALID_EVENT_STATE":
      return (
        err?.message ||
        "This event changed state before your action completed. The list has been refreshed."
      );
    case "EVENT_REGISTRATION_ALREADY_CLOSED":
      return "Cannot publish because the registration close time has already passed. Edit the draft schedule first.";
    case "EVENT_HAS_BOOKINGS":
      return "Events with bookings cannot be cancelled yet because refund handling is not built in this version.";
    default:
      return err?.message || fallback;
  }
}

export default function OrganizerDashboardPage() {
  const { showToast } = useToast();

  const [page, setPage] = useState(1);
  const [data, setData] = useState({
    items: [],
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  // Publish confirmation modal state
  const [publishTarget, setPublishTarget] = useState(null);
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishError, setPublishError] = useState("");

  // Cancel modal state
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let isActive = true;

    setLoading(true);
    setError("");

    listMyEvents({ page, limit: PAGE_SIZE }, { signal: controller.signal })
      .then((result) => {
        if (!isActive) return;
        setData(result);
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
        setError(err?.message || "Unable to load your events.");
        setLoading(false);
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [page, reloadTick]);

  const refreshEvents = useCallback(() => {
    setReloadTick((n) => n + 1);
  }, []);

  const handleConfirmPublish = async () => {
    if (!publishTarget || publishLoading) return;
    setPublishLoading(true);
    setPublishError("");
    try {
      await publishEvent(publishTarget.id);
      showToast({
        variant: "success",
        title: "Event published",
        message: `"${publishTarget.title}" is now visible to the public.`,
      });
      setPublishTarget(null);
      refreshEvents();
    } catch (err) {
      const msg = getFriendlyConflictMessage(
        err,
        "Unable to publish this event."
      );
      setPublishError(msg);
      if (err?.status === 409) {
        refreshEvents();
      }
    } finally {
      setPublishLoading(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancelTarget || cancelLoading) return;
    const trimmed = cancelReason.trim();
    if (trimmed.length < 3 || trimmed.length > 300) {
      setCancelError("Cancellation reason must be between 3 and 300 characters.");
      return;
    }
    if (/[<>]/.test(trimmed)) {
      setCancelError('Cancellation reason must not contain "<" or ">" characters.');
      return;
    }

    setCancelLoading(true);
    setCancelError("");
    try {
      await cancelEvent(cancelTarget.id, trimmed);
      showToast({
        variant: "info",
        title: "Event cancelled",
        message: `"${cancelTarget.title}" has been marked as cancelled.`,
      });
      setCancelTarget(null);
      setCancelReason("");
      refreshEvents();
    } catch (err) {
      const msg = getFriendlyConflictMessage(
        err,
        "Unable to cancel this event."
      );
      setCancelError(msg);
      if (err?.status === 409) {
        refreshEvents();
      }
    } finally {
      setCancelLoading(false);
    }
  };

  const displayTotalPages = Math.max(1, data.totalPages || 0);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb="Organizer"
        title="My Events"
        subtitle="Create draft events, publish them for fair-queue registration, or cancel eligible events."
        actions={
          <Button to="/organizer/new" variant="primary">
            <CalendarPlus className="h-4 w-4" aria-hidden="true" />
            Create event
          </Button>
        }
      />

      <div aria-live="polite" className="text-sm text-slate-600">
        {loading
          ? "Loading your events..."
          : error
          ? "Unable to load your events."
          : `${data.total} event${data.total === 1 ? "" : "s"} created under your organizer account.`}
      </div>

      {!loading && error && (
        <Alert
          variant="danger"
          title="Could not load your events"
          actions={
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={refreshEvents}
            >
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {!loading && !error && data.items.length === 0 && (
        <EmptyState
          icon={CalendarPlus}
          title="You have not created any events yet"
          description="Start by creating a draft event. You can review every field before publishing it to fans."
          action={
            <Button to="/organizer/new" variant="primary">
              Create your first event
            </Button>
          }
        />
      )}

      {!loading && !error && data.items.length > 0 && (
        <>
          <Table caption="Organizer events">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Start date</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Tickets (avail / total)</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((event) => {
                const canEdit = event.status !== "CANCELLED";
                const canPublish = event.status === "DRAFT";
                const canCancel = CANCELLABLE_STATUSES.has(event.status);

                return (
                  <tr key={event.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <Link
                        to={`/events/${event.id}`}
                        className="font-semibold text-navy hover:text-sky hover:underline"
                      >
                        {event.title}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {event.venueName}, {event.city}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusPill status={event.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                      {formatDateTime(event.eventDate)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-navy">
                      {formatRupees(event.basePricePaise)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700">
                      {event.availableTickets} / {event.totalTickets}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {canEdit && (
                          <Button
                            to={`/organizer/${event.id}/edit`}
                            variant="secondary"
                            size="sm"
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            Edit
                          </Button>
                        )}
                        {canPublish && (
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            onClick={() => {
                              setPublishError("");
                              setPublishTarget(event);
                            }}
                          >
                            <Send className="h-3.5 w-3.5" aria-hidden="true" />
                            Publish
                          </Button>
                        )}
                        {canCancel && (
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            onClick={() => {
                              setCancelError("");
                              setCancelReason("");
                              setCancelTarget(event);
                            }}
                          >
                            <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                            Cancel
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>

          {displayTotalPages > 1 && (
            <nav
              aria-label="My events pagination"
              className="flex flex-wrap items-center justify-between gap-3 pt-2"
            >
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Previous
              </Button>
              <span className="text-sm font-medium text-navy">
                Page {page} of {displayTotalPages}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={page >= displayTotalPages}
                onClick={() => setPage((p) => Math.min(displayTotalPages, p + 1))}
              >
                Next
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </nav>
          )}
        </>
      )}

      {/* Publish Confirmation Modal */}
      <Modal
        isOpen={Boolean(publishTarget)}
        onClose={() => {
          if (!publishLoading) {
            setPublishTarget(null);
            setPublishError("");
          }
        }}
        title="Publish event?"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={publishLoading}
              onClick={() => {
                setPublishTarget(null);
                setPublishError("");
              }}
            >
              Keep as draft
            </Button>
            <Button
              type="button"
              variant="primary"
              isLoading={publishLoading}
              disabled={publishLoading}
              onClick={handleConfirmPublish}
            >
              Confirm publish
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {publishError && (
            <Alert variant="danger" title="Could not publish">
              {publishError}
            </Alert>
          )}
          <p>
            Publishing{" "}
            <strong className="font-semibold text-navy">
              {publishTarget?.title}
            </strong>{" "}
            makes it visible to all public visitors immediately.
          </p>
          <div className="rounded-lg border border-slate-200 bg-offwhite p-3.5 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-navy">
              Fields that will lock after publishing:
            </p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-slate-700">
              <li>Event title, venue name, and city</li>
              <li>Registration open, registration close, and event start times</li>
              <li>Ticket face value and 110% resale cap</li>
              <li>Total ticket supply, max tickets per person, and hold duration</li>
            </ul>
            <p className="text-xs text-slate-600">
              Only the plain-text <strong>description</strong> can be edited
              after publishing.
            </p>
          </div>
        </div>
      </Modal>

      {/* Cancel Event Modal */}
      <Modal
        isOpen={Boolean(cancelTarget)}
        onClose={() => {
          if (!cancelLoading) {
            setCancelTarget(null);
            setCancelReason("");
            setCancelError("");
          }
        }}
        title="Cancel event?"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={cancelLoading}
              onClick={() => {
                setCancelTarget(null);
                setCancelReason("");
                setCancelError("");
              }}
            >
              Keep event
            </Button>
            <Button
              type="button"
              variant="danger"
              isLoading={cancelLoading}
              disabled={cancelLoading}
              onClick={handleConfirmCancel}
            >
              Confirm cancellation
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {cancelError && (
            <Alert variant="danger" title="Could not cancel event">
              {cancelError}
            </Alert>
          )}
          <p>
            Cancelling{" "}
            <strong className="font-semibold text-navy">
              {cancelTarget?.title}
            </strong>{" "}
            is permanent and removes it from public search results. Visitors who
            open a direct link will see your cancellation reason.
          </p>
          <Textarea
            id="cancel-event-reason"
            label="Cancellation reason"
            required
            rows={3}
            disabled={cancelLoading}
            placeholder="Explain why this event is being cancelled (3 to 300 characters)."
            value={cancelReason}
            onChange={(e) => {
              setCancelReason(e.target.value);
              if (cancelError) setCancelError("");
            }}
            maxLength={300}
          />
        </div>
      </Modal>
    </div>
  );
}
