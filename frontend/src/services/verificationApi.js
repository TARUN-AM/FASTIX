import apiClient from "./api";

/**
 * Fetches current verification status for the signed-in user.
 * GET /api/v1/verification/status
 */
export async function getVerificationStatus() {
  const response = await apiClient.get("/verification/status");
  return response.data?.data;
}

/**
 * Submits simulated identity verification details.
 * POST /api/v1/verification/identity/submit
 *
 * PRIVACY: Only sends demo document fields in the POST JSON body,
 * never in URL parameters or client storage.
 */
export async function submitIdentity({
  documentType,
  documentNumber,
  fullNameOnDocument,
  consent,
}) {
  const response = await apiClient.post("/verification/identity/submit", {
    documentType,
    documentNumber,
    fullNameOnDocument,
    consent,
  });
  return response.data?.data;
}
