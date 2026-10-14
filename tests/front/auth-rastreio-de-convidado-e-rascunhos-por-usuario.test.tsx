// @vitest-environment jsdom
//
// L10 da auditoria de segurança (12/10/2026) — o que sobrevivia à saída da
// conta num aparelho compartilhado (tablet de balcão):
//
//   * `guest_tracked_orders` (sessionStorage): os pedidos que o comprador
//     achou por e-mail + código — dado dele, lido por `OrderDetailsView` até
//     para quem está logado. O logout apaga; e ENTRAR numa conta também (o
//     visitante sem conta nunca faz logout). Só quando o usuário MUDA: o
//     SIGNED_IN reemitido ao voltar à aba, com o mesmo usuário, não apaga.
//   * As FILAS offline e os RASCUNHOS do admin agora têm chave por usuário
//     (`<chave>:<uid>`): o logout NÃO os apaga — são escrita pendente e
//     trabalho em curso do dono, que os reencontra ao voltar. Apaga só os
//     rascunhos ANTIGOS (chave sem `:<uid>`), que nenhum código lê mais.
//
// Andaime: o MESMO de checkout-pedido-pendente-limpa-no-logout.test.tsx.
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RASTREIO = "guest_tracked_orders";

interface Snapshot {
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
  const ctx = useContext(authContext) as { logout: () => Promise<void> };
  aoAtualizar({ logout: ctx.logout });
  return null;
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

describe("rastreio de convidado e rascunhos — por usuário", () => {
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

  function encherAparelho() {
    sessionStorage.setItem(RASTREIO, '[{"id":"pedido-do-comprador"}]');
    // chaves POR USUÁRIO: ficam
    localStorage.setItem("orders_offline_updates_queue:user-a", "[1]");
    localStorage.setItem("products_offline_updates_queue:user-a", "[2]");
    localStorage.setItem("admin_banner_form_draft:user-a", '{"t":1}');
    localStorage.setItem("admin_pdv_venda_draft:user-a", '{"c":1}');
    localStorage.setItem("ikcous_product_form_draft:user-a", '{"p":1}');
    localStorage.setItem("ikcous_product_form_draft_edit_p1:user-a", '{"p":2}');
    // chaves ANTIGAS (sem dono): saem
    localStorage.setItem("admin_banner_form_draft", '{"t":0}');
    localStorage.setItem("admin_pdv_venda_draft", '{"cliente":"Maria"}');
    localStorage.setItem("ikcous_product_form_draft", '{"p":0}');
    localStorage.setItem("ikcous_product_form_draft_edit_p1", '{"p":0}');
  }

  function conferirLogout() {
    expect(sessionStorage.getItem(RASTREIO)).toBeNull();
    // Por usuário: ficam intactos para o dono reencontrar.
    for (const chave of [
      "orders_offline_updates_queue:user-a",
      "products_offline_updates_queue:user-a",
      "admin_banner_form_draft:user-a",
      "admin_pdv_venda_draft:user-a",
      "ikcous_product_form_draft:user-a",
      "ikcous_product_form_draft_edit_p1:user-a",
    ]) {
      expect(localStorage.getItem(chave), chave).not.toBeNull();
    }
    // Antigas: somem.
    for (const chave of [
      "admin_banner_form_draft",
      "admin_pdv_venda_draft",
      "ikcous_product_form_draft",
      "ikcous_product_form_draft_edit_p1",
    ]) {
      expect(localStorage.getItem(chave), chave).toBeNull();
    }
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

    return {
      entrar: async (uid: string) => {
        await act(async () => {
          callback("SIGNED_IN", sessaoDe(uid));
          await esperarMicrotarefas();
        });
      },
      sair: async () => {
        await act(async () => {
          callback("SIGNED_OUT", null);
          await esperarMicrotarefas();
        });
      },
      aoAtualizar,
    };
  }

  it("SIGNED_OUT apaga o rastreio do convidado e os rascunhos antigos; preserva filas e rascunhos por usuário", async () => {
    const { entrar, sair } = await montarLogado();
    await entrar("user-a");
    encherAparelho();

    await sair();

    conferirLogout();
  });

  it("logout() com signOut() falhando (rede caída) também apaga e também preserva", async () => {
    const { entrar, aoAtualizar } = await montarLogado();
    const { supabase } = await import("@/lib/supabase");
    await entrar("user-a");
    encherAparelho();
    (
      supabase.auth.signOut as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ error: { message: "Failed to fetch" } });

    const { logout } = aoAtualizar.mock.calls.at(-1)![0] as Snapshot;
    await act(async () => {
      await logout();
      await esperarMicrotarefas();
    });

    conferirLogout();
  });

  it("visitante que ENTRA numa conta (sem nunca ter feito logout) esquece o rastreio da aba", async () => {
    const { entrar } = await montarLogado();
    sessionStorage.setItem(RASTREIO, '[{"id":"pedido-do-visitante"}]');

    await entrar("user-a");

    expect(sessionStorage.getItem(RASTREIO)).toBeNull();
  });

  it("SIGNED_IN reemitido para o MESMO usuário (volta à aba) NÃO apaga o rastreio", async () => {
    const { entrar } = await montarLogado();
    await entrar("user-a");
    sessionStorage.setItem(RASTREIO, '[{"id":"consulta-em-andamento"}]');

    await entrar("user-a");

    expect(sessionStorage.getItem(RASTREIO)).not.toBeNull();
  });

  it("troca direta de conta (user-a -> user-b, sem SIGNED_OUT) esquece o rastreio e preserva as filas", async () => {
    const { entrar } = await montarLogado();
    await entrar("user-a");
    encherAparelho();

    await entrar("user-b");

    expect(sessionStorage.getItem(RASTREIO)).toBeNull();
    expect(localStorage.getItem("orders_offline_updates_queue:user-a")).toBe(
      "[1]",
    );
    expect(localStorage.getItem("admin_pdv_venda_draft:user-a")).toBe(
      '{"c":1}',
    );
  });

  it("sessionStorage bloqueado (modo privado): o logout não lança e ainda limpa o resto", async () => {
    const { entrar, sair } = await montarLogado();
    await entrar("user-a");
    encherAparelho();
    const bloqueado = () => {
      throw new DOMException("bloqueado", "SecurityError");
    };
    vi.stubGlobal("sessionStorage", {
      getItem: bloqueado,
      setItem: bloqueado,
      removeItem: bloqueado,
      clear: () => {},
      key: () => null,
      length: 0,
    });

    await sair();

    expect(localStorage.getItem("admin_pdv_venda_draft")).toBeNull();
    expect(localStorage.getItem("orders_offline_updates_queue:user-a")).toBe(
      "[1]",
    );
  });
});
