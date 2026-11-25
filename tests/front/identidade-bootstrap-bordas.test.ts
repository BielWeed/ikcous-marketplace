/* eslint-disable security/detect-non-literal-fs-filename -- Só pastas criadas por mkdtemp neste arquivo são lidas ou escritas. */
// Caça por mutação em scripts/identidade-bootstrap.mjs (25/11/2026): 48 dos 78
// defeitos de uma linha sobreviviam ao teste do lançador. Aqui entram as bordas
// que ele não segura: a tradução de cada tipo de erro em código de saída, a
// mensagem de cada recusa, a regra do --saida e do --subidos, o texto "modo", as
// variáveis de ambiente faltando UMA a UMA, os nomes de loja reservados, o que o
// alvo novo manda pela rede e o rodapé que roda o comando.
//
// Tudo em memória: o núcleo entra já carregado, as portas são falsas e o fetch é
// um dublê. Nenhum banco, nenhum CLI, nenhuma rede. Valores inventados.
//
// Mutantes equivalentes (nenhum teste os derruba, e não precisa):
//  - `persistSession: false` -> `true` no cliente do alvo novo: sem sessão, o
//    supabase-js em Node não faz nenhuma chamada de rede a mais por causa disso.
//  - tirar "ikcous-publicada" de `alvosReservados`: o nome continua recusado
//    pela terceira condição de conferirAlvoNovo, porque scripts/frota/
//    canais-de-backend.json já traz um canal com `migrations` igual a ele (a
//    redundância some, e este mutante passa a morrer, se esse canal sair).
//  - os dois de `remover`/`path.win32.join` anotados em
//    identidade-bootstrap-portas-reais.test.ts.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ehConflito409,
  interpretarResultadoCp,
  principal,
  quotarComando,
} from "../../scripts/identidade-bootstrap.mjs";
import * as nucleo from "../../scripts/identidadeBootstrap";
import { createIdentityBuildFixture } from "../../scripts/identityBuildFixture";

const { CODIGOS_DE_SAIDA, BootstrapError, lerKit, montarIdentidade } = nucleo;
// Cada caso monta um kit sintético em disco (1 a 4 s); o padrão de 5 s é curto.
vi.setConfig({ testTimeout: 30_000 });
const SCRIPT = fileURLToPath(
  new URL("../../scripts/identidade-bootstrap.mjs", import.meta.url),
);
const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
const ANON_KEY = "sb_publishable_fixture_only";
const REF_NOVA = "abcdefghijklmnopqrst";
const DOMINIO = "loja-ensaio.example";
const CHAVE_SERVICO = "chave-privilegiada-ficticia";
const URL_DE_BANCO_FALSA = ["postgresql:", "//u:SENHA@h/db"].join("");
const valoresBase = {
  store_name: "Loja Ensaio",
  primary_color: "#18181B",
  secondary_color: "#059669",
  accent_color: "#F4F4F5",
  store_city: null,
  store_state: null,
};
const identidadeNula = {
  store_name: null,
  store_city: null,
  store_state: null,
  primary_color: null,
  secondary_color: null,
  accent_color: null,
  logo_url: null,
  branding_assets: null,
};
const linhaNula = { revision: "0", identity: identidadeNula };

let dir: string;
const argvOriginal = [...process.argv];
const exitCodeOriginal = process.exitCode;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ident-bordas-"));
});
afterEach(async () => {
  process.argv = [...argvOriginal];
  process.exitCode = exitCodeOriginal;
  await fs.rm(dir, { recursive: true, force: true });
});

const envLegado = (extra: Record<string, string | undefined> = {}) => ({
  DATABASE_URL: URL_DE_BANCO_FALSA,
  VITE_SUPABASE_URL: SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: ANON_KEY,
  ...extra,
});
const envNovo = (extra: Record<string, string | undefined> = {}) => ({
  VITE_SUPABASE_URL: SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: CHAVE_SERVICO,
  ...extra,
});

async function kitSintetico(loja: string) {
  const fixture = await createIdentityBuildFixture("aurora");
  const kitRoot = path.join(dir, "kit");
  await fs.mkdir(path.join(kitRoot, loja), { recursive: true });
  await fs.writeFile(
    path.join(kitRoot, "manifesto.json"),
    JSON.stringify({ scope: "local-preparation" }),
  );
  await fs.writeFile(
    path.join(kitRoot, loja, "branding-assets.json"),
    JSON.stringify(fixture.identity.assets),
  );
  for (const file of fixture.files) {
    const nome = file.path.split("/")[2];
    await fs.mkdir(path.join(kitRoot, "objetos", file.sha256), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(kitRoot, "objetos", file.sha256, nome),
      file.bytes,
    );
  }
  const valores = path.join(dir, "valores.json");
  await fs.writeFile(valores, JSON.stringify(valoresBase));
  return { kitRoot, valores };
}

// Servidor falso em memória: objetos do bucket + a linha da identidade.
function servidorFalso(inicial: { revision: string; identity: unknown }) {
  const bucket = new Map<string, { bytes: Uint8Array; mime: string }>();
  let linha = inicial;
  const chamadas: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const prefixo = "/storage/v1/object/public/branding/";
    if (url.pathname.startsWith(prefixo)) {
      const objeto = bucket.get(url.pathname.slice(prefixo.length));
      if (!objeto) return new Response("nao existe", { status: 404 });
      return new Response(Buffer.from(objeto.bytes), {
        status: 200,
        headers: {
          "content-type": objeto.mime,
          "content-length": String(objeto.bytes.length),
        },
      });
    }
    if (url.pathname === "/rest/v1/v_store_config") {
      return new Response(
        JSON.stringify([(linha as { identity: unknown }).identity]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return new Response(`rota inesperada ${url.pathname}`, { status: 500 });
  }) as typeof fetch;
  const banco = {
    async ler() {
      chamadas.push("ler");
      return linha;
    },
    async gravar(_rev: string, _esperado: unknown, desejado: unknown) {
      chamadas.push("gravar");
      linha = {
        revision: String(Number(linha.revision) + 1),
        identity: desejado,
      };
      return linha;
    },
  };
  const storage = {
    async subir(objeto: { path: string; arquivo: string; mime: string }) {
      chamadas.push(`subir:${objeto.path}`);
      bucket.set(objeto.path, {
        bytes: await fs.readFile(objeto.arquivo),
        mime: objeto.mime,
      });
    },
    async remover(paths: string[]) {
      chamadas.push(`remover:${paths.length}`);
      for (const p of paths) bucket.delete(p);
    },
  };
  return { banco, storage, fetchImpl, bucket, chamadas, linha: () => linha };
}

async function rodar(
  argv: string[],
  env: Record<string, string | undefined>,
  fabricas: Record<string, unknown> = {},
) {
  const logs: string[] = [];
  const errs: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a) => {
    logs.push(a.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a) => {
    errs.push(a.map(String).join(" "));
  });
  const exit = await principal(argv, env, {
    carregarNucleo: async () => nucleo,
    ...fabricas,
  });
  return { exit, logs, errs, texto: errs.join("\n") };
}
const comServidor = (s: ReturnType<typeof servidorFalso>) => ({
  portaBanco: () => s.banco,
  portaStorage: () => s.storage,
  fetchImpl: s.fetchImpl,
});
const argvLegado = (kitRoot: string, valores: string, extra: string[] = []) => [
  "--kit",
  kitRoot,
  "--loja",
  "ikcous",
  "--valores",
  valores,
  "--workdir-supabase",
  path.join(dir, "workdir"),
  ...extra,
];

// ---------------------------------------------------------------------------
describe("funções puras do lançador", () => {
  it("quotarComando: aspa interna dobrada; 'npx' só fica sem aspas na posição 0", () => {
    expect(quotarComando(["npx", 'a"b'])).toBe('npx "a""b"');
    expect(quotarComando(["C:\\Program Files\\npx.cmd", "npx"])).toBe(
      '"C:\\Program Files\\npx.cmd" "npx"',
    );
    expect(quotarComando(["a", "b c"])).toBe('"a" "b c"');
  });

  it("ehConflito409: 409 inteiro, com ou sem aspas e com espaços, nunca 4090", () => {
    expect(ehConflito409('{"statusCode":409}')).toBe(true);
    expect(ehConflito409('{"statusCode":"409"}')).toBe(true);
    expect(ehConflito409('{"statusCode" : 409}')).toBe(true);
    expect(ehConflito409('{"statusCode":4090}')).toBe(false);
    expect(ehConflito409('{"statusCode":"40900"}')).toBe(false);
    expect(ehConflito409('{"statusCode":404}')).toBe(false);
  });

  it("interpretarResultadoCp: status nulo (morto por sinal) é falha; a saída crua prefere stderr", () => {
    expect(
      interpretarResultadoCp({ status: 0, stdout: "O", stderr: "E" }),
    ).toEqual({ desfecho: "ok", stdout: "O" });
    expect(
      interpretarResultadoCp({ status: null, stdout: "", stderr: "E" }),
    ).toEqual({ desfecho: "falha", saidaCrua: "E" });
    expect(
      interpretarResultadoCp({ status: 1, stdout: "O", stderr: "E" }),
    ).toEqual({ desfecho: "falha", saidaCrua: "E" });
    expect(
      interpretarResultadoCp({ status: 1, stdout: "O", stderr: "" }),
    ).toEqual({ desfecho: "falha", saidaCrua: "O" });
    expect(interpretarResultadoCp({ status: 1 })).toEqual({
      desfecho: "falha",
      saidaCrua: "",
    });
  });
});

// ---------------------------------------------------------------------------
describe("principal: recusas antes de tocar qualquer coisa", () => {
  const argvNovo = (slug = "loja-ensaio") => [
    "--kit",
    path.join("inexistente", "kit"),
    "--alvo-novo",
    slug,
    "--ref",
    REF_NOVA,
    "--dominio",
    DOMINIO,
    "--valores",
    path.join("inexistente", "v.json"),
  ];

  it.each([
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ])("alvo novo sem SÓ %s já recusa (entrada)", async (faltando) => {
    const r = await rodar(argvNovo(), envNovo({ [faltando]: undefined }));
    expect(r.exit).toBe(CODIGOS_DE_SAIDA.entrada);
    expect(r.texto).toContain(
      "alvo novo exige VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY",
    );
  });

  it.each(["DATABASE_URL", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"])(
    "modo legado sem SÓ %s já recusa (entrada)",
    async (faltando) => {
      const argv = argvLegado(
        path.join("inexistente", "kit"),
        path.join("inexistente", "v.json"),
      );
      const r = await rodar(argv, envLegado({ [faltando]: undefined }));
      expect(r.exit).toBe(CODIGOS_DE_SAIDA.entrada);
      expect(r.texto).toContain(
        "faltam DATABASE_URL, VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY no ambiente",
      );
    },
  );

  it("VITE_SUPABASE_URL que não é URL: mensagem própria, sem repetir o valor", async () => {
    const argv = argvLegado(
      path.join("inexistente", "kit"),
      path.join("inexistente", "v.json"),
    );
    const r = await rodar(
      argv,
      envLegado({ VITE_SUPABASE_URL: "valor-que-nao-e-url-123" }),
    );
    expect(r.exit).toBe(CODIGOS_DE_SAIDA.entrada);
    expect(r.texto).toContain("VITE_SUPABASE_URL invalida");
    expect(r.texto).not.toContain("valor-que-nao-e-url-123");
  });

  it.each(["ikcous", "ikcous-publicada", "savy", "loja", "sandbox"])(
    "nome reservado %s não pode ser alvo novo",
    async (slug) => {
      const r = await rodar(argvNovo(slug), envNovo());
      expect(r.exit).toBe(CODIGOS_DE_SAIDA.entrada);
      expect(r.texto).toContain(
        "--alvo-novo nao pode usar o alvo ou projeto de outra loja conhecida",
      );
    },
  );

  it("o núcleo que não carrega sai com 1 e a causa sai mascarada", async () => {
    const r = await rodar(argvNovo(), envNovo(), {
      carregarNucleo: async () => {
        throw new Error(`explodiu em ${URL_DE_BANCO_FALSA} agora`);
      },
    });
    expect(r.exit).toBe(1);
    expect(r.texto).toContain("inesperado:");
    expect(r.texto).toContain("<url-mascarada>");
    expect(r.texto).not.toContain("SENHA");
  });
});

// ---------------------------------------------------------------------------
describe("principal: tradução do erro em código de saída e em mensagem", () => {
  async function desfazerComErroNaGravacao(erro: unknown) {
    const { kitRoot, valores } = await kitSintetico("ikcous");
    const kit = await lerKit(kitRoot, "ikcous");
    const desired = montarIdentidade(kit, valoresBase, SUPABASE_URL);
    const s = servidorFalso({ revision: "1", identity: desired });
    s.banco.gravar = async () => {
      throw erro;
    };
    return rodar(
      argvLegado(kitRoot, valores, ["--desfazer", "--aplicar"]),
      envLegado(),
      comServidor(s),
    );
  }

  it.each([
    ["CONFLITO", CODIGOS_DE_SAIDA.conflito],
    ["ESTADO", CODIGOS_DE_SAIDA.recusa],
    ["UPLOAD", CODIGOS_DE_SAIDA.upload],
    ["CONFERENCIA", CODIGOS_DE_SAIDA.upload],
    ["PROVA", CODIGOS_DE_SAIDA.prova],
    ["VALORES", CODIGOS_DE_SAIDA.entrada],
  ])("BootstrapError %s sai com o código próprio", async (codigo, esperado) => {
    const r = await desfazerComErroNaGravacao(
      new BootstrapError(
        codigo as never,
        `falhou em ${URL_DE_BANCO_FALSA} fim`,
      ),
    );
    expect(r.exit).toBe(esperado);
    expect(r.texto).toContain(`${codigo}: falhou em <url-mascarada> fim`);
    expect(r.texto).not.toContain("SENHA");
  });

  it("erro que não é BootstrapError sai como inesperado, nunca como ok", async () => {
    const r = await desfazerComErroNaGravacao(
      new Error("estourou de um jeito imprevisto"),
    );
    expect(r.exit).toBe(CODIGOS_DE_SAIDA.inesperado);
    expect(r.exit).not.toBe(CODIGOS_DE_SAIDA.ok);
    expect(r.texto).toContain("inesperado:");
    expect(r.texto).toContain("estourou de um jeito imprevisto");
  });
});

// ---------------------------------------------------------------------------
describe("principal: --saida, modo e --subidos", () => {
  it("dry-run imprime modo DRY-RUN; --aplicar imprime modo APLICADO e grava a saída", async () => {
    const { kitRoot, valores } = await kitSintetico("ikcous");
    const s1 = servidorFalso(linhaNula);
    const seco = await rodar(
      argvLegado(kitRoot, valores),
      envLegado(),
      comServidor(s1),
    );
    expect(seco.exit).toBe(CODIGOS_DE_SAIDA.ok);
    expect(seco.logs.join("\n")).toContain('"modo": "DRY-RUN (nada gravado)"');
    expect(seco.logs.join("\n")).not.toContain("APLICADO");

    const saida = path.join(dir, "relatorio.json");
    const s2 = servidorFalso(linhaNula);
    const real = await rodar(
      argvLegado(kitRoot, valores, ["--aplicar", "--saida", saida]),
      envLegado(),
      comServidor(s2),
    );
    expect(real.exit).toBe(CODIGOS_DE_SAIDA.ok);
    expect(real.logs.join("\n")).toContain('"modo": "APLICADO"');
    expect(JSON.parse(await fs.readFile(saida, "utf8")).aplicado).toBe(true);
  });

  it("--saida que já existe SEM --aplicar não atrapalha o dry-run", async () => {
    const { kitRoot, valores } = await kitSintetico("ikcous");
    const saida = path.join(dir, "ja-existe.json");
    await fs.writeFile(saida, "conteudo antigo");
    const s = servidorFalso(linhaNula);
    const r = await rodar(
      argvLegado(kitRoot, valores, ["--saida", saida]),
      envLegado(),
      comServidor(s),
    );
    expect(r.exit).toBe(CODIGOS_DE_SAIDA.ok);
    expect(await fs.readFile(saida, "utf8")).toBe("conteudo antigo");
  });

  it("--aplicar com --saida que já existe: recusa ANTES de tocar qualquer porta, sem sobrescrever", async () => {
    const { kitRoot, valores } = await kitSintetico("ikcous");
    const saida = path.join(dir, "ja-existe.json");
    await fs.writeFile(saida, "conteudo antigo");
    const s = servidorFalso(linhaNula);
    const r = await rodar(
      argvLegado(kitRoot, valores, ["--aplicar", "--saida", saida]),
      envLegado(),
      comServidor(s),
    );
    expect(r.exit).toBe(CODIGOS_DE_SAIDA.entrada);
    expect(r.texto).toContain("o arquivo --saida ja existe, nao sobrescrevo");
    expect(r.texto).not.toContain(saida);
    expect(s.chamadas).toEqual([]);
    expect(await fs.readFile(saida, "utf8")).toBe("conteudo antigo");
  });

  it("arquivo --saida que aparece DEPOIS da checagem não é sobrescrito (flag wx): PROVA e o conteúdo alheio fica", async () => {
    const { kitRoot, valores } = await kitSintetico("ikcous");
    const saida = path.join(dir, "corrida.json");
    const s = servidorFalso(linhaNula);
    const gravar = s.banco.gravar.bind(s.banco);
    s.banco.gravar = async (...a: [string, unknown, unknown]) => {
      await fs.writeFile(saida, "criado por outro processo no meio");
      return gravar(...a);
    };
    const r = await rodar(
      argvLegado(kitRoot, valores, ["--aplicar", "--saida", saida]),
      envLegado(),
      comServidor(s),
    );
    expect(r.exit).toBe(CODIGOS_DE_SAIDA.prova);
    expect(await fs.readFile(saida, "utf8")).toBe(
      "criado por outro processo no meio",
    );
    expect(r.texto).toContain("PROVA: BANCO JA GRAVADO");
    expect(r.texto).toContain("EEXIST");
  });

  describe("--subidos ilegível", () => {
    async function desfazerCom(subidos: string) {
      const { kitRoot, valores } = await kitSintetico("ikcous");
      const kit = await lerKit(kitRoot, "ikcous");
      const s = servidorFalso({
        revision: "1",
        identity: montarIdentidade(kit, valoresBase, SUPABASE_URL),
      });
      const r = await rodar(
        argvLegado(kitRoot, valores, [
          "--desfazer",
          "--aplicar",
          "--subidos",
          subidos,
        ]),
        envLegado(),
        comServidor(s),
      );
      return { r, s };
    }

    it("JSON sem a lista `subidos`", async () => {
      const arquivo = path.join(dir, "s.json");
      await fs.writeFile(arquivo, JSON.stringify({ outro: 1 }));
      const { r, s } = await desfazerCom(arquivo);
      expect(r.exit).toBe(CODIGOS_DE_SAIDA.entrada);
      expect(r.texto).toContain(
        'arquivo --subidos ilegivel: falta campo "subidos" (array)',
      );
      expect(s.chamadas).not.toContain("gravar");
    });

    it("arquivo que não existe", async () => {
      const { r } = await desfazerCom(path.join(dir, "nao-existe.json"));
      expect(r.exit).toBe(CODIGOS_DE_SAIDA.entrada);
      expect(r.texto).toContain(
        "arquivo --subidos ilegivel: arquivo nao encontrado",
      );
    });

    it("JSON quebrado", async () => {
      const arquivo = path.join(dir, "s.json");
      await fs.writeFile(arquivo, "{ isto nao e json");
      const { r } = await desfazerCom(arquivo);
      expect(r.exit).toBe(CODIGOS_DE_SAIDA.entrada);
      expect(r.texto).toContain("arquivo --subidos ilegivel: JSON invalido");
    });

    it("sem permissão para ler (EACCES) tem mensagem própria", async () => {
      const arquivo = path.join(dir, "s.json");
      await fs.writeFile(arquivo, JSON.stringify({ subidos: [] }));
      const original = fs.readFile;
      vi.spyOn(fs, "readFile").mockImplementation((async (
        alvo: unknown,
        ...resto: unknown[]
      ) => {
        if (alvo === arquivo)
          throw Object.assign(new Error("negado"), { code: "EACCES" });
        return (original as (...a: unknown[]) => Promise<unknown>).call(
          fs,
          alvo,
          ...resto,
        );
      }) as never);
      const { r } = await desfazerCom(arquivo);
      expect(r.exit).toBe(CODIGOS_DE_SAIDA.entrada);
      expect(r.texto).toContain(
        "arquivo --subidos ilegivel: sem permissao para ler",
      );
      expect(r.texto).not.toContain(arquivo);
    });
  });
});

// ---------------------------------------------------------------------------
describe("alvo novo: o que vai pela rede", () => {
  type Req = { metodo: string; url: URL; cabecalhos: Headers };
  async function alvoNovo(
    opcoes: { dominioRows?: unknown[]; saveBody?: unknown } = {},
  ) {
    const { kitRoot, valores } = await kitSintetico("loja-ensaio");
    const s = servidorFalso(linhaNula);
    const reqs: Req[] = [];
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = new Request(input, init);
        const url = new URL(req.url);
        reqs.push({ metodo: req.method, url, cabecalhos: req.headers });
        const branding = "/storage/v1/object/branding/";
        if (req.method === "POST" && url.pathname.startsWith(branding)) {
          const destino = url.pathname.slice(branding.length);
          s.bucket.set(destino, {
            bytes: new Uint8Array(await req.arrayBuffer()),
            mime: req.headers.get("content-type") ?? "",
          });
          return Response.json({ Key: `branding/${destino}`, Id: "falso" });
        }
        if (url.pathname === "/rest/v1/rpc/save_store_identity") {
          if (opcoes.saveBody !== undefined)
            return new Response(JSON.stringify(opcoes.saveBody), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          const { desired_identity } = await req.json();
          return Response.json(
            await s.banco.gravar("0", null, desired_identity),
          );
        }
        if (url.pathname === "/rest/v1/rpc/read_store_identity")
          return Response.json(await s.banco.ler());
        if (
          url.pathname === "/rest/v1/v_store_config" &&
          url.searchParams.get("select") === "dominio_publico"
        )
          return Response.json(
            opcoes.dominioRows ?? [{ dominio_publico: DOMINIO }],
          );
        return s.fetchImpl(input, init);
      },
    );
    const argv = [
      "--kit",
      kitRoot,
      "--alvo-novo",
      "loja-ensaio",
      "--ref",
      REF_NOVA,
      "--dominio",
      DOMINIO,
      "--valores",
      valores,
      "--aplicar",
      "--saida",
      path.join(dir, "novo.json"),
    ];
    const legado = () => {
      throw new Error("alvo novo não usa a conexão ou o CLI legados");
    };
    const r = await rodar(argv, envNovo(), {
      fetchImpl,
      portaBanco: legado,
      portaStorage: legado,
    });
    return { r, reqs };
  }

  it("a ficha pública é lida com id=1 e limite 2; a leitura da identidade é por GET", async () => {
    const { r, reqs } = await alvoNovo();
    expect(r.exit).toBe(CODIGOS_DE_SAIDA.ok);
    const ficha = reqs.find(
      (q) =>
        q.url.pathname === "/rest/v1/v_store_config" &&
        q.url.searchParams.get("select") === "dominio_publico",
    );
    expect(ficha?.url.searchParams.get("id")).toBe("eq.1");
    expect(ficha?.url.searchParams.get("limit")).toBe("2");
    const leitura = reqs.find(
      (q) => q.url.pathname === "/rest/v1/rpc/read_store_identity",
    );
    expect(leitura?.metodo).toBe("GET");
  });

  it("o upload manda cache de um ano (31536000 s), sem sobrescrever", async () => {
    const { reqs } = await alvoNovo();
    const uploads = reqs.filter(
      (q) =>
        q.metodo === "POST" &&
        q.url.pathname.startsWith("/storage/v1/object/branding/"),
    );
    expect(uploads.length).toBeGreaterThan(0);
    for (const u of uploads) {
      expect(u.cabecalhos.get("cache-control")).toBe("max-age=31536000");
      expect(u.cabecalhos.get("x-upsert")).toBe("false");
    }
  });

  it("duas fichas públicas para o mesmo id são ambiguidade: recusa (ESTADO), não aceita a primeira", async () => {
    const { r } = await alvoNovo({
      dominioRows: [{ dominio_publico: DOMINIO }, { dominio_publico: DOMINIO }],
    });
    expect(r.exit).toBe(CODIGOS_DE_SAIDA.recusa);
    expect(r.texto).toContain(
      "a ficha publica store_config.id=1 falta, nao pode ser lida ou nao bate com --dominio",
    );
  });

  it("gravação que responde vazio (null) NÃO é confirmação", async () => {
    const { r } = await alvoNovo({ saveBody: null });
    expect(r.exit).toBe(CODIGOS_DE_SAIDA.inesperado);
    expect(r.texto).toContain(
      "nao foi possivel confirmar a gravacao; confira o banco antes de repetir",
    );
  });
});

// ---------------------------------------------------------------------------
describe("rodapé: o comando só roda quando este arquivo é o principal", () => {
  async function importar(argv: string[]) {
    vi.resetModules();
    const erros: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a) => {
      erros.push(a.map(String).join(" "));
    });
    process.exitCode = undefined;
    process.argv = argv;
    await import("../../scripts/identidade-bootstrap.mjs");
    return { erros, codigo: process.exitCode };
  }

  it("importado por outro comando, não lê argv nem muda o código de saída", async () => {
    const r = await importar([
      process.argv[0],
      "/outro/comando.mjs",
      "--qualquer",
    ]);
    expect(r.erros).toEqual([]);
    expect(r.codigo).toBeUndefined();
  });

  it("sem argv[1], também não roda", async () => {
    const r = await importar([process.argv[0]]);
    expect(r.erros).toEqual([]);
    expect(r.codigo).toBeUndefined();
  });

  it("rodado como comando, repassa os argumentos (menos node e o arquivo) e sai com o código do principal", async () => {
    const r = await importar([process.argv[0], SCRIPT, "--flag-inventada"]);
    expect(r.erros.join("\n")).toContain("flag desconhecida: --flag-inventada");
    expect(r.codigo).toBe(CODIGOS_DE_SAIDA.entrada);
  });
});
