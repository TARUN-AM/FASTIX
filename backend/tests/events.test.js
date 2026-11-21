const express = require("express");
const mongoose = require("mongoose");
const request = require("supertest");

const app = require("../src/app");
const config = require("../src/config/env");
const constants = require("../src/config/constants");
const User = require("../src/models/User.model");
const Event = require("../src/models/Event.model");
const Booking = require("../src/models/Booking.model");
const Ticket = require("../src/models/Ticket.model");
const SecurityLog = require("../src/models/SecurityLog.model");
const { signAccessToken } = require("../src/utils/jwt");
const {
  isValidObjectId,
  validateCreateEventPayload,
  validateUpdateEventPayload,
  validateCancelPayload,
  validatePublicEventListQuery,
  validateMyEventsQuery,
} = require("../src/utils/eventValidators");
const {
  getEventPhase,
  toPublicEvent,
  toOwnerEvent,
} = require("../src/services/event.service");
const { createEventRouter } = require("../src/routes/event.routes");
const {
  createEventReadLimiter,
  createEventWriteLimiter,
} = require("../src/middleware/rateLimit.middleware");
const {
  notFoundHandler,
  errorHandler,
} = require("../src/middleware/errorHandler.middleware");
const {
  DEMO_ORGANIZER_EMAIL,
  buildDemoEventSpecs,
  seedEvents,
} = require("../scripts/seedEvents");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("./helpers/db");

let seq = 0;

function makeFutureEventPayload(overrides = {}) {
  const now = Date.now();
  return {
    title: "Demo Concert: Evening Resonance",
    description: "An open-air live concert with fair ticketing rules.",
    venueName: "City Center Amphitheatre",
    city: "Mumbai",
    eventDate: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
    registrationOpenAt: new Date(now - 5 * 60 * 1000).toISOString(),
    registrationCloseAt: new Date(now + 60 * 60 * 1000).toISOString(),
    totalTickets: 250,
    basePricePaise: 500000,
    maxTicketsPerIdentity: 2,
    holdDurationMinutes: 5,
    ...overrides,
  };
}

async function createUserWithRole(role, overrides = {}) {
  seq += 1;
  const user = await User.create({
    fullName: `${role} User ${seq}`,
    email: `${role.toLowerCase()}${seq}@example.com`,
    phone: `+919876800${String(seq).padStart(3, "0")}`,
    passwordHash: "$2a$10$abcdefghijklmnopqrstuv1234567890abcdef",
    role,
    ...overrides,
  });
  const token = signAccessToken(user);
  return { user, token };
}

function buildRateLimitedEventsApp({ readMax, writeMax }) {
  const testApp = express();
  testApp.use(express.json());
  testApp.use(
    "/api/v1/events",
    createEventRouter({
      eventReadLimiter: createEventReadLimiter({ max: readMax }),
      eventWriteLimiter: createEventWriteLimiter({ max: writeMax }),
    })
  );
  testApp.use(notFoundHandler);
  testApp.use(errorHandler);
  return testApp;
}

describe("Event unit, validator, phase, model, and config tests (no DB)", () => {
  test("getEventPhase returns DRAFT, UPCOMING, REGISTRATION_OPEN, REGISTRATION_CLOSED, and CANCELLED including exact boundaries", () => {
    const openAt = new Date("2026-06-01T10:00:00.000Z");
    const closeAt = new Date("2026-06-01T11:00:00.000Z");
    const baseEvent = {
      status: constants.EVENT_STATUSES.PUBLISHED,
      registrationOpenAt: openAt,
      registrationCloseAt: closeAt,
    };

    expect(
      getEventPhase(
        { ...baseEvent, status: constants.EVENT_STATUSES.DRAFT },
        openAt
      )
    ).toBe("DRAFT");

    expect(
      getEventPhase(
        { ...baseEvent, status: constants.EVENT_STATUSES.CANCELLED },
        openAt
      )
    ).toBe("CANCELLED");

    // 1 ms before open -> UPCOMING
    expect(
      getEventPhase(baseEvent, new Date(openAt.getTime() - 1))
    ).toBe("UPCOMING");

    // Exactly at registrationOpenAt -> REGISTRATION_OPEN (inclusive lower bound)
    expect(getEventPhase(baseEvent, new Date(openAt.getTime()))).toBe(
      "REGISTRATION_OPEN"
    );

    // 1 ms before close -> REGISTRATION_OPEN
    expect(
      getEventPhase(baseEvent, new Date(closeAt.getTime() - 1))
    ).toBe("REGISTRATION_OPEN");

    // Exactly at registrationCloseAt -> REGISTRATION_CLOSED (exclusive upper bound)
    expect(getEventPhase(baseEvent, new Date(closeAt.getTime()))).toBe(
      "REGISTRATION_CLOSED"
    );

    // After close -> REGISTRATION_CLOSED
    expect(
      getEventPhase(baseEvent, new Date(closeAt.getTime() + 60_000))
    ).toBe("REGISTRATION_CLOSED");
  });

  test("toPublicEvent whitelists fields, computes floor 110% resale cap, and strips organizerId, contact info, and internal counters", () => {
    const openAt = new Date(Date.now() - 60_000);
    const closeAt = new Date(Date.now() + 600_000);
    const eventDate = new Date(Date.now() + 86_400_000);
    const fakeDoc = {
      _id: new mongoose.Types.ObjectId(),
      organizerId: {
        _id: new mongoose.Types.ObjectId(),
        fullName: "Demo Organizer",
        email: "organizer@fairticket.demo",
        phone: "+919000000001",
      },
      title: "Demo Concert: Floor Check",
      description: "Plain text description",
      artist: "",
      category: constants.EVENT_CATEGORIES.CONCERT,
      venueName: "Central Hall",
      city: "Mumbai",
      eventDate,
      registrationOpenAt: openAt,
      registrationCloseAt: closeAt,
      totalTickets: 100,
      availableTickets: 42,
      heldTickets: 8,
      soldTickets: 50,
      basePricePaise: 10001,
      maxTicketsPerIdentity: 2,
      holdDurationMinutes: 5,
      status: constants.EVENT_STATUSES.PUBLISHED,
      publishedAt: openAt,
    };

    const pub = toPublicEvent(fakeDoc);
    expect(pub.maxResalePricePaise).toBe(11001); // Math.floor(10001 * 110 / 100)
    expect(pub.organizerName).toBe("Demo Organizer");
    expect(pub.soldOut).toBe(false);
    expect(pub.phase).toBe("REGISTRATION_OPEN");

    const serialized = JSON.stringify(pub);
    expect(serialized).not.toContain("organizerId");
    expect(serialized).not.toContain("organizer@fairticket.demo");
    expect(serialized).not.toContain("+919000000001");
    expect(serialized).not.toContain("availableTickets");
    expect(serialized).not.toContain("heldTickets");
    expect(serialized).not.toContain("soldTickets");
    expect(serialized).not.toContain("ticketsHeld");

    const owner = toOwnerEvent(fakeDoc);
    expect(owner.availableTickets).toBe(42);
    expect(owner.heldTickets).toBe(8);
    expect(owner.soldTickets).toBe(50);
    expect(owner.organizerId).toBeUndefined();
  });

  test("isValidObjectId validates 24-character hex strings only", () => {
    expect(isValidObjectId(new mongoose.Types.ObjectId().toString())).toBe(true);
    expect(isValidObjectId("mine")).toBe(false);
    expect(isValidObjectId("not-an-id")).toBe(false);
    expect(isValidObjectId("12345678901234567890123g")).toBe(false);
    expect(isValidObjectId(null)).toBe(false);
  });

  test("validateCreateEventPayload rejects invalid prices, counts, hold duration, angle brackets, bad dates, non-strings, and unknown fields together", () => {
    const now = new Date("2026-06-01T10:00:00.000Z");

    // Multiple field errors collected together
    const multiBad = validateCreateEventPayload(
      {
        title: "Hi",
        description: "<script>alert(1)</script>",
        venueName: ["Array venue"],
        city: { $ne: "Mumbai" },
        basePricePaise: 500000.5,
        totalTickets: 0,
        maxTicketsPerIdentity: 3,
        holdDurationMinutes: 16,
        eventDate: 1700000000000,
        registrationOpenAt: "2026-06-01 10:00:00",
        registrationCloseAt: { $gt: 0 },
        organizerId: "507f1f77bcf86cd799439011",
        status: "PUBLISHED",
        availableTickets: 999,
        heldTickets: 1,
        soldTickets: 2,
        publishedAt: "2026-06-01T10:00:00.000Z",
        _id: "507f1f77bcf86cd799439011",
        role: "ADMIN",
      },
      now
    );

    expect(multiBad.valid).toBe(false);
    const fields = multiBad.errors.map((e) => e.field);
    expect(fields).toEqual(
      expect.arrayContaining([
        "title",
        "description",
        "venueName",
        "city",
        "basePricePaise",
        "totalTickets",
        "maxTicketsPerIdentity",
        "holdDurationMinutes",
        "eventDate",
        "registrationOpenAt",
        "registrationCloseAt",
        "organizerId",
        "status",
        "availableTickets",
        "heldTickets",
        "soldTickets",
        "publishedAt",
        "_id",
        "role",
      ])
    );

    // Individual price edge cases
    for (const badPrice of [
      constants.EVENT_MIN_PRICE_PAISE - 1,
      constants.EVENT_MAX_PRICE_PAISE + 1,
      500000.5,
      "500000",
      -100,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      const r = validateCreateEventPayload(
        makeFutureEventPayload({ basePricePaise: badPrice }),
        now
      );
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.field === "basePricePaise")).toBe(true);
    }

    // totalTickets edge cases
    for (const badTotal of [
      0,
      10.5,
      constants.EVENT_MAX_TOTAL_TICKETS + 1,
    ]) {
      const r = validateCreateEventPayload(
        makeFutureEventPayload({ totalTickets: badTotal }),
        now
      );
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.field === "totalTickets")).toBe(true);
    }

    // holdDurationMinutes 0 and 16 rejected
    for (const badHold of [0, 16, 31]) {
      const r = validateCreateEventPayload(
        makeFutureEventPayload({ holdDurationMinutes: badHold }),
        now
      );
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.field === "holdDurationMinutes")).toBe(
        true
      );
    }

    // Schedule errors: close in past, window too short, start before close
    const pastClose = validateCreateEventPayload(
      makeFutureEventPayload({
        registrationOpenAt: "2026-06-01T08:00:00.000Z",
        registrationCloseAt: "2026-06-01T09:00:00.000Z",
        eventDate: "2026-06-02T10:00:00.000Z",
      }),
      now
    );
    expect(pastClose.valid).toBe(false);
    expect(
      pastClose.errors.some((e) => e.field === "registrationCloseAt")
    ).toBe(true);

    const shortWindow = validateCreateEventPayload(
      makeFutureEventPayload({
        registrationOpenAt: "2026-06-01T11:00:00.000Z",
        registrationCloseAt: "2026-06-01T11:00:30.000Z",
        eventDate: "2026-06-02T10:00:00.000Z",
      }),
      now
    );
    expect(shortWindow.valid).toBe(false);
    expect(
      shortWindow.errors.some((e) => e.field === "registrationCloseAt")
    ).toBe(true);

    const startBeforeClose = validateCreateEventPayload(
      makeFutureEventPayload({
        registrationOpenAt: "2026-06-01T11:00:00.000Z",
        registrationCloseAt: "2026-06-01T12:00:00.000Z",
        eventDate: "2026-06-01T11:30:00.000Z",
      }),
      now
    );
    expect(startBeforeClose.valid).toBe(false);
    expect(startBeforeClose.errors.some((e) => e.field === "eventDate")).toBe(
      true
    );

    // Invalid calendar date (Feb 31) rejected
    const rolledDate = validateCreateEventPayload(
      makeFutureEventPayload({
        eventDate: "2026-02-31T12:00:00.000Z",
      }),
      now
    );
    expect(rolledDate.valid).toBe(false);
    expect(rolledDate.errors.some((e) => e.field === "eventDate")).toBe(true);
  });

  test("validatePublicEventListQuery and validateMyEventsQuery reject bad pagination and NoSQL operator objects", () => {
    for (const badQuery of [
      { page: "0" },
      { page: "-1" },
      { page: "abc" },
      { limit: "0" },
      { limit: "1000" },
      { limit: "1.5" },
      { city: { $ne: "Mumbai" } },
      { q: { $regex: ".*" } },
      { city: ["Mumbai", "Pune"] },
    ]) {
      const res = validatePublicEventListQuery(badQuery);
      expect(res.valid).toBe(false);
    }

    expect(
      validateMyEventsQuery({ status: "INVALID_STATUS" }).valid
    ).toBe(false);
    expect(
      validateMyEventsQuery({ status: constants.EVENT_STATUSES.DRAFT }).valid
    ).toBe(true);
    expect(validateCancelPayload({ reason: "ab" }).valid).toBe(false);
    expect(validateCancelPayload({ reason: "a".repeat(301) }).valid).toBe(
      false
    );
    expect(validateCancelPayload({ reason: 12345 }).valid).toBe(false);
    expect(validateUpdateEventPayload({}).valid).toBe(false);
  });

  test("Direct Mongoose Event validation rejects maxTicketsPerIdentity 3 and invalid schedule order", async () => {
    const base = {
      organizerId: new mongoose.Types.ObjectId(),
      title: "Model Validation Event",
      venueName: "Main Arena",
      city: "Mumbai",
      eventDate: new Date("2026-07-01T18:00:00.000Z"),
      registrationOpenAt: new Date("2026-06-15T10:00:00.000Z"),
      registrationCloseAt: new Date("2026-06-15T12:00:00.000Z"),
      totalTickets: 100,
      availableTickets: 100,
      basePricePaise: 500000,
    };

    const badLimit = new Event({ ...base, maxTicketsPerIdentity: 3 });
    await expect(badLimit.validate()).rejects.toThrow();

    const closeBeforeOpen = new Event({
      ...base,
      registrationOpenAt: new Date("2026-06-15T12:00:00.000Z"),
      registrationCloseAt: new Date("2026-06-15T11:00:00.000Z"),
    });
    await expect(closeBeforeOpen.validate()).rejects.toThrow();

    const startBeforeClose = new Event({
      ...base,
      eventDate: new Date("2026-06-15T11:30:00.000Z"),
    });
    await expect(startBeforeClose.validate()).rejects.toThrow();
  });

  test("buildConfig validates EVENT_WRITE_RATE_LIMIT_MAX and EVENT_READ_RATE_LIMIT_MAX defaults and rejects bad values", () => {
    const baseEnv = {
      NODE_ENV: "test",
      PORT: "5000",
      MONGODB_URI: "mongodb://127.0.0.1:27017/fairticket_test",
      CORS_ORIGIN: "http://localhost:3000",
      JWT_SECRET: "a_valid_test_jwt_secret_at_least_32_characters_long",
      IDENTITY_HASH_SECRET: "a_valid_test_secret_at_least_32_characters_long",
    };

    const defaults = config.buildConfig(baseEnv);
    expect(defaults.events.writeRateLimitMax).toBe(60);
    expect(defaults.events.readRateLimitMax).toBe(200);

    for (const badVal of ["0", "-5", "12.5", "abc"]) {
      expect(() =>
        config.buildConfig({ ...baseEnv, EVENT_WRITE_RATE_LIMIT_MAX: badVal })
      ).toThrow(/EVENT_WRITE_RATE_LIMIT_MAX/);
      expect(() =>
        config.buildConfig({ ...baseEnv, EVENT_READ_RATE_LIMIT_MAX: badVal })
      ).toThrow(/EVENT_READ_RATE_LIMIT_MAX/);
    }
  });

  test("seedEvents refuses NODE_ENV=production and demo titles contain no real artist names", async () => {
    await expect(seedEvents({ nodeEnv: "production" })).rejects.toThrow(
      /production/i
    );

    const specs = buildDemoEventSpecs();
    expect(specs).toHaveLength(3);
    for (const spec of specs) {
      expect(spec.title.startsWith("Demo")).toBe(true);
      expect(spec.title).not.toMatch(/coldplay|taylor|diljit|arijit|bts/i);
    }
  });

  test("HTTP smoke checks without DB: invalid ObjectId returns 404 and unauthenticated POST returns 401", async () => {
    const invalidGet = await request(app).get("/api/v1/events/not-a-valid-id");
    expect(invalidGet.status).toBe(404);
    expect(invalidGet.body.error.code).toBe(constants.ERROR_CODES.NOT_FOUND);

    const unauthPost = await request(app)
      .post("/api/v1/events")
      .send(makeFutureEventPayload());
    expect(unauthPost.status).toBe(401);
    expect(unauthPost.body.error.code).toBe(constants.ERROR_CODES.UNAUTHORIZED);
  });
});

describe("Event API and seed MongoDB integration tests", () => {
  beforeAll(async () => {
    await connectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  describe("Create and validation", () => {
    test("ORGANIZER creates a DRAFT event with initialized counters and SecurityLog EVENT_CREATED", async () => {
      const { user: organizer, token } = await createUserWithRole(
        constants.USER_ROLES.ORGANIZER
      );

      const res = await request(app)
        .post("/api/v1/events")
        .set("Authorization", `Bearer ${token}`)
        .send(makeFutureEventPayload());

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.event.status).toBe(constants.EVENT_STATUSES.DRAFT);
      expect(res.body.data.event.availableTickets).toBe(250);
      expect(res.body.data.event.heldTickets).toBe(0);
      expect(res.body.data.event.soldTickets).toBe(0);
      expect(res.body.data.event.maxResalePricePaise).toBe(550000);
      expect(res.body.data.event.organizerId).toBeUndefined();

      const saved = await Event.findById(res.body.data.event.id).lean();
      expect(String(saved.organizerId)).toBe(String(organizer._id));
      expect(saved.availableTickets).toBe(250);
      expect(saved.heldTickets).toBe(0);
      expect(saved.soldTickets).toBe(0);

      const log = await SecurityLog.findOne({
        eventType: constants.SECURITY_EVENT_TYPES.EVENT_CREATED,
        eventId: saved._id,
      }).lean();
      expect(log).not.toBeNull();
      expect(log.severity).toBe(constants.SECURITY_SEVERITIES.LOW);
    });

    test("CUSTOMER, ADMIN, and GATE_STAFF get 403 on create; no token gets 401", async () => {
      const payload = makeFutureEventPayload();

      const noAuth = await request(app).post("/api/v1/events").send(payload);
      expect(noAuth.status).toBe(401);

      for (const role of [
        constants.USER_ROLES.CUSTOMER,
        constants.USER_ROLES.ADMIN,
        constants.USER_ROLES.GATE_STAFF,
      ]) {
        const { token } = await createUserWithRole(role);
        const res = await request(app)
          .post("/api/v1/events")
          .set("Authorization", `Bearer ${token}`)
          .send(payload);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe(constants.ERROR_CODES.FORBIDDEN);
      }
    });

    test("Rejects mass-assignment fields and returns 400 without creating anything", async () => {
      const { token } = await createUserWithRole(
        constants.USER_ROLES.ORGANIZER
      );

      for (const extra of [
        { organizerId: new mongoose.Types.ObjectId().toString() },
        { status: constants.EVENT_STATUSES.PUBLISHED },
        { availableTickets: 10 },
        { heldTickets: 2 },
        { soldTickets: 5 },
        { publishedAt: new Date().toISOString() },
        { _id: new mongoose.Types.ObjectId().toString() },
        { role: "ADMIN" },
      ]) {
        const res = await request(app)
          .post("/api/v1/events")
          .set("Authorization", `Bearer ${token}`)
          .send(makeFutureEventPayload(extra));
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe(
          constants.ERROR_CODES.VALIDATION_ERROR
        );
      }

      expect(await Event.countDocuments()).toBe(0);
    });

    test("Returns all validation errors together with 400 VALIDATION_ERROR and never 500", async () => {
      const { token } = await createUserWithRole(
        constants.USER_ROLES.ORGANIZER
      );

      const res = await request(app)
        .post("/api/v1/events")
        .set("Authorization", `Bearer ${token}`)
        .send({
          title: "No",
          description: "Bad <script> tag",
          venueName: "A",
          city: "X",
          basePricePaise: "500000",
          totalTickets: 0,
          maxTicketsPerIdentity: 3,
          holdDurationMinutes: 31,
          eventDate: "not-iso",
          registrationOpenAt: 12345,
          registrationCloseAt: { bad: true },
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(constants.ERROR_CODES.VALIDATION_ERROR);
      expect(Array.isArray(res.body.error.details)).toBe(true);
      expect(res.body.error.details.length).toBeGreaterThanOrEqual(8);
    });
  });

  describe("Edit rules", () => {
    test("Owner can edit DRAFT fields with merged schedule validation; another organizer gets 404 + EVENT_ACCESS_DENIED; ADMIN and CUSTOMER get 403", async () => {
      const { token: org1Token } = await createUserWithRole(
        constants.USER_ROLES.ORGANIZER
      );
      const { user: org2, token: org2Token } = await createUserWithRole(
        constants.USER_ROLES.ORGANIZER
      );
      const { token: adminToken } = await createUserWithRole(
        constants.USER_ROLES.ADMIN
      );
      const { token: customerToken } = await createUserWithRole(
        constants.USER_ROLES.CUSTOMER
      );

      const created = await request(app)
        .post("/api/v1/events")
        .set("Authorization", `Bearer ${org1Token}`)
        .send(makeFutureEventPayload());
      const eventId = created.body.data.event.id;

      // Valid DRAFT update
      const updated = await request(app)
        .patch(`/api/v1/events/${eventId}`)
        .set("Authorization", `Bearer ${org1Token}`)
        .send({
          title: "Demo Concert: Updated Title",
          totalTickets: 400,
          basePricePaise: 600000,
        });
      expect(updated.status).toBe(200);
      expect(updated.body.data.event.title).toBe("Demo Concert: Updated Title");
      expect(updated.body.data.event.totalTickets).toBe(400);
      expect(updated.body.data.event.availableTickets).toBe(400);
      expect(updated.body.data.event.maxResalePricePaise).toBe(660000);

      // Merged schedule violation (eventDate earlier than existing registrationCloseAt)
      const badSchedule = await request(app)
        .patch(`/api/v1/events/${eventId}`)
        .set("Authorization", `Bearer ${org1Token}`)
        .send({
          eventDate: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        });
      expect(badSchedule.status).toBe(400);
      expect(badSchedule.body.error.code).toBe(
        constants.ERROR_CODES.VALIDATION_ERROR
      );

      // Another organizer gets 404 + EVENT_ACCESS_DENIED log
      const otherOrgRes = await request(app)
        .patch(`/api/v1/events/${eventId}`)
        .set("Authorization", `Bearer ${org2Token}`)
        .send({ title: "Hijacked Event" });
      expect(otherOrgRes.status).toBe(404);
      const deniedLog = await SecurityLog.findOne({
        eventType: constants.SECURITY_EVENT_TYPES.EVENT_ACCESS_DENIED,
        userId: org2._id,
        eventId,
      }).lean();
      expect(deniedLog).not.toBeNull();

      // ADMIN and CUSTOMER get 403
      const adminEdit = await request(app)
        .patch(`/api/v1/events/${eventId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ description: "Admin edit attempt" });
      expect(adminEdit.status).toBe(403);

      const custEdit = await request(app)
        .patch(`/api/v1/events/${eventId}`)
        .set("Authorization", `Bearer ${customerToken}`)
        .send({ description: "Customer edit attempt" });
      expect(custEdit.status).toBe(403);

      // Invalid ObjectId returns 404
      const invalidIdRes = await request(app)
        .patch("/api/v1/events/not-an-object-id")
        .set("Authorization", `Bearer ${org1Token}`)
        .send({ description: "Valid text" });
      expect(invalidIdRes.status).toBe(404);
    });

    test("After publishing, only description can change; mixed body rejected atomically with 409 EVENT_LOCKED; cancelled cannot be edited", async () => {
      const { token } = await createUserWithRole(
        constants.USER_ROLES.ORGANIZER
      );

      const created = await request(app)
        .post("/api/v1/events")
        .set("Authorization", `Bearer ${token}`)
        .send(makeFutureEventPayload());
      const eventId = created.body.data.event.id;

      await request(app)
        .post(`/api/v1/events/${eventId}/publish`)
        .set("Authorization", `Bearer ${token}`);

      // Description-only update succeeds
      const descUpdate = await request(app)
        .patch(`/api/v1/events/${eventId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ description: "Updated plain-text schedule info." });
      expect(descUpdate.status).toBe(200);
      expect(descUpdate.body.data.event.description).toBe(
        "Updated plain-text schedule info."
      );

      // Locked fields and mixed body rejected atomically
      const lockedBodies = [
        { basePricePaise: 700000 },
        { totalTickets: 500 },
        { maxTicketsPerIdentity: 1 },
        { holdDurationMinutes: 10 },
        { title: "Changed Title" },
        { venueName: "Changed Venue" },
        {
          description: "Should NOT be saved",
          basePricePaise: 700000,
        },
      ];

      for (const body of lockedBodies) {
        const res = await request(app)
          .patch(`/api/v1/events/${eventId}`)
          .set("Authorization", `Bearer ${token}`)
          .send(body);
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe(constants.ERROR_CODES.EVENT_LOCKED);
      }

      const dbEvent = await Event.findById(eventId).lean();
      expect(dbEvent.description).toBe("Updated plain-text schedule info.");
      expect(dbEvent.basePricePaise).toBe(500000);

      // Cancel then attempt edit -> 409 EVENT_LOCKED
      await request(app)
        .post(`/api/v1/events/${eventId}/cancel`)
        .set("Authorization", `Bearer ${token}`)
        .send({ reason: "Venue maintenance required." });

      const editCancelled = await request(app)
        .patch(`/api/v1/events/${eventId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ description: "Try editing cancelled event" });
      expect(editCancelled.status).toBe(409);
      expect(editCancelled.body.error.code).toBe(
        constants.ERROR_CODES.EVENT_LOCKED
      );
    });
  });

  describe("Publish and concurrency", () => {
    test("Owner publishes DRAFT, double publish returns 409, past close returns 409, non-owner 404, customer 403", async () => {
      const { token: org1Token } = await createUserWithRole(
        constants.USER_ROLES.ORGANIZER
      );
      const { token: org2Token } = await createUserWithRole(
        constants.USER_ROLES.ORGANIZER
      );
      const { token: custToken } = await createUserWithRole(
        constants.USER_ROLES.CUSTOMER
      );

      const created = await request(app)
        .post("/api/v1/events")
        .set("Authorization", `Bearer ${org1Token}`)
        .send(makeFutureEventPayload());
      const eventId = created.body.data.event.id;

      expect(
        (
          await request(app)
            .post(`/api/v1/events/${eventId}/publish`)
            .set("Authorization", `Bearer ${org2Token}`)
        ).status
      ).toBe(404);

      expect(
        (
          await request(app)
            .post(`/api/v1/events/${eventId}/publish`)
            .set("Authorization", `Bearer ${custToken}`)
        ).status
      ).toBe(403);

      const pubRes = await request(app)
        .post(`/api/v1/events/${eventId}/publish`)
        .set("Authorization", `Bearer ${org1Token}`);
      expect(pubRes.status).toBe(200);
      expect(pubRes.body.data.event.status).toBe(
        constants.EVENT_STATUSES.PUBLISHED
      );
      expect(pubRes.body.data.event.publishedAt).toBeTruthy();

      const pubLog = await SecurityLog.findOne({
        eventType: constants.SECURITY_EVENT_TYPES.EVENT_PUBLISHED,
        eventId,
      }).lean();
      expect(pubLog).not.toBeNull();

      const secondPub = await request(app)
        .post(`/api/v1/events/${eventId}/publish`)
        .set("Authorization", `Bearer ${org1Token}`);
      expect(secondPub.status).toBe(409);
      expect(secondPub.body.error.code).toBe(
        constants.ERROR_CODES.INVALID_EVENT_STATE
      );

      // Expired registrationCloseAt returns 409 EVENT_REGISTRATION_ALREADY_CLOSED
      const created2 = await request(app)
        .post("/api/v1/events")
        .set("Authorization", `Bearer ${org1Token}`)
        .send(makeFutureEventPayload());
      const event2Id = created2.body.data.event.id;
      await Event.updateOne(
        { _id: event2Id },
        { $set: { registrationCloseAt: new Date(Date.now() - 60_000) } }
      );
      const expiredPub = await request(app)
        .post(`/api/v1/events/${event2Id}/publish`)
        .set("Authorization", `Bearer ${org1Token}`);
      expect(expiredPub.status).toBe(409);
      expect(expiredPub.body.error.code).toBe(
        constants.ERROR_CODES.EVENT_REGISTRATION_ALREADY_CLOSED
      );
    });

    test("Two simultaneous publish calls produce exactly one 200 and one 409", async () => {
      const { token } = await createUserWithRole(
        constants.USER_ROLES.ORGANIZER
      );
      const created = await request(app)
        .post("/api/v1/events")
        .set("Authorization", `Bearer ${token}`)
        .send(makeFutureEventPayload());
      const eventId = created.body.data.event.id;

      const [r1, r2] = await Promise.all([
        request(app)
          .post(`/api/v1/events/${eventId}/publish`)
          .set("Authorization", `Bearer ${token}`),
        request(app)
          .post(`/api/v1/events/${eventId}/publish`)
          .set("Authorization", `Bearer ${token}`),
      ]);

      const statuses = [r1.status, r2.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 409]);
    });

    test("Publish racing a price edit preserves consistent final state", async () => {
      const { token } = await createUserWithRole(
        constants.USER_ROLES.ORGANIZER
      );
      const created = await request(app)
        .post("/api/v1/events")
        .set("Authorization", `Bearer ${token}`)
        .send(makeFutureEventPayload({ basePricePaise: 500000 }));
      const eventId = created.body.data.event.id;

      const [pubRes, editRes] = await Promise.all([
        request(app)
          .post(`/api/v1/events/${eventId}/publish`)
          .set("Authorization", `Bearer ${token}`),
        request(app)
          .patch(`/api/v1/events/${eventId}`)
          .set("Authorization", `Bearer ${token}`)
          .send({ basePricePaise: 750000 }),
      ]);

      expect(pubRes.status).toBe(200);
      expect([200, 409]).toContain(editRes.status);

      const finalDoc = await Event.findById(eventId).lean();
      expect(finalDoc.status).toBe(constants.EVENT_STATUSES.PUBLISHED);
      if (editRes.status === 409) {
        expect(editRes.body.error.code).toBe(
          constants.ERROR_CODES.EVENT_LOCKED
        );
        expect(finalDoc.basePricePaise).toBe(500000);
      } else {
        expect(finalDoc.basePricePaise).toBe(750000);
      }
    });
  });

  describe("Cancel and guards", () => {
    test("Owner and ADMIN can cancel; another organizer gets 404; bad reason gets 400; double and concurrent cancels return 409", async () => {
      const { token: org1Token } = await createUserWithRole(
        constants.USER_ROLES.ORGANIZER
      );
      const { token: org2Token } = await createUserWithRole(
        constants.USER_ROLES.ORGANIZER
      );
      const { token: adminToken } = await createUserWithRole(
        constants.USER_ROLES.ADMIN
      );

      const created1 = await request(app)
        .post("/api/v1/events")
        .set("Authorization", `Bearer ${org1Token}`)
        .send(makeFutureEventPayload());
      const id1 = created1.body.data.event.id;
      await request(app)
        .post(`/api/v1/events/${id1}/publish`)
        .set("Authorization", `Bearer ${org1Token}`);

      // Another organizer -> 404
      const otherCancel = await request(app)
        .post(`/api/v1/events/${id1}/cancel`)
        .set("Authorization", `Bearer ${org2Token}`)
        .send({ reason: "Unauthorized attempt" });
      expect(otherCancel.status).toBe(404);

      // Bad reasons -> 400
      for (const badBody of [
        {},
        { reason: "no" },
        { reason: "x".repeat(301) },
        { reason: 12345 },
      ]) {
        const res = await request(app)
          .post(`/api/v1/events/${id1}/cancel`)
          .set("Authorization", `Bearer ${org1Token}`)
          .send(badBody);
        expect(res.status).toBe(400);
      }

      // Concurrent cancel by owner -> one 200, one 409
      const [c1, c2] = await Promise.all([
        request(app)
          .post(`/api/v1/events/${id1}/cancel`)
          .set("Authorization", `Bearer ${org1Token}`)
          .send({ reason: "Severe weather advisory." }),
        request(app)
          .post(`/api/v1/events/${id1}/cancel`)
          .set("Authorization", `Bearer ${org1Token}`)
          .send({ reason: "Severe weather advisory." }),
      ]);
      expect([c1.status, c2.status].sort((a, b) => a - b)).toEqual([200, 409]);

      const log = await SecurityLog.findOne({
        eventType: constants.SECURITY_EVENT_TYPES.EVENT_CANCELLED,
        eventId: id1,
      }).lean();
      expect(log).not.toBeNull();
      expect(log.severity).toBe(constants.SECURITY_SEVERITIES.MEDIUM);

      // ADMIN cancels another event
      const created2 = await request(app)
        .post("/api/v1/events")
        .set("Authorization", `Bearer ${org1Token}`)
        .send(makeFutureEventPayload());
      const id2 = created2.body.data.event.id;
      const adminCancel = await request(app)
        .post(`/api/v1/events/${id2}/cancel`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ reason: "Policy review cancellation." });
      expect(adminCancel.status).toBe(200);
      expect(adminCancel.body.data.event.status).toBe(
        constants.EVENT_STATUSES.CANCELLED
      );
      expect(adminCancel.body.data.event.cancelReason).toBe(
        "Policy review cancellation."
      );
    });

    test("Blocks cancellation with 409 EVENT_HAS_BOOKINGS when a Booking or Ticket exists", async () => {
      const { user: org, token: orgToken } = await createUserWithRole(
        constants.USER_ROLES.ORGANIZER
      );
      const { user: customer } = await createUserWithRole(
        constants.USER_ROLES.CUSTOMER
      );

      const created = await request(app)
        .post("/api/v1/events")
        .set("Authorization", `Bearer ${orgToken}`)
        .send(makeFutureEventPayload());
      const eventId = created.body.data.event.id;
      await request(app)
        .post(`/api/v1/events/${eventId}/publish`)
        .set("Authorization", `Bearer ${orgToken}`);

      await Booking.create({
        bookingReference: "FT-2026-990001",
        eventId,
        userId: customer._id,
        identityHash: `0x${"a".repeat(64)}`,
        walletAddress: "0x1111111111111111111111111111111111111111",
        holdId: new mongoose.Types.ObjectId(),
        paymentId: new mongoose.Types.ObjectId(),
        quantity: 1,
        totalAmountPaise: 500000,
        authNonce: `0x${"b".repeat(64)}`,
        authExpiry: Math.floor(Date.now() / 1000) + 180,
      });

      const res = await request(app)
        .post(`/api/v1/events/${eventId}/cancel`)
        .set("Authorization", `Bearer ${orgToken}`)
        .send({ reason: "Attempted cancel after booking." });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(
        constants.ERROR_CODES.EVENT_HAS_BOOKINGS
      );

      const stillPublished = await Event.findById(eventId).lean();
      expect(stillPublished.status).toBe(constants.EVENT_STATUSES.PUBLISHED);

      // Also verify Ticket-only guard on a second event
      const created2 = await request(app)
        .post("/api/v1/events")
        .set("Authorization", `Bearer ${orgToken}`)
        .send(makeFutureEventPayload({ title: "Demo Concert: Ticket Guard" }));
      const event2Id = created2.body.data.event.id;
      await Ticket.create({
        onChainTicketId: 101,
        eventId: event2Id,
        onChainEventId: 1,
        bookingId: new mongoose.Types.ObjectId(),
        originalBuyerUserId: customer._id,
        originalOwnerWallet: "0x1111111111111111111111111111111111111111",
        currentOwnerUserId: customer._id,
        currentOwnerWallet: "0x1111111111111111111111111111111111111111",
        currentOwnerIdentityHash: `0x${"c".repeat(64)}`,
        originalPricePaise: 500000,
        lastSalePricePaise: 500000,
        maxResalePricePaise: 550000,
        mintTxHash: `0x${"d".repeat(64)}`,
      });

      const res2 = await request(app)
        .post(`/api/v1/events/${event2Id}/cancel`)
        .set("Authorization", `Bearer ${orgToken}`)
        .send({ reason: "Attempted cancel after ticket." });
      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe(
        constants.ERROR_CODES.EVENT_HAS_BOOKINGS
      );
      expect(org._id).toBeTruthy();
    });
  });

  describe("Public reading, filtering, pagination, and /mine", () => {
    test("GET /events returns only published events, whitelisted fields, escaped regex, case-insensitive filters, and 30-event pagination", async () => {
      const { user: org, token: orgToken } = await createUserWithRole(
        constants.USER_ROLES.ORGANIZER,
        {
          fullName: "Public Organizer",
          email: "secret.org@example.com",
          phone: "+919999888777",
        }
      );

      // Create 1 DRAFT and 1 CANCELLED (neither should appear in GET /events)
      await Event.create({
        organizerId: org._id,
        title: "Demo Draft Hidden",
        venueName: "Hidden Hall",
        city: "Mumbai",
        eventDate: new Date(Date.now() + 5 * 86_400_000),
        registrationOpenAt: new Date(Date.now() - 60_000),
        registrationCloseAt: new Date(Date.now() + 600_000),
        totalTickets: 100,
        availableTickets: 100,
        basePricePaise: 500000,
        status: constants.EVENT_STATUSES.DRAFT,
      });

      await Event.create({
        organizerId: org._id,
        title: "Demo Cancelled Hidden",
        venueName: "Cancelled Hall",
        city: "Mumbai",
        eventDate: new Date(Date.now() + 6 * 86_400_000),
        registrationOpenAt: new Date(Date.now() - 60_000),
        registrationCloseAt: new Date(Date.now() + 600_000),
        totalTickets: 100,
        availableTickets: 100,
        basePricePaise: 500000,
        status: constants.EVENT_STATUSES.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: "Cancelled for test",
      });

      // Insert 30 PUBLISHED events
      const baseNow = Date.now();
      const bulk = [];
      for (let i = 1; i <= 30; i += 1) {
        bulk.push({
          organizerId: org._id,
          title:
            i === 1
              ? "Demo Concert: Summer Lights"
              : `Demo Concert: Evening Show ${String(i).padStart(2, "0")}`,
          venueName: `Arena ${i}`,
          city: i % 2 === 0 ? "Pune" : "Mumbai",
          eventDate: new Date(baseNow + (10 + i) * 86_400_000),
          registrationOpenAt: new Date(baseNow - 60_000),
          registrationCloseAt: new Date(baseNow + 3600_000),
          totalTickets: 100,
          availableTickets: 80,
          heldTickets: 10,
          soldTickets: 10,
          basePricePaise: i === 2 ? 10001 : 500000,
          maxResalePricePaise: i === 2 ? 11001 : 550000,
          status: constants.EVENT_STATUSES.PUBLISHED,
          publishedAt: new Date(baseNow),
        });
      }
      await Event.insertMany(bulk);

      // Pagination across 3 pages: 12, 12, 6
      const p1 = await request(app).get("/api/v1/events?page=1&limit=12");
      const p2 = await request(app).get("/api/v1/events?page=2&limit=12");
      const p3 = await request(app).get("/api/v1/events?page=3&limit=12");

      expect(p1.status).toBe(200);
      expect(p1.body.data.items).toHaveLength(12);
      expect(p2.body.data.items).toHaveLength(12);
      expect(p3.body.data.items).toHaveLength(6);
      expect(p1.body.data.total).toBe(30);
      expect(p1.body.data.totalPages).toBe(3);

      const allIds = [
        ...p1.body.data.items,
        ...p2.body.data.items,
        ...p3.body.data.items,
      ].map((item) => item.id);
      expect(new Set(allIds).size).toBe(30);

      // Verify whitelist / no leakage
      const rawJson = JSON.stringify(p1.body.data);
      expect(rawJson).not.toContain("organizerId");
      expect(rawJson).not.toContain("secret.org@example.com");
      expect(rawJson).not.toContain("+919999888777");
      expect(rawJson).not.toContain("heldTickets");
      expect(rawJson).not.toContain("availableTickets");
      expect(rawJson).not.toContain("soldTickets");
      expect(rawJson).not.toContain("ticketsHeld");
      expect(p1.body.data.items[0].maxResalePricePaise).toBe(550000);
      expect(p1.body.data.items[1].maxResalePricePaise).toBe(11001);

      // Escaped regex search and ReDoS resistance
      const wildcard = await request(app).get("/api/v1/events?q=.*");
      expect(wildcard.status).toBe(200);
      expect(wildcard.body.data.items).toHaveLength(0);

      const redos = await request(app).get(
        `/api/v1/events?q=${encodeURIComponent("(a+)+$")}`
      );
      expect(redos.status).toBe(200);
      expect(redos.body.data.items).toHaveLength(0);

      // Case-insensitive title & city filters
      const qSummer = await request(app).get("/api/v1/events?q=SUMMER");
      expect(qSummer.status).toBe(200);
      expect(qSummer.body.data.items).toHaveLength(1);
      expect(qSummer.body.data.items[0].title).toBe(
        "Demo Concert: Summer Lights"
      );

      const cityPune = await request(app).get("/api/v1/events?city=pune");
      expect(cityPune.status).toBe(200);
      expect(cityPune.body.data.total).toBe(15);

      // Bad query parameters and NoSQL object injection return 400
      for (const qs of [
        "page=0",
        "page=-1",
        "page=abc",
        "limit=0",
        "limit=1000",
        "limit=1.5",
        "city[$ne]=Mumbai",
        "q[$regex]=.*",
      ]) {
        const bad = await request(app).get(`/api/v1/events?${qs}`);
        expect(bad.status).toBe(400);
      }

      expect(orgToken).toBeTruthy();
    });

    test("GET /events/:id enforces DRAFT visibility, shows CANCELLED to all, ignores garbage Bearer token; GET /events/mine is owner-only", async () => {
      const { token: org1Token } = await createUserWithRole(
        constants.USER_ROLES.ORGANIZER
      );
      const { token: org2Token } = await createUserWithRole(
        constants.USER_ROLES.ORGANIZER
      );
      const { token: adminToken } = await createUserWithRole(
        constants.USER_ROLES.ADMIN
      );
      const { token: custToken } = await createUserWithRole(
        constants.USER_ROLES.CUSTOMER
      );

      const draftRes = await request(app)
        .post("/api/v1/events")
        .set("Authorization", `Bearer ${org1Token}`)
        .send(makeFutureEventPayload({ title: "Demo Concert: Secret Draft" }));
      const draftId = draftRes.body.data.event.id;

      // DRAFT hidden from logged-out, customer, other organizer; visible to owner & admin
      expect((await request(app).get(`/api/v1/events/${draftId}`)).status).toBe(
        404
      );
      expect(
        (
          await request(app)
            .get(`/api/v1/events/${draftId}`)
            .set("Authorization", `Bearer ${custToken}`)
        ).status
      ).toBe(404);
      expect(
        (
          await request(app)
            .get(`/api/v1/events/${draftId}`)
            .set("Authorization", `Bearer ${org2Token}`)
        ).status
      ).toBe(404);
      expect(
        (
          await request(app)
            .get(`/api/v1/events/${draftId}`)
            .set("Authorization", `Bearer ${org1Token}`)
        ).status
      ).toBe(200);
      expect(
        (
          await request(app)
            .get(`/api/v1/events/${draftId}`)
            .set("Authorization", `Bearer ${adminToken}`)
        ).status
      ).toBe(200);

      // Publish then cancel -> visible to everyone (even with garbage Bearer token)
      await request(app)
        .post(`/api/v1/events/${draftId}/publish`)
        .set("Authorization", `Bearer ${org1Token}`);
      await request(app)
        .post(`/api/v1/events/${draftId}/cancel`)
        .set("Authorization", `Bearer ${org1Token}`)
        .send({ reason: "Venue roof repair." });

      const guestWithGarbageToken = await request(app)
        .get(`/api/v1/events/${draftId}`)
        .set("Authorization", "Bearer completely.garbage.token");
      expect(guestWithGarbageToken.status).toBe(200);
      expect(guestWithGarbageToken.body.data.event.status).toBe(
        constants.EVENT_STATUSES.CANCELLED
      );
      expect(guestWithGarbageToken.body.data.event.cancelReason).toBe(
        "Venue roof repair."
      );

      // GET /events/mine
      const org1Mine = await request(app)
        .get("/api/v1/events/mine")
        .set("Authorization", `Bearer ${org1Token}`);
      expect(org1Mine.status).toBe(200);
      expect(org1Mine.body.data.items).toHaveLength(1);
      expect(org1Mine.body.data.items[0].availableTickets).toBeDefined();

      const org2Mine = await request(app)
        .get("/api/v1/events/mine")
        .set("Authorization", `Bearer ${org2Token}`);
      expect(org2Mine.status).toBe(200);
      expect(org2Mine.body.data.items).toHaveLength(0);

      const custMine = await request(app)
        .get("/api/v1/events/mine")
        .set("Authorization", `Bearer ${custToken}`);
      expect(custMine.status).toBe(403);
    });
  });

  describe("Rate limiters and seed script", () => {
    test("Write and read event rate limiters return 429 RATE_LIMITED when exceeded", async () => {
      const { token } = await createUserWithRole(
        constants.USER_ROLES.ORGANIZER
      );
      const limitedApp = buildRateLimitedEventsApp({ readMax: 2, writeMax: 1 });

      expect((await request(limitedApp).get("/api/v1/events")).status).toBe(
        200
      );
      expect((await request(limitedApp).get("/api/v1/events")).status).toBe(
        200
      );
      const readBlocked = await request(limitedApp).get("/api/v1/events");
      expect(readBlocked.status).toBe(429);
      expect(readBlocked.body.error.code).toBe(
        constants.ERROR_CODES.RATE_LIMITED
      );

      const write1 = await request(limitedApp)
        .post("/api/v1/events")
        .set("Authorization", `Bearer ${token}`)
        .send(makeFutureEventPayload());
      expect(write1.status).toBe(201);

      const write2 = await request(limitedApp)
        .post("/api/v1/events")
        .set("Authorization", `Bearer ${token}`)
        .send(makeFutureEventPayload({ title: "Demo Concert: Second Event" }));
      expect(write2.status).toBe(429);
      expect(write2.body.error.code).toBe(constants.ERROR_CODES.RATE_LIMITED);
    });

    test("seedEvents fails clearly without demo organizer, creates 3 PUBLISHED events, and is idempotent", async () => {
      await expect(seedEvents({ nodeEnv: "test" })).rejects.toThrow(
        /seed:staff/i
      );

      await createUserWithRole(constants.USER_ROLES.ORGANIZER, {
        fullName: "FairTicket Demo Organizer",
        email: DEMO_ORGANIZER_EMAIL,
      });

      const firstRun = await seedEvents({ nodeEnv: "test" });
      expect(firstRun).toHaveLength(3);
      expect(firstRun.every((item) => item.status === "created")).toBe(true);
      expect(await Event.countDocuments()).toBe(3);

      const secondRun = await seedEvents({ nodeEnv: "test" });
      expect(secondRun).toHaveLength(3);
      expect(secondRun.every((item) => item.status === "already existed")).toBe(
        true
      );
      expect(await Event.countDocuments()).toBe(3);
    });
  });
});
