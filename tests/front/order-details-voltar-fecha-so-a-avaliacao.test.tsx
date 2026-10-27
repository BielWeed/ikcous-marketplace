// @vitest-environment jsdom
//
// VOLTAR DO CELULAR COM A FOLHA DE AVALIAÇÃO ABERTA. O defeito: no Android,
// abrir o pedido entregue, tocar em "Avaliar", escrever o comentário e apertar
// Voltar tirava a cliente da tela do pedido — a folha sumia junto com o texto.
// Agora o Voltar faz o MESMO que o X: sem texto, fecha só a folha; com texto,
// pergunta "Descartar o que você escreveu?" (a folha e o texto ficam). A tela
// do pedido nunca sai de cena e nenhuma entrada de histórico sobra.
//
// Histórico REAL do jsdom e um "App" simulado que só navega quando a tela do
// histórico muda (o "já estamos no mesmo destino" do `syncWithUrl`).
// Molde de montagem: order-details-fechar-avaliacao-nao-perde-o-texto.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const fetchUserOrders = vi.fn();
const updateOrderStatus = vi.fn();

const pedido: Order = {
  id: "pedido-avaliacao",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      productId: "prod-1",
      name: "Tênis feminino",
      price: 100,
      quantity: 1,
      image: "",
    },
  ],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "cash",
  status: "delivered",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cancelledAfterShipping: false,
};

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedido],
    fetchUserOrders,
    updateOrderStatus,
  }),
}));

const usuario = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true, whatsappNumber: "34999999999" },
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperar(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
let navegacoesDoApp: string[];
const ouvintes: Array<(e: PopStateEvent) => void> = [];
const onBack = vi.fn();
const onNavigate = vi.fn();

const telaDoHistorico = () =>
  `${globalThis.history.state?.view}|${globalThis.location.pathname}`;

beforeEach(() => {
  fetchUserOrders.mockReset();
  fetchUserOrders.mockResolvedValue([pedido]);
  onBack.mockReset();
  onNavigate.mockReset();
  // Uma entrada anterior (lista de pedidos) e, por cima, a tela do pedido.
  globalThis.history.replaceState({ view: "orders" }, "", "/orders");
  globalThis.history.pushState(
    { view: "order-details", id: "pedido-avaliacao" },
    "",
    "/order-details?id=pedido-avaliacao",
  );
  navegacoesDoApp = [];
  let telaMostrada = telaDoHistorico();
  const ouvinte = () => {
    const alvo = telaDoHistorico();
    if (alvo === telaMostrada) return;
    telaMostrada = alvo;
    navegacoesDoApp.push(alvo);
  };
  ouvintes.push(ouvinte);
  globalThis.addEventListener("popstate", ouvinte);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  for (const o of ouvintes.splice(0)) {
    globalThis.removeEventListener("popstate", o);
  }
});

async function abrirAFolhaDeAvaliacao() {
  const { OrderDetailsView } = await import(
    "@/views/customer/OrderDetailsView"
  );
  await act(async () => {
    raiz.render(
      <OrderDetailsView
        orderId="pedido-avaliacao"
        onBack={onBack}
        onNavigate={onNavigate}
      />,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  const estrela = hospedeiro.querySelector<HTMLButtonElement>(
    '[aria-label="Dar 4 estrelas para Tênis feminino"]',
  );
  expect(estrela).not.toBeNull();
  await act(async () => {
    estrela?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
}

const folha = () =>
  document.body.querySelector<HTMLElement>(
    '[aria-labelledby="titulo-avaliacao"]',
  );
const aviso = () =>
  document.body.querySelector<HTMLElement>('[role="alertdialog"]');

function botao(texto: string, dentro: ParentNode | null | undefined) {
  return Array.from(dentro?.querySelectorAll("button") ?? []).find(
    (b) =>
      b.textContent?.trim() === texto || b.getAttribute("aria-label") === texto,
  );
}

async function clicar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  // Dá tempo ao `history.back()` que o fechamento pede e ao retorno engolido.
  await act(async () => {
    await esperar(120);
  });
}

async function digitar(texto: string) {
  const area = folha()?.querySelector("textarea") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(area, texto);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Aperta o Voltar do aparelho: histórico real do jsdom. */
async function apertarVoltar() {
  await act(async () => {
    globalThis.history.back();
    await esperar(60);
  });
  await act(async () => {
    await esperar(120);
  });
}

const TEXTO = "Chegou rápido e serve certinho";
const MARCA = { folhaDePolitica: true };

describe("OrderDetailsView — o Voltar do celular fecha só a folha de avaliação", () => {
  it("abrir a folha empurra UMA entrada com o mesmo endereço do pedido", async () => {
    const antes = globalThis.history.length;
    await abrirAFolhaDeAvaliacao();
    expect(globalThis.history.length).toBe(antes + 1);
    expect(globalThis.location.pathname + globalThis.location.search).toBe(
      "/order-details?id=pedido-avaliacao",
    );
    expect(globalThis.history.state).toMatchObject({
      view: "order-details",
      id: "pedido-avaliacao",
      ...MARCA,
    });
  });

  it("só estrelas: o Voltar fecha a folha e a tela do pedido continua", async () => {
    await abrirAFolhaDeAvaliacao();
    await apertarVoltar();

    expect(folha()).toBeNull();
    expect(aviso()).toBeNull();
    // A tela do pedido segue montada, sem o App ter trocado de tela.
    expect(hospedeiro.textContent).toContain("Tênis feminino");
    expect(navegacoesDoApp).toEqual([]);
    expect(onBack).not.toHaveBeenCalled();
    expect(globalThis.history.state).toEqual({
      view: "order-details",
      id: "pedido-avaliacao",
    });
  });

  it("com texto: o Voltar PERGUNTA, a folha e o texto ficam e a tela não sai", async () => {
    await abrirAFolhaDeAvaliacao();
    await digitar(TEXTO);
    await apertarVoltar();

    expect(aviso()?.textContent).toContain("Descartar o que você escreveu?");
    expect(folha()).not.toBeNull();
    expect(folha()?.querySelector("textarea")?.value).toBe(TEXTO);
    expect(navegacoesDoApp).toEqual([]);
    // A entrada que o Voltar consumiu foi empurrada de novo.
    expect(globalThis.history.state).toMatchObject(MARCA);
  });

  it("com a pergunta na tela, outro Voltar é 'Continuar escrevendo' (texto intacto)", async () => {
    await abrirAFolhaDeAvaliacao();
    await digitar(TEXTO);
    await apertarVoltar();
    await apertarVoltar();

    expect(aviso()).toBeNull();
    expect(folha()?.querySelector("textarea")?.value).toBe(TEXTO);
    expect(navegacoesDoApp).toEqual([]);
    expect(globalThis.history.state).toMatchObject(MARCA);
  });

  it("depois de 'Descartar' pela pergunta do Voltar, não sobra entrada: o Voltar seguinte é do roteador", async () => {
    await abrirAFolhaDeAvaliacao();
    await digitar(TEXTO);
    await apertarVoltar();
    await clicar(botao("Descartar", aviso()));

    expect(folha()).toBeNull();
    expect(globalThis.history.state).toEqual({
      view: "order-details",
      id: "pedido-avaliacao",
    });
    expect(navegacoesDoApp).toEqual([]);
    await apertarVoltar();
    expect(navegacoesDoApp).toEqual(["orders|/orders"]);
  });

  it("fechar pelo X consome a entrada: a tela não recua e o Voltar seguinte é do roteador", async () => {
    await abrirAFolhaDeAvaliacao();
    await clicar(botao("Fechar avaliação", folha()));

    expect(folha()).toBeNull();
    expect(navegacoesDoApp).toEqual([]);
    expect(globalThis.history.state).toEqual({
      view: "order-details",
      id: "pedido-avaliacao",
    });
    await apertarVoltar();
    expect(navegacoesDoApp).toEqual(["orders|/orders"]);
  });
});
