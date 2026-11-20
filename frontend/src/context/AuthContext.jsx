import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { getVerificationStatus } from "../services/verificationApi";

const AuthContext = createContext(null);

/**
 * Lightweight AuthContext foundation providing `user`, `verificationStatus`,
 * and `refreshUser()` for the Identity Verification flow.
 * Prompt 5 expands this context with login, registration, logout, and JWT state.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [verificationStatus, setVerificationStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const refreshUser = useCallback(async () => {
    setIsLoading(true);
    try {
      const statusData = await getVerificationStatus();
      setVerificationStatus(statusData || null);
      setUser(statusData?.user || null);
      return statusData || null;
    } catch (err) {
      if (err?.status === 401 || err?.code === "UNAUTHORIZED") {
        setUser(null);
        setVerificationStatus(null);
        return null;
      }
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      verificationStatus,
      isAuthenticated: Boolean(user),
      isLoading,
      refreshUser,
    }),
    [user, verificationStatus, isLoading, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }
  return context;
}

export default AuthContext;
