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

describe("Registrar recebimento com a folha aberta na virada do dia", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
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
          aoSalvar={vi.fn()}
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

  async function confirmarDepoisDaVirada() {
    vi.setSystemTime(new Date("2026-11-13T03:05:00Z")); // 00h05 em SP
    const confirmar = [...document.querySelectorAll("button")].find(
      (botao) => botao.textContent?.trim() === "Confirmar baixa",
    );
    const dataExibida = campoData().value;
    await act(async () => confirmar!.click());
    return dataExibida;
  }

  it("grava a data que o campo mostra ao confirmar depois da virada", async () => {
    const dataExibida = await confirmarDepoisDaVirada();
    expect(dataExibida).toBe(DIA_DA_ABERTURA);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("fin_lancamento_baixar", {
      p_id: "recebimento-1",
      p_data: dataExibida,
      p_conta_id: null,
    });
  });

  it("respeita a data escolhida, inclusive quando volta ao dia da abertura", async () => {
    await digitarData("2026-11-11");
    await digitarData(DIA_DA_ABERTURA);
    await confirmarDepoisDaVirada();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("fin_lancamento_baixar", {
      p_id: "recebimento-1",
      p_data: DIA_DA_ABERTURA,
      p_conta_id: null,
    });
  });

  it("continua recusando uma data futura", async () => {
    await digitarData("2026-11-14");
    await confirmarDepoisDaVirada();
    expect(rpc).not.toHaveBeenCalled();
    expect(
      document.getElementById("fin-baixa-data-erro")?.textContent,
    ).toContain("a data não pode ser no futuro");
  });
});
