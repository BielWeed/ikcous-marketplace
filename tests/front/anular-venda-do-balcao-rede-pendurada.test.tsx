// @vitest-environment jsdom
//
// Anular venda do balcão com a rede PENDURADA (conectada, mas sem responder):
// a chamada precisa ter prazo. Sem ele o botão ficava em "Anulando…", Voltar,
// Esc e o campo do motivo travados, e a lojista não tinha como saber se a venda
// foi anulada. Estourar o prazo NÃO prova que nada foi anulado: a frase tem de
// mandar conferir a venda, e repetir o toque é seguro (a RPC é idempotente).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock, limparCacheMock, avisarMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  limparCacheMock: vi.fn(),
  avisarMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcMock } }));
vi.mock("@/hooks/useAnalytics", () => ({
  clearAnalyticsCache: limparCacheMock,
}));
vi.mock("@/lib/avisa-anulacao-do-balcao", () => ({
  avisarAnulacao: avisarMock,
}));

import { AnularVendaDoBalcao } from "@/components/admin/pdv/AnularVendaDoBalcao";
import {
  PRAZO_DA_ANULACAO_MS,
  useAnularVendaDoBalcao,
} from "@/hooks/useAnularVendaDoBalcao";
import { mensagemDaFalhaDaAnulacao } from "@/lib/anulacao-do-balcao";

function botao(raiz: ParentNode, texto: string): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function digitarMotivo(texto: string): void {
  const campo = document.querySelector("textarea") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(campo, texto);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

function Tela(): React.ReactElement {
  const { anular } = useAnularVendaDoBalcao();
  return (
    <AnularVendaDoBalcao
      total={79.8}
      forma="cash"
      aoAnular={(motivo) => anular("p1", motivo)}
    />
  );
}

const FRASE_CONFIRA_A_VENDA =
  "Não consegui confirmar com o servidor. Confira a venda antes de tentar de novo: se ela já foi anulada, o app avisa.";

describe("anular venda do balcão — rede pendurada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    rpcMock.mockReset();
    limparCacheMock.mockReset();
    avisarMock.mockReset();
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

  async function avancar(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function abrirEConfirmar(): Promise<void> {
    await act(async () => {
      raiz.render(<Tela />);
    });
    await act(async () => {
      botao(hospedeiro, "Anular venda")?.click();
    });
    await act(async () => digitarMotivo("engano no caixa"));
    await act(async () => {
      botao(hospedeiro, "Confirmar anulação")?.click();
    });
  }

  it("RPC que nunca responde: depois do prazo a tela solta e manda conferir a venda", async () => {
    rpcMock.mockImplementation(() => new Promise(() => {}));
    await abrirEConfirmar();

    // Antes do prazo: ainda aguardando, tudo travado como sempre foi.
    await avancar(PRAZO_DA_ANULACAO_MS - 1_000);
    expect(hospedeiro.textContent).toContain("Anulando");
    expect(botao(hospedeiro, "Voltar")?.disabled).toBe(true);
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();

    // Estourou o prazo: aviso honesto (NÃO diz "nada foi anulado"), tudo solto.
    await avancar(2_000);
    const alerta = hospedeiro.querySelector('[role="alert"]');
    expect(alerta?.textContent).toBe(FRASE_CONFIRA_A_VENDA);
    expect(alerta?.textContent).not.toMatch(/nada foi/i);
    expect(botao(hospedeiro, "Confirmar anulação")?.disabled).toBe(false);
    expect(botao(hospedeiro, "Voltar")?.disabled).toBe(false);
    expect(
      (document.querySelector("textarea") as HTMLTextAreaElement).disabled,
    ).toBe(false);
    // Nada foi dado como anulado na tela (não sabemos): sem aviso de sucesso e
    // sem limpar o cache do painel nem avisar a lista.
    expect(hospedeiro.textContent).not.toContain("Venda anulada");
    expect(limparCacheMock).not.toHaveBeenCalled();
    expect(avisarMock).not.toHaveBeenCalled();
  });

  it("depois do prazo dá para tentar de novo, e a segunda chamada responde 'já anulada'", async () => {
    rpcMock
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({
        data: { order_id: "p1", ja_anulada: true },
        error: null,
      });
    await abrirEConfirmar();
    await avancar(PRAZO_DA_ANULACAO_MS + 1);
    expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();

    await act(async () => {
      botao(hospedeiro, "Confirmar anulação")?.click();
    });
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock).toHaveBeenLastCalledWith("anular_venda_presencial", {
      p_order_id: "p1",
      p_motivo: "engano no caixa",
    });
    expect(hospedeiro.textContent).toContain("Esta venda já estava anulada");
    expect(avisarMock).toHaveBeenCalledWith("p1");
  });

  it("resposta que chega DEPOIS do prazo é descartada: não anuncia sucesso fora de hora", async () => {
    let responder!: (v: unknown) => void;
    rpcMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          responder = resolve;
        }),
    );
    await abrirEConfirmar();
    await avancar(PRAZO_DA_ANULACAO_MS + 1);
    await act(async () => {
      responder({ data: { order_id: "p1", ja_anulada: false }, error: null });
    });
    expect(hospedeiro.textContent).not.toContain("Venda anulada");
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
      FRASE_CONFIRA_A_VENDA,
    );
  });

  it("a frase do prazo estourado é a de 'confira a venda', nunca 'nada foi anulado'", () => {
    // O erro do prazo sai SEM `code` (como o do registro da venda).
    const erroDoPrazo = new Error("A anulação não respondeu a tempo.");
    expect(mensagemDaFalhaDaAnulacao(erroDoPrazo)).toBe(FRASE_CONFIRA_A_VENDA);
  });
});
