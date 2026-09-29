// @vitest-environment jsdom
//
// O CPF MORA NA CONTA (23/09/2026) — CADASTRO. Prova o contrato ponta a
// ponta (AuthView + AuthContext.signUp REAIS, mesmo padrão de
// auth-view-toast-e-inline-concordam.test.tsx): CPF é OPCIONAL, NUNCA vai
// em `options.data` (user_metadata), e a persistência segue o CAMINHO
// CERTO conforme o `signUp` devolve sessão ou não.
import { act } from "react";
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

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeCity: "Sao Paulo", storeState: "SP" },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CPF_MASCARADO = "529.982.247-25";
const CPF_DIGITOS = "52998224725";
const CHAVE_PENDENTE = "ikcous:cpf-pendente-cadastro";

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
    mapaCru: armazem,
  };
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

function botao(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("Cadastro — CPF opcional (o CPF mora na conta)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: ReturnType<typeof criarLocalStorageFake>;

  beforeEach(() => {
    vi.resetAllMocks();
    armazem = criarLocalStorageFake();
    vi.stubGlobal("localStorage", armazem);
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

  async function montarNoCadastro() {
    const { AuthProvider } = await import("@/contexts/AuthContext");
    const { AuthView } = await import("@/views/shared/AuthView");
    const { supabase } = await import("@/lib/supabase");

    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { session: null }, error: null });
    (
      supabase.auth.onAuthStateChange as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });

    const onNavigate = vi.fn();
    await act(async () => {
      raiz.render(
        <AuthProvider>
          <AuthView onNavigate={onNavigate} />
        </AuthProvider>,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // Vai para o modo cadastro (o botão de alternância mostra "CADASTRO"
    // no modo login).
    const paraCadastro = botao("CADASTRO");
    await act(async () => {
      paraCadastro?.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    return { supabase };
  }

  async function preencherCadastroBasico() {
    await act(async () => {
      digitar("fullName", "Maria Teste");
    });
    await act(async () => {
      digitar("phone", "34999998888");
    });
    await act(async () => {
      digitar("email", "cliente@example.com");
    });
    await act(async () => {
      digitar("password", "senha-forte-123");
    });
  }

  it("CPF vazio: cadastro normal, sem RPC de CPF e sem pendente criado", async () => {
    const { supabase } = await montarNoCadastro();
    (
      supabase.auth.signUp as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      data: {
        user: { id: "user-1", email: "cliente@example.com" },
        session: null,
      },
      error: null,
    });

    await preencherCadastroBasico();
    const finalizar = botao("FINALIZAR REGISTRO")!;
    await act(async () => {
      finalizar.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    const chamadaSignUp = (
      supabase.auth.signUp as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(chamadaSignUp.options.data).not.toHaveProperty("cpf");
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      "set_my_cpf",
      expect.anything(),
    );
    expect(armazem.getItem(CHAVE_PENDENTE)).toBeNull();
  });

  it("CPF preenchido e INVÁLIDO: erro no campo, nunca chama signUp", async () => {
    const { supabase } = await montarNoCadastro();
    await preencherCadastroBasico();
    await act(async () => {
      digitar("cpf", "111.111.111-11");
    });

    const finalizar = botao("FINALIZAR REGISTRO")!;
    await act(async () => {
      finalizar.click();
      await esperarMicrotarefas();
    });

    expect(supabase.auth.signUp).not.toHaveBeenCalled();
    expect(document.getElementById("cpf")?.getAttribute("aria-invalid")).toBe(
      "true",
    );
  });

  it("sessão IMEDIATA (signUp devolve session): grava na hora (set_my_cpf) e NÃO cria pendente", async () => {
    const { supabase } = await montarNoCadastro();
    (
      supabase.auth.signUp as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      data: {
        user: { id: "user-1", email: "cliente@example.com" },
        session: { user: { id: "user-1" } },
      },
      error: null,
    });
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: null,
    });

    await preencherCadastroBasico();
    await act(async () => {
      digitar("cpf", CPF_MASCARADO);
    });
    const finalizar = botao("FINALIZAR REGISTRO")!;
    await act(async () => {
      finalizar.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(supabase.rpc).toHaveBeenCalledWith("set_my_cpf", {
      p_cpf: CPF_DIGITOS,
    });
    expect(armazem.getItem(CHAVE_PENDENTE)).toBeNull();
  });

  it("SEM sessão (confirmação por e-mail pendente): cria o pendente (chave exclusiva) e NÃO chama set_my_cpf", async () => {
    const { supabase } = await montarNoCadastro();
    (
      supabase.auth.signUp as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      data: {
        user: { id: "user-1", email: "cliente@example.com" },
        session: null,
      },
      error: null,
    });

    await preencherCadastroBasico();
    await act(async () => {
      digitar("cpf", CPF_MASCARADO);
    });
    const finalizar = botao("FINALIZAR REGISTRO")!;
    await act(async () => {
      finalizar.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(supabase.rpc).not.toHaveBeenCalledWith(
      "set_my_cpf",
      expect.anything(),
    );
    const bruto = armazem.getItem(CHAVE_PENDENTE);
    expect(bruto).not.toBeNull();
    const registro = JSON.parse(bruto!);
    expect(registro.userId).toBe("user-1");
    expect(registro.email).toBe("cliente@example.com");
    expect(registro.cpf).toBe(CPF_DIGITOS);
    // Só a chave exclusiva recebe o CPF — nenhuma outra.
    expect(armazem.length).toBe(1);
  });
});
