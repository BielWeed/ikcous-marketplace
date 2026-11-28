import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarBuildIdentity } from "./fixtures/build-identity";

// No Android e no computador o navegador troca o endereço da inscrição de push
// sozinho e avisa o Service Worker (`pushsubscriptionchange`). Sem tratar, o
// próximo aviso ia para o endereço velho, dava 410, a linha era apagada e a
// lojista ficava sem aviso até abrir o painel. O SW não tem a sessão da conta
// (a RLS de `push_subscriptions` exige o dono), então ele faz o que dá:
// reinscreve com a MESMA chave e chama as janelas abertas para gravarem.
describe("troca da inscrição de push (pushsubscriptionchange)", () => {
  const ORIGEM = "https://loja.example";
  const CHAVE = new Uint8Array([4, 1, 2, 3]).buffer;
  const TIPO = "ikcous:inscricao-de-push-trocou";

  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function importar() {
    const listeners = new Map<string, (event: unknown) => void>();
    const janela = { url: `${ORIGEM}/admin`, postMessage: vi.fn() };
    const outra = { url: `${ORIGEM}/`, postMessage: vi.fn() };
    const subscribe = vi.fn().mockResolvedValue({ endpoint: "novo" });
    const matchAll = vi.fn().mockResolvedValue([janela, outra]);
    vi.stubGlobal("__STORE_IDENTITY__", criarBuildIdentity("Aurora", "aurora"));
    vi.stubGlobal("self", {
      location: { origin: ORIGEM, hostname: "loja.example" },
      __WB_MANIFEST: [],
      registration: { showNotification: vi.fn(), pushManager: { subscribe } },
      clients: { matchAll, openWindow: vi.fn() },
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
    const trocou = listeners.get("pushsubscriptionchange");
    expect(trocou).toBeTypeOf("function");
    return { trocou: trocou!, subscribe, matchAll, janela, outra };
  }

  async function disparar(
    trocou: (event: unknown) => void,
    evento: Record<string, unknown>,
  ) {
    const waitUntil = vi.fn();
    trocou({ ...evento, waitUntil });
    expect(waitUntil).toHaveBeenCalledOnce();
    await waitUntil.mock.calls[0][0];
  }

  it("reinscreve com a MESMA chave da inscrição antiga e chama as janelas abertas para gravar", async () => {
    const { trocou, subscribe, matchAll, janela, outra } = await importar();

    await disparar(trocou, {
      oldSubscription: { options: { applicationServerKey: CHAVE } },
      newSubscription: null,
    });

    expect(subscribe).toHaveBeenCalledExactlyOnceWith({
      userVisibleOnly: true,
      applicationServerKey: CHAVE,
    });
    expect(matchAll).toHaveBeenCalledWith({
      type: "window",
      includeUncontrolled: true,
    });
    expect(janela.postMessage).toHaveBeenCalledExactlyOnceWith({ tipo: TIPO });
    expect(outra.postMessage).toHaveBeenCalledExactlyOnceWith({ tipo: TIPO });
  });

  it("o navegador já entregou a inscrição nova: não reinscreve, só chama as janelas", async () => {
    const { trocou, subscribe, janela } = await importar();

    await disparar(trocou, {
      oldSubscription: { options: { applicationServerKey: CHAVE } },
      newSubscription: { endpoint: "ja-nova" },
    });

    expect(subscribe).not.toHaveBeenCalled();
    expect(janela.postMessage).toHaveBeenCalledOnce();
  });

  it("sem a chave antiga (o navegador não deu): não inventa chave, mas chama as janelas (o app inscreve com a chave da loja)", async () => {
    const { trocou, subscribe, janela } = await importar();

    await disparar(trocou, { oldSubscription: null, newSubscription: null });

    expect(subscribe).not.toHaveBeenCalled();
    expect(janela.postMessage).toHaveBeenCalledOnce();
  });

  it("reinscrever falha: o evento termina sem erro e as janelas ainda são chamadas", async () => {
    const { trocou, subscribe, janela } = await importar();
    subscribe.mockRejectedValue(new Error("serviço de push fora"));
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});

    await disparar(trocou, {
      oldSubscription: { options: { applicationServerKey: CHAVE } },
    });

    expect(janela.postMessage).toHaveBeenCalledOnce();
    aviso.mockRestore();
  });

  it("uma janela que morre no postMessage não impede as outras", async () => {
    const { trocou, janela, outra } = await importar();
    janela.postMessage.mockImplementation(() => {
      throw new Error("janela fechada");
    });

    await disparar(trocou, {
      oldSubscription: { options: { applicationServerKey: CHAVE } },
    });

    expect(outra.postMessage).toHaveBeenCalledOnce();
  });
});
