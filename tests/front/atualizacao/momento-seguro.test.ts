// MOMENTO SEGURO — a regra única de "posso recarregar o app agora?".
//
// Duas perguntas diferentes moram aqui (e a confusão entre elas é o defeito
// a evitar):
//   · `livre`: nada sensível em andamento nesta aba (compra, pagamento,
//     trabalho não salvo). É o que uma aba responde às outras.
//   · `instalarAgora`: livre E a pessoa está num PONTO DE PARADA (trocou de
//     tela ou o documento foi para segundo plano). É o que dispara a
//     instalação nesta aba.
import { describe, expect, it } from "vitest";

import {
  TELAS_DE_COMPRA,
  decidirMomentoSeguro,
} from "@/lib/atualizacao/momento-seguro";

const BASE = {
  view: "home",
  adminDirty: false,
  pedidoPendenteDoCheckout: false,
  documentoOculto: false,
  trocouDeTela: false,
} as const;

describe("ponto de parada", () => {
  it("tela parada e documento visível: livre, mas NÃO instala (nunca no meio de uma tela parada)", () => {
    const d = decidirMomentoSeguro(BASE);
    expect(d.livre).toBe(true);
    expect(d.pontoDeParada).toBe(false);
    expect(d.instalarAgora).toBe(false);
    expect(d.bloqueio).toBeNull();
  });

  it("trocou de tela em tela segura: instala", () => {
    const d = decidirMomentoSeguro({ ...BASE, trocouDeTela: true });
    expect(d.instalarAgora).toBe(true);
    expect(d.pontoDeParada).toBe(true);
  });

  it("documento oculto (app foi para segundo plano) em tela segura: instala", () => {
    const d = decidirMomentoSeguro({ ...BASE, documentoOculto: true });
    expect(d.instalarAgora).toBe(true);
  });
});

describe("o que NUNCA pode ser interrompido, mesmo num ponto de parada", () => {
  it("a lista de telas de compra é exatamente a de sempre", () => {
    expect([...TELAS_DE_COMPRA].sort()).toEqual(
      [
        "address-form",
        "auth",
        "cart",
        "checkout",
        "login",
        "order-success",
      ].sort(),
    );
  });

  for (const tela of [
    "cart",
    "checkout",
    "address-form",
    "order-success",
    "auth",
    "login",
  ]) {
    it(`tela de compra '${tela}': bloqueia mesmo trocando de tela e com o app em segundo plano`, () => {
      const d = decidirMomentoSeguro({
        ...BASE,
        view: tela,
        trocouDeTela: true,
        documentoOculto: true,
      });
      expect(d.instalarAgora).toBe(false);
      expect(d.livre).toBe(false);
      expect(d.bloqueio).toBe("tela-de-compra");
    });
  }

  it("PDV/formulário do painel sujo (adminDirty): bloqueia — a venda montada não pode sumir", () => {
    const d = decidirMomentoSeguro({
      ...BASE,
      view: "admin-pdv",
      adminDirty: true,
      trocouDeTela: true,
    });
    expect(d.instalarAgora).toBe(false);
    expect(d.livre).toBe(false);
    expect(d.bloqueio).toBe("trabalho-nao-salvo");
  });

  it("PIX pendente do checkout: bloqueia mesmo fora das telas de compra (cliente foi ao app do banco)", () => {
    const d = decidirMomentoSeguro({
      ...BASE,
      view: "profile",
      pedidoPendenteDoCheckout: true,
      documentoOculto: true,
    });
    expect(d.instalarAgora).toBe(false);
    expect(d.livre).toBe(false);
    expect(d.bloqueio).toBe("pedido-pendente-do-checkout");
  });

  it("controle: painel limpo, trocando de tela: instala (o bloqueio não é geral)", () => {
    expect(
      decidirMomentoSeguro({
        ...BASE,
        view: "admin-dashboard",
        trocouDeTela: true,
      }).instalarAgora,
    ).toBe(true);
  });
});

describe("todas as combinações: a regra é a conjunção, sem exceção escondida", () => {
  const bool = [false, true];
  for (const view of ["home", "checkout", "admin-pdv"]) {
    for (const adminDirty of bool) {
      for (const pedido of bool) {
        for (const oculto of bool) {
          for (const trocou of bool) {
            it(`view=${view} dirty=${adminDirty} pedido=${pedido} oculto=${oculto} trocou=${trocou}`, () => {
              const d = decidirMomentoSeguro({
                view,
                adminDirty,
                pedidoPendenteDoCheckout: pedido,
                documentoOculto: oculto,
                trocouDeTela: trocou,
              });
              const bloqueado =
                TELAS_DE_COMPRA.has(view as never) || adminDirty || pedido;
              expect(d.livre).toBe(!bloqueado);
              expect(d.pontoDeParada).toBe(oculto || trocou);
              expect(d.instalarAgora).toBe(!bloqueado && (oculto || trocou));
              expect(d.bloqueio === null).toBe(!bloqueado);
            });
          }
        }
      }
    }
  }
});
