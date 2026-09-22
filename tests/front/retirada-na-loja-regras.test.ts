import { opcaoFrescaOuMaisBarata } from "@/lib/auto-selecao-de-frete";
// RETIRADA NA LOJA (release 1.5.3, 22/09/2026) — as regras puras do front.
//
// 1. A escolha é EXPLÍCITA: a retirada custa R$ 0 e seria SEMPRE a "mais
//    barata" — a auto-seleção nunca a escolhe sozinha (nem quando é a única
//    opção: aí fica sem escolha e a cliente decide). Escolhida pela cliente,
//    ela é mantida enquanto voltar na cotação.
// 2. Retirada é modalidade DA LOJA (como a entrega local): os meios de
//    pagamento "na entrega" continuam valendo — só transportadora exige
//    antecipado.
import {
  ID_ENTREGA_LOCAL,
  ID_RETIRADA_NA_LOJA,
  ehModalidadeDaLoja,
  ehRetiradaNaLoja,
  pagamentoIncompativelComFrete,
} from "@/lib/guarda-de-frete";
import { describe, expect, it } from "vitest";

type Opcao = { id: string; price: number; deliveryDays: number };
const opcao = (id: string, price: number, deliveryDays: number): Opcao => ({
  id,
  price,
  deliveryDays,
});

const LOCAL = opcao("local-delivery", 10, 1);
const RETIRADA = opcao("store-pickup", 0, 0);

describe("o contrato do id", () => {
  it("é o MESMO token da RPC e da edge", () => {
    expect(ID_RETIRADA_NA_LOJA).toBe("store-pickup");
    expect(ID_ENTREGA_LOCAL).toBe("local-delivery");
  });

  it("comparação exata: espaço ou caixa diferente não é retirada", () => {
    expect(ehRetiradaNaLoja("store-pickup")).toBe(true);
    expect(ehRetiradaNaLoja(" store-pickup")).toBe(false);
    expect(ehRetiradaNaLoja("STORE-PICKUP")).toBe(false);
    expect(ehRetiradaNaLoja(null)).toBe(false);
    expect(ehRetiradaNaLoja(undefined)).toBe(false);
  });

  it("modalidade da loja = entrega local OU retirada; transportadora não", () => {
    expect(ehModalidadeDaLoja("local-delivery")).toBe(true);
    expect(ehModalidadeDaLoja("store-pickup")).toBe(true);
    expect(ehModalidadeDaLoja("melhor-envio-1")).toBe(false);
    expect(ehModalidadeDaLoja("free-shipping-promo")).toBe(false);
    expect(ehModalidadeDaLoja(null)).toBe(false);
  });
});

describe("auto-seleção NUNCA escolhe a retirada sozinha", () => {
  it("sem escolha anterior, com local + retirada: vai a local, mesmo a retirada sendo R$ 0", () => {
    expect(opcaoFrescaOuMaisBarata(null, [LOCAL, RETIRADA])?.id).toBe(
      "local-delivery",
    );
    // A ordem da lista não muda nada.
    expect(opcaoFrescaOuMaisBarata(null, [RETIRADA, LOCAL])?.id).toBe(
      "local-delivery",
    );
  });

  it("a retirada é a ÚNICA opção: nada é escolhido (null) — a cliente decide", () => {
    expect(opcaoFrescaOuMaisBarata(null, [RETIRADA])).toBeNull();
    expect(opcaoFrescaOuMaisBarata(LOCAL, [RETIRADA])).toBeNull();
  });

  it("a cliente ESCOLHEU a retirada: é mantida (objeto fresco) enquanto voltar na cotação", () => {
    const escolhida = { ...RETIRADA };
    const fresca = { ...RETIRADA };
    const resultado = opcaoFrescaOuMaisBarata(escolhida, [LOCAL, fresca]);
    expect(resultado).toBe(fresca);
  });

  it("escolheu a retirada e ela SUMIU (destino fora da área): cai para a mais barata que não é retirada", () => {
    const sedex = opcao("melhor-envio-1", 30, 3);
    const pac = opcao("melhor-envio-2", 20, 8);
    expect(opcaoFrescaOuMaisBarata(RETIRADA, [sedex, pac])?.id).toBe(
      "melhor-envio-2",
    );
  });

  it("controle: sem retirada na lista, a regra da mais barata segue igual", () => {
    const sedex = opcao("melhor-envio-1", 30, 3);
    const pac = opcao("melhor-envio-2", 20, 8);
    expect(opcaoFrescaOuMaisBarata(null, [sedex, pac])?.id).toBe(
      "melhor-envio-2",
    );
    expect(opcaoFrescaOuMaisBarata(sedex, [sedex, pac])?.id).toBe(
      "melhor-envio-1",
    );
    expect(opcaoFrescaOuMaisBarata(null, [])).toBeNull();
  });
});

describe("pagamento com retirada = regras da entrega local", () => {
  for (const paymentMethod of ["pix", "card", "cash"] as const) {
    it(`retirada + ${paymentMethod} na entrega: LIVRE`, () => {
      expect(
        pagamentoIncompativelComFrete({
          temOpcaoSelecionada: true,
          ehEntregaLocal: ehModalidadeDaLoja("store-pickup"),
          paymentMethod,
          pagamentoOnlineLigado: true,
        }),
      ).toBe(false);
    });
  }

  it("retirada + online com a flag DESLIGADA: travado (estado stale, igual à local)", () => {
    expect(
      pagamentoIncompativelComFrete({
        temOpcaoSelecionada: true,
        ehEntregaLocal: ehModalidadeDaLoja("store-pickup"),
        paymentMethod: "online",
        pagamentoOnlineLigado: false,
      }),
    ).toBe(true);
  });

  it("controle: transportadora + dinheiro continua travado", () => {
    expect(
      pagamentoIncompativelComFrete({
        temOpcaoSelecionada: true,
        ehEntregaLocal: ehModalidadeDaLoja("melhor-envio-1"),
        paymentMethod: "cash",
        pagamentoOnlineLigado: true,
      }),
    ).toBe(true);
  });
});
