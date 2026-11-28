// @vitest-environment jsdom
//
// O RASCUNHO DO CHECKOUT (nome, WhatsApp, endereço completo, observações) mora
// no `sessionStorage` da aba (src/lib/rascunho-do-checkout.ts) e só era
// apagado no sucesso da compra. O "Sair" apagava o pedido pendente, o recibo e
// o rastreio, mas deixava o rascunho legível para quem usasse a mesma aba
// depois (aparelho compartilhado). Agora o logout apaga, nos dois caminhos de
// saída (`SIGNED_OUT` e o `logout()` com o `signOut()` falhando). Controle: o
// que não é dado da conta (preferência de tema) continua.
//
// Andaime: o MESMO de checkout-recibo-limpa-no-logout.test.tsx.
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  guardarPedidoSemResposta,
  lerPedidoSemResposta,
} from "@/lib/pedido-sem-resposta";
import {
  lerRascunhoDoCheckout,
  rascunhoVazio,
  salvarRascunhoDoCheckout,
} from "@/lib/rascunho-do-checkout";

const CHAVE_DO_RASCUNHO = "ikcous-rascunho-do-checkout-v1";
const CHAVE_DO_TEMA = "theme";
const CHAVE_DO_PEDIDO_SEM_RESPOSTA = "ikcous-pedido-sem-resposta-v1";

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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Snapshot {
  userId: string | null;
  logout: () => Promise<void>;
}

type AuthChangeCallback = (
  event: string,
  session: unknown,
) => void | Promise<void>;

function Sonda({
  authContext,
  aoAtualizar,
}: {
  readonly authContext: React.Context<any>;
  readonly aoAtualizar: (snapshot: Snapshot) => void;
}) {
  const ctx = useContext(authContext) as {
    user: { id: string } | null;
    logout: () => Promise<void>;
  };
  aoAtualizar({
    userId: ctx.user?.id ?? null,
    logout: ctx.logout,
  });
  return null;
}

function ultimoEstado(
  aoAtualizar: ReturnType<typeof vi.fn>,
): Snapshot | undefined {
  return aoAtualizar.mock.calls.at(-1)?.[0];
}

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function criarArmazemFake() {
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

function sessaoDe(userId: string) {
  return {
    user: { id: userId, app_metadata: {} },
    access_token: `tok-${userId}`,
  };
}

describe("rascunho do checkout — limpo no logout", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("localStorage", criarArmazemFake());
    vi.stubGlobal("sessionStorage", criarArmazemFake());
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

  function guardarRascunhoDeCliente() {
    salvarRascunhoDoCheckout(globalThis.sessionStorage, {
      ...rascunhoVazio(),
      nome: "Cliente Teste",
      whatsapp: "11999990000",
      cep: "01001000",
      rua: "Rua de Teste",
      numero: "10",
      notas: "deixar com o porteiro",
      contaDosDados: "user-a",
    });
    guardarPedidoSemResposta({
      orderData: {
        idempotencyKey: "compra-convidado-teste",
        items: [],
        customer: { name: "Cliente Teste" },
        addressData: { street: "Rua de Teste", number: "10" },
      },
      ehOnline: false,
      metodoOnline: "pix",
      itens: [],
      valor: 200,
      cpfParaRpc: undefined,
      contaEsperada: null,
      semConta: true,
    });
    expect(lerPedidoSemResposta(null)?.orderData.customer).toEqual({
      name: "Cliente Teste",
    });
    globalThis.localStorage.setItem(CHAVE_DO_TEMA, "dark");
    expect(lerRascunhoDoCheckout(globalThis.sessionStorage)?.nome).toBe(
      "Cliente Teste",
    );
  }

  async function montarLogado() {
    vi.resetModules();
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    const { supabase } = await import("@/lib/supabase");

    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { session: null }, error: null });
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: null,
    });

    let callback: AuthChangeCallback = () => {};
    (
      supabase.auth.onAuthStateChange as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation((cb: AuthChangeCallback) => {
      callback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    const aoAtualizar = vi.fn();
    await act(async () => {
      raiz.render(
        <AuthProvider>
          <Sonda authContext={AuthContext} aoAtualizar={aoAtualizar} />
        </AuthProvider>,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      callback("SIGNED_IN", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });

    return { callback: () => callback, aoAtualizar };
  }

  it("SIGNED_OUT apaga o rascunho do checkout e mantém o tema", async () => {
    const { callback, aoAtualizar } = await montarLogado();
    expect(ultimoEstado(aoAtualizar)?.userId).toBe("user-a");
    guardarRascunhoDeCliente();

    const cb = callback();
    await act(async () => {
      cb("SIGNED_OUT", null);
      await esperarMicrotarefas();
    });

    expect(globalThis.sessionStorage.getItem(CHAVE_DO_RASCUNHO)).toBeNull();
    expect(
      globalThis.sessionStorage.getItem(CHAVE_DO_PEDIDO_SEM_RESPOSTA),
    ).toBeNull();
    expect(globalThis.localStorage.getItem(CHAVE_DO_TEMA)).toBe("dark");
  });

  it("logout() com signOut() falhando (rede caída) também apaga o rascunho", async () => {
    const { aoAtualizar } = await montarLogado();
    const { supabase } = await import("@/lib/supabase");
    guardarRascunhoDeCliente();
    (
      supabase.auth.signOut as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ error: { message: "Failed to fetch" } });

    const estado = ultimoEstado(aoAtualizar)!;
    await act(async () => {
      await estado.logout();
      await esperarMicrotarefas();
    });

    expect(globalThis.sessionStorage.getItem(CHAVE_DO_RASCUNHO)).toBeNull();
    expect(
      globalThis.sessionStorage.getItem(CHAVE_DO_PEDIDO_SEM_RESPOSTA),
    ).toBeNull();
    expect(globalThis.localStorage.getItem(CHAVE_DO_TEMA)).toBe("dark");
  });
});
