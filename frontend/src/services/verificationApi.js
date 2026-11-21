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
 * Requests a simulated phone OTP for the signed-in customer's account phone.
 * POST /api/v1/verification/otp/request
 */
export async function sendPhoneOtp() {
  const response = await apiClient.post("/verification/otp/request", {});
  return response.data?.data;
}

/**
 * Verifies a 6-digit phone OTP code for the signed-in customer.
 * POST /api/v1/verification/otp/verify
 */
export async function verifyPhoneOtp(otpCode) {
  const response = await apiClient.post("/verification/otp/verify", {
    otpCode,
  });
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

/**
 * Requests a single-use wallet signing challenge for the connected MetaMask address.
 * POST /api/v1/wallet/nonce
 */
export async function requestWalletChallenge(walletAddress) {
  const response = await apiClient.post("/wallet/nonce", {
    walletAddress,
  });
  return response.data?.data;
}

/**
 * Submits a MetaMask personal_sign signature to verify wallet ownership and link
 * the wallet to the authenticated verified customer account.
 * POST /api/v1/wallet/link
 *
 * SECURITY: Sends only walletAddress and signature (never message or nonce).
 */
export async function verifyWalletSignature({ walletAddress, signature }) {
  const response = await apiClient.post("/wallet/link", {
    walletAddress,
    signature,
  });
  return response.data?.data;
}
