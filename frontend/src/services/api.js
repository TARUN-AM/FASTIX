import axios from "axios";

// Keep JWT strictly in JS memory (never localStorage or sessionStorage)
// so XSS scripts cannot read persisted tokens across sessions.
let inMemoryAuthToken = null;

export function setAuthToken(token) {
  inMemoryAuthToken =
    typeof token === "string" && token.trim().length > 0 ? token.trim() : null;
}

export function getAuthToken() {
  return inMemoryAuthToken;
}

export function clearAuthToken() {
  inMemoryAuthToken = null;
}

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api/v1",
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});

apiClient.interceptors.request.use((config) => {
  if (inMemoryAuthToken) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${inMemoryAuthToken}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isCancel(error) || error?.code === "ERR_CANCELED") {
      return Promise.reject(error);
    }

    const apiError = error.response?.data?.error;

    if (apiError && typeof apiError.message === "string") {
      const readableError = new Error(apiError.message);
      readableError.code = apiError.code || "INTERNAL_ERROR";
      readableError.status = error.response?.status;
      if (apiError.details !== undefined) {
        readableError.details = apiError.details;
      }
      return Promise.reject(readableError);
    }

    if (error.code === "ECONNABORTED") {
      const timeoutError = new Error(
        "Request timed out after 15 seconds. Please check if the backend server is running."
      );
      timeoutError.code = "TIMEOUT_ERROR";
      return Promise.reject(timeoutError);
    }

    if (!error.response) {
      const networkError = new Error(
        "Cannot reach the FairTicket backend server. Make sure it is running on port 5000."
      );
      networkError.code = "NETWORK_ERROR";
      return Promise.reject(networkError);
    }

    const fallbackError = new Error(
      `Request failed with status ${error.response.status}.`
    );
    fallbackError.code = "HTTP_ERROR";
    fallbackError.status = error.response.status;
    return Promise.reject(fallbackError);
  }
);

export default apiClient;
