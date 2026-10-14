// @vitest-environment jsdom
//
// A inscrição de notificação push morava no APARELHO, não na conta: quem saía
// deixava a inscrição para trás (gravada com o `user_id` dele), e o próximo a
// entrar no mesmo navegador herdava o aparelho sem ter inscrição própria. O
// push dirigido à conta que saiu (inclusive o conteúdo do pedido dela) caía no
// celular de quem estava logado agora.
//
// Este arquivo trava o módulo que cuida disso: cancelar a inscrição DESTE
// aparelho para a conta que sai (servidor e navegador), com prazo curto, sem
// nunca lançar; e descobrir de quem é a inscrição que o navegador tem.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const eqUser = vi.fn();
const eqEndpoint = vi.fn();
const apagar = vi.fn();
const selecionar = vi.fn();
const getSession = vi.fn();
const desde = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: (...args: unknown[]) => getSession(...args) },
    from: (tabela: string) => desde(tabela),
  },
}));

const ENDPOINT = "https://push.exemplo/aparelho-1";

function instalarPush({
  inscricao,
  registro = "com-registro",
}: {
  inscricao: { endpoint: string; unsubscribe: () => Promise<boolean> } | null;
  registro?: "com-registro" | "sem-registro" | "lanca";
}) {
  const getRegistration = vi.fn(async () => {
    if (registro === "lanca") throw new Error("SW indisponível");
    if (registro === "sem-registro") return undefined;
    return { pushManager: { getSubscription: async () => inscricao } };
  });
  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    value: { getRegistration },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "PushManager", {
    value: class {},
    configurable: true,
    writable: true,
  });
  return getRegistration;
}

function instalarSemPush() {
  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

/** Monta o encadeamento `.from("push_subscriptions").delete().eq().eq()`. */
function prepararApagar(resultado: () => Promise<{ error: unknown }>) {
  eqUser.mockImplementation(() => resultado());
  eqEndpoint.mockImplementation(() => ({ eq: eqUser }));
  apagar.mockImplementation(() => ({ eq: eqEndpoint }));
  desde.mockImplementation((tabela: string) => {
    if (tabela !== "push_subscriptions") throw new Error(`tabela ${tabela}`);
    return { delete: apagar, select: selecionar };
  });
}

describe("inscrição de push — cancelar a do aparelho para a conta que sai", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("apaga a linha DA CONTA no servidor e desinscreve o navegador", async () => {
    const { cancelarInscricaoDaConta } = await import(
      "@/lib/inscricao-de-push-da-conta"
    );
    const unsubscribe = vi.fn(async () => true);
    instalarPush({ inscricao: { endpoint: ENDPOINT, unsubscribe } });
    prepararApagar(async () => ({ error: null }));

    await cancelarInscricaoDaConta("conta-a");

    expect(eqEndpoint).toHaveBeenCalledWith("endpoint", ENDPOINT);
    // O filtro por dono impede que um admin (a RLS deixa) apague a linha de
    // OUTRA conta que por acaso tenha o mesmo endpoint.
    expect(eqUser).toHaveBeenCalledWith("user_id", "conta-a");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("o servidor devolver erro NÃO impede desinscrever o navegador, e nada lança", async () => {
    const { cancelarInscricaoDaConta } = await import(
      "@/lib/inscricao-de-push-da-conta"
    );
    const unsubscribe = vi.fn(async () => true);
    instalarPush({ inscricao: { endpoint: ENDPOINT, unsubscribe } });
    prepararApagar(async () => ({ error: { message: "rede caiu" } }));

    await expect(cancelarInscricaoDaConta("conta-a")).resolves.toBeUndefined();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("o servidor LANÇAR também não impede nada", async () => {
    const { cancelarInscricaoDaConta } = await import(
      "@/lib/inscricao-de-push-da-conta"
    );
    const unsubscribe = vi.fn(async () => true);
    instalarPush({ inscricao: { endpoint: ENDPOINT, unsubscribe } });
    prepararApagar(async () => {
      throw new Error("Failed to fetch");
    });

    await expect(cancelarInscricaoDaConta("conta-a")).resolves.toBeUndefined();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("servidor pendurado: volta no prazo (3 s) e o navegador já foi desinscrito", async () => {
    vi.useFakeTimers();
    const { cancelarInscricaoDaConta, PRAZO_DO_PUSH_NO_LOGOUT_MS } =
      await import("@/lib/inscricao-de-push-da-conta");
    const unsubscribe = vi.fn(async () => true);
    instalarPush({ inscricao: { endpoint: ENDPOINT, unsubscribe } });
    prepararApagar(() => new Promise(() => {})); // nunca responde

    expect(PRAZO_DO_PUSH_NO_LOGOUT_MS).toBeLessThanOrEqual(3000);

    let terminou = false;
    const espera = cancelarInscricaoDaConta("conta-a").then(() => {
      terminou = true;
    });

    await vi.advanceTimersByTimeAsync(PRAZO_DO_PUSH_NO_LOGOUT_MS - 1);
    expect(terminou).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await espera;

    expect(terminou).toBe(true);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("o navegador não responder (getRegistration pendurado) também volta no prazo", async () => {
    vi.useFakeTimers();
    const { cancelarInscricaoDaConta, PRAZO_DO_PUSH_NO_LOGOUT_MS } =
      await import("@/lib/inscricao-de-push-da-conta");
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      value: { getRegistration: () => new Promise(() => {}) },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "PushManager", {
      value: class {},
      configurable: true,
      writable: true,
    });

    const espera = cancelarInscricaoDaConta("conta-a");
    await vi.advanceTimersByTimeAsync(PRAZO_DO_PUSH_NO_LOGOUT_MS + 1);

    await expect(espera).resolves.toBeUndefined();
  });

  it("sem service worker/Push (iOS fora do app instalado, navegador antigo): nada lança e nada é tocado", async () => {
    const { cancelarInscricaoDaConta, soltarInscricaoDoAparelho } =
      await import("@/lib/inscricao-de-push-da-conta");
    instalarSemPush();

    await expect(cancelarInscricaoDaConta("conta-a")).resolves.toBeUndefined();
    await expect(soltarInscricaoDoAparelho()).resolves.toBeUndefined();

    expect(desde).not.toHaveBeenCalled();
  });

  it("sem registro de service worker: volta na hora, sem esperar o prazo e sem tocar o servidor", async () => {
    const { cancelarInscricaoDaConta } = await import(
      "@/lib/inscricao-de-push-da-conta"
    );
    instalarPush({ inscricao: null, registro: "sem-registro" });

    await cancelarInscricaoDaConta("conta-a");

    expect(desde).not.toHaveBeenCalled();
  });

  it("navegador sem inscrição nenhuma: não toca o servidor", async () => {
    const { cancelarInscricaoDaConta } = await import(
      "@/lib/inscricao-de-push-da-conta"
    );
    instalarPush({ inscricao: null });

    await cancelarInscricaoDaConta("conta-a");

    expect(desde).not.toHaveBeenCalled();
  });

  it("getRegistration lançando não derruba ninguém", async () => {
    const { cancelarInscricaoDaConta, soltarInscricaoDoAparelho } =
      await import("@/lib/inscricao-de-push-da-conta");
    instalarPush({ inscricao: null, registro: "lanca" });

    await expect(cancelarInscricaoDaConta("conta-a")).resolves.toBeUndefined();
    await expect(soltarInscricaoDoAparelho()).resolves.toBeUndefined();
  });

  it("unsubscribe do navegador lançando não derruba o cancelamento", async () => {
    const { cancelarInscricaoDaConta } = await import(
      "@/lib/inscricao-de-push-da-conta"
    );
    const unsubscribe = vi.fn(async () => {
      throw new Error("falhou");
    });
    instalarPush({ inscricao: { endpoint: ENDPOINT, unsubscribe } });
    prepararApagar(async () => ({ error: null }));

    await expect(cancelarInscricaoDaConta("conta-a")).resolves.toBeUndefined();

    expect(apagar).toHaveBeenCalled();
  });

  it("soltarInscricaoDoAparelho só desinscreve o navegador: nunca fala com o servidor (sem sessão não há como)", async () => {
    const { soltarInscricaoDoAparelho } = await import(
      "@/lib/inscricao-de-push-da-conta"
    );
    const unsubscribe = vi.fn(async () => true);
    instalarPush({ inscricao: { endpoint: ENDPOINT, unsubscribe } });

    await soltarInscricaoDoAparelho();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(desde).not.toHaveBeenCalled();
  });
});

describe("inscrição de push — de quem é a inscrição que o navegador tem", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  function prepararSelecao(resultado: () => Promise<unknown>) {
    const eq = vi.fn(() => resultado());
    selecionar.mockImplementation(() => ({ eq }));
    desde.mockImplementation(() => ({ select: selecionar }));
    return eq;
  }

  function sessaoDe(id: string | null) {
    getSession.mockResolvedValue({
      data: { session: id ? { user: { id } } : null },
      error: null,
    });
  }

  it("a linha é da conta atual: 'esta-conta'", async () => {
    const { dequemEAInscricao } = await import(
      "@/lib/inscricao-de-push-da-conta"
    );
    sessaoDe("conta-b");
    const eq = prepararSelecao(async () => ({
      data: [{ user_id: "conta-b" }],
      error: null,
    }));

    expect(await dequemEAInscricao(ENDPOINT, "conta-b")).toBe("esta-conta");
    expect(eq).toHaveBeenCalledWith("endpoint", ENDPOINT);
  });

  it("nenhuma linha visível (a RLS esconde a de outra conta, ou ela nem existe): 'outra-conta'", async () => {
    const { dequemEAInscricao } = await import(
      "@/lib/inscricao-de-push-da-conta"
    );
    sessaoDe("conta-b");
    prepararSelecao(async () => ({ data: [], error: null }));

    expect(await dequemEAInscricao(ENDPOINT, "conta-b")).toBe("outra-conta");
  });

  it("visível, mas de outra conta (admin enxerga tudo): 'outra-conta'", async () => {
    const { dequemEAInscricao } = await import(
      "@/lib/inscricao-de-push-da-conta"
    );
    sessaoDe("admin-1");
    prepararSelecao(async () => ({
      data: [{ user_id: "conta-a" }],
      error: null,
    }));

    expect(await dequemEAInscricao(ENDPOINT, "admin-1")).toBe("outra-conta");
  });

  it("erro na consulta: 'desconhecido' (desconhecido não autoriza destruir)", async () => {
    const { dequemEAInscricao } = await import(
      "@/lib/inscricao-de-push-da-conta"
    );
    sessaoDe("conta-b");
    prepararSelecao(async () => ({ data: null, error: { message: "rede" } }));

    expect(await dequemEAInscricao(ENDPOINT, "conta-b")).toBe("desconhecido");
  });

  it("consulta lançando: 'desconhecido'", async () => {
    const { dequemEAInscricao } = await import(
      "@/lib/inscricao-de-push-da-conta"
    );
    sessaoDe("conta-b");
    prepararSelecao(async () => {
      throw new Error("Failed to fetch");
    });

    expect(await dequemEAInscricao(ENDPOINT, "conta-b")).toBe("desconhecido");
  });

  it("o cliente do Supabase NÃO tem sessão desta conta (consulta iria como anônima e voltaria vazia): 'desconhecido', sem consultar", async () => {
    const { dequemEAInscricao } = await import(
      "@/lib/inscricao-de-push-da-conta"
    );
    sessaoDe(null);
    prepararSelecao(async () => ({ data: [], error: null }));

    expect(await dequemEAInscricao(ENDPOINT, "conta-b")).toBe("desconhecido");
    expect(desde).not.toHaveBeenCalled();
  });

  it("a sessão do cliente é de OUTRA conta que a pedida: 'desconhecido'", async () => {
    const { dequemEAInscricao } = await import(
      "@/lib/inscricao-de-push-da-conta"
    );
    sessaoDe("conta-c");
    prepararSelecao(async () => ({ data: [], error: null }));

    expect(await dequemEAInscricao(ENDPOINT, "conta-b")).toBe("desconhecido");
  });
});
