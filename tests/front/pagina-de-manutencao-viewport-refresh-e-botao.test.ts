/**
 * As duas páginas de "loja em manutenção" (a do porteiro, no servidor, e a do
 * service worker, montada em código) eram um parágrafo solto: sem
 * <meta viewport> (o texto saía minúsculo no celular), sem botão e sem tentar
 * sozinhas. No iPhone com o app instalado não existe barra do navegador nem
 * puxar para atualizar: para tentar de novo a pessoa tinha de fechar o app e
 * abrir outra vez, mesmo que o servidor voltasse em 10 segundos.
 *
 * O conserto copia o padrão de `public/offline.html`: <meta viewport>,
 * <title>, recarga automática (<meta http-equiv="refresh">: 30 s no porteiro,
 * que consulta o banco a cada recarga; 10 s no service worker, que só aparece
 * sem internet e não gera carga) e um
 * link "Tentar novamente" apontando para a própria página (href vazio). SEM
 * script e SEM atributo de evento de propósito: a CSP de produção (vercel.json)
 * só libera 1 hash em script-src, então qualquer script em linha seria
 * bloqueado e a página ficaria parada.
 *
 * O que NÃO muda (e o teste cobra): status 503 e os cabeçalhos de cada
 * resposta (`retry-after`, `x-ikcous-*`, e o `cache-control: no-store` do
 * porteiro, para a tela de manutenção nunca grudar).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { respostaManutencao } from "@/hospedagem/porteiro";

/** O que as duas páginas precisam ter para o celular e para a recarga. */
function exigirPaginaQueVoltaSozinha(html: string, segundos: number) {
  expect(html).toMatch(
    /<meta name="viewport" content="width=device-width, initial-scale=1(\.0)?"\s*\/?>/,
  );
  expect(
    html.match(/<meta http-equiv="refresh" content="(\d+)"\s*\/?>/)?.[1],
  ).toBe(String(segundos));
  expect(html).toMatch(/<title>[^<]*manuten[^<]*<\/title>/i);
  // O botão é um link para a própria página: recarrega sem script.
  expect(html).toMatch(/<a [^>]*href=""[^>]*>\s*Tentar novamente\s*<\/a>/);
  // A frase que já existia continua dizendo o que está acontecendo.
  expect(html.toLowerCase()).toContain("manuten");
  // CSP: nada de script em linha nem de atributo de evento.
  expect(html).not.toContain("<script");
  expect(html).not.toMatch(/\son[a-z]+\s*=/i);
}

describe("porteiro — o 503 de manutenção ajusta ao celular, tenta sozinho e tem botão", () => {
  it("a página tem viewport, título, recarga de 30 s e o link Tentar novamente", async () => {
    const resposta = respostaManutencao("banco-indisponivel", "erro");
    exigirPaginaQueVoltaSozinha(await resposta.text(), 30);
  });

  it("o texto de antes continua lá (a frase não mudou)", async () => {
    const html = await respostaManutencao("sem-loja", "ausente").text();
    expect(html).toContain("Esta loja está em manutenção. Volte em instantes.");
  });

  it("status e cabeçalhos não mudam: 503, no-store, retry-after 60 e os x-ikcous-*", () => {
    const resposta = respostaManutencao("discorda", "hit");
    expect(resposta.status).toBe(503);
    expect(resposta.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(resposta.headers.get("cache-control")).toBe("no-store");
    expect(resposta.headers.get("retry-after")).toBe("60");
    expect(resposta.headers.get("x-ikcous-porteiro")).toBe("discorda");
    expect(resposta.headers.get("x-ikcous-caderneta")).toBe("hit");
  });

  it("nenhum dado de loja vai para a página: o corpo é o mesmo para qualquer motivo", async () => {
    const motivos = [
      "sem-loja",
      "discorda",
      "banco-indisponivel",
      "html-indisponivel",
    ] as const;
    const corpos = await Promise.all(
      motivos.map((m) => respostaManutencao(m, "miss").text()),
    );
    expect(new Set(corpos).size).toBe(1);
  });
});

// ─── service worker ─────────────────────────────────────────────────────────

type Listener = (event: unknown) => void;

describe("service worker — o 503 'sem ficha no cache' também ajusta, tenta sozinho e tem botão", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Rota nunca visitada, rede fora do ar, só o index.html SEM ficha no cache
   * e nem a página offline guardada: o último recurso do SW. */
  async function ultimoRecursoDoSw(): Promise<Response> {
    const listeners = new Map<string, Listener[]>();
    const selfFalso = {
      location: { origin: "https://loja.exemplo.com" },
      __WB_MANIFEST: [],
      addEventListener(tipo: string, fn: Listener) {
        listeners.set(tipo, [...(listeners.get(tipo) ?? []), fn]);
      },
      clients: { claim: vi.fn().mockResolvedValue(undefined) },
      registration: { waiting: null },
      skipWaiting: vi.fn(),
    };
    const cacheFalso = {
      addAll: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined),
      match: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(true),
    };
    const semFicha = () =>
      new Response("<!doctype html><html><body>app</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    const cachesFalso = {
      open: vi.fn().mockResolvedValue(cacheFalso),
      match: vi.fn((chave: string | Request) => {
        const url = typeof chave === "string" ? chave : chave.url;
        const caminho = url.startsWith("http") ? new URL(url).pathname : url;
        return Promise.resolve(
          caminho === "/index.html" ? semFicha() : undefined,
        );
      }),
      keys: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(true),
    };
    vi.stubGlobal("self", selfFalso);
    vi.stubGlobal("caches", cachesFalso);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
      },
    );
    await import("@/sw/sw");

    const request = new Request("https://loja.exemplo.com/pedido/123", {
      method: "GET",
    });
    Object.defineProperty(request, "mode", { value: "navigate" });
    const event = { request, respondWith: vi.fn(), waitUntil: vi.fn() };
    const [fetchListener] = listeners.get("fetch") ?? [];
    expect(fetchListener).toBeDefined();
    fetchListener(event);
    expect(event.respondWith).toHaveBeenCalledTimes(1);
    return event.respondWith.mock.calls[0][0];
  }

  it("a página tem viewport, título, recarga de 10 s e o link Tentar novamente", async () => {
    const resposta = await ultimoRecursoDoSw();
    exigirPaginaQueVoltaSozinha(await resposta.text(), 10);
  });

  it("a frase de antes continua lá e nenhum byte do HTML sem ficha chega à pessoa", async () => {
    const html = await (await ultimoRecursoDoSw()).text();
    expect(html).toContain("Loja em manutenção. Tente novamente em instantes.");
    expect(html).not.toContain("<body>app</body>");
  });

  it("status e cabeçalhos não mudam: 503, retry-after 60 e x-ikcous-porteiro", async () => {
    const resposta = await ultimoRecursoDoSw();
    expect(resposta.status).toBe(503);
    expect(resposta.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(resposta.headers.get("retry-after")).toBe("60");
    expect(resposta.headers.get("x-ikcous-porteiro")).toBe(
      "sem-ficha-no-cache",
    );
  });
});
