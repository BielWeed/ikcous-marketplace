// O gancho do contador DENTRO do porteiro (spec "visitas da loja", decisao 4):
// `atenderPorteiro` avisa `contarEntrada(conexao da ficha, request)` DEPOIS que
// o documento da loja saiu com 200 -- e so nele. O que dói aqui:
//   - contar uma pagina que a pessoa nao recebeu (503, loja em manutencao);
//   - contar o que nao e' pagina (HEAD, arquivo, /api/, robots, sitemap);
//   - a conta quebrar a pagina (callback que lanca nao pode mudar um byte);
//   - gravar no banco errado (a conexao tem de ser a da ficha DESTE host).
// `fetch` e' dublê -- nunca rede de verdade.
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConexaoDaLoja } from "@/config/fichaDaLojaContract";
import {
  SELECT_CONFIGURACAO_PUBLICA,
  atenderPorteiro,
} from "@/hospedagem/porteiro";
import type {
  AmbientePorteiro,
  DependenciasPorteiro,
  EntradaCachePorteiro,
} from "@/hospedagem/porteiro";

afterEach(() => {
  vi.restoreAllMocks();
});

const HTML_ASSADO = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Loja Fixture | Lugar Nenhum</title>
<meta name="description" content="Produtos e novidades de Loja Fixture" />
<style id="dynamic-branding-style">:root {--primary-color:#000000;}</style>
</head>
<body>
<div class="cinematic-text">Loja Fixture</div>
</body>
</html>`;

const MANIFEST_ASSADO = {
  name: "IKCOUS Marketplace",
  short_name: "IKCOUS",
  icons: [{ src: "/i.png", sizes: "192x192", type: "image/png" }],
};

function linhaFixture(nome: string, primary: string, origin: string) {
  const hash = "a".repeat(64);
  const asset = (arquivo: string, largura: number, altura: number) => ({
    path: `v1/${hash}/${arquivo}.png`,
    sha256: hash,
    media_type: "image/png",
    bytes: 100,
    width: largura,
    height: altura,
  });
  const header = asset("header", 64, 64);
  return {
    store_name: nome,
    store_city: null,
    store_state: null,
    logo_url: `${origin}/storage/v1/object/public/branding/${header.path}`,
    primary_color: primary,
    secondary_color: "#654321",
    accent_color: "#ABCDEF",
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

interface BancoFake {
  readonly nome: string;
  readonly dominioPublico: string;
  readonly manutencao?: boolean;
}

const ORIGEM_A = "https://projetoaaaaaaaaaaaaa.supabase.co";
const ORIGEM_B = "https://projetobbbbbbbbbbbbb.supabase.co";

function criarFetchDuble(
  bancos: Record<string, BancoFake>,
  opcoes: { statusDoDocumento?: number } = {},
): typeof fetch {
  const json = (corpo: unknown) =>
    new Response(JSON.stringify(corpo), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  return (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/index.html")
      return new Response(HTML_ASSADO, {
        status: opcoes.statusDoDocumento ?? 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    if (url.pathname === "/manifest.webmanifest") return json(MANIFEST_ASSADO);
    const banco = bancos[url.origin];
    if (url.pathname === "/rest/v1/vw_produtos_public") return json([]);
    if (url.pathname === "/rest/v1/banners") return json([]);
    if (url.pathname === "/rest/v1/v_store_config") {
      if (!banco) return new Response("erro", { status: 500 });
      if (url.searchParams.get("select") === SELECT_CONFIGURACAO_PUBLICA)
        return json([
          {
            dominio_publico: banco.dominioPublico,
            mp_public_key: null,
            vapid_public_key: null,
            pagamento_online: false,
            manutencao: banco.manutencao ?? false,
          },
        ]);
      return json([linhaFixture(banco.nome, "#111111", url.origin)]);
    }
    throw new Error(`URL não mapeada no dublê de teste: ${url.toString()}`);
  }) as typeof fetch;
}

const AMBIENTE_A: AmbientePorteiro = {
  VITE_SUPABASE_URL: ORIGEM_A,
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a",
};
const AMBIENTE_B: AmbientePorteiro = {
  VITE_SUPABASE_URL: ORIGEM_B,
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_b",
};

const BANCOS: Record<string, BancoFake> = {
  [ORIGEM_A]: { nome: "Loja A", dominioPublico: "loja-a.exemplo" },
  [ORIGEM_B]: { nome: "Loja B", dominioPublico: "loja-b.exemplo" },
};

function deps(
  fetchImpl: typeof fetch,
  extra: Partial<DependenciasPorteiro> = {},
): DependenciasPorteiro {
  return {
    fetchImpl,
    cache: new Map<string, EntradaCachePorteiro>(),
    ...extra,
  };
}

function pedido(host: string, caminho = "/", init: RequestInit = {}) {
  return new Request(`https://${host}${caminho}`, init);
}

describe("atenderPorteiro + contarEntrada -- o que conta", () => {
  it("GET / com 200 chama contarEntrada UMA vez, com a conexao da ficha e o proprio request", async () => {
    const contarEntrada = vi.fn();
    const request = pedido("loja-a.exemplo");
    const resp = await atenderPorteiro(
      request,
      AMBIENTE_A,
      deps(criarFetchDuble(BANCOS), { contarEntrada }),
    );
    expect(resp.status).toBe(200);
    expect(contarEntrada).toHaveBeenCalledTimes(1);
    const [conexao, recebido] = contarEntrada.mock.calls[0] as [
      ConexaoDaLoja,
      Request,
    ];
    expect(conexao).toEqual({
      supabaseUrl: ORIGEM_A,
      publishableKey: "sb_publishable_a",
    });
    expect(recebido).toBe(request);
  });

  it("ISOLAMENTO: o host B passa a conexao de B, o host A a de A -- nunca a do outro", async () => {
    const contarEntrada = vi.fn();
    const dependencias = deps(criarFetchDuble(BANCOS), { contarEntrada });
    await atenderPorteiro(pedido("loja-a.exemplo"), AMBIENTE_A, dependencias);
    await atenderPorteiro(pedido("loja-b.exemplo"), AMBIENTE_B, dependencias);
    const conexoes = contarEntrada.mock.calls.map(
      (c) => (c[0] as ConexaoDaLoja).supabaseUrl,
    );
    const chaves = contarEntrada.mock.calls.map(
      (c) => (c[0] as ConexaoDaLoja).publishableKey,
    );
    expect(conexoes).toEqual([ORIGEM_A, ORIGEM_B]);
    expect(chaves).toEqual(["sb_publishable_a", "sb_publishable_b"]);
  });

  it("a abertura de navegador (com cartaz possivel) tambem chama so UMA vez", async () => {
    const contarEntrada = vi.fn();
    await atenderPorteiro(
      pedido("loja-a.exemplo", "/", {
        headers: {
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
        },
      }),
      AMBIENTE_A,
      deps(criarFetchDuble(BANCOS), { contarEntrada }),
    );
    expect(contarEntrada).toHaveBeenCalledTimes(1);
  });
});

describe("atenderPorteiro + contarEntrada -- o que NAO chama", () => {
  it("HEAD nao chama (o porteiro o atende como GET, mas nao e' uma pessoa abrindo a loja)", async () => {
    const contarEntrada = vi.fn();
    const resp = await atenderPorteiro(
      pedido("loja-a.exemplo", "/", { method: "HEAD" }),
      AMBIENTE_A,
      deps(criarFetchDuble(BANCOS), { contarEntrada }),
    );
    expect(resp.status).toBe(200);
    expect(contarEntrada).not.toHaveBeenCalled();
  });

  it("POST (pass-through) nao chama", async () => {
    const contarEntrada = vi.fn();
    await atenderPorteiro(
      pedido("loja-a.exemplo", "/", { method: "POST", body: "x" }),
      AMBIENTE_A,
      deps(criarFetchDuble(BANCOS), { contarEntrada }),
    );
    expect(contarEntrada).not.toHaveBeenCalled();
  });

  it.each([
    "/x.txt",
    "/api/x",
    "/.well-known/x",
    "/robots.txt",
    "/sitemap.xml",
    "/identidade.json",
    "/manifest.webmanifest",
  ])("a rota %s nao chama", async (caminho) => {
    const contarEntrada = vi.fn();
    const resp = await atenderPorteiro(
      pedido("loja-a.exemplo", caminho),
      AMBIENTE_A,
      deps(criarFetchDuble(BANCOS), { contarEntrada }),
    );
    expect(resp.status).toBe(200);
    expect(contarEntrada).not.toHaveBeenCalled();
  });

  it("503 discorda (o banco diz que o dominio e' de outra loja) nao chama", async () => {
    const contarEntrada = vi.fn();
    const resp = await atenderPorteiro(
      pedido("loja-a.exemplo"),
      AMBIENTE_A,
      deps(
        criarFetchDuble({
          [ORIGEM_A]: { nome: "Loja A", dominioPublico: "outra.exemplo" },
        }),
        { contarEntrada },
      ),
    );
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("discorda");
    expect(contarEntrada).not.toHaveBeenCalled();
  });

  it("503 sem-loja (host que ninguem conhece) nao chama", async () => {
    const contarEntrada = vi.fn();
    const resp = await atenderPorteiro(
      pedido("host-que-nao-existe.exemplo"),
      {},
      deps(criarFetchDuble({}), { contarEntrada }),
    );
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("sem-loja");
    expect(contarEntrada).not.toHaveBeenCalled();
  });

  it("503 html-indisponivel (documento estatico fora do ar) nao chama", async () => {
    const contarEntrada = vi.fn();
    const resp = await atenderPorteiro(
      pedido("loja-a.exemplo"),
      AMBIENTE_A,
      deps(criarFetchDuble(BANCOS, { statusDoDocumento: 500 }), {
        contarEntrada,
      }),
    );
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("html-indisponivel");
    expect(contarEntrada).not.toHaveBeenCalled();
  });

  it("loja em manutencao (documento sai 200, mas a vitrine nao abre) nao chama", async () => {
    const contarEntrada = vi.fn();
    const resp = await atenderPorteiro(
      pedido("loja-a.exemplo"),
      AMBIENTE_A,
      deps(
        criarFetchDuble({
          [ORIGEM_A]: {
            nome: "Loja A",
            dominioPublico: "loja-a.exemplo",
            manutencao: true,
          },
        }),
        { contarEntrada },
      ),
    );
    expect(resp.status).toBe(200);
    expect(contarEntrada).not.toHaveBeenCalled();
  });
});

async function fotografar(resp: Response) {
  return {
    status: resp.status,
    cabecalhos: [...resp.headers.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    ),
    corpo: await resp.text(),
  };
}

describe("atenderPorteiro + contarEntrada -- a conta nunca muda a pagina", () => {
  it("contarEntrada que LANCA deixa a resposta byte a byte igual a de sem contador", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const controle = await fotografar(
      await atenderPorteiro(
        pedido("loja-a.exemplo"),
        AMBIENTE_A,
        deps(criarFetchDuble(BANCOS)),
      ),
    );
    const contarEntrada = vi.fn(() => {
      throw new Error("a conta quebrou");
    });
    const comContadorQuebrado = await fotografar(
      await atenderPorteiro(
        pedido("loja-a.exemplo"),
        AMBIENTE_A,
        deps(criarFetchDuble(BANCOS), { contarEntrada }),
      ),
    );
    expect(contarEntrada).toHaveBeenCalledTimes(1);
    expect(comContadorQuebrado).toEqual(controle);
    expect(controle.status).toBe(200);
    expect(controle.corpo).toContain("<title>Loja A</title>");
    expect(erro).toHaveBeenCalled();
  });

  it("CONTROLE: sem contarEntrada a resposta e' a de hoje (200, porteiro ok, ficha injetada)", async () => {
    const resp = await atenderPorteiro(
      pedido("loja-a.exemplo"),
      AMBIENTE_A,
      deps(criarFetchDuble(BANCOS)),
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("ok");
    expect(await resp.text()).toContain("<title>Loja A</title>");
  });

  it("contarEntrada que funciona tambem nao muda um byte da resposta", async () => {
    const controle = await fotografar(
      await atenderPorteiro(
        pedido("loja-a.exemplo"),
        AMBIENTE_A,
        deps(criarFetchDuble(BANCOS)),
      ),
    );
    const contarEntrada = vi.fn();
    const comContador = await fotografar(
      await atenderPorteiro(
        pedido("loja-a.exemplo"),
        AMBIENTE_A,
        deps(criarFetchDuble(BANCOS), { contarEntrada }),
      ),
    );
    expect(comContador).toEqual(controle);
  });
});
