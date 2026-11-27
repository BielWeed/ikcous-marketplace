// Lote 502: o carimbo de ordem do aviso de status (`data.emitidoEm`) era o
// relógio do aparelho da LOJISTA (`Date.now()`). O service worker da cliente
// mantém na bandeja o aviso de carimbo MAIOR (`ordem-do-aviso-do-pedido.ts`):
// com o PC da loja 1 min adiantado e o celular certo, "Retirado" (marcado no
// celular) perdia para "Pronto para retirar" (marcado no PC) e nunca aparecia.
//
// Agora o carimbo é a hora em que o BANCO gravou a mudança (`updated_at` da
// linha que a RPC devolve), o mesmo relógio para todos os aparelhos. Só sem
// ela (resposta antiga, gravação confirmada por releitura) cai no relógio
// local, como antes. O campo do payload continua o MESMO número em
// milissegundos: o service worker já instalado nas clientes entende.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  avisarOClienteDoStatus,
  horaGravadaNoBanco,
} from "@/lib/aviso-de-status-ao-cliente";
import {
  avisoMaisNovoQue,
  carimboDoAviso,
} from "@/lib/ordem-do-aviso-do-pedido";

const PEDIDO = "0b7c2a4e-1111-4222-8333-9a8b7c6d5e4f";
const ALVO = { userId: "cliente-1", retiradaNaLoja: true };

function dataDoUltimoAviso(): Record<string, unknown> {
  const chamadas = invoke.mock.calls.filter(([nome]) => nome === "send-push");
  const [, opcoes] = chamadas[chamadas.length - 1] as [
    string,
    { body: { data: Record<string, unknown> } },
  ];
  return opcoes.body.data;
}

describe("aviso de status à cliente — carimbo é a hora do banco, não do aparelho", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({ data: { enviados: 1, total: 1 }, error: null });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("com a hora gravada no banco, o carimbo é ela — mesmo com o relógio do aparelho adiantado", async () => {
    vi.spyOn(Date, "now").mockReturnValue(
      Date.parse("2026-11-27T12:01:00.000Z"),
    );
    await avisarOClienteDoStatus(
      PEDIDO,
      "shipping",
      ALVO,
      "2026-11-27T12:00:00.123456+00:00",
    );
    expect(dataDoUltimoAviso()).toEqual({
      orderId: PEDIDO,
      type: "order_status",
      emitidoEm: Date.parse("2026-11-27T12:00:00.123456+00:00"),
    });
  });

  it("PC da loja 1 min adiantado e celular certo: 'Retirado' (depois) ganha de 'Pronto' (antes) na bandeja", async () => {
    // Pronto para retirar, marcado no PC adiantado.
    vi.spyOn(Date, "now").mockReturnValue(
      Date.parse("2026-11-27T12:01:00.000Z"),
    );
    await avisarOClienteDoStatus(
      PEDIDO,
      "shipping",
      ALVO,
      "2026-11-27T12:00:00.000Z",
    );
    const pronto = { data: dataDoUltimoAviso() };
    // Retirado, marcado 20 s depois no celular de relógio certo.
    vi.spyOn(Date, "now").mockReturnValue(
      Date.parse("2026-11-27T12:00:20.000Z"),
    );
    await avisarOClienteDoStatus(
      PEDIDO,
      "delivered",
      ALVO,
      "2026-11-27T12:00:20.000Z",
    );
    const retirado = { data: dataDoUltimoAviso() };

    const carimboDoRetirado = carimboDoAviso(retirado.data);
    expect(carimboDoRetirado).not.toBeNull();
    // O service worker: há na bandeja algum aviso MAIS NOVO que o que chegou?
    expect(avisoMaisNovoQue(carimboDoRetirado as number, [pronto])).toBeNull();
    // E o inverso: o "Pronto" atrasado não passa por cima do "Retirado".
    expect(
      avisoMaisNovoQue(carimboDoAviso(pronto.data) as number, [retirado]),
    ).toBe(retirado);
  });

  it("sem a hora do banco (undefined, null), cai no relógio local, como antes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_780_000_000_000);
    await avisarOClienteDoStatus(PEDIDO, "shipping", ALVO);
    expect(dataDoUltimoAviso().emitidoEm).toBe(1_780_000_000_000);
    await avisarOClienteDoStatus(PEDIDO, "shipping", ALVO, null);
    expect(dataDoUltimoAviso().emitidoEm).toBe(1_780_000_000_000);
  });

  it("hora do banco ilegível ou vazia também cai no relógio local (nunca manda NaN)", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_780_000_000_000);
    await avisarOClienteDoStatus(PEDIDO, "shipping", ALVO, "não é data");
    expect(dataDoUltimoAviso().emitidoEm).toBe(1_780_000_000_000);
    await avisarOClienteDoStatus(PEDIDO, "shipping", ALVO, "");
    expect(dataDoUltimoAviso().emitidoEm).toBe(1_780_000_000_000);
  });
});

describe("horaGravadaNoBanco — o updated_at da linha que a gravação devolveu", () => {
  it("lê o updated_at da linha", () => {
    expect(
      horaGravadaNoBanco({ id: "p", updated_at: "2026-11-27T12:00:00Z" }),
    ).toBe("2026-11-27T12:00:00Z");
  });

  it("resposta sem linha, que não é objeto, lista, ou sem o campo em texto: null", () => {
    expect(horaGravadaNoBanco(null)).toBeNull();
    expect(horaGravadaNoBanco(undefined)).toBeNull();
    expect(horaGravadaNoBanco("2026-11-27T12:00:00Z")).toBeNull();
    expect(
      horaGravadaNoBanco([{ updated_at: "2026-11-27T12:00:00Z" }]),
    ).toBeNull();
    expect(horaGravadaNoBanco({ id: "p" })).toBeNull();
    expect(horaGravadaNoBanco({ updated_at: 1_780_000_000_000 })).toBeNull();
    expect(horaGravadaNoBanco({ updated_at: "" })).toBeNull();
  });
});
