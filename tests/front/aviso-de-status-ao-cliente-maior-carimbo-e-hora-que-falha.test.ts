// Lote 567: dois buracos de mutação em `avisarOClienteDoStatus`.
//
// 1. A memória do último carimbo do pedido guarda o MAIOR já emitido, não o
//    do último aviso: um aviso com a hora do banco ABAIXO do relógio do
//    aviso anterior não pode baixar o piso do próximo aviso sem ela — senão
//    o terceiro aviso sai mais "velho" que o primeiro e o celular da
//    cliente o descarta.
// 2. A hora do banco que chega como promessa e FALHA vira "sem hora do
//    banco": o aviso nunca lança (a ficha do pedido não espera nem quebra
//    por isso) e cai no relógio local.
//
// Relógio falso por `Date.now`; cada teste usa um pedido próprio, porque a
// memória do último carimbo é por pedido e vive no módulo.
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

import { avisarOClienteDoStatus } from "@/lib/aviso-de-status-ao-cliente";

const ALVO = { userId: "cliente-1", retiradaNaLoja: false };

function carimboDoUltimoAviso(): unknown {
  const chamadas = invoke.mock.calls.filter(([nome]) => nome === "send-push");
  const [, opcoes] = chamadas[chamadas.length - 1] as [
    string,
    { body: { data: Record<string, unknown> } },
  ];
  return opcoes.body.data.emitidoEm;
}

describe("aviso de status: maior carimbo e hora do banco que falha", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({ data: { enviados: 1, total: 1 }, error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("aviso com hora do banco ABAIXO do anterior não baixa o piso do próximo", async () => {
    const pedido = "pedido-maior-carimbo";
    const relogio = vi.spyOn(Date, "now");

    // Aviso 1: sem hora do banco, relógio em 2000.
    relogio.mockReturnValue(2000);
    await avisarOClienteDoStatus(pedido, "processing", ALVO, null);
    expect(carimboDoUltimoAviso()).toBe(2000);

    // Aviso 2: com a hora do banco (1500), que vale sozinha.
    await avisarOClienteDoStatus(
      pedido,
      "shipping",
      ALVO,
      new Date(1500).toISOString(),
    );
    expect(carimboDoUltimoAviso()).toBe(1500);

    // Aviso 3: sem hora do banco, relógio voltou a 1000. O piso é o MAIOR
    // carimbo já emitido (2000), não o do último aviso (1500).
    relogio.mockReturnValue(1000);
    await avisarOClienteDoStatus(pedido, "delivered", ALVO, null);
    expect(carimboDoUltimoAviso()).toBe(2001);
  });

  it("hora do banco que chega como promessa e falha: não lança e cai no relógio", async () => {
    const pedido = "pedido-hora-que-falha";
    vi.spyOn(Date, "now").mockReturnValue(1000);

    await expect(
      avisarOClienteDoStatus(
        pedido,
        "cancelled",
        ALVO,
        Promise.reject(new Error("leitura da hora falhou")),
      ),
    ).resolves.toBeUndefined();

    expect(invoke).toHaveBeenCalledWith("send-push", expect.anything());
    expect(carimboDoUltimoAviso()).toBe(1000);
  });
});
