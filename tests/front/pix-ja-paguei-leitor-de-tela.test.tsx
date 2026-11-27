// @vitest-environment jsdom
//
// PIX — "Já paguei — verificar" para quem usa leitor de tela (caça com lente
// "leitor de tela", 27/11/2026).
//
// Dois silêncios:
//   1. Quando a 5ª e última consulta terminava, o aviso "As verificações
//      manuais deste Pix acabaram" entrava num parágrafo FORA de qualquer
//      região viva — e a região viva que existia ficava vazia. Quem não vê a
//      tela não ouvia nada e não sabia que precisava acompanhar de outro jeito.
//   2. O botão ficava desabilitado (intervalo de 15 s entre consultas, ou
//      consultas esgotadas) sem nenhum motivo ligado a ele: o leitor dizia
//      só "indisponível".
//
// O que se prova aqui: o aviso de esgotado cai na MESMA região viva que já
// existia antes da mudança (o leitor só anuncia mudança em região que já
// estava montada), uma vez só; e o botão desabilitado aponta, por
// `aria-describedby`, para um texto que diz por que e quando libera — e o
// motivo some quando o botão volta.
import { PagamentoOnline } from "@/components/checkout/PagamentoOnline";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));

const { criarPagamento } = vi.hoisted(() => ({ criarPagamento: vi.fn() }));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ criarPagamento }),
}));

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ROTULO = "Já paguei — verificar";
const AVISO_ESGOTADO = "As verificações manuais deste Pix acabaram.";

function botao(hospedeiro: HTMLElement): HTMLButtonElement {
  const achado = Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) =>
      (b.textContent ?? "").includes(ROTULO) ||
      (b.textContent ?? "").includes("Verificando"),
  );
  if (!achado) throw new Error("botão 'Já paguei' não encontrado");
  return achado;
}

/** Texto que o leitor de tela lê como descrição do botão. */
function descricao(b: HTMLElement): string {
  const ids = (b.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean);
  return ids
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

/** A região viva que acompanha o botão (irmã dele, no mesmo bloco). */
function regiaoVivaDoBotao(hospedeiro: HTMLElement): HTMLElement {
  const regiao = botao(hospedeiro).parentElement?.querySelector<HTMLElement>(
    '[aria-live="polite"]',
  );
  if (!regiao) throw new Error("região viva do botão não encontrada");
  return regiao;
}

describe("PIX — 'Já paguei' fala com o leitor de tela", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    criarPagamento.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
  });

  // O orçamento de consultas mora num mapa do módulo, por pedido+cobrança:
  // cada teste usa um par próprio para não herdar consultas do anterior.
  async function montar(orderId: string, paymentId: string) {
    criarPagamento.mockImplementation((args: { metodo: string }) => {
      if (args.metodo === "pix") {
        return Promise.resolve({
          paymentId,
          statusPagamento: "aguardando",
          expiraEm: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          qrCode: "000201-codigo-copia-e-cola",
          qrCodeBase64: "abc123",
        });
      }
      return Promise.resolve({ verificacao: "pix" });
    });
    await act(async () => {
      raiz.render(
        <PagamentoOnline
          orderId={orderId}
          valor={100}
          onErro={() => {}}
          onRelerPagamentoPix={vi.fn()}
        />,
      );
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  async function consultar() {
    await act(async () => {
      botao(hospedeiro).click();
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it("o aviso de que as verificações acabaram entra na região viva que já existia, uma vez só", async () => {
    await montar("ped-leitor-1", "pay-leitor-1");
    const regiaoAntes = regiaoVivaDoBotao(hospedeiro);

    for (let i = 0; i < 4; i++) {
      await consultar();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
    }
    expect(regiaoAntes.textContent).not.toContain(AVISO_ESGOTADO);

    // 5ª e última consulta, sem confirmação.
    await consultar();

    // A MESMA região (montada antes da mudança) recebe o aviso.
    expect(regiaoAntes.isConnected).toBe(true);
    expect(regiaoAntes.textContent).toContain(AVISO_ESGOTADO);
    // E só ela: nenhum outro trecho repete o aviso fora da região viva.
    const ocorrencias = (hospedeiro.textContent ?? "").split(
      AVISO_ESGOTADO,
    ).length;
    expect(ocorrencias - 1).toBe(1);

    // Sem spam: o tempo passa e a região não muda de texto.
    const textoAnunciado = regiaoAntes.textContent;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(regiaoAntes.textContent).toBe(textoAnunciado);
  });

  it("botão desabilitado no intervalo diz por quê e quando libera; ao liberar, o motivo some", async () => {
    await montar("ped-leitor-2", "pay-leitor-2");
    const b = botao(hospedeiro);
    expect(b.disabled).toBe(false);
    expect(b.hasAttribute("aria-describedby")).toBe(false);

    await consultar();
    expect(b.disabled).toBe(true);
    const motivo = descricao(b);
    expect(motivo).toMatch(/15 segundos/);
    expect(motivo).toMatch(/verificar de novo/);
    // O motivo não é anunciado sozinho (não fica numa região viva): o leitor
    // o lê quando chega no botão — sem repetir a cada segundo.
    const elMotivo = document.getElementById(
      b.getAttribute("aria-describedby") ?? "",
    );
    expect(elMotivo?.closest("[aria-live]")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(b.disabled).toBe(false);
    expect(b.hasAttribute("aria-describedby")).toBe(false);
    expect(hospedeiro.textContent).not.toMatch(/15 segundos/);
  });

  it("botão desabilitado depois da última consulta aponta para o aviso de esgotado", async () => {
    await montar("ped-leitor-3", "pay-leitor-3");
    for (let i = 0; i < 5; i++) {
      await consultar();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
    }
    const b = botao(hospedeiro);
    expect(b.disabled).toBe(true);
    expect(descricao(b)).toContain(AVISO_ESGOTADO);
    // Esgotado não promete "15 segundos": o botão não volta mais.
    expect(descricao(b)).not.toMatch(/segundos/);
  });

  it("enquanto a consulta está em voo, o rótulo 'Verificando…' já é o motivo: sem descrição extra", async () => {
    await montar("ped-leitor-4", "pay-leitor-4");
    let responder = (_: { verificacao: string }) => {};
    criarPagamento.mockImplementation(
      () =>
        new Promise<{ verificacao: string }>((resolve) => {
          responder = resolve;
        }),
    );
    await consultar();
    const b = botao(hospedeiro);
    expect(b.textContent).toContain("Verificando…");
    expect(b.hasAttribute("aria-describedby")).toBe(false);
    await act(async () => {
      responder({ verificacao: "pix" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(descricao(b)).toMatch(/15 segundos/);
  });
});
