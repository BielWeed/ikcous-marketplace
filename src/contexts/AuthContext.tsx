import {
  type LoginAudience,
  MENSAGEM_ERRO_LOGIN_GENERICA,
  MENSAGEM_ERRO_LOGIN_GENERICA_LOJISTA,
} from "@/lib/mensagens-auth";
import { supabase } from "@/lib/supabase";
import {
  isAuthApiError,
  isAuthRetryableFetchError,
} from "@supabase/supabase-js";
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
  // #120 — "unconfirmed" e "not_found" saíram do union: eram exatamente o
  // vazamento (a UI mostrava mensagem diferente por resultado, revelando se
  // o e-mail tinha conta e se estava confirmado). Só resta "success" (a
  // MESMA resposta neutra, exista ou não a conta) e "error" (falha genuína,
  // que não pode distinguir os dois casos).
  status: "success" | "error";
  message?: string;
}

// #123 — três estados em vez de um booleano só: "unknown" separa "ainda não
// sei" de "não é admin", para o painel não expulsar ninguém enquanto a
// verificação (a RPC `is_admin`, do servidor) ainda está em voo. `isAdmin`
// continua existindo, derivado: `adminStatus === "admin"`.
export type AdminStatus = "unknown" | "admin" | "not-admin";

// A1-fix4 — `MENSAGEM_ERRO_LOGIN_GENERICA`, `MENSAGEM_ERRO_LOGIN_GENERICA_LOJISTA`
// e o tipo `LoginAudience` moraram aqui até este arquivo importar
// `@/lib/supabase` (que instancia um cliente Supabase real em tempo de
// import) arrastar essa dependência para todo teste que só queria ler uma
// frase de texto — via este arquivo — e estourar "Web Worker is not
// supported" no jsdom. Agora vivem em `@/lib/mensagens-auth.ts`, um módulo
// sem nenhum import de runtime; o histórico de decisão de cada frase (por
// que "fale com a loja" não serve para o lojista, por que `user_banned` é
// 400 e não 403, por que `audience` é obrigatório sem default) está lá.

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: any | null;
  loading: boolean;
  isAdmin: boolean;
  adminStatus: AdminStatus;
  login: (
    email: string,
    senha: string,
    audience: LoginAudience,
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

// Coalescência por usuário (#121): antes disto era um semáforo GLOBAL
// (`checkingLock: Promise<void> | null`), compartilhado por qualquer
// checagem em voo — na troca de conta na mesma aba, a checagem do cliente
// novo simplesmente esperava (e descartava) a do admin antigo, sem nunca
// calcular o próprio resultado. Agora só coalesce quando o `userId` bate;
// um `userId` diferente inicia a sua própria verificação, nunca compartilha
// a promise de outro usuário.
let checkInFlight: { userId: string; promise: Promise<boolean> } | null = null;
let initPromise: Promise<any> | null = null;

// #122 — função ÚNICA de limpeza de sessão local, chamada tanto pelo
// `logout` (caminho de sucesso e o fallback de erro) quanto pelo listener de
// `SIGNED_OUT`. Antes disto a lógica estava duplicada e divergente: o
// listener removia 'app.favorites' (chave morta — zero writers no
// repositório) e nunca tocava os caches de pedidos e endereços, que guardam
// dado pessoal (histórico de pedidos; CEP, rua, número e destinatário) e
// sobreviviam ao logout indefinidamente num dispositivo compartilhado.
// Varredura por PREFIXO, de trás para a frente (o índice se desloca ao
// remover) — igual ao que o código já fazia para `ikcous_is_admin_`: um
// dispositivo compartilhado acumula cache de vários usuários, não só do que
// acabou de sair.
function clearLocalUserData() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("marketplace_cart_v1");
  localStorage.removeItem("ikcous_recently_viewed");
  localStorage.removeItem("ikcous_is_admin");
  // Revisão de contexto limpo do diff (achado 2) — o CEP também é PII do
  // usuário logado: `ikcous_last_shipping_cep` é lido na montagem do
  // checkout e do calculador de frete, e `ikcous_shipping_cache_<cep>`
  // carrega o CEP no PRÓPRIO NOME da chave (visível no DevTools sem abrir
  // valor nenhum). Sem isto, cliente B via o CEP de cliente A pré-preenchido
  // num dispositivo compartilhado.
  localStorage.removeItem("ikcous_last_shipping_cep");
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (
      key?.startsWith("ikcous_is_admin_") ||
      key?.startsWith("ikcous_orders_cache_") ||
      key?.startsWith("ikcous_addresses_cache_") ||
      key?.startsWith("ikcous_shipping_cache_")
    ) {
      localStorage.removeItem(key);
    }
  }
}

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

  const [session, setSession] = useState<Session | null>(cachedSession);
  const [user, setUser] = useState<User | null>(
    cachedSession ? cachedSession.user : null,
  );
  const [profile, setProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(!!cachedSession); // Non-blocking for guests, verifying for returned users
  // #123 — `adminStatus` NUNCA nasce confirmado a partir do texto em cache
  // (`getCachedSession()` é `JSON.parse` de `localStorage`, editável no
  // DevTools). Com sessão, nasce "unknown" e só a RPC promove para "admin"
  // ou "not-admin". Sem sessão, não há usuário para verificar.
  const [adminStatus, setAdminStatus] = useState<AdminStatus>(
    cachedSession?.user ? "unknown" : "not-admin",
  );
  const isAdmin = adminStatus === "admin";
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

  // #121 — precisa existir ANTES de `checkAdmin`: é a guarda que decide, na
  // resolução de uma verificação, se o usuário que a disparou ainda é o
  // ativo (troca de conta no meio da checagem não pode gravar por cima).
  const activeUserIdRef = useRef<string | null>(
    cachedSession?.user?.id || null,
  );

  const checkAdmin = async (u: User | null | undefined) => {
    if (!u) {
      setAdminStatus("not-admin");
      return;
    }

    const userId = u.id;
    const cacheKey = `ikcous_is_admin_${userId}`;

    // Aplica o resultado só se o usuário verificado ainda for o ativo no
    // momento em que a checagem termina (#121) — sem isto, a checagem do
    // usuário que SAIU pode gravar `isAdmin`/cache por cima do usuário que
    // entrou depois, inclusive quando chega atrasada (promise órfã do
    // timeout, ver `networkCheck`).
    //
    // Achado 2 (revisão #121/#123) — `verified` distingue um VEREDITO real
    // (a RPC ou o fallback em `profiles` respondeu) de um NÃO-VEREDITO
    // (timeout de 3s ou erro de rede, ver o `catch` mais abaixo). Só um
    // veredito pode ser persistido: gravar "false" no `localStorage` a
    // partir de uma resposta que nunca chegou vira uma conclusão permanente
    // — nas cargas SEGUINTES, o Fast Path 2 leria esse cache e resolveria
    // "not-admin" antes de qualquer rede, sem chance de correção. Um
    // não-veredito só pode mexer no estado em memória desta carga.
    const applyResult = (isAdminResult: boolean, verified: boolean) => {
      if (activeUserIdRef.current !== userId) {
        console.debug(
          "[Auth] Discarding stale admin check result for user:",
          userId,
        );
        return;
      }
      setAdminStatus(isAdminResult ? "admin" : "not-admin");
      if (verified) {
        localStorage.setItem(cacheKey, isAdminResult ? "true" : "false");
      }
    };

    // #123 — a sessão local é texto que o usuário edita no DevTools; o
    // supabase-js não valida a assinatura do JWT no cliente. `app_metadata`
    // NUNCA confirma admin por si só — só a RPC abaixo (ou o fallback em
    // `profiles`), verificada pelo servidor nesta carga de página, decide.

    // Fast Path 2: Local Cache (Immediate return for confirmed customers, keyed by user ID)
    const cachedAdmin = localStorage.getItem(cacheKey);
    if (cachedAdmin === "false") {
      setAdminStatus("not-admin");
      // Run background check to sync with potential admin status updates without blocking initial load
      networkCheck()
        .then((result) => applyResult(result, true))
        .catch((err) =>
          console.error("[Auth] background networkCheck error:", err),
        );
      return;
    }

    // Network validation (Heavy). Resolve o booleano — não escreve estado
    // nem localStorage por conta própria; quem faz isso é `applyResult`,
    // guardado pelo usuário ativo. Timeout/erro REJEITA em vez de resolver
    // `false` — quem decide o que fazer com um não-veredito é quem chama
    // (`applyResult(..., false)` mais abaixo), não esta função.
    async function networkCheck(): Promise<boolean> {
      if (checkInFlight && checkInFlight.userId === userId) {
        // Mesmo usuário já tem uma verificação em voo: reaproveita a
        // promise dela em vez de disparar outra RPC.
        return checkInFlight.promise;
      }

      // Usuário diferente (ou nenhuma verificação em voo): inicia a
      // própria, sem esperar nem descartar a de outro usuário.
      const myCheck = (async (): Promise<boolean> => {
        const queryPromise = (async (): Promise<boolean> => {
          // First try direct RPC (fastest, most secure)
          const { data, error } = await supabase.rpc("is_admin");
          if (!error && typeof data === "boolean") {
            return data;
          }

          // Fallback: check profiles table
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", userId)
            .single();

          return !profileError && profile?.role === "admin";
        })();

        // Add a resilient 3-second timeout limit to the network query
        const timeoutPromise = new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error("Admin check timeout")), 3000),
        );

        return Promise.race([queryPromise, timeoutPromise]);
      })();

      checkInFlight = { userId, promise: myCheck };

      try {
        return await myCheck;
      } finally {
        // Anotado 3 (revisão #121/#123) — compara pela IDENTIDADE da
        // promise, não pelo `userId`. Só o `userId` não distingue DUAS
        // checagens do MESMO usuário: na sequência A → B → A dentro da
        // mesma janela, a checagem ORIGINAL de A pode liquidar por último e,
        // comparando só o `userId`, apagaria o slot da SEGUNDA checagem de
        // A — que ainda está em voo — mesmo sem ser a dona dele.
        if (checkInFlight?.promise === myCheck) {
          checkInFlight = null;
        }
      }
    }

    // Await the network check to prevent privilege bypass on client spoofing.
    try {
      const result = await networkCheck();
      applyResult(result, true);
    } catch (err) {
      console.error("[Auth] Error/Timeout checking admin status:", err);
      // Não-veredito (Achado 2): trata como não-admin SÓ nesta carga, sem
      // persistir no localStorage.
      applyResult(false, false);
    }
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
        // O nome NAO entra no log: sao 540 `console.*` no projeto e quase
        // nenhum sob guarda, entao isto ia para producao — qualquer pessoa que
        // abrisse o console na loja lia o nome completo de quem acabara de
        // entrar. Saber QUE o perfil chegou basta para depurar; saber de quem
        // e' dado de cliente na tela de um estranho.
        if (profileData && import.meta.env.DEV)
          console.log("[Auth] Profile fetched");
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
                  setAdminStatus("not-admin");
                  return;
                }

                // CONTA-02 (auditoria de 26/08/2026) — `verifyError` que NÃO
                // é comprovadamente inválido não pode terminar deslogando.
                // `AuthRetryableFetchError` é o que o @supabase/auth-js
                // lança para QUALQUER falha de rede ou status 5xx
                // (node_modules/@supabase/auth-js/dist/module/lib/fetch.js:
                // 18-32: handleError() cobre `!looksLikeFetchResponse`
                // — rede/CORS — e a lista NETWORK_ERROR_CODES de 500 a 530)
                // — classificação ESTRUTURAL da própria SDK (o nome/classe
                // do erro), não uma lista de strings nova que quebra se o
                // servidor mudar a frase amanhã. Falha ao VERIFICAR não é
                // prova de invalidez: o boot já hidratou sessão/usuário a
                // partir do cache local (linhas acima), e não tocar em nada
                // aqui — nem `signOut()`, nem `activeUserIdRef`, nem
                // `setSession`/`setUser` — é o que preserva carrinho, vistos
                // recentemente, comparados e CEP de frete até a próxima
                // tentativa (próximo boot ou evento do listener). Isto
                // também cobre o caso OFFLINE: `supabase.auth.signOut()`
                // devolve erro de rede SEM chamar `_removeSession()` (ver
                // GoTrueClient.js:3357-3376 — só limpa a sessão local se o
                // servidor confirmou, ou se o erro foi 404/401/403), então a
                // pessoa continua logada; ao NÃO entrar mais no `else` de
                // `if (verifiedUser)` abaixo para este erro,
                // `activeUserIdRef.current` também não é zerado por engano,
                // e o estado não fica desencontrado do que a UI mostra.
                //
                // CONTA-02b (auditoria de 26/08/2026) — 429 (rate limit) NÃO
                // cai em nenhum dos dois ramos acima: não é 403/"not
                // found"/"Invalid token" (não é `isDefinitivelyInvalid`), e
                // não está em `NETWORK_ERROR_CODES` (500-504, 520-530 —
                // node_modules/@supabase/auth-js/dist/module/lib/fetch.js:
                // 21-32), então o SDK lança `AuthApiError(429)`, não
                // `AuthRetryableFetchError`. Sem este ramo, o mesmo `else`
                // de `if (verifiedUser)` chamava `signOut()` para "estou
                // sendo limitado por excesso de chamadas" — gatilho real:
                // várias abas ou recargas rápidas contra `GET /user`. Mesma
                // classificação ESTRUTURAL (`isAuthApiError` +
                // `.status`, node_modules/@supabase/auth-js/dist/module/
                // lib/errors.js:41-50), mesmo princípio: não consigo
                // verificar não pode significar sessão inválida.
                const isRateLimited =
                  isAuthApiError(verifyError) && verifyError.status === 429;

                if (isAuthRetryableFetchError(verifyError) || isRateLimited) {
                  console.warn(
                    "[Auth] Session verification inconclusive (network/server error or rate limited). Keeping cached session.",
                  );
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
          setAdminStatus("not-admin");
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
        setAdminStatus("not-admin");
        if (event === "SIGNED_OUT") {
          clearLocalUserData();
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
        // Tradução por CAUSA verificada na doc oficial do Supabase Auth
        // (https://supabase.com/docs/guides/auth/debugging/error-codes):
        // `user_already_exists`/`email_exists` e `weak_password` têm causa
        // única, e o limite de envio (429) não distingue conta existente de
        // inexistente — nenhum dos três reabre enumeração. O que não bate em
        // nenhum caso conhecido (validação de parâmetro, provedor
        // desabilitado, rede) fica genérico: melhor honesto do que presumido.
        console.error("[Auth] Erro ao cadastrar:", error.message);
        let message = "Não foi possível concluir o cadastro. Tente novamente.";
        if (
          error.code === "email_exists" ||
          error.code === "user_already_exists" ||
          error.message?.includes("already registered")
        ) {
          message =
            "Este e-mail já está cadastrado. Tente entrar ou recuperar sua senha.";
        } else if (error.code === "weak_password") {
          message =
            // NÃO prescrever "mais caracteres": o `weak_password` do
            // @supabase/auth-js tem TRÊS causas (lib/types.d.ts:138 —
            // `["length", "characters", "pwned"]`), e em duas delas acrescentar
            // caracteres falha de novo. `characters` pede outra CLASSE de
            // caractere; `pwned` é senha vazada, e uma de 40 caracteres reprova
            // igual. Prescrever a correção de uma causa para as três é o mesmo
            // defeito que este lote existe para matar: a tela nomeando um
            // conserto que não conserta.
            "Senha muito fraca. Escolha outra senha.";
        } else if (error.status === 429) {
          message = "Muitas tentativas. Tente novamente em alguns minutos.";
        }
        toast.error(message);
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
      audience: LoginAudience,
    ): Promise<{ success: boolean; error?: any }> => {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: senha,
      });
      if (error) {
        // We keep the toast for global notification, but return the error for specific UI handling
        //
        // Mesma tradução por causa de AuthView.tsx (handleSubmit, ramo de
        // erro de login) — o toast global e a mensagem inline da tela
        // precisam concordar, senão o usuário lê duas frases diferentes para
        // o mesmo erro. A ORDEM importa: o Supabase devolve status 400 tanto
        // para "Invalid login credentials" quanto para "Email not
        // confirmed" quanto para "User is banned" (conferido na fonte do
        // GoTrue), então os casos de e-mail não confirmado e de conta
        // banida têm que ser checados ANTES do 400 genérico — checados
        // depois nunca são alcançados.
        console.error("[Auth] Erro ao entrar:", error.message);
        // A1-fix2/A1-fix3 — o ramo genérico escolhe a frase pela AUDIÊNCIA
        // de quem chamou (ver comentário de
        // `MENSAGEM_ERRO_LOGIN_GENERICA_LOJISTA` em `@/lib/mensagens-auth.ts`,
        // não mais aqui — A1-fix4 moveu as duas constantes). `audience` é
        // OBRIGATÓRIO (sem default): AdminLoginView.tsx passa `"admin"`;
        // AuthView.tsx (cliente) passa `"customer"` explicitamente.
        let message =
          audience === "admin"
            ? MENSAGEM_ERRO_LOGIN_GENERICA_LOJISTA
            : MENSAGEM_ERRO_LOGIN_GENERICA;
        if (
          error.code === "email_not_confirmed" ||
          error.message?.includes("Email not confirmed")
        ) {
          message =
            "Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada.";
        } else if (
          error.code === "user_banned" ||
          error.message?.includes("User is banned")
        ) {
          // A1-fix3 (achado BLOQUEANTE) — PRECISA vir antes do `else if
          // (error.status === 400 ...)` abaixo. `user_banned` é HTTP 400
          // (conferido na fonte do GoTrue, ver comentário de
          // `MENSAGEM_ERRO_LOGIN_GENERICA` em `@/lib/mensagens-auth.ts`, não
          // mais aqui — A1-fix4 moveu a constante); sem este ramo explícito,
          // o `status === 400` genérico capturava `user_banned` e a pessoa
          // com a SENHA CERTA lia "E-mail ou senha incorretos" para sempre.
          // `message` fica a genérica-por-audiência já atribuída acima —
          // decisão tomada, não reabrir: o GoTrue já devolve `code:
          // "user_banned"` no corpo da resposta (visível nas ferramentas do
          // navegador), então a fronteira do vazamento é a API, não a tela.
        } else if (
          error.status === 400 ||
          error.message?.includes("Invalid login credentials")
        ) {
          message = "E-mail ou senha incorretos. Verifique suas credenciais.";
        } else if (error.status === 429) {
          // Verificado na doc oficial: o limite de login (token grant) é POR
          // ENDEREÇO IP, não por usuário — não revela se a conta existe.
          message = "Muitas tentativas. Tente novamente em alguns minutos.";
        }
        toast.error(message);
        return { success: false, error };
      }
      return { success: true };
    },
    [],
  );

  const logout = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      // #122 — `signOut()` devolvendo erro (rede caída, por exemplo) não
      // dispara o evento `SIGNED_OUT`: sem este ramo, o app continuava
      // "logado" e o token do supabase-js continuava vivo no localStorage,
      // legível no DevTools. Terminamos deslogados MESMO ASSIM — o toast de
      // erro continua existindo, mas deixa de ser a única consequência.
      console.error("[Auth] Erro ao sair:", error.message);
      // Genérico de propósito: rede caída e sessão já expirada dão o mesmo
      // erro aqui, e não temos como distinguir uma causa da outra — mas as
      // duas terminam com a sessão LOCAL limpa de qualquer forma (ver o
      // resto deste bloco), então a mensagem só avisa que o servidor não
      // confirmou, sem apontar uma causa que não foi verificada.
      toast.error(
        "Não foi possível confirmar a saída no servidor, mas sua sessão local foi encerrada.",
      );
      // Revisão de contexto limpo do diff (achado 1) — sem isto, uma checagem
      // de admin (`checkAdmin`, RPC `is_admin`) que estivesse em voo no
      // momento do logout via `activeUserIdRef.current` ainda apontando para
      // o usuário que saiu, e `applyResult` gravava
      // `ikcous_is_admin_<uuid>` por cima mesmo depois da sessão ter sido
      // encerrada. É a mesma guarda que o listener de `onAuthStateChange`
      // (`supabase.auth.onAuthStateChange`, acima neste efeito) já honra ao
      // atualizar `activeUserIdRef.current = currentUserId` logo no início do
      // callback, para qualquer evento — SIGNED_OUT incluso; este é o único
      // caminho de saída que não a honrava.
      activeUserIdRef.current = null;
      setSession(null);
      setUser(null);
      setAdminStatus("not-admin");
      setIsPasswordRecovery(false);
      clearLocalUserData();
      if (typeof window !== "undefined") {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key?.includes("-auth-token") || key?.includes("-code-verifier")) {
            localStorage.removeItem(key);
          }
        }
      }
    } else {
      setSession(null);
      setUser(null);
      setAdminStatus("not-admin");
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
        // O limite de envio (429/`over_email_send_rate_limit`, doc oficial)
        // é a única causa aqui com um sinal estável para distinguir — o
        // resto (rede, provedor) cai no genérico de reenvio.
        console.error("[Auth] Erro ao reenviar e-mail:", error.message);
        const message =
          error.status === 429 || error.code === "over_email_send_rate_limit"
            ? "Muitas tentativas. Aguarde alguns minutos antes de pedir um novo e-mail."
            : "Não foi possível reenviar o e-mail agora. Tente novamente em instantes.";
        toast.error(message);
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
        // #120 — antes disto, chamávamos a RPC `check_user_confirmation_status`
        // para decidir entre três respostas diferentes ("not_found",
        // "unconfirmed", "success"). Essa RPC é SECURITY DEFINER e tinha
        // EXECUTE liberado para `anon`: um visitante jogando uma lista de
        // e-mails no endpoint REST descobria quem tem conta e quem
        // confirmou, e a própria UI confirmava isso em texto. A RPC foi
        // revogada (ver migration nova em `supabase/migrations/`); agora
        // chamamos `resetPasswordForEmail` direto, que por design do
        // Supabase Auth NÃO confirma nem nega a existência da conta — a
        // resposta é a mesma independentemente de o e-mail estar cadastrado.
        //
        // Decisão já tomada (não reabrir): perdemos o reenvio automático do
        // e-mail de confirmação que rodava no ramo "unconfirmed" — não dá
        // para mantê-lo sem voltar a distinguir os casos no cliente, que é
        // exatamente o vazamento que estamos fechando. Corrigido na revisão
        // de contexto limpo (achado 4): quem se cadastra e some antes de
        // confirmar NÃO tem hoje um caminho de autoatendimento para um novo
        // link — `resendConfirmationEmail` só é renderizado sob
        // `showConfirmation` (AuthView.tsx), que nasce `false` e só vira
        // `true` dentro de um `signUp` bem-sucedido DA MESMA sessão de
        // navegador. Fechar a enumeração foi a decisão tomada mesmo assim;
        // dar a esse usuário uma entrada nova na tela de login é escopo de
        // outra issue, não desta.
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${
            window.location.origin + window.location.pathname
          }?type=recovery`,
        });

        if (error) {
          // Erro genuíno (rede, rate limit etc.) — não pode distinguir
          // e-mail cadastrado de não cadastrado, só reportar que algo deu
          // errado no envio. Revisão de contexto limpo (achado 3): o rate
          // limit do Supabase Auth é POR USUÁRIO, então só dispara para quem
          // TEM conta — ecoar `error.message` (ex.: "For security purposes,
          // you can only request this after N seconds") na TELA reabria a
          // mesma enumeração que a RPC revogada causava. A mensagem para o
          // chamador é sempre genérica; o detalhe vai só para o console.
          console.error("[Auth] resetPasswordForEmail error:", error.message);
          return {
            success: false,
            status: "error",
            message:
              "Não foi possível enviar o link de recuperação agora. Tente novamente em instantes.",
          };
        }

        return {
          success: true,
          status: "success",
          message:
            "Se este e-mail estiver cadastrado, enviamos um link de recuperação.",
        };
      } catch (err: any) {
        // Este `catch` só roda quando `resetPasswordForEmail` LANÇA em vez de
        // devolver `{ error }` — uma exceção fora do protocolo normal do
        // GoTrue (o SDK normalmente captura falha de rede/servidor e devolve
        // como `error`, nunca lança; ver AuthUnknownError em
        // node_modules/@supabase/auth-js/dist/module/lib/errors.d.ts). Sem
        // sinal nenhum para distinguir a causa, `err?.message` pode ser
        // absolutamente qualquer coisa — inclusive detalhe interno do banco
        // ou do servidor. Mesma frase do ramo `if (error)` logo acima: a
        // causa é igualmente desconhecida, então não pode ganhar uma
        // terceira frase inventada, e não pode ecoar `err.message` na tela.
        console.error("[Auth] Reset recovery exception:", err);
        return {
          success: false,
          status: "error",
          message:
            "Não foi possível enviar o link de recuperação agora. Tente novamente em instantes.",
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
        // Tradução por causa (doc oficial do Supabase Auth,
        // https://supabase.com/docs/guides/auth/debugging/error-codes):
        // `same_password` e `weak_password` têm causa única. Diferente do
        // "faça login novamente" que já enganou este repositório antes,
        // `reauthentication_needed` é um mecanismo PRÓPRIO do Supabase Auth
        // para operação sensível — sempre resolve fazendo login de novo,
        // não é um erro de RLS com causa dupla. O que sobra (validação de
        // parâmetro, rede) fica genérico.
        console.error("[Auth] Erro ao atualizar senha:", error.message);
        let message = "Não foi possível atualizar sua senha. Tente novamente.";
        if (error.code === "same_password") {
          message = "A nova senha precisa ser diferente da senha atual.";
        } else if (error.code === "weak_password") {
          message =
            // NÃO prescrever "mais caracteres": o `weak_password` do
            // @supabase/auth-js tem TRÊS causas (lib/types.d.ts:138 —
            // `["length", "characters", "pwned"]`), e em duas delas acrescentar
            // caracteres falha de novo. `characters` pede outra CLASSE de
            // caractere; `pwned` é senha vazada, e uma de 40 caracteres reprova
            // igual. Prescrever a correção de uma causa para as três é o mesmo
            // defeito que este lote existe para matar: a tela nomeando um
            // conserto que não conserta.
            "Senha muito fraca. Escolha outra senha.";
        } else if (error.code === "reauthentication_needed") {
          message =
            "Por segurança, é preciso fazer login novamente antes de trocar a senha.";
        }
        toast.error(message);
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
        // `update_my_profile_secure` não tem nenhum `RAISE EXCEPTION` (ver
        // supabase/migrations/20260806000000_baseline_do_schema_vivo.sql,
        // função `update_my_profile_secure`) — o único `WHERE id = auth.uid()`
        // não gera erro nem quando não afeta linha nenhuma. Todo erro que
        // chega aqui é de causa não distinguível (rede, restrição do banco),
        // então a mensagem é sempre a mesma, sem depender de `err.message`
        // como reserva — reserva com o texto cru é vazamento também.
        console.error("[Auth] Error updating profile:", err);
        toast.error("Não foi possível atualizar seu perfil. Tente novamente.");
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
      adminStatus,
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
      adminStatus,
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
