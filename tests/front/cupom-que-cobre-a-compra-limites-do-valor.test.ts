// CUPOM QUE COBRE A COMPRA INTEIRA — os limites que a tabela de
// `cupom-que-cobre-a-compra.test.ts` deixa passar: ela lê o limiar pela
// constante exportada (então trocar o 100 do código não a derruba), nunca
// cruza percentual com mínimo baixo e nunca testa valor/mínimo menores que R$ 1.
import { describe, expect, it } from "vitest";

import { cupomPodeCobrirACompraInteira } from "@/lib/cupom-que-cobre-a-compra";

type Cupom = Parameters<typeof cupomPodeCobrirACompraInteira>[0];

const CASOS: { nome: string; cupom: Cupom; avisa: boolean }[] = [
  {
    nome: "fixo de exatamente R$ 100 sem mínimo avisa (o limiar é 100, escrito por extenso)",
    cupom: { type: "fixed", value: 100 },
    avisa: true,
  },
  {
    nome: "100% avisa mesmo com mínimo ALTO: o percentual zera a conta sem depender do mínimo",
    cupom: { type: "percentage", value: 100, minPurchase: 150 },
    avisa: true,
  },
  {
    nome: "95% com mínimo baixo (R$ 50) NÃO avisa: percentual abaixo de 100 sobra produto, o mínimo não muda isso",
    cupom: { type: "percentage", value: 95, minPurchase: 50 },
    avisa: false,
  },
  {
    nome: "fixo SEM valor (campo apagado) mas com mínimo não avisa: ausente é zero, nunca um",
    cupom: { type: "fixed", minPurchase: 0.5 },
    avisa: false,
  },
  {
    nome: "fixo de R$ 1 com mínimo de R$ 1: comprando o mínimo a conta zera, avisa",
    cupom: { type: "fixed", value: 1, minPurchase: 1 },
    avisa: true,
  },
  {
    nome: "fixo de R$ 0,50 com mínimo de R$ 0,50 (valor abaixo de R$ 1): avisa",
    cupom: { type: "fixed", value: 0.5, minPurchase: 0.5 },
    avisa: true,
  },
  {
    nome: "fixo de R$ 50 com mínimo de R$ 0,50: o mínimo existe (é maior que zero), então a conta é exata e avisa",
    cupom: { type: "fixed", value: 50, minPurchase: 0.5 },
    avisa: true,
  },
  {
    nome: "fixo de R$ 50 com mínimo de R$ 1 avisa pela mesma conta exata",
    cupom: { type: "fixed", value: 50, minPurchase: 1 },
    avisa: true,
  },
  {
    nome: "fixo de R$ 0,99 com mínimo de R$ 1: sobra um centavo, não avisa",
    cupom: { type: "fixed", value: 0.99, minPurchase: 1 },
    avisa: false,
  },
];

describe("cupomPodeCobrirACompraInteira — limites do valor e do mínimo", () => {
  for (const caso of CASOS) {
    it(caso.nome, () => {
      expect(cupomPodeCobrirACompraInteira(caso.cupom)).toBe(caso.avisa);
    });
  }
});
