const { ERROR_CODES } = require("../config/constants");
const { sendSuccess, sendError } = require("../utils/apiResponse");
const {
  isValidObjectId,
  validateCreateEventPayload,
  validateUpdateEventPayload,
  validateCancelPayload,
  validatePublicEventListQuery,
  validateMyEventsQuery,
} = require("../utils/eventValidators");
const eventService = require("../services/event.service");

function extractRequestMeta(req) {
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || "",
    userAgent: req.get("user-agent") || "",
  };
}

/**
 * GET /api/v1/events
 * Public paginated listing of non-DRAFT, non-CANCELLED events.
 */
async function listPublicEvents(req, res, next) {
  try {
    const queryResult = validatePublicEventListQuery(req.query);
    if (!queryResult.valid) {
      return sendError(
        res,
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Invalid event search or pagination parameters.",
        queryResult.errors
      );
    }

    const result = await eventService.listPublicEvents(queryResult.value);
    return sendSuccess(res, result, 200);
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/events/mine
 * Organizer-only paginated listing of the caller's own events (all statuses).
 */
async function listMyEvents(req, res, next) {
  try {
    const queryResult = validateMyEventsQuery(req.query);
    if (!queryResult.valid) {
      return sendError(
        res,
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Invalid event filter or pagination parameters.",
        queryResult.errors
      );
    }

    const result = await eventService.listMyEvents(req.user, queryResult.value);
    return sendSuccess(res, result, 200);
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/events/:eventId
 * Public event details (DRAFT visible only to owning ORGANIZER or ADMIN).
 */
async function getPublicEvent(req, res, next) {
  try {
    const { eventId } = req.params;
    if (!isValidObjectId(eventId)) {
      return sendError(res, 404, ERROR_CODES.NOT_FOUND, "Event not found.");
    }

    const event = await eventService.getPublicEvent(eventId, req.user || null);
    return sendSuccess(res, { event }, 200);
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/v1/events
 * Organizer creates a new DRAFT event.
 */
async function createEvent(req, res, next) {
  try {
    const validation = validateCreateEventPayload(req.body);
    if (!validation.valid) {
      return sendError(
        res,
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Please fix the highlighted event fields.",
        validation.errors
      );
    }

    const event = await eventService.createEvent(
      req.user,
      validation.value,
      extractRequestMeta(req)
    );
    return sendSuccess(res, { event }, 201);
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /api/v1/events/:eventId
 * Owning organizer updates a DRAFT event (all allowed fields) or a published
 * event's description only.
 */
async function updateEvent(req, res, next) {
  try {
    const { eventId } = req.params;
    if (!isValidObjectId(eventId)) {
      return sendError(res, 404, ERROR_CODES.NOT_FOUND, "Event not found.");
    }

    const validation = validateUpdateEventPayload(req.body);
    if (!validation.valid) {
      return sendError(
        res,
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Please fix the highlighted event fields.",
        validation.errors
      );
    }

    const event = await eventService.updateEvent(
      eventId,
      req.user,
      validation.value,
      extractRequestMeta(req)
    );
    return sendSuccess(res, { event }, 200);
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/v1/events/:eventId/publish
 * Owning organizer transitions a DRAFT event to PUBLISHED.
 */
async function publishEvent(req, res, next) {
  try {
    const { eventId } = req.params;
    if (!isValidObjectId(eventId)) {
      return sendError(res, 404, ERROR_CODES.NOT_FOUND, "Event not found.");
    }

    const event = await eventService.publishEvent(
      eventId,
      req.user,
      extractRequestMeta(req)
    );
    return sendSuccess(res, { event }, 200);
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/v1/events/:eventId/cancel
 * Owning organizer or ADMIN cancels an eligible event with a required reason.
 */
async function cancelEvent(req, res, next) {
  try {
    const { eventId } = req.params;
    if (!isValidObjectId(eventId)) {
      return sendError(res, 404, ERROR_CODES.NOT_FOUND, "Event not found.");
    }

    const validation = validateCancelPayload(req.body);
    if (!validation.valid) {
      return sendError(
        res,
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Please provide a valid cancellation reason.",
        validation.errors
      );
    }

    const event = await eventService.cancelEvent(
      eventId,
      req.user,
      validation.value,
      extractRequestMeta(req)
    );
    return sendSuccess(res, { event }, 200);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listPublicEvents,
  listMyEvents,
  getPublicEvent,
  createEvent,
  updateEvent,
  publishEvent,
  cancelEvent,
};
