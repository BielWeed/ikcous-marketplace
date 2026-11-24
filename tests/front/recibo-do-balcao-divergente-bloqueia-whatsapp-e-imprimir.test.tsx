// @vitest-environment jsdom
//
// Recibo de tela do balcão (`ReciboDaVenda`): quando a venda volta com
// divergência ("Entrou uma venda diferente da que estava na tela" — a caixa
// tentou de novo com a mesma chave e o banco devolveu a venda ANTIGA), o
// comprovante tem total/peças diferentes do que a cliente vai pagar. Mensagem
// de WhatsApp enviada não se desfaz e papel impresso é de uma venda que será
// anulada: enquanto a divergência estiver de pé (e a venda não anulada),
// "Enviar por WhatsApp" e "Imprimir" ficam desligados, o papel não existe na
// página (Ctrl+P) e a tela diz o que fazer.
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

const FRASE = "Anule esta venda antes de enviar ou imprimir.";

const ITEM: ItemDoCupom = {
  chave: "produto-1::",
  productId: "produto-1",
  variantId: null,
  nome: "Camiseta Lisa",
  variacao: null,
  preco: 50,
  quantidade: 1,
  estoque: 10,
  imagem: "",
};

const NORMAL: ReciboDaVendaRegistrada = {
  orderId: "33333333-3333-3333-3333-333333333333",
  numero: "333333",
  criadoEm: "2026-11-24T12:00:00.000Z",
  total: 50,
  subtotal: 50,
  desconto: 0,
  pagamento: "cash",
  cliente: {
    tipo: "avulso",
    nome: "Cliente de Teste",
    whatsapp: "11999998888",
  },
  itens: [ITEM],
  jaExistia: false,
};

const DIVERGENTE: ReciboDaVendaRegistrada = {
  ...NORMAL,
  jaExistia: true,
  divergenciaComATela: {
    totalDaTela: 100,
    unidadesDaTela: 2,
    pagamentoDaTela: "cash",
    aMaisNaTela: [{ nome: "Meia", variacao: null, quantidade: 1 }],
  },
};

function botao(raiz: ParentNode, texto: string): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("ReciboDaVenda — divergência desliga WhatsApp e Imprimir", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let imprimir: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    abrirWhatsappMock.mockReset();
    imprimir = vi.fn();
    vi.stubGlobal("print", imprimir);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
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

  it("(1) com divergência e sem anular: os dois botões desligados, nada abre, a frase aparece e o papel some", async () => {
    await renderizar(DIVERGENTE);

    const enviar = botao(hospedeiro, "Enviar por WhatsApp");
    const imprimirBotao = botao(hospedeiro, "Imprimir");
    expect(enviar).toBeDefined();
    expect(imprimirBotao).toBeDefined();
    expect(enviar?.disabled).toBe(true);
    expect(imprimirBotao?.disabled).toBe(true);

    await act(async () => enviar?.click());
    await act(async () => imprimirBotao?.click());
    expect(abrirWhatsappMock).not.toHaveBeenCalled();
    expect(imprimir).not.toHaveBeenCalled();

    expect(hospedeiro.textContent).toContain(FRASE);
    // Ctrl+P / menu do navegador também não imprimem o comprovante errado
    // (o papel vai para o `document`, fora do hospedeiro).
    expect(document.querySelector("[data-tema-fixo]")).toBeNull();
    // A saída do problema continua à mão.
    expect(botao(hospedeiro, "Anular venda")).toBeDefined();
    expect(botao(hospedeiro, "Nova venda")).toBeDefined();
  });

  it("(2) sem divergência: os dois botões ligados, o WhatsApp abre, imprimir chama o navegador, sem a frase e com o papel", async () => {
    await renderizar(NORMAL);

    const enviar = botao(hospedeiro, "Enviar por WhatsApp");
    const imprimirBotao = botao(hospedeiro, "Imprimir");
    expect(enviar?.disabled).toBe(false);
    expect(imprimirBotao?.disabled).toBe(false);

    await act(async () => enviar?.click());
    await act(async () => imprimirBotao?.click());
    expect(abrirWhatsappMock).toHaveBeenCalledTimes(1);
    expect(imprimir).toHaveBeenCalledTimes(1);

    expect(hospedeiro.textContent).not.toContain(FRASE);
    expect(document.querySelector("[data-tema-fixo]")).not.toBeNull();
  });

  it("(3) divergência já ANULADA: continua como antes — sem botões de enviar/imprimir, sem a frase, sem papel", async () => {
    await renderizar({ ...DIVERGENTE, anulada: true });

    expect(botao(hospedeiro, "Enviar por WhatsApp")).toBeUndefined();
    expect(botao(hospedeiro, "Imprimir")).toBeUndefined();
    expect(hospedeiro.textContent).not.toContain(FRASE);
    expect(hospedeiro.textContent).toContain(
      "Venda anulada. Registre a venda certa.",
    );
    expect(document.querySelector("[data-tema-fixo]")).toBeNull();
  });
});
