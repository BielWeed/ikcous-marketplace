// @vitest-environment jsdom
//
// Onda F (F4) do painel simples: cada número do Início diz o conceito e a
// janela. "Vendas pagas" é o rótulo exato da régua de `crm__vendas` (pago,
// pago_apos_expirar, recebido_na_entrega, sem cancelado/devolvido, pelo dia do
// pagamento). Prova, montando a tela de verdade:
//   (a) o "Hoje" e o mês se chamam "Vendas pagas hoje" e "Vendas pagas no mês";
//   (b) "Contas vencidas" aparece UMA vez (no Para fazer) e "A pagar (vencidas
//       + próximos 7 dias)" continua levando ao Financeiro (o rótulo antigo,
//       "A pagar em 7 dias", escondia que a soma inclui o que já venceu);
//   (c) a legenda da série de 14 dias e a ajuda do Início usam as mesmas
//       palavras; "Lucro estimado" não vira "vendas" (vem do DRE).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  respostas: new Map<string, { data: unknown; error: unknown }>(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string) =>
      Promise.resolve(h.respostas.get(nome) ?? { data: null, error: null }),
    channel: () => {
      const canal = { on: () => canal, subscribe: () => canal };
      return canal;
    },
    removeChannel: () => undefined,
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
    config: { storeName: "Loja", storeCity: "Manaus", storeState: "AM" },
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

const ocorrencias = (corpo: string, alvo: string) =>
  corpo.split(alvo).length - 1;

async function esperarAte(condicao: () => boolean, timeoutMs = 3000) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(`esperarAte: não aconteceu em ${timeoutMs}ms`);
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

describe("Início: cada número diz o conceito e a janela", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;
  const onNavigate = vi.fn();

  async function montar(painel: unknown) {
    vi.resetModules();
    h.respostas.clear();
    h.respostas.set("painel_inicio", { data: painel, error: null });
    onNavigate.mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const { AdminDashboardView } = await import(
      "@/views/admin/AdminDashboardView"
    );
    await act(async () => {
      raiz.render(<AdminDashboardView active={true} onNavigate={onNavigate} />);
    });
    await esperarAte(() => texto(hospedeiro).includes("Este mês"));
    await esperarAte(() => texto(hospedeiro).includes("R$ 1.200,50"));
  }

  beforeEach(async () => {
    await montar(PAINEL);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it("(a) o Hoje e o mês dizem 'Vendas pagas' com a janela", () => {
    const pagina = texto(hospedeiro);
    expect(pagina).toContain("Vendas pagas hoje");
    expect(pagina).toContain("Vendas pagas no mês");
    expect(pagina).not.toContain("Receita do mês");
    // hoje.pedidos é a contagem de crm__vendas do dia: são vendas.
    expect(pagina).toMatch(/4\s*vendas/);
    // O lucro vem do DRE do Financeiro: não ganha o rótulo de vendas.
    expect(pagina).toContain("Lucro estimado");
    // ...e o lucro (entre o seu rótulo e o gráfico dos 14 dias) não herda a
    // régua de crm__vendas.
    const tileDoLucro = pagina.slice(
      pagina.indexOf("Lucro estimado"),
      pagina.indexOf("Últimos 14 dias"),
    );
    expect(tileDoLucro).toContain("Margem estimada");
    expect(tileDoLucro).not.toContain("Vendas pagas");
    // O topo do mês conta as mesmas vendas do Hoje: "80 vendas".
    expect(pagina).toMatch(/80\s*vendas/);
    expect(pagina).not.toContain("80 pedidos");
  });

  it("(a2) sem margem calculável, o rodapé do lucro diz de onde vem a conta", async () => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    await montar({ ...PAINEL, mes: { ...PAINEL.mes, receita: 0 } });
    // O link "Como é calculado o lucro" abre a explicação no mesmo lugar.
    const como = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      texto(b).includes("Como é calculado o lucro"),
    );
    expect(como?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => como?.click());
    expect(como?.getAttribute("aria-expanded")).toBe("true");
    expect(texto(hospedeiro)).toContain(
      "Desconta estornos, devoluções, custos e despesas, mesmo não pagas. Sem custo cadastrado, usa R$ 0 de custo.",
    );
  });

  it("(b) 'Contas vencidas' aparece uma vez (no Para fazer) e 'A pagar (vencidas + próximos 7 dias)' leva ao Financeiro", () => {
    const pagina = texto(hospedeiro);
    expect(ocorrencias(pagina, "2 contas vencidas")).toBe(1);
    expect(pagina).toContain("1 devolução aberta");

    const paraFazer = hospedeiro.querySelector(
      '[aria-labelledby="inicio-para-fazer-titulo"]',
    );
    expect(texto(paraFazer)).toContain("2 contas vencidas");

    const botao = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.getAttribute("aria-label") ?? "").startsWith("A pagar —"),
    );
    expect(botao).toBeTruthy();
    expect(texto(botao ?? null)).toContain("Vencidas + próximos 7 dias");
    act(() => botao?.click());
    expect(onNavigate).toHaveBeenCalledWith("admin-financeiro");
  });

  it("(b2) 'A pagar (vencidas + próximos 7 dias)' é um botão-linha novo (rounded-2xl, gradiente, min-h-11)", () => {
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.getAttribute("aria-label") ?? "").startsWith("A pagar —"),
    );
    expect(botao).toBeTruthy();
    expect(texto(botao ?? null)).toContain("Vencidas + próximos 7 dias");
    for (const classe of ["rounded-2xl", "min-h-11", "transition-colors"]) {
      expect(botao?.classList.contains(classe)).toBe(true);
    }
    expect(
      botao?.querySelector("svg.lucide-chevron-right.size-5"),
    ).not.toBeNull();
  });

  it("(b3) o resumo do mês não usa cinza 500 em texto", () => {
    const mes = hospedeiro.querySelector(
      '[aria-labelledby="inicio-mes-titulo"]',
    );
    expect(mes?.querySelector("p.text-zinc-500")).toBeNull();
  });

  it("(c) a legenda da série e a ajuda usam as mesmas palavras", async () => {
    const serie = hospedeiro.querySelector(
      '[aria-labelledby="inicio-serie-titulo"]',
    );
    expect(texto(serie)).toContain("Vendas pagas por dia nos últimos 14 dias");
    expect(texto(serie)).not.toContain("Receita por dia");
    // O conceito também está no título do gráfico, não só na tabela sr-only.
    expect(texto(serie?.querySelector("#inicio-serie-titulo") ?? null)).toBe(
      "Últimos 14 dias · vendas pagas por dia",
    );

    const ajuda = hospedeiro.querySelector<HTMLButtonElement>(
      '[aria-label="Como ler o Início"]',
    );
    await act(async () => ajuda?.click());
    const corpo = texto(document.body);
    expect(corpo).toContain("Vendas pagas hoje:");
    expect(corpo).toContain("o resultado do Financeiro no mês");
  });
});
