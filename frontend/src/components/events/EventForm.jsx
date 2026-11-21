import { useMemo, useState } from "react";
import { Clock } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardBody,
  Input,
  Select,
  Textarea,
} from "../ui";
import {
  calculateMaxResalePrice,
  formatPaiseToRupeeInput,
  formatRupees,
  parseRupeesToPaise,
} from "../../utils/formatMoney";

const EVENT_MIN_PRICE_PAISE = 10000;
const EVENT_MAX_PRICE_PAISE = 50000000;
const EVENT_MAX_TOTAL_TICKETS = 100000;
const MIN_HOLD_MINUTES = 1;
const MAX_HOLD_MINUTES = 15;
const MAX_DESCRIPTION_LENGTH = 2000;
const ANGLE_BRACKETS_REGEX = /[<>]/;

const MAX_PER_USER_OPTIONS = [
  { value: "1", label: "1 ticket per person" },
  { value: "2", label: "2 tickets per person" },
];

function toDatetimeLocalValue(isoOrDate) {
  if (!isoOrDate) return "";
  const date = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildInitialState(initialEvent) {
  if (!initialEvent) {
    return {
      title: "",
      description: "",
      venueName: "",
      city: "",
      eventDate: "",
      registrationOpenAt: "",
      registrationCloseAt: "",
      priceRupees: "",
      totalTickets: "",
      maxTicketsPerIdentity: "2",
      holdDurationMinutes: "5",
    };
  }

  return {
    title: initialEvent.title || "",
    description: initialEvent.description || "",
    venueName: initialEvent.venueName || "",
    city: initialEvent.city || "",
    eventDate: toDatetimeLocalValue(initialEvent.eventDate),
    registrationOpenAt: toDatetimeLocalValue(initialEvent.registrationOpenAt),
    registrationCloseAt: toDatetimeLocalValue(initialEvent.registrationCloseAt),
    priceRupees: formatPaiseToRupeeInput(initialEvent.basePricePaise),
    totalTickets:
      initialEvent.totalTickets !== undefined
        ? String(initialEvent.totalTickets)
        : "",
    maxTicketsPerIdentity:
      initialEvent.maxTicketsPerIdentity !== undefined
        ? String(initialEvent.maxTicketsPerIdentity)
        : "2",
    holdDurationMinutes:
      initialEvent.holdDurationMinutes !== undefined
        ? String(initialEvent.holdDurationMinutes)
        : "5",
  };
}

function mapServerFieldErrors(err) {
  const mapped = {};
  if (Array.isArray(err?.details)) {
    for (const item of err.details) {
      if (item && typeof item.field === "string" && typeof item.message === "string") {
        const key = item.field === "basePricePaise" ? "priceRupees" : item.field;
        if (!mapped[key]) {
          mapped[key] = item.message;
        }
      }
    }
  }
  return mapped;
}

/**
 * Accessible organizer event creation & editing form.
 * Client-side validation mirrors backend rules for UX only; the backend enforces all rules.
 */
export default function EventForm({
  mode = "create",
  initialEvent = null,
  onSubmit,
  onCancel,
}) {
  const isEdit = mode === "edit";
  const isLockedAfterPublish =
    isEdit && initialEvent && initialEvent.status !== "DRAFT";
  const isCancelled =
    isEdit && initialEvent && initialEvent.status === "CANCELLED";

  const [values, setValues] = useState(() => buildInitialState(initialEvent));
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const parsedPricePreviewPaise = useMemo(
    () => parseRupeesToPaise(values.priceRupees),
    [values.priceRupees]
  );

  const maxResalePreviewPaise = useMemo(() => {
    if (
      parsedPricePreviewPaise === null ||
      parsedPricePreviewPaise < EVENT_MIN_PRICE_PAISE
    ) {
      return null;
    }
    return calculateMaxResalePrice(parsedPricePreviewPaise);
  }, [parsedPricePreviewPaise]);

  function handleChange(field) {
    return (e) => {
      const nextVal = e.target.value;
      setValues((prev) => ({ ...prev, [field]: nextVal }));
      if (fieldErrors[field]) {
        setFieldErrors((prev) => {
          const copy = { ...prev };
          delete copy[field];
          return copy;
        });
      }
      if (formError) {
        setFormError("");
      }
    };
  }

  function handleFillDemoTiming() {
    const now = Date.now();
    const open = new Date(now);
    const close = new Date(now + 10 * 60 * 1000);
    const start = new Date(now + 30 * 24 * 60 * 60 * 1000);

    setValues((prev) => ({
      ...prev,
      registrationOpenAt: toDatetimeLocalValue(open),
      registrationCloseAt: toDatetimeLocalValue(close),
      eventDate: toDatetimeLocalValue(start),
    }));
    setFieldErrors((prev) => {
      const copy = { ...prev };
      delete copy.registrationOpenAt;
      delete copy.registrationCloseAt;
      delete copy.eventDate;
      return copy;
    });
  }

  function validateAndBuildPayload() {
    const errors = {};

    if (isLockedAfterPublish) {
      if (ANGLE_BRACKETS_REGEX.test(values.description)) {
        errors.description =
          'Description must not contain "<" or ">" characters.';
      } else if (values.description.trim().length > MAX_DESCRIPTION_LENGTH) {
        errors.description = `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`;
      }

      if (Object.keys(errors).length > 0) {
        return { valid: false, errors, payload: null };
      }

      return {
        valid: true,
        errors: {},
        payload: { description: values.description.trim() },
      };
    }

    const title = values.title.trim().replace(/\s+/g, " ");
    if (ANGLE_BRACKETS_REGEX.test(values.title)) {
      errors.title = 'Title must not contain "<" or ">" characters.';
    } else if (title.length < 3 || title.length > 120) {
      errors.title = "Title must be between 3 and 120 characters.";
    }

    if (ANGLE_BRACKETS_REGEX.test(values.description)) {
      errors.description =
        'Description must not contain "<" or ">" characters.';
    } else if (values.description.trim().length > MAX_DESCRIPTION_LENGTH) {
      errors.description = `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`;
    }

    const venueName = values.venueName.trim().replace(/\s+/g, " ");
    if (ANGLE_BRACKETS_REGEX.test(values.venueName)) {
      errors.venueName = 'Venue name must not contain "<" or ">" characters.';
    } else if (venueName.length < 2 || venueName.length > 120) {
      errors.venueName = "Venue name must be between 2 and 120 characters.";
    }

    const city = values.city.trim().replace(/\s+/g, " ");
    if (ANGLE_BRACKETS_REGEX.test(values.city)) {
      errors.city = 'City must not contain "<" or ">" characters.';
    } else if (city.length < 2 || city.length > 60) {
      errors.city = "City must be between 2 and 60 characters.";
    }

    const pricePaise = parseRupeesToPaise(values.priceRupees);
    if (pricePaise === null) {
      errors.priceRupees =
        "Enter a valid rupee amount with up to 2 decimals (e.g., 5000 or 5000.50).";
    } else if (
      pricePaise < EVENT_MIN_PRICE_PAISE ||
      pricePaise > EVENT_MAX_PRICE_PAISE
    ) {
      errors.priceRupees = `Ticket price must be between ${formatRupees(
        EVENT_MIN_PRICE_PAISE
      )} and ${formatRupees(EVENT_MAX_PRICE_PAISE)}.`;
    }

    const totalTicketsNum = Number(values.totalTickets);
    if (
      !values.totalTickets.trim() ||
      !/^\d+$/.test(values.totalTickets.trim()) ||
      !Number.isSafeInteger(totalTicketsNum) ||
      totalTicketsNum < 1 ||
      totalTicketsNum > EVENT_MAX_TOTAL_TICKETS
    ) {
      errors.totalTickets = `Total tickets must be a whole number between 1 and ${EVENT_MAX_TOTAL_TICKETS}.`;
    }

    const maxPerNum = Number(values.maxTicketsPerIdentity);
    if (!Number.isSafeInteger(maxPerNum) || maxPerNum < 1 || maxPerNum > 2) {
      errors.maxTicketsPerIdentity = "Max tickets per person must be 1 or 2.";
    }

    const holdNum = Number(values.holdDurationMinutes);
    if (
      !values.holdDurationMinutes.trim() ||
      !/^\d+$/.test(values.holdDurationMinutes.trim()) ||
      !Number.isSafeInteger(holdNum) ||
      holdNum < MIN_HOLD_MINUTES ||
      holdNum > MAX_HOLD_MINUTES
    ) {
      errors.holdDurationMinutes = `Hold time must be a whole number between ${MIN_HOLD_MINUTES} and ${MAX_HOLD_MINUTES} minutes.`;
    }

    const parsedStart = values.eventDate ? new Date(values.eventDate) : null;
    const parsedOpen = values.registrationOpenAt
      ? new Date(values.registrationOpenAt)
      : null;
    const parsedClose = values.registrationCloseAt
      ? new Date(values.registrationCloseAt)
      : null;

    if (!parsedStart || Number.isNaN(parsedStart.getTime())) {
      errors.eventDate = "Please select a valid event start date and time.";
    }
    if (!parsedOpen || Number.isNaN(parsedOpen.getTime())) {
      errors.registrationOpenAt =
        "Please select a valid registration open date and time.";
    }
    if (!parsedClose || Number.isNaN(parsedClose.getTime())) {
      errors.registrationCloseAt =
        "Please select a valid registration close date and time.";
    }

    if (
      parsedStart &&
      parsedOpen &&
      parsedClose &&
      !Number.isNaN(parsedStart.getTime()) &&
      !Number.isNaN(parsedOpen.getTime()) &&
      !Number.isNaN(parsedClose.getTime())
    ) {
      if (parsedClose.getTime() <= Date.now()) {
        errors.registrationCloseAt =
          "Registration close time must be in the future.";
      } else if (parsedClose.getTime() - parsedOpen.getTime() < 60 * 1000) {
        errors.registrationCloseAt =
          "Registration close time must be at least 1 minute after registration opens.";
      }

      if (parsedStart.getTime() <= parsedClose.getTime()) {
        errors.eventDate =
          "Event start time must be after registration closes.";
      }
    }

    if (Object.keys(errors).length > 0) {
      return { valid: false, errors, payload: null };
    }

    return {
      valid: true,
      errors: {},
      payload: {
        title,
        description: values.description.trim(),
        venueName,
        city,
        eventDate: parsedStart.toISOString(),
        registrationOpenAt: parsedOpen.toISOString(),
        registrationCloseAt: parsedClose.toISOString(),
        basePricePaise: pricePaise,
        totalTickets: totalTicketsNum,
        maxTicketsPerIdentity: maxPerNum,
        holdDurationMinutes: holdNum,
      },
    };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting || isCancelled) {
      return;
    }

    setFormError("");
    const result = validateAndBuildPayload();
    if (!result.valid) {
      setFieldErrors(result.errors);
      setFormError("Please fix the highlighted fields before saving.");
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      await onSubmit(result.payload);
    } catch (err) {
      const serverMapped = mapServerFieldErrors(err);
      if (Object.keys(serverMapped).length > 0) {
        setFieldErrors(serverMapped);
      }
      setFormError(
        err?.message || "Could not save the event. Please check your inputs."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          {isCancelled && (
            <Alert variant="danger" title="Cancelled events cannot be edited">
              This event has already been cancelled. Create a new event if you
              want to host a replacement date.
            </Alert>
          )}

          {isLockedAfterPublish && !isCancelled && (
            <Alert variant="info" title="Event details locked after publishing">
              After publishing, only the description can be changed. Cancel and
              recreate the event to change title, venue, schedule, pricing, or
              ticket limits.
            </Alert>
          )}

          {formError && (
            <Alert variant="danger" title="Could not save event">
              {formError}
            </Alert>
          )}

          {/* Basic Info */}
          <div className="space-y-4">
            <Input
              id="event-title"
              label="Title"
              required
              disabled={isLockedAfterPublish || submitting}
              placeholder="e.g., Demo Concert: Summer Lights"
              value={values.title}
              onChange={handleChange("title")}
              error={fieldErrors.title}
              maxLength={120}
            />

            <div>
              <Textarea
                id="event-description"
                label="Description"
                rows={4}
                disabled={isCancelled || submitting}
                placeholder="Describe the event schedule, venue notes, and fair-ticketing guidance (plain text only)."
                value={values.description}
                onChange={handleChange("description")}
                error={fieldErrors.description}
                maxLength={MAX_DESCRIPTION_LENGTH}
              />
              <div className="mt-1 flex justify-end text-xs text-slate-500">
                <span>
                  {values.description.length} / {MAX_DESCRIPTION_LENGTH}{" "}
                  characters
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                id="event-venue"
                label="Venue name"
                required
                disabled={isLockedAfterPublish || submitting}
                placeholder="e.g., Harborview Open Arena"
                value={values.venueName}
                onChange={handleChange("venueName")}
                error={fieldErrors.venueName}
                maxLength={120}
              />

              <Input
                id="event-city"
                label="City"
                required
                disabled={isLockedAfterPublish || submitting}
                placeholder="e.g., Mumbai"
                value={values.city}
                onChange={handleChange("city")}
                error={fieldErrors.city}
                maxLength={60}
              />
            </div>
          </div>

          {/* Schedule Section */}
          <div className="space-y-3 border-t border-slate-100 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-navy">
                  Registration &amp; event schedule
                </h3>
                <p className="text-xs text-slate-500">
                  Times are saved in UTC ISO 8601 format from your local clock.
                </p>
              </div>
              {import.meta.env.DEV && !isLockedAfterPublish && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={submitting}
                  onClick={handleFillDemoTiming}
                >
                  <Clock className="h-4 w-4" aria-hidden="true" />
                  Demo timing
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Input
                id="event-reg-open"
                label="Registration opens"
                type="datetime-local"
                required
                disabled={isLockedAfterPublish || submitting}
                value={values.registrationOpenAt}
                onChange={handleChange("registrationOpenAt")}
                error={fieldErrors.registrationOpenAt}
              />

              <Input
                id="event-reg-close"
                label="Registration closes"
                type="datetime-local"
                required
                disabled={isLockedAfterPublish || submitting}
                value={values.registrationCloseAt}
                onChange={handleChange("registrationCloseAt")}
                error={fieldErrors.registrationCloseAt}
              />

              <Input
                id="event-start"
                label="Event start"
                type="datetime-local"
                required
                disabled={isLockedAfterPublish || submitting}
                value={values.eventDate}
                onChange={handleChange("eventDate")}
                error={fieldErrors.eventDate}
              />
            </div>
          </div>

          {/* Pricing & Capacity Section */}
          <div className="space-y-4 border-t border-slate-100 pt-5">
            <h3 className="text-sm font-semibold text-navy">
              Pricing &amp; fair-ticketing limits
            </h3>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                id="event-price-rupees"
                label="Ticket price in rupees"
                type="text"
                inputMode="decimal"
                required
                disabled={isLockedAfterPublish || submitting}
                placeholder="e.g., 5000 or 2500.50"
                hint={
                  maxResalePreviewPaise !== null
                    ? `110% resale cap preview: ${formatRupees(
                        maxResalePreviewPaise
                      )} (verified on backend)`
                    : "Enter whole rupees or up to 2 decimals (Rs 100 to Rs 5,00,000)."
                }
                value={values.priceRupees}
                onChange={handleChange("priceRupees")}
                error={fieldErrors.priceRupees}
              />

              <Input
                id="event-total-tickets"
                label="Total tickets"
                type="number"
                min={1}
                max={EVENT_MAX_TOTAL_TICKETS}
                step={1}
                required
                disabled={isLockedAfterPublish || submitting}
                placeholder="e.g., 100"
                value={values.totalTickets}
                onChange={handleChange("totalTickets")}
                error={fieldErrors.totalTickets}
              />

              <Select
                id="event-max-per-person"
                label="Max tickets per person"
                required
                disabled={isLockedAfterPublish || submitting}
                options={MAX_PER_USER_OPTIONS}
                value={values.maxTicketsPerIdentity}
                onChange={handleChange("maxTicketsPerIdentity")}
                error={fieldErrors.maxTicketsPerIdentity}
              />

              <Input
                id="event-hold-minutes"
                label="Hold time in minutes"
                type="number"
                min={MIN_HOLD_MINUTES}
                max={MAX_HOLD_MINUTES}
                step={1}
                required
                disabled={isLockedAfterPublish || submitting}
                hint="How long a fan has to pay once it is their turn (1 to 15 minutes)."
                value={values.holdDurationMinutes}
                onChange={handleChange("holdDurationMinutes")}
                error={fieldErrors.holdDurationMinutes}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-5">
            {onCancel && (
              <Button
                type="button"
                variant="secondary"
                disabled={submitting}
                onClick={onCancel}
              >
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              isLoading={submitting}
              disabled={submitting || isCancelled}
            >
              {isEdit
                ? isLockedAfterPublish
                  ? "Save description"
                  : "Save draft changes"
                : "Create draft event"}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
