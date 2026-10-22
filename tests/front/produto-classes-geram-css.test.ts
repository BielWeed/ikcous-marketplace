// Classe que não gera CSS some em silêncio no jsdom (ele não vê CSS): vira
// seleção sem destaque, texto ilegível ou foco azul padrão. Aqui o Tailwind do
// projeto é COMPILADO com as classes dos componentes novos do formulário de
// produto, e cada classe tem de aparecer como regra no resultado. As
// variáveis `--admin-*` do CSS à mão também têm de existir (ou ter reserva).
/* eslint-disable security/detect-non-literal-fs-filename --
   lê arquivos-fonte de caminho fixo do repositório */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const exigir = createRequire(join(raiz, "package.json"));
// O `tailwind.config.js` é CommonJS num pacote ESM: o carregador do próprio
// Tailwind (jiti) sabe lê-lo, o `require` direto não.
const carregarConfig = exigir("tailwindcss/loadConfig") as (
  caminho: string,
) => Record<string, unknown>;
const ler = (caminho: string) => readFileSync(join(raiz, caminho), "utf8");

const COMPONENTES_NOVOS = [
  "src/components/admin/products/CampoDeCategoria.tsx",
  "src/components/admin/products/CodigoDoProduto.tsx",
  "src/components/admin/products/InterruptorDoProduto.tsx",
];

/** Classes que o formulário ganhou direto no JSX (trocas de cor e afins). */
const CLASSES_DO_FORMULARIO = [
  "bg-admin-surface",
  "bg-admin-raised",
  "border-admin-border",
  "text-zinc-200",
  "text-zinc-300",
];

/** Classes escritas à mão em CSS próprio (não são utilitários do Tailwind). */
const ehClasseDaCasa = (classe: string) =>
  classe.startsWith("produto-") || classe === "group";

// Como o Tailwind escreve o seletor: barra invertida antes do símbolo; a
// vírgula vira o código hexadecimal 2c, com espaço no fim.
const BARRA = String.fromCharCode(92);
const escapar = (classe: string) =>
  classe.replace(/[^a-zA-Z0-9_-]/g, (c) =>
    c === "," ? `${BARRA}2c ` : `${BARRA}${c}`,
  );

function classesDe(fonte: string): string[] {
  const achadas = new Set<string>();
  for (const m of fonte.matchAll(/className="([^"]+)"/g)) {
    for (const classe of (m[1] ?? "").split(/\s+/)) {
      if (classe) achadas.add(classe);
    }
  }
  return [...achadas];
}

describe("formulário de produto — toda classe usada gera CSS", () => {
  it("cada utilitário dos componentes novos aparece como regra no Tailwind compilado", async () => {
    const usadas = new Set<string>(CLASSES_DO_FORMULARIO);
    for (const arquivo of COMPONENTES_NOVOS) {
      for (const classe of classesDe(ler(arquivo))) usadas.add(classe);
    }
    const utilitarios = [...usadas].filter((c) => !ehClasseDaCasa(c));
    expect(utilitarios.length).toBeGreaterThan(10);

    const tailwind = exigir("tailwindcss");
    const config = carregarConfig(join(raiz, "tailwind.config.js"));
    const resultado = await postcss([
      tailwind({
        ...config,
        // Uma entrada por classe: o extrator confunde `>` de `[&>svg]:…`
        // com fim de tag e engoliria as classes seguintes.
        content: utilitarios.map((classe) => ({
          raw: `<div class="${classe}"></div>`,
          extension: "html",
        })),
      }),
    ]).process("@tailwind utilities;", { from: undefined });

    const semRegra = utilitarios.filter(
      (classe) => !resultado.css.includes(`.${escapar(classe)}`),
    );
    expect(
      semRegra,
      "classe sem regra no Tailwind (ela não existe no tema do projeto)",
    ).toEqual([]);
  });

  it("o controle do teste: uma classe inexistente É pega", async () => {
    const tailwind = exigir("tailwindcss");
    const config = carregarConfig(join(raiz, "tailwind.config.js"));
    const resultado = await postcss([
      tailwind({
        ...config,
        content: [
          { raw: "bg-admin-text border-admin-text", extension: "html" },
        ],
      }),
    ]).process("@tailwind utilities;", { from: undefined });
    expect(resultado.css).not.toContain(".bg-admin-text");
    expect(resultado.css).not.toContain(".border-admin-text");
  });

  it("as classes da casa usadas nos componentes têm regra no CSS do formulário", () => {
    const css = ler("src/components/admin/products/formulario-produto.css");
    const faltando: string[] = [];
    for (const arquivo of COMPONENTES_NOVOS) {
      for (const classe of classesDe(ler(arquivo))) {
        if (classe.startsWith("produto-") && !css.includes(`.${classe}`)) {
          faltando.push(classe);
        }
      }
    }
    expect(faltando).toEqual([]);
  });

  it("toda variável --admin-* do CSS do formulário existe no tema ou tem reserva", () => {
    const css = ler("src/components/admin/products/formulario-produto.css");
    const temas =
      ler("src/index.css") + ler("src/components/layouts/temas-do-painel.css");
    const sem: string[] = [];
    for (const m of css.matchAll(/var\((--admin-[a-z0-9-]+)\s*([,)])/g)) {
      const nome = m[1] ?? "";
      const temReserva = m[2] === ",";
      if (!temReserva && !temas.includes(`${nome}:`)) sem.push(nome);
    }
    expect(sem).toEqual([]);
  });
});
