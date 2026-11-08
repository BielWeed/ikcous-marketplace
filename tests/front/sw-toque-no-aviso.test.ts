import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarBuildIdentity } from "./fixtures/build-identity";

// Toque no aviso do celular: o Service Worker decide entre FOCAR a janela da
// loja, NAVEGÁ-LA até o pedido do aviso, ou ABRIR uma nova. A decisão pura
// mora em `src/lib/alvo-do-aviso.ts` (tabela em alvo-do-aviso.test.ts); aqui
// se prova que o `notificationclick` do `sw.ts` a obedece.
describe("toque no aviso (notificationclick)", () => {
  const HOST = "loja.example";
  const ORIGEM = `https://${HOST}`;

  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function janela(url: string, navegar?: ReturnType<typeof vi.fn>) {
    const j: Record<string, unknown> = {
      url,
      focus: vi.fn().mockResolvedValue(undefined),
    };
    if (navegar) j.navigate = navegar;
    return j as {
      url: string;
      focus: ReturnType<typeof vi.fn>;
      navigate?: ReturnType<typeof vi.fn>;
    };
  }

  async function importar(janelas: ReturnType<typeof janela>[]) {
    const listeners = new Map<string, (event: unknown) => void>();
    const openWindow = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("__STORE_IDENTITY__", criarBuildIdentity("Aurora", "aurora"));
    vi.stubGlobal("self", {
      location: { origin: ORIGEM, hostname: HOST },
      __WB_MANIFEST: [],
      registration: { showNotification: vi.fn() },
      clients: {
        matchAll: vi.fn().mockResolvedValue(janelas),
        openWindow,
      },
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        listeners.set(type, listener),
    });
    vi.stubGlobal("caches", { open: vi.fn(), match: vi.fn() });
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
      },
    );
    await import("@/sw/sw");
    const clique = listeners.get("notificationclick");
    expect(clique).toBeTypeOf("function");
    return { clique: clique!, openWindow };
  }

  async function tocar(
    clique: (event: unknown) => void,
    dados: Record<string, unknown> | undefined,
  ) {
    const waitUntil = vi.fn();
    const close = vi.fn();
    clique({ notification: { close, data: dados }, waitUntil });
    expect(close).toHaveBeenCalledOnce();
    await waitUntil.mock.calls[0][0];
  }

  it("aviso de pedido com a cliente em OUTRO pedido: a janela navega até o pedido do aviso e ganha foco", async () => {
    const alvo = "/order-details?id=A";
    const navegarPara = vi.fn();
    const aberta = janela(`${ORIGEM}/order-details?id=B`, navegarPara);
    navegarPara.mockResolvedValue(aberta);
    const { clique, openWindow } = await importar([aberta]);

    await tocar(clique, { url: alvo, orderId: "A", type: "order_status" });

    expect(navegarPara).toHaveBeenCalledExactlyOnceWith(`${ORIGEM}${alvo}`);
    expect(aberta.focus).toHaveBeenCalledOnce();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("aviso de pedido com a cliente JÁ nesse pedido: só foca, não recarrega", async () => {
    const navegarPara = vi.fn();
    const aberta = janela(`${ORIGEM}/order-details?id=A`, navegarPara);
    const { clique, openWindow } = await importar([aberta]);

    await tocar(clique, { url: "/order-details?id=A" });

    expect(aberta.focus).toHaveBeenCalledOnce();
    expect(navegarPara).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("aviso de pedido sem janela aberta: abre o pedido (não a vitrine)", async () => {
    const { clique, openWindow } = await importar([]);

    await tocar(clique, { url: "/order-details?id=A" });

    expect(openWindow).toHaveBeenCalledExactlyOnceWith(
      `${ORIGEM}/order-details?id=A`,
    );
  });

  it("janela que não aceita navegar (rejeita): abre o pedido em janela nova", async () => {
    const navegarPara = vi
      .fn()
      .mockRejectedValue(new TypeError("sem controle"));
    const aberta = janela(`${ORIGEM}/order-details?id=B`, navegarPara);
    const { clique, openWindow } = await importar([aberta]);

    await tocar(clique, { url: "/order-details?id=A" });

    expect(openWindow).toHaveBeenCalledExactlyOnceWith(
      `${ORIGEM}/order-details?id=A`,
    );
  });

  // Aviso "Pedido novo" do painel: a ficha aberta pode ter anotação ou código de
  // rastreio digitados e não salvos (só em estado local). `client.navigate` =
  // recarga completa = texto perdido. O SW foca a janela e AVISA o app; o app
  // responde (ack) por um canal e, sem resposta (app velho, aba travada), o SW
  // volta ao comportamento de antes: navegar.
  describe("aviso de pedido novo do painel (/admin-orders)", () => {
    const ALVO = "/admin-orders?id=B";
    const MENSAGEM = {
      tipo: "ikcous:abrir-pedido-do-aviso",
      pedidoId: "B",
    };

    // Janela cujo app responde (ou não) ao aviso, como o receptor real faz.
    function janelaDoPainel(
      url: string,
      app: "responde" | "mudo" | "sem-postmessage" | "postmessage-quebra",
    ) {
      const navegarPara = vi.fn();
      const j = janela(url, navegarPara) as ReturnType<typeof janela> & {
        postMessage?: ReturnType<typeof vi.fn>;
      };
      navegarPara.mockResolvedValue(j);
      if (app === "responde") {
        j.postMessage = vi.fn((_msg: unknown, portas: MessagePort[]) => {
          portas[0].postMessage({ ok: true });
        });
      } else if (app === "mudo") {
        j.postMessage = vi.fn();
      } else if (app === "postmessage-quebra") {
        j.postMessage = vi.fn(() => {
          throw new Error("janela fechada");
        });
      }
      return { j, navegarPara };
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it("app responde: a janela só ganha foco e o app é avisado — NÃO recarrega (o texto digitado fica)", async () => {
      const { j, navegarPara } = janelaDoPainel(
        `${ORIGEM}/admin-orders?id=A`,
        "responde",
      );
      const { clique, openWindow } = await importar([j]);

      await tocar(clique, { url: ALVO, orderId: "B" });

      expect(j.focus).toHaveBeenCalledOnce();
      expect(j.postMessage).toHaveBeenCalledExactlyOnceWith(MENSAGEM, [
        expect.anything(),
      ]);
      expect(navegarPara).not.toHaveBeenCalled();
      expect(openWindow).not.toHaveBeenCalled();
    });

    it("a lojista está na LISTA de pedidos: mesmo caminho, o app é avisado", async () => {
      const { j, navegarPara } = janelaDoPainel(
        `${ORIGEM}/admin-orders`,
        "responde",
      );
      const { clique } = await importar([j]);

      await tocar(clique, { url: ALVO });

      expect(j.postMessage).toHaveBeenCalledOnce();
      expect(navegarPara).not.toHaveBeenCalled();
    });

    it("app VELHO (não responde): depois de uma espera curta volta a navegar, como antes", async () => {
      vi.useFakeTimers();
      const { j, navegarPara } = janelaDoPainel(
        `${ORIGEM}/admin-orders?id=A`,
        "mudo",
      );
      const { clique, openWindow } = await importar([j]);

      const feito = tocar(clique, { url: ALVO });
      await vi.advanceTimersByTimeAsync(10_000);
      await feito;

      expect(j.postMessage).toHaveBeenCalledOnce();
      expect(navegarPara).toHaveBeenCalledExactlyOnceWith(`${ORIGEM}${ALVO}`);
      expect(openWindow).not.toHaveBeenCalled();
    });

    it("janela sem postMessage: navega direto, sem esperar", async () => {
      const { j, navegarPara } = janelaDoPainel(
        `${ORIGEM}/admin-orders?id=A`,
        "sem-postmessage",
      );
      const { clique } = await importar([j]);

      await tocar(clique, { url: ALVO });

      expect(navegarPara).toHaveBeenCalledExactlyOnceWith(`${ORIGEM}${ALVO}`);
    });

    it("postMessage que lança (janela morrendo): navega, nunca perde o aviso", async () => {
      const { j, navegarPara } = janelaDoPainel(
        `${ORIGEM}/admin-orders?id=A`,
        "postmessage-quebra",
      );
      const { clique } = await importar([j]);

      await tocar(clique, { url: ALVO });

      expect(navegarPara).toHaveBeenCalledExactlyOnceWith(`${ORIGEM}${ALVO}`);
    });

    it("já está na ficha do pedido do aviso: só foca, sem avisar o app nem navegar", async () => {
      const { j, navegarPara } = janelaDoPainel(
        `${ORIGEM}/admin-orders?id=B`,
        "responde",
      );
      const { clique } = await importar([j]);

      await tocar(clique, { url: ALVO });

      expect(j.focus).toHaveBeenCalledOnce();
      expect(j.postMessage).not.toHaveBeenCalled();
      expect(navegarPara).not.toHaveBeenCalled();
    });

    it("janela em OUTRA tela do painel (PDV): abre janela nova, sem mexer no PDV", async () => {
      const { j, navegarPara } = janelaDoPainel(
        `${ORIGEM}/admin-pdv`,
        "responde",
      );
      const { clique, openWindow } = await importar([j]);

      await tocar(clique, { url: ALVO });

      expect(openWindow).toHaveBeenCalledExactlyOnceWith(`${ORIGEM}${ALVO}`);
      expect(j.postMessage).not.toHaveBeenCalled();
      expect(navegarPara).not.toHaveBeenCalled();
    });
  });

  it("aviso SEM url (campanha comum) continua indo para '/': foca a janela da loja em /?source=pwa", async () => {
    const navegarPara = vi.fn();
    const aberta = janela(`${ORIGEM}/?source=pwa`, navegarPara);
    const { clique, openWindow } = await importar([aberta]);

    await tocar(clique, undefined);

    expect(aberta.focus).toHaveBeenCalledOnce();
    expect(navegarPara).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("aviso SEM url e sem janela: abre '/' (a vitrine, como sempre)", async () => {
    const { clique, openWindow } = await importar([]);

    await tocar(clique, {});

    expect(openWindow).toHaveBeenCalledExactlyOnceWith(`${ORIGEM}/`);
  });
});
