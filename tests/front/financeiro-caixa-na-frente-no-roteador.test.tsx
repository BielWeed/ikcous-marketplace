// @vitest-environment jsdom
//
// Financeiro — a costura do roteador com a aba inicial (24/10/2026).
// `onNavigate("admin-financeiro", "caixa")` (a linha "Caixa" do Início) chega à
// `AdminArea` como `selectedProductId` — o `id` genérico do roteador, que o App
// guarda para qualquer tela — e a `AdminArea` o entrega à tela como `abaInicial`.
// O App NÃO muda: este teste prova a ponta que muda (AdminArea → tela), e que um
// id que não é aba (lixo, aba inexistente, vazio) abre a Visão como sempre.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => true }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-1" },
    session: { user: { id: "admin-1" } },
    isAdmin: true,
    adminStatus: "admin",
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" }, products: [] }),
}));
vi.mock("@/components/admin/financeiro/FluxoDeCaixaGrafico", () => ({
  FluxoDeCaixaGrafico: () => null,
}));
// O menu e a barra do painel não fazem parte do que se prova aqui.
vi.mock("@/components/layouts/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AdminArea entrega o id do roteador à tela do Financeiro como aba inicial", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    rpcFalso.mockReset();
    rpcFalso.mockImplementation(async (nome: string) => ({
      data: nome === "fin_caixa_atual" ? null : nome === "fin_resumo" ? {} : [],
      error: null,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    localStorage.clear();
  });

  async function abrir(selectedProductId: string | null) {
    const { AdminArea } = await import("@/components/layouts/AdminArea");
    await act(async () => {
      raiz.render(
        <AdminArea
          currentView="admin-financeiro"
          onNavigate={vi.fn()}
          selectedProductId={selectedProductId}
          setIsAdminDirty={vi.fn()}
          setBackOverride={vi.fn()}
          handleAdminUserDetailBack={vi.fn()}
          backOverride={null}
          isTransitionSupported={false}
        />,
      );
    });
    // A tela vem por import dinâmico (lazy): espera as abas nascerem.
    for (
      let i = 0;
      i < 100 && !hospedeiro.querySelector('[role="tab"][data-state="active"]');
      i++
    ) {
      await act(async () => {
        await esperar(50);
      });
    }
    return hospedeiro.querySelector('[role="tab"][data-state="active"]')
      ?.textContent;
  }

  it("id 'caixa' abre na aba Caixa", async () => {
    expect(await abrir("caixa")).toBe("Caixa");
  });

  it.each([null, "", "contas", "CAIXA", "pedido-123"])(
    "id %j não é uma aba: abre na Visão, como sempre",
    async (id) => {
      expect(await abrir(id)).toBe("Visão");
    },
  );
});
