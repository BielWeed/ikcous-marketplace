// @vitest-environment jsdom
//
// Dashboard CRM (rota `admin-crm`, 26/09/2026). Monta a tela de verdade com
// o Supabase dublado e prova:
//   - os chips de período chamam `crm_visao` com as datas certas (fuso de
//     São Paulo, relógio fixo);
//   - as abas trocam de painel (Visão geral → Clientes → Canais → Funil);
//   - na aba Clientes, `crm_clientes` recebe segmento/paginação, cada linha
//     tem o WhatsApp com o texto do segmento e "Ver cliente" abre a ficha;
//   - o funil/pipeline leva à tela de Pedidos.
// Os blocos do dashboard antigo (gráficos/carrossel) são dublados: o
// assunto aqui é a casca nova do CRM.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  respostas: new Map<string, { data: unknown; error: unknown }>(),
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
      const canal: Record<string, unknown> = {
        on: () => canal,
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    fetchExecutiveSummary: vi.fn().mockResolvedValue(null),
    fetchCategoryAnalytics: vi.fn().mockResolvedValue(null),
    stats: null,
    categoryData: null,
    error: null,
    categoryError: null,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "adm-1" } }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useScrollRestoration", () => ({
  useScrollRestoration: () => ({ ref: { current: null } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja do Gabriel" } }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/components/admin/dashboard/KpiSummaryCards", () => ({
  KpiSummaryCards: () => null,
}));
vi.mock("@/components/admin/dashboard/OperationalPerformanceChart", () => ({
  OperationalPerformanceChart: () => null,
}));
vi.mock("@/components/admin/dashboard/StrategicIntelligenceBlocks", () => ({
  StrategicIntelligenceBlocks: () => null,
}));
vi.mock("@/components/admin/dashboard/TopProductsList", () => ({
  TopProductsList: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const VISAO = {
  kpis: {
    receita: 5000,
    receita_anterior: 4000,
    pedidos: 40,
    pedidos_anterior: 50,
    ticket_medio: 125,
    ticket_medio_anterior: 80,
    clientes_compradores: 30,
    clientes_novos: 6,
    taxa_recompra: 33.3,
    receita_recorrente_pct: 58,
    ltv_medio: 410,
    receita_em_risco: 2200,
    taxa_devolucao: 2.5,
  },
  canais: [
    { canal: "presencial", receita: 2000, pedidos: 25, ticket_medio: 80 },
    { canal: "online", receita: 3000, pedidos: 15, ticket_medio: 200 },
  ],
  formas: [
    { forma: "pix", receita: 3500, pedidos: 20 },
    { forma: "cash", receita: 1500, pedidos: 20 },
  ],
  funil: {
    visitas: 1000,
    produtos_vistos: 600,
    carrinhos: 120,
    pedidos_criados: 60,
    pedidos_pagos: 40,
  },
  pipeline: [
    { status: "processing", quantidade: 3, mais_antigo_em: null },
    { status: "pending", quantidade: 2, mais_antigo_em: null },
  ],
  segmentos: [
    { segmento: "campeoes", clientes: 4, receita: 1800 },
    { segmento: "em_risco", clientes: 2, receita: 2200 },
  ],
};

const CLIENTES = {
  total: 2,
  clientes: [
    {
      chave: "u-1",
      user_id: "u-1",
      nome: "Ana Souza",
      whatsapp: "(11) 98765-4321",
      pedidos: 6,
      receita: 900,
      dias_sem_comprar: 12,
      segmento: "campeoes",
      canal_preferido: "online",
    },
    {
      chave: "92999990000",
      user_id: null,
      nome: "Bruno do Balcão",
      whatsapp: "92999990000",
      pedidos: 1,
      receita: 80,
      dias_sem_comprar: 200,
      segmento: "em_risco",
      canal_preferido: "presencial",
    },
  ],
};

const texto = (el: Element | null) =>
  (el?.textContent ?? "").replace(/\u00a0/g, " ");

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

function botao(raiz: HTMLElement, alvo: string) {
  const achado = Array.from(raiz.querySelectorAll("button")).find(
    (b) => texto(b).trim() === alvo || texto(b).includes(alvo),
  );
  if (!achado) throw new Error(`botão "${alvo}" não encontrado`);
  return achado;
}

function chamadasDe(nome: string) {
  return h.rpc.mock.calls.filter(([n]) => n === nome).map(([, args]) => args);
}

describe("Dashboard CRM", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;
  const onNavigate = vi.fn();

  beforeEach(() => {
    // Relógio fixo só no Date (os setTimeout continuam reais): 12h de
    // 26/09/2026 em São Paulo.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T15:00:00Z"));
    vi.resetModules();
    h.rpc.mockClear();
    h.respostas.clear();
    h.respostas.set("crm_visao", { data: VISAO, error: null });
    h.respostas.set("crm_clientes", { data: CLIENTES, error: null });
    onNavigate.mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
  });

  async function montar() {
    const { AdminCrmView } = await import("@/views/admin/AdminCrmView");
    await act(async () => {
      raiz.render(<AdminCrmView active={true} onNavigate={onNavigate} />);
    });
    await esperarAte(() => chamadasDe("crm_visao").length >= 1);
  }

  it("abre em 30 dias e cada chip de período chama crm_visao com as datas certas", async () => {
    await montar();
    expect(chamadasDe("crm_visao").at(-1)).toEqual({
      p_inicio: "2026-08-28",
      p_fim: "2026-09-26",
    });

    const esperados: [string, string][] = [
      ["Mês", "2026-09-01"],
      ["Hoje", "2026-09-26"],
      ["7 dias", "2026-09-20"],
      ["Ano", "2026-01-01"],
    ];
    for (const [chip, inicio] of esperados) {
      const antes = chamadasDe("crm_visao").length;
      await act(async () => {
        botao(hospedeiro, chip).click();
      });
      await esperarAte(() => chamadasDe("crm_visao").length > antes);
      expect(chamadasDe("crm_visao").at(-1)).toEqual({
        p_inicio: inicio,
        p_fim: "2026-09-26",
      });
      expect(botao(hospedeiro, chip).getAttribute("aria-pressed")).toBe("true");
    }
  });

  it("Visão geral mostra os números do período com a variação escrita", async () => {
    await montar();
    await esperarAte(() => texto(hospedeiro).includes("R$ 5.000,00"));
    const pagina = texto(hospedeiro);
    expect(pagina).toContain("+25%"); // receita 5000 vs 4000
    expect(pagina).toContain("−20%"); // pedidos 40 vs 50
    expect(pagina).toContain("Taxa de recompra");
    expect(pagina).toContain("33,3%");
    expect(pagina).toContain("Receita em risco");
    expect(pagina).toContain("Histórico completo da loja");
  });

  it("as abas trocam de painel e só a aba visível fica à mostra", async () => {
    await montar();
    const aba = (rotulo: string) =>
      Array.from(hospedeiro.querySelectorAll('[role="tab"]')).find(
        (t) => texto(t) === rotulo,
      ) as HTMLButtonElement;
    const painel = (id: string) =>
      hospedeiro.querySelector(`#crm-painel-${id}`) as HTMLElement | null;

    expect(aba("Visão geral").getAttribute("aria-selected")).toBe("true");

    await act(async () => aba("Canais").click());
    await esperarAte(() => texto(painel("canais")).includes("Loja física"));
    expect(aba("Canais").getAttribute("aria-selected")).toBe("true");
    expect(painel("visao")?.hidden).toBe(true);
    expect(painel("canais")?.hidden).toBe(false);
    expect(texto(painel("canais"))).toContain("App (online)");
    expect(texto(painel("canais"))).toContain("PIX");
    expect(texto(painel("canais"))).toContain("70%");

    await act(async () => aba("Funil e pedidos").click());
    await esperarAte(() => texto(painel("funil")).includes("Pedidos pagos"));
    expect(painel("canais")?.hidden).toBe(true);
    expect(texto(painel("funil"))).toContain("66,7% do passo anterior");
    await act(async () => botao(painel("funil")!, "Em separação").click());
    expect(onNavigate).toHaveBeenLastCalledWith("admin-orders");

    // Seta para a direita volta ciclando até a primeira aba.
    await act(async () => {
      aba("Funil e pedidos").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(aba("Visão geral").getAttribute("aria-selected")).toBe("true");
  });

  it("Clientes: lista com WhatsApp pronto, filtro por segmento e ficha do cliente", async () => {
    await montar();
    const abaClientes = Array.from(
      hospedeiro.querySelectorAll('[role="tab"]'),
    ).find((t) => texto(t) === "Clientes") as HTMLButtonElement;
    await act(async () => abaClientes.click());
    await esperarAte(() => texto(hospedeiro).includes("Ana Souza"));

    expect(chamadasDe("crm_clientes").at(-1)).toEqual({
      p_segmento: null,
      p_busca: null,
      p_limite: 20,
      p_offset: 0,
    });

    const whatsapp = hospedeiro.querySelector(
      'a[href^="https://wa.me/5511987654321"]',
    );
    expect(whatsapp).not.toBeNull();
    const href = whatsapp?.getAttribute("href") ?? "";
    expect(decodeURIComponent(href.split("?text=")[1] ?? "")).toMatch(
      /^Oi, Ana! Aqui é da Loja do Gabriel\./,
    );
    expect(whatsapp?.getAttribute("target")).toBe("_blank");

    // Cliente de balcão (sem conta) não tem "Ver cliente"; o com conta tem.
    const painelClientes = hospedeiro.querySelector(
      "#crm-painel-clientes",
    ) as HTMLElement;
    const verCliente = Array.from(
      painelClientes.querySelectorAll("button"),
    ).filter((b) => texto(b).includes("Ver cliente"));
    expect(verCliente).toHaveLength(1);
    await act(async () => verCliente[0].click());
    expect(onNavigate).toHaveBeenLastCalledWith("admin-user-detail", "u-1");

    // Toque no segmento "Em risco" filtra a lista no banco.
    const antes = chamadasDe("crm_clientes").length;
    const segmento = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) =>
        b.getAttribute("aria-pressed") !== null &&
        texto(b).includes("Em risco"),
    ) as HTMLButtonElement;
    await act(async () => segmento.click());
    await esperarAte(() => chamadasDe("crm_clientes").length > antes);
    expect(chamadasDe("crm_clientes").at(-1)).toMatchObject({
      p_segmento: "em_risco",
      p_offset: 0,
    });
    expect(segmento.getAttribute("aria-pressed")).toBe("true");
  });

  it("'Ver clientes em risco' na Visão geral abre Clientes já filtrado", async () => {
    await montar();
    await esperarAte(() => texto(hospedeiro).includes("Ver clientes em risco"));
    await act(async () => botao(hospedeiro, "Ver clientes em risco").click());
    await esperarAte(() => chamadasDe("crm_clientes").length >= 1);
    expect(chamadasDe("crm_clientes").at(-1)).toMatchObject({
      p_segmento: "em_risco",
    });
  });
});
