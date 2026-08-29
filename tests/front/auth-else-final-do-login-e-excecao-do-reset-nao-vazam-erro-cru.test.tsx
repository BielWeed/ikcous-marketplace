// @vitest-environment jsdom
//
// Dois pontos, medidos na fonte antes deste teste existir:
//
// PONTO 1 — AuthView.tsx (handleSubmit, ramo de erro de login). O código já
// distingue "e-mail não confirmado" (400 + code), "credenciais inválidas"
// (400 genérico) e "muitas tentativas" (429) com frases próprias. Mas o
// ÚLTIMO ramo, `else if (error.message) { message = error.message; }`,
// pegava QUALQUER outra causa — conta banida (400 no password grant, code
// user_banned; `user_banned` É 403 em OUTROS endpoints do GoTrue, mas não
// neste — ver o comentário do ramo `user_banned` em AuthView.tsx para a
// fonte), provedor desativado, erro 500 do servidor, exceção interna do
// GoTrue — e
// jogava a frase crua, em inglês, na tela de quem está tentando entrar na
// loja. Esse ramo cai sobre uma família heterogênea de causas sem sinal
// estável para diferenciar (ver AuthApiError/AuthRetryableFetchError/
// AuthUnknownError em node_modules/@supabase/auth-js/dist/module/lib/
// errors.d.ts) — não existe UMA frase específica que sirva para todas, então
// a tradução certa é a genérica que a variável `message` já carregava por
// padrão (linha ~141 de AuthView.tsx), nunca `error.message`.
//
// PONTO 2 — AuthContext.tsx (resetPassword, bloco `catch`). O ramo `if
// (error)` (erro genuíno devolvido pelo GoTrue) já é genérico de propósito,
// para não reabrir a enumeração de e-mail que a #120 fechou. O `catch (err)`
// — que só roda quando `resetPasswordForEmail` LANÇA em vez de devolver
// `{error}`, uma exceção fora do protocolo normal — ainda montava a mensagem
// com `err?.message || "Erro inesperado"`, ecoando o texto cru de uma
// exceção que pode ser absolutamente qualquer coisa. AuthView.tsx (linha
// ~219) só repassa `res.message` para o toast — o vazamento nasce em
// AuthContext, não ali.
//
// Mesmos padrões dos dois arquivos irmãos deste lote:
// auth-view-reenvio-confirmacao-no-login.test.tsx (render de verdade da
// AuthView com useAuth mockado por inteiro) e auth-mensagem-traduzida.test.tsx
// (Sonda + createRoot sobre o AuthContext real, supabase mockado).
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Ponto 1: AuthView --------------------------------------------------

const login = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    login,
    signUp: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    resendConfirmationEmail: vi.fn(),
    isPasswordRecovery: false,
    setIsPasswordRecovery: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// Mesmo motivo do arquivo irmão: sem este mock, importar AuthView de verdade
// arrasta @/lib/supabase.ts e estoura "Web Worker is not supported" no jsdom.
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeCity: "Sao Paulo", storeState: "SP" },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function localizarBotaoPorTexto(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AuthView — o ramo final do erro de login para de repetir a frase crua do servidor", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    login.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function montarELogar(email: string, senha: string) {
    const { AuthView } = await import("@/views/shared/AuthView");
    const onNavigate = vi.fn();

    await act(async () => {
      raiz.render(<AuthView onNavigate={onNavigate} />);
    });

    await act(async () => {
      digitar("email", email);
      digitar("password", senha);
    });

    const entrarBotao = localizarBotaoPorTexto("ENTRAR AGORA")!;
    await act(async () => {
      entrarBotao.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  // A1-fix3 (achado BLOQUEANTE da revisão de contexto limpo) — a fixture
  // usava `status: 403`, e SÓ por isso este teste passava: o GoTrue devolve
  // `user_banned` como HTTP 400 no password grant (este caminho) — não 403.
  // Ressalva (A1-fix5): `user_banned` É 403 em OUTROS endpoints do GoTrue
  // (internal/api/auth.go:38, internal/api/verify.go:670,727, via
  // `NewForbiddenError`); "400, não 403" vale só aqui. Conferido na FONTE
  // (github.com/supabase/auth, internal/api/token.go,
  // ResourceOwnerPasswordGrant): `if user.IsBanned() { return
  // apierrors.NewBadRequestError(apierrors.ErrorCodeUserBanned, "User is
  // banned") }`, e `NewBadRequestError` usa `http.StatusBadRequest` (400)
  // em internal/api/apierrors/apierrors.go. Com o status REAL, o ramo
  // `error.status === 400` do código (antes desta correção) capturava
  // `user_banned` como se fosse credencial errada — a pessoa com a senha
  // CERTA lia "E-mail ou senha incorretos" para sempre (e com a senha
  // ERRADA também, já que `IsBanned()` roda ANTES de `Authenticate()` —
  // a senha nunca chega a ser conferida; este teste só exercita o caso
  // "senha certa" porque é o que mais confunde: a pessoa não teria como
  // saber que digitou certo).
  it("conta banida (status 400 real, code user_banned — não cai em nenhum dos ramos com frase própria): mensagem genérica, nunca a frase em inglês do servidor", async () => {
    login.mockResolvedValue({
      success: false,
      error: {
        status: 400,
        code: "user_banned",
        message: "User is banned",
      },
    });

    await montarELogar("banido@example.com", "senha123");

    // M1/M2 (revisão de contexto limpo) — a frase genérica passou a ser uma
    // constante única, compartilhada com AuthContext.login (toast) e
    // verdadeira para causas retryable E permanentes (banimento é uma
    // delas): não instrui "tente novamente" como se fosse sempre a solução,
    // e não enumera o motivo (não revela "user_banned" nem qualquer status).
    expect(hospedeiro.textContent).toMatch(/não foi possível entrar agora/i);
    expect(hospedeiro.textContent).not.toMatch(/user is banned/i);
  });

  it("causa sem status nem code (exceção interna do servidor): mesma mensagem genérica, nunca ecoa error.message", async () => {
    login.mockResolvedValue({
      success: false,
      error: {
        message: 'relation "auth.users" does not exist',
      },
    });

    await montarELogar("qualquer@example.com", "senha123");

    expect(hospedeiro.textContent).toMatch(/não foi possível entrar agora/i);
    expect(hospedeiro.textContent).not.toMatch(/does not exist/i);
  });

  // Regressão: os três ramos com frase própria continuam intactos — a
  // correção do ramo final não pode ter apagado a distinção entre eles.
  it("credenciais inválidas (status 400) continua com a frase própria, não a genérica do else final", async () => {
    login.mockResolvedValue({
      success: false,
      error: {
        status: 400,
        code: "invalid_credentials",
        message: "Invalid login credentials",
      },
    });

    await montarELogar("alguem@example.com", "senha-errada");

    expect(hospedeiro.textContent).toMatch(/e-?mail ou senha incorretos/i);
    expect(hospedeiro.textContent).not.toMatch(
      /não foi possível entrar agora/i,
    );
  });

  // M1/M2 — buraco de cobertura apontado pela revisão: o ramo 429 nunca era
  // asserido em nenhum dos testes que renderizam AuthView. Antes do diff de
  // A1, quebrar esse ramo aparecia como inglês cru na tela; hoje cairia em
  // silêncio numa frase em português plausível (a genérica). Este teste
  // fecha essa lacuna: garante que 429 continua com a frase PRÓPRIA
  // ("muitas tentativas"), nunca a genérica do ramo final.
  it("bloqueio por excesso de tentativas (status 429) continua com a frase própria, não a genérica do else final", async () => {
    login.mockResolvedValue({
      success: false,
      error: {
        status: 429,
        message: "Too many requests",
      },
    });

    await montarELogar("alguem@example.com", "senha123");

    expect(hospedeiro.textContent).toMatch(/muitas tentativas/i);
    expect(hospedeiro.textContent).not.toMatch(
      /não foi possível entrar agora/i,
    );
  });
});

// --- Ponto 2: AuthContext -------------------------------------------------

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      getUser: vi.fn(),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn(),
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      updateUser: vi.fn(),
      resend: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    },
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({
              data: null,
              error: { message: "não usado neste teste" },
            }),
        }),
      }),
    })),
  },
}));

function criarLocalStorageFake() {
  const armazem = new Map<string, string>();
  return {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, valor);
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
    clear: () => {
      armazem.clear();
    },
    key: (index: number) => Array.from(armazem.keys()).at(index) ?? null,
    get length() {
      return armazem.size;
    },
  };
}

interface SnapshotReset {
  resetPassword: (email: string) => Promise<{
    success: boolean;
    status: "success" | "error";
    message?: string;
  }>;
}

function SondaReset({
  authContext,
  aoAtualizar,
}: {
  readonly authContext: React.Context<any>;
  readonly aoAtualizar: (snapshot: SnapshotReset) => void;
}) {
  const ctx = useContext(authContext) as SnapshotReset;
  aoAtualizar({ resetPassword: ctx.resetPassword });
  return null;
}

function ultimoEstadoReset(
  aoAtualizar: ReturnType<typeof vi.fn>,
): SnapshotReset | undefined {
  return aoAtualizar.mock.calls.at(-1)?.[0];
}

describe("AuthContext — resetPassword: exceção fora do protocolo normal do GoTrue não vaza mais err.message", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar() {
    vi.resetModules();
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    const { supabase } = await import("@/lib/supabase");

    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { session: null }, error: null });
    (
      supabase.auth.onAuthStateChange as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });

    const aoAtualizar = vi.fn();
    await act(async () => {
      raiz.render(
        <AuthProvider>
          <SondaReset authContext={AuthContext} aoAtualizar={aoAtualizar} />
        </AuthProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const estado = ultimoEstadoReset(aoAtualizar)!;
    return { supabase, ...estado };
  }

  it("resetPasswordForEmail lança em vez de devolver {error}: a mensagem é a mesma do erro genuíno (não pode existir uma TERCEIRA frase para uma causa igualmente desconhecida), nunca err.message cru", async () => {
    const { supabase, resetPassword } = await montar();
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    (
      supabase.auth.resetPasswordForEmail as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new Error('relation "auth.users" does not exist'));

    let resultado: Awaited<ReturnType<SnapshotReset["resetPassword"]>>;
    await act(async () => {
      resultado = await resetPassword("alguem@example.com");
    });

    expect(resultado!.success).toBe(false);
    expect(resultado!.message).not.toMatch(/does not exist/i);
    // Mesma frase do ramo "erro genuíno" (if (error), logo acima no código-
    // fonte) — a causa é igualmente desconhecida, então não pode ganhar uma
    // terceira frase inventada.
    expect(resultado!.message).toMatch(
      /não foi possível enviar o link de recuperação/i,
    );
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
