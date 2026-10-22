// @vitest-environment node
//
// Classe de Tailwind que não gera regra não dá erro: a tela só fica sem borda, sem fundo, sem foco. Foi o que
// houve com `bg-admin-text` e `ring-admin-text-soft` (o token existe só como `.text-admin-text*`, escrito à
// mão). Este teste COMPILA o Tailwind do projeto sobre os arquivos e exige uma regra para cada classe de cor do
// painel (`admin-*`, `foreground`, `background`, `ring`); as escritas à mão, sem variante, valem se estão nos CSS.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const exigir = createRequire(join(raiz, "package.json"));
const ARQUIVOS = [
  "src/components/admin/categorias/SeletorDeIcone.tsx",
  "src/components/admin/categorias/GerenciarCategorias.tsx",
];

function css(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return css(caminho);
    return nome.endsWith(".css") ? [readFileSync(caminho, "utf8")] : [];
  });
}
const escapar = (t: string) => t.replace(/[^a-zA-Z0-9_-]/g, String.raw`\$&`);

describe("classes de cor do seletor de ícone e de Gerenciar categorias", () => {
  it("toda classe admin-*/foreground/background/ring gera regra de CSS", async () => {
    const fontes = ARQUIVOS.map((a) => readFileSync(join(raiz, a), "utf8"));
    const tailwind = exigir("tailwindcss");
    const config = exigir("tailwindcss/loadConfig")(
      join(raiz, "tailwind.config.js"),
    );
    const gerado = (
      await postcss([
        tailwind({
          ...config,
          content: fontes.map((raw) => ({ raw, extension: "tsx" })),
        }),
      ]).process("@tailwind utilities;", { from: undefined })
    ).css;
    const escritasAMao = css(join(raiz, "src")).join("\n");

    const classes = new Set<string>();
    for (const fonte of fontes)
      for (const [t] of fonte.matchAll(/[A-Za-z0-9:_/[\]().%-]+/g))
        if (/admin-|foreground|background|(^|:)(ring|border)-ring/.test(t))
          classes.add(t);

    expect(classes.size).toBeGreaterThan(10);
    const semRegra = [...classes].filter((t) => {
      if (gerado.includes(`.${escapar(t)}`)) return false;
      const semVariante = !t.includes(":");
      return !(semVariante && escritasAMao.includes(`.${t} `));
    });
    expect(semRegra).toEqual([]);
  });
});
