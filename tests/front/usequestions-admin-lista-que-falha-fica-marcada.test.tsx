// @vitest-environment jsdom
//
// Achado 7 (caça autônoma R4) — no painel, quando só a busca da LISTA de
// perguntas falhava (os números do topo são outra consulta), o hook devolvia
// `falhou: true` e mais nada: a lista da busca anterior continuava na tela
// (ou, se estava vazia, a tela dizia "Fila de perguntas limpa"). As Avaliações
// já tinham `erroDaListagemAdmin`; as Perguntas não.
//
// O contrato aqui é o do useReviews: a falha PREENCHE o erro, ZERA a lista e o
// cache da consulta que falhou, e o próximo sucesso LIMPA o erro. Cancelar
// uma carga (a próxima busca já saiu) não é falha e não marca nada.
vi.hoisted(() => {
  if (typeof globalThis.BroadcastChannel === "undefined") {
    class BroadcastChannelFalso {
      postMessage(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
      close(): void {}
    }
    (globalThis as unknown as Record<string, unknown>).BroadcastChannel =
      BroadcastChannelFalso;
  }
});

const h = vi.hoisted(() => ({
  // O que a próxima chamada da RPC do painel devolve.
  proxima: null as null | (() => Promise<unknown>),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => ({
      abortSignal: () => (h.proxima ? h.proxima() : Promise.resolve({})),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useQuestions } from "@/hooks/useQuestions";
import { cachedQuestionsData, limparCachesDeAdmin } from "@/utils/admin_cache";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Sonda = ReturnType<typeof useQuestions>;

const LINHA = {
  id: "q-1",
  user_id: "cliente-1",
  product_id: "prod-1",
  question: "Vocês enviam para o interior?",
  created_at: "2026-11-01T10:00:00.000Z",
  product: { nome: "Produto Teste", imagem_url: null },
  user: { full_name: "Maria", avatar_url: null },
  answers: [],
};

describe("useQuestions (painel) — lista que falha fica marcada, nunca vira fila limpa", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: Sonda;

  beforeEach(() => {
    h.proxima = null;
    limparCachesDeAdmin();
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

  async function montar() {
    function Componente() {
      const q = useQuestions();
      useEffect(() => {
        atual = q;
      });
      return null;
    }
    await act(async () => {
      raiz.render(<Componente />);
    });
  }

  async function carregar() {
    let resultado: Awaited<ReturnType<Sonda["getAllQuestions"]>>;
    await act(async () => {
      resultado = await atual.getAllQuestions(0, 10, "pending", "");
    });
    return resultado!;
  }

  const ok = () =>
    Promise.resolve({
      data: { data: [LINHA], total_count: 1 },
      error: null,
    });
  const falha = () =>
    Promise.resolve({ data: null, error: { message: "HTTP 500" } });

  it("a lista que falha zera as perguntas da busca anterior, zera o cache e marca o erro", async () => {
    await montar();
    h.proxima = ok;
    await carregar();
    expect(atual.questions).toHaveLength(1);
    expect(atual.erroDaListagemAdmin).toBeNull();
    expect(cachedQuestionsData).toHaveLength(1);

    h.proxima = falha;
    const resultado = await carregar();

    expect(resultado.falhou).toBe(true);
    expect(atual.questions).toEqual([]);
    expect(cachedQuestionsData ?? []).toEqual([]);
    expect(atual.erroDaListagemAdmin).toEqual(expect.any(String));
    expect(atual.erroDaListagemAdmin).not.toBe("");
  });

  it("o próximo sucesso limpa o erro e traz a lista de volta", async () => {
    await montar();
    h.proxima = falha;
    await carregar();
    expect(atual.erroDaListagemAdmin).not.toBeNull();

    h.proxima = ok;
    await carregar();

    expect(atual.erroDaListagemAdmin).toBeNull();
    expect(atual.questions).toHaveLength(1);
  });

  it("CONTROLE: carga cancelada (a próxima já saiu) não é falha — a lista fica e nenhum erro aparece", async () => {
    await montar();
    h.proxima = ok;
    await carregar();

    h.proxima = () =>
      Promise.reject(
        Object.assign(new Error("Fetch is aborted"), {
          name: "AbortError",
        }),
      );
    const resultado = await carregar();

    expect(resultado.falhou).toBe(true);
    expect(atual.erroDaListagemAdmin).toBeNull();
    expect(atual.questions).toHaveLength(1);
  });
});
