// COMPRA QUE FECHA EM R$ 0,00 (decisão do dono, 14/10/2026): a decisão pura
// da tela. Tabela: cada linha é um cenário que a cliente vive.
import { describe, expect, it } from "vitest";

import type { FormaDePagamentoNaEntrega } from "@/lib/formas-de-pagamento-na-entrega";
import {
  type MeioDePagamentoDoCheckout,
  formasDePagamentoParaTotalZero,
  saidaDoTotalZero,
  textoDoPedidoSemValor,
} from "@/lib/pagamento-com-total-zero";

const TODAS: readonly FormaDePagamentoNaEntrega[] = ["pix", "card", "cash"];

interface Caso {
  nome: string;
  totalFinal: number;
  freteFechado?: boolean;
  modalidadeDaLoja?: boolean;
  formasNaEntrega?: readonly FormaDePagamentoNaEntrega[];
  paymentMethod?: MeioDePagamentoDoCheckout;
  esperado: {
    zerado: boolean;
    escondeApp: boolean;
    travaPor: "transportadora" | "loja-so-no-app" | null;
    meioParaMarcar: FormaDePagamentoNaEntrega | null;
    bloqueiaFinalizar: boolean;
  };
}

const NADA_MUDA = {
  zerado: false,
  escondeApp: false,
  travaPor: null,
  meioParaMarcar: null,
  bloqueiaFinalizar: false,
} as const;

const CASOS: Caso[] = [
  // ── total acima de zero: a tela fica IDÊNTICA à de antes ────────────────
  {
    nome: "total 80 pelo app: nada muda",
    totalFinal: 80,
    paymentMethod: "online",
    esperado: NADA_MUDA,
  },
  {
    nome: "total 0,01 pelo app: um centavo ainda é valor a pagar",
    totalFinal: 0.01,
    paymentMethod: "online",
    esperado: NADA_MUDA,
  },
  {
    nome: "total 80 com transportadora: nada muda (as regras de hoje valem)",
    totalFinal: 80,
    modalidadeDaLoja: false,
    paymentMethod: "online",
    esperado: NADA_MUDA,
  },
  {
    nome: "total 80 em loja sem forma na entrega: nada muda",
    totalFinal: 80,
    formasNaEntrega: [],
    paymentMethod: "online",
    esperado: NADA_MUDA,
  },
  // ── total zero, frete ainda não fechado: a tela diz "a calcular" ────────
  {
    nome: "total 0 com frete ainda a calcular: a decisão não fala",
    totalFinal: 0,
    freteFechado: false,
    paymentMethod: "online",
    esperado: NADA_MUDA,
  },
  {
    nome: "total ainda não numérico (NaN): a decisão não fala",
    totalFinal: Number.NaN,
    paymentMethod: "online",
    esperado: NADA_MUDA,
  },
  // ── total zero, entrega local ou retirada ───────────────────────────────
  {
    nome: "total 0 e 'online' marcado: esconde o app e marca o primeiro da loja",
    totalFinal: 0,
    paymentMethod: "online",
    esperado: {
      zerado: true,
      escondeApp: true,
      travaPor: null,
      meioParaMarcar: "pix",
      bloqueiaFinalizar: true,
    },
  },
  {
    nome: "total 0 e 'card' já marcado: esconde o app e mantém a escolha",
    totalFinal: 0,
    paymentMethod: "card",
    esperado: {
      zerado: true,
      escondeApp: true,
      travaPor: null,
      meioParaMarcar: null,
      bloqueiaFinalizar: false,
    },
  },
  {
    nome: "total 0 e a loja só aceita dinheiro: marca dinheiro",
    totalFinal: 0,
    formasNaEntrega: ["cash"],
    paymentMethod: "online",
    esperado: {
      zerado: true,
      escondeApp: true,
      travaPor: null,
      meioParaMarcar: "cash",
      bloqueiaFinalizar: true,
    },
  },
  {
    nome: "total 0, a marcada foi desligada pela loja: marca a primeira ligada, na ordem da loja",
    totalFinal: 0,
    formasNaEntrega: ["cash", "card"],
    paymentMethod: "pix",
    esperado: {
      zerado: true,
      escondeApp: true,
      travaPor: null,
      meioParaMarcar: "cash",
      bloqueiaFinalizar: false,
    },
  },
  {
    nome: "total negativo (cupom maior que o pedido): conta como zero",
    totalFinal: -5,
    paymentMethod: "online",
    esperado: {
      zerado: true,
      escondeApp: true,
      travaPor: null,
      meioParaMarcar: "pix",
      bloqueiaFinalizar: true,
    },
  },
  {
    nome: "total 0,004 (ponto flutuante): em centavos é zero",
    totalFinal: 0.004,
    paymentMethod: "online",
    esperado: {
      zerado: true,
      escondeApp: true,
      travaPor: null,
      meioParaMarcar: "pix",
      bloqueiaFinalizar: true,
    },
  },
  // ── total zero que NÃO fecha: o Finalizar trava ─────────────────────────
  {
    nome: "total 0 com transportadora: trava, sem oferecer o app",
    totalFinal: 0,
    modalidadeDaLoja: false,
    paymentMethod: "online",
    esperado: {
      zerado: true,
      escondeApp: true,
      travaPor: "transportadora",
      meioParaMarcar: null,
      bloqueiaFinalizar: true,
    },
  },
  {
    nome: "total 0 com transportadora e forma na entrega marcada: ainda trava",
    totalFinal: 0,
    modalidadeDaLoja: false,
    paymentMethod: "pix",
    esperado: {
      zerado: true,
      escondeApp: true,
      travaPor: "transportadora",
      meioParaMarcar: null,
      bloqueiaFinalizar: true,
    },
  },
  {
    nome: "total 0 em loja que só aceita o app: trava",
    totalFinal: 0,
    formasNaEntrega: [],
    paymentMethod: "online",
    esperado: {
      zerado: true,
      escondeApp: true,
      travaPor: "loja-so-no-app",
      meioParaMarcar: null,
      bloqueiaFinalizar: true,
    },
  },
  {
    nome: "total 0, transportadora E loja só no app: a transportadora vem primeiro",
    totalFinal: 0,
    modalidadeDaLoja: false,
    formasNaEntrega: [],
    paymentMethod: "online",
    esperado: {
      zerado: true,
      escondeApp: true,
      travaPor: "transportadora",
      meioParaMarcar: null,
      bloqueiaFinalizar: true,
    },
  },
];

describe("formasDePagamentoParaTotalZero — a decisão da tela com total zero", () => {
  for (const caso of CASOS) {
    it(caso.nome, () => {
      const decisao = formasDePagamentoParaTotalZero({
        totalFinal: caso.totalFinal,
        freteFechado: caso.freteFechado ?? true,
        modalidadeDaLoja: caso.modalidadeDaLoja ?? true,
        formasNaEntrega: caso.formasNaEntrega ?? TODAS,
        paymentMethod: caso.paymentMethod ?? "pix",
      });
      expect(decisao).toEqual(caso.esperado);
    });
  }
});

describe("textos do pedido sem valor", () => {
  const semTrava = formasDePagamentoParaTotalZero({
    totalFinal: 0,
    freteFechado: true,
    modalidadeDaLoja: true,
    formasNaEntrega: TODAS,
    paymentMethod: "online",
  });
  const transportadora = formasDePagamentoParaTotalZero({
    totalFinal: 0,
    freteFechado: true,
    modalidadeDaLoja: false,
    formasNaEntrega: TODAS,
    paymentMethod: "online",
  });
  const soNoApp = formasDePagamentoParaTotalZero({
    totalFinal: 0,
    freteFechado: true,
    modalidadeDaLoja: true,
    formasNaEntrega: [],
    paymentMethod: "online",
  });

  it("os três casos dizem que não há valor a pagar, e só o que fecha fala de retirada ou entrega", () => {
    for (const decisao of [semTrava, transportadora, soNoApp]) {
      expect(textoDoPedidoSemValor({ decisao, ehRetirada: false })).toContain(
        "não tem valor a pagar",
      );
    }
    expect(
      textoDoPedidoSemValor({ decisao: semTrava, ehRetirada: true }),
    ).toContain("na retirada");
    expect(
      textoDoPedidoSemValor({ decisao: semTrava, ehRetirada: false }),
    ).toContain("na entrega");
  });

  it("a saída de quem trava aponta o caminho certo, e só fala de cupom quando há cupom", () => {
    expect(
      saidaDoTotalZero({ travaPor: "transportadora", temCupom: false }),
    ).toContain("retirada na loja");
    expect(
      saidaDoTotalZero({ travaPor: "transportadora", temCupom: false }),
    ).not.toContain("cupom");
    expect(
      saidaDoTotalZero({ travaPor: "transportadora", temCupom: true }),
    ).toContain("tire o cupom");
    expect(
      saidaDoTotalZero({ travaPor: "loja-so-no-app", temCupom: true }),
    ).toContain("Tire o cupom");
    expect(
      saidaDoTotalZero({ travaPor: "loja-so-no-app", temCupom: false }),
    ).toBe("Fale com a loja para combinar.");
  });
});
