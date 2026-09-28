// @vitest-environment jsdom
//
// PixDoBalcao isolado — os caminhos de borda do PIX com QR do balcão.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/copiar-para-clipboard", () => ({
  copiarParaClipboard: vi.fn(async () => true),
}));

import { PixDoBalcao } from "@/components/admin/pdv/PixDoBalcao";
import type { RespostaDoPixDoBalcao } from "@/lib/pix-do-balcao";

const AGORA = "2026-09-28T15:00:00.000Z";
function resp(
  extra: Partial<RespostaDoPixDoBalcao> = {},
): RespostaDoPixDoBalcao {
  return {
    situacao: "aguardando",
    total: 57,
    expiraEm: "2026-09-28T15:30:00.000Z",
    agoraServidor: AGORA,
    qrCode: "PIXCOPIA",
    qrCodeBase64: "AAAA",
    ...extra,
  };
}

let container: HTMLDivElement;
let root: Root;
const botao = (t: string) =>
  [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(t),
  ) as HTMLButtonElement | undefined;
const avancar = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

async function montar(props: Partial<Parameters<typeof PixDoBalcao>[0]> = {}) {
  const base = {
    numero: "ABC123",
    total: 57,
    cobrar: vi.fn(async () => resp()),
    consultar: vi.fn(async () => ({
      payment_status: "aguardando",
      status: "pending",
      expires_at: "2026-09-28T15:30:00.000Z",
    })),
    aoPago: vi.fn(),
    aoEncerrado: vi.fn(),
    aoDescartarCupom: vi.fn(),
    ...props,
  };
  await act(async () => {
    root.render(<PixDoBalcao {...base} />);
  });
  return base;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(AGORA));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("PixDoBalcao", () => {
  it("falha ao gerar mostra a frase da edge e 'Tentar de novo' gera outra vez", async () => {
    const cobrar = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("O PIX pelo app está indisponível nesta loja agora."),
      )
      .mockResolvedValue(resp());
    await montar({ cobrar });
    await avancar(1);
    expect(container.textContent).toContain("indisponível nesta loja");
    await act(async () => botao("Tentar de novo")?.click());
    await avancar(1);
    expect(container.textContent).toContain("Aguardando pagamento…");
    expect(cobrar).toHaveBeenCalledTimes(2);
  });

  it("ao zerar a contagem, UMA conferência decide: venceu → painel de vencido", async () => {
    const cobrar = vi.fn(async (acao: string) =>
      acao === "gerar"
        ? resp({ expiraEm: "2026-09-28T15:00:03.000Z" })
        : resp({ situacao: "expirado", qrCode: null, qrCodeBase64: null }),
    );
    await montar({ cobrar });
    await avancar(1);
    expect(container.textContent).toContain("Vence em 00:03");
    await avancar(4000);
    await avancar(1);
    expect(cobrar.mock.calls.filter(([a]) => a === "conferir")).toHaveLength(1);
    expect(container.textContent).toContain("venceu sem pagamento");
  });

  it("releitura vê pago_apos_expirar: não volta a cobrar — oferece limpar o cupom", async () => {
    const props = await montar({
      consultar: vi.fn(async () => ({
        payment_status: "pago_apos_expirar",
        status: "cancelled",
        expires_at: "2026-09-28T15:30:00.000Z",
      })),
    });
    await avancar(3100);
    expect(container.textContent).toContain("chegou DEPOIS do prazo");
    await act(async () => botao("limpar o cupom")?.click());
    expect(props.aoDescartarCupom).toHaveBeenCalledTimes(1);
    expect(props.aoEncerrado).not.toHaveBeenCalled();
  });

  it("'Cancelar' que descobre o PIX já pago segue como PAGO, nunca cancelado", async () => {
    const cobrar = vi.fn(async (acao: string) =>
      acao === "cancelar"
        ? resp({ situacao: "pago", jaEstavaPago: true })
        : resp(),
    );
    const props = await montar({ cobrar });
    await avancar(1);
    await act(async () => botao("Cancelar este PIX")?.click());
    await avancar(1);
    expect(props.aoPago).toHaveBeenCalledTimes(1);
    expect(props.aoEncerrado).not.toHaveBeenCalled();
  });

  it("'Conferir agora' sem pagamento avisa, e valor divergente pede para não entregar", async () => {
    const cobrar = vi
      .fn()
      .mockResolvedValueOnce(resp())
      .mockResolvedValueOnce(
        resp({ qrCode: undefined, qrCodeBase64: undefined }),
      )
      .mockResolvedValueOnce(resp({ valorDivergente: true }));
    const props = await montar({ cobrar });
    await avancar(1);
    await act(async () => botao("Conferir agora")?.click());
    await avancar(1);
    expect(container.textContent).toContain("Ainda não caiu");
    expect(container.querySelector("img")).not.toBeNull();
    await act(async () => botao("Conferir agora")?.click());
    await avancar(1);
    expect(container.textContent).toContain("Não entregue");
    expect(props.aoPago).not.toHaveBeenCalled();
  });

  it("cancelamento sem resposta do MP oferece a saída 'deixar vencer e limpar o cupom'", async () => {
    const cobrar = vi.fn(async (acao: string) => {
      if (acao === "cancelar")
        throw new Error(
          "Não consegui cancelar o PIX no Mercado Pago agora. Tente de novo.",
        );
      return resp();
    });
    const props = await montar({ cobrar });
    await avancar(1);
    expect(botao("Deixar este PIX vencer")).toBeUndefined();
    await act(async () => botao("Cancelar este PIX")?.click());
    await avancar(1);
    expect(container.textContent).toContain("Sem resposta do Mercado Pago");
    await act(async () => botao("Deixar este PIX vencer")?.click());
    expect(props.aoDescartarCupom).toHaveBeenCalledTimes(1);
    expect(props.aoEncerrado).not.toHaveBeenCalled();
  });
});
