// @ts-nocheck
/* eslint-disable security/detect-object-injection -- dublês de teste: as chaves vêm de constantes e mapas fechados do próprio arquivo, nunca de entrada externa. */
/* eslint-disable security/detect-non-literal-fs-filename -- o teste só lê e grava na pasta temporária que ele mesmo cria. */
/**
 * scripts/frota/publicar-release.mjs --sessao e --faxina (T8 do plano
 * PORTAO-OAUTH-PONTE-A, 26/11/2026, com as mudanças obrigatórias do crítico).
 *
 * A sessão abre a ponte (ponte-oauth.mjs, T7), grava os segredos das lojas
 * OAuth no GitHub e roda o ensaio em laço: Enter ensaia de novo, `promover`
 * publica, `sair` encerra. O que cada teste trava (e cai se a guarda sair):
 *  - o laço: o ensaio roda com o token DA SESSÃO (deps.tokenOAuth), nunca com
 *    renovar/tokenVigente; o aviso "só dentro de --sessao" some na sessão;
 *  - o fechar roda em TODO final: sair, promover que publicou, exceção no
 *    publicarRelease, SIGINT/SIGBREAK/SIGHUP do processo, Ctrl+C no prompt e
 *    a entrada fechada (rl.on("SIGINT") e rl.on("close"), mudança 1), Ctrl+C
 *    no meio do ensaio, o token perto de vencer (antes da rodada e pelo
 *    relógio parado no prompt);
 *  - o tratador é persistente: o 2º sinal só diz "apagando..." (mudança 1);
 *  - o fechar não depende de processo filho: o token do gh é lido UMA vez e o
 *    apagar é fetch DELETE dentro do processo (mudança 2);
 *  - sair/promover só fecham sem run em andamento; o sinal fecha mesmo assim,
 *    avisando (mudança 3, parte dos runs);
 *  - abertura interrompida apaga TODOS os nomes OAuth (mudança 5);
 *  - alguém além do dono com escrita: a sessão não abre (mudança 6);
 *  - o adaptador real do gh: argv na ordem do plano, valor SÓ pelo stdin, sem
 *    quebra de linha (um executável dublê em node grava argv e stdin);
 *  - --repo sai do `git remote get-url origin`, só github.com/OWNER/REPO;
 *  - --faxina avulsa só apaga segredo de loja OAuth e nada renova;
 *  - --sessao com --promover na linha de comando é uso errado (saída 2);
 *  - CANÁRIO: o valor do segredo nunca aparece no argv, no env do filho, na
 *    saída nem em erro.
 *
 * Nenhuma rede e nenhum gh de verdade: o gh é um script node numa pasta
 * temporária, o GitHub é um fetch dublê, o acesso e o relógio são dublês. Os
 * tokens são canários montados em tempo de execução.
 */
import { spawn as spawnNode } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { criarGhReal } from "../scripts/frota/ponte-oauth.mjs";
import {
  AVISO_DA_SESSAO_OAUTH,
  AVISO_DE_VENCIMENTO_MS,
  MATAR_TOKEN_NO_FECHAR,
  WORKFLOWS_COM_SEGREDO_DA_LOJA,
  lerArgumentos,
  main,
  publicarRelease,
  repoDoRemoto,
  rodarFaxina,
  rodarSessao,
  runsEmAndamentoPelaCli,
} from "../scripts/frota/publicar-release.mjs";

const require = createRequire(import.meta.url);
const { validarCadastro } = require("../scripts/frota/lojas.cjs");

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHA = "1".repeat(40);
const BASE = "2".repeat(40);
const TOPO = "4".repeat(40);
const IDENT = "e".repeat(64);
const DPL = "dpl_Novo123";
const DPL_ANTERIOR = "dpl_Anterior456";
const AGORA = Date.parse("2026-11-26T20:00:00Z");
const HORA = 3600 * 1000;
const MIN = 60 * 1000;
const REPO = "dono-falso/repo-falso";
const ARQUIVO_NOTAS = "src/novidades/notas-das-versoes.json";

// canários montados em tempo de execução (literal no fonte dispara o secretlint)
const canario = (par) => `sbp_oauth_${par.repeat(20)}`;
const CANARIO = canario("ab");
const CANARIO_2 = canario("cd");
const CANARIO_MORTO = canario("ef");
const CANARIOS = [CANARIO, CANARIO_2, CANARIO_MORTO, "sbp_oauth_"];

const REF_IKCOUS = "cafkrminfnokvgjqtkle";
const REF_SAVY = "gnjsrucsmjkajijrakzr";
const REF_OAUTH = "oauthlojatesteaaaaaa";
const REF_OAUTH_2 = "oauthlojadoisbbbbbbb";
const NOME_TESTE = "SUPABASE_ACCESS_TOKEN_LOJA_TESTE";
const NOME_DOIS = "SUPABASE_ACCESS_TOKEN_LOJA_DOIS";
const NOME_IKCOUS = "SUPABASE_ACCESS_TOKEN_IKCOUS";
const TOKEN_DA_LOJA = { "loja-teste": CANARIO, "loja-dois": CANARIO_2 };

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const pendente = () => new Promise(() => {});

async function ate(condicao, rotulo, limiteMs = 10_000) {
  const fim = Date.now() + limiteMs;
  while (!(await condicao())) {
    if (Date.now() > fim)
      throw new Error(`tempo esgotado esperando: ${rotulo}`);
    await esperar(10);
  }
}

// ------------------------------------------------------------ cadastro ---

const lojaOAuth = (ref, slug) => ({
  ref,
  classe: "assinante",
  apelido: `Teste ${slug}`,
  segredoDoToken: `SUPABASE_ACCESS_TOKEN_${slug.toUpperCase().replace(/-/g, "_")}`,
  functionsNomeadas: false,
  acesso: "oauth",
});

/** O lojas.json normalizado pelo código de verdade, com duas lojas OAuth. */
function cadastroCom(oauth = ["loja-teste", "loja-dois"]) {
  const refs = { "loja-teste": REF_OAUTH, "loja-dois": REF_OAUTH_2 };
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
        segredoDoToken: NOME_IKCOUS,
        functionsNomeadas: true,
      },
      savy: {
        ref: REF_SAVY,
        classe: "assinante",
        apelido: "Savy",
        segredoDoToken: "SUPABASE_ACCESS_TOKEN_SAVY",
        functionsNomeadas: true,
      },
      ...Object.fromEntries(oauth.map((s) => [s, lojaOAuth(refs[s], s)])),
    },
  });
}

// ------------------------------------------------- o gh: executável dublê ---

/**
 * O "gh": um script node. Grava (uma linha JSON por chamada) os argumentos, o
 * stdin, os nomes de variável do env que carregam um canário e a hora. O
 * `modo` vem antes dos argumentos do gh (o teste escolhe por chamada).
 */
const GH_DUBLE = `
const fs = require("node:fs");
const [registro, modo, ...args] = process.argv.slice(2);
let entrada = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { entrada += c; });
process.stdin.on("end", () => {
  const envComCanario = Object.entries(process.env)
    .filter(([, v]) => String(v).includes("sbp_oauth_"))
    .map(([k]) => k);
  fs.appendFileSync(registro, JSON.stringify({ args, entrada, envComCanario, modo, t: Date.now() }) + "\\n");
  if (args[0] === "auth" && args[1] === "token") {
    process.stdout.write("gho_" + "12".repeat(18) + "\\n");
    process.exit(0);
  }
  if (args[0] === "secret" && args[1] === "set") {
    if (modo === "falha-ecoando") {
      process.stderr.write("erro ao gravar o valor " + entrada + "\\n");
      process.exit(1);
    }
    if (modo === "pendura") { setInterval(() => {}, 1000); return; }
    process.exit(0);
  }
  process.exit(3);
});
`;

function lerRegistroSync(registro) {
  return readFileSync(registro, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/**
 * O GitHub: colaboradores, lista de segredos e DELETE. O estado dos segredos
 * é a história (o `secret set` do registro do gh dublê e os DELETE daqui),
 * na ordem do relógio: é o `gh secret list` que o teste confere no fim.
 */
function githubFalso(
  registro,
  {
    existentes = [],
    escrita = ["dono-falso"],
    apagarFalha = [],
    segurarApagar = false,
  } = {},
) {
  const apagados = [];
  const chamadas = [];
  let soltar = () => {};
  const solto = new Promise((r) => {
    soltar = r;
  });
  const noGitHub = () => {
    const eventos = [
      ...existentes.map((nome) => ({ t: 0, nome, ha: true })),
      ...lerRegistroSync(registro)
        .filter(
          (r) =>
            r.args[0] === "secret" &&
            r.args[1] === "set" &&
            r.modo !== "falha-ecoando",
        )
        .map((r) => ({ t: r.t, nome: r.args[2], ha: true })),
      ...apagados
        .filter((a) => a.efetivo)
        .map((a) => ({ t: a.t, nome: a.nome, ha: false })),
    ].sort((a, b) => a.t - b.t);
    const ha = new Set();
    for (const e of eventos) {
      if (e.ha) ha.add(e.nome);
      else ha.delete(e.nome);
    }
    return [...ha].sort();
  };
  const fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const metodo = init.method ?? "GET";
    chamadas.push({
      metodo,
      caminho: u.pathname,
      auth: init.headers?.authorization,
    });
    if (metodo === "GET" && u.pathname === `/repos/${REPO}/collaborators`) {
      return new Response(
        JSON.stringify(
          escrita.map((login) => ({
            login,
            permissions: { admin: login === "dono-falso", push: true },
          })),
        ),
        { status: 200 },
      );
    }
    if (metodo === "GET" && u.pathname === `/repos/${REPO}/actions/secrets`) {
      const nomes = noGitHub();
      return new Response(
        JSON.stringify({
          total_count: nomes.length,
          secrets: nomes.map((name) => ({ name })),
        }),
        { status: 200 },
      );
    }
    const m = new RegExp(`^/repos/${REPO}/actions/secrets/([A-Z0-9_]+)$`).exec(
      u.pathname,
    );
    if (metodo === "DELETE" && m) {
      const nome = m[1];
      const existia = noGitHub().includes(nome);
      const falha = apagarFalha.includes(nome);
      const registroDoApagar = { nome, t: Date.now(), efetivo: false };
      apagados.push(registroDoApagar);
      if (segurarApagar) await solto;
      if (falha) return new Response("", { status: 500 });
      registroDoApagar.efetivo = existia;
      registroDoApagar.t = Date.now();
      return new Response("", { status: existia ? 204 : 404 });
    }
    return new Response("", { status: 404 });
  };
  return { fetch, apagados, chamadas, noGitHub, soltar: () => soltar() };
}

// -------------------------------------------------------- acesso dublê ---

function acessoFalso({ expiraEm = AGORA + 20 * HORA, antesDeRenovar } = {}) {
  const chamadas = {
    longa: [],
    deNovo: [],
    liberar: [],
    renovar: 0,
    vigente: 0,
  };
  const acesso = {
    async renovarComTravaLonga({ slug }) {
      chamadas.longa.push(slug);
      if (antesDeRenovar) await antesDeRenovar(slug);
      return {
        accessToken: TOKEN_DA_LOJA[slug],
        expiraEm,
        async renovarDeNovo() {
          chamadas.deNovo.push(slug);
          return { accessToken: CANARIO_MORTO, expiraEm: AGORA + 24 * HORA };
        },
        async liberar() {
          chamadas.liberar.push(slug);
        },
      };
    },
    async renovar() {
      chamadas.renovar++;
      throw new Error("a sessão nunca renova fora da trava longa");
    },
    async tokenVigente() {
      chamadas.vigente++;
      throw new Error("a sessão nunca usa o token do ensaio avulso");
    },
  };
  return { acesso, chamadas };
}

// ------------------------------------------------- o dono e os sinais ---

/** O dono no teclado: cada pergunta consome uma resposta (texto ou função). */
class EntradaFalsa extends EventEmitter {
  constructor(respostas) {
    super();
    this.respostas = [...respostas];
    this.perguntas = [];
    this.fechada = false;
    this.m = null;
  }
  perguntar(texto) {
    this.perguntas.push(texto);
    const r = this.respostas.shift();
    if (r === undefined) return pendente();
    if (typeof r === "function") return Promise.resolve(r(this.m));
    return Promise.resolve(r);
  }
  close() {
    this.fechada = true;
  }
}

/** Resposta que, em vez de digitar, dispara um evento e fica esperando. */
const disparar = (alvo, evento) => (m) => {
  setTimeout(() => (alvo === "entrada" ? m.entrada : m.sinais).emit(evento), 0);
  return pendente();
};

/** O publicarRelease dublê: usa a fonte de token como o portão usaria. */
function publicarFalso(roteiro = []) {
  const chamadas = [];
  const fn = async (opcoes, deps) => {
    const i = chamadas.length;
    const registro = { opcoes, tokens: [] };
    chamadas.push(registro);
    for (const [slug, ref] of [
      ["loja-teste", REF_OAUTH],
      ["loja-dois", REF_OAUTH_2],
    ]) {
      const t = await deps.tokenOAuth({ slug, ref });
      registro.tokens.push(t.accessToken);
    }
    const passo = roteiro[i] ?? { codigo: 1 };
    if (typeof passo === "function") return passo(opcoes, deps);
    return {
      codigo: passo.codigo,
      relatorio: `rodada ${i + 1}: promover=${opcoes.promover}`,
      bloqueios: [],
      lojas: [],
      producaoAnterior: null,
    };
  };
  fn.chamadas = chamadas;
  return fn;
}

/**
 * Monta tudo numa pasta temporária e roda `corpo(m)`; a pasta sai no fim.
 * `m.rodar()` chama rodarSessao com o ambiente dublê.
 */
async function comSessao(op, corpo) {
  const dir = await Deno.makeTempDir({ prefix: "sessao-t8-" });
  try {
    const registro = path.join(dir, "gh.jsonl");
    const duble = path.join(dir, "gh-duble.cjs");
    await Deno.writeTextFile(registro, "");
    await Deno.writeTextFile(duble, GH_DUBLE);
    const cadastro = op.cadastro ?? cadastroCom();
    const github = githubFalso(registro, op.github);
    const spawns = [];
    const gh = criarGhReal({
      repo: REPO,
      cadastro,
      fetch: github.fetch,
      spawn: (_exe, args, opcoes) => {
        spawns.push(args);
        return spawnNode(
          "node",
          [duble, registro, op.modoDoGh?.(args) ?? "ok", ...args],
          opcoes,
        );
      },
    });
    const { acesso, chamadas: acessoChamadas } = acessoFalso(op.acesso);
    const entrada = new EntradaFalsa(op.respostas ?? []);
    const sinais = new EventEmitter();
    const saida = [];
    const relogio = { t: AGORA };
    const agendados = [];
    const publicar = op.publicar ?? publicarFalso(op.roteiro);
    const amb = {
      deps: op.deps ?? {},
      cadastro,
      acesso,
      gh,
      entrada,
      sinais,
      escrever: (t) => saida.push(String(t)),
      agora: () => relogio.t,
      agendar: (fn, ms) => {
        const a = { fn, ms, cancelado: false };
        agendados.push(a);
        return () => {
          a.cancelado = true;
        };
      },
      publicar,
      runsEmAndamento: op.runsEmAndamento ?? (async () => []),
      ...(op.amb ?? {}),
    };
    const m = {
      amb,
      registro,
      github,
      spawns,
      acessoChamadas,
      entrada,
      sinais,
      saida,
      texto: () => saida.join("\n"),
      relogio,
      agendados,
      publicar,
      ghRegistro: () => lerRegistroSync(registro),
      rodar: (opcoes = {}) =>
        rodarSessao({ sha: SHA, deploymentId: DPL, ...opcoes }, amb),
    };
    entrada.m = m;
    await corpo(m);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const deletesDe = (m) => m.github.apagados.map((a) => a.nome).sort();

function semCanario(texto, rotulo) {
  for (const c of CANARIOS) {
    assert(!String(texto).includes(c), `${rotulo}: vazou um token`);
  }
}

/** Fim de sessão: nada sobrou no GitHub, tratadores fora, entrada fechada. */
function assertFechouLimpo(m) {
  assertEquals(m.github.noGitHub(), [], "sobrou segredo no GitHub");
  for (const s of ["SIGINT", "SIGBREAK", "SIGHUP"]) {
    assertEquals(m.sinais.listenerCount(s), 0, `tratador de ${s} ficou`);
  }
  assertEquals(m.entrada.listenerCount("SIGINT"), 0, "rl.on(SIGINT) ficou");
  assertEquals(m.entrada.listenerCount("close"), 0, "rl.on(close) ficou");
  assert(m.entrada.fechada, "a entrada não foi fechada");
  assertEquals(m.acessoChamadas.liberar.sort(), ["loja-dois", "loja-teste"]);
}

// ====================================================================
// 1. o laço
// ====================================================================

Deno.test("sessão 1: abre (faxina, uma renovação por loja, grava), ensaia com o token DA SESSÃO, Enter ensaia de novo, promover publica e fecha", async () => {
  await comSessao(
    {
      respostas: ["", "promover"],
      roteiro: [{ codigo: 1 }, { codigo: 0 }, { codigo: 0 }],
    },
    async (m) => {
      const codigo = await m.rodar();
      assertEquals(codigo, 0);
      // três rodadas: ensaio, ensaio (Enter), promover
      assertEquals(
        m.publicar.chamadas.map((c) => c.opcoes.promover),
        [false, false, true],
      );
      for (const c of m.publicar.chamadas) {
        assertEquals(c.opcoes.emSessao, true);
        assertEquals(c.opcoes.sha, SHA);
        assertEquals(c.opcoes.deploymentId, DPL);
        assertEquals(c.tokens, [CANARIO, CANARIO_2]);
      }
      // uma renovação por loja, só pela trava longa; nunca renovar/vigente
      assertEquals(m.acessoChamadas.longa, ["loja-teste", "loja-dois"]);
      assertEquals(m.acessoChamadas.renovar, 0);
      assertEquals(m.acessoChamadas.vigente, 0);
      // gravou as duas e apagou as duas no fim
      const sets = m
        .ghRegistro()
        .filter((r) => r.args[0] === "secret")
        .map((r) => r.args[2]);
      assertEquals(sets, [NOME_TESTE, NOME_DOIS]);
      assertEquals(deletesDe(m), [NOME_DOIS, NOME_TESTE]);
      assertStringIncludes(m.texto(), "segredos apagados: 2 de 2");
      assertStringIncludes(m.texto(), NOME_TESTE);
      assertFechouLimpo(m);
    },
  );
});

Deno.test("sessão 1: `sair` encerra com o código da última rodada e cancela o relógio do vencimento", async () => {
  await comSessao(
    { respostas: ["sair"], roteiro: [{ codigo: 1 }] },
    async (m) => {
      assertEquals(await m.rodar(), 1);
      assertEquals(m.publicar.chamadas.length, 1);
      assertEquals(m.agendados.length, 1);
      assert(m.agendados[0].cancelado, "o relógio do vencimento ficou ligado");
      assertFechouLimpo(m);
    },
  );
});

Deno.test("sessão 1: promover que NÃO publica (bloqueado) volta ao prompt; nada fecha até o `sair`", async () => {
  await comSessao(
    {
      respostas: [
        "promover",
        (mm) => {
          assertEquals(mm.github.apagados.length, 0, "fechou cedo demais");
          return "sair";
        },
      ],
      roteiro: [{ codigo: 1 }, { codigo: 1 }],
    },
    async (m) => {
      assertEquals(await m.rodar(), 1);
      assertEquals(
        m.publicar.chamadas.map((c) => c.opcoes.promover),
        [false, true],
      );
      assertFechouLimpo(m);
    },
  );
});

Deno.test("sessão 1: resposta desconhecida não roda nada e pergunta de novo", async () => {
  await comSessao(
    { respostas: ["publicar", "sair"], roteiro: [{ codigo: 0 }] },
    async (m) => {
      assertEquals(await m.rodar(), 0);
      assertEquals(m.publicar.chamadas.length, 1);
      assertEquals(m.entrada.perguntas.length, 2);
      assertStringIncludes(m.texto(), "não entendi");
      assertFechouLimpo(m);
    },
  );
});

// ====================================================================
// 2. o fechar roda em todo final
// ====================================================================

Deno.test("sessão 2: exceção DENTRO do publicarRelease (de verdade) fecha, sai 2 e a mensagem não leva token", async () => {
  const deps = depsDoPortao().d;
  deps.inventariar = async () => {
    throw new Error(`inventário caiu com ${CANARIO} na mensagem`);
  };
  await comSessao({ publicar: publicarRelease, deps }, async (m) => {
    assertEquals(await m.rodar(), 2);
    assertStringIncludes(m.texto(), "inventário caiu");
    semCanario(m.texto(), "saída");
    assertFechouLimpo(m);
  });
});

for (const sinal of ["SIGINT", "SIGBREAK", "SIGHUP"]) {
  Deno.test(`sessão 2: ${sinal} do processo com o prompt aberto fecha e sai com o código da última rodada`, async () => {
    await comSessao(
      {
        respostas: [disparar("sinais", sinal)],
        roteiro: [{ codigo: 0 }],
      },
      async (m) => {
        assertEquals(await m.rodar(), 0);
        assertEquals(m.publicar.chamadas.length, 1);
        assertFechouLimpo(m);
      },
    );
  });
}

Deno.test("sessão 2 (mudança 1): Ctrl+C no prompt do readline (rl 'SIGINT', modo cru) fecha", async () => {
  await comSessao(
    { respostas: [disparar("entrada", "SIGINT")], roteiro: [{ codigo: 1 }] },
    async (m) => {
      assertEquals(await m.rodar(), 1);
      assertFechouLimpo(m);
    },
  );
});

Deno.test("sessão 2 (mudança 1): a entrada que fecha (rl 'close': Ctrl+D, stdin acabou) fecha a sessão", async () => {
  await comSessao(
    { respostas: [disparar("entrada", "close")], roteiro: [{ codigo: 1 }] },
    async (m) => {
      assertEquals(await m.rodar(), 1);
      assertFechouLimpo(m);
    },
  );
});

Deno.test("sessão 2: Ctrl+C NO MEIO do ensaio fecha na hora (sem esperar o ensaio) e sai 1", async () => {
  let noEnsaio = false;
  await comSessao(
    {
      publicar: async (_opcoes, deps) => {
        await deps.tokenOAuth({ slug: "loja-teste", ref: REF_OAUTH });
        noEnsaio = true;
        return pendente();
      },
    },
    async (m) => {
      const r = m.rodar();
      await ate(() => noEnsaio, "o ensaio começar");
      m.entrada.emit("SIGINT");
      assertEquals(await r, 1);
      assertFechouLimpo(m);
    },
  );
});

Deno.test("sessão 2 (mudança 1): tratador persistente — o 2º e o 3º sinal só dizem 'apagando...', o fechar roda UMA vez", async () => {
  await comSessao(
    {
      respostas: [disparar("sinais", "SIGINT")],
      roteiro: [{ codigo: 1 }],
      github: { segurarApagar: true },
    },
    async (m) => {
      const r = m.rodar();
      await ate(() => m.github.apagados.length === 2, "os DELETE em voo");
      m.sinais.emit("SIGBREAK");
      m.entrada.emit("SIGINT");
      const apagando = m.saida.filter((l) => l.includes("apagando")).length;
      assertEquals(apagando, 2);
      m.github.soltar();
      assertEquals(await r, 1);
      assertEquals(m.github.apagados.length, 2, "o fechar rodou de novo");
      assertEquals(m.acessoChamadas.deNovo.length, 2);
      assertFechouLimpo(m);
    },
  );
});

Deno.test("sessão 2: token com menos de 45 min antes de uma rodada — avisa a hora, fecha, e NÃO roda a rodada", async () => {
  const expiraEm = AGORA + 3 * HORA;
  await comSessao(
    {
      acesso: { expiraEm },
      respostas: [
        (mm) => {
          mm.relogio.t = expiraEm - 30 * MIN;
          return "";
        },
      ],
      roteiro: [{ codigo: 1 }],
    },
    async (m) => {
      assertEquals(await m.rodar(), 1);
      assertEquals(m.publicar.chamadas.length, 1);
      const d = new Date(expiraEm);
      const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      assertStringIncludes(
        m.texto(),
        `o token vence às ${hhmm}; feche e abra outra sessão`,
      );
      assertFechouLimpo(m);
    },
  );
});

Deno.test("sessão 2: parado no prompt, o relógio agendado para 45 min antes do vencimento fecha sozinho", async () => {
  const expiraEm = AGORA + 5 * HORA;
  await comSessao(
    { acesso: { expiraEm }, roteiro: [{ codigo: 0 }] },
    async (m) => {
      const r = m.rodar();
      await ate(() => m.entrada.perguntas.length === 1, "o prompt");
      assertEquals(m.agendados.length, 1);
      assertEquals(
        m.agendados[0].ms,
        expiraEm - AVISO_DE_VENCIMENTO_MS - AGORA,
      );
      m.relogio.t = expiraEm - AVISO_DE_VENCIMENTO_MS;
      m.agendados[0].fn();
      assertEquals(await r, 0);
      assertStringIncludes(m.texto(), "o token vence às");
      assertFechouLimpo(m);
    },
  );
});

Deno.test("sessão 2: o fechar tem teto — DELETE que não responde não prende a sessão; manda rodar --faxina", async () => {
  await comSessao(
    {
      respostas: ["sair"],
      roteiro: [{ codigo: 1 }],
      github: { segurarApagar: true },
      amb: { tetoDoFecharMs: 40 },
    },
    async (m) => {
      assertEquals(await m.rodar(), 1);
      assertStringIncludes(m.texto(), "--faxina");
      assertStringIncludes(m.texto(), NOME_TESTE);
      // solta o DELETE preso e deixa o fechar em segundo plano terminar
      m.github.soltar();
      await ate(
        () => m.acessoChamadas.liberar.length === 2,
        "o fechar em segundo plano",
      );
      await esperar(20);
    },
  );
});

// ====================================================================
// 3. mudança 2: o fechar não depende de processo filho
// ====================================================================

Deno.test("sessão 3 (mudança 2): `gh auth token` é lido UMA vez; o fechar apaga por fetch DELETE, sem nenhum processo filho", async () => {
  await comSessao(
    { respostas: ["", "sair"], roteiro: [{ codigo: 1 }, { codigo: 1 }] },
    async (m) => {
      assertEquals(await m.rodar(), 1);
      const authToken = m.spawns.filter((a) => a[0] === "auth");
      assertEquals(authToken.length, 1);
      // só auth token + os dois secret set: nada de gh no fechar
      assertEquals(m.spawns.length, 3);
      const deletes = m.github.chamadas.filter((c) => c.metodo === "DELETE");
      assertEquals(deletes.length, 2);
      for (const d of deletes) assert(d.auth?.startsWith("Bearer gho_"));
      assertFechouLimpo(m);
    },
  );
});

// ====================================================================
// 4. mudança 3: runs em andamento
// ====================================================================

Deno.test("sessão 4 (mudança 3): `sair` com run em andamento NÃO fecha; avisa e pergunta de novo; sem runs, fecha", async () => {
  const respostasDosRuns = [
    [{ workflow: "publicar-functions.yml", id: 4242, titulo: "Publicar" }],
    [],
  ];
  await comSessao(
    {
      respostas: [
        "sair",
        (mm) => {
          assertEquals(mm.github.apagados.length, 0, "fechou com run vivo");
          return "sair";
        },
      ],
      roteiro: [{ codigo: 0 }],
      runsEmAndamento: async () => respostasDosRuns.shift(),
    },
    async (m) => {
      assertEquals(await m.rodar(), 0);
      assertStringIncludes(m.texto(), "4242");
      assertStringIncludes(m.texto(), "Ctrl+C");
      assertFechouLimpo(m);
    },
  );
});

Deno.test("sessão 4 (mudança 3): sem conseguir ler os runs, `sair` NÃO fecha no escuro", async () => {
  let n = 0;
  await comSessao(
    {
      respostas: [
        "sair",
        (mm) => {
          assertEquals(mm.github.apagados.length, 0);
          return "sair";
        },
      ],
      roteiro: [{ codigo: 1 }],
      runsEmAndamento: async () => {
        n++;
        if (n === 1) throw new Error("gh run list falhou");
        return [];
      },
    },
    async (m) => {
      assertEquals(await m.rodar(), 1);
      assertStringIncludes(m.texto(), "não consegui ler os runs");
      assertFechouLimpo(m);
    },
  );
});

Deno.test("sessão 4 (mudança 3): promover que publicou com run em andamento volta ao prompt", async () => {
  const respostasDosRuns = [
    [{ workflow: "aplicar-migrations.yml", id: 7, titulo: "x" }],
    [],
  ];
  await comSessao(
    {
      respostas: ["promover", "sair"],
      roteiro: [{ codigo: 1 }, { codigo: 0 }],
      runsEmAndamento: async () => respostasDosRuns.shift(),
    },
    async (m) => {
      assertEquals(await m.rodar(), 0);
      assertEquals(m.entrada.perguntas.length, 2);
      assertFechouLimpo(m);
    },
  );
});

Deno.test("sessão 4 (mudança 3): o SINAL fecha mesmo com run em andamento, e avisa que não conferiu", async () => {
  let lidos = 0;
  await comSessao(
    {
      respostas: [disparar("sinais", "SIGHUP")],
      roteiro: [{ codigo: 1 }],
      runsEmAndamento: async () => {
        lidos++;
        return [{ workflow: "publicar-functions.yml", id: 1, titulo: "x" }];
      },
    },
    async (m) => {
      assertEquals(await m.rodar(), 1);
      assertEquals(lidos, 0);
      assertStringIncludes(m.texto(), "sem conferir runs");
      assertFechouLimpo(m);
    },
  );
});

// ====================================================================
// 5. mudanças 5 e 6: abertura interrompida e escrita de terceiros
// ====================================================================

Deno.test("sessão 5 (mudança 5): sinal DURANTE a renovação — a abertura cai, TODOS os nomes OAuth são apagados, nada ensaia", async () => {
  await comSessao(
    {
      acesso: {
        antesDeRenovar: async (slug) => {
          if (slug !== "loja-dois") return;
          setTimeout(() => sinaisDoTeste.emit("SIGINT"), 0);
          await pendente();
        },
      },
    },
    async (m) => {
      sinaisDoTeste = m.sinais;
      assertEquals(await m.rodar(), 1);
      assertEquals(m.publicar.chamadas.length, 0);
      assertEquals(deletesDe(m), [NOME_DOIS, NOME_TESTE]);
      assertStringIncludes(m.texto(), "interrompida");
      assertEquals(m.github.noGitHub(), []);
      assertEquals(m.acessoChamadas.liberar, ["loja-teste"]);
      assertEquals(m.sinais.listenerCount("SIGINT"), 0);
      assert(m.entrada.fechada);
    },
  );
});
let sinaisDoTeste = null;

Deno.test("sessão 5 (mudança 5): sinal com o `gh secret set` da 2ª loja em voo — o gh morre e os DOIS segredos saem", async () => {
  await comSessao(
    {
      modoDoGh: (args) =>
        args[0] === "secret" && args[2] === NOME_DOIS ? "pendura" : "ok",
    },
    async (m) => {
      const r = m.rodar();
      await ate(
        () => m.ghRegistro().some((x) => x.args[2] === NOME_DOIS),
        "o gh da 2ª loja",
      );
      m.sinais.emit("SIGINT");
      assertEquals(await r, 1);
      assertEquals(m.publicar.chamadas.length, 0);
      assert(deletesDe(m).includes(NOME_TESTE));
      assert(deletesDe(m).includes(NOME_DOIS));
      assertEquals(m.github.noGitHub(), []);
      assertEquals(m.acessoChamadas.liberar.sort(), [
        "loja-dois",
        "loja-teste",
      ]);
    },
  );
});

Deno.test("sessão 5 (mudança 6): alguém além do dono com escrita no repositório — a sessão não abre, nada renova nem grava", async () => {
  await comSessao(
    { github: { escrita: ["dono-falso", "intruso-falso"] } },
    async (m) => {
      assertEquals(await m.rodar(), 1);
      assertStringIncludes(m.texto(), "intruso-falso");
      assertEquals(m.acessoChamadas.longa, []);
      assertEquals(
        m.ghRegistro().filter((x) => x.args[0] === "secret").length,
        0,
      );
      assertEquals(m.publicar.chamadas.length, 0);
    },
  );
});

// ====================================================================
// 6. canário e o adaptador real do gh
// ====================================================================

Deno.test("sessão 6 (canário): o valor nunca vai no argv nem no env do gh; vai SÓ no stdin, sem quebra de linha; nunca na saída", async () => {
  // o env desta máquina NUNCA vai para a mensagem de um assert (pode ter chave)
  const envAntes = new Map(Object.entries(Deno.env.toObject()));
  await comSessao(
    { respostas: ["", "sair"], roteiro: [{ codigo: 1 }, { codigo: 1 }] },
    async (m) => {
      assertEquals(await m.rodar(), 1);
      const registro = m.ghRegistro();
      for (const r of registro) {
        semCanario(JSON.stringify(r.args), "argv do gh");
        assertEquals(r.envComCanario, [], "env do gh com canário");
      }
      const sets = registro.filter((r) => r.args[0] === "secret");
      assertEquals(
        sets.map((r) => r.args),
        [
          ["secret", "set", NOME_TESTE, "--app", "actions", "--repo", REPO],
          ["secret", "set", NOME_DOIS, "--app", "actions", "--repo", REPO],
        ],
      );
      assertEquals(
        sets.map((r) => r.entrada),
        [CANARIO, CANARIO_2],
      );
      semCanario(m.texto(), "saída da sessão");
    },
  );
  const envDepois = Object.entries(Deno.env.toObject());
  assert(
    envDepois.length === envAntes.size &&
      envDepois.every(([k, v]) => envAntes.get(k) === v),
    "o process.env mudou durante a sessão",
  );
  semCanario(JSON.stringify(envDepois), "process.env");
});

Deno.test("sessão 6 (canário): `gh secret set` que falha ECOANDO o valor — a sessão não abre e o erro sai sem o valor", async () => {
  await comSessao(
    {
      modoDoGh: (args) =>
        args[0] === "secret" && args[2] === NOME_TESTE ? "falha-ecoando" : "ok",
    },
    async (m) => {
      assertEquals(await m.rodar(), 1);
      assertStringIncludes(m.texto(), "gh secret set");
      semCanario(m.texto(), "erro da abertura");
      assertEquals(m.github.noGitHub(), []);
      assertEquals(m.publicar.chamadas.length, 0);
    },
  );
});

// ====================================================================
// 7. o portão de verdade dentro da sessão (aviso e token)
// ====================================================================

/** O portão com IKCOUS, Savy e as duas lojas OAuth (cópia enxuta da T6). */
function depsDoPortao({ mudaPagamento = false } = {}) {
  const todas = [
    { ref: REF_IKCOUS, nome: "IKCOUS", projeto: "ikcous-publicada" },
    { ref: REF_SAVY, nome: "Savy", projeto: "savy" },
    { ref: REF_OAUTH, nome: "loja-teste", projeto: "loja-teste" },
    { ref: REF_OAUTH_2, nome: "loja-dois", projeto: "loja-dois" },
  ];
  const chamadas = { gestao: [], tokenAvulso: [] };
  const arvore = {
    [SHA]: {
      [ARQUIVO_NOTAS]: JSON.stringify({
        "1.5.18": {
          titulo: "Atualização do app",
          novidades: [],
          correcoes: ["Correções de estabilidade."],
          melhorias: [],
        },
      }),
      "supabase/functions/criar-pagamento/index.ts": mudaPagamento
        ? "pagamento v2"
        : "pagamento",
      "supabase/config.toml": "",
    },
  };
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
  const pacote = (nome) => [
    { caminho: `supabase/functions/${nome}/index.ts`, conteudo: "pagamento" },
  ];
  const d = {
    politica: {
      projetoVercel: { id: "prj_X", time: "team_Y" },
      lojasSemBackendGerenciado: [],
      enderecosEsperados: [],
      migrationsForaDaRelease: [],
    },
    canais: {
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
    },
    cadastro: cadastroCom(),
    agora: () => AGORA,
    esperaDeRetentativaMs: 0,
    fetchImpl: async (url) =>
      new URL(url).pathname === "/"
        ? new Response("<html></html>", {
            status: 503,
            headers: { "x-ikcous-porteiro": "sem-loja" },
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
    listarFuncoesNoSha: async () => ["criar-pagamento"],
    lerArquivoNoSha: (sha, caminho) => arvore[sha]?.[caminho] ?? null,
    arvoreIgual: async () => true,
    topoDoRamo: async () => TOPO,
    listarRuns: async () => [],
    logDoRun: async () => "",
    migrationList: async () =>
      JSON.stringify({ migrations: [{ remote: "20261190000000" }] }),
    listarFuncoes: async () => [{ slug: "criar-pagamento", verify_jwt: true }],
    baixarFuncao: async (_ref, nome) => pacote(nome),
    fetchGestao: async (url, init) => {
      const u = new URL(url);
      chamadas.gestao.push({
        caminho: u.pathname,
        auth: init.headers.authorization,
      });
      const oQue = u.pathname.endsWith("/functions")
        ? "functions"
        : "migrations";
      const corpo =
        oQue === "functions"
          ? [{ slug: "criar-pagamento", verify_jwt: true, status: "ACTIVE" }]
          : [{ version: "20261190000000", name: "a" }];
      return new Response(JSON.stringify(corpo), { status: 200 });
    },
    // o token do ENSAIO AVULSO: dentro da sessão, nunca é chamado
    tokenOAuth: async ({ slug }) => {
      chamadas.tokenAvulso.push(slug);
      return { accessToken: canario("00"), expiraEm: AGORA + 20 * HORA };
    },
    baixarOAuth: async (_ref, nome) => pacote(nome),
  };
  return { d, chamadas };
}

Deno.test("sessão 7: com o portão de verdade, as leituras OAuth usam o token DA SESSÃO; o do ensaio avulso nunca é chamado", async () => {
  const { d, chamadas } = depsDoPortao();
  await comSessao(
    { publicar: publicarRelease, deps: d, respostas: ["sair"] },
    async (m) => {
      assertEquals(await m.rodar(), 0);
      assertEquals(chamadas.tokenAvulso, []);
      assertEquals(m.acessoChamadas.renovar, 0);
      assertEquals(m.acessoChamadas.vigente, 0);
      const auth = new Map(
        chamadas.gestao.map((g) => [g.caminho.split("/")[3], g.auth]),
      );
      assertEquals(auth.get(REF_OAUTH), `Bearer ${CANARIO}`);
      assertEquals(auth.get(REF_OAUTH_2), `Bearer ${CANARIO_2}`);
      assertStringIncludes(m.texto(), "PRONTO");
      semCanario(m.texto(), "relatório na sessão");
      assertFechouLimpo(m);
    },
  );
});

Deno.test("sessão 7 (T6): o aviso '# loja OAuth: só dentro de --sessao' sai FORA da sessão e some DENTRO dela", async () => {
  const fora = await publicarRelease(
    { sha: SHA, deploymentId: DPL, promover: false },
    depsDoPortao({ mudaPagamento: true }).d,
  );
  assertEquals(fora.codigo, 1);
  assert(
    fora.consertos.includes(AVISO_DA_SESSAO_OAUTH),
    "controle: fora da sessão o aviso sai",
  );
  const dentro = await publicarRelease(
    { sha: SHA, deploymentId: DPL, promover: false, emSessao: true },
    depsDoPortao({ mudaPagamento: true }).d,
  );
  assertEquals(dentro.codigo, 1);
  assert(
    !dentro.consertos.includes(AVISO_DA_SESSAO_OAUTH),
    dentro.consertos.join("\n"),
  );
  assert(!dentro.relatorio.includes(AVISO_DA_SESSAO_OAUTH));
  // os comandos da loja OAuth continuam lá
  assert(
    dentro.consertos.some((l) => l.includes('-f "projeto=loja-teste"')),
    dentro.consertos.join("\n"),
  );
  // dentro da sessão o passo seguinte é o Enter, não outro comando de ensaio
  assert(
    !dentro.relatorio.includes("node scripts/frota/publicar-release.mjs --sha"),
  );
  assertStringIncludes(dentro.relatorio, "aperte Enter");
});

Deno.test("sessão 7: dentro da sessão o PRONTO manda digitar `promover`, não rodar --promover", async () => {
  const r = await publicarRelease(
    { sha: SHA, deploymentId: DPL, promover: false, emSessao: true },
    depsDoPortao().d,
  );
  assertEquals(r.codigo, 0);
  assertStringIncludes(r.relatorio, "digite `promover`");
  assert(!r.relatorio.includes("--promover"));
});

// ====================================================================
// 8. linha de comando, repositório, faxina, runs
// ====================================================================

Deno.test("linha de comando: --sessao com --promover é uso errado (saída 2); --faxina não aceita outro argumento", async () => {
  const ok = ["--sha", SHA, "--deployment", DPL];
  assertThrows(
    () => lerArgumentos(["--sessao", "--promover", ...ok]),
    Error,
    "--promover",
  );
  assertThrows(() => lerArgumentos(["--faxina", ...ok]), Error, "--faxina");
  assertThrows(
    () => lerArgumentos(["--faxina", "--sessao"]),
    Error,
    "--faxina",
  );
  assertThrows(() => lerArgumentos(["--sessao"]), Error, "--sha");
  assertEquals(lerArgumentos(["--sessao", ...ok]).sessao, true);
  assertEquals(lerArgumentos(["--faxina"]).faxina, true);
  assertEquals(lerArgumentos(ok).sessao, false);
  const antes = console.error;
  const vistos = [];
  console.error = (x) => vistos.push(String(x));
  try {
    assertEquals(await main(["--sessao", "--promover", ...ok]), 2);
  } finally {
    console.error = antes;
  }
  assertStringIncludes(vistos.join("\n"), "--sessao");
});

Deno.test("repositório: só github.com/OWNER/REPO (https ou ssh, com ou sem .git); o resto recusa SEM ecoar a URL", () => {
  assertEquals(
    repoDoRemoto("https://github.com/Dono-1/repo.x.git"),
    "Dono-1/repo.x",
  );
  assertEquals(repoDoRemoto("https://github.com/Dono-1/repo"), "Dono-1/repo");
  assertEquals(repoDoRemoto("git@github.com:Dono-1/repo.git"), "Dono-1/repo");
  assertEquals(
    repoDoRemoto("ssh://git@github.com/Dono-1/repo.git\n"),
    "Dono-1/repo",
  );
  const segredoNaUrl = `https://x-access-token:${canario("77")}@github.com/a/b.git`;
  for (const ruim of [
    segredoNaUrl,
    "https://gitlab.com/a/b.git",
    "https://github.com.evil.test/a/b.git",
    "https://github.com/a/b/c.git",
    "https://github.com/a/..",
    "",
    null,
  ]) {
    let erro = null;
    try {
      repoDoRemoto(ruim);
    } catch (e) {
      erro = e;
    }
    assert(erro, `aceitou ${ruim}`);
    semCanario(erro.message, "erro do repositório");
    assert(!String(erro.message).includes("gitlab"), "ecoou a URL");
  }
});

Deno.test("--faxina avulsa: apaga só os segredos OAuth que existem, nunca o da IKCOUS, nada renova", async () => {
  await comSessao(
    { github: { existentes: [NOME_TESTE, NOME_IKCOUS] } },
    async (m) => {
      const codigo = await rodarFaxina({
        cadastro: m.amb.cadastro,
        gh: m.amb.gh,
        escrever: m.amb.escrever,
      });
      assertEquals(codigo, 0);
      assertEquals(deletesDe(m), [NOME_TESTE]);
      assertEquals(m.github.noGitHub(), [NOME_IKCOUS]);
      assertEquals(m.acessoChamadas.longa, []);
      assertStringIncludes(m.texto(), NOME_TESTE);
      // pelo main: o mesmo, sem nenhuma dependência real
      const saida = [];
      assertEquals(
        await main(["--faxina"], {
          faxina: () => ({
            cadastro: m.amb.cadastro,
            gh: m.amb.gh,
            escrever: (t) => saida.push(t),
          }),
        }),
        0,
      );
      assertStringIncludes(saida.join("\n"), "nada a apagar");
    },
  );
});

Deno.test("--faxina avulsa: segredo que não sai volta com o comando exato e saída 1", async () => {
  await comSessao(
    { github: { existentes: [NOME_DOIS], apagarFalha: [NOME_DOIS] } },
    async (m) => {
      const codigo = await rodarFaxina({
        cadastro: m.amb.cadastro,
        gh: m.amb.gh,
        escrever: m.amb.escrever,
      });
      assertEquals(codigo, 1);
      assertStringIncludes(
        m.texto(),
        `gh secret delete ${NOME_DOIS} --app actions --repo ${REPO}`,
      );
    },
  );
});

Deno.test("runs em andamento pela CLI: lê cada workflow com segredo de loja e devolve o que não terminou", async () => {
  const pedidos = [];
  const ler = runsEmAndamentoPelaCli(async (args) => {
    pedidos.push(args);
    const w = args[args.indexOf("--workflow") + 1];
    return JSON.stringify(
      w === "publicar-functions.yml"
        ? [
            { databaseId: 1, status: "completed", displayTitle: "a" },
            { databaseId: 2, status: "queued", displayTitle: "b" },
            { databaseId: 3, status: "esquisito", displayTitle: "c" },
          ]
        : [],
    );
  });
  const vivos = await ler();
  assertEquals(
    vivos.map((r) => r.id),
    [2, 3],
  );
  assertEquals(pedidos.length, WORKFLOWS_COM_SEGREDO_DA_LOJA.length);
  const quebrado = runsEmAndamentoPelaCli(async () => "{}");
  let erro = null;
  try {
    await quebrado();
  } catch (e) {
    erro = e;
  }
  assert(erro, "lista torta tem de lançar (nunca 'nenhum run')");
});

Deno.test("runs em andamento: a lista cobre TODO workflow que usa o segredo da loja (menos o ci.yml)", () => {
  const dir = path.join(RAIZ, ".github", "workflows");
  const usam = readdirSync(dir)
    .filter((f) => f.endsWith(".yml") && f !== "ci.yml")
    .filter((f) =>
      /SUPABASE_ACCESS_TOKEN_|lojas\.cjs/.test(
        readFileSync(path.join(dir, f), "utf8"),
      ),
    )
    .sort();
  assertEquals([...WORKFLOWS_COM_SEGREDO_DA_LOJA].sort(), usam);
});

Deno.test("matar o token no fechar fica LIGADO até a prova P6b decidir (lado seguro)", async () => {
  assertEquals(MATAR_TOKEN_NO_FECHAR, true);
  await comSessao(
    { respostas: ["sair"], roteiro: [{ codigo: 1 }] },
    async (m) => {
      await m.rodar();
      assertEquals(m.acessoChamadas.deNovo.sort(), ["loja-dois", "loja-teste"]);
      semCanario(m.texto(), "saída");
    },
  );
});
