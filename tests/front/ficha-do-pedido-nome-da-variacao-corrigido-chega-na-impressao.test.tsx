// @vitest-environment jsdom
//
// A ficha do pedido guardava em memória o nome da variação ("Tamanho M") para
// sempre, enquanto a exportação em CSV lê o cadastro de novo a cada vez. A
// lojista corrigia o nome da opção no produto, voltava ao pedido e o papel
// (e a tela) saíam com o nome antigo até ela recarregar o app. Contrato:
//   - a cópia em memória vale 60 s: dentro disso a ficha reaproveita (abrir
//     pedidos em sequência não pisca nem repete consulta);
//   - passou disso, abrir a ficha lê o cadastro de novo e o nome corrigido
//     chega à tela e ao recibo.
//
// O Date.now é controlado pelo teste. Só o caso do relógio da ficha
// simula também o disparo do timeout.
//
// Molde: ficha-do-pedido-imprimir-espera-tamanho-e-cor.test.tsx.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { banco, consultas } = vi.hoisted(() => ({
  banco: [] as Array<{ id: string; sku: string; name: string; value: string }>,
  consultas: { product_variants: 0, falhar: false },
}));

vi.mock("@/lib/supabase", () => {
  function construtorDa(tabela: string) {
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.in = vi.fn((_coluna: string, ids: string[]) => {
      if (tabela === "product_variants") consultas.product_variants++;
      if (tabela === "product_variants" && consultas.falhar) {
        return Promise.resolve({
          data: null,
          error: { message: "falha de rede" },
        });
      }
      return Promise.resolve({
        data:
          tabela === "product_variants"
            ? banco.filter((v) => ids.includes(v.id)).map((v) => ({ ...v }))
            : [],
        error: null,
      });
    });
    builder.maybeSingle = vi.fn(() =>
      Promise.resolve({ data: null, error: null }),
    );
    builder.update = vi.fn(() => builder);
    return builder;
  }
  return {
    supabase: {
      from: vi.fn((tabela: string) => construtorDa(tabela)),
      rpc: vi.fn(),
      functions: { invoke: vi.fn() },
      channel: vi.fn(),
      removeChannel: vi.fn(),
    },
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

type ItemDoPedido = Order["items"][number];

function pedidoFake(variantId: string): Order {
  const items: ItemDoPedido[] = [
    {
      productId: "598044d4-9426-44d9-a0c9-000000000001",
      name: "Camiseta Básica",
      price: 50,
      quantity: 1,
      image: "",
      variantId,
    },
  ];
  return {
    id: "ped-validade-123456",
    customer: {
      name: "Cliente Teste",
      whatsapp: "349998888777",
      address: "Rua das Flores",
      number: "123",
      neighborhood: "Centro",
      city: "Patos de Minas",
      state: "MG",
    },
    items,
    subtotal: 50,
    shipping: 0,
    discount: 0,
    total: 50,
    paymentMethod: "cash",
    status: "pending",
    paymentStatus: null,
    createdAt: "2026-09-01T14:32:00.000Z",
    updatedAt: "2026-09-01T14:32:00.000Z",
    cancelledAfterShipping: false,
    pagamentoRecebidoEm: null,
    pagamentoRecebidoPor: null,
  };
}

describe("ficha do pedido — o nome da variação corrigido chega à impressão", () => {
  let raiz: Root | null;
  let hospedeiro: HTMLDivElement;
  let agora: number;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    agora = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => agora);
    banco.length = 0;
    consultas.product_variants = 0;
    consultas.falhar = false;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = null;
  });

  afterEach(() => {
    act(() => {
      raiz?.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function assentar() {
    await act(async () => {
      if (vi.isFakeTimers()) {
        await vi.advanceTimersByTimeAsync(0);
      } else {
        await new Promise((r) => setTimeout(r, 0));
      }
    });
  }

  // Abrir a ficha de novo = montar outra, como ao sair do pedido e voltar.
  async function abrirFicha(order: Order) {
    act(() => {
      raiz?.unmount();
    });
    raiz = createRoot(hospedeiro);
    await mostrarPedido(raiz, order);
  }

  async function mostrarPedido(raizDaFicha: Root, order: Order) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raizDaFicha.render(
        <OrderDetail order={order} onStatusChange={vi.fn()} />,
      );
    });
    await assentar();
  }

  const papel = () => document.body.querySelector("[data-tema-fixo]");
  const botaoImprimir = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Imprimir Pedido"]',
    );

  it("depois de 60 s a ficha lê o cadastro de novo e traz o nome corrigido", async () => {
    banco.push({
      id: "598044d4-9426-44d9-a0c9-000000000002",
      sku: "CAM-M",
      name: "Tamanho",
      value: "M",
    });
    await abrirFicha(pedidoFake("598044d4-9426-44d9-a0c9-000000000002"));
    expect(hospedeiro.textContent).toContain("Tamanho M");

    // A lojista corrige o nome da opção no produto e volta ao pedido.
    banco[0] = {
      id: "598044d4-9426-44d9-a0c9-000000000002",
      sku: "CAM-M",
      name: "Tamanho",
      value: "G",
    };
    agora += 61_000;
    await abrirFicha(pedidoFake("598044d4-9426-44d9-a0c9-000000000002"));

    expect(hospedeiro.textContent).toContain("Tamanho G");
    expect(hospedeiro.textContent).not.toContain("Tamanho M");
    expect(botaoImprimir()?.disabled).toBe(false);
  });

  it("CONTROLE: dentro dos 60 s reaproveita a cópia (sem consulta nova)", async () => {
    banco.push({
      id: "598044d4-9426-44d9-a0c9-000000000003",
      sku: "CAM-P",
      name: "Tamanho",
      value: "P",
    });
    await abrirFicha(pedidoFake("598044d4-9426-44d9-a0c9-000000000003"));
    expect(consultas.product_variants).toBe(1);

    banco[0] = {
      id: "598044d4-9426-44d9-a0c9-000000000003",
      sku: "CAM-P",
      name: "Tamanho",
      value: "GG",
    };
    agora += 30_000;
    await abrirFicha(pedidoFake("598044d4-9426-44d9-a0c9-000000000003"));

    expect(consultas.product_variants).toBe(1);
    expect(hospedeiro.textContent).toContain("Tamanho P");
    expect(hospedeiro.textContent).not.toContain("Tamanho GG");
  });

  it("variação apagada do catálogo depois de 60 s: o nome velho não volta ao papel", async () => {
    banco.push({
      id: "598044d4-9426-44d9-a0c9-000000000004",
      sku: "CAM-XG",
      name: "Tamanho",
      value: "XG",
    });
    await abrirFicha(pedidoFake("598044d4-9426-44d9-a0c9-000000000004"));
    expect(hospedeiro.textContent).toContain("Tamanho XG");

    banco.length = 0;
    agora += 61_000;
    await abrirFicha(pedidoFake("598044d4-9426-44d9-a0c9-000000000004"));

    expect(hospedeiro.textContent).not.toContain("Tamanho XG");
    // Leitura que deu certo e não achou: imprime como sempre.
    expect(botaoImprimir()?.disabled).toBe(false);
  });

  it("na troca de pedido sem desmontar, a releitura que falha bloqueia o papel com rótulo vencido", async () => {
    const id = "598044d4-9426-44d9-a0c9-000000000006";
    banco.push({ id, sku: "CAM-P", name: "Tamanho", value: "P" });
    const antigo = pedidoFake(id);
    await abrirFicha(antigo);
    expect(papel()?.textContent).toContain("Tamanho P");
    expect(botaoImprimir()?.disabled).toBe(false);

    banco[0].value = "M";
    agora += 60_000;
    consultas.falhar = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const outro = { ...pedidoFake(id), id: "ped-validade-654321" };
    if (!raiz) throw new Error("A primeira ficha não foi montada");
    await mostrarPedido(raiz, outro);

    expect(consultas.product_variants).toBe(2);
    expect(botaoImprimir()?.disabled).toBe(true);
    expect(papel()).toBeNull();
    const tentar = Array.from(hospedeiro.querySelectorAll("button")).find(
      (botao) => botao.textContent === "Tentar de novo",
    );
    expect(tentar).toBeDefined();

    consultas.falhar = false;
    await act(async () => tentar?.click());
    await assentar();

    expect(botaoImprimir()?.disabled).toBe(false);
    expect(papel()?.textContent).toContain("Tamanho M");
    expect(papel()?.textContent).not.toContain("Tamanho P");
  });

  it("ao vencer com a ficha aberta, o rótulo fica nos itens com aviso, mas não imprime", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const id = "598044d4-9426-44d9-a0c9-000000000009";
    banco.push({ id, sku: "CAM-M", name: "Cor / Tamanho", value: "Azul / M" });
    await abrirFicha(pedidoFake(id));

    const rotuloNaFicha = () =>
      hospedeiro.querySelector(
        '[data-testid="bloco-itens"] [data-testid="variacao-do-item"]',
      );
    expect(rotuloNaFicha()?.textContent).toBe("Cor Azul · Tamanho M");
    expect(papel()?.textContent).toContain("Cor Azul · Tamanho M");

    agora += 60_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(botaoImprimir()?.disabled).toBe(true);
    expect(papel()).toBeNull();
    // O aviso aponta o botão que existe ("Tentar de novo"), não o F5.
    const aviso = hospedeiro.querySelector('[role="alert"]')?.textContent;
    expect(aviso).toContain(
      "A cópia do tamanho e da cor venceu. Toque em Tentar de novo antes de separar o pedido.",
    );
    expect(aviso).not.toContain("Recarregue");
    expect(rotuloNaFicha()?.textContent).toBe(
      "Cor Azul · Tamanho M (atualize a ficha)",
    );
    // Sem o recibo montado, Ctrl+P ainda pode imprimir a página do painel.
    expect(rotuloNaFicha()?.classList.contains("print:hidden")).toBe(true);
    expect(consultas.product_variants).toBe(1);
  });

  it("Ctrl+P não leva uma cópia que acabou de vencer com a ficha aberta", async () => {
    const id = "598044d4-9426-44d9-a0c9-000000000007";
    banco.push({ id, sku: "CAM-P", name: "Tamanho", value: "P" });
    await abrirFicha(pedidoFake(id));

    agora += 59_999;
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
      expect(papel()?.textContent).toContain("Tamanho P");
    });

    agora += 1;
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
      // O navegador tira a foto do papel antes de devolver o controle ao React.
      expect(papel()).toBeNull();
    });
    expect(botaoImprimir()?.disabled).toBe(true);
  });

  it("preserva no papel a variação gravada na compra, mesmo se o catálogo falhar", async () => {
    const id = "598044d4-9426-44d9-a0c9-000000000008";
    banco.push({ id, sku: "CAM-P", name: "Tamanho", value: "P" });
    await abrirFicha(pedidoFake(id));

    agora += 60_000;
    consultas.falhar = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const outro = { ...pedidoFake(id), id: "ped-validade-765432" };
    outro.items[0].variacaoNomeNaCompra = "Tamanho";
    outro.items[0].variacaoValorNaCompra = "G";
    if (!raiz) throw new Error("A primeira ficha não foi montada");
    await mostrarPedido(raiz, outro);

    expect(consultas.product_variants).toBe(2);
    expect(botaoImprimir()?.disabled).toBe(false);
    expect(papel()?.textContent).toContain("Tamanho G");
    expect(papel()?.textContent).not.toContain("Tamanho P");
  });

  it("se a releitura falha, o aviso aparece (a cópia vencida não finge estar em dia)", async () => {
    banco.push({
      id: "598044d4-9426-44d9-a0c9-000000000005",
      sku: "CAM-G",
      name: "Cor",
      value: "Azul",
    });
    await abrirFicha(pedidoFake("598044d4-9426-44d9-a0c9-000000000005"));
    expect(hospedeiro.textContent).toContain("Cor Azul");

    // Cadastro mudou e a releitura vai falhar: nada de recibo em silêncio.
    consultas.falhar = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    agora += 61_000;
    await abrirFicha(pedidoFake("598044d4-9426-44d9-a0c9-000000000005"));

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Não deu para carregar tamanho",
    );
    expect(botaoImprimir()?.disabled).toBe(true);
  });
});
