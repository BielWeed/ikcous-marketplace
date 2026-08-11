// @ts-nocheck
/**
 * Testes da notify-new-order (PEDIDO-020, #89).
 *
 * Nada aqui toca rede nem banco. O que se prova é a parte que decide SE o aviso
 * sai e O QUE ele diz — que é onde os erros custam caro: aviso com valor errado
 * manda o lojista conferir o pedido errado, e janela mal calculada transforma
 * uma função sem `verify_jwt` em canal de spam.
 *
 * O envio em si já é coberto pelos testes da send-push, que exercitam o mesmo
 * `enviarParaInscritos` de `_shared/webpush.ts` contra um push service local.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  JANELA_MINUTOS,
  dentroDaJanela,
  formatarBRL,
  montarAviso,
  numeroDoPedido,
  pareceUuid,
} from "./index.ts";

const UUID_VALIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

Deno.test("aceita UUID e recusa o que não é", () => {
  assert(pareceUuid(UUID_VALIDO));
  assert(pareceUuid(UUID_VALIDO.toUpperCase()));

  for (const ruim of [
    "",
    null,
    undefined,
    42,
    "1; DROP TABLE marketplace_orders",
    "3f2a1b8c4d5e4f609a7b1c2d3e4f5a6b",
    `${UUID_VALIDO} `,
  ]) {
    assertEquals(pareceUuid(ruim), false, `deveria recusar: ${String(ruim)}`);
  }
});

Deno.test("número do pedido são os 6 últimos, em maiúscula", () => {
  assertEquals(numeroDoPedido(UUID_VALIDO), "#4F5A6B");
});

Deno.test("valor sai em pt-BR, com milhar", () => {
  assertEquals(formatarBRL(129.8), "R$ 129,80");
  assertEquals(formatarBRL(1234.5), "R$ 1.234,50");
  assertEquals(formatarBRL(0), "R$ 0,00");
  assertEquals(formatarBRL("59.90"), "R$ 59,90");
});

Deno.test("valor ausente ou inválido não vira NaN na tela do lojista", () => {
  assertEquals(formatarBRL(null), "R$ 0,00");
  assertEquals(formatarBRL(undefined), "R$ 0,00");
  assertEquals(formatarBRL("abacaxi"), "R$ 0,00");
});

Deno.test("o aviso traz os três dados que o critério 2 exige", () => {
  const aviso = montarAviso({
    id: UUID_VALIDO,
    customer_name: "Maria Silva",
    total: 129.8,
    total_amount: null,
    created_at: new Date().toISOString(),
  });

  assertStringIncludes(aviso.body, "#4F5A6B"); // número do pedido
  assertStringIncludes(aviso.body, "R$ 129,80"); // valor
  assertStringIncludes(aviso.body, "Maria Silva"); // nome do cliente
});

Deno.test("usa total, não total_amount — medido: 18 de 64 pedidos têm total_amount NULL", () => {
  const aviso = montarAviso({
    id: UUID_VALIDO,
    customer_name: "João",
    total: 99.9,
    total_amount: 1,
    created_at: new Date().toISOString(),
  });
  assertStringIncludes(aviso.body, "R$ 99,90");
});

Deno.test("cai para total_amount quando total é nulo", () => {
  const aviso = montarAviso({
    id: UUID_VALIDO,
    customer_name: "João",
    total: null,
    total_amount: 42.5,
    created_at: new Date().toISOString(),
  });
  assertStringIncludes(aviso.body, "R$ 42,50");
});

Deno.test("pedido sem nome não vira 'undefined' na notificação", () => {
  for (const nome of [null, undefined, "", "   "]) {
    const aviso = montarAviso({
      id: UUID_VALIDO,
      customer_name: nome,
      total: 10,
      created_at: new Date().toISOString(),
    });
    assertStringIncludes(aviso.body, "cliente sem nome");
    assertEquals(aviso.body.includes("undefined"), false);
  }
});

Deno.test("janela: pedido recente passa, pedido velho não", () => {
  const agora = Date.parse("2026-08-05T12:00:00.000Z");

  const minutosAtras = (m: number) =>
    new Date(agora - m * 60000).toISOString();

  assert(dentroDaJanela(minutosAtras(0), agora), "agora mesmo");
  assert(dentroDaJanela(minutosAtras(1), agora), "1 min");
  assert(
    dentroDaJanela(minutosAtras(JANELA_MINUTOS), agora),
    "exatamente no limite",
  );
  assertEquals(
    dentroDaJanela(minutosAtras(JANELA_MINUTOS + 1), agora),
    false,
    "1 min depois do limite",
  );
  assertEquals(dentroDaJanela(minutosAtras(60 * 24), agora), false, "ontem");
});

Deno.test("janela tolera relógio adiantado, mas não o futuro distante", () => {
  const agora = Date.parse("2026-08-05T12:00:00.000Z");
  const emMinutos = (m: number) => new Date(agora + m * 60000).toISOString();

  assert(dentroDaJanela(emMinutos(1), agora), "1 min no futuro: relógio");
  assertEquals(
    dentroDaJanela(emMinutos(10), agora),
    false,
    "10 min no futuro não é desvio de relógio",
  );
});

Deno.test("data ilegível não passa pela janela", () => {
  assertEquals(dentroDaJanela("nunca", Date.now()), false);
  assertEquals(dentroDaJanela("", Date.now()), false);
});
