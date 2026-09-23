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

/**
 * Digita num `<input>` controlado pelo React: setar `.value` direto não
 * dispara o `onChange` porque o React intercepta o setter nativo para
 * detectar mudança real — passar pelo setter do PROTÓTIPO (truque padrão de
 * teste em jsdom) é o que faz o evento `input` disparar o handler de verdade.
 */
function digitarNoInput(el: HTMLInputElement, valor: string): void {
  // Pega o descritor do PRÓPRIO protótipo do elemento (não de `window.
  // HTMLInputElement`) — em ambiente de teste pode haver mais de um realm
  // jsdom, e o setter do realm errado lança "not a valid instance".
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(el),
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
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
    // CPF válido de teste (exigido pelo Melhor Envio) — quem quer testar o
    // portão de CPF sobrescreve com `null`/inválido.
    cpf: "52998224725",
    ...over,
  };
}

describe("EtiquetaDoPedidoCard", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    eqChamadas.length = 0;
    colunasPedidas.length = 0;
    pedidoState.data = pedido();
    pedidoState.error = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    // As travas de reentrada (`geracaoDaEtiquetaEmVoo`/`cpfEmVoo`/
    // `rastreioEmVoo`) vivem em escopo de MÓDULO (2ª rodada da revisão Opus
    // sobre aadbf4c — precisam sobreviver ao desmonte/remonte do card via
    // `key`), e o módulo só é importado UMA vez por todo o arquivo de teste
    // (o `import()` dinâmico é cacheado): sem zerar aqui, um `orderId` que
    // ficou "em voo" e não passou pelo `finally` de um teste anterior (ex.:
    // suíte interrompida no meio) vazaria para o teste seguinte.
    const { _resetTravasDeReentranciaParaTeste } = await import(
      "@/components/admin/orders/EtiquetaDoPedidoCard"
    );
    _resetTravasDeReentranciaParaTeste();
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
    // O CPF (exigido pelo Melhor Envio em `to.document`) entra pela mesma
    // costura JSON do serviço do checkout — sem checar, um refator que
    // apagasse `customer_data->>cpf` continuaria verde aqui e todo pedido
    // pareceria "precisa_cpf" para sempre em produção.
    expect(colunasPedidas[0]).toMatch(/customer_data->>cpf/);
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
    // Cobertura herdada do card antigo (EtiquetasEnvioCard): a confirmação
    // mostra o frete PAGO DESTE pedido (pedido() tem shipping: 24.9), não um
    // valor genérico — achado da revisão Opus sobre a migração (aadbf4c).
    expect(hospedeiro.textContent).toMatch(/R\$\s*24,90/);
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
    expect(onTrackingAtualizado).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      "ME23002OWZ7BR",
    );
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
    // Cobertura herdada do card antigo: `already` mostra o link da etiqueta
    // EXISTENTE (achado da revisão Opus sobre a migração, aadbf4c) — sem
    // isso a lojista não tem como abrir/reimprimir a etiqueta já paga.
    const linkEtiquetaExistente = hospedeiro.querySelector<HTMLAnchorElement>(
      'a[href="https://melhorenvio.com.br/imprimir/existia"]',
    );
    expect(linkEtiquetaExistente).toBeTruthy();
    expect(linkEtiquetaExistente?.getAttribute("rel")).toMatch(/noopener/);
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
    expect(onTrackingAtualizado).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      "ME999NOVO",
    );
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

    // Restaura o mock original — sem isso, o monkey-patch de `supabase.from`
    // vaza para TODOS os testes seguintes deste arquivo (achado ao acrescentar
    // os testes de CPF abaixo: eles quebravam só quando a suíte inteira
    // rodava, nunca isolados — clássico sintoma de vazamento entre testes).
    (supabaseMod.supabase.from as unknown) = fromOriginal;
  });

  // ── CPF do destinatário (requisito novo: Melhor Envio exige `to.document`) ──

  it("precisa_cpf (CPF ausente): mostra o campo de CPF e NÃO oferece 'Gerar etiqueta'", async () => {
    pedidoState.data = pedido({ cpf: null });
    await abrirCard();
    expect(botao("Gerar etiqueta")).toBeUndefined();
    expect(hospedeiro.querySelector("#cpf-destinatario")).toBeTruthy();
    expect(botao("Salvar CPF")).toBeTruthy();
    expect(hospedeiro.textContent).toMatch(/exige o CPF do destinatário/i);
  });

  it("precisa_cpf (CPF inválido salvo): mostra o motivo de inválido, não de ausente", async () => {
    pedidoState.data = pedido({ cpf: "11111111111" });
    await abrirCard();
    expect(hospedeiro.textContent).toMatch(
      /CPF salvo neste pedido é inválido/i,
    );
  });

  it("precisa_cpf: CPF inválido digitado NÃO invoca a edge — mostra erro local persistente", async () => {
    pedidoState.data = pedido({ cpf: null });
    await abrirCard();
    const campo =
      hospedeiro.querySelector<HTMLInputElement>("#cpf-destinatario")!;
    await act(async () => {
      digitarNoInput(campo, "111.111.111-11");
    });
    await act(async () => {
      botao("Salvar CPF")?.click();
    });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(
      hospedeiro.querySelector('[data-testid="erro-cpf"]')?.textContent,
    ).toMatch(/inválido/i);
  });

  it("precisa_cpf: salvar invoca a edge com body EXATO { action: 'definir_cpf_destinatario', orderId, cpf: <11 dígitos SEM máscara> }", async () => {
    pedidoState.data = pedido({ cpf: null });
    invokeMock.mockResolvedValue({ data: { success: true, cpf_final: "25" } });
    await abrirCard();
    const campo =
      hospedeiro.querySelector<HTMLInputElement>("#cpf-destinatario")!;
    await act(async () => {
      digitarNoInput(campo, "529.982.247-25");
    });
    await act(async () => {
      botao("Salvar CPF")?.click();
      await esperarMicrotarefas();
    });
    expect(invokeMock).toHaveBeenCalledWith("melhor-envio-etiqueta", {
      body: {
        action: "definir_cpf_destinatario",
        orderId: "11111111-1111-1111-1111-111111111111",
        cpf: "52998224725",
      },
    });
  });

  it("precisa_cpf: depois de salvar com sucesso, relê o pedido e mostra 'Gerar etiqueta' (sai de precisa_cpf sozinho, sem estado local otimista)", async () => {
    pedidoState.data = pedido({ cpf: null });
    invokeMock.mockResolvedValueOnce({
      data: { success: true, cpf_final: "25" },
    });
    await abrirCard();

    // Depois do salvamento, o BANCO já tem o CPF — é a releitura que traz.
    pedidoState.data = pedido({ cpf: "52998224725" });

    const campo =
      hospedeiro.querySelector<HTMLInputElement>("#cpf-destinatario")!;
    await act(async () => {
      digitarNoInput(campo, "52998224725");
    });
    await act(async () => {
      botao("Salvar CPF")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(botao("Gerar etiqueta")).toBeTruthy();
    expect(hospedeiro.querySelector("#cpf-destinatario")).toBeNull();
  });

  it("gerar_etiqueta NUNCA leva o cpf no body — o cpf só viaja pela action definir_cpf_destinatario", async () => {
    invokeMock.mockResolvedValue({
      data: {
        success: true,
        already: false,
        tracking_code: null,
        label_url: null,
        label_id: "lbl-1",
      },
    });
    await abrirCard(); // pedido() já tem cpf válido -> disponivel
    await act(async () => {
      botao("Gerar etiqueta")?.click();
    });
    await act(async () => {
      botao("Confirmar e gerar")?.click();
      await esperarMicrotarefas();
    });
    const chamada = invokeMock.mock.calls.find(
      (c) => c[0] === "melhor-envio-etiqueta",
    );
    expect(chamada?.[1]?.body).not.toHaveProperty("cpf");
  });

  it("gerar_etiqueta responde 400 precisa_cpf (tela desatualizada): relê o pedido e cai no estado de CPF, com a mensagem visível", async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: {
        name: "FunctionsHttpError",
        context: new Response(
          JSON.stringify({
            error: "Este pedido não tem o CPF do destinatário.",
            precisa_cpf: true,
          }),
          { status: 400 },
        ),
      },
    });
    await abrirCard();

    // A releitura traz o que a edge de fato viu: pedido sem CPF.
    pedidoState.data = pedido({ cpf: null });

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

    expect(hospedeiro.querySelector("#cpf-destinatario")).toBeTruthy();
    expect(
      hospedeiro.querySelector('[data-testid="erro-etiqueta"]')?.textContent,
    ).toBe("Este pedido não tem o CPF do destinatário.");
  });

  it("CPF inteiro nunca aparece no DOM — a confirmação de compra mostra só a máscara", async () => {
    await abrirCard(); // pedido() já tem cpf válido -> disponivel
    await act(async () => {
      botao("Gerar etiqueta")?.click();
    });
    const textoCpf =
      hospedeiro.querySelector('[data-testid="cpf-mascarado"]')?.textContent ??
      "";
    expect(textoCpf).toContain("25");
    expect(hospedeiro.textContent).not.toContain("52998224725");
  });

  // ── Corrida: pedido troca de A para B com uma chamada de A ainda em voo ──
  // (achado da revisão Opus sobre o commit aadbf4c: 5-20 s de geração de
  // etiqueta é tempo de sobra para o lojista trocar de ficha no meio).

  const ORDER_A = "11111111-1111-1111-1111-111111111111";
  const ORDER_B = "bbbbbbbb-1111-1111-1111-111111111111";

  it("gerar_etiqueta em voo + troca A→B: a resposta de A NÃO vira 'emitida' em B, sem link de A, onTrackingAtualizado nunca chamado com o código de A", async () => {
    let resolverA: (v: unknown) => void = () => {};
    invokeMock.mockReturnValue(
      new Promise((resolve) => {
        resolverA = resolve;
      }),
    );
    const onTrackingAtualizado = vi.fn();
    await abrirCard(ORDER_A, { onTrackingAtualizado });
    await act(async () => {
      botao("Gerar etiqueta")?.click();
    });
    await act(async () => {
      botao("Confirmar e gerar")?.click();
    });

    // Troca para B enquanto a compra de A está em voo.
    pedidoState.data = pedido({
      id: ORDER_B,
      shipping_option_id: "store-pickup",
    });
    await abrirCard(ORDER_B, { onTrackingAtualizado });
    expect(hospedeiro.textContent).toMatch(/retirada na loja/i);

    // A resposta ATRASADA de A chega só agora.
    await act(async () => {
      resolverA({
        data: {
          success: true,
          already: false,
          tracking_code: "ME-DE-A",
          label_url: "https://melhorenvio.com.br/imprimir/de-A",
          label_id: "lbl-A",
        },
      });
      await esperarMicrotarefas();
    });

    expect(hospedeiro.textContent).toMatch(/retirada na loja/i);
    expect(
      hospedeiro.querySelector(
        'a[href="https://melhorenvio.com.br/imprimir/de-A"]',
      ),
    ).toBeNull();
    expect(onTrackingAtualizado).not.toHaveBeenCalledWith(ORDER_A, "ME-DE-A");
  });

  it("consultar_rastreio em voo + troca A→B: o rastreio de A NÃO aparece sobre B e onTrackingAtualizado nunca é chamado com ele", async () => {
    pedidoState.data = pedido({
      shipping_label_id: "lbl-A",
      shipping_label_url: null,
      tracking_code: "ME-ANTIGO-A",
    });
    let resolverA: (v: unknown) => void = () => {};
    invokeMock.mockReturnValue(
      new Promise((resolve) => {
        resolverA = resolve;
      }),
    );
    const onTrackingAtualizado = vi.fn();
    await abrirCard(ORDER_A, { onTrackingAtualizado });
    await act(async () => {
      botao("Atualizar rastreio")?.click();
    });

    // Troca para B enquanto a consulta de A está em voo.
    pedidoState.data = pedido({
      id: ORDER_B,
      shipping_option_id: "store-pickup",
    });
    await abrirCard(ORDER_B, { onTrackingAtualizado });
    expect(hospedeiro.textContent).toMatch(/retirada na loja/i);

    await act(async () => {
      resolverA({
        data: {
          success: true,
          tracking_code: "ME-NOVO-DE-A",
          status_etiqueta: "posted",
        },
      });
      await esperarMicrotarefas();
    });

    expect(hospedeiro.textContent).toMatch(/retirada na loja/i);
    expect(onTrackingAtualizado).not.toHaveBeenCalledWith(
      ORDER_A,
      "ME-NOVO-DE-A",
    );
  });

  it("definir_cpf_destinatario em voo + troca A→B: o resultado de A não grava/mostra nada sobre B", async () => {
    pedidoState.data = pedido({ cpf: null });
    let resolverA: (v: unknown) => void = () => {};
    invokeMock.mockReturnValue(
      new Promise((resolve) => {
        resolverA = resolve;
      }),
    );
    await abrirCard(ORDER_A);
    const campo =
      hospedeiro.querySelector<HTMLInputElement>("#cpf-destinatario")!;
    await act(async () => {
      digitarNoInput(campo, "52998224725");
    });
    await act(async () => {
      botao("Salvar CPF")?.click();
    });

    // Troca para B enquanto o salvamento de A está em voo.
    pedidoState.data = pedido({
      id: ORDER_B,
      shipping_option_id: "store-pickup",
    });
    await abrirCard(ORDER_B);
    expect(hospedeiro.textContent).toMatch(/retirada na loja/i);

    await act(async () => {
      resolverA({ data: { success: true, cpf_final: "25" } });
      await esperarMicrotarefas();
    });

    // B continua mostrando B (indisponível) — nem o campo de CPF nem
    // "Gerar etiqueta" herdados do desfecho de A aparecem.
    expect(hospedeiro.textContent).toMatch(/retirada na loja/i);
    expect(hospedeiro.querySelector("#cpf-destinatario")).toBeNull();
    expect(botao("Gerar etiqueta")).toBeUndefined();
  });

  it("resgate em voo + troca A→B: a releitura do resgate NÃO busca A por cima de B (prova pelo id que cada `.eq` recebeu)", async () => {
    let resolverA: (v: unknown) => void = () => {};
    invokeMock.mockReturnValue(
      new Promise((resolve) => {
        resolverA = resolve;
      }),
    );
    await abrirCard(ORDER_A);
    await act(async () => {
      botao("Gerar etiqueta")?.click();
    });
    await act(async () => {
      botao("Confirmar e gerar")?.click();
    });

    // Troca para B enquanto a geração de A está em voo.
    pedidoState.data = pedido({
      id: ORDER_B,
      shipping_option_id: "store-pickup",
    });
    await abrirCard(ORDER_B);
    expect(hospedeiro.textContent).toMatch(/retirada na loja/i);
    // Até aqui, só A (leitura inicial) e B (leitura da troca) foram lidos.
    expect(eqChamadas).toEqual([ORDER_A, ORDER_B]);

    // A resposta de A chega DEPOIS da troca: é um resgate (409) — se a
    // guarda não existisse, o handler releria o pedido pelo `orderId` da
    // CLOSURE velha (A), gerando um 3º `.eq` com o id de A.
    await act(async () => {
      resolverA({
        data: null,
        error: {
          name: "FunctionsHttpError",
          context: new Response(
            JSON.stringify({
              error:
                "Já existe uma geração de etiqueta em andamento para este pedido.",
              label_id: "lbl-corrida-A",
              resgate: true,
            }),
            { status: 409 },
          ),
        },
      });
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(hospedeiro.textContent).toMatch(/retirada na loja/i);
    expect(eqChamadas).toEqual([ORDER_A, ORDER_B]);
    expect(
      hospedeiro.querySelector('[data-testid="erro-etiqueta"]'),
    ).toBeNull();
  });

  // ── Corrida MODELANDO PRODUÇÃO: com `key={orderId}` a troca A→B DESMONTA
  // a instância de A de verdade (React não reaproveita) — os 5 testes de
  // corrida acima usam `abrirCard`, que re-renderiza a MESMA instância com
  // uma prop nova, sem `key`, e por isso nunca passam por este caminho. 2ª
  // rodada da revisão Opus sobre aadbf4c: é exatamente esta diferença que
  // fazia a guarda por `useRef` escrito no corpo do render nunca disparar em
  // produção (`OrderDetail.tsx` usa `key={order.id}`).

  it("[PRODUÇÃO] key={orderId} desmonta A ao trocar para B: resposta atrasada de A não chama onTrackingAtualizado nem mostra toast de sucesso/erro de A", async () => {
    const { EtiquetaDoPedidoCard } = await import(
      "@/components/admin/orders/EtiquetaDoPedidoCard"
    );
    let resolverA: (v: unknown) => void = () => {};
    invokeMock.mockReturnValue(
      new Promise((resolve) => {
        resolverA = resolve;
      }),
    );
    const onTrackingAtualizado = vi.fn();

    await act(async () => {
      raiz.render(
        <EtiquetaDoPedidoCard
          key={ORDER_A}
          orderId={ORDER_A}
          isOffline={false}
          onTrackingAtualizado={onTrackingAtualizado}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      botao("Gerar etiqueta")?.click();
    });
    await act(async () => {
      botao("Confirmar e gerar")?.click();
    });

    // Troca para B com `key` diferente — DESMONTA a instância de A de
    // verdade, igual `OrderDetail.tsx` faz ao trocar de pedido.
    pedidoState.data = pedido({
      id: ORDER_B,
      shipping_option_id: "store-pickup",
    });
    await act(async () => {
      raiz.render(
        <EtiquetaDoPedidoCard
          key={ORDER_B}
          orderId={ORDER_B}
          isOffline={false}
          onTrackingAtualizado={onTrackingAtualizado}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    expect(hospedeiro.textContent).toMatch(/retirada na loja/i);

    // A resposta ATRASADA de A chega só agora, sobre a instância JÁ
    // DESMONTADA (o `fetch`/`invoke` em voo sobrevive na closure mesmo sem
    // o componente estar mais na árvore).
    await act(async () => {
      resolverA({
        data: {
          success: true,
          already: false,
          tracking_code: "ME-DE-A",
          label_url: "https://melhorenvio.com.br/imprimir/de-A",
          label_id: "lbl-A",
        },
      });
      await esperarMicrotarefas();
    });

    expect(hospedeiro.textContent).toMatch(/retirada na loja/i);
    expect(onTrackingAtualizado).not.toHaveBeenCalled();
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it("[PRODUÇÃO] A→B→A com a compra de A ainda em voo: o 2º 'Confirmar e gerar' de A (instância NOVA, pós-desmonte) não dispara 2ª invocação — trava de reentrada sobrevive ao desmonte por estar em escopo de MÓDULO", async () => {
    const { EtiquetaDoPedidoCard } = await import(
      "@/components/admin/orders/EtiquetaDoPedidoCard"
    );
    let resolverA: (v: unknown) => void = () => {};
    invokeMock.mockReturnValue(
      new Promise((resolve) => {
        resolverA = resolve;
      }),
    );

    // 1) Abre A, confirma a compra — fica em voo (resolverA ainda não foi
    // chamado).
    await act(async () => {
      raiz.render(
        <EtiquetaDoPedidoCard
          key={ORDER_A}
          orderId={ORDER_A}
          isOffline={false}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      botao("Gerar etiqueta")?.click();
    });
    await act(async () => {
      botao("Confirmar e gerar")?.click();
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);

    // 2) Troca para B — DESMONTA a instância de A com a compra ainda em voo.
    pedidoState.data = pedido({
      id: ORDER_B,
      shipping_option_id: "store-pickup",
    });
    await act(async () => {
      raiz.render(
        <EtiquetaDoPedidoCard
          key={ORDER_B}
          orderId={ORDER_B}
          isOffline={false}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    expect(hospedeiro.textContent).toMatch(/retirada na loja/i);

    // 3) Volta para A — MONTA UMA INSTÂNCIA NOVA (3ª), sem nenhuma memória
    // de que uma compra de A já está em voo: se a trava fosse por INSTÂNCIA
    // (o `useRef<Set>` de antes desta correção), o Set desta instância
    // nasceria VAZIO e um 2º clique em "Confirmar e gerar" passaria
    // despercebido — comprando a etiqueta duas vezes (dinheiro de verdade).
    pedidoState.data = pedido({ id: ORDER_A });
    await act(async () => {
      raiz.render(
        <EtiquetaDoPedidoCard
          key={ORDER_A}
          orderId={ORDER_A}
          isOffline={false}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // Os botões TÊM de existir: sem isto, um card ainda carregando faria o
    // clique não acontecer e o teste passaria sem provar a trava.
    expect(botao("Gerar etiqueta")).toBeTruthy();
    await act(async () => {
      botao("Gerar etiqueta")?.click();
    });
    expect(botao("Confirmar e gerar")).toBeTruthy();
    await act(async () => {
      botao("Confirmar e gerar")?.click();
    });

    // A compra original de A continua em voo — a trava de MÓDULO ainda tem
    // ORDER_A dentro, então este clique NÃO pode invocar de novo, e AVISA.
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining("em andamento"),
    );

    // Limpeza: resolve a chamada original para não vazar estado pendente
    // entre testes (o `beforeEach` seguinte também zera a trava, mas a
    // promise em si ficaria pendurada sem isto).
    await act(async () => {
      resolverA({
        data: {
          success: true,
          already: false,
          tracking_code: "ME-A",
          label_url: null,
          label_id: "lbl-A",
        },
      });
      await esperarMicrotarefas();
    });
  });
});
