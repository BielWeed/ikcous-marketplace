// @vitest-environment jsdom
import { EstornoCard } from "@/components/admin/orders/EstornoCard";
import { EtiquetaDoPedidoCard } from "@/components/admin/orders/EtiquetaDoPedidoCard";
import { OrderDetail } from "@/components/admin/orders/OrderDetail";
import type { PedidoParaEtiqueta } from "@/lib/elegibilidade-da-etiqueta";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { consulta, invoke } = vi.hoisted(() => ({
  consulta: {
    data: null as PedidoParaEtiqueta | null,
    error: null as { message: string } | null,
  },
  invoke: vi.fn(),
}));

// Só as fronteiras de rede: estados e cliques da etiqueta são os reais.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => consulta }),
      }),
    }),
    functions: { invoke },
  },
}));
vi.mock("@/hooks/useEstornosDoPedido", () => ({
  useEstornosDoPedido: () => ({
    erro: "Falha de leitura",
    recarregar: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pedido: Order = {
  id: "pedido-cores",
  customer: {
    name: "Cliente Teste",
    whatsapp: "",
    address: "Rua de Teste",
    number: "123",
    neighborhood: "Centro",
    city: "Cidade Teste",
    state: "MG",
  },
  items: [],
  subtotal: 100,
  shipping: 20,
  discount: 10,
  total: 110,
  paymentMethod: "pix",
  paymentStatus: "pago",
  status: "processing",
  cancelledAfterShipping: false,
  createdAt: "2026-10-20T12:00:00Z",
  updatedAt: "2026-10-20T12:00:00Z",
};

function pedidoDaEtiqueta(
  extra: Partial<PedidoParaEtiqueta> = {},
): PedidoParaEtiqueta {
  return {
    id: pedido.id,
    status: "processing",
    payment_status: "pago",
    shipping: 20,
    shipping_cost: null,
    tracking_code: null,
    shipping_label_id: null,
    shipping_label_url: null,
    notes: null,
    shipping_option_id: "melhor-envio-3",
    cpf: "52998224725",
    ...extra,
  };
}

// Voltar qualquer fundo/borda semântica nestes avisos reprova o DOM real.
// Botões continuam fora da decisão visual desta onda; branco/cinza são neutros.
function recipienteNeutro(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  const aviso = el!;
  const classes = [aviso, ...aviso.querySelectorAll("*")].flatMap((no) =>
    [...no.classList].filter(() => !no.closest("button, a")),
  );
  expect(
    classes.filter((classe) =>
      /^(?:bg|border)-(?:red|rose|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|pink)-\d+/.test(
        classe,
      ),
    ),
  ).toEqual([]);
  expect(aviso.classList.contains("border-admin-border")).toBe(true);
  expect(aviso.classList.contains("bg-admin-surface")).toBe(true);
}

function estatico(elemento: Parameters<typeof renderToStaticMarkup>[0]) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(elemento);
  return host;
}

describe("onda 2a — avisos da ficha com cor só no texto/glifo", () => {
  it("cancelamento mantém o texto e o glifo vermelho em recipiente neutro", () => {
    const host = estatico(
      <OrderDetail
        order={{ ...pedido, status: "cancelled" }}
        onStatusChange={vi.fn()}
      />,
    );
    const titulo = [...host.querySelectorAll("p")].find(
      (el) => el.textContent === "Pedido cancelado",
    )!;
    recipienteNeutro(titulo.parentElement?.parentElement);
    expect(titulo.classList.contains("text-red-400")).toBe(true);
    expect(
      titulo.parentElement?.parentElement?.querySelector("svg.text-red-400"),
    ).not.toBeNull();
    expect(host.textContent).toContain(
      "Este pedido foi cancelado e não pode prosseguir.",
    );
  });

  it("retirada conserva rótulo e endereço sem pintar a caixa", () => {
    const host = estatico(
      <OrderDetail
        order={{
          ...pedido,
          retiradaNaLoja: true,
          enderecoDeRetirada: "Rua de Teste, 456",
        }}
        onStatusChange={vi.fn()}
      />,
    );
    const aviso = host.querySelector('[aria-label="Retirada na loja"]');
    recipienteNeutro(aviso);
    expect(aviso?.textContent).toContain(
      "A cliente busca o pedido em: Rua de Teste, 456",
    );
    expect(aviso?.querySelector("p.text-emerald-400")?.textContent).toBe(
      "Retirada na loja",
    );
  });

  it("código do cupom mantém o desconto sem chip pintado", () => {
    const host = estatico(
      <OrderDetail
        order={{ ...pedido, couponCode: "TESTE10" }}
        onStatusChange={vi.fn()}
      />,
    );
    const codigo = [...host.querySelectorAll("span")].find(
      (el) => el.textContent === "TESTE10",
    );
    recipienteNeutro(codigo);
    expect(codigo?.parentElement?.parentElement?.textContent).toContain(
      "- R$ 10,00",
    );
  });

  it("erro de leitura dos estornos continua vermelho sem caixa vermelha", () => {
    const host = estatico(<EstornoCard order={pedido} />);
    recipienteNeutro(host.firstElementChild);
    expect(host.querySelector("p.text-red-400")?.textContent).toContain(
      "Não consegui carregar as devoluções deste pedido.",
    );
    expect(host.querySelector("button")?.textContent).toBe(
      "Tentar carregar de novo",
    );
  });
});

describe("onda 2a — estados reais da etiqueta", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    consulta.data = pedidoDaEtiqueta();
    consulta.error = null;
    invoke.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  async function montar() {
    await act(async () => {
      raiz.render(
        <EtiquetaDoPedidoCard orderId={pedido.id} isOffline={false} />,
      );
    });
  }

  async function clicar(texto: string) {
    const botao = [...host.querySelectorAll("button")].find(
      (el) => el.textContent?.trim() === texto,
    );
    expect(botao, texto).toBeDefined();
    await act(async () => botao!.click());
  }

  it("erro da consulta mantém nova tentativa sem fundo vermelho", async () => {
    consulta.error = { message: "Falha simulada" };
    vi.spyOn(console, "error").mockImplementation(() => {});
    await montar();
    const botao = [...host.querySelectorAll("button")].find(
      (el) => el.textContent?.trim() === "Tentar de novo",
    );
    recipienteNeutro(botao?.parentElement);
    expect(botao?.parentElement?.classList.contains("text-red-400")).toBe(true);
  });

  it.each([null, "123"])(
    "CPF %s pede correção em caixa neutra",
    async (cpf) => {
      consulta.data = pedidoDaEtiqueta({ cpf });
      await montar();
      const aviso = host.querySelector('[data-testid="precisa-cpf"]');
      recipienteNeutro(aviso);
      expect(aviso?.textContent).toContain("O Melhor Envio exige o CPF");
      expect(aviso?.querySelector("svg.text-amber-400")).not.toBeNull();
      if (cpf)
        expect(aviso?.textContent).toContain(
          "O CPF salvo neste pedido é inválido",
        );
    },
  );

  it("confirmação de compra usa âmbar só na mensagem e glifo", async () => {
    await montar();
    await clicar("Gerar etiqueta");
    const aviso = host
      .querySelector('[data-testid="cpf-mascarado"]')
      ?.closest("div");
    recipienteNeutro(aviso);
    expect(aviso?.textContent).toContain(
      "A etiqueta é comprada com o saldo da SUA conta",
    );
    expect(aviso?.querySelector("svg.text-amber-400")).not.toBeNull();
  });

  it.each(["emitida", "sucesso", "already"] as const)(
    "etiqueta %s tem confirmação verde em caixa neutra",
    async (estado) => {
      if (estado === "emitida") {
        consulta.data = pedidoDaEtiqueta({
          shipping_label_id: "etiqueta-teste",
        });
      } else {
        invoke.mockResolvedValue({
          data: { label_id: "etiqueta-teste", already: estado === "already" },
          error: null,
        });
      }
      await montar();
      if (estado !== "emitida") {
        await clicar("Gerar etiqueta");
        await clicar("Confirmar e gerar");
      }
      const titulo = [...host.querySelectorAll("span")].find(
        (el) =>
          el.textContent ===
          (estado === "emitida"
            ? "Etiqueta emitida"
            : estado === "sucesso"
              ? "Etiqueta gerada e vinculada ao pedido!"
              : "Este pedido já tinha etiqueta — nada foi comprado de novo."),
      )!;
      recipienteNeutro(titulo?.parentElement?.parentElement);
      expect(
        titulo?.parentElement?.classList.contains("text-emerald-400"),
      ).toBe(true);
      expect(titulo?.parentElement?.querySelector("svg")).not.toBeNull();
    },
  );

  it("falha de geração persiste vermelha sem fundo/borda de erro", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    invoke.mockResolvedValue({
      data: null,
      error: {
        context: { json: async () => ({ error: "Saldo insuficiente." }) },
      },
    });
    await montar();
    await clicar("Gerar etiqueta");
    await clicar("Confirmar e gerar");
    const aviso = host.querySelector('[data-testid="erro-etiqueta"]');
    recipienteNeutro(aviso);
    expect(aviso?.textContent).toBe("Saldo insuficiente.");
    expect(aviso?.classList.contains("text-red-400")).toBe(true);
  });
});
