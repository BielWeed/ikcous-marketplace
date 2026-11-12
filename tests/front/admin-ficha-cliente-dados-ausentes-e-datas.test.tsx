// @vitest-environment jsdom
//
// Ficha do cliente no painel: dado ausente aparecia como "N/A" (inglês) e a
// data era escrita de quatro jeitos ("07 de fev, 2026", "10 ago 26",
// "10 agosto, 26" e "07/02/2026"). Agora: "Não informado" para e-mail e
// WhatsApp, "—" para a data que falta, e uma só forma de escrever a data
// (dd/MM/aaaa, a mesma do cartão da lista de Clientes). No carrinho, o produto
// que sumiu do catálogo diz "Excluído" (não "Deletado", palavra que o resto do
// painel não usa).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { AdminUserDetailView as TipoTelaFicha } from "@/views/admin/AdminUserDetailView";

const { estado } = vi.hoisted(() => ({
  estado: {
    profile: {} as Record<string, unknown>,
    carrinho: [] as unknown[],
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "admin-1" } }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () =>
      Promise.resolve({
        data: {
          profile: estado.profile,
          orders: [
            {
              id: "pedido-1",
              status: "delivered",
              total: 100,
              payment_status: "pago",
              created_at: "2026-08-11T02:30:00Z",
            },
          ],
          cart_items: estado.carrinho,
          addresses: [],
        },
        error: null,
      }),
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: [], error: null }),
      }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let TelaFicha: typeof TipoTelaFicha;

beforeAll(async () => {
  ({ AdminUserDetailView: TelaFicha } = await import(
    "@/views/admin/AdminUserDetailView"
  ));
});

describe("AdminUserDetailView — dado ausente e datas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estado.carrinho = [];
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

  async function abrirFicha() {
    await act(async () => {
      raiz.render(
        <TelaFicha userId="cliente-1" onBack={vi.fn()} onNavigate={vi.fn()} />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    return hospedeiro.textContent ?? "";
  }

  it("sem e-mail, WhatsApp e data de cadastro: 'Não informado' e '—', nunca 'N/A'", async () => {
    estado.profile = {
      id: "cliente-1",
      full_name: "Cliente de Prova",
      role: "customer",
    };
    const texto = await abrirFicha();
    expect(texto).not.toContain("N/A");
    expect(texto).toContain("Cliente desde —");
    expect(texto.match(/Não informado/g)).toHaveLength(2);
  });

  it("o rótulo é 'E-mail', como no resto do painel", async () => {
    estado.profile = {
      id: "cliente-1",
      full_name: "Cliente de Prova",
      role: "customer",
      email: "prova@exemplo.com",
    };
    const texto = await abrirFicha();
    expect(texto).toContain("E-mail");
    expect(texto).not.toMatch(/(^|[^-])Email/);
  });

  it("toda data da ficha sai em dd/MM/aaaa", async () => {
    estado.profile = {
      id: "cliente-1",
      full_name: "Cliente de Prova",
      role: "customer",
      created_at: "2026-02-08T02:30:00Z",
      email: "prova@exemplo.com",
      whatsapp: "34999999999",
    };
    const texto = await abrirFicha();
    expect(texto).toContain("Cliente desde 07/02/2026");
    // Última compra (cartão do resumo) e linha do extrato: o mesmo pedido.
    expect(texto.match(/10\/08\/2026/g)?.length).toBeGreaterThanOrEqual(2);
    expect(texto).not.toMatch(/10 ago|07 de fev/i);
  });

  it("produto do carrinho que sumiu do catálogo diz 'Excluído', não 'Deletado'", async () => {
    estado.profile = {
      id: "cliente-1",
      full_name: "Cliente de Prova",
      role: "customer",
    };
    estado.carrinho = [{ product_id: "produto-sumido", quantity: 1 }];
    await abrirFicha();
    const aba = [...hospedeiro.querySelectorAll("button, [role='tab']")].find(
      (b) => b.textContent?.trim().startsWith("Carrinho("),
    );
    expect(aba).toBeDefined();
    await act(async () => {
      (aba as HTMLElement).dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      );
      (aba as HTMLElement).click();
    });
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Produto Indisponível / Excluído");
    expect(texto).not.toContain("Deletado");
  });
});
