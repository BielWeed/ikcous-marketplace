// @vitest-environment jsdom
//
// A internet segue de pé, a aba está visível, mas SÓ o socket do canal de
// avaliações cai e volta. O cliente com o produto aberto (ProductView) e a
// lojista no painel (AdminReviewsView) consultam ANTES de assinar: a avaliação
// ou a resposta que entrou no intervalo não chega por evento nenhum, e a tela
// ficava com o dado velho até F5 (o painel, também a contagem de pendências).
// O callback de status do canal só escrevia no console.
//
// Contrato: ao voltar a SUBSCRIBED DEPOIS de uma queda (CHANNEL_ERROR,
// TIMED_OUT ou CLOSED), o hook dispara UMA releitura pelo `onChange` que o
// chamador entregou e avisa as outras abas (que não têm canal) pelo mesmo
// aviso que o evento de mudança já usa. A PRIMEIRA confirmação não relê (a
// lista acabou de ser lida) e um SUBSCRIBED repetido sem queda também não.
vi.hoisted(() => {
  class BroadcastChannelFalso {
    nome: string;
    constructor(nome: string) {
      this.nome = nome;
    }
    postMessage(mensagem: unknown): void {
      (
        globalThis as unknown as { __avisosDeAbas: unknown[] }
      ).__avisosDeAbas.push({ nome: this.nome, mensagem });
    }
    addEventListener(): void {}
    removeEventListener(): void {}
    close(): void {}
  }
  (globalThis as unknown as Record<string, unknown>).__avisosDeAbas = [];
  (globalThis as unknown as Record<string, unknown>).BroadcastChannel =
    BroadcastChannelFalso;
});

const h = vi.hoisted(() => ({
  isLeader: true,
  aoMudarOStatus: null as ((status: string, err?: unknown) => void) | null,
  canaisCriados: 0,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "cliente-1", email: "cliente@teste.com" },
    profile: null,
    isAdmin: false,
  }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: h.isLeader }),
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedReviewsData: null,
  setCachedReviewsData: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    channel: vi.fn(() => {
      h.canaisCriados += 1;
      const canal: Record<string, unknown> = {};
      canal.on = vi.fn(() => canal);
      canal.subscribe = vi.fn((cb: (status: string, err?: unknown) => void) => {
        h.aoMudarOStatus = cb;
        return canal;
      });
      return canal;
    }),
    removeChannel: vi.fn(() => Promise.resolve()),
  },
}));

import { act, useEffect } from "react";
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

import { useReviews } from "@/hooks/useReviews";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const avisos = () =>
  (globalThis as unknown as { __avisosDeAbas: unknown[] }).__avisosDeAbas;

describe("useReviews.subscribeToReviews — canal que volta de queda relê", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let aoMudar: Mock<() => void>;

  async function montar(productId?: string) {
    function Prova() {
      const { subscribeToReviews } = useReviews();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- montagem única de propósito: o hook real muda de identidade por render.
      useEffect(() => subscribeToReviews(aoMudar, productId), []);
      return null;
    }
    await act(async () => {
      raiz.render(<Prova />);
    });
  }

  const status = (s: string) => act(async () => h.aoMudarOStatus?.(s));

  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    h.isLeader = true;
    h.aoMudarOStatus = null;
    h.canaisCriados = 0;
    avisos().length = 0;
    aoMudar = vi.fn<() => void>();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  it("assina, confirma, cai e volta: UMA releitura e as outras abas são avisadas", async () => {
    await montar("prod-1");
    await status("SUBSCRIBED");
    expect(aoMudar).not.toHaveBeenCalled();

    await status("CHANNEL_ERROR");
    expect(aoMudar).not.toHaveBeenCalled();
    await status("SUBSCRIBED");

    expect(aoMudar).toHaveBeenCalledTimes(1);
    expect(avisos()).toEqual([
      {
        nome: "ikcous_reviews_sync",
        mensagem: { type: "reviews_change", productId: "prod-1" },
      },
    ]);
  });

  it("a primeira confirmação do canal NÃO relê nem avisa", async () => {
    await montar("prod-1");
    await status("SUBSCRIBED");
    expect(aoMudar).not.toHaveBeenCalled();
    expect(avisos()).toEqual([]);
  });

  it("SUBSCRIBED repetido sem queda no meio NÃO relê", async () => {
    await montar("prod-1");
    await status("SUBSCRIBED");
    await status("SUBSCRIBED");
    await status("SUBSCRIBED");
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("TIMED_OUT e CLOSED também contam como queda", async () => {
    await montar("prod-1");
    await status("SUBSCRIBED");
    await status("TIMED_OUT");
    await status("SUBSCRIBED");
    expect(aoMudar).toHaveBeenCalledTimes(1);
    await status("CLOSED");
    await status("SUBSCRIBED");
    expect(aoMudar).toHaveBeenCalledTimes(2);
  });

  it("várias quedas seguidas antes de voltar rendem UMA releitura só", async () => {
    await montar("prod-1");
    await status("SUBSCRIBED");
    await status("CHANNEL_ERROR");
    await status("TIMED_OUT");
    await status("CLOSED");
    await status("SUBSCRIBED");
    await status("SUBSCRIBED");
    expect(aoMudar).toHaveBeenCalledTimes(1);
    expect(avisos()).toHaveLength(1);
  });

  it("queda ANTES da primeira confirmação também relê quando enfim confirma", async () => {
    // A consulta inicial saiu antes de a assinatura existir: o canal que só
    // confirma na segunda tentativa tem a mesma janela cega de uma queda.
    await montar("prod-1");
    await status("CHANNEL_ERROR");
    await status("SUBSCRIBED");
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it("painel (sem produto): a releitura avisa com productId indefinido", async () => {
    await montar(undefined);
    await status("SUBSCRIBED");
    await status("CHANNEL_ERROR");
    await status("SUBSCRIBED");
    expect(aoMudar).toHaveBeenCalledTimes(1);
    expect(avisos()).toEqual([
      {
        nome: "ikcous_reviews_sync",
        mensagem: { type: "reviews_change", productId: undefined },
      },
    ]);
  });

  it("aba secundária não tem canal: nada a reler por queda de socket", async () => {
    h.isLeader = false;
    await montar("prod-1");
    expect(h.canaisCriados).toBe(0);
    expect(h.aoMudarOStatus).toBeNull();
    expect(aoMudar).not.toHaveBeenCalled();
  });
});
