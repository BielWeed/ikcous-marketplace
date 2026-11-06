// @vitest-environment jsdom
//
// "Na data" (saldo inicial) da conta no FUTURO fazia o saldo sumir: o banco
// (`fin__saldos`, migration 20261177000000) só soma movimentos com
// `data >= saldo_inicial_em` e até `fin__hoje()`. `validarConta` aceita o dia
// de hoje como 2º argumento (opcional) e recusa data depois dele; o campo da
// folha trava o seletor em `max=hoje` e mostra a frase junto ao campo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));

import { ContaFolha } from "@/components/admin/financeiro/FolhasDeCadastro";
import { type FormularioDaConta, validarConta } from "@/lib/financeiro";
import type { ContaFinanceira } from "@/types/financeiro";

const HOJE = "2026-11-05";
const AMANHA = "2026-11-06";
const ONTEM = "2026-11-04";
const FRASE = "A data do saldo inicial não pode ser no futuro.";

function formulario(saldoInicialEm: string): FormularioDaConta {
  return {
    nome: "Cofre",
    tipo: "outro",
    saldoInicial: "10,00",
    saldoInicialEm,
    ativa: true,
  };
}

describe("validarConta — data do saldo inicial não pode ser no futuro", () => {
  it("amanhã (depois de hoje) é recusada, com a frase no campo da data", () => {
    const r = validarConta(formulario(AMANHA), HOJE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.saldoInicialEm).toBe(FRASE);
  });

  it("hoje e dias passados continuam valendo", () => {
    expect(validarConta(formulario(HOJE), HOJE).ok).toBe(true);
    expect(validarConta(formulario(ONTEM), HOJE).ok).toBe(true);
  });

  it("sem o 2º argumento nada muda: data futura segue aceita, como antes", () => {
    const r = validarConta(formulario(AMANHA));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.saldo_inicial_em).toBe(AMANHA);
  });

  it("data vazia segue com a frase de sempre (não vira 'futuro')", () => {
    const r = validarConta(formulario(""), HOJE);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erros.saldoInicialEm).toBe("Informe a data do saldo inicial.");
    }
  });
});

describe("ContaFolha — campo 'Na data' não deixa passar do dia de hoje", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  function montar(conta: ContaFinanceira | null) {
    return act(async () => {
      raiz.render(
        <ContaFolha
          conta={conta}
          hoje={HOJE}
          aoFechar={vi.fn()}
          aoSalvar={vi.fn()}
          aoMudarSujo={vi.fn()}
        />,
      );
    });
  }

  function folha(): HTMLElement {
    const el = document.querySelector<HTMLElement>(
      '[data-slot="sheet-content"]',
    );
    if (!el) throw new Error("folha não abriu");
    return el;
  }

  function salvar() {
    const botao = [...folha().querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Salvar",
    );
    if (!botao) throw new Error("Salvar não existe");
    return act(async () => {
      botao.click();
    });
  }

  async function mudarData(valor: string) {
    const campo = document.getElementById("fin-conta-data") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
      campo.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  beforeEach(() => {
    rpcFalso.mockReset();
    rpcFalso.mockResolvedValue({ data: null, error: null });
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

  it("o seletor de data tem max = hoje", async () => {
    await montar(null);
    const campo = document.getElementById("fin-conta-data") as HTMLInputElement;
    expect(campo.max).toBe(HOJE);
  });

  it("com data no futuro, Salvar mostra a frase junto ao campo e não grava", async () => {
    await montar(null);
    await mudarData(AMANHA);
    await salvar();
    expect(folha().textContent).toContain(FRASE);
    expect(rpcFalso).not.toHaveBeenCalled();
  });

  it("editar conta antiga com data futura sem mexer na data: o erro aparece e não grava", async () => {
    await montar({
      id: "conta-velha",
      nome: "Cofre",
      tipo: "outro",
      saldoInicial: 10,
      saldoInicialEm: AMANHA,
      ativa: true,
      ordem: 3,
      sistema: false,
      saldo: 0,
    });
    await salvar();
    expect(folha().textContent).toContain(FRASE);
    expect(rpcFalso).not.toHaveBeenCalled();
  });

  it("corrigida para hoje, a mensagem some", async () => {
    await montar(null);
    await mudarData(AMANHA);
    await salvar();
    expect(folha().textContent).toContain(FRASE);
    await mudarData(HOJE);
    expect(folha().textContent).not.toContain(FRASE);
  });
});
