// @vitest-environment jsdom
//
// Pedido novo chega em tempo real e entra no TOPO da lista de Pedidos do
// painel (useOrders, INSERT do realtime). A lista desce bem na hora em que a
// lojista vai tocar em "Avançar" — botão que age com 1 toque, sem desfazer, e
// avisa a cliente. O dedo cai no cartão errado: avança outro pedido e o aviso
// vai para outra cliente.
//
// A regra (o mesmo princípio da proteção do Chrome contra deslocamento de
// layout e do filterTouchesWhenObscured do Android): o toque num botão de 1
// toque de um cartão que MUDOU DE LUGAR (ou acabou de aparecer) nos últimos
// ~600 ms é ignorado, com um aviso curto. Teclado e leitor de tela agem sobre
// o botão em foco, que não troca de pedido quando a lista se mexe: não são
// barrados.
//
// O jsdom não calcula layout: o `offsetTop` de cada cartão aqui vem da posição
// dele na lista (300 px por cartão), que é o que o navegador faria.
import { AdminOrderCard } from "@/components/admin/orders/AdminOrderCard";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const AVISO = "A lista mudou. Confira o pedido e toque de novo.";
const ALTURA_DO_CARTAO = 300;

let root: Root;
let host: HTMLDivElement;
let agora: number;
const avancar = vi.fn();
const whatsapp = vi.fn();

const pedido = (id: string, nome: string): Order => ({
  id,
  customer: { name: nome, whatsapp: "11999999999" },
  items: [
    { productId: "p1", name: "Caneca", quantity: 1, price: 10, image: "" },
  ],
  subtotal: 10,
  total: 10,
  shipping: 0,
  discount: 0,
  status: "pending",
  paymentMethod: "online",
  paymentStatus: "pago",
  createdAt: "2026-11-27T12:00:00Z",
  updatedAt: "2026-11-27T12:00:00Z",
  cancelledAfterShipping: false,
});

const ANA = pedido("pedido-ana-0001", "Ana");
const BIA = pedido("pedido-bia-0002", "Bia");
const NOVO = pedido("pedido-novo-0003", "Carla");

function Lista({ pedidos }: { readonly pedidos: readonly Order[] }) {
  return (
    <div>
      {pedidos.map((p) => (
        <AdminOrderCard
          key={p.id}
          order={p}
          viewMode="compact"
          onSelect={vi.fn()}
          onWhatsApp={whatsapp}
          onRegistrarPagamento={vi.fn()}
          registrandoPagamento={false}
          onStatusChange={avancar}
        />
      ))}
    </div>
  );
}

async function mostrar(pedidos: readonly Order[]) {
  await act(async () => root.render(<Lista pedidos={pedidos} />));
}

function cartaoDe(nome: string): HTMLElement {
  const cartao = [
    ...host.querySelectorAll<HTMLElement>('[data-testid="pedido-card"]'),
  ].find((c) => c.querySelector("h4")?.textContent === nome);
  expect(cartao, nome).toBeTruthy();
  return cartao!;
}

function botaoAvancarDe(nome: string): HTMLButtonElement {
  const botao = [...cartaoDe(nome).querySelectorAll("button")].find((b) =>
    b.textContent?.startsWith("Avançar"),
  );
  expect(botao, `Avançar de ${nome}`).toBeTruthy();
  return botao!;
}

/** Toque de dedo/mouse: o navegador manda `detail` 1 (um toque). */
async function tocar(botao: HTMLElement) {
  await act(async () => {
    botao.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  avancar.mockResolvedValue(undefined);
  agora = Date.parse("2026-11-27T15:00:00Z");
  vi.spyOn(Date, "now").mockImplementation(() => agora);
  vi.spyOn(toast, "warning");
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(
    function (this: HTMLElement) {
      if (this.dataset.testid !== "pedido-card" || !this.parentElement) {
        return 0;
      }
      return [...this.parentElement.children].indexOf(this) * ALTURA_DO_CARTAO;
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("toque em cartão que acabou de mudar de lugar", () => {
  it("lista parada: o toque avança na hora (a primeira montagem não é mudança)", async () => {
    await mostrar([ANA, BIA]);
    await tocar(botaoAvancarDe("Ana"));
    expect(avancar).toHaveBeenCalledWith(ANA.id, "processing", "pending");
    expect(toast.warning).not.toHaveBeenCalledWith(AVISO, expect.anything());
  });

  it("pedido novo entra no topo: o toque que cai no cartão novo não avança ninguém", async () => {
    await mostrar([ANA]);
    agora += 5_000;
    await mostrar([NOVO, ANA]);
    await tocar(botaoAvancarDe("Carla"));
    expect(avancar).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith(AVISO, expect.anything());
  });

  it("o cartão que desceu também não avança, e passado o tempo o mesmo toque avança", async () => {
    await mostrar([ANA, BIA]);
    agora += 5_000;
    await mostrar([NOVO, ANA, BIA]);
    agora += 200;
    await tocar(botaoAvancarDe("Ana"));
    expect(avancar).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith(AVISO, expect.anything());

    agora += 700;
    await tocar(botaoAvancarDe("Ana"));
    expect(avancar).toHaveBeenCalledTimes(1);
    expect(avancar).toHaveBeenCalledWith(ANA.id, "processing", "pending");
  });

  it("o WhatsApp do cartão que desceu também espera a lista parar", async () => {
    await mostrar([ANA]);
    agora += 5_000;
    await mostrar([NOVO, ANA]);
    const botao = cartaoDe("Ana").querySelector<HTMLButtonElement>(
      'button[title="WhatsApp"]',
    );
    expect(botao).toBeTruthy();
    await tocar(botao!);
    expect(whatsapp).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith(AVISO, expect.anything());
  });

  it("teclado e leitor de tela (clique sem toque) agem no botão em foco: não são barrados", async () => {
    await mostrar([ANA]);
    agora += 5_000;
    await mostrar([NOVO, ANA]);
    await act(async () => botaoAvancarDe("Ana").click());
    expect(avancar).toHaveBeenCalledWith(ANA.id, "processing", "pending");
  });
});
