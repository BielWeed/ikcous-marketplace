// @vitest-environment jsdom
//
// EtiquetaDoPedidoCard — a emissão de etiqueta migrou de Admin > Frete
// (busca global de pedido) para DENTRO da ficha do pedido: o card recebe o
// `orderId` já escolhido e busca SÓ esse pedido. Porta as garantias de
// DINHEIRO do card antigo (EtiquetasEnvioCard):
//
//   1. montar NUNCA invoca a edge — só lê o pedido;
//   2. consulta filtra pelo orderId da prop;
//   3. 1º clique abre confirmação SEM invocar;
//   4. confirmar invoca com body EXATO { action: "gerar_etiqueta", orderId };
//   5. dois cliques rápidos = UMA invocação;
//   6. sucesso mostra rastreio + link e chama onTrackingAtualizado;
//   7. `already` mostra "nada foi comprado de novo";
//   8. erro de negócio (formato REAL do supabase-js v2) mostra a mensagem do
//      corpo e persiste na tela;
//   9. `resgate` refaz a leitura (cai em emitida) e NUNCA reapresenta o
//      botão de compra;
//  10. indisponível (cada motivo) nunca mostra "Gerar etiqueta";
//  11. emitida mostra "Atualizar rastreio", que invoca consultar_rastreio;
//  12. offline desabilita os botões de ação;
//  13. troca de orderId descarta a resposta antiga em voo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, pedidoState, eqChamadas, colunasPedidas } = vi.hoisted(
  () => ({
    invokeMock: vi.fn(),
    pedidoState: {
      data: null as any,
      error: null as { message: string } | null,
    },
    eqChamadas: [] as string[],
    // A STRING que `select(...)` recebeu — sem capturar isso o mock aceitaria
    // QUALQUER coluna (inclusive nenhuma) e a suíte ficaria verde mesmo se um
    // refator apagasse `shipping_label_id`/`payment_status`/o campo do
    // serviço do checkout da consulta real, quebrando a elegibilidade em
    // produção sem nenhum teste vermelho (mesmo achado do card antigo,
    // admin-etiquetas-lista-pagina-busca-e-marca-emitidas.test.tsx).
    colunasPedidas: [] as string[],
  }),
);

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (_table: string) => ({
      select: (colunas: string) => {
        colunasPedidas.push(colunas);
        return {
          eq: (_coluna: string, valor: string) => {
            eqChamadas.push(valor);
            return {
              maybeSingle: () =>
                Promise.resolve({
                  data: pedidoState.data,
                  error: pedidoState.error,
                }),
            };
          },
        };
      },
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

function pedido(over: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    status: "processing",
    payment_status: "pago",
    shipping: 24.9,
    shipping_cost: null,
    tracking_code: null,
    shipping_label_id: null,
    shipping_label_url: null,
    notes: null,
    shipping_option_id: "melhor-envio-3",
    ...over,
  };
}

describe("EtiquetaDoPedidoCard", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    eqChamadas.length = 0;
    colunasPedidas.length = 0;
    pedidoState.data = pedido();
    pedidoState.error = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function abrirCard(
    orderId = "11111111-1111-1111-1111-111111111111",
    props: Record<string, unknown> = {},
  ) {
    const { EtiquetaDoPedidoCard } = await import(
      "@/components/admin/orders/EtiquetaDoPedidoCard"
    );
    await act(async () => {
      raiz.render(
        <EtiquetaDoPedidoCard orderId={orderId} isOffline={false} {...props} />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    return { EtiquetaDoPedidoCard };
  }

  const botao = (texto: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    ) as HTMLButtonElement | undefined;

  it("montar NÃO invoca a edge — só lê o pedido pelo orderId da prop", async () => {
    await abrirCard();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(eqChamadas).toEqual(["11111111-1111-1111-1111-111111111111"]);
    // Guarda de verdade (herdada do card antigo, achado ANOTADO): sem checar
    // a STRING de `select()`, um refator que apagasse `shipping_label_id`,
    // `payment_status` ou o campo do serviço do checkout continuaria verde
    // aqui e quebraria a elegibilidade em produção sem teste vermelho.
    expect(colunasPedidas[0]).toMatch(/shipping_label_id/);
    expect(colunasPedidas[0]).toMatch(/payment_status/);
    expect(colunasPedidas[0]).toMatch(/status/);
    expect(colunasPedidas[0]).toMatch(/shipping_option_id/);
  });

  it("1º clique em 'Gerar etiqueta' NÃO invoca — abre a confirmação", async () => {
    await abrirCard();
    expect(botao("Gerar etiqueta")).toBeTruthy();

    await act(async () => {
      botao("Gerar etiqueta")?.click();
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toMatch(/saldo da SUA conta/i);
    expect(botao("Confirmar e gerar")).toBeTruthy();
  });

  it("confirmar invoca com body EXATO { action: 'gerar_etiqueta', orderId }", async () => {
    invokeMock.mockResolvedValue({
      data: {
        success: true,
        already: false,
        tracking_code: "ME1",
        label_url: "https://melhorenvio.com.br/imprimir/x",
        label_id: "lbl-1",
      },
    });
    await abrirCard();
    await act(async () => {
      botao("Gerar etiqueta")?.click();
    });
    await act(async () => {
      botao("Confirmar e gerar")?.click();
      await esperarMicrotarefas();
    });

    expect(invokeMock).toHaveBeenCalledWith("melhor-envio-etiqueta", {
      body: {
        action: "gerar_etiqueta",
        orderId: "11111111-1111-1111-1111-111111111111",
      },
    });
  });

  it("dois cliques rápidos em 'Confirmar e gerar' disparam UMA única invocação", async () => {
    let resolver: (v: unknown) => void = () => {};
    invokeMock.mockReturnValue(
      new Promise((resolve) => {
        resolver = resolve;
      }),
    );
    await abrirCard();
    await act(async () => {
      botao("Gerar etiqueta")?.click();
    });

    await act(async () => {
      const btn = botao("Confirmar e gerar")!;
      btn.click();
      btn.click();
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolver({
        data: {
          success: true,
          already: false,
          tracking_code: "ME1",
          label_url: null,
          label_id: "lbl-1",
        },
      });
      await esperarMicrotarefas();
    });
  });

  it("sucesso mostra rastreio + link e chama onTrackingAtualizado", async () => {
    invokeMock.mockResolvedValue({
      data: {
        success: true,
        already: false,
        tracking_code: "ME23002OWZ7BR",
        label_url: "https://melhorenvio.com.br/imprimir/abc",
        label_id: "lbl-1",
      },
    });
    const onTrackingAtualizado = vi.fn();
    await abrirCard(undefined, { onTrackingAtualizado });

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

    expect(
      hospedeiro.querySelector('[data-testid="codigo-rastreio"]')?.textContent,
    ).toBe("ME23002OWZ7BR");
    const linkEtiqueta = hospedeiro.querySelector<HTMLAnchorElement>(
      'a[href="https://melhorenvio.com.br/imprimir/abc"]',
    );
    expect(linkEtiqueta).toBeTruthy();
    // Link externo abre em aba nova sem entregar a janela abridora
    // (tabnabbing) — mesma checagem do card antigo.
    expect(linkEtiqueta?.getAttribute("rel")).toMatch(/noopener/);
    expect(onTrackingAtualizado).toHaveBeenCalledWith("ME23002OWZ7BR");
    expect(hospedeiro.textContent).toContain(
      "Etiqueta gerada e vinculada ao pedido!",
    );
  });

  it("already: true — mostra que nada foi comprado de novo", async () => {
    invokeMock.mockResolvedValue({
      data: {
        success: true,
        already: true,
        tracking_code: null,
        label_url: "https://melhorenvio.com.br/imprimir/existia",
        label_id: "lbl-existia",
      },
    });
    await abrirCard();

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

    expect(hospedeiro.textContent).toContain(
      "Este pedido já tinha etiqueta — nada foi comprado de novo.",
    );
  });

  it("erro de negócio no formato REAL do SDK (FunctionsHttpError + context): mensagem persiste na tela", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: {
        name: "FunctionsHttpError",
        context: new Response(
          JSON.stringify({
            error: "Token do Melhor Envio não configurado.",
          }),
          { status: 400 },
        ),
      },
    });
    await abrirCard();

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

    expect(
      hospedeiro.querySelector('[data-testid="erro-etiqueta"]')?.textContent,
    ).toBe("Token do Melhor Envio não configurado.");
    // Continua na confirmação para tentar de novo — erro comum não é resgate.
    expect(botao("Confirmar e gerar")).toBeTruthy();
    // Sem código de rastreio inventado: o erro não pode fazer a tela
    // fingir que a etiqueta foi emitida.
    expect(
      hospedeiro.querySelector('[data-testid="codigo-rastreio"]'),
    ).toBeNull();
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      "Token do Melhor Envio não configurado.",
    );
  });

  it("resgate: refaz a leitura do pedido (cai em emitida) e NUNCA reapresenta 'Confirmar e gerar'", async () => {
    const mensagemResgate =
      "Já existe uma geração de etiqueta em andamento para este pedido.";
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: {
        name: "FunctionsHttpError",
        context: new Response(
          JSON.stringify({
            error: mensagemResgate,
            label_id: "lbl-corrida",
            resgate: true,
          }),
          { status: 409 },
        ),
      },
    });
    await abrirCard();

    // Depois da resposta de resgate, a releitura do pedido devolve a
    // etiqueta já vinculada por OUTRA corrida — é isso que faz cair em
    // "emitida" sem novo clique de compra.
    pedidoState.data = pedido({
      shipping_label_id: "lbl-corrida",
      shipping_label_url: null,
      tracking_code: null,
    });

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

    expect(botao("Confirmar e gerar")).toBeUndefined();
    expect(botao("Gerar etiqueta")).toBeUndefined();
    expect(
      hospedeiro.querySelector('[data-testid="erro-etiqueta"]')?.textContent,
    ).toBe(mensagemResgate);
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(mensagemResgate);
  });

  it.each([
    ["cancelled", "cancelado"],
    ["delivered", "entregue"],
  ])(
    "indisponível (status %s): mostra o motivo e não oferece 'Gerar etiqueta'",
    async (status, trechoEsperado) => {
      pedidoState.data = pedido({ status });
      await abrirCard();
      // `RegExp` não-literal com termo de `it.each` dispara
      // security/detect-non-literal-regexp (ReDoS) — sem risco real aqui
      // (lista fechada de 2 strings), mas o `.includes` evita o aviso.
      expect(hospedeiro.textContent?.toLowerCase()).toContain(
        trechoEsperado.toLowerCase(),
      );
      expect(botao("Gerar etiqueta")).toBeUndefined();
    },
  );

  it("indisponível (não pago): mostra o motivo do pagamento, sem botão de compra", async () => {
    pedidoState.data = pedido({ payment_status: "aguardando" });
    await abrirCard();
    expect(hospedeiro.textContent).toMatch(/pagamento confirmado/i);
    expect(botao("Gerar etiqueta")).toBeUndefined();
  });

  it("indisponível (SuperFrete): mostra o nome do serviço, sem botão de compra", async () => {
    pedidoState.data = pedido({ shipping_option_id: "superfrete-1" });
    await abrirCard();
    expect(hospedeiro.textContent).toMatch(/SuperFrete \(PAC\)/);
    expect(botao("Gerar etiqueta")).toBeUndefined();
  });

  it("indisponível (Frenet): sem botão de compra", async () => {
    pedidoState.data = pedido({ shipping_option_id: "frenet-EXP01" });
    await abrirCard();
    expect(hospedeiro.textContent).toMatch(/Frenet/);
    expect(botao("Gerar etiqueta")).toBeUndefined();
  });

  it("indisponível (retirada na loja): sem botão de compra", async () => {
    pedidoState.data = pedido({ shipping_option_id: "store-pickup" });
    await abrirCard();
    expect(hospedeiro.textContent).toMatch(/retirada na loja/i);
    expect(botao("Gerar etiqueta")).toBeUndefined();
  });

  it("indisponível (exige agência): sem botão de compra", async () => {
    pedidoState.data = pedido({ shipping_option_id: "melhor-envio-12" });
    await abrirCard();
    expect(hospedeiro.textContent).toMatch(/agência de coleta/i);
    expect(botao("Gerar etiqueta")).toBeUndefined();
  });

  it("indisponível (sem serviço do ME): sem botão de compra", async () => {
    pedidoState.data = pedido({ shipping_option_id: null });
    await abrirCard();
    expect(hospedeiro.textContent).toMatch(/Melhor Envio/i);
    expect(botao("Gerar etiqueta")).toBeUndefined();
  });

  it("emitida: mostra 'Atualizar rastreio', que invoca consultar_rastreio com o orderId", async () => {
    pedidoState.data = pedido({
      shipping_label_id: "lbl-ja-existe",
      shipping_label_url: "https://melhorenvio.com.br/imprimir/ja",
      tracking_code: "ME999",
    });
    invokeMock.mockResolvedValue({
      data: {
        success: true,
        tracking_code: "ME999NOVO",
        status_etiqueta: "posted",
      },
    });
    const onTrackingAtualizado = vi.fn();
    await abrirCard(undefined, { onTrackingAtualizado });

    expect(botao("Gerar etiqueta")).toBeUndefined();
    expect(botao("Atualizar rastreio")).toBeTruthy();

    await act(async () => {
      botao("Atualizar rastreio")?.click();
      await esperarMicrotarefas();
    });

    expect(invokeMock).toHaveBeenCalledWith("melhor-envio-etiqueta", {
      body: {
        action: "consultar_rastreio",
        orderId: "11111111-1111-1111-1111-111111111111",
      },
    });
    expect(onTrackingAtualizado).toHaveBeenCalledWith("ME999NOVO");
  });

  it("emitida: 'Atualizar rastreio' com erro de negócio mostra a mensagem do corpo no toast (herdado de admin-shipping-etiqueta-melhor-envio.test.tsx)", async () => {
    pedidoState.data = pedido({
      shipping_label_id: "lbl-ja-existe",
      shipping_label_url: null,
      tracking_code: null,
    });
    invokeMock.mockResolvedValue({
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

    await act(async () => {
      botao("Atualizar rastreio")?.click();
      await esperarMicrotarefas();
    });

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      "O Melhor Envio recusou o token (não autenticado).",
    );
    // O erro de CONSULTA não pode derrubar o card para "confirmar"/apagar a
    // etiqueta já emitida — continua mostrando "Atualizar rastreio".
    expect(botao("Atualizar rastreio")).toBeTruthy();
  });

  it("offline desabilita 'Gerar etiqueta'", async () => {
    await abrirCard(undefined, { isOffline: true });
    expect(botao("Gerar etiqueta")?.disabled).toBe(true);
  });

  it("offline desabilita 'Atualizar rastreio' no estado emitida", async () => {
    pedidoState.data = pedido({
      shipping_label_id: "lbl-ja-existe",
      tracking_code: "ME999",
    });
    await abrirCard(undefined, { isOffline: true });
    expect(botao("Atualizar rastreio")?.disabled).toBe(true);
  });

  it("erro de leitura do pedido: mostra 'Tentar de novo' e não quebra", async () => {
    pedidoState.data = null;
    pedidoState.error = { message: "falha de rede" };
    await abrirCard();
    expect(botao("Tentar de novo")).toBeTruthy();
    expect(botao("Gerar etiqueta")).toBeUndefined();
  });

  it("troca de orderId descarta a resposta antiga em voo", async () => {
    let resolverAntigo: (v: unknown) => void = () => {};
    const antigo = new Promise((resolve) => {
      resolverAntigo = resolve;
    });
    let chamadaEq = 0;
    const { EtiquetaDoPedidoCard } = await import(
      "@/components/admin/orders/EtiquetaDoPedidoCard"
    );

    // Sobrescreve o mock só para esta consulta: a primeira `eq` fica presa
    // (simula uma resposta de rede lenta que chega DEPOIS da troca de
    // orderId); a segunda resolve na hora com um pedido diferente.
    const supabaseMod = await import("@/lib/supabase");
    const fromOriginal = supabaseMod.supabase.from;
    (supabaseMod.supabase.from as unknown) = (table: any) => {
      if (table !== "marketplace_orders") return fromOriginal(table);
      return {
        select: () => ({
          eq: (_coluna: string, valor: string) => {
            chamadaEq += 1;
            const minhaChamada = chamadaEq;
            return {
              maybeSingle: () =>
                minhaChamada === 1
                  ? antigo
                  : Promise.resolve({
                      data: pedido({
                        id: valor,
                        shipping_option_id: "store-pickup",
                      }),
                      error: null,
                    }),
            };
          },
        }),
      };
    };

    await act(async () => {
      raiz.render(
        <EtiquetaDoPedidoCard
          orderId="aaaaaaaa-0000-0000-0000-000000000000"
          isOffline={false}
        />,
      );
    });
    await act(async () => {
      raiz.render(
        <EtiquetaDoPedidoCard
          orderId="bbbbbbbb-1111-1111-1111-111111111111"
          isOffline={false}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // A resposta do orderId NOVO já chegou (pedido de retirada — indisponível).
    expect(hospedeiro.textContent).toMatch(/retirada na loja/i);

    // Agora a resposta ANTIGA (que ficou presa) chega — não pode sobrescrever
    // o que já está na tela.
    await act(async () => {
      resolverAntigo({
        data: pedido({
          id: "aaaaaaaa-0000-0000-0000-000000000000",
          shipping_option_id: "melhor-envio-3",
        }),
        error: null,
      });
      await esperarMicrotarefas();
    });

    expect(hospedeiro.textContent).toMatch(/retirada na loja/i);
    expect(botao("Gerar etiqueta")).toBeUndefined();
  });
});
