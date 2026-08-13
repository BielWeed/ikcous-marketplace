import type { AdminStatus } from "@/contexts/AuthContext";
// @vitest-environment jsdom
//
// Issues #121 e #123 — AuthContext.tsx é o dono de `isAdmin`/`adminStatus`
// para a loja inteira, e hoje resolve por dois caminhos errados: um
// semáforo global de módulo (#121) e texto editável do `localStorage`
// (#123). Sem `@testing-library/react` neste projeto (vitest.config.ts
// documenta a escolha), o padrão já usado em
// address-form-cep-race.test.tsx e use-busca-cep.test.tsx é seguido aqui:
// `createRoot` + `act` puro do React, e um componente-sonda que reporta o
// valor do contexto por CALLBACK (`aoAtualizar`), não por mutação de
// variável de fora do componente — a primeira versão deste arquivo mutava
// uma `let atual` fechada na sonda e o `eslint-plugin-react-hooks` reprova
// isso (`react-hooks/globals`, "Cannot reassign variables declared outside
// of the component"), com razão: é efeito colateral em render.
//
// POR QUE `vi.resetModules()` + `await import(...)` SÓ PARA O AuthContext:
// `checkInFlight` e `initPromise` (AuthContext.tsx:57-59) são variáveis de
// MÓDULO — compartilhadas por qualquer instância de `AuthProvider` que
// reimporte o MESMO módulo. Sem reset, um teste herdaria a verificação em
// voo do teste anterior. Mesmo padrão de `promessaSdk` em
// pagamento-online.test.tsx e de `sw-fetch.test.ts`. `@/lib/supabase`, ao
// contrário, NÃO é reimportado: `vi.mock()` roda a factory uma vez só (o
// registro de mocks sobrevive a `resetModules()` — só o registro de
// módulos "reais" é limpo), então uma segunda `await import("@/lib/supabase")`
// devolveria o MESMO objeto — mas com `.mock.calls` acumulado do teste
// anterior. Medido: sem isto, o teste 2 herdava contagem de RPC do teste 1
// e travava num `filaIsAdmin[1]` que nunca existiu. Import estático aqui em
// cima + `vi.resetAllMocks()` no `beforeEach` é o que garante teste
// isolado.
import { supabase } from "@/lib/supabase";
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      getUser: vi.fn(),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({
              data: null,
              error: { message: "não usado nestes testes" },
            }),
        }),
      }),
    })),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão já
// usado em address-form-cep-race.test.tsx e pagamento-online.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Snapshot {
  isAdmin: boolean;
  adminStatus: AdminStatus;
  userId: string | null;
}

type AuthChangeCallback = (
  event: string,
  session: unknown,
) => void | Promise<void>;

/** Sonda genérica: lê o contexto (passado por fora, porque cada teste pode
 * ter reimportado `@/contexts/AuthContext` do zero — ver cabeçalho) e
 * REPORTA por callback, em vez de mutar uma variável fechada de fora do
 * componente (é essa mutação que `react-hooks/globals` reprova). */
function Sonda({
  authContext,
  aoAtualizar,
}: {
  readonly authContext: React.Context<any>;
  readonly aoAtualizar: (snapshot: Snapshot) => void;
}) {
  const ctx = useContext(authContext) as {
    isAdmin: boolean;
    adminStatus: AdminStatus;
    user: { id: string } | null;
  };
  aoAtualizar({
    isAdmin: ctx.isAdmin,
    adminStatus: ctx.adminStatus,
    userId: ctx.user?.id ?? null,
  });
  return null;
}

/** Devolve o snapshot da chamada mais recente de `aoAtualizar` (o último
 * valor que o contexto assumiu até agora). */
function ultimoEstado(
  aoAtualizar: ReturnType<typeof vi.fn>,
): Snapshot | undefined {
  const chamadas = aoAtualizar.mock.calls;
  return chamadas.at(-1)?.[0];
}

/** Devolve o snapshot do PRIMEIRO render — usado no teste 5 para provar que
 * o estado síncrono inicial não nasce "admin" a partir do cache adulterado. */
function primeiroEstado(
  aoAtualizar: ReturnType<typeof vi.fn>,
): Snapshot | undefined {
  return aoAtualizar.mock.calls[0]?.[0];
}

/** Espera a fila de microtarefas drenar por inteiro — mesmo helper e mesmo
 * motivo de pagamento-online.test.tsx: um `setTimeout(0)` só roda depois que
 * TODAS as microtarefas pendentes (inclusive as que uma promise resolvida
 * agenda em cadeia) já drenaram. */
function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Reimporta `@/contexts/AuthContext` do zero (ver cabeçalho do arquivo) —
 * `checkInFlight`/`initPromise` nascem `null` de novo. `@/lib/supabase` é o
 * dublê estático importado no topo, o mesmo em todos os testes. */
async function montarProvider() {
  vi.resetModules();
  const { AuthContext, AuthProvider } = await import("@/contexts/AuthContext");
  return { supabase, AuthContext, AuthProvider };
}

/** Node 25 já expõe um `globalThis.localStorage` experimental sem `.clear`
 * nem `.key`, que pisa na implementação do jsdom antes do teste rodar
 * (confirmado: `localStorage.clear is not a function` mesmo com
 * `@vitest-environment jsdom`). O resto da suíte contorna isto com
 * `vi.stubGlobal("localStorage", ...)` (ver checkout-view-flag-on.test.tsx)
 * — aqui precisa também de `length`/`key(i)`, que `getCachedSession()`
 * usa para varrer as chaves em busca de `-auth-token`. */
function criarLocalStorageFake() {
  const armazem = new Map<string, string>();
  return {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, valor);
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
    clear: () => {
      armazem.clear();
    },
    key: (index: number) => Array.from(armazem.keys()).at(index) ?? null,
    get length() {
      return armazem.size;
    },
  };
}

function semearSessaoCache(
  userId: string,
  appMetadata: Record<string, unknown> = {},
) {
  localStorage.setItem(
    "sb-teste-auth-token",
    JSON.stringify({
      access_token: `tok-${userId}`,
      user: { id: userId, app_metadata: appMetadata },
    }),
  );
}

type Deferred = { resolve: (v: unknown) => void; reject: (e: unknown) => void };

// O client real do supabase-js tipa `rpc(nome, ...)` com um union literal
// dos nomes de RPC cadastrados — incompatível de propósito com o `string`
// solto que os testes usam para escolher o dublê. `any` aqui é o mesmo
// contorno que `useOrders.ts` já usa para o `rpc` tipado (`as any`).
function rpcMock(supabaseDublê: any): ReturnType<typeof vi.fn> {
  return supabaseDublê.rpc as ReturnType<typeof vi.fn>;
}

/** Configura `supabase.rpc` para devolver, só para "is_admin", uma promise
 * que o teste controla manualmente (fila FIFO — uma entrada por chamada).
 * Qualquer outra RPC (ex.: get_my_complete_profile, chamada por
 * fetchProfile) resolve vazia na hora, para não travar o fluxo. */
function configurarRpcControlada(supabaseDublê: any): Deferred[] {
  const filaIsAdmin: Deferred[] = [];
  rpcMock(supabaseDublê).mockImplementation((name: string) => {
    if (name === "is_admin") {
      return new Promise((resolve, reject) => {
        filaIsAdmin.push({ resolve, reject });
      });
    }
    return Promise.resolve({ data: null, error: null });
  });
  return filaIsAdmin;
}

function contarChamadasIsAdmin(supabaseDublê: any): number {
  return rpcMock(supabaseDublê).mock.calls.filter(
    (args: unknown[]) => args[0] === "is_admin",
  ).length;
}

describe("AuthContext — verificação de admin (issues #121 e #123)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    // Zera `.mock.calls` e a `mockImplementation` de TODOS os dublês
    // (`supabase.rpc`, `.auth.*`, `sonner`) — ver o comentário no topo do
    // arquivo sobre por que `@/lib/supabase` não é reimportado por teste.
    vi.resetAllMocks();
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Monta o Provider com um boot sem sessão (getSession resolve `null`),
   * captura o callback do `onAuthStateChange` para simular trocas de conta
   * manualmente, e devolve `aoAtualizar` (o dublê que a Sonda chama a cada
   * render). Usado pelos casos da Parte A (#121), que testam a
   * coalescência entre chamadas concorrentes de `checkAdmin`, não o boot
   * inicial em si. */
  async function montarSemSessaoInicial() {
    const { supabase, AuthContext, AuthProvider } = await montarProvider();

    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { session: null }, error: null });

    let callback: AuthChangeCallback = () => {};
    (
      supabase.auth.onAuthStateChange as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation((cb: AuthChangeCallback) => {
      callback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    const filaIsAdmin = configurarRpcControlada(supabase);
    const aoAtualizar = vi.fn();

    await act(async () => {
      raiz.render(
        <AuthProvider>
          <Sonda authContext={AuthContext} aoAtualizar={aoAtualizar} />
        </AuthProvider>,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    return { supabase, callback: () => callback, filaIsAdmin, aoAtualizar };
  }

  function sessaoDe(userId: string) {
    return {
      user: { id: userId, app_metadata: {} },
      access_token: `tok-${userId}`,
    };
  }

  // ---------------------------------------------------------------------
  // Parte A — #121
  // ---------------------------------------------------------------------

  it("1. duas chamadas concorrentes para o MESMO userId disparam uma única RPC", async () => {
    const { supabase, callback, filaIsAdmin, aoAtualizar } =
      await montarSemSessaoInicial();
    const cb = callback();

    await act(async () => {
      // Duas chamadas concorrentes, sem await entre elas — é exatamente o
      // "admin sai, cliente entra antes da RPC responder" descrito no
      // brief, só que com o MESMO usuário duas vezes.
      cb("SIGNED_IN", sessaoDe("user-a"));
      cb("SIGNED_IN", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });

    expect(contarChamadasIsAdmin(supabase)).toBe(1);

    filaIsAdmin[0].resolve({ data: true, error: null });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(ultimoEstado(aoAtualizar)?.adminStatus).toBe("admin");
    expect(ultimoEstado(aoAtualizar)?.isAdmin).toBe(true);
  });

  it("2. duas chamadas concorrentes para userIds DIFERENTES disparam duas RPCs, cada uma resolvendo o próprio booleano", async () => {
    const { supabase, callback, filaIsAdmin, aoAtualizar } =
      await montarSemSessaoInicial();
    const cb = callback();

    await act(async () => {
      cb("SIGNED_IN", sessaoDe("user-a"));
      cb("SIGNED_IN", sessaoDe("user-b"));
      await esperarMicrotarefas();
    });

    // Esta é a asserção que morre no código de hoje: o semáforo global
    // (`checkingLock`) faz a segunda chamada apenas ESPERAR a primeira e
    // voltar sem calcular nada — só UMA RPC dispara para os dois usuários.
    expect(contarChamadasIsAdmin(supabase)).toBe(2);

    // user-b (o ativo) é admin; user-a não é.
    filaIsAdmin[0].resolve({ data: false, error: null }); // user-a
    filaIsAdmin[1].resolve({ data: true, error: null }); // user-b
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(ultimoEstado(aoAtualizar)?.userId).toBe("user-b");
    expect(ultimoEstado(aoAtualizar)?.adminStatus).toBe("admin");
    expect(localStorage.getItem("ikcous_is_admin_user-b")).toBe("true");
  });

  it("3. a RPC do usuário A resolvendo DEPOIS de o usuário ativo virar B não escreve isAdmin nem o localStorage de A", async () => {
    const { callback, filaIsAdmin, aoAtualizar } =
      await montarSemSessaoInicial();
    const cb = callback();

    await act(async () => {
      cb("SIGNED_IN", sessaoDe("user-a"));
      cb("SIGNED_IN", sessaoDe("user-b"));
      await esperarMicrotarefas();
    });

    // Pré-requisito desta prova: as duas RPCs têm que ter disparado (item
    // 2). Falha aqui, limpa, se a coalescência ainda for o semáforo global.
    expect(filaIsAdmin.length).toBe(2);

    // B (o ativo) responde primeiro.
    filaIsAdmin[1].resolve({ data: false, error: null }); // user-b
    await act(async () => {
      await esperarMicrotarefas();
    });
    expect(ultimoEstado(aoAtualizar)?.userId).toBe("user-b");
    expect(ultimoEstado(aoAtualizar)?.adminStatus).toBe("not-admin");

    // A RPC de A (o usuário que SAIU) só chega agora, dizendo que A É admin.
    filaIsAdmin[0].resolve({ data: true, error: null }); // user-a
    await act(async () => {
      await esperarMicrotarefas();
    });

    // O usuário ativo continua sendo B, e continua not-admin — a resposta
    // tardia de A não pode ter promovido ninguém.
    expect(ultimoEstado(aoAtualizar)?.userId).toBe("user-b");
    expect(ultimoEstado(aoAtualizar)?.adminStatus).toBe("not-admin");
    expect(ultimoEstado(aoAtualizar)?.isAdmin).toBe(false);
    // E o cache de A nunca foi escrito com o resultado descartado.
    expect(localStorage.getItem("ikcous_is_admin_user-a")).toBeNull();
  });

  it("4. o timeout de 3s produz isAdmin=false SEM persistir no localStorage, e a queryPromise chegando depois NÃO sobrescreve", async () => {
    // `useFakeTimers` só DEPOIS do boot: `montarSemSessaoInicial` usa
    // `esperarMicrotarefas` (setTimeout real) para drenar o initAuth — com
    // timers falsos já ligados, esse setTimeout nunca dispara sozinho e o
    // teste trava até o timeout do próprio vitest.
    const { callback, filaIsAdmin, aoAtualizar } =
      await montarSemSessaoInicial();
    vi.useFakeTimers();
    const cb = callback();

    await act(async () => {
      cb("SIGNED_IN", sessaoDe("user-a"));
      await vi.advanceTimersByTimeAsync(0);
    });

    // Passa dos 3s do timeout interno da checagem de admin sem resolver a
    // RPC — a queryPromise (o rpc("is_admin") real) continua pendurada.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });

    // Achado 2 (revisão #121/#123): o timeout NUNCA é um veredito do
    // servidor — é a ausência de um. `adminStatus` pode virar "not-admin"
    // em memória (esta carga trata o usuário como não-admin até a próxima
    // checagem), mas o `localStorage` não pode ser escrito: gravar "false"
    // aqui persistiria uma resposta que nunca chegou, e a guarda de rota do
    // Achado 1 (App.tsx) usa exatamente esse cache, via Fast Path 2, para
    // decidir instantaneamente nas cargas SEGUINTES — antes de qualquer
    // rede.
    expect(ultimoEstado(aoAtualizar)?.adminStatus).toBe("not-admin");
    expect(ultimoEstado(aoAtualizar)?.isAdmin).toBe(false);
    expect(localStorage.getItem("ikcous_is_admin_user-a")).toBeNull();

    // A queryPromise órfã finalmente responde, dizendo que É admin.
    filaIsAdmin[0].resolve({ data: true, error: null });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Nada mudou: a resposta atrasada não escreve por cima do timeout, e o
    // cache continua sem entrada nenhuma para este usuário.
    expect(ultimoEstado(aoAtualizar)?.adminStatus).toBe("not-admin");
    expect(ultimoEstado(aoAtualizar)?.isAdmin).toBe(false);
    expect(localStorage.getItem("ikcous_is_admin_user-a")).toBeNull();
  });

  // ---------------------------------------------------------------------
  // Parte B — #123
  // ---------------------------------------------------------------------

  it("5. sessão em cache com app_metadata.role === 'admin' e RPC respondendo false termina em adminStatus 'not-admin'", async () => {
    const { supabase, AuthContext, AuthProvider } = await montarProvider();

    // A sessão em cache está ADULTERADA (DevTools): role "admin" direto no
    // JSON que o supabase-js persiste, sem tocar a assinatura do token.
    semearSessaoCache("user-spoof", { role: "admin" });

    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      data: {
        session: {
          user: { id: "user-spoof", app_metadata: { role: "admin" } },
          access_token: "tok-user-spoof",
        },
      },
      error: null,
    });
    (
      supabase.auth.getUser as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      data: { user: { id: "user-spoof", app_metadata: { role: "admin" } } },
      error: null,
    });
    (
      supabase.auth.onAuthStateChange as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (name: string) => {
        if (name === "is_admin") {
          return Promise.resolve({ data: false, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    );

    const aoAtualizar = vi.fn();

    await act(async () => {
      raiz.render(
        <AuthProvider>
          <Sonda authContext={AuthContext} aoAtualizar={aoAtualizar} />
        </AuthProvider>,
      );
    });

    // Estado do PRIMEIRO render, síncrono, ANTES de qualquer RPC ter
    // chance de responder: mesmo com o cache adulterado dizendo "admin",
    // isto não pode ter promovido ninguém ainda. Anotado 4 (revisão
    // #121/#123): `.not.toBe("admin")` também passaria com `undefined` —
    // `.toBe("unknown")` prova a mesma coisa sem deixar essa porta aberta.
    expect(primeiroEstado(aoAtualizar)?.adminStatus).toBe("unknown");

    await act(async () => {
      await esperarMicrotarefas();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(ultimoEstado(aoAtualizar)?.adminStatus).toBe("not-admin");
    expect(ultimoEstado(aoAtualizar)?.isAdmin).toBe(false);
  });

  it("6. adminStatus fica 'unknown' até a fonte verificada responder, para um usuário sem cache de admin", async () => {
    const { supabase, AuthContext, AuthProvider } = await montarProvider();

    semearSessaoCache("user-sem-cache", {});
    // Sem `ikcous_is_admin_user-sem-cache` no localStorage — é isso que faz
    // "sem cache" aqui: o usuário está logado, mas nunca foi verificado.

    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      data: {
        session: {
          user: { id: "user-sem-cache", app_metadata: {} },
          access_token: "tok-user-sem-cache",
        },
      },
      error: null,
    });
    (
      supabase.auth.getUser as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      data: { user: { id: "user-sem-cache", app_metadata: {} } },
      error: null,
    });
    (
      supabase.auth.onAuthStateChange as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    const filaIsAdmin = configurarRpcControlada(supabase);
    const aoAtualizar = vi.fn();

    await act(async () => {
      raiz.render(
        <AuthProvider>
          <Sonda authContext={AuthContext} aoAtualizar={aoAtualizar} />
        </AuthProvider>,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    // A RPC já foi disparada (está na fila), mas ainda não respondeu — o
    // estado tem que ser "unknown", nunca "not-admin" por omissão.
    expect(filaIsAdmin.length).toBeGreaterThan(0);
    expect(ultimoEstado(aoAtualizar)?.adminStatus).toBe("unknown");
    expect(ultimoEstado(aoAtualizar)?.isAdmin).toBe(false);

    filaIsAdmin[0].resolve({ data: true, error: null });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(ultimoEstado(aoAtualizar)?.adminStatus).toBe("admin");
  });

  it("7. localStorage[cacheKey] === 'false' resolve 'not-admin' de imediato, sem esperar a rede", async () => {
    const { supabase, AuthContext, AuthProvider } = await montarProvider();

    semearSessaoCache("user-cache-false", {});
    localStorage.setItem("ikcous_is_admin_user-cache-false", "false");

    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      data: {
        session: {
          user: { id: "user-cache-false", app_metadata: {} },
          access_token: "tok-user-cache-false",
        },
      },
      error: null,
    });
    (
      supabase.auth.getUser as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      data: { user: { id: "user-cache-false", app_metadata: {} } },
      error: null,
    });
    (
      supabase.auth.onAuthStateChange as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    // A RPC NUNCA resolve nesta prova — se o código precisasse dela para
    // sair de "unknown", o teste travaria em "unknown" para sempre.
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (name: string) => {
        if (name === "is_admin") return new Promise(() => {});
        return Promise.resolve({ data: null, error: null });
      },
    );

    const aoAtualizar = vi.fn();

    await act(async () => {
      raiz.render(
        <AuthProvider>
          <Sonda authContext={AuthContext} aoAtualizar={aoAtualizar} />
        </AuthProvider>,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(ultimoEstado(aoAtualizar)?.adminStatus).toBe("not-admin");
    expect(ultimoEstado(aoAtualizar)?.isAdmin).toBe(false);
  });

  // ---------------------------------------------------------------------
  // Anotado 3 (revisão #121/#123) — o `finally` de `networkCheck` comparava
  // `checkInFlight?.userId === userId`, que não distingue DUAS checagens do
  // MESMO usuário. Na sequência A → B → A dentro da mesma janela, a
  // checagem ORIGINAL de A (órfã, já substituída no slot por B e depois
  // pela segunda checagem de A) liquida por último e, comparando só o
  // `userId`, vê "A" == "A" e limpa o slot da SEGUNDA checagem de A — que
  // ainda está em voo. Consequência: a próxima checagem de A não encontra
  // nada para reaproveitar e dispara uma RPC redundante.
  // ---------------------------------------------------------------------

  it("8. a checagem ORIGINAL de A liquidando por último não apaga o slot da SEGUNDA checagem de A, ainda em voo", async () => {
    const { supabase, callback, filaIsAdmin } = await montarSemSessaoInicial();
    const cb = callback();

    // 1) A entra — dispara a checagem 1 (RPC #0), dona do slot.
    await act(async () => {
      cb("SIGNED_IN", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });
    // 2) B entra — dispara a checagem de B (RPC #1); o slot passa a ser de B.
    await act(async () => {
      cb("SIGNED_IN", sessaoDe("user-b"));
      await esperarMicrotarefas();
    });
    // 3) A entra de novo — como o slot é de B (userId diferente), esta é
    // uma checagem NOVA para A (RPC #2, a "checagem 2"), que passa a ser a
    // dona do slot.
    await act(async () => {
      cb("SIGNED_IN", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });
    expect(filaIsAdmin.length).toBe(3);

    // A checagem 1 (órfã, RPC #0) finalmente resolve. Com o bug (compara
    // por `userId`), o `finally` dela veria o slot atual (dono: "user-a",
    // da checagem 2) e o limparia por engano, mesmo pertencendo à checagem
    // 2, não à 1.
    filaIsAdmin[0].resolve({ data: false, error: null });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // 4) A entra uma TERCEIRA vez, com a checagem 2 (RPC #2) ainda em voo
    // (nunca resolvida). Se o slot da checagem 2 sobreviveu (comparação por
    // identidade da promise), esta chamada REAPROVEITA a checagem 2 — nenhuma
    // RPC nova. Com o bug, o slot já tinha sido apagado no passo anterior, e
    // esta chamada dispara uma quarta RPC redundante.
    await act(async () => {
      cb("SIGNED_IN", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });

    expect(contarChamadasIsAdmin(supabase)).toBe(3);
  });
});
