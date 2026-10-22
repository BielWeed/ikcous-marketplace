// A view "Avisar clientes" só pode usar classes de cor/borda que o Tailwind do
// projeto realmente gera: classe inexistente (ex.: `bg-admin-text`) não dá
// erro nenhum — o elemento só fica sem a cor, e nenhum teste de jsdom vê.
// Este teste compila o Tailwind do projeto sobre as classes da view e falha
// se alguma não gerar regra.
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const tailwindcss = require("tailwindcss");

// O package.json do projeto é "type": "module" e o tailwind.config.js é CJS:
// compila o arquivo como CJS, a partir da própria pasta do projeto.
function carregarConfigDoProjeto() {
  const caminho = resolve(__dirname, "../../tailwind.config.js");
  const modulo = new (Module as any)(caminho);
  modulo.filename = caminho;
  modulo.paths = (Module as any)._nodeModulePaths(dirname(caminho));
  modulo._compile(readFileSync(caminho, "utf-8"), caminho);
  return modulo.exports;
}
const configDoProjeto = carregarConfigDoProjeto();

const ARQUIVO = resolve(__dirname, "../../src/views/admin/AdminPushView.tsx");
const PREFIXOS =
  /^(?:bg|text|border|ring|outline|divide|fill|stroke|from|to|via)-/;

function classesDaView(): string[] {
  const fonte = readFileSync(ARQUIVO, "utf-8");
  const blocos = [
    ...fonte.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g),
  ].map((m) => (m[1] ?? m[2] ?? "").replace(/\$\{[^}]*\}/g, " "));
  const tokens = blocos.flatMap((b) => b.split(/\s+/)).filter(Boolean);
  return [
    ...new Set(
      tokens.filter(
        (t) =>
          PREFIXOS.test(t.slice(t.lastIndexOf(":") + 1)) && !t.includes("[&"),
      ),
    ),
  ];
}

const escapar = (t: string) => t.replace(/[^a-zA-Z0-9_-]/g, "\\$&");

describe("AdminPushView — toda classe de cor usada gera CSS", () => {
  it("compila o Tailwind do projeto e acha uma regra para cada classe", async () => {
    const classes = classesDaView();
    expect(classes.length).toBeGreaterThan(20);
    const resultado = await postcss([
      tailwindcss({
        ...configDoProjeto,
        content: [{ raw: classes.join(" "), extension: "html" }],
      }),
    ]).process("@tailwind utilities;", { from: undefined });
    const semRegra = classes.filter(
      (c) => !resultado.css.includes(`.${escapar(c)}`),
    );
    expect(semRegra).toEqual([]);
  });

  it("não usa cor de marca (dourado) em lugar nenhum da tela", () => {
    expect(readFileSync(ARQUIVO, "utf-8")).not.toContain("admin-gold");
  });
});
