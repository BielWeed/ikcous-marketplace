// @vitest-environment jsdom
//
// Editar uma conta manda SÓ o que a lojista mexeu. A folha mandava a conta
// inteira com os valores de quando abriu: com dois aparelhos, quem trocava só o
// nome desfazia em silêncio o saldo inicial (e o "ativa" e a data) que o outro
// aparelho tinha corrigido, e a tela dizia "Conta atualizada.".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ContaFolha } from "@/components/admin/financeiro/FolhasDeCadastro";
import {
  type FormularioDaConta,
  corpoDaContaEditada,
  validarConta,
} from "@/lib/financeiro";
import type { ContaFinanceira, PayloadDaConta } from "@/types/financeiro";

const HOJE = "2026-09-27";

const CONTA: ContaFinanceira = {
  id: "conta-1",
  nome: "Banco do Brasil",
  tipo: "banco",
  saldoInicial: 100,
  saldoInicialEm: "2026-01-01",
  ativa: true,
  ordem: 1,
  sistema: false,
  saldo: 100,
};

const FORM: FormularioDaConta = {
  id: "conta-1",
  nome: "Banco do Brasil",
  tipo: "banco",
  saldoInicial: "100.00",
  saldoInicialEm: "2026-01-01",
  ativa: true,
};

function validado(form: FormularioDaConta) {
  const r = validarConta(form, HOJE);
  if (!r.ok) throw new Error("devia validar");
  return r.payload;
}

describe("corpoDaContaEditada — o corpo mínimo da edição", () => {
  const abertura = validarConta(FORM, HOJE);

  it("saldo 100 contra '100,00' é o mesmo número: não viaja; o nome (aparado) viaja", () => {
    const corpo = corpoDaContaEditada(
      validado({ ...FORM, nome: "  Itaú  ", saldoInicial: "100,00" }),
      abertura,
    );
    expect(corpo).toEqual({ id: "conta-1", nome: "Itaú" });
    expect("saldo_inicial" in corpo).toBe(false);
  });

  it("nome só com espaços a mais não é mudança", () => {
    expect(
      corpoDaContaEditada(
        validado({ ...FORM, nome: "  Banco do Brasil " }),
        abertura,
      ),
    ).toEqual({ id: "conta-1" });
  });

  it("data igual e ativa igual ficam de fora; os que mudaram vão", () => {
    expect(
      corpoDaContaEditada(
        validado({ ...FORM, saldoInicialEm: "2026-02-10", ativa: false }),
        abertura,
      ),
    ).toEqual({
      id: "conta-1",
      saldo_inicial_em: "2026-02-10",
      ativa: false,
    });
  });

  it("saldo que mudou vai como número", () => {
    expect(
      corpoDaContaEditada(
        validado({ ...FORM, saldoInicial: "-1.234,56" }),
        abertura,
      ),
    ).toEqual({ id: "conta-1", saldo_inicial: -1234.56 });
  });

  it("nada mudou: só o id", () => {
    expect(corpoDaContaEditada(validado(FORM), abertura)).toEqual({
      id: "conta-1",
    });
  });

  it("conta NOVA (sem id): o corpo é o completo", () => {
    const { id: _id, ...semId } = FORM;
    const payload = validado(semId);
    expect(corpoDaContaEditada(payload, validarConta(semId, HOJE))).toEqual({
      nome: "Banco do Brasil",
      tipo: "banco",
      saldo_inicial: 100,
      saldo_inicial_em: "2026-01-01",
      ativa: true,
    });
  });

  it("abertura que não valida (data futura guardada): cai no corpo completo", () => {
    const futura = { ...FORM, saldoInicialEm: "2027-01-01" };
    const completo: PayloadDaConta = {
      id: "conta-1",
      nome: "Novo",
      tipo: "banco",
      saldo_inicial: 100,
      saldo_inicial_em: "2026-01-01",
      ativa: true,
    };
    expect(validarConta(futura, HOJE).ok).toBe(false);
    expect(corpoDaContaEditada(completo, validarConta(futura, HOJE))).toEqual(
      completo,
    );
  });
});

describe("ContaFolha — o que viaja no Salvar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpcFalso.mockReset();
    rpcFalso.mockImplementation(async (_n: string, args: { p: object }) => ({
      data: { id: "conta-1", ...args.p },
      error: null,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function abrir(conta: ContaFinanceira | null) {
    const aoSalvar = vi.fn();
    const desenhar = (c: ContaFinanceira | null) => (
      <ContaFolha
        conta={c}
        hoje={HOJE}
        aoFechar={vi.fn()}
        aoSalvar={aoSalvar}
        aoMudarSujo={vi.fn()}
      />
    );
    await act(async () => raiz.render(desenhar(conta)));
    return {
      aoSalvar,
      redesenhar: (c: ContaFinanceira) =>
        act(async () => raiz.render(desenhar(c))),
    };
  }

  async function digitar(id: string, valor: string) {
    const campo = document.getElementById(id) as HTMLInputElement;
    await act(async () => {
      campo.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
  }

  async function salvar() {
    const botao = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[data-slot="sheet-content"] button',
      ),
    ].find((b) => b.textContent?.trim() === "Salvar");
    if (!botao) throw new Error("botão Salvar não existe");
    await act(async () => botao.click());
  }

  function corpoEnviado(): Record<string, unknown> {
    expect(rpcFalso).toHaveBeenCalledTimes(1);
    return rpcFalso.mock.calls[0]?.[1].p;
  }

  it("outro aparelho corrigiu o saldo para 500; aqui só o nome muda: o saldo NÃO viaja", async () => {
    const { aoSalvar, redesenhar } = await abrir(CONTA);
    // O outro aparelho gravou 500 e a lista da tela já traz isso.
    await redesenhar({ ...CONTA, saldoInicial: 500, saldo: 500 });
    await digitar("fin-conta-nome", "Banco Novo");
    await salvar();

    const p = corpoEnviado();
    expect(p).toEqual({ id: "conta-1", nome: "Banco Novo" });
    expect("saldo_inicial" in p).toBe(false);
    expect(aoSalvar).toHaveBeenCalledExactlyOnceWith("Conta atualizada.");
  });

  it("mexeu no saldo: só o saldo viaja, como número", async () => {
    await abrir(CONTA);
    await digitar("fin-conta-saldo", "250,50");
    await salvar();
    expect(corpoEnviado()).toEqual({ id: "conta-1", saldo_inicial: 250.5 });
  });

  it("não mexeu em nada e salvou: a RPC recebe só o id (mesma volta de sempre)", async () => {
    const { aoSalvar } = await abrir(CONTA);
    await salvar();
    expect(corpoEnviado()).toEqual({ id: "conta-1" });
    expect(aoSalvar).toHaveBeenCalledExactlyOnceWith("Conta atualizada.");
  });

  it("desligou a conta: só o ativa viaja", async () => {
    await abrir(CONTA);
    const interruptor = document.getElementById(
      "fin-conta-ativa",
    ) as HTMLButtonElement;
    await act(async () => interruptor.click());
    await salvar();
    expect(corpoEnviado()).toEqual({ id: "conta-1", ativa: false });
  });

  it("mudou a data do saldo: só a data viaja", async () => {
    await abrir(CONTA);
    await digitar("fin-conta-data", "2026-03-05");
    await salvar();
    expect(corpoEnviado()).toEqual({
      id: "conta-1",
      saldo_inicial_em: "2026-03-05",
    });
  });

  it("conta NOVA: o corpo continua completo, sem id", async () => {
    const { aoSalvar } = await abrir(null);
    await digitar("fin-conta-nome", "Cofre");
    await digitar("fin-conta-saldo", "80,00");
    await salvar();
    expect(corpoEnviado()).toEqual({
      nome: "Cofre",
      tipo: "banco",
      saldo_inicial: 80,
      saldo_inicial_em: HOJE,
      ativa: true,
    });
    expect(aoSalvar).toHaveBeenCalledExactlyOnceWith("Conta criada.");
  });
});
