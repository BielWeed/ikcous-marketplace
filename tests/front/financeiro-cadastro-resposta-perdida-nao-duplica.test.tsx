// @vitest-environment jsdom
//
// Financeiro — conta e categoria NOVAS: se a resposta do servidor se perde
// ANTES dos 30 s (queda de rede, "Failed to fetch"), a gravação pode já ter
// acontecido. A tela não pode convidar a repetir (o servidor só insere: criaria
// uma conta/categoria igual, e o saldo inicial entraria duas vezes). Ela trata
// como o prazo estourado: trava o Salvar e manda conferir a lista.
//
// Os controles seguram o outro lado: recusa do servidor (com código) continua
// com a frase de sempre e deixa repetir, e EDITAR (com id) continua podendo
// repetir (atualiza a mesma linha). E a folha não fecha com o salvamento no ar.
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

import {
  CategoriaFolha,
  ContaFolha,
} from "@/components/admin/financeiro/FolhasDeCadastro";
import {
  ErroDeFormatoFinanceiro,
  ErroDePrazoFinanceiro,
  ehFalhaDeRedeSemCodigo,
} from "@/lib/financeiro";
import type { CategoriaFinanceira, ContaFinanceira } from "@/types/financeiro";

const HOJE = "2026-11-08";
const CONTA_EXISTENTE: ContaFinanceira = {
  id: "conta-1",
  nome: "Cofre da loja",
  tipo: "outro",
  saldoInicial: 0,
  saldoInicialEm: HOJE,
  ativa: true,
  ordem: 3,
  sistema: false,
  saldo: 0,
};
const CATEGORIA_EXISTENTE: CategoriaFinanceira = {
  id: "cat-1",
  nome: "Aluguel",
  natureza: "despesa",
  grupoDre: "despesa_fixa",
  ativa: true,
  sistema: false,
};

// O que o supabase-js entrega quando o fetch cai: erro SEM código.
const REDE_CAIU = {
  message: "TypeError: Failed to fetch",
  details: "",
  hint: "",
  code: "",
};

let raiz: Root;
let hospedeiro: HTMLDivElement;

function botao(rotulo: string): HTMLButtonElement {
  const el = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === rotulo,
  );
  if (!el) throw new Error(`Botão ${rotulo} não existe`);
  return el;
}
const botaoX = () =>
  document.querySelector<HTMLButtonElement>('[aria-label="Fechar"]');

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
    await vi.advanceTimersByTimeAsync(150);
  });
}
async function tocarSalvar() {
  await act(async () => {
    botao("Salvar").click();
  });
}

interface Espioes {
  aoSalvar: Mock<(mensagem: string) => void>;
  aoSemResposta: Mock<() => void>;
  aoMudarEnviando: Mock<(enviando: boolean) => void>;
}
function espioes(): Espioes {
  return {
    aoSalvar: vi.fn<(mensagem: string) => void>(),
    aoSemResposta: vi.fn<() => void>(),
    aoMudarEnviando: vi.fn<(enviando: boolean) => void>(),
  };
}

interface Cadastro {
  readonly nome: string;
  readonly rpc: string;
  /** Frase que identifica o que pode ter sido criado. */
  readonly frase: RegExp;
  readonly novo: (e: Espioes) => ReactElement;
  readonly existente: (e: Espioes) => ReactElement;
  readonly preencherNovo: () => Promise<void>;
}
const CADASTROS: Cadastro[] = [
  {
    nome: "conta",
    rpc: "fin_conta_salvar",
    frase: /conta foi salva/,
    preencherNovo: () => digitar("fin-conta-nome", "Banco da loja"),
    novo: (e) => (
      <ContaFolha
        conta={null}
        hoje={HOJE}
        aoFechar={vi.fn()}
        aoSalvar={e.aoSalvar}
        aoSemResposta={e.aoSemResposta}
        aoMudarEnviando={e.aoMudarEnviando}
        aoMudarSujo={vi.fn()}
      />
    ),
    existente: (e) => (
      <ContaFolha
        conta={CONTA_EXISTENTE}
        hoje={HOJE}
        aoFechar={vi.fn()}
        aoSalvar={e.aoSalvar}
        aoSemResposta={e.aoSemResposta}
        aoMudarEnviando={e.aoMudarEnviando}
        aoMudarSujo={vi.fn()}
      />
    ),
  },
  {
    nome: "categoria",
    rpc: "fin_categoria_salvar",
    frase: /categoria foi salva/,
    preencherNovo: () => digitar("fin-categoria-nome", "Aluguel da loja"),
    novo: (e) => (
      <CategoriaFolha
        categoria={null}
        aoFechar={vi.fn()}
        aoSalvar={e.aoSalvar}
        aoSemResposta={e.aoSemResposta}
        aoMudarEnviando={e.aoMudarEnviando}
        aoMudarSujo={vi.fn()}
      />
    ),
    existente: (e) => (
      <CategoriaFolha
        categoria={CATEGORIA_EXISTENTE}
        aoFechar={vi.fn()}
        aoSalvar={e.aoSalvar}
        aoSemResposta={e.aoSemResposta}
        aoMudarEnviando={e.aoMudarEnviando}
        aoMudarSujo={vi.fn()}
      />
    ),
  },
];

const chamadasDa = (rpc: string) =>
  rpcFalso.mock.calls.filter(([nome]) => nome === rpc);

beforeEach(() => {
  vi.useFakeTimers();
  rpcFalso.mockReset();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(async () => {
  await act(async () => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

describe.each(CADASTROS)("$nome NOVA — resposta perdida", (c) => {
  const FALHAS: ReadonlyArray<readonly [string, () => void]> = [
    [
      "erro sem código devolvido pelo supabase",
      () => rpcFalso.mockResolvedValue({ data: null, error: REDE_CAIU }),
    ],
    [
      "fetch que rejeita (TypeError)",
      () => rpcFalso.mockRejectedValue(new TypeError("Failed to fetch")),
    ],
  ];

  it.each(FALHAS)(
    "%s: trava o Salvar e manda conferir a lista, sem convidar a repetir",
    async (_nome, preparar) => {
      preparar();
      const e = espioes();
      await act(async () => raiz.render(c.novo(e)));
      await c.preencherNovo();

      await tocarSalvar();

      expect(chamadasDa(c.rpc)).toHaveLength(1);
      // Voltou do "Salvando…", mas o Salvar fica parado.
      expect(botao("Salvar").disabled).toBe(true);
      const texto = document.body.textContent ?? "";
      expect(texto).toMatch(/não deu para confirmar/);
      expect(texto).toMatch(c.frase);
      expect(texto).toMatch(/confira/i);
      expect(texto).not.toMatch(/Não consegui falar com o servidor/);
      expect(texto).not.toMatch(/tente de novo/);
      // A tela relê a lista ao fechar; nada foi dado como salvo.
      expect(e.aoSemResposta).toHaveBeenCalledTimes(1);
      expect(e.aoSalvar).not.toHaveBeenCalled();
      // A folha volta a poder fechar (o envio acabou).
      expect(e.aoMudarEnviando).toHaveBeenLastCalledWith(false);
      expect(botaoX()?.disabled).toBe(false);

      // Nem outro toque nem mexer no formulário reabrem a gravação.
      await tocarSalvar();
      await c.preencherNovo();
      await tocarSalvar();
      expect(chamadasDa(c.rpc)).toHaveLength(1);
      expect(botao("Salvar").disabled).toBe(true);
      expect(document.body.textContent).toMatch(/não deu para confirmar/);
    },
  );

  it("controle: recusa do servidor (22023, com código) mostra a frase do banco e deixa repetir", async () => {
    rpcFalso.mockResolvedValue({
      data: null,
      error: {
        code: "22023",
        message: "Já existe uma conta com esse nome.",
        details: null,
      },
    });
    const e = espioes();
    await act(async () => raiz.render(c.novo(e)));
    await c.preencherNovo();

    await tocarSalvar();
    expect(document.body.textContent).toMatch(/Já existe uma conta/);
    expect(document.body.textContent).not.toMatch(/não deu para confirmar/);
    expect(botao("Salvar").disabled).toBe(false);
    expect(e.aoSemResposta).not.toHaveBeenCalled();

    await tocarSalvar();
    expect(chamadasDa(c.rpc)).toHaveLength(2);
  });

  it("controle: banco recusou os dados (23514) continua com a frase de hoje e deixa repetir", async () => {
    rpcFalso.mockResolvedValue({
      data: null,
      error: { code: "23514", message: "check violation", details: null },
    });
    const e = espioes();
    await act(async () => raiz.render(c.novo(e)));
    await c.preencherNovo();

    await tocarSalvar();
    expect(document.body.textContent).toMatch(/O banco recusou os dados/);
    expect(botao("Salvar").disabled).toBe(false);
    expect(e.aoSemResposta).not.toHaveBeenCalled();
  });

  it("controle: Financeiro não instalado (função ausente, mesmo sem código) NÃO vira 'sem resposta'", async () => {
    rpcFalso.mockResolvedValue({
      data: null,
      error: {
        code: "",
        message:
          "Could not find the function public.fin_x(p) in the schema cache",
        details: "",
      },
    });
    const e = espioes();
    await act(async () => raiz.render(c.novo(e)));
    await c.preencherNovo();

    await tocarSalvar();
    expect(document.body.textContent).toMatch(/ainda não foi instalado/);
    expect(document.body.textContent).not.toMatch(/não deu para confirmar/);
    expect(botao("Salvar").disabled).toBe(false);
    expect(e.aoSemResposta).not.toHaveBeenCalled();
  });
});

describe.each(CADASTROS)("$nome EXISTENTE — resposta perdida", (c) => {
  it("controle: edição com rede caída continua com a frase de hoje e repete com os mesmos dados", async () => {
    rpcFalso.mockResolvedValue({ data: null, error: REDE_CAIU });
    const e = espioes();
    await act(async () => raiz.render(c.existente(e)));

    await tocarSalvar();
    expect(document.body.textContent).toMatch(
      /Não consegui falar com o servidor/,
    );
    expect(document.body.textContent).not.toMatch(/não deu para confirmar/);
    expect(botao("Salvar").disabled).toBe(false);
    expect(e.aoSemResposta).not.toHaveBeenCalled();

    await tocarSalvar();
    expect(chamadasDa(c.rpc)).toHaveLength(2);
    const [primeira, segunda] = chamadasDa(c.rpc);
    expect(segunda[1]).toEqual(primeira[1]);
  });
});

describe.each(CADASTROS)("$nome — salvamento no ar", (c) => {
  function noAr() {
    let soltar!: (resposta: { data: unknown; error: unknown }) => void;
    rpcFalso.mockImplementation(
      () =>
        new Promise((resolve) => {
          soltar = resolve;
        }),
    );
    return (resposta: { data: unknown; error: unknown }) => soltar(resposta);
  }

  it("avisa a tela e não deixa fechar enquanto grava; libera quando a recusa chega", async () => {
    const soltar = noAr();
    const e = espioes();
    await act(async () => raiz.render(c.novo(e)));
    await c.preencherNovo();

    await tocarSalvar();
    expect(e.aoMudarEnviando).toHaveBeenCalledWith(true);
    expect(botaoX()?.disabled).toBe(true);

    await act(async () =>
      soltar({
        data: null,
        error: { code: "22023", message: "Nome já usado.", details: null },
      }),
    );
    expect(e.aoMudarEnviando).toHaveBeenLastCalledWith(false);
    expect(botaoX()?.disabled).toBe(false);
  });

  it("depois de gravar com sucesso, avisa que o envio acabou", async () => {
    const soltar = noAr();
    const e = espioes();
    await act(async () => raiz.render(c.novo(e)));
    await c.preencherNovo();

    await tocarSalvar();
    await act(async () => soltar({ data: null, error: null }));
    expect(e.aoSalvar).toHaveBeenCalledTimes(1);
    expect(e.aoMudarEnviando).toHaveBeenLastCalledWith(false);
  });
});

describe("ehFalhaDeRedeSemCodigo — o que conta como resposta perdida", () => {
  it("conta: erro sem código, fetch que rejeita, texto solto e valor nulo", () => {
    expect(ehFalhaDeRedeSemCodigo(REDE_CAIU)).toBe(true);
    expect(ehFalhaDeRedeSemCodigo({ message: "Failed to fetch" })).toBe(true);
    expect(ehFalhaDeRedeSemCodigo(new TypeError("Failed to fetch"))).toBe(true);
    expect(ehFalhaDeRedeSemCodigo("falhou")).toBe(true);
    expect(ehFalhaDeRedeSemCodigo(null)).toBe(true);
  });

  it("não conta: o servidor respondeu (qualquer código), prazo (tem tratamento próprio), formato e função ausente", () => {
    for (const code of ["22023", "P0001", "23505", "42501", "PGRST301"]) {
      expect(ehFalhaDeRedeSemCodigo({ code, message: "x" })).toBe(false);
    }
    expect(ehFalhaDeRedeSemCodigo(new ErroDePrazoFinanceiro("x"))).toBe(false);
    expect(ehFalhaDeRedeSemCodigo(new ErroDeFormatoFinanceiro("fin_x"))).toBe(
      false,
    );
    expect(
      ehFalhaDeRedeSemCodigo({
        message: "Could not find the function public.fin_x",
      }),
    ).toBe(false);
  });
});
