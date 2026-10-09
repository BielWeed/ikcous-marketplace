// @vitest-environment jsdom
//
// Painel simples, onda F, tarefa F6 — "de onde vem" a lista de Clientes.
//
// Duas telas se chamam "Clientes" e listam gente diferente:
//   - Clientes (AdminCustomersView): contas do app (`get_admin_customers_paged`).
//     Quem comprou só no balcão NÃO está aqui — está em Relatórios › Clientes.
//   - Relatórios › Clientes (ClientesDoCrm): `crm_clientes`, que junta
//     compradores (app e balcão), `pediu_nao_pagou` e `nunca_comprou`.
// Cada tela agora diz isso em uma frase. A do CRM NÃO pode dizer "com conta no
// app" (seria falso: o balcão entra) nem prometer só "quem já comprou" (também
// entram quem pediu e não pagou e quem criou conta sem comprar).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () =>
      Promise.resolve({
        data: {
          data: [],
          total_count: 0,
          stats: {
            total_customers: 0,
            global_ltv: 0,
            global_orders: 0,
            new_customers_30d: 0,
          },
        },
        error: null,
      }),
    from: () => ({
      select: () => Promise.resolve({ data: [], error: null }),
    }),
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/utils/admin_cache", () => ({
  cachedCustomersData: null,
  setCachedCustomersData: vi.fn(),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja" } }),
}));
vi.mock("@/hooks/useCrm", () => ({
  useCrmClientes: () => ({
    lista: { total: 0, clientes: [] },
    carregando: false,
    erro: null,
    atualizar: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function texto(el: Element | null) {
  return (el?.textContent ?? "").replace(/\s+/g, " ");
}

describe("as duas listas de Clientes dizem de onde vêm", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it("Clientes diz que lista contas do app e aponta o balcão para Relatórios › Clientes", async () => {
    const { AdminCustomersView } = await import(
      "@/views/admin/AdminCustomersView"
    );
    await act(async () => {
      raiz.render(<AdminCustomersView active={true} onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    const frase = `Clientes com conta no app. Quem comprou só no balcão aparece em ${NOMES_DO_PAINEL["admin-crm"]} › Clientes.`;
    const paragrafo = Array.from(hospedeiro.querySelectorAll("p")).find(
      (p) => texto(p).trim() === frase,
    );
    expect(paragrafo, "parágrafo de origem da lista").toBeDefined();
    // Legível: nada de 10px nem de cinza abaixo de zinc-400.
    expect(paragrafo?.className).toContain("text-zinc-400");
    expect(paragrafo?.className).not.toMatch(/text-\[(?:[0-9]|10)px\]/);
  });

  it("Relatórios › Clientes diz quem entra na lista, sem afirmar 'com conta no app'", async () => {
    const { ClientesDoCrm } = await import(
      "@/components/admin/crm/ClientesDoCrm"
    );
    await act(async () => {
      raiz.render(
        <ClientesDoCrm
          segmentos={[]}
          carregandoSegmentos={false}
          segmento={null}
          aoMudarSegmento={() => {}}
          active
          onNavigate={() => {}}
          sinalDeAtualizacao={0}
        />,
      );
    });

    const corpo = texto(hospedeiro);
    expect(corpo).toContain(
      "Quem já comprou (app e balcão), quem pediu e não pagou e quem criou conta sem comprar — com WhatsApp e ficha a um toque.",
    );
    expect(corpo).not.toMatch(/com conta no app/i);
    // A frase antiga prometia só quem compra e quem não comprou.
    expect(corpo).not.toContain("Quem compra e quem ainda não comprou");
  });
});
