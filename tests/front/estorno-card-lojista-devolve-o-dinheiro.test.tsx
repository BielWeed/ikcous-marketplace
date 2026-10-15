// @vitest-environment jsdom
//
// T6 do plano-mãe de estorno pelo app (`20260907-plano-estorno-pelo-app.md`)
// — o cartão "Devolução de dinheiro" que o lojista vê na ficha do pedido
// (`OrderDetail.tsx`). O hook (`useEstornosDoPedido`) é mockado por inteiro
// aqui: este arquivo cobre só o que o CARTÃO decide a partir do saldo e das
// linhas que o hook devolve — a leitura do banco é coberta à parte em
// `use-estornos-do-pedido-rpc-depois-edge.test.ts`.
//
// Render de verdade (react-dom/client + jsdom), mesmo casco de
// `cancelar-pedido-pago-avisa-do-dinheiro.test.tsx`: `createRoot` + `act`,
// `IS_REACT_ACT_ENVIRONMENT` ligada, `confirm` stubado por teste.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LinhaEstornoDoPedido } from "@/hooks/useEstornosDoPedido";
import type { Order } from "@/types";

const useEstornosDoPedidoMock = vi.fn();
vi.mock("@/hooks/useEstornosDoPedido", () => ({
  useEstornosDoPedido: (orderId: string) => useEstornosDoPedidoMock(orderId),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pedidoBase: Order = {
  id: "pedido-estorno-1",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      productId: "prod-1",
      name: "Blusa Teste",
      price: 100,
      quantity: 1,
      image: "",
    },
  ],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "online",
  status: "cancelled",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
  paymentStatus: "pago",
};

function linhaDeExemplo(
  extra: Partial<LinhaEstornoDoPedido> = {},
): LinhaEstornoDoPedido {
  return {
    id: "refund-1",
    amount: 30,
    status: "em_processamento",
    solicitado_por: "lojista",
    mp_status: null,
    mp_status_detail: null,
    tentativas: 1,
    ultimo_erro: null,
    motivo: null,
    created_at: "2026-09-01T10:00:00.000Z",
    concluido_em: null,
    // Lote R1: veredito do servidor. Padrão = "nada saiu" (o caso de hoje);
    // os testes do R1 ligam `pode_ter_saido` explicitamente.
    pode_ter_saido: false,
    por_fora_liberado_em: null,
    por_fora_apos_espera_liberado: false,
    substituida_por_manual: false,
    eh_pix: false,
    ...extra,
  };
}

const solicitarEstornoMock = vi.fn().mockResolvedValue(undefined);
const registrarPorForaAposEsperaMock = vi.fn().mockResolvedValue(true);
const recarregarMock = vi.fn();

function hookPadrao(
  extra: Partial<ReturnType<typeof useEstornosDoPedidoMock>> = {},
) {
  return {
    linhas: [] as LinhaEstornoDoPedido[],
    pago: 100,
    devolvido: 0,
    emCurso: 0,
    emDuvida: 0,
    disponivel: 100,
    carregando: false,
    // Data já leu pelo menos uma vez (primeira carga concluída) — os 11
    // testes originais assumem saldo confiável na tela. O caso "ainda não
    // sei" (BLOQUEIA 2) põe isto em `false` explicitamente.
    pedidoCarregado: true,
    erro: false,
    recarregar: recarregarMock,
    solicitarEstorno: solicitarEstornoMock,
    registrarPorForaAposEspera: registrarPorForaAposEsperaMock,
    enviando: false,
    ...extra,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
let confirmMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  solicitarEstornoMock.mockClear();
  registrarPorForaAposEsperaMock.mockClear();
  recarregarMock.mockClear();
  useEstornosDoPedidoMock.mockReset();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

async function montar(order: Order = pedidoBase) {
  const { EstornoCard } = await import("@/components/admin/orders/EstornoCard");
  await act(async () => {
    raiz.render(<EstornoCard order={order} />);
  });
}

// `formatCurrency` usa NBSP (U+00A0) entre "R$" e o número (é o que o ICU
// devolve para moeda em pt-BR — ver `admin-coupon-form-view-minimo-com-
// centavos.test.tsx:67`, mesmo `\s+` normalizado para espaço comum).
function normalizarEspacos(valor: string | null): string {
  return (valor ?? "").replace(/\s+/g, " ");
}

function texto(): string {
  return normalizarEspacos(hospedeiro.textContent);
}

function botaoComTexto(alvo: string): HTMLButtonElement | undefined {
  return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    normalizarEspacos(b.textContent).includes(alvo),
  );
}

describe("EstornoCard — o lojista devolve o dinheiro do pedido pelo painel", () => {
  it("U1: pedido pago, cancelado, não enviado, sem linhas — botão habilitado com o total disponível", async () => {
    useEstornosDoPedidoMock.mockReturnValue(hookPadrao());

    await montar();

    const botao = botaoComTexto("Devolver R$ 100,00");
    expect(botao).toBeDefined();
    expect(botao?.disabled).toBe(false);
  });

  it("U2: cancelado após envio sem retorno do produto — botão desabilitado e texto do retorno", async () => {
    useEstornosDoPedidoMock.mockReturnValue(hookPadrao());

    await montar({
      ...pedidoBase,
      cancelledAfterShipping: true,
      returnedToSellerAt: null,
    });

    const botao = botaoComTexto("Devolver R$ 100,00");
    expect(botao?.disabled).toBe(true);
    // BLOQUEIA 1 do laudo 08/09: o texto antigo mandava clicar num "botão
    // acima" que não existe nesta tela — o botão de retorno vive no alerta
    // de pedidos cancelados, ao lado do título "Pedidos"
    // (`AlertasCancelados.tsx`), não na ficha do pedido.
    expect(texto()).toContain(
      "Para devolver o dinheiro, primeiro confirme que o produto voltou, no aviso de pedidos cancelados (ícone ao lado do título Pedidos).",
    );
    expect(texto()).not.toContain("acima");
  });

  it("U3: clique confirma e chama solicitarEstorno UMA vez; recusar o confirm não chama nada", async () => {
    useEstornosDoPedidoMock.mockReturnValue(hookPadrao());
    confirmMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirmMock);

    await montar();
    const botao = botaoComTexto("Devolver R$ 100,00");
    await act(async () => {
      botao?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(solicitarEstornoMock).toHaveBeenCalledTimes(1);
    expect(solicitarEstornoMock).toHaveBeenCalledWith({
      amount: 100,
      motivo: expect.any(String),
    });

    // Recusar o confirm: zero chamadas na rodada seguinte.
    solicitarEstornoMock.mockClear();
    confirmMock.mockReturnValue(false);
    await act(async () => {
      botao?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(solicitarEstornoMock).not.toHaveBeenCalled();
  });

  it("U4: linha em_processamento mostra o texto 'em andamento'", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({ linhas: [linhaDeExemplo({ tentativas: 1 })] }),
    );

    await montar();

    expect(texto()).toContain(
      "Devolução de R$ 30,00 em andamento — o Mercado Pago está processando. Eu aviso aqui quando concluir.",
    );
  });

  it("U5: concluído parcial de 30 — saldo e botão refletem o restante", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        devolvido: 30,
        disponivel: 70,
        linhas: [
          linhaDeExemplo({
            status: "concluido",
            solicitado_por: "lojista",
            concluido_em: "2026-09-01T12:30:00.000Z",
          }),
        ],
      }),
    );

    await montar();

    expect(texto()).toContain("Devolvido: R$ 30,00 · Disponível: R$ 70,00");
    expect(botaoComTexto("Devolver R$ 70,00")).toBeDefined();
  });

  it("U6: falhou mostra o erro e 'Tentar de novo'; recusado (sem chargeback) não tem botão", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        linhas: [
          linhaDeExemplo({
            id: "refund-falhou",
            status: "falhou",
            ultimo_erro: "o Mercado Pago recusou o valor informado",
          }),
        ],
      }),
    );
    await montar();
    expect(texto()).toContain(
      "A devolução de R$ 30,00 não foi concluída: o Mercado Pago recusou o valor informado",
    );
    expect(botaoComTexto("Tentar de novo")).toBeDefined();

    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);

    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        linhas: [
          linhaDeExemplo({
            id: "refund-recusado",
            status: "recusado",
            ultimo_erro: "pagamento fora do prazo de 180 dias",
          }),
        ],
      }),
    );
    await montar();
    expect(texto()).toContain(
      "A devolução de R$ 30,00 foi recusada: pagamento fora do prazo de 180 dias",
    );
    expect(botaoComTexto("Tentar de novo")).toBeUndefined();
  });

  it("U7: nenhum texto do DOM expõe id do Mercado Pago, em nenhum dos estados", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        disponivel: 0,
        devolvido: 100,
        linhas: [
          linhaDeExemplo({
            id: "id-solicitado",
            status: "solicitado",
          }),
          linhaDeExemplo({
            id: "id-em-processamento",
            status: "em_processamento",
            tentativas: 5,
          }),
          linhaDeExemplo({
            id: "id-concluido",
            status: "concluido",
            concluido_em: "2026-09-01T12:00:00.000Z",
          }),
          linhaDeExemplo({
            id: "id-concluido-sistema",
            status: "concluido",
            solicitado_por: "sistema",
            concluido_em: "2026-09-01T12:00:00.000Z",
          }),
          linhaDeExemplo({
            id: "id-falhou",
            status: "falhou",
            ultimo_erro: "erro",
          }),
          linhaDeExemplo({
            id: "id-recusado",
            status: "recusado",
            ultimo_erro: "erro",
          }),
          linhaDeExemplo({
            id: "id-chargeback-em-curso",
            status: "em_processamento",
            solicitado_por: "sistema",
            mp_status: "charged_back",
          }),
          linhaDeExemplo({
            id: "id-chargeback-concluido",
            status: "concluido",
            solicitado_por: "sistema",
            mp_status: "charged_back",
            concluido_em: "2026-09-01T12:00:00.000Z",
          }),
          linhaDeExemplo({
            id: "id-chargeback-recusado",
            status: "recusado",
            solicitado_por: "sistema",
            mp_status: "charged_back",
          }),
        ],
      }),
    );

    await montar();

    const dom = texto();
    expect(dom).not.toContain("mp_refund_id");
    expect(dom).not.toContain("PAY");
    expect(dom).not.toContain("api.");
    expect(dom).not.toContain("refund_id");
    expect(dom).not.toContain("uuid");
  });

  it("U8: disponível de R$ 0,01 renderiza 'R$ 0,01', sem sumir o zero à esquerda", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({ pago: 100, devolvido: 99.99, disponivel: 0.01 }),
    );

    await montar();

    expect(texto()).toContain("Disponível: R$ 0,01");
    expect(botaoComTexto("Devolver R$ 0,01")).toBeDefined();
  });

  it("U9: chargeback em análise mostra o texto de contestação, sem 'Tentar de novo', e o saldo já considera o valor reservado", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        emCurso: 30,
        disponivel: 70,
        linhas: [
          linhaDeExemplo({
            solicitado_por: "sistema",
            mp_status: "charged_back",
            status: "em_processamento",
          }),
        ],
      }),
    );

    await montar();

    expect(texto()).toContain(
      "Contestação no cartão de R$ 30,00 em análise no Mercado Pago — o valor fica reservado até a decisão.",
    );
    expect(botaoComTexto("Tentar de novo")).toBeUndefined();
    expect(botaoComTexto("Devolver R$ 70,00")).toBeDefined();
  });

  it("U10: teto de 5 tentativas mostra o aviso e NUNCA oferece 'Tentar de novo'", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        linhas: [linhaDeExemplo({ status: "em_processamento", tentativas: 5 })],
      }),
    );

    await montar();

    expect(texto()).toContain(
      "A devolução de R$ 30,00 não foi confirmada pelo Mercado Pago depois de 5 tentativas.",
    );
    expect(botaoComTexto("Tentar de novo")).toBeUndefined();
  });

  it("U11: pedido não cancelado — texto de aviso e botão desabilitado", async () => {
    useEstornosDoPedidoMock.mockReturnValue(hookPadrao());

    await montar({ ...pedidoBase, status: "processing" });

    expect(texto()).toContain("Cancele o pedido antes de devolver o dinheiro.");
    expect(botaoComTexto("Devolver R$ 100,00")?.disabled).toBe(true);
  });

  it("BLOQUEIA 2: durante a primeira carga, não afirma nada sobre saldo", async () => {
    // `pedido === null` (`pedidoCarregado: false`) + `carregando: true` —
    // ainda NÃO SEI o saldo, o que é diferente de "saldo é zero".
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        carregando: true,
        pedidoCarregado: false,
        pago: 0,
        devolvido: 0,
        disponivel: 0,
        linhas: [],
      }),
    );

    await montar();

    const domCarregando = texto();
    expect(domCarregando).not.toContain("já foi devolvido");
    expect(domCarregando).not.toContain("R$ 0,00");
    expect(domCarregando).toContain("Carregando");

    // Resolve: mesmo componente, novo retorno do hook (sem remontar).
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        carregando: false,
        pedidoCarregado: true,
        pago: 100,
        devolvido: 0,
        disponivel: 100,
      }),
    );
    const { EstornoCard } = await import(
      "@/components/admin/orders/EstornoCard"
    );
    await act(async () => {
      raiz.render(<EstornoCard order={pedidoBase} />);
    });

    expect(texto()).toContain("Pago: R$ 100,00");
    expect(botaoComTexto("Devolver R$ 100,00")).toBeDefined();
  });

  it("AC 3 — limbo (carregando:false, pedidoCarregado:false, erro:false) ainda mostra 'Carregando…', nunca afirma saldo", async () => {
    // Só alcançável hoje se `.single()` devolver `{data:null,error:null}`
    // (o cast do hook aceita null sem erro) — a guarda tinha de valer pela
    // invariante `!pedidoCarregado`, não pela combinação com `carregando`.
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        carregando: false,
        pedidoCarregado: false,
        erro: false,
        pago: 0,
        devolvido: 0,
        disponivel: 0,
        linhas: [],
      }),
    );

    await montar();

    const dom = texto();
    expect(dom).toContain("Carregando");
    expect(dom).not.toContain("Pago:");
    expect(dom).not.toContain("já foi devolvido");
    expect(dom).not.toContain("R$ 0,00");
  });

  it("AC4-A (mutação A): disponível zero (100% estornado) NÃO mostra botão de devolver", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({ pago: 100, devolvido: 100, disponivel: 0 }),
    );

    await montar();

    expect(texto()).toContain("Todo o valor pago já foi devolvido.");
    expect(botaoComTexto("Devolver")).toBeUndefined();
  });

  it("AC4-B (mutação B): 'falhou' com saldo insuficiente NÃO oferece 'Tentar de novo'", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        disponivel: 10,
        linhas: [
          linhaDeExemplo({
            status: "falhou",
            amount: 30,
            ultimo_erro: "erro qualquer",
          }),
        ],
      }),
    );

    await montar();

    expect(texto()).toContain("A devolução de R$ 30,00 não foi concluída");
    expect(botaoComTexto("Tentar de novo")).toBeUndefined();
  });

  async function abrirCampoDeOutroValor(): Promise<HTMLInputElement> {
    const abrir = botaoComTexto("devolver outro valor");
    await act(async () => {
      abrir?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    const input = hospedeiro.querySelector("input");
    if (!input) throw new Error("input do campo não encontrado");
    return input as HTMLInputElement;
  }

  // Escrever num input controlado por React em jsdom exige o setter nativo +
  // evento de input; atribuir `.value` direto não avisa o React (mesmo
  // padrão de `admin-shipping-trocar-de-aba-nao-apaga-o-que-foi-digitado`).
  async function digitar(input: HTMLInputElement, valor: string) {
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(input, valor);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
  }

  it("campo 'outro valor': '10,50' habilita 'Devolver R$ 10,50' e a RPC recebe 10.5", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({ pago: 45.77, devolvido: 0, disponivel: 45.77 }),
    );
    confirmMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirmMock);

    await montar();
    const input = await abrirCampoDeOutroValor();
    await digitar(input, "10,50");

    const botao = botaoComTexto("Devolver R$ 10,50");
    expect(botao?.disabled).toBe(false);

    await act(async () => {
      botao?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(solicitarEstornoMock).toHaveBeenCalledWith({
      amount: 10.5,
      motivo: expect.any(String),
    });
  });

  it("campo 'outro valor': acima do disponível desabilita com a mensagem de faixa", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({ pago: 45.77, devolvido: 0, disponivel: 45.77 }),
    );

    await montar();
    const input = await abrirCampoDeOutroValor();
    await digitar(input, "100");

    expect(texto()).toContain("O valor tem de ficar entre R$ 0,01 e R$ 45,77");
    expect(botaoComTexto("Devolver R$ 100,00")?.disabled).toBe(true);
  });

  it("campo 'outro valor': vazio desabilita o botão", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({ pago: 45.77, devolvido: 0, disponivel: 45.77 }),
    );

    await montar();
    await abrirCampoDeOutroValor();

    expect(botaoComTexto("Devolver R$ 0,00")?.disabled).toBe(true);
  });

  it("campo 'outro valor': '1.500,00' (milhar pt-BR) vira 1500 e habilita", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({ pago: 2000, devolvido: 0, disponivel: 2000 }),
    );

    await montar();
    const input = await abrirCampoDeOutroValor();
    await digitar(input, "1.500,00");

    expect(botaoComTexto("Devolver R$ 1.500,00")?.disabled).toBe(false);
  });

  it("campo 'outro valor': '1500.50' (ponto decimal) continua aceito como 1500,50", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({ pago: 2000, devolvido: 0, disponivel: 2000 }),
    );

    await montar();
    const input = await abrirCampoDeOutroValor();
    await digitar(input, "1500.50");

    expect(botaoComTexto("Devolver R$ 1.500,50")?.disabled).toBe(false);
  });

  it("campo 'outro valor': '1500,50' (vírgula sem milhar) continua aceito", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({ pago: 2000, devolvido: 0, disponivel: 2000 }),
    );

    await montar();
    const input = await abrirCampoDeOutroValor();
    await digitar(input, "1500,50");

    expect(botaoComTexto("Devolver R$ 1.500,50")?.disabled).toBe(false);
  });

  it("campo 'outro valor': '1e2' é recusado por FORMATO, mesmo com saldo generoso", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({ pago: 2000, devolvido: 0, disponivel: 2000 }),
    );

    await montar();
    const input = await abrirCampoDeOutroValor();
    await digitar(input, "1e2");

    // NaN de propósito: cai no rótulo de 0 e fica desabilitado — se o
    // parser aceitasse notação científica, "1e2" viraria 100 (< 2000) e
    // o botão apareceria habilitado com "Devolver R$ 100,00".
    expect(botaoComTexto("Devolver R$ 0,00")?.disabled).toBe(true);
    expect(botaoComTexto("Devolver R$ 100,00")).toBeUndefined();
  });

  it("campo 'outro valor': '0,001' abaixo do piso desabilita, aria-invalid e a RPC nunca é chamada", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({ pago: 45.77, devolvido: 0, disponivel: 45.77 }),
    );

    await montar();
    const input = await abrirCampoDeOutroValor();
    await digitar(input, "0,001");

    const botao = botaoComTexto("Devolver R$ 0,00");
    expect(botao?.disabled).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(texto()).toContain("O valor tem de ficar entre R$ 0,01 e R$ 45,77");
    expect(solicitarEstornoMock).not.toHaveBeenCalled();
  });

  it("campo 'outro valor': '0,01' (piso exato) habilita 'Devolver R$ 0,01'", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({ pago: 45.77, devolvido: 0, disponivel: 45.77 }),
    );

    await montar();
    const input = await abrirCampoDeOutroValor();
    await digitar(input, "0,01");

    const botao = botaoComTexto("Devolver R$ 0,01");
    expect(botao?.disabled).toBe(false);
  });

  it("acessibilidade do campo: aria-invalid, aria-describedby e foco ao abrir", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({ pago: 45.77, devolvido: 0, disponivel: 45.77 }),
    );

    await montar();
    const input = await abrirCampoDeOutroValor();

    expect(document.activeElement).toBe(input);

    await digitar(input, "100");

    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const aviso = describedBy ? document.getElementById(describedBy) : null;
    expect(aviso?.textContent).toContain("O valor tem de ficar entre");
  });
});

// ---------------------------------------------------------------------------
// Lote R1 (15/10/2026): o veredito "pode ter saído" é do SERVIDOR, e a tela
// decide os botões só a partir dele. jsdom não vê CSS: aqui só se afirma o
// que está no DOM (texto, botões, chamadas), nunca layout.
// ---------------------------------------------------------------------------
describe("EstornoCard — lote R1: linha que pode ter saído não se repete", () => {
  async function clicar(botao: HTMLButtonElement | undefined) {
    await act(async () => {
      botao?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
  }

  it("R1-A: falhou com pode_ter_saido=false — 'Tentar de novo' normal, sem saída dos 7 dias", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        linhas: [
          linhaDeExemplo({
            status: "falhou",
            ultimo_erro: "Saldo insuficiente.",
            pode_ter_saido: false,
          }),
        ],
      }),
    );
    await montar();

    expect(texto()).toContain(
      "A devolução de R$ 30,00 não foi concluída: Saldo insuficiente.",
    );
    expect(botaoComTexto("Tentar de novo")).toBeDefined();
    expect(texto()).not.toContain("não repita");
    expect(botaoComTexto("Já devolvi por fora")).toBeUndefined();
  });

  it("R1-B: falhou com pode_ter_saido=true — SEM 'Tentar de novo', mostra 'confirmando… não repita'", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        linhas: [
          linhaDeExemplo({
            status: "falhou",
            ultimo_erro: "Tempo esgotado.",
            pode_ter_saido: true,
          }),
        ],
      }),
    );
    await montar();

    expect(texto()).toContain(
      "A loja está confirmando com o Mercado Pago, não repita.",
    );
    expect(botaoComTexto("Tentar de novo")).toBeUndefined();
    // Ainda sem liberação do servidor: nenhuma saída por fora.
    expect(botaoComTexto("Já devolvi por fora")).toBeUndefined();
  });

  it("R1-C: recusado com pode_ter_saido=true também avisa 'não repita'", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        linhas: [
          linhaDeExemplo({
            status: "recusado",
            ultimo_erro: "Recusado.",
            pode_ter_saido: true,
          }),
        ],
      }),
    );
    await montar();

    expect(texto()).toContain("não repita");
    expect(botaoComTexto("Tentar de novo")).toBeUndefined();
  });

  it("R1-D: servidor liberou (por_fora_apos_espera_liberado) — botão dos 7 dias com aviso de dobro e frase obrigatória", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        linhas: [
          linhaDeExemplo({
            id: "refund-velho",
            status: "falhou",
            pode_ter_saido: true,
            por_fora_apos_espera_liberado: true,
          }),
        ],
      }),
    );
    await montar();

    expect(botaoComTexto("Tentar de novo")).toBeUndefined();
    const botao = botaoComTexto("Já devolvi por fora (depois de 7 dias)");

    // Frase errada (minúscula), ou desistir (null): nada é registrado.
    const promptMock = vi.fn().mockReturnValue("devolvi por fora");
    vi.stubGlobal("prompt", promptMock);
    await clicar(botao);
    promptMock.mockReturnValue(null);
    await clicar(botao);
    expect(registrarPorForaAposEsperaMock).not.toHaveBeenCalled();

    // O diálogo mostra o risco de dobro e pede a frase fixa.
    expect(promptMock.mock.calls[0][0]).toContain(
      "Se o Mercado Pago ainda processar esta devolução, o cliente recebe em dobro.",
    );
    expect(promptMock.mock.calls[0][0]).toContain("digite DEVOLVI POR FORA");

    promptMock.mockReturnValue(" DEVOLVI POR FORA ");
    await clicar(botao);

    expect(registrarPorForaAposEsperaMock).toHaveBeenCalledTimes(1);
    expect(registrarPorForaAposEsperaMock).toHaveBeenCalledWith("refund-velho");
    // A saída por fora nunca pede dinheiro ao Mercado Pago.
    expect(solicitarEstornoMock).not.toHaveBeenCalled();
  });

  it("R1-E: linha travada (5 tentativas) liberada pelo servidor ganha a saída dos 7 dias, nunca 'Tentar de novo'", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        linhas: [
          linhaDeExemplo({
            status: "em_processamento",
            tentativas: 5,
            pode_ter_saido: true,
            por_fora_apos_espera_liberado: true,
          }),
        ],
      }),
    );
    await montar();

    expect(botaoComTexto("Tentar de novo")).toBeUndefined();
    expect(
      botaoComTexto("Já devolvi por fora (depois de 7 dias)"),
    ).toBeDefined();
  });

  it("R1-F: linha concluída nunca mostra saída por fora, mesmo com o servidor liberando", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        linhas: [
          linhaDeExemplo({
            status: "concluido",
            concluido_em: "2026-09-02T10:00:00.000Z",
            pode_ter_saido: true,
            por_fora_apos_espera_liberado: true,
          }),
        ],
      }),
    );
    await montar();

    expect(botaoComTexto("Já devolvi por fora")).toBeUndefined();
  });

  it("R1-H: pode ter saído, há 7 dias, mas o servidor NÃO liberou (booleano false) — sem botão dos 7 dias", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        linhas: [
          linhaDeExemplo({
            status: "falhou",
            pode_ter_saido: true,
            por_fora_apos_espera_liberado: false,
            // Data antiga não decide nada: quem libera é o booleano.
            created_at: "2026-01-01T10:00:00.000Z",
          }),
        ],
      }),
    );
    await montar();

    expect(botaoComTexto("Já devolvi por fora")).toBeUndefined();
    expect(texto()).toContain("não repita");
  });

  it("R1-I: saída já usada (por_fora_liberado_em) — não oferece o botão de novo e diz que já foi registrado", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        linhas: [
          linhaDeExemplo({
            status: "falhou",
            pode_ter_saido: true,
            // Mesmo com o booleano ainda verdadeiro, a marca de uso vence.
            por_fora_apos_espera_liberado: true,
            por_fora_liberado_em: "2026-10-16T10:00:00.000Z",
          }),
        ],
      }),
    );
    await montar();

    expect(botaoComTexto("Já devolvi por fora")).toBeUndefined();
    expect(botaoComTexto("Tentar de novo")).toBeUndefined();
    expect(texto()).toContain("Você já registrou que devolveu por fora.");
  });

  it("R1-J: linha SUBSTITUÍDA pelo manual (pode_ter_saido=false = 'não conta como dúvida') — sem 'Tentar de novo' e sem a saída dos 7 dias, mesmo com saldo", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        disponivel: 100,
        linhas: [
          linhaDeExemplo({
            status: "falhou",
            ultimo_erro: "Tempo esgotado.",
            pode_ter_saido: false,
            substituida_por_manual: true,
            // Mesmo que o servidor dissesse que a espera passou, a linha já foi resolvida.
            por_fora_apos_espera_liberado: true,
          }),
        ],
      }),
    );
    await montar();

    expect(botaoComTexto("Tentar de novo")).toBeUndefined();
    expect(botaoComTexto("Já devolvi por fora")).toBeUndefined();
    expect(texto()).toContain("Você já registrou que devolveu por fora.");
  });

  it("R1-G: o resumo mostra o valor 'Em confirmação' que o servidor prende", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({ emDuvida: 30, disponivel: 70 }),
    );
    await montar();

    expect(texto()).toContain(
      "Disponível: R$ 70,00 · Em confirmação: R$ 30,00",
    );
  });
});
