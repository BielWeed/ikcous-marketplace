// CARTÃO PELO APP (Fase 3.5, 26/09/2026) — a leitura da linha
// `config_pagamento_cartao` (id = 1) falha FECHADO, e a gravação passa pela
// RPC de admin `salvar_config_pagamento_cartao` com os três parâmetros do
// contrato (docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { banco } = vi.hoisted(() => ({
  banco: {
    resposta: { data: null, error: null } as {
      data: unknown;
      error: { message: string; code?: string } | null;
    },
    lancar: false,
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      banco.from(tabela);
      if (banco.lancar) throw new TypeError("rede caiu");
      return {
        select: (colunas: string) => {
          banco.select(colunas);
          return {
            eq: (coluna: string, valor: unknown) => {
              banco.eq(coluna, valor);
              return { maybeSingle: async () => banco.resposta };
            },
          };
        },
      };
    },
    rpc: (...args: unknown[]) => banco.rpc(...args),
  },
}));

import {
  CONFIG_DO_CARTAO_DESLIGADA,
  buscarConfigDoCartao,
  cartaoLigado,
  esquecerConfigDoCartao,
  lerConfigDoCartao,
  normalizarConfigDoCartao,
  parcelasMaximasNoBrick,
  rotuloDaOpcaoDeCartao,
  salvarConfigDoCartao,
  tiposDeCartaoAceitos,
} from "@/lib/config-do-cartao";

beforeEach(() => {
  esquecerConfigDoCartao();
  banco.resposta = { data: null, error: null };
  banco.lancar = false;
  banco.from.mockReset();
  banco.select.mockReset();
  banco.eq.mockReset();
  banco.rpc.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("normalizarConfigDoCartao — só o que o banco garante liga alguma coisa", () => {
  it("linha válida passa como está", () => {
    expect(
      normalizarConfigDoCartao({
        credito: true,
        debito: false,
        parcelas_max: 6,
      }),
    ).toEqual({ credito: true, debito: false, parcelasMax: 6 });
  });

  it("ausente, nula ou com tipos estranhos fica DESLIGADA", () => {
    expect(normalizarConfigDoCartao(null)).toEqual(CONFIG_DO_CARTAO_DESLIGADA);
    expect(normalizarConfigDoCartao(undefined)).toEqual(
      CONFIG_DO_CARTAO_DESLIGADA,
    );
    expect(
      normalizarConfigDoCartao({ credito: "true", debito: 1, parcelas_max: 3 }),
    ).toEqual({ credito: false, debito: false, parcelasMax: 3 });
  });

  it("parcelas fora de 1..12 ou quebradas caem em 1 (à vista)", () => {
    for (const parcelas_max of [0, 13, 2.5, "6", null]) {
      expect(
        normalizarConfigDoCartao({ credito: true, debito: false, parcelas_max })
          .parcelasMax,
      ).toBe(1);
    }
    expect(
      normalizarConfigDoCartao({
        credito: true,
        debito: false,
        parcelas_max: 12,
      }).parcelasMax,
    ).toBe(12);
  });
});

describe("derivados da config", () => {
  const credito = { credito: true, debito: false, parcelasMax: 10 };
  const debito = { credito: false, debito: true, parcelasMax: 10 };
  const osDois = { credito: true, debito: true, parcelasMax: 10 };

  it("rótulo diz só o que a loja aceita", () => {
    expect(rotuloDaOpcaoDeCartao(credito)).toBe("Cartão de crédito");
    expect(rotuloDaOpcaoDeCartao(debito)).toBe("Cartão de débito");
    expect(rotuloDaOpcaoDeCartao(osDois)).toBe("Cartão de crédito ou débito");
  });

  it("tipos do Brick e parcelas: débito é sempre à vista", () => {
    expect(tiposDeCartaoAceitos(credito)).toEqual(["credit_card"]);
    expect(tiposDeCartaoAceitos(debito)).toEqual(["debit_card"]);
    expect(tiposDeCartaoAceitos(osDois)).toEqual(["credit_card", "debit_card"]);
    expect(parcelasMaximasNoBrick(credito)).toBe(10);
    expect(parcelasMaximasNoBrick(debito)).toBe(1);
    expect(parcelasMaximasNoBrick(osDois)).toBe(10);
  });

  it("cartaoLigado só com crédito ou débito", () => {
    expect(cartaoLigado(CONFIG_DO_CARTAO_DESLIGADA)).toBe(false);
    expect(cartaoLigado(credito)).toBe(true);
    expect(cartaoLigado(debito)).toBe(true);
  });
});

describe("buscarConfigDoCartao / lerConfigDoCartao", () => {
  it("lê a linha id=1 com as três colunas do contrato", async () => {
    banco.resposta = {
      data: { credito: true, debito: true, parcelas_max: 4 },
      error: null,
    };
    await expect(buscarConfigDoCartao()).resolves.toEqual({
      ok: true,
      config: { credito: true, debito: true, parcelasMax: 4 },
    });
    expect(banco.from).toHaveBeenCalledWith("config_pagamento_cartao");
    expect(banco.select).toHaveBeenCalledWith("credito,debito,parcelas_max");
    expect(banco.eq).toHaveBeenCalledWith("id", 1);
  });

  it("linha ausente é 'desligado' legítimo, não falha", async () => {
    await expect(buscarConfigDoCartao()).resolves.toEqual({
      ok: true,
      config: CONFIG_DO_CARTAO_DESLIGADA,
    });
  });

  it("erro do banco ou exceção: buscar diz que falhou; ler devolve DESLIGADA", async () => {
    banco.resposta = { data: null, error: { message: "permission denied" } };
    await expect(buscarConfigDoCartao()).resolves.toEqual({ ok: false });
    await expect(lerConfigDoCartao()).resolves.toEqual(
      CONFIG_DO_CARTAO_DESLIGADA,
    );

    esquecerConfigDoCartao();
    banco.lancar = true;
    await expect(buscarConfigDoCartao()).resolves.toEqual({ ok: false });
    await expect(lerConfigDoCartao()).resolves.toEqual(
      CONFIG_DO_CARTAO_DESLIGADA,
    );
  });

  it("ler tem cache de módulo — mas falha NÃO fica em cache", async () => {
    banco.resposta = { data: null, error: { message: "rede" } };
    await lerConfigDoCartao();
    banco.resposta = {
      data: { credito: true, debito: false, parcelas_max: 3 },
      error: null,
    };
    await expect(lerConfigDoCartao()).resolves.toEqual({
      credito: true,
      debito: false,
      parcelasMax: 3,
    });
    expect(banco.from).toHaveBeenCalledTimes(2);

    // Agora com sucesso em cache: a terceira leitura não vai ao banco.
    await lerConfigDoCartao();
    expect(banco.from).toHaveBeenCalledTimes(2);
  });

  it("o cache vence em 1 minuto (o painel desligou → o checkout vê)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
    banco.resposta = {
      data: { credito: true, debito: false, parcelas_max: 3 },
      error: null,
    };
    await lerConfigDoCartao();
    banco.resposta = {
      data: { credito: false, debito: false, parcelas_max: 3 },
      error: null,
    };
    vi.setSystemTime(new Date("2026-09-26T12:00:59Z"));
    await expect(lerConfigDoCartao()).resolves.toMatchObject({ credito: true });
    vi.setSystemTime(new Date("2026-09-26T12:01:01Z"));
    await expect(lerConfigDoCartao()).resolves.toMatchObject({
      credito: false,
    });
  });
});

describe("salvarConfigDoCartao", () => {
  it("chama a RPC com p_credito/p_debito/p_parcelas_max e devolve a linha GRAVADA", async () => {
    banco.rpc.mockResolvedValue({
      data: { id: 1, credito: true, debito: false, parcelas_max: 5 },
      error: null,
    });
    await expect(
      salvarConfigDoCartao({ credito: true, debito: false, parcelasMax: 5 }),
    ).resolves.toEqual({ credito: true, debito: false, parcelasMax: 5 });
    expect(banco.rpc).toHaveBeenCalledWith("salvar_config_pagamento_cartao", {
      p_credito: true,
      p_debito: false,
      p_parcelas_max: 5,
    });
  });

  it("salvar esquece o cache do checkout", async () => {
    banco.resposta = {
      data: { credito: true, debito: false, parcelas_max: 3 },
      error: null,
    };
    await lerConfigDoCartao();
    banco.rpc.mockResolvedValue({
      data: { credito: false, debito: false, parcelas_max: 3 },
      error: null,
    });
    await salvarConfigDoCartao({
      credito: false,
      debito: false,
      parcelasMax: 3,
    });
    await lerConfigDoCartao();
    expect(banco.from).toHaveBeenCalledTimes(2);
  });

  it("sem permissão (42501) ou outro erro: lança frase curada, nunca o texto do Postgres", async () => {
    banco.rpc.mockResolvedValue({
      data: null,
      error: { message: "new row violates row-level security", code: "42501" },
    });
    await expect(
      salvarConfigDoCartao({ credito: true, debito: false, parcelasMax: 1 }),
    ).rejects.toThrow(
      "Só o administrador da loja pode mudar o cartão pelo app.",
    );

    banco.rpc.mockResolvedValue({
      data: null,
      error: { message: "check constraint parcelas_max", code: "23514" },
    });
    await expect(
      salvarConfigDoCartao({ credito: true, debito: false, parcelasMax: 1 }),
    ).rejects.toThrow(
      "Não foi possível salvar o cartão pelo app. Tente de novo.",
    );
  });
});
