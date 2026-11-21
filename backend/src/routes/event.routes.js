const express = require("express");
const { USER_ROLES } = require("../config/constants");
const {
  authenticate,
  optionalAuthenticate,
} = require("../middleware/auth.middleware");
const { requireRole } = require("../middleware/role.middleware");
const {
  createEventReadLimiter,
  createEventWriteLimiter,
} = require("../middleware/rateLimit.middleware");
const eventController = require("../controllers/event.controller");

function createEventRouter(options = {}) {
  const router = express.Router();
  const eventReadLimiter =
    options.eventReadLimiter || createEventReadLimiter();
  const eventWriteLimiter =
    options.eventWriteLimiter || createEventWriteLimiter();

  // Public event discovery
  router.get("/", eventReadLimiter, eventController.listPublicEvents);

  // IMPORTANT: Registered BEFORE /:eventId so "mine" is never matched as an eventId
  router.get(
    "/mine",
    authenticate,
    requireRole(USER_ROLES.ORGANIZER),
    eventController.listMyEvents
  );

  // Public event details with optional auth (owners and admins can preview DRAFT events)
  router.get(
    "/:eventId",
    eventReadLimiter,
    optionalAuthenticate,
    eventController.getPublicEvent
  );

  // Organizer-only event creation and editing (ADMIN receives 403)
  router.post(
    "/",
    authenticate,
    requireRole(USER_ROLES.ORGANIZER),
    eventWriteLimiter,
    eventController.createEvent
  );

  router.patch(
    "/:eventId",
    authenticate,
    requireRole(USER_ROLES.ORGANIZER),
    eventWriteLimiter,
    eventController.updateEvent
  );

  router.post(
    "/:eventId/publish",
    authenticate,
    requireRole(USER_ROLES.ORGANIZER),
    eventWriteLimiter,
    eventController.publishEvent
  );

  // Owning organizer or ADMIN may cancel an eligible event
  router.post(
    "/:eventId/cancel",
    authenticate,
    requireRole(USER_ROLES.ORGANIZER, USER_ROLES.ADMIN),
    eventWriteLimiter,
    eventController.cancelEvent
  );

  return router;
}

const defaultRouter = createEventRouter();
defaultRouter.createEventRouter = createEventRouter;

module.exports = defaultRouter;
