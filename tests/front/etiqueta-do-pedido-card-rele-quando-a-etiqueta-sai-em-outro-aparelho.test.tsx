// @vitest-environment jsdom
//
// Ficha do mesmo pedido pago aberta em dois aparelhos: o aparelho A gera a
// etiqueta e o B seguia mostrando "Gerar etiqueta", sem "Abrir etiqueta". A
// edge grava `shipping_label_id` (reivindicação) e depois `shipping_label_url`
// sem mexer em status nem pagamento, que eram as únicas coisas que faziam o
// cartão reler. Agora a ficha passa o vínculo da etiqueta ao cartão e uma
// MUDANÇA dele (id ou url) refaz a leitura, em silêncio, do MESMO jeito da
// releitura por status/pagamento (sem remontar, sem piscar o esqueleto).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, pedidoState, eqChamadas } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  pedidoState: { data: null as any },
  eqChamadas: [] as string[],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "order_shipping_events") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      return {
        select: () => ({
          eq: (_coluna: string, valor: string) => {
            eqChamadas.push(valor);
            return {
              maybeSingle: () =>
                Promise.resolve({ data: pedidoState.data, error: null }),
            };
          },
        }),
      };
    },
    functions: { invoke: invokeMock },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ID = "11111111-1111-1111-1111-111111111111";
const URL_DA_ETIQUETA = "https://melhorenvio.com.br/imprimir/abc";

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function pedido(over: Record<string, unknown> = {}) {
  return {
    id: ID,
    status: "processing",
    payment_status: "pago",
    shipping: 24.9,
    shipping_cost: null,
    tracking_code: null,
    shipping_label_id: null,
    shipping_label_url: null,
    notes: null,
    shipping_option_id: "melhor-envio-3",
    cpf: "52998224725",
    ...over,
  };
}

describe("EtiquetaDoPedidoCard — relê o pedido quando a etiqueta sai em outro aparelho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    eqChamadas.length = 0;
    pedidoState.data = pedido();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const { _resetTravasDeReentranciaParaTeste } = await import(
      "@/components/admin/orders/EtiquetaDoPedidoCard"
    );
    _resetTravasDeReentranciaParaTeste();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function desenhar(props: Record<string, unknown> = {}) {
    const { EtiquetaDoPedidoCard } = await import(
      "@/components/admin/orders/EtiquetaDoPedidoCard"
    );
    await act(async () => {
      raiz.render(
        <EtiquetaDoPedidoCard
          orderId={ID}
          isOffline={false}
          status="processing"
          paymentStatus="pago"
          {...props}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  const botao = (texto: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    ) as HTMLButtonElement | undefined;

  const linkAbrirEtiqueta = () =>
    [...hospedeiro.querySelectorAll("a")].find((a) =>
      a.textContent?.includes("Abrir etiqueta"),
    ) as HTMLAnchorElement | undefined;

  it("o outro aparelho gerou a etiqueta: o cartão relê, 'Gerar etiqueta' some e 'Abrir etiqueta' aparece", async () => {
    await desenhar({ shippingLabelIdDaFicha: undefined });
    expect(botao("Gerar etiqueta")).toBeTruthy();
    expect(linkAbrirEtiqueta()).toBeUndefined();
    expect(eqChamadas).toHaveLength(1);

    pedidoState.data = pedido({
      shipping_label_id: "lbl-1",
      shipping_label_url: URL_DA_ETIQUETA,
      tracking_code: "ME123",
    });
    await desenhar({
      shippingLabelIdDaFicha: "lbl-1",
      shippingLabelUrlDaFicha: URL_DA_ETIQUETA,
    });

    expect(eqChamadas).toHaveLength(2);
    expect(botao("Gerar etiqueta")).toBeUndefined();
    expect(linkAbrirEtiqueta()?.getAttribute("href")).toBe(URL_DA_ETIQUETA);
  });

  it("a url chega DEPOIS do id (a edge reivindica o id e só então grava a url): a url nova também relê", async () => {
    await desenhar();

    // 1º UPDATE da edge: só o id (reivindicação).
    pedidoState.data = pedido({ shipping_label_id: "lbl-1" });
    await desenhar({ shippingLabelIdDaFicha: "lbl-1" });
    expect(eqChamadas).toHaveLength(2);
    expect(linkAbrirEtiqueta()).toBeUndefined();

    // 2º UPDATE: o mesmo id, agora com a url e o rastreio.
    pedidoState.data = pedido({
      shipping_label_id: "lbl-1",
      shipping_label_url: URL_DA_ETIQUETA,
      tracking_code: "ME123",
    });
    await desenhar({
      shippingLabelIdDaFicha: "lbl-1",
      shippingLabelUrlDaFicha: URL_DA_ETIQUETA,
    });

    expect(eqChamadas).toHaveLength(3);
    expect(linkAbrirEtiqueta()?.getAttribute("href")).toBe(URL_DA_ETIQUETA);
  });

  it("a releitura é silenciosa: não volta ao esqueleto de 'carregando' e a confirmação aberta cede à etiqueta que já existe", async () => {
    await desenhar();
    await act(async () => {
      botao("Gerar etiqueta")?.click();
    });
    expect(botao("Confirmar e gerar")).toBeTruthy();

    // Mesmo pedido, só mudou o vínculo da etiqueta: relê sem remontar.
    pedidoState.data = pedido({ shipping_label_id: "lbl-1" });
    await desenhar({ shippingLabelIdDaFicha: "lbl-1" });

    expect(eqChamadas).toHaveLength(2);
    expect(hospedeiro.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(botao("Gerar etiqueta")).toBeUndefined();
    expect(botao("Confirmar e gerar")).toBeUndefined();
  });

  it("nada mudou no vínculo (mesmo id e url em outro render): NÃO relê", async () => {
    pedidoState.data = pedido({
      shipping_label_id: "lbl-1",
      shipping_label_url: URL_DA_ETIQUETA,
    });
    await desenhar({
      shippingLabelIdDaFicha: "lbl-1",
      shippingLabelUrlDaFicha: URL_DA_ETIQUETA,
    });
    await desenhar({
      shippingLabelIdDaFicha: "lbl-1",
      shippingLabelUrlDaFicha: URL_DA_ETIQUETA,
      isOffline: false,
    });
    expect(eqChamadas).toHaveLength(1);
  });

  it("sem o vínculo nas props (quem monta o cartão sem a ficha) ou com 'sem etiqueta' repetido: nunca relê", async () => {
    await desenhar();
    await desenhar({
      shippingLabelIdDaFicha: undefined,
      shippingLabelUrlDaFicha: undefined,
    });
    await desenhar({
      shippingLabelIdDaFicha: null,
      shippingLabelUrlDaFicha: null,
    });
    expect(eqChamadas).toHaveLength(1);
  });

  // O APARELHO QUE COMPRA: a edge grava o id na reivindicação (antes de pagar)
  // e a url só no fim. O id chegando pela lista ao vivo no meio da compra não
  // pode derrubar o quadro "Gerando…" nem competir com a resposta da compra.
  async function comprarEmVoo() {
    let resolver: (v: unknown) => void = () => {};
    invokeMock.mockReturnValue(
      new Promise((resolve) => {
        resolver = resolve;
      }),
    );
    await desenhar();
    await act(async () => {
      botao("Gerar etiqueta")?.click();
    });
    await act(async () => {
      botao("Confirmar e gerar")?.click();
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).toContain("Gerando…");
    return resolver;
  }

  it("compra deste aparelho em voo + id novo pela lista ao vivo: NÃO relê e 'Gerando…' continua; ao terminar a url não some", async () => {
    const resolver = await comprarEmVoo();

    pedidoState.data = pedido({ shipping_label_id: "lbl-1" });
    await desenhar({ shippingLabelIdDaFicha: "lbl-1" });

    expect(eqChamadas).toHaveLength(1);
    expect(hospedeiro.textContent).toContain("Gerando…");
    expect(hospedeiro.textContent).not.toContain("Etiqueta emitida");

    pedidoState.data = pedido({
      shipping_label_id: "lbl-1",
      shipping_label_url: URL_DA_ETIQUETA,
      tracking_code: "ME123",
    });
    await act(async () => {
      resolver({
        data: {
          success: true,
          already: false,
          tracking_code: "ME123",
          label_url: URL_DA_ETIQUETA,
          label_id: "lbl-1",
        },
      });
      await esperarMicrotarefas();
    });
    await desenhar({
      shippingLabelIdDaFicha: "lbl-1",
      shippingLabelUrlDaFicha: URL_DA_ETIQUETA,
    });

    expect(hospedeiro.textContent).toContain(
      "Etiqueta gerada e vinculada ao pedido!",
    );
    expect(linkAbrirEtiqueta()?.getAttribute("href")).toBe(URL_DA_ETIQUETA);
  });

  it("a compra termina SEM resposta/falha com o id já trocado no meio do voo: a mudança não se perde, relê ao terminar", async () => {
    const resolver = await comprarEmVoo();

    pedidoState.data = pedido({ shipping_label_id: "lbl-1" });
    await desenhar({ shippingLabelIdDaFicha: "lbl-1" });
    expect(eqChamadas).toHaveLength(1);

    await act(async () => {
      resolver({
        data: null,
        error: {
          name: "FunctionsHttpError",
          context: new Response(JSON.stringify({ error: "Falha qualquer." }), {
            status: 500,
          }),
        },
      });
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(eqChamadas.length).toBeGreaterThanOrEqual(2);
    expect(botao("Gerar etiqueta")).toBeUndefined();
    expect(botao("Confirmar e gerar")).toBeUndefined();
    expect(hospedeiro.textContent).toContain("Etiqueta emitida");
  });

  it("trocar de pedido NÃO conta como mudança do vínculo: a leitura é uma só pelo pedido novo", async () => {
    await desenhar({ shippingLabelIdDaFicha: "lbl-1" });
    expect(eqChamadas).toEqual([ID]);

    const OUTRO = "22222222-2222-2222-2222-222222222222";
    pedidoState.data = pedido({ id: OUTRO });
    await desenhar({ orderId: OUTRO, shippingLabelIdDaFicha: undefined });

    expect(eqChamadas).toEqual([ID, OUTRO]);
  });
});
