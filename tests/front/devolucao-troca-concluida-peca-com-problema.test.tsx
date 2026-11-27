// @vitest-environment jsdom
//
// Devolução concluída com TROCA: a peça nova chega pela loja e pode vir com
// problema — e o cartão só dizia "a loja combina com você a entrega". Agora:
//  - troca: a frase manda falar com a loja informando o protocolo e, se a loja
//    tem WhatsApp, o botão "A peça da troca veio com problema" abre o WhatsApp
//    dela já com o número do pedido e o protocolo (o MESMO montador de link do
//    "Falar com a loja" da tela do pedido);
//  - loja sem WhatsApp: só a frase;
//  - vale-troca: a frase explica que a compra feita com o vale tem devolução
//    própria, e não há botão.
// Os toques são gestos inteiros (pointerdown, pointerup, click).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const { fetchUserOrders, rpc, respostas, loja } = vi.hoisted(() => ({
  fetchUserOrders: vi.fn(),
  rpc: vi.fn(),
  respostas: new Map<string, unknown>(),
  loja: { whatsappNumber: "34999990000" as string | null },
}));

const ID_DO_PEDIDO = "pedido-7f3a9c";
const PROTOCOLO = "DV261127-TROCA";

const pedido: Order = {
  id: ID_DO_PEDIDO,
  customer: { name: "Cliente Inventada", whatsapp: "34988887777" },
  items: [
    { productId: "p-1", name: "Tênis", price: 100, quantity: 1, image: "" },
  ],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "online",
  paymentStatus: "pago",
  status: "delivered",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cancelledAfterShipping: false,
};

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedido],
    fetchUserOrders,
    updateOrderStatus: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u-1" } }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      enableReviews: false,
      whatsappNumber: loja.whatsappNumber,
      storeAddress: "Rua Inventada, 10",
      businessHours: null,
    },
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
    rpc,
  },
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const POLITICA = {
  prazo_arrependimento_dias: 7,
  prazo_troca_dias: 30,
  prazo_vicio_dias: 90,
  aceita_troca: true,
  aceita_vale: true,
  exige_fotos_vicio: true,
  metodos_locais: ["entrega_na_loja", "coleta"],
  metodos_nacionais: ["etiqueta_reversa", "envio_proprio"],
  reembolso_momento: "ao_receber",
  frete_troca_pago_por: "cliente",
  categorias_sem_troca: [],
  texto_politica: null,
  endereco_devolucao: null,
};

const DETALHE = {
  id: "d-1",
  protocolo: PROTOCOLO,
  order_id: ID_DO_PEDIDO,
  tipo: "troca",
  motivo: "tamanho_pequeno",
  detalhe: null,
  resolucao_desejada: "troca",
  resolucao_final: "troca",
  modalidade: "local",
  metodo_retorno: "entrega_na_loja",
  status: "concluida",
  valor_itens: 100,
  valor_frete_ida: 0,
  valor_reembolso: null,
  refund_id: null,
  reembolso_manual: false,
  fotos: [],
  codigo_rastreio: null,
  codigo_postagem: null,
  etiqueta_url: null,
  coleta_em: null,
  mensagem_loja: null,
  observacao_inspecao: null,
  entregue_em: "2026-09-24T15:00:00Z",
  prazo_ate: "2026-10-24",
  politica: POLITICA,
  created_at: "2026-09-26T10:00:00Z",
  aprovada_em: "2026-09-26T11:00:00Z",
  itens: [
    {
      id: "di-1",
      order_item_id: "oi-1",
      product_name: "Tênis",
      quantidade: 1,
      valor_unitario: 100,
    },
  ],
  eventos: [],
  pedido: null,
};

const FRASE_DA_TROCA =
  "Se a peça nova tiver algum problema, fale com a loja informando o protocolo.";
const FRASE_DO_VALE =
  "Se usar o vale numa compra pelo app, a peça nova tem devolução própria naquele pedido.";
const ROTULO_DO_BOTAO = "A peça da troca veio com problema";

let raiz: Root;
let hospedeiro: HTMLDivElement;
let abrir: ReturnType<typeof vi.fn>;

beforeEach(() => {
  rpc.mockReset();
  respostas.clear();
  loja.whatsappNumber = "34999990000";
  respostas.set("devolucao_elegibilidade", {
    pode: false,
    motivo_bloqueio: null,
    entregue_em: "2026-09-24T15:00:00Z",
    dias_desde_entrega: 30,
    modalidade: "local",
    metodos: ["entrega_na_loja"],
    prazos: {
      arrependimento_ate: "2026-10-01",
      troca_ate: "2026-10-24",
      vicio_ate: "2026-12-23",
    },
    janelas: { arrependimento: false, troca: false, vicio: true },
    itens: [],
    politica: POLITICA,
  });
  rpc.mockImplementation((nome: string) =>
    Promise.resolve({ data: respostas.get(nome) ?? null, error: null }),
  );
  abrir = vi.fn();
  vi.stubGlobal("open", abrir);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function mostrarDevolucao(campos: Record<string, unknown> = {}) {
  const detalhe = { ...DETALHE, ...campos };
  respostas.set("devolucoes_do_pedido", [detalhe]);
  respostas.set("devolucao_detalhe", detalhe);
  fetchUserOrders.mockResolvedValue([pedido]);
  const { OrderDetailsView } = await import(
    "@/views/customer/OrderDetailsView"
  );
  await act(async () => {
    raiz.render(
      <OrderDetailsView
        orderId={ID_DO_PEDIDO}
        onBack={() => {}}
        onNavigate={() => {}}
      />,
    );
  });
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  const cartao = hospedeiro.querySelector<HTMLElement>(
    '[data-testid="cartao-devolucao"]',
  );
  expect(cartao).not.toBeNull();
  return cartao;
}

const botaoDaPeca = (cartao: HTMLElement | null) =>
  Array.from(cartao?.querySelectorAll("button") ?? []).find(
    (b) => b.textContent?.trim() === ROTULO_DO_BOTAO,
  );

async function tocar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    el?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    el?.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

describe("troca concluída: a peça nova com problema tem caminho", () => {
  it("troca + loja com WhatsApp: frase e botão; o link leva o número do pedido e o protocolo", async () => {
    const cartao = await mostrarDevolucao();

    expect(cartao?.textContent).toContain(FRASE_DA_TROCA);
    await tocar(botaoDaPeca(cartao));

    expect(abrir).toHaveBeenCalledTimes(1);
    const [url, alvo, recursos] = abrir.mock.calls[0];
    expect(alvo).toBe("_blank");
    expect(recursos).toBe("noopener,noreferrer");
    const link = new URL(String(url));
    expect(link.origin + link.pathname).toBe("https://wa.me/5534999990000");
    expect(link.searchParams.get("text")).toBe(
      `Olá! A peça que recebi na troca do pedido #7F3A9C (protocolo ${PROTOCOLO}) veio com problema.`,
    );
  });

  it("o 'Falar com a loja' geral continua mandando a mensagem de dúvida", async () => {
    await mostrarDevolucao();
    const geral = hospedeiro.querySelector<HTMLElement>(
      '[aria-label="Falar com a loja no WhatsApp"]',
    );

    await tocar(geral);

    expect(abrir).toHaveBeenCalledTimes(1);
    const link = new URL(String(abrir.mock.calls[0][0]));
    expect(link.searchParams.get("text")).toBe(
      "Olá! Tenho uma dúvida sobre meu pedido #7F3A9C.",
    );
  });

  it("troca + loja SEM WhatsApp: só a frase, sem botão", async () => {
    loja.whatsappNumber = "";
    const cartao = await mostrarDevolucao();

    expect(cartao?.textContent).toContain(FRASE_DA_TROCA);
    expect(botaoDaPeca(cartao)).toBeUndefined();
  });

  it("vale-troca: a frase do vale e nenhum botão", async () => {
    const cartao = await mostrarDevolucao({
      resolucao_final: "vale",
      resolucao_desejada: "vale",
    });

    expect(cartao?.textContent).toContain(FRASE_DO_VALE);
    expect(cartao?.textContent).not.toContain(FRASE_DA_TROCA);
    expect(botaoDaPeca(cartao)).toBeUndefined();
  });

  it("troca ainda em andamento (aprovada): sem botão de peça com problema", async () => {
    const cartao = await mostrarDevolucao({
      status: "aprovada",
      resolucao_final: null,
    });

    expect(botaoDaPeca(cartao)).toBeUndefined();
  });
});
