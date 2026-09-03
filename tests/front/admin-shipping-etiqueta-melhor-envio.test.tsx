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
//   4. Erro de negócio da function (ex.: token não configurado) chega NO
//      FORMATO REAL do supabase-js v2 — `data: null` + FunctionsHttpError com
//      o corpo em `error.context` (Response) — e a mensagem do corpo aparece
//      na tela, sem código de rastreio inventado.
//   5. Sem pedido selecionado o botão fica desabilitado — nada de invocar
//      com orderId vazio.
//   6. A lista já nasce com o portão de pagamento: o segundo `.in` filtra
//      `payment_status` para os TRÊS valores de dinheiro que entrou do CHECK
//      (`pago`, `pago_apos_expirar`, `recebido_na_entrega` — mesmo critério
//      da function, falha fechado).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, filtrosIn, pedidosState } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  // Captura os argumentos de CADA `.in` encadeado (status, payment_status).
  filtrosIn: [] as Array<[string, string[]]>,
  pedidosState: {
    data: [] as any[] | null,
    error: null as { message: string } | null,
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// `marketplace_orders` responde o que o teste armou em `pedidosState`;
// qualquer outra tabela devolve vazio sem erro. A cadeia espelha a consulta
// real: select → in(status) → in(payment_status) → order → limit.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (_table: string) => ({
      select: () => ({
        in: (colunaA: string, valoresA: string[]) => ({
          in: (colunaB: string, valoresB: string[]) => {
            filtrosIn.push([colunaA, valoresA], [colunaB, valoresB]);
            return {
              order: () => ({
                limit: () =>
                  Promise.resolve({
                    data: pedidosState.data,
                    error: pedidosState.error,
                  }),
              }),
            };
          },
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
    payment_status: "pago",
    shipping: 24.9,
    tracking_code: null,
    created_at: "2026-09-03T10:00:00Z",
  },
  {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    customer_name: "João Pires",
    status: "shipping",
    payment_status: "pago_apos_expirar",
    shipping: 15,
    tracking_code: null,
    created_at: "2026-09-02T10:00:00Z",
  },
];

describe("EtiquetasEnvioCard — etiqueta só sai com confirmação explícita", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    filtrosIn.length = 0;
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

  it("primeiro clique NÃO invoca a function — abre a confirmação com o nome do cliente, o frete e o portão de pagamento", async () => {
    await abrirCard();
    await selecionarPedido();

    await act(async () => {
      botao("Gerar etiqueta")?.click();
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toMatch(/saldo da SUA conta/i);
    expect(hospedeiro.textContent).toMatch(/Maria Souza/);
    // A7 do revisor: o lojista confirma vendo o frete que o cliente pagou.
    expect(hospedeiro.textContent).toMatch(/frete pago pelo cliente/i);
    expect(hospedeiro.textContent).toMatch(/R\$ 24,90/);
    // A6 do revisor: a lista só nasce com pagamento confirmado — os TRÊS
    // valores de dinheiro que entrou do CHECK, mesmo critério de falha
    // fechado da function (recebido_na_entrega entra na 2ª rodada do
    // re-review, item D).
    const filtroPagamento = filtrosIn.find(
      ([coluna]) => coluna === "payment_status",
    );
    expect(filtroPagamento).toEqual([
      "payment_status",
      ["pago", "pago_apos_expirar", "recebido_na_entrega"],
    ]);
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

  it("already: true — a tela diz que NADA foi comprado de novo E mostra o link da etiqueta existente", async () => {
    invokeMock.mockResolvedValue({
      data: {
        success: true,
        already: true,
        tracking_code: "ME1111AAAAABR",
        // A5 do revisor: a select do `already` agora traz shipping_label_url —
        // re-clique mostra "Abrir etiqueta" de verdade.
        label_url: "https://melhorenvio.com.br/imprimir/que-ja-existia",
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
    expect(
      hospedeiro.querySelector<HTMLAnchorElement>(
        'a[href="https://melhorenvio.com.br/imprimir/que-ja-existia"]',
      ),
    ).toBeTruthy();
  });

  it("erro de negócio no formato REAL do SDK (FunctionsHttpError + context): mensagem do corpo aparece na tela, sem código inventado", async () => {
    // Contrato do supabase-js v2: resposta fora de 2xx chega como
    // `data: null` + `error` (FunctionsHttpError) com o corpo da function em
    // `error.context` (um Response) — O QUE O SDK REALMENTE PRODUZ. O mock
    // antigo `{ data: { error } }` era um formato que o SDK não gera.
    invokeMock.mockResolvedValue({
      data: null,
      error: {
        name: "FunctionsHttpError",
        context: new Response(
          JSON.stringify({
            error:
              "Token do Melhor Envio não configurado. Cadastre o token em Logística & Frete.",
          }),
          { status: 400 },
        ),
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

  it("consultar rastreio com erro de negócio: a mensagem do corpo da function sai no toast", async () => {
    // Caminho realista: etiqueta já existe na conta (already), o lojista clica
    // em "Atualizar rastreio" e a function responde 400 de negócio.
    invokeMock
      .mockResolvedValueOnce({
        data: {
          success: true,
          already: true,
          tracking_code: null,
          label_url: null,
          label_id: "10b87ac0-e99d-4aa4-b8b0-b147a84e16bf",
        },
      })
      .mockResolvedValueOnce({
        data: null,
        error: {
          name: "FunctionsHttpError",
          context: new Response(
            JSON.stringify({
              error: "O Melhor Envio recusou o token (não autenticado).",
            }),
            { status: 502 },
          ),
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
      botao("Atualizar rastreio")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(invokeMock).toHaveBeenLastCalledWith("melhor-envio-etiqueta", {
      body: { action: "consultar_rastreio", orderId: PEDIDOS[0].id },
    });
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      "O Melhor Envio recusou o token (não autenticado).",
    );
  });

  it("sem pedido selecionado, o botão Gerar etiqueta fica desabilitado", async () => {
    await abrirCard();
    const gerar = botao("Gerar etiqueta");
    expect(gerar).toBeTruthy();
    expect(gerar?.disabled).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("resgate (resgate: true no 409): a confirmação some, a mensagem com o id da etiqueta FICA na tela (item I) e o toast a carrega", async () => {
    // Corpo REAL do ramo 409 da function (corrida de geração, contrato E′):
    // `resgate: true` manda a tela de volta para a lista — e, item I do
    // re-review, a mensagem (com o id que amarra o pedido à compra no Melhor
    // Envio) não pode viver só no toast de ~4 s: fica no bloco vermelho acima
    // de "Gerar etiqueta" até o lojista trocar de pedido.
    const mensagemResgate =
      "Já existe uma geração de etiqueta em andamento para este pedido. Aguarde ou recarregue para ver a etiqueta existente.";
    invokeMock.mockResolvedValue({
      data: null,
      error: {
        name: "FunctionsHttpError",
        context: new Response(
          JSON.stringify({
            error: mensagemResgate,
            label_id: "x",
            resgate: true,
          }),
          { status: 409 },
        ),
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

    // De volta à lista: o botão de gasto NÃO está na tela e o seletor voltou.
    expect(botao("Confirmar e gerar")).toBeUndefined();
    expect(hospedeiro.querySelector("#pedido-etiqueta-select")).toBeTruthy();
    // A mensagem do corpo ESTÁ na tela — bloco vermelho persistente.
    expect(
      hospedeiro.querySelector('[data-testid="erro-etiqueta"]')?.textContent,
    ).toBe(mensagemResgate);
    // E o toast também a carregou.
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(mensagemResgate);
  });
});
