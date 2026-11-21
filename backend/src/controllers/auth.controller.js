const { ERROR_CODES } = require("../config/constants");
const authService = require("../services/auth.service");
const { sendError, sendSuccess } = require("../utils/apiResponse");
const { toPublicUser } = require("../utils/publicUser");
const {
  isPlainObject,
  isPlainString,
  rejectUnknownFields,
  validateEmail,
  validateName,
  validatePassword,
  validatePhone,
} = require("../utils/validators");

const REGISTER_ALLOWED_FIELDS = ["fullName", "email", "phone", "password"];
const LOGIN_ALLOWED_FIELDS = ["email", "password"];

function extractRequestMeta(req) {
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || undefined,
    userAgent:
      typeof req.headers["user-agent"] === "string"
        ? req.headers["user-agent"].slice(0, 200)
        : undefined,
  };
}

async function register(req, res, next) {
  try {
    if (!isPlainObject(req.body)) {
      return sendError(
        res,
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Request body must be a JSON object."
      );
    }

    const unknownFields = rejectUnknownFields(
      req.body,
      REGISTER_ALLOWED_FIELDS
    );
    if (unknownFields.length > 0) {
      return sendError(
        res,
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Request contains disallowed fields.",
        unknownFields.map((field) => ({
          field,
          message: `Field "${field}" is not allowed.`,
        }))
      );
    }

    const errors = [];
    const nameResult = validateName(req.body.fullName, "Full name");
    if (!nameResult.valid) {
      errors.push({ field: "fullName", message: nameResult.message });
    }

    const emailResult = validateEmail(req.body.email);
    if (!emailResult.valid) {
      errors.push({ field: "email", message: emailResult.message });
    }

    const phoneResult = validatePhone(req.body.phone);
    if (!phoneResult.valid) {
      errors.push({ field: "phone", message: phoneResult.message });
    }

    const passwordResult = validatePassword(req.body.password, {
      email: isPlainString(req.body.email) ? req.body.email : undefined,
    });
    if (!passwordResult.valid) {
      errors.push({ field: "password", message: passwordResult.message });
    }

    if (errors.length > 0) {
      return sendError(
        res,
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Please fix the highlighted fields.",
        errors
      );
    }

    const result = await authService.register({
      fullName: nameResult.value,
      email: emailResult.value,
      phone: phoneResult.value,
      password: passwordResult.value,
    });

    return sendSuccess(res, result, 201);
  } catch (err) {
    return next(err);
  }
}

async function login(req, res, next) {
  try {
    if (!isPlainObject(req.body)) {
      return sendError(
        res,
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Request body must be a JSON object."
      );
    }

    const unknownFields = rejectUnknownFields(req.body, LOGIN_ALLOWED_FIELDS);
    if (unknownFields.length > 0) {
      return sendError(
        res,
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Request contains disallowed fields.",
        unknownFields.map((field) => ({
          field,
          message: `Field "${field}" is not allowed.`,
        }))
      );
    }

    const errors = [];

    // Strict plain-string checks block NoSQL operator injection (e.g. { "$gt": "" })
    const emailResult = validateEmail(req.body.email);
    if (!emailResult.valid) {
      errors.push({ field: "email", message: emailResult.message });
    }

    if (!isPlainString(req.body.password) || req.body.password.length === 0) {
      errors.push({ field: "password", message: "Password is required." });
    } else if (Buffer.byteLength(req.body.password, "utf8") > 72) {
      errors.push({
        field: "password",
        message: "Password must be at most 72 bytes long.",
      });
    }

    if (errors.length > 0) {
      return sendError(
        res,
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Please enter a valid email and password.",
        errors
      );
    }

    const result = await authService.login(
      {
        email: emailResult.value,
        password: req.body.password,
      },
      extractRequestMeta(req)
    );

    return sendSuccess(res, result, 200);
  } catch (err) {
    return next(err);
  }
}

function me(req, res) {
  return sendSuccess(res, { user: toPublicUser(req.user) }, 200);
}

async function logout(req, res, next) {
  try {
    const result = await authService.logout(req.user, extractRequestMeta(req));
    return sendSuccess(res, result, 200);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  register,
  login,
  me,
  logout,
};
