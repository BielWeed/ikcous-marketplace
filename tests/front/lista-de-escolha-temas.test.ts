/* eslint-disable security/detect-non-literal-fs-filename -- Lê só fontes CSS fixas do repositório. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Rule, parse } from "postcss";
import { describe, expect, it } from "vitest";

function lerFonte(caminho: string) {
  return readFileSync(resolve(caminho), "utf8").replace(/\r\n/g, "\n");
}

const CSS_DA_LISTA =
  "src/components/admin/primitivos/lista-de-escolha/lista-de-escolha.css";
const lista = parse(lerFonte(CSS_DA_LISTA));
const temas = parse(lerFonte("src/components/layouts/temas-do-painel.css"));

const ESCURO = ":where(html.admin-mode:not([data-admin-tema]))";
const CLARO = 'html.admin-mode[data-admin-tema="claro"]';
const CONFORTAVEL = 'html.admin-mode[data-admin-tema="confortavel"]';

function regras(raiz: ReturnType<typeof parse>, seletor: string): Rule[] {
  const achadas: Rule[] = [];
  raiz.walkRules((regra) => {
    if (regra.selector.replace(/\s+/g, " ").trim() === seletor)
      achadas.push(regra);
  });
  return achadas;
}

function valor(regra: Rule, prop: string): string | undefined {
  let achado: string | undefined;
  regra.walkDecls(prop, (d) => {
    achado = d.value;
  });
  return achado;
}

describe("lista de escolha — cores próprias por tema", () => {
  it("os três seletores são os MESMOS do temas-do-painel.css", () => {
    for (const seletor of [ESCURO, CLARO, CONFORTAVEL]) {
      expect(regras(temas, seletor).length, seletor).toBeGreaterThan(0);
      expect(regras(lista, seletor), seletor).toHaveLength(1);
    }
  });

  it("Escuro: ouro próprio (o --admin-gold do Escuro é amarelo) e fundo da escolhida a 12%", () => {
    const [regra] = regras(lista, ESCURO);
    expect(valor(regra, "--lista-ouro")).toBe("39.1 66.7% 55.3%");
    expect(valor(regra, "--lista-escolhida-opacidade")).toBe("0.12");
  });

  it("Claro: o ouro do tema (#8A5A00) e fundo a 10%", () => {
    const [regra] = regras(lista, CLARO);
    expect(valor(regra, "--lista-ouro")).toBe("var(--admin-gold)");
    expect(valor(regra, "--lista-escolhida-opacidade")).toBe("0.1");
  });

  it("Confortável: o ouro do tema (#D9A441) e fundo a 14%", () => {
    const [regra] = regras(lista, CONFORTAVEL);
    expect(valor(regra, "--lista-ouro")).toBe("var(--admin-gold)");
    expect(valor(regra, "--lista-escolhida-opacidade")).toBe("0.14");
  });

  it("o texto usa o token do painel com a reserva do Escuro", () => {
    const fonte = lerFonte(CSS_DA_LISTA);
    expect(fonte).toContain("hsl(var(--admin-text, 240 10% 96.1%))");
  });

  it("o anel ouro vence o verde que o index.css põe em todo foco do painel", () => {
    // `html.admin-mode :focus-visible` (index.css) troca a cor do contorno de
    // tudo no painel; uma classe sozinha tem menos peso e o anel sairia verde.
    const anel = (() => {
      const achadas: Rule[] = [];
      lista.walkRules((regra) => {
        if (
          regra.selectors.includes(
            "html.admin-mode .lista-de-escolha-anel:focus-visible",
          )
        )
          achadas.push(regra);
      });
      return achadas;
    })();
    expect(anel).toHaveLength(1);
    expect(valor(anel[0], "outline")).toContain("--lista-ouro");
  });

  it("temas-do-painel.css não leva nada da lista (ela tem arquivo próprio)", () => {
    expect(
      lerFonte("src/components/layouts/temas-do-painel.css"),
    ).not.toContain("--lista-");
  });
});
