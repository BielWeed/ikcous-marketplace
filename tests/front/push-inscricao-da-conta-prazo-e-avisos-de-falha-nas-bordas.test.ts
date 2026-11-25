// @vitest-environment jsdom
//
// Bordas do "Sair" com push (`inscricao-de-push-da-conta.ts`) que o teste
// vizinho (`push-inscricao-segue-a-conta-lib.test.ts`) deixa sem prova:
//  - o prazo é de 3 s EXATOS (2999 ms ainda espera; o parâmetro `prazoMs` vale);
//  - a espera termina na hora quando o trabalho termina (não segura o Sair até
//    o prazo) e não deixa relógio pendurado;
//  - aparelho com service worker mas SEM Push (Safari fora do app instalado) não
//    é tocado: nem registro, nem bandeja, nem servidor;
//  - cada falha é AVISADA no console (e só ela): sem falha, silêncio; com falha
//    do servidor, do navegador ou da bandeja, uma linha identificando qual;
//  - consulta de dono que volta com erro não vale como resposta, mesmo que
//    traga linhas.
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

type Inscricao = { endpoint: string; unsubscribe: () => Promise<boolean> };

function instalarPush({
  inscricao,
  registro = "com-registro",
  getNotifications,
}: {
  inscricao: Inscricao | null;
  registro?: "com-registro" | "sem-registro";
  getNotifications?: () => Promise<unknown>;
}) {
  const getRegistration = vi.fn(async () => {
    if (registro === "sem-registro") return undefined;
    return {
      pushManager: { getSubscription: async () => inscricao },
      ...(getNotifications ? { getNotifications } : {}),
    };
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

function instalarComServiceWorkerMasSemPush() {
  const getRegistration = vi.fn(async () => ({
    pushManager: { getSubscription: async () => null },
    getNotifications: async () => [],
  }));
  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    value: { getRegistration },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "PushManager", {
    value: undefined,
    configurable: true,
    writable: true,
  });
  return getRegistration;
}

function prepararApagar(resultado: () => Promise<{ error: unknown }>) {
  eqUser.mockImplementation(() => resultado());
  eqEndpoint.mockImplementation(() => ({ eq: eqUser }));
  apagar.mockImplementation(() => ({ eq: eqEndpoint }));
  desde.mockImplementation((tabela: string) => {
    if (tabela !== "push_subscriptions") throw new Error(`tabela ${tabela}`);
    return { delete: apagar, select: selecionar };
  });
}

let aviso: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function modulo() {
  return await import("@/lib/inscricao-de-push-da-conta");
}

describe("Sair com push — o prazo", () => {
  it("o prazo é de 3 s: aos 2999 ms ainda espera o servidor, aos 3000 ms volta", async () => {
    vi.useFakeTimers();
    const { cancelarInscricaoDaConta } = await modulo();
    instalarPush({
      inscricao: { endpoint: ENDPOINT, unsubscribe: async () => true },
    });
    prepararApagar(() => new Promise(() => {}));

    let terminou = false;
    const espera = cancelarInscricaoDaConta("conta-a").then(() => {
      terminou = true;
    });

    await vi.advanceTimersByTimeAsync(2999);
    expect(terminou).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await espera;
    expect(terminou).toBe(true);
  });

  it("o prazo passado por quem chama vale no lugar do padrão", async () => {
    vi.useFakeTimers();
    const { cancelarInscricaoDaConta } = await modulo();
    instalarPush({
      inscricao: { endpoint: ENDPOINT, unsubscribe: async () => true },
    });
    prepararApagar(() => new Promise(() => {}));

    let terminou = false;
    const espera = cancelarInscricaoDaConta("conta-a", 500).then(() => {
      terminou = true;
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(terminou).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await espera;
    expect(terminou).toBe(true);
  });

  it("trabalho que termina rápido: volta NA HORA e não deixa relógio pendurado", async () => {
    vi.useFakeTimers();
    const { cancelarInscricaoDaConta } = await modulo();
    instalarPush({
      inscricao: { endpoint: ENDPOINT, unsubscribe: async () => true },
    });
    prepararApagar(async () => ({ error: null }));

    let terminou = false;
    void cancelarInscricaoDaConta("conta-a").then(() => {
      terminou = true;
    });
    // Nenhum relógio andou: só as promessas.
    await vi.advanceTimersByTimeAsync(0);

    expect(terminou).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    [
      "sem registro de service worker",
      { inscricao: null, registro: "sem-registro" as const },
    ],
    ["sem inscrição no navegador", { inscricao: null }],
  ])("%s: volta na hora, sem esperar o prazo", async (_nome, cenario) => {
    vi.useFakeTimers();
    const { cancelarInscricaoDaConta } = await modulo();
    instalarPush(cenario);

    let terminou = false;
    void cancelarInscricaoDaConta("conta-a").then(() => {
      terminou = true;
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(terminou).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Sair com push — aparelho com service worker mas SEM Push", () => {
  it("cancelar e soltar não tocam registro, bandeja nem servidor", async () => {
    const { cancelarInscricaoDaConta, soltarInscricaoDoAparelho } =
      await modulo();
    const getRegistration = instalarComServiceWorkerMasSemPush();

    await cancelarInscricaoDaConta("conta-a");
    await soltarInscricaoDoAparelho();

    expect(getRegistration).not.toHaveBeenCalled();
    expect(desde).not.toHaveBeenCalled();
  });
});

describe("Sair com push — o que vai para o console", () => {
  it("tudo certo (servidor, navegador e bandeja): nenhum aviso", async () => {
    const { cancelarInscricaoDaConta, soltarInscricaoDoAparelho } =
      await modulo();
    const fechar = vi.fn();
    instalarPush({
      inscricao: { endpoint: ENDPOINT, unsubscribe: async () => true },
      getNotifications: async () => [{ close: fechar }],
    });
    prepararApagar(async () => ({ error: null }));

    await cancelarInscricaoDaConta("conta-a");
    await soltarInscricaoDoAparelho();

    expect(fechar).toHaveBeenCalledTimes(2);
    expect(aviso).not.toHaveBeenCalled();
  });

  it("navegador sem getNotifications (iOS): o resto roda e NADA é avisado como falha", async () => {
    const { cancelarInscricaoDaConta } = await modulo();
    const unsubscribe = vi.fn(async () => true);
    instalarPush({ inscricao: { endpoint: ENDPOINT, unsubscribe } });
    prepararApagar(async () => ({ error: null }));

    await cancelarInscricaoDaConta("conta-a");

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(aviso).not.toHaveBeenCalled();
  });

  it.each([
    [
      "sem registro de service worker",
      { inscricao: null, registro: "sem-registro" as const },
    ],
    [
      "com registro, mas sem inscrição",
      { inscricao: null, getNotifications: async () => [] },
    ],
  ])(
    "%s: cancelar e soltar não avisam falha nenhuma",
    async (_nome, cenario) => {
      const { cancelarInscricaoDaConta, soltarInscricaoDoAparelho } =
        await modulo();
      instalarPush(cenario);

      await cancelarInscricaoDaConta("conta-a");
      await soltarInscricaoDoAparelho();

      expect(aviso).not.toHaveBeenCalled();
    },
  );

  it("o servidor responde com erro: um aviso 'não foi possível apagar a inscrição' com o erro", async () => {
    const { cancelarInscricaoDaConta } = await modulo();
    instalarPush({
      inscricao: { endpoint: ENDPOINT, unsubscribe: async () => true },
    });
    const erro = { message: "rede caiu" };
    prepararApagar(async () => ({ error: erro }));

    await cancelarInscricaoDaConta("conta-a");

    expect(aviso).toHaveBeenCalledTimes(1);
    expect(aviso).toHaveBeenCalledWith(
      "[push] Não foi possível apagar a inscrição:",
      erro,
    );
  });

  it("o servidor LANÇA: o mesmo aviso, e o navegador é desinscrito mesmo assim", async () => {
    const { cancelarInscricaoDaConta } = await modulo();
    const unsubscribe = vi.fn(async () => true);
    instalarPush({ inscricao: { endpoint: ENDPOINT, unsubscribe } });
    const falha = new Error("Failed to fetch");
    prepararApagar(async () => {
      throw falha;
    });

    await cancelarInscricaoDaConta("conta-a");

    expect(aviso).toHaveBeenCalledTimes(1);
    expect(aviso).toHaveBeenCalledWith(
      "[push] Não foi possível apagar a inscrição:",
      falha,
    );
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("o navegador recusa desinscrever (promessa rejeitada): aviso próprio, sem rejeição solta", async () => {
    const { cancelarInscricaoDaConta, soltarInscricaoDoAparelho } =
      await modulo();
    const falha = new Error("recusou");
    instalarPush({
      inscricao: {
        endpoint: ENDPOINT,
        unsubscribe: () => Promise.reject(falha),
      },
    });
    prepararApagar(async () => ({ error: null }));

    await cancelarInscricaoDaConta("conta-a");
    await soltarInscricaoDoAparelho();

    expect(aviso).toHaveBeenCalledTimes(2);
    expect(aviso).toHaveBeenNthCalledWith(
      1,
      "[push] Não foi possível desinscrever o navegador:",
      falha,
    );
    expect(aviso).toHaveBeenNthCalledWith(
      2,
      "[push] Não foi possível desinscrever o navegador:",
      falha,
    );
  });

  it("a bandeja não abre (getNotifications rejeita): aviso próprio, e o resto do Sair roda", async () => {
    const { cancelarInscricaoDaConta } = await modulo();
    const falha = new Error("sem permissão");
    const unsubscribe = vi.fn(async () => true);
    instalarPush({
      inscricao: { endpoint: ENDPOINT, unsubscribe },
      getNotifications: () => Promise.reject(falha),
    });
    prepararApagar(async () => ({ error: null }));

    await cancelarInscricaoDaConta("conta-a");

    expect(aviso).toHaveBeenCalledTimes(1);
    expect(aviso).toHaveBeenCalledWith(
      "[push] Não foi possível fechar os avisos da bandeja:",
      falha,
    );
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(apagar).toHaveBeenCalledTimes(1);
  });

  it("um aviso da bandeja que não fecha NÃO vira aviso no console (é esperado) e os outros fecham", async () => {
    const { cancelarInscricaoDaConta } = await modulo();
    const fechaOk = vi.fn();
    instalarPush({
      inscricao: null,
      getNotifications: async () => [
        {
          close: () => {
            throw new Error("já dispensado");
          },
        },
        { close: fechaOk },
      ],
    });

    await cancelarInscricaoDaConta("conta-a");

    expect(fechaOk).toHaveBeenCalledTimes(1);
    expect(aviso).not.toHaveBeenCalled();
  });
});

describe("de quem é a inscrição — erro da consulta não vale como resposta", () => {
  it("consulta que volta com erro E com linhas: 'desconhecido'", async () => {
    const { dequemEAInscricao } = await modulo();
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    selecionar.mockImplementation(() => ({
      eq: async () => ({
        data: [{ user_id: "u1" }],
        error: { message: "parcial" },
      }),
    }));
    desde.mockImplementation(() => ({ select: selecionar }));

    await expect(dequemEAInscricao(ENDPOINT, "u1")).resolves.toBe(
      "desconhecido",
    );
  });
});
