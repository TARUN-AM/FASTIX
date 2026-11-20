import axios from "axios";

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api/v1",
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Prompt 5: Add a request interceptor here to attach the JWT token
// (`Authorization: Bearer <token>`) to outgoing requests.

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
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
