// @vitest-environment jsdom
//
// Laudo 0109 (B2): o comprovante do pedido "na entrega" (o caminho padrão)
// saía SÓ pela chamada fire-and-forget do navegador na hora da compra — aba
// fechada ou rede caída no segundo errado e o e-mail nunca chegava, sem
// retry e sem ninguém (cliente nem loja) ficar sabendo.
//
// O conserto é o botão "Reenviar comprovante por e-mail" na FICHA do pedido.
// A trava de "um e-mail por pedido" continua sendo a MESMA RPC do banco
// (`reivindicar_email_de_confirmacao`) — o que este teste prende é a tela
// contar a verdade sobre cada desfecho:
//   ok:true            → confirma o reenvio;
//   motivo:ja_enviado  → diz que JÁ foi enviado (não finge que reenviou);
//   motivo:sem_remetente → diz que a loja não configurou e-mail;
//   falha              → avisa que não deu agora.
//
// Molde de montagem: tests/front/notificacoes-acao-que-falha-avisa-a-cliente
// .test.tsx (createRoot + act, sem @testing-library; hooks dublês com
// IDENTIDADES estáveis para o efeito de carga não disparar em laço).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";
import { OrderDetailsView } from "@/views/customer/OrderDetailsView";

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastNeutro = vi.fn();
const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign((...args: unknown[]) => toastNeutro(...args), {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    info: (...args: unknown[]) => toastInfo(...args),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

const reenviarComprovante = vi.fn();
const fetchUserOrders = vi.fn();
const updateOrderStatus = vi.fn();

const usuarioDeTeste = { user: { id: "cliente-1" } };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => usuarioDeTeste,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { whatsappNumber: "" } }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [],
    fetchUserOrders,
    updateOrderStatus,
    reenviarComprovante,
  }),
}));

const pedido: Order = {
  id: "pedido-1",
  status: "processing",
  paymentStatus: null,
  paymentMethod: "cash",
  createdAt: new Date("2026-09-01T12:00:00Z").toISOString(),
  customer: { name: "Cliente", phone: "" },
  deliveryAddress: null,
  subtotal: 100,
  shipping: 10,
  discount: 0,
  total: 110,
  items: [
    {
      productId: "produto-1",
      name: "Produto",
      image: "",
      quantity: 1,
      price: 100,
    },
  ],
} as unknown as Order;

let container: HTMLElement | null = null;
let root: Root | null = null;

async function montarFicha() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <OrderDetailsView
        orderId="pedido-1"
        onBack={() => {}}
        onNavigate={() => {}}
      />,
    );
  });
  await act(async () => {});
}

function acharBotaoReenvio(): HTMLButtonElement | null {
  const botoes = container?.querySelectorAll("button") || [];
  for (const botao of botoes) {
    if (botao.textContent?.includes("Reenviar comprovante")) return botao;
  }
  return null;
}

beforeEach(() => {
  toastSuccess.mockClear();
  toastError.mockClear();
  toastNeutro.mockClear();
  toastInfo.mockClear();
  reenviarComprovante.mockReset();
  fetchUserOrders.mockResolvedValue([pedido]);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
});

describe("botão reenviar comprovante na ficha do pedido", () => {
  it("o botão existe e chama o reenvio com o id do pedido", async () => {
    reenviarComprovante.mockResolvedValue({ ok: true });
    await montarFicha();

    const botao = acharBotaoReenvio();
    expect(botao).not.toBeNull();

    await act(async () => {
      botao?.click();
    });

    expect(reenviarComprovante).toHaveBeenCalledWith("pedido-1");
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("desfecho ja_enviado diz que o e-mail JÁ saiu — não finge reenvio", async () => {
    reenviarComprovante.mockResolvedValue({ ok: false, motivo: "ja_enviado" });
    await montarFicha();

    await act(async () => {
      acharBotaoReenvio()?.click();
    });

    expect(toastSuccess).not.toHaveBeenCalled();
    // toast.info (e não toast()): só success/error/warning/info vão para a
    // cápsula do celular; o neutro sumia (o Sonner fica escondido ali).
    expect(toastNeutro).not.toHaveBeenCalled();
    expect(toastInfo).toHaveBeenCalledWith(
      expect.stringContaining("já foi enviado"),
    );
  });

  it("desfecho sem_remetente aponta para a configuração da loja", async () => {
    reenviarComprovante.mockResolvedValue({
      ok: false,
      motivo: "sem_remetente",
    });
    await montarFicha();

    await act(async () => {
      acharBotaoReenvio()?.click();
    });

    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("não configurou o envio de e-mails"),
    );
  });

  it("falha de envio avisa que não deu AGORA, sem prometer nada", async () => {
    reenviarComprovante.mockResolvedValue({
      ok: false,
      motivo: "envio_falhou",
    });
    await montarFicha();

    await act(async () => {
      acharBotaoReenvio()?.click();
    });

    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("Não conseguimos reenviar"),
    );
  });

  // Rede "pendurada" (achado da onda 50, 08/11/2026): o botão ficava em
  // "Reenviando…" para sempre, sem aviso. O hook (prazo de 20 s) entrega
  // `sem_resposta`; a tela solta o botão e diz a verdade: não dá para saber se
  // o e-mail saiu — nem "reenviado", nem "não deu".
  it("sem resposta da rede: solta o botão e avisa que NÃO dá para saber se o e-mail saiu", async () => {
    let terminar!: (desfecho: { ok: boolean; motivo: string }) => void;
    reenviarComprovante.mockReturnValue(
      new Promise((resolve) => {
        terminar = resolve;
      }),
    );
    await montarFicha();

    await act(async () => {
      acharBotaoReenvio()?.click();
    });
    // enquanto espera: "Reenviando…", desabilitado
    const esperando = Array.from(container?.querySelectorAll("button") ?? [])
      .filter((b) => b.textContent?.includes("Reenviando"))
      .at(0);
    expect(esperando).toBeDefined();
    expect(esperando?.disabled).toBe(true);
    expect(toastError).not.toHaveBeenCalled();

    await act(async () => {
      terminar({ ok: false, motivo: "sem_resposta" });
    });

    // o botão voltou, habilitado, com o nome de sempre
    const solto = acharBotaoReenvio();
    expect(solto).not.toBeNull();
    expect(solto?.disabled).toBe(false);
    expect(container?.textContent).not.toContain("Reenviando");

    // aviso honesto: não afirma envio nem falha; manda conferir antes de repetir
    expect(toastError).toHaveBeenCalledTimes(1);
    const frase = String(toastError.mock.calls[0]?.[0]);
    expect(frase).toMatch(/sem resposta/i);
    expect(frase).toMatch(/caixa de entrada/i);
    expect(frase).toMatch(/spam/i);
    expect(frase).toMatch(/antes de tentar de novo/i);
    expect(frase).not.toMatch(/Não conseguimos reenviar/);
    expect(frase).not.toMatch(/reenviado/i);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastInfo).not.toHaveBeenCalled();

    // e dá para tentar de novo (o botão solto funciona)
    reenviarComprovante.mockResolvedValue({ ok: true });
    await act(async () => {
      acharBotaoReenvio()?.click();
    });
    expect(reenviarComprovante).toHaveBeenCalledTimes(2);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });
});
