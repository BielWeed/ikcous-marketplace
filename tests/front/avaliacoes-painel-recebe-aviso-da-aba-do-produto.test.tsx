// @vitest-environment jsdom
//
// Aba secundaria do PAINEL de avaliacoes nao recebia o aviso de avaliacao nova
// quando a aba LIDER era a de um produto: o lider assina o canal Realtime do
// SEU produto e avisa as demais abas com `{ type: "reviews_change", productId }`.
// O painel assina sem produto (todas as avaliacoes) e o filtro
// `event.data.productId === productId` descartava o aviso (id !== undefined),
// deixando a lista antiga na tela.
//
// O conserto: assinatura SEM produto aceita o aviso de qualquer produto;
// assinatura COM produto segue filtrando pelo seu.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const ouvintesDoCanal = new Set<(event: { data: unknown }) => void>();

vi.mock("@/lib/canal-de-abas", () => ({
  criarCanalDeAbas: () => ({
    postMessage: vi.fn(),
    close: vi.fn(),
    addEventListener: (
      _tipo: string,
      ouvinte: (e: { data: unknown }) => void,
    ) => ouvintesDoCanal.add(ouvinte),
    removeEventListener: (
      _tipo: string,
      ouvinte: (e: { data: unknown }) => void,
    ) => ouvintesDoCanal.delete(ouvinte),
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-1", email: "admin@teste.com" },
    profile: null,
    isAdmin: true,
  }),
}));

// Aba SECUNDARIA: escuta o BroadcastChannel em vez do Realtime.
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("useReviews - aba secundaria recebe o aviso de avaliacao do lider", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let useReviews: typeof import("@/hooks/useReviews").useReviews;

  beforeAll(async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    ({ useReviews } = await import("@/hooks/useReviews"));
  }, 15000);

  beforeEach(() => {
    ouvintesDoCanal.clear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    await act(async () => raiz.unmount());
    hospedeiro.remove();
  });

  async function montarAssinatura(productId?: string) {
    const aoMudar = vi.fn();
    function Prova() {
      const { subscribeToReviews } = useReviews();
      useEffect(
        () => subscribeToReviews(aoMudar, productId),
        [subscribeToReviews],
      );
      return null;
    }
    await act(async () => {
      raiz.render(<Prova />);
    });
    return aoMudar;
  }

  function avisoDoLider(productId: string | undefined) {
    act(() => {
      for (const ouvinte of ouvintesDoCanal) {
        ouvinte({ data: { type: "reviews_change", productId, payload: {} } });
      }
    });
  }

  it("painel (sem produto) relê a lista quando o lider avisa de um produto", async () => {
    const aoMudar = await montarAssinatura(undefined);

    avisoDoLider("prod-9");

    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it("painel (sem produto) tambem relê quando o lider e o proprio painel", async () => {
    const aoMudar = await montarAssinatura(undefined);

    avisoDoLider(undefined);

    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it("pagina de produto continua relendo so o aviso do SEU produto", async () => {
    const aoMudar = await montarAssinatura("prod-1");

    avisoDoLider("prod-1");
    expect(aoMudar).toHaveBeenCalledTimes(1);

    avisoDoLider("prod-9");
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it("mensagem de outro tipo no canal nao acorda ninguem", async () => {
    const aoMudar = await montarAssinatura(undefined);

    act(() => {
      for (const ouvinte of ouvintesDoCanal) {
        ouvinte({ data: { type: "outra_coisa", productId: "prod-9" } });
      }
    });

    expect(aoMudar).not.toHaveBeenCalled();
  });
});
