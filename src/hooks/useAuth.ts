import { AuthContext } from "@/contexts/AuthContext";
import { useContext } from "react";

/**
 * useAuth - Consumes the centralized AuthContext
 */
export function useAuth() {
  return useContext(AuthContext);
}
