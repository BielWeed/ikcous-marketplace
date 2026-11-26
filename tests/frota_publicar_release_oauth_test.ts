// @ts-nocheck
/* eslint-disable security/detect-object-injection -- dublês de teste: as chaves vêm de constantes e mapas fechados do próprio arquivo, nunca de entrada externa. */
/**
 * scripts/frota/publicar-release.mjs — a loja OAuth no portão (T6 do plano
 * PORTAO-OAUTH-PONTE-A, 26/11/2026; decisão 1 do sócio: "não conseguiu ler =
 * não lida, bloqueia, nunca passou").
 *
 * A loja aberta pelo nova-loja só tem acesso OAuth (`acesso: "oauth"` no
 * lojas.json): o CLI do dono não a enxerga. O portão passa a ler as três
 * coisas dela (ledger, lista e código das functions) pelo leitor OAuth
 * (scripts/frota/leitor-oauth.mjs), com o token do cofre. O que cada teste
 * trava (e cai se a guarda sair):
 *  1. a loja OAuth é lida pelo leitor; o dublê do CLI NUNCA recebe o ref dela;
 *  2. IKCOUS e Savy continuam pelo CLI: mesmas chamadas, mesmo relatório;
 *  3. o token é pedido UMA vez por loja (ledger, lista e N downloads em
 *     paralelo), e uma falha também não se repete;
 *  4. sem refresh no cofre, cofre travado, SemAcesso, token sem prazo, token
 *     vencido, API fora, download indisponível (T3): codigo 1, "não lida",
 *     nunca PRONTO, com o motivo e o que o dono faz;
 *  5. cadastro OAuth incoerente bloqueia pelo nome, sem ler nada;
 *  6. o canário (token) não aparece no relatório, nos bloqueios nem no --json;
 *  7. os comandos de conserto da loja OAuth saem com o aviso da sessão;
 *  + as anotações da revisão Opus da T5: RE_FUNCAO igual nos dois arquivos,
 *    function REMOVED/THROTTLED = ausente, verify_jwt torto diz function e loja.
 *
 * Nenhuma rede, nenhum CLI, nenhum cofre real: o fetch da gestão, o token, o
 * baixar e o CLI são dublês. O token é um canário montado em tempo de execução.
 */
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { criarAcessoOAuth } from "../scripts/frota/acesso-oauth.mjs";
import {
  CofreTravado,
  criarCofreMemoria,
} from "../scripts/frota/cofre-local.mjs";
import { RE_FUNCAO as RE_FUNCAO_DO_LEITOR } from "../scripts/frota/leitor-oauth.mjs";
import {
  RE_FUNCAO as RE_FUNCAO_DO_PORTAO,
  baixarOAuthIndisponivel,
  comLeituraOAuth,
  dependenciasReais,
  lerCanais,
  lojasOAuth,
  publicarRelease,
  resumoEmJson,
} from "../scripts/frota/publicar-release.mjs";
import { SemAcesso } from "../scripts/frota/supabase-gestao.mjs";

const require = createRequire(import.meta.url);
const {
  validarCadastro,
  carregarLojas,
} = require("../scripts/frota/lojas.cjs");

const SHA = "1".repeat(40);
const BASE = "2".repeat(40);
const TOPO = "4".repeat(40);
const IDENT = "e".repeat(64);
const DPL = "dpl_Novo123";
const DPL_ANTERIOR = "dpl_Anterior456";
const AGORA = Date.parse("2026-11-26T20:00:00Z");
const HORA = 3600 * 1000;
const ARQUIVO_NOTAS = "src/novidades/notas-das-versoes.json";
const NOTA_VALIDA = {
  titulo: "Atualização do app",
  novidades: [],
  correcoes: ["Correções de estabilidade."],
  melhorias: [],
};
// canário montado em tempo de execução (literal no fonte dispara o secretlint)
const CANARIO = `sbp_oauth_${"ab".repeat(20)}`;
const CANARIO_2 = `sbp_oauth_${"cd".repeat(20)}`;
const AVISO_DA_SESSAO =
  "# loja OAuth: estes comandos só funcionam dentro de `--sessao`";

const REF_IKCOUS = "cafkrminfnokvgjqtkle";
const REF_SAVY = "gnjsrucsmjkajijrakzr";
const REF_OAUTH = "oauthlojatesteaaaaaa";
const REF_OAUTH_2 = "oauthlojadoisbbbbbbb";

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** O cadastro (lojas.json) normalizado pelo código de verdade. */
function cadastroCom(extras = {}) {
  return validarCadastro({
    lojas: {
      loja: {
        ref: REF_IKCOUS,
        classe: "legado",
        apelido: "loja",
        segredoDoToken: "SUPABASE_ACCESS_TOKEN",
      },
      "ikcous-publicada": {
        ref: REF_IKCOUS,
        classe: "assinante",
        apelido: "CAF",
        segredoDoToken: "SUPABASE_ACCESS_TOKEN_IKCOUS",
        functionsNomeadas: true,
      },
      savy: {
        ref: REF_SAVY,
        classe: "assinante",
        apelido: "Savy",
        segredoDoToken: "SUPABASE_ACCESS_TOKEN_SAVY",
        functionsNomeadas: true,
      },
      ...extras,
    },
  });
}

const lojaOAuth = (ref, sufixo) => ({
  ref,
  classe: "assinante",
  apelido: `Teste ${sufixo}`,
  segredoDoToken: `SUPABASE_ACCESS_TOKEN_${sufixo.toUpperCase().replace(/-/g, "_")}`,
  functionsNomeadas: false,
  acesso: "oauth",
});

/**
 * Cenário: IKCOUS e Savy (CLI) e, se pedido, lojas OAuth. Tudo pronto: o
 * ledger tem a migration, as duas functions estão em dia. `ajuste` troca
 * comportamento; `chamadas` anota o que cada dublê recebeu.
 */
function montar(ajuste = {}) {
  const oauth = ajuste.oauth ?? [{ ref: REF_OAUTH, slug: "loja-teste" }];
  const todas = [
    { ref: REF_IKCOUS, nome: "IKCOUS", projeto: "ikcous-publicada" },
    { ref: REF_SAVY, nome: "Savy", projeto: "savy" },
    ...oauth.map((o) => ({ ref: o.ref, nome: o.slug, projeto: o.slug })),
  ];
  const chamadas = {
    cli: [],
    gestao: [],
    token: [],
    baixarOAuth: [],
  };
  const arvore = {
    [SHA]: {
      [ARQUIVO_NOTAS]: JSON.stringify({ "1.5.18": NOTA_VALIDA }),
      "supabase/functions/criar-pagamento/index.ts": "pagamento",
      "supabase/functions/webhook-mercadopago/index.ts": "webhook",
      "supabase/config.toml":
        '[functions."webhook-mercadopago"]\nverify_jwt = false\n',
      ...(ajuste.arvoreDoSha ?? {}),
    },
    [BASE]: {
      "supabase/functions/criar-pagamento/index.ts": "pagamento",
      "supabase/functions/webhook-mercadopago/index.ts": "webhook",
    },
  };
  const canais = {
    ramoDaRelease: "release",
    funcoesNaoPublicadas: [],
    validadeDaEvidenciaHoras: 6,
    provasDeObjetos: [],
    canais: Object.fromEntries(
      todas.map((l) => [
        l.ref,
        {
          nome: l.nome,
          migrations: l.projeto,
          functions: l.projeto,
          projetosNoMesmoBanco: [],
          functionsPublicaveis: ["criar-pagamento"],
        },
      ]),
    ),
  };
  if (ajuste.canais) ajuste.canais(canais);
  const sondas = todas.map((l) => ({
    dominio: `${l.nome.toLowerCase()}.vercel.app`,
    versao: { codeSha: BASE },
    ficha: {
      status: 200,
      caderneta: "hit",
      titulo: l.nome,
      refs: [l.ref],
      estavel: true,
    },
  }));
  const funcoesNoAr = (ref) =>
    ajuste.funcoesNoAr?.(ref) ?? [
      { slug: "criar-pagamento", verify_jwt: true, status: "ACTIVE" },
      { slug: "webhook-mercadopago", verify_jwt: false, status: "ACTIVE" },
    ];
  const pacote = (nome) => [
    {
      caminho: `supabase/functions/${nome}/index.ts`,
      conteudo: arvore[SHA][`supabase/functions/${nome}/index.ts`],
    },
  ];
  const cadastro =
    ajuste.cadastro !== undefined
      ? ajuste.cadastro
      : cadastroCom(
          Object.fromEntries(
            oauth.map((o) => [o.slug, lojaOAuth(o.ref, o.slug)]),
          ),
        );

  const d = {
    politica: {
      projetoVercel: { id: "prj_X", time: "team_Y" },
      lojasSemBackendGerenciado: [],
      enderecosEsperados: [],
      migrationsForaDaRelease: [],
    },
    canais,
    agora: ajuste.agora ?? (() => AGORA),
    esperaDeRetentativaMs: 0,
    lojasEmParalelo: ajuste.lojasEmParalelo,
    fetchImpl: async (url) =>
      new URL(url).pathname === "/"
        ? new Response("<html></html>", {
            status: 503,
            headers: {
              "x-ikcous-porteiro": "sem-loja",
              "x-ikcous-caderneta": "miss",
            },
          })
        : new Response(
            JSON.stringify({
              version: `1.5.18-sha.${SHA.slice(0, 7)}-identity.${IDENT}`,
              codeVersion: "1.5.18",
              codeSha: SHA,
              identityRevision: IDENT,
              source: "database",
              promotable: true,
            }),
            { status: 200 },
          ),
    vercelApi: async () => ({
      id: DPL,
      url: "cand.vercel.app",
      target: "production",
      readyState: "READY",
      projectId: "prj_X",
    }),
    inventariar: async () => ({
      origem: "vercel",
      completo: true,
      motivoParcial: null,
      dominios: sondas.map((s) => s.dominio),
      vercel: { ok: true, producaoOficial: DPL_ANTERIOR },
      sondas,
    }),
    conferirFrota: async () => ({
      ok: false,
      resultados: sondas.map((s) => ({ dominio: s.dominio, classe: "OK" })),
      relatorio: "(antes)",
    }),
    promover: async () => {},
    listarMigrationsNoSha: async () => ["20261190000000_a.sql"],
    listarFuncoesNoSha: async () => ["criar-pagamento", "webhook-mercadopago"],
    lerArquivoNoSha: (sha, caminho) => arvore[sha]?.[caminho] ?? null,
    arvoreIgual: async () => true,
    topoDoRamo: async () => TOPO,
    listarRuns: async () => [],
    logDoRun: async () => "",
    // ---- o caminho do CLI (IKCOUS e Savy)
    migrationList: async (ref) => {
      chamadas.cli.push(["migrationList", ref]);
      await esperar(2);
      return JSON.stringify({ migrations: [{ remote: "20261190000000" }] });
    },
    listarFuncoes: async (ref) => {
      chamadas.cli.push(["listarFuncoes", ref]);
      return funcoesNoAr(ref).map(({ slug, verify_jwt }) => ({
        slug,
        verify_jwt,
      }));
    },
    baixarFuncao: async (ref, nome) => {
      chamadas.cli.push(["baixarFuncao", ref, nome]);
      return pacote(nome);
    },
  };
  if (cadastro !== null) d.cadastro = cadastro;
  if (ajuste.semOAuthDeps !== true) {
    // ---- o caminho OAuth (fetch da Management API, token e baixar)
    d.fetchGestao = async (url, init) => {
      const u = new URL(url);
      chamadas.gestao.push({
        caminho: u.pathname,
        auth: init.headers.authorization,
      });
      const m =
        /^\/v1\/projects\/([a-z]{20})\/(database\/migrations|functions)$/.exec(
          u.pathname,
        );
      if (!m) return new Response("", { status: 404 });
      const [, ref, oQue] = m;
      const especial = ajuste.respostaDaGestao?.(ref, oQue);
      if (especial instanceof Error) throw especial;
      if (especial instanceof Response) return especial;
      await esperar(3);
      const corpo =
        oQue === "functions"
          ? funcoesNoAr(ref)
          : [{ version: "20261190000000", name: "a" }];
      return new Response(JSON.stringify(corpo), { status: 200 });
    };
    d.tokenOAuth =
      ajuste.tokenOAuth ??
      (async ({ slug, ref }) => {
        chamadas.token.push([slug, ref]);
        await esperar(5);
        return {
          accessToken: slug === "loja-dois" ? CANARIO_2 : CANARIO,
          expiraEm: AGORA + 20 * HORA,
        };
      });
    d.baixarOAuth =
      ajuste.baixarOAuth ??
      (async (ref, nome, gestao) => {
        chamadas.baixarOAuth.push([ref, nome, typeof gestao?.pedir]);
        await esperar(2);
        return pacote(nome);
      });
  }
  return { d, chamadas };
}

const executar = (d) =>
  publicarRelease({ sha: SHA, deploymentId: DPL, promover: false }, d);

const refsDoCli = (chamadas) => new Set(chamadas.cli.map((c) => c[1]));

/** A seção "### <título> (<ref>)" do relatório, até a próxima linha vazia. */
function secaoDaLoja(relatorio, ref) {
  const linhas = relatorio.split("\n");
  const i = linhas.findIndex((l) => l.startsWith("### ") && l.includes(ref));
  if (i < 0) return null;
  const fim = linhas.indexOf("", i);
  return linhas.slice(i, fim).join("\n");
}

/** Nada que leve o token pode sair do portão. */
function semCanario(r) {
  for (const t of [CANARIO, CANARIO_2, "sbp_oauth_"]) {
    assert(!r.relatorio.includes(t), "canário no relatório");
    assert(!JSON.stringify(r.bloqueios).includes(t), "canário nos bloqueios");
    assert(
      !resumoEmJson(r, "2026-11-26T20:00:00.000Z").includes(t),
      "canário no --json",
    );
    assert(
      !JSON.stringify(r.consertos ?? []).includes(t),
      "canário nos consertos",
    );
  }
}

// ====================================================================
// controle e 1: a loja OAuth é lida pelo leitor, nunca pelo CLI
// ====================================================================

Deno.test("oauth 1: controle — com a loja OAuth lida pela API e tudo em dia, o portão dá PRONTO", async () => {
  const { d } = montar();
  const r = await executar(d);
  assertEquals(r.bloqueios, []);
  assertEquals(r.codigo, 0);
  assertStringIncludes(r.relatorio, "PRONTO");
  assertStringIncludes(
    secaoDaLoja(r.relatorio, REF_OAUTH),
    "faltam no ledger: nenhuma",
  );
  assertStringIncludes(
    secaoDaLoja(r.relatorio, REF_OAUTH),
    "functions: 2 em dia, 0 não prontas",
  );
  semCanario(r);
});

Deno.test("oauth 1: o dublê do CLI NUNCA recebe o ref da loja OAuth; a API recebe as leituras dela com o token dela", async () => {
  const { d, chamadas } = montar();
  await executar(d);
  assert(!refsDoCli(chamadas).has(REF_OAUTH), JSON.stringify(chamadas.cli));
  assertEquals(chamadas.gestao.map((g) => g.caminho).sort(), [
    `/v1/projects/${REF_OAUTH}/database/migrations`,
    `/v1/projects/${REF_OAUTH}/functions`,
  ]);
  for (const g of chamadas.gestao) assertEquals(g.auth, `Bearer ${CANARIO}`);
  // o código das functions veio do baixar OAuth, com o cliente da gestão da loja
  assertEquals(
    chamadas.baixarOAuth.map(([ref, nome, pedir]) => [ref, nome, pedir]).sort(),
    [
      [REF_OAUTH, "criar-pagamento", "function"],
      [REF_OAUTH, "webhook-mercadopago", "function"],
    ],
  );
});

// ====================================================================
// 2: IKCOUS e Savy pelo CLI, sem mudar nada
// ====================================================================

Deno.test("oauth 2: sem loja OAuth no cadastro, IKCOUS e Savy dão o MESMO relatório e as MESMAS chamadas que sem cadastro nenhum (o caminho de antes)", async () => {
  const semCadastro = montar({ oauth: [], cadastro: null, semOAuthDeps: true });
  const comCadastro = montar({ oauth: [] });
  const a = await executar(semCadastro.d);
  const b = await executar(comCadastro.d);
  assertEquals(a.codigo, 0);
  assertEquals(b.relatorio, a.relatorio);
  assertEquals(b.bloqueios, a.bloqueios);
  assertEquals(
    [...comCadastro.chamadas.cli].sort(),
    [...semCadastro.chamadas.cli].sort(),
  );
  // e nenhum caminho OAuth foi tocado
  assertEquals(comCadastro.chamadas.token, []);
  assertEquals(comCadastro.chamadas.gestao, []);
});

Deno.test("oauth 2: com a loja OAuth no cadastro, as seções e as chamadas de CLI da IKCOUS e da Savy ficam IGUAIS às de antes", async () => {
  const antes = montar({ oauth: [], cadastro: null, semOAuthDeps: true });
  const depois = montar();
  const a = await executar(antes.d);
  const b = await executar(depois.d);
  for (const ref of [REF_IKCOUS, REF_SAVY]) {
    assert(secaoDaLoja(a.relatorio, ref));
    assertEquals(secaoDaLoja(b.relatorio, ref), secaoDaLoja(a.relatorio, ref));
  }
  const doCli = (cs) =>
    cs.cli.filter((c) => c[1] === REF_IKCOUS || c[1] === REF_SAVY).sort();
  assertEquals(doCli(depois.chamadas), doCli(antes.chamadas));
  assertEquals(doCli(depois.chamadas).length, 2 * 4); // ledger, lista, 2 downloads
});

Deno.test("oauth 2: o lojas.json e o canais-de-backend.json DE VERDADE não têm loja OAuth hoje: o mapa sai vazio e nada bloqueia", () => {
  const { mapa, bloqueios } = lojasOAuth(carregarLojas(), lerCanais());
  assertEquals(mapa.size, 0);
  assertEquals(bloqueios, []);
});

Deno.test("oauth 2: sem loja OAuth, comLeituraOAuth devolve as MESMAS dependências (nenhuma leitura muda de mão)", () => {
  const { d } = montar({ oauth: [] });
  const { mapa } = lojasOAuth(d.cadastro, d.canais);
  assertEquals(comLeituraOAuth(d, { mapa, tokenDe: () => {} }), d);
});

// ====================================================================
// 3: o token é pedido UMA vez por loja
// ====================================================================

Deno.test("oauth 3: o token é pedido UMA vez por loja, com ledger, lista e downloads em paralelo, e cada loja usa o seu", async () => {
  const { d, chamadas } = montar({
    oauth: [
      { ref: REF_OAUTH, slug: "loja-teste" },
      { ref: REF_OAUTH_2, slug: "loja-dois" },
    ],
  });
  const r = await executar(d);
  assertEquals(r.codigo, 0, JSON.stringify(r.bloqueios));
  assertEquals(chamadas.token.sort(), [
    ["loja-dois", REF_OAUTH_2],
    ["loja-teste", REF_OAUTH],
  ]);
  for (const g of chamadas.gestao) {
    const esperado = g.caminho.includes(REF_OAUTH_2) ? CANARIO_2 : CANARIO;
    assertEquals(g.auth, `Bearer ${esperado}`);
  }
  semCanario(r);
});

Deno.test("oauth 3: falha ao pegar o token NÃO se repete (nenhuma segunda renovação na mesma execução)", async () => {
  let pedidos = 0;
  const { d } = montar({
    tokenOAuth: async () => {
      pedidos++;
      await esperar(3);
      throw new SemAcesso("Acesso: o Supabase recusou o refresh (HTTP 401).", {
        status: 401,
      });
    },
  });
  const r = await executar(d);
  assertEquals(r.codigo, 1);
  assertEquals(pedidos, 1);
});

// ====================================================================
// 4: não lida = bloqueia, nunca PRONTO, com o motivo e o que fazer
// ====================================================================

/** Bloqueio "ledger não lido" da loja OAuth, e nunca PRONTO. */
function exigirNaoLida(r, ...trechos) {
  assertEquals(r.codigo, 1);
  assert(!r.relatorio.includes("PRONTO"), "não lida nunca é PRONTO");
  const doLedger = r.bloqueios.find(
    (b) =>
      b.alvo.includes(REF_OAUTH) && b.motivo.startsWith("ledger não lido: "),
  );
  assert(doLedger, JSON.stringify(r.bloqueios, null, 1));
  assertStringIncludes(doLedger.motivo, "loja OAuth loja-teste");
  for (const t of trechos) assertStringIncludes(doLedger.motivo, t);
  assertStringIncludes(
    secaoDaLoja(r.relatorio, REF_OAUTH),
    "faltam no ledger: NÃO LIDO",
  );
  semCanario(r);
  return doLedger;
}

Deno.test("oauth 4: cofre SEM refresh (o acesso de verdade, cofre em memória vazio) — não lida, e manda rodar o abrir/receber do nova-loja", async () => {
  const acesso = criarAcessoOAuth({
    cofre: criarCofreMemoria(),
    fetch: () => {
      throw new Error("sem rede no teste");
    },
    agora: () => AGORA,
  });
  const { d, chamadas } = montar({
    tokenOAuth: ({ slug }) => acesso.tokenVigente({ slug, minimoMs: 2 * HORA }),
  });
  const r = await executar(d);
  exigirNaoLida(
    r,
    "sem acesso",
    "nova-loja.mjs abrir --loja loja-teste",
    "receber",
  );
  assert(!refsDoCli(chamadas).has(REF_OAUTH));
});

Deno.test("oauth 4: cofre TRAVADO — não lida, diz que outro comando está com a loja e o que fazer", async () => {
  const { d } = montar({
    tokenOAuth: async () => {
      throw new CofreTravado(
        "Cofre: a loja loja-teste está travada por outro comando (apague C:/x/loja-teste.trava se nenhum estiver rodando).",
      );
    },
  });
  exigirNaoLida(await executar(d), "travado", "loja-teste.trava");
});

Deno.test("oauth 4: SemAcesso (a API recusou o token: 401) — não lida, autorização revogada ou vencida, e o que fazer", async () => {
  const { d } = montar({
    respostaDaGestao: () => new Response("", { status: 401 }),
  });
  exigirNaoLida(await executar(d), "sem acesso", "abrir");
});

Deno.test("oauth 4: token SEM prazo (expiraEm nulo) — não lida", async () => {
  const { d, chamadas } = montar({
    tokenOAuth: async () => ({ accessToken: CANARIO, expiraEm: null }),
  });
  exigirNaoLida(await executar(d), "sem prazo");
  assertEquals(chamadas.gestao, [], "token sem prazo não é usado");
});

Deno.test("oauth 4: token VENCIDO — não lida, 'token venceu: rode o ensaio de novo', e nada renova de novo", async () => {
  let pedidos = 0;
  const { d, chamadas } = montar({
    tokenOAuth: async () => {
      pedidos++;
      return { accessToken: CANARIO, expiraEm: AGORA - 1 };
    },
  });
  exigirNaoLida(await executar(d), "token venceu: rode o ensaio de novo");
  assertEquals(pedidos, 1);
  assertEquals(chamadas.gestao, []);
});

Deno.test("oauth 4: API FORA (a conexão cai) — não lida, 'API do Supabase não respondeu', rode o ensaio de novo", async () => {
  const { d } = montar({
    respostaDaGestao: () => new TypeError("fetch failed"),
  });
  exigirNaoLida(await executar(d), "não respondeu", "rode o ensaio de novo");
});

Deno.test("oauth 4: resposta ILEGÍVEL do ledger (lista vazia) — não lida, nunca 'nada falta'", async () => {
  const { d } = montar({
    respostaDaGestao: (_ref, oQue) =>
      oQue === "database/migrations"
        ? new Response("[]", { status: 200 })
        : undefined,
  });
  exigirNaoLida(await executar(d), "ilegível");
});

Deno.test("oauth 4: sem fonte de token nas dependências — não lida (falha fechada, nunca cai no CLI)", async () => {
  const { d, chamadas } = montar();
  d.tokenOAuth = undefined;
  exigirNaoLida(await executar(d));
  assert(!refsDoCli(chamadas).has(REF_OAUTH));
});

Deno.test("oauth 4: sem fetch da gestão nas dependências — não lida (nunca o fetch global)", async () => {
  const { d } = montar();
  d.fetchGestao = undefined;
  exigirNaoLida(await executar(d));
});

Deno.test("oauth 4: o baixar PADRÃO (T3 ainda não existe) deixa as functions da loja OAuth não lidas: bloqueia, e diz por quê", async () => {
  const { d } = montar();
  d.baixarOAuth = undefined;
  const r = await executar(d);
  assertEquals(r.codigo, 1);
  assert(!r.relatorio.includes("PRONTO"));
  const dasFunctions = r.bloqueios.filter(
    (b) => b.alvo.includes(REF_OAUTH) && b.motivo.startsWith("function "),
  );
  assertEquals(dasFunctions.length, 2, JSON.stringify(r.bloqueios));
  for (const b of dasFunctions) {
    assertStringIncludes(b.motivo, "download falhou: loja OAuth loja-teste");
    assertStringIncludes(b.motivo, "T3");
  }
  // o ledger e a lista foram lidos: só o download fica não lido
  assertStringIncludes(
    secaoDaLoja(r.relatorio, REF_OAUTH),
    "faltam no ledger: nenhuma",
  );
  semCanario(r);
});

Deno.test("oauth 4: o baixar das dependências REAIS é o indisponível, com o código BAIXAR_INDISPONIVEL", async () => {
  const reais = dependenciasReais({
    rodarGh: () => Promise.reject(new Error("sem gh no teste")),
    rodarSupabase: () => Promise.reject(new Error("sem CLI no teste")),
  });
  assertEquals(reais.baixarOAuth, baixarOAuthIndisponivel);
  const e = await assertRejects(() =>
    reais.baixarOAuth(REF_OAUTH, "criar-pagamento", {}),
  );
  assertEquals(e.codigo, "BAIXAR_INDISPONIVEL");
  assertEquals(e.name, "ErroDaPonte");
  // o cadastro real entra nas dependências; o cofre só abre quando há loja OAuth
  assertEquals(reais.cadastro, carregarLojas());
  assertEquals(typeof reais.tokenOAuth, "function");
  assertEquals(typeof reais.fetchGestao, "function");
});

// ====================================================================
// 5: cadastro OAuth incoerente bloqueia pelo nome, sem ler nada
// ====================================================================

Deno.test("oauth 5: canal com migrations (ou functions) diferente do slug bloqueia pelo NOME, e nada da loja é lido", async () => {
  for (const campo of ["migrations", "functions"]) {
    const { d, chamadas } = montar({
      canais: (c) => {
        c.canais[REF_OAUTH][campo] = "outra-loja";
      },
    });
    const r = await executar(d);
    assertEquals(r.codigo, 1);
    const b = r.bloqueios.find(
      (x) =>
        x.alvo === `loja-teste (${REF_OAUTH})` &&
        x.motivo.startsWith("cadastro OAuth incoerente"),
    );
    assert(b, `${campo}: ${JSON.stringify(r.bloqueios)}`);
    assert(!refsDoCli(chamadas).has(REF_OAUTH), campo);
    assertEquals(chamadas.token, [], campo);
    assertEquals(chamadas.gestao, [], campo);
  }
});

Deno.test("oauth 5: loja OAuth SEM canal bloqueia pelo nome (mesmo fora do inventário)", async () => {
  const { d, chamadas } = montar({
    canais: (c) => {
      delete c.canais[REF_OAUTH];
    },
  });
  const r = await executar(d);
  assertEquals(r.codigo, 1);
  assert(
    r.bloqueios.some(
      (b) =>
        b.alvo === `loja-teste (${REF_OAUTH})` &&
        b.motivo.startsWith("cadastro OAuth incoerente") &&
        b.motivo.includes("sem canal"),
    ),
    JSON.stringify(r.bloqueios),
  );
  assert(!refsDoCli(chamadas).has(REF_OAUTH));
});

Deno.test("oauth 5: lojasOAuth: ref da loja OAuth repetido em outra entrada do cadastro é incoerente", () => {
  const cadastro = cadastroCom({
    "loja-teste": lojaOAuth(REF_OAUTH, "loja-teste"),
  });
  // validarCadastro já recusa duas ASSINANTES com o mesmo ref; o legado não
  const comLegado = {
    lojas: {
      ...cadastro.lojas,
      sandbox: { ...cadastro.lojas.loja, projeto: "sandbox", ref: REF_OAUTH },
    },
  };
  const { d } = montar();
  const { mapa, bloqueios } = lojasOAuth(comLegado, d.canais);
  assertEquals(bloqueios.length, 1);
  assertStringIncludes(bloqueios[0].motivo, "cadastro OAuth incoerente");
  assert(mapa.get(REF_OAUTH).incoerente);
});

Deno.test("oauth 5: lojasOAuth: cadastro ilegível (sem `lojas`) bloqueia, nunca vira 'nenhuma loja OAuth'", () => {
  const { d } = montar();
  for (const torto of [{}, { lojas: null }, { lojas: [] }, "x"]) {
    const { mapa, bloqueios } = lojasOAuth(torto, d.canais);
    assertEquals(mapa.size, 0);
    assertEquals(bloqueios.length, 1, JSON.stringify(torto));
    assertStringIncludes(bloqueios[0].motivo, "lojas.json");
  }
});

// ====================================================================
// 6: o canário nunca sai, nem quando o erro o carrega
// ====================================================================

Deno.test("oauth 6: erro que carrega o token na mensagem (do baixar ou da gestão) sai SEM o token", async () => {
  const comToken = montar({
    baixarOAuth: async () => {
      throw new Error(`falhou com Bearer ${CANARIO}`);
    },
  });
  const r1 = await executar(comToken.d);
  assertEquals(r1.codigo, 1);
  semCanario(r1);
  const { ErroDaGestao } = await import("../scripts/frota/supabase-gestao.mjs");
  const daGestao = montar({
    respostaDaGestao: () =>
      new ErroDaGestao(`Gestão Supabase: eco ${CANARIO}`, { codigo: "HTTP" }),
  });
  const r2 = await executar(daGestao.d);
  assertEquals(r2.codigo, 1);
  semCanario(r2);
});

// ====================================================================
// 7: conserto da loja OAuth avisa que só funciona dentro da sessão
// ====================================================================

Deno.test("oauth 7: os comandos de conserto da loja OAuth saem com o aviso da sessão; os da IKCOUS não", async () => {
  // a release muda o criar-pagamento: as três lojas precisam publicar
  const { d } = montar({
    arvoreDoSha: {
      "supabase/functions/criar-pagamento/index.ts": "pagamento v2",
    },
    baixarOAuth: async (_ref, nome) => [
      {
        caminho: `supabase/functions/${nome}/index.ts`,
        conteudo: nome === "criar-pagamento" ? "pagamento" : "webhook",
      },
    ],
  });
  d.baixarFuncao = async (_ref, nome) => [
    {
      caminho: `supabase/functions/${nome}/index.ts`,
      conteudo: nome === "criar-pagamento" ? "pagamento" : "webhook",
    },
  ];
  const r = await executar(d);
  assertEquals(r.codigo, 1);
  const i = r.consertos.indexOf(AVISO_DA_SESSAO);
  assert(i >= 0, r.consertos.join("\n"));
  const blocoOAuth = r.consertos.slice(i + 1);
  assert(
    blocoOAuth.some(
      (l) =>
        l.startsWith("gh workflow run publicar-functions.yml") &&
        l.includes('-f "projeto=loja-teste"'),
    ),
    r.consertos.join("\n"),
  );
  assertEquals(
    r.consertos.filter((l) => l === AVISO_DA_SESSAO).length,
    1,
    "só a loja OAuth leva o aviso",
  );
  // o bloco da IKCOUS vem antes do aviso e não o leva
  assert(
    r.consertos
      .slice(0, i)
      .some((l) => l.includes('-f "projeto=ikcous-publicada"')),
  );
});

// ====================================================================
// anotações da revisão Opus da T5
// ====================================================================

Deno.test("revisão: o RE_FUNCAO do leitor é IGUAL ao do portão (as cópias não podem divergir)", () => {
  assertEquals(RE_FUNCAO_DO_LEITOR.source, RE_FUNCAO_DO_PORTAO.source);
  assertEquals(RE_FUNCAO_DO_LEITOR.flags, RE_FUNCAO_DO_PORTAO.flags);
});

Deno.test("revisão: function REMOVED na loja OAuth conta como AUSENTE — gera o comando de publicar, nunca 'em dia'", async () => {
  const { d } = montar({
    funcoesNoAr: (ref) =>
      ref === REF_OAUTH
        ? [
            { slug: "criar-pagamento", verify_jwt: true, status: "REMOVED" },
            {
              slug: "webhook-mercadopago",
              verify_jwt: false,
              status: "ACTIVE",
            },
          ]
        : undefined,
  });
  const r = await executar(d);
  const secao = secaoDaLoja(r.relatorio, REF_OAUTH);
  assertStringIncludes(secao, "functions: 1 em dia");
  // a release não mudou a function: não bloqueia, mas o comando sai (o mesmo
  // caminho da function que falta numa loja nova), depois do aviso da sessão
  assertEquals(r.codigo, 0, JSON.stringify(r.bloqueios));
  const linhas = r.relatorio.split("\n");
  const i = linhas.indexOf(AVISO_DA_SESSAO);
  assert(i >= 0, r.relatorio);
  assert(
    linhas
      .slice(i)
      .some(
        (l) =>
          l.startsWith("gh workflow run publicar-functions.yml") &&
          l.includes('-f "projeto=loja-teste"') &&
          l.includes('-f "functions=criar-pagamento"'),
      ),
    r.relatorio,
  );
});

Deno.test("revisão: verify_jwt ausente na loja OAuth — o bloqueio diz QUAL function e QUAL loja", async () => {
  const { d } = montar({
    funcoesNoAr: (ref) =>
      ref === REF_OAUTH
        ? [
            { slug: "criar-pagamento", verify_jwt: true, status: "ACTIVE" },
            { slug: "webhook-mercadopago", status: "ACTIVE" },
          ]
        : undefined,
  });
  const r = await executar(d);
  assertEquals(r.codigo, 1);
  const b = r.bloqueios.find(
    (x) => x.alvo.includes(REF_OAUTH) && x.motivo.includes("verify_jwt"),
  );
  assert(b, JSON.stringify(r.bloqueios));
  assertStringIncludes(b.motivo, "webhook-mercadopago");
  assertStringIncludes(b.motivo, "loja-teste");
  assertStringIncludes(b.motivo, REF_OAUTH);
});
