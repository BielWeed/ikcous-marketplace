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

import {
  cupomEstaEsgotado,
  cupomEstaExpirado,
  rotuloDoCupom,
} from "@/utils/status-do-cupom";

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
    expect(rotuloDoCupom({ active: true, validUntil: noFuturo }, agora)).toBe(
      "Ativo",
    );
  });

  it("ligado e sem data de validade: Ativo", () => {
    expect(rotuloDoCupom({ active: true, validUntil: null }, agora)).toBe(
      "Ativo",
    );
  });

  it("ligado e vencido: Expirado", () => {
    expect(rotuloDoCupom({ active: true, validUntil: noPassado }, agora)).toBe(
      "Expirado",
    );
  });

  it("desligado na chavinha, mesmo dentro do prazo: Inativo", () => {
    expect(rotuloDoCupom({ active: false, validUntil: noFuturo }, agora)).toBe(
      "Inativo",
    );
  });

  it("desligado na chavinha E vencido: Inativo, a chavinha decide — não existe um terceiro rótulo", () => {
    expect(rotuloDoCupom({ active: false, validUntil: noPassado }, agora)).toBe(
      "Inativo",
    );
    expect(
      rotuloDoCupom({ active: false, validUntil: noPassado }, agora),
    ).not.toBe("Expirado");
  });
});

// Cupom que já usou todos os usos que tinha: o checkout recusa ("Cupom atingiu
// o limite de uso") — mas a tela dizia "Ativo" e contava o cupom como
// "Disponível para uso". A regra do servidor é `usage_limit IS NOT NULL AND
// usage_limit > 0 AND usage_count >= usage_limit` (migration 20261203000000).
describe("cupomEstaEsgotado — o teto casa com o checkout", () => {
  it.each([
    // [limite, usos, esgotado?, o caso]
    [10, 9, false, "um uso a menos que o teto"],
    [10, 10, true, "usos == teto"],
    [10, 11, true, "usos passaram do teto (corrida entre dois pedidos)"],
    [1, 1, true, "cupom de uso único já usado"],
    [1, 0, false, "cupom de uso único ainda não usado"],
    [0, 500, false, "limite 0 = sem limite, como o infinito do cartão"],
    [null, 500, false, "limite nulo = sem limite"],
    [undefined, 500, false, "limite ausente = sem limite"],
    [10, null, false, "usos nulos contam como 0"],
    [10, undefined, false, "usos ausentes contam como 0"],
  ] as const)(
    "limite %s, usos %s → esgotado %s (%s)",
    (limite, usos, esperado, _caso) => {
      expect(cupomEstaEsgotado(limite, usos)).toBe(esperado);
    },
  );
});

describe("rotuloDoCupom — Esgotado entra na ordem de decisão", () => {
  const agora = new Date("2026-08-20T12:00:00.000Z");
  const noPassado = "2026-08-01T00:00:00.000Z";
  const noFuturo = "2026-09-01T00:00:00.000Z";

  it.each([
    {
      caso: "ligado, no prazo, usos abaixo do teto",
      cupom: {
        active: true,
        validUntil: noFuturo,
        usageLimit: 5,
        usageCount: 4,
      },
      rotulo: "Ativo",
    },
    {
      caso: "ligado, ilimitado (limite 0) com muitos usos",
      cupom: { active: true, validUntil: null, usageLimit: 0, usageCount: 99 },
      rotulo: "Ativo",
    },
    {
      caso: "ligado, sem limite nenhum informado",
      cupom: { active: true },
      rotulo: "Ativo",
    },
    {
      caso: "ligado, no prazo, usos == teto",
      cupom: {
        active: true,
        validUntil: noFuturo,
        usageLimit: 5,
        usageCount: 5,
      },
      rotulo: "Esgotado",
    },
    {
      caso: "ligado, sem data, usos acima do teto",
      cupom: { active: true, validUntil: null, usageLimit: 5, usageCount: 7 },
      rotulo: "Esgotado",
    },
    {
      caso: "desligado e esgotado: a chavinha decide",
      cupom: {
        active: false,
        validUntil: noFuturo,
        usageLimit: 5,
        usageCount: 5,
      },
      rotulo: "Inativo",
    },
    {
      caso: "ligado, vencido E esgotado: a data vem primeiro, como no servidor",
      cupom: {
        active: true,
        validUntil: noPassado,
        usageLimit: 5,
        usageCount: 5,
      },
      rotulo: "Expirado",
    },
    {
      caso: "ligado, vencido, não esgotado",
      cupom: {
        active: true,
        validUntil: noPassado,
        usageLimit: 5,
        usageCount: 1,
      },
      rotulo: "Expirado",
    },
  ])("$caso → $rotulo", ({ cupom, rotulo }) => {
    expect(rotuloDoCupom(cupom, agora)).toBe(rotulo);
  });
});
