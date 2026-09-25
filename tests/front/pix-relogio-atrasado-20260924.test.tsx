// @vitest-environment jsdom
import { PagamentoOnline } from "@/components/checkout/PagamentoOnline";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));
const { criarPagamento } = vi.hoisted(() => ({ criarPagamento: vi.fn() }));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ criarPagamento }),
}));

// @ts-expect-error React act flag is internal
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Pix quando o relógio do celular está errado", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    criarPagamento.mockReset().mockResolvedValue({
      paymentId: "pay-test",
      statusPagamento: "aguardando",
      expiraEm: "2026-09-24T15:30:00.123456+00:00",
      qrCode: "codigo-pix-de-teste",
      qrCodeBase64: "abc123",
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /**
   * Monta o componente de verdade e espera a resposta de `criarPagamento` —
   * disparada DIRETO ao montar desde 25/09/2026 (PIX sem Brick). O
   * `setTimeout(resolve, 0)` continua real (fora do `toFake` do
   * `beforeEach`, que só cobre Date/setInterval/clearInterval), então drena
   * a promessa normalmente mesmo com o relógio congelado.
   */
  async function mostrarPix() {
    await act(async () => {
      root.render(
        <PagamentoOnline
          orderId="a1b2c3d4-e5f6-4000-8000-000000000001"
          valor={129.9}
          onErro={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("não promete minutos restantes quando o aparelho pode estar atrasado", async () => {
    // A resposta não inclui a hora do servidor: às 15:35 reais, o celular
    // atrasado 40 minutos marca 14:55 e o Pix já venceu.
    vi.setSystemTime(new Date("2026-09-24T14:55:00.000Z"));
    await mostrarPix();
    expect(host.textContent).toContain("Prazo informado: até");
    expect(host.textContent).toContain(
      "Confira a validade no app do seu banco.",
    );
    expect(host.textContent).not.toMatch(/Faltam \d/);
    expect(host.querySelector("img[alt='QR code do PIX']")).not.toBeNull();
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("retira aviso local quando o próprio aparelho corrige o horário", async () => {
    vi.setSystemTime(new Date("2026-09-24T16:00:00.000Z"));
    await mostrarPix();
    expect(host.textContent).toContain(
      "O horário previsto para pagar já passou.",
    );
    vi.setSystemTime(new Date("2026-09-24T15:20:00.000Z"));
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(host.textContent).not.toContain(
      "O horário previsto para pagar já passou.",
    );
    expect(host.querySelector("img[alt='QR code do PIX']")).not.toBeNull();
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it.each([
    "2026-09-24T15:30:00.1Z",
    "2026-09-24T15:30:00.12+00:00",
    "2026-09-24T15:30:00.123456+00:00",
  ])("lê fração %s do banco em parser estrito", async (expiraEm) => {
    const parser = Date.parse;
    vi.spyOn(Date, "parse").mockImplementation((value) => {
      const fracao = value.match(/\.(\d+)(?=Z$|[+-]\d{2}:\d{2}$)/i)?.[1];
      return fracao && fracao.length !== 3 ? Number.NaN : parser(value);
    });
    criarPagamento.mockResolvedValue({
      paymentId: "pay-test",
      statusPagamento: "aguardando",
      expiraEm,
      qrCode: "codigo-pix-de-teste",
      qrCodeBase64: "abc123",
    });
    vi.setSystemTime(new Date("2026-09-24T15:20:00.000Z"));
    await mostrarPix();
    const hora = new Date("2026-09-24T15:30:00.123Z").toLocaleTimeString(
      "pt-BR",
      {
        hour: "2-digit",
        minute: "2-digit",
      },
    );
    expect(host.textContent).toContain(`Prazo informado: até ${hora}`);
    expect(host.textContent).not.toContain("Não conseguimos ler o prazo");
  });
});
