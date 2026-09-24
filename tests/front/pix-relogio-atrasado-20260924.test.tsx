// @vitest-environment jsdom
import { PagamentoOnline } from "@/components/checkout/PagamentoOnline";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
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
    document.head.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "TEST-000000-0000-0000-0000-000000000000");
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
    document.querySelectorAll("script[data-mp-sdk]").forEach((s) => s.remove());
    // @ts-expect-error cleanup of SDK stub
    globalThis.MercadoPago = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function mostrarPix() {
    const create = vi.fn().mockResolvedValue({ unmount: vi.fn() });
    // @ts-expect-error Mercado Pago SDK stub
    globalThis.MercadoPago = function Stub() {
      return { bricks: () => ({ create }) };
    };
    await act(async () => {
      root.render(
        <PagamentoOnline
          orderId="a1b2c3d4-e5f6-4000-8000-000000000001"
          valor={129.9}
          onErro={vi.fn()}
        />,
      );
    });
    document.querySelector("script[data-mp-sdk]")?.dispatchEvent(new Event("load"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const { onSubmit } = create.mock.calls[0][2].callbacks;
    await act(async () => onSubmit({ formData: {} }));
  }

  it("não promete minutos restantes quando o aparelho pode estar atrasado", async () => {
    // A resposta não inclui a hora do servidor: às 15:35 reais, o celular
    // atrasado 40 minutos marca 14:55 e o Pix já venceu.
    vi.setSystemTime(new Date("2026-09-24T14:55:00.000Z"));
    await mostrarPix();
    expect(host.textContent).toContain("Prazo informado: até");
    expect(host.textContent).toContain("Confira a validade no app do seu banco.");
    expect(host.textContent).not.toMatch(/Faltam \d/);
    expect(host.querySelector("img[alt='QR code do PIX']")).not.toBeNull();
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("retira aviso local quando o próprio aparelho corrige o horário", async () => {
    vi.setSystemTime(new Date("2026-09-24T16:00:00.000Z"));
    await mostrarPix();
    expect(host.textContent).toContain("O horário previsto para pagar já passou.");
    vi.setSystemTime(new Date("2026-09-24T15:20:00.000Z"));
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(host.textContent).not.toContain("O horário previsto para pagar já passou.");
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
    const hora = new Date("2026-09-24T15:30:00.123Z").toLocaleTimeString("pt-BR", {
      hour: "2-digit", minute: "2-digit",
    });
    expect(host.textContent).toContain(`Prazo informado: até ${hora}`);
    expect(host.textContent).not.toContain("Não conseguimos ler o prazo");
  });
});
