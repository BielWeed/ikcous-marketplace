// @vitest-environment jsdom
//
// Caça de 03/11/2026 (achado e6): no dia 1 do mês, antes da primeira venda
// paga, `mes.pedidos` e `hoje.pedidos` valem 0 — e o Início tratava isso como
// "loja que nunca vendeu", mostrando "Sua loja começa por aqui" e "Sem pedidos
// por enquanto" para uma loja que vende há anos. O sinal de histórico que já
// vem no mesmo objeto: a receita do mês anterior e a série dos últimos 14 dias
// (no dia 1, a série ainda cobre o fim do mês passado).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  respostas: new Map<string, { data: unknown; error: unknown }>(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string, args?: unknown) => {
      h.rpc(nome, args);
      return Promise.resolve(
        h.respostas.get(nome) ?? { data: null, error: null },
      );
    },
    channel: () => {
      const canal = { on: () => canal, subscribe: () => canal };
      return canal;
    },
    removeChannel: vi.fn(),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: { user: { id: "adm-1" } },
    profile: { full_name: "Gabriel Dono" },
    isAdmin: true,
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      storeName: "Loja do Gabriel",
      storeCity: "Manaus",
      storeState: "AM",
      originCep: "69000-000",
    },
    isLoaded: true,
    products: [{ isActive: true }],
    loadingProducts: false,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useScrollRestoration", () => ({
  useScrollRestoration: () => ({ ref: { current: null } }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Dia 1 do mês, antes da primeira venda: tudo zerado, sem nada para fazer.
const PAINEL_DIA_1 = {
  hoje: {
    receita: 0,
    online: 0,
    presencial: 0,
    pedidos: 0,
    receita_semana_passada: 0,
  },
  mes: {
    receita: 0,
    receita_mes_anterior: 0,
    pedidos: 0,
    ticket_medio: 0,
    lucro_estimado: 0,
  },
  saldo_total: 0,
  a_receber_7d: 0,
  a_pagar_7d: 0,
  contas_vencidas: 0,
  pendencias: {
    pedidos_para_preparar: 0,
    devolucoes_abertas: 0,
    caixa_aberto: false,
    estoque_baixo: 0,
  },
  serie_14d: [
    { dia: "2026-10-31", receita: 0 },
    { dia: "2026-11-01", receita: 0 },
  ],
};

const texto = (el: Element | null) =>
  (el?.textContent ?? "").split(String.fromCharCode(160)).join(" ");

async function esperarAte(condicao: () => boolean, timeoutMs = 3000) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(
        `esperarAte: não aconteceu em ${timeoutMs}ms — corpo: ${texto(document.body).slice(0, 400)}`,
      );
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

describe("Início: loja antiga no começo do mês", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    vi.resetModules();
    h.respostas.clear();
    h.rpc.mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montarComPainel(painel: unknown) {
    h.respostas.set("painel_inicio", { data: painel, error: null });
    const { AdminDashboardView } = await import(
      "@/views/admin/AdminDashboardView"
    );
    await act(async () => {
      raiz.render(
        <AdminDashboardView active={true} onNavigate={() => undefined} />,
      );
    });
    // O "Para fazer" só escolhe entre as duas frases depois de ler o painel.
    await esperarAte(
      () =>
        texto(hospedeiro).includes("Tudo em dia") ||
        texto(hospedeiro).includes("Sem pedidos por enquanto"),
    );
  }

  it("com vendas no mês passado não mostra boas-vindas nem 'Sem pedidos por enquanto'", async () => {
    await montarComPainel({
      ...PAINEL_DIA_1,
      mes: { ...PAINEL_DIA_1.mes, receita_mes_anterior: 1500 },
    });
    expect(
      hospedeiro.querySelector('section[aria-label="Boas-vindas"]'),
    ).toBeNull();
    expect(texto(hospedeiro)).not.toContain("Sua loja começa por aqui");
    expect(texto(hospedeiro)).not.toContain("Sem pedidos por enquanto");
    expect(texto(hospedeiro)).toContain("Tudo em dia");
  });

  it("dia 1 (a base do mês anterior ainda é zero) mas vendeu nos últimos 14 dias: não é loja nova", async () => {
    await montarComPainel({
      ...PAINEL_DIA_1,
      serie_14d: [
        { dia: "2026-10-30", receita: 240 },
        { dia: "2026-10-31", receita: 0 },
        { dia: "2026-11-01", receita: 0 },
      ],
    });
    expect(
      hospedeiro.querySelector('section[aria-label="Boas-vindas"]'),
    ).toBeNull();
    expect(texto(hospedeiro)).not.toContain("Sem pedidos por enquanto");
    expect(texto(hospedeiro)).toContain("Tudo em dia");
  });

  it("controle: loja que de fato nunca vendeu continua com as boas-vindas", async () => {
    await montarComPainel(PAINEL_DIA_1);
    expect(
      hospedeiro.querySelector('section[aria-label="Boas-vindas"]'),
    ).not.toBeNull();
    expect(texto(hospedeiro)).toContain("Sua loja começa por aqui");
    expect(texto(hospedeiro)).toContain("Sem pedidos por enquanto");
  });
});
