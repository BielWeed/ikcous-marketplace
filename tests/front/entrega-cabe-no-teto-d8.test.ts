// A ENTREGA CABE NO TETO D8 (800 kB brotli somados, decisão do dono) — 23/09/2026.
//
// A cadeia #637 -> #640 -> #639 -> #638 (J&T, frete nacional, logos + CPF,
// etiqueta) levou a entrega fixture de 791,19 para 804,34 kB e reprovou o
// `npm run size`. O teto não sobe; três ajustes de build, sem tirar código do
// app, devolveram 6,99 kB (medido por arquivo, brotli, como o .size-limit.cjs):
//   1. alias lodash/<fn> -> lodash-es/<fn> (recharts sem 263 embrulhos CJS): -3,18
//   2. terser compress.passes = 2:                                          -1,11
//   3. rollup experimentalMinChunkSize = 1000 (117 -> 103 arquivos):        -2,70
// Entrega 797,35 kB. Nenhuma tela do cliente engorda (medido por tela, ver o
// comentário no vite.config.ts) — por isso 1000 e não 2000, que pendurava
// ~10 kB a mais na Home, na Busca e nos Favoritos.
//
// Como o teste de vendor-charts, este lê o TEXTO do vite.config.ts: o build
// leva minutos e muda nome de chunk a cada versão. A prova do número mora no
// CI (job "Build e tamanho"); aqui se trava a REGRA — quem apagar um dos três
// devolve kB que a entrega não tem de folga.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Pacote = { version: string; dependencies?: Record<string, string> };

const configTexto = readFileSync("vite.config.ts", "utf-8");
const pacoteDoApp = JSON.parse(readFileSync("package.json", "utf-8")) as Pacote;
const lodashEs = JSON.parse(
  readFileSync("node_modules/lodash-es/package.json", "utf-8"),
) as Pacote;
const lodash = JSON.parse(
  readFileSync("node_modules/lodash/package.json", "utf-8"),
) as Pacote;

describe("build — os três ajustes que põem a entrega abaixo do teto D8", () => {
  it("o recharts resolve lodash/<fn> para lodash-es/<fn>", () => {
    expect(configTexto).toContain(
      '{ find: /^lodash\\/(.*)$/, replacement: "lodash-es/$1" }',
    );
  });

  it("lodash-es é dependência declarada e da MESMA versão do lodash instalado", () => {
    // Mesma versão = mesmo código, só o formato de módulo muda. Se o recharts
    // passar a resolver outro lodash, suba o lodash-es junto.
    expect(pacoteDoApp.dependencies?.["lodash-es"]).toBeDefined();
    expect(lodashEs.version).toBe(lodash.version);
  });

  it("terser faz duas passadas e só chunks < 1 kB são fundidos", () => {
    expect(configTexto).toMatch(
      /terserOptions:\s*\{\s*compress:\s*\{\s*passes:\s*2\s*\}\s*\}/,
    );
    expect(configTexto).toMatch(/experimentalMinChunkSize:\s*1000,/);
  });
});
