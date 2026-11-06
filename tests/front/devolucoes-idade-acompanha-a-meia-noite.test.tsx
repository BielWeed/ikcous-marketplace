// @vitest-environment jsdom
//
// Devoluções: o painel fica aberto de um dia para o outro e o cartão da
// devolução pedida às 22h dizia "hoje" até alguém trocar de tela. Agora o "hoje"
// da lista acompanha o relógio (meia-noite de São Paulo) e o cartão passa a
// "há 1 dia" sozinho.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc, functions: { invoke: vi.fn() }, storage: { from: vi.fn() } },
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINHA = {
  id: "d-1",
  protocolo: "DV260926-ABCDE",
  order_id: "o-1",
  cliente_nome: "Maria",
  cliente_whatsapp: "34999999999",
  tipo: "arrependimento",
  motivo: "tamanho_pequeno",
  status: "solicitada",
  resolucao_desejada: "reembolso",
  metodo_retorno: "envio_proprio",
  modalidade: "nacional",
  valor_itens: 199.8,
  prazo_ate: "2026-10-01",
  created_at: "2026-09-27T01:00:00Z", // 22h de 26/09 em São Paulo
};

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-27T02:30:00Z")); // 23h30 de 26/09
  rpc.mockResolvedValue({
    data: { total: 1, contagem: { solicitada: 1 }, itens: [LINHA] },
    error: null,
  });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

async function drenar() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}

const cartao = () =>
  (
    hospedeiro.querySelector('[data-devolucao="d-1"]')?.textContent ?? ""
  ).replace(/\s+/g, " ");

describe("Devoluções — idade do cartão com a tela aberta na virada do dia", () => {
  it("23h30: 'hoje'; passada a meia-noite, sem mexer na tela: 'há 1 dia'", async () => {
    const { AdminDevolucoesView } = await import(
      "@/views/admin/AdminDevolucoesView"
    );
    await act(async () => {
      raiz.render(<AdminDevolucoesView onNavigate={vi.fn()} active />);
    });
    await drenar();

    expect(cartao()).toContain("hoje");
    expect(cartao()).not.toContain("há 1 dia");

    // 90 min depois: 01h00 de 27/09 em São Paulo.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90 * 60_000);
    });
    await drenar();

    expect(cartao()).toContain("há 1 dia");
  });
});
