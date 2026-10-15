// CUPOM QUE COBRE A COMPRA INTEIRA (decisão do dono, 14/10/2026): quando o
// formulário do cupom avisa a lojista. Tabela: cada linha é um cupom que ela
// poderia criar.
import { describe, expect, it } from "vitest";

import {
  VALOR_FIXO_QUE_PODE_COBRIR_UM_PEDIDO,
  cupomPodeCobrirACompraInteira,
} from "@/lib/cupom-que-cobre-a-compra";

type Cupom = Parameters<typeof cupomPodeCobrirACompraInteira>[0];

const CASOS: { nome: string; cupom: Cupom; avisa: boolean }[] = [
  {
    nome: "100% avisa",
    cupom: { type: "percentage", value: 100 },
    avisa: true,
  },
  {
    nome: "99% não avisa (sobra 1% do produto)",
    cupom: { type: "percentage", value: 99 },
    avisa: false,
  },
  {
    nome: "10% não avisa",
    cupom: { type: "percentage", value: 10 },
    avisa: false,
  },
  {
    nome: "100% com mínimo de compra continua avisando",
    cupom: { type: "percentage", value: 100, minPurchase: 50 },
    avisa: true,
  },
  {
    nome: "fixo R$ 15 sem mínimo não avisa",
    cupom: { type: "fixed", value: 15 },
    avisa: false,
  },
  {
    nome: "fixo R$ 150 sem mínimo avisa (valor alto)",
    cupom: { type: "fixed", value: 150 },
    avisa: true,
  },
  {
    nome: "fixo no limiar (R$ 100) avisa",
    cupom: { type: "fixed", value: VALOR_FIXO_QUE_PODE_COBRIR_UM_PEDIDO },
    avisa: true,
  },
  {
    nome: "fixo R$ 99,99 sem mínimo não avisa",
    cupom: { type: "fixed", value: 99.99 },
    avisa: false,
  },
  {
    nome: "fixo R$ 30 com mínimo de R$ 30: comprando o mínimo a conta zera, avisa",
    cupom: { type: "fixed", value: 30, minPurchase: 30 },
    avisa: true,
  },
  {
    nome: "fixo R$ 30 com mínimo de R$ 100: sobra produto, não avisa",
    cupom: { type: "fixed", value: 30, minPurchase: 100 },
    avisa: false,
  },
  {
    nome: "valor zero não avisa",
    cupom: { type: "percentage", value: 0 },
    avisa: false,
  },
  {
    nome: "formulário ainda vazio não avisa",
    cupom: {},
    avisa: false,
  },
  {
    nome: "valor como texto vindo do campo ('100') é lido como número",
    cupom: { type: "percentage", value: "100" as unknown as number },
    avisa: true,
  },
];

describe("cupomPodeCobrirACompraInteira", () => {
  for (const caso of CASOS) {
    it(caso.nome, () => {
      expect(cupomPodeCobrirACompraInteira(caso.cupom)).toBe(caso.avisa);
    });
  }
});
