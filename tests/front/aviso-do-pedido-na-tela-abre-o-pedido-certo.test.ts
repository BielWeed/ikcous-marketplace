// Toque no push de OUTRO pedido com a lojista no meio de uma anotação na ficha:
// o app não troca de pedido (o texto se perderia), e o aviso que saiu da
// bandeja reaparece na tela. Antes era sempre "Chegou um pedido novo", com um
// id fixo e sem caminho para o pedido certo: contestação, cobrança duplicada,
// cliente que cancelou viravam "pedido novo", e o segundo aviso apagava o
// primeiro. Aqui se prova o aviso na tela de verdade (o `toast` do sonner):
// o texto é o do push, cada pedido tem o seu, e "Abrir pedido #X" só abre
// quando a guarda da ficha deixa — senão o aviso fica.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: { info: (...a: unknown[]) => toastInfo(...a) },
}));

import { mostrarAvisoDoPedidoNaTela } from "../../src/lib/receptor-do-pedido-do-aviso";

interface AcaoDoAviso {
  label: string;
  onClick: (evento: { preventDefault: () => void }) => void;
}

describe("aviso do pedido na tela (painel ocupado)", () => {
  beforeEach(() => {
    toastInfo.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mostrar(abrir: () => boolean, pedidoId = "pedido-0000-00c0de") {
    mostrarAvisoDoPedidoNaTela({
      pedidoId,
      titulo: "Contestação de pagamento para conferir",
      corpo: "00C0DE · confira no painel do Mercado Pago",
      abrir,
    });
    const [titulo, opcoes] = toastInfo.mock.calls.at(-1) as [
      string,
      {
        id: string;
        description: string;
        duration: number;
        action: AcaoDoAviso;
      },
    ];
    return { titulo, opcoes };
  }

  it("mostra o que o push dizia, fica até a lojista agir, com a ação do pedido certo", () => {
    const { titulo, opcoes } = mostrar(() => true);

    expect(titulo).toBe("Contestação de pagamento para conferir");
    expect(opcoes.description).toBe(
      "00C0DE · confira no painel do Mercado Pago",
    );
    expect(opcoes.duration).toBe(Number.POSITIVE_INFINITY);
    expect(opcoes.action.label).toBe("Abrir pedido #00C0DE");
  });

  it("dois avisos de pedidos diferentes têm ids diferentes (um não apaga o outro)", () => {
    const a = mostrar(() => true, "pedido-1").opcoes.id;
    const b = mostrar(() => true, "pedido-2").opcoes.id;
    expect(a).not.toBe(b);
  });

  it("'Abrir pedido' com a guarda livre: abre e deixa o aviso fechar", () => {
    const abrir = vi.fn(() => true);
    const { opcoes } = mostrar(abrir);
    const preventDefault = vi.fn();

    opcoes.action.onClick({ preventDefault });

    expect(abrir).toHaveBeenCalledOnce();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(toastInfo).toHaveBeenCalledTimes(1);
  });

  it("'Abrir pedido' com o texto ainda por salvar: não abre, o aviso FICA e a lojista sabe por quê", () => {
    const abrir = vi.fn(() => false);
    const { opcoes } = mostrar(abrir);
    const preventDefault = vi.fn();

    opcoes.action.onClick({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(toastInfo).toHaveBeenCalledTimes(2);
    expect(toastInfo.mock.calls[1][0]).toContain("#00C0DE");
    // Outro id: o segundo aviso não substitui o do pedido (que fica).
    expect((toastInfo.mock.calls[1][1] as { id: string }).id).not.toBe(
      opcoes.id,
    );
  });
});
