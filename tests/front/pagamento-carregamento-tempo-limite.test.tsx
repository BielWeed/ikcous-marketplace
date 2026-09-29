// @vitest-environment jsdom
//
// Os dois "loadings" da tela de pagamento dependiam de promessas SEM tempo
// limite — `supabase.functions.invoke` (PIX) e o script do SDK do Mercado
// Pago (cartão). Rede presa = spinner infinito ("Gerando o QR code do
// Pix…" / "Carregando o formulário do cartão...") sem erro e sem saída.
//
// O tempo limite é provado nos dois caminhos, com o desfecho que cada um já
// tem de contrato: erro RECUPERÁVEL no PIX (a retentativa converge — a edge
// reconsulta a mesma cobrança em vez de duplicar), `onFalhaDeMontagem` no
// cartão (nenhum POST de cartão existiu — `semCobranca`, "Pagar com PIX"
// oferecido pelo CheckoutView).
//
// Os prazos são testados por FAIXA (10s = dentro; +90s = fora) e não por
// igualdade, para o teste prender o COMPORTAMENTO sem soldar o valor exato
// que a implementação escolher.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RespostaCriarPagamento } from "@/hooks/useOrders";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

const { criarPagamento } = vi.hoisted(() => ({ criarPagamento: vi.fn() }));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ criarPagamento }),
}));

const CONFIG_DO_CARTAO = { credito: true, debito: false, parcelasMax: 12 };

function respostaPixOk(): RespostaCriarPagamento {
  return {
    paymentId: "pay-1",
    statusPagamento: "aguardando",
    expiraEm: "2026-09-25T12:00:00.000Z",
    qrCode: "000201...",
    qrCodeBase64: "abc123",
  };
}

// `promessaSdk` (SDK) e `promessasPagamentoPix` (cache por pedido) moram em
// módulo — cada teste reimporta do zero para não herdar estado do anterior
// (mesmo padrão de pagamento-online.test.tsx). Os tipos dos módulos ficam
// por conta da inferência do `await import(...)` — `typeof import(...)`
// quebrado em várias linhas pelo formatter não é parseável pelo esbuild do
// vite (armadilha já documentada em pagamento-online.test.tsx).
async function importarLimpo() {
  vi.resetModules();
  const pagamentoOnline = await import("@/components/checkout/PagamentoOnline");
  const pagamentoComCartao = await import(
    "@/components/checkout/PagamentoComCartao"
  );
  return { pagamentoOnline, pagamentoComCartao };
}

/** Dublê do SDK — mesmo formato de pagamento-com-cartao.test.tsx. */
function instalarSdkFalso() {
  const create = vi.fn(async () => ({ unmount: vi.fn() }));
  // @ts-expect-error stub do SDK
  globalThis.MercadoPago = vi.fn(function MercadoPagoStub() {
    return { bricks: () => ({ create }) };
  });
  return { create };
}

afterEach(() => {
  vi.useRealTimers();
  document.head.innerHTML = "";
  // @ts-expect-error limpando o global entre testes
  globalThis.MercadoPago = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("dispararPagamentoPix — a criação da cobrança tem tempo limite", () => {
  it("criarPagamento que nunca responde vira erro RECUPERÁVEL no prazo — nunca spinner infinito", async () => {
    vi.useFakeTimers();
    const { pagamentoOnline } = await importarLimpo();
    const onErro = vi.fn();
    const onPix = vi.fn();
    const criarPagamentoDuble = vi.fn(
      () => new Promise<RespostaCriarPagamento>(() => {}),
    ); // pendura

    pagamentoOnline.dispararPagamentoPix({
      orderId: "ped-1",
      criarPagamento: criarPagamentoDuble,
      onErro,
      onPix,
    });

    // Dentro do prazo: o spinner continua sendo a tela certa, nada dispara.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onErro).not.toHaveBeenCalled();

    // Passado o prazo: erro recuperável — o CheckoutView oferece
    // "Tentar de novo" em vez de rodar o QR infinito.
    await vi.advanceTimersByTimeAsync(90_000);
    expect(onErro).toHaveBeenCalledTimes(1);
    expect(onErro.mock.calls[0][1]).toBe("recuperavel");
    expect(String(onErro.mock.calls[0][0])).toMatch(/pix/i);
    expect(onPix).not.toHaveBeenCalled();
  });

  it("depois do tempo limite, 'Tentar de novo' dispara uma chamada NOVA — a promessa pendurada sai do cache do pedido", async () => {
    vi.useFakeTimers();
    const { pagamentoOnline } = await importarLimpo();
    const criarPagamentoDuble = vi.fn(
      () => new Promise<RespostaCriarPagamento>(() => {}),
    );
    const onErro = vi.fn();

    pagamentoOnline.dispararPagamentoPix({
      orderId: "ped-1",
      criarPagamento: criarPagamentoDuble,
      onErro,
      onPix: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(onErro).toHaveBeenCalledTimes(1);

    // "Tentar de novo" — remontagem do componente. SEM o descarte do cache,
    // a remontagem reusaria a MESMA promessa pendurada (o cache só sai na
    // assentação, que nunca chega) e o spinner voltaria para sempre.
    const onPix2 = vi.fn();
    criarPagamentoDuble.mockResolvedValueOnce(respostaPixOk());
    pagamentoOnline.dispararPagamentoPix({
      orderId: "ped-1",
      criarPagamento: criarPagamentoDuble,
      onErro,
      onPix: onPix2,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(criarPagamentoDuble).toHaveBeenCalledTimes(2);
    expect(onPix2).toHaveBeenCalledTimes(1);
    expect(onPix2.mock.calls[0][0].qrCode).toBe("000201...");
  });

  it("resposta dentro do prazo: QR normal e NENHUM erro de tempo limite depois", async () => {
    vi.useFakeTimers();
    const { pagamentoOnline } = await importarLimpo();
    const onErro = vi.fn();
    const onPix = vi.fn();
    const criarPagamentoDuble = vi.fn().mockResolvedValue(respostaPixOk());

    pagamentoOnline.dispararPagamentoPix({
      orderId: "ped-1",
      criarPagamento: criarPagamentoDuble,
      onErro,
      onPix,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(onPix).toHaveBeenCalledTimes(1);

    // O timer do prazo morre com a resposta — passar do prazo não inventa
    // erro sobre uma cobrança que já entregou o QR.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(onErro).not.toHaveBeenCalled();
  });
});

describe("montarBrickDeCartao — o carregamento do SDK tem tempo limite", () => {
  it("SDK que nunca carrega dispara onFalhaDeMontagem no prazo — nunca 'Carregando o formulário…' infinito", async () => {
    vi.stubEnv(
      "VITE_MP_PUBLIC_KEY",
      "TEST-00000000-0000-0000-0000-000000000000",
    );
    vi.useFakeTimers();
    const { pagamentoComCartao } = await importarLimpo();
    const onFalhaDeMontagem = vi.fn();
    const onPronto = vi.fn();

    const limpar = pagamentoComCartao.montarBrickDeCartao({
      containerId: "mp-cartao-x",
      valor: 100,
      config: CONFIG_DO_CARTAO,
      onEnviar: vi.fn(),
      onFalhaDeMontagem,
      onPronto,
    });

    // Dentro do prazo: a tela de carga continua sendo a certa.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onFalhaDeMontagem).not.toHaveBeenCalled();

    // Passado o prazo: a falha de montagem é o caminho que o componente já
    // tem para SDK que não carrega — CheckoutView mostra o erro com
    // "Pagar com PIX" (nenhum POST existiu).
    await vi.advanceTimersByTimeAsync(90_000);
    expect(onFalhaDeMontagem).toHaveBeenCalledTimes(1);
    expect(onPronto).not.toHaveBeenCalled();

    limpar();
  });

  it("SDK que carrega dentro do prazo monta o Brick e NUNCA dispara a falha", async () => {
    vi.stubEnv(
      "VITE_MP_PUBLIC_KEY",
      "TEST-00000000-0000-0000-0000-000000000000",
    );
    vi.useFakeTimers();
    const { pagamentoComCartao } = await importarLimpo();
    instalarSdkFalso();
    const onFalhaDeMontagem = vi.fn();
    const onPronto = vi.fn();

    const limpar = pagamentoComCartao.montarBrickDeCartao({
      containerId: "mp-cartao-x",
      valor: 100,
      config: CONFIG_DO_CARTAO,
      onEnviar: vi.fn(),
      onFalhaDeMontagem,
      onPronto,
    });

    // O script "carrega":
    document
      .querySelector("script[data-mp-sdk]")!
      .dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(0);

    // Passar do prazo não inventa falha — o timer morreu com o load.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(onFalhaDeMontagem).not.toHaveBeenCalled();

    limpar();
  });
});
