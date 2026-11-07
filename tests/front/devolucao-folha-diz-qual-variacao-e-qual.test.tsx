// @vitest-environment jsdom
//
// Folha de pedir devolução/troca da CLIENTE: duas linhas do MESMO produto em
// variações diferentes (camiseta Azul P e camiseta Preta M) apareciam idênticas
// ("Camiseta", mesmo preço), no passo de escolher o que volta e na revisão — a
// cliente podia marcar a variação errada. A elegibilidade que o servidor manda
// não traz a variação; o pedido que a tela já tem traz o id da linha e o id da
// variação, e o texto ("Cor Azul · Tamanho P") vem de `product_variants`, a
// mesma leitura da ficha do pedido. Sem variação (ou com a leitura falhando) a
// folha aparece como sempre.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";
import type { ElegibilidadeDevolucao } from "@/types/devolucao";

const { rpc, from, fetchUserOrders } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  fetchUserOrders: vi.fn(),
}));

const estado: { pedido: Order | null } = { pedido: null };

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [estado.pedido],
    fetchUserOrders,
    updateOrderStatus: vi.fn(),
  }),
}));
// Objeto ESTÁVEL entre renders: um novo a cada chamada religaria os efeitos.
const usuario = { id: "u-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      enableReviews: false,
      whatsappNumber: "34999999999",
      storeAddress: "Rua A, 10",
      businessHours: "Seg a Sex, 9h às 18h",
    },
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { from, rpc } }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const VARIACOES = [
  { id: "v-azul-p", name: "Cor / Tamanho", value: "Azul / P" },
  { id: "v-preta-m", name: "Cor / Tamanho", value: "Preta / M" },
];

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
  updated_at: null,
};

function linhaElegivel(order_item_id: string) {
  return {
    order_item_id,
    product_id: "p-camiseta",
    product_name: "Camiseta",
    image_url: null,
    quantidade: 1,
    ja_devolvida: 0,
    disponivel: 1,
    valor_unitario: 100,
  };
}

const ELEGIBILIDADE = {
  pode: true,
  motivo_bloqueio: null,
  entregue_em: "2026-11-01T15:00:00Z",
  dias_desde_entrega: 2,
  modalidade: "nacional",
  metodos: ["etiqueta_reversa", "envio_proprio"],
  prazos: {
    arrependimento_ate: "2026-11-08",
    troca_ate: "2026-12-01",
    vicio_ate: "2027-01-30",
  },
  janelas: { arrependimento: true, troca: true, vicio: true },
  itens: [linhaElegivel("oi-1"), linhaElegivel("oi-2")],
  politica: POLITICA,
} as unknown as ElegibilidadeDevolucao;

const pedido = (itens: Order["items"]): Order => ({
  id: "pedido-dev",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: itens,
  subtotal: 200,
  shipping: 0,
  discount: 0,
  total: 200,
  paymentMethod: "online",
  paymentStatus: "pago",
  status: "delivered",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cancelledAfterShipping: false,
});

const DUAS_LINHAS: Order["items"] = [
  {
    id: "oi-1",
    productId: "p-camiseta",
    variantId: "v-azul-p",
    name: "Camiseta",
    price: 100,
    quantity: 1,
    image: "",
  },
  {
    id: "oi-2",
    productId: "p-camiseta",
    variantId: "v-preta-m",
    name: "Camiseta",
    price: 100,
    quantity: 1,
    image: "",
  },
];

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  fetchUserOrders.mockReset();
  rpc.mockReset();
  from.mockReset();
  rpc.mockImplementation((nome: string) =>
    Promise.resolve({
      data:
        nome === "devolucao_elegibilidade"
          ? ELEGIBILIDADE
          : nome === "devolucoes_do_pedido"
            ? []
            : null,
      error: null,
    }),
  );
  from.mockImplementation((tabela: string) => ({
    select: () => ({
      in: () =>
        Promise.resolve({
          data: tabela === "product_variants" ? VARIACOES : [],
          error: null,
        }),
      eq: () => ({
        in: () => Promise.resolve({ data: [], error: null }),
        order: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  }));
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

async function abrirAFolha(itens: Order["items"]) {
  estado.pedido = pedido(itens);
  fetchUserOrders.mockResolvedValue([estado.pedido]);
  const { OrderDetailsView } = await import(
    "@/views/customer/OrderDetailsView"
  );
  await act(async () => {
    raiz.render(
      <OrderDetailsView
        orderId="pedido-dev"
        onBack={() => {}}
        onNavigate={() => {}}
      />,
    );
  });
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
  const pedir = hospedeiro.querySelector<HTMLButtonElement>(
    '[data-testid="acao-solicitar-devolucao"]',
  );
  expect(pedir).toBeTruthy();
  await act(async () => {
    pedir?.click();
  });
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}

const folha = () =>
  document.querySelector<HTMLElement>('[data-testid="folha-devolucao"]');
const passoItens = () =>
  folha()?.querySelector<HTMLElement>('[data-testid="passo-itens"]');
const rotulosDoPasso = () =>
  Array.from(
    folha()?.querySelectorAll('[data-testid="variacao-do-item-elegivel"]') ??
      [],
  ).map((el) => el.textContent);
const nomesDosBotoes = (prefixo: string) =>
  Array.from(folha()?.querySelectorAll(`[aria-label^="${prefixo}"]`) ?? []).map(
    (el) => el.getAttribute("aria-label"),
  );

function botao(rotulo: string): HTMLButtonElement | undefined {
  return Array.from(folha()?.querySelectorAll("button") ?? []).find(
    (b) =>
      b.textContent?.trim() === rotulo ||
      b.getAttribute("aria-label") === rotulo,
  );
}

async function clicar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

describe("folha de devolução da cliente: qual variação é qual", () => {
  it("passo 1: cada linha do mesmo produto mostra a sua cor e tamanho, e os botões de quantidade se distinguem", async () => {
    await abrirAFolha(DUAS_LINHAS);

    expect(passoItens()).toBeTruthy();
    expect(rotulosDoPasso()).toEqual([
      "Cor Azul · Tamanho P",
      "Cor Preta · Tamanho M",
    ]);
    expect(nomesDosBotoes("Aumentar")).toEqual([
      "Aumentar Camiseta (Cor Azul · Tamanho P)",
      "Aumentar Camiseta (Cor Preta · Tamanho M)",
    ]);
    expect(nomesDosBotoes("Diminuir")).toEqual([
      "Diminuir Camiseta (Cor Azul · Tamanho P)",
      "Diminuir Camiseta (Cor Preta · Tamanho M)",
    ]);
  });

  it("revisão: a linha escolhida diz qual variação vai voltar (só a escolhida)", async () => {
    await abrirAFolha(DUAS_LINHAS);
    await clicar(botao("Aumentar Camiseta (Cor Preta · Tamanho M)"));
    await clicar(botao("Continuar"));
    await clicar(
      folha()?.querySelector<HTMLInputElement>(
        'input[type="radio"][value="tamanho_pequeno"]',
      ),
    );
    await clicar(botao("Continuar"));
    await clicar(
      folha()?.querySelector<HTMLInputElement>(
        'input[type="radio"][value="reembolso"]',
      ),
    );
    await clicar(
      folha()?.querySelector<HTMLInputElement>(
        'input[type="radio"][value="envio_proprio"]',
      ),
    );
    await clicar(botao("Continuar"));

    const revisao =
      folha()?.querySelector('[data-testid="passo-revisao"]')?.textContent ??
      "";
    expect(revisao).toContain("1× Camiseta");
    expect(revisao).toContain("Cor Preta · Tamanho M");
    expect(revisao).not.toContain("Cor Azul · Tamanho P");
  });

  it("o limite: linha sem variação não ganha rótulo e o botão continua com o nome de sempre", async () => {
    await abrirAFolha([
      { ...DUAS_LINHAS[0], variantId: undefined },
      { ...DUAS_LINHAS[1], variantId: undefined },
    ]);

    expect(rotulosDoPasso()).toEqual([]);
    expect(nomesDosBotoes("Aumentar")).toEqual([
      "Aumentar Camiseta",
      "Aumentar Camiseta",
    ]);
  });

  it("o limite: pedido guardado sem o id da linha (cópia antiga) não quebra e não inventa rótulo", async () => {
    await abrirAFolha(
      DUAS_LINHAS.map((linha) => ({ ...linha, id: undefined })),
    );

    expect(passoItens()).toBeTruthy();
    expect(rotulosDoPasso()).toEqual([]);
    expect(nomesDosBotoes("Aumentar")).toEqual([
      "Aumentar Camiseta",
      "Aumentar Camiseta",
    ]);
  });

  it("o limite: se a leitura das variações falha, a folha aparece como sempre", async () => {
    from.mockImplementation((tabela: string) => ({
      select: () => ({
        in: () =>
          tabela === "product_variants"
            ? Promise.reject(new Error("rede"))
            : Promise.resolve({ data: [], error: null }),
        eq: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }));
    await abrirAFolha(DUAS_LINHAS);

    expect(passoItens()).toBeTruthy();
    expect(rotulosDoPasso()).toEqual([]);
  });
});

describe("o pedido da cliente guarda o id de cada linha (para ligar à folha)", () => {
  it("o mapeamento do pedido leva o id da linha adiante; linha sem id continua sem o campo", async () => {
    const { mapOrderFromDB } = await import("@/lib/mappers");
    const linha = (extra: Record<string, unknown>) => ({
      product_id: "p-camiseta",
      product_name: "Camiseta",
      price: 100,
      quantity: 1,
      variant_id: "v-azul-p",
      ...extra,
    });
    const pedidoMapeado = mapOrderFromDB({
      id: "pedido-dev",
      status: "delivered",
      items: [linha({ id: "oi-1" }), linha({})],
    } as unknown as Parameters<typeof mapOrderFromDB>[0]);

    expect(pedidoMapeado.items[0].id).toBe("oi-1");
    expect("id" in pedidoMapeado.items[1]).toBe(false);
  });
});
