// @vitest-environment jsdom
//
// A TROCA CARTÃO → PIX não pode esconder a cobrança incerta.
//
// O fallback de "cartão indisponível" (`PagamentoOnline`, quando a config do
// cartão some — a loja desligou o cartão ou o pagamento pelo app no MEIO do
// pagamento) desmonta a tela do cartão QUE ESTAVA EM CENA — inclusive as
// telas de "em análise"/3DS, onde uma cobrança PODE existir no Mercado Pago.
// Se esse fallback trocar para PIX dizendo `cartaoAindaVivo: false`, o
// CheckoutView NÃO marca `pedidoTemCobrancaIncerta`, e o primeiro erro do PIX
// sem sinal reabre "Cancelar pedido" sobre um cartão que o banco pode aprovar
// depois — o mesmo dinheiro em risco que o achado B3 existe para evitar.
//
// Quando o fallback nasce JUNTO da tela (config ausente desde o primeiro
// render), nenhum POST de cartão chegou a existir — `false` continua sendo
// o valor certo, e o segundo teste fixa isso para o ajuste não virar
// "sempre true".
import {
  type MetodoOnline,
  PagamentoOnline,
} from "@/components/checkout/PagamentoOnline";
import type { ConfigDoCartao } from "@/lib/config-do-cartao";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

const { criarPagamento } = vi.hoisted(() => ({ criarPagamento: vi.fn() }));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ criarPagamento }),
}));

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CONFIG_DO_CARTAO: ConfigDoCartao = {
  credito: true,
  debito: false,
  parcelasMax: 12,
};

describe("PagamentoOnline — a troca cartão→PIX não esconde a cobrança em curso", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    // O clique no fallback do teste remonta o PIX (contrato do CheckoutView:
    // a troca muda `metodoDoPedido` na hora) — o QR resolvido evita que o
    // efeito do PIX rode com uma promessa indefinida.
    criarPagamento.mockReset().mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "aguardando",
      expiraEm: "2026-09-25T12:00:00.000Z",
      qrCode: "000201...",
      qrCodeBase64: "abc123",
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    // A tela do cartão injeta a tag do SDK do Mercado Pago no head; sem
    // evento de load ela fica pendurada — limpar entre testes.
    document.head.innerHTML = "";
    vi.restoreAllMocks();
  });

  function botaoPagarComPix() {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Pagar com PIX"),
    );
    expect(
      botao,
      "o botão 'Pagar com PIX' deveria estar na tela",
    ).toBeDefined();
    return botao!;
  }

  async function clicar(botao: HTMLButtonElement) {
    await act(async () => {
      botao.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("a config do cartão que some com o cartão EM CENA troca com cartaoAindaVivo=true", async () => {
    const onTrocarParaPix = vi.fn();
    // Pai mínimo com o MESMO contrato do CheckoutView: a troca muda o método
    // na hora (`setMetodoDoPedido("pix")`).
    function Pai({ config }: { config: ConfigDoCartao | null }) {
      const [metodo, setMetodo] = useState<MetodoOnline>("cartao");
      return (
        <PagamentoOnline
          orderId="ped-1"
          valor={100}
          metodo={metodo}
          configDoCartao={config}
          onTrocarParaPix={(cartaoAindaVivo) => {
            onTrocarParaPix(cartaoAindaVivo);
            setMetodo("pix");
          }}
          onErro={() => {}}
        />
      );
    }

    // 1ª render: cartão em cena — a tela do Brick está montada (o SDK fica
    // pendurado no jsdom, e é justamente essa a cena: cliente com o cartão
    // aberto, cobrança possível).
    await act(async () => {
      raiz.render(<Pai config={CONFIG_DO_CARTAO} />);
    });
    expect(hospedeiro.textContent).toContain("Pagamento com cartão");

    // 2ª render: a config SOME no meio do pagamento — a tela do cartão (com
    // qualquer estado "em análise"/3DS que ela guardasse) é desmontada e o
    // fallback assume.
    await act(async () => {
      raiz.render(<Pai config={null} />);
    });
    expect(hospedeiro.textContent).toContain("não está disponível");

    await clicar(botaoPagarComPix());

    // O cartão esteve em cena: uma cobrança PODE existir — o CheckoutView
    // precisa marcar a cobrança incerta (nunca oferecer "Cancelar pedido"
    // sobre um cartão que pode ser aprovado).
    expect(onTrocarParaPix).toHaveBeenCalledWith(true);
  });

  it("a config ausente DESDE O INÍCIO troca com cartaoAindaVivo=false — nenhum cartão entrou em cena", async () => {
    const onTrocarParaPix = vi.fn();
    function Pai() {
      const [metodo, setMetodo] = useState<MetodoOnline>("cartao");
      return (
        <PagamentoOnline
          orderId="ped-2"
          valor={50}
          metodo={metodo}
          configDoCartao={null}
          onTrocarParaPix={(cartaoAindaVivo) => {
            onTrocarParaPix(cartaoAindaVivo);
            setMetodo("pix");
          }}
          onErro={() => {}}
        />
      );
    }

    await act(async () => {
      raiz.render(<Pai />);
    });
    expect(hospedeiro.textContent).toContain("não está disponível");

    await clicar(botaoPagarComPix());

    // Sem tela de cartão nenhuma, nunca houve POST de cartão — o valor
    // `false` continua sendo o verdadeiro aqui.
    expect(onTrocarParaPix).toHaveBeenCalledWith(false);
  });

  // Contrato "forma de cartão desligada" (01/10/2026): com cobrança incerta
  // NESTE pedido (`pedidoTemCobrancaIncerta` do CheckoutView, ex.: 502
  // ambíguo de um cartão anterior), o fallback NÃO pode ser a porta dos fundos
  // que a caixa âmbar fecha — nada de PIX nem "Cancelar pedido". A saída útil
  // é "Ver meus pedidos", a mesma da caixa âmbar.
  function botoes(texto: string) {
    return [...hospedeiro.querySelectorAll("button")].filter((b) =>
      b.textContent?.includes(texto),
    );
  }

  // "Cancelar pedido" só existe na caixa de erro do CheckoutView, aberta por
  // `onErro`: o contrato DESTE componente é nunca chamar `onErro` aqui. A
  // ausência do botão na tela inteira é provada em
  // checkout-view-cartao-forma-desligada.test.tsx.
  function exigirFallbackSemPixNemErro(onErro: ReturnType<typeof vi.fn>) {
    expect(hospedeiro.textContent).toContain("não está disponível");
    expect(hospedeiro.textContent).toContain("em análise pelo banco");
    expect(botoes("Pagar com PIX")).toHaveLength(0);
    expect(hospedeiro.textContent).not.toContain("Pagar com PIX");
    expect(onErro).not.toHaveBeenCalled();
  }

  it("cobrança incerta e a config some com o cartão EM CENA: sem PIX, sem Cancelar — 'Ver meus pedidos' é a saída", async () => {
    const onTrocarParaPix = vi.fn();
    const onVerMeusPedidos = vi.fn();
    const onErro = vi.fn();
    function Pai({ config }: { config: ConfigDoCartao | null }) {
      const [metodo, setMetodo] = useState<MetodoOnline>("cartao");
      const props = {
        orderId: "ped-3",
        valor: 100,
        metodo,
        configDoCartao: config,
        cobrancaIncerta: true,
        onVerMeusPedidos,
        onTrocarParaPix: (cartaoAindaVivo: boolean) => {
          onTrocarParaPix(cartaoAindaVivo);
          setMetodo("pix");
        },
        onErro,
      };
      return <PagamentoOnline {...props} />;
    }

    await act(async () => {
      raiz.render(<Pai config={CONFIG_DO_CARTAO} />);
    });
    expect(hospedeiro.textContent).toContain("Pagamento com cartão");

    await act(async () => {
      raiz.render(<Pai config={null} />);
    });
    exigirFallbackSemPixNemErro(onErro);

    const verPedidos = botoes("Ver meus pedidos");
    expect(verPedidos).toHaveLength(1);
    await clicar(verPedidos[0]);

    expect(onVerMeusPedidos).toHaveBeenCalledTimes(1);
    expect(onTrocarParaPix).not.toHaveBeenCalled();
    expect(criarPagamento).not.toHaveBeenCalled();
  });

  it("cobrança incerta e a config ausente DESDE O INÍCIO (remontagem do pedido): também sem PIX nem Cancelar", async () => {
    const onTrocarParaPix = vi.fn();
    const onVerMeusPedidos = vi.fn();
    const onErro = vi.fn();
    const props = {
      orderId: "ped-4",
      valor: 50,
      metodo: "cartao" as const,
      configDoCartao: null,
      cobrancaIncerta: true,
      onVerMeusPedidos,
      onTrocarParaPix,
      onErro,
    };

    await act(async () => {
      raiz.render(<PagamentoOnline {...props} />);
    });
    exigirFallbackSemPixNemErro(onErro);

    const verPedidos = botoes("Ver meus pedidos");
    expect(verPedidos).toHaveLength(1);
    await clicar(verPedidos[0]);

    expect(onVerMeusPedidos).toHaveBeenCalledTimes(1);
    expect(onTrocarParaPix).not.toHaveBeenCalled();
    expect(criarPagamento).not.toHaveBeenCalled();
  });
});
