// @vitest-environment jsdom
//
// O passo 1 da grade com os atributos novos (Capacidade e Material) e com os
// botões "Marcar todos" / "Limpar". Aqui o modal é montado SOZINHO: o que se
// prova é o que o lojista vê e toca, e que os limites da grade (no máximo 3
// atributos, 60 combinações, nome repetido) seguem valendo com os tipos novos.
import { ModalVarianteGrade } from "@/components/admin/products/ModalVarianteGrade";
import type { ProductVariant } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { botaoDoAtributo } from "./helpers/atributo-da-variacao";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
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

const linha = (name: string, value: string) =>
  ({
    id: `v-${name}-${value}`,
    productId: "p-1",
    name,
    value,
    stockIncrement: 1,
    active: true,
  }) as ProductVariant;

// Os atributos comuns da casa, como o formulário os oferece a um produto novo.
const COMUNS = ["Cor", "Tamanho", "Voltagem", "Capacidade", "Material"];

async function abrir({
  existentes = [] as ProductVariant[],
  grupoUnicoEmUso = null as string | null,
  sugestoes = COMUNS,
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

/** Toca os botões (ou bolinhas) do cartão `posicao`, pelo texto. */
async function escolher(posicao: number, ...rotulos: string[]) {
  for (const rotulo of rotulos) {
    const doCartao = cartao(posicao);
    const botao =
      doCartao?.querySelector<HTMLElement>(`[aria-label="${rotulo}"]`) ??
      botaoDoAtributo(posicao, rotulo);
    await tocar(botao);
  }
}

const aba = (posicao: number, rotulo: string) =>
  [
    ...(cartao(posicao)?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []),
  ].find((a) => texto(a) === rotulo);
const acao = (posicao: number, rotulo: string) =>
  [...(cartao(posicao)?.querySelectorAll("button") ?? [])].find(
    (b) => texto(b) === rotulo,
  );
const contagem = (i: number) =>
  texto(cartao(i)?.querySelector('[data-testid="contagem-do-atributo"]'));

describe("grade com Tamanho + Cor + Capacidade (o máximo de 3 atributos)", () => {
  async function montarOsTres() {
    await tocarPeca(0, "Tamanho");
    await escolher(0, "M", "G");
    await tocar(botaoExato("+ Adicionar outro atributo"));
    await tocarPeca(1, "Cor");
    await escolher(1, "Preto", "Branco");
    await tocar(botaoExato("+ Adicionar outro atributo"));
    await tocarPeca(2, "Capacidade");
    await escolher(2, "64 GB", "128 GB");
  }

  it("2 tamanhos × 2 cores × 2 capacidades = 8 combinações, e o botão diz 'Gerar 8 combinações'", async () => {
    await abrir();
    await montarOsTres();
    expect(texto(cartao(2))).toContain("3 · Capacidade");
    expect(texto(resumo())).toContain("2 tamanhos × 2 cores × 2 capacidades");
    expect(texto(resumo())).toContain("= 8 combinações");
    expect(texto(botaoPorTexto("Gerar"))).toBe("Gerar 8 combinações");
  });

  it("com 3 atributos acabou o espaço: nem '+ Adicionar outro atributo' nem atalho sobram", async () => {
    await abrir();
    await montarOsTres();
    expect(botaoExato("+ Adicionar outro atributo")).toBeUndefined();
    expect(corpo()).not.toContain("Sugestão:");
  });

  it("o clique em Gerar leva ao passo 2 com as 8 linhas e sem erro", async () => {
    await abrir();
    await montarOsTres();
    await tocar(botaoPorTexto("Gerar"));
    expect(toastError).not.toHaveBeenCalled();
    expect(corpo()).toContain("passo 2 de 2 · 8 combinações novas");
  });

  it("a contagem do cartão: capacidades no feminino, tamanhos no masculino", async () => {
    await abrir();
    await montarOsTres();
    expect(contagem(0)).toBe("2 selecionados");
    expect(contagem(2)).toBe("2 selecionadas");
  });

  it("Capacidade escolhida em um cartão fica apagada nos outros (um tipo por cartão)", async () => {
    await abrir();
    await tocarPeca(0, "Capacidade");
    await tocar(botaoExato("+ Adicionar outro atributo"));
    expect(botaoDoAtributo(1, "Capacidade").getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(botaoDoAtributo(1, "Material").getAttribute("aria-disabled")).toBe(
      null,
    );
  });
});

describe("o resumo concorda em número", () => {
  it("'1 capacidade' e '3 capacidades'", async () => {
    await abrir();
    await tocarPeca(0, "Capacidade");
    await escolher(0, "64 GB");
    expect(texto(resumo())).toContain("1 capacidade = 1 opção");
    await escolher(0, "128 GB", "256 GB");
    expect(texto(resumo())).toContain("3 capacidades = 3 opções");
  });

  it("'1 material' e '3 materiais'", async () => {
    await abrir();
    await tocarPeca(0, "Material");
    await escolher(0, "Algodão");
    expect(texto(resumo())).toContain("1 material = 1 opção");
    await escolher(0, "Linho", "Jeans");
    expect(texto(resumo())).toContain("3 materiais = 3 opções");
  });

  it("em duas camadas: '3 materiais × 2 capacidades = 6 combinações'", async () => {
    await abrir();
    await tocarPeca(0, "Material");
    await escolher(0, "Algodão", "Linho", "Jeans");
    await tocar(botaoExato("+ Adicionar outro atributo"));
    await tocarPeca(1, "Capacidade");
    await tocar(aba(1, "Volume"));
    await escolher(1, "1 L", "2 L");
    expect(texto(resumo())).toContain("3 materiais × 2 capacidades");
    expect(texto(resumo())).toContain("= 6 combinações");
  });

  it("produto que já grava 'Armazenamento' (apelido de Capacidade) completa a grade com plural certo e o nome intacto", async () => {
    await abrir({
      existentes: [linha("Armazenamento", "64 GB")],
      grupoUnicoEmUso: "Armazenamento",
      sugestoes: ["Armazenamento"],
    });
    expect(texto(cartao(0))).toContain("1 · Capacidade");
    expect(botaoDoAtributo(0, "Capacidade").getAttribute("aria-pressed")).toBe(
      "true",
    );
    // O 64 GB já existe e vem pronto como chip "já usado".
    expect(
      [...document.querySelectorAll('[data-testid="chip-do-produto"]')].map(
        (c) => texto(c),
      ),
    ).toEqual(["64 GB já usado"]);
    await escolher(0, "128 GB", "256 GB");
    expect(texto(resumo())).toContain("2 capacidades = 2 opções");
  });
});

describe("a trava de nome repetido vale para os tipos novos", () => {
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

  it("Capacidade num cartão e 'capacidade' digitado no 'Outro' do outro: o resumo avisa e não promete número", async () => {
    await abrir();
    await tocarPeca(0, "Capacidade");
    await escolher(0, "64 GB");
    await tocar(botaoExato("+ Outro"));
    await digitar("grade-nome-1", "capacidade");
    await digitar("grade-valor-1", "Grande");
    await tocar(
      document.querySelector<HTMLElement>(
        '[aria-label="Adicionar valor do atributo 2"]',
      ),
    );
    expect(texto(resumo())).toContain("Dois atributos se chamam");
    expect(texto(botaoPorTexto("Gerar"))).toBe("Gerar grade");
  });

  it("'Material' digitado no 'Outro' e a peça Material em outro cartão: mesmo aviso", async () => {
    await abrir();
    await tocarPeca(0, "Material");
    await escolher(0, "Linho");
    await tocar(botaoExato("+ Outro"));
    await digitar("grade-nome-1", "MATERIAL");
    await digitar("grade-valor-1", "Seda");
    await tocar(
      document.querySelector<HTMLElement>(
        '[aria-label="Adicionar valor do atributo 2"]',
      ),
    );
    expect(texto(resumo())).toContain("Dois atributos se chamam");
    await tocar(botaoPorTexto("Gerar"));
    expect(corpo()).toContain("passo 1 de 2");
  });
});

describe("os atalhos '+ …' do segundo atributo", () => {
  it("só com Cor: no máximo três tipos por prioridade (Tamanho, Voltagem, Capacidade) e o '+ Outro'", async () => {
    await abrir();
    await tocarPeca(0, "Cor");
    expect(texto(botaoPorTexto("+ Tamanho"))).toBe("+ Tamanho ex.: P, M, G");
    expect(texto(botaoPorTexto("+ Voltagem"))).toBe(
      "+ Voltagem ex.: 110 V, 220 V",
    );
    expect(texto(botaoPorTexto("+ Capacidade"))).toBe(
      "+ Capacidade ex.: 64 GB, 1 L",
    );
    expect(botaoPorTexto("+ Material")).toBeUndefined();
    expect(botaoExato("+ Outro")).toBeTruthy();
  });

  it("com Cor e Tamanho já escolhidos sobram Voltagem, Capacidade e Material (e Outro)", async () => {
    await abrir();
    await tocarPeca(0, "Cor");
    await tocar(botaoPorTexto("+ Tamanho"));
    expect(corpo()).toContain("Sugestão:");
    expect(botaoPorTexto("+ Voltagem")).toBeTruthy();
    expect(botaoPorTexto("+ Capacidade")).toBeTruthy();
    expect(botaoPorTexto("+ Material")).toBeTruthy();
    expect(botaoExato("+ Outro")).toBeTruthy();
    expect(botaoPorTexto("+ Tamanho")).toBeUndefined();
    expect(botaoPorTexto("+ Cor")).toBeUndefined();
  });

  it("'+ Capacidade' cria o cartão 2 já em Capacidade, com as abas", async () => {
    await abrir();
    await tocarPeca(0, "Cor");
    await tocar(botaoPorTexto("+ Capacidade"));
    expect(texto(cartao(1))).toContain("2 · Capacidade");
    expect(botaoDoAtributo(1, "Capacidade").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(aba(1, "Armazenamento")).toBeTruthy();
    expect(botaoPorTexto("+ Capacidade")).toBeUndefined();
  });

  it("'+ Material' cria o cartão 2 já em Material", async () => {
    await abrir();
    await tocarPeca(0, "Cor");
    await tocar(botaoPorTexto("+ Tamanho"));
    await tocar(botaoPorTexto("+ Material"));
    expect(texto(cartao(2))).toContain("3 · Material");
    expect(botaoDoAtributo(2, "Material").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("produto que já grava um grupo só: nenhum atalho novo também", async () => {
    await abrir({
      existentes: [linha("Capacidade", "64 GB")],
      grupoUnicoEmUso: "Capacidade",
      sugestoes: ["Capacidade"],
    });
    expect(botaoPorTexto("+ Material")).toBeUndefined();
    expect(botaoPorTexto("+ Tamanho")).toBeUndefined();
    expect(corpo()).not.toContain("Sugestão:");
  });
});

describe("Marcar todos e Limpar na grade (o pai troca a lista inteira de uma vez)", () => {
  it("Marcar todos marca os 7 tamanhos de roupa de uma vez: o resumo conta 7, não 1", async () => {
    await abrir();
    await tocarPeca(0, "Tamanho");
    await tocar(acao(0, "Marcar todos"));
    expect(texto(resumo())).toContain("7 tamanhos = 7 opções");
    expect(contagem(0)).toBe("7 selecionados");
    expect(acao(0, "Marcar todos")).toBeUndefined();
  });

  it("Limpar desmarca tudo e o resumo volta a pedir uma escolha", async () => {
    await abrir();
    await tocarPeca(0, "Tamanho");
    await tocar(acao(0, "Marcar todos"));
    await tocar(acao(0, "Limpar"));
    expect(contagem(0)).toBe("nenhum selecionado");
    expect(texto(resumo())).toContain(
      "Escolha pelo menos uma opção em cada atributo.",
    );
  });

  it("passou de 60: 12 números × 6 cores = 72 avisa e o botão não promete número", async () => {
    await abrir();
    await tocarPeca(0, "Tamanho");
    await tocar(aba(0, "Números"));
    await tocar(acao(0, "Marcar todos"));
    await tocar(botaoExato("+ Adicionar outro atributo"));
    await tocarPeca(1, "Cor");
    await escolher(1, "Preto", "Branco", "Cinza", "Azul", "Verde", "Vermelho");
    expect(texto(resumo())).toContain("= 72 combinações");
    expect(texto(resumo())).toContain("Passou do limite de 60 combinações");
    expect(texto(botaoPorTexto("Gerar"))).toBe("Gerar grade");
  });

  it("os marcados em abas diferentes entram juntos na mesma grade", async () => {
    await abrir();
    await tocarPeca(0, "Tamanho");
    await escolher(0, "P", "M");
    await tocar(aba(0, "Números"));
    await escolher(0, "38", "40");
    expect(contagem(0)).toBe("4 selecionados");
    expect(texto(resumo())).toContain("4 tamanhos = 4 opções");
    await tocar(botaoPorTexto("Gerar"));
    expect(corpo()).toContain("passo 2 de 2 · 4 combinações novas");
  });

  it("voltar do passo 2 reabre o cartão na aba dos valores escolhidos (Números), com tudo marcado", async () => {
    await abrir();
    await tocarPeca(0, "Tamanho");
    await tocar(aba(0, "Números"));
    await escolher(0, "38", "40");
    await tocar(botaoPorTexto("Gerar"));
    expect(corpo()).toContain("passo 2 de 2");
    await tocar(botaoPorTexto("← Voltar") ?? botaoPorTexto("Voltar"));
    expect(corpo()).toContain("passo 1 de 2");
    expect(aba(0, "Números")?.getAttribute("aria-selected")).toBe("true");
    expect(contagem(0)).toBe("2 selecionados");
  });
});

describe("o valor digitado numa aba 'Outro' entra na grade", () => {
  it("'2 anos' digitado na aba Outro vira botão marcado e conta no resumo", async () => {
    await abrir();
    await tocarPeca(0, "Tamanho");
    await tocar(aba(0, "Outro"));
    await act(async () => {
      const campo = document.getElementById(
        "grade-valor-0",
      ) as HTMLInputElement;
      Object.getOwnPropertyDescriptor(
        globalThis.HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo, "2 anos");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
    });
    await tocar(
      document.querySelector<HTMLElement>(
        '[aria-label="Adicionar valor do atributo 1"]',
      ),
    );
    expect(texto(resumo())).toContain("1 tamanho = 1 opção");
    const chip = cartao(0)?.querySelector('[data-testid="chip-do-produto"]');
    expect(texto(chip)).toBe("2 anos");
    expect(chip?.getAttribute("aria-pressed")).toBe("true");
  });
});
