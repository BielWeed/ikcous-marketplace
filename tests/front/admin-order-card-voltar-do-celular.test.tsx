// @vitest-environment jsdom
//
// Na lista de pedidos do painel, o cartão abre a pergunta de dinheiro
// ("Confirmar recebimento") e a de "Cancelar pedido" numa janela. Ela não tinha
// entrada no histórico: o Voltar do celular saía da lista de Pedidos com a
// pergunta aberta. Agora usa `useVoltarFechaAFolha`: o Voltar fecha SÓ a
// pergunta e a lista fica. O menu "Ações do pedido" em si fica de fora: "Ver
// detalhes" navega para a ficha de dentro dele, e a entrada de histórico da
// janela sobraria atrás da ficha (um Voltar "sem efeito"). Histórico REAL do
// jsdom e um "App" simulado. Molde: barra-de-busca-voltar-do-celular.test.tsx.
import { AdminOrderCard } from "@/components/admin/orders/AdminOrderCard";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 60) => new Promise<void>((r) => setTimeout(r, ms));

let raiz: Root;
let hospedeiro: HTMLDivElement;
let navegacoesDoApp: string[];
const ouvintes: Array<(e: PopStateEvent) => void> = [];
const aoMudarStatus = vi.fn(async () => {});
const aoReceber = vi.fn();

const tela = () =>
  `${globalThis.history.state?.view}|${globalThis.location.pathname}`;

// Pagamento na entrega, ainda não recebido: o cartão mostra "Marcar como recebido".
const pedido = (id: string): Order => ({
  id,
  customer: { name: "Maria Aparecida", whatsapp: "11999999999" },
  items: [
    { productId: "p1", name: "Caneca", quantity: 1, price: 10, image: "" },
  ],
  subtotal: 10,
  total: 10,
  shipping: 0,
  discount: 0,
  status: "shipping",
  paymentMethod: "cash",
  paymentStatus: null,
  createdAt: "2026-10-17T12:00:00Z",
  updatedAt: "2026-10-17T12:00:00Z",
  cancelledAfterShipping: false,
});

function Lista({ ids }: Readonly<{ ids: string[] }>) {
  return (
    <>
      {ids.map((id) => (
        <AdminOrderCard
          key={id}
          order={pedido(id)}
          viewMode="compact"
          onSelect={vi.fn()}
          onWhatsApp={vi.fn()}
          onRegistrarPagamento={aoReceber}
          registrandoPagamento={false}
          onStatusChange={aoMudarStatus}
          onReceberAntesDeAvancar={vi.fn()}
          isOffline={false}
        />
      ))}
    </>
  );
}

beforeEach(() => {
  globalThis.history.replaceState({ view: "home" }, "", "/");
  globalThis.history.pushState({ view: "admin-orders" }, "", "/pedidos");
  navegacoesDoApp = [];
  vi.clearAllMocks();
  let mostrada = tela();
  const ouvinte = () => {
    const alvo = tela();
    if (alvo === mostrada) return;
    mostrada = alvo;
    navegacoesDoApp.push(alvo);
  };
  ouvintes.push(ouvinte);
  globalThis.addEventListener("popstate", ouvinte);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  for (const o of ouvintes.splice(0)) {
    globalThis.removeEventListener("popstate", o);
  }
});

const janela = () => document.querySelector('[role="dialog"]');
const botaoDe = (texto: string, dentro: ParentNode = document) =>
  [...dentro.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) =>
      b.textContent?.trim() === texto || b.getAttribute("aria-label") === texto,
  );

async function montar(ids: string[]) {
  await act(async () => {
    raiz.render(<Lista ids={ids} />);
    await esperar(0);
  });
}
async function clicar(botao: HTMLElement | undefined) {
  await act(async () => {
    botao?.click();
    await esperar(0);
  });
}
async function abrirRecebimento() {
  await clicar(botaoDe("Marcar como recebido", hospedeiro));
}
async function abrirCancelamentoPeloMenu() {
  await clicar(
    hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label^="Ações do pedido"]',
    ) ?? undefined,
  );
  await clicar(botaoDe("Cancelar pedido", janela() ?? document));
}
async function apertarVoltar() {
  await act(async () => {
    globalThis.history.back();
    await esperar();
  });
}

describe("AdminOrderCard — as perguntas do cartão e o Voltar do celular", () => {
  it("aberta, a pergunta de recebimento ganha UMA entrada no histórico, na mesma tela", async () => {
    await montar(["pedido-a"]);
    const antes = globalThis.history.length;
    await abrirRecebimento();

    expect(janela()?.textContent).toContain("Recebeu os R$");
    expect(globalThis.history.length).toBe(antes + 1);
    expect(globalThis.history.state?.folhaDePolitica).toBe(true);
    expect(globalThis.location.pathname).toBe("/pedidos");
  });

  it("o Voltar fecha SÓ a pergunta de recebimento: a lista não troca e nada é gravado", async () => {
    await montar(["pedido-a"]);
    await abrirRecebimento();
    await apertarVoltar();

    expect(janela()).toBeNull();
    expect(navegacoesDoApp).toEqual([]);
    expect(globalThis.location.pathname).toBe("/pedidos");
    expect(globalThis.history.state?.view).toBe("admin-orders");
    expect(aoReceber).not.toHaveBeenCalled();
    expect(aoMudarStatus).not.toHaveBeenCalled();
  });

  it("o Voltar fecha SÓ a pergunta de cancelar aberta pelo menu: nada é cancelado", async () => {
    await montar(["pedido-a"]);
    await abrirCancelamentoPeloMenu();
    expect(janela()?.textContent).toContain("Cancelar pedido");
    expect(globalThis.history.state?.folhaDePolitica).toBe(true);

    await apertarVoltar();

    expect(janela()).toBeNull();
    expect(navegacoesDoApp).toEqual([]);
    expect(globalThis.history.state?.view).toBe("admin-orders");
    expect(aoMudarStatus).not.toHaveBeenCalled();
  });

  it("fechar pelo X devolve a entrada: o Voltar seguinte é do roteador", async () => {
    await montar(["pedido-a"]);
    await abrirRecebimento();
    await act(async () => {
      botaoDe("Fechar ações do pedido")?.click();
      await esperar(200);
    });

    expect(janela()).toBeNull();
    expect(globalThis.history.state?.folhaDePolitica).not.toBe(true);
    expect(navegacoesDoApp).toEqual([]);

    await apertarVoltar();
    expect(navegacoesDoApp).toEqual(["home|/"]);
  });

  it("vários cartões: só o aberto mexe no histórico, e o Voltar é um só", async () => {
    await montar(["pedido-a", "pedido-b", "pedido-c"]);
    const antes = globalThis.history.length;
    expect(globalThis.history.state?.folhaDePolitica).not.toBe(true);

    await clicar(botaoDe("Marcar como recebido", hospedeiro));
    expect(globalThis.history.length).toBe(antes + 1);

    await apertarVoltar();
    expect(janela()).toBeNull();
    expect(navegacoesDoApp).toEqual([]);
  });

  it("o menu 'Ações do pedido' continua sem entrada de histórico (Ver detalhes navega de dentro dele)", async () => {
    await montar(["pedido-a"]);
    const antes = globalThis.history.length;
    await clicar(
      hospedeiro.querySelector<HTMLButtonElement>(
        'button[aria-label^="Ações do pedido"]',
      ) ?? undefined,
    );

    expect(janela()?.textContent).toContain("Ações do pedido");
    expect(globalThis.history.length).toBe(antes);
    expect(globalThis.history.state?.folhaDePolitica).not.toBe(true);
  });
});

describe("AdminOrderCard — o que não muda", () => {
  it("'Recebi' na pergunta grava como antes e fecha sem sobrar entrada de histórico", async () => {
    await montar(["pedido-a"]);
    await abrirRecebimento();
    await act(async () => {
      botaoDe("Recebi")?.click();
      await esperar(200);
    });

    expect(aoReceber).toHaveBeenCalledWith("pedido-a", true);
    expect(janela()).toBeNull();
    expect(globalThis.history.state?.folhaDePolitica).not.toBe(true);
  });
});
