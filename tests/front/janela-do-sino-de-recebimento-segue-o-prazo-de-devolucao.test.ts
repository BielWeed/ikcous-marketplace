// A janela do sino de "recebimentos por marcar" segue o prazo de devolução da
// loja (15/10/2026). Antes era fixa em 30 dias: nos dias 31 a 90 a cliente
// tentava devolver, o servidor recusava ("Este pedido não tem pagamento a
// devolver") e o sino já tinha esquecido o pedido.
//
// Aqui a parte pura (a conta da data de corte e a leitura do prazo) e a leitura
// da configuração no banco, com a regra de ouro: se a configuração não chegou,
// o prazo é 90 — o aviso tem de SOBRAR, nunca sumir.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  JANELA_DE_RECEBIMENTO_DIAS,
  inicioDaJanelaDeRecebimento,
  janelaDeRecebimentoDias,
} from "@/lib/recebimentos-por-marcar";
import type { PoliticaDevolucao } from "@/types/devolucao";

const DIA = 24 * 3600 * 1000;
const AGORA = Date.parse("2026-10-15T15:00:00.000Z");

/** Um pedido atualizado há `dias` dias aparece no sino se a data dele passa do corte. */
function apareceNoSino(diasAtras: number, prazoEmDias?: number): boolean {
  const corte =
    prazoEmDias === undefined
      ? inicioDaJanelaDeRecebimento(AGORA)
      : inicioDaJanelaDeRecebimento(AGORA, prazoEmDias);
  const atualizadoEm = new Date(AGORA - diasAtras * DIA).toISOString();
  return atualizadoEm >= corte;
}

function politica(extra: Partial<PoliticaDevolucao> = {}): PoliticaDevolucao {
  return {
    prazo_arrependimento_dias: 7,
    prazo_troca_dias: 30,
    prazo_vicio_dias: 90,
    aceita_troca: true,
    aceita_vale: true,
    exige_fotos_vicio: true,
    metodos_locais: [],
    metodos_nacionais: [],
    reembolso_momento: "ao_receber",
    frete_troca_pago_por: "cliente",
    categorias_sem_troca: [],
    texto_politica: "",
    endereco_devolucao: "",
    updated_at: "",
    ...extra,
  } as PoliticaDevolucao;
}

describe("a data de corte do sino", () => {
  it("o padrão é 90 dias (o prazo de vício padrão da loja)", () => {
    expect(JANELA_DE_RECEBIMENTO_DIAS).toBe(90);
    expect(inicioDaJanelaDeRecebimento(AGORA)).toBe(
      new Date(AGORA - 90 * DIA).toISOString(),
    );
  });

  it("pedido de 45 dias APARECE com prazo de 90 e NÃO aparece com prazo de 30", () => {
    expect(apareceNoSino(45, 90)).toBe(true);
    expect(apareceNoSino(45, 30)).toBe(false);
  });

  it("sem prazo informado usa 90: o pedido de 45 dias aparece", () => {
    expect(apareceNoSino(45)).toBe(true);
    expect(apareceNoSino(89)).toBe(true);
    expect(apareceNoSino(91)).toBe(false);
  });

  it("o prazo escolhido manda no corte", () => {
    expect(inicioDaJanelaDeRecebimento(AGORA, 180)).toBe(
      new Date(AGORA - 180 * DIA).toISOString(),
    );
  });
});

describe("o prazo que a loja configurou", () => {
  it("sem configuração (ainda não carregou ou falhou) usa 90", () => {
    expect(janelaDeRecebimentoDias(null)).toBe(90);
    expect(janelaDeRecebimentoDias(undefined)).toBe(90);
  });

  it("usa o prazo de vício da loja", () => {
    expect(janelaDeRecebimentoDias(politica({ prazo_vicio_dias: 120 }))).toBe(
      120,
    );
  });

  it("vício curto, troca desligada: segue o vício (o mínimo do banco é 30)", () => {
    expect(
      janelaDeRecebimentoDias(
        politica({ prazo_vicio_dias: 30, aceita_troca: false }),
      ),
    ).toBe(30);
  });

  it("a cliente que ainda pode TROCAR também precisa do aviso: vale o maior prazo", () => {
    expect(
      janelaDeRecebimentoDias(
        politica({ prazo_vicio_dias: 30, prazo_troca_dias: 60 }),
      ),
    ).toBe(60);
  });

  it("troca desligada não alarga a janela", () => {
    expect(
      janelaDeRecebimentoDias(
        politica({
          prazo_vicio_dias: 30,
          prazo_troca_dias: 60,
          aceita_troca: false,
        }),
      ),
    ).toBe(30);
  });

  it("o prazo de desistir da compra também conta quando é o maior", () => {
    expect(
      janelaDeRecebimentoDias(
        politica({
          prazo_vicio_dias: 30,
          prazo_troca_dias: 0,
          prazo_arrependimento_dias: 45,
        }),
      ),
    ).toBe(45);
  });

  it("número quebrado na configuração cai no 90, nunca em janela zero", () => {
    expect(
      janelaDeRecebimentoDias(
        politica({
          prazo_vicio_dias: Number.NaN,
          prazo_troca_dias: Number.NaN,
          prazo_arrependimento_dias: Number.NaN,
        }),
      ),
    ).toBe(90);
    expect(
      janelaDeRecebimentoDias(
        politica({
          prazo_vicio_dias: 0,
          prazo_troca_dias: 0,
          prazo_arrependimento_dias: 0,
        }),
      ),
    ).toBe(90);
  });
});

describe("a leitura da configuração no banco", () => {
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

  beforeEach(() => {
    maybeSingleMock.mockReset();
    fromMock.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lê a linha única de `politica_devolucao` e devolve o prazo da loja", async () => {
    const { lerJanelaDeRecebimentoDias } = await import(
      "@/lib/janela-de-recebimento-da-loja"
    );
    maybeSingleMock.mockResolvedValue({
      data: {
        prazo_arrependimento_dias: 7,
        prazo_troca_dias: 30,
        prazo_vicio_dias: 200,
        aceita_troca: true,
      },
      error: null,
    });

    await expect(lerJanelaDeRecebimentoDias()).resolves.toBe(200);
    expect(fromMock).toHaveBeenCalledWith("politica_devolucao");
  });

  it.each([
    ["o banco devolve erro", { data: null, error: { message: "caiu" } }],
    ["a linha não existe", { data: null, error: null }],
    [
      "a linha vem sem os prazos",
      { data: { aceita_troca: true }, error: null },
    ],
  ])("%s: usa 90", async (_nome, resposta) => {
    const { lerJanelaDeRecebimentoDias } = await import(
      "@/lib/janela-de-recebimento-da-loja"
    );
    maybeSingleMock.mockResolvedValue(resposta);

    await expect(lerJanelaDeRecebimentoDias()).resolves.toBe(90);
  });

  it("a consulta que lança (rede caiu) também usa 90 — e não derruba quem chamou", async () => {
    const { lerJanelaDeRecebimentoDias } = await import(
      "@/lib/janela-de-recebimento-da-loja"
    );
    maybeSingleMock.mockRejectedValue(new Error("rede"));

    await expect(lerJanelaDeRecebimentoDias()).resolves.toBe(90);
  });
});
