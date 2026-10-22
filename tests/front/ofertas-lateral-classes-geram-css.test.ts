// @vitest-environment node
//
// Classe de Tailwind que não gera regra não dá erro: a tela só fica sem fundo, sem borda, sem foco, e o jsdom
// não vê. Este teste COMPILA o Tailwind do projeto sobre os arquivos do desenho Lateral e exige uma regra para
// TODA classe que o código usa em `className` (lidas do próprio código, sem lista fixa). Tem um controle: uma
// classe inventada (`bg-admin-text`) precisa ser apanhada pelo mesmo método.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const exigir = createRequire(join(raiz, "package.json"));
const ARQUIVOS = [
  "src/components/ui/custom/OfertasLateral.tsx",
  "src/components/ui/custom/OfertasLateralEsqueleto.tsx",
];

async function compilar(fontes: string[]): Promise<string> {
  const tailwind = exigir("tailwindcss");
  const config = exigir("tailwindcss/loadConfig")(
    join(raiz, "tailwind.config.js"),
  );
  return (
    await postcss([
      tailwind({
        ...config,
        content: fontes.map((raw) => ({ raw, extension: "tsx" })),
      }),
    ]).process("@tailwind utilities;", { from: undefined })
  ).css;
}
const escapar = (t: string) => t.replace(/[^a-zA-Z0-9_-]/g, String.raw`\$&`);

/** Texto entre aspas ou chaves logo depois de cada `className=` (literais de comparação `=== "x"` não são classe). */
function trechosDeClassName(fonte: string): string[] {
  const trechos: string[] = [];
  for (const m of fonte.matchAll(/className=/g)) {
    let i = (m.index ?? 0) + m[0].length;
    if (fonte[i] === '"') {
      trechos.push(fonte.slice(i + 1, fonte.indexOf('"', i + 1)));
    } else if (fonte[i] === "{") {
      let nivel = 0;
      const ini = i;
      for (; i < fonte.length; i++) {
        if (fonte[i] === "{") nivel++;
        if (fonte[i] === "}" && --nivel === 0) break;
      }
      trechos.push(fonte.slice(ini, i + 1));
    }
  }
  return trechos;
}
function classesDe(fonte: string): Set<string> {
  const classes = new Set<string>();
  for (const trecho of trechosDeClassName(fonte)) {
    const literais = trecho.startsWith("{")
      ? [...trecho.matchAll(/={2,3}\s*"[^"]*"|"([^"]*)"|`([^`$]*)`/g)]
          .map((l) => l[1] ?? l[2])
          .filter((l): l is string => l !== undefined)
      : [trecho];
    for (const literal of literais)
      for (const t of literal.split(/\s+/)) if (t) classes.add(t);
  }
  return classes;
}
const semRegra = (classes: Set<string>, css: string) =>
  [...classes].filter((t) => !css.includes(`.${escapar(t)}`));

describe("classes do desenho Lateral das Ofertas", () => {
  it("toda classe usada em className gera regra de CSS", async () => {
    const fontes = ARQUIVOS.map((a) => readFileSync(join(raiz, a), "utf8"));
    const css = await compilar(fontes);
    const classes = new Set(fontes.flatMap((f) => [...classesDe(f)]));
    expect(classes.size).toBeGreaterThan(40);
    // As classes que a especificação exige têm de estar entre as lidas.
    for (const t of [
      "bg-zinc-950",
      "text-white",
      "border-zinc-950",
      "focus-visible:ring-ring",
      "text-amber-700",
      "text-red-800",
    ])
      expect(classes.has(t), t).toBe(true);
    expect(semRegra(classes, css)).toEqual([]);
  });

  it("controle: uma classe inventada é apanhada pelo mesmo método", async () => {
    const fonte = '<i className="bg-admin-text bg-foreground" />';
    const css = await compilar([fonte]);
    expect(semRegra(classesDe(fonte), css)).toEqual(["bg-admin-text"]);
  });
});
