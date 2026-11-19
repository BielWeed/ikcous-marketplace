// @vitest-environment jsdom

import { CheckoutView } from "@/views/customer/CheckoutView";
import { StrictMode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comReleituraDeEnderecos } from "./duble-releitura-de-enderecos";

const createOrder = vi.fn();
const validateCoupon = vi.fn();
const sessaoAindaEhDoDono = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const CHAVE_RASCUNHO = "ikcous-rascunho-do-checkout-v1";
const entrega = {
  id: "local-delivery",
  name: "Entrega local",
  price: 0,
  deliveryDays: 1,
  provider: "local",
};
const endereco = {
  id: "addr-1",
  user_id: "user-1",
  name: "Casa",
  recipient_name: "Cliente Teste",
  cep: "38500-000",
  street: "Rua Teste",
  number: "100",
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  is_default: true,
};
const enderecos = [endereco];
const usuario = { id: "user-1" };
let total = 76.5;
let formas: string[];
let cuponsLigados = false;
let opcaoDeFrete = entrega;

vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: () => sessaoAindaEhDoDono(),
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      enableCoupons: cuponsLigados,
      formasPagamentoEntrega: formas,
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () =>
    comReleituraDeEnderecos({
      addresses: enderecos,
      loading: false,
    }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [
        {
          product: {
            id: "prod-1",
            name: "Produto Teste",
            price: total,
            images: [],
            stock: 10,
          },
          quantity: 1,
        },
      ],
      cartTotal: total,
      shippingFee: 0,
      selectedShippingOption: opcaoDeFrete,
      shippingCep: endereco.cep,
      clearCart: vi.fn(),
      renovarCarrinhoPeloCatalogo: async () => {},
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon }),
}));

vi.mock("@/hooks/useOrders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useOrders")>()),
  useOrders: () => ({ createOrder }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => false,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { ESTADO_PRONTO_SEM_CARTAO } = await import(
    "./duble-use-config-do-cartao"
  );
  return { useConfigDoCartao: () => ESTADO_PRONTO_SEM_CARTAO };
});

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(campo: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(campo),
    "value",
  )?.set;
  setter?.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CheckoutView — troco para pagamento em dinheiro", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const nota = () =>
    hospedeiro.querySelector<HTMLTextAreaElement>("#order-notes")!;
  const campo = () =>
    hospedeiro.querySelector<HTMLInputElement>("#checkout-valor-para-troco")!;
  const aviso = () => hospedeiro.querySelector("#checkout-aviso-troco")!;
  const escolha = (valor: string) =>
    hospedeiro.querySelector<HTMLInputElement>(
      `input[name="checkout-troco"][value="${valor}"]`,
    )!;
  const botao = (texto: string, dentroDe: ParentNode = hospedeiro) =>
    [...dentroDe.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    )!;
  const finalizar = () => botao("Finalizar Pedido", document.body);

  beforeEach(() => {
    onNavigate.mockClear();
    total = 76.5;
    formas = ["pix", "cash"];
    cuponsLigados = false;
    opcaoDeFrete = entrega;
    validateCoupon
      .mockReset()
      .mockResolvedValue({ valid: true, discount: total });
    createOrder.mockReset().mockResolvedValue({ id: "ped-1" });
    sessaoAindaEhDoDono.mockReset().mockResolvedValue(true);
    vi.stubGlobal("scrollTo", vi.fn());
    vi.useFakeTimers();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    localStorage.clear();
    sessionStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function renderizar(modoEstrito = false) {
    const checkout = (
      <CheckoutView
        onNavigate={onNavigate}
        onSetBackOverride={onSetBackOverride}
      />
    );
    await act(async () => {
      raiz.render(modoEstrito ? <StrictMode>{checkout}</StrictMode> : checkout);
    });
  }

  async function montar() {
    await renderizar();
    await act(async () => {
      digitar(
        hospedeiro.querySelector<HTMLInputElement>("#checkout-name")!,
        "Cliente Teste",
      );
      digitar(
        hospedeiro.querySelector<HTMLInputElement>("#checkout-tel")!,
        "34999999999",
      );
      await vi.advanceTimersByTimeAsync(420);
    });
    expect(finalizar().disabled).toBe(false);
  }

  async function pedirTroco(valor: string) {
    act(() => botao("Dinheiro na Entrega").click());
    expect(hospedeiro.textContent).toContain("Precisa de troco?");
    expect(escolha("nao").checked).toBe(true);
    act(() => escolha("sim").click());
    if (valor) act(() => digitar(campo(), valor));
  }

  async function enviar() {
    expect(finalizar().disabled).toBe(false);
    await act(async () => {
      finalizar().click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(createOrder).toHaveBeenCalledTimes(1);
    return createOrder.mock.calls[0][0];
  }

  it("só pergunta quando dinheiro está selecionado; Não é o padrão", async () => {
    await montar();
    expect(hospedeiro.textContent).not.toContain("Precisa de troco?");
    act(() => botao("Dinheiro na Entrega").click());
    expect(hospedeiro.textContent).toContain("Precisa de troco?");
    expect(escolha("nao").checked).toBe(true);
    expect(campo()).toBeNull();
    expect(finalizar().disabled).toBe(false);
  });

  it("explica no campo que o valor para troco deve superar o total", async () => {
    await montar();
    await pedirTroco("");
    expect(campo().placeholder).toBe("Valor maior que o total do pedido");
  });

  it("não pergunta na retirada quando a loja só oferece Pix", async () => {
    formas = ["pix"];
    opcaoDeFrete = { ...entrega, id: "store-pickup", provider: "pickup" };
    await renderizar();
    expect(botao("Pix na Retirada")).toBeDefined();
    expect(botao("Dinheiro na Retirada")).toBeUndefined();
    expect(hospedeiro.textContent).not.toContain("Precisa de troco?");
  });

  it.each([
    [76.5, "100", "Troco para R$ 100,00 (levar R$ 23,50)"],
    [19.9, "20", "Troco para R$ 20,00 (levar R$ 0,10)"],
    [19.9, "20,10", "Troco para R$ 20,10 (levar R$ 0,20)"],
    [19.9, "20.10", "Troco para R$ 20,10 (levar R$ 0,20)"],
    [10_000, "10.000,01", "Troco para R$ 10.000,01 (levar R$ 0,01)"],
  ])(
    "com total %s e pagamento %s, envia o troco antes da nota",
    async (preco, valor, prefixo) => {
      total = preco;
      await montar();
      await pedirTroco(valor);
      act(() => digitar(nota(), "Tocar a campainha.\nO portão é azul."));
      const pedido = await enviar();
      expect(pedido).toMatchObject({
        totalAmount: preco,
        paymentMethod: "cash",
      });
      expect(
        pedido.notes.startsWith(
          `${prefixo}\nTocar a campainha.\nO portão é azul.`,
        ),
      ).toBe(true);
    },
  );

  it.each(["", "0", "76.49", "76,50", "abc", "1000000000,00"])(
    "bloqueia valor inválido (%j) e anuncia o motivo junto ao campo",
    async (valor) => {
      await montar();
      await pedirTroco("100");
      const regiao = aviso();
      expect(regiao.textContent).toBe("");
      act(() => digitar(campo(), valor));
      expect(aviso()).toBe(regiao);
      expect(regiao.textContent).toMatch(/valor|troco/i);
      expect(finalizar().disabled).toBe(true);
      act(() => finalizar().click());
      expect(createOrder).not.toHaveBeenCalled();
    },
  );

  it.each(["Pix na Entrega", "Não"])(
    "escolher %s tira o prefixo sem apagar a nota",
    async (mudanca) => {
      await montar();
      await pedirTroco("100");
      act(() => {
        digitar(nota(), "Deixar na portaria.");
        if (mudanca === "Não") escolha("nao").click();
        else botao(mudanca).click();
      });
      expect(campo()).toBeNull();
      const pedido = await enviar();
      expect(pedido.notes).toMatch(/^Deixar na portaria\./);
      expect(pedido.notes).not.toContain("Troco para");
    },
  );

  it("não envia o troco antigo se a forma de pagamento mudar antes do envio", async () => {
    await montar();
    await pedirTroco("100");
    let liberarSessao: (vale: boolean) => void = () => {};
    sessaoAindaEhDoDono.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        liberarSessao = resolve;
      }),
    );
    await act(async () => {
      finalizar().click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(sessaoAindaEhDoDono).toHaveBeenCalledTimes(1);
    expect(createOrder).not.toHaveBeenCalled();

    act(() => botao("Pix na Entrega").click());
    await act(async () => liberarSessao(true));
    expect(createOrder).not.toHaveBeenCalled();
    const pedido = await enviar();
    expect(pedido.paymentMethod).toBe("pix");
    expect(pedido.notes ?? "").not.toContain("Troco para");
  });

  it.each(["100", ""])(
    "cupom que zera o pedido desliga o troco com Sim marcado e valor %j",
    async (valor) => {
      formas = ["cash"];
      cuponsLigados = true;
      await montar();
      await pedirTroco(valor);
      act(() => digitar(nota(), "Deixar na portaria."));
      await act(async () => {
        digitar(
          hospedeiro.querySelector<HTMLInputElement>("#coupon-code-input")!,
          "CUPOM100",
        );
      });
      await act(async () => {
        botao("Aplicar").click();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(validateCoupon).toHaveBeenCalled();
      expect(
        hospedeiro.querySelector('[data-testid="checkout-pedido-sem-valor"]'),
      ).not.toBeNull();
      expect(botao("Dinheiro na Entrega").getAttribute("aria-checked")).toBe(
        "true",
      );

      expect(hospedeiro.textContent).not.toContain("Precisa de troco?");
      const pedido = await enviar();
      expect(pedido).toMatchObject({ totalAmount: 0, couponCode: "CUPOM100" });
      expect(pedido.notes).toMatch(/^Deixar na portaria\./);
      expect(pedido.notes).not.toContain("Troco para");
    },
  );

  it("ao trocar de entrega para retirada em dinheiro, ignora o troco", async () => {
    await montar();
    await pedirTroco("100");
    opcaoDeFrete = { ...entrega, id: "store-pickup", provider: "pickup" };
    await renderizar();

    expect(botao("Dinheiro na Retirada").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(hospedeiro.textContent).not.toContain("Precisa de troco?");
    const pedido = await enviar();
    expect(pedido).toMatchObject({ totalAmount: 76.5, paymentMethod: "cash" });
    expect(pedido.notes ?? "").not.toContain("Troco para");
  });

  it("revalida o valor e refaz a conta quando muda o total", async () => {
    await montar();
    await pedirTroco("100");
    total = 100;
    await renderizar();
    expect(aviso().textContent).toMatch(/maior.*total/i);
    expect(finalizar().disabled).toBe(true);

    total = 89.9;
    await renderizar();
    expect(aviso().textContent).toBe("");
    const pedido = await enviar();
    expect(pedido.notes).toMatch(/^Troco para R\$ 100,00 \(levar R\$ 10,10\)/);
  });

  async function reabrirComTotal(novoTotal: number) {
    act(() => raiz.unmount());
    total = novoTotal;
    raiz = createRoot(hospedeiro);
    await renderizar(true);
    await act(async () => vi.advanceTimersByTimeAsync(420));
  }

  it.each([
    [60, "Troco para R$ 100,00 (levar R$ 40,00)"],
    [100, "Troco para R$ 100,00 (levar R$ 0,00)"],
  ])(
    "restaura o troco e recalcula a nota para o total de %s",
    async (preco, prefixo) => {
      total = 80;
      await montar();
      await pedirTroco("100");
      act(() => digitar(nota(), "Deixar na portaria."));

      createOrder.mockRejectedValueOnce({
        code: "P0001",
        message: "Estoque insuficiente para o produto Teste",
      });
      await act(async () => {
        finalizar().click();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(createOrder).toHaveBeenCalledTimes(1);
      await act(async () => {
        document
          .querySelector<HTMLButtonElement>(
            'button[data-acao="ajustar_estoque"]',
          )!
          .click();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(onNavigate).toHaveBeenCalledWith("cart");
      createOrder.mockClear();
      await reabrirComTotal(preco);

      expect(escolha("sim")?.checked).toBe(true);
      expect(campo().value).toBe("100");
      expect(aviso().textContent).toBe("");
      expect(sessionStorage.getItem(CHAVE_RASCUNHO)).not.toBeNull();
      expect(await enviar()).toMatchObject({
        paymentMethod: "cash",
        totalAmount: preco,
        notes: expect.stringContaining(`${prefixo}\nDeixar na portaria.`),
      });
      expect(sessionStorage.getItem(CHAVE_RASCUNHO)).toBeNull();
    },
  );

  it("pede para corrigir o troco restaurado se o valor não cobrir o novo total", async () => {
    await montar();
    await pedirTroco("100");

    await reabrirComTotal(110);

    expect(escolha("sim")?.checked).toBe(true);
    expect(campo().value).toBe("100");
    expect(campo().getAttribute("aria-invalid")).toBe("true");
    expect(aviso().textContent).toMatch(/valor.*total/i);
    expect(finalizar().disabled).toBe(true);
    act(() => finalizar().click());
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("descarta o troco se dinheiro deixou de estar disponível", async () => {
    await montar();
    await pedirTroco("100");
    expect(
      JSON.parse(sessionStorage.getItem(CHAVE_RASCUNHO) ?? "{}"),
    ).toMatchObject({
      trocoPara: "100",
    });
    formas = ["pix"];

    await reabrirComTotal(60);

    expect(botao("Pix na Entrega").getAttribute("aria-checked")).toBe("true");
    expect(campo()).toBeNull();
    formas = ["pix", "cash"];
    await reabrirComTotal(60);
    await pedirTroco("");
    expect(campo().value).toBe("");
  });

  it("não troca o pagamento ao reabrir um rascunho sem troco", async () => {
    await montar();
    act(() => digitar(nota(), "Deixar na portaria."));

    await reabrirComTotal(60);

    expect(botao("Pix na Entrega").getAttribute("aria-checked")).toBe("true");
    expect(campo()).toBeNull();
    const pedido = await enviar();
    expect(pedido.notes).toMatch(/^Deixar na portaria\./);
    expect(pedido.notes).not.toContain("Troco para");
  });

  it("reserva espaço na nota e preserva o prefixo mesmo com a nota já cheia", async () => {
    await montar();
    const textoLongo = `${"x".repeat(457)}🚪${"y".repeat(41)}`;
    act(() => digitar(nota(), textoLongo));
    expect(nota().maxLength).toBe(500);
    await pedirTroco("100");
    const prefixo = "Troco para R$ 100,00 (levar R$ 23,50)\n";
    expect(nota().maxLength).toBe(500 - prefixo.length);
    expect(nota().value).toBe(textoLongo);
    const pedido = await enviar();
    const [primeiraLinha, notaEnviada] = pedido.notes.split("\n");
    expect(`${primeiraLinha}\n`).toBe(prefixo);
    expect(notaEnviada.length).toBeLessThanOrEqual(500 - prefixo.length);
    expect(notaEnviada).toMatch(/^x{457}🚪y+…$/u);
  });
});
