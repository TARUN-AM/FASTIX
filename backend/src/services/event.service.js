const mongoose = require("mongoose");
const Event = require("../models/Event.model");
const Booking = require("../models/Booking.model");
const Ticket = require("../models/Ticket.model");
const SecurityLog = require("../models/SecurityLog.model");
const {
  USER_ROLES,
  EVENT_STATUSES,
  EVENT_STATUS_TRANSITIONS,
  ERROR_CODES,
  SECURITY_EVENT_TYPES,
  SECURITY_SEVERITIES,
} = require("../config/constants");
const { calculateMaxResalePrice } = require("../utils/money");
const {
  escapeRegex,
  validateEventSchedule,
} = require("../utils/eventValidators");

const PUBLIC_EVENT_SELECT = [
  "_id",
  "organizerId",
  "title",
  "description",
  "artist",
  "category",
  "venueName",
  "city",
  "eventDate",
  "registrationOpenAt",
  "registrationCloseAt",
  "totalTickets",
  "availableTickets",
  "basePricePaise",
  "maxResalePricePaise",
  "maxTicketsPerIdentity",
  "holdDurationMinutes",
  "status",
  "publishedAt",
  "cancelledAt",
  "cancelReason",
].join(" ");

const CANCELLABLE_STATUSES = Object.freeze(
  Object.entries(EVENT_STATUS_TRANSITIONS)
    .filter(([, allowedNext]) => allowedNext.includes(EVENT_STATUSES.CANCELLED))
    .map(([status]) => status)
);

function createServiceError(statusCode, code, message, details) {
  const err = new Error(message);
  err.isOperational = true;
  err.statusCode = statusCode;
  err.code = code;
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

async function writeSecurityLog({
  eventType,
  severity,
  userId,
  eventId,
  requestMeta = {},
  details = {},
}) {
  if (mongoose.connection.readyState !== 1) {
    return;
  }
  try {
    const userAgent =
      typeof requestMeta.userAgent === "string"
        ? requestMeta.userAgent.slice(0, 200)
        : undefined;
    await SecurityLog.create({
      eventType,
      severity,
      userId,
      eventId,
      ipAddress: requestMeta.ipAddress || undefined,
      userAgent,
      details,
    });
  } catch (_err) {
    // Audit logging must never break primary response flow
  }
}

function extractOrganizerId(eventDoc) {
  if (!eventDoc || !eventDoc.organizerId) {
    return null;
  }
  if (
    typeof eventDoc.organizerId === "object" &&
    eventDoc.organizerId._id !== undefined
  ) {
    return String(eventDoc.organizerId._id);
  }
  return String(eventDoc.organizerId);
}

function extractOrganizerName(eventDoc, explicitOrganizerName = null) {
  if (typeof explicitOrganizerName === "string" && explicitOrganizerName.trim()) {
    return explicitOrganizerName.trim();
  }
  if (
    eventDoc &&
    eventDoc.organizerId &&
    typeof eventDoc.organizerId === "object" &&
    typeof eventDoc.organizerId.fullName === "string"
  ) {
    return eventDoc.organizerId.fullName;
  }
  return null;
}

/**
 * Pure function computing the derived display phase of an event from its stored
 * status and registration window timestamps.
 *
 * Boundary definitions (strictly deterministic):
 * - status === "DRAFT"     -> "DRAFT"
 * - status === "CANCELLED" -> "CANCELLED"
 * - Otherwise (published or active lifecycle status):
 *   - now < registrationOpenAt                          -> "UPCOMING"
 *   - registrationOpenAt <= now < registrationCloseAt   -> "REGISTRATION_OPEN"
 *   - now >= registrationCloseAt                        -> "REGISTRATION_CLOSED"
 *
 * Note: Prompts 11 and 12 will extend this with queue and booking phases. The
 * stored `status` field remains the authoritative source of truth while `phase`
 * is a derived display value.
 */
function getEventPhase(event, now = new Date()) {
  if (!event) {
    return EVENT_STATUSES.DRAFT;
  }
  if (event.status === EVENT_STATUSES.DRAFT) {
    return "DRAFT";
  }
  if (event.status === EVENT_STATUSES.CANCELLED) {
    return "CANCELLED";
  }

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const openMs = new Date(event.registrationOpenAt).getTime();
  const closeMs = new Date(event.registrationCloseAt).getTime();

  if (nowMs < openMs) {
    return "UPCOMING";
  }
  if (nowMs < closeMs) {
    return "REGISTRATION_OPEN";
  }
  return "REGISTRATION_CLOSED";
}

/**
 * Strict whitelist serializer for public and customer event responses.
 * NEVER exposes organizerId, organizer email/phone, availableTickets, heldTickets,
 * soldTickets, or any internal operational counters.
 */
function toPublicEvent(eventDoc, organizerName = null, now = new Date()) {
  const maxResalePricePaise = calculateMaxResalePrice(eventDoc.basePricePaise);
  const soldOut =
    eventDoc.status === EVENT_STATUSES.SOLD_OUT ||
    Number(eventDoc.availableTickets) <= 0;

  const serialized = {
    id: String(eventDoc._id),
    title: eventDoc.title,
    description: eventDoc.description || "",
    artist: eventDoc.artist || "",
    category: eventDoc.category,
    venueName: eventDoc.venueName,
    city: eventDoc.city,
    eventDate: eventDoc.eventDate,
    registrationOpenAt: eventDoc.registrationOpenAt,
    registrationCloseAt: eventDoc.registrationCloseAt,
    totalTickets: eventDoc.totalTickets,
    basePricePaise: eventDoc.basePricePaise,
    maxResalePricePaise,
    maxTicketsPerIdentity: eventDoc.maxTicketsPerIdentity,
    holdDurationMinutes: eventDoc.holdDurationMinutes,
    status: eventDoc.status,
    phase: getEventPhase(eventDoc, now),
    soldOut,
    publishedAt: eventDoc.publishedAt || null,
    organizerName: extractOrganizerName(eventDoc, organizerName),
  };

  if (eventDoc.status === EVENT_STATUSES.CANCELLED) {
    serialized.cancelledAt = eventDoc.cancelledAt || null;
    serialized.cancelReason = eventDoc.cancelReason || "";
  }

  return serialized;
}

/**
 * Organizer/Admin management serializer extending toPublicEvent with inventory
 * counters and cancellation metadata. Still NEVER exposes organizerId or contact PII.
 */
function toOwnerEvent(eventDoc, organizerName = null, now = new Date()) {
  const base = toPublicEvent(eventDoc, organizerName, now);
  return {
    ...base,
    availableTickets: eventDoc.availableTickets,
    heldTickets: eventDoc.heldTickets ?? 0,
    soldTickets: eventDoc.soldTickets ?? 0,
    cancelledAt: eventDoc.cancelledAt || null,
    cancelReason: eventDoc.cancelReason || null,
  };
}

async function createEvent(organizer, validatedInput, requestMeta = {}) {
  const organizerId = organizer._id || organizer.id;
  const maxResalePricePaise = calculateMaxResalePrice(
    validatedInput.basePricePaise
  );

  const event = await Event.create({
    organizerId,
    title: validatedInput.title,
    description: validatedInput.description,
    artist: validatedInput.artist,
    category: validatedInput.category,
    venueName: validatedInput.venueName,
    city: validatedInput.city,
    eventDate: validatedInput.eventDate,
    registrationOpenAt: validatedInput.registrationOpenAt,
    registrationCloseAt: validatedInput.registrationCloseAt,
    totalTickets: validatedInput.totalTickets,
    availableTickets: validatedInput.totalTickets,
    heldTickets: 0,
    soldTickets: 0,
    basePricePaise: validatedInput.basePricePaise,
    maxResalePricePaise,
    maxTicketsPerIdentity: validatedInput.maxTicketsPerIdentity,
    holdDurationMinutes: validatedInput.holdDurationMinutes,
    status: EVENT_STATUSES.DRAFT,
  });

  await writeSecurityLog({
    eventType: SECURITY_EVENT_TYPES.EVENT_CREATED,
    severity: SECURITY_SEVERITIES.LOW,
    userId: organizerId,
    eventId: event._id,
    requestMeta,
    details: {
      status: event.status,
      totalTickets: event.totalTickets,
    },
  });

  return toOwnerEvent(event, organizer.fullName || null);
}

async function updateEvent(eventId, actor, validatedPatch, requestMeta = {}) {
  if (actor.role === USER_ROLES.ADMIN) {
    throw createServiceError(
      403,
      ERROR_CODES.FORBIDDEN,
      "Admins cannot edit event content. Admins may only cancel events."
    );
  }

  const actorId = String(actor._id || actor.id);
  const existing = await Event.findById(eventId).lean();

  if (!existing) {
    throw createServiceError(404, ERROR_CODES.NOT_FOUND, "Event not found.");
  }

  if (extractOrganizerId(existing) !== actorId) {
    await writeSecurityLog({
      eventType: SECURITY_EVENT_TYPES.EVENT_ACCESS_DENIED,
      severity: SECURITY_SEVERITIES.MEDIUM,
      userId: actor._id || actor.id,
      eventId: existing._id,
      requestMeta,
      details: { action: "UPDATE" },
    });
    throw createServiceError(404, ERROR_CODES.NOT_FOUND, "Event not found.");
  }

  if (existing.status === EVENT_STATUSES.CANCELLED) {
    throw createServiceError(
      409,
      ERROR_CODES.EVENT_LOCKED,
      "Cancelled events cannot be edited."
    );
  }

  const incomingFields = Object.keys(validatedPatch);

  if (existing.status !== EVENT_STATUSES.DRAFT) {
    const hasLockedField = incomingFields.some(
      (field) => field !== "description"
    );
    if (hasLockedField) {
      throw createServiceError(
        409,
        ERROR_CODES.EVENT_LOCKED,
        "After publishing, only the description can be changed. Cancel and recreate the event to change other details."
      );
    }
  }

  const updateSet = { ...validatedPatch };

  if (existing.status === EVENT_STATUSES.DRAFT) {
    const mergedEventDate = validatedPatch.eventDate || new Date(existing.eventDate);
    const mergedOpenAt =
      validatedPatch.registrationOpenAt || new Date(existing.registrationOpenAt);
    const mergedCloseAt =
      validatedPatch.registrationCloseAt || new Date(existing.registrationCloseAt);

    const scheduleChanged =
      validatedPatch.eventDate !== undefined ||
      validatedPatch.registrationOpenAt !== undefined ||
      validatedPatch.registrationCloseAt !== undefined;

    if (scheduleChanged) {
      const scheduleErrors = validateEventSchedule(
        {
          eventDate: mergedEventDate,
          registrationOpenAt: mergedOpenAt,
          registrationCloseAt: mergedCloseAt,
        },
        {
          requireCloseInFuture: validatedPatch.registrationCloseAt !== undefined,
          now: new Date(),
        }
      );
      if (scheduleErrors.length > 0) {
        throw createServiceError(
          400,
          ERROR_CODES.VALIDATION_ERROR,
          "Please fix the highlighted event schedule fields.",
          scheduleErrors
        );
      }
    }

    if (validatedPatch.totalTickets !== undefined) {
      updateSet.availableTickets = validatedPatch.totalTickets;
    }

    if (validatedPatch.basePricePaise !== undefined) {
      updateSet.maxResalePricePaise = calculateMaxResalePrice(
        validatedPatch.basePricePaise
      );
    }
  }

  // Atomic conditional update: filter includes _id, organizerId, AND the status
  // we just validated so a concurrent publish or cancel cannot race with edits.
  const updated = await Event.findOneAndUpdate(
    {
      _id: existing._id,
      organizerId: actor._id || actor.id,
      status: existing.status,
    },
    { $set: updateSet },
    { new: true, runValidators: true }
  ).lean();

  if (!updated) {
    const latest = await Event.findById(eventId).lean();
    if (!latest || extractOrganizerId(latest) !== actorId) {
      throw createServiceError(404, ERROR_CODES.NOT_FOUND, "Event not found.");
    }
    if (latest.status === EVENT_STATUSES.CANCELLED) {
      throw createServiceError(
        409,
        ERROR_CODES.EVENT_LOCKED,
        "Cancelled events cannot be edited."
      );
    }
    throw createServiceError(
      409,
      ERROR_CODES.EVENT_LOCKED,
      "After publishing, only the description can be changed. Cancel and recreate the event to change other details."
    );
  }

  await writeSecurityLog({
    eventType: SECURITY_EVENT_TYPES.EVENT_UPDATED,
    severity: SECURITY_SEVERITIES.LOW,
    userId: actor._id || actor.id,
    eventId: updated._id,
    requestMeta,
    details: {
      changedFields: incomingFields,
    },
  });

  return toOwnerEvent(updated, actor.fullName || null);
}

async function publishEvent(eventId, actor, requestMeta = {}) {
  const actorId = String(actor._id || actor.id);
  const now = new Date();

  // Atomic conditional transition: only transitions DRAFT -> PUBLISHED when owned
  // by actor and registrationCloseAt is still in the future.
  const published = await Event.findOneAndUpdate(
    {
      _id: eventId,
      organizerId: actor._id || actor.id,
      status: EVENT_STATUSES.DRAFT,
      registrationCloseAt: { $gt: now },
    },
    {
      $set: {
        status: EVENT_STATUSES.PUBLISHED,
        publishedAt: now,
      },
    },
    { new: true }
  ).lean();

  if (!published) {
    const existing = await Event.findById(eventId).lean();
    if (!existing) {
      throw createServiceError(404, ERROR_CODES.NOT_FOUND, "Event not found.");
    }
    if (extractOrganizerId(existing) !== actorId) {
      await writeSecurityLog({
        eventType: SECURITY_EVENT_TYPES.EVENT_ACCESS_DENIED,
        severity: SECURITY_SEVERITIES.MEDIUM,
        userId: actor._id || actor.id,
        eventId: existing._id,
        requestMeta,
        details: { action: "PUBLISH" },
      });
      throw createServiceError(404, ERROR_CODES.NOT_FOUND, "Event not found.");
    }
    if (existing.status !== EVENT_STATUSES.DRAFT) {
      throw createServiceError(
        409,
        ERROR_CODES.INVALID_EVENT_STATE,
        `Event cannot be published from status ${existing.status}.`
      );
    }
    if (new Date(existing.registrationCloseAt).getTime() <= now.getTime()) {
      throw createServiceError(
        409,
        ERROR_CODES.EVENT_REGISTRATION_ALREADY_CLOSED,
        "Cannot publish an event whose registration window has already closed."
      );
    }
    throw createServiceError(
      409,
      ERROR_CODES.INVALID_EVENT_STATE,
      "Event could not be published because its state changed."
    );
  }

  await writeSecurityLog({
    eventType: SECURITY_EVENT_TYPES.EVENT_PUBLISHED,
    severity: SECURITY_SEVERITIES.LOW,
    userId: actor._id || actor.id,
    eventId: published._id,
    requestMeta,
    details: {
      publishedAt: published.publishedAt,
    },
  });

  return toOwnerEvent(published, actor.fullName || null);
}

async function cancelEvent(eventId, actor, { reason }, requestMeta = {}) {
  const actorId = String(actor._id || actor.id);
  const isAdmin = actor.role === USER_ROLES.ADMIN;

  const existing = await Event.findById(eventId).lean();
  if (!existing) {
    throw createServiceError(404, ERROR_CODES.NOT_FOUND, "Event not found.");
  }

  if (!isAdmin && extractOrganizerId(existing) !== actorId) {
    await writeSecurityLog({
      eventType: SECURITY_EVENT_TYPES.EVENT_ACCESS_DENIED,
      severity: SECURITY_SEVERITIES.MEDIUM,
      userId: actor._id || actor.id,
      eventId: existing._id,
      requestMeta,
      details: { action: "CANCEL" },
    });
    throw createServiceError(404, ERROR_CODES.NOT_FOUND, "Event not found.");
  }

  if (!CANCELLABLE_STATUSES.includes(existing.status)) {
    throw createServiceError(
      409,
      ERROR_CODES.INVALID_EVENT_STATE,
      `Event cannot be cancelled from status ${existing.status}.`
    );
  }

  // Guard: Refunds and smart-contract-side event cancellation are not designed yet,
  // so cancellation is blocked once any Booking or Ticket document exists for the event.
  const [hasBooking, hasTicket] = await Promise.all([
    Booking.exists({ eventId: existing._id }),
    Ticket.exists({ eventId: existing._id }),
  ]);

  if (hasBooking || hasTicket) {
    throw createServiceError(
      409,
      ERROR_CODES.EVENT_HAS_BOOKINGS,
      "Events with bookings cannot be cancelled yet. Refund handling is not built in this version."
    );
  }

  const now = new Date();
  const filter = {
    _id: existing._id,
    status: { $in: CANCELLABLE_STATUSES },
  };
  if (!isAdmin) {
    filter.organizerId = actor._id || actor.id;
  }

  // Atomic conditional transition: ensures two simultaneous cancel calls produce
  // exactly one success and one 409 INVALID_EVENT_STATE.
  const cancelled = await Event.findOneAndUpdate(
    filter,
    {
      $set: {
        status: EVENT_STATUSES.CANCELLED,
        cancelledAt: now,
        cancelReason: reason,
      },
    },
    { new: true }
  )
    .populate("organizerId", "fullName")
    .lean();

  if (!cancelled) {
    throw createServiceError(
      409,
      ERROR_CODES.INVALID_EVENT_STATE,
      "Event has already been cancelled or moved to a non-cancellable state."
    );
  }

  await writeSecurityLog({
    eventType: SECURITY_EVENT_TYPES.EVENT_CANCELLED,
    severity: SECURITY_SEVERITIES.MEDIUM,
    userId: actor._id || actor.id,
    eventId: cancelled._id,
    requestMeta,
    details: {
      reason,
      actorRole: actor.role,
    },
  });

  return toOwnerEvent(cancelled);
}

async function listPublicEvents({ page, limit, city, q }) {
  const filter = {
    status: { $nin: [EVENT_STATUSES.DRAFT, EVENT_STATUSES.CANCELLED] },
  };

  if (city) {
    filter.city = new RegExp(`^${escapeRegex(city)}$`, "i");
  }

  if (q) {
    filter.title = new RegExp(escapeRegex(q), "i");
  }

  const skip = (page - 1) * limit;
  const now = new Date();

  const [docs, total] = await Promise.all([
    Event.find(filter)
      .select(PUBLIC_EVENT_SELECT)
      .populate("organizerId", "fullName")
      .sort({ eventDate: 1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Event.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(total / limit);
  const items = docs.map((doc) => toPublicEvent(doc, null, now));

  return {
    items,
    page,
    limit,
    total,
    totalPages,
  };
}

async function getPublicEvent(eventId, viewer = null) {
  const doc = await Event.findById(eventId)
    .select(PUBLIC_EVENT_SELECT)
    .populate("organizerId", "fullName")
    .lean();

  if (!doc) {
    throw createServiceError(404, ERROR_CODES.NOT_FOUND, "Event not found.");
  }

  if (doc.status === EVENT_STATUSES.DRAFT) {
    const viewerId = viewer ? String(viewer._id || viewer.id) : null;
    const isAdmin = Boolean(viewer && viewer.role === USER_ROLES.ADMIN);
    const isOwner = Boolean(viewerId && extractOrganizerId(doc) === viewerId);

    if (!isAdmin && !isOwner) {
      throw createServiceError(404, ERROR_CODES.NOT_FOUND, "Event not found.");
    }
  }

  return toPublicEvent(doc);
}

async function listMyEvents(organizer, { page, limit, status }) {
  const organizerId = organizer._id || organizer.id;
  const filter = { organizerId };
  if (status) {
    filter.status = status;
  }

  const skip = (page - 1) * limit;
  const now = new Date();

  const [docs, total] = await Promise.all([
    Event.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Event.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(total / limit);
  const items = docs.map((doc) =>
    toOwnerEvent(doc, organizer.fullName || null, now)
  );

  return {
    items,
    page,
    limit,
    total,
    totalPages,
  };
}

module.exports = {
  CANCELLABLE_STATUSES,
  getEventPhase,
  toPublicEvent,
  toOwnerEvent,
  createEvent,
  updateEvent,
  publishEvent,
  cancelEvent,
  listPublicEvents,
  getPublicEvent,
  listMyEvents,
};
