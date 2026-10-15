// Escalas do gráfico enxutas (15/10/2026, `scripts/escalasEnxutasDoGrafico.ts`).
//
// O plugin tira ~6 kB brotli do painel trocando, SÓ dentro do recharts, o
// módulo d3-scale inteiro por três nomes. Três coisas precisam continuar
// verdadeiras, e cada bloco abaixo cobre uma:
//
//   1. O plugin só mexe no importador certo (nada de escala sumindo do
//      `Brush`, nem do próprio módulo virtual — laço infinito).
//   2. NENHUM arquivo do app pede uma escala fora das três (`scale="time"`
//      cairia em silêncio em `scalePoint`) — o caso que dói.
//   3. O desenho dos gráficos (área, barra, pizza, eixo numérico e de
//      categoria) sai BYTE A BYTE igual com e sem o plugin, e o pacote de
//      verdade (Rollup) perde as escalas que ninguém usa.
/* eslint-disable security/detect-non-literal-fs-filename -- Só lê o `src/` deste repositório (raiz do teste + nomes vindos do próprio `readdirSync`), nunca texto de usuário. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite";
import { describe, expect, it } from "vitest";
import {
  ESCALAS_DO_PAINEL,
  codigoDoModuloEnxuto,
  escalasEnxutasDoGrafico,
} from "../../scripts/escalasEnxutasDoGrafico";

const RAIZ = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

// Os hooks do plugin são funções comuns; o tipo do Vite as embrulha em
// `ObjectHook`, então o teste chama por este contrato mínimo.
interface Ganchos {
  resolveId(origem: string, importador: string | undefined): unknown;
  load(id: string): unknown;
}
function ganchos(): Ganchos {
  return escalasEnxutasDoGrafico() as unknown as Ganchos;
}

const IMPORTADOR_DO_RECHARTS_POSIX =
  "C:/repo/node_modules/recharts/es6/util/ChartUtils.js";
const IMPORTADOR_DO_RECHARTS_WINDOWS =
  "C:\\repo\\node_modules\\recharts\\es6\\util\\ChartUtils.js";
const ESCALAS = "victory-vendor/d3-scale";

describe("escalasEnxutasDoGrafico — quem é redirecionado", () => {
  it("redireciona o d3-scale pedido pelo ChartUtils do recharts (caminho POSIX e Windows)", () => {
    const g = ganchos();
    const posix = g.resolveId(ESCALAS, IMPORTADOR_DO_RECHARTS_POSIX);
    const windows = g.resolveId(ESCALAS, IMPORTADOR_DO_RECHARTS_WINDOWS);
    expect(typeof posix).toBe("string");
    expect(windows).toBe(posix);
  });

  it("deixa o Brush, o app e o próprio módulo virtual no caminho normal", () => {
    const g = ganchos();
    const virtual = g.resolveId(ESCALAS, IMPORTADOR_DO_RECHARTS_POSIX);
    // O Brush importa `scalePoint` por NOME — continua com o módulo completo.
    expect(
      g.resolveId(
        ESCALAS,
        "C:/repo/node_modules/recharts/es6/cartesian/Brush.js",
      ),
    ).toBeNull();
    expect(g.resolveId(ESCALAS, "C:/repo/src/lib/qualquer.ts")).toBeNull();
    // O módulo virtual importa do pacote completo: se também fosse
    // redirecionado, o import dele apontaria para ele mesmo.
    expect(g.resolveId(ESCALAS, virtual as string)).toBeNull();
    // Importador desconhecido (ponto de entrada) e outros pacotes: intactos.
    expect(g.resolveId(ESCALAS, undefined)).toBeNull();
    expect(
      g.resolveId("victory-vendor/d3-shape", IMPORTADOR_DO_RECHARTS_POSIX),
    ).toBeNull();
  });

  it("só serve o código do próprio módulo virtual", () => {
    const g = ganchos();
    const virtual = g.resolveId(ESCALAS, IMPORTADOR_DO_RECHARTS_POSIX);
    expect(g.load(virtual as string)).toBe(codigoDoModuloEnxuto());
    expect(g.load("C:/repo/src/main.tsx")).toBeNull();
  });

  it("o módulo virtual reexporta exatamente as escalas do painel e nada mais", () => {
    expect(codigoDoModuloEnxuto()).toBe(
      'export { scaleBand, scaleLinear, scalePoint } from "victory-vendor/d3-scale";\n',
    );
    expect([...ESCALAS_DO_PAINEL]).toEqual([
      "scaleBand",
      "scaleLinear",
      "scalePoint",
    ]);
  });
});

function arquivosDeCodigo(pasta: string): string[] {
  const achados: string[] = [];
  for (const entrada of fs.readdirSync(pasta, { withFileTypes: true })) {
    const caminho = path.join(pasta, entrada.name);
    if (entrada.isDirectory()) achados.push(...arquivosDeCodigo(caminho));
    else if (/\.(ts|tsx)$/.test(entrada.name)) achados.push(caminho);
  }
  return achados;
}

describe("escalasEnxutasDoGrafico — o app não pede escala que ficou de fora", () => {
  it("nenhum arquivo que usa o recharts passa `scale` ao eixo", () => {
    const usam = arquivosDeCodigo(path.join(RAIZ, "src")).filter((arquivo) =>
      /from\s+["']recharts["']/.test(fs.readFileSync(arquivo, "utf8")),
    );
    // Se alguém trocar de biblioteca de gráfico, o teste precisa avisar em vez
    // de passar vazio.
    expect(usam.length).toBeGreaterThan(0);
    const comEscala = usam.filter((arquivo) =>
      /\bscale\s*[=:]/.test(fs.readFileSync(arquivo, "utf8")),
    );
    expect(
      comEscala.map((a) => path.relative(RAIZ, a)),
      "eixo com `scale` precisa de um nome em ESCALAS_DO_PAINEL (scripts/escalasEnxutasDoGrafico.ts); sem ele o recharts cai em scalePoint em silêncio",
    ).toEqual([]);
  });
});

// Entrada virtual: renderiza no servidor os mesmos tipos de gráfico das três
// telas (eixo de categoria + numérico, área, barra, pizza com fatias).
const ENTRADA = "virtual:renderiza-graficos";
const ID_DA_ENTRADA = `\0${ENTRADA}`;
const CODIGO_DA_ENTRADA = `
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ReferenceLine, XAxis, YAxis,
} from "recharts";

const dados = [
  { dia: "01/10", receita: 1200.5, custo: 800, saldo: 400.5 },
  { dia: "02/10", receita: 0, custo: 150, saldo: -150 },
  { dia: "03/10", receita: 3100, custo: 900, saldo: 2200 },
  { dia: "04/10", receita: 450.25, custo: 460, saldo: -9.75 },
  { dia: "05/10", receita: 2100, custo: 700, saldo: 1400 },
];
const fatias = [
  { name: "Roupas", value: 4200 },
  { name: "Calcados", value: 1900 },
  { name: "Acessorios", value: 640 },
];
const tamanho = { width: 520, height: 260, data: dados };
const sem = { isAnimationActive: false };

export function renderiza() {
  const area = h(AreaChart, tamanho,
    h(CartesianGrid, { strokeDasharray: "3 3" }),
    h(XAxis, { dataKey: "dia" }),
    h(YAxis, null),
    h(ReferenceLine, { y: 0 }),
    h(Area, { type: "monotone", dataKey: "saldo", ...sem }));
  const barra = h(BarChart, tamanho,
    h(XAxis, { dataKey: "dia" }),
    h(YAxis, { tickFormatter: (v) => "R$ " + v }),
    h(Bar, { dataKey: "receita", ...sem }),
    h(Bar, { dataKey: "custo", ...sem }));
  const pizza = h(PieChart, { width: 320, height: 260 },
    h(Pie, { data: fatias, dataKey: "value", nameKey: "name", innerRadius: 60, outerRadius: 100, ...sem },
      fatias.map((f, i) => h(Cell, { key: i, fill: ["#10b981", "#f43f5e", "#f9c406"][i] }))));
  return [area, barra, pizza].map((g) => renderToStaticMarkup(g));
}
// O build de app do Vite descarta os exports do ponto de entrada; pendurar a
// função num global é o que impede o Rollup de podar a entrada inteira.
globalThis.__renderizaGraficos = renderiza;
`;

function plugins(comEnxuto: boolean) {
  return [
    ...(comEnxuto ? [escalasEnxutasDoGrafico()] : []),
    {
      name: "entrada-virtual-dos-graficos",
      resolveId: (id: string) => (id === ENTRADA ? ID_DA_ENTRADA : null),
      load: (id: string) => (id === ID_DA_ENTRADA ? CODIGO_DA_ENTRADA : null),
    },
  ];
}

async function renderizar(comEnxuto: boolean): Promise<string[]> {
  const servidor = await createServer({
    root: RAIZ,
    configFile: false,
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { noExternal: ["recharts", "victory-vendor", /^d3-/] },
    plugins: plugins(comEnxuto),
  });
  try {
    const modulo = (await servidor.ssrLoadModule(ID_DA_ENTRADA)) as {
      renderiza: () => string[];
    };
    return modulo.renderiza();
  } finally {
    await servidor.close();
  }
}

// O build de verdade (Rollup) é quem poda: devolve só os módulos que ficaram
// com código no pacote final.
async function modulosNoPacote(comEnxuto: boolean): Promise<string[]> {
  const saida = await build({
    root: RAIZ,
    configFile: false,
    logLevel: "silent",
    plugins: plugins(comEnxuto),
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: ENTRADA,
        external: ["react", "react-dom/server"],
      },
    },
  });
  const rodadas = Array.isArray(saida) ? saida : [saida];
  const ids: string[] = [];
  for (const rodada of rodadas)
    for (const item of "output" in rodada ? rodada.output : [])
      if (item.type === "chunk")
        for (const [id, modulo] of Object.entries(item.modules))
          if (modulo.renderedLength > 0) ids.push(id.replaceAll("\\", "/"));
  return ids;
}

// O recharts numera `clipPath` com um contador global (`recharts1-clip`);
// o número depende de quantos gráficos já nasceram no processo, não do desenho.
const semContador = (svg: string) => svg.replace(/recharts\d+/g, "recharts#");

describe("escalasEnxutasDoGrafico — o desenho não muda", () => {
  it("área, barra e pizza saem byte a byte iguais com e sem o plugin", async () => {
    const completo = await renderizar(false);
    const enxuto = await renderizar(true);
    expect(enxuto).toHaveLength(3);
    for (const svg of enxuto) expect(svg).toContain("<svg");
    expect(enxuto.map(semContador)).toEqual(completo.map(semContador));
  }, 60_000);

  it("o pacote perde as escalas que ninguém usa e guarda as que o `auto` toca", async () => {
    const completo = await modulosNoPacote(false);
    const enxuto = await modulosNoPacote(true);
    const tem = (ids: string[], nome: string) =>
      ids.some((id) => id.endsWith(`/d3-scale/src/${nome}.js`));
    const SEM_USO = ["time", "log", "pow", "sequential", "quantile"];
    // Sem o plugin o recharts arrasta o d3-scale inteiro...
    for (const nome of SEM_USO) expect(tem(completo, nome), nome).toBe(true);
    // ...com ele, só o que o `parseScale` toca no modo `auto`.
    for (const nome of SEM_USO) expect(tem(enxuto, nome), nome).toBe(false);
    // `scalePoint` mora em band.js; as duas escalas de categoria usam ordinal.js.
    for (const nome of ["band", "linear", "ordinal"])
      expect(tem(enxuto, nome), nome).toBe(true);
  }, 60_000);
});
