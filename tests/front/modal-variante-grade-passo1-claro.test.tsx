// @vitest-environment jsdom
//
// O dono pediu: "sobre as variações tem que lembrar que tem outros valores como
// o tamanho, e isso deve ser fácil de entender como configura". O passo 1 da
// grade passou a ser: um texto de ajuda, um CARTÃO NUMERADO por atributo ("1 ·
// Cor", "2 · Tamanho") com a contagem do que foi escolhido, atalhos que criam o
// segundo atributo já no tipo certo, uma faixa RESUMO com a conta ao vivo
// ("3 cores × 3 tamanhos = 9 combinações") e o botão "Gerar 9 combinações".
//
// Aqui o modal é montado SOZINHO (sem o formulário do produto): o que se prova é
// o que o lojista vê e toca no passo 1. O que a grade grava não mudou e é
// coberto pelos testes de sempre (grade-criar, grade-bordas…).
import { ModalVarianteGrade } from "@/components/admin/products/ModalVarianteGrade";
import type { ProductVariant } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { botaoDoAtributo } from "./helpers/atributo-da-variacao";

const { toastError, toastInfo } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: {
    info: toastInfo,
    success: vi.fn(),
    error: toastError,
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
});

const linha = (name: string, value: string, id = `v-${name}-${value}`) =>
  ({
    id,
    productId: "p-1",
    name,
    value,
    stockIncrement: 1,
    active: true,
  }) as ProductVariant;

async function abrir({
  existentes = [] as ProductVariant[],
  grupoUnicoEmUso = null as string | null,
  sugestoes = ["Cor", "Tamanho", "Voltagem"],
} = {}) {
  await act(async () => {
    raiz.render(
      <ModalVarianteGrade
        aberto
        onFechar={vi.fn()}
        variantesExistentes={existentes}
        sugestoesDeAtributo={sugestoes}
        grupoUnicoEmUso={grupoUnicoEmUso}
        skusDaLoja={[]}
        precoDoProduto=""
        onEfetivar={vi.fn(() => true)}
      />,
    );
  });
}

const texto = (el: Element | null | undefined) =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const corpo = () => texto(document.body);
const cartao = (i: number) =>
  document.querySelector<HTMLElement>(`[data-testid="atributo-${i}"]`);
const resumo = () =>
  document.querySelector<HTMLElement>('[data-testid="resumo-da-grade"]');
const botoes = () => [...document.body.querySelectorAll("button")];
const botaoPorTexto = (t: string) =>
  botoes().find((b) => texto(b).startsWith(t));
const botaoExato = (t: string) => botoes().find((b) => texto(b) === t);

async function tocar(el: Element | null | undefined) {
  if (!el) throw new Error("elemento não está na tela");
  await act(async () => {
    (el as HTMLElement).click();
  });
}

const tocarPeca = (posicao: number, rotulo: string) =>
  tocar(botaoDoAtributo(posicao, rotulo));

/** Toca as bolinhas (ou os tamanhos) do cartão `posicao`, pelo rótulo. */
async function escolher(posicao: number, ...rotulos: string[]) {
  for (const rotulo of rotulos) {
    const doCartao = cartao(posicao);
    const botao =
      doCartao?.querySelector<HTMLElement>(`[aria-label="${rotulo}"]`) ??
      botaoDoAtributo(posicao, rotulo);
    await tocar(botao);
  }
}

const CORES = ["Preto", "Branco", "Cinza"];
const TAMANHOS = ["M", "G", "GG"];

/** Cor com 3 cores + Tamanho com 3 tamanhos, pelo botão e pelas peças. */
async function montarCorETamanho() {
  await tocarPeca(0, "Cor");
  await escolher(0, ...CORES);
  await tocar(botaoExato("+ Adicionar outro atributo"));
  await tocarPeca(1, "Tamanho");
  await escolher(1, ...TAMANHOS);
}

describe("passo 1 da grade — ajuda e cartões numerados", () => {
  it("abre com o texto de ajuda que ensina a juntar cor e tamanho", async () => {
    await abrir();
    expect(corpo()).toContain(
      "Escolha o que muda no produto. Para cor e tamanho juntos, toque em '+ Adicionar outro atributo'.",
    );
  });

  it("cada atributo é um cartão numerado com o tipo: '1 · Cor', '2 · Tamanho'", async () => {
    await abrir();
    expect(texto(cartao(0))).toContain("1 · Escolha o tipo");
    await tocarPeca(0, "Cor");
    expect(texto(cartao(0))).toContain("1 · Cor");
    await tocar(botaoExato("+ Adicionar outro atributo"));
    await tocarPeca(1, "Tamanho");
    expect(texto(cartao(1))).toContain("2 · Tamanho");
  });

  it("'Outro' mostra no título o nome que o lojista digitou", async () => {
    await abrir();
    await tocarPeca(0, "Outro");
    expect(texto(cartao(0))).toContain("1 · Outro");
    await act(async () => {
      const campo = document.getElementById("grade-nome-0") as HTMLInputElement;
      Object.getOwnPropertyDescriptor(
        globalThis.HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo, "Material");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(texto(cartao(0))).toContain("1 · Material");
  });

  it("a contagem concorda em gênero: cores no feminino, tamanhos e voltagens no masculino", async () => {
    await abrir();
    const contagem = (i: number) =>
      texto(cartao(i)?.querySelector('[data-testid="contagem-do-atributo"]'));
    await tocarPeca(0, "Cor");
    expect(contagem(0)).toBe("nenhuma selecionada");
    await escolher(0, "Preto");
    expect(contagem(0)).toBe("1 selecionada");
    await escolher(0, "Branco", "Cinza");
    expect(contagem(0)).toBe("3 selecionadas");

    await tocar(botaoExato("+ Adicionar outro atributo"));
    await tocarPeca(1, "Tamanho");
    expect(contagem(1)).toBe("nenhum selecionado");
    await escolher(1, "M");
    expect(contagem(1)).toBe("1 selecionado");
    await escolher(1, "G");
    expect(contagem(1)).toBe("2 selecionados");

    await tocar(botaoExato("+ Adicionar outro atributo"));
    await tocarPeca(2, "Voltagem");
    await escolher(2, "110V", "220V");
    expect(contagem(2)).toBe("2 selecionados");
  });

  it("o tipo que OUTRO cartão já usa fica apagado e não clicável; o do próprio cartão segue clicável", async () => {
    await abrir();
    await tocarPeca(0, "Cor");
    await tocar(botaoExato("+ Adicionar outro atributo"));

    const corNoSegundo = botaoDoAtributo(1, "Cor");
    expect(corNoSegundo.getAttribute("aria-disabled")).toBe("true");
    expect(
      botaoDoAtributo(1, "Tamanho").getAttribute("aria-disabled"),
    ).toBeNull();
    // O tipo do próprio cartão nunca fica apagado.
    expect(botaoDoAtributo(0, "Cor").getAttribute("aria-disabled")).toBeNull();

    await tocar(corNoSegundo);
    expect(botaoDoAtributo(1, "Cor").getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(texto(cartao(1))).toContain("2 · Escolha o tipo");

    // Ao escolher Tamanho no cartão 2, é o Tamanho que fica apagado no cartão 1.
    await tocarPeca(1, "Tamanho");
    expect(botaoDoAtributo(0, "Tamanho").getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(
      botaoDoAtributo(1, "Tamanho").getAttribute("aria-disabled"),
    ).toBeNull();
  });
});

describe("passo 1 da grade — '+ Adicionar outro atributo' e atalhos", () => {
  it("o botão tracejado tem o texto novo e respeita o limite de atributos", async () => {
    await abrir();
    expect(botaoExato("+ Adicionar outro atributo")).toBeTruthy();
    expect(botaoPorTexto("+ Atributo")).toBeUndefined();
    await tocar(botaoExato("+ Adicionar outro atributo"));
    await tocar(botaoExato("+ Adicionar outro atributo"));
    expect(cartao(2)).toBeTruthy();
    expect(botaoExato("+ Adicionar outro atributo")).toBeUndefined();
  });

  it("só com Cor: pergunta se varia em outra coisa e oferece Tamanho, Voltagem (com exemplo) e Outro", async () => {
    await abrir();
    await tocarPeca(0, "Cor");
    expect(corpo()).toContain(
      "Este produto também varia em outra coisa? Ex.: tamanho.",
    );
    expect(texto(botaoPorTexto("+ Tamanho"))).toBe("+ Tamanho ex.: P, M, G");
    expect(texto(botaoPorTexto("+ Voltagem"))).toBe(
      "+ Voltagem ex.: 110 V, 220 V",
    );
    expect(botaoExato("+ Outro")).toBeTruthy();
    expect(corpo()).not.toContain("Sugestão:");
  });

  it("'+ Tamanho' cria o cartão 2 JÁ em Tamanho; depois só sobram os tipos livres, em 'Sugestão:'", async () => {
    await abrir();
    await tocarPeca(0, "Cor");
    await tocar(botaoPorTexto("+ Tamanho"));
    expect(texto(cartao(1))).toContain("2 · Tamanho");
    expect(botaoDoAtributo(1, "Tamanho").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(corpo()).not.toContain("Este produto também varia");
    expect(corpo()).toContain("Sugestão:");
    expect(botaoPorTexto("+ Tamanho")).toBeUndefined();
    expect(botaoExato("+ Voltagem")).toBeTruthy();
    expect(botaoExato("+ Outro")).toBeTruthy();
  });

  it("'+ Voltagem' cria o cartão já em Voltagem e '+ Outro' já abre o campo do nome", async () => {
    await abrir();
    await tocarPeca(0, "Cor");
    await tocar(botaoPorTexto("+ Voltagem"));
    expect(texto(cartao(1))).toContain("2 · Voltagem");
    await tocar(botaoExato("+ Outro"));
    expect(texto(cartao(2))).toContain("3 · Outro");
    expect(document.getElementById("grade-nome-2")).toBeTruthy();
    // Três atributos: acabou o espaço, e nenhum atalho sobra.
    expect(corpo()).not.toContain("Sugestão:");
    expect(botaoExato("+ Outro")).toBeUndefined();
  });

  it("com Cor e Tamanho já escolhidos, a sugestão tem só Voltagem e Outro", async () => {
    await abrir();
    await montarCorETamanho();
    expect(corpo()).toContain("Sugestão:");
    expect(botaoExato("+ Voltagem")).toBeTruthy();
    expect(botaoExato("+ Outro")).toBeTruthy();
    expect(botaoPorTexto("+ Tamanho")).toBeUndefined();
  });

  it("enquanto o primeiro atributo ainda não tem tipo, não há atalho (nada a 'também' variar)", async () => {
    await abrir();
    expect(botaoPorTexto("+ Tamanho")).toBeUndefined();
    expect(corpo()).not.toContain("Este produto também varia");
    await tocarPeca(0, "Cor");
    expect(botaoPorTexto("+ Tamanho")).toBeTruthy();
  });

  it("produto que já grava um grupo só: nenhum atalho (a trava de um grupo recusaria)", async () => {
    await abrir({
      existentes: [linha("Cor", "Preto")],
      grupoUnicoEmUso: "Cor",
      sugestoes: ["Cor"],
    });
    expect(botaoPorTexto("+ Tamanho")).toBeUndefined();
    expect(botaoPorTexto("+ Voltagem")).toBeUndefined();
    expect(corpo()).not.toContain("Este produto também varia");
    expect(corpo()).not.toContain("Sugestão:");
  });
});

describe("passo 1 da grade — faixa RESUMO", () => {
  it("um atributo: '3 cores = 3 opções' e o aviso de que cada opção tem estoque próprio", async () => {
    await abrir();
    await tocarPeca(0, "Cor");
    await escolher(0, ...CORES);
    expect(texto(resumo())).toContain("RESUMO");
    expect(texto(resumo())).toContain("3 cores = 3 opções");
    expect(texto(resumo())).toContain(
      "Cada opção terá o seu próprio estoque. No próximo passo você coloca a quantidade de cada uma.",
    );
  });

  it("singular: '1 cor = 1 opção'", async () => {
    await abrir();
    await tocarPeca(0, "Cor");
    await escolher(0, "Preto");
    expect(texto(resumo())).toContain("1 cor = 1 opção");
    expect(texto(resumo())).not.toContain("opções");
  });

  it("dois atributos: '3 cores × 3 tamanhos' em linha menor e '= 9 combinações' em destaque", async () => {
    await abrir();
    await montarCorETamanho();
    expect(texto(resumo())).toContain("3 cores × 3 tamanhos");
    expect(texto(resumo())).toContain("= 9 combinações");
    expect(texto(resumo())).toContain(
      "Cada combinação terá o seu próprio estoque. No próximo passo você coloca a quantidade de cada uma.",
    );
  });

  it("singular com dois atributos: '1 cor × 1 tamanho' = '1 combinação'", async () => {
    await abrir();
    await tocarPeca(0, "Cor");
    await escolher(0, "Preto");
    await tocar(botaoExato("+ Adicionar outro atributo"));
    await tocarPeca(1, "Tamanho");
    await escolher(1, "M");
    expect(texto(resumo())).toContain("1 cor × 1 tamanho");
    expect(texto(resumo())).toContain("= 1 combinação");
    expect(texto(resumo())).not.toContain("combinações");
  });

  it("três atributos: 2 cores × 2 tamanhos × 2 voltagens = 8 combinações", async () => {
    await abrir();
    await tocarPeca(0, "Cor");
    await escolher(0, "Preto", "Branco");
    await tocar(botaoExato("+ Adicionar outro atributo"));
    await tocarPeca(1, "Tamanho");
    await escolher(1, "M", "G");
    await tocar(botaoExato("+ Adicionar outro atributo"));
    await tocarPeca(2, "Voltagem");
    await escolher(2, "110V", "220V");
    expect(texto(resumo())).toContain("2 cores × 2 tamanhos × 2 voltagens");
    expect(texto(resumo())).toContain("= 8 combinações");
  });

  it("as combinações que já existem NÃO contam", async () => {
    await abrir({
      existentes: [linha("Cor / Tamanho", "Preto / M")],
      grupoUnicoEmUso: "Cor / Tamanho",
      sugestoes: ["Cor / Tamanho"],
    });
    await escolher(0, "Preto", "Rosa");
    await escolher(1, "M", "G");
    // 2 × 2 = 4, mas "Preto / M" já existe: só 3 são novas.
    expect(texto(resumo())).toContain("2 cores × 2 tamanhos");
    expect(texto(resumo())).toContain("= 3 combinações");
    expect(texto(botaoPorTexto("Gerar"))).toBe("Gerar 3 combinações");
  });

  it("sem nada escolhido, ou com um atributo ainda vazio, pede ao menos uma opção em cada", async () => {
    await abrir();
    await tocarPeca(0, "Cor");
    expect(texto(resumo())).toContain(
      "Escolha pelo menos uma opção em cada atributo.",
    );
    await escolher(0, "Preto");
    expect(texto(resumo())).not.toContain("Escolha pelo menos");
    await tocar(botaoExato("+ Adicionar outro atributo"));
    await tocarPeca(1, "Tamanho");
    expect(texto(resumo())).toContain(
      "Escolha pelo menos uma opção em cada atributo.",
    );
    expect(texto(botaoPorTexto("Gerar"))).toBe("Gerar grade");
  });

  it("passou de 60 combinações: avisa em tom suave e o botão não promete um número", async () => {
    await abrir();
    await tocarPeca(0, "Cor");
    const todasAsCores = [
      ...(cartao(0)?.querySelectorAll<HTMLElement>(
        "[aria-label][aria-pressed]",
      ) ?? []),
    ].map((b) => b.getAttribute("aria-label") ?? "");
    expect(todasAsCores.length).toBe(18);
    await escolher(0, ...todasAsCores);
    await tocar(botaoExato("+ Adicionar outro atributo"));
    await tocarPeca(1, "Tamanho");
    await escolher(1, "PP", "P", "M", "G");
    // 18 × 4 = 72 > 60.
    expect(texto(resumo())).toContain("= 72 combinações");
    expect(texto(resumo())).toContain(
      "Passou do limite de 60 combinações: tire alguma opção.",
    );
    expect(texto(botaoPorTexto("Gerar"))).toBe("Gerar grade");
    // A regra de sempre segue valendo: gerar recusa com o aviso da grade.
    await tocar(botaoPorTexto("Gerar"));
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(corpo()).toContain("passo 1 de 2");
  });

  it("exatamente 60 combinações cabem: sem aviso", async () => {
    await abrir();
    await tocarPeca(0, "Cor");
    await escolher(0, "Preto", "Branco", "Cinza", "Azul", "Verde", "Vermelho");
    await tocar(botaoExato("+ Adicionar outro atributo"));
    await tocarPeca(1, "Tamanho");
    await escolher(1, "PP", "P", "M", "G", "GG", "XG", "34", "36", "38", "40");
    expect(texto(resumo())).toContain("= 60 combinações");
    expect(texto(resumo())).not.toContain("Passou do limite");
    expect(texto(botaoPorTexto("Gerar"))).toBe("Gerar 60 combinações");
  });
});

describe("passo 1 da grade — botão 'Gerar N'", () => {
  it("sem número enquanto nada foi escolhido", async () => {
    await abrir();
    expect(texto(botaoPorTexto("Gerar"))).toBe("Gerar grade");
  });

  it("um atributo: 'Gerar 3 opções' e 'Gerar 1 opção'", async () => {
    await abrir();
    await tocarPeca(0, "Cor");
    await escolher(0, "Preto");
    expect(texto(botaoPorTexto("Gerar"))).toBe("Gerar 1 opção");
    await escolher(0, "Branco", "Cinza");
    expect(texto(botaoPorTexto("Gerar"))).toBe("Gerar 3 opções");
  });

  it("dois atributos: 'Gerar 9 combinações', e o clique leva ao passo 2 com as 9 linhas", async () => {
    await abrir();
    await montarCorETamanho();
    expect(texto(botaoPorTexto("Gerar"))).toBe("Gerar 9 combinações");
    await tocar(botaoPorTexto("Gerar"));
    expect(toastError).not.toHaveBeenCalled();
    expect(corpo()).toContain("passo 2 de 2 · 9 combinações novas");
  });
});

/** Digita no campo do cartão e espera o amortecimento, como o lojista. */
async function digitar(id: string, valor: string) {
  await act(async () => {
    const campo = document.getElementById(id) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
  });
}

describe("passo 1 da grade — achados da revisão", () => {
  it("cartão nascido do '+ Outro' que vira Tamanho: o atalho '+ Tamanho' não volta a ser oferecido", async () => {
    await abrir();
    await tocarPeca(0, "Cor");
    await escolher(0, "Preto");
    await tocar(botaoExato("+ Outro"));
    await tocarPeca(1, "Tamanho");
    expect(botaoExato("+ Tamanho")).toBeUndefined();
  });

  it("voltar do passo 2 reabre o cartão no tipo que ele tinha (Tamanho), não em 'Outro'", async () => {
    await abrir();
    await tocarPeca(0, "Cor");
    await escolher(0, "Preto");
    await tocar(botaoExato("+ Outro"));
    await tocarPeca(1, "Tamanho");
    await escolher(1, "M");
    await tocar(botaoPorTexto("Gerar"));
    expect(corpo()).toContain("passo 2 de 2");
    await tocar(botaoPorTexto("← Voltar") ?? botaoPorTexto("Voltar"));
    expect(corpo()).toContain("passo 1 de 2");
    expect(botaoDoAtributo(1, "Tamanho").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(document.getElementById("grade-nome-1")).toBeNull();
  });

  it("produto que já grava um grupo não recebe a ajuda que manda juntar atributos", async () => {
    await abrir({ grupoUnicoEmUso: "Cor" });
    expect(corpo()).not.toContain("Para cor e tamanho juntos");
  });

  it("dois cartões com o mesmo nome: o resumo avisa e o botão não promete número", async () => {
    await abrir();
    await tocarPeca(0, "Cor");
    await escolher(0, "Preto");
    await tocar(botaoExato("+ Outro"));
    await digitar("grade-nome-1", "cor");
    await digitar("grade-valor-1", "Liso");
    await tocar(
      document.querySelector<HTMLElement>(
        '[aria-label="Adicionar valor do atributo 2"]',
      ),
    );
    expect(texto(resumo())).toContain("Dois atributos se chamam");
    expect(texto(resumo())).not.toContain("= 1 combinação");
    expect(texto(botaoPorTexto("Gerar"))).toBe("Gerar grade");
  });

  it("o aviso do limite conta o que o produto já tem: 58 existentes + 3 novas", async () => {
    const existentes = Array.from({ length: 58 }, (_, i) =>
      linha("Cor", `Cor ${i + 1}`),
    );
    await abrir({ existentes });
    await tocarPeca(0, "Cor");
    await escolher(0, "Preto", "Branco", "Cinza");
    expect(texto(resumo())).toContain("= 3 opções");
    expect(texto(resumo())).toContain(
      "O produto já tem 58; o limite é 60 no total.",
    );
    expect(texto(botaoPorTexto("Gerar"))).toBe("Gerar grade");
  });
});
