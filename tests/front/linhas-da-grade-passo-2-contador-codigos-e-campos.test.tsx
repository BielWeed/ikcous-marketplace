// @vitest-environment jsdom
//
// Passo 2 da grade de variações (LinhasDaGrade) renderizado SOZINHO: o
// contador "Só N novas — M existentes não são tocadas", o código previsto de
// cada linha, o que cada campo mostra e para qual callback cada campo envia o
// que a lojista digitou, e as três frases sobre o preço do produto. Caça por
// mutação (25/11/2026): dos 32 defeitos plantados, os três testes do modal
// (grade-criar, grade-completar-e-chips, letra-e-toque) derrubaram 31; só
// sobreviveu o nome acessível do campo de preço de cada linha ("Preço de
// <valor>" virar "Preço de <nome do atributo>"). Este arquivo prende essa
// peça diretamente, sem precisar montar o modal inteiro.
//
// Não plantado, e anotado como equivalente por construção: trocar
// `key={JSON.stringify([name, value])}` por `key={i}` — o React só reaproveita
// o nó por posição e, sem reordenar linhas na mesma montagem, o DOM é o mesmo.
import {
  type LinhaNoPasso2,
  LinhasDaGrade,
} from "@/components/admin/products/LinhasDaGrade";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINHAS: LinhaNoPasso2[] = [
  { name: "Cor", value: "Azul", estoque: "3", preco: "19.90" },
  { name: "Cor", value: "Verde", estoque: "5", preco: "" },
];

function props(sobre: Partial<Parameters<typeof LinhasDaGrade>[0]> = {}) {
  return {
    linhas: LINHAS,
    quantasExistentes: 2,
    precoDoProduto: 49.9,
    produtoSemPreco: false,
    skusPrevistos: ["BLU-AZUL", "BLU-VERDE"],
    skuBase: "BLU",
    onSkuBase: vi.fn(),
    aplicarEstoque: "7",
    onAplicarEstoque: vi.fn(),
    aplicarPreco: "12.50",
    onAplicarPreco: vi.fn(),
    onAplicarParaTodas: vi.fn(),
    valorSeguradoPendente: false,
    onMudarLinha: vi.fn(),
    ...sobre,
  };
}

let host: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});

afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

function montar(sobre: Partial<Parameters<typeof LinhasDaGrade>[0]> = {}) {
  const p = props(sobre);
  act(() => {
    raiz.render(<LinhasDaGrade {...p} />);
  });
  return p;
}

const por = (seletor: string) => host.querySelector<HTMLInputElement>(seletor);
const texto = (id: string) =>
  host.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;

function digitar(el: HTMLInputElement | null, valor: string) {
  if (!el) throw new Error("campo não achado");
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    el.focus();
    setter?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    el.blur();
  });
}

describe("LinhasDaGrade: o contador", () => {
  it("várias novas e várias existentes: plural nos dois lados, com os números certos", () => {
    montar({
      linhas: [
        ...LINHAS,
        { name: "Cor", value: "Rosa", estoque: "", preco: "" },
      ],
      quantasExistentes: 5,
    });
    expect(texto("contador-da-grade")).toBe(
      "Só as 3 novas — as 5 existentes não são tocadas",
    );
  });

  it("uma nova e uma existente: singular nos dois lados", () => {
    montar({ linhas: [LINHAS[0]], quantasExistentes: 1 });
    expect(texto("contador-da-grade")).toBe(
      "Só 1 nova — a 1 existente não é tocada",
    );
  });

  it("nenhuma existente: 'as 0 existentes' (não é singular)", () => {
    montar({ quantasExistentes: 0 });
    expect(texto("contador-da-grade")).toBe(
      "Só as 2 novas — as 0 existentes não são tocadas",
    );
  });

  it("duas novas NÃO usam o singular", () => {
    montar();
    expect(texto("contador-da-grade")).toContain("as 2 novas");
    expect(texto("contador-da-grade")).not.toContain("1 nova");
  });
});

describe("LinhasDaGrade: uma linha por combinação nova", () => {
  it("mostra o valor de cada combinação e o código previsto dela", () => {
    montar();
    const nomes = [...host.querySelectorAll('[data-testid="linha-da-grade"]')];
    expect(nomes.map((n) => n.textContent)).toEqual(["Azul", "Verde"]);
    const codigos = [...host.querySelectorAll('[data-testid="sku-da-linha"]')];
    expect(codigos.map((c) => c.textContent)).toEqual([
      "BLU-AZUL",
      "BLU-VERDE",
    ]);
  });

  it("código vazio, ausente ou fora da lista vira 'sem código'", () => {
    montar({ skusPrevistos: ["", "BLU-VERDE"] });
    let codigos = [...host.querySelectorAll('[data-testid="sku-da-linha"]')];
    expect(codigos.map((c) => c.textContent)).toEqual([
      "sem código",
      "BLU-VERDE",
    ]);
    montar({ skusPrevistos: ["BLU-AZUL"] });
    codigos = [...host.querySelectorAll('[data-testid="sku-da-linha"]')];
    expect(codigos.map((c) => c.textContent)).toEqual([
      "BLU-AZUL",
      "sem código",
    ]);
  });

  it("cada campo tem id pelo índice e nome acessível pelo VALOR da combinação", () => {
    montar();
    expect(por("#grade-linha-estoque-0")?.getAttribute("aria-label")).toBe(
      "Estoque de Azul",
    );
    expect(por("#grade-linha-estoque-1")?.getAttribute("aria-label")).toBe(
      "Estoque de Verde",
    );
    expect(por("#grade-linha-preco-0")?.getAttribute("aria-label")).toBe(
      "Preço de Azul",
    );
    expect(por("#grade-linha-preco-1")?.getAttribute("aria-label")).toBe(
      "Preço de Verde",
    );
    expect(por("#grade-linha-estoque-2")).toBeNull();
  });

  it("estoque e preço aparecem nos campos CERTOS de cada linha", () => {
    montar();
    expect(por("#grade-linha-estoque-0")?.value).toBe("3");
    expect(por("#grade-linha-estoque-1")?.value).toBe("5");
    expect(por("#grade-linha-preco-0")?.value).toBe("19,90");
    expect(por("#grade-linha-preco-1")?.value).toBe("");
    expect(por("#grade-linha-preco-1")?.placeholder).toBe("Auto");
  });

  it("digitar o estoque de uma linha avisa 'estoque' com o índice dela; o preço avisa 'preco'", () => {
    const p = montar();
    digitar(por("#grade-linha-estoque-1"), "9");
    expect(p.onMudarLinha).toHaveBeenLastCalledWith(1, "estoque", "9");
    digitar(por("#grade-linha-preco-0"), "25");
    expect(p.onMudarLinha).toHaveBeenCalledTimes(2);
    // A máscara de dinheiro lê os dígitos como centavos: "25" = R$ 0,25.
    expect(p.onMudarLinha).toHaveBeenLastCalledWith(0, "preco", "0.25");
  });
});

describe("LinhasDaGrade: zero digitado no preço vale 'vazio' (usa o preço do produto)", () => {
  it("preço de uma linha: digitar 0 devolve texto vazio, não '0.00' (senão a variação sairia de graça)", () => {
    const p = montar();
    digitar(por("#grade-linha-preco-0"), "0");
    expect(p.onMudarLinha).toHaveBeenLastCalledWith(0, "preco", "");
  });

  it("preço do 'Aplicar para todas': digitar 0 também devolve vazio", () => {
    const p = montar();
    digitar(por("#grade-aplicar-preco"), "0");
    expect(p.onAplicarPreco).toHaveBeenLastCalledWith("");
  });
});

describe("LinhasDaGrade: 'Aplicar para todas' e o código base", () => {
  it("os campos mostram o que o modal guardou, cada um o seu", () => {
    montar();
    expect(por("#grade-aplicar-estoque")?.value).toBe("7");
    expect(por("#grade-aplicar-preco")?.value).toBe("12,50");
    expect(por("#grade-sku-base")?.value).toBe("BLU");
  });

  it("cada campo envia para o SEU callback", () => {
    const p = montar();
    digitar(por("#grade-aplicar-estoque"), "11");
    expect(p.onAplicarEstoque).toHaveBeenLastCalledWith("11");
    expect(p.onAplicarPreco).not.toHaveBeenCalled();
    digitar(por("#grade-aplicar-preco"), "30");
    expect(p.onAplicarPreco).toHaveBeenCalledTimes(1);
    expect(p.onAplicarEstoque).toHaveBeenCalledTimes(1);
    digitar(por("#grade-sku-base"), "NOVO");
    expect(p.onSkuBase).toHaveBeenLastCalledWith("NOVO");
    expect(p.onAplicarEstoque).toHaveBeenCalledTimes(1);
    expect(p.onMudarLinha).not.toHaveBeenCalled();
  });

  it("o botão 'Aplicar para todas' chama o callback uma vez", () => {
    const p = montar();
    const botao = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Aplicar para todas",
    );
    expect(botao).toBeTruthy();
    act(() => botao?.click());
    expect(p.onAplicarParaTodas).toHaveBeenCalledTimes(1);
  });

  it("o aviso do valor segurado só aparece quando há valor pendente", () => {
    montar({ valorSeguradoPendente: false });
    expect(
      host.querySelector('[data-testid="valor-segurado-aviso"]'),
    ).toBeNull();
    montar({ valorSeguradoPendente: true });
    const aviso = host.querySelector('[data-testid="valor-segurado-aviso"]');
    expect(aviso?.getAttribute("role")).toBe("status");
    expect(aviso?.textContent).toContain(
      "Este valor será usado nas linhas que você ainda não preencheu ao salvar.",
    );
    expect(aviso?.textContent).toContain('Clique em "Aplicar para todas"');
  });
});

describe("LinhasDaGrade: o que se diz sobre o preço do produto", () => {
  it("produto COM preço: mostra o preço em reais, sugere no campo e explica o 'Auto'", () => {
    montar({ precoDoProduto: 49.9 });
    expect(texto("preco-do-produto-na-grade")).toContain(
      "O preço do produto é R$ 49,90.",
    );
    expect(texto("preco-do-produto-na-grade")).toContain('("Auto")');
    expect(texto("preco-do-produto-na-grade")).toContain(
      "Deixe o preço vazio para a variação usar esse mesmo preço",
    );
    expect(texto("preco-do-produto-na-grade")).toContain(
      "não muda o preço do produto",
    );
    expect(por("#grade-aplicar-preco")?.placeholder).toBe("49,90");
  });

  it("preço inteiro também leva duas casas (R$ 10,00)", () => {
    montar({ precoDoProduto: 10 });
    expect(texto("preco-do-produto-na-grade")).toContain("R$ 10,00.");
    expect(por("#grade-aplicar-preco")?.placeholder).toBe("10,00");
  });

  it("produto SEM preço (campo vazio): diz que o preço digitado vira o do produto", () => {
    montar({ precoDoProduto: undefined, produtoSemPreco: true });
    expect(texto("preco-do-produto-na-grade")).toContain(
      "O produto ainda não tem Preço de Venda: o preço que você digitar para todas as linhas vira o dele",
    );
    expect(texto("preco-do-produto-na-grade")).toContain("vale o menor");
    expect(por("#grade-aplicar-preco")?.placeholder).toBe("preço");
  });

  it("preço do produto escrito mas inválido (ex.: 0,00): NÃO promete que vira o preço do produto", () => {
    montar({ precoDoProduto: undefined, produtoSemPreco: false });
    expect(texto("preco-do-produto-na-grade")).toContain(
      "O Preço de Venda do produto ainda não está certo (corrija no formulário).",
    );
    expect(texto("preco-do-produto-na-grade")).not.toContain("vira o dele");
    expect(por("#grade-aplicar-preco")?.placeholder).toBe("preço");
  });
});

describe("LinhasDaGrade: textos fixos", () => {
  it("rótulos do bloco e do código base", () => {
    montar();
    expect(host.textContent).toContain("Aplicar para todas");
    expect(host.textContent).toContain(
      "Código interno base (o sufixo por valor é automático)",
    );
    expect(por("#grade-sku-base")?.placeholder).toBe(
      "Ex: BLU — vazio nasce sem código",
    );
    expect(por("#grade-aplicar-estoque")?.placeholder).toBe("estoque");
    expect(por("#grade-aplicar-estoque")?.getAttribute("aria-label")).toBe(
      "Estoque para todas as linhas",
    );
    expect(por("#grade-aplicar-preco")?.getAttribute("aria-label")).toBe(
      "Preço para todas as linhas",
    );
  });
});
