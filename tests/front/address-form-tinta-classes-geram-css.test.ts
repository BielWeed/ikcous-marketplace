// Tela de endereço no estilo "Tinta" (23/10/2026): toda classe NOVA do
// formulário e do cabeçalho precisa virar CSS de verdade. O jsdom não calcula
// CSS, então classe inventada ou valor arbitrário mal escrito passa nos testes
// de componente e não pinta nada no celular. Aqui o Tailwind REAL do projeto
// compila as classes. Molde: free-shipping-block-compacto-classes-geram-css.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";

const requisitar = createRequire(import.meta.url);

// Classes novas (ou que mudaram de valor) em AddressForm.tsx.
const CLASSES_DO_FORMULARIO = [
  // campo, rótulo, tinta
  "rounded-[14px]",
  "border-input",
  "focus:border-foreground",
  "focus:ring-foreground/10",
  "text-[13px]",
  "mb-2",
  "gap-2",
  "not-italic",
  "text-foreground",
  // CEP achado: contorno verde claro e ✓ em círculo verde
  "border-2",
  "border-emerald-300",
  "dark:border-emerald-500/50",
  "size-6",
  "size-3.5",
  "rounded-full",
  "bg-emerald-500",
  "text-white",
  // cartões (fantasma, carregando, achado)
  "rounded-[18px]",
  "border-dashed",
  "bg-muted/30",
  "rounded-[13px]",
  "bg-foreground",
  "text-background",
  "text-[15px]",
  "font-semibold",
  // selo "Achado pelo CEP" (ponto + texto) e "Editar" como link
  "size-1.5",
  "gap-1.5",
  "text-[12px]",
  "text-emerald-700",
  "dark:text-emerald-400",
  "-my-3",
  "py-3",
  "underline",
  "underline-offset-4",
  // "Sem número" e chips Casa/Trabalho/Outro
  "h-9",
  "h-11",
  "rounded-xl",
  "px-3",
  "px-5",
  "justify-center",
  "transition-colors",
  "border-foreground",
  "text-foreground/80",
  // interruptor ligado em tinta
  "data-[state=checked]:bg-foreground",
  // Cancelar e botão de salvar
  "hover:bg-foreground/90",
  "hover:bg-muted",
  "rounded-2xl",
  "h-[52px]",
];

// Classes novas em AddressFormView.tsx (cabeçalho).
const CLASSES_DO_CABECALHO = [
  "h-[3px]",
  "flex-1",
  "bg-border",
  "mb-5",
  "mb-1",
  "gap-1.5",
  "font-mono",
  "text-[11px]",
  "uppercase",
  "tracking-[0.12em]",
  "text-muted-foreground",
  "text-[28px]",
  "font-bold",
  "leading-8",
  "tracking-tight",
  "text-[15px]",
  "leading-snug",
  "mt-2",
];

async function compilar(candidatas: string[]) {
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
  return { achadas, css: resultado.css };
}

describe("endereço Tinta: toda classe vira regra no Tailwind do projeto", () => {
  it("controle: classe inventada não gera CSS", async () => {
    const { achadas } = await compilar([
      "bg-tinta-inventada-900",
      "rounded-[18px]",
    ]);
    expect(achadas.has("bg-tinta-inventada-900")).toBe(false);
    expect(achadas.has("rounded-[18px]")).toBe(true);
  }, 60_000);

  it("as classes do formulário e do cabeçalho geram CSS", async () => {
    const todas = [...CLASSES_DO_FORMULARIO, ...CLASSES_DO_CABECALHO];
    const { achadas } = await compilar(todas);
    expect(todas.filter((c) => !achadas.has(c))).toEqual([]);
  }, 60_000);

  it("tinta é a cor do TEMA (foreground/background), não a cor da loja", async () => {
    const { css } = await compilar(["bg-foreground", "text-background"]);
    expect(css).toMatch(/\.bg-foreground\s*\{[^}]*var\(--foreground\)/);
    expect(css).toMatch(/\.text-background\s*\{[^}]*var\(--background\)/);
  }, 60_000);

  it("as classes listadas são as que o código usa de fato", () => {
    const formulario = readFileSync(
      "src/components/ui/custom/AddressForm.tsx",
      "utf8",
    );
    const cabecalho = readFileSync(
      "src/views/customer/AddressFormView.tsx",
      "utf8",
    );
    const ausentes = [
      ...CLASSES_DO_FORMULARIO.filter((c) => !formulario.includes(c)).map(
        (c) => `AddressForm: ${c}`,
      ),
      ...CLASSES_DO_CABECALHO.filter((c) => !cabecalho.includes(c)).map(
        (c) => `AddressFormView: ${c}`,
      ),
    ];
    expect(ausentes).toEqual([]);
  });

  it("o formulário não usa mais a cor da loja (primary) nem o amarelo para marcar seleção", () => {
    const formulario = readFileSync(
      "src/components/ui/custom/AddressForm.tsx",
      "utf8",
    );
    expect(formulario).not.toMatch(/bg-primary|border-primary|ring-primary/);
    expect(formulario).not.toMatch(/focus:border-ring|focus:ring-ring/);
  });
});
