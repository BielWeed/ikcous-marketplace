// @vitest-environment jsdom
//
// VISITANTE SEM LOGIN NÃO ABRE CANAL DE TEMPO REAL NA PÁGINA DO PRODUTO
// (preparação da Black Friday de 27/11/2026 -- ver o teste irmão do motor).
//
// A página do produto assina avaliações (`subscribeToReviews`) e perguntas
// (`subscribeToQuestions`); o gate de atualização assina o sinal de deploy
// (`useRealtimeUpdate`). Os três eram abertos por QUALQUER visitante, e cada um
// segura a conexão de tempo real da aba (o teto do plano é por conexão).
//
// O QUE ESTA SUÍTE TRAVA, com os hooks REAIS e o canal dublê:
//   (a) sem sessão nenhum `channel()` é criado, por nenhum dos três;
//   (b) com sessão o canal nasce como antes;
//   (c) sem sessão, voltar à aba refaz a leitura (o `onChange` da página), mas
//       não duas vezes em menos de 30 s;
//   (e) borda: a visitante que ENTRA na conta troca o modo na hora (o canal
//       abre); desmontar a página solta o ouvinte de aba.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let usuario: { id: string; email: string } | null = null;
const canaisCriados: string[] = [];

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario, profile: null, isAdmin: false }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));

vi.mock("@/lib/supabase", () => {
  const builder: any = {};
  Object.assign(
    builder,
    Object.fromEntries(
      [
        "select",
        "eq",
        "in",
        "order",
        "limit",
        "range",
        "abortSignal",
        "maybeSingle",
      ].map((metodo) => [metodo, vi.fn(() => builder)]),
    ),
  );
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) =>
    Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject);
  return {
    supabase: {
      from: vi.fn(() => builder),
      channel: vi.fn((nome: string) => {
        canaisCriados.push(nome);
        const canal: any = {};
        canal.on = vi.fn(() => canal);
        canal.subscribe = vi.fn();
        return canal;
      }),
      removeChannel: vi.fn(() => Promise.resolve()),
    },
  };
});

function disparaVisibilidade(estado: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => estado,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

let raiz: Root | null = null;
let hospedeiro: HTMLDivElement | null = null;
let releituras = 0;

async function montar(componente: () => null) {
  const React = (await import("react")).default;
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz?.render(React.createElement(componente));
  });
}

async function remontar(componente: () => null) {
  const React = (await import("react")).default;
  await act(async () => {
    raiz?.render(React.createElement(componente));
  });
}

async function sondaAvaliacoes() {
  const { useReviews } = await import("@/hooks/useReviews");
  return function Sonda() {
    const { subscribeToReviews } = useReviews();
    useEffect(
      () =>
        subscribeToReviews(() => {
          releituras += 1;
        }, "prod-1"),
      [subscribeToReviews],
    );
    return null;
  };
}

async function sondaPerguntas() {
  const { useQuestions } = await import("@/hooks/useQuestions");
  return function Sonda() {
    const { subscribeToQuestions } = useQuestions();
    useEffect(
      () =>
        subscribeToQuestions(() => {
          releituras += 1;
        }, "prod-1"),
      [subscribeToQuestions],
    );
    return null;
  };
}

async function sondaSinalDeDeploy() {
  const { useRealtimeUpdate } = await import("@/hooks/useRealtimeUpdate");
  return function Sonda() {
    useRealtimeUpdate(() => {
      releituras += 1;
    }, usuario?.id);
    return null;
  };
}

const casos = [
  {
    nome: "avaliações da página do produto (useReviews)",
    sonda: sondaAvaliacoes,
    canal: "reviews_prod_prod-1",
    atraso: 0,
  },
  {
    nome: "perguntas da página do produto (useQuestions)",
    sonda: sondaPerguntas,
    canal: "questions_prod_prod-1",
    atraso: 0,
  },
  {
    nome: "sinal de deploy do gate de atualização (useRealtimeUpdate)",
    sonda: sondaSinalDeDeploy,
    canal: "pwa-system-signals",
    // O hook adia a assinatura em 400 ms.
    atraso: 500,
  },
];

describe.each(casos)("$nome", ({ sonda, canal, atraso }) => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    canaisCriados.length = 0;
    releituras = 0;
    usuario = null;
    disparaVisibilidade("visible");
  });

  afterEach(async () => {
    if (raiz) await act(async () => raiz?.unmount());
    raiz = null;
    hospedeiro?.remove();
    hospedeiro = null;
    vi.useRealTimers();
  });

  async function deixarAssentar() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(atraso);
    });
  }

  it("(a) sem sessão nenhum channel() é criado", async () => {
    usuario = null;
    await montar(await sonda());
    await deixarAssentar();

    expect(canaisCriados).toEqual([]);
  });

  it("(b) com sessão o canal é criado como antes", async () => {
    usuario = { id: "cliente-1", email: "cliente@teste.com" };
    await montar(await sonda());
    await deixarAssentar();

    expect(canaisCriados).toEqual([canal]);
  });

  it("(e) a visitante que entra na conta abre o canal na hora", async () => {
    usuario = null;
    const Sonda = await sonda();
    await montar(Sonda);
    await deixarAssentar();
    expect(canaisCriados).toEqual([]);

    usuario = { id: "cliente-1", email: "cliente@teste.com" };
    await remontar(Sonda);
    await deixarAssentar();
    expect(canaisCriados).toEqual([canal]);
  });
});

describe.each(casos.filter((c) => c.atraso === 0))(
  "$nome — voltar à aba sem sessão",
  ({ sonda }) => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.resetModules();
      canaisCriados.length = 0;
      releituras = 0;
      usuario = null;
      disparaVisibilidade("visible");
    });

    afterEach(async () => {
      if (raiz) await act(async () => raiz?.unmount());
      raiz = null;
      hospedeiro?.remove();
      hospedeiro = null;
      vi.useRealTimers();
    });

    it("(c) refaz a leitura ao voltar, mas não duas vezes em menos de 30 s", async () => {
      await montar(await sonda());
      expect(releituras).toBe(0);

      // Voltou à aba logo depois de abrir a página (a leitura da entrada
      // acabou de rodar): nada a refazer.
      disparaVisibilidade("visible");
      expect(releituras).toBe(0);

      // Passaram 31 s: ao voltar, refaz.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      disparaVisibilidade("visible");
      expect(releituras).toBe(1);

      // Voltou de novo 5 s depois: não martela o banco.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      disparaVisibilidade("visible");
      expect(releituras).toBe(1);

      // Passados mais 31 s, refaz.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      disparaVisibilidade("visible");
      expect(releituras).toBe(2);
    });

    it("(c) aba escondida não refaz nada", async () => {
      await montar(await sonda());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      disparaVisibilidade("hidden");
      expect(releituras).toBe(0);
    });

    it("(e) desmontar a página solta o ouvinte de aba", async () => {
      await montar(await sonda());
      await act(async () => raiz?.unmount());
      raiz = null;
      await vi.advanceTimersByTimeAsync(60_000);
      disparaVisibilidade("visible");
      expect(releituras).toBe(0);
    });
  },
);
