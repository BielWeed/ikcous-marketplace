// @vitest-environment jsdom
//
// Dois defeitos de AuthContext + AuthView ligados ao e-mail de acesso:
//
// A) Link de "esqueci a senha" VENCIDO ou já usado (o Outlook/Hotmail costuma
//    gastar o link antes da pessoa) volta para o app com o erro no fim do
//    endereço, e o `?type=recovery` continua lá. O app olhava só o `type` e
//    abria a tela "Nova Senha", que nunca funciona: a pessoa digitava a senha e
//    lia "Não foi possível atualizar sua senha" sem saber que o link venceu.
//    Agora, com `error_code` no endereço (no hash OU na query), o app NÃO entra
//    em modo nova senha: abre a tela "Recuperar" com o aviso "Este link expirou
//    ou já foi usado. Peça um novo abaixo." e limpa o erro do endereço. O
//    caminho que funciona (sem `error_code`) fica idêntico.
//
// B) "Reenviar link" afirmava "E-mail de confirmação reenviado!", mas o
//    servidor responde sucesso FALSO (sem e-mail) quando o endereço já está
//    confirmado. O aviso vira condicional.
//
// RENDER DE VERDADE: AuthProvider real (supabase dublado) + AuthView real.
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
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
  resendConfirmationEmail: (email: string) => Promise<boolean>;
}

describe("AuthContext + AuthView — link de recuperação vencido e reenvio condicional", () => {
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

  describe("A) link de recuperação", () => {
    it("caminho que funciona: '?type=recovery' sem erro entra em nova senha, como antes", async () => {
      const { estado } = await montarComEndereco("/auth?type=recovery", true);

      expect(estado().isPasswordRecovery).toBe(true);
      expect(estado().linkDeRecuperacaoVencido).toBe(false);
      expect(hospedeiro.textContent).toContain("Nova Senha");
      expect(hospedeiro.textContent).not.toContain("expirou");
    });

    it("caminho que funciona: '#type=recovery' (no hash) também entra em nova senha", async () => {
      const { estado } = await montarComEndereco(
        "/auth#access_token=abc&type=recovery",
        true,
      );

      expect(estado().isPasswordRecovery).toBe(true);
      expect(estado().linkDeRecuperacaoVencido).toBe(false);
      expect(hospedeiro.textContent).toContain("Nova Senha");
    });

    it("erro no hash (otp_expired): NÃO entra em nova senha; abre 'Recuperar' com o aviso", async () => {
      const { estado } = await montarComEndereco(
        "/auth?type=recovery#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
        true,
      );

      expect(estado().isPasswordRecovery).toBe(false);
      expect(hospedeiro.textContent).not.toContain("Nova Senha");
      expect(hospedeiro.textContent).not.toContain("ATUALIZAR SENHA");
      expect(hospedeiro.textContent).toContain("Recuperar");
      expect(hospedeiro.textContent).toContain("SOLICITAR LINK");
      expect(hospedeiro.textContent).toContain(
        "Este link expirou ou já foi usado. Peça um novo abaixo.",
      );
    });

    it("erro na query (error_code=otp_expired): mesmo tratamento", async () => {
      const { estado } = await montarComEndereco(
        "/auth?type=recovery&error=access_denied&error_code=otp_expired",
        true,
      );

      expect(estado().isPasswordRecovery).toBe(false);
      expect(hospedeiro.textContent).toContain("SOLICITAR LINK");
      expect(hospedeiro.textContent).toContain("Este link expirou");
    });

    it("limpa o erro do endereço (e o type) depois de usar", async () => {
      await montarComEndereco(
        "/auth?type=recovery#error=access_denied&error_code=otp_expired&error_description=x",
        true,
      );

      expect(window.location.pathname).toBe("/auth");
      expect(window.location.hash).not.toContain("error");
      expect(window.location.search).not.toContain("type=recovery");
      expect(window.location.search).not.toContain("error");
    });

    it("o aviso sobrevive a quem digita o e-mail e some depois de pedir o novo link", async () => {
      const { supabase } = await montarComEndereco(
        "/auth?type=recovery#error_code=otp_expired",
        true,
      );
      (
        supabase.auth.resetPasswordForEmail as unknown as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue({ data: {}, error: null });

      const campo = document.getElementById("email") as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        globalThis.HTMLInputElement.prototype,
        "value",
      )?.set;
      await act(async () => {
        setter?.call(campo, "pessoa@example.com");
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(hospedeiro.textContent).toContain("Este link expirou");

      const botao = [...document.body.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("SOLICITAR LINK"),
      ) as HTMLButtonElement;
      await act(async () => {
        botao.click();
        await esperarMicrotarefas();
        await esperarMicrotarefas();
      });

      expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
      expect(hospedeiro.textContent).not.toContain("Este link expirou");
    });

    it("endereço comum (sem type nem erro): nada muda", async () => {
      const { estado } = await montarComEndereco("/auth", true);

      expect(estado().isPasswordRecovery).toBe(false);
      expect(estado().linkDeRecuperacaoVencido).toBe(false);
      expect(hospedeiro.textContent).toContain("ENTRAR AGORA");
      expect(hospedeiro.textContent).not.toContain("expirou");
    });
  });

  describe("B) reenvio do e-mail de confirmação", () => {
    it("o aviso de sucesso é condicional e não afirma 'reenviado'", async () => {
      const { supabase, estado } = await montarComEndereco("/");
      (
        supabase.auth.resend as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ data: {}, error: null });

      let resultado: boolean | undefined;
      await act(async () => {
        resultado = await estado().resendConfirmationEmail("a@example.com");
      });

      expect(resultado).toBe(true);
      expect(toast.success).toHaveBeenCalledTimes(1);
      const aviso = String(vi.mocked(toast.success).mock.calls[0]?.[0]);
      expect(aviso).not.toBe("E-mail de confirmação reenviado!");
      expect(aviso).toMatch(/^Se este e-?mail ainda aguarda confirmação/i);
      expect(aviso).toMatch(/se você já tem conta/i);
    });

    it("limite: erro do servidor continua dando o toast de erro (e nenhum de sucesso)", async () => {
      const { supabase, estado } = await montarComEndereco("/");
      (
        supabase.auth.resend as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        data: {},
        error: { message: "boom", status: 500, code: "unexpected_failure" },
      });

      let resultado: boolean | undefined;
      await act(async () => {
        resultado = await estado().resendConfirmationEmail("a@example.com");
      });

      expect(resultado).toBe(false);
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledTimes(1);
    });
  });
});
