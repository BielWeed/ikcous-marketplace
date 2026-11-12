// @vitest-environment jsdom
import { expect, it, vi } from "vitest";

// Mesmo isolamento do teste vizinho: nenhuma chamada ao Supabase real.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ criarPagamento: vi.fn() }),
}));

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function respostaPixOk() {
  return {
    paymentId: "pay-b",
    statusPagamento: "aguardando",
    expiraEm: "2026-11-11T12:00:00.000Z",
    qrCode: "000201-pix-b",
    qrCodeBase64: "abc123",
  };
}

function promessaControlada<T>() {
  let resolver!: (valor: T) => void;
  let rejeitar!: (erro: Error) => void;
  const promessa = new Promise<T>((resolve, reject) => {
    resolver = resolve;
    rejeitar = reject;
  });
  return { promessa, resolver, rejeitar };
}

it("erro terminal atrasado do PIX abandonado não chama onErro nem contamina o PIX novo", async () => {
  vi.resetModules();
  const { dispararPagamentoPix } = await import(
    "@/components/checkout/PagamentoOnline"
  );
  const tentativaA = promessaControlada<ReturnType<typeof respostaPixOk>>();
  const tentativaB = promessaControlada<ReturnType<typeof respostaPixOk>>();
  const criarPagamento = vi
    .fn()
    .mockReturnValueOnce(tentativaA.promessa)
    .mockReturnValueOnce(tentativaB.promessa);
  const onErroA = vi.fn();
  const onPixA = vi.fn();
  const onErroB = vi.fn();
  const onPixB = vi.fn();

  const cleanupA = dispararPagamentoPix({
    orderId: "ped-a",
    criarPagamento,
    onErro: onErroA,
    onPix: onPixA,
  });
  cleanupA(); // Abandona A ANTES de sua promessa rejeitar.

  // Outro pedido evita compartilhar a promessa em cache do StrictMode:
  // B é uma criação independente e permanece pendente enquanto A falha.
  const cleanupB = dispararPagamentoPix({
    orderId: "ped-b",
    criarPagamento,
    onErro: onErroB,
    onPix: onPixB,
  });

  try {
    expect(criarPagamento.mock.calls).toEqual([
      [{ orderId: "ped-a", metodo: "pix" }],
      [{ orderId: "ped-b", metodo: "pix" }],
    ]);
    tentativaA.rejeitar(
      Object.assign(
        new Error(
          "Este pagamento foi recusado e não pode ser tentado novamente neste pedido. Faça um pedido novo ou fale com a loja.",
        ),
        { terminal: true },
      ),
    );
    await esperarMicrotarefas();

    expect(onErroA).not.toHaveBeenCalled();
    expect(onPixA).not.toHaveBeenCalled();
    expect(onErroB).not.toHaveBeenCalled();
    expect(onPixB).not.toHaveBeenCalled();

    tentativaB.resolver(respostaPixOk());
    await esperarMicrotarefas();

    expect(onPixB).toHaveBeenCalledExactlyOnceWith({
      qrCodeBase64: "abc123",
      qrCode: "000201-pix-b",
      expiraEm: "2026-11-11T12:00:00.000Z",
    });
    expect(onErroA).not.toHaveBeenCalled();
    expect(onErroB).not.toHaveBeenCalled();
    expect(onPixA).not.toHaveBeenCalled();
  } finally {
    cleanupB();
    // Assenta B mesmo no mutante, para não deixar o timeout local pendurado.
    tentativaB.resolver(respostaPixOk());
    await esperarMicrotarefas();
  }
});
