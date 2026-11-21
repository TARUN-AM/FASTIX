import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Search,
  Ticket,
} from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
  StatusPill,
} from "../components/ui";
import { listEvents } from "../services/eventsApi";
import { formatDateTime } from "../utils/formatDate";
import { formatRupees } from "../utils/formatMoney";

const PAGE_SIZE = 12;

function parsePositivePage(rawPage) {
  if (!rawPage || !/^[1-9]\d*$/.test(rawPage)) {
    return 1;
  }
  const num = Number.parseInt(rawPage, 10);
  return Number.isSafeInteger(num) && num >= 1 ? num : 1;
}

export default function EventListingPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const urlQ = searchParams.get("q") || "";
  const urlCity = searchParams.get("city") || "";
  const urlPage = parsePositivePage(searchParams.get("page"));

  const [qInput, setQInput] = useState(urlQ);
  const [cityInput, setCityInput] = useState(urlCity);
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

  // Keep input boxes synchronized when navigating via browser back/forward
  useEffect(() => {
    setQInput(urlQ);
  }, [urlQ]);

  useEffect(() => {
    setCityInput(urlCity);
  }, [urlCity]);

  // Debounce filter inputs by 400 ms before updating URL query params
  useEffect(() => {
    const trimmedQ = qInput.trim();
    const trimmedCity = cityInput.trim();
    if (trimmedQ === urlQ && trimmedCity === urlCity) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      const next = new URLSearchParams();
      if (trimmedQ) next.set("q", trimmedQ);
      if (trimmedCity) next.set("city", trimmedCity);
      next.set("page", "1");
      setSearchParams(next, { replace: false });
    }, 400);

    return () => window.clearTimeout(timer);
  }, [qInput, cityInput, urlQ, urlCity, setSearchParams]);

  // Fetch events whenever URL query params change; cancel in-flight requests
  useEffect(() => {
    const controller = new AbortController();
    let isActive = true;

    setLoading(true);
    setError("");

    listEvents(
      {
        page: urlPage,
        limit: PAGE_SIZE,
        q: urlQ,
        city: urlCity,
      },
      { signal: controller.signal }
    )
      .then((result) => {
        if (!isActive) return;
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        if (!isActive || err?.code === "ERR_CANCELED" || err?.name === "CanceledError") {
          return;
        }
        setError(err?.message || "Unable to load events right now.");
        setLoading(false);
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [urlPage, urlQ, urlCity, reloadTick]);

  const handlePageChange = useCallback(
    (nextPage) => {
      const next = new URLSearchParams();
      if (urlQ) next.set("q", urlQ);
      if (urlCity) next.set("city", urlCity);
      next.set("page", String(nextPage));
      setSearchParams(next);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [urlQ, urlCity, setSearchParams]
  );

  const handleClearFilters = useCallback(() => {
    setQInput("");
    setCityInput("");
    setSearchParams(new URLSearchParams());
  }, [setSearchParams]);

  const hasActiveFilters = Boolean(urlQ || urlCity);
  const displayTotalPages = Math.max(1, data.totalPages || 0);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb="Discover"
        title="Upcoming Events"
        subtitle="Browse verified live events with randomized fair queues and 110% resale price caps."
      />

      {/* Search & City Filter Bar */}
      <Card>
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
            <Input
              id="events-search-q"
              label="Search events"
              placeholder="Search by event title..."
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              maxLength={50}
            />
            <Input
              id="events-filter-city"
              label="City"
              placeholder="e.g., Mumbai, Bengaluru, Pune"
              value={cityInput}
              onChange={(e) => setCityInput(e.target.value)}
              maxLength={60}
            />
            {hasActiveFilters && (
              <Button
                type="button"
                variant="secondary"
                onClick={handleClearFilters}
                className="w-full sm:w-auto"
              >
                Clear filters
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Accessible status summary */}
      <div aria-live="polite" className="text-sm text-slate-600">
        {loading
          ? "Loading events..."
          : error
          ? "Could not load events."
          : data.total === 0
          ? "No matching events found."
          : `Showing ${data.items.length} of ${data.total} event${
              data.total === 1 ? "" : "s"
            }${urlCity ? ` in ${urlCity}` : ""}.`}
      </div>

      {/* Error State */}
      {!loading && error && (
        <Alert
          variant="danger"
          title="Unable to load events"
          actions={
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setReloadTick((n) => n + 1)}
            >
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {/* Loading Skeletons */}
      {loading && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <Card key={idx}>
              <CardBody className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-5 w-16" />
                </div>
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </CardBody>
              <CardFooter className="flex items-center justify-between">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-8 w-24" />
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && data.items.length === 0 && (
        <EmptyState
          icon={Search}
          title={hasActiveFilters ? "No matching events" : "No published events yet"}
          description={
            hasActiveFilters
              ? "Try adjusting your search keywords or clearing the city filter."
              : "Check back soon for upcoming events with fair queue registration."
          }
          action={
            hasActiveFilters ? (
              <Button variant="secondary" onClick={handleClearFilters}>
                Clear filters
              </Button>
            ) : null
          }
        />
      )}

      {/* Event Cards Grid */}
      {!loading && !error && data.items.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {data.items.map((event) => {
              const isDemo =
                typeof event.title === "string" &&
                event.title.startsWith("Demo");
              return (
                <Card
                  key={event.id}
                  className="flex flex-col justify-between transition-shadow duration-150 hover:shadow-md"
                >
                  <CardBody className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <StatusPill status={event.phase} />
                      <div className="flex flex-wrap items-center gap-1.5">
                        {isDemo && <Badge tone="info">Demo</Badge>}
                        {event.soldOut && <Badge tone="warning">Sold out</Badge>}
                      </div>
                    </div>

                    <h2 className="text-lg font-semibold leading-snug text-navy">
                      <Link
                        to={`/events/${event.id}`}
                        className="hover:text-sky focus:outline-none focus:underline"
                      >
                        {event.title}
                      </Link>
                    </h2>

                    <div className="space-y-1.5 text-sm text-slate-600">
                      <p className="flex items-start gap-2">
                        <MapPin
                          className="mt-0.5 h-4 w-4 shrink-0 text-sky"
                          aria-hidden="true"
                        />
                        <span className="min-w-0 break-words">
                          {event.venueName}, {event.city}
                        </span>
                      </p>
                      <p className="flex items-center gap-2">
                        <Calendar
                          className="h-4 w-4 shrink-0 text-sky"
                          aria-hidden="true"
                        />
                        <span>{formatDateTime(event.eventDate)}</span>
                      </p>
                    </div>
                  </CardBody>

                  <CardFooter className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Face Value
                      </p>
                      <p className="flex items-center gap-1.5 text-base font-bold text-navy">
                        <Ticket
                          className="h-4 w-4 shrink-0 text-sky"
                          aria-hidden="true"
                        />
                        <span>{formatRupees(event.basePricePaise)}</span>
                      </p>
                    </div>
                    <Button
                      to={`/events/${event.id}`}
                      variant="primary"
                      size="sm"
                    >
                      View details
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>

          {/* Keyboard-accessible Pagination Controls */}
          <nav
            aria-label="Event listing pagination"
            className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4"
          >
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={urlPage <= 1}
              onClick={() => handlePageChange(urlPage - 1)}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Previous
            </Button>

            <span className="text-sm font-medium text-navy">
              Page {urlPage} of {displayTotalPages}
            </span>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={urlPage >= displayTotalPages}
              onClick={() => handlePageChange(urlPage + 1)}
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </nav>
        </>
      )}
    </div>
  );
}
