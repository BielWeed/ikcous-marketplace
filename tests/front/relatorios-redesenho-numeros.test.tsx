import { lerClientesDoCrm, lerVisaoDoCrm } from "@/lib/crm";
// @vitest-environment jsdom
// A fotografia foi gravada renderizando a base 4d27e0fe, ANTES do redesenho.
// Mesmo conjunto de dados nas quatro abas; apenas os seletores acompanham a nova casca.
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ lista: null as unknown }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja fictícia" } }),
}));
vi.mock("@/hooks/useCrm", () => ({
  useCrmClientes: () => ({
    lista: h.lista,
    carregando: false,
    erro: null,
    atualizar: vi.fn(),
  }),
  useCrmVisao: () => ({
    visao: null,
    carregando: true,
    erro: null,
    atualizar: vi.fn(),
  }),
  useDashboardClassico: () => ({
    stats: null,
    categorias: [],
    carregando: true,
    erro: null,
    erroDeCategoria: null,
    carregar: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useScrollRestoration", () => ({
  useScrollRestoration: () => ({ ref: { current: null } }),
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
vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn(), undefined],
}));

// @ts-expect-error flag de teste do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const dados = lerVisaoDoCrm({
  kpis: {
    receita: 170.88,
    receita_anterior: 187.37,
    pedidos: 9,
    pedidos_anterior: 2,
    ticket_medio: 18.99,
    ticket_medio_anterior: 93.69,
    clientes_compradores: 3,
    clientes_novos: 2,
    taxa_recompra: 0.667,
    receita_recorrente_pct: 0.771,
    ltv_medio: 57.96,
    receita_em_risco: 312.4,
    taxa_devolucao: 0.025,
  },
  canais: [
    { canal: "online", receita: 122.92, pedidos: 5, ticket_medio: 24.58 },
    { canal: "presencial", receita: 47.96, pedidos: 4, ticket_medio: 11.99 },
  ],
  formas: [
    { forma: "pix", receita: 98.92, pedidos: 4 },
    { forma: "dinheiro", receita: 35.98, pedidos: 3 },
    { forma: "credito", receita: 35.98, pedidos: 2 },
  ],
  funil: {
    visitas: null,
    produtos_vistos: null,
    carrinhos: 6,
    pedidos_criados: 7,
    pedidos_pagos: 5,
  },
  pipeline: [
    { status: "processing", quantidade: 13, mais_antigo_em: null },
    { status: "shipping", quantidade: 17, mais_antigo_em: null },
  ],
  segmentos: [
    { segmento: "campeoes", clientes: 1, receita: 113.94 },
    { segmento: "novos", clientes: 2, receita: 57.4 },
    { segmento: "em_risco", clientes: 3, receita: 312.4 },
    { segmento: "pediu_nao_pagou", clientes: 4, receita: 18.99 },
  ],
})!;
h.lista = lerClientesDoCrm({
  total: 23,
  clientes: [
    {
      chave: "ficticio",
      user_id: "ficticio",
      nome: "Pessoa fictícia",
      pedidos: 11,
      receita: 123.45,
      segmento: "campeoes",
      canal_preferido: "online",
      ultima_compra: "2026-10-12T12:00:00Z",
    },
  ],
});
let host: HTMLDivElement;
let root: Root;
const texto = (e: Element | null) => {
  if (!e) return "";
  const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
  const partes: string[] = [];
  while (walker.nextNode()) partes.push(walker.currentNode.textContent ?? "");
  return partes.join(" ").replace(/\s+/g, " ").trim();
};
const numeros = (s: string) =>
  [...new Set(s.match(/R\$\s*[\d.,]+|[+-]?[\d.,]+%|\b\d+\b/g) ?? [])].sort();
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function montar(node: ReactNode) {
  await act(async () => root.render(node));
}
function grupo(rotulo: string) {
  const novo = host.querySelector(`[role="group"][aria-label="${rotulo}"]`);
  if (novo) return novo;
  const label = [...host.querySelectorAll("p")].find(
    (e) => texto(e) === rotulo,
  );
  return label?.parentElement?.parentElement ?? null;
}
function clicar(nome: string) {
  const b = [...host.querySelectorAll("button")].find((e) => texto(e) === nome);
  if (b) act(() => b.click());
}

it("Visão conserva os oito números e as três variações da renderização anterior", async () => {
  const { VisaoGeralDoCrm } = await import(
    "@/components/admin/crm/VisaoGeralDoCrm"
  );
  await montar(
    <VisaoGeralDoCrm
      visao={dados}
      carregando={false}
      comparacao="vs. 30 dias antes"
      classico={
        {
          stats: null,
          categorias: [],
          carregando: false,
          erro: null,
          erroDeCategoria: null,
          carregar: vi.fn(),
        } as never
      }
      active
      onNavigate={vi.fn()}
      aoVerSegmento={vi.fn()}
    />,
  );
  clicar("Expandir");
  const rotulos = [
    "Receita",
    "Pedidos",
    "Valor médio por venda",
    "Clientes compradores",
    "Taxa de recompra",
    "Total já comprado por cliente (média)",
    "Receita em risco",
    "Taxa de devolução",
  ];
  expect(
    Object.fromEntries(
      rotulos.map((r) => [
        r,
        numeros(texto(grupo(r))).filter((n) => n !== "30"),
      ]),
    ),
  ).toMatchSnapshot();
});
it("Clientes conserva valores, pedidos, datas e todos os números dos grupos", async () => {
  const { ClientesDoCrm } = await import(
    "@/components/admin/crm/ClientesDoCrm"
  );
  await montar(
    <ClientesDoCrm
      segmentos={dados.segmentos}
      carregandoSegmentos={false}
      segmento={null}
      aoMudarSegmento={vi.fn()}
      active
      onNavigate={vi.fn()}
      sinalDeAtualizacao={0}
    />,
  );
  clicar("Grupos");
  const grupos = [...host.querySelectorAll("button[aria-pressed]")]
    .filter((b) => b.closest("section")?.querySelector("#crm-segmentos-titulo"))
    .map((e) => numeros(texto(e)));
  const cliente = [...host.querySelectorAll("li")].find((e) =>
    texto(e).includes("Pessoa fictícia"),
  );
  expect({
    grupos,
    cliente: numeros(texto(cliente ?? null)),
  }).toMatchSnapshot();
});
it("Canais conserva a receita, participação, pedidos e valor médio por canal e forma", async () => {
  const { CanaisDoCrm } = await import("@/components/admin/crm/CanaisDoCrm");
  await montar(
    <CanaisDoCrm visao={dados} carregando={false} onNavigate={vi.fn()} />,
  );
  const linhas = [...host.querySelectorAll("li")].map((e) => {
    // Receita e participação mudaram da linha para o resumo; ainda são do mesmo canal.
    const nome = e.getAttribute("aria-label")?.replace("Detalhes ", "");
    return numeros(
      (nome
        ? `${texto(host.querySelector(`[role="group"][aria-label="${nome}"]`))} `
        : "") + texto(e),
    );
  });
  expect(linhas).toMatchSnapshot();
});
it("dinheiro grande preserva o valor completo do computador e o compacto do celular", async () => {
  const { VisaoGeralDoCrm } = await import(
    "@/components/admin/crm/VisaoGeralDoCrm"
  );
  await montar(
    <VisaoGeralDoCrm
      visao={{ ...dados, kpis: { ...dados.kpis, receita: 12345.67 } }}
      carregando={false}
      comparacao="vs. 30 dias antes"
      classico={
        {
          stats: null,
          categorias: [],
          carregando: false,
          erro: null,
          erroDeCategoria: null,
          carregar: vi.fn(),
        } as never
      }
      active
      onNavigate={vi.fn()}
      aoVerSegmento={vi.fn()}
    />,
  );
  expect(texto(grupo("Receita")?.querySelector("h3") ?? null)).toContain(
    "R$ 12.345,67",
  );
  expect(grupo("Receita")?.querySelector(".sm\\:hidden")).not.toBeNull();
});

it("risco zero é neutro e não oferece ação; o risco positivo continua na primeira página", async () => {
  const { VisaoGeralDoCrm } = await import(
    "@/components/admin/crm/VisaoGeralDoCrm"
  );
  const props = {
    carregando: false,
    comparacao: "vs. 30 dias antes",
    classico: {
      stats: null,
      categorias: [],
      carregando: false,
      erro: null,
      erroDeCategoria: null,
      carregar: vi.fn(),
    } as never,
    active: true,
    onNavigate: vi.fn(),
    aoVerSegmento: vi.fn(),
  };
  await montar(
    <VisaoGeralDoCrm
      {...props}
      visao={{ ...dados, kpis: { ...dados.kpis, receitaEmRisco: 0 } }}
    />,
  );
  expect(texto(grupo("Receita em risco"))).toContain("R$ 0,00");
  expect(texto(grupo("Receita em risco"))).toContain(
    "Nenhum cliente nesse grupo agora",
  );
  expect(
    grupo("Receita em risco")?.querySelector("button:not([aria-haspopup])"),
  ).toBeNull();
  expect(grupo("Receita em risco")?.className).not.toContain(
    "border-amber-400",
  );
  await montar(<VisaoGeralDoCrm {...props} visao={dados} />);
  expect(grupo("Receita em risco")?.className).toContain("border-amber-400");
  expect(
    grupo("Receita em risco")?.closest('[aria-label="Cartão 2 de 6"]'),
  ).not.toBeNull();
});

it("erro sem cache reserva o resumo e oferece nova busca; offline preserva os números recebidos", async () => {
  const { VisaoGeralDoCrm } = await import(
    "@/components/admin/crm/VisaoGeralDoCrm"
  );
  const aoTentar = vi.fn();
  const props = {
    carregando: false,
    comparacao: "vs. 30 dias antes",
    classico: {
      stats: null,
      categorias: [],
      carregando: false,
      erro: null,
      erroDeCategoria: null,
      carregar: vi.fn(),
    } as never,
    active: true,
    onNavigate: vi.fn(),
    aoVerSegmento: vi.fn(),
    aoTentar,
  };
  await montar(
    <VisaoGeralDoCrm {...props} visao={null} erro="Falha fictícia" />,
  );
  expect(host.querySelector(".metricas-relatorio")?.className).toContain(
    "h-[148px]",
  );
  expect(host.textContent).toContain("Os números não carregaram");
  clicar("Tentar de novo");
  expect(aoTentar).toHaveBeenCalledTimes(1);
  await montar(<VisaoGeralDoCrm {...props} visao={dados} offline />);
  expect(host.textContent).toContain("Sem internet · números da última busca");
  expect(texto(grupo("Receita"))).toContain("R$ 170,88");
});

it("Funil conserva a conversão, as três etapas e as quantidades da fila", async () => {
  const { FunilEPedidosDoCrm } = await import(
    "@/components/admin/crm/FunilEPedidosDoCrm"
  );
  await montar(
    <FunilEPedidosDoCrm
      visao={dados}
      carregando={false}
      onNavigate={vi.fn()}
    />,
  );
  // O resumo repete etapas no desenho novo: a fotografia compara os valores únicos.
  expect(numeros(texto(host)).sort()).toMatchSnapshot();
});
