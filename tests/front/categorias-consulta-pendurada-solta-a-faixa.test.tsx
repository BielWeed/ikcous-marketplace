// @vitest-environment jsdom
//
// Rede "pendurada" na consulta das CATEGORIAS: a conexao aceita o pedido e nunca
// responde. Num aparelho sem copia salva, o "carregando" so desligava no fim da
// consulta (que nao acabava), a faixa de categorias da Home ficava em esqueleto
// para sempre e a promessa pendurada impedia qualquer nova tentativa. Agora a
// ESPERA da tela tem prazo (o do painel, 20 s): estourou, cai no mesmo caminho de
// uma falha de rede -- solta o "carregando" e agenda a nova tentativa automatica.
// A resposta tardia da consulta abandonada e' ignorada (nao desenha nem grava).
import { PRAZO_DA_CONSULTA_DO_PAINEL_MS } from "@/lib/prazo-da-requisicao";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rede = vi.hoisted(() => ({
  // O que a consulta devolve quando nao ha nada na fila (mutado por teste).
  resposta: { data: null as unknown, error: null as unknown },
  // Respostas na ordem das chamadas (uma consulta pendurada = promessa que o
  // teste nunca resolve, ou resolve de proposito depois do prazo).
  fila: [] as Array<Promise<unknown>>,
  // Quando (relogio do teste) cada consulta foi feita.
  consultas: [] as number[],
  // Tudo que foi gravado na copia do aparelho.
  gravacoes: [] as unknown[][],
}));

const avisos = vi.hoisted(() => ({ erro: vi.fn() }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: avisos.erro, info: vi.fn() },
}));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: () => {} }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getAll: async () => [],
      replaceAll: async (_loja: string, itens: unknown[]) => {
        rede.gravacoes.push(itens);
      },
      setLastSync: async () => {},
    }),
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => {
          rede.consultas.push(Date.now());
          const proxima = rede.fila.shift();
          return proxima ?? Promise.resolve(rede.resposta);
        },
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FALHA_DE_REDE = {
  message: "TypeError: Failed to fetch",
  details: "",
  hint: "",
  code: "",
};

function categoriaDoBanco(id: string, nome: string) {
  return {
    id,
    nome,
    slug: nome.toLowerCase(),
    descricao: "",
    ativo: true,
    created_at: "2026-10-01T00:00:00Z",
  };
}

function listaDe(...nomes: string[]) {
  return {
    data: nomes.map((nome, i) => categoriaDoBanco(`c${i}`, nome)),
    error: null,
  };
}

type Retrato = { nomes: string[]; isLoading: boolean };

describe("useCategories — consulta pendurada nao deixa a faixa em esqueleto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let retratos: Map<number, Retrato>;
  let emMemoria!: () => unknown[] | null;

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function montar(quantas = 1) {
    const { useCategories, categoriasEmMemoria } = await import(
      "@/hooks/useCategories"
    );
    emMemoria = categoriasEmMemoria;
    function Espiao({ indice }: { indice: number }) {
      const { categories, isLoading } = useCategories();
      useEffect(() => {
        retratos.set(indice, {
          nomes: categories.map((c) => c.name),
          isLoading,
        });
      });
      return null;
    }
    await act(async () => {
      raiz.render(
        <>
          <Espiao indice={0} />
          {quantas > 1 && <Espiao indice={1} />}
        </>,
      );
    });
    await avancar(50);
  }

  // Passa do prazo da consulta (montar ja gastou 50 ms).
  async function passarDoPrazo() {
    await avancar(PRAZO_DA_CONSULTA_DO_PAINEL_MS - 100);
    await avancar(200);
  }

  beforeEach(() => {
    // Cada cenario comeca sem cache de modulo nem pedido pendente do anterior.
    vi.resetModules();
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    rede.resposta = listaDe("Camisas");
    rede.fila = [];
    rede.consultas = [];
    rede.gravacoes = [];
    avisos.erro.mockClear();
    retratos = new Map();
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
    vi.restoreAllMocks();
  });

  it("consulta que nunca responde, sem copia salva: solta o carregando e tenta de novo", async () => {
    rede.fila = [new Promise(() => {})];
    await montar();
    expect(retratos.get(0)?.isLoading).toBe(true);

    // Antes do prazo ainda esta esperando (nao desiste cedo demais).
    await avancar(PRAZO_DA_CONSULTA_DO_PAINEL_MS - 100 - 50);
    expect(retratos.get(0)?.isLoading).toBe(true);
    expect(rede.consultas).toHaveLength(1);

    await avancar(200);
    expect(retratos.get(0)?.isLoading).toBe(false);
    expect(retratos.get(0)?.nomes).toEqual([]);
    // Ha nova tentativa agendada (relogio vivo), e o aviso espera por ela.
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    expect(avisos.erro).not.toHaveBeenCalled();

    // A nova tentativa (1 s depois) responde: a faixa ganha as categorias.
    await avancar(1_000);
    expect(rede.consultas).toHaveLength(2);
    expect(retratos.get(0)?.nomes).toEqual(["Camisas"]);
    expect(retratos.get(0)?.isLoading).toBe(false);
    expect(emMemoria()).not.toBeNull();
  });

  it("rede que fica pendurada em TODAS as tentativas: 4 consultas, 1 aviso, para", async () => {
    rede.fila = [
      new Promise(() => {}),
      new Promise(() => {}),
      new Promise(() => {}),
      new Promise(() => {}),
    ];
    await montar();
    await avancar(10 * 60_000);

    // 1 inicial + 3 automaticas -- nunca laco infinito.
    expect(rede.consultas).toHaveLength(4);
    expect(avisos.erro).toHaveBeenCalledTimes(1);
    expect(avisos.erro).toHaveBeenCalledWith("Erro ao carregar categorias", {
      id: "Erro ao carregar categorias",
    });
    expect(retratos.get(0)?.isLoading).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("duas telas esperando a mesma consulta pendurada: as duas saem do carregando", async () => {
    rede.fila = [new Promise(() => {})];
    await montar(2);
    await passarDoPrazo();

    expect(retratos.get(0)?.isLoading).toBe(false);
    expect(retratos.get(1)?.isLoading).toBe(false);
    await avancar(1_000);
    expect(retratos.get(0)?.nomes).toEqual(["Camisas"]);
    expect(retratos.get(1)?.nomes).toEqual(["Camisas"]);
  });

  it("a leitura de reserva (banco sem a coluna do icone) tambem tem prazo", async () => {
    rede.fila = [
      Promise.resolve({
        data: null,
        error: {
          code: "42703",
          message: 'column "icone" does not exist',
          details: "",
          hint: "",
        },
      }),
      new Promise(() => {}), // a leitura de reserva fica pendurada
    ];
    await montar();
    expect(rede.consultas).toHaveLength(2);
    expect(retratos.get(0)?.isLoading).toBe(true);

    await passarDoPrazo();
    expect(retratos.get(0)?.isLoading).toBe(false);
    await avancar(1_000);
    expect(retratos.get(0)?.nomes).toEqual(["Camisas"]);
  });

  it("controle: responde cedo -> categorias na tela, sem relogio pendente", async () => {
    await montar();
    expect(retratos.get(0)?.nomes).toEqual(["Camisas"]);
    expect(retratos.get(0)?.isLoading).toBe(false);
    expect(rede.consultas).toHaveLength(1);
    expect(avisos.erro).not.toHaveBeenCalled();
    // O relogio do prazo foi desarmado: nao sobra nada para estourar depois.
    expect(vi.getTimerCount()).toBe(0);
    await avancar(PRAZO_DA_CONSULTA_DO_PAINEL_MS * 2);
    expect(rede.consultas).toHaveLength(1);
    expect(retratos.get(0)?.nomes).toEqual(["Camisas"]);
  });

  it("controle: erro de rede explicito segue como antes (nova tentativa em 1 s, sem esperar o prazo)", async () => {
    rede.fila = [Promise.resolve({ data: null, error: FALHA_DE_REDE })];
    await montar();
    expect(retratos.get(0)?.isLoading).toBe(false);
    expect(avisos.erro).not.toHaveBeenCalled();
    expect(rede.consultas).toHaveLength(1);

    await avancar(1_000);
    expect(rede.consultas).toHaveLength(2);
    expect(retratos.get(0)?.nomes).toEqual(["Camisas"]);
  });

  it("resposta TARDIA da consulta abandonada nao grava nem desenha por cima da leitura nova", async () => {
    let tardia!: (v: unknown) => void;
    rede.fila = [
      new Promise((resolve) => {
        tardia = resolve;
      }),
    ];
    rede.resposta = listaDe("Novas");
    await montar();
    await passarDoPrazo();
    await avancar(1_000); // a nova tentativa leu "Novas"
    expect(retratos.get(0)?.nomes).toEqual(["Novas"]);
    const gravacoes = rede.gravacoes.length;
    expect(gravacoes).toBeGreaterThan(0);

    // So agora a consulta abandonada responde, com dado velho.
    await act(async () => {
      tardia(listaDe("Velhas"));
    });
    await avancar(50);

    expect(retratos.get(0)?.nomes).toEqual(["Novas"]);
    expect((emMemoria() as Array<{ name: string }>).map((c) => c.name)).toEqual(
      ["Novas"],
    );
    expect(rede.gravacoes).toHaveLength(gravacoes);
    expect(JSON.stringify(rede.gravacoes)).not.toContain("Velhas");
    expect(avisos.erro).not.toHaveBeenCalled();
  });

  it("resposta tardia ANTES da nova tentativa tambem e' ignorada, e a tentativa acontece", async () => {
    let tardia!: (v: unknown) => void;
    rede.fila = [
      new Promise((resolve) => {
        tardia = resolve;
      }),
    ];
    rede.resposta = listaDe("Novas");
    await montar();
    await passarDoPrazo();
    expect(retratos.get(0)?.isLoading).toBe(false);

    await act(async () => {
      tardia(listaDe("Velhas"));
    });
    await avancar(50);
    // A consulta abandonada nao escreve nada: continua sem lista e sem copia.
    expect(retratos.get(0)?.nomes).toEqual([]);
    expect(emMemoria()).toBeNull();
    expect(rede.gravacoes).toHaveLength(0);

    await avancar(1_000);
    expect(rede.consultas).toHaveLength(2);
    expect(retratos.get(0)?.nomes).toEqual(["Novas"]);
  });
});
