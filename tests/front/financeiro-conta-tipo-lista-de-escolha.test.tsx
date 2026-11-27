// @vitest-environment jsdom
//
// Lista premium (26/11/2026), lote A2.3 — o "Tipo" da conta deixou de ser
// `<select>` e virou a lista de escolha do painel. O que se prova aqui:
//  - as quatro opções de sempre, com o rótulo de sempre, e "Conta bancária"
//    já marcada na conta nova;
//  - escolher grava o `tipo` escolhido (e escolher "banco" grava
//    `tipo:"banco"`), na conta nova (corpo inteiro) e na editada (só o tipo);
//  - tocar no tipo que já está marcado não suja a folha;
//  - a conta do SISTEMA tem o tipo fixo: o campo fica desabilitado e o tipo
//    não viaja;
//  - enquanto salva, o tipo não se troca.
// Dados inventados.
import { act } from "react";
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ContaFolha } from "@/components/admin/financeiro/FolhasDeCadastro";
import type { ContaFinanceira } from "@/types/financeiro";
import {
  escolherNaLista,
  opcoesDaLista,
  valorDaLista,
} from "./helpers/lista-de-escolha";

const HOJE = "2026-11-26";
const CAMPO = "fin-conta-tipo";

const COFRE: ContaFinanceira = {
  id: "conta-cofre-teste",
  nome: "Cofre",
  tipo: "caixa",
  saldoInicial: 0,
  saldoInicialEm: "2026-01-01",
  ativa: true,
  ordem: 3,
  sistema: false,
  saldo: 0,
};

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ").trim();

const campo = () => document.getElementById(CAMPO) as HTMLButtonElement;
const textoDoCampo = () =>
  normalizar(document.getElementById(`${CAMPO}-valor`)?.textContent);

let raiz: Root;
let hospedeiro: HTMLDivElement;
let aoMudarSujo: Mock<(sujo: boolean) => void>;

beforeEach(() => {
  rpcFalso.mockReset();
  rpcFalso.mockImplementation(async (_n: string, args: { p: object }) => ({
    data: { id: "conta-1", ...args.p },
    error: null,
  }));
  aoMudarSujo = vi.fn<(sujo: boolean) => void>();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

async function abrir(conta: ContaFinanceira | null) {
  await act(async () =>
    raiz.render(
      <ContaFolha
        conta={conta}
        hoje={HOJE}
        aoFechar={vi.fn()}
        aoSalvar={vi.fn()}
        aoMudarSujo={aoMudarSujo}
      />,
    ),
  );
}

async function digitar(id: string, valor: string) {
  const elemento = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    elemento.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(elemento, valor);
    elemento.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    elemento.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

async function escolher(valor: string) {
  await act(async () => escolherNaLista(CAMPO, valor));
}

function botaoSalvar(): HTMLButtonElement {
  const botao = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[data-slot="sheet-content"] button',
    ),
  ].find((b) => normalizar(b.textContent) === "Salvar");
  if (!botao) throw new Error("botão Salvar não existe");
  return botao;
}

async function salvar() {
  await act(async () => botaoSalvar().click());
}

function corpoEnviado(): Record<string, unknown> {
  expect(rpcFalso).toHaveBeenCalledTimes(1);
  expect(rpcFalso.mock.calls[0]?.[0]).toBe("fin_conta_salvar");
  return rpcFalso.mock.calls[0]?.[1].p;
}

describe("ContaFolha — o tipo da conta na lista de escolha", () => {
  it("conta nova: as quatro opções de sempre e 'Conta bancária' já marcada", async () => {
    await abrir(null);

    let lidas: ReturnType<typeof opcoesDaLista> = [];
    act(() => {
      lidas = opcoesDaLista(CAMPO);
    });
    expect(lidas).toEqual([
      { valor: "caixa", rotulo: "Caixa físico", desabilitada: false },
      { valor: "banco", rotulo: "Conta bancária", desabilitada: false },
      { valor: "mercado_pago", rotulo: "Mercado Pago", desabilitada: false },
      { valor: "outro", rotulo: "Outra", desabilitada: false },
    ]);
    expect(valorDaLista(CAMPO)).toBe("banco");
    expect(textoDoCampo()).toBe("Conta bancária");
    expect(campo().disabled).toBe(false);
  });

  it("conta nova: trocar o tipo e voltar para banco grava tipo:'banco'", async () => {
    await abrir(null);
    await digitar("fin-conta-nome", "Cofre");
    await escolher("mercado_pago");
    expect(textoDoCampo()).toBe("Mercado Pago");
    expect(aoMudarSujo).toHaveBeenLastCalledWith(true);
    await escolher("banco");
    await salvar();

    expect(corpoEnviado()).toEqual({
      nome: "Cofre",
      tipo: "banco",
      saldo_inicial: 0,
      saldo_inicial_em: HOJE,
      ativa: true,
    });
  });

  it("conta nova: o tipo escolhido é o que vai ao servidor", async () => {
    await abrir(null);
    await digitar("fin-conta-nome", "Gaveta");
    await escolher("caixa");
    await salvar();

    expect(corpoEnviado()).toMatchObject({ nome: "Gaveta", tipo: "caixa" });
  });

  it("editar: trocar Caixa físico por Conta bancária manda só tipo:'banco'", async () => {
    await abrir(COFRE);
    expect(valorDaLista(CAMPO)).toBe("caixa");
    await escolher("banco");
    await salvar();

    expect(corpoEnviado()).toEqual({ id: COFRE.id, tipo: "banco" });
  });

  it("tocar no tipo que já está marcado não suja a folha nem manda o tipo", async () => {
    await abrir(COFRE);
    await escolher("caixa");

    expect(aoMudarSujo).toHaveBeenLastCalledWith(false);
    expect(aoMudarSujo).not.toHaveBeenCalledWith(true);
    await salvar();
    expect(corpoEnviado()).toEqual({ id: COFRE.id });
  });

  it("conta do sistema: o tipo é fixo, o campo fica desabilitado e o tipo não viaja", async () => {
    await abrir({
      ...COFRE,
      id: "conta-do-sistema",
      tipo: "banco",
      sistema: true,
    });

    expect(campo().disabled).toBe(true);
    expect(textoDoCampo()).toBe("Conta bancária");
    expect(() => escolherNaLista(CAMPO, "caixa")).toThrowError(/desabilitada/);
    // Nem o clique "forçado" abre a lista.
    act(() => campo().click());
    expect(campo().getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(`${CAMPO}-lista`)).toBeNull();

    await digitar("fin-conta-nome", "Banco da loja");
    await salvar();
    expect(corpoEnviado()).toEqual({
      id: "conta-do-sistema",
      nome: "Banco da loja",
    });
  });

  it("enquanto salva, o tipo não se troca", async () => {
    let soltar!: (resposta: { data: unknown; error: null }) => void;
    rpcFalso.mockReturnValueOnce(
      new Promise((resolve) => {
        soltar = resolve;
      }),
    );
    await abrir(COFRE);
    await salvar();

    expect(campo().disabled).toBe(true);
    expect(() => escolherNaLista(CAMPO, "banco")).toThrowError(/desabilitada/);
    await act(async () => soltar({ data: { id: COFRE.id }, error: null }));
    expect(rpcFalso).toHaveBeenCalledTimes(1);
  });
});
