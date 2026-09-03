// @vitest-environment jsdom
//
// Onda 3 — rastreio automático (frente glm-onda3-rastreio-0309). Contrato do
// card "Etiquetas de envio (Melhor Envio)" que entrou na tela de Frete:
//
//   1. CONFIRMAÇÃO EXPLÍCITA: "Gerar etiqueta" NÃO chama a edge function —
//      abre a confirmação (a etiqueta usa o SALDO do lojista). Só o clique
//      em "Confirmar e gerar" invoca, com action `gerar_etiqueta` e o id do
//      pedido selecionado.
//   2. O resultado mostra o código de rastreio e o link da etiqueta.
//   3. `already: true` (pedido que já tinha etiqueta) aparece como "nada foi
//      comprado de novo" — proteção de dinheiro na cara da tela.
//   4. Erro de negócio da function (ex.: token não configurado) aparece na
//      tela com a mensagem amigável, sem código de rastreio inventado.
//   5. Sem pedido selecionado o botão fica desabilitado — nada de invocar
//      com orderId vazio.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, pedidosState } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  pedidosState: {
    data: [] as any[] | null,
    error: null as { message: string } | null,
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// `marketplace_orders` responde o que o teste armou em `pedidosState`;
// qualquer outra tabela devolve vazio sem erro.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (_table: string) => ({
      select: () => ({
        in: () => ({
          order: () => ({
            limit: () =>
              Promise.resolve({
                data: pedidosState.data,
                error: pedidosState.error,
              }),
          }),
        }),
      }),
    }),
    functions: { invoke: invokeMock },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const PEDIDOS = [
  {
    id: "11111111-2222-3333-4444-555555555555",
    customer_name: "Maria Souza",
    status: "processing",
    tracking_code: null,
    created_at: "2026-09-03T10:00:00Z",
  },
  {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    customer_name: "João Pires",
    status: "shipping",
    tracking_code: null,
    created_at: "2026-09-02T10:00:00Z",
  },
];

describe("EtiquetasEnvioCard — etiqueta só sai com confirmação explícita", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    pedidosState.data = PEDIDOS;
    pedidosState.error = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function abrirCard() {
    const { EtiquetasEnvioCard } = await import(
      "@/components/admin/shipping/EtiquetasEnvioCard"
    );
    await act(async () => {
      raiz.render(<EtiquetasEnvioCard />);
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
    );

  const selecionarPedido = async () => {
    const select = hospedeiro.querySelector(
      "#pedido-etiqueta-select",
    ) as HTMLSelectElement;
    await act(async () => {
      select.value = PEDIDOS[0].id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };

  it("primeiro clique NÃO invoca a function — abre a confirmação com o nome do cliente", async () => {
    await abrirCard();
    await selecionarPedido();

    await act(async () => {
      botao("Gerar etiqueta")?.click();
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toMatch(/saldo da SUA conta/i);
    expect(hospedeiro.textContent).toMatch(/Maria Souza/);
    expect(botao("Confirmar e gerar")).toBeTruthy();
  });

  it("a confirmação invoca com action gerar_etiqueta e o id do pedido; resultado mostra rastreio e link da etiqueta", async () => {
    invokeMock.mockResolvedValue({
      data: {
        success: true,
        already: false,
        tracking_code: "ME23002OWZ7BR",
        label_url: "https://sandbox.melhorenvio.com.br/imprimir/abc",
        label_id: "10b87ac0-e99d-4aa4-b8b0-b147a84e16bf",
      },
    });
    await abrirCard();
    await selecionarPedido();

    await act(async () => {
      botao("Gerar etiqueta")?.click();
    });
    await act(async () => {
      botao("Confirmar e gerar")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("melhor-envio-etiqueta", {
      body: { action: "gerar_etiqueta", orderId: PEDIDOS[0].id },
    });
    expect(
      hospedeiro.querySelector('[data-testid="codigo-rastreio"]')?.textContent,
    ).toBe("ME23002OWZ7BR");
    const linkEtiqueta = hospedeiro.querySelector<HTMLAnchorElement>(
      'a[href="https://sandbox.melhorenvio.com.br/imprimir/abc"]',
    );
    expect(linkEtiqueta).toBeTruthy();
    // Link externo abre em aba nova sem entregar a janela abridora.
    expect(linkEtiqueta?.getAttribute("rel")).toMatch(/noopener/);
  });

  it("already: true — a tela diz que NADA foi comprado de novo", async () => {
    invokeMock.mockResolvedValue({
      data: {
        success: true,
        already: true,
        tracking_code: "ME1111AAAAABR",
        label_url: null,
        label_id: "10b87ac0-e99d-4aa4-b8b0-b147a84e16bf",
      },
    });
    await abrirCard();
    await selecionarPedido();

    await act(async () => {
      botao("Gerar etiqueta")?.click();
    });
    await act(async () => {
      botao("Confirmar e gerar")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(hospedeiro.textContent).toMatch(/já tinha etiqueta/i);
    expect(hospedeiro.textContent).toMatch(/nada foi comprado de novo/i);
  });

  it("erro de negócio (token não configurado): mensagem aparece na tela, sem código inventado", async () => {
    invokeMock.mockResolvedValue({
      data: {
        error:
          "Token do Melhor Envio não configurado. Cadastre o token em Logística & Frete.",
      },
    });
    await abrirCard();
    await selecionarPedido();

    await act(async () => {
      botao("Gerar etiqueta")?.click();
    });
    await act(async () => {
      botao("Confirmar e gerar")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(hospedeiro.textContent).toMatch(
      /Token do Melhor Envio não configurado/,
    );
    expect(
      hospedeiro.querySelector('[data-testid="codigo-rastreio"]'),
    ).toBeNull();
    // Continua na confirmação para o lojista tentar de novo sem refazer o
    // caminho todo.
    expect(botao("Confirmar e gerar")).toBeTruthy();
  });

  it("sem pedido selecionado, o botão Gerar etiqueta fica desabilitado", async () => {
    await abrirCard();
    const gerar = botao("Gerar etiqueta");
    expect(gerar).toBeTruthy();
    expect(gerar?.disabled).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
