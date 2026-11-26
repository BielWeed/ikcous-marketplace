// A SONDA DO CANDIDATO (plano `PLANO-RESERVA-DA-CADERNETA-26-11.md`, T7 e
// "Prova"): `GET /__ikcous/sonda-do-candidato?host=<loja>` diz, num deploy
// candidato (`.vercel.app`, ainda não promovido), o que o porteiro DAQUELE deploy
// decide para uma loja — sem a página da loja. É o que o portão da publicação
// confere antes de promover. O que dói aqui:
//   - as TRÊS condições juntas (`IKCOUS_SONDA_DO_CANDIDATO=1`, host do pedido
//     igual a `VERCEL_URL`, `VERCEL_ENV=production`): faltando uma, a rota não
//     faz NADA (nem caderneta, nem banco, nem reserva) — num domínio de loja ela
//     não existe;
//   - nunca corpo de página, nunca o documento da reserva, nunca chave: só o
//     JSON curto `{host, porteiro, caderneta, ref, destinoDaCaderneta}`;
//   - cache NOVO a cada sonda (a ficha guardada de outra visita não responde
//     por ela) e `cache-control: no-store`;
//   - host inválido é recusado ANTES de qualquer pergunta;
//   - um visitante não força leituras repetidas: a reserva usa o MESMO leitor
//     (cache por instância) e a sonda tem teto por minuto.
// A caderneta é a REAL (`resolverNaCaderneta` de `middleware.ts`, com o `fetch`
// global trocado por um dublê). Nunca rede de verdade. Domínios, refs e chaves
// são INVENTADOS (repositório público).
import { afterEach, describe, expect, it, vi } from "vitest";

const { createClient, get } = vi.hoisted(() => {
  const get = vi.fn<(chave: string) => Promise<unknown>>();
  const createClient = vi.fn((_conexao: string, _opcoes?: unknown) => ({
    get,
  }));
  return { createClient, get };
});
vi.mock("@vercel/global-config", () => ({ createClient }));

import {
  SELECT_CONFIGURACAO_PUBLICA,
  ehCaminhoDeDocumento,
} from "@/hospedagem/porteiro";
import {
  CAMINHO_DA_SONDA,
  JANELA_DA_SONDA_MS,
  TETO_DA_SONDA_POR_JANELA,
  atenderSonda,
} from "@/hospedagem/sondaDoCandidato";
import type {
  AmbienteDaSonda,
  DependenciasDaSonda,
} from "@/hospedagem/sondaDoCandidato";
import middleware, { resolverNaCaderneta } from "../../middleware";

const REF_A = "sondaasondaasondaaso"; // 20 letras, inventado
const REF_B = "sondabsondabsondabso"; // 20 letras, inventado
const ORIGEM_A = `https://${REF_A}.supabase.co`;
const ORIGEM_B = `https://${REF_B}.supabase.co`;
const K_A = "sb_publishable_inventada_da_sonda_a";
const K_B = "sb_publishable_inventada_da_sonda_b";
const HOST_A = "loja-a-sonda.exemplo";
const HOST_B = "loja-b-sonda.exemplo";
const CANDIDATO = "ikcous-candidato-abc123-inventado.vercel.app";
const FROTA = "principalprincipalpri.supabase.co";
// Montado por partes para nenhum detector de segredo confundir o fixture.
const SEGREDO_DA_FROTA = ["segredo", "da", "frota", "inventado"].join("-");
const TOKEN = ["tok", "inventado", "SONDA", "1a2b3c"].join("_");

const AMBIENTE: AmbienteDaSonda = {
  IKCOUS_FROTA_URL: `https://${FROTA}`,
  IKCOUS_FROTA_APIKEY: "sb_publishable_principal_inventada",
  IKCOUS_FROTA_CHAVE: SEGREDO_DA_FROTA,
  VERCEL_ENV: "production",
  VERCEL_URL: CANDIDATO,
  IKCOUS_SONDA_DO_CANDIDATO: "1",
};

// ─── o banco de cada loja e a caderneta (o `fetch` GLOBAL) ─────────────────

const HASH = "a".repeat(64);
function asset(nome: string, largura: number, altura: number) {
  return {
    path: `v1/${HASH}/${nome}.png`,
    sha256: HASH,
    media_type: "image/png",
    bytes: 100,
    width: largura,
    height: altura,
  };
}
function linhaDaLoja(nome: string, origem: string) {
  const header = asset("header", 64, 64);
  return {
    store_name: nome,
    store_city: null,
    store_state: null,
    logo_url: `${origem}/storage/v1/object/public/branding/${header.path}`,
    primary_color: "#123456",
    secondary_color: "#654321",
    accent_color: "#abcdef",
    branding_assets: {
      version: 1,
      originals: [header],
      header,
      loader: asset("loader", 64, 64),
      favicon: asset("favicon", 32, 32),
      apple_touch: asset("apple", 180, 180),
      icon_192: asset("icon192", 192, 192),
      icon_512: asset("icon512", 512, 512),
      maskable_512: asset("maskable", 512, 512),
      og: asset("og", 1200, 630),
    },
  };
}

const LOJAS: Record<string, { nome: string; dominio: string }> = {
  [ORIGEM_A]: { nome: "Loja Alfa da Sonda Inventada", dominio: HOST_A },
  [ORIGEM_B]: { nome: "Loja Beta da Sonda Inventada", dominio: HOST_B },
};

type ModoDaCaderneta = "hit-a" | "503" | "miss" | "adormecida";

/** Um `fetch` só para tudo: a caderneta no modo pedido e o banco de cada loja.
 * Conta cada pergunta, para provar que a sonda recusada não perguntou nada. */
function rede(modoInicial: ModoDaCaderneta) {
  const conta = { caderneta: 0, bancos: 0, outros: [] as string[] };
  const estado = { modo: modoInicial };
  const duble = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.startsWith("/rest/v1/rpc/resolver_loja")) {
      conta.caderneta += 1;
      switch (estado.modo) {
        case "503":
          return new Response("indisponivel", { status: 503 });
        case "miss":
          return Response.json([]);
        case "adormecida":
          return Response.json([
            {
              supabase_url: null,
              publishable_key: null,
              project_ref: REF_A,
              nome: "Loja Alfa da Sonda Inventada",
              estado: "adormecida",
            },
          ]);
        case "hit-a":
          return Response.json([
            {
              supabase_url: ORIGEM_A,
              publishable_key: K_A,
              project_ref: REF_A,
              nome: "Loja Alfa da Sonda Inventada",
              estado: "ativa",
            },
          ]);
      }
    }
    const loja = LOJAS[url.origin];
    if (loja && url.pathname === "/rest/v1/v_store_config") {
      conta.bancos += 1;
      if (url.searchParams.get("select") === SELECT_CONFIGURACAO_PUBLICA)
        return Response.json([
          {
            dominio_publico: loja.dominio,
            mp_public_key: null,
            vapid_public_key: null,
            pagamento_online: false,
            manutencao: false,
          },
        ]);
      return Response.json([linhaDaLoja(loja.nome, url.origin)]);
    }
    conta.outros.push(url.toString());
    throw new Error(`rede proibida no teste: ${url.toString()}`);
  });
  vi.stubGlobal("fetch", duble as unknown as typeof fetch);
  return { conta, estado, duble };
}

function documentoDaReserva(hosts: Record<string, unknown>) {
  return {
    v: 1,
    gerada_em: "2026-11-26T12:00:00.000Z",
    sha: "0123456789abcdef0123456789abcdef01234567",
    hosts,
  };
}

const RESERVA_CERTA = documentoDaReserva({
  [HOST_A]: { u: ORIGEM_A, k: K_A },
  [HOST_B]: { u: ORIGEM_B, k: K_B },
});

function deps(extra: Partial<DependenciasDaSonda> = {}): DependenciasDaSonda {
  return {
    fetchImpl: ((...args: Parameters<typeof fetch>) =>
      fetch(...args)) as typeof fetch,
    resolverNaCaderneta,
    lerReserva: vi.fn(async () => RESERVA_CERTA),
    janela: { inicio: 0, usados: 0 },
    agora: () => 1_000_000,
    ...extra,
  };
}

function pedido(
  host: string | string[] | null,
  {
    origem = CANDIDATO,
    metodo = "GET",
  }: { origem?: string; metodo?: string } = {},
) {
  const url = new URL(`https://${origem}${CAMINHO_DA_SONDA}`);
  for (const h of host === null ? [] : Array.isArray(host) ? host : [host])
    url.searchParams.append("host", h);
  return new Request(url, { method: metodo });
}

function silenciarLog() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}

/** O corpo NUNCA é página, reserva ou chave: confere o texto cru. */
function semNadaDaLoja(texto: string) {
  expect(texto).not.toMatch(/<!doctype|<html|<body|<meta/i);
  expect(texto).not.toContain("Loja Alfa da Sonda Inventada");
  expect(texto).not.toContain("Loja Beta da Sonda Inventada");
  expect(texto).not.toContain("manutenção");
  expect(texto).not.toContain(K_A);
  expect(texto).not.toContain(K_B);
  expect(texto).not.toContain("sb_publishable");
  expect(texto).not.toContain(SEGREDO_DA_FROTA);
  expect(texto).not.toContain(TOKEN);
  expect(texto).not.toContain("gerada_em");
}

async function json(resp: Response) {
  expect(resp.headers.get("content-type")).toBe(
    "application/json; charset=utf-8",
  );
  expect(resp.headers.get("cache-control")).toBe("no-store");
  const texto = await resp.text();
  semNadaDaLoja(texto);
  return JSON.parse(texto) as Record<string, unknown>;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  get.mockReset();
  createClient.mockClear();
});

// ═══ as três condições ═════════════════════════════════════════════════════

describe("sonda — as três condições juntas, ou a rota não faz nada", () => {
  it("as três presentes: 200 com o JSON da decisão", async () => {
    silenciarLog();
    rede("hit-a");
    const resp = await atenderSonda(pedido(HOST_A), AMBIENTE, deps());
    expect(resp.status).toBe(200);
    expect(await json(resp)).toEqual({
      host: HOST_A,
      porteiro: "ok",
      caderneta: "hit",
      ref: REF_A,
      destinoDaCaderneta: FROTA,
    });
  });

  const faltas: ReadonlyArray<[string, AmbienteDaSonda, string?]> = [
    [
      "sem IKCOUS_SONDA_DO_CANDIDATO",
      { ...AMBIENTE, IKCOUS_SONDA_DO_CANDIDATO: undefined },
    ],
    [
      'IKCOUS_SONDA_DO_CANDIDATO=true (só "1" liga)',
      { ...AMBIENTE, IKCOUS_SONDA_DO_CANDIDATO: "true" },
    ],
    [
      "IKCOUS_SONDA_DO_CANDIDATO=0",
      { ...AMBIENTE, IKCOUS_SONDA_DO_CANDIDATO: "0" },
    ],
    ["VERCEL_ENV=preview", { ...AMBIENTE, VERCEL_ENV: "preview" }],
    ["sem VERCEL_ENV", { ...AMBIENTE, VERCEL_ENV: undefined }],
    ["sem VERCEL_URL", { ...AMBIENTE, VERCEL_URL: undefined }],
    ["VERCEL_URL vazio", { ...AMBIENTE, VERCEL_URL: "" }],
    ["pedido no domínio da loja (host ≠ VERCEL_URL)", AMBIENTE, HOST_A],
    [
      "pedido num alias do projeto (host ≠ VERCEL_URL)",
      AMBIENTE,
      "ikcous-inventado.vercel.app",
    ],
    ["pedido num host que só CONTÉM o VERCEL_URL", AMBIENTE, `x${CANDIDATO}`],
  ];
  for (const [nome, ambiente, origem] of faltas) {
    it(`${nome}: 404 sem perguntar nada a ninguém`, async () => {
      const r = rede("hit-a");
      const d = deps();
      const resp = await atenderSonda(pedido(HOST_A, { origem }), ambiente, d);
      expect(resp.status).toBe(404);
      expect(await json(resp)).toEqual({ sonda: "desligada" });
      expect(r.duble).not.toHaveBeenCalled();
      expect(d.lerReserva).not.toHaveBeenCalled();
      expect(d.janela.usados).toBe(0);
    });
  }

  it("a 404 não diz QUAL condição faltou (mesmo corpo nos três casos)", async () => {
    rede("hit-a");
    const corpos = new Set<string>();
    for (const [ambiente, origem] of [
      [{ ...AMBIENTE, IKCOUS_SONDA_DO_CANDIDATO: undefined }, CANDIDATO],
      [{ ...AMBIENTE, VERCEL_ENV: "preview" }, CANDIDATO],
      [AMBIENTE, HOST_A],
    ] as const) {
      const resp = await atenderSonda(
        pedido(HOST_A, { origem }),
        ambiente,
        deps(),
      );
      corpos.add(await resp.text());
    }
    expect(corpos.size).toBe(1);
  });

  it("VERCEL_URL em maiúsculas ainda casa com o host normalizado", async () => {
    silenciarLog();
    rede("hit-a");
    const resp = await atenderSonda(
      pedido(HOST_A),
      { ...AMBIENTE, VERCEL_URL: CANDIDATO.toUpperCase() },
      deps(),
    );
    expect(resp.status).toBe(200);
  });

  it("método que não é GET: 405, sem perguntar nada", async () => {
    const r = rede("hit-a");
    const d = deps();
    const resp = await atenderSonda(
      pedido(HOST_A, { metodo: "POST" }),
      AMBIENTE,
      d,
    );
    expect(resp.status).toBe(405);
    expect(resp.headers.get("allow")).toBe("GET");
    expect(await json(resp)).toEqual({ sonda: "metodo" });
    expect(r.duble).not.toHaveBeenCalled();
  });
});

// ═══ host inválido ══════════════════════════════════════════════════════════

describe("sonda — host inválido é recusado antes de qualquer pergunta", () => {
  const invalidos: ReadonlyArray<[string, string | string[] | null]> = [
    ["sem host", null],
    ["host vazio", ""],
    ["dois hosts", [HOST_A, HOST_B]],
    ["maiúsculas (não normalizado)", "LOJA-A-SONDA.exemplo"],
    ["ponto final (não normalizado)", `${HOST_A}.`],
    ["com porta", `${HOST_A}:443`],
    ["com protocolo", `https://${HOST_A}`],
    ["com caminho", `${HOST_A}/x`],
    ["com credencial", `eu@${HOST_A}`],
    ["sem ponto", "localhost"],
    ["IPv4", "127.0.0.1"],
    ["IPv6", "[::1]"],
    ["rótulo vazio", "loja..exemplo"],
    ["rótulo começando com hífen", "-loja.exemplo"],
    ["rótulo terminando com hífen", "loja-.exemplo"],
    ["caractere fora do DNS", "loja_a.exemplo"],
    ["espaço", "loja a.exemplo"],
    ["rótulo de 64", `${"a".repeat(64)}.exemplo`],
    [
      "mais de 253",
      `${Array.from({ length: 50 }, () => "abcde").join(".")}.exemplo`,
    ],
    ["unicode cru", "lojá.exemplo"],
  ];
  for (const [nome, host] of invalidos) {
    it(`${nome}: 400, sem caderneta, sem banco, sem reserva`, async () => {
      const r = rede("hit-a");
      const d = deps();
      const resp = await atenderSonda(pedido(host), AMBIENTE, d);
      expect(resp.status).toBe(400);
      expect(await json(resp)).toEqual({ sonda: "host-invalido" });
      expect(r.duble).not.toHaveBeenCalled();
      expect(d.lerReserva).not.toHaveBeenCalled();
      expect(d.janela.usados).toBe(0);
    });
  }

  it("host válido com punycode e rótulo de 63 passa", async () => {
    silenciarLog();
    rede("miss");
    for (const host of ["xn--loj-ela.exemplo", `${"a".repeat(63)}.exemplo`]) {
      const resp = await atenderSonda(pedido(host), AMBIENTE, deps());
      expect(resp.status).toBe(200);
      expect((await json(resp)).host).toBe(host);
    }
  });
});

// ═══ o que a sonda devolve ═════════════════════════════════════════════════

describe("sonda — só a decisão, nunca a página", () => {
  it("caderneta falha (503), sem ficha: caderneta reserva, porteiro ok, ref do banco da reserva", async () => {
    silenciarLog();
    rede("503");
    const d = deps();
    const resp = await atenderSonda(pedido(HOST_B), AMBIENTE, d);
    expect(resp.status).toBe(200);
    expect(await json(resp)).toEqual({
      host: HOST_B,
      porteiro: "ok",
      caderneta: "reserva",
      ref: REF_B,
      destinoDaCaderneta: FROTA,
    });
    expect(d.lerReserva).toHaveBeenCalledTimes(1);
  });

  it("reserva aponta A para o banco de B: porteiro discorda, e NADA da página de manutenção nem de B", async () => {
    silenciarLog();
    rede("503");
    const envenenada = documentoDaReserva({
      [HOST_A]: { u: ORIGEM_B, k: K_B },
    });
    const resp = await atenderSonda(
      pedido(HOST_A),
      AMBIENTE,
      deps({ lerReserva: vi.fn(async () => envenenada) }),
    );
    // A sonda RESPONDEU (200): a decisão do porteiro é o conteúdo, não o status.
    expect(resp.status).toBe(200);
    expect(await json(resp)).toEqual({
      host: HOST_A,
      porteiro: "discorda",
      caderneta: "reserva",
      ref: null,
      destinoDaCaderneta: FROTA,
    });
  });

  it("caderneta falha e a reserva também: banco-indisponivel com erro", async () => {
    silenciarLog();
    rede("503");
    const resp = await atenderSonda(
      pedido(HOST_A),
      AMBIENTE,
      deps({
        lerReserva: vi.fn(async () => {
          throw new Error(`reserva da caderneta indisponivel ${TOKEN}`);
        }),
      }),
    );
    expect(await json(resp)).toEqual({
      host: HOST_A,
      porteiro: "banco-indisponivel",
      caderneta: "erro",
      ref: null,
      destinoDaCaderneta: FROTA,
    });
  });

  it("host desconhecido (miss): sem-loja, sem a página", async () => {
    silenciarLog();
    rede("miss");
    const resp = await atenderSonda(
      pedido("ninguem-sonda.exemplo"),
      AMBIENTE,
      deps(),
    );
    expect(await json(resp)).toEqual({
      host: "ninguem-sonda.exemplo",
      porteiro: "sem-loja",
      caderneta: "miss",
      ref: null,
      destinoDaCaderneta: FROTA,
    });
  });

  it("loja adormecida: a decisão, sem o nome da loja", async () => {
    silenciarLog();
    rede("adormecida");
    const resp = await atenderSonda(pedido(HOST_A), AMBIENTE, deps());
    expect(await json(resp)).toEqual({
      host: HOST_A,
      porteiro: "adormecida",
      caderneta: "hit",
      ref: null,
      destinoDaCaderneta: FROTA,
    });
  });

  it("a sonda num alias .vercel.app da loja: encaminha, sem Location na resposta", async () => {
    silenciarLog();
    rede("503");
    const alias = "loja-a-sonda-inventada.vercel.app";
    const resp = await atenderSonda(
      pedido(alias),
      AMBIENTE,
      deps({
        lerReserva: vi.fn(async () =>
          documentoDaReserva({ [alias]: { u: ORIGEM_A, k: K_A } }),
        ),
      }),
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("location")).toBeNull();
    expect((await json(resp)).porteiro).toBe("encaminha");
  });

  it("destinoDaCaderneta é SÓ o nome do host: nada de caminho, consulta ou credencial da variável", async () => {
    silenciarLog();
    rede("hit-a");
    const resp = await atenderSonda(
      pedido(HOST_A),
      {
        ...AMBIENTE,
        IKCOUS_FROTA_URL: `https://usuario:${TOKEN}@${FROTA}/caminho?token=${TOKEN}`,
      },
      deps(),
    );
    expect((await json(resp)).destinoDaCaderneta).toBe(FROTA);
  });

  it("caderneta apontada para um destino que não resolve (prova 1): destino aparece, caderneta reserva", async () => {
    silenciarLog();
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === "caderneta-errada.invalid")
        throw new TypeError("fetch failed");
      const loja = LOJAS[url.origin];
      if (loja && url.pathname === "/rest/v1/v_store_config")
        return url.searchParams.get("select") === SELECT_CONFIGURACAO_PUBLICA
          ? Response.json([
              {
                dominio_publico: loja.dominio,
                mp_public_key: null,
                vapid_public_key: null,
                pagamento_online: false,
                manutencao: false,
              },
            ])
          : Response.json([linhaDaLoja(loja.nome, url.origin)]);
      throw new Error(`rede proibida no teste: ${url.toString()}`);
    }) as typeof fetch);
    const resp = await atenderSonda(
      pedido(HOST_A),
      { ...AMBIENTE, IKCOUS_FROTA_URL: "https://caderneta-errada.invalid" },
      deps(),
    );
    expect(await json(resp)).toEqual({
      host: HOST_A,
      porteiro: "ok",
      caderneta: "reserva",
      ref: REF_A,
      destinoDaCaderneta: "caderneta-errada.invalid",
    });
  });

  it("caderneta não configurada: destino null e caderneta ausente", async () => {
    silenciarLog();
    rede("hit-a");
    const resp = await atenderSonda(
      pedido(HOST_A),
      { ...AMBIENTE, IKCOUS_FROTA_URL: undefined },
      deps(),
    );
    const corpo = await json(resp);
    expect(corpo.destinoDaCaderneta).toBeNull();
    expect(corpo.caderneta).toBe("ausente");
  });

  it("a resposta tem SÓ as cinco chaves, com valores curtos", async () => {
    silenciarLog();
    rede("hit-a");
    const corpo = await json(
      await atenderSonda(pedido(HOST_A), AMBIENTE, deps()),
    );
    expect(Object.keys(corpo).sort()).toEqual(
      ["caderneta", "destinoDaCaderneta", "host", "porteiro", "ref"].sort(),
    );
    for (const valor of Object.values(corpo))
      if (typeof valor === "string")
        expect(valor.length).toBeLessThanOrEqual(253);
  });
});

// ═══ cache novo ════════════════════════════════════════════════════════════

describe("sonda — cache novo a cada pedido", () => {
  it("a ficha de uma sonda não responde pela seguinte: a caderneta é perguntada de novo", async () => {
    silenciarLog();
    const r = rede("hit-a");
    const d = deps();
    const primeira = await json(
      await atenderSonda(pedido(HOST_A), AMBIENTE, d),
    );
    expect(primeira.caderneta).toBe("hit");
    // Mesma instância, mesmo instante: com cache compartilhado, a 2ª seria "hit".
    r.estado.modo = "503";
    const segunda = await json(await atenderSonda(pedido(HOST_A), AMBIENTE, d));
    expect(segunda.caderneta).toBe("reserva");
    expect(r.conta.caderneta).toBe(2);
  });

  it('o "não achei" de uma sonda não fica guardado para a seguinte', async () => {
    silenciarLog();
    const r = rede("miss");
    // Reserva vazia: o "não achei" de um host que ela conhece abriria pela
    // reserva (T4), e aqui o assunto é só o cache do "não achei".
    const d = deps({ lerReserva: vi.fn(async () => documentoDaReserva({})) });
    expect(
      (await json(await atenderSonda(pedido(HOST_A), AMBIENTE, d))).porteiro,
    ).toBe("sem-loja");
    r.estado.modo = "hit-a";
    expect(
      (await json(await atenderSonda(pedido(HOST_A), AMBIENTE, d))).porteiro,
    ).toBe("ok");
  });
});

// ═══ teto por minuto ═══════════════════════════════════════════════════════

describe("sonda — teto por instância: um visitante não vira martelo", () => {
  it(`passa de ${TETO_DA_SONDA_POR_JANELA} na mesma janela: 429 sem perguntar nada, e a janela seguinte reabre`, async () => {
    silenciarLog();
    const r = rede("miss");
    let agora = 5_000_000;
    const d = deps({ agora: () => agora });
    for (let i = 0; i < TETO_DA_SONDA_POR_JANELA; i += 1)
      expect((await atenderSonda(pedido(HOST_A), AMBIENTE, d)).status).toBe(
        200,
      );
    const perguntasAntes = r.conta.caderneta;
    const barrada = await atenderSonda(pedido(HOST_A), AMBIENTE, d);
    expect(barrada.status).toBe(429);
    expect(barrada.headers.get("retry-after")).toBe("60");
    expect(await json(barrada)).toEqual({ sonda: "limite" });
    expect(r.conta.caderneta).toBe(perguntasAntes);

    agora += JANELA_DA_SONDA_MS;
    expect((await atenderSonda(pedido(HOST_A), AMBIENTE, d)).status).toBe(200);
  });
});

// ═══ ligada no middleware real ═════════════════════════════════════════════

function ambienteDoProcesso(extra: Record<string, string | undefined>) {
  for (const [chave, valor] of Object.entries({
    ...AMBIENTE,
    VITE_SUPABASE_URL: undefined,
    VITE_SUPABASE_PUBLISHABLE_KEY: undefined,
    VITE_SUPABASE_ANON_KEY: undefined,
    IKCOUS_DOMINIO_PRINCIPAL: undefined,
    GLOBAL_CONFIG: undefined,
    EDGE_CONFIG: undefined,
    ...extra,
  }))
    vi.stubEnv(chave, valor);
}

let sequencia = 0;
function conexaoNova(): string {
  sequencia += 1;
  return `https://global-config.vercel.com/ecfg_sonda${sequencia}?token=${TOKEN}`;
}

describe("middleware real — a rota da sonda", () => {
  it("o matcher da borda casa o caminho da sonda (senão a rota nunca roda)", () => {
    expect(ehCaminhoDeDocumento(CAMINHO_DA_SONDA)).toBe(true);
  });

  it("candidato com as três condições: o JSON da sonda, pela reserva da Global Config", async () => {
    silenciarLog();
    ambienteDoProcesso({ GLOBAL_CONFIG: conexaoNova() });
    get.mockResolvedValue(RESERVA_CERTA);
    rede("503");
    const resp = await middleware(pedido(HOST_A));
    expect(resp.status).toBe(200);
    expect(await json(resp)).toEqual({
      host: HOST_A,
      porteiro: "ok",
      caderneta: "reserva",
      ref: REF_A,
      destinoDaCaderneta: FROTA,
    });
  });

  it("muitas sondas na mesma instância: a Global Config é lida UMA vez (o cache do leitor vale)", async () => {
    silenciarLog();
    ambienteDoProcesso({ GLOBAL_CONFIG: conexaoNova() });
    get.mockResolvedValue(RESERVA_CERTA);
    rede("503");
    for (const host of [HOST_A, HOST_B, HOST_A, HOST_B, HOST_A])
      expect((await json(await middleware(pedido(host)))).caderneta).toBe(
        "reserva",
      );
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("no domínio da loja, a mesma rota é 404 e não toca a caderneta nem a Global Config", async () => {
    ambienteDoProcesso({ GLOBAL_CONFIG: conexaoNova() });
    get.mockResolvedValue(RESERVA_CERTA);
    const r = rede("hit-a");
    const resp = await middleware(pedido(HOST_B, { origem: HOST_A }));
    expect(resp.status).toBe(404);
    expect(await json(resp)).toEqual({ sonda: "desligada" });
    expect(r.duble).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("deploy sem a variável da sonda: 404 também no próprio .vercel.app", async () => {
    ambienteDoProcesso({ IKCOUS_SONDA_DO_CANDIDATO: undefined });
    const r = rede("hit-a");
    const resp = await middleware(pedido(HOST_A));
    expect(resp.status).toBe(404);
    expect(r.duble).not.toHaveBeenCalled();
  });
});
