// @vitest-environment jsdom
//
// Link de CONFIRMAÇÃO DE CADASTRO vencido ou já usado (o Outlook/Hotmail costuma
// gastar o link ao "conferir" a mensagem) volta ao app com o erro no fim do
// endereço (`#error=access_denied&error_code=otp_expired`) e SEM `type=recovery`
// (só o link de "esqueci a senha" leva esse tipo, ver `resetPassword`). O app
// olhava só o `error_code` e abria a tela "Recuperar senha": a pessoa que só
// queria confirmar o cadastro era mandada pedir a troca de uma senha que ela
// acabou de criar. Agora, sem `type=recovery`, o app abre a tela de ENTRAR com
// "Esse link já foi usado ou venceu. Se você já confirmou seu cadastro, é só
// entrar." O caso com `type=recovery` (auth-link-de-recuperacao-vencido-e-
// reenvio-condicional.test.tsx) segue como antes.
//
// RENDER DE VERDADE: AuthProvider real (supabase dublado) + AuthView real.
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      getUser: vi.fn(),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      resend: vi.fn(),
    },
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({
              data: null,
              error: { message: "não usado nestes testes" },
            }),
        }),
      }),
    })),
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeCity: "Sao Paulo", storeState: "SP" } }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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

interface Estado {
  isPasswordRecovery: boolean;
  linkDeRecuperacaoVencido: boolean;
  linkDeConfirmacaoVencido: boolean;
  resendConfirmationEmail: (email: string) => Promise<boolean>;
}

describe('AuthContext + AuthView — link de confirmação vencido não vira "Recuperar senha"', () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    window.history.replaceState({}, "", "/");
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
    window.history.replaceState({}, "", "/");
  });

  /** Monta o AuthProvider real com o endereço dado e uma sonda do contexto. */
  async function montarComEndereco(endereco: string, comTela = false) {
    window.history.replaceState({}, "", endereco);
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
    function Sonda() {
      const ctx = useContext(AuthContext) as unknown as Estado;
      aoAtualizar({
        isPasswordRecovery: ctx.isPasswordRecovery,
        linkDeRecuperacaoVencido: ctx.linkDeRecuperacaoVencido,
        linkDeConfirmacaoVencido: ctx.linkDeConfirmacaoVencido,
        resendConfirmationEmail: ctx.resendConfirmationEmail,
      } satisfies Estado);
      return null;
    }
    const { AuthView } = comTela
      ? await import("@/views/shared/AuthView")
      : { AuthView: null };

    await act(async () => {
      raiz.render(
        <AuthProvider>
          <Sonda />
          {AuthView ? <AuthView onNavigate={vi.fn()} /> : null}
        </AuthProvider>,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    return {
      supabase,
      estado: () => aoAtualizar.mock.calls.at(-1)?.[0] as Estado,
    };
  }

  const AVISO =
    "Esse link já foi usado ou venceu. Se você já confirmou seu cadastro, é só entrar.";

  it("erro no hash SEM type=recovery (link de confirmação): NÃO é link de recuperação; abre ENTRAR com o aviso certo", async () => {
    const { estado } = await montarComEndereco(
      "/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
      true,
    );

    expect(estado().linkDeRecuperacaoVencido).toBe(false);
    expect(estado().isPasswordRecovery).toBe(false);
    // Nada de "Recuperar senha": a pessoa só queria confirmar o cadastro.
    expect(hospedeiro.textContent).not.toContain("SOLICITAR LINK");
    expect(hospedeiro.textContent).not.toContain("Peça um novo abaixo");
    expect(hospedeiro.textContent).toContain("ENTRAR AGORA");
    expect(hospedeiro.textContent).toContain(AVISO);
  });

  it("erro na query SEM type=recovery: mesmo tratamento", async () => {
    const { estado } = await montarComEndereco(
      "/?error=access_denied&error_code=otp_expired",
      true,
    );

    expect(estado().linkDeRecuperacaoVencido).toBe(false);
    expect(hospedeiro.textContent).toContain("ENTRAR AGORA");
    expect(hospedeiro.textContent).toContain(AVISO);
  });

  it("limpa o erro do endereço depois de usar (um F5 não repete o aviso)", async () => {
    await montarComEndereco(
      "/#error=access_denied&error_code=otp_expired&error_description=x",
      true,
    );

    expect(window.location.hash).not.toContain("error");
    expect(window.location.search).not.toContain("error");
  });

  it("o aviso some quando a pessoa tenta entrar (não fica grudado na tela)", async () => {
    await montarComEndereco("/#error_code=otp_expired", true);
    expect(hospedeiro.textContent).toContain(AVISO);

    const form = hospedeiro.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await esperarMicrotarefas();
    });

    expect(hospedeiro.textContent).not.toContain(AVISO);
  });

  it("controle: COM type=recovery o link vencido continua sendo de recuperação (não ganha o aviso de confirmação)", async () => {
    const { estado } = await montarComEndereco(
      "/auth?type=recovery#error=access_denied&error_code=otp_expired",
      true,
    );

    // A tela devolve a bandeira assim que mostra o aviso (por isso aqui ela já
    // voltou a falso); o que prova a classificação é a tela que abriu.
    expect(estado().linkDeConfirmacaoVencido).toBe(false);
    expect(hospedeiro.textContent).toContain("SOLICITAR LINK");
    expect(hospedeiro.textContent).toContain("Este link expirou");
    expect(hospedeiro.textContent).not.toContain(AVISO);
  });

  it("controle: '#type=recovery' no hash junto do erro também é de recuperação", async () => {
    // Sem a tela montada, a bandeira fica como o contexto a classificou.
    const { estado } = await montarComEndereco(
      "/auth#error_code=otp_expired&type=recovery",
    );

    expect(estado().linkDeRecuperacaoVencido).toBe(true);
    expect(estado().linkDeConfirmacaoVencido).toBe(false);
  });

  it("controle: endereço comum (sem erro): nada muda", async () => {
    const { estado } = await montarComEndereco("/auth", true);

    expect(estado().linkDeRecuperacaoVencido).toBe(false);
    expect(estado().linkDeConfirmacaoVencido).toBe(false);
    expect(hospedeiro.textContent).not.toContain(AVISO);
  });
});
