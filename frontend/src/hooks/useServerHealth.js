import { useCallback, useEffect, useState } from "react";
import apiClient from "../services/api";

// Module-level shared state so HomePage and Footer ServerStatus reuse one
// single GET /health request and stay synchronized on retry.
let sharedState = {
  status: "loading",
  data: null,
  error: "",
};

let inFlightPromise = null;
let hasInitialized = false;
const listeners = new Set();

function emit(nextState) {
  sharedState = nextState;
  listeners.forEach((listener) => listener(sharedState));
}

async function fetchHealth() {
  if (inFlightPromise) {
    return inFlightPromise;
  }

  emit({
    status: "loading",
    data: null,
    error: "",
  });

  inFlightPromise = apiClient
    .get("/health")
    .then((response) => {
      const payload = response.data;
      if (payload?.success && payload?.data?.status === "ok") {
        emit({
          status: "connected",
          data: payload.data,
          error: "",
        });
      } else {
        emit({
          status: "error",
          data: null,
          error: "Received an unexpected response from the FairTicket backend.",
        });
      }
    })
    .catch((err) => {
      emit({
        status: "error",
        data: null,
        error: err?.message || "Unable to connect to the FairTicket backend.",
      });
    })
    .finally(() => {
      inFlightPromise = null;
    });

  return inFlightPromise;
}

/**
 * Shared hook that checks GET /api/v1/health once across mounted components
 * and exposes a manual retry() function.
 */
export function useServerHealth() {
  const [state, setState] = useState(sharedState);

  useEffect(() => {
    listeners.add(setState);
    setState(sharedState);

    if (!hasInitialized) {
      hasInitialized = true;
      fetchHealth();
    }

    return () => {
      listeners.delete(setState);
    };
  }, []);

  const retry = useCallback(() => {
    return fetchHealth();
  }, []);

  return {
    status: state.status,
    data: state.data,
    error: state.error,
    retry,
  };
}
