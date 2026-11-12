// @vitest-environment jsdom
//
// Financeiro — cancelar lançamento manual: o motivo feito só de caracteres
// invisíveis (U+200B, U+FEFF...) não vale como motivo. O `trim()` do JS não os
// tira, então antes o lançamento era cancelado (e deixava de contar no saldo) e
// o comprovante mostrava um "Motivo" em branco. Motivo normal segue IDÊNTICO.
import { type ReactElement, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));

import { CancelarLancamentoDialogo } from "@/components/admin/financeiro/FolhasDeLancamento";

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ");

let raiz: Root;
let hospedeiro: HTMLDivElement;
let aoSalvar: Mock<(mensagem: string, tom?: "sucesso" | "informacao") => void>;
let aoMudarSujo: Mock<(sujo: boolean) => void>;

function montar(): ReactElement {
  return (
    <CancelarLancamentoDialogo
      alvo={{ id: "lanc-1", descricao: "Aluguel", valor: 120 }}
      aoFechar={vi.fn()}
      aoSalvar={aoSalvar}
      aoMudarSujo={aoMudarSujo}
    />
  );
}

async function digitarMotivo(valor: string) {
  const campo = document.getElementById(
    "fin-cancelar-motivo",
  ) as HTMLTextAreaElement;
  await act(async () => {
    campo.focus();
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(150);
  });
}

async function confirmar() {
  const botao = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Cancelar lançamento",
  ) as HTMLButtonElement;
  await act(async () => {
    botao.click();
    await vi.advanceTimersByTimeAsync(50);
  });
}

const chamadasDeCancelar = () =>
  rpcFalso.mock.calls.filter(([nome]) => nome === "fin_lancamento_cancelar");

describe("Financeiro — cancelar lançamento: motivo só invisível", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    rpcFalso.mockReset();
    rpcFalso.mockResolvedValue({ data: { id: "lanc-1" }, error: null });
    aoSalvar =
      vi.fn<(mensagem: string, tom?: "sucesso" | "informacao") => void>();
    aoMudarSujo = vi.fn<(sujo: boolean) => void>();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(montar());
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
  });

  it("só espaços de largura zero (U+200B): recusa, não grava e mostra o aviso", async () => {
    await digitarMotivo("\u200B\u200B\u200B");
    await confirmar();

    expect(chamadasDeCancelar()).toHaveLength(0);
    expect(aoSalvar).not.toHaveBeenCalled();
    expect(
      normalizar(document.querySelector('[role="alertdialog"]')?.textContent),
    ).toContain("por que está cancelando");
  });

  it("só marcas invisíveis misturadas (FEFF, 2060, 200C, 200D) com espaços: recusa", async () => {
    await digitarMotivo("\uFEFF \u2060\u200C\u200D \u200B");
    await confirmar();

    expect(chamadasDeCancelar()).toHaveLength(0);
    expect(aoSalvar).not.toHaveBeenCalled();
  });

  it("motivo com texto visível e um invisível junto continua valendo (controle)", async () => {
    await digitarMotivo("\u200B abc");
    await confirmar();

    expect(chamadasDeCancelar()).toHaveLength(1);
    expect(aoSalvar).toHaveBeenCalledWith("Lançamento cancelado.");
  });

  it("motivo normal com acento e emoji é enviado idêntico ao de sempre (controle)", async () => {
    await digitarMotivo("  Lançado em dobro 🙂  ");
    await confirmar();

    expect(rpcFalso).toHaveBeenCalledWith("fin_lancamento_cancelar", {
      p_id: "lanc-1",
      p_motivo: "Lançado em dobro 🙂",
    });
    expect(aoSalvar).toHaveBeenCalledWith("Lançamento cancelado.");
  });

  it("motivo curto de 2 letras segue recusado como antes (controle)", async () => {
    await digitarMotivo("ok");
    await confirmar();

    expect(chamadasDeCancelar()).toHaveLength(0);
    expect(aoSalvar).not.toHaveBeenCalled();
  });

  it("o aviso de 'alterações não salvas' continua pelo que a pessoa digitou", async () => {
    await digitarMotivo("\u200B\u200B\u200B");
    expect(aoMudarSujo).toHaveBeenLastCalledWith(true);
  });
});
