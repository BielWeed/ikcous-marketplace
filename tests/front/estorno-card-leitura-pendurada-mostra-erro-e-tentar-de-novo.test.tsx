// @vitest-environment jsdom
//
// Rede "pendurada" (conecta e nao responde: celular com sinal fraco): a leitura
// do saldo e do historico de devolucoes da ficha do pedido nunca terminava, e o
// cartao "Devolucao de dinheiro" ficava em "Carregando..." para sempre — sem
// erro e sem o botao de tentar de novo, que so existia quando a leitura FALHA.
// A lojista nao sabia se era lentidao ou defeito e nao conseguia devolver.
//
// O que este arquivo prende:
// 1. passado o prazo, o cartao diz que NAO conseguiu ler e oferece o botao —
//    nunca "R$ 0,00 disponivel" nem "nenhuma devolucao" (dinheiro: desconhecido
//    nao e zero);
// 2. o botao de tentar de novo le outra vez e, se a leitura nova voltar, o
//    cartao se recupera;
// 3. a resposta ATRASADA da leitura que estourou nao pinta a tela por cima da
//    leitura nova (contador de leitura);
// 4. controle negativo: leitura lenta, mas dentro do prazo, nao vira erro.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const SALDO_ABERTO = {
  total: 100,
  valor_estornado: 0,
  em_voo: 0,
  em_duvida: 0,
  manual: 0,
  disponivel: 100,
  reservado_por_fora: 0,
  linhas: [],
};
const SALDO_TUDO_DEVOLVIDO = {
  ...SALDO_ABERTO,
  valor_estornado: 100,
  disponivel: 0,
};

type RespostaDoSaldo = { data: unknown; error: unknown };

// Uma resposta por leitura do saldo, na ordem: `null` = nunca responde.
let respostasDoSaldo: Array<RespostaDoSaldo | null | Promise<RespostaDoSaldo>> =
  [];
let leiturasDoSaldo = 0;

function criarBuilderLinhas() {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: duble do query builder thenable do Supabase.
  builder.then = (resolve: unknown, reject?: unknown) =>
    Promise.resolve({ data: [], error: null }).then(
      resolve as never,
      reject as never,
    );
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => criarBuilderLinhas()),
    rpc: vi.fn((nome: string) => {
      if (nome !== "pedido_reembolsos_e_saldo") {
        return Promise.resolve({ data: null, error: null });
      }
      leiturasDoSaldo += 1;
      const resposta = respostasDoSaldo.shift();
      if (resposta === null || resposta === undefined) {
        return new Promise(() => {});
      }
      return Promise.resolve(resposta);
    }),
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pedido: Order = {
  id: "pedido-pendurado",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "online",
  paymentStatus: "pago",
  status: "processing",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  respostasDoSaldo = [];
  leiturasDoSaldo = 0;
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

async function renderizar() {
  const { EstornoCard } = await import("@/components/admin/orders/EstornoCard");
  await act(async () => {
    raiz.render(<EstornoCard order={pedido} />);
  });
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function botaoTentarDeNovo() {
  return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    /Tentar carregar de novo/.test(b.textContent ?? ""),
  );
}

describe("EstornoCard — leitura que nunca responde", () => {
  it("passado o prazo mostra o erro e o botao, e nunca um saldo inventado", async () => {
    respostasDoSaldo = [null];
    await renderizar();

    // Ainda dentro do prazo: so "Carregando…", sem botao.
    expect(hospedeiro.textContent).toContain("Carregando");
    expect(botaoTentarDeNovo()).toBeUndefined();

    await passar(20_000);

    expect(hospedeiro.textContent).toContain(
      "Não consegui carregar as devoluções deste pedido",
    );
    expect(botaoTentarDeNovo()).toBeDefined();
    // Dinheiro: "nao sei" nunca vira numero nem "nada a devolver".
    expect(hospedeiro.textContent).not.toMatch(/R\$\s0,00/);
    expect(hospedeiro.textContent).not.toContain("Carregando");
  });

  it("o botao le de novo e o cartao se recupera quando a leitura volta", async () => {
    respostasDoSaldo = [null, { data: SALDO_ABERTO, error: null }];
    await renderizar();
    await passar(20_000);

    const botao = botaoTentarDeNovo();
    expect(botao).toBeDefined();
    await act(async () => {
      botao?.click();
    });

    expect(leiturasDoSaldo).toBe(2);
    expect(botaoTentarDeNovo()).toBeUndefined();
    expect(hospedeiro.textContent).toMatch(/Disponível:\sR\$\s100/);
  });

  it("a resposta atrasada da leitura que estourou nao pinta por cima da leitura nova", async () => {
    let soltarAtrasada!: (r: RespostaDoSaldo) => void;
    const atrasada = new Promise<RespostaDoSaldo>((resolve) => {
      soltarAtrasada = resolve;
    });
    respostasDoSaldo = [atrasada, { data: SALDO_ABERTO, error: null }];
    await renderizar();
    await passar(20_000);

    await act(async () => {
      botaoTentarDeNovo()?.click();
    });
    expect(hospedeiro.textContent).toMatch(/Disponível:\sR\$\s100/);

    // A leitura velha chega tarde, com um retrato DIFERENTE (tudo devolvido):
    // se ela vencesse, o cartao trocaria o saldo e o botao sem ninguem pedir.
    await act(async () => {
      soltarAtrasada({ data: SALDO_TUDO_DEVOLVIDO, error: null });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(hospedeiro.textContent).toMatch(/Disponível:\sR\$\s100/);
    expect(hospedeiro.textContent).not.toContain(
      "Não consegui carregar as devoluções deste pedido",
    );
  });

  it("controle: leitura lenta mas dentro do prazo NAO vira erro", async () => {
    let soltar!: (r: RespostaDoSaldo) => void;
    respostasDoSaldo = [
      new Promise<RespostaDoSaldo>((resolve) => {
        soltar = resolve;
      }),
    ];
    await renderizar();

    await passar(10_000);
    expect(botaoTentarDeNovo()).toBeUndefined();

    await act(async () => {
      soltar({ data: SALDO_ABERTO, error: null });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(botaoTentarDeNovo()).toBeUndefined();
    expect(hospedeiro.textContent).toMatch(/Disponível:\sR\$\s100/);
    // O prazo nao fica armado depois da resposta: nada vira erro mais tarde.
    await passar(30_000);
    expect(botaoTentarDeNovo()).toBeUndefined();
  });
});
