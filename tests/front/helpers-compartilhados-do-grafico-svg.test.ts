import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ReactNode, act } from "react";
import { createRoot } from "react-dom/client";
import { build } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escalasEnxutasDoGrafico } from "../../scripts/escalasEnxutasDoGrafico";
import { graficoEnxuto } from "../../scripts/graficoEnxuto";
import { helpersCompartilhadosDoGrafico } from "../../scripts/helpersCompartilhadosDoGrafico";

const RAIZ = fileURLToPath(new URL("../..", import.meta.url));
const ENTRADA = "virtual:prova-svg-dos-helpers";
const ID = `\0${ENTRADA}`;
// jsdom já é dependência do projeto; seus tipos não são. Contrato mínimo
// local evita adicionar @types/jsdom apenas para esta prova de build.
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (
    html: string,
    opcoes: { pretendToBeVisual: boolean; url: string },
  ) => {
    window: Window & typeof globalThis;
  };
};
let dom: InstanceType<typeof JSDOM>;
// Importa os componentes REAIS. O composto adicional exercita Line e Pie,
// além do monotone e stackOffset="sign" usados pelo FluxoDeCaixaGrafico.
const CODIGO = `
import { createElement as h, Fragment } from 'react';
import { FluxoDeCaixaGrafico } from '@/components/admin/financeiro/FluxoDeCaixaGrafico';
import { OperationalPerformanceChart } from '@/components/admin/dashboard/OperationalPerformanceChart';
import { StrategicIntelligenceBlocks } from '@/components/admin/dashboard/StrategicIntelligenceBlocks';
import { Area, Bar, Cell, ComposedChart, Line, Pie, PieChart, Tooltip, XAxis, YAxis } from 'recharts';
const pontos = [
 {dia:'2026-08-29',entradas:120,saidas:80,resultado:40,saldo:null},
 {dia:'2026-08-30',entradas:10,saidas:60,resultado:-50,saldo:-50},
 {dia:'2026-08-31',entradas:200,saidas:20,resultado:180,saldo:130},
 {dia:'2026-09-01',entradas:25,saidas:40,resultado:-15,saldo:115},
];
const stats = { inventory:{totalCost:500}, productsWithoutCost:0, revenueHistory:pontos.map(p => ({date:p.dia, full_date:p.dia,revenue:p.entradas,cost_sold:p.saidas,profit:p.resultado,orders:2})) };
export function tela() {
 return h(Fragment, null,
  h('section', {id:'fluxo'}, h(FluxoDeCaixaGrafico, {pontos,carregando:false,ativo:true,marco:'2026-08-30'})),
  h('section', {id:'operacional'}, h(OperationalPerformanceChart, {stats,loading:false,active:true})),
  h('section', {id:'categorias'}, h(StrategicIntelligenceBlocks, {categoryData:[{name:'roupas',value:300},{name:'calcados',value:200},{name:'acessorios',value:100}],loading:false,active:true})),
  h('section', {id:'composto'}, h(ComposedChart, {width:520,height:300,data:pontos,stackOffset:'sign'},
   h(XAxis,{dataKey:'dia'}),h(YAxis),h(Tooltip),
   h(Area,{type:'monotone',dataKey:'saldo',isAnimationActive:false,activeDot:{r:5}}),
   h(Bar,{dataKey:'entradas',isAnimationActive:false}),
   h(Line,{type:'monotone',dataKey:'resultado',isAnimationActive:false,activeDot:{r:6}}))),
  h('section', {id:'pizza'}, h(PieChart,{width:320,height:300},
   h(Tooltip),h(Pie,{data:pontos,dataKey:'entradas',nameKey:'dia',innerRadius:40,outerRadius:90,isAnimationActive:false},
    pontos.map((_,i)=>h(Cell,{key:i,fill:['red','blue','green','gold'][i]})))))
 );
}
`;

async function compilar(
  comPlugin: boolean,
  enxuto = false,
  setorQuebrado = false,
) {
  let transformados = 0;
  const plugin = helpersCompartilhadosDoGrafico();
  const transform = plugin.transform as (
    codigo: string,
    id: string,
  ) => { code: string } | null;
  plugin.transform = (codigo, id) => {
    const resultado = transform(codigo, id);
    if (resultado) transformados++;
    return resultado;
  };
  const saida = await build({
    root: RAIZ,
    configFile: false,
    envFile: false,
    logLevel: "silent",
    resolve: {
      alias: [
        { find: "@", replacement: path.join(RAIZ, "src") },
        { find: /^lodash\/(.*)$/, replacement: "lodash-es/$1" },
      ],
    },
    esbuild: { jsx: "automatic" },
    plugins: [
      escalasEnxutasDoGrafico(),
      ...(comPlugin ? [plugin] : []),
      ...(enxuto ? [graficoEnxuto()] : []),
      // Controle negativo: comprova que a captura enxerga perder o Sector real.
      ...(setorQuebrado
        ? [
            {
              name: "controle-negativo-sector",
              enforce: "pre" as const,
              load(id: string) {
                return /\/recharts\/es6\/shape\/Sector\.js$/.test(
                  id.replaceAll("\\", "/"),
                )
                  ? "export const Sector = () => null;"
                  : null;
              },
            },
          ]
        : []),
      {
        name: "entrada-svg",
        resolveId: (id) => (id === ENTRADA ? ID : null),
        load: (id) => (id === ID ? CODIGO : null),
      },
    ],
    build: {
      write: false,
      minify: false,
      target: "esnext",
      lib: { entry: ENTRADA, formats: ["cjs"] },
      rollupOptions: {
        input: ENTRADA,
        external: [
          "react",
          "react/jsx-runtime",
          "react-dom",
          "react-dom/client",
        ],
      },
    },
  });
  if (comPlugin) expect(transformados).toBeGreaterThan(20);
  const rodadas = Array.isArray(saida) ? saida : [saida];
  const chunks = rodadas.flatMap((r) =>
    "output" in r ? r.output.filter((c) => c.type === "chunk") : [],
  );
  expect(chunks).toHaveLength(1);
  if (enxuto) {
    const vivos = Object.entries(chunks[0].modules)
      .filter(([, modulo]) => modulo.renderedLength > 0)
      .map(([id]) => id.replaceAll("\\", "/"));
    expect(
      vivos.filter((id) =>
        /\/node_modules\/(d3-color|d3-interpolate|d3-format)\//.test(id),
      ),
    ).toEqual([]);
    expect(
      vivos.filter((id) =>
        /\/d3-shape\/src\/(curve\/(basis|step|natural|bump)|symbol)/.test(id),
      ),
    ).toEqual([]);
  }
  const modulo = { exports: {} as { tela: () => ReactNode } };
  new Function("require", "module", "exports", chunks[0].code)(
    createRequire(import.meta.url),
    modulo,
    modulo.exports,
  );
  return modulo.exports.tela;
}

beforeEach(() => {
  // Build no ambiente Node: o TextEncoder nativo e o Uint8Array do jsdom
  // pertencem a realms diferentes e violam uma invariante do esbuild.
  // Instala apenas as APIs de layout que os componentes precisam.
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost",
  });
  for (const nome of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Element",
    "SVGElement",
    "MouseEvent",
  ] as const) {
    // eslint-disable-next-line security/detect-object-injection -- Nomes fechados de APIs do DOM definidos logo acima.
    vi.stubGlobal(nome, nome === "window" ? dom.window : dom.window[nome]);
  }
  vi.stubGlobal(
    "getComputedStyle",
    dom.window.getComputedStyle.bind(dom.window),
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    dom.window.requestAnimationFrame.bind(dom.window),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    dom.window.cancelAnimationFrame.bind(dom.window),
  );
  // Mesmo layout controlado dos testes financeiros existentes; a biblioteca
  // e os componentes não são mockados. matchMedia móvel desliga animação do CRM.
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  dom.window.matchMedia = () =>
    ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }) as unknown as MediaQueryList;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 520,
    height: 300,
    left: 0,
    top: 0,
    right: 520,
    bottom: 300,
    x: 0,
    y: 0,
    toJSON() {},
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(520);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(300);
});

afterEach(() => {
  vi.useRealTimers();
  dom.window.close();
});

function capturar(tela: () => ReactNode, movel = true) {
  vi.useFakeTimers();
  dom.window.matchMedia = () =>
    ({
      matches: movel,
      addEventListener() {},
      removeEventListener() {},
    }) as unknown as MediaQueryList;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const quadros: string[][] = [];
  const concluirAnimacao = () => {
    if (!movel)
      act(() => {
        vi.advanceTimersByTime(4000);
      });
  };
  // Só o contador global de IDs do Recharts é normalizado, como na prova
  // das escalas. Caminhos, atributos, números, cores e texto ficam intactos.
  const registrar = () =>
    quadros.push(
      [
        ...container.querySelectorAll(
          ".recharts-surface, .recharts-tooltip-wrapper",
        ),
      ].map((n) => n.outerHTML.replace(/recharts\d+/g, "recharts#")),
    );
  function mover(seletor: string) {
    const grafico = container.querySelector(seletor);
    expect(grafico).toBeTruthy();
    act(() => {
      grafico!.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 240,
          clientY: 100,
        }),
      );
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
  }
  try {
    act(() => {
      root.render(tela());
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    // No desktop os componentes reais mantêm a animação de entrada. Ela só
    // começa depois de o gráfico sair do esqueleto; avança numa etapa separada.
    concluirAnimacao();
    expect(container.querySelectorAll("#fluxo .recharts-surface")).toHaveLength(
      2,
    );
    expect(
      container.querySelectorAll("#operacional .recharts-surface"),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll(".recharts-bar-rectangle").length,
    ).toBeGreaterThan(0);
    expect(
      container.querySelectorAll(".recharts-area-area").length,
    ).toBeGreaterThan(0);
    expect(
      container.querySelectorAll(".recharts-line-curve").length,
    ).toBeGreaterThan(0);
    expect(
      container.querySelectorAll("#pizza .recharts-pie-sector"),
    ).toHaveLength(4);
    expect(
      container.querySelectorAll("#categorias .recharts-pie-sector"),
    ).toHaveLength(3);
    expect(
      container.querySelectorAll("#categorias path.recharts-sector"),
    ).toHaveLength(3);
    expect(
      container.querySelector("#categorias svg.recharts-surface")?.textContent,
    ).toContain("Total");
    expect(
      container.querySelector("#categorias svg.recharts-surface")?.textContent,
    ).toContain("600,00");
    registrar();
    mover("#fluxo .recharts-wrapper:last-child");
    expect(
      container.querySelectorAll('[data-testid="fluxo-tooltip"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll("#fluxo .recharts-active-dot").length,
    ).toBeGreaterThan(0);
    registrar();
    mover("#composto .recharts-wrapper");
    expect(
      container.querySelectorAll("#composto .recharts-active-dot").length,
    ).toBeGreaterThan(0);
    registrar();
    mover("#operacional .recharts-wrapper");
    registrar();
    act(() => {
      container
        .querySelectorAll(".recharts-pie-sector")[0]
        .dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    registrar();
    const fatia = container.querySelector("#categorias .recharts-pie-sector")!;
    act(() => {
      fatia.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(
      container.querySelector("#categorias .recharts-active-shape path"),
    ).toBeTruthy();
    expect(
      container.querySelector("#categorias svg.recharts-surface")?.textContent,
    ).toContain("Roupas");
    expect(
      container.querySelector("#categorias svg.recharts-surface")?.textContent,
    ).toContain("(50.0%)");
    registrar();
    act(() => {
      fatia.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      vi.advanceTimersByTime(200);
    });
    expect(
      container.querySelector("#categorias svg.recharts-surface")?.textContent,
    ).toContain("Total");
    registrar();
    const ocultar = container.querySelector<HTMLButtonElement>(
      '#categorias button[title="Ocultar do gráfico"]',
    )!;
    act(() => ocultar.click());
    concluirAnimacao();
    expect(
      container.querySelectorAll("#categorias path.recharts-sector"),
    ).toHaveLength(2);
    expect(
      container.querySelector("#categorias svg.recharts-surface")?.textContent,
    ).toContain("300,00");
    registrar();
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '#categorias button[title="Mostrar no gráfico"]',
        )!
        .click(),
    );
    concluirAnimacao();
    expect(
      container.querySelectorAll("#categorias path.recharts-sector"),
    ).toHaveLength(3);
    registrar();
    const roi = [
      ...container.querySelectorAll<HTMLButtonElement>("#operacional button"),
    ].find((b) => b.textContent?.includes("Retorno do estoque"));
    expect(roi).toBeTruthy();
    act(() => {
      roi!.click();
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    concluirAnimacao();
    expect(
      container.querySelectorAll("#operacional .recharts-area-area").length,
    ).toBeGreaterThan(0);
    mover("#operacional .recharts-wrapper");
    registrar();
    return quadros;
  } finally {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  }
}

describe("helpers compartilhados — SVG dos gráficos reais", () => {
  it("fluxo, CRM, barra/linha/área/pizza e interação têm SVG e tooltip idênticos com e sem o plugin", async () => {
    const original = await compilar(false);
    const compartilhado = await compilar(true);
    expect(capturar(compartilhado)).toEqual(capturar(original));
  }, 120_000);

  it("a economia remove os módulos não usados sem mudar SVG, tooltip, activeShape ou Label central", async () => {
    const original = await compilar(true);
    const enxuto = await compilar(true, true);
    for (const movel of [true, false]) {
      expect(capturar(enxuto, movel)).toEqual(capturar(original, movel));
    }
  }, 120_000);

  it("controle negativo: perder Sector é detectado pela pizza real de categorias", async () => {
    const quebrado = await compilar(true, false, true);
    expect(() => capturar(quebrado)).toThrow();
  }, 120_000);
});
