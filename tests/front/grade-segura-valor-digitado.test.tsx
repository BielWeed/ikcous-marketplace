// @vitest-environment jsdom
//
// GRADE DE VARIANTES — o valor digitado em "Aplicar para todas" e NÃO aplicado
// (a lojista não clicou no botão) é SEGURADO e preenchido nas linhas ao
// efetivar. Antes ele era ignorado: o produto ficava sem preço, o formulário
// pedia o Preço de Venda de novo e o estoque das linhas gravava 0.
//
// Decisão do dono (10/10/2026, "segurar e preencher"). Regra:
//  - preço segurado preenche SÓ as linhas de preço vazio (nunca sobrescreve o
//    que a lojista digitou numa linha);
//  - estoque segurado preenche SÓ as linhas cujo estoque ela nunca mexeu
//    (rastreado por linha, não por "é 0"): um 0 digitado de propósito fica 0;
//  - o segurado entra na MESMA conta de `resolverPrecoDaGrade`;
//  - o botão "Aplicar para todas" continua como era (sobrescreve as linhas).
//
// Montagem real (react-dom/client + jsdom), molde de
// produto-formulario-no-celular.test.tsx. O LocalBufferedInput só entrega o
// valor no blur (ou após 200 ms), por isso `digitar` foca, escreve e desfoca.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type LinhaProntaDaGrade,
  ModalVarianteGrade,
} from "@/components/admin/products/ModalVarianteGrade";
import { preencherComSegurado } from "@/utils/grade-valor-segurado";

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onEfetivar = vi.fn<
  (linhas: LinhaProntaDaGrade[], precoDoProduto?: number) => boolean
>(() => true);

function montar(precoDoProduto: string) {
  act(() => {
    root.render(
      <ModalVarianteGrade
        aberto
        onFechar={() => {}}
        variantesExistentes={[]}
        sugestoesDeAtributo={[]}
        grupoUnicoEmUso={null}
        skusDaLoja={[]}
        precoDoProduto={precoDoProduto}
        onEfetivar={onEfetivar}
      />,
    );
  });
}

function campo<T extends HTMLElement = HTMLInputElement>(seletor: string): T {
  const el = document.body.querySelector<T>(seletor);
  if (!el) throw new Error(`campo não achado: ${seletor}`);
  return el;
}

function porRotulo(rotulo: string): HTMLInputElement {
  return campo(`input[aria-label="${rotulo}"]`);
}

/** Digita como a lojista: foca, escreve (o React vê o `input`) e sai do campo. */
function digitar(el: HTMLInputElement, valor: string) {
  act(() => {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    el.blur();
  });
}

function botao(texto: string): HTMLButtonElement {
  const achado = [...document.body.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").trim().startsWith(texto),
  );
  if (!achado) throw new Error(`botão não achado: ${texto}`);
  return achado;
}

function clicar(el: HTMLElement) {
  act(() => {
    el.click();
  });
}

/** Passo 1 → passo 2 com as três combinações P, M, G (atributo "Tamanho"). */
function irParaOPasso2() {
  digitar(campo("#grade-nome-0"), "Tamanho");
  for (const valor of ["P", "M", "G"]) {
    digitar(campo("#grade-valor-0"), valor);
    clicar(
      campo<HTMLButtonElement>(
        "button[aria-label='Adicionar valor do atributo 1']",
      ),
    );
  }
  clicar(botao("Gerar grade"));
}

const segurarPreco = (centavos: string) =>
  digitar(porRotulo("Preço para todas as linhas"), centavos);
const segurarEstoque = (valor: string) =>
  digitar(porRotulo("Estoque para todas as linhas"), valor);
const precoDaLinha = (tamanho: string, centavos: string) =>
  digitar(porRotulo(`Preço de ${tamanho}`), centavos);
const estoqueDaLinha = (tamanho: string, valor: string) =>
  digitar(porRotulo(`Estoque de ${tamanho}`), valor);

const efetivar = () => clicar(botao("Salvar"));
const aplicarParaTodas = () => clicar(botao("Aplicar para todas"));

const entregue = (): LinhaProntaDaGrade[] =>
  onEfetivar.mock.calls.at(-1)?.[0] ?? [];
const precoEntregue = (): number | undefined =>
  onEfetivar.mock.calls.at(-1)?.[1];
const porTamanho = (tamanho: string) =>
  entregue().find((l) => l.value === tamanho);
const aviso = () =>
  document.body.querySelector('[data-testid="valor-segurado-aviso"]');

beforeEach(() => {
  onEfetivar.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("grade — preço segurado preenche as linhas vazias ao efetivar", () => {
  it("(a) produto sem preço, preço segurado 50: o produto recebe 50 e todas as variantes ficam Auto", () => {
    montar("");
    irParaOPasso2();
    segurarPreco("5000");
    efetivar();

    expect(onEfetivar).toHaveBeenCalledTimes(1);
    expect(precoEntregue()).toBe(50);
    expect(entregue().map((l) => l.priceOverride)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("(b) uma linha com preço próprio 70: ela mantém 70, as outras recebem o segurado e o produto recebe o MENOR", () => {
    montar("");
    irParaOPasso2();
    precoDaLinha("M", "7000");
    segurarPreco("5000");
    efetivar();

    expect(precoEntregue()).toBe(50);
    expect(porTamanho("M")?.priceOverride).toBe(70);
    expect(porTamanho("P")?.priceOverride).toBeUndefined();
    expect(porTamanho("G")?.priceOverride).toBeUndefined();
  });

  it("(b2) linha com preço próprio MENOR que o segurado: o produto recebe o menor e o segurado fica como preço próprio das vazias", () => {
    montar("");
    irParaOPasso2();
    precoDaLinha("M", "3000");
    segurarPreco("5000");
    efetivar();

    expect(precoEntregue()).toBe(30);
    expect(porTamanho("M")?.priceOverride).toBeUndefined();
    expect(porTamanho("P")?.priceOverride).toBe(50);
    expect(porTamanho("G")?.priceOverride).toBe(50);
  });

  it("(h) produto que já tem preço: o segurado vale só para as combinações novas e o preço do produto não muda", () => {
    montar("80.00");
    irParaOPasso2();
    segurarPreco("5000");
    efetivar();

    expect(precoEntregue()).toBeUndefined();
    expect(entregue().map((l) => l.priceOverride)).toEqual([50, 50, 50]);
  });

  it("grade com preço só em algumas linhas e segurado vazio: não chuta, o produto continua pedindo o Preço de Venda", () => {
    montar("");
    irParaOPasso2();
    precoDaLinha("M", "7000");
    efetivar();

    expect(precoEntregue()).toBeUndefined();
    expect(porTamanho("M")?.priceOverride).toBe(70);
    expect(porTamanho("P")?.priceOverride).toBeUndefined();
  });

  it("(e) preço segurado 0,00 é ignorado: nunca vira preço zero nem preço do produto", () => {
    montar("");
    irParaOPasso2();
    segurarPreco("0");
    efetivar();

    expect(precoEntregue()).toBeUndefined();
    expect(entregue().map((l) => l.priceOverride)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("grade — estoque segurado preenche as linhas que a lojista não mexeu", () => {
  it("estoque segurado 10 sem mexer em linha nenhuma: todas gravam 10", () => {
    montar("");
    irParaOPasso2();
    segurarEstoque("10");
    efetivar();

    expect(entregue().map((l) => l.stockIncrement)).toEqual([10, 10, 10]);
  });

  it("(c) uma linha editada à mão para 3: ela fica 3, as outras 10", () => {
    montar("");
    irParaOPasso2();
    estoqueDaLinha("M", "3");
    segurarEstoque("10");
    efetivar();

    expect(porTamanho("P")?.stockIncrement).toBe(10);
    expect(porTamanho("M")?.stockIncrement).toBe(3);
    expect(porTamanho("G")?.stockIncrement).toBe(10);
  });

  it("(d) estoque editado à mão para 0 DE PROPÓSITO (mexeu e voltou a 0): fica 0, não vira o segurado", () => {
    montar("");
    irParaOPasso2();
    estoqueDaLinha("M", "5");
    estoqueDaLinha("M", "0");
    segurarEstoque("10");
    efetivar();

    expect(porTamanho("M")?.stockIncrement).toBe(0);
    expect(porTamanho("P")?.stockIncrement).toBe(10);
    expect(porTamanho("G")?.stockIncrement).toBe(10);
  });

  it("a ordem não importa: segurar o estoque ANTES de editar a linha dá o mesmo resultado", () => {
    montar("");
    irParaOPasso2();
    segurarEstoque("10");
    estoqueDaLinha("M", "3");
    efetivar();

    expect(entregue().map((l) => l.stockIncrement)).toEqual([10, 3, 10]);
  });
});

describe("grade — segurado vazio ou inválido não muda nada (e)", () => {
  it("sem nada segurado: estoque 0, todas Auto e o produto sem preço, como sempre", () => {
    montar("");
    irParaOPasso2();
    efetivar();

    expect(precoEntregue()).toBeUndefined();
    expect(entregue().map((l) => l.stockIncrement)).toEqual([0, 0, 0]);
    expect(entregue().map((l) => l.priceOverride)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("estoque segurado apagado de volta para vazio: ignora", () => {
    montar("");
    irParaOPasso2();
    segurarEstoque("10");
    segurarEstoque("");
    efetivar();

    expect(entregue().map((l) => l.stockIncrement)).toEqual([0, 0, 0]);
  });
});

describe("grade — o botão Aplicar para todas continua como era (f)", () => {
  it("(f) clicar em Aplicar e depois efetivar dá o mesmo resultado do segurado", () => {
    montar("");
    irParaOPasso2();
    segurarPreco("5000");
    segurarEstoque("10");
    aplicarParaTodas();
    efetivar();

    expect(precoEntregue()).toBe(50);
    expect(entregue().map((l) => l.priceOverride)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(entregue().map((l) => l.stockIncrement)).toEqual([10, 10, 10]);
  });

  it("o clique em Aplicar SOBRESCREVE as linhas (como hoje), inclusive a que já tinha preço próprio", () => {
    montar("");
    irParaOPasso2();
    precoDaLinha("M", "7000");
    segurarPreco("5000");
    aplicarParaTodas();
    efetivar();

    expect(precoEntregue()).toBe(50);
    expect(porTamanho("M")?.priceOverride).toBeUndefined();
  });

  it("depois de aplicar, um valor NOVO digitado e não aplicado não sobrescreve o que já foi aplicado", () => {
    montar("");
    irParaOPasso2();
    segurarPreco("5000");
    segurarEstoque("10");
    aplicarParaTodas();
    segurarPreco("8000");
    segurarEstoque("20");
    efetivar();

    expect(precoEntregue()).toBe(50);
    expect(entregue().map((l) => l.stockIncrement)).toEqual([10, 10, 10]);
  });

  it("dupla efetivação continua barrada", () => {
    montar("");
    irParaOPasso2();
    segurarPreco("5000");
    efetivar();
    efetivar();

    expect(onEfetivar).toHaveBeenCalledTimes(1);
  });
});

describe("grade — a frase que avisa do valor segurado (g)", () => {
  it("(g) não aparece sem nada digitado; aparece com preço ou estoque segurado; some depois de Aplicar", () => {
    montar("");
    irParaOPasso2();
    expect(aviso()).toBeNull();

    segurarPreco("5000");
    expect(aviso()?.textContent).toContain("será usado nas linhas vazias");
    expect(aviso()?.textContent).toContain("Aplicar para todas");

    aplicarParaTodas();
    expect(aviso()).toBeNull();

    segurarEstoque("10");
    expect(aviso()).not.toBeNull();
  });

  it("não aparece para preço 0,00 (que não será usado) nem quando todas as linhas já têm o que o segurado preencheria", () => {
    montar("");
    irParaOPasso2();
    segurarPreco("0");
    expect(aviso()).toBeNull();

    segurarPreco("5000");
    expect(aviso()).not.toBeNull();
    precoDaLinha("P", "1000");
    precoDaLinha("M", "1000");
    precoDaLinha("G", "1000");
    expect(aviso()).toBeNull();
  });
});

describe("preencherComSegurado — a regra pura", () => {
  const base = [
    { name: "Tamanho", value: "P", estoque: "0", preco: "" },
    { name: "Tamanho", value: "M", estoque: "0", preco: "70.00" },
  ];

  it("estoque segurado com letras vai pela mesma limpeza de sempre (só dígitos)", () => {
    const r = preencherComSegurado(base, "1a2", "");
    expect(r.linhas.map((l) => l.estoque)).toEqual(["12", "12"]);
    expect(r.preencheu).toBe(true);
  });

  it("estoque segurado sem dígito nenhum e preço segurado não numérico: ignora, devolve as mesmas linhas", () => {
    const r = preencherComSegurado(base, "abc", "-");
    expect(r.linhas).toBe(base);
    expect(r.preencheu).toBe(false);
  });

  it("preço segurado só entra onde o preço está vazio e usa a mesma limpeza do botão (vírgula vira ponto)", () => {
    const r = preencherComSegurado(base, "", "49,90");
    expect(r.linhas.map((l) => l.preco)).toEqual(["49.90", "70.00"]);
  });

  it("não muta as linhas de entrada", () => {
    const copia = structuredClone(base);
    preencherComSegurado(base, "10", "50.00");
    expect(base).toEqual(copia);
  });
});
