// @vitest-environment jsdom
//
// Tela do pedido cancelado e estornado, rede "pendurada" (conecta e não
// responde): a leitura de `order_refunds` não tinha prazo, então
// "Conferindo sua devolução…" ficava na tela para sempre e nunca chegava a
// "o dinheiro volta sozinho" / "fale com a loja". Aqui o estouro conta como
// falha (entra na contagem de tentativas) e a leitura é refeita quando a
// conexão volta. Só a rede é dublada; o hook é o de verdade.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDevolucaoDoPedidoCliente } from "@/hooks/useDevolucaoDoPedidoCliente";

type Resposta = { data: unknown; error: unknown };

const { ler } = vi.hoisted(() => ({ ler: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.order = () => ler();
      return b;
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NUNCA = () => new Promise<Resposta>(() => {});
const LINHA = {
  amount: 50,
  status: "solicitado",
  solicitado_por: "lojista",
  concluido_em: null,
};

type Leitura = ReturnType<typeof useDevolucaoDoPedidoCliente>;
let raiz: Root;
let hospedeiro: HTMLDivElement;
let leitura: Leitura;

function Sonda() {
  leitura = useDevolucaoDoPedidoCliente("pedido-1", true);
  return null;
}
async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  vi.clearAllMocks();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

describe("devolução do pedido (cliente) com rede conectada e sem resposta", () => {
  it("a primeira leitura pendurada deixa de girar e vira erro", async () => {
    ler.mockImplementation(NUNCA);
    await act(async () => raiz.render(<Sonda />));
    expect(leitura.carregando).toBe(true);
    expect(leitura.erro).toBe(false);

    await avancar(12_000);

    expect(leitura.carregando).toBe(false);
    expect(leitura.erro).toBe(true);
    expect(leitura.lido).toBe(false);
  });

  it("o estouro entra na contagem de tentativas e a tela chega a 'não consegui saber'", async () => {
    ler.mockImplementation(NUNCA);
    await act(async () => raiz.render(<Sonda />));

    // 3 tentativas: cada uma estoura em 12 s e a próxima começa 4 s depois.
    await avancar(12_000);
    expect(leitura.desistiu).toBe(false);
    await avancar(4_000 + 12_000);
    expect(leitura.desistiu).toBe(false);
    await avancar(4_000 + 12_000);

    expect(leitura.desistiu).toBe(true);
    expect(leitura.lido).toBe(false);
    expect(ler).toHaveBeenCalledTimes(3);
  });

  it("a resposta que chega depois do prazo não pinta a tela", async () => {
    let resolver!: (r: Resposta) => void;
    ler.mockImplementationOnce(
      () => new Promise<Resposta>((resolve) => (resolver = resolve)),
    );
    ler.mockImplementation(NUNCA);
    await act(async () => raiz.render(<Sonda />));
    await avancar(12_000);
    expect(leitura.erro).toBe(true);

    await act(async () => resolver({ data: [LINHA], error: null }));

    expect(leitura.linhas).toHaveLength(0);
    expect(leitura.lido).toBe(false);
  });

  it("depois de desistir, a conexão que volta refaz a leitura", async () => {
    ler.mockImplementation(NUNCA);
    await act(async () => raiz.render(<Sonda />));
    await avancar(12_000 + 4_000 + 12_000 + 4_000 + 12_000);
    expect(leitura.desistiu).toBe(true);

    ler.mockResolvedValue({ data: [LINHA], error: null });
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    expect(leitura.lido).toBe(true);
    expect(leitura.desistiu).toBe(false);
    expect(leitura.erro).toBe(false);
    expect(leitura.linhas).toHaveLength(1);
  });

  it("voltar para a aba também refaz a leitura", async () => {
    ler.mockImplementation(NUNCA);
    await act(async () => raiz.render(<Sonda />));
    await avancar(12_000 + 4_000 + 12_000 + 4_000 + 12_000);
    expect(leitura.desistiu).toBe(true);

    ler.mockResolvedValue({ data: [LINHA], error: null });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(leitura.lido).toBe(true);
    expect(leitura.linhas).toHaveLength(1);
  });

  it("a leitura que responde dentro do prazo continua valendo", async () => {
    ler.mockResolvedValue({ data: [LINHA], error: null });
    await act(async () => raiz.render(<Sonda />));
    await avancar(0);

    expect(leitura.lido).toBe(true);
    expect(leitura.erro).toBe(false);
    expect(leitura.linhas).toHaveLength(1);
  });
});
