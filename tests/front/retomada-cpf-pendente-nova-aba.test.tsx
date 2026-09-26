// @vitest-environment jsdom
//
// O CPF MORA NA CONTA (23/09/2026) — RETOMADA EM NOVA ABA. O cenário real:
// o link de confirmação de e-mail abre uma aba NOVA (Android), sem
// nenhum estado em memória da aba do cadastro — só o `localStorage`
// (compartilhado entre abas) carrega o pendente. Este arquivo renderiza o
// `AuthProvider` REAL, sem nenhuma aba anterior, e dispara os eventos do
// listener de auth diretamente (é o mesmo listener que dispara em
// SIGNED_IN/INITIAL_SESSION de verdade) para prová-lo.
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
    },
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    })),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CPF_DIGITOS = "52998224725";
const CHAVE_PENDENTE = "ikcous:cpf-pendente-cadastro";
const USER_ID = "user-1";
const EMAIL = "cliente@example.com";

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

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function gravarPendente(armazem: ReturnType<typeof criarLocalStorageFake>) {
  armazem.setItem(
    CHAVE_PENDENTE,
    JSON.stringify({
      v: 1,
      userId: USER_ID,
      email: EMAIL,
      cpf: CPF_DIGITOS,
      expiraEm: Date.now() + 60_000,
    }),
  );
}

function sessaoFake(userId: string, email: string) {
  return { user: { id: userId, email } } as any;
}

/** `supabase.rpc` também é chamado por `fetchProfile`/`checkAdmin` no
 * mesmo evento SIGNED_IN — contar só as chamadas de `set_my_cpf`. */
function chamadasDeSetMyCpf(rpc: ReturnType<typeof vi.fn>): number {
  return rpc.mock.calls.filter(([nome]) => nome === "set_my_cpf").length;
}

describe("Retomada do CPF pendente — nova aba, sem estado em memória", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: ReturnType<typeof criarLocalStorageFake>;
  let callbackDoListener: ((event: string, session: unknown) => void) | null;

  beforeEach(() => {
    vi.resetAllMocks();
    armazem = criarLocalStorageFake();
    vi.stubGlobal("localStorage", armazem);
    callbackDoListener = null;
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

  async function montarProvider() {
    const { AuthProvider } = await import("@/contexts/AuthContext");
    const { supabase } = await import("@/lib/supabase");

    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { session: null }, error: null });
    (
      supabase.auth.onAuthStateChange as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation((cb: (e: string, s: unknown) => void) => {
      callbackDoListener = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    // Default para as chamadas que NÃO são o foco do teste (`fetchProfile`
    // via `get_my_complete_profile`, `checkAdmin` via `is_admin`) — cada
    // teste sobrescreve `set_my_cpf` por cima quando precisa.
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: null,
    });

    await act(async () => {
      raiz.render(
        <AuthProvider>
          <div />
        </AuthProvider>,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    return { supabase };
  }

  it("pendente VENCIDO some ao abrir o app mesmo SEM sessão nenhuma (aparelho compartilhado onde ninguém volta a entrar) — revisão de segurança 23/09", async () => {
    armazem.setItem(
      CHAVE_PENDENTE,
      JSON.stringify({
        v: 1,
        userId: USER_ID,
        email: EMAIL,
        cpf: CPF_DIGITOS,
        expiraEm: Date.now() - 1,
      }),
    );
    const { supabase } = await montarProvider();

    expect(armazem.getItem(CHAVE_PENDENTE)).toBeNull();
    expect(
      chamadasDeSetMyCpf(supabase.rpc as unknown as ReturnType<typeof vi.fn>),
    ).toBe(0);
  });

  it("pendente DENTRO do prazo continua guardado ao abrir o app sem sessão (espera o login confirmado)", async () => {
    gravarPendente(armazem);
    await montarProvider();

    expect(armazem.getItem(CHAVE_PENDENTE)).not.toBeNull();
  });

  it("SIGNED_IN do mesmo usuário: uma chamada set_my_cpf, e o pendente some", async () => {
    gravarPendente(armazem);
    const { supabase } = await montarProvider();
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: null,
    });

    await act(async () => {
      callbackDoListener!("SIGNED_IN", sessaoFake(USER_ID, EMAIL));
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(supabase.rpc).toHaveBeenCalledWith("set_my_cpf", {
      p_cpf: CPF_DIGITOS,
    });
    expect(
      chamadasDeSetMyCpf(supabase.rpc as unknown as ReturnType<typeof vi.fn>),
    ).toBe(1);
    expect(armazem.getItem(CHAVE_PENDENTE)).toBeNull();
  });

  it("SIGNED_IN + INITIAL_SESSION duplicados (mesmo usuário): só UMA chamada set_my_cpf", async () => {
    gravarPendente(armazem);
    const { supabase } = await montarProvider();
    let resolverRpc!: (v: unknown) => void;
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => {
        resolverRpc = resolve;
      }),
    );

    await act(async () => {
      callbackDoListener!("SIGNED_IN", sessaoFake(USER_ID, EMAIL));
      callbackDoListener!("INITIAL_SESSION", sessaoFake(USER_ID, EMAIL));
      await esperarMicrotarefas();
      resolverRpc({ data: null, error: null });
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(
      chamadasDeSetMyCpf(supabase.rpc as unknown as ReturnType<typeof vi.fn>),
    ).toBe(1);
    expect(armazem.getItem(CHAVE_PENDENTE)).toBeNull();
  });

  it("sessão de OUTRA conta: remove o pendente sem chamar a RPC", async () => {
    gravarPendente(armazem);
    const { supabase } = await montarProvider();

    await act(async () => {
      callbackDoListener!(
        "SIGNED_IN",
        sessaoFake("outro-user", "outro@example.com"),
      );
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(supabase.rpc).not.toHaveBeenCalledWith(
      "set_my_cpf",
      expect.anything(),
    );
    expect(armazem.getItem(CHAVE_PENDENTE)).toBeNull();
  });

  it("sem pendente algum: SIGNED_IN não toca a RPC de CPF", async () => {
    const { supabase } = await montarProvider();

    await act(async () => {
      callbackDoListener!("SIGNED_IN", sessaoFake(USER_ID, EMAIL));
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(supabase.rpc).not.toHaveBeenCalledWith(
      "set_my_cpf",
      expect.anything(),
    );
  });
});
