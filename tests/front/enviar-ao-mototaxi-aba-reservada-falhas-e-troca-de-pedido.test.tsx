// @vitest-environment jsdom
// Caça por mutação: o botão "Enviar ao mototáxi" reserva uma aba no clique e só
// depois consulta o número. As bordas abaixo (pop-up barrado, aba fechada no
// meio da consulta, troca de pedido durante a consulta, mensagem de erro velha)
// não eram vistas por nenhum teste.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  numero: "5511987654321" as string | null,
  // Cada leitura do contato consome a próxima promessa da fila (vazia = responde na hora).
  fila: [] as Promise<unknown>[],
  leituras: 0,
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: () => ({
      select: () => ({
        eq: () => ({
          abortSignal() {
            return this;
          },
          maybeSingle: async () => {
            estado.leituras += 1;
            if (estado.fila.length > 0) return estado.fila.shift();
            return {
              data: { whatsapp: estado.numero, nome: "Zé" },
              error: null,
            };
          },
        }),
      }),
    }),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pedidoA: Order = {
  id: "aaaaaaaa-1111-4222-8333-000000000001",
  shippingOptionId: "local-delivery",
  customer: {
    name: "Cliente Fictícia A",
    whatsapp: "11912345678",
    address: "Rua Inventada",
    number: "12",
    neighborhood: "Centro",
    city: "São Paulo",
    state: "SP",
    cep: "01000-000",
  },
  items: [
    { productId: "p", name: "Caneca", quantity: 1, price: 25, image: "" },
  ],
  subtotal: 25,
  shipping: 8,
  discount: 0,
  total: 33,
  paymentMethod: "cash",
  status: "processing",
  createdAt: "",
  updatedAt: "",
  cancelledAfterShipping: false,
};
const pedidoB: Order = {
  ...pedidoA,
  id: "bbbbbbbb-1111-4222-8333-000000000002",
};

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  estado.numero = "5511987654321";
  estado.fila = [];
  estado.leituras = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function mostrar(order: Order) {
  const { EnviarAoMototaxi } = await import(
    "@/components/admin/orders/EnviarAoMototaxi"
  );
  await act(async () => {
    root.render(<EnviarAoMototaxi order={order} loja="Loja fictícia" />);
  });
}
const botao = () =>
  host.querySelector<HTMLButtonElement>('[aria-label="Enviar ao mototáxi"]');
const alerta = () => host.querySelector('[role="alert"]')?.textContent ?? null;

function segurarALeitura() {
  let liberar!: (numero: string | null) => void;
  let falhar!: () => void;
  const promise = new Promise((resolver) => {
    liberar = (numero) => resolver({ data: { whatsapp: numero }, error: null });
    falhar = () => resolver({ data: null, error: { message: "falha" } });
  });
  estado.fila.push(promise);
  return { liberar, falhar };
}

/** Aba falsa: `closed` só vira true se a aba for fechada de verdade (modelo do navegador). */
function abaFalsa(opcoes: { fechaDeVerdade: boolean }) {
  const navegar = vi.fn();
  const link = document.createElement("a");
  vi.spyOn(link, "click").mockImplementation(() => navegar(link.href));
  const aba = {
    opener: window as unknown,
    closed: false,
    close: vi.fn(() => {
      if (opcoes.fechaDeVerdade) aba.closed = true;
    }),
    document: { createElement: () => link, body: { append: vi.fn() } },
  };
  return { aba, navegar };
}
function proximaAba(aba: unknown) {
  return vi.spyOn(window, "open").mockReturnValue(aba as Window);
}

it("pop-up barrado: avisa onde permitir e não consulta o número nem envia nada", async () => {
  await mostrar(pedidoA);
  const leiturasAoAbrir = estado.leituras;
  const abrir = vi.spyOn(window, "open").mockReturnValue(null);
  await act(async () => botao()!.click());
  expect(abrir).toHaveBeenCalledOnce();
  expect(alerta()).toBe("Permita abrir uma nova aba para enviar ao mototáxi.");
  // Sem aba reservada não há consulta nenhuma (nada de ler contato à toa).
  expect(estado.leituras).toBe(leiturasAoAbrir);
  expect(botao()?.disabled).toBe(false);
  expect(botao()?.textContent).toContain("Enviar ao mototáxi");
});

it("durante a consulta o botão fica travado, com o texto de espera, e volta ao fim", async () => {
  await mostrar(pedidoA);
  const leitura = segurarALeitura();
  const { aba, navegar } = abaFalsa({ fechaDeVerdade: true });
  const abrir = proximaAba(aba);
  await act(async () => botao()!.click());
  expect(botao()?.disabled).toBe(true);
  expect(botao()?.textContent).toContain("Conferindo o número…");
  // Clique extra enquanto confere não abre segunda aba.
  await act(async () => botao()!.click());
  expect(abrir).toHaveBeenCalledOnce();
  await act(async () => leitura.liberar("5511987654321"));
  expect(navegar).toHaveBeenCalledOnce();
  expect(botao()?.disabled).toBe(false);
  expect(botao()?.textContent).toContain("Enviar ao mototáxi");
});

it("o aviso de uma falha antiga some assim que o clique seguinte começa", async () => {
  await mostrar(pedidoA);
  // 1º clique: o número foi apagado entre a abertura da ficha e o clique.
  estado.numero = null;
  const primeira = abaFalsa({ fechaDeVerdade: true });
  proximaAba(primeira.aba);
  await act(async () => botao()!.click());
  expect(alerta()).toBe("O mototáxi está sem um número cadastrado.");
  expect(primeira.aba.close).toHaveBeenCalledOnce();

  // 2º clique: número de volta; a leitura fica pendente para ver o meio do caminho.
  estado.numero = "5511987654321";
  const leitura = segurarALeitura();
  const segunda = abaFalsa({ fechaDeVerdade: true });
  proximaAba(segunda.aba);
  await act(async () => botao()!.click());
  expect(alerta()).toBeNull();
  await act(async () => leitura.liberar("5511987654321"));
  expect(segunda.navegar).toHaveBeenCalledOnce();
  expect(alerta()).toBeNull();
});

it("aba fechada pela lojista durante a consulta: nada é enviado nem escrito nela", async () => {
  await mostrar(pedidoA);
  const leitura = segurarALeitura();
  const { aba, navegar } = abaFalsa({ fechaDeVerdade: true });
  const append = aba.document.body.append;
  proximaAba(aba);
  await act(async () => botao()!.click());
  aba.closed = true; // a lojista fechou a aba pelo navegador
  await act(async () => leitura.liberar("5511987654321"));
  expect(navegar).not.toHaveBeenCalled();
  expect(append).not.toHaveBeenCalled();
  expect(alerta()).toBeNull();
});

it("trocar de pedido no meio da consulta fecha a aba, ignora a resposta e destrava o botão", async () => {
  await mostrar(pedidoA);
  const leitura = segurarALeitura();
  const { aba, navegar } = abaFalsa({ fechaDeVerdade: false });
  proximaAba(aba);
  await act(async () => botao()!.click());
  expect(botao()?.disabled).toBe(true);

  // A ficha passa a mostrar OUTRO pedido enquanto a leitura segue pendente.
  await mostrar(pedidoB);
  expect(aba.close).toHaveBeenCalledOnce();
  expect(botao()?.disabled).toBe(false);
  expect(botao()?.textContent).toContain("Enviar ao mototáxi");

  await act(async () => leitura.liberar("5511987654321"));
  // A resposta chegou para o pedido anterior: não pode abrir WhatsApp com ele.
  expect(navegar).not.toHaveBeenCalled();
  expect(alerta()).toBeNull();
});

it("fechar a ficha no meio da consulta fecha a aba reservada", async () => {
  await mostrar(pedidoA);
  const leitura = segurarALeitura();
  const { aba, navegar } = abaFalsa({ fechaDeVerdade: true });
  proximaAba(aba);
  await act(async () => botao()!.click());
  expect(aba.close).not.toHaveBeenCalled();
  act(() => root.render(<div />));
  expect(aba.close).toHaveBeenCalledOnce();
  await act(async () => leitura.liberar("5511987654321"));
  expect(navegar).not.toHaveBeenCalled();
});

it("o aviso de falha de um pedido não aparece na ficha do pedido seguinte", async () => {
  await mostrar(pedidoA);
  estado.numero = null;
  const { aba } = abaFalsa({ fechaDeVerdade: true });
  proximaAba(aba);
  await act(async () => botao()!.click());
  expect(alerta()).toBe("O mototáxi está sem um número cadastrado.");

  estado.numero = "5511987654321";
  await mostrar(pedidoB);
  expect(alerta()).toBeNull();
});

it("falha da consulta que chega depois de trocar de pedido não pinta aviso na ficha nova", async () => {
  await mostrar(pedidoA);
  const leitura = segurarALeitura();
  const { aba } = abaFalsa({ fechaDeVerdade: false });
  proximaAba(aba);
  await act(async () => botao()!.click());
  await mostrar(pedidoB);
  expect(aba.close).toHaveBeenCalledOnce();
  await act(async () => leitura.falhar());
  expect(alerta()).toBeNull();
  // A aba já tinha sido fechada ao trocar de pedido: não fecha de novo.
  expect(aba.close).toHaveBeenCalledOnce();
});

it.each(["cash", "pix", "card"] as const)(
  "pedido com pagamento na entrega (%s) já estornado não vai para o mototáxi",
  async (paymentMethod) => {
    await mostrar({
      ...pedidoA,
      paymentMethod,
      paymentStatus: "estornado",
      status: "processing",
    });
    expect(botao()).toBeNull();
    expect(host.textContent).not.toContain("Enviar ao mototáxi");
    // E o mesmo pedido, sem o estorno, é oferecido (o teste não é vazio).
    await mostrar({ ...pedidoA, paymentMethod, paymentStatus: null });
    expect(botao()).not.toBeNull();
  },
);

it("resposta atrasada do pedido anterior não destrava nem derruba a consulta do pedido atual", async () => {
  await mostrar(pedidoA);
  const leituraA = segurarALeitura();
  const abaA = abaFalsa({ fechaDeVerdade: false });
  proximaAba(abaA.aba);
  await act(async () => botao()!.click());

  await mostrar(pedidoB);
  const leituraB = segurarALeitura();
  const abaB = abaFalsa({ fechaDeVerdade: false });
  proximaAba(abaB.aba);
  await act(async () => botao()!.click());
  expect(botao()?.disabled).toBe(true);

  // A resposta do pedido A chega no meio da consulta do B.
  await act(async () => leituraA.liberar("5511987654321"));
  expect(abaA.navegar).not.toHaveBeenCalled();
  expect(botao()?.disabled).toBe(true);
  expect(botao()?.textContent).toContain("Conferindo o número…");
  expect(abaB.aba.close).not.toHaveBeenCalled();

  await act(async () => leituraB.liberar("5511987654321"));
  expect(abaB.navegar).toHaveBeenCalledOnce();
  expect(abaA.navegar).not.toHaveBeenCalled();
  expect(botao()?.disabled).toBe(false);
});
