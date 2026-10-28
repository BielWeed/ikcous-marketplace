// @vitest-environment jsdom
//
// Lote 245 — Balcão: o recibo vermelho ("Entrou uma venda diferente da que
// estava na tela") não pode fazer a caixa perder a venda.
//
// Caminho: venda com 3 peças → "Não sabemos se a venda foi registrada" → a
// caixa acrescenta uma 4ª peça (MESMA chave de idempotência, regra do reenvio
// que NÃO muda) → tenta de novo → o banco devolve a venda ANTIGA
// (`ja_existia`). Este arquivo prende quatro coisas:
//  (d) depois de anular, o alerta "Anule esta venda" some;
//  (a) o alerta diz QUAIS peças diferem, em palavras simples;
//  (b) "Nova venda" depois de uma divergência não apaga o cupom da tela sem
//      aviso, e depois da anulação há "Registrar de novo com os itens da tela"
//      (chave nova só nesse clique, e só com a venda antiga anulada);
//  e que a chave segue estável na retentativa de rede.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { ReciboDaVenda } from "@/components/admin/pdv/ReciboDaVenda";
import {
  type EstadoDaVenda,
  type ItemDoCupom,
  type ReciboDaVendaRegistrada,
  chaveDoItemDoCupom,
  estadoInicialDaVenda,
  reducerDaVenda,
  useVendaPresencial,
} from "@/hooks/useVendaPresencial";

function item(
  id: string,
  nome: string,
  variacao: string | null,
  quantidade = 1,
  preco = 50,
): ItemDoCupom {
  return {
    chave: chaveDoItemDoCupom(id, null),
    productId: id,
    variantId: null,
    nome,
    variacao,
    preco,
    quantidade,
    estoque: 99,
    imagem: "",
  };
}

const CAMISETA = item("p1", "Camiseta", "M");
const CALCA = item("p2", "Calça", "42");
const BONE = item("p3", "Boné", null);
const MEIA = item("p4", "Meia", null);

function reciboDoBanco(
  itens: readonly ItemDoCupom[],
  parcial: Partial<ReciboDaVendaRegistrada> = {},
): ReciboDaVendaRegistrada {
  const total = itens.reduce((s, i) => s + i.preco * i.quantidade, 0);
  return {
    orderId: "11111111-1111-1111-1111-111111111111",
    numero: "111111",
    criadoEm: "2026-10-27T12:00:00.000Z",
    total,
    subtotal: total,
    desconto: 0,
    pagamento: "cash",
    cliente: { tipo: "sem_cliente" },
    itens,
    jaExistia: true,
    ...parcial,
  };
}

/** A tela da caixa (enviando) com a chave que já tinha ido ao banco. */
function telaCom(itens: readonly ItemDoCupom[]): EstadoDaVenda {
  return {
    ...estadoInicialDaVenda(() => "chave-antiga"),
    itens,
    pagamento: "cash",
    enviando: true,
  };
}

function registradaComDivergencia(
  telaItens: readonly ItemDoCupom[],
  bancoItens: readonly ItemDoCupom[],
): EstadoDaVenda {
  return reducerDaVenda(telaCom(telaItens), {
    tipo: "venda_registrada",
    recibo: reciboDoBanco(bancoItens),
  });
}

// ----------------------------------------------------------------------------
// (a) o que difere, calculado pelo cérebro (reducer) — dado da divergência
// ----------------------------------------------------------------------------


// ----------------------------------------------------------------------------
// (b) registrar de novo com os itens da tela — só com a venda antiga anulada
// ----------------------------------------------------------------------------


// ----------------------------------------------------------------------------
// A tela do recibo
// ----------------------------------------------------------------------------

function botao(raiz: ParentNode, texto: string): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function digitarMotivo(texto: string): void {
  const campo = document.querySelector("textarea") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(campo, texto);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

const DIVERGENTE: ReciboDaVendaRegistrada = reciboDoBanco(
  [CAMISETA, CALCA, BONE],
  {
    divergenciaComATela: {
      totalDaTela: 200,
      unidadesDaTela: 4,
      pagamentoDaTela: "cash",
      aMaisNaTela: [{ nome: "Meia", variacao: null, quantidade: 1 }],
    },
  },
);

describe("recibo vermelho — texto, anulação e Nova venda", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  async function montar(
    recibo: ReciboDaVendaRegistrada,
    extras: {
      despachar?: (a: unknown) => void;
      limparCupom?: () => void;
      aoAnular?: () => Promise<{ orderId: string; jaAnulada: boolean }>;
    } = {},
  ): Promise<void> {
    await act(async () => {
      raiz.render(
        <ReciboDaVenda
          recibo={recibo}
          despachar={(extras.despachar ?? vi.fn()) as never}
          limparCupom={extras.limparCupom ?? vi.fn()}
          storeName="Loja Teste"
          aoAnular={
            extras.aoAnular ??
            (async () => ({ orderId: recibo.orderId, jaAnulada: false }))
          }
        />,
      );
    });
  }

  async function anularEstaVenda(): Promise<void> {
    await act(async () => {
      botao(hospedeiro, "Anular venda")!.click();
    });
    await act(async () => digitarMotivo("peça a mais"));
    await act(async () => {
      botao(hospedeiro, "Confirmar anulação")!.click();
    });
  }




  it("(d) depois de anular, o alerta vermelho e o 'Anule esta venda' somem; fica o texto neutro", async () => {
    await montar(DIVERGENTE);
    expect(hospedeiro.textContent).toContain(
      "Anule esta venda e registre de novo",
    );
    await anularEstaVenda();

    expect(hospedeiro.textContent).toContain(
      "Venda anulada. Registre a venda certa.",
    );
    expect(hospedeiro.textContent).not.toContain("Anule esta venda");
    expect(hospedeiro.textContent).not.toContain("Entrou uma venda diferente");
    expect(hospedeiro.querySelector(".pdv-notice-red")).toBeNull();
    // Nenhum alerta vermelho de divergência sobrou (role="alert" só aparece em erro).
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });







});

// ----------------------------------------------------------------------------
// De ponta a ponta com o hook de verdade: o cupom da tela volta inteiro
// ----------------------------------------------------------------------------

