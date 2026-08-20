// Auditoria do painel do lojista, lote 1 — a tela de Cupons (AdminCouponsView)
// mostrava "Ativo" e contava no indicador "Cupons Ativos" um cupom cuja data
// de validade já tinha passado, mesmo o servidor já recusando esse cupom no
// checkout. Estas duas funções puras isolam a parte que dá para testar sem
// montar a tela: quando um cupom expira, e qual rótulo ele ganha quando a
// chavinha manual (`active`) e o vencimento discordam entre si. O
// companheiro `admin-coupons-view-expirado.test.tsx` prova que a TELA usa
// estas funções — sozinho, este arquivo não pega o defeito de esquecer de
// ligar a função no JSX.
import { describe, expect, it } from "vitest";

import { cupomEstaExpirado, rotuloDoCupom } from "@/utils/status-do-cupom";

describe("cupomEstaExpirado — o corte casa com o RPC de checkout", () => {
  const agora = new Date("2026-08-20T12:00:00.000Z");

  it("sem validUntil, nunca expira", () => {
    expect(cupomEstaExpirado(undefined, agora)).toBe(false);
    expect(cupomEstaExpirado(null, agora)).toBe(false);
  });

  it("data no futuro ainda não expirou", () => {
    expect(cupomEstaExpirado("2026-08-21T00:00:00.000Z", agora)).toBe(false);
  });

  it("data no passado já expirou", () => {
    expect(cupomEstaExpirado("2026-08-19T00:00:00.000Z", agora)).toBe(true);
  });

  it("o instante exato de validUntil já conta como expirado (casa com '> now()' do RPC)", () => {
    // O checkout só aceita quando `valid_until > now()`. No instante exato,
    // o RPC já recusa — então a tela não pode dizer "Ativo" ali.
    expect(cupomEstaExpirado(agora.toISOString(), agora)).toBe(true);
  });

  it("data malformada não derruba a tela — trata como sem vencimento", () => {
    expect(cupomEstaExpirado("não é uma data", agora)).toBe(false);
  });
});

describe("rotuloDoCupom — a chavinha manual vence a leitura de vencimento", () => {
  const agora = new Date("2026-08-20T12:00:00.000Z");
  const noPassado = "2026-08-01T00:00:00.000Z";
  const noFuturo = "2026-09-01T00:00:00.000Z";

  it("ligado e dentro do prazo: Ativo", () => {
    expect(
      rotuloDoCupom({ active: true, validUntil: noFuturo }, agora),
    ).toBe("Ativo");
  });

  it("ligado e sem data de validade: Ativo", () => {
    expect(rotuloDoCupom({ active: true, validUntil: null }, agora)).toBe(
      "Ativo",
    );
  });

  it("ligado e vencido: Expirado", () => {
    expect(
      rotuloDoCupom({ active: true, validUntil: noPassado }, agora),
    ).toBe("Expirado");
  });

  it("desligado na chavinha, mesmo dentro do prazo: Inativo", () => {
    expect(
      rotuloDoCupom({ active: false, validUntil: noFuturo }, agora),
    ).toBe("Inativo");
  });

  it("desligado na chavinha E vencido: Inativo, a chavinha decide — não existe um terceiro rótulo", () => {
    expect(
      rotuloDoCupom({ active: false, validUntil: noPassado }, agora),
    ).toBe("Inativo");
    expect(
      rotuloDoCupom({ active: false, validUntil: noPassado }, agora),
    ).not.toBe("Expirado");
  });
});
