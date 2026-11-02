// A gravacao da entrada no banco da loja (spec "visitas da loja", decisoes 4 e
// 5). O que dói aqui: gravar NUNCA pode atrasar nem derrubar a pagina da loja
// (a funcao nao rejeita, tem prazo de 1,5 s e e' entregue sem espera), e uma
// loja que ainda nao recebeu a migration (404) nao pode ser martelada a cada
// visita. `fetch` e relogio sao dubles -- nunca rede de verdade.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CanalDeEntrada } from "@/hospedagem/contador";
import { registrarEntrada } from "@/hospedagem/contador";

const CONEXAO_A = {
  supabaseUrl: "https://projetoaaaaaaaaaaaaa.supabase.co",
  publishableKey: "sb_publishable_a",
};
const CONEXAO_B = {
  supabaseUrl: "https://projetobbbbbbbbbbbbb.supabase.co",
  publishableKey: "sb_publishable_b",
};

const DEZ_MINUTOS = 10 * 60 * 1000;
const UM_MINUTO = 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  // Todo silencio loga uma linha; os testes que olham o log pegam o mesmo espiao.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function deps(
  fetchImpl: typeof fetch,
  relogio: { agora: number } = { agora: 1_000_000 },
  silencio = new Map<string, number>(),
) {
  return { fetchImpl, silencio, agora: () => relogio.agora };
}

function fetchQueResponde(status: number) {
  return vi.fn(async () => new Response(null, { status }));
}

describe("registrarEntrada -- o pedido que sai", () => {
  it("POST em <supabaseUrl>/rest/v1/rpc/contar_entrada, com a chave PUBLICA da conexao e o canal no corpo", async () => {
    const fetchDuble = fetchQueResponde(204);
    const resultado = await registrarEntrada(
      CONEXAO_A,
      "whatsapp",
      deps(fetchDuble as unknown as typeof fetch),
    );
    expect(resultado).toBeUndefined();
    expect(fetchDuble).toHaveBeenCalledTimes(1);
    const [url, init] = fetchDuble.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${CONEXAO_A.supabaseUrl}/rest/v1/rpc/contar_entrada`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "content-type": "application/json",
      apikey: "sb_publishable_a",
      Authorization: "Bearer sb_publishable_a",
    });
    expect(init.body).toBe('{"p_canal":"whatsapp"}');
    expect(init.redirect).toBe("error");
    expect(init.credentials).toBe("omit");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    "direto",
    "instagram",
    "whatsapp",
    "outros_sites",
    "previa",
  ] satisfies CanalDeEntrada[])(
    "o canal %s vai no corpo, so ele",
    async (canal) => {
      const fetchDuble = fetchQueResponde(204);
      await registrarEntrada(
        CONEXAO_B,
        canal,
        deps(fetchDuble as unknown as typeof fetch),
      );
      const init = (
        fetchDuble.mock.calls[0] as unknown as [string, RequestInit]
      )[1];
      expect(JSON.parse(String(init.body))).toEqual({ p_canal: canal });
    },
  );
});

describe("registrarEntrada -- nunca rejeita, nunca atrasa alem do prazo", () => {
  it("fetch que rejeita -> resolve undefined, sem lancar", async () => {
    const fetchDuble = vi.fn(async () => {
      throw new TypeError("rede caiu");
    });
    await expect(
      registrarEntrada(
        CONEXAO_A,
        "direto",
        deps(fetchDuble as unknown as typeof fetch),
      ),
    ).resolves.toBeUndefined();
  });

  it("fetch que lanca de forma SINCRONA (antes de devolver promessa) -> resolve undefined", async () => {
    const fetchDuble = vi.fn(() => {
      throw new Error("falha sincrona");
    });
    await expect(
      registrarEntrada(
        CONEXAO_A,
        "direto",
        deps(fetchDuble as unknown as typeof fetch),
      ),
    ).resolves.toBeUndefined();
  });

  it("resposta 500 -> resolve undefined (e cala a loja por 60 s: ver o bloco de silencio por categoria)", async () => {
    const fetchDuble = fetchQueResponde(500);
    await expect(
      registrarEntrada(
        CONEXAO_A,
        "direto",
        deps(fetchDuble as unknown as typeof fetch),
      ),
    ).resolves.toBeUndefined();
  });

  it("fetch que NUNCA responde -> resolve undefined em 1,5 s e aborta o pedido", async () => {
    let sinal: AbortSignal | undefined;
    const fetchDuble = vi.fn((_url: unknown, init?: RequestInit) => {
      sinal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    let resolveu = false;
    const promessa = registrarEntrada(
      CONEXAO_A,
      "direto",
      deps(fetchDuble as unknown as typeof fetch),
    ).then((valor) => {
      resolveu = true;
      return valor;
    });

    await vi.advanceTimersByTimeAsync(1_499);
    expect(resolveu).toBe(false);
    expect(sinal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(promessa).resolves.toBeUndefined();
    expect(sinal?.aborted).toBe(true);
  });

  it("deixa o temporizador limpo quando a resposta chega (nada pendurado no isolate)", async () => {
    await registrarEntrada(
      CONEXAO_A,
      "direto",
      deps(fetchQueResponde(204) as unknown as typeof fetch),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("registrarEntrada -- 404 = funcao ausente nesta loja: silencio de 10 min por supabaseUrl", () => {
  it("depois de um 404 o MESMO supabaseUrl nao recebe fetch por 10 min; outro supabaseUrl recebe", async () => {
    const relogio = { agora: 5_000_000 };
    const silencio = new Map<string, number>();
    const fetchA = fetchQueResponde(404);
    const chamadas: string[] = [];
    const fetchImpl = (async (url: string) => {
      chamadas.push(url);
      return url.startsWith(CONEXAO_A.supabaseUrl)
        ? fetchA()
        : new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const dep = deps(fetchImpl, relogio, silencio);

    await registrarEntrada(CONEXAO_A, "direto", dep);
    expect(chamadas).toHaveLength(1);

    relogio.agora += DEZ_MINUTOS - 1;
    await registrarEntrada(CONEXAO_A, "whatsapp", dep);
    await registrarEntrada(CONEXAO_A, "previa", dep);
    expect(chamadas).toHaveLength(1);

    // O silêncio de A não cala B (banco de outra loja).
    await registrarEntrada(CONEXAO_B, "direto", dep);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1]).toContain(CONEXAO_B.supabaseUrl);
  });

  it("passados 10 min tenta de novo; se agora funciona, a loja volta a contar", async () => {
    const relogio = { agora: 9_000_000 };
    const silencio = new Map<string, number>();
    const respostas = [404, 204, 204];
    const fetchDuble = vi.fn(
      async () => new Response(null, { status: respostas.shift() ?? 204 }),
    );
    const dep = deps(fetchDuble as unknown as typeof fetch, relogio, silencio);

    await registrarEntrada(CONEXAO_A, "direto", dep);
    expect(fetchDuble).toHaveBeenCalledTimes(1);

    relogio.agora += DEZ_MINUTOS;
    await registrarEntrada(CONEXAO_A, "direto", dep);
    expect(fetchDuble).toHaveBeenCalledTimes(2);

    // Migration chegou: o proximo pedido (ainda no mesmo instante) nao e' calado.
    await registrarEntrada(CONEXAO_A, "direto", dep);
    expect(fetchDuble).toHaveBeenCalledTimes(3);
  });

  it("se a loja continua sem a funcao depois dos 10 min, o silencio recomeca a partir dali", async () => {
    const relogio = { agora: 2_000_000 };
    const fetchDuble = fetchQueResponde(404);
    const dep = deps(fetchDuble as unknown as typeof fetch, relogio);

    await registrarEntrada(CONEXAO_A, "direto", dep);
    relogio.agora += DEZ_MINUTOS;
    await registrarEntrada(CONEXAO_A, "direto", dep);
    expect(fetchDuble).toHaveBeenCalledTimes(2);

    relogio.agora += DEZ_MINUTOS - 1;
    await registrarEntrada(CONEXAO_A, "direto", dep);
    expect(fetchDuble).toHaveBeenCalledTimes(2);
  });

  it("o mapa de silencio e' o do chamador: dois chamadores com mapas separados nao se calam", async () => {
    const fetchDuble = fetchQueResponde(404);
    await registrarEntrada(
      CONEXAO_A,
      "direto",
      deps(fetchDuble as unknown as typeof fetch),
    );
    await registrarEntrada(
      CONEXAO_A,
      "direto",
      deps(fetchDuble as unknown as typeof fetch),
    );
    expect(fetchDuble).toHaveBeenCalledTimes(2);
  });
});

describe("registrarEntrada -- 401/403 (grants diferentes) tambem calam 10 min, com UMA linha de log por janela", () => {
  it.each([401, 403, 404])(
    "status %s: silencia o supabaseUrl, nao tenta de novo na janela e loga uma linha so, sem URL",
    async (status) => {
      const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
      const relogio = { agora: 1_000_000 };
      const fetchDuble = fetchQueResponde(status);
      const dep = deps(fetchDuble as unknown as typeof fetch, relogio);

      await registrarEntrada(CONEXAO_A, "direto", dep);
      await registrarEntrada(CONEXAO_A, "whatsapp", dep);
      relogio.agora += DEZ_MINUTOS - 1;
      await registrarEntrada(CONEXAO_A, "previa", dep);

      expect(fetchDuble).toHaveBeenCalledTimes(1);
      expect(aviso).toHaveBeenCalledTimes(1);
      expect(aviso).toHaveBeenCalledWith(
        `contador-de-visitas: silenciado status=${status}`,
      );
      // Nada que identifique loja ou visitante.
      const linha = String(aviso.mock.calls[0]?.[0]);
      expect(linha).not.toContain("supabase");
      expect(linha).not.toContain("http");

      // Janela nova (10 min depois): tenta de novo, cala de novo, loga de novo.
      relogio.agora += 1;
      await registrarEntrada(CONEXAO_A, "direto", dep);
      expect(fetchDuble).toHaveBeenCalledTimes(2);
      expect(aviso).toHaveBeenCalledTimes(2);
    },
  );

  it("duas gravacoes em voo ao mesmo tempo que voltam 401 geram UMA linha so", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchDuble = fetchQueResponde(401);
    const dep = deps(fetchDuble as unknown as typeof fetch);
    await Promise.all([
      registrarEntrada(CONEXAO_A, "direto", dep),
      registrarEntrada(CONEXAO_A, "direto", dep),
    ]);
    expect(fetchDuble).toHaveBeenCalledTimes(2);
    expect(aviso).toHaveBeenCalledTimes(1);
  });

  it("sucesso (200, 204) nao cala nem loga", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const status of [200, 204]) {
      const fetchDuble = fetchQueResponde(status);
      const dep = deps(fetchDuble as unknown as typeof fetch);
      await registrarEntrada(CONEXAO_A, "direto", dep);
      await registrarEntrada(CONEXAO_A, "direto", dep);
      expect(fetchDuble).toHaveBeenCalledTimes(2);
    }
    expect(aviso).not.toHaveBeenCalled();
  });

  it("o silencio por 401 nao cala outro supabaseUrl", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const silencio = new Map<string, number>();
    const fetchA = fetchQueResponde(401);
    const fetchB = fetchQueResponde(204);
    await registrarEntrada(
      CONEXAO_A,
      "direto",
      deps(fetchA as unknown as typeof fetch, undefined, silencio),
    );
    await registrarEntrada(
      CONEXAO_B,
      "direto",
      deps(fetchB as unknown as typeof fetch, undefined, silencio),
    );
    expect(fetchB).toHaveBeenCalledTimes(1);
  });
});

// ─── silencio por categoria de falha ────────────────────────────────────────
//
// Banco doente nao pode receber um POST por visita, e falha PERMANENTE (ex.: 400
// por CHECK de canal) nao pode ficar invisivel: toda falha cala o banco e deixa
// UMA linha anonima de log por janela. Transitoria (5xx, 429, prazo, rede) = 60 s;
// permanente (404/401/403 e qualquer outro 4xx) = 10 min.

describe("registrarEntrada -- silencio por categoria (tempo certo, uma linha de log por janela)", () => {
  const CASOS: ReadonlyArray<readonly [number, number]> = [
    [500, UM_MINUTO],
    [502, UM_MINUTO],
    [503, UM_MINUTO],
    [429, UM_MINUTO],
    [400, DEZ_MINUTOS],
    [405, DEZ_MINUTOS],
    [422, DEZ_MINUTOS],
    [401, DEZ_MINUTOS],
    [403, DEZ_MINUTOS],
    [404, DEZ_MINUTOS],
  ];

  it.each(CASOS)(
    "status %s cala por %s ms: uma tentativa, uma linha; 1 ms antes do fim segue calado; no fim tenta de novo e loga de novo",
    async (status, duracao) => {
      const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
      const relogio = { agora: 3_000_000 };
      const fetchDuble = fetchQueResponde(status);
      const dep = deps(fetchDuble as unknown as typeof fetch, relogio);

      await registrarEntrada(CONEXAO_A, "direto", dep);
      await registrarEntrada(CONEXAO_A, "whatsapp", dep);
      expect(fetchDuble).toHaveBeenCalledTimes(1);
      expect(aviso).toHaveBeenCalledTimes(1);
      expect(aviso).toHaveBeenCalledWith(
        `contador-de-visitas: silenciado status=${status}`,
      );

      relogio.agora += duracao - 1;
      await registrarEntrada(CONEXAO_A, "previa", dep);
      expect(fetchDuble).toHaveBeenCalledTimes(1);

      relogio.agora += 1;
      await registrarEntrada(CONEXAO_A, "direto", dep);
      expect(fetchDuble).toHaveBeenCalledTimes(2);
      expect(aviso).toHaveBeenCalledTimes(2);
    },
  );

  it("prazo estourado (fetch que nunca responde) cala por 60 s e loga status=timeout", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const relogio = { agora: 4_000_000 };
    const fetchDuble = vi.fn(() => new Promise<Response>(() => {}));
    const dep = deps(fetchDuble as unknown as typeof fetch, relogio);

    const primeira = registrarEntrada(CONEXAO_A, "direto", dep);
    await vi.advanceTimersByTimeAsync(1_500);
    await primeira;
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(aviso).toHaveBeenCalledWith(
      "contador-de-visitas: silenciado status=timeout",
    );

    await registrarEntrada(CONEXAO_A, "direto", dep);
    expect(fetchDuble).toHaveBeenCalledTimes(1);

    relogio.agora += UM_MINUTO - 1;
    await registrarEntrada(CONEXAO_A, "direto", dep);
    expect(fetchDuble).toHaveBeenCalledTimes(1);

    relogio.agora += 1;
    const terceira = registrarEntrada(CONEXAO_A, "direto", dep);
    await vi.advanceTimersByTimeAsync(1_500);
    await terceira;
    expect(fetchDuble).toHaveBeenCalledTimes(2);
    expect(aviso).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "fetch que rejeita",
      () => vi.fn(async () => Promise.reject(new TypeError("rede caiu"))),
    ],
    [
      "fetch que lanca de forma sincrona",
      () =>
        vi.fn(() => {
          throw new Error("falha sincrona");
        }),
    ],
  ])(
    "erro de rede (%s) cala por 60 s e loga status=rede",
    async (_nome, criar) => {
      const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
      const relogio = { agora: 5_000_000 };
      const fetchDuble = criar();
      const dep = deps(fetchDuble as unknown as typeof fetch, relogio);

      await registrarEntrada(CONEXAO_A, "direto", dep);
      await registrarEntrada(CONEXAO_A, "direto", dep);
      expect(fetchDuble).toHaveBeenCalledTimes(1);
      expect(aviso).toHaveBeenCalledTimes(1);
      expect(aviso).toHaveBeenCalledWith(
        "contador-de-visitas: silenciado status=rede",
      );

      relogio.agora += UM_MINUTO - 1;
      await registrarEntrada(CONEXAO_A, "direto", dep);
      expect(fetchDuble).toHaveBeenCalledTimes(1);

      relogio.agora += 1;
      await registrarEntrada(CONEXAO_A, "direto", dep);
      expect(fetchDuble).toHaveBeenCalledTimes(2);
    },
  );

  it("a linha de log e' anonima: sem URL, chave, referer nem user-agent, em toda categoria", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const status of [500, 400]) {
      await registrarEntrada(
        CONEXAO_A,
        "direto",
        deps(fetchQueResponde(status) as unknown as typeof fetch),
      );
    }
    expect(aviso).toHaveBeenCalledTimes(2);
    for (const [linha] of aviso.mock.calls) {
      expect(String(linha)).toMatch(
        /^contador-de-visitas: silenciado status=\w+$/,
      );
      expect(String(linha)).not.toContain("supabase");
      expect(String(linha)).not.toContain("sb_publishable");
    }
  });

  it("o silencio de um banco nao afeta outro, em nenhuma categoria", async () => {
    for (const status of [500, 400, 404]) {
      const silencio = new Map<string, number>();
      const relogio = { agora: 6_000_000 };
      const fetchA = fetchQueResponde(status);
      const fetchB = fetchQueResponde(204);
      await registrarEntrada(
        CONEXAO_A,
        "direto",
        deps(fetchA as unknown as typeof fetch, relogio, silencio),
      );
      await registrarEntrada(
        CONEXAO_B,
        "direto",
        deps(fetchB as unknown as typeof fetch, relogio, silencio),
      );
      expect(fetchB).toHaveBeenCalledTimes(1);
    }
  });

  it("2xx/204 nao cala nem loga", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchDuble = fetchQueResponde(204);
    const dep = deps(fetchDuble as unknown as typeof fetch);
    await registrarEntrada(CONEXAO_A, "direto", dep);
    await registrarEntrada(CONEXAO_A, "direto", dep);
    expect(fetchDuble).toHaveBeenCalledTimes(2);
    expect(aviso).not.toHaveBeenCalled();
  });

  it("falhas em voo ao mesmo tempo na mesma janela geram UMA linha so", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchDuble = fetchQueResponde(503);
    const dep = deps(fetchDuble as unknown as typeof fetch);
    await Promise.all([
      registrarEntrada(CONEXAO_A, "direto", dep),
      registrarEntrada(CONEXAO_A, "direto", dep),
      registrarEntrada(CONEXAO_A, "direto", dep),
    ]);
    expect(fetchDuble).toHaveBeenCalledTimes(3);
    expect(aviso).toHaveBeenCalledTimes(1);
  });

  it("uma falha curta que chega depois de uma longa NAO encurta o silencio", async () => {
    const relogio = { agora: 7_000_000 };
    const respostas = [404, 500];
    const fetchDuble = vi.fn(
      async () => new Response(null, { status: respostas.shift() ?? 204 }),
    );
    const dep = deps(fetchDuble as unknown as typeof fetch, relogio);
    await Promise.all([
      registrarEntrada(CONEXAO_A, "direto", dep),
      registrarEntrada(CONEXAO_A, "direto", dep),
    ]);
    relogio.agora += UM_MINUTO;
    await registrarEntrada(CONEXAO_A, "direto", dep);
    expect(fetchDuble).toHaveBeenCalledTimes(2);
  });
});
