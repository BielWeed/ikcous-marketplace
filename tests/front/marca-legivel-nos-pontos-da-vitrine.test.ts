// Os cinco pontos da vitrine que usavam a cor da loja como texto, ícone ou
// anel sobre BRANCO (nome do produto no hover, "faltam R$" do carrinho, botão
// "Útil", check do frete, foco da galeria) passam a usar `primary-legivel`
// (--primary-legivel, ver cor-da-loja.ts). O jsdom não calcula CSS, então aqui
// o Tailwind REAL do projeto compila as classes novas (classe que não vira
// regra não pinta nada) e a fonte de cada componente é conferida. Molde:
// free-shipping-block-compacto-classes-geram-css.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";

const requisitar = createRequire(import.meta.url);

const CLASSES_NOVAS = [
  "text-primary-legivel",
  "group-hover:text-primary-legivel",
  "ring-primary-legivel",
  "lg:focus-visible:ring-primary-legivel",
  "lg:border-primary-legivel",
];

async function regrasGeradas(
  candidatas: string[],
): Promise<Map<string, string>> {
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
  const achadas = new Map<string, string>();
  resultado.root.walkRules((regra) => {
    selectorParser((seletores) => {
      seletores.walkClasses((c) => {
        achadas.set(c.value, regra.toString());
      });
    }).processSync(regra.selector);
  });
  return achadas;
}

const FONTES = {
  ProductCard: readFileSync("src/components/ui/custom/ProductCard.tsx", "utf8"),
  PremiumOffers: readFileSync(
    "src/components/ui/custom/PremiumOffers.tsx",
    "utf8",
  ),
  CartReminder: readFileSync(
    "src/components/ui/custom/CartReminder.tsx",
    "utf8",
  ),
  ReviewCard: readFileSync("src/components/ui/custom/ReviewCard.tsx", "utf8"),
  ShippingCalculator: readFileSync(
    "src/components/ui/custom/ShippingCalculator.tsx",
    "utf8",
  ),
  GaleriaDoProduto: readFileSync(
    "src/components/ui/custom/GaleriaDoProduto.tsx",
    "utf8",
  ),
};

// A cor da marca CRUA como texto/anel/borda: `primary` sem sufixo. Não pega
// `text-primary-foreground` (o texto SOBRE a marca) nem `-legivel`.
const HOVER_CRU = /group-hover:text-primary(?![-\w])/;
const TEXTO_CRU = /text-primary(?![-\w])/;
const ANEL_CRU = /lg:focus-visible:ring-primary(?![-\w])/;
const BORDA_CRU = /lg:border-primary(?![-\w])/;

describe("classes primary-legivel: geram CSS no Tailwind do projeto", () => {
  it("controle: classe inventada não gera CSS", async () => {
    const g = await regrasGeradas(["text-primary-inventada", "text-primary"]);
    expect(g.has("text-primary-inventada")).toBe(false);
    expect(g.has("text-primary")).toBe(true);
  }, 60_000);

  it("todas viram regra e leem --primary-legivel", async () => {
    const g = await regrasGeradas(CLASSES_NOVAS);
    for (const classe of CLASSES_NOVAS) {
      const chave = classe.replace(/:/g, "\\:");
      const achada = [...g.entries()].find(([nome]) => nome === classe);
      expect(achada, `${chave} não gerou CSS`).toBeDefined();
      expect(achada?.[1], chave).toContain("--primary-legivel");
    }
  }, 60_000);

  it("sem --primary-legivel definido a classe cai na cor da marca", async () => {
    const g = await regrasGeradas(["text-primary-legivel"]);
    expect(g.get("text-primary-legivel")).toContain("var(--primary)");
  }, 60_000);
});

describe("os cinco pontos usam a cor legível, não a cor crua da marca", () => {
  it("ProductCard: o nome do produto no hover", () => {
    const f = FONTES.ProductCard;
    expect(f).toContain("group-hover:text-primary-legivel");
    expect(f).not.toMatch(HOVER_CRU);
  });

  it("PremiumOffers: o nome da oferta no hover", () => {
    const f = FONTES.PremiumOffers;
    expect(f).toContain("group-hover:text-primary-legivel");
    expect(f).not.toMatch(HOVER_CRU);
  });

  it("CartReminder: o valor que falta para o frete grátis", () => {
    const f = FONTES.CartReminder;
    expect(f).toContain("font-extrabold text-primary-legivel");
    expect(f).not.toMatch(TEXTO_CRU);
  });

  it("ReviewCard: o botão Útil", () => {
    const f = FONTES.ReviewCard;
    expect(f).toContain("bg-secondary/10 text-primary-legivel");
    expect(f).not.toMatch(TEXTO_CRU);
  });

  it("ShippingCalculator: o check da opção escolhida", () => {
    const f = FONTES.ShippingCalculator;
    expect(f).toContain("bg-white text-primary-legivel");
    expect(f).not.toMatch(TEXTO_CRU);
  });

  it("GaleriaDoProduto: foco e borda da miniatura", () => {
    const f = FONTES.GaleriaDoProduto;
    expect(f).toContain("lg:focus-visible:ring-primary-legivel");
    expect(f).toContain("lg:border-primary-legivel");
    expect(f).not.toMatch(ANEL_CRU);
    expect(f).not.toMatch(BORDA_CRU);
  });
});
