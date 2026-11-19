// @vitest-environment jsdom
//
// Recibo de tela do balcão (`ReciboDaVenda`): dois lugares escrevem um VALOR EM
// REAIS que a lojista lê e repete ao cliente, e os dois têm de ser o TOTAL
// COBRADO (com desconto), nunca o subtotal:
//  - a pergunta "Anular esta venda de R$ X?" (a peça `AnularVendaDoBalcao`
//    recebe `total={recibo.total}`);
//  - a mensagem de WhatsApp "… — Total R$ X. Obrigado …".
//
// Os valores são escolhidos onde subtotal ≠ total E onde o float erra:
// `1 - 0.7` = 0.30000000000000004 e `100.1 - 10.2` = 89.89999999999999. O texto
// precisa sair com centavos certos ("0,30" e "89,90"), não "0,3" nem "89,89".
//
// Sem `@testing-library/react`: `createRoot` + `act`, padrão da casa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { abrirWhatsappMock } = vi.hoisted(() => ({
  abrirWhatsappMock: vi.fn<(url: string) => void>(),
}));

vi.mock("@/lib/abrir-whatsapp", () => ({ abrirWhatsapp: abrirWhatsappMock }));

import { ReciboDaVenda } from "@/components/admin/pdv/ReciboDaVenda";
import type {
  ItemDoCupom,
  ReciboDaVendaRegistrada,
} from "@/hooks/useVendaPresencial";

const ITEM: ItemDoCupom = {
  chave: "produto-1::",
  productId: "produto-1",
  variantId: null,
  nome: "Camiseta Lisa",
  variacao: null,
  preco: 100.1,
  quantidade: 1,
  estoque: 10,
  imagem: "",
};

// [subtotal, desconto, total como o float entrega, total esperado na tela]
const CASOS: readonly [number, number, number, string][] = [
  [1, 0.7, 1 - 0.7, "0,30"],
  [100.1, 10.2, 100.1 - 10.2, "89,90"],
];

function reciboComDesconto(
  subtotal: number,
  desconto: number,
  total: number,
): ReciboDaVendaRegistrada {
  return {
    orderId: "22222222-2222-2222-2222-222222222222",
    numero: "222222",
    criadoEm: "2026-11-18T12:00:00.000Z",
    total,
    subtotal,
    desconto,
    pagamento: "cash",
    cliente: {
      tipo: "avulso",
      nome: "Cliente de Teste",
      whatsapp: "11999998888",
    },
    itens: [ITEM],
    jaExistia: false,
  };
}

function botao(raiz: ParentNode, texto: string): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("ReciboDaVenda — o valor que a lojista lê é o TOTAL cobrado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    abrirWhatsappMock.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function renderizar(recibo: ReciboDaVendaRegistrada): Promise<void> {
    await act(async () => {
      raiz.render(
        <ReciboDaVenda
          recibo={recibo}
          despachar={vi.fn()}
          limparCupom={vi.fn()}
          storeName="Loja Teste"
          aoAnular={vi.fn()}
        />,
      );
    });
  }

  it.each(CASOS)(
    "a pergunta de anular (subtotal %s, desconto %s) mostra o total cobrado, nunca o subtotal",
    async (subtotal, desconto, total, esperado) => {
      await renderizar(reciboComDesconto(subtotal, desconto, total));

      const abrir = botao(hospedeiro, "Anular venda");
      expect(abrir).toBeDefined();
      await act(async () => {
        abrir?.click();
      });

      const pergunta = [...hospedeiro.querySelectorAll("p")].find((p) =>
        p.textContent?.startsWith("Anular esta venda de"),
      );
      expect(pergunta).toBeDefined();
      // `formatCurrency` separa o "R$" do número com espaço não quebrável.
      expect(pergunta?.textContent?.replace(/\s/g, " ")).toBe(
        `Anular esta venda de R$ ${esperado}?`,
      );
      const subtotalNaTela = subtotal.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      expect(pergunta?.textContent).not.toContain(subtotalNaTela);
    },
  );

  it("celular incompleto deixa o envio indisponível e não abre o WhatsApp", async () => {
    await renderizar({
      ...reciboComDesconto(100, 10, 90),
      cliente: {
        tipo: "avulso",
        nome: "Cliente de Teste",
        whatsapp: "(34) 99876-543",
      },
    });

    const enviar = botao(hospedeiro, "Enviar por WhatsApp");
    expect(enviar).toBeDefined();
    await act(async () => enviar?.click());
    expect(abrirWhatsappMock).not.toHaveBeenCalled();
    expect(enviar?.disabled).toBe(true);
    expect(hospedeiro.textContent).toContain("incompleto");
  });

  it.each([
    ["(34) 99876-5432", "5534998765432"],
    ["(34) 3333-4444", "553433334444"],
  ])(
    "número completo %s continua abrindo o WhatsApp",
    async (whatsapp, destino) => {
      await renderizar({
        ...reciboComDesconto(100, 10, 90),
        cliente: { tipo: "avulso", nome: "Cliente de Teste", whatsapp },
      });

      const enviar = botao(hospedeiro, "Enviar por WhatsApp");
      expect(enviar?.disabled).toBe(false);
      await act(async () => enviar?.click());
      const url = abrirWhatsappMock.mock.lastCall?.[0];
      expect(url?.split("?")[0]).toBe(`https://wa.me/${destino}`);
    },
  );

  it.each(CASOS)(
    "a mensagem de WhatsApp (subtotal %s, desconto %s) leva o total cobrado com os centavos certos",
    async (subtotal, desconto, total, esperado) => {
      await renderizar(reciboComDesconto(subtotal, desconto, total));

      const enviar = botao(hospedeiro, "Enviar por WhatsApp");
      expect(enviar?.disabled).toBe(false);
      await act(async () => {
        enviar?.click();
      });

      expect(abrirWhatsappMock).toHaveBeenCalledTimes(1);
      const url = new URL(abrirWhatsappMock.mock.calls[0][0]);
      expect(url.origin + url.pathname).toBe("https://wa.me/5511999998888");
      const texto = url.searchParams.get("text") ?? "";
      expect(texto).toBe(
        `Aqui está o comprovante da sua compra na Loja Teste! Pedido #222222 — Total R$ ${esperado}. Obrigado pela preferência!`,
      );
      const subtotalNaTela = subtotal.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      expect(texto).not.toContain(subtotalNaTela);
    },
  );
});
