// @vitest-environment jsdom
//
// Venda de balcão que fecha em R$ 0,00 (desconto integral). A tela pedia para
// conferir um PIX/cartão de R$ 0,00 que nunca vai entrar, o recibo da tela
// dizia "Pagamento conferido pelo lojista" e o papel dizia "Sem valor a pagar".
// Agora tela, recibo e papel dizem a mesma coisa, e a venda com valor segue
// IDÊNTICA (os testes de controle abaixo). Só TEXTO e a caixinha mudam: total,
// desconto, forma gravada e o que vai na venda não passam por aqui.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { isOfflineRef } = vi.hoisted(() => ({
  isOfflineRef: { atual: false },
}));

// `useOnlineStatus` devolve `true` quando está OFFLINE (armadilha de nome).
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => isOfflineRef.atual,
}));

import { FechamentoDaVenda } from "@/components/admin/pdv/FechamentoDaVenda";
import { ReciboDaVenda } from "@/components/admin/pdv/ReciboDaVenda";
import type {
  FormaDePagamentoDoBalcao,
  ItemDoCupom,
  ReciboDaVendaRegistrada,
} from "@/hooks/useVendaPresencial";
import { useVendaPresencial } from "@/hooks/useVendaPresencial";
import { useEffect, useRef } from "react";

const ROTULO_DA_CAIXINHA = "Conferi o pagamento no app do banco";
const CONFERIDO = "Pagamento conferido pelo lojista";

const ITEM: ItemDoCupom = {
  chave: "produto-1::",
  productId: "produto-1",
  variantId: null,
  nome: "Camiseta Lisa",
  variacao: null,
  preco: 39.9,
  quantidade: 2,
  estoque: 10,
  imagem: "",
};

function botaoPorTexto(raizDom: ParentNode, texto: string): HTMLButtonElement {
  const achado = [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
  if (!achado) throw new Error(`botão "${texto}" não encontrado`);
  return achado as HTMLButtonElement;
}

function caixinha(raizDom: ParentNode): HTMLInputElement | null {
  const rotulo = [...raizDom.querySelectorAll("label")].find((l) =>
    l.textContent?.includes(ROTULO_DA_CAIXINHA),
  );
  return (rotulo?.control as HTMLInputElement | null) ?? null;
}

async function avancar(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
}

function criarArmazenamentoEmMemoria() {
  const dados = new Map<string, string>();
  return {
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      dados.set(chave, valor);
    },
    removeItem: (chave: string) => {
      dados.delete(chave);
    },
  };
}

function digitarInput(id: string, valor: string): void {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function Hospedeiro({
  pagamentoInicial,
  aoRegistrarVenda,
}: {
  pagamentoInicial: FormaDePagamentoDoBalcao;
  aoRegistrarVenda: () => Promise<void>;
}) {
  const { estado, despachar, limparCupom } = useVendaPresencial({
    armazenamento: criarArmazenamentoEmMemoria(),
  });
  const semeadoRef = useRef(false);
  useEffect(() => {
    if (semeadoRef.current) return;
    semeadoRef.current = true;
    despachar({
      tipo: "item_adicionado_manualmente",
      item: ITEM,
      em: Date.now(),
    });
    despachar({ tipo: "pagamento_escolhido", pagamento: pagamentoInicial });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- semeadura roda só na montagem.
  }, []);
  return (
    <FechamentoDaVenda
      estado={estado}
      despachar={despachar}
      aoRegistrarVenda={aoRegistrarVenda}
      limparCupom={limparCupom}
    />
  );
}

function reciboDeExemplo(
  parcial: Partial<ReciboDaVendaRegistrada> = {},
): ReciboDaVendaRegistrada {
  return {
    orderId: "11111111-1111-1111-1111-111111111111",
    numero: "111111",
    criadoEm: "2026-09-16T12:00:00.000Z",
    total: 79.8,
    subtotal: 79.8,
    desconto: 0,
    pagamento: "pix",
    cliente: { tipo: "sem_cliente" },
    itens: [ITEM],
    jaExistia: false,
    ...parcial,
  };
}

/** A parte do recibo que a lojista VÊ na tela (o papel mora em outro bloco,
 * `OrderReceipt`, que só aparece na impressão). */
function textoDaTela(raizDom: ParentNode): string {
  return raizDom.querySelector(".pdv-receipt > .pdv-card")?.textContent ?? "";
}

describe("balcão — venda de R$ 0,00", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    isOfflineRef.atual = false;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function montarFechamento(
    pagamentoInicial: FormaDePagamentoDoBalcao,
    aoRegistrarVenda: () => Promise<void> = vi
      .fn()
      .mockResolvedValue(undefined),
  ): Promise<void> {
    await act(async () => {
      raiz.render(
        <Hospedeiro
          pagamentoInicial={pagamentoInicial}
          aoRegistrarVenda={aoRegistrarVenda}
        />,
      );
    });
    await avancar();
  }

  async function darDescontoIntegral(): Promise<void> {
    await act(async () => {
      digitarInput("desconto-da-venda", "7980"); // R$ 79,80 = o subtotal todo
    });
    await avancar(300);
    await act(async () => {
      digitarInput("motivo-do-desconto", "cortesia da casa");
    });
    await avancar(300);
  }

  async function montarRecibo(recibo: ReciboDaVendaRegistrada): Promise<void> {
    await act(async () =>
      raiz.render(
        <ReciboDaVenda
          recibo={recibo}
          despachar={vi.fn()}
          limparCupom={vi.fn()}
          aoAnular={vi.fn()}
        />,
      ),
    );
  }

  describe("tela de fechamento", () => {
    it.each(["pix", "card"] as const)(
      "%s com desconto integral: não pede conferência, o botão fica liberado e a barra diz 'Tudo pronto'",
      async (forma) => {
        const aoRegistrarVenda = vi.fn().mockResolvedValue(undefined);
        await montarFechamento(forma, aoRegistrarVenda);
        await darDescontoIntegral();

        expect(caixinha(hospedeiro)).toBeNull();
        expect(hospedeiro.textContent).not.toContain(ROTULO_DA_CAIXINHA);
        expect(hospedeiro.textContent).not.toContain("Marque");
        expect(hospedeiro.textContent).not.toContain("Pagamento conferido");
        expect(hospedeiro.textContent).toContain("Tudo pronto para registrar.");
        expect(botaoPorTexto(hospedeiro, "Registrar venda").disabled).toBe(
          false,
        );

        await act(async () => {
          botaoPorTexto(hospedeiro, "Registrar venda").click();
        });
        await avancar();
        expect(aoRegistrarVenda).toHaveBeenCalledTimes(1);
      },
    );

    it("a caixinha volta quando o total volta a ter valor (desconto parcial) e trava de novo", async () => {
      await montarFechamento("pix");
      await darDescontoIntegral();
      expect(caixinha(hospedeiro)).toBeNull();

      await act(async () => {
        digitarInput("desconto-da-venda", "500"); // R$ 5,00
      });
      await avancar(300);

      expect(caixinha(hospedeiro)).not.toBeNull();
      expect(caixinha(hospedeiro)?.checked).toBe(false);
      expect(botaoPorTexto(hospedeiro, "Registrar venda").disabled).toBe(true);
    });

    it("controle: com total acima de zero o PIX segue pedindo a conferência", async () => {
      await montarFechamento("pix");
      expect(caixinha(hospedeiro)).not.toBeNull();
      expect(botaoPorTexto(hospedeiro, "Registrar venda").disabled).toBe(true);
      expect(hospedeiro.textContent).toContain(
        `Marque "${ROTULO_DA_CAIXINHA}"`,
      );
    });

    it("controle: R$ 0,01 de total ainda pede a conferência (a régua é em centavos)", async () => {
      await montarFechamento("card");
      await act(async () => {
        digitarInput("desconto-da-venda", "7979"); // sobra R$ 0,01
      });
      await avancar(300);
      await act(async () => {
        digitarInput("motivo-do-desconto", "quase tudo");
      });
      await avancar(300);

      expect(hospedeiro.textContent).toContain("R$ 0,01");
      expect(caixinha(hospedeiro)).not.toBeNull();
      expect(botaoPorTexto(hospedeiro, "Registrar venda").disabled).toBe(true);
    });

    it("controle: sem desconto integral o dinheiro segue sem caixinha e liberado", async () => {
      await montarFechamento("cash");
      expect(caixinha(hospedeiro)).toBeNull();
      expect(botaoPorTexto(hospedeiro, "Registrar venda").disabled).toBe(false);
    });
  });

  describe("recibo", () => {
    it.each(["pix", "card"] as const)(
      "%s com total zero: a tela diz 'Sem valor a pagar' e NÃO diz que o pagamento foi conferido",
      async (forma) => {
        await montarRecibo(
          reciboDeExemplo({
            pagamento: forma,
            total: 0,
            desconto: 79.8,
          }),
        );

        const tela = textoDaTela(hospedeiro);
        expect(tela).toContain("Sem valor a pagar");
        expect(tela).not.toContain(CONFERIDO);
        expect(tela).not.toContain("PIX na hora");
        expect(tela).not.toContain("Cartão na maquininha");
        expect(tela).toContain("R$ 0,00");
      },
    );

    it("tela e papel dizem a mesma coisa (o papel já dizia 'Sem valor a pagar')", async () => {
      await montarRecibo(
        reciboDeExemplo({ pagamento: "pix", total: 0, desconto: 79.8 }),
      );
      expect(textoDaTela(hospedeiro)).toContain("Sem valor a pagar");
      // O papel é um portal para fora do recibo: `[data-tema-fixo]`.
      const papel = document.querySelector("[data-tema-fixo]")?.textContent;
      expect(papel).toContain("Pagamento: Sem valor a pagar");
      expect(papel).not.toContain(CONFERIDO);
    });

    it("controle: PIX com valor segue 'PIX na hora' + 'conferido pelo lojista'", async () => {
      await montarRecibo(reciboDeExemplo({ pagamento: "pix" }));
      const tela = textoDaTela(hospedeiro);
      expect(tela).toContain("PIX na hora");
      expect(tela).toContain(CONFERIDO);
      expect(tela).not.toContain("Sem valor a pagar");
    });

    it("controle: cartão com valor segue 'Cartão na maquininha' + 'conferido pelo lojista'", async () => {
      await montarRecibo(reciboDeExemplo({ pagamento: "card" }));
      const tela = textoDaTela(hospedeiro);
      expect(tela).toContain("Cartão na maquininha");
      expect(tela).toContain(CONFERIDO);
    });

    it("controle: dinheiro com valor segue 'Dinheiro' e sem 'conferido'", async () => {
      await montarRecibo(reciboDeExemplo({ pagamento: "cash" }));
      const tela = textoDaTela(hospedeiro);
      expect(tela).toContain("Dinheiro");
      expect(tela).not.toContain(CONFERIDO);
    });

    it("controle: R$ 0,01 de total ainda é venda com valor (régua em centavos)", async () => {
      await montarRecibo(
        reciboDeExemplo({ pagamento: "pix", total: 0.01, desconto: 79.79 }),
      );
      const tela = textoDaTela(hospedeiro);
      expect(tela).toContain("PIX na hora");
      expect(tela).toContain(CONFERIDO);
      expect(tela).not.toContain("Sem valor a pagar");
    });
  });
});
