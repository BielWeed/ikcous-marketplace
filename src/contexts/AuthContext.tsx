import { supabase } from "@/lib/supabase";
import type { Session, User } from "@supabase/supabase-js";
import {
  type ReactNode,
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

export interface ResetPasswordResult {
  success: boolean;
  status: "success" | "unconfirmed" | "not_found" | "error";
  message?: string;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: any | null;
  loading: boolean;
  isAdmin: boolean;
  login: (
    email: string,
    senha: string,
  ) => Promise<{ success: boolean; error?: any }>;
  signUp: (
    email: string,
    senha: string,
    fullName: string,
    phone: string,
    cpf?: string,
  ) => Promise<boolean>;
  resetPassword: (email: string) => Promise<ResetPasswordResult>;
  verifyRecoveryCode: (email: string, code: string) => Promise<boolean>;
  resendConfirmationEmail: (email: string) => Promise<boolean>;
  updatePassword: (newPassword: string) => Promise<boolean>;
  logout: () => Promise<void>;
  fetchProfile: (passedUser?: User | null) => Promise<void>;
  updateProfile: (updates: {
    full_name?: string | null;
    whatsapp?: string | null;
    avatar_url?: string | null;
    cover_url?: string | null;
  }) => Promise<boolean>;
  isPasswordRecovery: boolean;
  setIsPasswordRecovery: (value: boolean) => void;
}

export const AuthContext = createContext<AuthContextType>(
  {} as AuthContextType,
);

// Shared semaphore and state for all Auth instances (prevents redundant parallel checks)
let checkingLock: Promise<void> | null = null;
let initPromise: Promise<any> | null = null;

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  // Synchronously recover session from localStorage to prevent screen flash/delay on boot
  const getCachedSession = () => {
    try {
      if (typeof window === "undefined") return null;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.includes("-auth-token")) {
          const item = localStorage.getItem(key);
          if (item) {
            const parsed = JSON.parse(item);
            const session = parsed.currentSession || parsed;
            if (session?.access_token && session.user) {
              return session;
            }
          }
        }
      }
    } catch (e) {
      console.error("[Auth] Error reading cached session:", e);
    }
    return null;
  };

  const cachedSession = getCachedSession();
  const cachedIsAdmin = (() => {
    if (!cachedSession?.user) return false;
    return cachedSession.user.app_metadata?.role === "admin";
  })();

  const [session, setSession] = useState<Session | null>(cachedSession);
  const [user, setUser] = useState<User | null>(
    cachedSession ? cachedSession.user : null,
  );
  const [profile, setProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(!!cachedSession); // Non-blocking for guests, verifying for returned users
  const [isAdmin, setIsAdmin] = useState<boolean>(cachedIsAdmin);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      return (
        params.get("type") === "recovery" ||
        window.location.hash.includes("type=recovery")
      );
    }
    return false;
  });

  useEffect(() => {
    if (isPasswordRecovery && typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("type");
      window.history.replaceState(
        {},
        document.title,
        url.pathname + url.search + url.hash,
      );
    }
  }, [isPasswordRecovery]);

  const checkAdmin = async (u: User | null | undefined) => {
    if (!u) {
      setIsAdmin(false);
      return;
    }

    const userId = u.id;
    const cacheKey = `ikcous_is_admin_${userId}`;

    // Fast Path 1: JWT Metadata (Zero latency, cryptographically secure. Rely ONLY on app_metadata, as user_metadata is client-writable)
    const jwtRole = u.app_metadata?.role;
    if (jwtRole === "admin") {
      setIsAdmin(true);
      localStorage.setItem(cacheKey, "true");
      return;
    }

    // Fast Path 2: Local Cache (Immediate return for confirmed customers, keyed by user ID)
    const cachedAdmin = localStorage.getItem(cacheKey);
    if (cachedAdmin === "false") {
      setIsAdmin(false);
      // Run background check to sync with potential admin status updates without blocking initial load
      networkCheck().catch((err) =>
        console.error("[Auth] background networkCheck error:", err),
      );
      return;
    }

    // Network validation (Heavy)
    async function networkCheck() {
      if (checkingLock) {
        try {
          await checkingLock;
        } catch {
          // Ignore concurrent check errors
        }
        return;
      }

      checkingLock = (async () => {
        const queryPromise = (async () => {
          // First try direct RPC (fastest, most secure)
          const { data, error } = await supabase.rpc("is_admin");
          if (!error && typeof data === "boolean") {
            setIsAdmin(data);
            localStorage.setItem(cacheKey, data ? "true" : "false");
            return;
          }

          // Fallback: check profiles table
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", userId)
            .single();

          const isDbAdmin = !profileError && profile?.role === "admin";
          setIsAdmin(isDbAdmin);
          localStorage.setItem(cacheKey, isDbAdmin ? "true" : "false");
        })();

        // Add a resilient 3-second timeout limit to the network query
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Admin check timeout")), 3000),
        );

        await Promise.race([queryPromise, timeoutPromise]);
      })();

      try {
        await checkingLock;
      } catch (err) {
        console.error("[Auth] Error/Timeout checking admin status:", err);
        setIsAdmin(false);
      } finally {
        checkingLock = null;
      }
    }

    // Await the network check to prevent privilege bypass on client spoofing
    await networkCheck();
  };

  useEffect(() => {
    // standalone fail-safe timer (v12.x reduced to 4s for instant UX recovery)
    const safetyTimeout = setTimeout(() => {
      setLoading((current) => {
        if (current) {
          console.log(
            "[Auth] Safety timeout (4s) reached. Unblocking UI forcefully.",
          );
          return false;
        }
        return current;
      });
    }, 4000);
    return () => clearTimeout(safetyTimeout);
  }, []);

  const fetchProfile = useCallback(async (passedUser?: User | null) => {
    const currentUser =
      passedUser || (await supabase.auth.getSession()).data.session?.user;
    if (!currentUser) {
      setProfile(null);
      return;
    }

    try {
      const { data, error } = await supabase.rpc("get_my_complete_profile");
      if (!error && data) {
        const profileData = Array.isArray(data) ? data[0] : data;
        setProfile((prev: any) => {
          // Impede mudança de referência se os dados forem idênticos (previne re-renderização em cascata)
          if (prev && JSON.stringify(prev) === JSON.stringify(profileData))
            return prev;
          return profileData;
        });
        if (profileData)
          console.log("[Auth] Profile fetched:", profileData.full_name);
      } else if (error) {
        console.error("[Auth] Error fetching profile:", error);
      }
    } catch (err) {
      console.error("[Auth] Profile fetch exception:", err);
    }
  }, []);

  const hasInited = useRef(false);
  const isVerifying = useRef(false);
  const isFirstMount = useRef(true);
  const activeUserIdRef = useRef<string | null>(
    cachedSession?.user?.id || null,
  );

  useEffect(() => {
    // Immediate session resolution with internal timeout guard
    const initAuth = async () => {
      if (hasInited.current) return;
      hasInited.current = true;
      console.log("[Auth] initAuth started");

      try {
        // Racing getSession against a timeout to prevent absolute hangs on mobile
        if (!initPromise) {
          initPromise = supabase.auth.getSession();
        }
        const sessionPromise = initPromise;
        const timeoutPromise = new Promise((resolve) =>
          setTimeout(() => resolve("timeout"), 3000),
        );

        const sessionRes = (await Promise.race([
          sessionPromise,
          timeoutPromise,
        ])) as Awaited<typeof sessionPromise> | "timeout";

        if (sessionRes === "timeout") {
          console.warn("[Auth] getSession timed out. Moving to listener.");
          setLoading(false);
          isFirstMount.current = false;
          return;
        }

        const initSes = sessionRes.data?.session;
        console.log("[Auth] getSession result:", !!initSes);

        if (initSes) {
          isVerifying.current = true;

          // Immediately hydrate session state to avoid UI loading hangs
          setSession(initSes);
          setUser(initSes.user);
          activeUserIdRef.current = initSes.user.id;
          setLoading(false);

          // Run validation and profile/admin updates non-blockingly in the background
          (async () => {
            try {
              const {
                data: { user: verifiedUser },
                error: verifyError,
              } = await supabase.auth.getUser();

              if (verifyError) {
                console.error(
                  "[Auth] Session verification failed:",
                  verifyError.message,
                );

                const isDefinitivelyInvalid =
                  verifyError.status === 403 ||
                  verifyError.message.includes("not found") ||
                  verifyError.message.includes("Invalid token");

                if (isDefinitivelyInvalid) {
                  console.warn(
                    "[Auth] Stale/Invalid session detected. Forcing signOut.",
                  );
                  await supabase.auth.signOut();
                  setSession(null);
                  setUser(null);
                  activeUserIdRef.current = null;
                  setIsAdmin(false);
                  return;
                }
              }

              if (verifiedUser) {
                setSession(initSes);
                setUser(verifiedUser);
                activeUserIdRef.current = verifiedUser.id;
                fetchProfile(verifiedUser).catch((err: Error) =>
                  console.error("[Auth] init fetchProfile error:", err),
                );
                checkAdmin(verifiedUser).catch((err: Error) =>
                  console.error("[Auth] init checkAdmin error:", err),
                );
              } else {
                await supabase.auth.signOut();
                activeUserIdRef.current = null;
              }
            } catch (err) {
              console.error("[Auth] Background verify exception:", err);
            } finally {
              isVerifying.current = false;
              isFirstMount.current = false;
            }
          })();
        } else {
          setSession(null);
          setUser(null);
          activeUserIdRef.current = null;
          setIsAdmin(false);
          setLoading(false);
          isFirstMount.current = false;
        }
      } catch (err) {
        console.error("[Auth] initAuth error:", err);
        setLoading(false);
        isFirstMount.current = false;
      }
    };
    initAuth();

    // Consolidated session listener for subsequent changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("[Auth] State change event:", event, !!session);

      // Guard: If we are already verifying in initAuth, don't let INITIAL_SESSION or redundant events override
      if (isVerifying.current && event === "INITIAL_SESSION") {
        console.log(
          "[Auth] Guarded: Verifying in progress, ignoring INITIAL_SESSION duplicate.",
        );
        return;
      }

      const previousUserId = activeUserIdRef.current;
      const currentUserId = session?.user?.id || null;
      activeUserIdRef.current = currentUserId;

      // Only set loading screen for explicit critical transitions (login/logout).
      // Do not block UI on background events (such as TOKEN_REFRESHED) or initial load recovery.
      // A transition is critical only if the auth state has actually changed for a different user.
      const isCriticalTransition =
        (event === "SIGNED_IN" || event === "SIGNED_OUT") &&
        !isFirstMount.current &&
        previousUserId !== currentUserId;

      if (isCriticalTransition) {
        setLoading(true);
      }

      setSession((prev) => {
        if (event === "INITIAL_SESSION" && !session && prev) return prev;
        if (event === "INITIAL_SESSION" && prev?.user?.id === session?.user?.id)
          return prev;
        return session;
      });

      setUser((prev) => {
        if (!session) return prev && event === "INITIAL_SESSION" ? prev : null;
        if (prev?.id === session?.user?.id) return prev; // PREVENT INFINITE EFFECT LOOPS
        return session.user;
      });

      if (event === "PASSWORD_RECOVERY") {
        console.log("[Auth] Recovery event detected");
        setIsPasswordRecovery(true);
      }

      if (session?.user) {
        if (isCriticalTransition) {
          // For SIGNED_IN, race checkAdmin and fetchProfile against a 2.5-second timeout to unblock loading state
          try {
            const verifyPromise = Promise.all([
              fetchProfile(session.user).catch((err: Error) =>
                console.error("[Auth] event fetchProfile error:", err),
              ),
              checkAdmin(session.user).catch((err: Error) =>
                console.error("[Auth] background checkAdmin error:", err),
              ),
            ]);
            const timeoutPromise = new Promise((resolve) =>
              setTimeout(() => resolve("timeout"), 2500),
            );

            const raceResult = await Promise.race([
              verifyPromise,
              timeoutPromise,
            ]);
            if (raceResult === "timeout") {
              console.warn(
                "[Auth] SIGNED_IN verification process timed out (2.5s). Unblocking UI.",
              );
            }
          } catch (err) {
            console.error("[Auth] SIGNED_IN verification error:", err);
          } finally {
            setLoading(false);
          }
        } else {
          // Non-critical background event or first mount hydration
          Promise.all([
            fetchProfile(session.user).catch((err: Error) =>
              console.error("[Auth] event fetchProfile error:", err),
            ),
            checkAdmin(session.user).catch((err: Error) =>
              console.error("[Auth] background checkAdmin error:", err),
            ),
          ]).catch((err) =>
            console.error("[Auth] background operations error:", err),
          );
        }
      } else {
        setProfile(null);
        setIsAdmin(false);
        if (event === "SIGNED_OUT" && typeof window !== "undefined") {
          localStorage.removeItem("app.favorites");
          localStorage.removeItem("marketplace_cart_v1");
          localStorage.removeItem("ikcous_recently_viewed");
          localStorage.removeItem("ikcous_compare");
          localStorage.removeItem("ikcous_is_admin");
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key?.startsWith("ikcous_is_admin_")) {
              localStorage.removeItem(key);
            }
          }
        }
        if (isCriticalTransition) {
          setLoading(false);
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signUp = useCallback(
    async (
      email: string,
      senha: string,
      fullName: string,
      phone: string,
      cpf?: string,
    ): Promise<boolean> => {
      const { error } = await supabase.auth.signUp({
        email,
        password: senha,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            full_name: fullName,
            phone: phone,
            cpf: cpf,
          },
        },
      });
      if (error) {
        toast.error(`Erro ao cadastrar: ${error.message}`);
        return false;
      }
      return true;
    },
    [],
  );

  const login = useCallback(
    async (
      email: string,
      senha: string,
    ): Promise<{ success: boolean; error?: any }> => {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: senha,
      });
      if (error) {
        // We keep the toast for global notification, but return the error for specific UI handling
        toast.error(`Erro ao entrar: ${error.message}`);
        return { success: false, error };
      }
      return { success: true };
    },
    [],
  );

  const logout = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(`Erro ao sair: ${error.message}`);
    } else {
      setSession(null);
      setUser(null);
      setIsAdmin(false);
      setIsPasswordRecovery(false);
    }
  }, []);

  const resendConfirmationEmail = useCallback(
    async (email: string): Promise<boolean> => {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) {
        toast.error(`Erro ao reenviar e-mail: ${error.message}`);
        return false;
      }
      toast.success("E-mail de confirmação reenviado!");
      return true;
    },
    [],
  );

  const resetPassword = useCallback(
    async (email: string): Promise<ResetPasswordResult> => {
      try {
        // Check email confirmation status via RPC
        const { data: checkData, error: checkError } = await supabase.rpc(
          "check_user_confirmation_status",
          {
            p_email: email,
          },
        );

        if (checkError) {
          console.error(
            "[Auth] Error checking verification status:",
            checkError,
          );
          return {
            success: false,
            status: "error",
            message: checkError.message,
          };
        }

        const checkResult = checkData as {
          exists?: boolean;
          confirmed?: boolean;
        } | null;
        const exists = checkResult?.exists;
        const confirmed = checkResult?.confirmed;

        if (!exists) {
          return {
            success: false,
            status: "not_found",
            message:
              "Este e-mail não está cadastrado. Verifique o endereço ou crie uma conta.",
          };
        }

        if (!confirmed) {
          // Resend confirmation email
          const { error: resendError } = await supabase.auth.resend({
            type: "signup",
            email,
            options: {
              emailRedirectTo: window.location.origin,
            },
          });

          if (resendError) {
            return {
              success: false,
              status: "error",
              message: `E-mail não confirmado. Falha ao reenviar e-mail de confirmação: ${resendError.message}`,
            };
          }

          return {
            success: false,
            status: "unconfirmed",
            message:
              "Seu e-mail ainda não foi confirmado. Enviamos um novo link de confirmação para a sua caixa de entrada.",
          };
        }

        // Email is confirmed, send recovery link to user's email
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${
            window.location.origin + window.location.pathname
          }?type=recovery`,
        });

        if (error) {
          return { success: false, status: "error", message: error.message };
        }

        return {
          success: true,
          status: "success",
          message: "Link de recuperação enviado para o seu e-mail!",
        };
      } catch (err: any) {
        console.error("[Auth] Reset recovery exception:", err);
        return {
          success: false,
          status: "error",
          message: err?.message || "Erro inesperado",
        };
      }
    },
    [],
  );

  const verifyRecoveryCode = useCallback(
    async (email: string, code: string): Promise<boolean> => {
      try {
        console.log("[Auth] Verifying OTP code");
        const { error } = await supabase.auth.verifyOtp({
          email,
          token: code,
          type: "email",
        });

        if (error) {
          console.error("[Auth] OTP verification failed:", error);
          toast.error("Código inválido ou expirado.");
          return false;
        }

        console.log("[Auth] OTP verified successfully. Session created.");
        setIsPasswordRecovery(true);
        return true;
      } catch (err) {
        console.error("[Auth] verifyOtp exception:", err);
        toast.error("Erro ao verificar código.");
        return false;
      }
    },
    [],
  );

  const updatePassword = useCallback(
    async (newPassword: string): Promise<boolean> => {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) {
        toast.error(`Erro ao atualizar senha: ${error.message}`);
        return false;
      }
      toast.success("Senha atualizada com sucesso!");
      setIsPasswordRecovery(false);
      return true;
    },
    [],
  );

  const updateProfile = useCallback(
    async (updates: {
      full_name?: string | null;
      whatsapp?: string | null;
      avatar_url?: string | null;
      cover_url?: string | null;
    }): Promise<boolean> => {
      try {
        const { error } = await supabase.rpc("update_my_profile_secure", {
          p_full_name:
            updates.full_name !== undefined ? updates.full_name : null,
          p_whatsapp: updates.whatsapp !== undefined ? updates.whatsapp : null,
          p_avatar_url:
            updates.avatar_url !== undefined ? updates.avatar_url : null,
          p_cover_url:
            updates.cover_url !== undefined ? updates.cover_url : null,
        } as any);
        if (error) throw error;
        await fetchProfile();
        return true;
      } catch (err: any) {
        console.error("[Auth] Error updating profile:", err);
        toast.error(
          `Erro ao atualizar perfil: ${err.message || "Erro inesperado"}`,
        );
        return false;
      }
    },
    [fetchProfile],
  );

  const value = useMemo(
    () => ({
      session,
      user,
      profile,
      loading,
      isAdmin,
      login,
      signUp,
      resetPassword,
      verifyRecoveryCode,
      resendConfirmationEmail,
      updatePassword,
      updateProfile,
      logout,
      fetchProfile,
      isPasswordRecovery,
      setIsPasswordRecovery,
    }),
    [
      session,
      user,
      profile,
      loading,
      isAdmin,
      login,
      signUp,
      resetPassword,
      verifyRecoveryCode,
      resendConfirmationEmail,
      updatePassword,
      updateProfile,
      logout,
      fetchProfile,
      isPasswordRecovery,
      setIsPasswordRecovery,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
