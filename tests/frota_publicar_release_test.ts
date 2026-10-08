// @ts-nocheck
/* eslint-disable security/detect-object-injection -- dublês de teste: as chaves vêm de constantes e mapas fechados do próprio arquivo, nunca de entrada externa. */
/**
 * scripts/frota/publicar-release.mjs — o portão único de publicação da frota.
 *
 * O QUE ESTES TESTES MEDEM (todas as dependências são dublês: nenhuma rede,
 * nenhum CLI, nenhum banco, nenhum SQL real):
 *  - qualquer falha de prontidão (candidato, inventário, identidade/isolamento/
 *    canônico antes do promote, ledger, prova de objetos 8e, functions,
 *    verify_jwt, loja assinante sem canal) BLOQUEIA e o promote NUNCA é
 *    chamado, mesmo com --promover; o bloqueio nomeia o alvo;
 *  - versão antiga antes do promote (ENDERECO_ANTIGO) NÃO bloqueia;
 *  - a evidência 8e só vale fresca, da loja certa, do commit com as mesmas
 *    migrations, com N>0 linhas, nenhuma ok=false e sem apply depois;
 *  - functions comparam CONJUNTOS de arquivos (falta, sobra, difere);
 *  - loja de teste (política) não é consultada no backend;
 *  - pronto + --promover chama o promote UMA vez e exige a conferência da frota
 *    e a produção oficial = deployment promovido; falha depois imprime o
 *    rollback exato para a produção anterior.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { resolverCliVercel } from "../scripts/frota/conferir-frota.mjs";
import {
  CONSULTAS_DE_ROL_FECHADO,
  argumentosDoPromote,
  arquivosEsperados,
  classificarFuncao,
  comandosDeConserto,
  decidirLote,
  evidenciaDaProva,
  importsRelativos,
  lerArgumentos,
  lerVeredicto,
  migrationsDaRelease,
  problemasAntesDoPromote,
  publicarRelease,
  verifyJwtDoConfig,
  versoesAplicadas,
} from "../scripts/frota/publicar-release.mjs";

const SHA = "a1580759629ae0568f76923a0daff6287a21f780";
const BASE = "07a12ddd33aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OUTRO = "b".repeat(40);
const IDENT = "e".repeat(64);
const CAF = "cafkrminfnokvgjqtkle";
const SAVY = "gnjsrucsmjkajijrakzr";
const TESTE = "cuemaffjmhkebhmghbap";
const NOVA = "zzzzzzzzzzzzzzzzzzzz";
const DPL = "dpl_Novo123";
const DPL_ANTERIOR = "dpl_Anterior456";
const AGORA = Date.parse("2026-10-06T20:00:00Z");
const PROVA = "8e-conferir-92-a-202-aplicado";
const A8 = "8a-antes-92-a-202-objetos-e-corpos";
const B8 = "8b-papeis-contraditorios";
const K8 = "8k-subtotal-divergente-ou-vazia-provada";
// A conferência de subtotal ANTIGA (legada): o portão não a usa mais.
const C8_LEGADA = "8c-subtotal-divergente";
const TOPO = "c".repeat(40);

const politica = {
  projetoVercel: { id: "prj_X", time: "team_Y" },
  lojasSemBackendGerenciado: [{ ref: TESTE, nome: "Almeida Store" }],
  enderecosEsperados: [{ dominio: "manut.vercel.app", estado: "manutencao" }],
  migrationsForaDaRelease: [{ versao: "20261201000000" }],
};
const canais = {
  ramoDaRelease: "claude/app-major-upgrade-wmc8x2",
  funcoesNaoPublicadas: ["send-order-whatsapp"],
  validadeDaEvidenciaHoras: 6,
  provasDeObjetos: [
    {
      consulta: PROVA,
      versoes: ["20261192000000"],
      backfillLedger: "92-202",
      ausenciaConfirmadaPor: A8,
      conferenciasAntesDoApply: [A8, B8, K8],
    },
  ],
  canais: {
    [CAF]: {
      nome: "IKCOUS",
      migrations: "ikcous-publicada",
      functions: "ikcous-publicada",
      projetosNoMesmoBanco: ["loja"],
      functionsPublicaveis: ["criar-pagamento", "webhook-mercadopago"],
    },
    [SAVY]: {
      nome: "Savy",
      migrations: "savy",
      functions: "savy",
      projetosNoMesmoBanco: [],
      functionsPublicaveis: ["criar-pagamento", "webhook-mercadopago"],
    },
  },
};

function versao(sha = SHA) {
  return JSON.stringify({
    version: `1.5.18-sha.${sha.slice(0, 7)}-identity.${IDENT}`,
    codeVersion: "1.5.18",
    codeSha: sha,
    identityRevision: IDENT,
    source: "database",
    promotable: true,
  });
}

function sonda(dominio, ref, titulo, sha = SHA) {
  return {
    dominio,
    versao: { codeSha: sha },
    ficha: {
      status: 200,
      caderneta: "hit",
      titulo,
      refs: [ref],
      estavel: true,
    },
  };
}

// Árvores de arquivos por commit. criar-pagamento importa _shared/mp.ts; a
// release mudou criar-pagamento/index.ts e acrescentou _shared/novo.ts.
const ARVORE = {
  [SHA]: {
    "supabase/functions/criar-pagamento/index.ts":
      'import { a } from "../_shared/mp.ts";\nimport "../_shared/novo.ts";\n// novo',
    "supabase/functions/_shared/mp.ts": "export const a = 1;",
    "supabase/functions/_shared/novo.ts": "export {};",
    "supabase/functions/calculate-shipping/index.ts": "frete",
    "supabase/functions/webhook-mercadopago/index.ts": "wh",
    "supabase/config.toml":
      '[functions."webhook-mercadopago"]\nverify_jwt = false\n',
  },
  [BASE]: {
    "supabase/functions/criar-pagamento/index.ts":
      'import { a } from "../_shared/mp.ts";\n// velho',
    "supabase/functions/_shared/mp.ts": "export const a = 1;",
    "supabase/functions/calculate-shipping/index.ts": "frete",
    "supabase/functions/webhook-mercadopago/index.ts": "wh",
  },
};
const MIGRATIONS = {
  [SHA]: [
    "20261190000000_a.sql",
    "20261192000000_b.sql",
    "20261201000000_fora.sql",
    "rollback-manual-20261192000000_b.sql",
  ],
  [BASE]: ["20261190000000_a.sql"],
};

function pacoteEmDia(nome) {
  return arquivosEsperados(nome, (c) => ARVORE[SHA][c] ?? null);
}

function log8e(ref, sha, okFalse = 0, linhas = 61) {
  return logConsulta(PROVA, ref, sha, okFalse, linhas);
}

// As consultas de ROL FECHADO (9a, 8e) só valem como evidência com ` rol=ok` no
// veredito (a resposta foi EXATAMENTE o rol); o helper imprime como o
// conferir-banco.cjs imprime. `rol` explícito sobrescreve (null = veredito ANTIGO, sem o campo).
function logConsulta(
  consulta,
  ref,
  sha,
  okFalse = 0,
  linhas = 10,
  rol = undefined,
) {
  const campo =
    rol === null
      ? ""
      : rol !== undefined
        ? ` rol=${rol}`
        : CONSULTAS_DE_ROL_FECHADO.has(consulta)
          ? " rol=ok"
          : "";
  return `algo\nVEREDITO-CONSULTA consulta=${consulta} ref=${ref} sha=${sha} linhas=${linhas} ok_false=${okFalse} ok_nao_booleano=0${campo}\n`;
}

/** Run verde de `conferir <consulta> em <projeto>` (databaseId próprio). */
function runConferir(
  id,
  consulta,
  projeto,
  createdAt = "2026-10-06T19:00:00Z",
) {
  return {
    databaseId: id,
    displayTitle: `conferir ${consulta} em ${projeto}`,
    headSha: OUTRO,
    createdAt,
    conclusion: "success",
    status: "completed",
  };
}

/** A saída REAL do `supabase migration list` 2.118 (tabela; o `-o json` é ignorado). */
function tabelaDoLedger(versoes) {
  return [
    "",
    "  ",
    "   Local | Remote           | Time (UTC)            ",
    "  -------|------------------|-----------------------",
    ...versoes.map((v) => `   \` \`   | \`${v}\` | \`${v}\`      `),
    "",
  ].join("\n");
}

/** As linhas de comando (`gh …`) que o relatório manda colar. */
const comandosGh = (relatorio) =>
  relatorio.split("\n").filter((l) => l.startsWith("gh "));

/** Dependências dublês; `ajuste` sobrescreve o estado por cenário. */
function deps(ajuste = {}) {
  const chamadas = {
    promover: [],
    migrationList: [],
    baixar: [],
    conferir: [],
  };
  const estado = {
    ledger: {
      [CAF]: ["20261190000000", "20261192000000"],
      [SAVY]: ["20261190000000", "20261192000000"],
    },
    noAr: {
      [CAF]: {
        "criar-pagamento": pacoteEmDia("criar-pagamento"),
        "calculate-shipping": pacoteEmDia("calculate-shipping"),
        "webhook-mercadopago": pacoteEmDia("webhook-mercadopago"),
      },
      [SAVY]: {
        "criar-pagamento": pacoteEmDia("criar-pagamento"),
        "calculate-shipping": pacoteEmDia("calculate-shipping"),
        "webhook-mercadopago": pacoteEmDia("webhook-mercadopago"),
      },
    },
    verifyJwt: { "webhook-mercadopago": false },
    sondas: [
      sonda("ickous-marketplace.vercel.app", CAF, "IKCOUS - imports"),
      sonda("savycollection.vercel.app", SAVY, "Savy", BASE),
      sonda("almeidastore.vercel.app", TESTE, "Almeida Store", BASE),
      {
        dominio: "manut.vercel.app",
        ficha: { status: 503, caderneta: "miss", refs: [] },
      },
    ],
    vercelOk: true,
    completo: true,
    producaoOficial: DPL_ANTERIOR,
    candidato: {
      id: DPL,
      url: "cand.vercel.app",
      target: "production",
      readyState: "READY",
      projectId: "prj_X",
    },
    versaoCandidato: versao(),
    classesAntes: [
      { dominio: "savycollection.vercel.app", classe: "ENDERECO_ANTIGO" },
      { dominio: "ickous-marketplace.vercel.app", classe: "OK" },
    ],
    posOk: true,
    producaoDepois: DPL,
    runsConferir: [
      {
        databaseId: 11,
        displayTitle: `conferir ${PROVA} em savy`,
        headSha: OUTRO,
        createdAt: "2026-10-06T19:00:00Z",
        conclusion: "success",
        status: "completed",
      },
    ],
    runsAplicar: [
      {
        databaseId: 9,
        displayTitle: "aplicar em savy: 20261192000000_b.sql",
        createdAt: "2026-10-06T18:00:00Z",
        conclusion: "success",
        status: "completed",
      },
    ],
    logs: { 11: log8e(SAVY, OUTRO) },
    arvoreIgual: true,
    topo: TOPO,
    ...ajuste,
  };
  const d = {
    politica,
    canais,
    agora: () => AGORA,
    fetchImpl: async () =>
      new Response(estado.versaoCandidato, { status: 200 }),
    vercelApi: async () => estado.candidato,
    inventariar: async () => ({
      origem: "vercel",
      completo: estado.completo,
      motivoParcial: estado.completo ? null : "lista incompleta",
      dominios: estado.sondas.map((s) => s.dominio),
      vercel: estado.vercelOk
        ? { ok: true, producaoOficial: estado.producaoOficial }
        : { ok: false, erro: "contrato quebrado" },
      sondas: estado.sondas,
    }),
    conferirFrota: async (_p, _sha, inventario) => {
      chamadas.conferir.push(inventario ? "antes" : "depois");
      if (inventario)
        return {
          ok: false,
          resultados: estado.classesAntes,
          relatorio: "(antes)",
        };
      return {
        ok: estado.posOk,
        resultados: [],
        relatorio: "(relatório da frota)",
        vercel: { ok: true, producaoOficial: estado.producaoDepois },
      };
    },
    promover: async (id) => {
      chamadas.promover.push(id);
    },
    listarMigrationsNoSha: async (sha) => MIGRATIONS[sha] ?? [],
    listarFuncoesNoSha: async () => [
      "_shared",
      "criar-pagamento",
      "calculate-shipping",
      "webhook-mercadopago",
      "send-order-whatsapp",
    ],
    lerArquivoNoSha: (sha, caminho) => ARVORE[sha]?.[caminho] ?? null,
    arvoreIgual: async (a, b, caminhos) =>
      typeof estado.arvoreIgual === "function"
        ? estado.arvoreIgual(a, b, caminhos)
        : estado.arvoreIgual,
    topoDoRamo: async () => {
      if (estado.topo instanceof Error) throw estado.topo;
      return estado.topo;
    },
    listarRuns: async (wf) =>
      wf === "conferir-banco-da-loja.yml"
        ? estado.runsConferir
        : estado.runsAplicar,
    logDoRun: async (id) => estado.logs[id] ?? "",
    migrationList: async (ref) => {
      chamadas.migrationList.push(ref);
      if (!estado.ledger[ref]) throw new Error("sem acesso");
      return tabelaDoLedger(estado.ledger[ref]);
    },
    listarFuncoes: async (ref) =>
      Object.keys(estado.noAr[ref] ?? {}).map((slug) => ({
        slug,
        verify_jwt: estado.verifyJwt[slug] ?? true,
      })),
    baixarFuncao: async (ref, nome) => {
      chamadas.baixar.push(`${ref}:${nome}`);
      return [...estado.noAr[ref][nome]].map(([caminho, conteudo]) => ({
        caminho,
        conteudo,
      }));
    },
  };
  return { d, chamadas, estado };
}

const executar = (d, promover = false) =>
  publicarRelease({ sha: SHA, deploymentId: DPL, promover }, d);

Deno.test("PRONTO com candidato VÁLIDO: ensaio não promove, mostra o comando e versão antiga não bloqueia", async () => {
  const { d, chamadas } = deps();
  const r = await executar(d);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(chamadas.promover.length, 0);
  assertStringIncludes(r.relatorio, "OK: cand.vercel.app");
  assertStringIncludes(
    r.relatorio,
    `--sha ${SHA} --deployment ${DPL} --promover`,
  );
  assertEquals(chamadas.conferir, ["antes"]);
});

Deno.test("loja de teste da política nunca é consultada no backend", async () => {
  const { d, chamadas } = deps();
  await executar(d);
  assert(!chamadas.migrationList.includes(TESTE));
  assert(!chamadas.baixar.some((b) => b.startsWith(TESTE)));
  assert(
    chamadas.migrationList.includes(SAVY) &&
      chamadas.migrationList.includes(CAF),
  );
});

// ---- lacuna no ledger: nunca reaplicar o que já está no banco (correção da coordenação, 06/10)
const LEDGER_CAF_SEM_92 = {
  [CAF]: ["20261190000000"],
  [SAVY]: ["20261190000000", "20261192000000"],
};
const LEDGER_SAVY_SEM_92 = {
  [CAF]: ["20261190000000", "20261192000000"],
  [SAVY]: ["20261190000000"],
};

Deno.test("CAF com schema ÍNTEGRO (8e verde) e ledger faltando: só prova+backfill do registro, NENHUM apply", async () => {
  const { d, chamadas } = deps({
    ledger: LEDGER_CAF_SEM_92,
    runsConferir: [
      runConferir(11, PROVA, "savy"),
      runConferir(21, PROVA, "ikcous-publicada"),
    ],
    logs: { 11: log8e(SAVY, OUTRO), 21: log8e(CAF, OUTRO) },
  });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover.length, 0);
  assert(
    r.bloqueios.some(
      (b) => b.alvo.includes(CAF) && b.motivo.includes("BACKFILL"),
    ),
    JSON.stringify(r.bloqueios),
  );
  const gh = comandosGh(r.relatorio);
  assertEquals(gh, [
    `gh workflow run conferir-banco-da-loja.yml --ref "claude/app-major-upgrade-wmc8x2" -f "consulta=${PROVA}" -f "projeto=ikcous-publicada" -f "expected_sha=${TOPO}" -f "gravar_ledger=92-202" -f "confirmar=GRAVAR"`,
  ]);
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("CAF com ledger faltando e SEM evidência da 8e: o único comando é a 8e (nem backfill, nem apply)", async () => {
  const { d } = deps({ ledger: LEDGER_CAF_SEM_92 });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1);
  const gh = comandosGh(r.relatorio);
  assertEquals(gh, [
    `gh workflow run conferir-banco-da-loja.yml --ref "claude/app-major-upgrade-wmc8x2" -f "consulta=${PROVA}" -f "projeto=ikcous-publicada" -f "expected_sha=${TOPO}"`,
  ]);
  assert(
    !r.relatorio.includes("aplicar-migrations.yml") &&
      !r.relatorio.includes("GRAVAR"),
  );
});

Deno.test("Savy com ledger faltando e 8e NEGATIVA sem diagnóstico: pede 8a/8b/8k (só leitura), nenhum apply", async () => {
  const { d } = deps({
    ledger: LEDGER_SAVY_SEM_92,
    logs: { 11: log8e(SAVY, OUTRO, 61) },
  });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1);
  const gh = comandosGh(r.relatorio);
  assertEquals(gh.length, 3, r.relatorio);
  for (const [i, c] of [A8, B8, K8].entries())
    assertStringIncludes(gh[i], `-f "consulta=${c}" -f "projeto=savy"`);
  assert(
    !r.relatorio.includes("aplicar-migrations.yml") &&
      !r.relatorio.includes("GRAVAR"),
  );
});

Deno.test("Savy com lote AUSENTE confirmado pela 8a (e 8b/8k ok): apply com nomes COMPLETOS e SHA efetivo; functions só depois", async () => {
  const { d, estado } = deps({
    ledger: LEDGER_SAVY_SEM_92,
    runsConferir: [
      runConferir(11, PROVA, "savy"),
      runConferir(31, A8, "savy"),
      runConferir(32, B8, "savy"),
      runConferir(33, K8, "savy"),
    ],
    logs: {
      11: log8e(SAVY, OUTRO, 61),
      31: logConsulta(A8, SAVY, OUTRO),
      32: logConsulta(B8, SAVY, OUTRO),
      33: logConsulta(K8, SAVY, OUTRO),
    },
  });
  estado.noAr[SAVY]["criar-pagamento"] = arquivosEsperados(
    "criar-pagamento",
    (c) => ARVORE[BASE][c] ?? null,
  );
  const r = await executar(d, true);
  assertEquals(r.codigo, 1);
  const gh = comandosGh(r.relatorio);
  assertEquals(gh, [
    `gh workflow run aplicar-migrations.yml --ref "claude/app-major-upgrade-wmc8x2" -f "projeto=savy" -f "expected_sha=${TOPO}" -f "migracoes=20261192000000_b.sql"`,
  ]);
  assertStringIncludes(r.relatorio, "SÓ depois do banco pronto");
  assert(!r.relatorio.includes("publicar-functions.yml"));
});

Deno.test("Savy: 8k POSITIVA (vazia provada) + 8a + 8b positivas e a 8c LEGADA NEGATIVA no histórico: apply — a 8c saiu do portão", async () => {
  const { d } = deps({
    ledger: LEDGER_SAVY_SEM_92,
    runsConferir: [
      runConferir(11, PROVA, "savy"),
      runConferir(31, A8, "savy"),
      runConferir(32, B8, "savy"),
      runConferir(33, K8, "savy"),
      // uma 8c legada mais NOVA que tudo e NEGATIVA (loja vazia: os controles leem 0)
      runConferir(34, C8_LEGADA, "savy", "2026-10-06T19:30:00Z"),
    ],
    logs: {
      11: log8e(SAVY, OUTRO, 61),
      31: logConsulta(A8, SAVY, OUTRO),
      32: logConsulta(B8, SAVY, OUTRO),
      33: logConsulta(K8, SAVY, OUTRO),
      34: logConsulta(C8_LEGADA, SAVY, OUTRO, 2),
    },
  });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1);
  const gh = comandosGh(r.relatorio);
  assertEquals(gh.length, 1, r.relatorio);
  assertStringIncludes(gh[0], "aplicar-migrations.yml");
  assertStringIncludes(gh[0], '-f "projeto=savy"');
  assert(!r.relatorio.includes(C8_LEGADA), "o relatório não cita mais a 8c");
});

Deno.test("Savy: 8k SEM evidência (8a e 8b positivas): pede SÓ a 8k, nenhum apply; veredito da 8k com rol=invalido também é sem evidência", async () => {
  for (const [rotulo, logK] of [
    ["sem run", null],
    ["rol=invalido", logConsulta(K8, SAVY, OUTRO, 0, 20, "invalido")],
    [
      "veredito antigo, sem o campo rol",
      logConsulta(K8, SAVY, OUTRO, 0, 20, null),
    ],
  ] as Array<[string, string | null]>) {
    const runs = [
      runConferir(11, PROVA, "savy"),
      runConferir(31, A8, "savy"),
      runConferir(32, B8, "savy"),
    ];
    const logs: Record<number, string> = {
      11: log8e(SAVY, OUTRO, 61),
      31: logConsulta(A8, SAVY, OUTRO),
      32: logConsulta(B8, SAVY, OUTRO),
    };
    if (logK !== null) {
      runs.push(runConferir(33, K8, "savy"));
      logs[33] = logK;
    }
    const { d } = deps({
      ledger: LEDGER_SAVY_SEM_92,
      runsConferir: runs,
      logs,
    });
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, rotulo);
    const gh = comandosGh(r.relatorio);
    assertEquals(gh.length, 1, `${rotulo}: ${r.relatorio}`);
    assertStringIncludes(gh[0], `-f "consulta=${K8}" -f "projeto=savy"`);
    assert(!r.relatorio.includes("aplicar-migrations.yml"), rotulo);
  }
});

for (const [nome, negativa] of [
  ["8a (nem aplicado nem ausente: estado parcial)", A8],
  ["8b (papéis contraditórios)", B8],
  ["8k (subtotal divergente ou vazia provada)", K8],
]) {
  Deno.test(`Savy: 8e NEGATIVA e ${nome} com ok=false: PARADO, nenhum comando de banco`, async () => {
    const logs = {
      11: log8e(SAVY, OUTRO, 61),
      31: logConsulta(A8, SAVY, OUTRO),
      32: logConsulta(B8, SAVY, OUTRO),
      33: logConsulta(K8, SAVY, OUTRO),
    };
    const id = { [A8]: 31, [B8]: 32, [K8]: 33 }[negativa];
    logs[id] = logConsulta(negativa, SAVY, OUTRO, 2);
    const { d } = deps({
      ledger: LEDGER_SAVY_SEM_92,
      runsConferir: [
        runConferir(11, PROVA, "savy"),
        runConferir(31, A8, "savy"),
        runConferir(32, B8, "savy"),
        runConferir(33, K8, "savy"),
      ],
      logs,
    });
    const r = await executar(d, true);
    assertEquals(r.codigo, 1);
    assertEquals(comandosGh(r.relatorio), [], r.relatorio);
    assert(
      r.bloqueios.some(
        (b) =>
          b.alvo.includes(SAVY) &&
          b.motivo.includes("PARAR") &&
          b.motivo.includes(negativa),
      ),
      JSON.stringify(r.bloqueios),
    );
  });
}

Deno.test("ledger completo mas 8e NEGATIVA: PARADO (o registro mente), nenhum apply nem backfill", async () => {
  const { d } = deps({ logs: { 11: log8e(SAVY, OUTRO, 3) } });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1);
  assert(
    !r.relatorio.includes("aplicar-migrations.yml") &&
      !r.relatorio.includes("GRAVAR"),
    r.relatorio,
  );
  assert(
    r.bloqueios.some(
      (b) => b.alvo.includes(SAVY) && b.motivo.includes("PARAR"),
    ),
  );
});

Deno.test("migration ausente do ledger FORA de qualquer lote: bloqueia, sem comando automático", async () => {
  const { d } = deps({
    ledger: {
      [CAF]: ["20261192000000"],
      [SAVY]: ["20261190000000", "20261192000000"],
    },
  });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1);
  assert(
    r.bloqueios.some(
      (b) =>
        b.alvo.includes(CAF) &&
        b.motivo.includes("20261190000000") &&
        b.motivo.includes("fora de qualquer lote"),
    ),
  );
  assert(!r.relatorio.includes("aplicar-migrations.yml"));
});

Deno.test("topo do ramo não lido: bloqueia e não imprime comando nenhum", async () => {
  const { d } = deps({
    ledger: LEDGER_CAF_SEM_92,
    topo: new Error("sem rede"),
  });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1);
  assert(
    r.bloqueios.some(
      (b) => b.alvo.startsWith("ramo ") && b.motivo.includes("sem rede"),
    ),
  );
  assertEquals(comandosGh(r.relatorio), []);
});

Deno.test("topo com migrations diferentes da release: nenhum comando de banco; functions diferentes: nenhum de functions", async () => {
  const { d, estado } = deps({
    ledger: LEDGER_CAF_SEM_92,
    arvoreIgual: (a, _b, caminhos) =>
      a !== TOPO ||
      (!caminhos.includes("supabase/migrations") &&
        !caminhos.includes("supabase/functions")),
  });
  estado.noAr[SAVY]["criar-pagamento"] = arquivosEsperados(
    "criar-pagamento",
    (c) => ARVORE[BASE][c] ?? null,
  );
  const r = await executar(d, true);
  assertEquals(r.codigo, 1);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  assertStringIncludes(r.relatorio, "migrations ou consultas diferentes");
  assertStringIncludes(r.relatorio, "functions ou config.toml diferentes");
});

Deno.test("comandos nunca carregam marcador (<…>) e citam o SHA efetivo", async () => {
  for (const ajuste of [
    { ledger: LEDGER_CAF_SEM_92 },
    { ledger: LEDGER_SAVY_SEM_92, logs: { 11: log8e(SAVY, OUTRO, 61) } },
  ]) {
    const { d, estado } = deps(ajuste);
    estado.noAr[SAVY]["criar-pagamento"] = arquivosEsperados(
      "criar-pagamento",
      (c) => ARVORE[BASE][c] ?? null,
    );
    const r = await executar(d);
    const gh = comandosGh(r.relatorio);
    assert(gh.length > 0, r.relatorio);
    for (const c of gh) {
      assert(!/[<>]/.test(c), c);
      assertStringIncludes(c, `-f "expected_sha=${TOPO}"`);
    }
  }
});

Deno.test("functions NAO_PRONTAS com banco pronto: comando de functions com o SHA efetivo", async () => {
  const { d, estado } = deps();
  estado.noAr[SAVY]["criar-pagamento"] = arquivosEsperados(
    "criar-pagamento",
    (c) => ARVORE[BASE][c] ?? null,
  );
  const r = await executar(d, true);
  assertEquals(comandosGh(r.relatorio), [
    `gh workflow run publicar-functions.yml --ref "claude/app-major-upgrade-wmc8x2" -f "projeto=savy" -f "functions=criar-pagamento" -f "expected_sha=${TOPO}"`,
  ]);
});

Deno.test("decidirLote: ledger PARCIAL com a 8a dizendo AUSENTE é contradição — PARAR, não apply", () => {
  const lote = {
    consulta: PROVA,
    versoes: ["1", "2"],
    backfillLedger: "92-202",
    ausenciaConfirmadaPor: A8,
    conferenciasAntesDoApply: [A8, B8, K8],
  };
  const quando = { run: { createdAt: "2026-10-06T19:00:00Z" } };
  const pos = { estado: "POSITIVA", motivo: "ok", ...quando };
  const diagnostico = () =>
    new Map([
      [A8, pos],
      [B8, pos],
      [K8, pos],
    ]);
  const neg = { estado: "NEGATIVA", motivo: "x", ...quando };
  assertEquals(
    decidirLote({
      lote,
      faltam: ["2"],
      exigeProva: true,
      prova: neg,
      diagnostico: diagnostico(),
    }).acao,
    "PARAR",
  );
  assertEquals(
    decidirLote({
      lote,
      faltam: ["1", "2"],
      exigeProva: true,
      prova: neg,
      diagnostico: diagnostico(),
    }).acao,
    "APLICAR",
  );
  // diagnóstico mais VELHO que a prova negativa não autoriza apply
  const provaNova = { ...neg, run: { createdAt: "2026-10-06T19:30:00Z" } };
  assertEquals(
    decidirLote({
      lote,
      faltam: ["1", "2"],
      exigeProva: true,
      prova: provaNova,
      diagnostico: diagnostico(),
    }).acao,
    "CONFERIR",
  );
  assertEquals(
    decidirLote({ lote, faltam: ["1", "2"], exigeProva: false, prova: pos })
      .acao,
    "BACKFILL",
  );
  assertEquals(
    decidirLote({
      lote: { ...lote, backfillLedger: undefined },
      faltam: ["1"],
      exigeProva: false,
      prova: pos,
    }).acao,
    "PARAR",
  );
  assertEquals(
    decidirLote({
      lote: { ...lote, ausenciaConfirmadaPor: undefined },
      faltam: ["1", "2"],
      exigeProva: true,
      prova: neg,
    }).acao,
    "PARAR",
  );
  assertEquals(
    decidirLote({ lote, faltam: [], exigeProva: false, prova: undefined }).acao,
    "NADA",
  );
});

// ---- promote no Windows: nunca o vercel.cmd (execFile sem shell recusa .cmd)
Deno.test("resolverCliVercel no Windows: node + vc.js ao lado do vercel.cmd; sem vc.js lança; fora do Windows, 'vercel'", () => {
  const dirNpm = "C:\\Users\\X\\AppData\\Roaming\\npm";
  const arquivos = new Set([
    `${dirNpm}\\vercel.cmd`,
    `${dirNpm}\\node_modules\\vercel\\dist\\vc.js`,
  ]);
  const env = { Path: `C:\\Windows\\system32;${dirNpm};C:\\outro` };
  assertEquals(
    resolverCliVercel({
      env,
      plataforma: "win32",
      existe: (p) => arquivos.has(p),
      node: "C:\\node\\node.exe",
    }),
    {
      comando: "C:\\node\\node.exe",
      prefixo: [`${dirNpm}\\node_modules\\vercel\\dist\\vc.js`],
    },
  );
  // só o shim, sem o vc.js: não devolve o .cmd — lança
  assertThrows(
    () =>
      resolverCliVercel({
        env,
        plataforma: "win32",
        existe: (p) => p.endsWith("vercel.cmd"),
        node: "n",
      }),
    Error,
    "não encontrado",
  );
  assertEquals(
    resolverCliVercel({ env, plataforma: "linux", existe: () => false }),
    { comando: "vercel", prefixo: [] },
  );
});

Deno.test("argumentosDoPromote: argumentos SEPARADOS, sem shell; id fora do formato dpl_ é recusado", () => {
  const cli = {
    comando: "C:\\node\\node.exe",
    prefixo: ["C:\\npm\\node_modules\\vercel\\dist\\vc.js"],
  };
  assertEquals(argumentosDoPromote(cli, DPL, "gabriels-projects-5a19f6ee"), {
    comando: "C:\\node\\node.exe",
    args: [
      "C:\\npm\\node_modules\\vercel\\dist\\vc.js",
      "promote",
      DPL,
      "--yes",
      "--timeout",
      "5m",
      "--scope",
      "gabriels-projects-5a19f6ee",
    ],
  });
  for (const ruim of ["dpl_x & calc", "--yes", "dpl_", "", undefined])
    assertThrows(() => argumentosDoPromote(cli, ruim, "time"));
  for (const escopo of [undefined, "", "--token=x", "Time Com Espaço"])
    assertThrows(() => argumentosDoPromote(cli, DPL, escopo), Error, "escopo");
});

Deno.test("título de loja com '|' não quebra as tabelas do relatório", async () => {
  const { d, estado } = deps();
  estado.sondas[1] = sonda(
    "savycollection.vercel.app",
    SAVY,
    "Savy | Loja",
    BASE,
  );
  delete estado.ledger[SAVY];
  const r = await executar(d);
  assertStringIncludes(r.relatorio, "| Savy \\| Loja |");
  assertStringIncludes(r.relatorio, "| Savy \\| Loja (gnjsrucsmjkajijrakzr) |");
});

// ---- (1) prova de objetos 8e: ledger sozinho não basta
for (const [nome, ajuste, trecho] of [
  ["sem run da 8e da Savy", { runsConferir: [] }, "sem run"],
  [
    "run da 8e vencido (fora da validade)",
    {
      runsConferir: [
        {
          databaseId: 11,
          displayTitle: `conferir ${PROVA} em savy`,
          headSha: OUTRO,
          createdAt: "2026-10-06T10:00:00Z",
          conclusion: "success",
          status: "completed",
        },
      ],
    },
    "nas últimas 6 h",
  ],
  [
    "run da 8e que falhou",
    {
      runsConferir: [
        {
          databaseId: 11,
          displayTitle: `conferir ${PROVA} em savy`,
          headSha: OUTRO,
          createdAt: "2026-10-06T19:00:00Z",
          conclusion: "failure",
          status: "completed",
        },
      ],
    },
    "terminou failure",
  ],
  [
    "antigo VERDE + mais novo VERMELHO na mesma loja e consulta",
    {
      runsConferir: [
        {
          databaseId: 11,
          displayTitle: `conferir ${PROVA} em savy`,
          headSha: OUTRO,
          createdAt: "2026-10-06T19:00:00Z",
          conclusion: "success",
          status: "completed",
        },
        {
          databaseId: 13,
          displayTitle: `conferir ${PROVA} em savy`,
          headSha: OUTRO,
          createdAt: "2026-10-06T19:40:00Z",
          conclusion: "failure",
          status: "completed",
        },
      ],
    },
    "(13) terminou failure",
  ],
  [
    "antigo VERDE + mais novo EM EXECUÇÃO",
    {
      runsConferir: [
        {
          databaseId: 11,
          displayTitle: `conferir ${PROVA} em savy`,
          headSha: OUTRO,
          createdAt: "2026-10-06T19:00:00Z",
          conclusion: "success",
          status: "completed",
        },
        {
          databaseId: 14,
          displayTitle: `conferir ${PROVA} em savy`,
          headSha: OUTRO,
          createdAt: "2026-10-06T19:45:00Z",
          conclusion: "",
          status: "in_progress",
        },
      ],
    },
    "ainda não terminou",
  ],
  [
    "antigo VERDE + mais novo CANCELADO",
    {
      runsConferir: [
        {
          databaseId: 11,
          displayTitle: `conferir ${PROVA} em savy`,
          headSha: OUTRO,
          createdAt: "2026-10-06T19:00:00Z",
          conclusion: "success",
          status: "completed",
        },
        {
          databaseId: 15,
          displayTitle: `conferir ${PROVA} em savy`,
          headSha: OUTRO,
          createdAt: "2026-10-06T19:46:00Z",
          conclusion: "cancelled",
          status: "completed",
        },
      ],
    },
    "terminou cancelled",
  ],
  [
    "8e da OUTRA loja (título da CAF)",
    {
      runsConferir: [
        {
          databaseId: 11,
          displayTitle: `conferir ${PROVA} em ikcous-publicada`,
          headSha: OUTRO,
          createdAt: "2026-10-06T19:00:00Z",
          conclusion: "success",
          status: "completed",
        },
      ],
    },
    "sem run",
  ],
  [
    "8e com ref impresso de outra loja",
    { logs: { 11: log8e(CAF, OUTRO) } },
    "conferiu o ref",
  ],
  [
    "8e com uma linha ok=false",
    { logs: { 11: log8e(SAVY, OUTRO, 1) } },
    "ok=false",
  ],
  [
    "8e com zero linhas",
    { logs: { 11: log8e(SAVY, OUTRO, 0, 0) } },
    "sem linhas",
  ],
  ["8e sem veredicto no log", { logs: { 11: "nada" } }, "VEREDITO"],
  [
    "8e com veredito de rol INVÁLIDO (resposta parcial, repetida, com item desconhecido ou coluna errada)",
    { logs: { 11: logConsulta(PROVA, SAVY, OUTRO, 0, 61, "invalido") } },
    "rol fechado",
  ],
  [
    "8e com o veredito ANTIGO (sem o campo rol): só `ok` não basta",
    { logs: { 11: logConsulta(PROVA, SAVY, OUTRO, 0, 61, null) } },
    "rol fechado",
  ],
  [
    "8e com dois veredictos (ambíguo)",
    { logs: { 11: log8e(SAVY, OUTRO) + log8e(SAVY, OUTRO) } },
    "VEREDITO",
  ],
  [
    "8e de commit com migrations diferentes do SHA",
    { arvoreIgual: false },
    "migrations ou consulta diferentes",
  ],
  [
    "apply na Savy DEPOIS da 8e",
    {
      runsAplicar: [
        {
          databaseId: 12,
          displayTitle: "aplicar em savy: x.sql",
          createdAt: "2026-10-06T19:30:00Z",
          conclusion: "success",
          status: "completed",
        },
      ],
    },
    "vencida",
  ],
  [
    "sha do veredicto ≠ commit do run",
    { logs: { 11: log8e(SAVY, SHA) } },
    "sha do veredicto",
  ],
]) {
  Deno.test(`BLOQUEIA prova de objetos: ${nome}`, async () => {
    const { d, chamadas } = deps(ajuste);
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, r.relatorio);
    assertEquals(chamadas.promover.length, 0);
    assert(
      r.bloqueios.some(
        (b) => b.alvo.includes(SAVY) && b.motivo.includes(trecho),
      ),
      JSON.stringify(r.bloqueios),
    );
  });
}

Deno.test("migration nova sem prova declarada: bloqueia", async () => {
  const { d } = deps();
  d.canais = { ...canais, provasDeObjetos: [] };
  const r = await executar(d, true);
  assertEquals(r.codigo, 1);
  assert(
    r.bloqueios.some((b) =>
      b.motivo.includes("sem prova de objetos declarada"),
    ),
  );
});

Deno.test("loja cuja base já tem a migration (CAF, base = SHA) não precisa de 8e nova", async () => {
  const { d } = deps();
  const r = await executar(d);
  assertEquals(r.codigo, 0, r.relatorio);
  assert(!r.bloqueios.some((b) => b.alvo.includes(CAF)));
});

// ---- (2) functions por CONJUNTO de arquivos
Deno.test("function que a release mudou e está velha no ar: NAO_PRONTA bloqueia", async () => {
  const { d, chamadas, estado } = deps();
  estado.noAr[SAVY]["criar-pagamento"] = arquivosEsperados(
    "criar-pagamento",
    (c) => ARVORE[BASE][c] ?? null,
  );
  const r = await executar(d, true);
  assertEquals(r.codigo, 1);
  assertEquals(chamadas.promover.length, 0);
  assert(
    r.bloqueios.some(
      (b) => b.alvo.includes(SAVY) && b.motivo.includes("criar-pagamento"),
    ),
    r.relatorio,
  );
  assertStringIncludes(r.relatorio, "publicar-functions.yml");
});

Deno.test("arquivo esperado que SUMIU do pacote do ar não passa como EM_DIA", async () => {
  const { d, estado } = deps();
  const pacote = pacoteEmDia("criar-pagamento");
  pacote.delete("supabase/functions/_shared/novo.ts");
  estado.noAr[SAVY]["criar-pagamento"] = pacote;
  const r = await executar(d, true);
  assertEquals(r.codigo, 1);
  assert(
    r.bloqueios.some((b) => b.motivo.includes("novo.ts (falta no ar)")),
    JSON.stringify(r.bloqueios),
  );
});

Deno.test("arquivo que SOBRA no ar (a release removeu) bloqueia", () => {
  const sha = new Map([["f/i.ts", "x"]]);
  const base = new Map([
    ["f/i.ts", "x"],
    ["f/velho.ts", "v"],
  ]);
  const noAr = new Map([
    ["f/i.ts", "x"],
    ["f/velho.ts", "v"],
  ]);
  assertEquals(classificarFuncao(noAr, sha, base).estado, "NAO_PRONTA");
});

Deno.test("deriva antiga (arquivo que a release não mudou) aparece mas não bloqueia", async () => {
  const { d, estado } = deps();
  estado.noAr[SAVY]["calculate-shipping"] = new Map([
    ["supabase/functions/calculate-shipping/index.ts", "frete-antigo"],
  ]);
  const r = await executar(d);
  assertEquals(r.codigo, 0, r.relatorio);
  assertStringIncludes(r.relatorio, "deriva antiga");
});

Deno.test("verify_jwt diferente do config.toml: bloqueia", async () => {
  const { d, estado } = deps();
  estado.verifyJwt = { "webhook-mercadopago": true };
  const r = await executar(d, true);
  assertEquals(r.codigo, 1);
  assert(r.bloqueios.some((b) => b.motivo.includes("verify_jwt")));
});

Deno.test("function da release ausente na loja: bloqueia", async () => {
  const { d, estado } = deps();
  const { "criar-pagamento": _fora, ...semCriarPagamento } = estado.noAr[SAVY];
  estado.noAr[SAVY] = semCriarPagamento;
  const r = await executar(d, true);
  assertEquals(r.codigo, 1);
  assert(r.bloqueios.some((b) => b.motivo.includes("não publicada")));
});

// ---- assinante nova e inventário
Deno.test("ASSINANTE NOVA entra pelo inventário sem lista por release e, sem canal, bloqueia pelo nome", async () => {
  const { d, chamadas, estado } = deps();
  estado.sondas.push(sonda("lojanova.vercel.app", NOVA, "Loja Nova", BASE));
  const r = await executar(d, true);
  assertEquals(r.codigo, 1);
  assertEquals(chamadas.promover.length, 0);
  assertStringIncludes(r.relatorio, "lojanova.vercel.app");
  assert(
    r.bloqueios.some(
      (b) => b.alvo.includes("Loja Nova") && b.motivo.includes("sem canal"),
    ),
    r.relatorio,
  );
});

Deno.test("ledger ilegível numa assinante: bloqueia (não vira 'nada falta')", async () => {
  const { d, estado } = deps();
  delete estado.ledger[SAVY];
  const r = await executar(d, true);
  assertEquals(r.codigo, 1);
  assert(
    r.bloqueios.some(
      (b) => b.alvo.includes(SAVY) && b.motivo.includes("ledger"),
    ),
  );
});

// ---- (3) identidade/isolamento/canônico antes do promote
for (const classe of [
  "LOJA_TROCADA",
  "SUSPEITA_ISOLAMENTO",
  "CANONICO_INVALIDO",
  "BUILD_DIVERGENTE",
  "INALCANCAVEL",
  "ESTADO_INESPERADO",
]) {
  Deno.test(`antes do promote: ${classe} bloqueia (versão antiga não)`, async () => {
    const { d, chamadas } = deps({
      classesAntes: [
        { dominio: "savycollection.vercel.app", classe, achados: ["x"] },
        { dominio: "a.vercel.app", classe: "ENDERECO_ANTIGO" },
      ],
    });
    const r = await executar(d, true);
    assertEquals(r.codigo, 1);
    assertEquals(chamadas.promover.length, 0);
    assert(r.bloqueios.some((b) => b.motivo.includes(classe)));
    assert(!r.bloqueios.some((b) => b.motivo.includes("ENDERECO_ANTIGO")));
  });
}

Deno.test("problemasAntesDoPromote aceita só OK e ENDERECO_ANTIGO (formato REAL dos achados: {classe, motivo})", () => {
  const velho = { codeSha: BASE };
  assertEquals(
    problemasAntesDoPromote(
      {
        resultados: [
          { dominio: "a", classe: "OK", achados: [] },
          {
            dominio: "b",
            classe: "ENDERECO_ANTIGO",
            versao: velho,
            achados: [{ classe: "ENDERECO_ANTIGO", motivo: "serve 07a12dd" }],
          },
        ],
      },
      SHA,
    ),
    [],
  );
  const r = problemasAntesDoPromote(
    {
      resultados: [
        {
          dominio: "c",
          classe: "LOJA_TROCADA",
          achados: [{ classe: "LOJA_TROCADA", motivo: "ref de outra loja" }],
        },
      ],
    },
    SHA,
  );
  assertEquals(r, ["c: LOJA_TROCADA — ref de outra loja"]);
  assert(!r[0].includes("[object Object]"));
});

// O furo da revisão final: ENDERECO_ANTIGO é mais grave na ordem de GRAVIDADE e escondia estes achados.
for (const [nome, achado] of [
  [
    "redirecionamento para outra loja (CANONICO_INVALIDO)",
    {
      classe: "CANONICO_INVALIDO",
      motivo:
        "Location leva para outra-loja.vercel.app, esperado ickous-marketplace.vercel.app",
    },
  ],
  [
    "manutenção servindo uma loja (ESTADO_INESPERADO)",
    {
      classe: "ESTADO_INESPERADO",
      motivo: "esperado manutenção (HTTP 503), veio HTTP 200",
    },
  ],
]) {
  Deno.test(`antes do promote: ${nome} escondido sob ENDERECO_ANTIGO BLOQUEIA`, async () => {
    const resultado = {
      dominio: "savy-collection.vercel.app",
      classe: "ENDERECO_ANTIGO",
      versao: { codeSha: BASE },
      achados: [achado, { classe: "ENDERECO_ANTIGO", motivo: "serve 07a12dd" }],
    };
    assertEquals(
      problemasAntesDoPromote({ resultados: [resultado] }, SHA).length,
      1,
    );
    const { d, chamadas } = deps({ classesAntes: [resultado] });
    const r = await executar(d, true);
    assertEquals(r.codigo, 1);
    assertEquals(chamadas.promover.length, 0);
    assert(
      r.bloqueios.some(
        (b) =>
          b.alvo === "frota (antes do promote)" &&
          b.motivo.includes(achado.classe),
      ),
      JSON.stringify(r.bloqueios),
    );
  });
}

Deno.test("antes do promote: BUILD_DIVERGENTE passa SÓ no build velho provado (codeSha válido ≠ release); no build da release ou sem versão, bloqueia", () => {
  const achados = [
    { classe: "BUILD_DIVERGENTE", motivo: "version.json fora do contrato: x" },
  ];
  assertEquals(
    problemasAntesDoPromote(
      {
        resultados: [
          {
            dominio: "v",
            classe: "ENDERECO_ANTIGO",
            versao: { codeSha: BASE },
            achados,
          },
        ],
      },
      SHA,
    ),
    [],
  );
  assertEquals(
    problemasAntesDoPromote(
      {
        resultados: [
          {
            dominio: "n",
            classe: "BUILD_DIVERGENTE",
            versao: { codeSha: SHA },
            achados,
          },
        ],
      },
      SHA,
    ).length,
    1,
  );
  assertEquals(
    problemasAntesDoPromote(
      {
        resultados: [
          {
            dominio: "s",
            classe: "BUILD_DIVERGENTE",
            versao: { codeSha: "abc" },
            achados,
          },
        ],
      },
      SHA,
    ).length,
    1,
  );
  assertEquals(
    problemasAntesDoPromote(
      { resultados: [{ dominio: "z", classe: "BUILD_DIVERGENTE", achados }] },
      SHA,
    ).length,
    1,
  );
});

// ---- evidência: o que a vence (revisão final, achado 4) e a ferramenta que a imprime (achado 8)
const LEDGER_CAF_SEM_92_COM_8E = {
  ledger: {
    [CAF]: ["20261190000000"],
    [SAVY]: ["20261190000000", "20261192000000"],
  },
  runsConferir: [
    runConferir(11, PROVA, "savy"),
    runConferir(21, PROVA, "ikcous-publicada"),
  ],
  logs: { 11: log8e(SAVY, OUTRO), 21: log8e(CAF, OUTRO) },
};
for (const [nome, aplicar] of [
  [
    "apply pelo alvo `loja` (mesmo banco da CAF) depois da 8e",
    {
      databaseId: 41,
      displayTitle: "aplicar em loja: x.sql",
      createdAt: "2026-10-06T19:30:00Z",
      updatedAt: "2026-10-06T19:31:00Z",
      status: "completed",
      conclusion: "success",
    },
  ],
  [
    "apply criado ANTES da 8e e ainda em execução",
    {
      databaseId: 42,
      displayTitle: "aplicar em ikcous-publicada: x.sql",
      createdAt: "2026-10-06T18:50:00Z",
      updatedAt: "2026-10-06T18:50:00Z",
      status: "in_progress",
      conclusion: "",
    },
  ],
  [
    "apply criado ANTES da 8e e terminado DEPOIS",
    {
      databaseId: 43,
      displayTitle: "aplicar em ikcous-publicada: x.sql",
      createdAt: "2026-10-06T18:55:00Z",
      updatedAt: "2026-10-06T19:05:00Z",
      status: "completed",
      conclusion: "success",
    },
  ],
  [
    "apply de ramo antigo (título sem alvo) terminado depois",
    {
      databaseId: 44,
      displayTitle: "Aplicar migrations (Supabase)",
      createdAt: "2026-10-06T19:10:00Z",
      updatedAt: "2026-10-06T19:12:00Z",
      status: "completed",
      conclusion: "success",
    },
  ],
]) {
  Deno.test(`evidência da CAF vencida: ${nome} — nada de backfill`, async () => {
    const { d } = deps({ ...LEDGER_CAF_SEM_92_COM_8E, runsAplicar: [aplicar] });
    const r = await executar(d);
    assertEquals(r.codigo, 1);
    assert(!r.relatorio.includes("GRAVAR"), r.relatorio);
    assert(
      r.bloqueios.some(
        (b) => b.alvo.includes(CAF) && b.motivo.includes("vencida"),
      ),
      JSON.stringify(r.bloqueios),
    );
  });
}

Deno.test("apply de OUTRA loja, ou antigo e terminado antes da 8e, não vence a evidência da CAF", async () => {
  const { d } = deps({
    ...LEDGER_CAF_SEM_92_COM_8E,
    runsAplicar: [
      {
        databaseId: 45,
        displayTitle: "aplicar em savy: x.sql",
        createdAt: "2026-10-06T19:30:00Z",
        updatedAt: "2026-10-06T19:31:00Z",
        status: "completed",
        conclusion: "success",
      },
      {
        databaseId: 46,
        displayTitle: "Aplicar migrations (Supabase)",
        createdAt: "2026-10-01T10:00:00Z",
        updatedAt: "2026-10-01T10:05:00Z",
        status: "completed",
        conclusion: "success",
      },
    ],
  });
  const r = await executar(d);
  assert(r.relatorio.includes('-f "confirmar=GRAVAR"'), r.relatorio);
});

Deno.test("evidência de um commit com OUTRA ferramenta de conferência (conferir-banco.cjs/workflow ≠ topo): sem evidência", async () => {
  const { d } = deps({
    ...LEDGER_CAF_SEM_92_COM_8E,
    arvoreIgual: (_a, b, caminhos) =>
      !(
        b === TOPO && caminhos.includes("scripts/publicacao/conferir-banco.cjs")
      ),
  });
  const r = await executar(d);
  assert(!r.relatorio.includes("GRAVAR"));
  assert(
    r.bloqueios.some(
      (b) =>
        b.alvo.includes(CAF) && b.motivo.includes("ferramenta de conferência"),
    ),
    JSON.stringify(r.bloqueios),
  );
});

// ---- achado 3: 8a "tudo ausente" mais VELHA que uma 8e negativa não autoriza apply
Deno.test("Savy: 8a/8b/8k verdes MAIS VELHAS que a 8e negativa: pede de novo, nenhum apply", async () => {
  const { d } = deps({
    ledger: LEDGER_SAVY_SEM_92,
    runsConferir: [
      runConferir(11, PROVA, "savy", "2026-10-06T19:30:00Z"),
      runConferir(31, A8, "savy", "2026-10-06T19:00:00Z"),
      runConferir(32, B8, "savy", "2026-10-06T19:00:00Z"),
      runConferir(33, K8, "savy", "2026-10-06T19:00:00Z"),
    ],
    logs: {
      11: log8e(SAVY, OUTRO, 12),
      31: logConsulta(A8, SAVY, OUTRO),
      32: logConsulta(B8, SAVY, OUTRO),
      33: logConsulta(K8, SAVY, OUTRO),
    },
  });
  const r = await executar(d, true);
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
  assertEquals(comandosGh(r.relatorio).length, 3);
  assertStringIncludes(r.relatorio, "mais antiga que a prova");
});

// ---- achado 5: function fora do canal não ganha comando que o workflow recusaria
Deno.test("function NAO_PRONTA fora das publicáveis do canal: PARADA pelo nome, sem comando", async () => {
  const { d, estado } = deps();
  estado.noAr[SAVY]["calculate-shipping"] = new Map([
    ["supabase/functions/calculate-shipping/index.ts", "frete-antigo"],
  ]);
  // a release mudou calculate-shipping (base diferente do SHA)
  ARVORE[BASE]["supabase/functions/calculate-shipping/index.ts"] =
    "frete-antigo";
  try {
    const r = await executar(d, true);
    assertEquals(r.codigo, 1);
    assert(
      r.bloqueios.some((b) => b.motivo.includes("function calculate-shipping")),
      JSON.stringify(r.bloqueios),
    );
    assert(
      !comandosGh(r.relatorio).some((c) => c.includes("calculate-shipping")),
      r.relatorio,
    );
    assertStringIncludes(r.relatorio, "só publica");
  } finally {
    ARVORE[BASE]["supabase/functions/calculate-shipping/index.ts"] = "frete";
  }
});

// ---- (4) candidato
for (const [nome, ajuste, trecho] of [
  [
    "candidato de outro projeto",
    {
      candidato: {
        id: DPL,
        url: "c.vercel.app",
        target: "production",
        readyState: "READY",
        projectId: "prj_OUTRO",
      },
    },
    "outro projeto",
  ],
  [
    "candidato preview",
    {
      candidato: {
        id: DPL,
        url: "c.vercel.app",
        target: null,
        readyState: "READY",
        projectId: "prj_X",
      },
    },
    "não é de produção",
  ],
  [
    "candidato não READY",
    {
      candidato: {
        id: DPL,
        url: "c.vercel.app",
        target: "production",
        readyState: "ERROR",
        projectId: "prj_X",
      },
    },
    "READY",
  ],
  ["candidato serve outro SHA", { versaoCandidato: versao(BASE) }, "release é"],
  [
    "version.json do candidato sem identityRevision/codeVersion",
    {
      versaoCandidato: JSON.stringify({
        codeSha: SHA,
        source: "database",
        promotable: true,
      }),
    },
    "fora do contrato",
  ],
  [
    "version.json do candidato com promotable string",
    { versaoCandidato: versao().replace("true", '"true"') },
    "fora do contrato",
  ],
  [
    "version.json do candidato não-JSON",
    { versaoCandidato: "<html>" },
    "fora do contrato",
  ],
  ["inventário incompleto", { completo: false }, "PARCIAL"],
  [
    "lista oficial da Vercel não lida/contrato quebrado",
    { vercelOk: false },
    "aliases",
  ],
  ["produção oficial ausente", { producaoOficial: null }, "produção oficial"],
  ["produção oficial malformada", { producaoOficial: "x" }, "produção oficial"],
]) {
  Deno.test(`BLOQUEIA: ${nome} — nunca promove`, async () => {
    const { d, chamadas } = deps(ajuste);
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, r.relatorio);
    assertEquals(chamadas.promover.length, 0);
    assert(
      r.bloqueios.some((b) => String(b.motivo).includes(trecho)),
      JSON.stringify(r.bloqueios),
    );
  });
}

Deno.test("endereço que não é loja legível nem esperado: bloqueia", async () => {
  const { d, estado } = deps();
  estado.sondas.push({
    dominio: "estranho.vercel.app",
    ficha: { status: 200, caderneta: "hit", refs: [CAF, SAVY], estavel: true },
  });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1);
  assert(r.bloqueios.some((b) => b.motivo.includes("estranho.vercel.app")));
});

// ---- promote
Deno.test("--promover pronto: promove UMA vez o deployment e confere a frota antes e depois", async () => {
  const { d, chamadas } = deps();
  const r = await executar(d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(chamadas.promover, [DPL]);
  assertEquals(chamadas.conferir, ["antes", "depois"]);
});

Deno.test("pós-promote com frota falhando: código 1 e rollback exato para a produção anterior", async () => {
  const { d } = deps({ posOk: false });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1);
  assertStringIncludes(r.relatorio, `vercel rollback ${DPL_ANTERIOR} --yes`);
});

Deno.test("pós-promote com produção oficial que não virou o deployment: falha", async () => {
  const { d } = deps({ producaoDepois: DPL_ANTERIOR });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1);
});

Deno.test("promote que lança: código 1, sem conferência 'depois' fingida", async () => {
  const { d, chamadas } = deps();
  d.promover = async () => {
    throw new Error("negado");
  };
  const r = await executar(d, true);
  assertEquals(r.codigo, 1);
  assertEquals(chamadas.conferir, ["antes"]);
});

// ---- partes puras
Deno.test("arquivosEsperados segue imports relativos transitivos e marca importado ausente", () => {
  const arv = {
    "supabase/functions/f/index.ts":
      'import x from "./a.ts";\nexport * from "../_shared/b.ts";\nconst m = await import("../_shared/c.ts");\nimport "npm:zod";',
    "supabase/functions/f/a.ts": 'import "../_shared/b.ts";',
    "supabase/functions/_shared/b.ts": "b",
  };
  const m = arquivosEsperados("f", (c) => arv[c] ?? null);
  assertEquals([...m.keys()].sort(), [
    "supabase/functions/_shared/b.ts",
    "supabase/functions/_shared/c.ts",
    "supabase/functions/f/a.ts",
    "supabase/functions/f/index.ts",
  ]);
  assertEquals(m.get("supabase/functions/_shared/c.ts"), null);
  assertEquals(
    importsRelativos('import "https://x/y.ts"; import a from "./z.ts"'),
    ["./z.ts"],
  );
});

Deno.test("classificarFuncao: EM_DIA com CRLF, NAO_PRONTA, DERIVA_ANTIGA, base desconhecida e vazio", () => {
  const sha = new Map([
    ["a.ts", "n\nl"],
    ["s.ts", "x"],
  ]);
  const base = new Map([
    ["a.ts", "v"],
    ["s.ts", "x"],
  ]);
  assertEquals(
    classificarFuncao(
      new Map([
        ["a.ts", "n\r\nl"],
        ["s.ts", "x"],
      ]),
      sha,
      base,
    ).estado,
    "EM_DIA",
  );
  assertEquals(
    classificarFuncao(
      new Map([
        ["a.ts", "v"],
        ["s.ts", "x"],
      ]),
      sha,
      base,
    ).estado,
    "NAO_PRONTA",
  );
  assertEquals(
    classificarFuncao(
      new Map([
        ["a.ts", "n\nl"],
        ["s.ts", "outro"],
      ]),
      sha,
      base,
    ).estado,
    "DERIVA_ANTIGA",
  );
  assertEquals(
    classificarFuncao(
      new Map([
        ["a.ts", "n\nl"],
        ["s.ts", "outro"],
      ]),
      sha,
      null,
    ).estado,
    "NAO_PRONTA",
  );
  assertEquals(classificarFuncao(new Map(), sha, base).estado, "NAO_PRONTA");
  // importado ausente no SHA (null) e ausente no ar também: não é "em dia"
  assertEquals(
    classificarFuncao(
      new Map([["a.ts", "n\nl"]]),
      new Map([
        ["a.ts", "n\nl"],
        ["b.ts", null],
      ]),
      null,
    ).estado,
    "NAO_PRONTA",
  );
});

Deno.test("a 201 (fora da release) e os rollback-manual não são exigidos", () => {
  assertEquals(
    migrationsDaRelease(
      [
        "20261192000000_b.sql",
        "20261201000000_x.sql",
        "rollback-manual-20261192000000_b.sql",
        "2026110000000_curta.sql",
      ],
      politica,
    ),
    ["2026110000000", "20261192000000"],
  );
});

Deno.test("versoesAplicadas lê a TABELA real do CLI (só a coluna Remote) e o JSON; formato desconhecido ou vazio lança", () => {
  // Trecho literal do `supabase migration list --linked -o json` 2.118 contra a CAF (06/10/2026): tabela, não JSON.
  const real =
    "\n  \n   Local | Remote           | Time (UTC)            \n  -------|------------------|-----------------------\n   ` `   | `20240304000000` | `2024-03-04 00:00:00` \n   ` `   | `20261191000000` | `20261191000000`      \n\n";
  assertEquals(
    [...versoesAplicadas(real)],
    ["20240304000000", "20261191000000"],
  );
  // linha só local (Remote vazio) não conta como aplicada
  assertEquals(
    [
      ...versoesAplicadas(
        "   Local | Remote | Time\n  ---|---|---\n   `20261192000000` |   | \n   ` ` | `20261190000000` | x\n",
      ),
    ],
    ["20261190000000"],
  );
  const s =
    'Connecting...\n{"migrations":[{"local":"1","remote":"1"},{"local":"2","remote":""}]}\n';
  assertEquals([...versoesAplicadas(s)], ["1"]);
  assertThrows(() => versoesAplicadas("sem json nem tabela"));
  assertThrows(() => versoesAplicadas("{}"));
  assertThrows(
    () => versoesAplicadas("   Local | Remote | Time\n  ---|---|---\n"),
    Error,
    "nenhuma versão remota",
  );
});

Deno.test("lerVeredicto: único e da consulta pedida", () => {
  assertEquals(lerVeredicto(log8e(SAVY, OUTRO), PROVA)?.linhas, 61);
  assertEquals(lerVeredicto(log8e(SAVY, OUTRO), "8a-outra"), null);
  assertEquals(
    lerVeredicto(log8e(SAVY, OUTRO) + log8e(SAVY, OUTRO), PROVA),
    null,
  );
});

Deno.test("verifyJwtDoConfig lê só a seção da function", () => {
  const m = verifyJwtDoConfig(
    '[functions."a"]\nverify_jwt = false\n[outra]\nverify_jwt = false\n[functions.b]\nverify_jwt = true\n',
  );
  assertEquals(m, { a: false, b: true });
});

Deno.test("lerArgumentos exige --sha de 40 hex e --deployment dpl_", () => {
  assertThrows(() => lerArgumentos(["--deployment", DPL]));
  assertThrows(() => lerArgumentos(["--sha", "abc", "--deployment", DPL]));
  assertThrows(() =>
    lerArgumentos(["--sha", SHA, "--deployment", "https://x"]),
  );
  assertEquals(
    lerArgumentos([
      "--sha",
      SHA.toUpperCase(),
      "--deployment",
      DPL,
      "--promover",
    ]).promover,
    true,
  );
});

// ---- contrato entre módulos: a linha que conferir-banco.cjs imprime é a que publicar-release.mjs lê
import { createRequire } from "node:module";
const requireCjs = createRequire(import.meta.url);
const { veredictoDaConsulta } = requireCjs(
  "../scripts/publicacao/conferir-banco.cjs",
);

const CONSULTA_ANTIGA = "6a-conferir-79-a-82"; // fora do rol fechado: o formato antigo vale
Deno.test("VEREDITO-CONSULTA: o que conferir-banco.cjs imprime, lerVeredicto entende (ok, ok=false, sem linhas, sem coluna ok)", () => {
  const linhas = [
    { item: "a", ok: true },
    { item: "b", ok: false },
    { item: "c", ok: "t" },
  ];
  const v = lerVeredicto(
    veredictoDaConsulta({
      consulta: CONSULTA_ANTIGA,
      ref: SAVY,
      sha: OUTRO,
      linhas,
    }),
    CONSULTA_ANTIGA,
  );
  assertEquals(v, {
    ref: SAVY,
    sha: OUTRO,
    linhas: 3,
    okFalse: 1,
    naoBooleano: 1,
  });
  const vazio = lerVeredicto(
    veredictoDaConsulta({
      consulta: CONSULTA_ANTIGA,
      ref: SAVY,
      sha: OUTRO,
      linhas: [],
    }),
    CONSULTA_ANTIGA,
  );
  assertEquals(vazio?.linhas, 0);
  assertEquals(
    veredictoDaConsulta({
      consulta: "backups",
      ref: SAVY,
      sha: OUTRO,
      linhas: [{ x: 1 }],
    }),
    null,
  );
  // sem GITHUB_SHA (rodada local) o sha sai "local" e não casa com commit nenhum
  assertEquals(
    lerVeredicto(
      veredictoDaConsulta({
        consulta: CONSULTA_ANTIGA,
        ref: SAVY,
        sha: undefined,
        linhas: [{ ok: true }],
      }),
      CONSULTA_ANTIGA,
    )?.sha,
    "local",
  );
});

// ===========================================================================
// Lote 60-66 (06/10/2026) — a faixa histórica da CAF: prova 9a, backfill do
// registro e NUNCA apply (flag `nuncaAplicar`), só no canal da CAF (`soNosRefs`).
// ===========================================================================
const PROVA_9A = "9a-conferir-60-a-66-aplicado";
const VERSOES_60_66 = [
  "20261160000000",
  "20261161000000",
  "20261162000000",
  "20261163000000",
  "20261164000000",
  "20261165000000",
  "20261166000000",
];
const MIGRATIONS_60_66 = VERSOES_60_66.map((v) => `${v}_lote.sql`);
const ESTE_LOTE = {
  consulta: PROVA_9A,
  versoes: VERSOES_60_66,
  backfillLedger: "60-66",
  nuncaAplicar: true,
  soNosRefs: [CAF],
};
const QUANDO = { run: { createdAt: "2026-10-06T19:00:00Z" } };
const POS = { ok: true, estado: "POSITIVA", motivo: "ok", ...QUANDO };
const NEG = { ok: false, estado: "NEGATIVA", motivo: "x", ...QUANDO };
const SEM = { ok: false, estado: "SEM_EVIDENCIA", motivo: "sem run" };

Deno.test("decidirLote 60-66: nuncaAplicar com lacuna — POSITIVA = só BACKFILL; SEM_EVIDENCIA = só a 9a (CONFERIR); NEGATIVA = PARAR, MESMO com diagnóstico que prova a ausência", () => {
  const lote = { ...ESTE_LOTE, versoes: ["1", "2"] };
  assertEquals(
    decidirLote({ lote, faltam: ["1", "2"], exigeProva: false, prova: POS })
      .acao,
    "BACKFILL",
  );
  const sem = decidirLote({
    lote,
    faltam: ["1", "2"],
    exigeProva: false,
    prova: SEM,
  });
  assertEquals(sem.acao, "CONFERIR");
  assertEquals(sem.consultas, [PROVA_9A]);
  assertEquals(
    decidirLote({ lote, faltam: ["1", "2"], exigeProva: false, prova: NEG })
      .acao,
    "PARAR",
  );
  // O MUTANTE: lote COM `ausenciaConfirmadaPor` e diagnóstico TODO positivo — sem
  // a checagem de nuncaAplicar este é exatamente o caminho que devolve APLICAR.
  const comAusencia = {
    ...lote,
    ausenciaConfirmadaPor: A8,
    conferenciasAntesDoApply: [A8, B8, K8],
  };
  const diagnostico = () =>
    new Map([
      [A8, POS],
      [B8, POS],
      [K8, POS],
    ]);
  const nunca = decidirLote({
    lote: comAusencia,
    faltam: ["1", "2"],
    exigeProva: true,
    prova: NEG,
    diagnostico: diagnostico(),
  });
  assertEquals(nunca.acao, "PARAR", JSON.stringify(nunca));
  assert(
    nunca.versoes === undefined,
    "nuncaAplicar não devolve versões a aplicar",
  );
  // CONTROLE: o mesmo lote SEM a flag chega ao APLICAR (a fixture alcança o caminho que a flag fecha)
  assertEquals(
    decidirLote({
      lote: { ...comAusencia, nuncaAplicar: false },
      faltam: ["1", "2"],
      exigeProva: true,
      prova: NEG,
      diagnostico: diagnostico(),
    }).acao,
    "APLICAR",
  );
});

Deno.test("decidirLote 60-66: com o ledger COMPLETO a lógica de ledger completo vale INTEIRA — nuncaAplicar só bloqueia o APLICAR, não dispensa prova", () => {
  const lote = { ...ESTE_LOTE, versoes: ["1", "2"] };
  const d = (exigeProva: boolean, prova: any) =>
    decidirLote({ lote, faltam: [], exigeProva, prova });
  // exigeProva=true + NEGATIVA conhecida → PARAR (o atalho "NADA" a esconderia)
  const negativa = d(true, NEG);
  assertEquals(negativa.acao, "PARAR", JSON.stringify(negativa));
  assertEquals(d(true, SEM).acao, "CONFERIR");
  assertEquals(d(true, SEM).consultas, [PROVA_9A]);
  assertEquals(d(true, POS).acao, "NADA");
  assertEquals(d(false, undefined).acao, "NADA");
});

Deno.test("comandosDeConserto: lote nuncaAplicar NUNCA imprime aplicar-migrations (defesa em profundidade, mesmo se a decisão vier APLICAR)", () => {
  const loja = { titulo: "IKCOUS", ref: CAF };
  const canal = canais.canais[CAF];
  const ctx = {
    ramo: canais.ramoDaRelease,
    topo: TOPO,
    topoBancoIgual: true,
    topoFunctionsIgual: true,
    nomesPorVersao: new Map(VERSOES_60_66.map((v) => [v, `${v}_lote.sql`])),
  };
  const lote = { ...ESTE_LOTE };
  const pront = {
    lotes: [
      {
        consulta: PROVA_9A,
        lote,
        faltam: VERSOES_60_66,
        decisao: { acao: "APLICAR", versoes: VERSOES_60_66, motivo: "x" },
      },
    ],
    funcoes: [],
    bancoPronto: false,
  };
  const cmds = comandosDeConserto(loja, pront, canal, ctx);
  assert(!cmds.join("\n").includes("aplicar-migrations"), cmds.join("\n"));
  assert(!cmds.some((c) => c.startsWith("gh ")), "nenhum comando gh");
  // controle: o mesmo lote SEM a flag imprime o apply
  pront.lotes[0].lote = { ...lote, nuncaAplicar: false };
  assertStringIncludes(
    comandosDeConserto(loja, pront, canal, ctx).join("\n"),
    "aplicar-migrations.yml",
  );
});

/** CAF sem as 7 no ledger (a lacuna de verdade); Savy e o resto em dia. */
function depsLacunaDaCaf(
  ajuste: Record<string, unknown> = {},
  runsExtra: any[] = [],
  logsExtra: Record<number, string> = {},
) {
  const ledgerCompleto = ["20261190000000", "20261192000000", ...VERSOES_60_66];
  const x = deps({
    ledger: {
      [CAF]: ["20261190000000", "20261192000000"],
      [SAVY]: ledgerCompleto,
    },
    // a Savy tem a 8e verde (a evidência dela, de antes): o ruído dela fica de fora
    runsConferir: [runConferir(11, PROVA, "savy"), ...runsExtra],
    logs: { 11: log8e(SAVY, OUTRO), ...logsExtra },
    ...ajuste,
  });
  const antigo = x.d.listarMigrationsNoSha;
  x.d.listarMigrationsNoSha = async (sha: string) => [
    ...(await antigo(sha)),
    ...MIGRATIONS_60_66,
  ];
  x.d.canais = {
    ...canais,
    provasDeObjetos: [...canais.provasDeObjetos, ESTE_LOTE],
  };
  return x;
}
const logs9a = (id: number, okFalse = 0) => ({
  [id]: logConsulta(PROVA_9A, CAF, OUTRO, okFalse, 38),
});

Deno.test("CAF com a 9a POSITIVA e as 7 fora do ledger: SÓ o backfill 60-66 (nenhum apply)", async () => {
  const { d } = depsLacunaDaCaf(
    {},
    [runConferir(31, PROVA_9A, "ikcous-publicada")],
    logs9a(31),
  );
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [
    `gh workflow run conferir-banco-da-loja.yml --ref "claude/app-major-upgrade-wmc8x2" -f "consulta=${PROVA_9A}" -f "projeto=ikcous-publicada" -f "expected_sha=${TOPO}" -f "gravar_ledger=60-66" -f "confirmar=GRAVAR"`,
  ]);
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("CAF com a 9a NEGATIVA (com e sem o diagnóstico de ausência no ar): PARADA, sem comando de banco e SEM apply", async () => {
  for (const diag of [false, true]) {
    const logsNeg: Record<number, string> = { ...logs9a(31, 3) };
    const runs: any[] = [runConferir(31, PROVA_9A, "ikcous-publicada")];
    if (diag) {
      for (const [i, c] of [A8, B8, K8].entries()) {
        runs.push(
          runConferir(41 + i, c, "ikcous-publicada", "2026-10-06T19:30:00Z"),
        );
        logsNeg[41 + i] = logConsulta(c, CAF, OUTRO, 0, 10);
      }
    }
    const { d } = depsLacunaDaCaf({}, runs, logsNeg);
    const r = await executar(d, true);
    assertEquals(r.codigo, 1);
    assertEquals(comandosGh(r.relatorio), [], `diag=${diag}: ${r.relatorio}`);
    assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
    assert(
      r.bloqueios.some(
        (b) => b.alvo.includes(CAF) && b.motivo.includes("PARAR"),
      ),
      JSON.stringify(r.bloqueios),
    );
  }
});

Deno.test("CAF sem evidência da 9a: o único comando é a 9a (só leitura) — nem backfill, nem apply", async () => {
  const { d } = depsLacunaDaCaf();
  const r = await executar(d, true);
  assertEquals(comandosGh(r.relatorio), [
    `gh workflow run conferir-banco-da-loja.yml --ref "claude/app-major-upgrade-wmc8x2" -f "consulta=${PROVA_9A}" -f "projeto=ikcous-publicada" -f "expected_sha=${TOPO}"`,
  ]);
  assert(
    !r.relatorio.includes("GRAVAR") &&
      !r.relatorio.includes("aplicar-migrations.yml"),
  );
});

Deno.test("CAF com as 7 já no ledger: nada a fazer para o lote (nem 9a, nem backfill)", async () => {
  const { d } = depsLacunaDaCaf();
  d.migrationList = async (_ref: string) =>
    tabelaDoLedger(["20261190000000", "20261192000000", ...VERSOES_60_66]);
  const r = await executar(d, true);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  assert(!r.relatorio.includes(PROVA_9A), r.relatorio);
});

Deno.test("a Savy NUNCA exige a 9a: sem o lote declarado para o ref dela, a lacuna de 60..66 na Savy é 'fora de qualquer lote' e nenhum comando cita a 9a", async () => {
  const { d } = depsLacunaDaCaf();
  d.migrationList = async (ref: string) =>
    tabelaDoLedger(
      ref === CAF
        ? ["20261190000000", "20261192000000", ...VERSOES_60_66]
        : ["20261190000000", "20261192000000"],
    );
  const r = await executar(d, true);
  assertEquals(r.codigo, 1);
  assert(!r.relatorio.includes(PROVA_9A), r.relatorio);
  assert(
    r.bloqueios.some(
      (b) =>
        b.alvo.includes(SAVY) &&
        b.motivo.includes("fora de qualquer lote declarado"),
    ),
    JSON.stringify(r.bloqueios),
  );
});

Deno.test("lerCanais — o canais-de-backend.json real declara o lote 60-66 só na CAF e nuncaAplicar; lote nuncaAplicar com ausenciaConfirmadaPor é recusado", async () => {
  const { writeFileSync, mkdtempSync, readFileSync } = await import("node:fs");
  const { lerCanais } = await import("../scripts/frota/publicar-release.mjs");
  const real = lerCanais();
  const lote = real.provasDeObjetos.find((p: any) => p.consulta === PROVA_9A);
  assert(lote, "o lote 60-66 não está no canais-de-backend.json");
  assertEquals(lote.versoes, VERSOES_60_66);
  assertEquals(lote.nuncaAplicar, true);
  assertEquals(lote.backfillLedger, "60-66");
  assertEquals(lote.soNosRefs, [CAF]);
  assertEquals(lote.ausenciaConfirmadaPor, undefined);
  assertEquals(lote.conferenciasAntesDoApply, undefined);
  const dir = mkdtempSync(`${Deno.env.get("TEMP") ?? "/tmp"}/canais-`);
  const base = JSON.parse(
    readFileSync(
      new URL("../scripts/frota/canais-de-backend.json", import.meta.url),
      "utf8",
    ),
  );
  const escrever = (mutar: (c: any) => void) => {
    const c = structuredClone(base);
    mutar(c);
    const f = `${dir}/c-${Math.random().toString(36).slice(2)}.json`;
    writeFileSync(f, JSON.stringify(c));
    return f;
  };
  assertThrows(
    () =>
      lerCanais(
        escrever((c) => {
          c.provasDeObjetos[1].ausenciaConfirmadaPor =
            "8a-antes-92-a-202-objetos-e-corpos";
        }),
      ),
    Error,
    "nuncaAplicar",
  );
  assertThrows(
    () =>
      lerCanais(
        escrever((c) => {
          c.provasDeObjetos[1].conferenciasAntesDoApply = [
            "8b-papeis-contraditorios",
          ];
        }),
      ),
    Error,
    "nuncaAplicar",
  );
  assertThrows(
    () =>
      lerCanais(
        escrever((c) => {
          c.provasDeObjetos[1].soNosRefs = ["zzzzzzzzzzzzzzzzzzzz"];
        }),
      ),
    Error,
    "soNosRefs",
  );
  assertThrows(
    () =>
      lerCanais(
        escrever((c) => {
          c.provasDeObjetos[1].nuncaAplicar = "sim";
        }),
      ),
    Error,
    "booleano",
  );
  // o lote da 92-202 continua válido e SEM a flag
  assertEquals(real.provasDeObjetos[0].nuncaAplicar, undefined);
  // o lote da 92-202 exige a 8k (a 8c com a prova de vazia) e NÃO a 8c legada
  assertEquals(real.provasDeObjetos[0].consulta, PROVA);
  assertEquals(real.provasDeObjetos[0].conferenciasAntesDoApply, [A8, B8, K8]);
  assert(
    !JSON.stringify(real.provasDeObjetos[0].conferenciasAntesDoApply).includes(
      C8_LEGADA,
    ),
    "a 8c legada saiu do portão",
  );
});

// ===========================================================================
// O CONSUMIDOR da prova (06/10/2026): o veredito da 9a e da 8e só vale com o ROL
// FECHADO exato. Antes, uma resposta com UMA linha ok=true gerava um veredito
// aparentemente positivo, e o portão publicava em cima dela.
// ===========================================================================
const { ROL_DA_9A, ROL_DA_8E, ROL_DA_8K, ROL_FECHADO_POR_CONSULTA } =
  requireCjs("../scripts/publicacao/conferir-banco.cjs");
const linhasOk = (rol: string[]) =>
  rol.map((item) => ({ item, esperado: "x", vivo: "x", ok: true }));

const RESPOSTAS_QUE_NAO_SAO_O_ROL: Array<
  [string, (rol: string[]) => unknown[]]
> = [
  ["parcial (os presentes TODOS ok=true)", (rol) => linhasOk(rol).slice(0, 1)],
  ["parcial, só uma linha a menos", (rol) => linhasOk(rol).slice(1)],
  ["duplicada", (rol) => [...linhasOk(rol), linhasOk(rol)[0]]],
  [
    "com item desconhecido",
    (rol) => [
      ...linhasOk(rol),
      { item: "intruso", esperado: "x", vivo: "x", ok: true },
    ],
  ],
  [
    "com item trocado por outro",
    (rol) =>
      linhasOk(rol).map((l, i) => (i === 2 ? { ...l, item: "outro" } : l)),
  ],
  [
    "com coluna a mais",
    (rol) => linhasOk(rol).map((l, i) => (i === 2 ? { ...l, extra: 1 } : l)),
  ],
  [
    "com coluna faltando (sem vivo)",
    (rol) =>
      linhasOk(rol).map((l: any, i) => {
        return i === 2
          ? Object.fromEntries(Object.entries(l).filter(([k]) => k !== "vivo"))
          : l;
      }),
  ],
  [
    "com ok string",
    (rol) => linhasOk(rol).map((l, i) => (i === 2 ? { ...l, ok: "true" } : l)),
  ],
  [
    "com ok null",
    (rol) => linhasOk(rol).map((l, i) => (i === 2 ? { ...l, ok: null } : l)),
  ],
  ["sem nenhuma linha", () => []],
];

/** A evidência que o portão acharia para este log, com um run verde e fresco. */
async function evidenciaDoLog(
  consulta: string,
  projeto: string,
  ref: string,
  log: string,
) {
  return await evidenciaDaProva({
    consulta,
    projeto,
    ref,
    sha: SHA,
    topo: TOPO,
    validadeHoras: 48,
    agora: AGORA,
    deps: {
      listarRuns: async (wf: string) =>
        wf === "conferir-banco-da-loja.yml"
          ? [runConferir(77, consulta, projeto)]
          : [],
      logDoRun: async () => log,
      arvoreIgual: async () => true,
    },
  });
}

Deno.test("rol fechado: UMA fonte — o contrato por consulta do conferir-banco.cjs e o conjunto do portão são os mesmos, e cada rol é o da consulta certa", () => {
  assertEquals(
    [...Object.keys(ROL_FECHADO_POR_CONSULTA)].sort(),
    [...CONSULTAS_DE_ROL_FECHADO].sort(),
  );
  assertEquals(ROL_FECHADO_POR_CONSULTA[PROVA_9A], ROL_DA_9A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[PROVA], ROL_DA_8E);
  assertEquals(ROL_FECHADO_POR_CONSULTA[K8], ROL_DA_8K);
  assert(
    CONSULTAS_DE_ROL_FECHADO.has(K8),
    "a 8k do portão é de rol fechado: só vale com rol=ok",
  );
});

for (const [consulta, rol, projeto, ref] of [
  [PROVA_9A, ROL_DA_9A, "ikcous-publicada", CAF],
  [PROVA, ROL_DA_8E, "savy", SAVY],
  [K8, ROL_DA_8K, "savy", SAVY],
] as Array<[string, string[], string, string]>) {
  Deno.test(`veredictoDaConsulta ${consulta}: resposta que NÃO é o rol exato NUNCA vira veredito positivo (rol=invalido) e o portão a trata como SEM_EVIDENCIA`, async () => {
    for (const [nome, monta] of RESPOSTAS_QUE_NAO_SAO_O_ROL) {
      const linha = veredictoDaConsulta({
        consulta,
        ref,
        sha: OUTRO,
        linhas: monta(rol),
      });
      assert(linha, `${nome}: tem de haver uma linha de veredito`);
      assertStringIncludes(linha, " rol=invalido", nome);
      const v = lerVeredicto(linha, consulta);
      assertEquals(v?.rol, "invalido", nome);
      const e = await evidenciaDoLog(consulta, projeto, ref, `x\n${linha}\n`);
      assertEquals(e.estado, "SEM_EVIDENCIA", `${nome}: ${JSON.stringify(e)}`);
      assertEquals(e.ok, false, nome);
    }
  });

  Deno.test(`veredictoDaConsulta ${consulta}: o rol EXATO todo ok=true é POSITIVA; com uma ok=false é NEGATIVA (estrutura válida); o veredito antigo (sem rol) é SEM_EVIDENCIA`, async () => {
    const positiva = veredictoDaConsulta({
      consulta,
      ref,
      sha: OUTRO,
      linhas: linhasOk(rol),
    });
    assertStringIncludes(
      positiva,
      `linhas=${rol.length} ok_false=0 ok_nao_booleano=0 rol=ok`,
    );
    const e = await evidenciaDoLog(consulta, projeto, ref, positiva);
    assertEquals(e.estado, "POSITIVA", JSON.stringify(e));
    const reprovada = veredictoDaConsulta({
      consulta,
      ref,
      sha: OUTRO,
      linhas: linhasOk(rol).map((l, i) => (i === 3 ? { ...l, ok: false } : l)),
    });
    assertStringIncludes(reprovada, "ok_false=1 ok_nao_booleano=0 rol=ok");
    assertEquals(
      (await evidenciaDoLog(consulta, projeto, ref, reprovada)).estado,
      "NEGATIVA",
    );
    // o veredito ANTIGO: as mesmas contagens sem o campo `rol`
    const antigo = positiva.replace(" rol=ok", "");
    assertEquals(lerVeredicto(antigo, consulta)?.rol, undefined);
    const ea = await evidenciaDoLog(consulta, projeto, ref, antigo);
    assertEquals(ea.estado, "SEM_EVIDENCIA", JSON.stringify(ea));
    assertStringIncludes(ea.motivo, "rol fechado");
  });
}

Deno.test("consulta FORA do rol fechado (as faixas 72..83 e as antigas) segue com o formato antigo, sem o campo rol", () => {
  for (const consulta of [
    "1a-conferir-o-que-nasceu",
    "2a-marcadores-72-74",
    CONSULTA_ANTIGA,
    "7a-conferir-83",
  ]) {
    const linha = veredictoDaConsulta({
      consulta,
      ref: SAVY,
      sha: OUTRO,
      linhas: [{ item: "a", ok: true }],
    });
    assert(!linha.includes("rol="), linha);
    assertEquals(lerVeredicto(linha, consulta)?.rol, undefined);
  }
});

Deno.test("portão, 92-202 (8e) com o ledger COMPLETO: resposta parcial da 8e (rol=invalido) NUNCA gera 'pronto para publicar' nem libera o promote", async () => {
  const parcial = veredictoDaConsulta({
    consulta: PROVA,
    ref: SAVY,
    sha: OUTRO,
    linhas: linhasOk(ROL_DA_8E).slice(0, 1),
  });
  const { d, chamadas } = deps({ logs: { 11: `x\n${parcial}\n` } });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover.length, 0);
  assert(
    r.bloqueios.some(
      (b) => b.alvo.includes(SAVY) && b.motivo.includes("rol fechado"),
    ),
    JSON.stringify(r.bloqueios),
  );
  // controle: o MESMO cenário com o rol exato libera
  const exata = veredictoDaConsulta({
    consulta: PROVA,
    ref: SAVY,
    sha: OUTRO,
    linhas: linhasOk(ROL_DA_8E),
  });
  const ok = deps({ logs: { 11: `x\n${exata}\n` } });
  const r2 = await executar(ok.d, true);
  assertEquals(r2.codigo, 0, r2.relatorio);
});

Deno.test("portão, 60-66 (9a) na CAF: resposta parcial da 9a NUNCA vira backfill nem apply — só pede a 9a de novo", async () => {
  const parcial = veredictoDaConsulta({
    consulta: PROVA_9A,
    ref: CAF,
    sha: OUTRO,
    linhas: linhasOk(ROL_DA_9A).slice(0, 1),
  });
  const { d } = depsLacunaDaCaf(
    {},
    [runConferir(31, PROVA_9A, "ikcous-publicada")],
    { 31: `x\n${parcial}\n` },
  );
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assert(!r.relatorio.includes("GRAVAR"), r.relatorio);
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
  assertEquals(comandosGh(r.relatorio), [
    `gh workflow run conferir-banco-da-loja.yml --ref "claude/app-major-upgrade-wmc8x2" -f "consulta=${PROVA_9A}" -f "projeto=ikcous-publicada" -f "expected_sha=${TOPO}"`,
  ]);
  // controle: o rol exato todo ok libera SÓ o backfill
  const exata = veredictoDaConsulta({
    consulta: PROVA_9A,
    ref: CAF,
    sha: OUTRO,
    linhas: linhasOk(ROL_DA_9A),
  });
  const ok = depsLacunaDaCaf(
    {},
    [runConferir(31, PROVA_9A, "ikcous-publicada")],
    { 31: `x\n${exata}\n` },
  );
  const r2 = await executar(ok.d, true);
  assertEquals(comandosGh(r2.relatorio).length, 1);
  assertStringIncludes(r2.relatorio, "gravar_ledger=60-66");
});
