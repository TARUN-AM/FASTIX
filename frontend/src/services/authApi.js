import apiClient from "./api";

/**
 * Registers a new CUSTOMER account and returns `{ token, user }`.
 */
export async function registerUser({ fullName, email, phone, password }) {
  const response = await apiClient.post("/auth/register", {
    fullName,
    email,
    phone,
    password,
  });
  return response.data?.data || null;
}

/**
 * Authenticates an existing user and returns `{ token, user }`.
 */
export async function loginUser({ email, password }) {
  const response = await apiClient.post("/auth/login", {
    email,
    password,
  });
  return response.data?.data || null;
}

/**
 * Fetches the authenticated user's live profile (`{ user }`).
 */
export async function getMe() {
  const response = await apiClient.get("/auth/me");
  return response.data?.data || null;
}

/**
 * Logs out the current session and records an audit event.
 */
export async function logoutUser() {
  const response = await apiClient.post("/auth/logout");
  return response.data?.data || null;
}
