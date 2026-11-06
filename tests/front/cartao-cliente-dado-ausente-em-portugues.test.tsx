// @vitest-environment jsdom
//
// Cartão do cliente na lista do painel: e-mail ausente aparecia como "N/A"
// (inglês) e a última compra ausente como "--". Agora: "Não informado" e o
// mesmo traço "—" do resto do painel.
import { CartaoCliente } from "@/components/admin/users/CartaoCliente";
import type { Customer } from "@/utils/admin_cache";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function cliente(sobrescreve: Partial<Customer>): Customer {
  return {
    id: "c-1",
    full_name: "Maria Souza",
    email: "maria@exemplo.com",
    phone: null,
    role: "customer",
    created_at: "2026-02-07T12:00:00Z",
    orders_count: 0,
    total_spent: 0,
    ...sobrescreve,
  };
}

describe("CartaoCliente — dado ausente", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function mostrar(c: Customer) {
    await act(async () => {
      raiz.render(
        <CartaoCliente
          customer={c}
          detalhado={true}
          onNavigate={vi.fn()}
          onPrefetch={vi.fn()}
        />,
      );
    });
    return hospedeiro.textContent ?? "";
  }

  it("sem e-mail e sem compra: 'Não informado' e '—', nunca 'N/A' nem '--'", async () => {
    const texto = await mostrar(
      cliente({ email: null as unknown as string, last_order_date: undefined }),
    );
    expect(texto).toContain("Não informado");
    expect(texto).not.toContain("N/A");
    expect(texto).not.toContain("--");
    expect(texto).toContain("—");
  });

  it("com os dados, mostra e-mail e datas em dd/MM/aaaa", async () => {
    const texto = await mostrar(
      cliente({ last_order_date: "2026-08-10T12:00:00Z" }),
    );
    expect(texto).toContain("maria@exemplo.com");
    expect(texto).toContain("Desde 07/02/2026");
    expect(texto).toContain("10/08/2026");
    expect(texto).not.toContain("Não informado");
  });
});
