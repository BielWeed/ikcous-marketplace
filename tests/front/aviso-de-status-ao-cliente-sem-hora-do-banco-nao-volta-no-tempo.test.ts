// Lote 553: o aviso de status à cliente carimba a ordem (`data.emitidoEm`)
// com a hora em que o BANCO gravou a mudança; sem ela (a leitura curta do
// cancelamento pela edge falhou ou pendurou) caía no relógio do aparelho da
// lojista. O celular da cliente guarda só o aviso de carimbo MAIOR
// (`avisoMaisNovoQue`): com o relógio da lojista ATRASADO, o "Cancelado" sem
// hora do banco saía com carimbo MENOR que o "Em trânsito" (que saiu com a
// hora do banco) e era descartado — a cliente continuava vendo "Em trânsito".
//
// Agora, sem a hora do banco, o carimbo nunca fica abaixo do que já se sabe
// do pedido: o último aviso que este aparelho emitiu e o `updatedAt` do
// pedido na tela (a última gravação que a tela conhece), +1 ms. Com a hora do
// banco, ela continua valendo sozinha. Cada teste usa um pedido próprio: a
// memória do último aviso é por pedido.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    functions: { invoke },
  },
}));
vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { avisarOClienteDoStatus } from "@/lib/aviso-de-status-ao-cliente";
import {
  avisoMaisNovoQue,
  carimboDoAviso,
} from "@/lib/ordem-do-aviso-do-pedido";

const ALVO = { userId: "cliente-1", retiradaNaLoja: false };
/** Hora em que o banco gravou o "Em trânsito". */
const HORA_DO_TRANSITO = "2026-11-27T12:00:00.000Z";
/** O relógio da lojista: 2 min ATRASADO em relação ao banco. */
const RELOGIO_ATRASADO = Date.parse("2026-11-27T11:58:30.000Z");

function dataDoUltimoAviso(): Record<string, unknown> {
  const chamadas = invoke.mock.calls.filter(([nome]) => nome === "send-push");
  const [, opcoes] = chamadas[chamadas.length - 1] as [
    string,
    { body: { data: Record<string, unknown> } },
  ];
  return opcoes.body.data;
}

describe("aviso sem a hora do banco não volta no tempo", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    invoke.mockReset();
    invoke.mockResolvedValue({ data: { enviados: 1, total: 1 }, error: null });
  });

  it("relógio atrasado: 'Cancelado' sem hora do banco não perde para o 'Em trânsito' que saiu com ela", async () => {
    const pedido = "pedido-relogio-atrasado";
    vi.spyOn(Date, "now").mockReturnValue(RELOGIO_ATRASADO);
    await avisarOClienteDoStatus(pedido, "shipping", ALVO, HORA_DO_TRANSITO);
    const transito = { data: dataDoUltimoAviso() };

    // A leitura da hora do cancelamento falhou: sem hora do banco.
    await avisarOClienteDoStatus(pedido, "cancelled", ALVO, null);
    const cancelado = { data: dataDoUltimoAviso() };

    const carimboDoCancelado = carimboDoAviso(cancelado.data) as number;
    expect(carimboDoCancelado).toBeGreaterThan(Date.parse(HORA_DO_TRANSITO));
    // O celular da cliente: nada na bandeja é mais novo que o "Cancelado"...
    expect(avisoMaisNovoQue(carimboDoCancelado, [transito])).toBeNull();
    // ...e o "Em trânsito" atrasado na rede não passa por cima dele.
    expect(
      avisoMaisNovoQue(carimboDoAviso(transito.data) as number, [cancelado]),
    ).toBe(cancelado);
  });

  it("o aviso anterior saiu de OUTRO aparelho: o updatedAt do pedido na tela segura a ordem", async () => {
    const pedido = "pedido-outro-aparelho";
    vi.spyOn(Date, "now").mockReturnValue(RELOGIO_ATRASADO);

    await avisarOClienteDoStatus(
      pedido,
      "cancelled",
      { ...ALVO, updatedAt: HORA_DO_TRANSITO },
      null,
    );

    expect(dataDoUltimoAviso().emitidoEm).toBe(
      Date.parse(HORA_DO_TRANSITO) + 1,
    );
  });

  it("controle: relógio certo (depois de tudo que se conhece) segue sendo o carimbo", async () => {
    const pedido = "pedido-relogio-certo";
    const agora = Date.parse("2026-11-27T12:05:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(agora);
    await avisarOClienteDoStatus(pedido, "shipping", ALVO, HORA_DO_TRANSITO);

    await avisarOClienteDoStatus(
      pedido,
      "cancelled",
      { ...ALVO, updatedAt: HORA_DO_TRANSITO },
      null,
    );

    expect(dataDoUltimoAviso().emitidoEm).toBe(agora);
  });

  it("controle: com a hora do banco, ela vale sozinha — mesmo abaixo do que se conhece", async () => {
    const pedido = "pedido-com-hora-do-banco";
    vi.spyOn(Date, "now").mockReturnValue(RELOGIO_ATRASADO);

    await avisarOClienteDoStatus(
      pedido,
      "shipping",
      { ...ALVO, updatedAt: "2026-11-27T12:10:00.000Z" },
      HORA_DO_TRANSITO,
    );

    expect(dataDoUltimoAviso().emitidoEm).toBe(Date.parse(HORA_DO_TRANSITO));
  });

  it("borda: updatedAt ilegível não vira NaN nem piso", async () => {
    const pedido = "pedido-updated-at-ilegivel";
    vi.spyOn(Date, "now").mockReturnValue(RELOGIO_ATRASADO);

    await avisarOClienteDoStatus(
      pedido,
      "cancelled",
      { ...ALVO, updatedAt: "não é data" },
      null,
    );

    expect(dataDoUltimoAviso().emitidoEm).toBe(RELOGIO_ATRASADO);
  });

  it("a hora do banco que CHEGA DEPOIS (promessa) é esperada e vale", async () => {
    const pedido = "pedido-hora-que-chega-depois";
    vi.spyOn(Date, "now").mockReturnValue(RELOGIO_ATRASADO);
    let entregar: (hora: string | null) => void = () => {};
    const horaQueChega = new Promise<string | null>((resolver) => {
      entregar = resolver;
    });

    const enviando = avisarOClienteDoStatus(
      pedido,
      "cancelled",
      ALVO,
      horaQueChega,
    );
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();
    entregar("2026-11-27T12:03:00.000Z");
    await enviando;

    expect(dataDoUltimoAviso().emitidoEm).toBe(
      Date.parse("2026-11-27T12:03:00.000Z"),
    );
  });

  it("borda: a promessa entrega null — cai no relógio com o piso do que se conhece", async () => {
    const pedido = "pedido-promessa-vazia";
    vi.spyOn(Date, "now").mockReturnValue(RELOGIO_ATRASADO);
    await avisarOClienteDoStatus(pedido, "shipping", ALVO, HORA_DO_TRANSITO);

    await avisarOClienteDoStatus(
      pedido,
      "cancelled",
      ALVO,
      Promise.resolve(null),
    );

    expect(dataDoUltimoAviso().emitidoEm).toBe(
      Date.parse(HORA_DO_TRANSITO) + 1,
    );
  });
});
