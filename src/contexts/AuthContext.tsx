import { createContext, useEffect, useState, useMemo, useRef, useCallback, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { Session, User } from '@supabase/supabase-js';
import { toast } from 'sonner';

interface AuthContextType {
    session: Session | null;
    user: User | null;
    profile: any | null;
    loading: boolean;
    isAdmin: boolean;
    login: (email: string, senha: string) => Promise<{ success: boolean; error?: any }>;
    signUp: (email: string, senha: string, fullName: string, phone: string) => Promise<boolean>;
    resetPassword: (email: string) => Promise<boolean>;
    updatePassword: (newPassword: string) => Promise<boolean>;
    logout: () => Promise<void>;
    fetchProfile: () => Promise<void>;
    isPasswordRecovery: boolean;
    setIsPasswordRecovery: (value: boolean) => void;
}

 
export const AuthContext = createContext<AuthContextType>({} as AuthContextType);

// Shared semaphore and state for all Auth instances (prevents redundant parallel checks)
let checkingLock: Promise<void> | null = null;

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [session, setSession] = useState<Session | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<any | null>(null);
    const [loading, setLoading] = useState(true);
    const [isAdmin, setIsAdmin] = useState<boolean>(false);
    const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

    const checkAdmin = async (u: User | null | undefined) => {
        if (!u) {
            setIsAdmin(false);
            localStorage.removeItem('ikcous_is_admin');
            return;
        }

        // Fast Path 1: JWT Metadata (Zero latency, cryptographically secure if synced)
        const jwtRole = u.app_metadata?.role || u.user_metadata?.role;
        if (jwtRole === 'admin') {
            setIsAdmin(true);
            localStorage.setItem('ikcous_is_admin', 'true');
            // We can return early without hitting the DB
            return;
        }

        // Fast Path 2: Local Cache (Used only to block UI while verifying, NEVER to grant access)
        const cachedAdmin = localStorage.getItem('ikcous_is_admin') === 'true';

        // Network validation (Heavy)
        const networkCheck = async () => {
            if (checkingLock) {
                await checkingLock;
                return;
            }

            checkingLock = (async () => {
                try {
                    // First try direct RPC (fastest, most secure)
                    const { data, error } = await supabase.rpc('is_admin');
                    if (!error && typeof data === 'boolean') {
                        setIsAdmin(data);
                        if (data) localStorage.setItem('ikcous_is_admin', 'true');
                        else localStorage.removeItem('ikcous_is_admin');
                        return;
                    }

                    // Fallback: check profiles table
                    const { data: profile, error: profileError } = await supabase
                        .from('profiles')
                        .select('role')
                        .eq('id', u.id)
                        .single();

                    if (!profileError && profile?.role === 'admin') {
                        setIsAdmin(true);
                        localStorage.setItem('ikcous_is_admin', 'true');
                    } else {
                        setIsAdmin(false);
                        localStorage.removeItem('ikcous_is_admin');
                    }
                } catch (err) {
                    console.error('[Auth] Error checking admin status:', err);
                    setIsAdmin(false);
                    localStorage.removeItem('ikcous_is_admin');
                } finally {
                    checkingLock = null;
                }
            })();
            
            await checkingLock;
        };

        // For non-cached users, we resolve immediately to unblock the UI and do network in background.
        // For cached admins, we await the network to verify they weren't demodded before showing admin views.
        if (cachedAdmin) {
            await networkCheck();
        } else {
            networkCheck().catch(err => console.error('[Auth] Background admin check failed:', err));
        }
    };

    useEffect(() => {
        // standalone fail-safe timer (v11.x extended to 15s for mobile stability)
        const safetyTimeout = setTimeout(() => {
            setLoading(current => {
                if (current) {
                    console.log('[Auth] Safety timeout (10s) reached. Unblocking UI forcefully.');
                    // If we timeout, we force loading to false to unblock the app.
                    return false;
                }
                return current;
            });
        }, 10000); // reduced from 15s to 10s for better UX, user shouldn't wait 15s to see the app
        return () => clearTimeout(safetyTimeout);
    }, []);

    const fetchProfile = useCallback(async () => {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (!currentUser) {
            setProfile(null);
            return;
        }

        try {
            const { data, error } = await supabase.rpc('get_my_complete_profile');
            if (!error && data) {
                const profileObj = Array.isArray(data) ? data[0] : data;
                setProfile(profileObj);
                if (profileObj) console.log('[Auth] Profile fetched:', profileObj.full_name);
            } else if (error) {
                console.error('[Auth] Error fetching profile:', error);
            }
        } catch (err) {
            console.error('[Auth] Profile fetch exception:', err);
        }
    }, []);

    const hasInited = useRef(false);
    const isVerifying = useRef(false);

    useEffect(() => {
        // Immediate session resolution with internal timeout guard
        const initAuth = async () => {
            if (hasInited.current) return;
            hasInited.current = true;
            console.log('[Auth] initAuth started');

            try {
                // Racing getSession against a timeout to prevent absolute hangs on mobile
                const sessionPromise = supabase.auth.getSession();
                const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('timeout'), 8000));

                const sessionRes = await Promise.race([sessionPromise, timeoutPromise]) as Awaited<typeof sessionPromise> | 'timeout';

                if (sessionRes === 'timeout') {
                    console.warn('[Auth] getSession timed out. Moving to listener.');
                    setLoading(false);
                    return;
                }

                const initSes = sessionRes.data?.session;
                console.log('[Auth] getSession result:', !!initSes);

                if (initSes) {
                    // ZENITH v21.7: Only verify if necessary. 
                    // We lock this to prevent parallel calls from hooks during initial paint.
                    isVerifying.current = true;

                    try {
                        const { data: { user: verifiedUser }, error: verifyError } = await supabase.auth.getUser();

                        if (verifyError) {
                            console.error('[Auth] Session verification failed:', verifyError.message);

                            // v12-vibe Resiliency: Only force signOut on absolute certainty of invalidity
                            const isDefinitivelyInvalid = 
                                verifyError.status === 403 || 
                                verifyError.message.includes('not found') ||
                                verifyError.message.includes('Invalid token');

                            if (isDefinitivelyInvalid) {
                                console.warn('[Auth] Stale/Invalid session detected. Forcing signOut.');
                                await supabase.auth.signOut();
                                setSession(null);
                                setUser(null);
                                return;
                            } else {
                                // Network errors or timeouts: assume session is still potentially valid
                                console.log('[Auth] Potential network issue. Retaining current session state.');
                                if (initSes) {
                                  setSession(initSes);
                                  setUser(initSes.user);
                                }
                                return;
                            }
                        }

                        if (verifiedUser) {
                            setSession(initSes);
                            setUser(verifiedUser);
                            // Fetch profile data (Solo-Ninja)
                            fetchProfile().catch((err: Error) => console.error('[Auth] init fetchProfile error:', err));
                            // AWAIT initial checkAdmin to prevent transition flicker on admin routes
                            await checkAdmin(verifiedUser).catch((err: Error) => console.error('[Auth] init checkAdmin error:', err));
                        } else {
                            await supabase.auth.signOut();
                        }
                    } finally {
                        isVerifying.current = false;
                    }
                }
            } catch (err) {
                console.error('[Auth] initAuth error:', err);
            } finally {
                console.log('[Auth] initAuth finished - unblocking UI');
                setLoading(false);
            }
        };
        initAuth();

        // Consolidated session listener for subsequent changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            console.log('[Auth] State change event:', event, !!session);

            // Guard: If we are already verifying in initAuth, don't let INITIAL_SESSION or redundant events override
            if (isVerifying.current && event === 'INITIAL_SESSION') {
                console.log('[Auth] Guarded: Verifying in progress, ignoring INITIAL_SESSION duplicate.');
                return;
            }

            setSession(prev => {
                if (event === 'INITIAL_SESSION' && !session && prev) return prev;
                if (event === 'INITIAL_SESSION' && prev?.user?.id === session?.user?.id) return prev;
                return session;
            });

            setUser(prev => {
                if (event === 'INITIAL_SESSION' && !session && prev) return prev;
                if (event === 'INITIAL_SESSION' && prev?.id === session?.user?.id) return prev;
                return session?.user ?? null;
            });

            if (event === 'PASSWORD_RECOVERY') {
                console.log('[Auth] Password recovery event detected');
                setIsPasswordRecovery(true);
            }

            if (session?.user) {
                fetchProfile().catch((err: Error) => console.error('[Auth] event fetchProfile error:', err));
                checkAdmin(session.user).catch((err: Error) => console.error('[Auth] background checkAdmin error:', err));
            } else {
                setProfile(null);
                setIsAdmin(false);
                if (event === 'SIGNED_OUT' && typeof window !== 'undefined') {
                    localStorage.removeItem('app.favorites');
                    localStorage.removeItem('marketplace_cart_v1');
                    localStorage.removeItem('ikcous_recently_viewed');
                    localStorage.removeItem('ikcous_compare');
                }
            }

            setLoading(false);
        });

        return () => {
            subscription.unsubscribe();
        };
    }, [fetchProfile]);



    const signUp = useCallback(async (email: string, senha: string, fullName: string, phone: string): Promise<boolean> => {
        const { error } = await supabase.auth.signUp({
            email,
            password: senha,
            options: {
                emailRedirectTo: window.location.origin,
                data: {
                    full_name: fullName,
                    phone: phone
                }
            }
        });
        if (error) {
            toast.error('Erro ao cadastrar: ' + error.message);
            return false;
        }
        return true;
    }, []);

    const login = useCallback(async (email: string, senha: string): Promise<{ success: boolean; error?: any }> => {
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password: senha,
        });
        if (error) {
            // We keep the toast for global notification, but return the error for specific UI handling
            toast.error('Erro ao entrar: ' + error.message);
            return { success: false, error };
        }
        return { success: true };
    }, []);

    const logout = useCallback(async () => {
        const { error } = await supabase.auth.signOut();
        if (error) {
            toast.error('Erro ao sair: ' + error.message);
        } else {
            setSession(null);
            setUser(null);
            setIsAdmin(false);
            setIsPasswordRecovery(false);
        }
    }, []);

    const resetPassword = useCallback(async (email: string): Promise<boolean> => {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + window.location.pathname + '?type=recovery',
        });
        if (error) {
            toast.error('Erro ao enviar e-mail: ' + error.message);
            return false;
        }
        toast.success('E-mail de recuperação enviado!');
        return true;
    }, []);

    const updatePassword = useCallback(async (newPassword: string): Promise<boolean> => {
        const { error } = await supabase.auth.updateUser({
            password: newPassword
        });
        if (error) {
            toast.error('Erro ao atualizar senha: ' + error.message);
            return false;
        }
        toast.success('Senha atualizada com sucesso!');
        setIsPasswordRecovery(false);
        return true;
    }, []);

    const value = useMemo(() => ({
        session,
        user,
        profile,
        loading,
        isAdmin,
        login,
        signUp,
        resetPassword,
        updatePassword,
        logout,
        fetchProfile,
        isPasswordRecovery,
        setIsPasswordRecovery
    }), [session, user, profile, loading, isAdmin, login, signUp, resetPassword, updatePassword, logout, fetchProfile, isPasswordRecovery, setIsPasswordRecovery]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};


