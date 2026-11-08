// Contratos de CSS/estrutura da barra "Subtotal / Entrega / Total" do checkout
// com a fonte do sistema grande (lote r64-a). O jsdom não faz layout: o que
// estes testes travam é a REGRA que, medida num Chromium de verdade (ver o
// relatório do lote: 84 combinações de largura x tamanho de fonte, sem uma só
// sobreposição e sem a barra pular entre "cotando" e "pronto"), faz a barra
// empilhar em vez de espremer duas colunas. Mesmo estilo de
// checkout-apresentacao-celular-estreito.test.ts.
import { readFileSync } from "node:fs";
import checkout from "@/views/customer/CheckoutView.tsx?raw";
import { type AtRule, type Rule, parse } from "postcss";
import { describe, expect, it } from "vitest";

const css = parse(readFileSync("src/index.css", "utf8"));

function declaracoes(regra: Rule): Record<string, string> {
  const achadas: Record<string, string> = {};
  regra.walkDecls((d) => {
    achadas[d.prop] = d.value;
  });
  return achadas;
}

/** O at-rule que condiciona a regra (`container`, `media`), ignorando o
 * `@layer` em que todo o CSS do app mora; `undefined` = regra incondicional. */
function condicaoDa(regra: Rule): string | undefined {
  let pai = regra.parent;
  while (pai && pai.type === "atrule") {
    const nome = (pai as AtRule).name;
    if (nome !== "layer") return nome;
    pai = pai.parent;
  }
  return undefined;
}

function regrasDe(seletor: string, dentroDe?: "container" | "media") {
  const achadas: Rule[] = [];
  css.walkRules(seletor, (regra) => {
    if (condicaoDa(regra) === dentroDe) achadas.push(regra);
  });
  return achadas;
}

function consultaDeContainer(): AtRule {
  let achada: AtRule | undefined;
  css.walkAtRules("container", (a) => {
    if (
      a.nodes?.some(
        (n) => n.type === "rule" && n.selector.includes("checkout-values"),
      )
    )
      achada = a;
  });
  expect(
    achada,
    "@container da barra do checkout em src/index.css",
  ).toBeDefined();
  return achada as AtRule;
}

describe("barra de valores do checkout — fonte grande do sistema", () => {
  it("a barra é um contêiner medido pela largura dela e o CheckoutView põe a classe em volta dos valores", () => {
    const [regra] = regrasDe(".checkout-barra");
    expect(declaracoes(regra)["container-type"]).toBe("inline-size");

    const grupo = checkout.indexOf('aria-label="Valores do pedido"');
    expect(grupo).toBeGreaterThan(-1);
    // A classe está no elemento que contém o grupo dos valores (e o botão).
    const ancestral = checkout.lastIndexOf('className="checkout-barra', grupo);
    expect(ancestral).toBeGreaterThan(-1);
    expect(grupo - ancestral).toBeLessThan(900);
  });

  it("o limite é em rem (acompanha a fonte do sistema), nunca em px: em px a barra não perceberia a fonte grande", () => {
    const consulta = consultaDeContainer();
    expect(consulta.params.startsWith("(max-width: ")).toBe(true);
    expect(consulta.params.endsWith("rem)")).toBe(true);
    expect(consulta.params).not.toContain("px");
    const limite = Number.parseFloat(
      consulta.params.slice("(max-width: ".length, -"rem)".length),
    );
    // 17 rem = 272 px a 100%: abaixo dos 288 px úteis do menor celular (320),
    // então o desenho de sempre não muda; a 110% (299 px) já empilha.
    expect(limite).toBeGreaterThan(16);
    expect(limite).toBeLessThan(18);
  });

  it("estreita, a barra empilha: uma coluna, e o Total ganha linha em cima em vez de linha à esquerda", () => {
    const consulta = consultaDeContainer();
    const dentro = (seletor: string) =>
      consulta.nodes?.find(
        (n): n is Rule => n.type === "rule" && n.selector === seletor,
      );

    const grade = dentro(".checkout-values");
    expect(grade && declaracoes(grade)["grid-template-columns"]).toBe(
      "minmax(0, 1fr)",
    );

    const total = dentro(".checkout-values > div:last-child");
    expect(total).toBeDefined();
    const t = declaracoes(total as Rule);
    expect(t["border-left-width"]).toBe("0");
    expect(t["border-top-width"]).toBe("1px");
    expect(t["padding-left"]).toBe("0");
  });

  it("empilhada, nenhum valor é forçado a ficar numa linha só (some o 'nowrap' que cortava o dígito)", () => {
    const consulta = consultaDeContainer();
    const valores = consulta.nodes?.find(
      (n): n is Rule =>
        n.type === "rule" && n.selector === ".checkout-values span:last-child",
    );
    expect(valores && declaracoes(valores)["white-space"]).toBe("normal");
  });

  it("limite: duas colunas (o desenho de sempre) continuam sendo a regra FORA do contêiner, com a mesma proporção", () => {
    const grade = regrasDe(".checkout-values").find(
      (r) => declaracoes(r)["grid-template-columns"],
    );
    expect(grade && declaracoes(grade)["grid-template-columns"]).toBe(
      "minmax(0, 1fr) minmax(0, 1.2fr)",
    );
    const total = regrasDe(".checkout-values > div:last-child")[0];
    expect(total.toString()).toContain("border-l");
  });

  it("cada linha de valor deixa o valor descer para baixo do rótulo quando não cabe (e continua à direita)", () => {
    const [linha] = regrasDe(".checkout-values > div:first-child > div");
    expect(linha.toString()).toMatch(/flex-wrap/);
    const [valor] = regrasDe(
      ".checkout-values > div:first-child > div > span:last-child",
    );
    expect(declaracoes(valor)["margin-left"]).toBe("auto");
  });

  it("a altura da barra segue medida pelo rodapé: nenhuma altura fixa nova na barra", () => {
    const consulta = consultaDeContainer();
    consulta.walkDecls((d) => {
      expect(d.prop).not.toMatch(/^(min-|max-)?height$/);
    });
    // O Total continua com a faixa de h-8 (2 rem) que o e2e
    // jornada-checkout-barra-nao-pula mede: em rem, escala com a fonte.
    expect(checkout).toContain("block h-8 w-24 animate-pulse");
  });
});
