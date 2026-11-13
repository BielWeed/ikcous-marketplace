// @vitest-environment jsdom
//
// "Vendas" e "Devoluções e estornos" são categorias do sistema. A tela já
// avisava "só o nome muda", mas o Salvar mandava também `natureza` e
// `grupo_dre`, e a RPC `fin_categoria_salvar` (20261199000000) recusa a
// PRESENÇA dessas chaves nessas duas categorias (e `ativa=false`), mesmo com o
// valor igual ao de hoje: renomear sempre falhava com "só o nome pode mudar".
//
// O dublê da RPC abaixo repete essa regra do banco: o teste de tela prova que a
// lojista consegue salvar (a folha fecha com sucesso), não só que o corpo mudou.
// A conta do sistema não tinha o defeito (a RPC só recusa `tipo` DIFERENTE do
// atual); o teste dela fixa isso, para ninguém "consertar" mexendo no tipo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import {
  CategoriaFolha,
  ContaFolha,
} from "@/components/admin/financeiro/FolhasDeCadastro";
import { validarCategoria, validarConta } from "@/lib/financeiro";
import type { CategoriaFinanceira, ContaFinanceira } from "@/types/financeiro";

const ID_VENDAS = "f2000000-0000-4000-8000-000000000001";

const VENDAS: CategoriaFinanceira = {
  id: ID_VENDAS,
  nome: "Vendas",
  natureza: "receita",
  grupoDre: "receita",
  ativa: true,
  sistema: true,
};

const ALUGUEL: CategoriaFinanceira = {
  id: "cat-aluguel",
  nome: "Aluguel",
  natureza: "despesa",
  grupoDre: "despesa_fixa",
  ativa: true,
  sistema: false,
};

const CONTA_DA_LOJA: ContaFinanceira = {
  id: "conta-loja",
  nome: "Caixa da loja",
  tipo: "caixa",
  saldoInicial: 100,
  saldoInicialEm: "2026-01-01",
  ativa: true,
  ordem: 1,
  sistema: true,
  saldo: 100,
};

/** Repete o que o banco faz com as duas categorias e a conta do sistema. */
function bancoFalso(_nome: string, args: { p: Record<string, unknown> }) {
  const p = args.p;
  if (
    p.id === ID_VENDAS &&
    ("natureza" in p || "grupo_dre" in p || p.ativa === false)
  ) {
    return Promise.resolve({
      data: null,
      error: {
        code: "22023",
        message:
          "Esta categoria recebe as vendas e os estornos automaticamente: só o nome pode mudar.",
      },
    });
  }
  if (p.id === CONTA_DA_LOJA.id && "tipo" in p && p.tipo !== "caixa") {
    return Promise.resolve({
      data: null,
      error: { code: "22023", message: "As contas da loja não mudam de tipo." },
    });
  }
  return Promise.resolve({ data: { id: p.id ?? "novo" }, error: null });
}

describe("validarCategoria — categoria do sistema manda só o que a RPC aceita", () => {
  const form = {
    id: ID_VENDAS,
    nome: "  Receita de vendas ",
    natureza: "receita",
    grupoDre: "receita",
    ativa: true,
  } as const;

  it("sistema: o corpo leva só id e nome (sem natureza nem grupo_dre)", () => {
    expect(validarCategoria(form, true)).toEqual({
      ok: true,
      payload: { id: ID_VENDAS, nome: "Receita de vendas", ativa: true },
    });
    const r = validarCategoria(form, true);
    if (!r.ok) throw new Error("devia validar");
    expect("natureza" in r.payload).toBe(false);
    expect("grupo_dre" in r.payload).toBe(false);
  });

  it("sistema já desativada no banco: não manda ativa=false (a RPC recusaria)", () => {
    const r = validarCategoria({ ...form, ativa: false }, true);
    if (!r.ok) throw new Error("devia validar");
    expect(r.payload).toEqual({ id: ID_VENDAS, nome: "Receita de vendas" });
  });

  it("sistema: o nome continua sendo validado (vazio e acima de 60)", () => {
    expect(validarCategoria({ ...form, nome: "  " }, true)).toEqual({
      ok: false,
      erros: { nome: "Dê um nome para a categoria." },
    });
    expect(validarCategoria({ ...form, nome: "x".repeat(61) }, true).ok).toBe(
      false,
    );
  });

  it("categoria comum: o corpo é o de sempre, com natureza e grupo_dre", () => {
    const comum = {
      id: "cat-aluguel",
      nome: "Aluguel",
      natureza: "despesa",
      grupoDre: "despesa_fixa",
      ativa: true,
    } as const;
    const esperado = {
      ok: true,
      payload: {
        id: "cat-aluguel",
        nome: "Aluguel",
        natureza: "despesa",
        grupo_dre: "despesa_fixa",
        ativa: true,
      },
    };
    expect(validarCategoria(comum)).toEqual(esperado);
    expect(validarCategoria(comum, false)).toEqual(esperado);
  });

  it("categoria nova (sem id) segue mandando natureza e grupo_dre", () => {
    expect(
      validarCategoria({
        nome: "Frete",
        natureza: "despesa",
        grupoDre: "despesa_fixa",
        ativa: true,
      }),
    ).toEqual({
      ok: true,
      payload: {
        nome: "Frete",
        natureza: "despesa",
        grupo_dre: "despesa_fixa",
        ativa: true,
      },
    });
  });
});

describe("validarConta — conta do sistema (sem defeito: a RPC só barra tipo diferente)", () => {
  it("o corpo mantém o tipo atual e o saldo novo segue valendo", () => {
    const r = validarConta({
      id: "conta-loja",
      nome: "Caixa da loja",
      tipo: "caixa",
      saldoInicial: "250,00",
      saldoInicialEm: "2026-01-01",
      ativa: true,
    });
    expect(r).toEqual({
      ok: true,
      payload: {
        id: "conta-loja",
        nome: "Caixa da loja",
        tipo: "caixa",
        saldo_inicial: 250,
        saldo_inicial_em: "2026-01-01",
        ativa: true,
      },
    });
  });
});

describe("Folhas do financeiro — renomear o que é do sistema", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpcFalso.mockReset();
    rpcFalso.mockImplementation(bancoFalso);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  function folha(): HTMLElement {
    const el = document.querySelector<HTMLElement>(
      '[data-slot="sheet-content"]',
    );
    if (!el) throw new Error("Folha não abriu");
    return el;
  }

  function botao(rotulo: string): HTMLButtonElement {
    const achado = [...folha().querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === rotulo,
    );
    if (!achado) throw new Error(`botão "${rotulo}" não existe`);
    return achado;
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

  async function abrirCategoria(categoria: CategoriaFinanceira) {
    const aoSalvar = vi.fn();
    await act(async () =>
      raiz.render(
        <CategoriaFolha
          categoria={categoria}
          aoFechar={vi.fn()}
          aoSalvar={aoSalvar}
          aoMudarSujo={vi.fn()}
        />,
      ),
    );
    return aoSalvar;
  }

  it("categoria do sistema: trocar o nome e salvar funciona e só o nome viaja", async () => {
    const aoSalvar = await abrirCategoria(VENDAS);
    await digitar("fin-categoria-nome", "Receita de vendas");
    await act(async () => botao("Salvar").click());

    expect(rpcFalso).toHaveBeenCalledExactlyOnceWith("fin_categoria_salvar", {
      p: { id: ID_VENDAS, nome: "Receita de vendas", ativa: true },
    });
    expect(aoSalvar).toHaveBeenCalledExactlyOnceWith("Categoria atualizada.");
    expect(folha().textContent).not.toContain("só o nome pode mudar");
  });

  it("categoria do sistema: a linha do resultado não pode ser trocada (o banco recusaria)", async () => {
    await abrirCategoria(VENDAS);
    const radios = [
      ...folha().querySelectorAll<HTMLInputElement>(
        'input[name="fin-categoria-grupo"]',
      ),
    ];
    expect(radios.length).toBeGreaterThan(0);
    expect(radios.every((r) => r.disabled)).toBe(true);
  });

  it("categoria comum: o corpo enviado é o de sempre", async () => {
    const aoSalvar = await abrirCategoria(ALUGUEL);
    await digitar("fin-categoria-nome", "Aluguel da loja");
    await act(async () => botao("Salvar").click());

    expect(rpcFalso).toHaveBeenCalledExactlyOnceWith("fin_categoria_salvar", {
      p: {
        id: "cat-aluguel",
        nome: "Aluguel da loja",
        natureza: "despesa",
        grupo_dre: "despesa_fixa",
        ativa: true,
      },
    });
    expect(aoSalvar).toHaveBeenCalledExactlyOnceWith("Categoria atualizada.");
  });

  it("conta do sistema: trocar o nome e o saldo salva (o tipo vai igual ao de hoje)", async () => {
    const aoSalvar = vi.fn();
    await act(async () =>
      raiz.render(
        <ContaFolha
          conta={CONTA_DA_LOJA}
          hoje="2026-09-27"
          aoFechar={vi.fn()}
          aoSalvar={aoSalvar}
          aoMudarSujo={vi.fn()}
        />,
      ),
    );
    await digitar("fin-conta-nome", "Gaveta da loja");
    await act(async () => botao("Salvar").click());

    expect(rpcFalso).toHaveBeenCalledExactlyOnceWith("fin_conta_salvar", {
      p: {
        id: "conta-loja",
        nome: "Gaveta da loja",
        tipo: "caixa",
        saldo_inicial: 100,
        saldo_inicial_em: "2026-01-01",
        ativa: true,
      },
    });
    expect(aoSalvar).toHaveBeenCalledExactlyOnceWith("Conta atualizada.");
  });
});
