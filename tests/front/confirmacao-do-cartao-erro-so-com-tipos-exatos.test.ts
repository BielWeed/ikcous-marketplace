// CONFIRMAÇÃO DO CARTÃO — o erro da consulta só encerra a tela quando a edge
// diz, com os TIPOS exatos, que o problema é do PEDIDO: `terminal` é o
// booleano `true` (não 1, não "1") e `httpStatus` é o NÚMERO 409 ou 404 (não o
// texto "409"). Achado por mutação em
// `src/components/checkout/confirmacao-do-cartao.ts`: trocar `===` por `==`
// nessas três comparações não derrubava teste nenhum, e a tela passaria a
// mostrar um painel de "este pedido não pode ser pago" por um erro que não fala
// do pedido (o cliente desistiria de pagar um pedido que ainda vale).
//
// Também fixa quais status NÃO encerram: só 409 e 404 falam do pedido — 401,
// 403, 408, 410, 429 e 500 mandam a cadência perguntar de novo (a consulta não
// cobra, então perguntar de novo é seguro).
import { describe, expect, it } from "vitest";

import { desfechoDoErroDaConsulta } from "@/components/checkout/confirmacao-do-cartao";

function erroDaEdge(
  mensagem: string,
  campos: Record<string, unknown>,
): Error & Record<string, unknown> {
  return Object.assign(new Error(mensagem), campos);
}

describe("desfechoDoErroDaConsulta — tipos exatos, nunca coerção", () => {
  it("`terminal` que só é 'verdadeiro' por coerção (1, '1', 'true', objeto) não encerra a tela", () => {
    for (const terminal of [1, "1", "true", {}, [], "sim"]) {
      expect(
        desfechoDoErroDaConsulta(
          erroDaEdge("Este pedido foi cancelado.", {
            terminal,
            httpStatus: 409,
          }),
        ),
      ).toEqual({ tipo: "sem-resposta" });
    }
  });

  it("status 409 ou 404 em TEXTO (ou lista) não encerra: só o número vale", () => {
    for (const httpStatus of ["409", "404", " 409", [409], [404]]) {
      expect(
        desfechoDoErroDaConsulta(
          erroDaEdge("Este pedido foi cancelado.", {
            terminal: true,
            httpStatus,
          }),
        ),
      ).toEqual({ tipo: "sem-resposta" });
    }
  });

  it("outros status marcados como terminal não falam do pedido: sem resposta", () => {
    for (const httpStatus of [400, 401, 403, 408, 410, 422, 429, 500, 502]) {
      expect(
        desfechoDoErroDaConsulta(
          erroDaEdge("Pagamento indisponível.", { terminal: true, httpStatus }),
        ),
      ).toEqual({ tipo: "sem-resposta" });
    }
  });

  it("os dois status que falam do pedido continuam encerrando (controle do teste)", () => {
    for (const httpStatus of [409, 404]) {
      expect(
        desfechoDoErroDaConsulta(
          erroDaEdge("Este pedido foi cancelado.", {
            terminal: true,
            httpStatus,
          }),
        ),
      ).toEqual({
        tipo: "terminal",
        mensagem: "Este pedido foi cancelado.",
      });
    }
  });
});
