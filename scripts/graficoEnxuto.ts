import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * Recharts 2.15.4: elimina caminhos que nenhum gráfico do painel usa.
 *
 * Complementa escalasEnxutasDoGrafico (linear/band/point). Só o continuous.js
 * recebe interpolação numérica, com a mesma fórmula do d3-interpolate; o
 * tickFormat do d3 não é chamado pelo Recharts (ele usa tickFormatter).
 * As curvas linear e monotone X/Y continuam sendo as originais do d3.
 *
 * Os componentes vazios conservam nome, defaultProps e os métodos estáticos
 * consultados pelo Recharts mesmo quando não estão na árvore React. Não são
 * substitutos funcionais: as guardas em grafico-enxuto-contrato.test.ts
 * REPROVAM se o app começar a pedir um deles, outra curva ou escala/range.
 * A prova diferencial SVG cobre os três componentes reais, inclusive o
 * Sector ativo e o Label central das categorias. Ao atualizar a dependência,
 * revisar estes caminhos e repetir a prova antes de alterar a versão abaixo.
 */
const VERSAO_RECHARTS = "2.15.4";
const VERSAO_D3_SCALE = "4.0.2";
const INTERPOLADOR = "\0ikcous:interpolacao-numerica";
const CURVAS = "\0ikcous:curvas-do-painel";

function componenteVazio(nome: string, props = "{}"): string {
  return `
import { PureComponent } from "react";
export class ${nome} extends PureComponent { render() { return null; } }
${nome}.displayName = "${nome}";
${nome}.defaultProps = ${props};
`;
}

const CASCAS = new Map([
  [
    "recharts/es6/cartesian/Brush.js",
    componenteVazio("Brush", "{ height: 40 }"),
  ],
  [
    "recharts/es6/component/Legend.js",
    `${componenteVazio("Legend")}Legend.getWithHeight = () => ({});`,
  ],
  ["recharts/es6/cartesian/ErrorBar.js", componenteVazio("ErrorBar")],
  ["recharts/es6/cartesian/ReferenceArea.js", componenteVazio("ReferenceArea")],
  ["recharts/es6/cartesian/ReferenceDot.js", componenteVazio("ReferenceDot")],
  [
    "recharts/es6/shape/Symbols.js",
    "export const Symbols = () => null; Symbols.registerSymbol = () => {};",
  ],
  ["recharts/es6/shape/Trapezoid.js", "export const Trapezoid = () => null;"],
  [
    "d3-scale/src/tickFormat.js",
    'export default function tickFormat() { throw new Error("Use tickFormatter do Recharts; tickFormat do d3 não faz parte do painel."); }',
  ],
]);

const CODIGO_NUMERICO = `
export function interpolateNumber(a, b) {
  a = +a; b = +b;
  return t => a * (1 - t) + b * t;
}
export function interpolateRound(a, b) {
  a = +a; b = +b;
  return t => Math.round(a * (1 - t) + b * t);
}
export function interpolate(a, b) {
  return b == null || typeof b === "boolean" ? () => b : interpolateNumber(a, b);
}
`;

// O Recharts referencia esta tabela dinamicamente. Os nomes não usados ficam
// como aliases de linear; a guarda impede que virem uma mudança visual muda.
const CODIGO_CURVAS = `
import { curveLinear } from "victory-vendor/d3-shape";
export { line, area, curveLinear, curveMonotoneX, curveMonotoneY } from "victory-vendor/d3-shape";
export {
  curveLinear as curveBasisClosed, curveLinear as curveBasisOpen,
  curveLinear as curveBasis, curveLinear as curveBumpX,
  curveLinear as curveBumpY, curveLinear as curveLinearClosed,
  curveLinear as curveNatural, curveLinear as curveStep,
  curveLinear as curveStepAfter, curveLinear as curveStepBefore
};
`;

export function graficoEnxuto(): Plugin {
  return {
    name: "grafico-enxuto",
    enforce: "pre",
    buildStart() {
      const require = createRequire(import.meta.url);
      const { version } = require("recharts/package.json") as {
        version: string;
      };
      if (version !== VERSAO_RECHARTS) {
        throw new Error(
          `Gráfico enxuto: revisar substituições e prova SVG para Recharts ${version} (validado: ${VERSAO_RECHARTS}).`,
        );
      }
      // d3-scale não exporta package.json; resolver a entrada mantém a leitura
      // no pacote instalado, sem depender da posição de node_modules.
      // eslint-disable-next-line security/detect-non-literal-require -- Manifesto local do pacote fixo resolvido pelo Node, sem entrada de usuário.
      const d3 = require(
        path.resolve(
          path.dirname(require.resolve("d3-scale")),
          "../package.json",
        ),
      ) as { version: string };
      if (d3.version !== VERSAO_D3_SCALE) {
        throw new Error(
          `Gráfico enxuto: revisar substituições e prova SVG para d3-scale ${d3.version} (validado: ${VERSAO_D3_SCALE}).`,
        );
      }
    },
    resolveId(origem, importador) {
      const caminho = importador?.replaceAll("\\", "/");
      if (
        origem === "d3-interpolate" &&
        caminho?.endsWith("/node_modules/d3-scale/src/continuous.js")
      )
        return INTERPOLADOR;
      if (
        origem === "victory-vendor/d3-shape" &&
        caminho?.endsWith("/node_modules/recharts/es6/shape/Curve.js")
      )
        return CURVAS;
      return null;
    },
    load(id) {
      if (id === INTERPOLADOR) return CODIGO_NUMERICO;
      if (id === CURVAS) return CODIGO_CURVAS;
      const caminho = id.replaceAll("\\", "/").split("?")[0];
      for (const [sufixo, codigo] of CASCAS) {
        if (caminho.endsWith(`/node_modules/${sufixo}`)) return codigo;
      }
      return null;
    },
  };
}
