// A janela do sino de "recebimentos por marcar" segue o prazo de devolução da
// loja (15/10/2026). Antes era fixa em 30 dias: nos dias 31 a 90 a cliente
// tentava devolver, o servidor recusava ("Este pedido não tem pagamento a
// devolver") e o sino já tinha esquecido o pedido.
//
// Aqui: a data de corte (semântica do servidor: dia de calendário de São
// Paulo, `v_dias <= prazo`, migration 20261175000000) e a leitura do prazo,
// com a regra de ouro: se a configuração não chegou, o prazo é 90 — o aviso
// tem de SOBRAR, nunca sumir.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  JANELA_DE_RECEBIMENTO_DIAS,
  inicioDaJanelaDeRecebimento,
  inicioDaJanelaDoSino,
} from "@/lib/recebimentos-por-marcar";

const { maybeSingleMock, fromMock } = vi.hoisted(() => {
  const maybeSingleMock = vi.fn();
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: maybeSingleMock,
  };
  return { maybeSingleMock, fromMock: vi.fn(() => builder) };
});

vi.mock("@/lib/supabase", () => ({ supabase: { from: fromMock } }));

/** O pedido entra no sino se a data dele passa do corte. */
function apareceNoSino(atualizadoEm: string, agora: string, dias?: number) {
  const corte =
    dias === undefined
      ? inicioDaJanelaDeRecebimento(Date.parse(agora))
      : inicioDaJanelaDeRecebimento(Date.parse(agora), dias);
  return Date.parse(atualizadoEm) >= Date.parse(corte);
}

describe("a data de corte do sino", () => {
  it("o padrão é 90 dias", () => {
    expect(JANELA_DE_RECEBIMENTO_DIAS).toBe(90);
  });

  it("o corte é o INÍCIO do dia de São Paulo, `dias` dias de calendário atrás", () => {
    // 15/10/2026 15:00 em São Paulo = 18:00Z.
    expect(
      inicioDaJanelaDeRecebimento(Date.parse("2026-10-15T18:00:00Z"), 30),
    ).toBe("2026-09-15T00:00:00-03:00");
    expect(
      inicioDaJanelaDeRecebimento(Date.parse("2026-10-15T18:00:00Z")),
    ).toBe("2026-07-17T00:00:00-03:00");
  });

  it("pedido de 45 dias APARECE com prazo de 90 e NÃO aparece com prazo de 30", () => {
    const agora = "2026-10-15T18:00:00Z";
    const atualizado = "2026-08-31T18:00:00Z"; // 45 dias antes
    expect(apareceNoSino(atualizado, agora, 90)).toBe(true);
    expect(apareceNoSino(atualizado, agora, 30)).toBe(false);
    // Sem prazo informado, vale o padrão de 90.
    expect(apareceNoSino(atualizado, agora)).toBe(true);
  });

  it("o dia limite vale o dia INTEIRO: atualizado às 23:00 do dia limite, 'agora' 23:30 do mesmo dia", () => {
    // Prazo de 30 dias. O servidor aceita `hoje(SP) - dia(SP) <= 30`.
    // Dia limite = 15/09 (30 dias antes de 15/10). 23:00 em SP = 02:00Z do dia
    // seguinte; 'agora' = 15/10 23:30 em SP = 16/10 02:30Z.
    const atualizado = "2026-09-16T02:00:00.000Z";
    const agora = "2026-10-16T02:30:00Z";
    expect(apareceNoSino(atualizado, agora, 30)).toBe(true);
  });

  it("no dia seguinte o mesmo pedido já saiu (o servidor recusa)", () => {
    const atualizado = "2026-09-16T02:00:00.000Z"; // 15/09 23:00 em SP
    const agora = "2026-10-17T02:30:00Z"; // 16/10 23:30 em SP
    expect(apareceNoSino(atualizado, agora, 30)).toBe(false);
  });

  it("pedido do começo do dia limite (00:00 em SP) também aparece; um minuto antes, não", () => {
    const agora = "2026-10-15T18:00:00Z";
    expect(apareceNoSino("2026-09-15T03:00:00.000Z", agora, 30)).toBe(true);
    expect(apareceNoSino("2026-09-15T02:59:00.000Z", agora, 30)).toBe(false);
  });

  it("virada de mês e de ano: 15 dias antes de 05/01/2027 é 21/12/2026", () => {
    expect(
      inicioDaJanelaDeRecebimento(Date.parse("2027-01-05T15:00:00Z"), 15),
    ).toBe("2026-12-21T00:00:00-03:00");
  });
});

describe("a leitura do prazo da loja", () => {
  beforeEach(() => {
    maybeSingleMock.mockReset();
    fromMock.mockClear();
  });

  /** Quantos dias o corte devolvido está para trás de hoje (calendário SP). */
  function diasDoCorte(corte: string): number {
    const hoje = new Date().toLocaleDateString("sv-SE", {
      timeZone: "America/Sao_Paulo",
    });
    return Math.round(
      (Date.parse(hoje) - Date.parse(corte.slice(0, 10))) / 86_400_000,
    );
  }

  it("lê a linha única de `politica_devolucao` e usa o prazo de defeito da loja", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { prazo_vicio_dias: 200 },
      error: null,
    });

    expect(diasDoCorte(await inicioDaJanelaDoSino())).toBe(200);
    expect(fromMock).toHaveBeenCalledWith("politica_devolucao");
  });

  it("a loja que aceita troca por MAIS dias que o defeito: vale o maior (troca 180 > defeito 90)", async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        prazo_vicio_dias: 90,
        prazo_troca_dias: 180,
        prazo_arrependimento_dias: 7,
        aceita_troca: true,
      },
      error: null,
    });

    expect(diasDoCorte(await inicioDaJanelaDoSino())).toBe(180);
  });

  it("troca que a loja NÃO aceita não alarga a janela (o servidor recusa a troca)", async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        prazo_vicio_dias: 90,
        prazo_troca_dias: 180,
        prazo_arrependimento_dias: 7,
        aceita_troca: false,
      },
      error: null,
    });

    expect(diasDoCorte(await inicioDaJanelaDoSino())).toBe(90);
  });

  it.each([
    ["o banco devolve erro", { data: null, error: { message: "caiu" } }],
    ["a linha não existe", { data: null, error: null }],
    ["a linha vem sem o prazo", { data: {}, error: null }],
    ["o prazo vem torto", { data: { prazo_vicio_dias: "x" }, error: null }],
    ["o prazo vem zerado", { data: { prazo_vicio_dias: 0 }, error: null }],
  ])("%s: usa 90", async (_nome, resposta) => {
    maybeSingleMock.mockResolvedValue(resposta);

    expect(diasDoCorte(await inicioDaJanelaDoSino())).toBe(90);
  });

  it("a consulta que lança (rede caiu) também usa 90 — e não derruba quem chamou", async () => {
    maybeSingleMock.mockRejectedValue(new Error("rede"));

    expect(diasDoCorte(await inicioDaJanelaDoSino())).toBe(90);
  });
});
