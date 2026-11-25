// Os NÚMEROS da cadência de confirmação do cartão (depois do 3DS). Os outros
// testes importam estas constantes e giram o relógio POR ELAS, então qualquer
// valor passaria; aqui o contrato documentado em
// `src/components/checkout/confirmacao-do-cartao.ts` fica fixado: se alguém
// mexer num deles, precisa mexer aqui de propósito.
import { describe, expect, it } from "vitest";

import {
  ESPERAS_DA_CONFIRMACAO_MS,
  ESPERAS_DA_RODADA_MANUAL_MS,
  ESPERA_ANTES_DO_AVISO_DO_APROVADO_MS,
  RETOMADAS_PELA_ABA_DA_CONFIRMACAO,
  RODADAS_MANUAIS_DA_CONFIRMACAO,
  TEMPO_LIMITE_DA_CONSULTA_DO_CARTAO_MS,
} from "@/components/checkout/confirmacao-do-cartao";

describe("números da cadência de confirmação do cartão", () => {
  it("esperas automáticas: 3, 5, 8, 12, 15, 20, 30 e 30 segundos", () => {
    expect([...ESPERAS_DA_CONFIRMACAO_MS]).toEqual([
      3_000, 5_000, 8_000, 12_000, 15_000, 20_000, 30_000, 30_000,
    ]);
  });

  it("a soma das esperas automáticas fica abaixo dos 3 minutos em que 'em análise' oferece o PIX", () => {
    const soma = ESPERAS_DA_CONFIRMACAO_MS.reduce((a, b) => a + b, 0);
    expect(soma).toBe(123_000);
    expect(soma).toBeLessThan(180_000);
  });

  it("rodada manual: consulta já e mais duas (10 s e 20 s depois)", () => {
    expect([...ESPERAS_DA_RODADA_MANUAL_MS]).toEqual([0, 10_000, 20_000]);
  });

  it("no máximo 5 toques de 'Verificar de novo' e 3 retomadas pela aba por tentativa", () => {
    expect(RODADAS_MANUAIS_DA_CONFIRMACAO).toBe(5);
    expect(RETOMADAS_PELA_ABA_DA_CONFIRMACAO).toBe(3);
  });

  it("teto local de uma consulta: 35 s; aviso do aprovado sem confirmação: 60 s", () => {
    expect(TEMPO_LIMITE_DA_CONSULTA_DO_CARTAO_MS).toBe(35_000);
    expect(ESPERA_ANTES_DO_AVISO_DO_APROVADO_MS).toBe(60_000);
  });
});
