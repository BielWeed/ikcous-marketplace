import type { Plugin } from "vite";

/**
 * Escalas do gráfico: só as que o painel usa (15/10/2026, ~6 kB brotli a menos).
 *
 * O recharts 2.x escolhe a escala do eixo com um acesso DINÂMICO ao módulo
 * inteiro — `import * as d3Scales from "victory-vendor/d3-scale"` e, para um
 * eixo com `scale="<nome>"`, `d3Scales["scale" + Nome]` (ChartUtils.js,
 * `parseScale`). O Rollup não consegue provar quais nomes serão pedidos e
 * mantém o d3-scale INTEIRO: tempo, log, pow, sqrt, symlog, quantil, quantize,
 * threshold, sequencial, divergente, radial, identidade e, por trás deles, o
 * d3-time e o d3-time-format (locale incluso). Medido no build fixture de
 * 15/10/2026: tudo isso somado era ~6,5 kB brotli de painel que nenhuma tela
 * usa — o eixo dos três gráficos (OperationalPerformanceChart,
 * StrategicIntelligenceBlocks, FluxoDeCaixaGrafico) nunca passa `scale`, então
 * cai sempre no ramo `scale === "auto"` do `parseScale`, que só toca
 * `scaleBand`, `scaleLinear` e `scalePoint`.
 *
 * A troca é cirúrgica: SÓ o `ChartUtils.js` do recharts recebe, no lugar do
 * módulo inteiro, um módulo virtual que reexporta esses três nomes — os demais
 * importadores (o `Brush` pede `scalePoint` por nome) seguem o caminho normal.
 *
 * O QUE MUDA, e o que NÃO: o desenho dos gráficos é idêntico (teste compara o
 * SVG dos três gráficos com e sem o plugin). O que deixa de existir é o
 * atalho `scale="time"`/`"log"`/… num eixo: o recharts, sem o nome, cai em
 * `scalePoint` em silêncio. Por isso `tests/front/escalas-enxutas-do-grafico`
 * reprova se algum arquivo que usa o recharts passar `scale=` — quem precisar
 * de outra escala acrescenta o nome em `ESCALAS_DO_PAINEL` ao mesmo tempo.
 */
export const ESCALAS_DO_PAINEL = [
  "scaleBand",
  "scaleLinear",
  "scalePoint",
] as const;

const MODULO_COMPLETO = "victory-vendor/d3-scale";
const ID_VIRTUAL = "\0ikcous:escalas-enxutas-do-grafico";
const ARQUIVO_DO_RECHARTS =
  /[\\/]node_modules[\\/]recharts[\\/]es6[\\/]util[\\/]ChartUtils\.js$/;

/** Código do módulo virtual: reexporta SÓ os nomes do painel, a partir do
 * mesmo pacote — nenhuma dependência nova, nenhuma cópia de código do d3. */
export function codigoDoModuloEnxuto(): string {
  return `export { ${ESCALAS_DO_PAINEL.join(", ")} } from ${JSON.stringify(MODULO_COMPLETO)};\n`;
}

export function escalasEnxutasDoGrafico(): Plugin {
  return {
    name: "escalas-enxutas-do-grafico",
    enforce: "pre",
    resolveId(origem, importador) {
      if (origem !== MODULO_COMPLETO || importador === undefined) return null;
      return ARQUIVO_DO_RECHARTS.test(importador) ? ID_VIRTUAL : null;
    },
    load(id) {
      return id === ID_VIRTUAL ? codigoDoModuloEnxuto() : null;
    },
  };
}
