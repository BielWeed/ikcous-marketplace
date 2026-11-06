// @vitest-environment jsdom
// "Receita em risco" soma DOIS grupos do banco (em_risco = "Podem não voltar" e
// nao_pode_perder = "Bons clientes sumindo"), mas o atalho do cartão só abria
// o primeiro: a lojista não alcançava os bons clientes sumindo, que são a maior
// parte do dinheiro. Agora, quando esse grupo tem clientes, há um segundo atalho.
import { lerVisaoDoCrm } from "@/lib/crm";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja fictícia" } }),
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

const kpis = {
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
  receita_em_risco: 2200,
  taxa_devolucao: 0.025,
};
const base = {
  kpis,
  canais: [],
  formas: [],
  funil: {
    visitas: null,
    produtos_vistos: null,
    carrinhos: 6,
    pedidos_criados: 7,
    pedidos_pagos: 5,
  },
  pipeline: [],
};
const comOsDoisGrupos = lerVisaoDoCrm({
  ...base,
  segmentos: [
    { segmento: "em_risco", clientes: 2, receita: 400 },
    { segmento: "nao_pode_perder", clientes: 3, receita: 1800 },
  ],
})!;
const soEmRisco = lerVisaoDoCrm({
  ...base,
  segmentos: [{ segmento: "em_risco", clientes: 2, receita: 2200 }],
})!;
const sumindoVazio = lerVisaoDoCrm({
  ...base,
  segmentos: [
    { segmento: "em_risco", clientes: 2, receita: 2200 },
    { segmento: "nao_pode_perder", clientes: 0, receita: 0 },
  ],
})!;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const texto = (e: Element) => (e.textContent ?? "").replace(/\s+/g, " ").trim();
const botoes = () => [...host.querySelectorAll("button")];
const botao = (nome: string) => botoes().find((b) => texto(b) === nome);

async function montar(
  visao: typeof comOsDoisGrupos | null,
  aoVerSegmento = vi.fn(),
) {
  const { VisaoGeralDoCrm } = await import(
    "@/components/admin/crm/VisaoGeralDoCrm"
  );
  await act(async () =>
    root.render(
      <VisaoGeralDoCrm
        visao={visao}
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
        aoVerSegmento={aoVerSegmento}
      />,
    ),
  );
  return aoVerSegmento;
}

it("com 'Bons clientes sumindo' tendo clientes: há dois atalhos, cada um abre o seu grupo", async () => {
  const aoVerSegmento = await montar(comOsDoisGrupos);
  const primeiro = botao("Ver quem pode não voltar");
  const segundo = botao("Ver bons clientes sumindo");
  expect(primeiro).toBeTruthy();
  expect(segundo).toBeTruthy();
  act(() => primeiro!.click());
  expect(aoVerSegmento).toHaveBeenLastCalledWith("em_risco");
  act(() => segundo!.click());
  expect(aoVerSegmento).toHaveBeenLastCalledWith("nao_pode_perder");
  expect(aoVerSegmento).toHaveBeenCalledTimes(2);
});

it("o aviso diz que a receita em risco soma os dois grupos", async () => {
  await montar(comOsDoisGrupos);
  expect(host.textContent).toContain("Podem não voltar");
  expect(host.textContent).toContain("Bons clientes sumindo");
});

it("sem o grupo (ausente ou com zero clientes): só o primeiro atalho, sem o segundo", async () => {
  await montar(soEmRisco);
  expect(botao("Ver quem pode não voltar")).toBeTruthy();
  expect(botao("Ver bons clientes sumindo")).toBeUndefined();
  await montar(sumindoVazio);
  expect(botao("Ver quem pode não voltar")).toBeTruthy();
  expect(botao("Ver bons clientes sumindo")).toBeUndefined();
});

it("sem dados da visão, nenhum dos atalhos aparece", async () => {
  await montar(null);
  expect(botao("Ver bons clientes sumindo")).toBeUndefined();
});
