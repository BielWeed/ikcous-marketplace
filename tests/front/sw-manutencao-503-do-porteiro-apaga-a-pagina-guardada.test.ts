import {
  type MotivoManutencao,
  respostaForaDoAr,
  respostaManutencao,
} from "@/hospedagem/porteiro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/sw/sw.ts` — a navegação guardada não esconde a manutenção do porteiro.
 *
 * O DEFEITO: a navegação responde com a página GUARDADA e a rede só revalida
 * em segundo plano (`waitUntil`). A revalidação só olhava o 200: quando o
 * porteiro (`respostaManutencao`, em `src/hospedagem/porteiro.ts`) passava a
 * responder 503, o SW ignorava a resposta e a cliente que já tinha aberto o
 * app antes continuava vendo a vitrine ANTIGA (a ficha da loja é lida do HTML
 * guardado), sem nunca ver a tela de manutenção, enquanto o cache existisse.
 *
 * O MARCADOR REAL do 503 do porteiro: status 503 + cabeçalho
 * `x-ikcous-porteiro` com o motivo (`sem-loja`, `discorda`,
 * `banco-indisponivel`, `html-indisponivel`).
 * Só `sem-loja` e `discorda` apagam a página guardada. Os outros dois são
 * falhas passageiras; 503 sem cabeçalho e falhas da hospedagem também mantêm
 * o app guardado.
 *
 * O QUE ESTE TESTE FIXA (e o limite): a abertura que viu o 503 ainda entrega a
 * página guardada (o ramo é cache-primeiro de propósito: rede fora do ar não
 * pode dar tela branca) — com recusa duradoura, a PRÓXIMA abertura recebe o
 * 503. Falha passageira do porteiro e rede que FALHA (offline) não apagam nada.
 *
 * Mesmo molde de `sw-revalidacao-espera-a-atualizacao-que-esta-instalando`:
 * `sw.ts` registra os listeners ao ser importado, então o self é falso e a
 * importação é feita dentro de cada teste. O cache aqui GUARDA de verdade (um
 * Map), porque o que se prova é o que sobra nele depois.
 */

type Listener = (event: unknown) => void;

const ORIGEM = "https://loja.exemplo.com";
const ROTA = `${ORIGEM}/produtos`;
const VITRINE_ANTIGA = "<html>vitrine antiga</html>";
// L8 (26/11/2026): `adormecida` (503) e `encerrada` (410) também são recusas
// DURADOURAS — a página própria da loja fora do ar não pode ficar escondida
// atrás da vitrine guardada de quando a loja estava aberta.
const COMPORTAMENTO: Record<MotivoManutencao, boolean> = {
  "sem-loja": true,
  discorda: true,
  "banco-indisponivel": false,
  "html-indisponivel": false,
  adormecida: true,
  encerrada: true,
};

/** O que a PRÓXIMA abertura mostra quando a recusa é duradoura. */
const RECUSA_ESPERADA: Partial<
  Record<MotivoManutencao, { status: number; texto: string }>
> = {
  "sem-loja": { status: 503, texto: "manutenção" },
  discorda: { status: 503, texto: "manutenção" },
  adormecida: { status: 503, texto: "Loja Bela está fechada no momento." },
  encerrada: { status: 410, texto: "Loja Bela não está mais no ar." },
};

const chave = (alvo: Request | string) =>
  new URL(typeof alvo === "string" ? alvo : alvo.url, ORIGEM).href;

/**
 * A resposta REAL do porteiro (não uma cópia escrita à mão): se o porteiro
 * mudar o marcador, este teste quebra em vez de o SW ficar cego em silêncio.
 */
function respostaDoPorteiro(motivo: MotivoManutencao): Response {
  if (motivo === "adormecida" || motivo === "encerrada")
    return respostaForaDoAr(
      { estado: motivo, nome: "Loja Bela", ref: "abcdefghijklmnopqrst" },
      "hit",
      undefined,
    );
  return respostaManutencao(motivo, "ausente");
}

function montar(rede: () => Promise<Response>) {
  const listeners = new Map<string, Listener[]>();
  const guardadas = new Map<string, Response>([
    [ROTA, new Response(VITRINE_ANTIGA, { status: 200 })],
  ]);
  const selfFalso = {
    location: { origin: ORIGEM },
    __WB_MANIFEST: [],
    addEventListener(tipo: string, fn: Listener) {
      listeners.set(tipo, [...(listeners.get(tipo) ?? []), fn]);
    },
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
    registration: { waiting: null, installing: null },
    skipWaiting: vi.fn(),
  };
  const casar = vi.fn(async (alvo: Request | string) =>
    guardadas.get(chave(alvo))?.clone(),
  );
  const put = vi.fn(async (alvo: Request | string, resposta: Response) => {
    guardadas.set(chave(alvo), resposta);
  });
  const apagar = vi.fn(async (alvo: Request | string) =>
    guardadas.delete(chave(alvo)),
  );
  const cacheFalso = {
    addAll: vi.fn().mockResolvedValue(undefined),
    put,
    match: casar,
    keys: vi.fn().mockResolvedValue([]),
    delete: apagar,
  };
  const cachesFalso = {
    match: casar,
    open: vi.fn().mockResolvedValue(cacheFalso),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };
  vi.stubGlobal("self", selfFalso);
  vi.stubGlobal("caches", cachesFalso);
  vi.stubGlobal("fetch", vi.fn(rede));
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      close() {}
    },
  );
  return { listeners, guardadas, put, apagar };
}

/** Abre a rota como navegação e espera a revalidação em segundo plano. */
async function abrir(listeners: Map<string, Listener[]>, url = ROTA) {
  const request = new Request(url);
  Object.defineProperty(request, "mode", { value: "navigate" });
  const esperas: Promise<unknown>[] = [];
  const respondWith = vi.fn();
  (listeners.get("fetch") ?? [])[0]({
    request,
    respondWith,
    waitUntil: (p: Promise<unknown>) => esperas.push(p),
  });
  const resposta = (await respondWith.mock.calls[0][0]) as Response;
  expect(esperas).toHaveLength(1);
  await Promise.all(esperas);
  // O put/delete são encadeados em promessas soltas: deixa a fila esvaziar.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return resposta;
}

describe("sw.ts — 503 do porteiro nao fica escondido atras da pagina guardada", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(Object.entries(COMPORTAMENTO))(
    "503 do porteiro (%s): apaga a pagina guardada somente se duradouro (%s)",
    async (motivo, deveApagar) => {
      const { listeners, guardadas, put, apagar } = montar(async () =>
        respostaDoPorteiro(motivo as MotivoManutencao),
      );
      await import("@/sw/sw");

      // 1ª abertura: cache-primeiro (de propósito), mas já descobre o 503.
      const primeira = await abrir(listeners);
      expect(await primeira.text()).toBe(VITRINE_ANTIGA);
      expect(guardadas.has(ROTA)).toBe(!deveApagar);

      const segunda = await abrir(listeners);
      if (deveApagar) {
        // Nada guardado: a recusa duradoura passa como veio na próxima visita.
        const esperada = RECUSA_ESPERADA[motivo as MotivoManutencao];
        if (!esperada) throw new Error(`motivo sem recusa esperada: ${motivo}`);
        expect(apagar).toHaveBeenCalledTimes(1);
        expect(chave(apagar.mock.calls[0][0])).toBe(ROTA);
        expect(segunda.status).toBe(esperada.status);
        expect(segunda.headers.get("x-ikcous-porteiro")).toBe(motivo);
        expect(await segunda.text()).toContain(esperada.texto);
      } else {
        // Falha passageira: preserva o app guardado também na próxima visita.
        expect(apagar).not.toHaveBeenCalled();
        expect(segunda.status).toBe(200);
        expect(await segunda.text()).toBe(VITRINE_ANTIGA);
      }
      // E o 503 nunca é gravado como se fosse a página da loja.
      expect(put).not.toHaveBeenCalled();
      expect(guardadas.has(ROTA)).toBe(!deveApagar);
    },
  );

  it("rede FALHANDO (offline): continua entregando a pagina guardada e nao apaga nada", async () => {
    const { listeners, guardadas, apagar } = montar(async () => {
      throw new TypeError("Failed to fetch");
    });
    await import("@/sw/sw");

    const resposta = await abrir(listeners);

    expect(await resposta.text()).toBe(VITRINE_ANTIGA);
    expect(apagar).not.toHaveBeenCalled();
    expect(guardadas.has(ROTA)).toBe(true);
  });

  it.each([
    ["502 da hospedagem", 502, {}],
    ["504 da hospedagem", 504, {}],
    ["500 generico", 500, {}],
    ["503 da hospedagem, sem o marcador do porteiro", 503, {}],
    [
      "503 com marcador que nao e de resposta de rede do porteiro",
      503,
      { "x-ikcous-porteiro": "sem-ficha-no-cache" },
    ],
    // L8: o marcador vale só com o status CERTO de cada página.
    ["410 sem o marcador do porteiro", 410, {}],
    [
      "410 com marcador adormecida (par trocado)",
      410,
      { "x-ikcous-porteiro": "adormecida" },
    ],
    [
      "503 com marcador encerrada (par trocado)",
      503,
      { "x-ikcous-porteiro": "encerrada" },
    ],
    ["410 com marcador sem-loja", 410, { "x-ikcous-porteiro": "sem-loja" }],
  ])("%s: NAO apaga a pagina guardada", async (_nome, status, cabecalhos) => {
    const { listeners, guardadas, apagar } = montar(
      async () =>
        new Response("<html>erro</html>", { status, headers: cabecalhos }),
    );
    await import("@/sw/sw");

    const resposta = await abrir(listeners);

    expect(await resposta.text()).toBe(VITRINE_ANTIGA);
    expect(apagar).not.toHaveBeenCalled();
    expect(guardadas.has(ROTA)).toBe(true);
  });

  it("200 do porteiro: segue regravando a pagina nova (o fluxo de sempre)", async () => {
    const { listeners, guardadas, put, apagar } = montar(
      async () =>
        new Response("<html>vitrine nova</html>", {
          status: 200,
          headers: { "x-ikcous-porteiro": "ok" },
        }),
    );
    await import("@/sw/sw");

    await abrir(listeners);

    expect(apagar).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledTimes(1);
    expect(await guardadas.get(ROTA)?.text()).toBe("<html>vitrine nova</html>");
  });

  it("duas aberturas ao mesmo tempo vendo o 503: as duas apagam sem erro (idempotente)", async () => {
    const { listeners, guardadas } = montar(async () =>
      respostaDoPorteiro("discorda"),
    );
    await import("@/sw/sw");

    const [a, b] = await Promise.all([abrir(listeners), abrir(listeners)]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(guardadas.has(ROTA)).toBe(false);
  });

  it("falha ao apagar o cache nao derruba a abertura (entrega a guardada e nao rejeita)", async () => {
    const { listeners, apagar } = montar(async () =>
      respostaDoPorteiro("sem-loja"),
    );
    apagar.mockRejectedValue(new Error("cache indisponivel"));
    await import("@/sw/sw");

    const resposta = await abrir(listeners);

    expect(await resposta.text()).toBe(VITRINE_ANTIGA);
    expect(apagar).toHaveBeenCalledTimes(1);
  });
});
