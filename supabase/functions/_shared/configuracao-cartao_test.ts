import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  aceitaAlgumCartao,
  CONFIGURACAO_CARTAO_PADRAO,
  escreverConfiguracaoCartao,
  lerConfiguracaoCartao,
  tentativaCabeNaConfiguracao,
} from "./configuracao-cartao.ts";

Deno.test("lerConfiguracaoCartao: linha ausente é o padrão (tudo ligado, sem limite)", () => {
  assertEquals(lerConfiguracaoCartao(null), { ok: true, config: CONFIGURACAO_CARTAO_PADRAO });
  assertEquals(lerConfiguracaoCartao(undefined), {
    ok: true,
    config: { credito: true, debito: true, parcelasMax: null },
  });
});

Deno.test("lerConfiguracaoCartao: lê o que o painel grava", () => {
  assertEquals(
    lerConfiguracaoCartao('{"credito":true,"debito":false,"parcelas_max":6}'),
    { ok: true, config: { credito: true, debito: false, parcelasMax: 6 } },
  );
  assertEquals(
    lerConfiguracaoCartao('{"credito":false,"debito":true,"parcelas_max":null}'),
    { ok: true, config: { credito: false, debito: true, parcelasMax: null } },
  );
});

Deno.test("lerConfiguracaoCartao: presente mas ilegível recusa, nunca vira o padrão", () => {
  for (
    const bruto of [
      "",
      "não é json",
      "null",
      "[]",
      "{}",
      '{"credito":true,"debito":true}',
      '{"credito":"sim","debito":true,"parcelas_max":null}',
      '{"credito":true,"debito":true,"parcelas_max":0}',
      '{"credito":true,"debito":true,"parcelas_max":13}',
      '{"credito":true,"debito":true,"parcelas_max":2.5}',
      '{"credito":true,"debito":true,"parcelas_max":"6"}',
    ]
  ) {
    assertEquals(lerConfiguracaoCartao(bruto), { ok: false }, bruto);
  }
});

Deno.test("escreverConfiguracaoCartao: ida e volta preservam o valor", () => {
  const config = { credito: true, debito: false, parcelasMax: 10 };
  assertEquals(lerConfiguracaoCartao(escreverConfiguracaoCartao(config)), { ok: true, config });
});

Deno.test("escreverConfiguracaoCartao: recusa parcelas fora da faixa", () => {
  assertThrows(() => escreverConfiguracaoCartao({ credito: true, debito: true, parcelasMax: 0 }));
  assertThrows(() => escreverConfiguracaoCartao({ credito: true, debito: true, parcelasMax: 13 }));
});

Deno.test("tentativaCabeNaConfiguracao: crédito até o limite do lojista", () => {
  const config = { credito: true, debito: true, parcelasMax: 6 };
  assertEquals(tentativaCabeNaConfiguracao(config, "credit_card", 1), { ok: true });
  assertEquals(tentativaCabeNaConfiguracao(config, "credit_card", 6), { ok: true });
  assertEquals(tentativaCabeNaConfiguracao(config, "credit_card", 7), {
    ok: false,
    motivo: "Esta loja parcela em até 6x.",
  });
});

Deno.test("tentativaCabeNaConfiguracao: sem limite do app aceita o que o MP oferecer", () => {
  assertEquals(tentativaCabeNaConfiguracao(CONFIGURACAO_CARTAO_PADRAO, "credit_card", 12), {
    ok: true,
  });
});

Deno.test("tentativaCabeNaConfiguracao: débito é só à vista e respeita o desligado", () => {
  assertEquals(tentativaCabeNaConfiguracao(CONFIGURACAO_CARTAO_PADRAO, "debit_card", 1), {
    ok: true,
  });
  assertEquals(tentativaCabeNaConfiguracao(CONFIGURACAO_CARTAO_PADRAO, "debit_card", 2), {
    ok: false,
    motivo: "Cartão de débito é só à vista.",
  });
  assertEquals(
    tentativaCabeNaConfiguracao({ credito: true, debito: false, parcelasMax: null }, "debit_card", 1),
    { ok: false, motivo: "Esta loja não aceita cartão de débito." },
  );
});

Deno.test("tentativaCabeNaConfiguracao: crédito desligado recusa", () => {
  assertEquals(
    tentativaCabeNaConfiguracao({ credito: false, debito: true, parcelasMax: null }, "credit_card", 1),
    { ok: false, motivo: "Esta loja não aceita cartão de crédito." },
  );
});

Deno.test("tentativaCabeNaConfiguracao: parcelas não inteiras ou < 1 recusam", () => {
  for (const parcelas of [0, -1, 1.5, Number.NaN]) {
    assertEquals(
      tentativaCabeNaConfiguracao(CONFIGURACAO_CARTAO_PADRAO, "credit_card", parcelas).ok,
      false,
      String(parcelas),
    );
  }
});

Deno.test("aceitaAlgumCartao", () => {
  assertEquals(aceitaAlgumCartao(CONFIGURACAO_CARTAO_PADRAO), true);
  assertEquals(aceitaAlgumCartao({ credito: false, debito: true, parcelasMax: null }), true);
  assertEquals(aceitaAlgumCartao({ credito: false, debito: false, parcelasMax: null }), false);
});
