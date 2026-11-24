// @vitest-environment jsdom
// Quando a Visão geral do CRM diz "Sua loja ainda não tem venda paga" (achado
// por mutação em 24/11/2026): só quando o histórico INTEIRO da loja não tem
// pedido nem receita. Uma loja que já vendeu, mas não vendeu neste período
// (ou cujo único pedido foi um brinde de R$ 0,00), continua vendo os cartões
// e a nota "Nenhuma venda paga neste período" — mandar essa lojista de volta
// para "Os relatórios começam na primeira venda" esconde os números dela.
// Também: enquanto a busca do período está em andamento, uma falha antiga
// ainda guardada não pode trocar o esqueleto por "Os números não carregaram".
import { VisaoGeralDoCrm } from "@/components/admin/crm/VisaoGeralDoCrm";
import { useDashboardClassico } from "@/hooks/useCrm";
import { lerVisaoDoCrm } from "@/lib/crm";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  analytics: {
    stats: {
      revenueHistory: [] as { revenue: number; orders: number }[],
    },
    categoryData: [] as { name: string; value: number }[],
    error: null,
    categoryError: null as string | null,
    fetchExecutiveSummary: vi.fn().mockResolvedValue(undefined),
    fetchCategoryAnalytics: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useAnalytics", () => ({ useAnalytics: () => h.analytics }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: null }) }));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja fictícia" } }),
}));
vi.mock("@/components/admin/dashboard/OperationalPerformanceChart", () => ({
  OperationalPerformanceChart: ({ loading }: { loading: boolean }) => (
    <div data-testid="grafico" data-carregando={String(loading)} />
  ),
}));
vi.mock("@/components/admin/dashboard/TopProductsList", () => ({
  TopProductsList: () => null,
}));
vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn(), undefined],
}));

const navegar = vi.fn();

// @ts-expect-error flag interna de teste do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  navegar.mockClear();
  h.analytics.stats.revenueHistory = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const VISAO_SEM_VENDA_NO_PERIODO = {
  kpis: { pedidos: 0, clientes_compradores: 0, taxa_devolucao: 0 },
  segmentos: [],
  canais: [],
  formas: [],
  pipeline: [],
};

type Classico = ReturnType<typeof useDashboardClassico>;

function Sonda({
  comVisao = true,
  carregando = false,
  erro = null,
  offline = false,
  aoTentar,
  intervalo,
  kpis,
  classicoFalso,
}: {
  comVisao?: boolean;
  carregando?: boolean;
  erro?: string | null;
  offline?: boolean;
  aoTentar?: () => void;
  intervalo?: string;
  kpis?: Record<string, number>;
  classicoFalso?: Partial<Classico>;
}) {
  const classicoDoHook = useDashboardClassico(false);
  const classico: Classico = { ...classicoDoHook, ...classicoFalso };
  return (
    <VisaoGeralDoCrm
      visao={
        comVisao
          ? lerVisaoDoCrm({
              ...VISAO_SEM_VENDA_NO_PERIODO,
              kpis: { ...VISAO_SEM_VENDA_NO_PERIODO.kpis, ...kpis },
            })
          : null
      }
      carregando={carregando}
      erro={erro}
      offline={offline}
      aoTentar={aoTentar}
      comparacao="vs. período anterior"
      intervalo={intervalo}
      classico={classico}
      active
      onNavigate={navegar}
      aoVerSegmento={vi.fn()}
    />
  );
}
async function montar(props: Parameters<typeof Sonda>[0] = {}) {
  await act(async () => root.render(<Sonda {...props} />));
}

it("histórico com dias sem venda e dias com venda: não é loja nova, e a nota diz que o PERÍODO ficou sem venda", async () => {
  h.analytics.stats.revenueHistory = [
    { revenue: 0, orders: 0 },
    { revenue: 120, orders: 2 },
    { revenue: 0, orders: 0 },
  ];
  await montar();

  expect(host.textContent).not.toContain("Sua loja ainda não tem venda paga");
  expect(host.textContent).not.toContain(
    "Os relatórios começam na primeira venda",
  );
  expect(host.textContent).toContain("Nenhuma venda paga neste período");
  expect(
    host.querySelector('article[aria-label="Taxa de recompra"]'),
  ).toBeTruthy();
});

it("histórico só com pedido de R$ 0,00 (brinde) já é venda: não volta para 'primeira venda'", async () => {
  h.analytics.stats.revenueHistory = [{ revenue: 0, orders: 1 }];
  await montar();

  expect(host.textContent).not.toContain("Sua loja ainda não tem venda paga");
  expect(host.textContent).toContain("Nenhuma venda paga neste período");
});

it("histórico com receita mas sem contagem de pedido também já é venda", async () => {
  h.analytics.stats.revenueHistory = [{ revenue: 80, orders: 0 }];
  await montar();

  expect(host.textContent).not.toContain("Sua loja ainda não tem venda paga");
});

it("buscando de novo com uma falha antiga guardada: continua o esqueleto, sem 'Os números não carregaram'", async () => {
  await montar({
    comVisao: false,
    carregando: true,
    erro: "Falha antiga da busca anterior",
  });

  expect(host.textContent).not.toContain("Os números não carregaram");
  expect(host.querySelector(".premium-shimmer")).not.toBeNull();

  // Passada a busca, sem visão e com a falha: aí sim a falha aparece.
  await montar({
    comVisao: false,
    carregando: false,
    erro: "Falha antiga da busca anterior",
  });

  expect(host.textContent).toContain("Os números não carregaram");
});

it("busca que falhou, sem número nenhum: os seis cartões dizem 'Sem dado agora' e o valor é traço", async () => {
  h.analytics.stats.revenueHistory = [{ revenue: 120, orders: 2 }];
  await montar({
    comVisao: false,
    carregando: false,
    erro: "Falha da busca",
  });

  for (const rotulo of [
    "Valor médio por venda",
    "Receita em risco",
    "Clientes compradores",
    "Taxa de recompra",
    "Total já comprado por cliente (média)",
    "Taxa de devolução",
  ]) {
    const cartao = host.querySelector(`article[aria-label="${rotulo}"]`);
    expect(cartao, rotulo).toBeTruthy();
    expect(cartao?.textContent, rotulo).toContain("Sem dado agora");
    expect(cartao?.textContent, rotulo).toContain("—");
  }
});

const AVISO_DA_ULTIMA_BUSCA =
  "Não deu para atualizar · mostrando a última busca";

it("com números na tela e a atualização falhou: avisa e o 'Tentar de novo' refaz a busca", async () => {
  const aoTentar = vi.fn();
  await montar({ erro: "Falha da busca", aoTentar });

  expect(host.textContent).toContain(AVISO_DA_ULTIMA_BUSCA);
  const botao = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Tentar de novo",
  );
  expect(botao).toBeTruthy();
  await act(async () => botao?.click());
  expect(aoTentar).toHaveBeenCalledTimes(1);
});

it("o aviso 'mostrando a última busca' só existe quando há última busca na tela", async () => {
  // Sem número nenhum: não há "última busca" para mostrar.
  await montar({ comVisao: false, erro: "Falha da busca" });
  expect(host.textContent).not.toContain(AVISO_DA_ULTIMA_BUSCA);

  // Buscando de novo: o aviso espera a resposta, não pisca durante ela.
  await montar({ carregando: true, erro: "Falha da busca" });
  expect(host.textContent).not.toContain(AVISO_DA_ULTIMA_BUSCA);

  // Sem internet o aviso é outro (a nota do cartão), não este.
  await montar({ erro: "Falha da busca", offline: true });
  expect(host.textContent).not.toContain(AVISO_DA_ULTIMA_BUSCA);
  expect(host.textContent).toContain("Sem internet · números da última busca");
});

const KPIS_COM_VENDA_E_RISCO = {
  pedidos: 3,
  ticket_medio: 40,
  clientes_compradores: 2,
  receita_em_risco: 500,
  taxa_recompra: 0.5,
  receita_recorrente_pct: 0.2,
  taxa_devolucao: 0,
  ltv_medio: 100,
};

it("rodapé do resumo: 'intervalo · comparação', e sem intervalo não sobra o ponto separador", async () => {
  const rodape = () =>
    host
      .querySelector(".metricas-painel-secundarias")
      ?.textContent?.replace(/\s+/g, " ")
      .trim();

  await montar({ intervalo: "28 ago – 26 set" });
  expect(rodape()).toBe("28 ago – 26 set · vs. período anterior");

  await montar({ intervalo: "" });
  expect(rodape()).toBe("vs. período anterior");
});

it("a faixa de nota do resumo: vermelha na falha, âmbar sem internet, neutra no normal", async () => {
  const faixa = () => host.querySelector(".metricas-relatorio-nota");

  await montar({ comVisao: false, erro: "Falha da busca" });
  expect(faixa()?.className).toContain("bg-rose-500/10");
  expect(faixa()?.className).not.toContain("bg-amber-500/10");

  await montar({ offline: true });
  expect(faixa()?.className).toContain("bg-amber-500/10");
  expect(faixa()?.className).not.toContain("bg-rose-500/10");

  await montar({ kpis: KPIS_COM_VENDA_E_RISCO });
  expect(faixa()?.className).not.toContain("bg-amber-500/10");
  expect(faixa()?.className).not.toContain("bg-rose-500/10");
});

it("só o cartão 'Receita em risco' ganha o destaque âmbar quando há risco", async () => {
  await montar({ kpis: KPIS_COM_VENDA_E_RISCO });

  const destacados = [...host.querySelectorAll("article[aria-label]")]
    .filter((a) => a.className.includes("border-amber-400"))
    .map((a) => a.getAttribute("aria-label"));
  expect(destacados).toEqual(["Receita em risco"]);
});

it("só os três cartões de número histórico trazem o botão 'Entender'", async () => {
  await montar({ kpis: KPIS_COM_VENDA_E_RISCO });

  const comAjuda = [...host.querySelectorAll("article[aria-label]")]
    .filter((a) => a.querySelector('button[aria-label^="Entender "]'))
    .map((a) => a.getAttribute("aria-label"));
  expect(comAjuda.sort()).toEqual(
    [
      "Receita em risco",
      "Taxa de recompra",
      "Total já comprado por cliente (média)",
    ].sort(),
  );
});

const STATS_COM_VENDA = {
  revenueHistory: [{ revenue: 100, orders: 1 }],
} as unknown as Classico["stats"];

const aviso = () => host.querySelector("[data-aviso-historico]");
const grafico = () => host.querySelector('[data-testid="grafico"]');

it("histórico: enquanto relê, o aviso de falha espera; o gráfico só é esqueleto sem nada para mostrar", async () => {
  await montar({
    classicoFalso: { stats: STATS_COM_VENDA, erro: "Falha", carregando: true },
  });
  expect(aviso()).toBeNull();
  expect(grafico()?.getAttribute("data-carregando")).toBe("false");

  await montar({
    classicoFalso: { stats: null, erro: null, carregando: true },
  });
  expect(grafico()?.getAttribute("data-carregando")).toBe("true");
});

it("histórico: falha com números antigos na tela avisa 'mostrando a última busca' e junta a orientação de permissão", async () => {
  const permissao =
    "Sem permissão para acessar estes dados agora. Peça acesso ao dono da loja.";
  await montar({
    classicoFalso: { stats: STATS_COM_VENDA, erro: "Falha", carregando: false },
  });
  expect(aviso()?.textContent).toContain(
    "Não deu para atualizar o histórico · mostrando a última busca",
  );
  expect(aviso()?.textContent).not.toContain("Sem permissão");

  await montar({
    classicoFalso: {
      stats: STATS_COM_VENDA,
      erro: permissao,
      carregando: false,
    },
  });
  expect(aviso()?.textContent).toContain(
    `Não deu para atualizar o histórico · mostrando a última busca. ${permissao}`,
  );
});

it("histórico: sem nada na tela, falha comum diz 'Falha ao carregar'; só a falha de permissão inteira vira orientação", async () => {
  await montar({
    classicoFalso: {
      stats: null,
      erro: "Sem permissão de rede, tente depois",
      carregando: false,
    },
  });
  expect(aviso()?.textContent).toContain(
    "Falha ao carregar o histórico da loja",
  );
  expect(aviso()?.textContent).not.toContain("Sem permissão de rede");

  const permissao =
    "Sem permissão para acessar estes dados agora. Peça acesso ao dono da loja.";
  await montar({
    classicoFalso: { stats: null, erro: permissao, carregando: false },
  });
  expect(aviso()?.textContent).toContain(permissao);
  expect(aviso()?.textContent).not.toContain("Falha ao carregar");
});

it("loja nova: o botão 'Vender no balcão' leva para o PDV", async () => {
  h.analytics.stats.revenueHistory = [{ revenue: 0, orders: 0 }];
  await montar();

  const botao = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Vender no balcão",
  );
  expect(botao).toBeTruthy();
  await act(async () => botao?.click());
  expect(navegar).toHaveBeenCalledWith("admin-pdv");
});
