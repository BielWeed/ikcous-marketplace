/* eslint-disable security/detect-non-literal-fs-filename -- Lê somente o Recharts instalado no repositório. */
import fs from "node:fs";
import { rollup } from "rollup";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { helpersCompartilhadosDoGrafico } from "../../scripts/helpersCompartilhadosDoGrafico";
import { classificarBundle } from "../../scripts/portaoDividido";

const BASE = "/repo/node_modules/recharts/es6/";
const CHECK =
  'function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }';

async function empacotar(
  modulos: Record<string, string>,
  entrada = `${BASE}entrada.js`,
) {
  const plugin = helpersCompartilhadosDoGrafico();
  const fontes = new Map(Object.entries(modulos));
  const pacote = await rollup({
    input: entrada,
    plugins: [
      plugin,
      {
        name: "fixtures-do-recharts",
        resolveId: (id) => (fontes.has(id) ? id : null),
        load: (id) => fontes.get(id) ?? null,
      },
    ],
  });
  try {
    const { output } = await pacote.generate({ format: "es" });
    expect(output).toHaveLength(1);
    const item = output[0];
    if (item.type !== "chunk") throw new Error("Esperava JavaScript");
    return { codigo: item.code, modulos: Object.keys(item.modules) };
  } finally {
    await pacote.close();
  }
}

const executar = (codigo: string) =>
  import(
    /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(codigo).toString("base64")}`
  );

function copias(codigo: string, nome: string) {
  return ts
    .createSourceFile(
      "pacote.js",
      codigo,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    )
    .statements.filter(
      (n) => ts.isFunctionDeclaration(n) && n.name?.text === nome,
    ).length;
}

describe("helpersCompartilhadosDoGrafico", () => {
  it("compartilha uma única definição aprovada entre módulos, mesmo com espaços/comentários diferentes", async () => {
    const { codigo } = await empacotar({
      [`${BASE}a.js`]: `${CHECK}\nexport function a(v, C) { _classCallCheck(v, C); return 1; }`,
      [`${BASE}b.js`]: `${CHECK.replace("if (", "/* babel */ if (\n")}\nexport function b(v, C) { _classCallCheck(v, C); return 2; }`,
      [`${BASE}entrada.js`]: `export {a} from '${BASE}a.js'; export {b} from '${BASE}b.js';`,
    });
    expect(copias(codigo, "_classCallCheck")).toBe(1);
    const { a, b } = await executar(codigo);
    expect(a([], Array)).toBe(1);
    expect(b([], Array)).toBe(2);
    expect(() => a({}, Array)).toThrow("Cannot call a class as a function");
  });

  it("um único token diferente mantém o helper separado", async () => {
    const { codigo, modulos } = await empacotar({
      [`${BASE}entrada.js`]: `${CHECK.replace("instance instanceof Constructor", "instance === Constructor")}\nexport function testar(v, C) { _classCallCheck(v, C); }`,
    });
    expect(modulos.some((id) => id.includes("ikcous:helpers"))).toBe(false);
    const { testar } = await executar(codigo);
    expect(() => testar([], Array)).toThrow();
    expect(() => testar(Array, Array)).not.toThrow();
  });

  it("inclui os operadores prefixos e pós-fixos na assinatura, mesmo sem tokens filhos no AST do TS", async () => {
    const prefixo = await empacotar({
      [`${BASE}entrada.js`]: `${CHECK.replace("!(instance", "~(instance")}\nexport function testar(v,C) { _classCallCheck(v,C); }`,
    });
    expect(prefixo.modulos.some((id) => id.includes("ikcous:helpers"))).toBe(
      false,
    );
    const { testar } = await executar(prefixo.codigo);
    expect(() => testar([], Array)).toThrow();

    const codigo = helpersDaLine();
    const arquivo = ts.createSourceFile(
      "Line.js",
      codigo,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const array = arquivo.statements
      .find(
        (n) =>
          ts.isFunctionDeclaration(n) && n.name?.text === "_arrayLikeToArray",
      )!
      .getText(arquivo);
    const posfixo = await empacotar({
      [`${BASE}entrada.js`]: `${array.replace("i++", "i--")}\nexport function copiar(v,n) { return _arrayLikeToArray(v,n); }`,
    });
    expect(posfixo.modulos.some((id) => id.includes("ikcous:helpers"))).toBe(
      false,
    );
  });

  it("não compartilha funções fora da lista, nem construtores iguais com protótipos distintos", async () => {
    const { codigo, modulos } = await empacotar({
      [`${BASE}entrada.js`]: `function A() {} function B() {} ${CHECK.replaceAll("_classCallCheck", "parecido")} export function testar() { A.prototype.a=1; parecido([], Array); return [A===B, new B().a]; }`,
    });
    expect(modulos.some((id) => id.includes("ikcous:helpers"))).toBe(false);
    expect((await executar(codigo)).testar()).toEqual([false, undefined]);
  });

  it.each([
    "/repo/src/app.js",
    "/repo/node_modules/d3-shape/src/line.js",
    "/repo/node_modules/recharts/lib/cartesian/Line.js",
  ])("não transforma %s", async (id) => {
    const { modulos } = await empacotar(
      {
        [id]: `${CHECK}\nexport function testar(v, C) { _classCallCheck(v,C); }`,
      },
      id,
    );
    expect(modulos.some((m) => m.includes("ikcous:helpers"))).toBe(false);
  });

  it("mantém os helpers no vendor do painel e o fecho estático do PDV no precache", async () => {
    const inicio = "/repo/src/main.js";
    const painel = "/repo/src/components/layouts/AdminArea.tsx";
    const pdv = "/repo/src/views/admin/AdminPdvView.tsx";
    const fontes = new Map([
      [
        inicio,
        `export const painel=()=>import('${painel}'); export const pdv=()=>import('${pdv}');`,
      ],
      [
        painel,
        `import { desenhar } from '${BASE}Line.js'; export function painel(v,C) { desenhar(v,C); return 'painel'; }`,
      ],
      [pdv, "export const vender = () => 1;"],
      [
        `${BASE}Line.js`,
        `${CHECK}\nexport function desenhar(v,C) { _classCallCheck(v,C); }`,
      ],
    ]);
    async function grafo(comPlugin: boolean) {
      const pacote = await rollup({
        input: inicio,
        plugins: [
          ...(comPlugin ? [helpersCompartilhadosDoGrafico()] : []),
          {
            name: "grafo-fixture",
            resolveId: (id) => (fontes.has(id) ? id : null),
            load: (id) => fontes.get(id) ?? null,
          },
        ],
      });
      try {
        const { output } = await pacote.generate({
          format: "es",
          entryFileNames: "assets/[name].js",
          chunkFileNames: (chunk) =>
            chunk.facadeModuleId === pdv
              ? "assets/PdvBalcao.js"
              : "assets/[name].js",
          manualChunks: (id) =>
            id.startsWith(BASE) ? "vendor-charts" : undefined,
        });
        const chunks = output.filter((item) => item.type === "chunk");
        const classificacao = classificarBundle(chunks);
        const charts = chunks.find((c) => c.name === "vendor-charts")!;
        expect(classificacao.painel).toContain(charts.fileName);
        expect(classificacao.cliente).not.toContain(charts.fileName);
        if (comPlugin)
          expect(
            charts.moduleIds.some((id) => id.includes("ikcous:helpers")),
          ).toBe(true);
        const balcão = chunks.find((c) => c.facadeModuleId === pdv)!;
        // Mesmo nome e exclusão assets/Admin*.js já usados em vite.config.ts.
        const fecho = new Set<string>();
        const fila = [balcão.fileName];
        while (fila.length) {
          const id = fila.pop()!;
          if (fecho.has(id)) continue;
          fecho.add(id);
          fila.push(...chunks.find((c) => c.fileName === id)!.imports);
        }
        const precache = [...fecho].sort();
        expect(precache.some((id) => /^assets\/Admin.*\.js$/.test(id))).toBe(
          false,
        );
        return { classificacao, precache };
      } finally {
        await pacote.close();
      }
    }
    expect(await grafo(true)).toEqual(await grafo(false));
  });

  it("também delimita o Recharts em caminhos Windows", async () => {
    const id = "C:\\repo\\node_modules\\recharts\\es6\\cartesian\\Line.js";
    const { modulos } = await empacotar(
      {
        [id]: `${CHECK}\nexport function testar(v,C) { _classCallCheck(v,C); }`,
      },
      id,
    );
    expect(modulos.some((m) => m.includes("ikcous:helpers"))).toBe(true);
  });

  it("preserva bindings: global sombreado, escrita externa e identidade observável impedem a troca", async () => {
    for (const final of [
      "export const identidade = _classCallCheck;",
      "_classCallCheck = () => 42; export function testar() { return _classCallCheck(); }",
      "const TypeError = Error; export function testar(v,C) { _classCallCheck(v,C); }",
      "export { _classCallCheck as alias };",
      "export const objeto = { _classCallCheck };",
    ]) {
      const { modulos } = await empacotar({
        [`${BASE}entrada.js`]: `${CHECK}\n${final}`,
      });
      expect(modulos.some((m) => m.includes("ikcous:helpers"))).toBe(false);
    }
  });

  it.each(["eval", "(eval)", "((eval))"])(
    "mantém o escopo local quando há eval direto: %s",
    async (chamada) => {
      const { codigo, modulos } = await empacotar({
        [`${BASE}entrada.js`]: `${CHECK}\nexport function testar() { ${chamada}("_classCallCheck = () => 42"); return _classCallCheck(); }`,
      });
      expect(modulos.some((id) => id.includes("ikcous:helpers"))).toBe(false);
      expect((await executar(codigo)).testar()).toBe(42);
    },
  );

  it("dependência alterada bloqueia também seus dependentes, em todas as etapas", async () => {
    const preambulo = helpersDaLine().replace(
      '"@babel/helpers - typeof"',
      '"alterado"',
    );
    const { modulos, codigo } = await empacotar({
      [`${BASE}entrada.js`]: `${preambulo}\nexport function testar(o,k,v) { return _defineProperty(o,k,v); }`,
    });
    expect(copias(codigo, "_typeof")).toBe(1);
    // A cadeia _defineProperty → _toPropertyKey → _toPrimitive → _typeof fica local.
    expect(codigo).toContain('"alterado"');
    expect(modulos.filter((id) => id.includes("ikcous:helpers"))).toHaveLength(
      0,
    );
  });

  it("preserva getters, símbolos, descritores, propriedades herdadas e a inicialização dos helpers", async () => {
    const { codigo } = await empacotar({
      [`${BASE}entrada.js`]: `${helpersDaLine()}
export function testar() {
  let leituras = 0;
  const simbolo = Symbol('chave');
  const origem = Object.create({ herdada: 99 });
  Object.defineProperties(origem, {
    valor: { enumerable: true, get() { leituras++; return 7; } },
    oculto: { value: 8, enumerable: false }
  });
  origem[simbolo] = 9;
  const spread = _objectSpread({}, origem);
  const descritores = _objectSpread({}, {}, origem);
  const semValor = _objectWithoutProperties(origem, ['valor']);
  const atribuida = _extends({}, origem);
  function Pai() {} function Filho() { _classCallCheck(this, Filho); }
  _inherits(Filho, Pai);
  _createClass(Filho, [{key:'valor', get() { return 12; }}]);
  const chave = { [Symbol.toPrimitive]() { return simbolo; } };
  const definida = _defineProperty(Object.create({[simbolo]:0}), chave, 15);
  return { leituras, valor: spread.valor, simbolo: spread[simbolo], herdada: spread.herdada,
    getter: typeof Object.getOwnPropertyDescriptor(descritores, 'valor').get,
    oculto: Object.getOwnPropertyDescriptor(descritores, 'oculto').enumerable,
    excluida: 'valor' in semValor, simboloRest: semValor[simbolo], atribuida: atribuida.valor,
    prototipo: _getPrototypeOf(Filho) === Pai, instancia: new Filho() instanceof Pai,
    classe: new Filho().valor, definida: Object.getOwnPropertyDescriptor(definida, simbolo),
    array: _toConsumableArray(new Set([1,2])) };
}`,
    });
    expect((await executar(codigo)).testar()).toEqual({
      leituras: 2,
      valor: 7,
      simbolo: 9,
      herdada: undefined,
      getter: "function",
      oculto: false,
      excluida: false,
      simboloRest: 9,
      atribuida: 7,
      prototipo: true,
      instancia: true,
      classe: 12,
      definida: {
        value: 15,
        enumerable: true,
        configurable: true,
        writable: true,
      },
      array: [1, 2],
    });
  });
});

function helpersDaLine() {
  const codigo = fs.readFileSync(
    new URL(
      "../../node_modules/recharts/es6/cartesian/Line.js",
      import.meta.url,
    ),
    "utf8",
  );
  const arquivo = ts.createSourceFile(
    "Line.js",
    codigo,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  return arquivo.statements
    .filter(ts.isFunctionDeclaration)
    .filter(
      (n) =>
        n.name && (n.name.text.startsWith("_") || n.name.text === "ownKeys"),
    )
    .map((n) => n.getText(arquivo))
    .join("\n");
}
