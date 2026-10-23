// Tela Conta no estilo "Tinta" (23/10/2026): toda classe nova do desenho precisa
// virar CSS de verdade. O jsdom não calcula CSS, então classe inventada ou valor
// arbitrário mal escrito passa nos testes de componente e não pinta nada no
// celular. Aqui o Tailwind REAL do projeto compila as classes e o teste confere
// que cada uma gerou regra. Molde: free-shipping-block-compacto-classes-geram-css.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";

const requisitar = createRequire(import.meta.url);

// Classes novas do desenho da Conta (cabeçalho, abas, cartão de identidade,
// campos, linha-link, voltar e rodapé do botão principal).
const CLASSES = [
  // cabeçalho
  "font-mono",
  "text-[11px]",
  "uppercase",
  "tracking-[0.12em]",
  "text-muted-foreground",
  "text-[28px]",
  "font-bold",
  "leading-8",
  "tracking-tight",
  "text-foreground",
  // abas (controle segmentado)
  "rounded-[14px]",
  "bg-muted",
  "p-1",
  "h-11",
  "rounded-[10px]",
  "bg-foreground",
  "text-background",
  // cartão de identidade
  "rounded-[18px]",
  "border-border",
  "bg-muted/30",
  "size-16",
  "rounded-[20px]",
  "underline",
  "underline-offset-2",
  "min-h-11",
  // campos
  "h-[52px]",
  "border-input",
  "bg-muted/40",
  "text-[13px]",
  "font-semibold",
  // linha-link e voltar
  "h-14",
  "justify-between",
  // rodapé do botão principal (acima da navegação inferior)
  "bottom-docked-navigation",
  "sticky",
  "bg-background/95",
  "backdrop-blur",
  "rounded-2xl",
  "text-[15px]",
  "text-red-600",
  "border-red-300",
  "dark:text-red-400",
  "text-amber-700",
  "dark:text-amber-400",
  "text-emerald-600",
  "dark:text-emerald-400",
  // anel de foco, avatar e rodapé responsivo
  "focus-visible:ring-2",
  "focus-visible:ring-ring",
  "focus-visible:ring-zinc-900/50",
  "bg-background/80",
  "md:bottom-[104px]",
  "-mx-4",
  "sm:-mx-6",
  "truncate",
  "text-lg",
  "text-xl",
  "placeholder:text-muted-foreground/60",
  "md:text-[15px]",
  "hover:bg-foreground/90",
  "focus-visible:bg-background",
];

async function geradas(candidatas: string[]): Promise<Set<string>> {
  const carregar = requisitar("tailwindcss/loadConfig") as (
    caminho: string,
  ) => Record<string, unknown>;
  const config = carregar(resolve("tailwind.config.js"));
  const css = readFileSync("src/index.css", "utf8");
  const resultado = await postcss([
    tailwindcss({
      ...config,
      content: [{ raw: candidatas.join(" "), extension: "html" }],
    }),
  ]).process(css, { from: "src/index.css" });
  const achadas = new Set<string>();
  resultado.root.walkRules((regra) => {
    selectorParser((seletores) => {
      seletores.walkClasses((c) => {
        achadas.add(c.value);
      });
    }).processSync(regra.selector);
  });
  return achadas;
}

describe("Conta (Tinta): toda classe vira regra no Tailwind do projeto", () => {
  it("controle: classe inventada não gera CSS", async () => {
    const g = await geradas(["bg-marca-inventada-900", "rounded-[14px]"]);
    expect(g.has("bg-marca-inventada-900")).toBe(false);
    expect(g.has("rounded-[14px]")).toBe(true);
  }, 60_000);

  it("as classes do desenho aprovado geram CSS", async () => {
    const g = await geradas(CLASSES);
    // `/` vira `\/` no seletor; o parser devolve a classe já sem a barra.
    expect(CLASSES.filter((c) => !g.has(c))).toEqual([]);
  }, 60_000);

  it("as classes de cor da tinta usam variáveis do tema (nunca a cor da marca)", () => {
    const fonte = readFileSync(
      "src/views/customer/AccountSettingsView.tsx",
      "utf8",
    );
    // Botão principal e aba selecionada: tinta, jamais `bg-primary`.
    expect(fonte).toContain("bg-foreground text-background");
    const rodape = fonte.slice(
      fonte.indexOf("bottom-docked-navigation"),
      fonte.indexOf("bottom-docked-navigation") + 900,
    );
    expect(rodape).not.toContain("bg-primary");
  });

  it("as classes listadas aparecem de fato no componente", () => {
    const fonte = readFileSync(
      "src/views/customer/AccountSettingsView.tsx",
      "utf8",
    );
    const so_do_componente = [
      "text-[28px]",
      "tracking-[0.12em]",
      "rounded-[14px]",
      "rounded-[10px]",
      "rounded-[18px]",
      "rounded-[20px]",
      "h-[52px]",
      "bottom-docked-navigation",
      "bg-foreground",
      "text-background",
      "bg-muted/40",
      "bg-muted/30",
    ];
    for (const c of so_do_componente) expect(fonte, c).toContain(c);
  });

  it("TODA classe da tela nova (fora dos modais) gera CSS", async () => {
    const fonte = readFileSync(
      "src/views/customer/AccountSettingsView.tsx",
      "utf8",
    );
    // Só a tela nova: dos módulos acima do componente até o primeiro Dialog.
    const tela = fonte.slice(
      fonte.indexOf("// Linguagem"),
      fonte.indexOf("<Dialog open={isAvatarModalOpen}"),
    );
    const fichas = new Set<string>();
    for (const m of tela.matchAll(/"([^"\n]*)"/g))
      for (const t of m[1].split(/\s+/)) fichas.add(t);
    for (const m of tela.matchAll(/`([^`\n]*)`/g))
      for (const t of m[1].split(/\s+/)) fichas.add(t);
    // Só o que parece classe utilitária: tem hífen ou é palavra de utilitário
    // sem hífen. Descarta texto de tela e identificadores.
    const SEM_HIFEN = new Set([
      "flex",
      "relative",
      "absolute",
      "truncate",
      "sticky",
      "block",
      "uppercase",
      "underline",
      "border",
      "inline-flex",
      "shrink-0",
    ]);
    const candidatas = [...fichas].filter(
      (t) =>
        /^[a-z!-][a-zA-Z0-9:/._[\]%()#-]*$/.test(t) &&
        (t.includes("-") || SEM_HIFEN.has(t)),
    );
    expect(candidatas.length).toBeGreaterThan(40);
    const g = await geradas(candidatas);
    // Itens que não são utilitários do Tailwind (ids, rótulos, nomes).
    const naoUtilitarios = new Set([
      "form-senha",
      "full_name",
      "full_name-erro",
      "cpf-erro",
      "profile-tab",
      "security-tab",
      "new-password",
      "new_password",
      "confirm_password",
      "pt-BR",
      "foto-de-perfil",
      "edicao-da-conta",
      "salvar-conta",
    ]);
    expect(
      candidatas.filter((c) => !g.has(c) && !naoUtilitarios.has(c)),
    ).toEqual([]);
  }, 60_000);
});
