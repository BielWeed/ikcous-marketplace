// @vitest-environment jsdom
//
// Lote 230: "Devolver R$ ..." (e "Tentar de novo") na ficha do pedido pergunta
// pela JANELA DO APP, não pela caixa nativa do navegador. Cada teste prova
// três coisas: a janela aparece com o valor em destaque e o verbo da ação,
// `confirm` NÃO é chamado, confirmar executa UMA vez (mesmo com duplo toque) e
// desistir não executa nada. Também prova o Voltar do aparelho e o Esc: os
// dois desistem sem executar.
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

const pedido: Order = {
  id: "pedido-estorno-230",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [],
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

const solicitarEstorno = vi.fn().mockResolvedValue(undefined);

function hookPadrao(extra: Record<string, unknown> = {}) {
  return {
    linhas: [] as LinhaEstornoDoPedido[],
    pago: 100,
    devolvido: 0,
    emCurso: 0,
    emDuvida: 0,
    disponivel: 100,
    reservadoPorFora: 0,
    carregando: false,
    pedidoCarregado: true,
    erro: false,
    recarregar: vi.fn(),
    solicitarEstorno,
    registrarPorForaAposEspera: vi.fn(),
    enviando: false,
    ...extra,
  };
}

function linhaEstorno(
  extra: Partial<LinhaEstornoDoPedido> = {},
): LinhaEstornoDoPedido {
  return {
    id: "refund-falhou",
    amount: 30,
    status: "falhou",
    solicitado_por: "lojista",
    mp_status: null,
    mp_status_detail: null,
    tentativas: 1,
    ultimo_erro: "o Mercado Pago recusou",
    motivo: null,
    created_at: "2026-09-01T10:00:00.000Z",
    concluido_em: null,
    pode_ter_saido: false,
    por_fora_liberado_em: null,
    por_fora_apos_espera_liberado: false,
    substituida_por_manual: false,
    eh_pix: false,
    ...extra,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
let nativo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  solicitarEstorno.mockClear();
  useEstornosDoPedidoMock.mockReset();
  nativo = vi.fn(() => true);
  vi.stubGlobal("confirm", nativo);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function montar() {
  const { EstornoCard } = await import("@/components/admin/orders/EstornoCard");
  await act(async () => {
    raiz.render(<EstornoCard order={pedido} />);
  });
}

const normal = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ").trim();

function janela() {
  return document.querySelector<HTMLElement>('[data-testid="confirmar-acao"]');
}

function botaoDa(raizDoBotao: ParentNode, alvo: string) {
  return Array.from(raizDoBotao.querySelectorAll("button")).find((b) =>
    normal(b.textContent).includes(alvo),
  );
}

async function tocar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.click();
  });
}

describe("lote 230 — Devolver R$ ... pergunta pela janela do app", () => {
  it("abre a janela com o valor em destaque e o verbo da ação, sem chamar o confirm nativo", async () => {
    useEstornosDoPedidoMock.mockReturnValue(hookPadrao());
    await montar();

    await tocar(botaoDa(hospedeiro, "Devolver R$ 100,00"));

    expect(nativo).not.toHaveBeenCalled();
    const j = janela();
    expect(j).not.toBeNull();
    // valor em destaque (parágrafo próprio) + texto que a caixa nativa dizia
    expect(normal(j?.querySelector("p")?.textContent)).toBe("R$ 100,00");
    expect(normal(j?.textContent)).toContain(
      "Devolver R$ 100,00 ao cliente pelo Mercado Pago? O dinheiro sai da sua conta do Mercado Pago e não dá para desfazer.",
    );
    // botão da ação com o verbo (não "OK") e botão "Voltar", ambos de 44 px
    const botoes = Array.from(j?.querySelectorAll("button") ?? []);
    expect(botoes.map((b) => normal(b.textContent))).toEqual([
      "Voltar",
      "Devolver R$ 100,00",
    ]);
    expect(normal(j?.textContent)).not.toContain("em andamento neste pedido");
    for (const b of botoes) expect(b.className).toContain("min-h-11");
    // nada foi enviado antes da resposta
    expect(solicitarEstorno).not.toHaveBeenCalled();
  });

  it("mostra valor e horário da devolução solicitada antes de confirmar outra do mesmo valor", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        linhas: [linhaEstorno({ id: "solicitada", status: "solicitado" })],
        emCurso: 30,
        disponivel: 70,
      }),
    );
    await montar();
    await tocar(botaoDa(hospedeiro, "devolver outro valor"));
    const campo = hospedeiro.querySelector("input");
    expect(campo).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo, "30");
      campo?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await tocar(botaoDa(hospedeiro, "Devolver R$ 30,00"));

    const j = janela() as HTMLElement;
    expect(normal(j.textContent)).toContain(
      "Já existe uma devolução de R$ 30,00 em andamento neste pedido.",
    );
    expect(normal(j.textContent)).toContain("01/09 às 07:00");
    expect(normal(j.textContent)).toContain(
      "Confirme só se esta for OUTRA devolução",
    );
    expect(normal(j.textContent)).toContain("aguarde alguns instantes");
    expect(solicitarEstorno).not.toHaveBeenCalled();

    await tocar(botaoDa(j, "Confirmar devolução adicional"));
    expect(solicitarEstorno).toHaveBeenCalledExactlyOnceWith({
      amount: 30,
      motivo: "",
    });
  });

  it.each([
    {
      caso: "em processamento no teto de tentativas",
      linha: linhaEstorno({
        status: "em_processamento",
        tentativas: 5,
        ultimo_erro: null,
      }),
      emCurso: 30,
      emDuvida: 0,
    },
    {
      caso: "parada sem confirmação do Mercado Pago",
      linha: linhaEstorno({ pode_ter_saido: true }),
      emCurso: 0,
      emDuvida: 30,
    },
  ])(
    "orienta a conferir no Mercado Pago quando a devolução anterior está $caso",
    async ({ linha, emCurso, emDuvida }) => {
      useEstornosDoPedidoMock.mockReturnValue(
        hookPadrao({ linhas: [linha], emCurso, emDuvida, disponivel: 70 }),
      );
      await montar();
      await tocar(botaoDa(hospedeiro, "Devolver R$ 70,00"));

      const texto = normal(janela()?.textContent);
      expect(texto).toContain(
        "Já existe uma devolução de R$ 30,00 em andamento neste pedido.",
      );
      expect(texto).toContain(
        "Confirme só se esta for OUTRA devolução. Antes de repetir, confira no painel do Mercado Pago se a anterior saiu.",
      );
      expect(texto).not.toContain("aguarde alguns instantes");
      expect(solicitarEstorno).not.toHaveBeenCalled();
    },
  );

  it("lista cada devolução em processamento ou em dúvida, mesmo sem horário", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        linhas: [
          linhaEstorno({
            id: "processando",
            status: "em_processamento",
            amount: 12,
            created_at: "",
          }),
          linhaEstorno({ id: "duvida", amount: 20, pode_ter_saido: true }),
        ],
        emCurso: 12,
        emDuvida: 20,
        disponivel: 68,
      }),
    );
    await montar();
    await tocar(botaoDa(hospedeiro, "Devolver R$ 68,00"));

    const j = janela() as HTMLElement;
    expect(normal(j.textContent)).toContain("R$ 12,00");
    expect(normal(j.textContent)).toContain("R$ 20,00");
    expect(normal(j.textContent)).toContain(
      "Antes de repetir, confira no painel do Mercado Pago se a anterior saiu.",
    );
    expect(normal(j.textContent)).not.toContain("Invalid Date");
    expect(botaoDa(j, "Confirmar devolução adicional")).toBeDefined();
  });

  it("identifica a devolução sem valor nem horário na confirmação com duas em curso", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        linhas: [
          linhaEstorno({
            id: "sem-dados",
            status: "solicitado",
            amount: undefined as unknown as number,
            created_at: "",
          }),
          linhaEstorno({
            id: "com-valor",
            status: "em_processamento",
            amount: 20,
          }),
        ],
        emCurso: 20,
        disponivel: 80,
      }),
    );
    await montar();
    await tocar(botaoDa(hospedeiro, "Devolver R$ 80,00"));

    const texto = normal(janela()?.textContent);
    expect(texto).toContain("Valor não informado");
    expect(texto).toContain("R$ 20,00");
  });

  it("avisa sobre a devolução concluída no gateway, mas ainda sem data de confirmação", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        linhas: [linhaEstorno({ status: "concluido", concluido_em: null })],
        emCurso: 30,
        disponivel: 70,
      }),
    );
    await montar();
    await tocar(botaoDa(hospedeiro, "Devolver R$ 70,00"));

    const j = janela() as HTMLElement;
    expect(normal(j.textContent)).toContain(
      "Já existe uma devolução de R$ 30,00 em andamento neste pedido.",
    );
    expect(botaoDa(j, "Confirmar devolução adicional")).toBeDefined();
  });

  it.each([undefined, null])(
    "não inventa valor na confirmação quando chega %s",
    async (amount) => {
      useEstornosDoPedidoMock.mockReturnValue(
        hookPadrao({
          linhas: [
            linhaEstorno({
              status: "solicitado",
              // Simula um valor ausente na resposta, apesar do tipo declarado.
              amount: amount as unknown as number,
            }),
          ],
        }),
      );
      await montar();
      await tocar(botaoDa(hospedeiro, "Devolver R$ 100,00"));

      const j = janela() as HTMLElement;
      const texto = normal(j.textContent);
      expect(texto).toContain("em andamento neste pedido");
      expect(texto).toContain("01/09 às 07:00");
      expect(texto).not.toContain("NaN");
      expect(texto).not.toContain("R$ 0,00");
      expect(botaoDa(j, "Confirmar devolução adicional")).toBeDefined();
    },
  );

  it("mantém a confirmação normal quando as linhas já concluíram, falharam sem dúvida ou são contestação", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        linhas: [
          linhaEstorno({
            id: "concluida",
            status: "concluido",
            amount: 20,
            concluido_em: "2026-09-01T10:10:00.000Z",
          }),
          linhaEstorno(),
          linhaEstorno({
            id: "contestacao",
            status: "concluido",
            mp_status: "charged_back",
            concluido_em: null,
          }),
        ],
        devolvido: 20,
        disponivel: 80,
      }),
    );
    await montar();
    await tocar(botaoDa(hospedeiro, "Devolver R$ 80,00"));

    const j = janela() as HTMLElement;
    expect(normal(j.textContent)).toContain(
      "Devolver R$ 80,00 ao cliente pelo Mercado Pago? O dinheiro sai da sua conta do Mercado Pago e não dá para desfazer.",
    );
    expect(normal(j.textContent)).not.toContain("em andamento neste pedido");
    expect(botaoDa(j, "Confirmar devolução adicional")).toBeUndefined();
    expect(botaoDa(j, "Devolver R$ 80,00")).toBeDefined();
  });

  it("confirmar executa UMA vez, mesmo com duplo toque no botão da ação", async () => {
    useEstornosDoPedidoMock.mockReturnValue(hookPadrao());
    await montar();
    await tocar(botaoDa(hospedeiro, "Devolver R$ 100,00"));

    const acao = botaoDa(janela() as HTMLElement, "Devolver R$ 100,00");
    await act(async () => {
      acao?.click();
      acao?.click();
    });

    expect(nativo).not.toHaveBeenCalled();
    expect(solicitarEstorno).toHaveBeenCalledTimes(1);
    expect(solicitarEstorno).toHaveBeenCalledWith({ amount: 100, motivo: "" });
  });

  it("'Voltar' (desistir) não executa nada e fecha a janela", async () => {
    useEstornosDoPedidoMock.mockReturnValue(hookPadrao());
    await montar();
    await tocar(botaoDa(hospedeiro, "Devolver R$ 100,00"));

    await tocar(botaoDa(janela() as HTMLElement, "Voltar"));

    expect(solicitarEstorno).not.toHaveBeenCalled();
    expect(nativo).not.toHaveBeenCalled();
    expect(janela()).toBeNull();
  });

  it("Esc desiste sem executar", async () => {
    useEstornosDoPedidoMock.mockReturnValue(hookPadrao());
    await montar();
    await tocar(botaoDa(hospedeiro, "Devolver R$ 100,00"));

    await act(async () => {
      janela()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(solicitarEstorno).not.toHaveBeenCalled();
    expect(janela()).toBeNull();
  });

  it("o Voltar do aparelho fecha SÓ a janela, sem executar, e a próxima pergunta abre de novo", async () => {
    useEstornosDoPedidoMock.mockReturnValue(hookPadrao());
    globalThis.history.replaceState({ view: "admin-orders" }, "", "/");
    await montar();
    await tocar(botaoDa(hospedeiro, "Devolver R$ 100,00"));
    expect(janela()).not.toBeNull();
    // a janela empurrou UMA entrada no histórico para o Voltar consumir
    expect(globalThis.history.state?.folhaDePolitica).toBe(true);

    await act(async () => {
      globalThis.history.back();
      // O jsdom entrega o popstate numa macrotarefa: espera a janela sair.
      for (let i = 0; i < 50 && janela() !== null; i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
    });

    expect(janela()).toBeNull();
    expect(solicitarEstorno).not.toHaveBeenCalled();
    expect(nativo).not.toHaveBeenCalled();

    // não ficou travada: perguntar de novo funciona e confirmar executa
    await tocar(botaoDa(hospedeiro, "Devolver R$ 100,00"));
    expect(janela()).not.toBeNull();
    await tocar(botaoDa(janela() as HTMLElement, "Devolver R$ 100,00"));
    expect(solicitarEstorno).toHaveBeenCalledTimes(1);
  });

  it("'Tentar de novo' de uma linha que falhou também pergunta pela janela, com o valor da linha", async () => {
    useEstornosDoPedidoMock.mockReturnValue(
      hookPadrao({
        linhas: [
          linhaEstorno(),
          linhaEstorno({ id: "outra-em-curso", status: "solicitado" }),
        ],
        emCurso: 30,
        disponivel: 70,
      }),
    );
    await montar();
    await tocar(botaoDa(hospedeiro, "Tentar de novo"));

    expect(nativo).not.toHaveBeenCalled();
    expect(normal(janela()?.querySelector("p")?.textContent)).toBe("R$ 30,00");
    expect(solicitarEstorno).not.toHaveBeenCalled();

    await tocar(botaoDa(janela() as HTMLElement, "Devolver R$ 30,00"));
    expect(solicitarEstorno).toHaveBeenCalledTimes(1);
    // "Tentar de novo" repete ESSA linha: o id vai junto (o servidor repete uma vez só, mesmo em duas abas)
    expect(solicitarEstorno).toHaveBeenCalledWith({
      amount: 30,
      motivo: "",
      repetindo: "refund-falhou",
    });
  });

  it("a pergunta aberta não some se o cartão passa a mostrar erro ou 'carregando' (saídas antecipadas)", async () => {
    useEstornosDoPedidoMock.mockReturnValue(hookPadrao());
    await montar();
    await tocar(botaoDa(hospedeiro, "Devolver R$ 100,00"));
    expect(janela()).not.toBeNull();

    for (const extra of [{ erro: true }, { pedidoCarregado: false }]) {
      useEstornosDoPedidoMock.mockReturnValue(hookPadrao(extra));
      await montar();
      expect(janela()).not.toBeNull();
    }
    expect(solicitarEstorno).not.toHaveBeenCalled();
  });
});
