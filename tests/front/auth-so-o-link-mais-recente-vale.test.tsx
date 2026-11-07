// @vitest-environment jsdom
//
// "SÓ O E-MAIL MAIS RECENTE VALE" — a tela tem de dizer isso.
//
// Cada novo pedido de link (recuperação de senha ou confirmação de cadastro)
// troca o anterior no servidor: só o link do e-mail MAIS RECENTE funciona. A
// tela dizia que o link "expirou" e mandava pedir outro, e quem obedecia (menos
// de 1 minuto depois) caía na frase "Não foi possível enviar o link... tente
// novamente em instantes", que parece pane embora o e-mail bom já estivesse na
// caixa de entrada. Quem pedia 3 ou 4 links desistia.
//
// As frases são estáticas e iguais para qualquer endereço: não revelam se a
// conta existe (#120) nem ecoam o texto do servidor.
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
            Promise.resolve({ data: null, error: { message: "não usado" } }),
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
  resetPassword: (
    email: string,
  ) => Promise<{ success: boolean; message: string }>;
  resendConfirmationEmail: (email: string) => Promise<boolean>;
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function botaoQueComeca(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.trim().startsWith(texto),
  ) as HTMLButtonElement | undefined;
}

const LEMBRETE = /e-mail mais recente/i;

describe("só o e-mail mais recente vale", () => {
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

  async function montarComEndereco(endereco: string, comTela = true) {
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
        resetPassword: ctx.resetPassword,
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
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return {
      supabase,
      estado: () => aoAtualizar.mock.calls.at(-1)?.[0] as Estado,
    };
  }

  it("link de RECUPERAÇÃO vencido: diz que só vale o e-mail mais recente e ainda manda pedir outro", async () => {
    await montarComEndereco(
      "/auth?type=recovery#error=access_denied&error_code=otp_expired&error_description=x",
    );

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Este link expirou ou já foi usado.");
    expect(texto).toMatch(LEMBRETE);
    expect(texto).toMatch(/peça um novo abaixo/i);
  });

  it("link de CONFIRMAÇÃO vencido: mantém a frase de sempre e acrescenta o lembrete", async () => {
    await montarComEndereco(
      "/#error=access_denied&error_code=otp_expired&error_description=x",
    );

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain(
      "Esse link já foi usado ou venceu. Se você já confirmou seu cadastro, é só entrar.",
    );
    expect(texto).toMatch(
      /se pediu mais de um e-mail, vale só o mais recente/i,
    );
  });

  it("tela 'Verifique seu e-mail' da recuperação: avisa que pedir de novo invalida o anterior", async () => {
    const { supabase } = await montarComEndereco("/auth");
    (
      supabase.auth.resetPasswordForEmail as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: {}, error: null });

    await act(async () => botaoQueComeca("Esqueceu?")!.click());
    await act(async () => digitar("email", "maria@example.com"));
    await act(async () => botaoQueComeca("SOLICITAR LINK")!.click());

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Verifique seu e-mail");
    expect(texto).toMatch(/use só o e-mail mais recente/i);
    expect(texto).toMatch(/anteriores deixam de valer/i);
  });

  it("pedido recusado (limite do servidor): a frase lembra do e-mail mais recente e NÃO ecoa o texto do servidor", async () => {
    const { supabase, estado } = await montarComEndereco("/auth", false);
    (
      supabase.auth.resetPasswordForEmail as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      data: {},
      error: {
        message:
          "For security purposes, you can only request this after 37 seconds.",
        status: 429,
        code: "over_email_send_rate_limit",
      },
    });

    let resultado: Awaited<ReturnType<Estado["resetPassword"]>> | undefined;
    await act(async () => {
      resultado = await estado().resetPassword("maria@example.com");
    });

    expect(resultado?.success).toBe(false);
    expect(resultado?.message).toMatch(LEMBRETE);
    expect(resultado?.message).toMatch(/spam/i);
    expect(resultado?.message).not.toMatch(/security purposes|37|seconds/i);
  });

  it("exceção no pedido (rede) dá a MESMA frase do erro do servidor: nada distingue conta cadastrada de não cadastrada", async () => {
    const { supabase, estado } = await montarComEndereco("/auth", false);
    const mock = supabase.auth.resetPasswordForEmail as unknown as ReturnType<
      typeof vi.fn
    >;
    mock.mockResolvedValueOnce({
      data: {},
      error: { message: "x", status: 500 },
    });
    mock.mockRejectedValueOnce(new Error("detalhe interno do banco"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    let doErro: Awaited<ReturnType<Estado["resetPassword"]>> | undefined;
    let daExcecao: Awaited<ReturnType<Estado["resetPassword"]>> | undefined;
    await act(async () => {
      doErro = await estado().resetPassword("a@example.com");
      daExcecao = await estado().resetPassword("b@example.com");
    });

    expect(doErro?.message).toMatch(LEMBRETE);
    expect(daExcecao?.message).toBe(doErro?.message);
    expect(daExcecao?.message).not.toMatch(/banco|detalhe/i);
  });

  it("reenvio da confirmação, sucesso: lembra que vale só o e-mail mais recente", async () => {
    const { supabase, estado } = await montarComEndereco("/", false);
    (
      supabase.auth.resend as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: {}, error: null });

    await act(async () => {
      await estado().resendConfirmationEmail("a@example.com");
    });

    const aviso = String(vi.mocked(toast.success).mock.calls[0]?.[0]);
    expect(aviso).toMatch(/^Se este e-?mail ainda aguarda confirmação/i);
    expect(aviso).toMatch(/mais recente/i);
  });

  it("reenvio da confirmação, limite do servidor: lembra do e-mail mais recente", async () => {
    const { supabase, estado } = await montarComEndereco("/", false);
    (
      supabase.auth.resend as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      data: {},
      error: { message: "x", status: 429, code: "over_email_send_rate_limit" },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await act(async () => {
      await estado().resendConfirmationEmail("a@example.com");
    });

    const aviso = String(vi.mocked(toast.error).mock.calls[0]?.[0]);
    expect(aviso).toMatch(/Muitas tentativas/);
    expect(aviso).toMatch(/mais recente/i);
  });
});
