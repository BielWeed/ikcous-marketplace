import { createRequire } from "node:module";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { graficoEnxuto } from "../../scripts/graficoEnxuto";

interface Ganchos {
  resolveId(origem: string, importador?: string): string | null;
  load(id: string): string | null;
}
const raiz = "C:/repo/node_modules/";
const arquivo = "d3-scale/src/continuous.js";

describe("gráfico enxuto — fronteiras da substituição", () => {
  it("só troca o interpolador do continuous.js, sem laço no módulo virtual", () => {
    const g = graficoEnxuto() as unknown as Ganchos;
    const id = g.resolveId("d3-interpolate", raiz + arquivo);
    expect(id).toEqual(expect.any(String));
    expect(
      g.resolveId("d3-interpolate", (raiz + arquivo).replaceAll("/", "\\")),
    ).toBe(id);
    expect(g.resolveId("d3-interpolate", id!)).toBeNull();
    expect(g.resolveId("d3-interpolate", "C:/repo/src/grafico.ts")).toBeNull();
    expect(g.resolveId("d3-interpolate")).toBeNull();
    expect(g.load("C:/repo/src/cartesian/Brush.js")).toBeNull();
    expect(g.load(`${raiz}recharts/es6/shape/Sector.js`)).toBeNull();
    expect(g.load(`${raiz}recharts/es6/component/Label.js`)).toBeNull();
    expect(g.load(`${raiz}recharts/es6/cartesian/ReferenceLine.js`)).toBeNull();
  });

  it.each([
    "Brush",
    "Legend",
    "ErrorBar",
    "ReferenceArea",
    "ReferenceDot",
    "Symbols",
    "Trapezoid",
  ])(
    "%s continua exportado e identificável, mas sem implementação morta",
    (nome) => {
      const g = graficoEnxuto() as unknown as Ganchos;
      const pasta = ["Legend"].includes(nome)
        ? "component"
        : ["Symbols", "Trapezoid"].includes(nome)
          ? "shape"
          : "cartesian";
      const codigo = g.load(`${raiz}recharts/es6/${pasta}/${nome}.js`);
      expect(codigo).toContain(nome);
      expect(codigo).toContain("null");
    },
  );
});

const ENTRADA = "virtual:escala-numerica";
const ID = `\0${ENTRADA}`;
const CODIGO = `
import { scaleLinear } from "victory-vendor/d3-scale";
export function medir() {
 const dominios = [[0,1],[-123.45,987.65],[0,0],[10,-10],[0,0.1,1000],[-1e8,1e8]];
 return dominios.flatMap(domain => [[0,520],[520,0],[-3.5,271.25]].map(range => {
  const s = scaleLinear(domain,range);
  const valores = [-1e8,-200,-1,-0.01,0,0.1,1,10,55.5,1000,1e8];
  const capturar = f => valores.map(x => [f(x),f.invert(x)]);
  return [capturar(s),s.ticks(7),capturar(s.copy().clamp(true)),capturar(s.copy().rangeRound(range)),s(null),s(NaN),s.copy().unknown("vazio")(NaN)];
 }));
}
`;

async function medir(enxuto: boolean) {
  const saida = await build({
    configFile: false,
    envFile: false,
    logLevel: "silent",
    plugins: [
      ...(enxuto ? [graficoEnxuto()] : []),
      {
        name: "escala-numerica",
        resolveId: (id) => (id === ENTRADA ? ID : null),
        load: (id) => (id === ID ? CODIGO : null),
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry: ENTRADA, formats: ["cjs"] },
      rollupOptions: { input: ENTRADA },
    },
  });
  const rodada = Array.isArray(saida) ? saida[0] : saida;
  if (!("output" in rodada)) throw new Error("Build sem saída");
  const chunk = rodada.output.find((c) => c.type === "chunk")!;
  const modulo = { exports: {} as { medir: () => unknown } };
  new Function("require", "module", "exports", chunk.code)(
    createRequire(import.meta.url),
    modulo,
    modulo.exports,
  );
  return modulo.exports.medir();
}

describe("gráfico enxuto — números preservados", () => {
  it("mantém interpolação, inversa, ticks, cópia, clamp e arredondamento em domínios variados", async () => {
    expect(await medir(true)).toEqual(await medir(false));
  }, 30_000);
});
