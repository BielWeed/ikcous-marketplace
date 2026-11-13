// @vitest-environment jsdom
//
// As LEITURAS de Perguntas do painel não podem ficar penduradas para sempre.
// Rede "pendurada" conecta e não responde: a lista (`get_admin_questions_paged`)
// e as duas contagens do topo (`getQAStats`) não tinham prazo — as ESCRITAS do
// mesmo hook já tinham `aguardarComPrazo`. Resultado: `loading` ligado sem fim,
// o contador de leituras em voo da tela nunca baixava (a volta ao app deixava de
// reler) e o cartão dizia "Nenhuma pergunta ainda".
//
// Roda o hook de verdade com o Supabase dublado e relógio falso. Estourou o
// prazo: a lista cai no erro que já existe ("Tentar de novo") e as contagens
// devolvem `status: "error"` (nunca zeros). O prazo NÃO quebra o cancelamento:
// uma carga superada por outra continua sendo só cancelada, sem marcar erro.
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
  // Resposta da RPC da lista: recebe o signal da chamada.
  rpc: null as null | ((signal: AbortSignal) => Promise<unknown>),
  // Resposta das contagens (cada consulta do getQAStats chama uma vez).
  contagem: null as null | (() => Promise<unknown>),
  signals: [] as AbortSignal[],
  toastErro: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => ({
      abortSignal: (signal: AbortSignal) => {
        h.signals.push(signal);
        return h.rpc ? h.rpc(signal) : Promise.resolve({});
      },
    }),
    from: () => {
      const construtor: {
        select: () => typeof construtor;
        eq: () => typeof construtor;
        then: (
          resolucao: (valor: unknown) => void,
          rejeicao: (erro: unknown) => void,
        ) => void;
      } = {
        select: () => construtor,
        eq: () => construtor,
        // O query builder do Supabase É thenable por desenho (mesmo precedente
        // de qa-stats-erro-nao-e-fila-vazia.test.tsx).
        // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
        then: (resolucao, rejeicao) => {
          (h.contagem ? h.contagem() : Promise.resolve({})).then(
            resolucao,
            rejeicao,
          );
        },
      };
      return construtor;
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: h.toastErro, info: vi.fn() },
}));

import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useQuestions } from "@/hooks/useQuestions";
import { PRAZO_DA_CONSULTA_DO_PAINEL_MS } from "@/lib/prazo-da-requisicao";
import { limparCachesDeAdmin } from "@/utils/admin_cache";

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

const ok = () =>
  Promise.resolve({
    data: { data: [LINHA], total_count: 1 },
    error: null,
  });
const pendurada = () => new Promise<never>(() => {});
// Como o fetch de verdade: ao ser abortada, a requisição rejeita.
const penduradaQueObedeceAoAbort = (signal: AbortSignal) =>
  new Promise<never>((_, rejeitar) => {
    signal.addEventListener("abort", () =>
      rejeitar(
        Object.assign(new Error("Fetch is aborted"), { name: "AbortError" }),
      ),
    );
  });

describe("useQuestions (painel) — as leituras têm prazo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: Sonda;

  beforeEach(() => {
    vi.useFakeTimers();
    h.rpc = null;
    h.contagem = null;
    h.signals = [];
    h.toastErro.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  async function passarOPrazo() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_DA_CONSULTA_DO_PAINEL_MS + 1);
    });
  }

  type Resultado = Awaited<ReturnType<Sonda["getAllQuestions"]>>;
  /** Inicia a carga e devolve um "porta" para saber se ela terminou. */
  async function iniciarCarga(silent = false) {
    const estado: { terminou: boolean; resultado?: Resultado } = {
      terminou: false,
    };
    await act(async () => {
      void atual.getAllQuestions(0, 10, "all", "", silent).then((r) => {
        estado.terminou = true;
        estado.resultado = r;
      });
    });
    return estado;
  }

  describe("a lista (get_admin_questions_paged)", () => {
    it("rede que não responde: passado o prazo o loading desliga e o erro 'Tentar de novo' aparece", async () => {
      await montar();
      h.rpc = pendurada;

      const carga = await iniciarCarga();
      expect(atual.loading).toBe(true);
      expect(carga.terminou).toBe(false);

      await passarOPrazo();

      expect(carga.terminou).toBe(true);
      expect(carga.resultado?.falhou).toBe(true);
      expect(atual.loading).toBe(false);
      expect(atual.erroDaListagemAdmin).toEqual(expect.any(String));
      expect(atual.erroDaListagemAdmin).not.toBe("");
      expect(atual.questions).toEqual([]);
      expect(h.toastErro).toHaveBeenCalledTimes(1);
    });

    it("estourado o prazo, a requisição abandonada é cancelada (não fica ocupando a conexão)", async () => {
      await montar();
      h.rpc = pendurada;

      await iniciarCarga();
      expect(h.signals).toHaveLength(1);
      expect(h.signals[0].aborted).toBe(false);

      await passarOPrazo();

      expect(h.signals[0].aborted).toBe(true);
    });

    it("releitura de bastidor que estoura o prazo mantém a lista da tela, sem erro nem toast", async () => {
      await montar();
      h.rpc = ok;
      await act(async () => {
        await atual.getAllQuestions(0, 10, "all", "");
      });
      expect(atual.questions).toHaveLength(1);

      h.rpc = pendurada;
      const carga = await iniciarCarga(true);
      await passarOPrazo();

      expect(carga.terminou).toBe(true);
      expect(carga.resultado?.falhou).toBe(true);
      expect(atual.loading).toBe(false);
      expect(atual.questions).toHaveLength(1);
      expect(atual.erroDaListagemAdmin).toBeNull();
      expect(h.toastErro).not.toHaveBeenCalled();
    });

    it("CONTROLE: carga superada por outra continua só cancelada — a lista nova fica e nenhum erro aparece", async () => {
      await montar();
      h.rpc = penduradaQueObedeceAoAbort;
      const primeira = await iniciarCarga();

      h.rpc = ok;
      await act(async () => {
        await atual.getAllQuestions(0, 10, "all", "novo");
      });
      expect(primeira.terminou).toBe(true);
      expect(primeira.resultado?.falhou).toBe(true);

      await passarOPrazo();

      expect(atual.questions).toHaveLength(1);
      expect(atual.erroDaListagemAdmin).toBeNull();
      expect(h.toastErro).not.toHaveBeenCalled();
    });

    it("o prazo da carga VELHA, vencendo depois de a nova já ter entregado, não apaga a lista nova", async () => {
      await montar();
      // A primeira ignora o cancelamento (a rede nem avisa): só o prazo a encerra.
      h.rpc = pendurada;
      await iniciarCarga();

      h.rpc = ok;
      await act(async () => {
        await atual.getAllQuestions(0, 10, "all", "novo");
      });
      expect(atual.questions).toHaveLength(1);

      await passarOPrazo();

      expect(atual.questions).toHaveLength(1);
      expect(atual.erroDaListagemAdmin).toBeNull();
      expect(h.toastErro).not.toHaveBeenCalled();
    });
  });

  describe("as contagens do topo (getQAStats)", () => {
    it("uma contagem pendurada vira status 'error' no prazo — nunca zeros de fila limpa", async () => {
      await montar();
      h.contagem = pendurada;

      const estado: {
        terminou: boolean;
        resultado?: Awaited<ReturnType<Sonda["getQAStats"]>>;
      } = { terminou: false };
      await act(async () => {
        void atual.getQAStats().then((r) => {
          estado.terminou = true;
          estado.resultado = r;
        });
      });
      expect(estado.terminou).toBe(false);

      await passarOPrazo();

      expect(estado.terminou).toBe(true);
      expect(estado.resultado?.status).toBe("error");
      expect(estado.resultado && "total" in estado.resultado).toBe(false);
    });

    it("CONTROLE: contagens que respondem no prazo seguem entregando os números", async () => {
      await montar();
      h.contagem = () => Promise.resolve({ count: 4, error: null });

      let resultado: Awaited<ReturnType<Sonda["getQAStats"]>> | undefined;
      await act(async () => {
        resultado = await atual.getQAStats();
      });

      expect(resultado).toMatchObject({ status: "ok", total: 4, pending: 4 });
    });
  });
});
