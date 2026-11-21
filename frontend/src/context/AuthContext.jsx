import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { clearAuthToken, getAuthToken, setAuthToken } from "../services/api";
import {
  getMe,
  loginUser,
  logoutUser,
  registerUser,
} from "../services/authApi";
import { getVerificationStatus } from "../services/verificationApi";

const AuthContext = createContext(null);

/**
 * Application-wide authentication context.
 * Keeps the access token strictly in React/JS memory (never browser storage)
 * and exposes user profile, verification status, login, register, logout, and refreshUser.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [verificationStatus, setVerificationStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const clearSession = useCallback(() => {
    clearAuthToken();
    setUser(null);
    setVerificationStatus(null);
  }, []);

  const login = useCallback(async ({ email, password }) => {
    setIsLoading(true);
    try {
      const data = await loginUser({ email, password });
      if (!data?.token || !data?.user) {
        throw new Error("Invalid sign-in response from server.");
      }
      setAuthToken(data.token);
      setUser(data.user);
      setVerificationStatus(null);
      return data;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const register = useCallback(async ({ fullName, email, phone, password }) => {
    setIsLoading(true);
    try {
      const data = await registerUser({ fullName, email, phone, password });
      if (!data?.token || !data?.user) {
        throw new Error("Invalid registration response from server.");
      }
      setAuthToken(data.token);
      setUser(data.user);
      setVerificationStatus(null);
      return data;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    const activeToken = getAuthToken();
    try {
      if (activeToken) {
        await logoutUser();
      }
    } catch (_err) {
      // Always clear local session even if the network or token already expired
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const refreshUser = useCallback(async () => {
    if (!getAuthToken()) {
      clearSession();
      return null;
    }

    setIsLoading(true);
    try {
      const statusData = await getVerificationStatus();
      setVerificationStatus(statusData || null);
      if (statusData?.user) {
        setUser(statusData.user);
      } else {
        const meData = await getMe();
        setUser(meData?.user || null);
      }
      return statusData || null;
    } catch (err) {
      if (
        err?.status === 401 ||
        err?.code === "UNAUTHORIZED" ||
        err?.code === "TOKEN_EXPIRED"
      ) {
        clearSession();
        return null;
      }
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [clearSession]);

  const value = useMemo(
    () => ({
      user,
      verificationStatus,
      isAuthenticated: Boolean(user),
      isLoading,
      login,
      register,
      logout,
      refreshUser,
    }),
    [user, verificationStatus, isLoading, login, register, logout, refreshUser]
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
