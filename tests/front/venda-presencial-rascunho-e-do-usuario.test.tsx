// @vitest-environment jsdom
//
// L10 da auditoria de segurança (12/10/2026) — o rascunho do PDV
// (`admin_pdv_venda_draft`) tinha UMA chave no aparelho: o cupom em curso do
// admin A (com nome e WhatsApp de cliente) era restaurado na tela do admin B
// e, pior, APAGADO quando B abria a tela com o cupom vazio. Agora a chave é
// por usuário — `admin_pdv_venda_draft:<uid>` — e o hook só lê e grava a do
// dono. Sem uid (sessão ainda não identificada) o hook não lê nem grava nada.
//
// A chave de idempotência (`chaveDeIdempotencia`) mora DENTRO do rascunho: o
// dono que volta recebe o MESMO rascunho, com a MESMA chave — retentar a
// venda não duplica o pedido.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type OpcoesDoVendaPresencial,
  type VendaPresencialEmUso,
  estadoInicialDaVenda,
  serializarRascunho,
  useVendaPresencial,
} from "@/hooks/useVendaPresencial";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "admin_pdv_venda_draft";

function criarArmazenamentoEmMemoria() {
  const mapa = new Map<string, string>();
  return {
    mapa,
    getItem: (chave: string) => mapa.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      mapa.set(chave, valor);
    },
    removeItem: (chave: string) => {
      mapa.delete(chave);
    },
  };
}

function Sonda({
  opcoes,
  aoAtualizar,
}: {
  readonly opcoes: OpcoesDoVendaPresencial;
  readonly aoAtualizar: (venda: VendaPresencialEmUso) => void;
}) {
  const venda = useVendaPresencial(opcoes);
  aoAtualizar(venda);
  return null;
}

const ultimo = (f: ReturnType<typeof vi.fn>): VendaPresencialEmUso =>
  f.mock.calls.at(-1)?.[0];

const item = {
  chave: "prod-1::",
  productId: "prod-1",
  variantId: null,
  nome: "Caneca",
  variacao: null,
  preco: 10,
  quantidade: 1,
  estoque: 5,
  imagem: "",
};

/** Um cupom em curso, com cliente avulso (nome e WhatsApp). */
function cupomDe(chaveDeIdempotencia: string) {
  const base = estadoInicialDaVenda(() => chaveDeIdempotencia);
  return serializarRascunho({
    ...base,
    itens: [item],
    cliente: { tipo: "avulso", nome: "Maria", whatsapp: "34999990000" },
  });
}

describe("rascunho do PDV — uma chave por usuário", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
  });

  async function montar(
    armazenamento: ReturnType<typeof criarArmazenamentoEmMemoria>,
    userId: string | undefined,
    aoAtualizar = vi.fn(),
  ) {
    await act(async () => {
      raiz.render(
        <Sonda
          opcoes={{
            armazenamento,
            userId,
            gerarChave: () => `chave-nova-${userId}`,
            atrasoDeGravacaoMs: 50,
          }}
          aoAtualizar={aoAtualizar}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    return aoAtualizar;
  }

  it("o rascunho de A NÃO é restaurado nem apagado quando B abre a tela com o cupom vazio", async () => {
    const armazenamento = criarArmazenamentoEmMemoria();
    const deA = cupomDe("chave-de-a");
    armazenamento.mapa.set(`${BASE}:admin-a`, deA);

    const aoAtualizar = await montar(armazenamento, "admin-b");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(ultimo(aoAtualizar).restaurado).toBe(false);
    expect(ultimo(aoAtualizar).estado.itens).toEqual([]);
    expect(armazenamento.mapa.get(`${BASE}:admin-a`)).toBe(deA);
    expect(armazenamento.mapa.has(`${BASE}:admin-b`)).toBe(false);
    // e nada na chave antiga, compartilhada
    expect(armazenamento.mapa.has(BASE)).toBe(false);
  });

  it("A volta e reencontra o rascunho dele, com a MESMA chave de idempotência", async () => {
    const armazenamento = criarArmazenamentoEmMemoria();
    armazenamento.mapa.set(`${BASE}:admin-a`, cupomDe("chave-de-a"));

    const aoAtualizar = await montar(armazenamento, "admin-a");

    const { estado, restaurado } = ultimo(aoAtualizar);
    expect(restaurado).toBe(true);
    expect(estado.chaveDeIdempotencia).toBe("chave-de-a");
    expect(estado.itens).toHaveLength(1);
  });

  it("B monta o cupom dele: grava só na chave de B; a de A fica intacta", async () => {
    const armazenamento = criarArmazenamentoEmMemoria();
    const deA = cupomDe("chave-de-a");
    armazenamento.mapa.set(`${BASE}:admin-a`, deA);

    const aoAtualizar = await montar(armazenamento, "admin-b");
    await act(async () => {
      ultimo(aoAtualizar).despachar({
        tipo: "item_adicionado_manualmente",
        item,
        em: 0,
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(armazenamento.mapa.has(`${BASE}:admin-b`)).toBe(true);
    expect(armazenamento.mapa.get(`${BASE}:admin-a`)).toBe(deA);
    expect(armazenamento.mapa.has(BASE)).toBe(false);
  });

  it("limpar o cupom apaga só o rascunho do dono", async () => {
    const armazenamento = criarArmazenamentoEmMemoria();
    const deA = cupomDe("chave-de-a");
    armazenamento.mapa.set(`${BASE}:admin-a`, deA);
    armazenamento.mapa.set(`${BASE}:admin-b`, cupomDe("chave-de-b"));

    const aoAtualizar = await montar(armazenamento, "admin-b");
    await act(async () => {
      ultimo(aoAtualizar).limparCupom();
    });

    expect(armazenamento.mapa.has(`${BASE}:admin-b`)).toBe(false);
    expect(armazenamento.mapa.get(`${BASE}:admin-a`)).toBe(deA);
  });

  it("SEM uid: não lê o rascunho de ninguém e não grava nada", async () => {
    const armazenamento = criarArmazenamentoEmMemoria();
    const deA = cupomDe("chave-de-a");
    armazenamento.mapa.set(`${BASE}:admin-a`, deA);
    armazenamento.mapa.set(BASE, cupomDe("chave-antiga"));

    const aoAtualizar = await montar(armazenamento, undefined);
    await act(async () => {
      ultimo(aoAtualizar).despachar({
        tipo: "item_adicionado_manualmente",
        item,
        em: 0,
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(ultimo(aoAtualizar).restaurado).toBe(false);
    // o cupom vive em memória, mas nada novo foi para o armazenamento
    expect([...armazenamento.mapa.keys()].sort()).toEqual(
      [BASE, `${BASE}:admin-a`].sort(),
    );
    expect(armazenamento.mapa.get(`${BASE}:admin-a`)).toBe(deA);
  });

  it("troca de usuário com a tela montada: o cupom de A não vai parar na chave de B", async () => {
    const armazenamento = criarArmazenamentoEmMemoria();
    const aoAtualizar = vi.fn();
    await montar(armazenamento, "admin-a", aoAtualizar);
    await act(async () => {
      ultimo(aoAtualizar).despachar({
        tipo: "item_adicionado_manualmente",
        item,
        em: 0,
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(armazenamento.mapa.has(`${BASE}:admin-a`)).toBe(true);
    const deA = armazenamento.mapa.get(`${BASE}:admin-a`);

    // a MESMA tela passa a ser do admin B (sem desmontar)
    await montar(armazenamento, "admin-b", aoAtualizar);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(ultimo(aoAtualizar).estado.itens).toEqual([]);
    expect(armazenamento.mapa.has(`${BASE}:admin-b`)).toBe(false);
    expect(armazenamento.mapa.get(`${BASE}:admin-a`)).toBe(deA);
  });
});
