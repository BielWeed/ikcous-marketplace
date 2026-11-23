// @vitest-environment jsdom
// A mesma ficha recebe outro pedido sem desmontar. As promessas controladas
// deixam a resposta antiga chegar por último, inclusive depois do cleanup.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface LinhaDoCatalogo {
  id: string;
  codigo?: string;
  sku?: string;
  name?: string;
  value?: string;
}

interface RespostaDoCatalogo {
  data: LinhaDoCatalogo[];
  error: null;
}

const { consultasPendentes } = vi.hoisted(() => ({
  consultasPendentes: new Map<string, Promise<RespostaDoCatalogo>>(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.in = vi.fn(
        (_coluna: string, ids: string[]) =>
          consultasPendentes.get(`${tabela}:${ids[0]}`) ??
          Promise.resolve({
            data:
              tabela === "vw_produtos_admin"
                ? ids.map((id) => ({ id, codigo: `PROD-${id}` }))
                : [],
            error: null,
          }),
      );
      return builder;
    }),
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

// Estes cards têm consultas próprias, alheias à leitura dos itens da ficha.
vi.mock("@/components/admin/orders/EtiquetaDoPedidoCard", () => ({
  EtiquetaDoPedidoCard: () => null,
}));
vi.mock("@/components/admin/orders/DevolucaoDoPedidoAdminCard", () => ({
  DevolucaoDoPedidoAdminCard: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function controlarConsulta(tabela: string, id: string) {
  let resolver!: (resposta: RespostaDoCatalogo) => void;
  let rejeitar!: (erro: Error) => void;
  const promessa = new Promise<RespostaDoCatalogo>((resolve, reject) => {
    resolver = resolve;
    rejeitar = reject;
  });
  consultasPendentes.set(`${tabela}:${id}`, promessa);
  return {
    responder: (data: LinhaDoCatalogo[]) => resolver({ data, error: null }),
    rejeitar,
  };
}

const sufixosDoCatalogo = [
  "invertida-a",
  "invertida-b",
  "feliz",
  "mesmos-itens",
  "loading-a",
  "loading-b",
  "cache-b",
  "cache-a",
  "produto-lento-a",
  "produto-lento-b",
  "desmontada",
  "erro-a",
  "erro-b",
];

function idDoCatalogo(sufixo: string, tipo: 1 | 2): string {
  const indice = sufixosDoCatalogo.indexOf(sufixo) + 1;
  if (!indice) throw new Error(`Sufixo de fixture desconhecido: ${sufixo}`);
  return `598044d5-9426-44d9-a0c9-${tipo}${String(indice).padStart(11, "0")}`;
}

function pedidoFake(sufixo: string): Order {
  return {
    id: `pedido-${sufixo}`,
    customer: {
      name: "Pessoa Fictícia",
      whatsapp: "34999990000",
      address: "Rua de Teste",
      number: "10",
      city: "Cidade Fictícia",
      state: "MG",
    },
    items: [
      {
        productId: idDoCatalogo(sufixo, 2),
        variantId: idDoCatalogo(sufixo, 1),
        name: "Camiseta de teste",
        price: 50,
        quantity: 1,
        image: "",
      },
    ],
    subtotal: 50,
    shipping: 0,
    discount: 0,
    total: 50,
    paymentMethod: "cash",
    paymentStatus: null,
    status: "pending",
    createdAt: "2026-10-01T12:00:00.000Z",
    updatedAt: "2026-10-01T12:00:00.000Z",
    cancelledAfterShipping: false,
  };
}

function tamanho(sufixo: string, value: string): LinhaDoCatalogo[] {
  return [
    {
      id: idDoCatalogo(sufixo, 1),
      sku: `SKU-${sufixo}`,
      name: "Tamanho",
      value,
    },
  ];
}

describe("ficha do pedido — resposta antiga não apaga tamanho e código", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    consultasPendentes.clear();
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    Reflect.deleteProperty(navigator, "clipboard");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function renderizar(order: Order) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });
  }

  const itens = () =>
    hospedeiro.querySelector<HTMLElement>('[data-testid="bloco-itens"]');
  const variacoes = () =>
    [...hospedeiro.querySelectorAll('[data-testid="variacao-do-item"]')].map(
      (elemento) => elemento.textContent,
    );
  const recibo = () =>
    [...document.querySelectorAll("div")].find((elemento) =>
      elemento.classList.contains("print:block"),
    );

  it("mantém o tamanho e o SKU de B na ficha e no recibo quando A responde depois", async () => {
    const a = controlarConsulta(
      "product_variants",
      idDoCatalogo("invertida-a", 1),
    );
    const b = controlarConsulta(
      "product_variants",
      idDoCatalogo("invertida-b", 1),
    );
    await renderizar(pedidoFake("invertida-a"));
    await renderizar(pedidoFake("invertida-b"));

    await act(async () => b.responder(tamanho("invertida-b", "M")));
    expect(variacoes()).toEqual(["Tamanho M"]);
    expect(itens()?.textContent).toContain(
      "Código do cadastro: SKU-invertida-b",
    );
    expect(recibo()?.textContent).toContain("Tamanho M");

    await act(async () => a.responder(tamanho("invertida-a", "P")));
    expect(variacoes()).toEqual(["Tamanho M"]);
    expect(itens()?.textContent).toContain(
      "Código do cadastro: SKU-invertida-b",
    );
    expect(recibo()?.textContent).toContain("Tamanho M");
    expect(hospedeiro.textContent).not.toContain("Tamanho P");
  });

  it("continua mostrando cor, tamanho e código no caminho feliz", async () => {
    const consulta = controlarConsulta(
      "product_variants",
      idDoCatalogo("feliz", 1),
    );
    await renderizar(pedidoFake("feliz"));
    expect(itens()?.textContent).toContain("Carregando código…");

    await act(async () =>
      consulta.responder([
        {
          id: idDoCatalogo("feliz", 1),
          sku: "AZUL-M",
          name: "Cor / Tamanho",
          value: "Azul / M",
        },
      ]),
    );
    expect(variacoes()).toEqual(["Cor Azul · Tamanho M"]);
    expect(recibo()?.textContent).toContain("Cor Azul · Tamanho M");
    expect(itens()?.textContent).toContain("Código do cadastro: AZUL-M");
    expect(itens()?.textContent).not.toContain("Carregando código…");
  });

  it("trocar de pedido invalida a consulta mesmo quando os dois têm os mesmos itens", async () => {
    const a = controlarConsulta(
      "product_variants",
      idDoCatalogo("mesmos-itens", 1),
    );
    const pedidoA = pedidoFake("mesmos-itens");
    await renderizar(pedidoA);
    const b = controlarConsulta(
      "product_variants",
      idDoCatalogo("mesmos-itens", 1),
    );
    await renderizar({ ...pedidoA, id: "outro-pedido-com-os-mesmos-itens" });

    await act(async () => b.responder(tamanho("mesmos-itens", "M")));
    expect(variacoes()).toEqual(["Tamanho M"]);
    await act(async () => a.responder(tamanho("mesmos-itens", "P")));
    expect(variacoes()).toEqual(["Tamanho M"]);
    expect(itens()?.textContent).toContain(
      "Código do cadastro: SKU-mesmos-itens",
    );
  });

  it("o finally de A não encerra o carregamento de B, que termina com a resposta de B", async () => {
    const a = controlarConsulta(
      "product_variants",
      idDoCatalogo("loading-a", 1),
    );
    const b = controlarConsulta(
      "product_variants",
      idDoCatalogo("loading-b", 1),
    );
    await renderizar(pedidoFake("loading-a"));
    await renderizar(pedidoFake("loading-b"));

    await act(async () => a.responder(tamanho("loading-a", "P")));
    expect(itens()?.textContent).toContain("Carregando código…");

    await act(async () => b.responder(tamanho("loading-b", "M")));
    expect(itens()?.textContent).not.toContain("Carregando código…");
    expect(itens()?.textContent).toContain("Código do cadastro: SKU-loading-b");
    expect(variacoes()).toEqual(["Tamanho M"]);
  });

  it("sair de uma consulta pendente para um pedido em cache não prende o carregamento", async () => {
    const b = controlarConsulta("product_variants", idDoCatalogo("cache-b", 1));
    const pedidoB = pedidoFake("cache-b");
    await renderizar(pedidoB);
    await act(async () => b.responder(tamanho("cache-b", "M")));
    const a = controlarConsulta("product_variants", idDoCatalogo("cache-a", 1));
    await renderizar(pedidoFake("cache-a"));
    expect(itens()?.textContent).toContain("Carregando código…");

    await renderizar(pedidoB);
    expect(itens()?.textContent).not.toContain("Carregando código…");
    expect(itens()?.textContent).toContain("Código do cadastro: SKU-cache-b");
    await act(async () => a.responder(tamanho("cache-a", "P")));
    expect(variacoes()).toEqual(["Tamanho M"]);
  });

  it("descarta também a resposta antiga que ainda esperava a consulta de produtos", async () => {
    const a = controlarConsulta(
      "vw_produtos_admin",
      idDoCatalogo("produto-lento-a", 2),
    );
    const b = controlarConsulta(
      "product_variants",
      idDoCatalogo("produto-lento-b", 1),
    );
    const pedidoA = pedidoFake("produto-lento-a");
    // Sem variação em A, só há o primeiro await para proteger seus setters.
    pedidoA.items[0].variantId = undefined;
    await renderizar(pedidoA);
    await renderizar(pedidoFake("produto-lento-b"));
    await act(async () => b.responder(tamanho("produto-lento-b", "M")));

    await act(async () =>
      a.responder([
        { id: idDoCatalogo("produto-lento-a", 2), codigo: "CODIGO-ANTIGO" },
      ]),
    );
    expect(variacoes()).toEqual(["Tamanho M"]);
    expect(itens()?.textContent).toContain(
      "Código do cadastro: SKU-produto-lento-b",
    );
    expect(recibo()?.textContent).toContain("Tamanho M");
  });

  it("desmontar descarta a resposta e não deixa tamanho antigo em cache para a próxima ficha", async () => {
    const antiga = controlarConsulta(
      "product_variants",
      idDoCatalogo("desmontada", 1),
    );
    const pedido = pedidoFake("desmontada");
    await renderizar(pedido);
    act(() => raiz.unmount());
    await act(async () => antiga.responder(tamanho("desmontada", "P")));

    // React ignora setters depois de desmontar; ausência de warning não
    // prova descarte. Remontar com os mesmos itens expõe o cache indevido.
    const nova = controlarConsulta(
      "product_variants",
      idDoCatalogo("desmontada", 1),
    );
    raiz = createRoot(hospedeiro);
    await renderizar(pedido);
    expect(variacoes()).toEqual([]);
    expect(itens()?.textContent).toContain("Carregando código…");
    await act(async () => nova.responder(tamanho("desmontada", "M")));
    expect(variacoes()).toEqual(["Tamanho M"]);
    expect(itens()?.textContent).not.toContain("Carregando código…");
  });

  it("erro de uma consulta invalidada não vira erro do pedido atual nem encerra seu carregamento", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = controlarConsulta("product_variants", idDoCatalogo("erro-a", 1));
    const b = controlarConsulta("product_variants", idDoCatalogo("erro-b", 1));
    await renderizar(pedidoFake("erro-a"));
    await renderizar(pedidoFake("erro-b"));
    await act(async () =>
      a.rejeitar(new Error("Falha fictícia da consulta antiga")),
    );
    expect(erro).not.toHaveBeenCalled();
    expect(itens()?.textContent).toContain("Carregando código…");

    await act(async () => b.responder(tamanho("erro-b", "M")));
    expect(variacoes()).toEqual(["Tamanho M"]);
    expect(itens()?.textContent).not.toContain("Carregando código…");
  });
});
