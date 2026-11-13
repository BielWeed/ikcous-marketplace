import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarBuildIdentity } from "./fixtures/build-identity";

// A lojista avanca o pedido ("Saiu para entrega" -> "Entregue") e o painel dispara os dois avisos sem
// esperar um pelo outro. Se o primeiro atrasa na rede e o segundo chega antes, a bandeja mostrava
// "Entregue" e DEPOIS "Saiu para entrega" (mesma tag, `renotify`): a cliente ficava com a informacao
// ERRADA no aparelho. O painel agora carimba o aviso (`data.emitidoEm`, em ms) e o service worker olha o
// aviso do mesmo pedido que ja esta na bandeja: se ele e MAIS NOVO que o que acabou de chegar, o que
// chegou nao o substitui. O push SEMPRE termina mostrando uma notificacao (o navegador exige: um push
// sem notificacao vira aviso generico do Chrome e queima a permissao no iOS), entao o aviso atrasado
// regrava, em silencio, o conteudo do mais novo. Sem carimbo (painel/app antigo, campanha), nada muda.
describe("aviso atrasado do mesmo pedido nao substitui o mais novo", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  type Mostrado = {
    title: string;
    body?: string;
    icon?: string;
    badge?: string;
    tag?: string;
    renotify?: boolean;
    data?: Record<string, unknown>;
  };

  // A "bandeja": showNotification com a mesma tag SUBSTITUI a anterior, como o aparelho faz.
  async function importar(opcoes: { semGetNotifications?: boolean } = {}) {
    vi.stubGlobal("__STORE_IDENTITY__", criarBuildIdentity("Aurora", "aurora"));
    const listeners = new Map<string, (event: unknown) => void>();
    const bandeja: Mostrado[] = [];
    const showNotification = vi.fn(
      async (title: string, options: Omit<Mostrado, "title">) => {
        const nova = { title, ...options };
        const i = nova.tag ? bandeja.findIndex((n) => n.tag === nova.tag) : -1;
        if (i >= 0) bandeja.splice(i, 1, nova);
        else bandeja.push(nova);
      },
    );
    const getNotifications = vi.fn(async (filtro?: { tag?: string }) =>
      bandeja.filter((n) => !filtro?.tag || n.tag === filtro.tag),
    );
    vi.stubGlobal("self", {
      location: { origin: "https://loja.example", hostname: "loja.example" },
      __WB_MANIFEST: [],
      registration: opcoes.semGetNotifications
        ? { showNotification }
        : { showNotification, getNotifications },
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        listeners.set(type, listener),
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
    const push = listeners.get("push");
    expect(push).toBeTypeOf("function");
    const receber = async (payload: unknown) => {
      const waitUntil = vi.fn();
      push!({ data: { json: () => payload }, waitUntil });
      await waitUntil.mock.calls[0][0];
    };
    return { receber, bandeja, showNotification, getNotifications };
  }

  const status = (titulo: string, emitidoEm?: number, pedido = "p1") => ({
    title: titulo,
    body: `Seu pedido agora esta: ${titulo}`,
    url: `/order-details?id=${pedido}`,
    data: {
      orderId: pedido,
      type: "order_status",
      ...(emitidoEm === undefined ? {} : { emitidoEm }),
    },
  });

  it("entrega INVERTIDA: o 'Entregue' chega primeiro e o 'A caminho' atrasado nao o substitui", async () => {
    const { receber, bandeja, showNotification } = await importar();
    await receber(status("Entregue", 2000));
    await receber(status("A caminho", 1000));

    // Todo push mostra UMA notificacao (o navegador exige), mas a bandeja fica com o mais novo.
    expect(showNotification).toHaveBeenCalledTimes(2);
    expect(bandeja).toHaveLength(1);
    expect(bandeja[0]).toMatchObject({
      title: "Entregue",
      body: "Seu pedido agora esta: Entregue",
      tag: "pedido-p1",
      data: {
        url: "/order-details?id=p1",
        orderId: "p1",
        type: "order_status",
        emitidoEm: 2000,
      },
    });
    // A regravacao do mais novo e SILENCIOSA: a cliente nao e avisada de novo de algo que ja viu.
    expect(showNotification.mock.calls[1][1].renotify).toBe(false);
    // O icone e o distintivo seguem os do aviso mantido.
    expect(showNotification.mock.calls[1][1].icon).toBe(
      showNotification.mock.calls[0][1].icon,
    );
    expect(showNotification.mock.calls[1][1].badge).toBe(
      showNotification.mock.calls[0][1].badge,
    );
  });

  it("CONTROLE — ordem normal: o ultimo a chegar e o mais novo e vence, avisando de novo", async () => {
    const { receber, bandeja, showNotification } = await importar();
    await receber(status("A caminho", 1000));
    await receber(status("Entregue", 2000));

    expect(bandeja).toHaveLength(1);
    expect(bandeja[0].title).toBe("Entregue");
    expect(bandeja[0].data?.emitidoEm).toBe(2000);
    expect(showNotification.mock.calls[1][1].renotify).toBe(true);
  });

  it("tres avisos fora de ordem terminam no mais novo, qualquer que seja a ordem de chegada", async () => {
    const { receber, bandeja } = await importar();
    await receber(status("A caminho", 2000));
    await receber(status("Confirmado", 1000));
    await receber(status("Entregue", 3000));
    await receber(status("Preparando", 1500));
    expect(bandeja).toHaveLength(1);
    expect(bandeja[0].title).toBe("Entregue");
  });

  it("CONTROLE — empate de carimbo: mostra (nenhum aviso legitimo some)", async () => {
    const { receber, bandeja, showNotification } = await importar();
    await receber(status("A caminho", 1000));
    await receber(status("Entregue", 1000));
    expect(bandeja[0].title).toBe("Entregue");
    expect(showNotification.mock.calls[1][1].renotify).toBe(true);
  });

  it("CONTROLE — aviso SEM carimbo (painel antigo) mostra como sempre, mesmo com um carimbado na bandeja", async () => {
    const { receber, bandeja, showNotification } = await importar();
    await receber(status("Entregue", 2000));
    await receber(status("A caminho"));
    expect(bandeja[0].title).toBe("A caminho");
    expect(showNotification.mock.calls[1][1].renotify).toBe(true);
  });

  it("CONTROLE — aviso carimbado sobre um da bandeja SEM carimbo mostra", async () => {
    const { receber, bandeja } = await importar();
    await receber(status("A caminho"));
    await receber(status("Entregue", 1000));
    expect(bandeja[0].title).toBe("Entregue");
  });

  it.each([
    ["texto", "2000"],
    ["nulo", null],
    ["objeto", { n: 1 }],
    ["NaN", Number.NaN],
  ])("carimbo invalido (%s) vale como ausente: mostra", async (_n, marca) => {
    const { receber, bandeja } = await importar();
    await receber(status("Entregue", 2000));
    const payload = status("A caminho");
    (payload.data as Record<string, unknown>).emitidoEm = marca;
    await receber(payload);
    expect(bandeja[0].title).toBe("A caminho");
  });

  it("outro pedido nao e afetado: o carimbo de um nao segura o aviso do outro", async () => {
    const { receber, bandeja } = await importar();
    await receber(status("Entregue", 9000, "p1"));
    await receber(status("Confirmado", 100, "p2"));
    expect(bandeja.map((n) => [n.tag, n.title])).toEqual([
      ["pedido-p1", "Entregue"],
      ["pedido-p2", "Confirmado"],
    ]);
  });

  it("campanha (sem pedido) nao consulta a bandeja nem ganha tag", async () => {
    const { receber, bandeja, getNotifications } = await importar();
    await receber({
      title: "Promo",
      data: { emitidoEm: 5, campanha: true },
    });
    await receber({
      title: "Promo 2",
      data: { emitidoEm: 1, campanha: true },
    });
    expect(getNotifications).not.toHaveBeenCalled();
    expect(bandeja).toHaveLength(2);
    expect(bandeja[1]).not.toHaveProperty("tag");
  });

  it("navegador sem getNotifications: mostra como sempre (nunca perde o aviso)", async () => {
    const { receber, bandeja } = await importar({ semGetNotifications: true });
    await receber(status("Entregue", 2000));
    await receber(status("A caminho", 1000));
    expect(bandeja[0].title).toBe("A caminho");
  });

  it("getNotifications que falha: mostra como sempre (nunca perde o aviso)", async () => {
    const { receber, bandeja, getNotifications } = await importar();
    getNotifications.mockRejectedValue(new Error("indisponivel"));
    await receber(status("Entregue", 2000));
    await receber(status("A caminho", 1000));
    expect(bandeja[0].title).toBe("A caminho");
  });
});
