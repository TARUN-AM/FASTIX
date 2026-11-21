const crypto = require("crypto");
const {
  IDENTITY_STATUSES,
  IDENTITY_REJECTION_REASONS,
} = require("../../config/constants");
const {
  normalizeName,
  normalizeDocumentNumber,
} = require("../../utils/normalize");

/*
 * Production replacement note:
 * In production, this mock provider layer would be replaced by an authorized KYC
 * provider approved under the applicable Indian regulations, with proper user
 * consent and data-protection compliance. That provider would return a
 * verification result and an opaque provider reference; the rest of the
 * FairTicket codebase (controller, identity service, models, and frontend flow)
 * does not need to change.
 */

const PROVIDER_NAME = "MOCK_KYC";

/**
 * Simulated identity verification adapter for local hackathon demos.
 *
 * Rules evaluated in strict order:
 * 1. If normalizeName(fullNameOnDocument) !== normalizeName(accountName) -> REJECTED (NAME_MISMATCH)
 * 2. If normalizeDocumentNumber(documentNumber) starts with "DEMO-REJECT" -> REJECTED (DOCUMENT_REJECTED)
 * 3. Otherwise -> VERIFIED (reasonCode: null)
 *
 * PRIVACY: Never logs inputs and never returns documentNumber or name data.
 */
async function verify({
  documentType,
  documentNumber,
  fullNameOnDocument,
  accountName,
}) {
  // Reference is a random opaque receipt ID, never derived from documentNumber.
  const providerReference = `MOCK-${crypto.randomBytes(8).toString("hex")}`;

  if (normalizeName(fullNameOnDocument) !== normalizeName(accountName)) {
    return {
      status: IDENTITY_STATUSES.REJECTED,
      reasonCode: IDENTITY_REJECTION_REASONS.NAME_MISMATCH,
      providerReference,
      providerName: PROVIDER_NAME,
    };
  }

  const normalizedNumber = normalizeDocumentNumber(documentNumber);
  if (normalizedNumber.startsWith("DEMO-REJECT")) {
    return {
      status: IDENTITY_STATUSES.REJECTED,
      reasonCode: IDENTITY_REJECTION_REASONS.DOCUMENT_REJECTED,
      providerReference,
      providerName: PROVIDER_NAME,
    };
  }

  // Keep documentType referenced cleanly for future real-provider adapters.
  void documentType;

  return {
    status: IDENTITY_STATUSES.VERIFIED,
    reasonCode: null,
    providerReference,
    providerName: PROVIDER_NAME,
  };
}

module.exports = {
  PROVIDER_NAME,
  verify,
};
