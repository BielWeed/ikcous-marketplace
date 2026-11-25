// @vitest-environment jsdom
//
// Caça por mutação em `src/config/branding.ts` (25/11/2026), a parte que
// escreve no documento. Os testes vizinhos conferem os valores gravados, mas
// deixavam passar sete trocas que a pessoa vê (ou o navegador sente):
//
//   1. os ícones criados na hora (`icon`, `apple-touch-icon`) irem parar no
//      <body> em vez do <head> — o navegador ignora <link rel="icon"> fora do
//      <head>, e a contagem por `document.querySelectorAll` não distingue;
//   2. a cor da barra do celular (`meta theme-color`) ser gravada em minúsculas
//      quando o build entrega "#18181B": o valor tem de seguir como chegou;
//   3. o texto do loader inicial perder o `.trim()` ("Loja Aurora " com espaço)
//      ou cortar na palavra errada (o corte é na barra "|", não no espaço);
//   4. um nome vazio APAGAR o texto e a inicial do loader em vez de deixar
//      os que o HTML já trazia;
//   5. a inicial do loader sair sem a regra de `primeiraLetra` (maiúscula,
//      sem espaço antes) — `nome[0]` mostra "a" para "aurora";
//   6. o seletor do ícone existente casar por PREFIXO (`rel^=`): um
//      <link rel="apple-touch-icon-precomposed"> ou "icon-mask" da página seria
//      reescrito com a URL do ícone da loja em vez de ser deixado em paz;
//   7. `hexToTailwindHsl` tirar TODO "#" do texto e não só o primeiro: "##fff"
//      virava branco em vez de cor inválida (preta).
//
// O objeto `branding` é a semente do build e é MUTÁVEL de propósito aqui: cada
// teste troca o `appName` e o `afterEach` devolve o original.
import {
  applyBranding,
  applyThemeColor,
  branding,
  hexToTailwindHsl,
} from "@/config/branding";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const nomeDoBuild = branding.appName;

const LOADER =
  '<div class="guardian-brand-text">IKCOUS</div><div class="guardian-logo-icon"><span>I</span></div>';

const textoDoLoader = () =>
  document.querySelector(".guardian-brand-text")?.textContent;
const inicialDoLoader = () =>
  document.querySelector(".guardian-logo-icon span")?.textContent;

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("style");
});

afterEach(() => {
  branding.appName = nomeDoBuild;
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("style");
});

describe("applyThemeColor — a cor segue como chegou", () => {
  it("maiúsculas do build (#18181B) não viram minúsculas na tag", () => {
    applyThemeColor("#AbCdEf");
    expect(
      document.head
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute("content"),
    ).toBe("#AbCdEf");
  });
});

describe("applyBranding — o que é criado na hora nasce no <head>", () => {
  it("os dois ícones e a tag da cor ficam no <head>; o <body> não ganha nenhum <link> nem <meta>", () => {
    applyBranding();

    expect(document.head.querySelector('link[rel="icon"]')).not.toBeNull();
    expect(
      document.head.querySelector('link[rel="apple-touch-icon"]'),
    ).not.toBeNull();
    expect(
      document.head.querySelector('meta[name="theme-color"]'),
    ).not.toBeNull();
    expect(document.body.querySelectorAll("link, meta")).toHaveLength(0);
  });
});

describe("applyBranding — o ícone certo é achado pelo papel EXATO, não por prefixo", () => {
  it("um link 'apple-touch-icon-precomposed' e um 'icon-mask' ficam como estão, e os dois papéis são criados ao lado", () => {
    document.head.innerHTML =
      '<link rel="apple-touch-icon-precomposed" href="/pre.png"><link rel="icon-mask" href="/mascara.svg">';
    applyBranding();

    expect(
      document.head
        .querySelector('link[rel="apple-touch-icon-precomposed"]')
        ?.getAttribute("href"),
    ).toBe("/pre.png");
    expect(
      document.head
        .querySelector('link[rel="icon-mask"]')
        ?.getAttribute("href"),
    ).toBe("/mascara.svg");
    expect(document.head.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
    expect(
      document.head.querySelectorAll('link[rel="apple-touch-icon"]'),
    ).toHaveLength(1);
  });
});

describe("hexToTailwindHsl — só UM '#' inicial é tirado", () => {
  it("'##fff' não vira branco: sobra um '#' e o tamanho deixa de ser 3 ou 6", () => {
    expect(hexToTailwindHsl("##fff")).toBe("0 0% 0%");
    expect(hexToTailwindHsl("#fff")).toBe("0 0% 100%");
  });
});

describe("applyBranding — o loader inicial leva o nome e a inicial da marca", () => {
  it("corta na barra, sem espaço sobrando, e não na primeira palavra", () => {
    document.body.innerHTML = LOADER;
    branding.appName = "  Loja Aurora  | Imports e presentes";
    applyBranding();

    expect(textoDoLoader()).toBe("Loja Aurora");
    expect(inicialDoLoader()).toBe("L");
  });

  it("sem barra, o nome inteiro entra no loader", () => {
    document.body.innerHTML = LOADER;
    branding.appName = "Aurora Imports";
    applyBranding();

    expect(textoDoLoader()).toBe("Aurora Imports");
    expect(inicialDoLoader()).toBe("A");
  });

  it("a inicial sai em maiúscula, mesmo que o nome comece em minúscula", () => {
    document.body.innerHTML = LOADER;
    branding.appName = "aurora";
    applyBranding();

    expect(textoDoLoader()).toBe("aurora");
    expect(inicialDoLoader()).toBe("A");
  });

  it("nome vazio não apaga o que o HTML já trazia no loader", () => {
    document.body.innerHTML = LOADER;
    branding.appName = "";
    applyBranding();

    expect(textoDoLoader()).toBe("IKCOUS");
    expect(inicialDoLoader()).toBe("I");
  });

  it("sem loader na página, nada lança e nada é criado", () => {
    branding.appName = "Aurora";
    expect(() => applyBranding()).not.toThrow();
    expect(document.querySelector(".guardian-brand-text")).toBeNull();
  });
});
