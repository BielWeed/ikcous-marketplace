// Sonda de rede POR CONTEÚDO (issue #92, aceite 3).
//
// "navigator.onLine true + response.ok" mente: portal cativo e DNS
// sequestrado respondem 200 (com HTML do portal) para qualquer URL. O purge
// que disparasse nesse estado apagaria o offline de quem tinha rede MENTINDO
// — o dano original da issue, agora com cara de legítimo.
//
// Por isso a sonda exige CONTEÚDO de /version.json: status ok + content-type
// json + corpo JSON com campo `version` string. Portal cativo devolve
// text/html e falha FECHADO. Falso negativo (rede boa recusada) é
// aceitável: não purga, e a UI mostra a tela honesta de offline com botão.
//
// Ambiente node: a sonda só depende de fetch global (stubado) e de
// AbortController — nada de DOM.
import { afterEach, describe, expect, it, vi } from "vitest";

import { verificarRedeDeVerdade } from "@/lib/recuperacao-chunk";

// Mesmo literal do PRAZO_SONDA_DE_REDE_MS no módulo, duplicado de propósito:
// se o prazo do módulo mudar, este teste quebra e avisa.
const PRAZO_SONDA_DE_REDE_MS = 5000;

function respostaJson(): Response {
  return new Response(JSON.stringify({ version: "1.0.0-abc" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("verificarRedeDeVerdade — rede provada por conteúdo, não por ok", () => {
  it("controle: sonda /version.json com cache no-store", async () => {
    const buscar = vi.fn(async () => respostaJson());
    vi.stubGlobal("fetch", buscar);

    await verificarRedeDeVerdade();

    expect(buscar).toHaveBeenCalledWith(
      "/version.json",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("version.json válido de verdade → rede verificada", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respostaJson()),
    );

    expect(await verificarRedeDeVerdade()).toBe(true);
  });

  it("PORTAL CATIVO: 200 text/html não é rede — falha fechado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>login do portal</html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      ),
    );

    expect(await verificarRedeDeVerdade()).toBe(false);
  });

  it("content-type MENTINDO: HTML declarado, JSON válido de /version.json no corpo → falha fechado", async () => {
    // O caso que separa o content-type do parse: se a validação fosse só
    // "o corpo faz parse e tem version", um portal/DNS mentindo que serve
    // JSON válido (ou um proxy reaproveitando a resposta) passaria. A
    // declaração tem de ser json — é ela que o proxy cativo não finge.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ version: "1.0.0-abc" }), {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      ),
    );

    expect(await verificarRedeDeVerdade()).toBe(false);
  });

  it("content-type json com corpo que não é JSON (parse estoura) → falha fechado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{quebrado", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    expect(await verificarRedeDeVerdade()).toBe(false);
  });

  it("corpo JSON sem o campo version string → não é a sonda desta loja", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ qualquer: "coisa" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    expect(await verificarRedeDeVerdade()).toBe(false);
  });

  it("erro de erro/404/503 → sem rede verificada", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );

    expect(await verificarRedeDeVerdade()).toBe(false);
  });

  it("fetch rejeitado (rede caída de verdade) → false, sem estourar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    expect(await verificarRedeDeVerdade()).toBe(false);
  });

  it("rede meia-aberta pendurada → false DENTRO do prazo (a sonda não vira spinner eterno)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_caminho: string, opcoes?: { signal?: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            opcoes?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      ),
    );

    const sonda = verificarRedeDeVerdade();
    await vi.advanceTimersByTimeAsync(PRAZO_SONDA_DE_REDE_MS + 1);

    expect(await sonda).toBe(false);
  });
});
