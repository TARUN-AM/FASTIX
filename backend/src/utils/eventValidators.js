const {
  MAX_ACTIVE_TICKETS,
  DEFAULT_HOLD_MINUTES,
  MIN_HOLD_MINUTES,
  MAX_HOLD_MINUTES,
  EVENT_MIN_PRICE_PAISE,
  EVENT_MAX_PRICE_PAISE,
  EVENT_MAX_TOTAL_TICKETS,
  EVENT_MIN_REGISTRATION_WINDOW_MINUTES,
  EVENT_LIST_MAX_PAGE_SIZE,
  EVENT_LIST_DEFAULT_PAGE_SIZE,
  EVENT_CATEGORIES,
  EVENT_CATEGORY_VALUES,
  EVENT_STATUS_VALUES,
} = require("../config/constants");
const {
  isPlainObject,
  isPlainString,
  rejectUnknownFields,
} = require("./validators");

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;
const ANGLE_BRACKETS_REGEX = /[<>]/;
const POSITIVE_INT_STRING_REGEX = /^[1-9]\d*$/;
const STRICT_ISO_8601_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;

const ALLOWED_EVENT_FIELDS = Object.freeze([
  "title",
  "description",
  "venueName",
  "city",
  "eventDate",
  "registrationOpenAt",
  "registrationCloseAt",
  "totalTickets",
  "basePricePaise",
  "maxTicketsPerIdentity",
  "holdDurationMinutes",
  "category",
  "artist",
]);

const ALLOWED_CANCEL_FIELDS = Object.freeze(["reason"]);
const ALLOWED_PUBLIC_LIST_QUERY_FIELDS = Object.freeze([
  "page",
  "limit",
  "city",
  "q",
]);
const ALLOWED_MY_LIST_QUERY_FIELDS = Object.freeze([
  "page",
  "limit",
  "status",
]);

function isValidObjectId(value) {
  return typeof value === "string" && OBJECT_ID_REGEX.test(value);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collapseSpaces(value) {
  return value.trim().replace(/\s+/g, " ");
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validateEventTitle(value) {
  if (!isPlainString(value)) {
    return { valid: false, message: "Title must be a text string." };
  }
  if (ANGLE_BRACKETS_REGEX.test(value)) {
    return {
      valid: false,
      message: 'Title must not contain "<" or ">" characters.',
    };
  }
  const normalized = collapseSpaces(value);
  if (normalized.length < 3 || normalized.length > 120) {
    return {
      valid: false,
      message: "Title must be between 3 and 120 characters.",
    };
  }
  return { valid: true, value: normalized };
}

function validateVenueName(value) {
  if (!isPlainString(value)) {
    return { valid: false, message: "Venue name must be a text string." };
  }
  if (ANGLE_BRACKETS_REGEX.test(value)) {
    return {
      valid: false,
      message: 'Venue name must not contain "<" or ">" characters.',
    };
  }
  const normalized = collapseSpaces(value);
  if (normalized.length < 2 || normalized.length > 120) {
    return {
      valid: false,
      message: "Venue name must be between 2 and 120 characters.",
    };
  }
  return { valid: true, value: normalized };
}

function validateCity(value) {
  if (!isPlainString(value)) {
    return { valid: false, message: "City must be a text string." };
  }
  if (ANGLE_BRACKETS_REGEX.test(value)) {
    return {
      valid: false,
      message: 'City must not contain "<" or ">" characters.',
    };
  }
  const normalized = collapseSpaces(value);
  if (normalized.length < 2 || normalized.length > 60) {
    return {
      valid: false,
      message: "City must be between 2 and 60 characters.",
    };
  }
  return { valid: true, value: normalized };
}

function validateDescription(value) {
  if (value === undefined) {
    return { valid: true, value: "" };
  }
  if (!isPlainString(value)) {
    return { valid: false, message: "Description must be a text string." };
  }
  if (ANGLE_BRACKETS_REGEX.test(value)) {
    return {
      valid: false,
      message: 'Description must not contain "<" or ">" characters.',
    };
  }
  const trimmed = value.trim();
  if (trimmed.length > 2000) {
    return {
      valid: false,
      message: "Description must be at most 2000 characters.",
    };
  }
  return { valid: true, value: trimmed };
}

function validateArtist(value) {
  if (value === undefined) {
    return { valid: true, value: "" };
  }
  if (!isPlainString(value)) {
    return { valid: false, message: "Artist must be a text string." };
  }
  if (ANGLE_BRACKETS_REGEX.test(value)) {
    return {
      valid: false,
      message: 'Artist must not contain "<" or ">" characters.',
    };
  }
  const normalized = collapseSpaces(value);
  if (normalized.length > 100) {
    return {
      valid: false,
      message: "Artist must be at most 100 characters.",
    };
  }
  return { valid: true, value: normalized };
}

function validateCategory(value) {
  if (value === undefined) {
    return { valid: true, value: EVENT_CATEGORIES.CONCERT };
  }
  if (!isPlainString(value)) {
    return { valid: false, message: "Category must be a text string." };
  }
  const trimmed = value.trim();
  if (!EVENT_CATEGORY_VALUES.includes(trimmed)) {
    return {
      valid: false,
      message: `Category must be one of: ${EVENT_CATEGORY_VALUES.join(", ")}.`,
    };
  }
  return { valid: true, value: trimmed };
}

function validateBasePricePaise(value) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isSafeInteger(value)
  ) {
    return {
      valid: false,
      message: "Ticket price must be a whole number in paise.",
    };
  }
  if (value < EVENT_MIN_PRICE_PAISE || value > EVENT_MAX_PRICE_PAISE) {
    return {
      valid: false,
      message: `Ticket price must be between ${EVENT_MIN_PRICE_PAISE} and ${EVENT_MAX_PRICE_PAISE} paise.`,
    };
  }
  return { valid: true, value };
}

function validateTotalTickets(value) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isSafeInteger(value)
  ) {
    return {
      valid: false,
      message: "Total tickets must be a whole number.",
    };
  }
  if (value < 1 || value > EVENT_MAX_TOTAL_TICKETS) {
    return {
      valid: false,
      message: `Total tickets must be between 1 and ${EVENT_MAX_TOTAL_TICKETS}.`,
    };
  }
  return { valid: true, value };
}

function validateMaxTicketsPerIdentity(value, { allowDefault = false } = {}) {
  if (value === undefined && allowDefault) {
    return { valid: true, value: MAX_ACTIVE_TICKETS };
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isSafeInteger(value)
  ) {
    return {
      valid: false,
      message: "Max tickets per person must be a whole number.",
    };
  }
  if (value < 1 || value > MAX_ACTIVE_TICKETS) {
    return {
      valid: false,
      message: `Max tickets per person must be between 1 and ${MAX_ACTIVE_TICKETS}.`,
    };
  }
  return { valid: true, value };
}

function validateHoldDurationMinutes(value, { allowDefault = false } = {}) {
  if (value === undefined && allowDefault) {
    return { valid: true, value: DEFAULT_HOLD_MINUTES };
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isSafeInteger(value)
  ) {
    return {
      valid: false,
      message: "Hold duration must be a whole number of minutes.",
    };
  }
  if (value < MIN_HOLD_MINUTES || value > MAX_HOLD_MINUTES) {
    return {
      valid: false,
      message: `Hold duration must be between ${MIN_HOLD_MINUTES} and ${MAX_HOLD_MINUTES} minutes.`,
    };
  }
  return { valid: true, value };
}

function validateStrictIsoDate(value, label = "Date") {
  if (!isPlainString(value)) {
    return {
      valid: false,
      message: `${label} must be an ISO 8601 date string with timezone (Z or +/-HH:MM).`,
    };
  }
  const match = STRICT_ISO_8601_REGEX.exec(value);
  if (!match) {
    return {
      valid: false,
      message: `${label} must be a valid ISO 8601 date string including timezone (Z or +/-HH:MM).`,
    };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] !== undefined ? Number(match[6]) : 0;
  const tzOffsetHour = match[10] !== undefined ? Number(match[10]) : 0;
  const tzOffsetMinute = match[11] !== undefined ? Number(match[11]) : 0;

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    tzOffsetHour > 23 ||
    tzOffsetMinute > 59
  ) {
    return {
      valid: false,
      message: `${label} is not a valid calendar date or time.`,
    };
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return {
      valid: false,
      message: `${label} is not a valid date.`,
    };
  }
  return { valid: true, value: parsed };
}

function validateEventSchedule(
  { eventDate, registrationOpenAt, registrationCloseAt },
  { requireCloseInFuture = true, now = new Date() } = {}
) {
  const errors = [];
  const openMs = registrationOpenAt.getTime();
  const closeMs = registrationCloseAt.getTime();
  const startMs = eventDate.getTime();
  const minWindowMs = EVENT_MIN_REGISTRATION_WINDOW_MINUTES * 60 * 1000;

  if (requireCloseInFuture && closeMs <= now.getTime()) {
    errors.push({
      field: "registrationCloseAt",
      message: "Registration close time must be in the future.",
    });
  }

  if (closeMs - openMs < minWindowMs) {
    errors.push({
      field: "registrationCloseAt",
      message: `Registration close time must be at least ${EVENT_MIN_REGISTRATION_WINDOW_MINUTES} minute(s) after registration open time.`,
    });
  }

  if (startMs <= closeMs) {
    errors.push({
      field: "eventDate",
      message: "Event start time must be after registration close time.",
    });
  }

  return errors;
}

function validateCancelReason(value) {
  if (!isPlainString(value)) {
    return {
      valid: false,
      message: "Cancellation reason must be a text string.",
    };
  }
  if (ANGLE_BRACKETS_REGEX.test(value)) {
    return {
      valid: false,
      message: 'Cancellation reason must not contain "<" or ">" characters.',
    };
  }
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 300) {
    return {
      valid: false,
      message: "Cancellation reason must be between 3 and 300 characters.",
    };
  }
  return { valid: true, value: trimmed };
}

function validateCreateEventPayload(body, now = new Date()) {
  if (!isPlainObject(body)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Request body must be a JSON object." }],
      value: null,
    };
  }

  const errors = [];
  const unknownFields = rejectUnknownFields(body, ALLOWED_EVENT_FIELDS);
  for (const field of unknownFields) {
    errors.push({ field, message: "Field is not allowed." });
  }

  const titleRes = validateEventTitle(body.title);
  if (!titleRes.valid) errors.push({ field: "title", message: titleRes.message });

  const descRes = validateDescription(body.description);
  if (!descRes.valid) {
    errors.push({ field: "description", message: descRes.message });
  }

  const venueRes = validateVenueName(body.venueName);
  if (!venueRes.valid) {
    errors.push({ field: "venueName", message: venueRes.message });
  }

  const cityRes = validateCity(body.city);
  if (!cityRes.valid) errors.push({ field: "city", message: cityRes.message });

  const artistRes = validateArtist(body.artist);
  if (!artistRes.valid) {
    errors.push({ field: "artist", message: artistRes.message });
  }

  const categoryRes = validateCategory(body.category);
  if (!categoryRes.valid) {
    errors.push({ field: "category", message: categoryRes.message });
  }

  const priceRes = validateBasePricePaise(body.basePricePaise);
  if (!priceRes.valid) {
    errors.push({ field: "basePricePaise", message: priceRes.message });
  }

  const totalRes = validateTotalTickets(body.totalTickets);
  if (!totalRes.valid) {
    errors.push({ field: "totalTickets", message: totalRes.message });
  }

  const maxPerRes = validateMaxTicketsPerIdentity(body.maxTicketsPerIdentity, {
    allowDefault: true,
  });
  if (!maxPerRes.valid) {
    errors.push({ field: "maxTicketsPerIdentity", message: maxPerRes.message });
  }

  const holdRes = validateHoldDurationMinutes(body.holdDurationMinutes, {
    allowDefault: true,
  });
  if (!holdRes.valid) {
    errors.push({ field: "holdDurationMinutes", message: holdRes.message });
  }

  const eventDateRes = validateStrictIsoDate(body.eventDate, "Event start time");
  if (!eventDateRes.valid) {
    errors.push({ field: "eventDate", message: eventDateRes.message });
  }

  const openRes = validateStrictIsoDate(
    body.registrationOpenAt,
    "Registration open time"
  );
  if (!openRes.valid) {
    errors.push({ field: "registrationOpenAt", message: openRes.message });
  }

  const closeRes = validateStrictIsoDate(
    body.registrationCloseAt,
    "Registration close time"
  );
  if (!closeRes.valid) {
    errors.push({ field: "registrationCloseAt", message: closeRes.message });
  }

  if (eventDateRes.valid && openRes.valid && closeRes.valid) {
    const scheduleErrors = validateEventSchedule(
      {
        eventDate: eventDateRes.value,
        registrationOpenAt: openRes.value,
        registrationCloseAt: closeRes.value,
      },
      { requireCloseInFuture: true, now }
    );
    errors.push(...scheduleErrors);
  }

  if (errors.length > 0) {
    return { valid: false, errors, value: null };
  }

  return {
    valid: true,
    errors: [],
    value: {
      title: titleRes.value,
      description: descRes.value,
      venueName: venueRes.value,
      city: cityRes.value,
      artist: artistRes.value,
      category: categoryRes.value,
      basePricePaise: priceRes.value,
      totalTickets: totalRes.value,
      maxTicketsPerIdentity: maxPerRes.value,
      holdDurationMinutes: holdRes.value,
      eventDate: eventDateRes.value,
      registrationOpenAt: openRes.value,
      registrationCloseAt: closeRes.value,
    },
  };
}

function validateUpdateEventPayload(body) {
  if (!isPlainObject(body)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Request body must be a JSON object." }],
      value: null,
    };
  }

  const keys = Object.keys(body);
  if (keys.length === 0) {
    return {
      valid: false,
      errors: [
        {
          field: "body",
          message: "At least one event field must be provided for update.",
        },
      ],
      value: null,
    };
  }

  const errors = [];
  const unknownFields = rejectUnknownFields(body, ALLOWED_EVENT_FIELDS);
  for (const field of unknownFields) {
    errors.push({ field, message: "Field is not allowed." });
  }

  const parsed = {};

  if (Object.prototype.hasOwnProperty.call(body, "title")) {
    const r = validateEventTitle(body.title);
    if (!r.valid) errors.push({ field: "title", message: r.message });
    else parsed.title = r.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, "description")) {
    const r = validateDescription(body.description);
    if (!r.valid) errors.push({ field: "description", message: r.message });
    else parsed.description = r.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, "venueName")) {
    const r = validateVenueName(body.venueName);
    if (!r.valid) errors.push({ field: "venueName", message: r.message });
    else parsed.venueName = r.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, "city")) {
    const r = validateCity(body.city);
    if (!r.valid) errors.push({ field: "city", message: r.message });
    else parsed.city = r.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, "artist")) {
    const r = validateArtist(body.artist);
    if (!r.valid) errors.push({ field: "artist", message: r.message });
    else parsed.artist = r.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, "category")) {
    const r = validateCategory(body.category);
    if (!r.valid) errors.push({ field: "category", message: r.message });
    else parsed.category = r.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, "basePricePaise")) {
    const r = validateBasePricePaise(body.basePricePaise);
    if (!r.valid) errors.push({ field: "basePricePaise", message: r.message });
    else parsed.basePricePaise = r.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, "totalTickets")) {
    const r = validateTotalTickets(body.totalTickets);
    if (!r.valid) errors.push({ field: "totalTickets", message: r.message });
    else parsed.totalTickets = r.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, "maxTicketsPerIdentity")) {
    const r = validateMaxTicketsPerIdentity(body.maxTicketsPerIdentity, {
      allowDefault: false,
    });
    if (!r.valid) {
      errors.push({ field: "maxTicketsPerIdentity", message: r.message });
    } else {
      parsed.maxTicketsPerIdentity = r.value;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "holdDurationMinutes")) {
    const r = validateHoldDurationMinutes(body.holdDurationMinutes, {
      allowDefault: false,
    });
    if (!r.valid) {
      errors.push({ field: "holdDurationMinutes", message: r.message });
    } else {
      parsed.holdDurationMinutes = r.value;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "eventDate")) {
    const r = validateStrictIsoDate(body.eventDate, "Event start time");
    if (!r.valid) errors.push({ field: "eventDate", message: r.message });
    else parsed.eventDate = r.value;
  }

  if (Object.prototype.hasOwnProperty.call(body, "registrationOpenAt")) {
    const r = validateStrictIsoDate(
      body.registrationOpenAt,
      "Registration open time"
    );
    if (!r.valid) {
      errors.push({ field: "registrationOpenAt", message: r.message });
    } else {
      parsed.registrationOpenAt = r.value;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "registrationCloseAt")) {
    const r = validateStrictIsoDate(
      body.registrationCloseAt,
      "Registration close time"
    );
    if (!r.valid) {
      errors.push({ field: "registrationCloseAt", message: r.message });
    } else {
      parsed.registrationCloseAt = r.value;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, value: null };
  }

  return { valid: true, errors: [], value: parsed };
}

function validateCancelPayload(body) {
  if (!isPlainObject(body)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Request body must be a JSON object." }],
      value: null,
    };
  }

  const errors = [];
  const unknownFields = rejectUnknownFields(body, ALLOWED_CANCEL_FIELDS);
  for (const field of unknownFields) {
    errors.push({ field, message: "Field is not allowed." });
  }

  const reasonRes = validateCancelReason(body.reason);
  if (!reasonRes.valid) {
    errors.push({ field: "reason", message: reasonRes.message });
  }

  if (errors.length > 0) {
    return { valid: false, errors, value: null };
  }

  return { valid: true, errors: [], value: { reason: reasonRes.value } };
}

function validatePaginationParams(query, errors) {
  let page = 1;
  if (query.page !== undefined && query.page !== "") {
    if (!isPlainString(query.page) || !POSITIVE_INT_STRING_REGEX.test(query.page.trim())) {
      errors.push({
        field: "page",
        message: "Page must be a whole number greater than or equal to 1.",
      });
    } else {
      const parsedPage = Number(query.page.trim());
      if (!Number.isSafeInteger(parsedPage) || parsedPage < 1) {
        errors.push({
          field: "page",
          message: "Page must be a whole number greater than or equal to 1.",
        });
      } else {
        page = parsedPage;
      }
    }
  }

  let limit = EVENT_LIST_DEFAULT_PAGE_SIZE;
  if (query.limit !== undefined && query.limit !== "") {
    if (
      !isPlainString(query.limit) ||
      !POSITIVE_INT_STRING_REGEX.test(query.limit.trim())
    ) {
      errors.push({
        field: "limit",
        message: `Limit must be a whole number between 1 and ${EVENT_LIST_MAX_PAGE_SIZE}.`,
      });
    } else {
      const parsedLimit = Number(query.limit.trim());
      if (
        !Number.isSafeInteger(parsedLimit) ||
        parsedLimit < 1 ||
        parsedLimit > EVENT_LIST_MAX_PAGE_SIZE
      ) {
        errors.push({
          field: "limit",
          message: `Limit must be a whole number between 1 and ${EVENT_LIST_MAX_PAGE_SIZE}.`,
        });
      } else {
        limit = parsedLimit;
      }
    }
  }

  return { page, limit };
}

function validatePublicEventListQuery(query = {}) {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return {
      valid: false,
      errors: [{ field: "query", message: "Query parameters are invalid." }],
      value: null,
    };
  }

  const errors = [];
  const allowedSet = new Set(ALLOWED_PUBLIC_LIST_QUERY_FIELDS);
  for (const key of Object.keys(query)) {
    if (!allowedSet.has(key)) {
      errors.push({ field: key, message: "Query parameter is not allowed." });
    }
  }

  const { page, limit } = validatePaginationParams(query, errors);

  let city;
  if (query.city !== undefined) {
    if (!isPlainString(query.city)) {
      errors.push({ field: "city", message: "City filter must be a text string." });
    } else {
      const trimmedCity = collapseSpaces(query.city);
      if (trimmedCity.length > 60) {
        errors.push({
          field: "city",
          message: "City filter must be at most 60 characters.",
        });
      } else if (trimmedCity.length > 0) {
        city = trimmedCity;
      }
    }
  }

  let q;
  if (query.q !== undefined) {
    if (!isPlainString(query.q)) {
      errors.push({ field: "q", message: "Search query must be a text string." });
    } else {
      const trimmedQ = query.q.trim();
      if (trimmedQ.length > 50) {
        errors.push({
          field: "q",
          message: "Search query must be at most 50 characters.",
        });
      } else if (trimmedQ.length > 0) {
        q = trimmedQ;
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, value: null };
  }

  return {
    valid: true,
    errors: [],
    value: { page, limit, city, q },
  };
}

function validateMyEventsQuery(query = {}) {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return {
      valid: false,
      errors: [{ field: "query", message: "Query parameters are invalid." }],
      value: null,
    };
  }

  const errors = [];
  const allowedSet = new Set(ALLOWED_MY_LIST_QUERY_FIELDS);
  for (const key of Object.keys(query)) {
    if (!allowedSet.has(key)) {
      errors.push({ field: key, message: "Query parameter is not allowed." });
    }
  }

  const { page, limit } = validatePaginationParams(query, errors);

  let status;
  if (query.status !== undefined && query.status !== "") {
    if (!isPlainString(query.status)) {
      errors.push({
        field: "status",
        message: "Status filter must be a text string.",
      });
    } else {
      const trimmed = query.status.trim();
      if (!EVENT_STATUS_VALUES.includes(trimmed)) {
        errors.push({
          field: "status",
          message: `Status filter must be one of: ${EVENT_STATUS_VALUES.join(", ")}.`,
        });
      } else {
        status = trimmed;
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, value: null };
  }

  return {
    valid: true,
    errors: [],
    value: { page, limit, status },
  };
}

module.exports = {
  ALLOWED_EVENT_FIELDS,
  ALLOWED_CANCEL_FIELDS,
  isValidObjectId,
  escapeRegex,
  validateEventTitle,
  validateVenueName,
  validateCity,
  validateDescription,
  validateArtist,
  validateCategory,
  validateBasePricePaise,
  validateTotalTickets,
  validateMaxTicketsPerIdentity,
  validateHoldDurationMinutes,
  validateStrictIsoDate,
  validateEventSchedule,
  validateCancelReason,
  validateCreateEventPayload,
  validateUpdateEventPayload,
  validateCancelPayload,
  validatePublicEventListQuery,
  validateMyEventsQuery,
};
