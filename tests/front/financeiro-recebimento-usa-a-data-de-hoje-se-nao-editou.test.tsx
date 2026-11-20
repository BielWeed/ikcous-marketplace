// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

import { BaixarLancamentoFolha } from "@/components/admin/financeiro/FolhasDeLancamento";

const DIA_DA_ABERTURA = "2026-11-12";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Financeiro — dia da baixa de um recebimento", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const aoSalvar = vi.fn();

  beforeEach(async () => {
    aoSalvar.mockClear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-13T02:55:00Z")); // 23h55 em SP
    rpc.mockReset().mockResolvedValue({
      data: { id: "recebimento-1", status: "realizado" },
      error: null,
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(
        <BaixarLancamentoFolha
          alvo={{
            id: "recebimento-1",
            descricao: "Recebimento de teste",
            valor: 50,
            contaId: null,
            lado: "entrada",
            vencimento: DIA_DA_ABERTURA,
          }}
          hoje={DIA_DA_ABERTURA}
          contas={[]}
          aoFechar={vi.fn()}
          aoSalvar={aoSalvar}
          aoMudarSujo={vi.fn()}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
  });

  function campoData() {
    return document.querySelector<HTMLInputElement>("#fin-baixa-data")!;
  }

  async function digitarData(valor: string) {
    const campo = campoData();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function confirmar() {
    const botao = [...document.querySelectorAll("button")].find(
      (botao) => botao.textContent?.trim() === "Confirmar baixa",
    );
    await act(async () => botao!.click());
  }

  async function alternarDataManual() {
    const caixa = document.querySelector<HTMLInputElement>(
      "#fin-baixa-outra-data",
    );
    if (!caixa) throw new Error("Não encontrei a opção de escolher outra data");
    await act(async () => caixa.click());
  }

  it.each([
    ["o aparelho está no mês errado", "2026-10-01T12:00:00Z"],
    ["a folha ficou aberta na virada do dia", "2026-11-13T03:05:00Z"],
  ])("deixa o servidor datar a baixa quando %s", async (_, instante) => {
    vi.setSystemTime(new Date(instante));
    await confirmar();

    expect(rpc).toHaveBeenCalledExactlyOnceWith("fin_lancamento_baixar", {
      p_id: "recebimento-1",
      p_conta_id: null,
    });
    expect(aoSalvar).toHaveBeenCalledWith("Recebimento registrado.");
  });

  it("envia a data escolhida mesmo se ela parecer futura no aparelho", async () => {
    await alternarDataManual();
    await digitarData("2026-11-11");
    await digitarData(DIA_DA_ABERTURA);
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    await confirmar();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("fin_lancamento_baixar", {
      p_id: "recebimento-1",
      p_data: DIA_DA_ABERTURA,
      p_conta_id: null,
    });
  });

  it("não baixa automaticamente se a opção manual está ativa mas sem data", async () => {
    await alternarDataManual();
    await confirmar();

    expect(rpc).not.toHaveBeenCalled();
    expect(
      document.getElementById("fin-baixa-data-erro")?.textContent,
    ).toContain("Informe a data.");

    await alternarDataManual();
    await confirmar();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("fin_lancamento_baixar", {
      p_id: "recebimento-1",
      p_conta_id: null,
    });
  });

  it("mostra a recusa do servidor para data futura sem confirmar o recebimento", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "22023",
        message: "A baixa não pode ter data no futuro.",
        details: null,
        hint: null,
      },
    });
    await alternarDataManual();
    await digitarData("2026-11-14");
    await confirmar();

    expect(rpc).toHaveBeenCalledExactlyOnceWith("fin_lancamento_baixar", {
      p_id: "recebimento-1",
      p_data: "2026-11-14",
      p_conta_id: null,
    });
    expect(aoSalvar).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "A baixa não pode ter data no futuro.",
    );
  });
});
