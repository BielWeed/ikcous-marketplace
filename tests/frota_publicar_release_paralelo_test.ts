// @ts-nocheck
/* eslint-disable security/detect-object-injection -- dublês de teste: as chaves vêm de constantes e mapas fechados do próprio arquivo, nunca de entrada externa. */
/**
 * scripts/frota/publicar-release.mjs — a PRONTIDÃO POR LOJA em paralelo.
 *
 * Auditoria de escala (25/11/2026, item B6): a etapa 3 do portão olhava uma
 * loja por vez (~16 comandos por loja, cada um com limite de 180 s), o que dá
 * 1 a 2 horas por ensaio com 60 lojas, e uma única falha de rede bloqueava a
 * publicação inteira. O conserto tem três partes, e cada teste abaixo cai se a
 * sua parte for tirada:
 *
 *  - até 4 lojas ao mesmo tempo (nunca mais), com o relatório e os bloqueios
 *    na MESMA ordem de antes e o mesmo veredito que o serial;
 *  - UMA nova tentativa, só para falha marcada como transitória (rede/tempo
 *    esgotado); falha real (migration faltando, acesso negado, erro de
 *    código) nunca é repetida, e a falha persistente continua BLOQUEANDO;
 *  - a lista de runs do GitHub lida UMA vez mesmo com várias lojas pedindo
 *    ao mesmo tempo (o cache guarda a promessa, não só o resultado).
 *
 * A janela de 1000 runs (B2) já entrou na base (#1857); aqui só se prova que
 * uma prova na posição 120 de 150 runs continua achada com 10 lojas.
 *
 * Todas as dependências são dublês com dados inventados: nenhuma rede, nenhum
 * CLI, nenhum banco.
 */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  PRONTIDAO_LOJAS_EM_PARALELO,
  comUmaRetentativa,
  dependenciasReais,
  evidenciaDaProva,
  falhaDeComandoEhTransitoria,
  mapearEmParalelo,
  publicarRelease,
} from "../scripts/frota/publicar-release.mjs";

const SHA = "1".repeat(40);
const BASE = "2".repeat(40);
const OUTRO = "3".repeat(40);
const TOPO = "4".repeat(40);
const IDENT = "e".repeat(64);
const DPL = "dpl_Novo123";
const DPL_ANTERIOR = "dpl_Anterior456";
const AGORA = Date.parse("2026-10-06T20:00:00Z");
const PROVA = "8e-conferir-92-a-202-aplicado";
const VERSAO_NOVA = "20261192000000";
const ARQUIVO_NOTAS = "src/novidades/notas-das-versoes.json";
const NOTA_VALIDA = {
  titulo: "Atualização do app",
  novidades: [],
  correcoes: ["Correções de estabilidade."],
  melhorias: [],
};

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Falha de rede como o `rodar` real a marca (`transitorio: true`). */
const falhaDeRede = (msg = "supabase link falhou: ECONNRESET") =>
  Object.assign(new Error(msg), { transitorio: true });

/** ref de 20 letras minúsculas por índice (o RE_REF do portão): 0 → "aaaa…aa". */
const refDe = (i) =>
  `${"a".repeat(18)}${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`;
const nomeDe = (i) => `loja-${String(i + 1).padStart(2, "0")}`;

const tabelaDoLedger = (versoes) =>
  [
    "",
    "   Local | Remote           | Time (UTC)            ",
    "  -------|------------------|-----------------------",
    ...versoes.map((v) => `   \` \`   | \`${v}\` | \`${v}\`      `),
    "",
  ].join("\n");

/**
 * Cenário de N lojas, todas prontas: o ledger tem as duas migrations (a nova,
 * 20261192000000, não existe na base que a loja serve → exige prova de objetos
 * "conferir <PROVA> em loja-NN", um run verde por loja), as duas functions
 * estão em dia. `ajuste` troca o comportamento por loja; os contadores contam
 * as chamadas de cada dependência por loja e a concorrência de leitura.
 */
function montar(n, ajuste = {}) {
  const lojas = Array.from({ length: n }, (_, i) => ({
    ref: refDe(i),
    nome: nomeDe(i),
  }));
  const chamadas = {
    migrationList: {},
    listarFuncoes: {},
    baixar: {},
    listarRuns: 0,
    logDoRun: 0,
  };
  const conta = (grupo, chave) => {
    grupo[chave] = (grupo[chave] ?? 0) + 1;
  };
  let emVoo = 0;
  const concorrencia = { maximo: 0 };
  /** Envolve uma leitura por loja para medir quantas rodam ao mesmo tempo. */
  const medir = async (atraso, corpo) => {
    emVoo++;
    concorrencia.maximo = Math.max(concorrencia.maximo, emVoo);
    try {
      if (atraso) await esperar(atraso);
      return await corpo();
    } finally {
      emVoo--;
    }
  };
  const arvore = {
    [SHA]: {
      [ARQUIVO_NOTAS]: JSON.stringify({ "1.5.18": NOTA_VALIDA }),
      "supabase/functions/criar-pagamento/index.ts": "pagamento",
      "supabase/functions/webhook-mercadopago/index.ts": "webhook",
      "supabase/config.toml":
        '[functions."webhook-mercadopago"]\nverify_jwt = false\n',
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
    provasDeObjetos: [
      { consulta: PROVA, versoes: [VERSAO_NOVA], backfillLedger: "92-202" },
    ],
    canais: Object.fromEntries(
      lojas.map((l) => [
        l.ref,
        {
          nome: l.nome,
          migrations: l.nome,
          functions: l.nome,
          projetosNoMesmoBanco: [],
          functionsPublicaveis: ["criar-pagamento"],
        },
      ]),
    ),
  };
  const sondas = [
    ...lojas.map((l) => ({
      dominio: `${l.nome}.vercel.app`,
      versao: { codeSha: BASE },
      ficha: {
        status: 200,
        caderneta: "hit",
        titulo: l.nome,
        refs: [l.ref],
        estavel: true,
      },
    })),
    {
      dominio: "manut.vercel.app",
      ficha: { status: 503, caderneta: "miss", refs: [] },
    },
  ];
  const runsDeConferir = lojas.map((l, i) => ({
    databaseId: 100 + i,
    displayTitle: `conferir ${PROVA} em ${l.nome}`,
    headSha: OUTRO,
    createdAt: "2026-10-06T19:00:00Z",
    updatedAt: "2026-10-06T19:05:00Z",
    conclusion: "success",
    status: "completed",
  }));
  const logDe = (i) =>
    `VEREDITO-CONSULTA consulta=${PROVA} ref=${lojas[i].ref} sha=${OUTRO} linhas=61 ok_false=0 ok_nao_booleano=0 rol=ok\n`;
  const indiceDoRef = (ref) => lojas.findIndex((l) => l.ref === ref);
  const pacote = (nome) => ({
    nome,
    conteudo: arvore[SHA][`supabase/functions/${nome}/index.ts`],
  });

  const d = {
    politica: {
      projetoVercel: { id: "prj_X", time: "team_Y" },
      lojasSemBackendGerenciado: [],
      enderecosEsperados: [
        { dominio: "manut.vercel.app", estado: "manutencao" },
      ],
      migrationsForaDaRelease: [],
    },
    canais,
    agora: () => AGORA,
    esperaDeRetentativaMs: 0,
    ...(ajuste.lojasEmParalelo !== undefined
      ? { lojasEmParalelo: ajuste.lojasEmParalelo }
      : {}),
    fetchImpl: async (url) => {
      const u = new URL(url);
      if (u.pathname === "/")
        return new Response("<html></html>", {
          status: 503,
          // O porteiro do candidato: a caderneta não conhece o endereço (miss).
          headers: {
            "x-ikcous-porteiro": "sem-loja",
            "x-ikcous-caderneta": "miss",
          },
        });
      return new Response(
        JSON.stringify({
          version: `1.5.18-sha.${SHA.slice(0, 7)}-identity.${IDENT}`,
          codeVersion: "1.5.18",
          codeSha: SHA,
          identityRevision: IDENT,
          source: "database",
          promotable: true,
        }),
        { status: 200 },
      );
    },
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
    listarMigrationsNoSha: async (sha) =>
      sha === SHA
        ? ["20261190000000_a.sql", `${VERSAO_NOVA}_b.sql`]
        : ["20261190000000_a.sql"],
    listarFuncoesNoSha: async () => ["criar-pagamento", "webhook-mercadopago"],
    lerArquivoNoSha: (sha, caminho) => arvore[sha]?.[caminho] ?? null,
    arvoreIgual: async () => true,
    topoDoRamo: async () => TOPO,
    listarRuns: async (wf) => {
      if (wf === "conferir-banco-da-loja.yml") {
        chamadas.listarRuns++;
        const falha = ajuste.falhaDeRuns?.(chamadas.listarRuns);
        if (falha) throw falha;
        return runsDeConferir;
      }
      return [];
    },
    logDoRun: async (id) => {
      chamadas.logDoRun++;
      return logDe(Number(id) - 100);
    },
    migrationList: async (ref) => {
      conta(chamadas.migrationList, ref);
      return medir(ajuste.atrasoDoLedger?.(indiceDoRef(ref)) ?? 5, async () => {
        const falha = ajuste.falhaDoLedger?.(
          indiceDoRef(ref),
          chamadas.migrationList[ref],
        );
        if (falha) throw falha;
        const versoes = ajuste.ledgerDa?.(indiceDoRef(ref)) ?? [
          "20261190000000",
          VERSAO_NOVA,
        ];
        return tabelaDoLedger(versoes);
      });
    },
    listarFuncoes: async (ref) => {
      conta(chamadas.listarFuncoes, ref);
      const falha = ajuste.falhaDeListarFuncoes?.(
        indiceDoRef(ref),
        chamadas.listarFuncoes[ref],
      );
      if (falha) throw falha;
      return [
        { slug: "criar-pagamento", verify_jwt: true },
        {
          slug: "webhook-mercadopago",
          verify_jwt: ajuste.verifyJwtDoWebhook?.(indiceDoRef(ref)) ?? false,
        },
      ];
    },
    baixarFuncao: async (ref, nome) => {
      conta(chamadas.baixar, `${ref}:${nome}`);
      const falha = ajuste.falhaDeBaixar?.(
        indiceDoRef(ref),
        nome,
        chamadas.baixar[`${ref}:${nome}`],
      );
      if (falha) throw falha;
      const p = pacote(nome);
      const conteudo = ajuste.conteudoBaixado?.(indiceDoRef(ref), nome);
      return [
        {
          caminho: `supabase/functions/${nome}/index.ts`,
          conteudo: conteudo ?? p.conteudo,
        },
      ];
    },
  };
  return { d, chamadas, concorrencia, lojas };
}

const executar = (d) =>
  publicarRelease({ sha: SHA, deploymentId: DPL, promover: false }, d);

const titulosDasLojas = (relatorio) =>
  [...relatorio.matchAll(/^### (loja-\d+) /gm)].map((m) => m[1]);

// ====================================================================
// controle: o cenário base está PRONTO (sem isso, os testes abaixo seriam
// vazios: "bloqueado" por qualquer motivo parece sucesso de teste)
// ====================================================================

Deno.test("paralelo: controle — 10 lojas prontas dão PRONTO, sem bloqueio, e cada loja foi lida", async () => {
  const { d, chamadas, lojas } = montar(10);
  const r = await executar(d);
  assertEquals(r.bloqueios, []);
  assertEquals(r.codigo, 0);
  assertStringIncludes(r.relatorio, "PRONTO");
  for (const l of lojas) assertEquals(chamadas.migrationList[l.ref], 1);
  assertEquals(PRONTIDAO_LOJAS_EM_PARALELO, 4);
});

// ====================================================================
// (b) concorrência: teto de 4, ordem estável
// ====================================================================

Deno.test("paralelo: 10 lojas leem no máximo 4 ao mesmo tempo (e de fato 4), e o relatório sai na ORDEM do inventário mesmo com a primeira loja mais lenta", async () => {
  const { d, concorrencia } = montar(10, {
    // a loja 1 é a mais lenta: no paralelo, termina por último
    atrasoDoLedger: (i) => (i === 0 ? 60 : 10),
  });
  const r = await executar(d);
  assertEquals(r.codigo, 0, JSON.stringify(r.bloqueios));
  assertEquals(concorrencia.maximo, 4, "tem de usar 4 e nunca passar de 4");
  assertEquals(
    titulosDasLojas(r.relatorio),
    Array.from({ length: 10 }, (_, i) => nomeDe(i)),
  );
});

Deno.test("paralelo: os bloqueios saem na ordem das lojas, intercalados como no serial, mesmo com a loja 1 terminando por último", async () => {
  const { d } = montar(8, {
    atrasoDoLedger: (i) => (i === 0 ? 60 : 5),
    // lojas 1, 4 e 7 sem a migration nova no ledger
    ledgerDa: (i) =>
      [0, 3, 6].includes(i)
        ? ["20261190000000"]
        : ["20261190000000", VERSAO_NOVA],
  });
  const r = await executar(d);
  assertEquals(r.codigo, 1);
  const alvos = [...new Set(r.bloqueios.map((b) => b.alvo))];
  assertEquals(
    alvos.map((a) => /loja-\d+/.exec(a)[0]),
    ["loja-01", "loja-04", "loja-07"],
  );
});

Deno.test("paralelo: o limite pedido em deps.lojasEmParalelo vale (1 = serial) e um valor inválido cai no padrão 4", async () => {
  for (const [pedido, esperado] of [
    [1, 1],
    [2, 2],
    ["abc", 4],
    [0, 4],
    [10, 4],
    [-3, 4],
  ]) {
    const { d, concorrencia } = montar(9, { lojasEmParalelo: pedido });
    const r = await executar(d);
    assertEquals(r.codigo, 0);
    assertEquals(concorrencia.maximo, esperado, `pedido ${pedido}`);
  }
});

// ====================================================================
// (d) mesmo veredito que o serial
// ====================================================================

Deno.test("paralelo: o resultado com 12 lojas é IDÊNTICO ao serial (relatório, bloqueios e código), com falhas misturadas", async () => {
  const ajuste = {
    atrasoDoLedger: (i) => (i % 3 === 0 ? 30 : 4),
    // loja 3: migration faltando; loja 6: verify_jwt errado; loja 9: ledger sem acesso
    ledgerDa: (i) =>
      i === 2 ? ["20261190000000"] : ["20261190000000", VERSAO_NOVA],
    // loja 6: o webhook no ar exige JWT, o config.toml do SHA diz que não
    verifyJwtDoWebhook: (i) => i === 5,
    falhaDoLedger: (i) => (i === 8 ? new Error("sem acesso ao projeto") : null),
  };
  const serial = await executar(
    montar(12, { ...ajuste, lojasEmParalelo: 1 }).d,
  );
  const quatro = await executar(
    montar(12, { ...ajuste, lojasEmParalelo: 4 }).d,
  );
  const padrao = await executar(montar(12, ajuste).d);
  assert(serial.bloqueios.length >= 3, "o cenário tem de bloquear de verdade");
  assertEquals(serial.codigo, 1);
  for (const par of [quatro, padrao]) {
    assertEquals(par.codigo, serial.codigo);
    assertEquals(par.bloqueios, serial.bloqueios);
    assertEquals(par.relatorio, serial.relatorio);
  }
});

Deno.test("paralelo: com todas as lojas prontas, serial e paralelo dão o mesmo relatório (30 lojas)", async () => {
  const serial = await executar(montar(30, { lojasEmParalelo: 1 }).d);
  const paralelo = await executar(montar(30).d);
  assertEquals(serial.codigo, 0);
  assertEquals(paralelo.relatorio, serial.relatorio);
});

// ====================================================================
// (c) nova tentativa: só rede/tempo esgotado, uma vez só
// ====================================================================

Deno.test("retentativa: falha de rede UMA vez no ledger de uma loja → 1 nova tentativa e passa; as outras lojas não são repetidas", async () => {
  const { d, chamadas, lojas } = montar(6, {
    falhaDoLedger: (i, tentativa) =>
      i === 2 && tentativa === 1 ? falhaDeRede() : null,
  });
  const r = await executar(d);
  assertEquals(r.bloqueios, []);
  assertEquals(r.codigo, 0);
  assertEquals(chamadas.migrationList[lojas[2].ref], 2);
  for (const i of [0, 1, 3, 4, 5])
    assertEquals(chamadas.migrationList[lojas[i].ref], 1);
});

Deno.test("retentativa: falha de rede PERSISTENTE → exatamente 2 tentativas (sem laço), a loja BLOQUEIA e as outras seguem", async () => {
  const { d, chamadas, lojas } = montar(6, {
    falhaDoLedger: (i) =>
      i === 2 ? falhaDeRede("supabase link falhou: ETIMEDOUT") : null,
  });
  const r = await executar(d);
  assertEquals(r.codigo, 1);
  assertEquals(chamadas.migrationList[lojas[2].ref], 2);
  const motivos = r.bloqueios
    .filter((b) => b.alvo.includes(lojas[2].ref))
    .map((b) => b.motivo);
  assertEquals(motivos.length, 1);
  assertStringIncludes(motivos[0], "ledger não lido");
  assertStringIncludes(motivos[0], "ETIMEDOUT");
  assertStringIncludes(motivos[0], "nova tentativa");
  // nenhuma outra loja foi bloqueada
  assertEquals(
    r.bloqueios.filter((b) => !b.alvo.includes(lojas[2].ref)),
    [],
  );
});

Deno.test("retentativa: falha REAL (sem a marca de transitória) NÃO é repetida e bloqueia", async () => {
  const { d, chamadas, lojas } = montar(5, {
    falhaDoLedger: (i) =>
      i === 1 ? new Error("supabase link falhou: Invalid access token") : null,
  });
  const r = await executar(d);
  assertEquals(r.codigo, 1);
  assertEquals(chamadas.migrationList[lojas[1].ref], 1, "sem nova tentativa");
  assertEquals(
    r.bloqueios.filter((b) => b.alvo.includes(lojas[1].ref)).length,
    1,
  );
});

Deno.test("retentativa: migration FALTANDO no ledger não é erro de leitura: lê UMA vez, bloqueia, e não repete nada", async () => {
  const { d, chamadas, lojas } = montar(5, {
    ledgerDa: (i) =>
      i === 3 ? ["20261190000000"] : ["20261190000000", VERSAO_NOVA],
  });
  const r = await executar(d);
  assertEquals(r.codigo, 1);
  assertEquals(chamadas.migrationList[lojas[3].ref], 1);
  const motivos = r.bloqueios
    .filter((b) => b.alvo.includes(lojas[3].ref))
    .map((b) => b.motivo);
  assert(motivos.length >= 1);
  assertStringIncludes(motivos.join(" | "), VERSAO_NOVA);
  assertEquals(
    r.bloqueios.filter((b) => !b.alvo.includes(lojas[3].ref)),
    [],
  );
});

Deno.test("retentativa: download de function com falha de rede UMA vez passa na 2ª; persistente vira 'download falhou' e BLOQUEIA", async () => {
  const uma = montar(4, {
    falhaDeBaixar: (i, nome, tentativa) =>
      i === 1 && nome === "criar-pagamento" && tentativa === 1
        ? falhaDeRede("supabase functions falhou: i/o timeout")
        : null,
  });
  const r1 = await executar(uma.d);
  assertEquals(r1.bloqueios, []);
  assertEquals(uma.chamadas.baixar[`${uma.lojas[1].ref}:criar-pagamento`], 2);

  const sempre = montar(4, {
    falhaDeBaixar: (i, nome) =>
      i === 1 && nome === "criar-pagamento"
        ? falhaDeRede("supabase functions falhou: i/o timeout")
        : null,
  });
  const r2 = await executar(sempre.d);
  assertEquals(r2.codigo, 1);
  assertEquals(
    sempre.chamadas.baixar[`${sempre.lojas[1].ref}:criar-pagamento`],
    2,
  );
  assertStringIncludes(
    r2.bloqueios.map((b) => b.motivo).join(" | "),
    "download falhou",
  );
});

Deno.test("retentativa: listar functions com falha de rede UMA vez passa; falha real vira bloqueio sem repetir", async () => {
  const uma = montar(3, {
    falhaDeListarFuncoes: (i, t) => (i === 0 && t === 1 ? falhaDeRede() : null),
  });
  assertEquals((await executar(uma.d)).bloqueios, []);
  assertEquals(uma.chamadas.listarFuncoes[uma.lojas[0].ref], 2);

  const real = montar(3, {
    falhaDeListarFuncoes: (i) => (i === 0 ? new Error("boom") : null),
  });
  const r = await executar(real.d);
  assertEquals(r.codigo, 1);
  assertEquals(real.chamadas.listarFuncoes[real.lojas[0].ref], 1);
});

Deno.test("retentativa: a lista de runs do GitHub com falha de rede UMA vez é lida de novo; a prova da loja não vira 'não lida'", async () => {
  const { d, chamadas } = montar(4, {
    falhaDeRuns: (chamada) =>
      chamada === 1
        ? falhaDeRede("gh run falhou: HTTP 502: Bad Gateway")
        : null,
  });
  const r = await executar(d);
  assertEquals(r.bloqueios, []);
  assertEquals(r.codigo, 0);
  assert(chamadas.listarRuns >= 2, "a leitura que falhou foi repetida");
});

// ====================================================================
// fail-closed: exceção inesperada continua derrubando o portão
// ====================================================================

Deno.test("paralelo: exceção inesperada numa loja REJEITA o portão (nada é promovido), só depois de todas as leituras em curso terminarem", async () => {
  const { d, concorrencia } = montar(8);
  const lerOriginal = d.lerArquivoNoSha;
  // só a leitura do pacote esperado de uma function dentro da prontidão joga
  d.lerArquivoNoSha = (sha, caminho) => {
    if (caminho === "supabase/functions/criar-pagamento/index.ts")
      throw new Error("leitura do git quebrou");
    return lerOriginal(sha, caminho);
  };
  await assertRejects(() => executar(d), Error, "leitura do git quebrou");
  // ninguém ficou lendo no escuro depois da rejeição
  await esperar(80);
  assert(concorrencia.maximo <= 4);
});

// ====================================================================
// peças: mapearEmParalelo, comUmaRetentativa, classificação da falha
// ====================================================================

Deno.test("mapearEmParalelo: devolve na ORDEM da entrada, respeita o limite e aceita lista vazia", async () => {
  assertEquals(await mapearEmParalelo([], 4, async (x) => x), []);
  let emVoo = 0;
  let maximo = 0;
  const saida = await mapearEmParalelo(
    [50, 5, 5, 5, 5, 5, 5],
    3,
    async (ms, i) => {
      emVoo++;
      maximo = Math.max(maximo, emVoo);
      await esperar(ms);
      emVoo--;
      return `${i}:${ms}`;
    },
  );
  assertEquals(saida, ["0:50", "1:5", "2:5", "3:5", "4:5", "5:5", "6:5"]);
  assertEquals(maximo, 3);
});

Deno.test("mapearEmParalelo: com falhas espera TODAS terminarem e rejeita com a PRIMEIRA falha na ordem da entrada (não a primeira no tempo)", async () => {
  const terminadas = [];
  await assertRejects(
    () =>
      mapearEmParalelo([0, 1, 2, 3, 4], 5, async (x) => {
        if (x === 1) {
          await esperar(40);
          throw new Error("falha do item 1");
        }
        if (x === 3) throw new Error("falha do item 3 (mais rápida)");
        await esperar(10);
        terminadas.push(x);
        return x;
      }),
    Error,
    "falha do item 1",
  );
  assertEquals(terminadas.sort(), [0, 2, 4]);
});

Deno.test("comUmaRetentativa: transitória 1x → 2 chamadas e devolve; 2x → rejeita após 2 chamadas; não transitória → 1 chamada", async () => {
  let n = 0;
  assertEquals(
    await comUmaRetentativa(
      async () => {
        n++;
        if (n === 1) throw falhaDeRede();
        return "ok";
      },
      { esperaMs: 0 },
    ),
    "ok",
  );
  assertEquals(n, 2);

  n = 0;
  await assertRejects(
    () =>
      comUmaRetentativa(
        async () => {
          n++;
          throw falhaDeRede("ECONNRESET");
        },
        { esperaMs: 0 },
      ),
    Error,
    "ECONNRESET",
  );
  assertEquals(n, 2);

  n = 0;
  await assertRejects(
    () =>
      comUmaRetentativa(
        async () => {
          n++;
          throw new Error("real");
        },
        { esperaMs: 0 },
      ),
    Error,
    "real",
  );
  assertEquals(n, 1);

  // marca só vale com `transitorio === true` exato (string/1 não valem)
  n = 0;
  await assertRejects(() =>
    comUmaRetentativa(
      async () => {
        n++;
        throw Object.assign(new Error("x"), { transitorio: "true" });
      },
      { esperaMs: 0 },
    ),
  );
  assertEquals(n, 1);
});

Deno.test("falhaDeComandoEhTransitoria: tempo esgotado e rede SIM; token inválido, 401/404, comando ausente, saída estourada e erro desconhecido NÃO", () => {
  const timeout = { killed: true, signal: "SIGTERM", code: null };
  assertEquals(falhaDeComandoEhTransitoria(timeout, ""), true);
  for (const s of [
    "Error: connect ECONNRESET 1.2.3.4:443",
    "dial tcp: lookup api.supabase.com: i/o timeout",
    "Get https://x: net/http: TLS handshake timeout",
    "HTTP 502: Bad Gateway (https://api.github.com/repos/x/actions/runs)",
    "HTTP 429: API rate limit exceeded",
    "unexpected status 503: upstream unavailable",
    "getaddrinfo EAI_AGAIN api.supabase.com",
    "read tcp 1.2.3.4: connection reset by peer",
    "unexpected EOF",
  ]) {
    assertEquals(
      falhaDeComandoEhTransitoria({ code: 1 }, s),
      true,
      `devia ser transitória: ${s}`,
    );
  }
  for (const s of [
    "Invalid access token format",
    "HTTP 401: Bad credentials",
    "HTTP 404: Not Found",
    "HTTP 403: Resource not accessible by integration",
    "Cannot find project ref. Have you run supabase link?",
    'relation "x" does not exist',
    "",
  ]) {
    assertEquals(
      falhaDeComandoEhTransitoria({ code: 1 }, s),
      false,
      `NÃO devia ser transitória: ${s}`,
    );
  }
  assertEquals(falhaDeComandoEhTransitoria({ code: "ENOENT" }, ""), false);
  assertEquals(
    falhaDeComandoEhTransitoria(
      { killed: true, code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" },
      "",
    ),
    false,
  );
  assertEquals(falhaDeComandoEhTransitoria(undefined, undefined), false);
});

// ====================================================================
// listarRuns real: cache da PROMESSA (várias lojas pedindo juntas)
// ====================================================================

async function comDependenciasReais(corpo, opcoes) {
  if (Deno.build.os !== "windows")
    return await corpo(dependenciasReais(opcoes));
  const dir = Deno.makeTempDirSync();
  Deno.mkdirSync(`${dir}/node_modules/vercel/dist`, { recursive: true });
  Deno.writeTextFileSync(`${dir}/vercel.cmd`, "");
  Deno.writeTextFileSync(`${dir}/node_modules/vercel/dist/vc.js`, "");
  const antes = Deno.env.get("PATH") ?? "";
  Deno.env.set("PATH", `${dir};${antes}`);
  try {
    return await corpo(dependenciasReais(opcoes));
  } finally {
    Deno.env.set("PATH", antes);
    Deno.removeSync(dir, { recursive: true });
  }
}

Deno.test("listarRuns real: 4 lojas pedindo a lista ao MESMO tempo geram UMA chamada ao gh", async () => {
  let chamadas = 0;
  const rodarGh = async () => {
    chamadas++;
    await esperar(20);
    return JSON.stringify([{ databaseId: 1 }]);
  };
  await comDependenciasReais(
    async (reais) => {
      const listas = await Promise.all(
        [1, 2, 3, 4].map(() => reais.listarRuns("conferir-banco-da-loja.yml")),
      );
      for (const l of listas) assertEquals(l, [{ databaseId: 1 }]);
    },
    { rodarGh },
  );
  assertEquals(chamadas, 1);
});

Deno.test("listarRuns real: falha NÃO fica guardada no cache — a nova tentativa chama o gh de novo e a lista boa passa a valer", async () => {
  let chamadas = 0;
  const rodarGh = async () => {
    chamadas++;
    await esperar(5);
    if (chamadas === 1) throw falhaDeRede("gh run falhou: HTTP 502");
    return JSON.stringify([{ databaseId: 7 }]);
  };
  await comDependenciasReais(
    async (reais) => {
      await assertRejects(
        () => reais.listarRuns("conferir-banco-da-loja.yml"),
        Error,
        "HTTP 502",
      );
      assertEquals(await reais.listarRuns("conferir-banco-da-loja.yml"), [
        { databaseId: 7 },
      ]);
      // e agora sim em cache
      await reais.listarRuns("conferir-banco-da-loja.yml");
    },
    { rodarGh },
  );
  assertEquals(chamadas, 2);
});

// ====================================================================
// (a) a prova certa numa lista longa (janela de 1000 já está na base)
// ====================================================================

Deno.test("prova: 10 lojas, 150 runs de conferência — a prova na posição 126 é achada, e o run MAIS NOVO do título decide (vermelho novo vence verde antigo)", async () => {
  const lojas = Array.from({ length: 10 }, (_, i) => nomeDe(i));
  const runs = [];
  // 15 rodadas de 10 lojas, da mais nova (posição 0) para a mais antiga (149).
  // loja-07 e loja-08 só têm run do título certo a partir da rodada 12 (posição
  // >= 120, fora da janela antiga de 100); antes disso há runs de OUTRA consulta.
  // loja-07: verde na rodada 12. loja-08: vermelho na 12 e verde na 13.
  for (let rodada = 0; rodada < 15; rodada++) {
    for (const loja of lojas) {
      const i = runs.length;
      const soDeOutraConsulta =
        (loja === "loja-07" || loja === "loja-08") && rodada < 12;
      runs.push({
        databaseId: 1000 + i,
        displayTitle: `conferir ${soDeOutraConsulta ? "8a-outra" : PROVA} em ${loja}`,
        headSha: OUTRO,
        createdAt: new Date(AGORA - 60_000 - i * 60_000).toISOString(),
        updatedAt: new Date(AGORA - 30_000 - i * 60_000).toISOString(),
        conclusion: loja === "loja-08" && rodada === 12 ? "failure" : "success",
        status: "completed",
      });
    }
  }
  assertEquals(runs.length, 150);
  const posicaoDe = (loja) =>
    runs.findIndex((r) => r.displayTitle === `conferir ${PROVA} em ${loja}`);
  assertEquals(posicaoDe("loja-07"), 126);
  assert(
    posicaoDe("loja-07") >= 120,
    "a prova tem de estar fora dos 100 primeiros",
  );
  const lidos = [];
  // como o `gh run list --limit N` real: devolve só os N primeiros
  const rodarGh = async (args) => {
    const workflow = args[args.indexOf("--workflow") + 1];
    if (workflow !== "conferir-banco-da-loja.yml") return "[]"; // sem apply nenhum
    const limite = Number(args[args.indexOf("--limit") + 1]);
    lidos.push(limite);
    return JSON.stringify(runs.slice(0, limite));
  };
  await comDependenciasReais(
    async (reais) => {
      // o ref do veredito é o do projeto Supabase (20 letras), não o nome da loja
      const refDaLoja = (loja) => refDe(Number(loja.slice(-2)) - 1);
      const prova = (loja) =>
        evidenciaDaProva({
          consulta: PROVA,
          projeto: loja,
          projetosNoMesmoBanco: [],
          ref: refDaLoja(loja),
          sha: SHA,
          topo: TOPO,
          validadeHoras: 6,
          agora: AGORA,
          deps: {
            listarRuns: reais.listarRuns,
            arvoreIgual: async () => true,
            logDoRun: async () =>
              `VEREDITO-CONSULTA consulta=${PROVA} ref=${refDaLoja(loja)} sha=${OUTRO} linhas=5 ok_false=0 ok_nao_booleano=0 rol=ok
`,
          },
        });
      const sete = await prova("loja-07");
      assertEquals(sete.ok, true, sete.motivo);
      const oito = await prova("loja-08");
      assertEquals(oito.ok, false);
      assertStringIncludes(oito.motivo, "terminou failure");
      const dez = await prova("loja-10");
      assertEquals(dez.ok, true, dez.motivo);
    },
    { rodarGh },
  );
  assertEquals(lidos.length, 1, "a lista é lida uma vez só para as provas");
  assert(lidos[0] >= 150, `janela de ${lidos[0]} runs não cobre os 150`);
});
