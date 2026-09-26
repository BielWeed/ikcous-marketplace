// @vitest-environment jsdom
//
// Início do painel (rota `admin-dashboard`, 26/09/2026): o perfil da loja,
// o "Hoje", os quatro números do mês, o "Para fazer", a assinatura e os
// dois botões grandes (Dashboard CRM e Financeiro). Monta a tela de verdade
// com o Supabase dublado e prova:
//   - as duas RPCs do contrato (`painel_inicio` e `assinatura_da_loja_ler`)
//     são chamadas e os 4 KPIs do mês aparecem com os valores do banco;
//   - sem linha de assinatura, o card diz a verdade ("não sincronizado");
//   - os botões grandes e o "Para fazer" levam às telas certas;
//   - o tempo real escuta `marketplace_orders` e é desligado ao desmontar.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  respostas: new Map<string, { data: unknown; error: unknown }>(),
  rpc: vi.fn(),
  canais: [] as { nome: string; tabelas: string[] }[],
  removidos: [] as string[],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string, args?: unknown) => {
      h.rpc(nome, args);
      return Promise.resolve(
        h.respostas.get(nome) ?? { data: null, error: null },
      );
    },
    channel: (nome: string) => {
      const registro = { nome, tabelas: [] as string[] };
      h.canais.push(registro);
      const canal = {
        nome,
        on: (_evento: string, opcoes: { table?: string }) => {
          if (opcoes.table) registro.tabelas.push(opcoes.table);
          return canal;
        },
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: (canal: { nome: string }) => {
      h.removidos.push(canal.nome);
    },
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
      logoUrl: null,
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
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PAINEL = {
  hoje: {
    receita: 350,
    online: 200,
    presencial: 150,
    pedidos: 4,
    receita_semana_passada: 280,
  },
  mes: {
    receita: 12345.67,
    receita_mes_anterior: 10000,
    pedidos: 80,
    ticket_medio: 154.32,
    lucro_estimado: 4321.09,
  },
  saldo_total: 8765.43,
  a_receber_7d: 1200.5,
  a_pagar_7d: 300,
  contas_vencidas: 2,
  pendencias: {
    pedidos_para_preparar: 5,
    devolucoes_abertas: 1,
    caixa_aberto: false,
    estoque_baixo: 3,
  },
  serie_14d: [
    { dia: "2026-09-25", receita: 120 },
    { dia: "2026-09-26", receita: 350 },
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

function botaoPorTexto(raiz: HTMLElement, alvo: string) {
  const botao = Array.from(raiz.querySelectorAll("button")).find((b) =>
    texto(b).includes(alvo),
  );
  if (!botao) throw new Error(`botão "${alvo}" não encontrado`);
  return botao;
}

describe("Início do painel", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;
  const onNavigate = vi.fn();

  beforeEach(() => {
    // O cache do Início é de módulo: cada teste começa com um módulo novo.
    vi.resetModules();
    h.respostas.clear();
    h.rpc.mockClear();
    h.canais.length = 0;
    h.removidos.length = 0;
    onNavigate.mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montar() {
    const { AdminDashboardView } = await import(
      "@/views/admin/AdminDashboardView"
    );
    await act(async () => {
      raiz.render(<AdminDashboardView active={true} onNavigate={onNavigate} />);
    });
    await esperarAte(() => h.rpc.mock.calls.length >= 2);
  }

  it("chama as duas RPCs do contrato e mostra os 4 números do mês", async () => {
    h.respostas.set("painel_inicio", { data: PAINEL, error: null });
    await montar();
    await esperarAte(() => texto(hospedeiro).includes("R$ 12.345,67"));

    expect(h.rpc.mock.calls.map(([nome]) => nome).sort()).toEqual([
      "assinatura_da_loja_ler",
      "painel_inicio",
    ]);

    const pagina = texto(hospedeiro);
    for (const rotulo of [
      "Receita do mês",
      "Lucro estimado",
      "Saldo em contas",
      "A receber em 7 dias",
    ]) {
      expect(pagina).toContain(rotulo);
    }
    expect(pagina).toContain("R$ 4.321,09");
    expect(pagina).toContain("R$ 8.765,43");
    expect(pagina).toContain("R$ 1.200,50");
    // Hoje: receita, divisão app × balcão e a variação vs. semana passada.
    expect(pagina).toContain("R$ 350,00");
    expect(pagina).toContain("App");
    expect(pagina).toContain("Balcão");
    expect(pagina).toContain("+25%");
    // Receita do mês +23,5% vs. mês anterior (12345,67 / 10000).
    expect(pagina).toContain("+23,5%");
    // Identidade da loja vinda do config e do perfil.
    expect(pagina).toContain("Loja do Gabriel");
    expect(pagina).toContain("Manaus / AM");
    expect(pagina).toContain("Gabriel Dono");
  });

  it("sem linha de assinatura, o card diz que o plano não foi sincronizado", async () => {
    h.respostas.set("painel_inicio", { data: PAINEL, error: null });
    h.respostas.set("assinatura_da_loja_ler", { data: null, error: null });
    await montar();
    await esperarAte(() =>
      texto(hospedeiro).includes(
        "Plano ainda não sincronizado com a sua conta",
      ),
    );
    expect(hospedeiro.querySelector('a[href^="https://cobranca"]')).toBeNull();
  });

  it("com assinatura, mostra plano, status com texto e o link de gerenciar em nova aba", async () => {
    h.respostas.set("painel_inicio", { data: PAINEL, error: null });
    h.respostas.set("assinatura_da_loja_ler", {
      data: {
        plano: "Loja Pro",
        status: "atrasada",
        valor_mensal: 99.9,
        ciclo: "mensal",
        proxima_cobranca_em: "2026-10-01",
        recursos: ["PDV", "CRM"],
        gerenciar_url: "https://cobranca.exemplo.com/loja",
        suporte_whatsapp: "11987654321",
      },
      error: null,
    });
    await montar();
    await esperarAte(() => texto(hospedeiro).includes("Loja Pro"));

    const pagina = texto(hospedeiro);
    expect(pagina).toContain("Atrasada");
    expect(pagina).toContain("R$ 99,90/mês");
    expect(pagina).toContain("01/10/2026");
    const gerenciar = hospedeiro.querySelector(
      'a[href="https://cobranca.exemplo.com/loja"]',
    );
    expect(gerenciar?.getAttribute("target")).toBe("_blank");
    expect(gerenciar?.getAttribute("rel")).toContain("noopener");
    expect(
      hospedeiro.querySelector('a[href="https://wa.me/5511987654321"]'),
    ).not.toBeNull();
  });

  it("os botões grandes levam ao Dashboard CRM e ao Financeiro", async () => {
    h.respostas.set("painel_inicio", { data: PAINEL, error: null });
    await montar();

    await act(async () => {
      botaoPorTexto(hospedeiro, "Dashboard CRM").click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith("admin-crm");

    await act(async () => {
      botaoPorTexto(hospedeiro, "Caixa, extrato").click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith("admin-financeiro");

    await act(async () => {
      botaoPorTexto(hospedeiro, "Vender").click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith("admin-pdv");
  });

  it("o 'Para fazer' mostra as contagens e cada linha abre a tela que resolve", async () => {
    h.respostas.set("painel_inicio", { data: PAINEL, error: null });
    await montar();
    await esperarAte(() => texto(hospedeiro).includes("pendências"));

    const destinos: [string, string][] = [
      ["Pedidos para preparar", "admin-orders"],
      ["Devoluções abertas", "admin-devolucoes"],
      ["Contas vencidas", "admin-financeiro"],
      ["Produtos com estoque baixo", "admin-products"],
    ];
    for (const [rotulo, destino] of destinos) {
      await act(async () => {
        botaoPorTexto(hospedeiro, rotulo).click();
      });
      expect(onNavigate).toHaveBeenLastCalledWith(destino);
    }
    const preparar = botaoPorTexto(hospedeiro, "Pedidos para preparar");
    expect(texto(preparar)).toContain("5");
    // 4 pendências acesas: preparar, devolução, vencidas, estoque.
    expect(texto(hospedeiro)).toContain("4 pendências");
  });

  it("função ainda não criada no banco vira aviso honesto, não número zero", async () => {
    h.respostas.set("painel_inicio", {
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    await montar();
    await esperarAte(() =>
      texto(hospedeiro).includes("ainda não foram ativados"),
    );
    expect(texto(hospedeiro)).not.toContain("R$ 0,00");
  });

  it("o tempo real escuta marketplace_orders e o canal é removido ao desmontar", async () => {
    h.respostas.set("painel_inicio", { data: PAINEL, error: null });
    await montar();

    const canal = h.canais.find((c) => c.nome === "admin-inicio-pedidos");
    expect(canal?.tabelas).toEqual(["marketplace_orders"]);

    act(() => raiz.unmount());
    expect(h.removidos).toContain("admin-inicio-pedidos");
    // afterEach desmonta de novo: uma raiz nova evita o erro de raiz morta.
    raiz = createRoot(hospedeiro);
  });

  it("tela inativa (atrás de outra aba) não chama o banco nem abre canal", async () => {
    const { AdminDashboardView } = await import(
      "@/views/admin/AdminDashboardView"
    );
    await act(async () => {
      raiz.render(
        <AdminDashboardView active={false} onNavigate={onNavigate} />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.canais).toEqual([]);
  });
});
