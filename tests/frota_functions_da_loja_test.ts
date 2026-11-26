import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
// @ts-nocheck
/* eslint-disable security/detect-object-injection -- dublês de teste: as chaves vêm dos arquivos versionados e de constantes do próprio arquivo, nunca de entrada externa. */
/**
 * functions-da-loja.mjs (plano nova-loja, B2, lacuna L1): publica numa loja
 * NOVA as edge functions publicáveis do canal dela, pela Management API
 * (implantarFuncao), uma por vez, conferindo cada uma pelo GET /functions.
 *
 * O que este arquivo trava:
 *  - publica EXATAMENTE as functionsPublicaveis do canal, com o verify_jwt do
 *    supabase/config.toml (o que o publicar-functions.yml usa: o CLI lê o
 *    arquivo, e o workflow nunca passa --no-verify-jwt). O teste lê o
 *    config.toml com um leitor PRÓPRIO, não o do script;
 *  - fontes que divergem (canais × workflow × config.toml × lojas.json) =
 *    recusa antes da rede de escrita;
 *  - send-order-whatsapp nunca sai, nem com TODAS as fontes adulteradas;
 *  - uma falha = NÃO e para (nenhum POST depois dela); estado desconhecido
 *    nunca vira SIM;
 *  - já existente com o mesmo verify_jwt = pulada; --substituir só com
 *    --aplicar;
 *  - sem --aplicar = 0 POST; projeto fora de ACTIVE_HEALTHY = 0 POST;
 *  - o token nunca aparece na saída;
 *  - os arquivos de _shared que a function importa vão junto, com o conteúdo
 *    do repositório e o nome = caminho relativo ao projeto.
 *
 * Nenhuma chamada de rede real: todo fetch aqui é falso.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { executar } from "../scripts/frota/functions-da-loja.mjs";
import { criarClienteGestao } from "../scripts/frota/supabase-gestao.mjs";

const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const TOKEN = "sbp_oauth_TOKEN_FALSO_inventado_0123456789abcdef";
const REF_SAVY = "gnjsrucsmjkajijrakzr";
const REF_CAF = "cafkrminfnokvgjqtkle";
const CAMINHO_CANAIS = "scripts/frota/canais-de-backend.json";
const CAMINHO_CONFIG = "supabase/config.toml";
const CAMINHO_WORKFLOW = ".github/workflows/publicar-functions.yml";

/** Lê o arquivo do repositório (árvore de trabalho); null se não existir. */
function lerDoDisco(caminho) {
  try {
    return Deno.readTextFileSync(`${RAIZ}/${caminho}`);
  } catch {
    return null;
  }
}

/** Leitor com trocas: { caminho: conteúdo } ganha do disco. */
function leitor(trocas = {}) {
  return (caminho) =>
    Object.hasOwn(trocas, caminho) ? trocas[caminho] : lerDoDisco(caminho);
}

const CANAIS = JSON.parse(lerDoDisco(CAMINHO_CANAIS));
const PUBLICAVEIS_SAVY = [...CANAIS.canais[REF_SAVY].functionsPublicaveis];

/**
 * Leitor PRÓPRIO do config.toml (de propósito, não o do script): bloco
 * [functions."x"] seguido de verify_jwt = true|false.
 */
function verifyJwtLidoPeloTeste() {
  const mapa = {};
  let atual = null;
  for (const linha of lerDoDisco(CAMINHO_CONFIG).split(/\r?\n/)) {
    const t = linha.trim();
    if (t.startsWith("#") || t === "") continue;
    const cab = t.match(/^\[functions\."([^"]+)"\]$/);
    if (cab) {
      atual = cab[1];
      continue;
    }
    if (t.startsWith("[")) {
      atual = null;
      continue;
    }
    const v = t.match(/^verify_jwt = (true|false)$/);
    if (v && atual) mapa[atual] = v[1] === "true";
  }
  return mapa;
}

/**
 * Servidor falso da Management API: guarda o que foi publicado e responde o
 * GET /functions com isso. `opcoes.deploy(slug, n)` pode devolver uma
 * Response (ou lançar) para a n-ésima publicação.
 */
function servidorFalso({
  statusProjeto = "ACTIVE_HEALTHY",
  existentes = [],
  deploy,
  listaFalha = false,
} = {}) {
  const funcoes = new Map(existentes.map((f) => [f.slug, { ...f }]));
  const chamadas = [];
  const publicados = [];
  let nDeploy = 0;
  const json = (status, corpo) =>
    Promise.resolve(
      new Response(JSON.stringify(corpo), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  const f = async (url, init = {}) => {
    const u = new URL(String(url));
    const metodo = init.method ?? "GET";
    chamadas.push({
      metodo,
      caminho: u.pathname,
      slug: u.searchParams.get("slug"),
      init,
    });
    assertEquals(u.origin, "https://api.supabase.com");
    assertEquals(init.headers?.authorization, `Bearer ${TOKEN}`);
    if (metodo === "GET" && /^\/v1\/projects\/[a-z]{20}$/.test(u.pathname)) {
      return json(200, { ref: u.pathname.slice(13), status: statusProjeto });
    }
    if (metodo === "GET" && /\/functions$/.test(u.pathname)) {
      if (listaFalha) return json(500, { message: "falhou" });
      return json(200, [...funcoes.values()]);
    }
    if (metodo === "POST" && /\/functions\/deploy$/.test(u.pathname)) {
      nDeploy++;
      const slug = u.searchParams.get("slug");
      const form = init.body;
      const meta = JSON.parse(form.get("metadata"));
      const arquivos = await Promise.all(
        form.getAll("file").map(async (a) => ({
          caminho: a.name,
          conteudo: await a.text(),
        })),
      );
      publicados.push({ slug, meta, arquivos });
      if (deploy) {
        const r = await deploy(slug, nDeploy);
        if (r) return r;
      }
      const registro = {
        id: `id-${slug}`,
        slug,
        name: slug,
        status: "ACTIVE",
        version: 1,
        verify_jwt: meta.verify_jwt,
      };
      funcoes.set(slug, registro);
      return json(201, registro);
    }
    throw new Error(
      `servidor falso: pedido inesperado ${metodo} ${u.pathname}`,
    );
  };
  f.chamadas = chamadas;
  f.publicados = publicados;
  f.funcoes = funcoes;
  f.posts = () => chamadas.filter((c) => c.metodo === "POST");
  return f;
}

function deps(fetchFn, extra = {}) {
  return {
    ler: leitor(extra.trocas),
    sha: "0123456789abcdef0123456789abcdef01234567",
    cliente: criarClienteGestao({ token: TOKEN, fetch: fetchFn }),
    esperar: async () => {},
    ...extra,
  };
}

const ARGS_SAVY = ["--projeto", REF_SAVY, "--canal", "savy"];

function semToken(r) {
  const tudo = [...r.saida, ...r.erros, JSON.stringify(r)].join("\n");
  assert(!tudo.includes(TOKEN), "o token apareceu na saída");
  assert(!tudo.includes(TOKEN.slice(10, 30)), "pedaço do token na saída");
}

// --------------------------------------------------------------------------

Deno.test("todas as publicáveis do canal sobem, uma por vez, e o veredito é SIM", async () => {
  const srv = servidorFalso();
  const r = await executar([...ARGS_SAVY, "--aplicar"], deps(srv));
  assertEquals(r.veredito, "SIM", r.saida.join("\n"));
  assertEquals(r.codigo, 0);
  assertEquals(
    srv.publicados.map((p) => p.slug),
    PUBLICAVEIS_SAVY,
    "publicou exatamente a lista do canal, na ordem dela",
  );
  assertEquals(PUBLICAVEIS_SAVY.length, 13);
  // uma por vez: cada POST é seguido de um GET /functions antes do próximo POST
  const seq = srv.chamadas.map((c) =>
    c.metodo === "POST" ? "P" : /functions$/.test(c.caminho) ? "L" : "G",
  );
  assertEquals(seq[0], "G", "o status do projeto é lido antes de tudo");
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] === "P")
      assertEquals(seq[i + 1], "L", `POST ${i} sem conferência logo depois`);
  }
  semToken(r);
});

Deno.test("verify_jwt de CADA function é o do supabase/config.toml (lido pelo teste)", async () => {
  const esperado = verifyJwtLidoPeloTeste();
  const srv = servidorFalso();
  const r = await executar([...ARGS_SAVY, "--aplicar"], deps(srv));
  assertEquals(r.veredito, "SIM");
  for (const p of srv.publicados) {
    assert(
      Object.hasOwn(esperado, p.slug),
      `${p.slug} sem entrada no config.toml`,
    );
    assertEquals(
      p.meta.verify_jwt,
      esperado[p.slug],
      `verify_jwt de ${p.slug}`,
    );
  }
  // os dois que não podem ter JWT de jeito nenhum
  const porSlug = Object.fromEntries(
    srv.publicados.map((p) => [p.slug, p.meta]),
  );
  assertEquals(porSlug["webhook-mercadopago"].verify_jwt, false);
  assertEquals(porSlug["reconciliar-pagamentos"].verify_jwt, false);
  assertEquals(porSlug["auth-send-email"].verify_jwt, false);
  assertEquals(porSlug["criar-pagamento"].verify_jwt, true);
  assertEquals(porSlug["estornar-pagamento"].verify_jwt, true);
});

Deno.test("o plano (sem --aplicar) mostra nome e verify_jwt de cada uma e faz 0 POST", async () => {
  const srv = servidorFalso();
  const r = await executar(ARGS_SAVY, deps(srv));
  assertEquals(srv.posts().length, 0, "ensaio não escreve");
  const texto = r.saida.join("\n");
  const esperado = verifyJwtLidoPeloTeste();
  for (const nome of PUBLICAVEIS_SAVY) {
    assert(
      texto.includes(`${nome} verify_jwt=${esperado[nome]}`),
      `o plano não mostra ${nome} verify_jwt=${esperado[nome]}`,
    );
  }
  assert(/ENSAIO/.test(texto));
  assertEquals(r.veredito, "NAO", "loja sem functions: o ensaio não diz SIM");
  semToken(r);
});

Deno.test("send-order-whatsapp nunca é enviada: fontes reais", async () => {
  const srv = servidorFalso();
  await executar([...ARGS_SAVY, "--aplicar"], deps(srv));
  assert(srv.chamadas.every((c) => c.slug !== "send-order-whatsapp"));
  assert(
    srv.publicados.every((p) =>
      p.arquivos.every((a) => !a.caminho.includes("send-order-whatsapp")),
    ),
  );
});

Deno.test("send-order-whatsapp nunca é enviada: nem com canais, workflow e funcoesNaoPublicadas adulterados", async () => {
  const canais = structuredClone(CANAIS);
  canais.funcoesNaoPublicadas = [];
  canais.canais[REF_SAVY].functionsPublicaveis.push("send-order-whatsapp");
  const workflow = lerDoDisco(CAMINHO_WORKFLOW)
    .replace(
      "send-order-confirmation|calculate-shipping|",
      "send-order-whatsapp|send-order-confirmation|calculate-shipping|",
    )
    .replace(
      /if \[ "\$n" = "send-order-whatsapp" \]/,
      'if [ "$n" = "nunca-existe" ]',
    );
  const config = `${lerDoDisco(CAMINHO_CONFIG)}\n[functions."send-order-whatsapp"]\nverify_jwt = false\n`;
  const srv = servidorFalso();
  const r = await executar(
    [...ARGS_SAVY, "--aplicar"],
    deps(srv, {
      trocas: {
        [CAMINHO_CANAIS]: JSON.stringify(canais),
        [CAMINHO_WORKFLOW]: workflow,
        [CAMINHO_CONFIG]: config,
      },
    }),
  );
  assertEquals(srv.posts().length, 0, "recusa antes de qualquer escrita");
  assertEquals(r.veredito, "NAO");
  assert(/send-order-whatsapp/.test(r.erros.join("\n")), r.erros.join("\n"));
});

Deno.test("send-order-whatsapp no canal com funcoesNaoPublicadas intacto: recusa", async () => {
  const canais = structuredClone(CANAIS);
  canais.canais[REF_SAVY].functionsPublicaveis.push("send-order-whatsapp");
  const srv = servidorFalso();
  const r = await executar(
    [...ARGS_SAVY, "--aplicar"],
    deps(srv, { trocas: { [CAMINHO_CANAIS]: JSON.stringify(canais) } }),
  );
  assertEquals(srv.posts().length, 0);
  assertEquals(r.veredito, "NAO");
});

Deno.test("uma falha no meio = NÃO e PARA: nenhum POST depois dela", async () => {
  const srv = servidorFalso({
    deploy: (_slug, n) =>
      n === 3
        ? new Response(JSON.stringify({ message: "boom" }), { status: 500 })
        : null,
  });
  const r = await executar([...ARGS_SAVY, "--aplicar"], deps(srv));
  assertEquals(srv.posts().length, 3, "parou na terceira");
  assertEquals(r.veredito, "NAO");
  assertEquals(r.codigo, 1);
  assert(r.erros.join("\n").includes(PUBLICAVEIS_SAVY[2]), r.erros.join("\n"));
  semToken(r);
});

Deno.test("falha de rede no deploy (estado desconhecido) para; se era a última, INCERTO, nunca SIM", async () => {
  const ultima = PUBLICAVEIS_SAVY.length;
  const srv = servidorFalso({
    deploy: (_slug, n) => {
      if (n === ultima) throw new Error(`rede caiu levando ${TOKEN}`);
      return null;
    },
  });
  const r = await executar([...ARGS_SAVY, "--aplicar"], deps(srv));
  assertEquals(srv.posts().length, ultima);
  assertEquals(r.veredito, "INCERTO");
  assertEquals(r.codigo, 3);
  semToken(r);
});

Deno.test("falha de rede no meio: as que nem foram tentadas faltam = NÃO", async () => {
  const srv = servidorFalso({
    deploy: (_slug, n) => {
      if (n === 2) throw new Error("rede caiu");
      return null;
    },
  });
  const r = await executar([...ARGS_SAVY, "--aplicar"], deps(srv));
  assertEquals(srv.posts().length, 2);
  assertEquals(r.veredito, "NAO");
});

Deno.test("201 mas a conferência mostra verify_jwt trocado = NÃO e para", async () => {
  const srv = servidorFalso({
    deploy: (slug, n) => {
      if (n !== 1) return null;
      // o servidor responde 201 mas guarda o CONTRÁRIO do verify_jwt pedido
      const pedido = srv.publicados.at(-1).meta.verify_jwt;
      const reg = {
        id: "x",
        slug,
        status: "ACTIVE",
        version: 1,
        verify_jwt: !pedido,
      };
      srv.funcoes.set(slug, reg);
      return new Response(JSON.stringify(reg), { status: 201 });
    },
  });
  const r = await executar([...ARGS_SAVY, "--aplicar"], deps(srv));
  assertEquals(srv.posts().length, 1);
  assertEquals(r.veredito, "NAO");
});

Deno.test("201 mas a function não aparece no GET depois das tentativas = INCERTO e para", async () => {
  const srv = servidorFalso({
    deploy: (slug, n) =>
      n === 1
        ? new Response(
            JSON.stringify({ id: "x", slug, status: "ACTIVE", version: 1 }),
            { status: 201 },
          )
        : null,
  });
  // o deploy respondeu 201 sem gravar nada no servidor falso
  const r = await executar([...ARGS_SAVY, "--aplicar"], deps(srv));
  assertEquals(srv.posts().length, 1);
  assert(r.veredito !== "SIM");
});

Deno.test("já existentes com o mesmo verify_jwt são puladas; as outras sobem", async () => {
  const esperado = verifyJwtLidoPeloTeste();
  const ja = PUBLICAVEIS_SAVY.slice(0, 4).map((slug) => ({
    slug,
    status: "ACTIVE",
    verify_jwt: esperado[slug],
  }));
  const srv = servidorFalso({ existentes: ja });
  const r = await executar([...ARGS_SAVY, "--aplicar"], deps(srv));
  assertEquals(r.veredito, "SIM", r.erros.join("\n"));
  assertEquals(
    srv.publicados.map((p) => p.slug),
    PUBLICAVEIS_SAVY.slice(4),
  );
  assert(/PULAR/.test(r.saida.join("\n")));
});

Deno.test("todas já existentes e certas: 0 POST e SIM (rodar duas vezes não republica)", async () => {
  const esperado = verifyJwtLidoPeloTeste();
  const srv = servidorFalso({
    existentes: PUBLICAVEIS_SAVY.map((slug) => ({
      slug,
      status: "ACTIVE",
      verify_jwt: esperado[slug],
    })),
  });
  const r = await executar([...ARGS_SAVY, "--aplicar"], deps(srv));
  assertEquals(srv.posts().length, 0);
  assertEquals(r.veredito, "SIM");
});

Deno.test("--substituir com --aplicar republica as que já existem", async () => {
  const esperado = verifyJwtLidoPeloTeste();
  const srv = servidorFalso({
    existentes: PUBLICAVEIS_SAVY.map((slug) => ({
      slug,
      status: "ACTIVE",
      verify_jwt: esperado[slug],
    })),
  });
  const r = await executar(
    [...ARGS_SAVY, "--aplicar", "--substituir"],
    deps(srv),
  );
  assertEquals(srv.posts().length, PUBLICAVEIS_SAVY.length);
  assertEquals(r.veredito, "SIM");
});

Deno.test("--substituir sem --aplicar é uso errado e não toca a rede", async () => {
  const srv = servidorFalso();
  const r = await executar([...ARGS_SAVY, "--substituir"], deps(srv));
  assertEquals(r.codigo, 2);
  assertEquals(srv.chamadas.length, 0);
});

Deno.test("já existente com verify_jwt DIFERENTE: recusa sem --substituir, 0 POST", async () => {
  const srv = servidorFalso({
    existentes: [
      { slug: "webhook-mercadopago", status: "ACTIVE", verify_jwt: true },
    ],
  });
  const r = await executar([...ARGS_SAVY, "--aplicar"], deps(srv));
  assertEquals(srv.posts().length, 0);
  assertEquals(r.veredito, "NAO");
  assert(/webhook-mercadopago/.test(r.erros.join("\n")));
});

Deno.test("--projeto e --canal são obrigatórios; ref inválido recusa", async () => {
  for (const argv of [
    ["--canal", "savy"],
    ["--projeto", REF_SAVY],
    ["--projeto", "CURTO", "--canal", "savy"],
    [...ARGS_SAVY, "--outra"],
  ]) {
    const srv = servidorFalso();
    const r = await executar(argv, deps(srv));
    assertEquals(r.codigo, 2, argv.join(" "));
    assertEquals(srv.chamadas.length, 0);
  }
});

Deno.test("canal de outra loja (ref não bate) recusa antes da rede", async () => {
  const srv = servidorFalso();
  const r = await executar(
    ["--projeto", REF_CAF, "--canal", "savy", "--aplicar"],
    deps(srv),
  );
  assertEquals(r.veredito, "NAO");
  assertEquals(srv.chamadas.length, 0);
});

Deno.test("canal sem entrada em canais-de-backend.json recusa", async () => {
  const canais = structuredClone(CANAIS);
  delete canais.canais[REF_SAVY];
  const srv = servidorFalso();
  const r = await executar(
    [...ARGS_SAVY, "--aplicar"],
    deps(srv, { trocas: { [CAMINHO_CANAIS]: JSON.stringify(canais) } }),
  );
  assertEquals(r.veredito, "NAO");
  assertEquals(srv.chamadas.length, 0);
});

Deno.test("fontes divergentes recusam: canais lista uma que o workflow não aceita", async () => {
  const canais = structuredClone(CANAIS);
  canais.canais[REF_SAVY].functionsPublicaveis = canais.canais[
    REF_SAVY
  ].functionsPublicaveis.filter((n) => n !== "send-push");
  const srv = servidorFalso();
  const r = await executar(
    [...ARGS_SAVY, "--aplicar"],
    deps(srv, { trocas: { [CAMINHO_CANAIS]: JSON.stringify(canais) } }),
  );
  assertEquals(r.veredito, "NAO");
  assertEquals(srv.chamadas.length, 0);
  assert(/diverg/i.test(r.erros.join("\n")), r.erros.join("\n"));
});

Deno.test("fontes divergentes recusam: o workflow passa a usar --no-verify-jwt", async () => {
  const workflow = lerDoDisco(CAMINHO_WORKFLOW).replace(
    'supabase functions deploy "$n" --project-ref "$REF" --yes',
    'supabase functions deploy "$n" --project-ref "$REF" --no-verify-jwt --yes',
  );
  const srv = servidorFalso();
  const r = await executar(
    [...ARGS_SAVY, "--aplicar"],
    deps(srv, { trocas: { [CAMINHO_WORKFLOW]: workflow } }),
  );
  assertEquals(r.veredito, "NAO");
  assertEquals(srv.chamadas.length, 0);
});

Deno.test("function publicável sem verify_jwt no config.toml recusa (nada de padrão adivinhado)", async () => {
  const config = lerDoDisco(CAMINHO_CONFIG).replace(
    /\[functions\."webhook-mercadopago"\]\r?\nverify_jwt = false/,
    "",
  );
  assert(!config.includes('"webhook-mercadopago"'));
  const srv = servidorFalso();
  const r = await executar(
    [...ARGS_SAVY, "--aplicar"],
    deps(srv, { trocas: { [CAMINHO_CONFIG]: config } }),
  );
  assertEquals(r.veredito, "NAO");
  assertEquals(srv.chamadas.length, 0);
});

Deno.test("arquivo importado que não existe recusa antes da rede", async () => {
  const srv = servidorFalso();
  const r = await executar(
    [...ARGS_SAVY, "--aplicar"],
    deps(srv, {
      trocas: { "supabase/functions/_shared/mercadopago.ts": null },
    }),
  );
  assertEquals(r.veredito, "NAO");
  assertEquals(srv.chamadas.length, 0);
});

Deno.test("projeto fora de ACTIVE_HEALTHY: 0 POST e NÃO", async () => {
  const srv = servidorFalso({ statusProjeto: "COMING_UP" });
  const r = await executar([...ARGS_SAVY, "--aplicar"], deps(srv));
  assertEquals(srv.posts().length, 0);
  assertEquals(r.veredito, "NAO");
  assert(/ACTIVE_HEALTHY/.test(r.erros.join("\n")));
});

Deno.test("lista de functions ilegível antes de publicar: INCERTO, 0 POST", async () => {
  const srv = servidorFalso({ listaFalha: true });
  const r = await executar([...ARGS_SAVY, "--aplicar"], deps(srv));
  assertEquals(srv.posts().length, 0);
  assertEquals(r.veredito, "INCERTO");
});

Deno.test("_shared importado vai junto, com o conteúdo do repositório e nome relativo ao projeto", async () => {
  const srv = servidorFalso();
  await executar([...ARGS_SAVY, "--aplicar"], deps(srv));
  const porSlug = new Map(srv.publicados.map((p) => [p.slug, p]));

  const criar = porSlug.get("criar-pagamento");
  const nomes = criar.arquivos.map((a) => a.caminho);
  assertEquals(
    criar.meta.entrypoint_path,
    "supabase/functions/criar-pagamento/index.ts",
  );
  assert(nomes.includes("supabase/functions/criar-pagamento/index.ts"));
  // importado direto pelo index.ts
  assert(
    nomes.includes("supabase/functions/_shared/mercadopago.ts"),
    nomes.join("\n"),
  );
  // nenhum arquivo de teste vai junto
  assert(
    nomes.every((n) => !/_test\.ts$/.test(n)),
    nomes.join("\n"),
  );
  // todo import relativo de todo arquivo enviado também foi enviado (fecho transitivo)
  for (const a of criar.arquivos) {
    for (const m of a.conteudo.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
      const dir = a.caminho.split("/").slice(0, -1);
      for (const seg of m[1].split("/")) {
        if (seg === "..") dir.pop();
        else if (seg !== ".") dir.push(seg);
      }
      assert(
        nomes.includes(dir.join("/")),
        `${a.caminho} importa ${dir.join("/")}, que não foi junto`,
      );
    }
  }
  for (const a of criar.arquivos) {
    assertEquals(a.conteudo, lerDoDisco(a.caminho), `conteúdo de ${a.caminho}`);
  }

  // webpush (com o vendor .mjs) vai na send-push
  const push = porSlug.get("send-push").arquivos.map((a) => a.caminho);
  assert(
    push.includes("supabase/functions/_shared/webpush.ts"),
    push.join("\n"),
  );
});

Deno.test("o token nunca aparece na saída, nem quando o fetch lança com ele na mensagem", async () => {
  const srv = servidorFalso({
    deploy: (_s, n) => {
      if (n === 1) throw new Error(`Authorization: Bearer ${TOKEN}`);
      return null;
    },
  });
  const r = await executar([...ARGS_SAVY, "--aplicar"], deps(srv));
  semToken(r);
  const r2 = await executar(ARGS_SAVY, deps(servidorFalso()));
  semToken(r2);
});
