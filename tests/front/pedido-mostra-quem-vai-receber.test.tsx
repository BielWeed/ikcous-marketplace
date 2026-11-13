import type { Order } from "@/types";
// @vitest-environment jsdom
// "Quem vai receber" chega ao painel (13/11/2026). A cliente digita o nome de quem recebe no endereço; a migration
// 20261399997000 o copia para `customer_data.address.recipient_name` do pedido. A ficha do pedido mostra "Recebe: X"
// SÓ quando o pedido tem esse nome e ele é de OUTRA pessoa (a comparação ignora acento, caixa e espaço sobrando).
// O mapper lê o nome SÓ do retrato do pedido: o endereço ATUAL da conta (o JOIN) pode ter sido editado depois da compra.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ update: () => ({ eq: vi.fn() }) }),
    functions: { invoke: vi.fn() },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/admin/orders/EtiquetaDoPedidoCard", () => ({
  EtiquetaDoPedidoCard: () => null,
}));
vi.mock("@/components/admin/orders/EstornoCard", () => ({
  EstornoCard: () => null,
}));
vi.mock("@/components/admin/orders/DevolucaoDoPedidoAdminCard", () => ({
  DevolucaoDoPedidoAdminCard: () => null,
}));
import { OrderDetail } from "@/components/admin/orders/OrderDetail";
import { mapOrderFromDB } from "@/lib/mappers";
import { quemVaiReceberSeForOutro } from "@/lib/quem-vai-receber";

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ENDERECO = {
  cep: "38500-100",
  street: "Rua da Prova",
  number: "10",
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
};

function linhaDoBanco(
  address: Record<string, unknown> | null,
  extra: Record<string, unknown> = {},
) {
  return {
    id: "pedido-1",
    user_id: "user-1",
    customer_name: "Maria Souza",
    customer_data: { whatsapp: "34999999999", address, ...extra },
    total: 100,
    subtotal: 100,
    shipping: 0,
    discount: 0,
    payment_method: "pix",
    payment_status: "pago",
    status: "processing",
    created_at: "2026-11-13T10:00:00Z",
    updated_at: "2026-11-13T10:00:00Z",
    items: [],
  } as any;
}

function pedidoDaFicha(
  comprador: string,
  recipientName: string | undefined,
): Order {
  return {
    id: "pedido-1",
    customer: {
      name: comprador,
      whatsapp: "34999999999",
      address: "Rua da Prova",
      number: "10",
      neighborhood: "Centro",
      city: "Monte Carmelo",
      state: "MG",
      cep: "38500-100",
      ...(recipientName === undefined ? {} : { recipientName }),
    },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    paymentStatus: "pago",
    status: "processing",
    createdAt: "2026-11-13T10:00:00Z",
    updatedAt: "2026-11-13T10:00:00Z",
    cancelledAfterShipping: false,
  } as Order;
}

describe("quemVaiReceberSeForOutro — só devolve o nome quando é outra pessoa", () => {
  it("outra pessoa: devolve o nome aparado e sem espaço duplo", () => {
    expect(quemVaiReceberSeForOutro("Maria Souza", "Ana Presente")).toBe(
      "Ana Presente",
    );
    expect(quemVaiReceberSeForOutro("Maria Souza", "  Ana   Presente ")).toBe(
      "Ana Presente",
    );
  });
  it("a mesma pessoa (sem acento, sem caixa, com espaço sobrando) não aparece", () => {
    expect(quemVaiReceberSeForOutro("José Antônio", "jose  ANTONIO")).toBe("");
    expect(quemVaiReceberSeForOutro("Maria Souza", " maria souza ")).toBe("");
    expect(quemVaiReceberSeForOutro("Conceição", "CONCEICAO")).toBe("");
  });
  it("nome parecido mas diferente aparece (Souza x Sousa)", () => {
    expect(quemVaiReceberSeForOutro("Maria Souza", "Maria Sousa")).toBe(
      "Maria Sousa",
    );
  });
  it("sem nome, vazio, só espaços ou nulo: nada", () => {
    expect(quemVaiReceberSeForOutro("Maria", undefined)).toBe("");
    expect(quemVaiReceberSeForOutro("Maria", null)).toBe("");
    expect(quemVaiReceberSeForOutro("Maria", "")).toBe("");
    expect(quemVaiReceberSeForOutro("Maria", "   ")).toBe("");
  });
  it("comprador sem nome: quem recebe aparece", () => {
    expect(quemVaiReceberSeForOutro(undefined, "Ana Presente")).toBe(
      "Ana Presente",
    );
    expect(quemVaiReceberSeForOutro("", "Ana Presente")).toBe("Ana Presente");
  });
});

describe("mapOrderFromDB — customer.recipientName vem SÓ do retrato do pedido", () => {
  it("retrato com recipient_name: o nome aparado chega a customer.recipientName e o resto do endereço é o de sempre", () => {
    const o = mapOrderFromDB(
      linhaDoBanco({ ...ENDERECO, recipient_name: "  Ana Presente " }),
    );
    expect(o.customer.recipientName).toBe("Ana Presente");
    expect(o.customer.name).toBe("Maria Souza");
    expect(o.customer.address).toBe("Rua da Prova");
    expect(o.customer.cep).toBe("38500-100");
  });
  it("addressData (o formato antigo do retrato) também vale", () => {
    const o = mapOrderFromDB(
      linhaDoBanco(null, {
        addressData: { ...ENDERECO, recipient_name: "Ana Presente" },
      }),
    );
    expect(o.customer.recipientName).toBe("Ana Presente");
  });
  it.each([
    ["sem a chave (pedido antigo)", { ...ENDERECO }],
    ["só espaços", { ...ENDERECO, recipient_name: "   " }],
    ["nulo", { ...ENDERECO, recipient_name: null }],
    ["número", { ...ENDERECO, recipient_name: 42 }],
  ])("%s: sem recipientName", (_rotulo, address) => {
    const o = mapOrderFromDB(linhaDoBanco(address as any));
    expect(o.customer.recipientName).toBeUndefined();
    expect("recipientName" in o.customer).toBe(false);
  });
  it("pedido sem retrato: o endereço ATUAL da conta (JOIN) não empresta o nome (a linha pode ter mudado depois da compra)", () => {
    const linha = linhaDoBanco(null);
    linha.address = { ...ENDERECO, recipient_name: "Nome Digitado Depois" };
    const o = mapOrderFromDB(linha);
    expect(o.customer.address).toBe("Rua da Prova"); // o endereço ainda vem do JOIN, como sempre
    expect(o.customer.recipientName).toBeUndefined();
  });
  it("o nome solto na raiz do customer_data não conta: só o do endereço", () => {
    const o = mapOrderFromDB(
      linhaDoBanco({ ...ENDERECO }, { recipient_name: "Raiz Nao Conta" }),
    );
    expect(o.customer.recipientName).toBeUndefined();
  });
});

describe("ficha do pedido — 'Recebe: X'", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });
  const abrir = async (order: Order) => {
    await act(async () => {
      raiz.render(<OrderDetail onStatusChange={vi.fn()} order={order} />);
    });
    return host.querySelector('[data-testid="bloco-entrega"]') as HTMLElement;
  };

  it("outra pessoa recebe: a ficha mostra 'Recebe: Ana Presente', ao lado do endereço de entrega", async () => {
    const bloco = await abrir(pedidoDaFicha("Maria Souza", "Ana Presente"));
    const linha = bloco.querySelector('[data-testid="pedido-quem-recebe"]');
    expect(linha).not.toBeNull();
    expect(linha!.textContent).toBe("Recebe: Ana Presente");
    // fica no bloco do endereço de entrega, depois do endereço
    expect(bloco.textContent).toContain("Endereço de entrega");
    expect(
      bloco.textContent!.indexOf("Rua da Prova") <
        bloco.textContent!.indexOf("Recebe: Ana Presente"),
    ).toBe(true);
  });

  it.each([
    [
      "a mesma pessoa, com acento e caixa diferentes",
      "José Antônio",
      "jose ANTONIO",
    ],
    ["a mesma pessoa, com espaço sobrando", "Maria Souza", "  Maria   Souza "],
  ])("%s: nada de 'Recebe'", async (_r, comprador, recebe) => {
    const bloco = await abrir(pedidoDaFicha(comprador, recebe));
    expect(
      bloco.querySelector('[data-testid="pedido-quem-recebe"]'),
    ).toBeNull();
    expect(bloco.textContent).not.toContain("Recebe:");
  });

  it("pedido sem nome de quem recebe (antigo ou sem digitar): nada de 'Recebe' e o resto da ficha segue", async () => {
    const bloco = await abrir(pedidoDaFicha("Maria Souza", undefined));
    expect(
      bloco.querySelector('[data-testid="pedido-quem-recebe"]'),
    ).toBeNull();
    expect(bloco.textContent).toContain("Maria Souza");
    expect(bloco.textContent).toContain("Rua da Prova");
  });

  it("do banco à tela: o retrato do pedido com outro nome vira 'Recebe: …' na ficha real", async () => {
    const order = mapOrderFromDB(
      linhaDoBanco({ ...ENDERECO, recipient_name: "Ana Presente" }),
    );
    const bloco = await abrir(order);
    expect(
      bloco.querySelector('[data-testid="pedido-quem-recebe"]')?.textContent,
    ).toBe("Recebe: Ana Presente");
  });

  it("do banco à tela: retrato com o MESMO nome do comprador não mostra 'Recebe'", async () => {
    const order = mapOrderFromDB(
      linhaDoBanco({ ...ENDERECO, recipient_name: "maria souza" }),
    );
    const bloco = await abrir(order);
    expect(
      bloco.querySelector('[data-testid="pedido-quem-recebe"]'),
    ).toBeNull();
  });
});
