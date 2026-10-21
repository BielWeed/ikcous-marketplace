// @vitest-environment jsdom
import { CanaisDoCrm } from "@/components/admin/crm/CanaisDoCrm";
import { ClientesDoCrm } from "@/components/admin/crm/ClientesDoCrm";
import { FunilEPedidosDoCrm } from "@/components/admin/crm/FunilEPedidosDoCrm";
import { VisaoGeralDoCrm } from "@/components/admin/crm/VisaoGeralDoCrm";
import { lerVisaoDoCrm } from "@/lib/crm";
import { type ReactNode, act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@/components/admin/dashboard/OperationalPerformanceChart", () => ({
  OperationalPerformanceChart: () => null,
}));
vi.mock("@/components/admin/dashboard/StrategicIntelligenceBlocks", () => ({
  StrategicIntelligenceBlocks: () => null,
}));
vi.mock("@/components/admin/dashboard/TopProductsList", () => ({
  TopProductsList: () => null,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja fictícia" } }),
}));
vi.mock("@/hooks/useCrm", () => ({
  useCrmClientes: () => ({
    lista: { total: 23, clientes: [] },
    carregando: false,
    erro: null,
    atualizar: vi.fn(),
  }),
}));
vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn(), undefined],
}));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const visao = lerVisaoDoCrm({
  kpis: { receita: 170.88, pedidos: 9 },
  canais: [
    { canal: "online", receita: 170.88, pedidos: 9, ticket_medio: 18.99 },
  ],
  funil: { carrinhos: 6, pedidos_criados: 7, pedidos_pagos: 5 },
  formas: [{ forma: "pix", receita: 170.88, pedidos: 9 }],
  pipeline: [],
  segmentos: [
    { segmento: "em_risco", clientes: 3, receita: 170.88 },
    { segmento: "campeoes", clientes: 4, receita: 200 },
    { segmento: "novos", clientes: 2, receita: 50 },
    { segmento: "pediu_nao_pagou", clientes: 1, receita: 70 },
  ],
})!;
const classico = {
  stats: null,
  categorias: [],
  carregando: false,
  erro: null,
  erroDeCategoria: null,
  carregar: vi.fn(),
};
const abas = [
  [
    "Visão",
    (props: {
      visao: typeof visao | null;
      erro: string;
      aoTentar: () => void;
      offline?: boolean;
    }) => (
      <VisaoGeralDoCrm
        {...props}
        carregando={false}
        comparacao=""
        classico={classico}
        active
        onNavigate={vi.fn()}
        aoVerSegmento={vi.fn()}
      />
    ),
    "170,88",
  ],
  [
    "Canais",
    (props: {
      visao: typeof visao | null;
      erro: string;
      aoTentar: () => void;
      offline?: boolean;
    }) => <CanaisDoCrm {...props} carregando={false} onNavigate={vi.fn()} />,
    "170,88",
  ],
  [
    "Funil",
    (props: {
      visao: typeof visao | null;
      erro: string;
      aoTentar: () => void;
      offline?: boolean;
    }) => (
      <FunilEPedidosDoCrm {...props} carregando={false} onNavigate={vi.fn()} />
    ),
    "5 de 7",
  ],
  [
    "Clientes",
    ({
      visao,
      ...props
    }: {
      visao: ReturnType<typeof lerVisaoDoCrm>;
      erro: string;
      aoTentar: () => void;
      offline?: boolean;
    }) => (
      <ClientesDoCrm
        {...props}
        segmentos={visao?.segmentos ?? []}
        segmentosDisponiveis={visao != null}
        carregandoSegmentos={false}
        segmento={null}
        aoMudarSegmento={vi.fn()}
        active
        onNavigate={vi.fn()}
        sinalDeAtualizacao={0}
      />
    ),
    "Melhores clientes 4",
  ],
] as const;

async function montar(
  node: ReactNode,
  verificar: (host: HTMLDivElement) => Promise<void> | void,
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(node));
    await verificar(host);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
}

it.each(abas)(
  "%s: erro com cache avisa e conserva os números",
  async (_nome, render, numero) => {
    const tentar = vi.fn();
    await montar(
      render({ visao, erro: "Falha de rede", aoTentar: tentar }),
      async (host) => {
        const aviso = host.querySelector('[role="alert"]');
        expect(aviso?.textContent).toContain(
          "Não deu para atualizar · mostrando a última busca",
        );
        expect(host.textContent).toContain(numero);
        const botao = [...aviso!.querySelectorAll("button")].find((b) =>
          b.textContent?.includes("Tentar de novo"),
        );
        expect(botao).toBeDefined();
        await act(async () => botao!.click());
        expect(tentar).toHaveBeenCalledOnce();
      },
    );
  },
);

it.each(abas.slice(1))(
  "%s: erro sem cache não inventa estado vazio",
  async (_nome, render) => {
    await montar(
      render({ visao: null, erro: "Falha de rede", aoTentar: vi.fn() }),
      (host) => {
        expect(host.textContent).toContain("Não deu para buscar os números");
        for (const frase of [
          "Nenhum pedido em aberto",
          "A fila está em dia",
          "Ainda não há dados do funil do app",
          "Nenhuma venda pelo app neste período",
          "Nenhuma venda pela loja física neste período",
          "Sem pagamentos registrados",
        ])
          expect(host.textContent).not.toContain(frase);
      },
    );
  },
);

it("Clientes: sem resumo dos grupos, pílulas mostram desconhecido, não zero", async () => {
  await montar(
    abas[3][1]({ visao: null, erro: "Falha de rede", aoTentar: vi.fn() }),
    (host) => {
      const filtros = host.querySelector('[aria-label="Filtrar por grupo"]')!;
      for (const nome of ["Melhores clientes", "Podem não voltar", "Novos"]) {
        const pilula = [...filtros.querySelectorAll("button")].find((b) =>
          b.textContent?.includes(nome),
        );
        expect(pilula?.textContent).toContain("—");
        expect(pilula?.textContent).not.toMatch(/\b0\b/);
      }
    },
  );
});

it.each(abas)(
  "%s: offline com cache continua com o aviso de internet",
  async (_nome, render, numero) => {
    await montar(
      render({
        visao,
        erro: "Falha de rede",
        offline: true,
        aoTentar: vi.fn(),
      }),
      (host) => {
        expect(host.textContent).toContain(
          "Sem internet · números da última busca",
        );
        expect(host.textContent).not.toContain("Não deu para atualizar");
        expect(host.textContent).toContain(numero);
      },
    );
  },
);
