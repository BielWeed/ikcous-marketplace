import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarBuildIdentity } from "./fixtures/build-identity";

describe("push usa a imagem da própria entrega", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ETAPA 3 (ADENDO A.8/B.5, 11/09/2026): `sw.ts` deixou de ler o ícone do
  // build ASSADO (`__STORE_IDENTITY__`) para a notificação — ele lê a ficha
  // guardada no cache PRÓPRIO (`ikcous-identidade`, instalada pelo
  // `install`), e só cai no ícone NEUTRO (`/icons/heart-96x96.png`) quando
  // esse cache está vazio ou o host não bate (ver
  // `sw-icone-neutro-nunca-o-da-principal.test.ts`). O icon colorido vem
  // de icon_192; o badge Android vem EXCLUSIVAMENTE de badge_96 ou da
  // reserva branca/transparente. Ambos usam a mesma ficha validada por host.
  const HOST_LOJA = "loja.example";

  function fichaComIconePorLoja(name: string, slug: string) {
    const identidade = criarBuildIdentity(name, slug);
    return {
      json: vi.fn().mockResolvedValue({
        schemaVersion: 2,
        host: HOST_LOJA,
        identidade: {
          identity: identidade.identity,
          localUrls: {
            ...identidade.localUrls,
            badge_96: `/identity/${slug}/badge-96.png`,
          },
          publicUrl: `https://${HOST_LOJA}`,
          identityRevision: "b".repeat(64),
        },
        conexao: {
          supabaseUrl: "https://ficha.supabase.co",
          publishableKey: "sb_publishable_ficha",
        },
      }),
    };
  }

  async function importar(
    name = "Aurora",
    rede: {
      fetchFn?: ReturnType<typeof vi.fn>;
      put?: ReturnType<typeof vi.fn>;
      semCopiaGuardada?: boolean;
    } = {},
  ) {
    const slug = name.toLowerCase();
    // Sem rede por padrão: o `push` agora tenta renovar a ficha pela rede
    // antes de ler a cópia guardada, e nenhum teste deste bloco quer
    // depender do `fetch` de verdade do Node.
    const fetchFn =
      rede.fetchFn ?? vi.fn().mockRejectedValue(new Error("sem rede"));
    vi.stubGlobal("fetch", fetchFn);
    vi.stubGlobal("__STORE_IDENTITY__", criarBuildIdentity(name, slug));
    const listeners = new Map<string, (event: unknown) => void>();
    const showNotification = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("self", {
      location: { origin: `https://${HOST_LOJA}`, hostname: HOST_LOJA },
      __WB_MANIFEST: [],
      registration: { showNotification },
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        listeners.set(type, listener),
    });
    const respostaFicha = fichaComIconePorLoja(name, slug);
    const put = rede.put ?? vi.fn().mockResolvedValue(undefined);
    const open = vi.fn().mockResolvedValue({
      match: vi
        .fn()
        .mockResolvedValue(rede.semCopiaGuardada ? undefined : respostaFicha),
      put,
    });
    vi.stubGlobal("caches", { open, match: vi.fn() });
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
    return { push: push!, showNotification, put, open, fetchFn };
  }

  it.each(["Aurora", "Horizonte"])(
    "icon de %s vem de icon_192, badge vem de badge_96 (ignora o payload)",
    async (name) => {
      const { push, showNotification } = await importar(name);
      const waitUntil = vi.fn();
      push({
        data: {
          json: () => ({
            title: "Aviso",
            body: "Mensagem",
            url: "/pedido",
            data: { pedido: "fixture" },
            icon: "https://externo.example/errado.png",
            badge: "https://externo.example/colorido.png",
          }),
        },
        waitUntil,
      });
      // O ícone agora vem da ficha em cache (leitura assíncrona,
      // `resolverIconesDaLoja().then(notificar)`) — `showNotification` só é
      // chamada depois que a promessa passada a `waitUntil` resolve.
      await waitUntil.mock.calls[0][0];
      expect(showNotification).toHaveBeenCalledExactlyOnceWith("Aviso", {
        body: "Mensagem",
        icon: `/identity/${name.toLowerCase()}/icon-192.png`,
        badge: `/identity/${name.toLowerCase()}/badge-96.png`,
        data: { url: "/pedido", pedido: "fixture" },
      });
      expect(waitUntil).toHaveBeenCalledExactlyOnceWith(
        showNotification.mock.results[0].value,
      );
    },
  );

  it.each(["sem-api", "cache-falhou", "json-invalido"])(
    "%s conserva icon/badge neutros sem ler a marca assada",
    async (falha) => {
      const { push, showNotification } = await importar();
      const erro = () => Promise.reject(new Error("cache indisponível"));
      vi.stubGlobal(
        "caches",
        falha === "sem-api"
          ? {}
          : {
              match: vi.fn(),
              open:
                falha === "cache-falhou"
                  ? erro
                  : async () => ({
                      match: async () => ({ json: erro }),
                    }),
            },
      );
      const waitUntil = vi.fn();
      push({ data: { json: () => ({ title: "Aviso" }) }, waitUntil });
      await waitUntil.mock.calls[0][0];
      expect(showNotification).toHaveBeenCalledExactlyOnceWith("Aviso", {
        body: "",
        icon: "/icons/heart-96x96.png",
        badge: "/icons/badge-96x96.png",
        data: { url: "/" },
      });
    },
  );

  it("push de texto inválido também recebe badge neutro (nunca colorido)", async () => {
    const { push, showNotification } = await importar();
    const waitUntil = vi.fn();
    push({
      data: {
        json: () => {
          throw new Error("JSON inválido");
        },
        text: () => "Aviso textual",
      },
      waitUntil,
    });
    await waitUntil.mock.calls[0][0];
    expect(showNotification).toHaveBeenCalledExactlyOnceWith("Notificação", {
      body: "Aviso textual",
      badge: "/icons/badge-96x96.png",
    });
  });

  it("payload vazio conserva título/corpo/URL de reserva; evento sem data não notifica", async () => {
    const { push, showNotification } = await importar();
    const waitUntil = vi.fn();
    push({ waitUntil });
    expect(showNotification).not.toHaveBeenCalled();
    push({ data: { json: () => ({}) }, waitUntil });
    // Mesma leitura assíncrona da ficha (ver comentário acima); só o
    // SEGUNDO `push` chega a chamar `waitUntil`.
    await waitUntil.mock.calls[0][0];
    expect(showNotification).toHaveBeenCalledExactlyOnceWith("Novidade!", {
      body: "",
      icon: "/identity/aurora/icon-192.png",
      badge: "/identity/aurora/badge-96.png",
      data: { url: "/" },
    });
  });

  // A lojista trocou o ícone depois que o app foi instalado: a ficha
  // guardada no `install` ficou velha (a URL da imagem leva o hash do
  // conteúdo, então imagem nova = URL nova). O aviso precisa mostrar a marca
  // de HOJE, sem esperar um app novo, e sem nunca perder ou atrasar o aviso
  // se a rede falhar.
  describe("renova a ficha da loja pela rede antes de mostrar o aviso", () => {
    const ICONE_NOVO = "/identity/nova-marca/icon-192.png";
    const BADGE_NOVO = "/identity/nova-marca/badge-96.png";
    const ICONE_GUARDADO = "/identity/aurora/icon-192.png";
    const BADGE_GUARDADO = "/identity/aurora/badge-96.png";

    function corpoDaFicha(
      host = HOST_LOJA,
      localUrls: Record<string, string> | null = {
        icon_192: ICONE_NOVO,
        badge_96: BADGE_NOVO,
      },
    ) {
      return {
        schemaVersion: 2,
        host,
        identidade: {
          identity: { name: "Nova Marca" },
          localUrls,
          publicUrl: `https://${host}`,
          identityRevision: "c".repeat(64),
        },
        conexao: {
          supabaseUrl: "https://ficha.supabase.co",
          publishableKey: "sb_publishable_ficha",
        },
      };
    }

    function respostaDaRede(corpo: unknown, status = 200) {
      return new Response(
        typeof corpo === "string" ? corpo : JSON.stringify(corpo),
        { status },
      );
    }

    async function disparar(push: (e: unknown) => void) {
      const waitUntil = vi.fn();
      push({ data: { json: () => ({ title: "Aviso" }) }, waitUntil });
      await waitUntil.mock.calls[0][0];
    }

    function opcoesDoAviso(showNotification: ReturnType<typeof vi.fn>) {
      return showNotification.mock.calls[0][1] as {
        icon: string;
        badge: string;
      };
    }

    it("ficha nova na rede + cópia velha guardada: o aviso sai com o ícone NOVO e a cópia é regravada", async () => {
      const { push, showNotification, put } = await importar("Aurora", {
        fetchFn: vi.fn().mockResolvedValue(respostaDaRede(corpoDaFicha())),
      });
      await disparar(push);
      expect(showNotification).toHaveBeenCalledExactlyOnceWith(
        "Aviso",
        expect.objectContaining({ icon: ICONE_NOVO, badge: BADGE_NOVO }),
      );
      await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1));
      expect(put.mock.calls[0][0]).toBe("/identidade.json");
      const guardada = put.mock.calls[0][1] as Response;
      expect((await guardada.json()).identidade.localUrls.icon_192).toBe(
        ICONE_NOVO,
      );
    });

    it("pede a ficha sem usar cópia do navegador e com prazo (sinal de cancelamento)", async () => {
      const { push, fetchFn } = await importar("Aurora", {
        fetchFn: vi.fn().mockResolvedValue(respostaDaRede(corpoDaFicha())),
      });
      await disparar(push);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/identidade.json");
      expect(init.cache).toBe("no-store");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it("sem NENHUMA cópia guardada (install que não conseguiu buscar a ficha), a rede resolve o ícone da loja", async () => {
      const { push, showNotification } = await importar("Aurora", {
        semCopiaGuardada: true,
        fetchFn: vi.fn().mockResolvedValue(respostaDaRede(corpoDaFicha())),
      });
      await disparar(push);
      expect(opcoesDoAviso(showNotification)).toMatchObject({
        icon: ICONE_NOVO,
        badge: BADGE_NOVO,
      });
    });

    it("rede fora: o aviso sai com a cópia guardada, nada é regravado", async () => {
      const { push, showNotification, put } = await importar("Aurora", {
        fetchFn: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      });
      await disparar(push);
      expect(opcoesDoAviso(showNotification)).toMatchObject({
        icon: ICONE_GUARDADO,
        badge: BADGE_GUARDADO,
      });
      expect(put).not.toHaveBeenCalled();
    });

    it("rede fora E sem cópia guardada: ícone neutro, o aviso nunca se perde", async () => {
      const { push, showNotification } = await importar("Aurora", {
        semCopiaGuardada: true,
        fetchFn: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      });
      await disparar(push);
      expect(opcoesDoAviso(showNotification)).toMatchObject({
        icon: "/icons/heart-96x96.png",
        badge: "/icons/badge-96x96.png",
      });
    });

    it.each([
      ["servidor responde erro (503)", () => respostaDaRede("fora do ar", 503)],
      [
        "servidor responde erro (503) com corpo que parece ficha",
        () => respostaDaRede(corpoDaFicha(), 503),
      ],
      [
        "servidor responde uma página em vez da ficha",
        () => respostaDaRede("<!doctype html><html></html>"),
      ],
      [
        "ficha de OUTRA loja (host diferente)",
        () => respostaDaRede(corpoDaFicha("outra-loja.example")),
      ],
      [
        "ficha sem as URLs das imagens",
        () => respostaDaRede(corpoDaFicha(HOST_LOJA, null)),
      ],
    ])(
      "%s: cai na cópia guardada e não sobrescreve ela",
      async (_nome, resposta) => {
        const { push, showNotification, put } = await importar("Aurora", {
          fetchFn: vi.fn().mockImplementation(async () => resposta()),
        });
        await disparar(push);
        expect(opcoesDoAviso(showNotification)).toMatchObject({
          icon: ICONE_GUARDADO,
          badge: BADGE_GUARDADO,
        });
        expect(put).not.toHaveBeenCalled();
      },
    );

    it("ficha nova de versão antiga (sem badge_96): ícone novo e badge neutro, nunca o colorido", async () => {
      const { push, showNotification } = await importar("Aurora", {
        fetchFn: vi
          .fn()
          .mockResolvedValue(
            respostaDaRede(corpoDaFicha(HOST_LOJA, { icon_192: ICONE_NOVO })),
          ),
      });
      await disparar(push);
      expect(opcoesDoAviso(showNotification)).toMatchObject({
        icon: ICONE_NOVO,
        badge: "/icons/badge-96x96.png",
      });
    });

    it("gravar a cópia falha: o aviso sai igual, com o ícone novo", async () => {
      const { push, showNotification } = await importar("Aurora", {
        fetchFn: vi.fn().mockResolvedValue(respostaDaRede(corpoDaFicha())),
        put: vi.fn().mockRejectedValue(new Error("cota cheia")),
      });
      await disparar(push);
      expect(opcoesDoAviso(showNotification)).toMatchObject({
        icon: ICONE_NOVO,
      });
    });

    it("gravar a cópia TRAVA para sempre: o aviso não espera por ela", async () => {
      const { push, showNotification } = await importar("Aurora", {
        fetchFn: vi.fn().mockResolvedValue(respostaDaRede(corpoDaFicha())),
        put: vi.fn().mockReturnValue(new Promise(() => {})),
      });
      await disparar(push);
      expect(opcoesDoAviso(showNotification)).toMatchObject({
        icon: ICONE_NOVO,
      });
    });

    it("dois avisos ao mesmo tempo: os dois saem com o ícone novo", async () => {
      const { push, showNotification } = await importar("Aurora", {
        fetchFn: vi
          .fn()
          .mockImplementation(async () => respostaDaRede(corpoDaFicha())),
      });
      await Promise.all([disparar(push), disparar(push)]);
      expect(showNotification).toHaveBeenCalledTimes(2);
      for (const [, opcoes] of showNotification.mock.calls) {
        expect(opcoes.icon).toBe(ICONE_NOVO);
      }
    });

    describe("rede que não responde", () => {
      // Faz o prazo andar no relógio de mentira (a versão nativa do prazo usa
      // o relógio de verdade), e o `fetch` do teste obedece ao cancelamento
      // como o do navegador: o pedido E a leitura do corpo caem com o sinal.
      const original = AbortSignal.timeout;
      afterEach(() => {
        AbortSignal.timeout = original;
      });

      function sinalNoRelogioDeMentira(nativo: boolean) {
        if (nativo) {
          AbortSignal.timeout = (ms: number) => {
            const controle = new AbortController();
            setTimeout(() => controle.abort(), ms);
            return controle.signal;
          };
        } else {
          (AbortSignal as { timeout?: unknown }).timeout = undefined;
        }
      }

      function cancelavel(sinal: AbortSignal) {
        return new Promise<never>((_, rejeitar) =>
          sinal.addEventListener("abort", () =>
            rejeitar(new DOMException("aborted", "AbortError")),
          ),
        );
      }

      it.each([
        ["com AbortSignal.timeout", true],
        ["sem AbortSignal.timeout (iOS 15)", false],
      ])(
        "pedido pendurado (%s): em até 2 s o aviso sai com a cópia guardada",
        async (_nome, nativo) => {
          sinalNoRelogioDeMentira(nativo);
          const { push, showNotification, put } = await importar("Aurora", {
            fetchFn: vi
              .fn()
              .mockImplementation((_url: string, init: RequestInit) =>
                cancelavel(init.signal as AbortSignal),
              ),
          });
          const waitUntil = vi.fn();
          push({ data: { json: () => ({ title: "Aviso" }) }, waitUntil });
          await vi.advanceTimersByTimeAsync(10);
          expect(showNotification).not.toHaveBeenCalled();
          await vi.advanceTimersByTimeAsync(2000);
          await waitUntil.mock.calls[0][0];
          expect(opcoesDoAviso(showNotification)).toMatchObject({
            icon: ICONE_GUARDADO,
            badge: BADGE_GUARDADO,
          });
          expect(put).not.toHaveBeenCalled();
        },
      );

      it("cabeçalho chega mas o corpo da ficha nunca termina: o prazo também derruba a leitura", async () => {
        sinalNoRelogioDeMentira(true);
        const { push, showNotification } = await importar("Aurora", {
          fetchFn: vi
            .fn()
            .mockImplementation(async (_url: string, init: RequestInit) => ({
              ok: true,
              clone: () => ({}),
              json: () => cancelavel(init.signal as AbortSignal),
            })),
        });
        const waitUntil = vi.fn();
        push({ data: { json: () => ({ title: "Aviso" }) }, waitUntil });
        await vi.advanceTimersByTimeAsync(10);
        expect(showNotification).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(2000);
        await waitUntil.mock.calls[0][0];
        expect(opcoesDoAviso(showNotification)).toMatchObject({
          icon: ICONE_GUARDADO,
        });
      });
    });
  });
});
