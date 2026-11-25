import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarBuildIdentity } from "./fixtures/build-identity";

/**
 * `src/sw/sw.ts` — fronteiras do aviso no celular que nenhum teste vizinho
 * segurava (caça por mutação, 25/11/2026). Cada caso nasceu de um defeito de
 * uma linha plantado de propósito que continuava passando:
 *
 *  - TOQUE no aviso do painel (`/admin-orders?id=X`): a espera pela resposta do
 *    app é de EXATAMENTE 1500 ms (um a menos e a lojista perde o texto digitado
 *    por um app lento; um a mais e a janela fica parada); o canal de aviso é
 *    sempre fechado e solto; sem `MessageChannel` o SW navega; janela que não
 *    tem `focus` (aba de outro tipo) nunca é escolhida; janela sem `navigate`
 *    abre uma nova no destino; `navigate` que devolve OUTRA janela dá o foco a
 *    ela; `focus` que rejeita não derruba o aviso do app.
 *  - AVISO atrasado de pedido: quando o aviso mais novo já está na bandeja, o
 *    regravado usa o ÍCONE e o ÍCONE PEQUENO do mais novo (só cai nos de agora
 *    quando ele não tem), e `data.url` do painel vence o `url` do topo.
 */

const HOST = "loja.example";
const ORIGEM = `https://${HOST}`;

type Listener = (event: unknown) => void;

type Janela = {
  url: string;
  focus?: ReturnType<typeof vi.fn>;
  navigate?: ReturnType<typeof vi.fn>;
  postMessage?: ReturnType<typeof vi.fn>;
};

/** Janela da loja: `focus` existe sempre que não se pedir o contrário. */
function janela(url: string, extras: Partial<Janela> = {}): Janela {
  return { url, focus: vi.fn().mockResolvedValue(undefined), ...extras };
}

/** Canal de mensagem falso: o que se manda por `port2` chega em `port1.onmessage`. */
function instalarCanalFalso() {
  const criados: {
    port1: {
      onmessage: ((e: unknown) => void) | null;
      close: ReturnType<typeof vi.fn>;
    };
    port2: { postMessage: ReturnType<typeof vi.fn> };
  }[] = [];
  class CanalFalso {
    port1: (typeof criados)[number]["port1"];
    port2: (typeof criados)[number]["port2"];
    constructor() {
      const port1 = {
        onmessage: null as ((e: unknown) => void) | null,
        close: vi.fn(),
      };
      const port2 = {
        postMessage: vi.fn((dado: unknown) =>
          port1.onmessage?.({ data: dado }),
        ),
      };
      this.port1 = port1;
      this.port2 = port2;
      criados.push({ port1, port2 });
    }
  }
  vi.stubGlobal("MessageChannel", CanalFalso);
  return criados;
}

async function importarSw(
  janelas: Janela[],
  registration: Record<string, unknown> = { showNotification: vi.fn() },
) {
  const listeners = new Map<string, Listener>();
  const openWindow = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("__STORE_IDENTITY__", criarBuildIdentity("Aurora", "aurora"));
  vi.stubGlobal("self", {
    location: { origin: ORIGEM, hostname: HOST },
    __WB_MANIFEST: [],
    registration,
    clients: { matchAll: vi.fn().mockResolvedValue(janelas), openWindow },
    addEventListener: (tipo: string, listener: Listener) =>
      listeners.set(tipo, listener),
  });
  vi.stubGlobal("caches", {});
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      close() {}
    },
  );
  await import("@/sw/sw");
  return { listeners, openWindow };
}

function tocar(
  listeners: Map<string, Listener>,
  dados: Record<string, unknown> | undefined,
): Promise<unknown> {
  const clique = listeners.get("notificationclick");
  expect(clique).toBeTypeOf("function");
  const waitUntil = vi.fn();
  const close = vi.fn();
  clique!({ notification: { close, data: dados }, waitUntil });
  expect(close).toHaveBeenCalledOnce();
  return waitUntil.mock.calls[0][0] as Promise<unknown>;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("toque no aviso do painel — a espera pela resposta do app", () => {
  const ALVO = "/admin-orders?id=B";

  function painelMudo() {
    const navegarPara = vi.fn();
    const j = janela(`${ORIGEM}/admin-orders?id=A`, {
      navigate: navegarPara,
      postMessage: vi.fn(),
    });
    navegarPara.mockResolvedValue(j);
    return { j, navegarPara };
  }

  it("app mudo: NÃO navega com 1499 ms de espera e navega quando completam 1500 ms", async () => {
    vi.useFakeTimers();
    instalarCanalFalso();
    const { j, navegarPara } = painelMudo();
    const { listeners } = await importarSw([j]);

    const feito = tocar(listeners, { url: ALVO });
    await vi.advanceTimersByTimeAsync(1499);
    expect(navegarPara).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await feito;
    expect(navegarPara).toHaveBeenCalledExactlyOnceWith(`${ORIGEM}${ALVO}`);
  });
});

describe("toque no aviso do painel — o canal com o app é sempre limpo", () => {
  const ALVO = "/admin-orders?id=B";

  it("app que RESPONDE: o canal é fechado, o ouvinte solto e a espera cancelada (nada fica pendente)", async () => {
    vi.useFakeTimers();
    const canais = instalarCanalFalso();
    const navegarPara = vi.fn();
    const j = janela(`${ORIGEM}/admin-orders?id=A`, {
      navigate: navegarPara,
      postMessage: vi.fn(
        (_msg: unknown, portas: { postMessage: (d: unknown) => void }[]) =>
          portas[0].postMessage({ ok: true }),
      ),
    });
    const { listeners } = await importarSw([j]);
    const pendentesAntes = vi.getTimerCount();

    await tocar(listeners, { url: ALVO });

    expect(canais).toHaveLength(1);
    expect(canais[0].port1.close).toHaveBeenCalledOnce();
    expect(canais[0].port1.onmessage).toBeNull();
    expect(vi.getTimerCount()).toBe(pendentesAntes);
    expect(navegarPara).not.toHaveBeenCalled();
  });

  it("app MUDO: passado o prazo o canal também é fechado e solto, e a janela navega", async () => {
    vi.useFakeTimers();
    const canais = instalarCanalFalso();
    const navegarPara = vi.fn();
    const j = janela(`${ORIGEM}/admin-orders?id=A`, {
      navigate: navegarPara,
      postMessage: vi.fn(),
    });
    navegarPara.mockResolvedValue(j);
    const { listeners } = await importarSw([j]);

    const feito = tocar(listeners, { url: ALVO });
    await vi.advanceTimersByTimeAsync(5_000);
    await feito;

    expect(canais[0].port1.close).toHaveBeenCalledOnce();
    expect(canais[0].port1.onmessage).toBeNull();
    expect(navegarPara).toHaveBeenCalledExactlyOnceWith(`${ORIGEM}${ALVO}`);
  });

  it("sem como criar o canal (MessageChannel lança): não espera o app e navega até o pedido", async () => {
    vi.stubGlobal(
      "MessageChannel",
      class {
        constructor() {
          throw new Error("sem canal neste aparelho");
        }
      },
    );
    const navegarPara = vi.fn();
    const postMessage = vi.fn();
    const j = janela(`${ORIGEM}/admin-orders?id=A`, {
      navigate: navegarPara,
      postMessage,
    });
    navegarPara.mockResolvedValue(j);
    const { listeners } = await importarSw([j]);

    await tocar(listeners, { url: ALVO });

    expect(postMessage).not.toHaveBeenCalled();
    expect(navegarPara).toHaveBeenCalledExactlyOnceWith(`${ORIGEM}${ALVO}`);
  });

  it("o foco da janela REJEITA (janela morrendo): o app ainda é avisado e, respondendo, nada navega", async () => {
    instalarCanalFalso();
    const navegarPara = vi.fn();
    const postMessage = vi.fn(
      (_msg: unknown, portas: { postMessage: (d: unknown) => void }[]) =>
        portas[0].postMessage({ ok: true }),
    );
    const j = janela(`${ORIGEM}/admin-orders?id=A`, {
      navigate: navegarPara,
      postMessage,
      focus: vi.fn().mockRejectedValue(new Error("sem foco")),
    });
    const { listeners } = await importarSw([j]);

    await expect(tocar(listeners, { url: ALVO })).resolves.toBeUndefined();

    expect(postMessage).toHaveBeenCalledOnce();
    expect(navegarPara).not.toHaveBeenCalled();
  });
});

describe("toque no aviso — qual janela é escolhida e o que acontece ao navegar", () => {
  const ALVO = "/order-details?id=A";

  it("janela SEM `focus` (aba de outro tipo) é ignorada: a que tem `focus` ganha o foco", async () => {
    const semFoco = { url: `${ORIGEM}/order-details?id=A` } as Janela;
    const comFoco = janela(`${ORIGEM}/order-details?id=A`);
    const { listeners, openWindow } = await importarSw([semFoco, comFoco]);

    await expect(tocar(listeners, { url: ALVO })).resolves.toBeUndefined();

    expect(comFoco.focus).toHaveBeenCalledOnce();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("só existem janelas SEM `focus`: abre uma janela nova no pedido, sem quebrar", async () => {
    const semFoco = { url: `${ORIGEM}/order-details?id=A` } as Janela;
    const { listeners, openWindow } = await importarSw([semFoco]);

    await tocar(listeners, { url: ALVO });

    expect(openWindow).toHaveBeenCalledExactlyOnceWith(`${ORIGEM}${ALVO}`);
  });

  it("janela em OUTRO pedido que não tem `navigate`: abre janela nova no destino e não a foca", async () => {
    const velha = janela(`${ORIGEM}/order-details?id=B`);
    const { listeners, openWindow } = await importarSw([velha]);

    await tocar(listeners, { url: ALVO });

    expect(openWindow).toHaveBeenCalledExactlyOnceWith(`${ORIGEM}${ALVO}`);
    expect(velha.focus).not.toHaveBeenCalled();
  });

  it("`navigate` devolve OUTRA janela (a navegada): o foco vai para ela, não para a antiga", async () => {
    const navegada = janela(`${ORIGEM}/order-details?id=A`);
    const antiga = janela(`${ORIGEM}/order-details?id=B`, {
      navigate: vi.fn().mockResolvedValue(navegada),
    });
    const { listeners } = await importarSw([antiga]);

    await tocar(listeners, { url: ALVO });

    expect(navegada.focus).toHaveBeenCalledOnce();
    expect(antiga.focus).not.toHaveBeenCalled();
  });

  it("`navigate` devolve nada (null): o foco vai para a própria janela", async () => {
    const antiga = janela(`${ORIGEM}/order-details?id=B`, {
      navigate: vi.fn().mockResolvedValue(null),
    });
    const { listeners } = await importarSw([antiga]);

    await tocar(listeners, { url: ALVO });

    expect(antiga.focus).toHaveBeenCalledOnce();
  });
});

describe("aviso de pedido — o mais novo da bandeja manda no ícone, e data.url manda no destino", () => {
  type Mostrado = {
    title: string;
    body?: string;
    icon?: string;
    badge?: string;
    tag?: string;
    data?: Record<string, unknown>;
  };

  async function importarComBandeja(naBandeja: Mostrado[]) {
    const showNotification = vi.fn(async () => {});
    const getNotifications = vi.fn(async () => naBandeja);
    const { listeners } = await importarSw([], {
      showNotification,
      getNotifications,
    });
    const receber = async (payload: unknown) => {
      const push = listeners.get("push");
      expect(push).toBeTypeOf("function");
      const waitUntil = vi.fn();
      push!({ data: { json: () => payload }, waitUntil });
      await waitUntil.mock.calls[0][0];
    };
    const ultimo = () => {
      const chamadas = showNotification.mock.calls as unknown as [
        string,
        Mostrado,
      ][];
      return chamadas[chamadas.length - 1];
    };
    return { receber, showNotification, ultimo };
  }

  const status = (emitidoEm?: number) => ({
    title: "A caminho",
    body: "Seu pedido saiu",
    url: "/order-details?id=p1",
    data: { orderId: "p1", ...(emitidoEm === undefined ? {} : { emitidoEm }) },
  });

  it("o aviso mais novo tem ícone e ícone pequeno próprios: o regravado usa ELES", async () => {
    const { receber, ultimo } = await importarComBandeja([
      {
        title: "Entregue",
        body: "Chegou",
        icon: "/icones/do-mais-novo.png",
        badge: "/icones/pequeno-do-mais-novo.png",
        tag: "pedido-p1",
        data: { orderId: "p1", emitidoEm: 2000 },
      },
    ]);

    await receber(status(1000));

    const [titulo, opcoes] = ultimo();
    expect(titulo).toBe("Entregue");
    expect(opcoes.icon).toBe("/icones/do-mais-novo.png");
    expect(opcoes.badge).toBe("/icones/pequeno-do-mais-novo.png");
  });

  it("o aviso mais novo SEM ícone próprio: o regravado fica com o ícone de agora (nunca vazio)", async () => {
    const { receber, ultimo } = await importarComBandeja([
      {
        title: "Entregue",
        body: "Chegou",
        tag: "pedido-p1",
        data: { orderId: "p1", emitidoEm: 2000 },
      },
    ]);
    // Um aviso sem carimbo mostra os ícones de agora: é o que o regravado deve herdar.
    await receber({ title: "Oi", data: { orderId: "p1" } });
    const [, deAgora] = ultimo();
    expect(deAgora.icon).toBeTruthy();
    expect(deAgora.badge).toBeTruthy();

    await receber(status(1000));

    const [titulo, opcoes] = ultimo();
    expect(titulo).toBe("Entregue");
    expect(opcoes.icon).toBe(deAgora.icon);
    expect(opcoes.badge).toBe(deAgora.badge);
  });

  it("`data.url` do aviso vence o `url` do topo; sem `data.url`, vale o do topo", async () => {
    const { receber, ultimo } = await importarComBandeja([]);

    await receber({
      title: "Pedido novo",
      url: "/do-topo",
      data: { url: "/admin-orders?id=B" },
    });
    expect(ultimo()[1].data?.url).toBe("/admin-orders?id=B");

    await receber({ title: "Pedido novo", url: "/do-topo", data: { x: 1 } });
    expect(ultimo()[1].data?.url).toBe("/do-topo");
  });
});
