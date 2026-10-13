import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Contrato do CSS do cartão de mapa do endereço (revisão da PR #712,
// 13/10/2026). O teste do componente roda com MapLibre mockado e em jsdom: ele
// NÃO enxerga contraste, quebra de linha nem altura — por isso o CSS é lido
// aqui, no padrão de `mapa-pino-sem-transform-no-marcador.test.ts`. Quatro
// defeitos confirmados:
//  (a) texto de status com 4,40:1 (abaixo do AA 4,5:1);
//  (b) linha de créditos `nowrap`+`ellipsis` CORTAVA a atribuição exigida
//      (OpenMapTiles / OpenStreetMap contributors) em tela estreita;
//  (c) estado "consultando/indisponível" ocupava ~60 px dos 160 px do
//      contêiner e deixava ~100 px de vazio;
//  (d) regra `.address-map` morta, com comentário que a chamava de "fundo do
//      hospedeiro" (o hospedeiro real é `.address-card-map__canvas`).
function ler(caminho: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo de arquivo do próprio repositório, sem entrada externa.
  return readFileSync(new URL(caminho, import.meta.url), "utf8");
}

const css = ler("../../src/components/ui/custom/address-card-map.css");
const componente = ler("../../src/components/ui/custom/AddressCardMap.tsx");

// Texto sem comentários de bloco: o texto explicativo cita seletores e classes
// e não pode contar como declaração nem como uso.
function semComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, "");
}

const cssSemComentarios = semComentarios(css);

type Regra = { seletores: string[]; corpo: string };

// Regras `seletor, seletor { corpo }` do CSS, na ordem do arquivo. Este CSS
// não tem chaves aninhadas; dentro de um `@media` o regex ainda acha a regra
// de dentro, então uma regra repetida lá também é contada.
function regrasDe(texto: string): Regra[] {
  return [...semComentarios(texto).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    (m) => ({
      seletores: m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")),
      corpo: m[2],
    }),
  );
}

function regrasDoSeletor(regras: Regra[], seletor: string): Regra[] {
  return regras.filter((r) => r.seletores.includes(seletor));
}

// O corpo da ÚNICA regra do seletor. A cascata usa a ÚLTIMA declaração, mas
// ler só a primeira deixava passar um bloco repetido no fim do arquivo que
// reintroduz o defeito (mutação da revisão: `.address-card-map__creditos
// { white-space: nowrap; … }` ao final deixava o contrato verde). Por isso
// o contrato exige UMA regra por seletor: não há "a outra" para ler errado.
function corpoUnico(regras: Regra[], seletor: string): string {
  const achadas = regrasDoSeletor(regras, seletor);
  expect(
    achadas.length,
    `o seletor ${seletor} deve ter UMA regra só no CSS (achei ${achadas.length}): com duas, a cascata usa a última e este contrato leria a errada`,
  ).toBe(1);
  return achadas[0].corpo;
}

const regrasDoCss = regrasDe(css);

function bloco(seletor: string): string {
  return corpoUnico(regrasDoCss, seletor);
}

// Classes que o componente de fato APLICA: os valores de `className = "…"` no
// fonte sem comentários. Não vale tokenizar o arquivo inteiro: o caminho do
// `import` do CSS (`…/address-card-map.css`) e qualquer comentário já trazem o
// token `address-card-map`, e a classe raiz passava por construção (renomear
// o `className` da raiz ficava verde).
function classesAplicadas(fonte: string): Set<string> {
  const codigo = semComentarios(fonte).replace(/^\s*\/\/.*$/gm, "");
  const valores = [
    ...codigo.matchAll(/className\s*=\s*\{?\s*["'`]([^"'`]*)["'`]/g),
  ].map((m) => m[1]);
  return new Set(valores.flatMap((v) => v.split(/\s+/).filter(Boolean)));
}

// Valor de `color`/`background` em hex de 6 dígitos (o `(?<![\w-])` exclui
// `background-color`, `border-color`).
function cor(corpo: string, propriedade: "color" | "background"): `#${string}` {
  const achado =
    propriedade === "color"
      ? /(?<![\w-])color\s*:\s*(#[0-9a-f]{6})\b/i.exec(corpo)
      : /(?<![\w-])background\s*:\s*(#[0-9a-f]{6})\b/i.exec(corpo);
  expect(achado, `${propriedade} em hex de 6 dígitos`).not.toBeNull();
  return achado![1].toLowerCase() as `#${string}`;
}

// WCAG 2.x: luminância relativa e razão de contraste.
function canalLinear(canal: number): number {
  const c = canal / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminancia(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * canalLinear((n >> 16) & 255) +
    0.7152 * canalLinear((n >> 8) & 255) +
    0.0722 * canalLinear(n & 255)
  );
}

function razaoDeContraste(a: string, b: string): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
}

describe("calculadora de contraste do próprio teste", () => {
  it("bate com os valores conhecidos da WCAG", () => {
    expect(razaoDeContraste("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(razaoDeContraste("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // O defeito original: #71717a sobre #f4f4f5 dava 4,40:1 (< 4,5).
    expect(razaoDeContraste("#71717a", "#f4f4f5")).toBeCloseTo(4.397, 3);
  });
});

describe("(a) contraste AA do texto do cartão", () => {
  it("o texto de status tem razão >= 4,5:1 sobre o próprio fundo", () => {
    const b = bloco(".address-card-map__status");
    const razao = razaoDeContraste(cor(b, "color"), cor(b, "background"));
    expect(razao).toBeGreaterThanOrEqual(4.5);
  });

  it("a linha de créditos e os links dela mantêm razão >= 4,5:1 (9 px)", () => {
    const fundo = cor(bloco(".address-card-map__creditos"), "background");
    expect(
      razaoDeContraste(
        cor(bloco(".address-card-map__creditos"), "color"),
        fundo,
      ),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      razaoDeContraste(
        cor(bloco(".address-card-map__creditos a"), "color"),
        fundo,
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe("(b) a atribuição exigida nunca fica oculta", () => {
  it("os créditos quebram linha: sem nowrap, sem ellipsis, sem overflow oculto", () => {
    const b = bloco(".address-card-map__creditos");
    // `pre-wrap`/`pre-line` quebram linha e são aceitos; `nowrap`/`pre`, não.
    // `text-wrap-mode: nowrap` (longhand moderno) desliga a quebra igual.
    expect(b).not.toMatch(
      /(white-space|text-wrap(-mode)?)\s*:\s*(nowrap|pre)(?![\w-])/,
    );
    expect(b).not.toMatch(/text-overflow\s*:/);
    expect(b).not.toMatch(/overflow(-[xy])?\s*:\s*(hidden|clip)/);
  });

  it("segue legível: 9 px, e a linha não é espremida pelo flex do cartão", () => {
    const b = bloco(".address-card-map__creditos");
    expect(b).toMatch(/font-size:\s*9px/);
    // `flex: none` = a linha cresce com o texto e é o canvas que cede altura.
    expect(b).toMatch(/flex:\s*none/);
    // Sem espaços para quebrar numa tela muito estreita, ainda assim não corta.
    expect(b).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe("(c) o estado sem mapa preenche a altura do contêiner", () => {
  it("o cartão é uma coluna flex de 100% da altura do contêiner", () => {
    const b = bloco(".address-card-map");
    expect(b).toMatch(/display:\s*flex/);
    expect(b).toMatch(/flex-direction:\s*column/);
    expect(b).toMatch(/height:\s*100%/);
  });

  it("o status cresce (flex: 1) e centraliza a mensagem nos dois eixos", () => {
    const b = bloco(".address-card-map__status");
    expect(b).toMatch(/flex:\s*1\b/);
    expect(b).toMatch(/display:\s*flex/);
    expect(b).toMatch(/align-items:\s*center/);
    expect(b).toMatch(/justify-content:\s*center/);
    expect(b).toMatch(/text-align:\s*center/);
  });

  it("o estado com mapa não muda: canvas flexível e créditos fora do canvas", () => {
    const b = bloco(".address-card-map__canvas");
    expect(b).toMatch(/flex:\s*1\b/);
    expect(b).toMatch(/min-height:\s*0/);
    expect(b).toMatch(/width:\s*100%/);
  });
});

describe("(d) o CSS não carrega regra morta", () => {
  it("não existe a regra `.address-map` solta (só o pino `.address-map__pin`)", () => {
    expect(cssSemComentarios).not.toMatch(/\.address-map\s*[{,]/);
    expect(cssSemComentarios).toMatch(/\.address-map__pin\s*\{/);
  });

  it("toda classe declarada no CSS é usada pelo componente", () => {
    const declaradas = new Set(
      [...cssSemComentarios.matchAll(/\.([a-z][\w-]*)/gi)].map((m) => m[1]),
    );
    const usadas = classesAplicadas(componente);
    const mortas = [...declaradas].filter((classe) => !usadas.has(classe));
    expect(mortas, "classes no CSS que nada usa").toEqual([]);
  });
});

// Provas de que as próprias ferramentas do contrato não se deixam enganar
// (mutações em memória, sem tocar arquivo de outra frente).
describe("o contrato não é enganado por mutações", () => {
  // Base sintética (e não o CSS real): estas provas são sobre a ferramenta e
  // têm de dar o mesmo resultado com qualquer conteúdo do CSS do repositório.
  const base = ".creditos { font-size: 9px; }\n.creditos a { color: #000; }\n";
  const repetida =
    ".creditos { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }";

  it("regra repetida no fim do CSS (cascata) reprova o seletor único", () => {
    const regras = regrasDe(`${base}${repetida}\n`);
    expect(regrasDoSeletor(regras, ".creditos")).toHaveLength(2);
    expect(() => corpoUnico(regras, ".creditos")).toThrow(
      /deve ter UMA regra só/,
    );
  });

  it("a repetição também é vista em lista de seletores e dentro de @media", () => {
    const emLista = regrasDe(`${base}.x,\n.creditos{white-space:nowrap}\n`);
    expect(regrasDoSeletor(emLista, ".creditos")).toHaveLength(2);
    const emMedia = regrasDe(
      `${base}@media (max-width: 320px) {\n  ${repetida}\n}\n`,
    );
    expect(regrasDoSeletor(emMedia, ".creditos")).toHaveLength(2);
  });

  it("seletor com regra única passa, e o descendente (`.creditos a`) é outra regra", () => {
    const regras = regrasDe(base);
    expect(corpoUnico(regras, ".creditos")).toMatch(/font-size:\s*9px/);
    expect(corpoUnico(regras, ".creditos a")).toMatch(/color:\s*#000/);
  });

  it("seletor sem regra também reprova (não vira corpo vazio)", () => {
    expect(() => corpoUnico(regrasDe(base), ".nao-existe")).toThrow(
      /deve ter UMA regra só/,
    );
  });

  it("o caminho do import do CSS não conta como uso da classe raiz", () => {
    const fonte = [
      'import "@/components/ui/custom/address-card-map.css";',
      'export const A = () => <div className="renomeada" />;',
    ].join("\n");
    expect(classesAplicadas(fonte).has("address-card-map")).toBe(false);
    expect(classesAplicadas(fonte).has("renomeada")).toBe(true);
  });

  it("comentário que cita a classe não conta como uso", () => {
    const fonte = [
      '{/* o <div className="address-card-map"> é a raiz */}',
      "// className = 'address-card-map__status'",
      'export const A = () => <div className="outra" />;',
    ].join("\n");
    const usadas = classesAplicadas(fonte);
    expect(usadas.has("address-card-map")).toBe(false);
    expect(usadas.has("address-card-map__status")).toBe(false);
  });

  it("className de várias classes e atribuição direta (pino) contam", () => {
    const fonte = [
      'pino.className = "address-map__pin";',
      'const a = <p className="address-card-map__status extra" />;',
    ].join("\n");
    expect([...classesAplicadas(fonte)].sort()).toEqual([
      "address-card-map__status",
      "address-map__pin",
      "extra",
    ]);
  });
});
