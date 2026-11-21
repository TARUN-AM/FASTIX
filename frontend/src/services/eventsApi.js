import apiClient from "./api";

/**
 * Fetches paginated public events (non-DRAFT, non-CANCELLED).
 * Supports AbortController signal to prevent stale filter responses.
 */
export async function listEvents(params = {}, { signal } = {}) {
  const cleanParams = {};
  if (params.page !== undefined && params.page !== "") {
    cleanParams.page = params.page;
  }
  if (params.limit !== undefined && params.limit !== "") {
    cleanParams.limit = params.limit;
  }
  if (typeof params.city === "string" && params.city.trim()) {
    cleanParams.city = params.city.trim();
  }
  if (typeof params.q === "string" && params.q.trim()) {
    cleanParams.q = params.q.trim();
  }

  const response = await apiClient.get("/events", {
    params: cleanParams,
    signal,
  });
  return response.data.data;
}

/**
 * Fetches public event details (or DRAFT preview for owning organizer / ADMIN).
 * Returns `{ event, serverDateHeader }` so display-only countdowns can apply
 * the one-time server-to-browser clock offset from the HTTP Date header.
 */
export async function getEvent(eventId, { signal } = {}) {
  const response = await apiClient.get(
    `/events/${encodeURIComponent(eventId)}`,
    { signal }
  );
  const serverDateHeader =
    response.headers?.date || response.headers?.Date || null;
  return {
    event: response.data.data.event,
    serverDateHeader,
  };
}

/**
 * Fetches the authenticated organizer's own events (including DRAFT and CANCELLED).
 */
export async function listMyEvents(params = {}, { signal } = {}) {
  const cleanParams = {};
  if (params.page !== undefined && params.page !== "") {
    cleanParams.page = params.page;
  }
  if (params.limit !== undefined && params.limit !== "") {
    cleanParams.limit = params.limit;
  }
  if (typeof params.status === "string" && params.status.trim()) {
    cleanParams.status = params.status.trim();
  }

  const response = await apiClient.get("/events/mine", {
    params: cleanParams,
    signal,
  });
  return response.data.data;
}

/**
 * Creates a new DRAFT event (ORGANIZER only).
 */
export async function createEvent(values) {
  const response = await apiClient.post("/events", values);
  return response.data.data.event;
}

/**
 * Updates an existing event (all allowed fields while DRAFT; description only after publish).
 */
export async function updateEvent(eventId, values) {
  const response = await apiClient.patch(
    `/events/${encodeURIComponent(eventId)}`,
    values
  );
  return response.data.data.event;
}

/**
 * Publishes a DRAFT event (owning ORGANIZER only).
 */
export async function publishEvent(eventId) {
  const response = await apiClient.post(
    `/events/${encodeURIComponent(eventId)}/publish`
  );
  return response.data.data.event;
}

/**
 * Cancels an eligible event with a required reason (owning ORGANIZER or ADMIN).
 */
export async function cancelEvent(eventId, reason) {
  const response = await apiClient.post(
    `/events/${encodeURIComponent(eventId)}/cancel`,
    { reason }
  );
  return response.data.data.event;
}
