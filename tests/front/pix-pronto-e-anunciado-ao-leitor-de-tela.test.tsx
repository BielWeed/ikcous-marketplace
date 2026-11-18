// @vitest-environment jsdom
import { PagamentoOnline } from "@/components/checkout/PagamentoOnline";
import type { RespostaCriarPagamento } from "@/hooks/useOrders";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { criarPagamento } = vi.hoisted(() => ({ criarPagamento: vi.fn() }));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ criarPagamento }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));

// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let foco: HTMLButtonElement;
let resolver: (resposta: RespostaCriarPagamento) => void;

beforeEach(() => {
  criarPagamento.mockReset();
  criarPagamento.mockImplementation(
    () =>
      new Promise<RespostaCriarPagamento>((resolve) => {
        resolver = resolve;
      }),
  );
  foco = document.createElement("button");
  document.body.append(foco);
  foco.focus();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  foco.remove();
  vi.restoreAllMocks();
});

it("anuncia a geração e depois o Pix pronto na mesma região, sem mover foco nem repetir no render", async () => {
  const props = { orderId: "pix-anuncio-pronto", valor: 100, onErro: vi.fn() };
  await act(async () => root.render(<PagamentoOnline {...props} />));
  const gerando = Array.from(
    container.querySelectorAll('[role="status"]'),
  ).find((el) => el.textContent?.includes("Gerando o QR code do Pix"));
  expect(gerando).toBeDefined();
  expect(gerando?.getAttribute("aria-live")).toBe("polite");
  const regiao = container.querySelector('[aria-live="polite"].sr-only');
  expect(regiao).not.toBeNull();
  expect(regiao?.textContent).toBe("");

  await act(async () => {
    resolver({
      paymentId: "pix-anuncio-1",
      statusPagamento: "aguardando",
      expiraEm: "2099-11-17T23:59:00Z",
      qrCode: "000201-PIX-FICTICIO",
      qrCodeBase64: "abc123",
    });
  });
  expect(container.contains(regiao)).toBe(true);
  expect(regiao?.textContent).toBe("Pix pronto. Copie o código para pagar.");
  expect(document.activeElement).toBe(foco);
  const mudancas = vi.fn();
  const observador = new MutationObserver(mudancas);
  observador.observe(regiao!, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  await act(async () =>
    root.render(<PagamentoOnline {...props} valor={120} />),
  );
  expect(mudancas).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(foco);
  observador.disconnect();
});

it("não promete copiar quando a resposta só tem a imagem do QR", async () => {
  await act(async () =>
    root.render(
      <PagamentoOnline
        orderId="pix-anuncio-so-imagem"
        valor={100}
        onErro={vi.fn()}
      />,
    ),
  );
  const regiao = container.querySelector('[aria-live="polite"].sr-only');
  expect(regiao).not.toBeNull();
  await act(async () => {
    resolver({
      paymentId: "pix-anuncio-2",
      statusPagamento: "aguardando",
      expiraEm: "2099-11-17T23:59:00Z",
      qrCodeBase64: "abc123",
    });
  });
  expect(container.contains(regiao)).toBe(true);
  expect(regiao?.textContent).toBe("");
});
