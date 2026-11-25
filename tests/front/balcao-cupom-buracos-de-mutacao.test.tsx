// @vitest-environment jsdom
//
// Buracos achados por caça de mutação em CupomDaVenda (o cupom do balcão). Os
// testes antigos só o exercitam pela tela inteira do balcão:
//  - na folha "Qual combinação?", a opção sem estoque fica travada e diz
//    "Esgotado"; a com estoque mostra preço e quantidade e escolhe;
//  - "Limpar a tela da venda" aparece quando QUALQUER coisa da venda está no
//    cupom (item, desconto, cliente, forma de pagamento) e some quando não há
//    nada — pagamento escolhido ou cliente sobreviviam à desistência e iam
//    para a venda seguinte;
//  - o aviso "Limite do estoque" aparece só no teto.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CupomDaVenda } from "@/components/admin/pdv/CupomDaVenda";
import {
  type EstadoDaVenda,
  type ItemDoCupom,
  type OpcaoDeVariacao,
  estadoInicialDaVenda,
} from "@/hooks/useVendaPresencial";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

const ITEM: ItemDoCupom = {
  chave: "produto-1::",
  productId: "produto-1",
  variantId: null,
  nome: "Camiseta de Teste",
  variacao: null,
  preco: 10,
  quantidade: 1,
  estoque: 5,
  imagem: "",
};

function estado(extra: Partial<EstadoDaVenda> = {}): EstadoDaVenda {
  return { ...estadoInicialDaVenda(() => "chave-de-teste"), ...extra };
}

function montar(
  e: EstadoDaVenda,
  extra: {
    despachar?: (a: unknown) => void;
    limparCupom?: () => void;
    agora?: () => number;
  } = {},
) {
  act(() =>
    raiz.render(
      <CupomDaVenda
        estado={e}
        despachar={(extra.despachar ?? vi.fn()) as never}
        subtotal={0}
        onNavigate={vi.fn()}
        limparCupom={extra.limparCupom ?? vi.fn()}
        feedback={null}
        agora={extra.agora}
      />,
    ),
  );
}

const botoes = () => Array.from(host.querySelectorAll("button"));
const botaoLimpar = () =>
  botoes().find((b) => b.textContent?.startsWith("Limpar"));

const OPCAO_ESGOTADA: OpcaoDeVariacao = {
  variant_id: "v-1",
  nome: "Tamanho",
  valor: "P",
  preco: 49.9,
  estoque: 0,
  imagem: null,
  codigo_barras: null,
};
const OPCAO_COM_ESTOQUE: OpcaoDeVariacao = {
  variant_id: "v-2",
  nome: "Tamanho",
  valor: "M",
  preco: 59.9,
  estoque: 3,
  imagem: null,
  codigo_barras: null,
};

describe("folha 'Qual combinação?'", () => {
  function comEscolha(despachar = vi.fn(), agora = () => 1234) {
    montar(
      estado({
        escolhaDeVariacao: {
          codigo: "123",
          produtoId: "produto-9",
          produtoNome: "Vestido de Teste",
          opcoes: [OPCAO_ESGOTADA, OPCAO_COM_ESTOQUE],
        },
      }),
      { despachar, agora },
    );
    const opcao = (texto: string) =>
      botoes().find((b) => b.textContent?.includes(texto));
    return { despachar, opcao };
  }

  it("opção sem estoque fica travada e diz 'Esgotado'", () => {
    const { opcao } = comEscolha();
    const esgotada = opcao("Tamanho P");
    expect(esgotada?.disabled).toBe(true);
    expect(esgotada?.textContent).toContain("Esgotado");
  });

  it("opção com estoque mostra preço e quantidade e fica liberada", () => {
    const { opcao } = comEscolha();
    const livre = opcao("Tamanho M");
    expect(livre?.disabled).toBe(false);
    expect(livre?.textContent).toContain("R$ 59,90 · 3 em estoque");
  });

  it("escolher a opção com estoque despacha a escolha com o relógio da tela", () => {
    const despachar = vi.fn();
    const { opcao } = comEscolha(despachar, () => 98765);
    act(() => opcao("Tamanho M")?.click());
    expect(despachar).toHaveBeenCalledExactlyOnceWith({
      tipo: "variacao_escolhida",
      opcao: OPCAO_COM_ESTOQUE,
      em: 98765,
    });
  });

  it("clicar na opção esgotada não despacha nada", () => {
    const despachar = vi.fn();
    const { opcao } = comEscolha(despachar);
    act(() => opcao("Tamanho P")?.click());
    expect(despachar).not.toHaveBeenCalled();
  });
});

describe("botão 'Limpar a tela da venda'", () => {
  it("cupom sem nada da venda: o botão não aparece", () => {
    montar(estado());
    expect(botaoLimpar()).toBeUndefined();
  });

  it.each([
    ["só um item", { itens: [ITEM] }],
    ["só um desconto", { desconto: 5 }],
    ["só uma forma de pagamento escolhida", { pagamento: "pix" as const }],
    [
      "só um cliente cadastrado",
      {
        cliente: {
          tipo: "cadastrado" as const,
          userId: "u-1",
          nome: "Cliente de Teste",
          whatsapp: null,
        },
      },
    ],
    [
      "só um cliente avulso",
      {
        cliente: {
          tipo: "avulso" as const,
          nome: "Cliente Avulso",
          whatsapp: "00000000000",
        },
      },
    ],
  ])("%s: o botão aparece", (_nome, extra) => {
    montar(estado(extra));
    expect(botaoLimpar()).toBeDefined();
  });

  it("limpar pede confirmação e só zera depois do 'Limpar esta venda da tela'", () => {
    const limparCupom = vi.fn();
    montar(estado({ pagamento: "cash" }), { limparCupom });
    act(() => botaoLimpar()?.click());
    expect(limparCupom).not.toHaveBeenCalled();
    const confirmar = botoes().find(
      (b) => b.textContent === "Limpar esta venda da tela",
    );
    act(() => confirmar?.click());
    expect(limparCupom).toHaveBeenCalledTimes(1);
  });
});

describe("limite de estoque de um item", () => {
  it("abaixo do teto: '+' liberado e sem aviso de limite", () => {
    montar(estado({ itens: [{ ...ITEM, quantidade: 2, estoque: 5 }] }));
    const mais = host.querySelector<HTMLButtonElement>(
      `[aria-label="Aumentar quantidade de Camiseta de Teste"]`,
    );
    expect(mais?.disabled).toBe(false);
    expect(host.textContent).not.toContain("Limite do estoque");
  });

  it("no teto: '+' travado e o aviso diz quantas unidades há", () => {
    montar(estado({ itens: [{ ...ITEM, quantidade: 5, estoque: 5 }] }));
    const mais = host.querySelector<HTMLButtonElement>(
      `[aria-label="Aumentar quantidade de Camiseta de Teste"]`,
    );
    expect(mais?.disabled).toBe(true);
    expect(host.textContent).toContain("Limite do estoque · 5 un.");
  });

  it("o total da linha é preço vezes quantidade", () => {
    montar(
      estado({ itens: [{ ...ITEM, preco: 12.5, quantidade: 3, estoque: 9 }] }),
    );
    expect(host.textContent).toContain("R$ 37,50");
  });
});
