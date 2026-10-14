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
  lerCanais,
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
// O lote da migration 20261203000000 (cupons desligados, #645): consulta do lote (DEPOIS) e de ausência (ANTES).
const A10 = "10a-conferir-cupons-desligados-aplicado";
const B10 = "10b-antes-cupons-desligados-gatilho-e-corpo";
// O lote da migration 20261204000000 (a venda do balcão se anula no mesmo dia): consulta do lote (DEPOIS) e de ausência (ANTES).
const A11 = "11a-conferir-anular-venda-presencial-aplicado";
const B11 = "11b-antes-anular-venda-presencial-funcao-ausente";
// O lote das migrations 20261205000000 e 20261206000000 (o cupom preso diz quando a vaga volta; a vaga do pedido nunca cobrado volta em 1 h): consulta do lote (DEPOIS) e de ausência (ANTES).
const A12 = "12a-conferir-cupom-preso-aplicado";
const B12 = "12b-antes-cupom-preso-funcoes-ausentes";
// O lote da migration 20261207000000 (a coluna duplicada de contagem de uso do cupom e apagada): consulta do lote (DEPOIS) e a do ANTES (aqui o contrario do precedente: a coluna tem de estar PRESENTE e zerada).
const A14 = "14a-conferir-contador-duplicado-apagado";
const B14 = "14b-antes-contador-duplicado-coluna-presente-e-zerada";
// O lote da migration 20261208000000 (o checkout mostra os cupons da cliente): consulta do lote (DEPOIS) e de ausência (ANTES).
const A15 = "15a-conferir-cupons-do-checkout-aplicado";
const B15 = "15b-antes-cupons-do-checkout-pecas-ausentes";
// O lote das migrations 20261209000000 e 20261210000000 (o cupom do PIX anulado volta em minutos): consulta do lote (DEPOIS) e de ausência (ANTES).
const A16 = "16a-conferir-pix-anulado-aplicado";
const B16 = "16b-antes-pix-anulado-foto-ausente";
// O lote das migrations 20261212000000, 20261213000000 e 20261214000000 (o estoque do painel segue UMA regra; cada uma só troca o corpo de UMA função): consulta do lote (DEPOIS) e a do ANTES (os corpos vigentes).
const A17 = "17a-conferir-estoque-do-painel-aplicado";
const B17 = "17b-antes-estoque-do-painel-corpos-vigentes";
// O lote da migration 20261215000000 (a política de devolução não mostra quem a editou, achado L): consulta do lote (DEPOIS) e a do ANTES (SELECT da tabela inteira).
const A19 = "19a-conferir-politica-devolucao-aplicado";
const B19 = "19b-antes-politica-devolucao-grant-de-tabela";
// O lote da migration 20261216000000 (o cliente apaga a foto de devolução que não usou): consulta do lote (DEPOIS) e a do ANTES (nenhuma política de DELETE).
const A20 = "20a-conferir-fotos-da-devolucao-aplicado";
const B20 = "20b-antes-fotos-da-devolucao-sem-delete";
// O lote da migration 20261217000000 (o e-mail da loja tem teto e o codigo do convidado nao se queima): consulta do lote (DEPOIS) e a do ANTES (corpos vigentes).
const A21 = "21a-conferir-teto-de-email-aplicado";
const B21 = "21b-antes-teto-de-email-corpos-vigentes";
// O lote das migrations 20261218000000 + 20261218000100 + 20261219000000 (as portas pequenas do banco): consulta do lote (DEPOIS) e a do ANTES (estado vigente).
const A22 = "22a-conferir-portas-do-banco-aplicado";
const B22 = "22b-antes-portas-do-banco-estado-vigente";
// O lote da migration 20261220000000 (a consulta antiga de pedido por codigo fecha para o visitante): consulta do lote (DEPOIS) e a do ANTES (a v1 ainda aberta).
const A23 = "23a-conferir-consulta-antiga-de-pedido-fechada";
const B23 = "23b-antes-consulta-antiga-de-pedido-aberta";
// O lote da migration 20261221000000 (a media de avaliacoes e o voto util fecham para o visitante): consulta do lote (DEPOIS) e a do ANTES (as duas funcoes ainda abertas).
const A24 = "24a-conferir-avaliacoes-fechadas-ao-visitante";
const B24 = "24b-antes-avaliacoes-abertas-ao-visitante";
// O lote da migration 20261222000000 (a media de avaliacoes so responde ao administrador): consulta do lote (DEPOIS: corpo novo, guarda, ACL fechada) e a do ANTES (o corpo da baseline, sem a guarda).
const A25 = "25a-conferir-media-de-avaliacoes-so-admin";
const B25 = "25b-antes-media-de-avaliacoes-sem-guarda";
// O lote da migration 20261223000000 (o voto util so vale em avaliacao que o publico ve): consulta do lote (DEPOIS: corpo novo, guarda de status, ACL fechada) e a do ANTES (o corpo da 20261050000000, sem a guarda).
const A26 = "26a-conferir-voto-util-so-em-avaliacao-publica";
const B26 = "26b-antes-voto-util-sem-guarda-de-status";
const A27 = "27a-conferir-avaliacao-nasce-sem-resposta-da-loja";
const B27 = "27b-antes-avaliacao-aceita-resposta-forjada";

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
const {
  ROL_DA_9A,
  ROL_DA_8E,
  ROL_DA_8K,
  ROL_DA_10A,
  ROL_DA_12A,
  ROL_DA_12B,
  ROL_DA_14A,
  ROL_DA_14B,
  ROL_DA_15A,
  ROL_DA_15B,
  ROL_DA_16A,
  ROL_DA_16B,
  ROL_DA_17A,
  ROL_DA_17B,
  ROL_DA_19A,
  ROL_DA_19B,
  ROL_DA_20A,
  ROL_DA_20B,
  ROL_DA_21A,
  ROL_DA_21B,
  ROL_DA_22A,
  ROL_DA_22B,
  ROL_DA_23A,
  ROL_DA_23B,
  ROL_DA_24A,
  ROL_DA_24B,
  ROL_DA_25A,
  ROL_DA_25B,
  ROL_DA_26A,
  ROL_DA_26B,
  ROL_DA_27A,
  ROL_DA_27B,
  ROL_DA_10B,
  ROL_FECHADO_POR_CONSULTA,
} = requireCjs("../scripts/publicacao/conferir-banco.cjs");
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
  assertEquals(ROL_FECHADO_POR_CONSULTA[A10], ROL_DA_10A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B10], ROL_DA_10B);
  assertEquals(ROL_FECHADO_POR_CONSULTA[A15], ROL_DA_15A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B15], ROL_DA_15B);
  assertEquals(ROL_FECHADO_POR_CONSULTA[A16], ROL_DA_16A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B16], ROL_DA_16B);
  assertEquals(ROL_FECHADO_POR_CONSULTA[A17], ROL_DA_17A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B17], ROL_DA_17B);
  assertEquals(ROL_FECHADO_POR_CONSULTA[A19], ROL_DA_19A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B19], ROL_DA_19B);
  assertEquals(ROL_FECHADO_POR_CONSULTA[A20], ROL_DA_20A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B20], ROL_DA_20B);
  assertEquals(ROL_FECHADO_POR_CONSULTA[A21], ROL_DA_21A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B21], ROL_DA_21B);
  assertEquals(ROL_FECHADO_POR_CONSULTA[A22], ROL_DA_22A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B22], ROL_DA_22B);
  assertEquals(ROL_FECHADO_POR_CONSULTA[A23], ROL_DA_23A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B23], ROL_DA_23B);
  assertEquals(ROL_FECHADO_POR_CONSULTA[A24], ROL_DA_24A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B24], ROL_DA_24B);
  assertEquals(ROL_FECHADO_POR_CONSULTA[A25], ROL_DA_25A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B25], ROL_DA_25B);
  assertEquals(ROL_FECHADO_POR_CONSULTA[A26], ROL_DA_26A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B26], ROL_DA_26B);
  assertEquals(ROL_FECHADO_POR_CONSULTA[A27], ROL_DA_27A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B27], ROL_DA_27B);
  assert(
    CONSULTAS_DE_ROL_FECHADO.has(A10) && CONSULTAS_DE_ROL_FECHADO.has(B10),
  );
  assert(
    CONSULTAS_DE_ROL_FECHADO.has(K8),
    "a 8k do portão é de rol fechado: só vale com rol=ok",
  );
});

for (const [consulta, rol, projeto, ref] of [
  [PROVA_9A, ROL_DA_9A, "ikcous-publicada", CAF],
  [PROVA, ROL_DA_8E, "savy", SAVY],
  [K8, ROL_DA_8K, "savy", SAVY],
  [A10, ROL_DA_10A, "savy", SAVY],
  [B10, ROL_DA_10B, "savy", SAVY],
  [A15, ROL_DA_15A, "savy", SAVY],
  [B15, ROL_DA_15B, "savy", SAVY],
  [A16, ROL_DA_16A, "savy", SAVY],
  [B16, ROL_DA_16B, "savy", SAVY],
  [A17, ROL_DA_17A, "ikcous-publicada", CAF],
  [B17, ROL_DA_17B, "savy", SAVY],
  [A19, ROL_DA_19A, "ikcous-publicada", CAF],
  [B19, ROL_DA_19B, "savy", SAVY],
  [A20, ROL_DA_20A, "ikcous-publicada", CAF],
  [B20, ROL_DA_20B, "savy", SAVY],
  [A21, ROL_DA_21A, "ikcous-publicada", CAF],
  [B21, ROL_DA_21B, "savy", SAVY],
  [A22, ROL_DA_22A, "ikcous-publicada", CAF],
  [B22, ROL_DA_22B, "savy", SAVY],
  [A23, ROL_DA_23A, "ikcous-publicada", CAF],
  [B23, ROL_DA_23B, "savy", SAVY],
  [A24, ROL_DA_24A, "ikcous-publicada", CAF],
  [B24, ROL_DA_24B, "savy", SAVY],
  [A25, ROL_DA_25A, "ikcous-publicada", CAF],
  [B25, ROL_DA_25B, "savy", SAVY],
  [A26, ROL_DA_26A, "ikcous-publicada", CAF],
  [B26, ROL_DA_26B, "savy", SAVY],
  [A27, ROL_DA_27A, "ikcous-publicada", CAF],
  [B27, ROL_DA_27B, "savy", SAVY],
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
      linhas: linhasOk(rol).map((l, i) =>
        i === rol.length - 1 ? { ...l, ok: false } : l,
      ),
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

// ===========================================================================
// O LOTE 20261203000000 (cupons desligados não dão desconto, issue #645) do
// canais-de-backend.json REAL — como o portão o enxerga nas duas lojas assinantes.
// Lote de UMA migration, de apply normal (sem backfillLedger, sem nuncaAplicar).
// Os dublês são os de sempre; o lote vem do ARQUIVO, não de uma cópia.
// ===========================================================================
const V203 = "20261203000000";
const ARQ203 = "20261203000000_cupons_desligados_nao_dao_desconto.sql";
const LOTE_REAL_203 = lerCanais().provasDeObjetos.find(
  (p: any) => p.consulta === A10,
);
const LOJAS_203: Array<[string, string]> = [
  [CAF, "ikcous-publicada"],
  [SAVY, "savy"],
];
type Estado203 = {
  quando?: string;
  okFalse?: number;
  rol?: string | null;
} | null;

/** Runs e logs de 10a/10b para as DUAS lojas (a mesma situação em cada uma). */
function evidenciasDoLote203(a: Estado203, b: Estado203) {
  const runs: any[] = [];
  const logs: Record<number, string> = {};
  let id = 100;
  for (const [ref, projeto] of LOJAS_203) {
    for (const [consulta, s, linhas] of [
      [A10, a, 21],
      [B10, b, 6],
    ] as Array<[string, Estado203, number]>) {
      if (!s) continue;
      id += 1;
      runs.push(
        runConferir(id, consulta, projeto, s.quando ?? "2026-10-06T19:00:00Z"),
      );
      logs[id] = logConsulta(
        consulta,
        ref,
        OUTRO,
        s.okFalse ?? 0,
        linhas,
        s.rol,
      );
    }
  }
  return { runs, logs };
}
function depsLote203(
  ledgerTem203: boolean,
  a: Estado203 = null,
  b: Estado203 = null,
) {
  const { runs, logs } = evidenciasDoLote203(a, b);
  const ledger = ledgerTem203 ? ["20261190000000", V203] : ["20261190000000"];
  const x = deps({
    ledger: { [CAF]: ledger, [SAVY]: ledger },
    runsConferir: runs,
    logs,
    // as duas lojas servem o BASE: a 20261203000000 é NOVA para elas
    sondas: [
      sonda("ickous-marketplace.vercel.app", CAF, "IKCOUS - imports", BASE),
      sonda("savycollection.vercel.app", SAVY, "Savy", BASE),
      sonda("almeidastore.vercel.app", TESTE, "Almeida Store", BASE),
      {
        dominio: "manut.vercel.app",
        ficha: { status: 503, caderneta: "miss", refs: [] },
      },
    ],
  });
  x.d.listarMigrationsNoSha = async (sha: string) =>
    sha === SHA
      ? ["20261190000000_a.sql", ARQ203, `rollback-manual-${ARQ203}`]
      : ["20261190000000_a.sql"];
  x.d.canais = { ...canais, provasDeObjetos: [LOTE_REAL_203] };
  return x;
}
/** Os comandos `gh` do relatório que são DESTA loja. */
const comandosDaLoja = (relatorio: string, projeto: string) =>
  comandosGh(relatorio).filter((c) => c.includes(`-f "projeto=${projeto}"`));
const NEG203 = { okFalse: 5 };

Deno.test("lote 20261203000000 — o canais-de-backend.json real o declara como lote de UMA migration de apply normal: consulta 10a, ausência 10b, sem backfill, sem nuncaAplicar, nas duas lojas", () => {
  assert(LOTE_REAL_203, "o lote da 10a não está no canais-de-backend.json");
  assertEquals(LOTE_REAL_203.versoes, [V203]);
  assertEquals(LOTE_REAL_203.ausenciaConfirmadaPor, B10);
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assertEquals(LOTE_REAL_203[campo], undefined, campo);
  // a 10a e a 10b são de rol fechado, e os lotes antigos continuam como estavam
  assert(
    CONSULTAS_DE_ROL_FECHADO.has(A10) && CONSULTAS_DE_ROL_FECHADO.has(B10),
  );
  const todos = lerCanais().provasDeObjetos.map((p: any) => p.consulta);
  assertEquals(todos, [
    PROVA,
    PROVA_9A,
    A10,
    A11,
    A12,
    A14,
    A15,
    A16,
    A17,
    A19,
    A20,
    A21,
    A22,
    A23,
    A24,
    A25,
    A26,
    A27,
  ]);
});

Deno.test("lote 20261203000000 — SEM evidência nenhuma: o único comando por loja é a 10a (só leitura); nenhum apply", async () => {
  const { d } = depsLote203(false);
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${A10}"`);
    assertStringIncludes(cmds[0], `-f "expected_sha=${TOPO}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
  assert(!r.relatorio.includes("GRAVAR"), r.relatorio);
});

Deno.test("lote 20261203000000 — 10a NEGATIVA (a migration ainda não está no banco) e SEM a 10b: pede SÓ a 10b; nenhum apply", async () => {
  const { d } = depsLote203(false, NEG203);
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B10}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261203000000 — 10a NEGATIVA + 10b POSITIVA (da mesma janela ou mais nova): o comando é o APPLY do arquivo COMPLETO com o SHA efetivo, e nenhum backfill", async () => {
  const { d } = depsLote203(false, NEG203, { quando: "2026-10-06T19:10:00Z" });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], "aplicar-migrations.yml");
    assertStringIncludes(cmds[0], `-f "migracoes=${ARQ203}"`);
    assertStringIncludes(cmds[0], `-f "expected_sha=${TOPO}"`);
  }
  assert(!r.relatorio.includes("gravar_ledger"), r.relatorio);
  assert(!r.relatorio.includes("confirmar"), r.relatorio);
});

Deno.test("lote 20261203000000 — a 10b MAIS VELHA que a 10a negativa não vale: pede a 10b de novo, nenhum apply", async () => {
  const { d } = depsLote203(
    false,
    { ...NEG203, quando: "2026-10-06T19:30:00Z" },
    { quando: "2026-10-06T19:00:00Z" },
  );
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B10}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261203000000 — 10a NEGATIVA e 10b NEGATIVA (gatilho já existe ou corpo da validate fora do baseline): PARADO, nenhum comando de banco", async () => {
  const { d } = depsLote203(false, NEG203, { okFalse: 2 });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("PARAR") &&
          b.motivo.includes(B10),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261203000000 — objetos JÁ no banco (10a POSITIVA) mas o ledger sem a versão: PARADO (o lote não declara backfillLedger), nenhum apply nem gravação", async () => {
  const { d } = depsLote203(false, {});
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  assert(!r.relatorio.includes("GRAVAR"), r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("não declara backfillLedger"),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261203000000 — apply feito (ledger com a versão) e 10a POSITIVA: nada a fazer, a release é liberada", async () => {
  const { d, chamadas } = depsLote203(true, {});
  const r = await executar(d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  assertEquals(chamadas.promover.length, 1);
});

Deno.test("lote 20261203000000 — ledger com a versão mas SEM a 10a: ainda exige a prova de objetos (a migration é nova para a loja); com a 10a NEGATIVA: PARADO", async () => {
  const sem = depsLote203(true);
  const r1 = await executar(sem.d, true);
  assertEquals(r1.codigo, 1, r1.relatorio);
  assertEquals(sem.chamadas.promover.length, 0);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r1.relatorio, projeto);
    assertEquals(cmds.length, 1, r1.relatorio);
    assertStringIncludes(cmds[0], `-f "consulta=${A10}"`);
  }
  const neg = depsLote203(true, NEG203);
  const r2 = await executar(neg.d, true);
  assertEquals(r2.codigo, 1, r2.relatorio);
  assertEquals(comandosGh(r2.relatorio), [], r2.relatorio);
  assertEquals(neg.chamadas.promover.length, 0);
  assert(
    r2.bloqueios.some((b: any) => b.motivo.includes("PARAR")),
    JSON.stringify(r2.bloqueios),
  );
});

Deno.test("lote 20261203000000 — veredito da 10a sem rol=ok (rol=invalido ou veredito antigo) é SEM evidência: pede a 10a de novo, nunca libera", async () => {
  for (const rol of ["invalido", null]) {
    const { d } = depsLote203(true, { rol });
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, `${rol}: ${r.relatorio}`);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r.relatorio, projeto);
      assertEquals(cmds.length, 1, `${rol}: ${r.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${A10}"`);
    }
  }
});

Deno.test("lote 20261203000000 — SEM o lote no canais-de-backend.json o portão BLOQUEIA a release (era o defeito): migration nova sem prova de objetos declarada, nas duas lojas", async () => {
  const { d, chamadas } = depsLote203(false);
  d.canais = { ...canais, provasDeObjetos: [] };
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover.length, 0);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes(
            `migration nova ${V203} sem prova de objetos declarada`,
          ),
      ),
      JSON.stringify(r.bloqueios),
    );
});

// ===========================================================================
// O LOTE 20261204000000 (a venda do balcão se anula no mesmo dia) do
// canais-de-backend.json REAL — como o portão o enxerga nas duas lojas
// assinantes. Lote de UMA migration, de apply normal (sem backfillLedger, sem
// nuncaAplicar). A consulta do lote é a 11a (14 linhas), a de ausência a 11b (8).
// ===========================================================================
const V204 = "20261204000000";
const ARQ204 = "20261204000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql";
const LOTE_REAL_204 = lerCanais().provasDeObjetos.find(
  (p: any) => p.consulta === A11,
);
function evidenciasDoLote204(a: Estado203, b: Estado203) {
  const runs: any[] = [];
  const logs: Record<number, string> = {};
  let id = 200;
  for (const [ref, projeto] of LOJAS_203) {
    for (const [consulta, st, linhas] of [
      [A11, a, 14],
      [B11, b, 9],
    ] as Array<[string, Estado203, number]>) {
      if (!st) continue;
      id += 1;
      runs.push(
        runConferir(id, consulta, projeto, st.quando ?? "2026-10-06T19:00:00Z"),
      );
      logs[id] = logConsulta(
        consulta,
        ref,
        OUTRO,
        st.okFalse ?? 0,
        linhas,
        st.rol,
      );
    }
  }
  return { runs, logs };
}
function depsLote204(
  ledgerTem204: boolean,
  a: Estado203 = null,
  b: Estado203 = null,
) {
  const { runs, logs } = evidenciasDoLote204(a, b);
  const ledger = ledgerTem204 ? ["20261190000000", V204] : ["20261190000000"];
  const x = deps({
    ledger: { [CAF]: ledger, [SAVY]: ledger },
    runsConferir: runs,
    logs,
    sondas: [
      sonda("ickous-marketplace.vercel.app", CAF, "IKCOUS - imports", BASE),
      sonda("savycollection.vercel.app", SAVY, "Savy", BASE),
      sonda("almeidastore.vercel.app", TESTE, "Almeida Store", BASE),
      {
        dominio: "manut.vercel.app",
        ficha: { status: 503, caderneta: "miss", refs: [] },
      },
    ],
  });
  x.d.listarMigrationsNoSha = async (sha: string) =>
    sha === SHA
      ? ["20261190000000_a.sql", ARQ204, `rollback-manual-${ARQ204}`]
      : ["20261190000000_a.sql"];
  x.d.canais = { ...canais, provasDeObjetos: [LOTE_REAL_204] };
  return x;
}

Deno.test("lote 20261204000000 — o canais-de-backend.json real o declara como lote de UMA migration de apply normal: consulta 11a, ausência 11b, sem backfill, sem nuncaAplicar", () => {
  assert(LOTE_REAL_204, "o lote da 11a não está no canais-de-backend.json");
  assertEquals(LOTE_REAL_204.versoes, [V204]);
  assertEquals(LOTE_REAL_204.ausenciaConfirmadaPor, B11);
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assertEquals(LOTE_REAL_204[campo], undefined, campo);
  assert(
    CONSULTAS_DE_ROL_FECHADO.has(A11) && CONSULTAS_DE_ROL_FECHADO.has(B11),
  );
});

Deno.test("lote 20261204000000 — SEM evidência: o único comando por loja é a 11a (só leitura); nenhum apply", async () => {
  const { d } = depsLote204(false);
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${A11}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261204000000 — 11a NEGATIVA (a migration ainda não está no banco) e SEM a 11b: pede SÓ a 11b; nenhum apply", async () => {
  const { d } = depsLote204(false, NEG203);
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B11}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261204000000 — 11a NEGATIVA + 11b POSITIVA (da mesma janela ou mais nova): o comando é o APPLY do arquivo COMPLETO com o SHA efetivo, e nenhum backfill", async () => {
  const { d } = depsLote204(false, NEG203, { quando: "2026-10-06T19:10:00Z" });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], "aplicar-migrations.yml");
    assertStringIncludes(cmds[0], `-f "migracoes=${ARQ204}"`);
    assertStringIncludes(cmds[0], `-f "expected_sha=${TOPO}"`);
  }
  assert(!r.relatorio.includes("gravar_ledger"), r.relatorio);
});

Deno.test("lote 20261204000000 — a 11b MAIS VELHA que a 11a negativa não vale: pede a 11b de novo, nenhum apply", async () => {
  const { d } = depsLote204(
    false,
    { ...NEG203, quando: "2026-10-06T19:30:00Z" },
    { quando: "2026-10-06T19:00:00Z" },
  );
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B11}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261204000000 — 11a e 11b NEGATIVAS (função já existe com outro corpo ou dependência fora do esperado): PARADO, nenhum comando de banco", async () => {
  const { d } = depsLote204(false, NEG203, { okFalse: 2 });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("PARAR") &&
          b.motivo.includes(B11),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261204000000 — função JÁ no banco (11a POSITIVA) mas o ledger sem a versão: PARADO (sem backfillLedger), nenhum apply nem gravação", async () => {
  const { d } = depsLote204(false, {});
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("não declara backfillLedger"),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261204000000 — apply feito (ledger com a versão) e 11a POSITIVA: nada a fazer, a release é liberada", async () => {
  const { d, chamadas } = depsLote204(true, {});
  const r = await executar(d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  assertEquals(chamadas.promover.length, 1);
});

Deno.test("lote 20261204000000 — veredito da 11a sem rol=ok é SEM evidência: pede a 11a de novo, nunca libera", async () => {
  for (const rol of ["invalido", null]) {
    const { d } = depsLote204(true, { rol });
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, `${rol}: ${r.relatorio}`);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r.relatorio, projeto);
      assertEquals(cmds.length, 1, `${rol}: ${r.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${A11}"`);
    }
  }
});

Deno.test("lote 20261204000000 — SEM o lote no canais-de-backend.json o portão BLOQUEIA a release: migration nova sem prova de objetos declarada, nas duas lojas", async () => {
  const { d, chamadas } = depsLote204(false);
  d.canais = { ...canais, provasDeObjetos: [] };
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover.length, 0);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes(
            `migration nova ${V204} sem prova de objetos declarada`,
          ),
      ),
      JSON.stringify(r.bloqueios),
    );
});

// ===========================================================================
// O LOTE 20261205000000 + 20261206000000 (o cupom preso diz quando a vaga volta;
// a vaga do pedido nunca cobrado volta em 1 h) do canais-de-backend.json REAL —
// como o portão o enxerga nas duas lojas assinantes. Lote de DUAS migrations, de
// apply normal (sem backfillLedger, sem nuncaAplicar). A consulta do lote é a 12a
// (24 linhas), a de ausência a 12b (10).
// ===========================================================================
const V205 = "20261205000000";
const V206 = "20261206000000";
const ARQ205 = "20261205000000_o_cupom_preso_diz_quando_a_vaga_volta.sql";
const ARQ206 =
  "20261206000000_a_vaga_do_cupom_nunca_cobrado_volta_em_uma_hora.sql";
const LOTE_REAL_205 = lerCanais().provasDeObjetos.find(
  (p: any) => p.consulta === A12,
);
function evidenciasDoLote205(a: Estado203, b: Estado203) {
  const runs: any[] = [];
  const logs: Record<number, string> = {};
  let id = 300;
  for (const [ref, projeto] of LOJAS_203) {
    for (const [consulta, st, linhas] of [
      [A12, a, 24],
      [B12, b, 10],
    ] as Array<[string, Estado203, number]>) {
      if (!st) continue;
      id += 1;
      runs.push(
        runConferir(id, consulta, projeto, st.quando ?? "2026-10-06T19:00:00Z"),
      );
      logs[id] = logConsulta(
        consulta,
        ref,
        OUTRO,
        st.okFalse ?? 0,
        linhas,
        st.rol,
      );
    }
  }
  return { runs, logs };
}
/** `ledger` = as versões do lote que o ledger JÁ tem (nenhuma, só a 1205 ou as duas). */
function depsLote205(
  ledger: string[],
  a: Estado203 = null,
  b: Estado203 = null,
) {
  const { runs, logs } = evidenciasDoLote205(a, b);
  const registro = ["20261190000000", ...ledger];
  const x = deps({
    ledger: { [CAF]: registro, [SAVY]: registro },
    runsConferir: runs,
    logs,
    sondas: [
      sonda("ickous-marketplace.vercel.app", CAF, "IKCOUS - imports", BASE),
      sonda("savycollection.vercel.app", SAVY, "Savy", BASE),
      sonda("almeidastore.vercel.app", TESTE, "Almeida Store", BASE),
      {
        dominio: "manut.vercel.app",
        ficha: { status: 503, caderneta: "miss", refs: [] },
      },
    ],
  });
  x.d.listarMigrationsNoSha = async (sha: string) =>
    sha === SHA
      ? [
          "20261190000000_a.sql",
          ARQ205,
          `rollback-manual-${ARQ205}`,
          ARQ206,
          `rollback-manual-${ARQ206}`,
        ]
      : ["20261190000000_a.sql"];
  x.d.canais = { ...canais, provasDeObjetos: [LOTE_REAL_205] };
  return x;
}

Deno.test("lote 20261205+06 — o canais-de-backend.json real o declara como lote de DUAS migrations de apply normal, na ordem: consulta 12a, ausência 12b, sem backfill, sem nuncaAplicar", () => {
  assert(LOTE_REAL_205, "o lote da 12a não está no canais-de-backend.json");
  assertEquals(LOTE_REAL_205.versoes, [V205, V206]);
  assertEquals(LOTE_REAL_205.ausenciaConfirmadaPor, B12);
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assertEquals(LOTE_REAL_205[campo], undefined, campo);
  assert(
    CONSULTAS_DE_ROL_FECHADO.has(A12) && CONSULTAS_DE_ROL_FECHADO.has(B12),
  );
  assertEquals(ROL_FECHADO_POR_CONSULTA[A12], ROL_DA_12A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B12], ROL_DA_12B);
});

Deno.test("lote 20261205+06 — SEM evidência: o único comando por loja é a 12a (só leitura); nenhum apply", async () => {
  const { d } = depsLote205([]);
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${A12}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261205+06 — 12a NEGATIVA (as migrations ainda não estão no banco) e SEM a 12b: pede SÓ a 12b; nenhum apply", async () => {
  const { d } = depsLote205([], NEG203);
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B12}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261205+06 — 12a NEGATIVA + 12b POSITIVA: UM comando de apply com os DOIS arquivos, 20261205 antes de 20261206, o SHA efetivo e nenhum backfill", async () => {
  const { d } = depsLote205([], NEG203, { quando: "2026-10-06T19:10:00Z" });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], "aplicar-migrations.yml");
    assertStringIncludes(
      cmds[0],
      `-f "migracoes=${ARQ205},${ARQ206}"`,
      "a 20261206 exige a 20261205 no banco: as duas vão juntas e nesta ordem",
    );
    assertStringIncludes(cmds[0], `-f "expected_sha=${TOPO}"`);
  }
  assert(!r.relatorio.includes("gravar_ledger"), r.relatorio);
});

Deno.test("lote 20261205+06 — a 12b MAIS VELHA que a 12a negativa não vale: pede a 12b de novo, nenhum apply", async () => {
  const { d } = depsLote205(
    [],
    { ...NEG203, quando: "2026-10-06T19:30:00Z" },
    { quando: "2026-10-06T19:00:00Z" },
  );
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B12}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261205+06 — 12a e 12b NEGATIVAS (funções novas já existem, ou a varredura tem outro corpo): PARADO, nenhum comando de banco", async () => {
  const { d } = depsLote205([], NEG203, { okFalse: 2 });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("PARAR") &&
          b.motivo.includes(B12),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261205+06 — só a 20261205 no ledger (a 20261206 falhou ou não rodou) e as duas consultas NEGATIVAS: PARADO para diagnóstico, nenhum apply", async () => {
  const { d } = depsLote205([V205], NEG203, { okFalse: 2 });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) => b.alvo.includes(ref) && b.motivo.includes("PARAR"),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261205+06 — objetos JÁ no banco (12a POSITIVA) mas o ledger sem as versões: PARADO (sem backfillLedger), nenhum apply nem gravação", async () => {
  const { d } = depsLote205([], {});
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("não declara backfillLedger"),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261205+06 — apply feito (ledger com as duas versões) e 12a POSITIVA: nada a fazer, a release é liberada", async () => {
  const { d, chamadas } = depsLote205([V205, V206], {});
  const r = await executar(d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  assertEquals(chamadas.promover.length, 1);
});

Deno.test("lote 20261205+06 — ledger com as duas versões mas a 12a NEGATIVA (um objeto divergiu): nunca libera", async () => {
  const { d, chamadas } = depsLote205([V205, V206], NEG203);
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover.length, 0);
});

Deno.test("lote 20261205+06 — veredito da 12a sem rol=ok é SEM evidência: pede a 12a de novo, nunca libera", async () => {
  for (const rol of ["invalido", null]) {
    const { d } = depsLote205([V205, V206], { rol });
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, `${rol}: ${r.relatorio}`);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r.relatorio, projeto);
      assertEquals(cmds.length, 1, `${rol}: ${r.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${A12}"`);
    }
  }
});

Deno.test("lote 20261205+06 — SEM o lote no canais-de-backend.json o portão BLOQUEIA a release: migrations novas sem prova de objetos declarada, nas duas lojas", async () => {
  const { d, chamadas } = depsLote205([]);
  d.canais = { ...canais, provasDeObjetos: [] };
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover.length, 0);
  for (const [ref] of LOJAS_203)
    for (const v of [V205, V206])
      assert(
        r.bloqueios.some(
          (b: any) =>
            b.alvo.includes(ref) &&
            b.motivo.includes(
              `migration nova ${v} sem prova de objetos declarada`,
            ),
        ),
        `${v}: ${JSON.stringify(r.bloqueios)}`,
      );
});

// ===========================================================================
// O LOTE 20261207000000 (a coluna duplicada de contagem de uso do cupom e apagada)
// do canais-de-backend.json REAL — como o portão o enxerga nas duas lojas assinantes.
// Lote de UMA migration, de apply normal (sem backfillLedger, sem nuncaAplicar). A
// consulta do lote é a 14a (4 linhas); a do ANTES (campo ausenciaConfirmadaPor) é a 14b
// (11 linhas) e confirma o CONTRÁRIO do precedente: a coluna PRESENTE e zerada. O portão
// só exige que ela seja POSITIVA e mais nova que a 14a negativa; não interpreta o que ela
// mede (o mecanismo de decidirLote não muda).
// ===========================================================================
const V207 = "20261207000000";
const ARQ207 = "20261207000000_o_contador_duplicado_do_cupom_morre.sql";
const LOTE_REAL_207 = lerCanais().provasDeObjetos.find(
  (p: any) => p.consulta === A14,
);
function evidenciasDoLote207(a: Estado203, b: Estado203) {
  const runs: any[] = [];
  const logs: Record<number, string> = {};
  let id = 700;
  for (const [ref, projeto] of LOJAS_203) {
    for (const [consulta, st, linhas] of [
      [A14, a, 4],
      [B14, b, 13],
    ] as Array<[string, Estado203, number]>) {
      if (!st) continue;
      id += 1;
      runs.push(
        runConferir(id, consulta, projeto, st.quando ?? "2026-10-06T19:00:00Z"),
      );
      logs[id] = logConsulta(
        consulta,
        ref,
        OUTRO,
        st.okFalse ?? 0,
        linhas,
        st.rol,
      );
    }
  }
  return { runs, logs };
}
/** `ledger` = as versões do lote que o ledger JÁ tem (nenhuma ou a 20261207). */
function depsLote207(
  ledger: string[],
  a: Estado203 = null,
  b: Estado203 = null,
) {
  const { runs, logs } = evidenciasDoLote207(a, b);
  const registro = ["20261190000000", ...ledger];
  const x = deps({
    ledger: { [CAF]: registro, [SAVY]: registro },
    runsConferir: runs,
    logs,
    sondas: [
      sonda("ickous-marketplace.vercel.app", CAF, "IKCOUS - imports", BASE),
      sonda("savycollection.vercel.app", SAVY, "Savy", BASE),
      sonda("almeidastore.vercel.app", TESTE, "Almeida Store", BASE),
      {
        dominio: "manut.vercel.app",
        ficha: { status: 503, caderneta: "miss", refs: [] },
      },
    ],
  });
  x.d.listarMigrationsNoSha = async (sha: string) =>
    sha === SHA
      ? ["20261190000000_a.sql", ARQ207, `rollback-manual-${ARQ207}`]
      : ["20261190000000_a.sql"];
  x.d.canais = { ...canais, provasDeObjetos: [LOTE_REAL_207] };
  return x;
}

Deno.test("lote 20261207 — o canais-de-backend.json real o declara como lote de UMA migration de apply normal: consulta 14a, o ANTES na 14b, sem backfill, sem nuncaAplicar, e as duas de rol fechado", () => {
  assert(LOTE_REAL_207, "o lote da 14a não está no canais-de-backend.json");
  assertEquals(LOTE_REAL_207.versoes, [V207]);
  assertEquals(LOTE_REAL_207.ausenciaConfirmadaPor, B14);
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assertEquals(LOTE_REAL_207[campo], undefined, campo);
  assert(
    CONSULTAS_DE_ROL_FECHADO.has(A14) && CONSULTAS_DE_ROL_FECHADO.has(B14),
  );
  assertEquals(ROL_FECHADO_POR_CONSULTA[A14], ROL_DA_14A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B14], ROL_DA_14B);
  assertEquals(ROL_DA_14A.length, 4);
  assertEquals(ROL_DA_14B.length, 13);
});

Deno.test("lote 20261207 — SEM evidência: o único comando por loja é a 14a (só leitura); nenhum apply", async () => {
  const { d } = depsLote207([]);
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${A14}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261207 — 14a NEGATIVA (a coluna ainda existe) e SEM a 14b: pede SÓ a 14b; nenhum apply", async () => {
  const { d } = depsLote207([], NEG203);
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B14}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261207 — 14a NEGATIVA + 14b POSITIVA (coluna presente e zerada): o comando é o APPLY do arquivo COMPLETO com o SHA efetivo, e nenhum backfill", async () => {
  const { d } = depsLote207([], NEG203, { quando: "2026-10-06T19:10:00Z" });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], "aplicar-migrations.yml");
    assertStringIncludes(cmds[0], `-f "migracoes=${ARQ207}"`);
    assertStringIncludes(cmds[0], `-f "expected_sha=${TOPO}"`);
  }
  assert(!r.relatorio.includes("gravar_ledger"), r.relatorio);
});

Deno.test("lote 20261207 — a 14b MAIS VELHA que a 14a negativa não vale: pede a 14b de novo, nenhum apply", async () => {
  const { d } = depsLote207(
    [],
    { ...NEG203, quando: "2026-10-06T19:30:00Z" },
    { quando: "2026-10-06T19:00:00Z" },
  );
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B14}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261207 — 14a e 14b NEGATIVAS (um valor diferente de 0, um NULL ou um dependente da coluna): PARADO para o dono decidir, nenhum comando de banco", async () => {
  const { d } = depsLote207([], NEG203, { okFalse: 1 });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("PARAR") &&
          b.motivo.includes(B14),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261207 — coluna JÁ apagada (14a POSITIVA) mas o ledger sem a versão: PARADO (sem backfillLedger), nenhum apply nem gravação", async () => {
  const { d } = depsLote207([], {});
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("não declara backfillLedger"),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261207 — apply feito (ledger com a versão) e 14a POSITIVA: nada a fazer, a release é liberada", async () => {
  const { d, chamadas } = depsLote207([V207], {});
  const r = await executar(d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  assertEquals(chamadas.promover.length, 1);
});

Deno.test("lote 20261207 — ledger com a versão mas a 14a NEGATIVA (a coluna voltou ou o contador mudou de forma): nunca libera", async () => {
  const { d, chamadas } = depsLote207([V207], NEG203);
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover.length, 0);
});

Deno.test("lote 20261207 — veredito da 14a sem rol=ok é SEM evidência: pede a 14a de novo, nunca libera", async () => {
  for (const rol of ["invalido", null]) {
    const { d } = depsLote207([V207], { rol });
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, `${rol}: ${r.relatorio}`);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r.relatorio, projeto);
      assertEquals(cmds.length, 1, `${rol}: ${r.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${A14}"`);
    }
  }
});

Deno.test("lote 20261207 — veredito da 14b sem rol=ok NÃO autoriza o apply (nunca vira positivo): pede a 14b de novo", async () => {
  for (const rol of ["invalido", null]) {
    const { d } = depsLote207([], NEG203, {
      rol,
      quando: "2026-10-06T19:10:00Z",
    });
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, `${rol}: ${r.relatorio}`);
    assert(
      !r.relatorio.includes("aplicar-migrations.yml"),
      `${rol}: ${r.relatorio}`,
    );
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r.relatorio, projeto);
      assertEquals(cmds.length, 1, `${rol}: ${r.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${B14}"`);
    }
  }
});

Deno.test("lote 20261207 — SEM o lote no canais-de-backend.json o portão BLOQUEIA a release: migration nova sem prova de objetos declarada, nas duas lojas", async () => {
  const { d, chamadas } = depsLote207([]);
  d.canais = { ...canais, provasDeObjetos: [] };
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover.length, 0);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes(
            `migration nova ${V207} sem prova de objetos declarada`,
          ),
      ),
      JSON.stringify(r.bloqueios),
    );
});

// ===========================================================================
// O LOTE 20261208000000 (o checkout mostra os cupons da cliente) do
// canais-de-backend.json REAL — como o portão o enxerga nas duas lojas assinantes.
// Lote de UMA migration, de apply normal (sem backfillLedger, sem nuncaAplicar). A
// consulta do lote é a 15a (37 linhas); a de ausência (campo ausenciaConfirmadaPor) é a
// 15b (15 linhas): nada do que a migration cria existe e o banco está na base que o
// pré-voo exige. O portão só exige que ela seja POSITIVA e mais nova que a 15a negativa;
// não interpreta o que ela mede (o mecanismo de decidirLote não muda).
// ===========================================================================
const V208 = "20261208000000";
const ARQ208 = "20261208000000_o_checkout_mostra_os_cupons_da_cliente.sql";
const LOTE_REAL_208 = lerCanais().provasDeObjetos.find(
  (p: any) => p.consulta === A15,
);
function evidenciasDoLote208(a: Estado203, b: Estado203) {
  const runs: any[] = [];
  const logs: Record<number, string> = {};
  let id = 800;
  for (const [ref, projeto] of LOJAS_203) {
    for (const [consulta, st, linhas] of [
      [A15, a, 37],
      [B15, b, 15],
    ] as Array<[string, Estado203, number]>) {
      if (!st) continue;
      id += 1;
      runs.push(
        runConferir(id, consulta, projeto, st.quando ?? "2026-10-06T19:00:00Z"),
      );
      logs[id] = logConsulta(
        consulta,
        ref,
        OUTRO,
        st.okFalse ?? 0,
        linhas,
        st.rol,
      );
    }
  }
  return { runs, logs };
}
/** `ledger` = as versões do lote que o ledger JÁ tem (nenhuma ou a 20261207). */
function depsLote208(
  ledger: string[],
  a: Estado203 = null,
  b: Estado203 = null,
) {
  const { runs, logs } = evidenciasDoLote208(a, b);
  const registro = ["20261190000000", ...ledger];
  const x = deps({
    ledger: { [CAF]: registro, [SAVY]: registro },
    runsConferir: runs,
    logs,
    sondas: [
      sonda("ickous-marketplace.vercel.app", CAF, "IKCOUS - imports", BASE),
      sonda("savycollection.vercel.app", SAVY, "Savy", BASE),
      sonda("almeidastore.vercel.app", TESTE, "Almeida Store", BASE),
      {
        dominio: "manut.vercel.app",
        ficha: { status: 503, caderneta: "miss", refs: [] },
      },
    ],
  });
  x.d.listarMigrationsNoSha = async (sha: string) =>
    sha === SHA
      ? ["20261190000000_a.sql", ARQ208, `rollback-manual-${ARQ208}`]
      : ["20261190000000_a.sql"];
  x.d.canais = { ...canais, provasDeObjetos: [LOTE_REAL_208] };
  return x;
}

Deno.test("lote 20261208 — o canais-de-backend.json real o declara como lote de UMA migration de apply normal: consulta 15a, a AUSÊNCIA na 15b, sem backfill, sem nuncaAplicar, e as duas de rol fechado", () => {
  assert(LOTE_REAL_208, "o lote da 15a não está no canais-de-backend.json");
  assertEquals(LOTE_REAL_208.versoes, [V208]);
  assertEquals(LOTE_REAL_208.ausenciaConfirmadaPor, B15);
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assertEquals(LOTE_REAL_208[campo], undefined, campo);
  assert(
    CONSULTAS_DE_ROL_FECHADO.has(A15) && CONSULTAS_DE_ROL_FECHADO.has(B15),
  );
  assertEquals(ROL_FECHADO_POR_CONSULTA[A15], ROL_DA_15A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B15], ROL_DA_15B);
  assertEquals(ROL_DA_15A.length, 37);
  assertEquals(ROL_DA_15B.length, 15);
});

Deno.test("lote 20261208 — SEM evidência: o único comando por loja é a 15a (só leitura); nenhum apply", async () => {
  const { d } = depsLote208([]);
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${A15}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261208 — 15a NEGATIVA (a migration ainda não está no banco) e SEM a 15b: pede SÓ a 15b; nenhum apply", async () => {
  const { d } = depsLote208([], NEG203);
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B15}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261208 — 15a NEGATIVA + 15b POSITIVA (nenhuma peça nova existe e a base é a do pré-voo): o comando é o APPLY do arquivo COMPLETO com o SHA efetivo, e nenhum backfill", async () => {
  const { d } = depsLote208([], NEG203, { quando: "2026-10-06T19:10:00Z" });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], "aplicar-migrations.yml");
    assertStringIncludes(cmds[0], `-f "migracoes=${ARQ208}"`);
    assertStringIncludes(cmds[0], `-f "expected_sha=${TOPO}"`);
  }
  assert(!r.relatorio.includes("gravar_ledger"), r.relatorio);
});

Deno.test("lote 20261208 — a 15b MAIS VELHA que a 15a negativa não vale: pede a 15b de novo, nenhum apply", async () => {
  const { d } = depsLote208(
    [],
    { ...NEG203, quando: "2026-10-06T19:30:00Z" },
    { quando: "2026-10-06T19:00:00Z" },
  );
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B15}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261208 — 15a e 15b NEGATIVAS (meia migration, gatilho da 203 ausente, corpo da validação fora da 203 ou peça alheia no caminho): PARADO para o dono decidir, nenhum comando de banco", async () => {
  const { d } = depsLote208([], NEG203, { okFalse: 1 });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("PARAR") &&
          b.motivo.includes(B15),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261208 — objetos JÁ no banco (15a POSITIVA) mas o ledger sem a versão: PARADO (sem backfillLedger), nenhum apply nem gravação", async () => {
  const { d } = depsLote208([], {});
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("não declara backfillLedger"),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261208 — apply feito (ledger com a versão) e 15a POSITIVA: nada a fazer, a release é liberada", async () => {
  const { d, chamadas } = depsLote208([V208], {});
  const r = await executar(d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  assertEquals(chamadas.promover.length, 1);
});

Deno.test("lote 20261208 — ledger com a versão mas a 15a NEGATIVA (uma peça sumiu ou divergiu depois do apply: gatilho, política, corpo da validação): nunca libera", async () => {
  const { d, chamadas } = depsLote208([V208], NEG203);
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover.length, 0);
});

Deno.test("lote 20261208 — veredito da 15a sem rol=ok é SEM evidência: pede a 15a de novo, nunca libera", async () => {
  for (const rol of ["invalido", null]) {
    const { d } = depsLote208([V208], { rol });
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, `${rol}: ${r.relatorio}`);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r.relatorio, projeto);
      assertEquals(cmds.length, 1, `${rol}: ${r.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${A15}"`);
    }
  }
});

Deno.test("lote 20261208 — veredito da 15b sem rol=ok NÃO autoriza o apply (nunca vira positivo): pede a 15b de novo", async () => {
  for (const rol of ["invalido", null]) {
    const { d } = depsLote208([], NEG203, {
      rol,
      quando: "2026-10-06T19:10:00Z",
    });
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, `${rol}: ${r.relatorio}`);
    assert(
      !r.relatorio.includes("aplicar-migrations.yml"),
      `${rol}: ${r.relatorio}`,
    );
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r.relatorio, projeto);
      assertEquals(cmds.length, 1, `${rol}: ${r.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${B15}"`);
    }
  }
});

Deno.test("lote 20261208 — SEM o lote no canais-de-backend.json o portão BLOQUEIA a release: migration nova sem prova de objetos declarada, nas duas lojas", async () => {
  const { d, chamadas } = depsLote208([]);
  d.canais = { ...canais, provasDeObjetos: [] };
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover.length, 0);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes(
            `migration nova ${V208} sem prova de objetos declarada`,
          ),
      ),
      JSON.stringify(r.bloqueios),
    );
});

// ===========================================================================
// O LOTE 20261209000000 + 20261210000000 (o cupom do PIX anulado volta em minutos)
// do canais-de-backend.json REAL — como o portão o enxerga nas duas lojas
// assinantes. Lote de DUAS migrations, de apply normal (sem backfillLedger, sem
// nuncaAplicar). A consulta do lote é a 16a (32 linhas); a de ausência (campo
// ausenciaConfirmadaPor) é a 16b (14 linhas): a foto da cobrança ainda não existe e
// o banco está na base que o pré-voo exige. O portão só exige que a 16b seja POSITIVA
// e mais nova que a 16a negativa; não interpreta o que ela mede.
// ===========================================================================
const V209 = "20261209000000";
const V210 = "20261210000000";
const ARQ209 = "20261209000000_a_foto_da_cobranca_no_cancelamento.sql";
const ARQ210 =
  "20261210000000_a_vaga_do_cupom_do_pix_anulado_volta_em_minutos.sql";
const LOTE_REAL_209 = lerCanais().provasDeObjetos.find(
  (p: any) => p.consulta === A16,
);
function evidenciasDoLote209(a: Estado203, b: Estado203) {
  const runs: any[] = [];
  const logs: Record<number, string> = {};
  let id = 900;
  for (const [ref, projeto] of LOJAS_203) {
    for (const [consulta, st, linhas] of [
      [A16, a, 32],
      [B16, b, 14],
    ] as Array<[string, Estado203, number]>) {
      if (!st) continue;
      id += 1;
      runs.push(
        runConferir(id, consulta, projeto, st.quando ?? "2026-10-06T19:00:00Z"),
      );
      logs[id] = logConsulta(
        consulta,
        ref,
        OUTRO,
        st.okFalse ?? 0,
        linhas,
        st.rol,
      );
    }
  }
  return { runs, logs };
}
/** `ledger` = as versões do lote que o ledger JÁ tem (nenhuma, só a 1209 ou as duas). */
function depsLote209(
  ledger: string[],
  a: Estado203 = null,
  b: Estado203 = null,
) {
  const { runs, logs } = evidenciasDoLote209(a, b);
  const registro = ["20261190000000", ...ledger];
  const x = deps({
    ledger: { [CAF]: registro, [SAVY]: registro },
    runsConferir: runs,
    logs,
    sondas: [
      sonda("ickous-marketplace.vercel.app", CAF, "IKCOUS - imports", BASE),
      sonda("savycollection.vercel.app", SAVY, "Savy", BASE),
      sonda("almeidastore.vercel.app", TESTE, "Almeida Store", BASE),
      {
        dominio: "manut.vercel.app",
        ficha: { status: 503, caderneta: "miss", refs: [] },
      },
    ],
  });
  x.d.listarMigrationsNoSha = async (sha: string) =>
    sha === SHA
      ? [
          "20261190000000_a.sql",
          ARQ209,
          `rollback-manual-${ARQ209}`,
          ARQ210,
          `rollback-manual-${ARQ210}`,
        ]
      : ["20261190000000_a.sql"];
  x.d.canais = { ...canais, provasDeObjetos: [LOTE_REAL_209] };
  return x;
}

Deno.test("lote 20261209+10 — o canais-de-backend.json real o declara como lote de DUAS migrations de apply normal, na ordem: consulta 16a, ausência 16b, sem backfill, sem nuncaAplicar, as duas de rol fechado", () => {
  assert(LOTE_REAL_209, "o lote da 16a não está no canais-de-backend.json");
  assertEquals(LOTE_REAL_209.versoes, [V209, V210]);
  assertEquals(LOTE_REAL_209.ausenciaConfirmadaPor, B16);
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assertEquals(LOTE_REAL_209[campo], undefined, campo);
  assert(
    CONSULTAS_DE_ROL_FECHADO.has(A16) && CONSULTAS_DE_ROL_FECHADO.has(B16),
  );
  assertEquals(ROL_FECHADO_POR_CONSULTA[A16], ROL_DA_16A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B16], ROL_DA_16B);
  assertEquals(ROL_DA_16A.length, 32);
  assertEquals(ROL_DA_16B.length, 14);
  // as versões do lote existem como arquivo, com o rollback ao lado
  for (const v of [V209, V210]) {
    const arq = v === V209 ? ARQ209 : ARQ210;
    assert(
      Deno.statSync(`supabase/migrations/${arq}`).isFile,
      `falta a migration ${arq}`,
    );
    assert(
      Deno.statSync(`supabase/migrations/rollback-manual-${arq}`).isFile,
      `falta o rollback ${arq}`,
    );
  }
});

Deno.test("lote 20261209+10 — o _comentario do lote registra o que o banco NÃO prova: a pré-condição das functions no ar (A3), o teste do webhook, a ordem das lojas e que as duas migrations são aditivas; e o do lote 12 registra que a 12a aceita os dois estados", () => {
  const c = String(LOTE_REAL_209._comentario);
  for (const trecho of [
    "ADITIVAS",
    "medir a versao das FUNCTIONS no ar em CADA loja",
    "test/pix-anulado-webhook-20261009",
    "IKCOUS, depois Savy",
    "a 20261210 exige a foto da 20261209",
    "Almeida, Brand Meliz e Space",
  ])
    assertStringIncludes(c, trecho);
  const c12 = String(LOTE_REAL_205._comentario);
  assertStringIncludes(c12, "DEPOIS DO LOTE 16");
  assertStringIncludes(c12, "TAMBEM o estado que a 20261210000000 deixa");
});

Deno.test("lote 20261209+10 — SEM evidência: o único comando por loja é a 16a (só leitura); nenhum apply", async () => {
  const { d } = depsLote209([]);
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${A16}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261209+10 — 16a NEGATIVA (as migrations ainda não estão no banco) e SEM a 16b: pede SÓ a 16b; nenhum apply", async () => {
  const { d } = depsLote209([], NEG203);
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B16}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261209+10 — 16a NEGATIVA + 16b POSITIVA: UM comando de apply com os DOIS arquivos, 20261209 antes de 20261210, o SHA efetivo e nenhum backfill", async () => {
  const { d } = depsLote209([], NEG203, { quando: "2026-10-06T19:10:00Z" });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], "aplicar-migrations.yml");
    assertStringIncludes(
      cmds[0],
      `-f "migracoes=${ARQ209},${ARQ210}"`,
      "a 20261210 exige a foto da 20261209 no banco: as duas vão juntas e nesta ordem",
    );
    assertStringIncludes(cmds[0], `-f "expected_sha=${TOPO}"`);
  }
  assert(!r.relatorio.includes("gravar_ledger"), r.relatorio);
});

Deno.test("lote 20261209+10 — a 16b MAIS VELHA que a 16a negativa não vale: pede a 16b de novo, nenhum apply", async () => {
  const { d } = depsLote209(
    [],
    { ...NEG203, quando: "2026-10-06T19:30:00Z" },
    { quando: "2026-10-06T19:00:00Z" },
  );
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B16}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261209+10 — 16a e 16b NEGATIVAS (a foto já existe, ou o auxiliar/a varredura têm outro corpo): PARADO, nenhum comando de banco", async () => {
  const { d } = depsLote209([], NEG203, { okFalse: 2 });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("PARAR") &&
          b.motivo.includes(B16),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261209+10 — só a 20261209 no ledger (a 20261210 falhou ou não rodou) e as duas consultas NEGATIVAS: PARADO para diagnóstico, nenhum apply", async () => {
  const { d } = depsLote209([V209], NEG203, { okFalse: 2 });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) => b.alvo.includes(ref) && b.motivo.includes("PARAR"),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261209+10 — só a 20261209 no ledger e a 16a POSITIVA (impossível sem a 20261210, mas o ledger é quem manda): nunca libera, nenhum apply nem gravação", async () => {
  const { d, chamadas } = depsLote209([V209], {});
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover.length, 0);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
});

Deno.test("lote 20261209+10 — objetos JÁ no banco (16a POSITIVA) mas o ledger sem as versões: PARADO (sem backfillLedger), nenhum apply nem gravação", async () => {
  const { d } = depsLote209([], {});
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("não declara backfillLedger"),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261209+10 — apply feito (ledger com as duas versões) e 16a POSITIVA: nada a fazer, a release é liberada", async () => {
  const { d, chamadas } = depsLote209([V209, V210], {});
  const r = await executar(d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  assertEquals(chamadas.promover.length, 1);
});

Deno.test("lote 20261209+10 — ledger com as duas versões mas a 16a NEGATIVA (um objeto sumiu ou divergiu depois do apply): nunca libera", async () => {
  const { d, chamadas } = depsLote209([V209, V210], NEG203);
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover.length, 0);
});

Deno.test("lote 20261209+10 — veredito da 16a sem rol=ok é SEM evidência: pede a 16a de novo, nunca libera", async () => {
  for (const rol of ["invalido", null]) {
    const { d, chamadas } = depsLote209([V209, V210], { rol });
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, `${rol}: ${r.relatorio}`);
    assertEquals(chamadas.promover.length, 0, `${rol}`);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r.relatorio, projeto);
      assertEquals(cmds.length, 1, `${rol}: ${r.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${A16}"`);
    }
  }
});

Deno.test("lote 20261209+10 — veredito da 16b sem rol=ok NÃO autoriza o apply (nunca vira positivo): pede a 16b de novo", async () => {
  for (const rol of ["invalido", null]) {
    const { d } = depsLote209([], NEG203, {
      rol,
      quando: "2026-10-06T19:10:00Z",
    });
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, `${rol}: ${r.relatorio}`);
    assert(
      !r.relatorio.includes("aplicar-migrations.yml"),
      `${rol}: ${r.relatorio}`,
    );
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r.relatorio, projeto);
      assertEquals(cmds.length, 1, `${rol}: ${r.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${B16}"`);
    }
  }
});

Deno.test("lote 20261209+10 — SEM o lote no canais-de-backend.json o portão BLOQUEIA a release: as duas migrations novas sem prova de objetos declarada, nas duas lojas", async () => {
  const { d, chamadas } = depsLote209([]);
  d.canais = { ...canais, provasDeObjetos: [] };
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover.length, 0);
  for (const [ref] of LOJAS_203)
    for (const v of [V209, V210])
      assert(
        r.bloqueios.some(
          (b: any) =>
            b.alvo.includes(ref) &&
            b.motivo.includes(
              `migration nova ${v} sem prova de objetos declarada`,
            ),
        ),
        `${v}: ${JSON.stringify(r.bloqueios)}`,
      );
});

// ===========================================================================
// GUARDA DE COBERTURA (09/10/2026): toda migration da frente nova (versão >=
// 20261192000000, a primeira do lote 92-202) que não é rollback está em
// EXATAMENTE UM lote do canais-de-backend.json REAL ou em
// `migrationsForaDaRelease` do politica.json REAL. Sem isto, uma migration nova
// sem lote só aparece como bloqueio no ensaio da release (publicar-release.mjs:
// "migration nova … sem prova de objetos declarada"), e uma migration em DOIS
// lotes teria duas decisões para a mesma versão.
// ===========================================================================
Deno.test("guarda: toda migration (fora rollback) com versão >= 20261192000000 está em EXATAMENTE um lote do canais-de-backend.json ou em migrationsForaDaRelease", async () => {
  const lotes = lerCanais().provasDeObjetos;
  const politicaReal = JSON.parse(
    await Deno.readTextFile("scripts/frota/politica.json"),
  );
  const fora = (politicaReal.migrationsForaDaRelease ?? []).map(
    (m: any) => m.versao,
  );
  const versoes: string[] = [];
  for await (const e of Deno.readDir("supabase/migrations"))
    if (e.isFile && /^\d{14}_.*\.sql$/.test(e.name))
      versoes.push(e.name.slice(0, 14));
  const novas = versoes.filter((v) => v >= "20261192000000").sort();
  assert(novas.includes("20261192000000"), "a 20261192000000 sumiu da árvore");
  const erradas = novas
    .map((v) => ({
      v,
      n:
        lotes.filter((l: any) => (l.versoes ?? []).includes(v)).length +
        fora.filter((x: string) => x === v).length,
    }))
    .filter((x) => x.n !== 1);
  assertEquals(
    erradas,
    [],
    "cada migration nova tem de estar em exatamente um lote (ou fora da release)",
  );
  // e nenhum lote declara versão que não existe como arquivo
  for (const l of lotes)
    for (const v of l.versoes ?? [])
      assert(versoes.includes(v), `${l.consulta}: versão ${v} sem arquivo`);
});

// ===========================================================================
// O LOTE 20261212000000 + 20261213000000 + 20261214000000 (o estoque do painel
// segue UMA regra) do canais-de-backend.json REAL — como o portão o enxerga nas
// duas lojas assinantes. Lote de TRÊS migrations INDEPENDENTES, de apply normal
// (sem backfillLedger, sem nuncaAplicar): cada uma só troca o CORPO de UMA função
// (painel_inicio, get_admin_products_paged, get_admin_analytics_v2). A consulta do
// lote é a 17a (14 linhas); a de ausência (campo ausenciaConfirmadaPor) é a 17b
// (11 linhas): os três corpos de antes, uma sobrecarga, o EXECUTE e as colunas. O
// portão só exige que a 17b seja POSITIVA e mais nova que a 17a negativa; não
// interpreta o que ela mede. `decidirLote` não muda para este lote.
// ===========================================================================
const V212 = "20261212000000";
const V213 = "20261213000000";
const V214 = "20261214000000";
const ARQ212 =
  "20261212000000_o_inicio_conta_estoque_baixo_pela_regra_da_loja.sql";
const ARQ213 =
  "20261213000000_o_filtro_de_estoque_baixo_do_admin_segue_a_regra.sql";
const ARQ214 =
  "20261214000000_o_lucro_do_estoque_so_conta_produto_com_custo.sql";
const LOTE_REAL_212 = lerCanais().provasDeObjetos.find(
  (p: any) => p.consulta === A17,
);
function evidenciasDoLote212(a: Estado203, b: Estado203) {
  const runs: any[] = [];
  const logs: Record<number, string> = {};
  let id = 1200;
  for (const [ref, projeto] of LOJAS_203) {
    for (const [consulta, st, linhas] of [
      [A17, a, 14],
      [B17, b, 11],
    ] as Array<[string, Estado203, number]>) {
      if (!st) continue;
      id += 1;
      runs.push(
        runConferir(id, consulta, projeto, st.quando ?? "2026-10-06T19:00:00Z"),
      );
      logs[id] = logConsulta(
        consulta,
        ref,
        OUTRO,
        st.okFalse ?? 0,
        linhas,
        st.rol,
      );
    }
  }
  return { runs, logs };
}
/** `ledger` = as versões do lote que o ledger JÁ tem (nenhuma, parte ou as três). */
function depsLote212(
  ledger: string[],
  a: Estado203 = null,
  b: Estado203 = null,
) {
  const { runs, logs } = evidenciasDoLote212(a, b);
  const registro = ["20261190000000", ...ledger];
  const x = deps({
    ledger: { [CAF]: registro, [SAVY]: registro },
    runsConferir: runs,
    logs,
    // as duas lojas servem o BASE: as três migrations são NOVAS para elas
    sondas: [
      sonda("ickous-marketplace.vercel.app", CAF, "IKCOUS - imports", BASE),
      sonda("savycollection.vercel.app", SAVY, "Savy", BASE),
      sonda("almeidastore.vercel.app", TESTE, "Almeida Store", BASE),
      {
        dominio: "manut.vercel.app",
        ficha: { status: 503, caderneta: "miss", refs: [] },
      },
    ],
  });
  x.d.listarMigrationsNoSha = async (sha: string) =>
    sha === SHA
      ? [
          "20261190000000_a.sql",
          ARQ212,
          `rollback-manual-${ARQ212}`,
          ARQ213,
          `rollback-manual-${ARQ213}`,
          ARQ214,
          `rollback-manual-${ARQ214}`,
        ]
      : ["20261190000000_a.sql"];
  x.d.canais = { ...canais, provasDeObjetos: [LOTE_REAL_212] };
  return x;
}

Deno.test("lote 20261212+13+14 — o canais-de-backend.json real o declara como lote de TRÊS migrations de apply normal, na ordem: consulta 17a, ausência 17b, sem nenhum campo a mais, as duas de rol fechado (14 e 11)", () => {
  assert(LOTE_REAL_212, "o lote da 17a não está no canais-de-backend.json");
  assertEquals(LOTE_REAL_212.versoes, [V212, V213, V214]);
  assertEquals(LOTE_REAL_212.ausenciaConfirmadaPor, B17);
  assertEquals(Object.keys(LOTE_REAL_212).sort(), [
    "_comentario",
    "ausenciaConfirmadaPor",
    "consulta",
    "versoes",
  ]);
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assertEquals(LOTE_REAL_212[campo], undefined, campo);
  assert(
    CONSULTAS_DE_ROL_FECHADO.has(A17) && CONSULTAS_DE_ROL_FECHADO.has(B17),
  );
  assertEquals(ROL_FECHADO_POR_CONSULTA[A17], ROL_DA_17A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B17], ROL_DA_17B);
  assertEquals(ROL_DA_17A.length, 14);
  assertEquals(ROL_DA_17B.length, 11);
  // o lote vem DEPOIS do lote 16 no arquivo
  const consultas = lerCanais().provasDeObjetos.map((p: any) => p.consulta);
  assertEquals(consultas.indexOf(A17), consultas.indexOf(A16) + 1);
  // as versões do lote existem como arquivo, com o rollback ao lado
  for (const arq of [ARQ212, ARQ213, ARQ214]) {
    assert(
      Deno.statSync(`supabase/migrations/${arq}`).isFile,
      `falta a migration ${arq}`,
    );
    assert(
      Deno.statSync(`supabase/migrations/rollback-manual-${arq}`).isFile,
      `falta o rollback ${arq}`,
    );
  }
});

Deno.test("lote 20261212+13+14 — o _comentario do lote registra o que o portão não mede: três migrations independentes, só corpo, o caminho 17a -> 17b -> apply, o estado parcial, a 8e, a ordem das lojas e do front e os rollbacks", () => {
  const c = String(LOTE_REAL_212._comentario);
  assert(/^[\x20-\x7e]*$/.test(c), "o _comentario é ASCII, como os outros");
  for (const trecho of [
    "TRES migrations INDEPENDENTES",
    "sem backfillLedger e sem nuncaAplicar",
    "so troca o CORPO de UMA funcao",
    "IKCOUS e Savy",
    "Almeida, Brand Meliz e Space",
    "na ordem 12, 13, 14 (independentes)",
    "ESTADO PARCIAL",
    "rollback-manual",
    "aplicar-migrations.yml",
    "17a POSITIVA",
    "ROL FECHADO (14 e 11",
    "a 8e JA aceita",
    "backfill 92-202",
    "IKCOUS, depois Savy",
    "AdminProductsView",
    "20261199000000",
    "17b POSITIVA e a 17a NEGATIVA",
  ])
    assertStringIncludes(c, trecho);
});

Deno.test("lote 20261212+13+14 — SEM evidência: o único comando por loja é a 17a (só leitura); nenhum apply", async () => {
  const { d } = depsLote212([]);
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${A17}"`);
    assertStringIncludes(cmds[0], `-f "expected_sha=${TOPO}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
  assert(!r.relatorio.includes("GRAVAR"), r.relatorio);
});

Deno.test("lote 20261212+13+14 — 17a NEGATIVA (o lote ainda não está no banco) e SEM a 17b: pede SÓ a 17b; nenhum apply", async () => {
  const { d } = depsLote212([], NEG203);
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B17}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261212+13+14 — 17a NEGATIVA + 17b POSITIVA: UM comando de apply com os TRÊS arquivos na ordem 12, 13, 14, o SHA efetivo e nenhum backfill", async () => {
  const { d } = depsLote212([], NEG203, { quando: "2026-10-06T19:10:00Z" });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], "aplicar-migrations.yml");
    assertStringIncludes(
      cmds[0],
      `-f "migracoes=${ARQ212},${ARQ213},${ARQ214}"`,
    );
    assertStringIncludes(cmds[0], `-f "expected_sha=${TOPO}"`);
  }
  assert(!r.relatorio.includes("gravar_ledger"), r.relatorio);
});

Deno.test("lote 20261212+13+14 — a 17b MAIS VELHA que a 17a negativa não vale: pede a 17b de novo, nenhum apply", async () => {
  const { d } = depsLote212(
    [],
    { ...NEG203, quando: "2026-10-06T19:30:00Z" },
    { quando: "2026-10-06T19:00:00Z" },
  );
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B17}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261212+13+14 — 17a e 17b NEGATIVAS (estado parcial: parte do lote já aplicada, ou um corpo, a ACL ou uma coluna fora do esperado): PARADO citando a 17b, nenhum comando de banco", async () => {
  const { d } = depsLote212([], NEG203, { okFalse: 1 });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("PARAR") &&
          b.motivo.includes(B17),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261212+13+14 — só a 20261212 no ledger e as duas consultas NEGATIVAS: PARADO para diagnóstico, nenhum apply", async () => {
  const { d } = depsLote212([V212], NEG203, { okFalse: 1 });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) => b.alvo.includes(ref) && b.motivo.includes("PARAR"),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261212+13+14 — só a 20261212 no ledger e a 17a POSITIVA (o ledger é quem manda): nunca libera, nenhum apply nem gravação", async () => {
  const { d, chamadas } = depsLote212([V212], {});
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover.length, 0);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
});

Deno.test("lote 20261212+13+14 — ledger com 20261212 e 20261213, 17a NEGATIVA e 17b POSITIVA: PARADO por contradição (a 17b diz AUSENTE e o ledger diz parte), nenhum apply", async () => {
  const { d, chamadas } = depsLote212([V212, V213], NEG203, {
    quando: "2026-10-06T19:10:00Z",
  });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover.length, 0);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("PARAR") &&
          b.motivo.includes("contradição") &&
          b.motivo.includes(V214),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261212+13+14 — objetos JÁ no banco (17a POSITIVA) mas o ledger sem as versões: PARADO (sem backfillLedger), nenhum apply nem gravação", async () => {
  const { d } = depsLote212([], {});
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("não declara backfillLedger"),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261212+13+14 — apply feito (ledger com as três versões) e 17a POSITIVA: nada a fazer, a release é liberada", async () => {
  const { d, chamadas } = depsLote212([V212, V213, V214], {});
  const r = await executar(d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  assertEquals(chamadas.promover.length, 1);
});

Deno.test("lote 20261212+13+14 — ledger com as três versões mas a 17a NEGATIVA (um corpo divergiu depois do apply): nunca libera", async () => {
  const { d, chamadas } = depsLote212([V212, V213, V214], NEG203);
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover.length, 0);
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261212+13+14 — veredito da 17a ou da 17b sem rol=ok é SEM evidência: pede a mesma consulta de novo, nunca libera nem aplica", async () => {
  for (const rol of ["invalido", null]) {
    const a = depsLote212([V212, V213, V214], { rol });
    const ra = await executar(a.d, true);
    assertEquals(ra.codigo, 1, `${rol}: ${ra.relatorio}`);
    assertEquals(a.chamadas.promover.length, 0, `${rol}`);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(ra.relatorio, projeto);
      assertEquals(cmds.length, 1, `${rol}: ${ra.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${A17}"`);
    }
    const b = depsLote212([], NEG203, { rol, quando: "2026-10-06T19:10:00Z" });
    const rb = await executar(b.d, true);
    assertEquals(rb.codigo, 1, `${rol}: ${rb.relatorio}`);
    assert(
      !rb.relatorio.includes("aplicar-migrations.yml"),
      `${rol}: ${rb.relatorio}`,
    );
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(rb.relatorio, projeto);
      assertEquals(cmds.length, 1, `${rol}: ${rb.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${B17}"`);
    }
  }
});

Deno.test("lote 20261212+13+14 — SEM o lote no canais-de-backend.json o portão BLOQUEIA a release: as três migrations novas sem prova de objetos declarada, nas duas lojas", async () => {
  const { d, chamadas } = depsLote212([]);
  d.canais = { ...canais, provasDeObjetos: [] };
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover.length, 0);
  for (const [ref] of LOJAS_203)
    for (const v of [V212, V213, V214])
      assert(
        r.bloqueios.some(
          (b: any) =>
            b.alvo.includes(ref) &&
            b.motivo.includes(
              `migration nova ${v} sem prova de objetos declarada`,
            ),
        ),
        `${v}: ${JSON.stringify(r.bloqueios)}`,
      );
});

// ===========================================================================
// O LOTE 20261215000000 (a política de devolução não mostra quem a editou, achado
// L) do canais-de-backend.json REAL — como o portão o enxerga nas duas lojas
// assinantes. Lote de UMA migration, de apply normal (sem backfillLedger, sem
// nuncaAplicar). A consulta do lote é a 19a (9 linhas), a de ausência a 19b (9).
// ===========================================================================
const V215 = "20261215000000";
const ARQ215 =
  "20261215000000_a_politica_de_devolucao_nao_mostra_quem_a_editou.sql";
const LOTE_REAL_215 = lerCanais().provasDeObjetos.find(
  (p: any) => p.consulta === A19,
);
function evidenciasDoLote215(a: Estado203, b: Estado203) {
  const runs: any[] = [];
  const logs: Record<number, string> = {};
  let id = 1500;
  for (const [ref, projeto] of LOJAS_203) {
    for (const [consulta, st, linhas] of [
      [A19, a, 9],
      [B19, b, 9],
    ] as Array<[string, Estado203, number]>) {
      if (!st) continue;
      id += 1;
      runs.push(
        runConferir(id, consulta, projeto, st.quando ?? "2026-10-06T19:00:00Z"),
      );
      logs[id] = logConsulta(
        consulta,
        ref,
        OUTRO,
        st.okFalse ?? 0,
        linhas,
        st.rol,
      );
    }
  }
  return { runs, logs };
}
function depsLote215(
  ledgerTem215: boolean,
  a: Estado203 = null,
  b: Estado203 = null,
) {
  const { runs, logs } = evidenciasDoLote215(a, b);
  const ledger = ledgerTem215 ? ["20261190000000", V215] : ["20261190000000"];
  const x = deps({
    ledger: { [CAF]: ledger, [SAVY]: ledger },
    runsConferir: runs,
    logs,
    // as duas lojas servem o BASE: a 20261215000000 é NOVA para elas
    sondas: [
      sonda("ickous-marketplace.vercel.app", CAF, "IKCOUS - imports", BASE),
      sonda("savycollection.vercel.app", SAVY, "Savy", BASE),
      sonda("almeidastore.vercel.app", TESTE, "Almeida Store", BASE),
      {
        dominio: "manut.vercel.app",
        ficha: { status: 503, caderneta: "miss", refs: [] },
      },
    ],
  });
  x.d.listarMigrationsNoSha = async (sha: string) =>
    sha === SHA
      ? ["20261190000000_a.sql", ARQ215, `rollback-manual-${ARQ215}`]
      : ["20261190000000_a.sql"];
  x.d.canais = { ...canais, provasDeObjetos: [LOTE_REAL_215] };
  return x;
}

Deno.test("lote 20261215000000 — o canais-de-backend.json real o declara como lote de UMA migration de apply normal: consulta 19a, ausência 19b, sem backfill, sem nuncaAplicar, nas duas lojas", async () => {
  assert(LOTE_REAL_215, "o lote da 19a não está no canais-de-backend.json");
  assertEquals(LOTE_REAL_215.versoes, [V215]);
  assertEquals(LOTE_REAL_215.ausenciaConfirmadaPor, B19);
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assertEquals(LOTE_REAL_215[campo], undefined, campo);
  assert(
    CONSULTAS_DE_ROL_FECHADO.has(A19) && CONSULTAS_DE_ROL_FECHADO.has(B19),
  );
  assertEquals(ROL_FECHADO_POR_CONSULTA[A19], ROL_DA_19A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B19], ROL_DA_19B);
  assertEquals(ROL_DA_19A.length, 9);
  assertEquals(ROL_DA_19B.length, 9);
  // a migration e o rollback existem como arquivo, e as duas consultas estão no menu do workflow
  const migracoes = new Set<string>();
  for await (const e of Deno.readDir("supabase/migrations"))
    if (e.isFile) migracoes.add(e.name);
  assert(migracoes.has(ARQ215), ARQ215);
  assert(migracoes.has(`rollback-manual-${ARQ215}`));
  const workflow = await Deno.readTextFile(
    ".github/workflows/conferir-banco-da-loja.yml",
  );
  assertStringIncludes(workflow, `- ${A19}`);
  assertStringIncludes(workflow, `- ${B19}`);
  // o lote vem DEPOIS do lote 17 no arquivo
  const consultas = lerCanais().provasDeObjetos.map((p: any) => p.consulta);
  assertEquals(consultas.indexOf(A19), consultas.indexOf(A17) + 1);
  // o comentário do lote conta o que o dono precisa saber antes de aplicar
  const c = String(LOTE_REAL_215._comentario);
  for (const trecho of [
    "UMA migration",
    "APPLY NORMAL",
    "sem backfillLedger",
    "ROL FECHADO",
    "banco de CADA loja primeiro",
    "front velho",
    "registerType prompt",
    "rollback-manual-20261215000000",
    "item 16 de docs/runbooks/producao-unica-fonte.md",
  ])
    assertStringIncludes(c, trecho);
});

Deno.test("lote 20261215000000 — SEM evidência nenhuma: o único comando por loja é a 19a (só leitura); nenhum apply", async () => {
  const { d } = depsLote215(false);
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${A19}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261215000000 — 19a NEGATIVA (a migration ainda não está no banco) e SEM a 19b: pede SÓ a 19b; nenhum apply", async () => {
  const { d } = depsLote215(false, { okFalse: 6 });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B19}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261215000000 — 19a NEGATIVA + 19b POSITIVA (da mesma janela ou mais nova): o comando é o APPLY do arquivo COMPLETO com o SHA efetivo, e nenhum backfill", async () => {
  const { d } = depsLote215(
    false,
    { okFalse: 6 },
    { quando: "2026-10-06T19:10:00Z" },
  );
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], "aplicar-migrations.yml");
    assertStringIncludes(cmds[0], `-f "migracoes=${ARQ215}"`);
    assertStringIncludes(cmds[0], `-f "expected_sha=${TOPO}"`);
  }
  assert(!r.relatorio.includes("gravar_ledger"), r.relatorio);
});

Deno.test("lote 20261215000000 — a 19b MAIS VELHA que a 19a negativa não vale: pede a 19b de novo, nenhum apply", async () => {
  const { d } = depsLote215(
    false,
    { okFalse: 6, quando: "2026-10-06T19:30:00Z" },
    { quando: "2026-10-06T19:00:00Z" },
  );
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B19}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261215000000 — 19a NEGATIVA e 19b NEGATIVA (a loja não está na base de antes: tabela ausente ou grant diferente): PARADO, nenhum comando de banco", async () => {
  const { d } = depsLote215(false, { okFalse: 6 }, { okFalse: 2 });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("PARAR") &&
          b.motivo.includes(B19),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261215000000 — objetos JÁ no banco (19a POSITIVA) mas o ledger sem a versão: PARADO (o lote não declara backfillLedger), nenhum apply nem gravação", async () => {
  const { d } = depsLote215(false, {});
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  assert(!r.relatorio.includes("GRAVAR"), r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("não declara backfillLedger"),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261215000000 — apply feito (ledger com a versão) e 19a POSITIVA: nada a fazer, a release é liberada", async () => {
  const { d, chamadas } = depsLote215(true, {});
  const r = await executar(d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  assertEquals(chamadas.promover.length, 1);
});

Deno.test("lote 20261215000000 — ledger com a versão mas SEM a 19a: ainda exige a prova de objetos; com a 19a NEGATIVA: PARADO", async () => {
  const sem = depsLote215(true);
  const r1 = await executar(sem.d, true);
  assertEquals(r1.codigo, 1, r1.relatorio);
  assertEquals(sem.chamadas.promover.length, 0);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r1.relatorio, projeto);
    assertEquals(cmds.length, 1, r1.relatorio);
    assertStringIncludes(cmds[0], `-f "consulta=${A19}"`);
  }
  const neg = depsLote215(true, { okFalse: 6 });
  const r2 = await executar(neg.d, true);
  assertEquals(r2.codigo, 1, r2.relatorio);
  assertEquals(comandosGh(r2.relatorio), [], r2.relatorio);
  assertEquals(neg.chamadas.promover.length, 0);
  assert(
    r2.bloqueios.some((b: any) => b.motivo.includes("PARAR")),
    JSON.stringify(r2.bloqueios),
  );
});

Deno.test("lote 20261215000000 — veredito da 19a sem rol=ok (rol=invalido ou veredito antigo) é SEM evidência: pede a 19a de novo, nunca libera", async () => {
  for (const rol of ["invalido", null]) {
    const { d } = depsLote215(true, { rol });
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, `${rol}: ${r.relatorio}`);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r.relatorio, projeto);
      assertEquals(cmds.length, 1, `${rol}: ${r.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${A19}"`);
    }
  }
});

Deno.test("lote 20261215000000 — SEM o lote no canais-de-backend.json o portão BLOQUEIA a release: migration nova sem prova de objetos declarada, nas duas lojas", async () => {
  const { d, chamadas } = depsLote215(false);
  d.canais = { ...canais, provasDeObjetos: [] };
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover.length, 0);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes(
            `migration nova ${V215} sem prova de objetos declarada`,
          ),
      ),
      JSON.stringify(r.bloqueios),
    );
});

// ===========================================================================
// O LOTE 20261216000000 (o cliente apaga a foto de devolução que não usou) do canais-de-backend.json REAL — como o portão o enxerga nas duas lojas
// assinantes. Lote de UMA migration, de apply normal (sem backfillLedger, sem
// nuncaAplicar). A consulta do lote é a 20a (6 linhas), a de ausência a 20b (6).
// ===========================================================================
const V216 = "20261216000000";
const ARQ216 =
  "20261216000000_o_cliente_apaga_a_foto_de_devolucao_que_nao_usou.sql";
const LOTE_REAL_216 = lerCanais().provasDeObjetos.find(
  (p: any) => p.consulta === A20,
);
function evidenciasDoLote216(a: Estado203, b: Estado203) {
  const runs: any[] = [];
  const logs: Record<number, string> = {};
  let id = 1600;
  for (const [ref, projeto] of LOJAS_203) {
    for (const [consulta, st, linhas] of [
      [A20, a, 6],
      [B20, b, 6],
    ] as Array<[string, Estado203, number]>) {
      if (!st) continue;
      id += 1;
      runs.push(
        runConferir(id, consulta, projeto, st.quando ?? "2026-10-06T19:00:00Z"),
      );
      logs[id] = logConsulta(
        consulta,
        ref,
        OUTRO,
        st.okFalse ?? 0,
        linhas,
        st.rol,
      );
    }
  }
  return { runs, logs };
}
function depsLote216(
  ledgerTem216: boolean,
  a: Estado203 = null,
  b: Estado203 = null,
) {
  const { runs, logs } = evidenciasDoLote216(a, b);
  const ledger = ledgerTem216 ? ["20261190000000", V216] : ["20261190000000"];
  const x = deps({
    ledger: { [CAF]: ledger, [SAVY]: ledger },
    runsConferir: runs,
    logs,
    // as duas lojas servem o BASE: a 20261216000000 é NOVA para elas
    sondas: [
      sonda("ickous-marketplace.vercel.app", CAF, "IKCOUS - imports", BASE),
      sonda("savycollection.vercel.app", SAVY, "Savy", BASE),
      sonda("almeidastore.vercel.app", TESTE, "Almeida Store", BASE),
      {
        dominio: "manut.vercel.app",
        ficha: { status: 503, caderneta: "miss", refs: [] },
      },
    ],
  });
  x.d.listarMigrationsNoSha = async (sha: string) =>
    sha === SHA
      ? ["20261190000000_a.sql", ARQ216, `rollback-manual-${ARQ216}`]
      : ["20261190000000_a.sql"];
  x.d.canais = { ...canais, provasDeObjetos: [LOTE_REAL_216] };
  return x;
}

Deno.test("lote 20261216000000 — o canais-de-backend.json real o declara como lote de UMA migration de apply normal: consulta 20a, ausência 20b, sem backfill, sem nuncaAplicar, nas duas lojas", async () => {
  assert(LOTE_REAL_216, "o lote da 20a não está no canais-de-backend.json");
  assertEquals(LOTE_REAL_216.versoes, [V216]);
  assertEquals(LOTE_REAL_216.ausenciaConfirmadaPor, B20);
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assertEquals(LOTE_REAL_216[campo], undefined, campo);
  assert(
    CONSULTAS_DE_ROL_FECHADO.has(A20) && CONSULTAS_DE_ROL_FECHADO.has(B20),
  );
  assertEquals(ROL_FECHADO_POR_CONSULTA[A20], ROL_DA_20A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B20], ROL_DA_20B);
  assertEquals(ROL_DA_20A.length, 6);
  assertEquals(ROL_DA_20B.length, 6);
  // a migration e o rollback existem como arquivo, e as duas consultas estão no menu do workflow
  const migracoes = new Set<string>();
  for await (const e of Deno.readDir("supabase/migrations"))
    if (e.isFile) migracoes.add(e.name);
  assert(migracoes.has(ARQ216), ARQ216);
  assert(migracoes.has(`rollback-manual-${ARQ216}`));
  const workflow = await Deno.readTextFile(
    ".github/workflows/conferir-banco-da-loja.yml",
  );
  assertStringIncludes(workflow, `- ${A20}`);
  assertStringIncludes(workflow, `- ${B20}`);
  // o lote vem DEPOIS do lote 19 no arquivo
  const consultas = lerCanais().provasDeObjetos.map((p: any) => p.consulta);
  assertEquals(consultas.indexOf(A20), consultas.indexOf(A19) + 1);
  // o comentário do lote conta o que o dono precisa saber antes de aplicar
  const c = String(LOTE_REAL_216._comentario);
  for (const trecho of [
    "UMA migration",
    "APPLY NORMAL",
    "sem backfillLedger",
    "ROL FECHADO",
    "banco de CADA loja primeiro",
    "front desta release logo depois",
    "o app ignora",
    "rollback-manual-20261216000000",
    "item 17 de docs/runbooks/producao-unica-fonte.md",
  ])
    assertStringIncludes(c, trecho);
});

Deno.test("lote 20261216000000 — SEM evidência nenhuma: o único comando por loja é a 20a (só leitura); nenhum apply", async () => {
  const { d } = depsLote216(false);
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${A20}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261216000000 — 20a NEGATIVA (a migration ainda não está no banco) e SEM a 20b: pede SÓ a 20b; nenhum apply", async () => {
  const { d } = depsLote216(false, { okFalse: 3 });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B20}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261216000000 — 20a NEGATIVA + 20b POSITIVA (da mesma janela ou mais nova): o comando é o APPLY do arquivo COMPLETO com o SHA efetivo, e nenhum backfill", async () => {
  const { d } = depsLote216(
    false,
    { okFalse: 3 },
    { quando: "2026-10-06T19:10:00Z" },
  );
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], "aplicar-migrations.yml");
    assertStringIncludes(cmds[0], `-f "migracoes=${ARQ216}"`);
    assertStringIncludes(cmds[0], `-f "expected_sha=${TOPO}"`);
  }
  assert(!r.relatorio.includes("gravar_ledger"), r.relatorio);
});

Deno.test("lote 20261216000000 — a 20b MAIS VELHA que a 20a negativa não vale: pede a 20b de novo, nenhum apply", async () => {
  const { d } = depsLote216(
    false,
    { okFalse: 3, quando: "2026-10-06T19:30:00Z" },
    { quando: "2026-10-06T19:00:00Z" },
  );
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B20}"`);
  }
  assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
});

Deno.test("lote 20261216000000 — 20a NEGATIVA e 20b NEGATIVA (a loja não está na base de antes: a política de DELETE do cliente já existe): PARADO, nenhum comando de banco", async () => {
  const { d } = depsLote216(false, { okFalse: 3 }, { okFalse: 3 });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("PARAR") &&
          b.motivo.includes(B20),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261216000000 — objetos JÁ no banco (20a POSITIVA) mas o ledger sem a versão: PARADO (o lote não declara backfillLedger), nenhum apply nem gravação", async () => {
  const { d } = depsLote216(false, {});
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  assert(!r.relatorio.includes("GRAVAR"), r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("não declara backfillLedger"),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261216000000 — apply feito (ledger com a versão) e 20a POSITIVA: nada a fazer, a release é liberada", async () => {
  const { d, chamadas } = depsLote216(true, {});
  const r = await executar(d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  assertEquals(chamadas.promover.length, 1);
});

Deno.test("lote 20261216000000 — ledger com a versão mas SEM a 20a: ainda exige a prova de objetos; com a 20a NEGATIVA: PARADO", async () => {
  const sem = depsLote216(true);
  const r1 = await executar(sem.d, true);
  assertEquals(r1.codigo, 1, r1.relatorio);
  assertEquals(sem.chamadas.promover.length, 0);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r1.relatorio, projeto);
    assertEquals(cmds.length, 1, r1.relatorio);
    assertStringIncludes(cmds[0], `-f "consulta=${A20}"`);
  }
  const neg = depsLote216(true, { okFalse: 3 });
  const r2 = await executar(neg.d, true);
  assertEquals(r2.codigo, 1, r2.relatorio);
  assertEquals(comandosGh(r2.relatorio), [], r2.relatorio);
  assertEquals(neg.chamadas.promover.length, 0);
  assert(
    r2.bloqueios.some((b: any) => b.motivo.includes("PARAR")),
    JSON.stringify(r2.bloqueios),
  );
});

Deno.test("lote 20261216000000 — veredito da 20a sem rol=ok (rol=invalido ou veredito antigo) é SEM evidência: pede a 20a de novo, nunca libera", async () => {
  for (const rol of ["invalido", null]) {
    const { d } = depsLote216(true, { rol });
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, `${rol}: ${r.relatorio}`);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r.relatorio, projeto);
      assertEquals(cmds.length, 1, `${rol}: ${r.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${A20}"`);
    }
  }
});

Deno.test("lote 20261216000000 — SEM o lote no canais-de-backend.json o portão BLOQUEIA a release: migration nova sem prova de objetos declarada, nas duas lojas", async () => {
  const { d, chamadas } = depsLote216(false);
  d.canais = { ...canais, provasDeObjetos: [] };
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover.length, 0);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes(
            `migration nova ${V216} sem prova de objetos declarada`,
          ),
      ),
      JSON.stringify(r.bloqueios),
    );
});

// ===========================================================================
// O LOTE 20261217000000 (o e-mail da loja tem teto e o codigo do convidado nao se queima) do
// canais-de-backend.json REAL — como o portão o enxerga nas duas lojas assinantes. Lote de UMA
// migration, de apply normal. A consulta do lote é a 21a (14 linhas), a de ausência a 21b (8).
// ===========================================================================
const V217 = "20261217000000";
const ARQ217 =
  "20261217000000_o_email_da_loja_tem_teto_e_o_codigo_nao_se_queima.sql";
const LOTE_REAL_217 = lerCanais().provasDeObjetos.find(
  (p: any) => p.consulta === A21,
);
function depsLote217(
  ledgerTem217: boolean,
  a: Estado203 = null,
  b: Estado203 = null,
) {
  const runs: any[] = [];
  const logs: Record<number, string> = {};
  let id = 1700;
  for (const [ref, projeto] of LOJAS_203) {
    for (const [consulta, st, linhas] of [
      [A21, a, 14],
      [B21, b, 8],
    ] as Array<[string, Estado203, number]>) {
      if (!st) continue;
      id += 1;
      runs.push(
        runConferir(id, consulta, projeto, st.quando ?? "2026-10-06T19:00:00Z"),
      );
      logs[id] = logConsulta(
        consulta,
        ref,
        OUTRO,
        st.okFalse ?? 0,
        linhas,
        st.rol,
      );
    }
  }
  const ledger = ledgerTem217 ? ["20261190000000", V217] : ["20261190000000"];
  const x = deps({
    ledger: { [CAF]: ledger, [SAVY]: ledger },
    runsConferir: runs,
    logs,
    // as duas lojas servem o BASE: a 20261217000000 é NOVA para elas
    sondas: [
      sonda("ickous-marketplace.vercel.app", CAF, "IKCOUS - imports", BASE),
      sonda("savycollection.vercel.app", SAVY, "Savy", BASE),
      sonda("almeidastore.vercel.app", TESTE, "Almeida Store", BASE),
      {
        dominio: "manut.vercel.app",
        ficha: { status: 503, caderneta: "miss", refs: [] },
      },
    ],
  });
  x.d.listarMigrationsNoSha = async (sha: string) =>
    sha === SHA
      ? ["20261190000000_a.sql", ARQ217, `rollback-manual-${ARQ217}`]
      : ["20261190000000_a.sql"];
  x.d.canais = { ...canais, provasDeObjetos: [LOTE_REAL_217] };
  return x;
}

Deno.test("lote 20261217000000 — o canais-de-backend.json real o declara como lote de UMA migration de apply normal: consulta 21a, ausência 21b, sem backfill, sem nuncaAplicar, nas duas lojas", async () => {
  assert(LOTE_REAL_217, "o lote da 21a não está no canais-de-backend.json");
  assertEquals(LOTE_REAL_217.versoes, [V217]);
  assertEquals(LOTE_REAL_217.ausenciaConfirmadaPor, B21);
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assertEquals(LOTE_REAL_217[campo], undefined, campo);
  assert(
    CONSULTAS_DE_ROL_FECHADO.has(A21) && CONSULTAS_DE_ROL_FECHADO.has(B21),
  );
  assertEquals(ROL_FECHADO_POR_CONSULTA[A21], ROL_DA_21A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B21], ROL_DA_21B);
  assertEquals(ROL_DA_21A.length, 14);
  assertEquals(ROL_DA_21B.length, 8);
  const migracoes = new Set<string>();
  for await (const e of Deno.readDir("supabase/migrations"))
    if (e.isFile) migracoes.add(e.name);
  assert(migracoes.has(ARQ217), ARQ217);
  assert(migracoes.has(`rollback-manual-${ARQ217}`));
  const workflow = await Deno.readTextFile(
    ".github/workflows/conferir-banco-da-loja.yml",
  );
  assertStringIncludes(workflow, `- ${A21}`);
  assertStringIncludes(workflow, `- ${B21}`);
  // o lote vem DEPOIS do lote 20 no arquivo
  const consultas = lerCanais().provasDeObjetos.map((p: any) => p.consulta);
  assertEquals(consultas.indexOf(A21), consultas.indexOf(A20) + 1);
  const c = String(LOTE_REAL_217._comentario);
  for (const trecho of [
    "UMA migration",
    "APPLY NORMAL",
    "sem backfillLedger",
    "ROL FECHADO",
    "ADITIVA",
    "Nenhuma edge function muda",
    "banco de CADA loja primeiro",
    "front desta release logo depois",
    "por isso o banco vem antes",
    "rollback-manual-20261217000000",
    "item 18 de docs/runbooks/producao-unica-fonte.md",
  ])
    assertStringIncludes(c, trecho);
});

Deno.test("lote 20261217000000 — SEM evidência: pede a 21a; 21a NEGATIVA sem a 21b: pede a 21b; nenhum apply", async () => {
  for (const [a, consulta] of [
    [null, A21],
    [{ okFalse: 3 }, B21],
  ] as Array<[Estado203, string]>) {
    const { d } = depsLote217(false, a);
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, r.relatorio);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r.relatorio, projeto);
      assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${consulta}"`);
    }
    assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
  }
});

Deno.test("lote 20261217000000 — 21a NEGATIVA + 21b POSITIVA mais nova: o comando é o APPLY do arquivo com o SHA efetivo, sem backfill; 21b mais VELHA não vale", async () => {
  const ok = depsLote217(
    false,
    { okFalse: 3 },
    { quando: "2026-10-06T19:10:00Z" },
  );
  const r = await executar(ok.d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], "aplicar-migrations.yml");
    assertStringIncludes(cmds[0], `-f "migracoes=${ARQ217}"`);
    assertStringIncludes(cmds[0], `-f "expected_sha=${TOPO}"`);
  }
  assert(!r.relatorio.includes("gravar_ledger"), r.relatorio);
  const velha = depsLote217(
    false,
    { okFalse: 3, quando: "2026-10-06T19:30:00Z" },
    { quando: "2026-10-06T19:00:00Z" },
  );
  const r2 = await executar(velha.d, true);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r2.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r2.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B21}"`);
  }
  assert(!r2.relatorio.includes("aplicar-migrations.yml"), r2.relatorio);
});

Deno.test("lote 20261217000000 — 21a e 21b NEGATIVAS (a loja não está na base de antes): PARADO; 21a POSITIVA com o ledger sem a versão: PARADO", async () => {
  const dupla = depsLote217(false, { okFalse: 3 }, { okFalse: 3 });
  const r = await executar(dupla.d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("PARAR") &&
          b.motivo.includes(B21),
      ),
      JSON.stringify(r.bloqueios),
    );
  const semLedger = depsLote217(false, {});
  const r2 = await executar(semLedger.d, true);
  assertEquals(r2.codigo, 1, r2.relatorio);
  assertEquals(comandosGh(r2.relatorio), [], r2.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r2.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("não declara backfillLedger"),
      ),
      JSON.stringify(r2.bloqueios),
    );
});

Deno.test("lote 20261217000000 — apply feito e 21a POSITIVA: liberada; veredito sem rol=ok nunca libera; sem o lote no canais o portão BLOQUEIA", async () => {
  const feito = depsLote217(true, {});
  const r = await executar(feito.d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(feito.chamadas.promover.length, 1);
  for (const rol of ["invalido", null]) {
    const { d } = depsLote217(true, { rol });
    const r2 = await executar(d, true);
    assertEquals(r2.codigo, 1, `${rol}: ${r2.relatorio}`);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r2.relatorio, projeto);
      assertEquals(cmds.length, 1, `${rol}: ${r2.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${A21}"`);
    }
  }
  const sem = depsLote217(false);
  sem.d.canais = { ...canais, provasDeObjetos: [] };
  const r3 = await executar(sem.d, true);
  assertEquals(r3.codigo, 1, r3.relatorio);
  assertEquals(sem.chamadas.promover.length, 0);
  for (const [ref] of LOJAS_203)
    assert(
      r3.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes(
            `migration nova ${V217} sem prova de objetos declarada`,
          ),
      ),
      JSON.stringify(r3.bloqueios),
    );
});

// ===========================================================================
// O LOTE 20261218000000 + 20261218000100 + 20261219000000 (as portas pequenas do banco) do
// canais-de-backend.json REAL — como o portão o enxerga nas duas lojas assinantes. Lote de TRÊS
// migrations, de apply normal, num único dispatch. A consulta do lote é a 22a (15 linhas), a de
// ausência a 22b (11). A 20261218000100 não tem linha na 22b (na IKCOUS o antes dela já é o depois):
// sozinha no ledger, só a contradição com a 22b positiva a denuncia.
// ===========================================================================
const V2180 = "20261218000000";
const V2181 = "20261218000100";
const V219 = "20261219000000";
const ARQ2180 =
  "20261218000000_a_foto_do_perfil_tem_teto_e_o_painel_fecha_ao_visitante.sql";
const ARQ2181 = "20261218000100_configuracoes_e_codigos_so_do_servidor.sql";
const ARQ219 = "20261219000000_perfil_publico_so_de_quem_escreveu.sql";
const LOTE_REAL_22 = lerCanais().provasDeObjetos.find(
  (p: any) => p.consulta === A22,
);
/** `ledger` = as versões do lote que o ledger JÁ tem (nenhuma, parte ou as três). */
function depsLote22(
  ledger: string[],
  a: Estado203 = null,
  b: Estado203 = null,
) {
  const runs: any[] = [];
  const logs: Record<number, string> = {};
  let id = 2200;
  for (const [ref, projeto] of LOJAS_203) {
    for (const [consulta, st, linhas] of [
      [A22, a, 15],
      [B22, b, 11],
    ] as Array<[string, Estado203, number]>) {
      if (!st) continue;
      id += 1;
      runs.push(
        runConferir(id, consulta, projeto, st.quando ?? "2026-10-06T19:00:00Z"),
      );
      logs[id] = logConsulta(
        consulta,
        ref,
        OUTRO,
        st.okFalse ?? 0,
        linhas,
        st.rol,
      );
    }
  }
  const registro = ["20261190000000", ...ledger];
  const x = deps({
    ledger: { [CAF]: registro, [SAVY]: registro },
    runsConferir: runs,
    logs,
    // as duas lojas servem o BASE: as três migrations são NOVAS para elas
    sondas: [
      sonda("ickous-marketplace.vercel.app", CAF, "IKCOUS - imports", BASE),
      sonda("savycollection.vercel.app", SAVY, "Savy", BASE),
      sonda("almeidastore.vercel.app", TESTE, "Almeida Store", BASE),
      {
        dominio: "manut.vercel.app",
        ficha: { status: 503, caderneta: "miss", refs: [] },
      },
    ],
  });
  x.d.listarMigrationsNoSha = async (sha: string) =>
    sha === SHA
      ? [
          "20261190000000_a.sql",
          ARQ2180,
          `rollback-manual-${ARQ2180}`,
          ARQ2181,
          `rollback-manual-${ARQ2181}`,
          ARQ219,
          `rollback-manual-${ARQ219}`,
        ]
      : ["20261190000000_a.sql"];
  x.d.canais = { ...canais, provasDeObjetos: [LOTE_REAL_22] };
  return x;
}

Deno.test("lote 20261218+181+219 — o canais-de-backend.json real o declara como lote de TRÊS migrations de apply normal, na ordem: consulta 22a, ausência 22b, sem nenhum campo a mais, as duas de rol fechado (15 e 11)", async () => {
  assert(LOTE_REAL_22, "o lote da 22a não está no canais-de-backend.json");
  assertEquals(LOTE_REAL_22.versoes, [V2180, V2181, V219]);
  assertEquals(LOTE_REAL_22.ausenciaConfirmadaPor, B22);
  assertEquals(Object.keys(LOTE_REAL_22).sort(), [
    "_comentario",
    "ausenciaConfirmadaPor",
    "consulta",
    "versoes",
  ]);
  assert(
    CONSULTAS_DE_ROL_FECHADO.has(A22) && CONSULTAS_DE_ROL_FECHADO.has(B22),
  );
  assertEquals(ROL_FECHADO_POR_CONSULTA[A22], ROL_DA_22A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B22], ROL_DA_22B);
  assertEquals(ROL_DA_22A.length, 15);
  assertEquals(ROL_DA_22B.length, 11);
  // o lote vem DEPOIS do lote 21 no arquivo
  const consultas = lerCanais().provasDeObjetos.map((p: any) => p.consulta);
  assertEquals(consultas.indexOf(A22), consultas.indexOf(A21) + 1);
  for (const arq of [ARQ2180, ARQ2181, ARQ219]) {
    assert(
      Deno.statSync(`supabase/migrations/${arq}`).isFile,
      `falta a migration ${arq}`,
    );
    assert(
      Deno.statSync(`supabase/migrations/rollback-manual-${arq}`).isFile,
      `falta o rollback ${arq}`,
    );
  }
  const workflow = await Deno.readTextFile(
    ".github/workflows/conferir-banco-da-loja.yml",
  );
  assertStringIncludes(workflow, `- ${A22}`);
  assertStringIncludes(workflow, `- ${B22}`);
});

Deno.test("lote 20261218+181+219 — o _comentario do lote registra o que o portão não mede: NÃO ADITIVAS, o caminho 22a -> 22b -> apply, o estado parcial, a ordem das lojas, os rollbacks e o runbook", () => {
  const c = String(LOTE_REAL_22._comentario);
  assert(/^[\x20-\x7e]*$/.test(c), "o _comentario é ASCII, como os outros");
  for (const trecho of [
    "Lote de TRES migrations",
    "APPLY NORMAL",
    "sem backfillLedger e sem nuncaAplicar",
    "NAO ADITIVAS",
    "IKCOUS e Savy",
    "Almeida, Brand Meliz e Space",
    "Na IKCOUS a 20261218000100 e no-op",
    "na ordem 18000000, 18000100, 19000000",
    "ESTADO PARCIAL",
    "22b POSITIVA",
    "ROL FECHADO (15 e 11 linhas)",
    "Nenhuma edge function muda",
    "IKCOUS, depois Savy",
    "rollback-manual-20261219000000_perfil_publico_so_de_quem_escreveu.sql",
    "rollback-manual-20261218000100_configuracoes_e_codigos_so_do_servidor.sql",
    "NAO se aplica na IKCOUS",
    "rollback-manual-20261218000000_a_foto_do_perfil_tem_teto_e_o_painel_fecha_ao_visitante.sql",
    "item 19 de docs/runbooks/producao-unica-fonte.md",
  ])
    assertStringIncludes(c, trecho);
});

Deno.test("lote 20261218+181+219 — SEM evidência: pede a 22a; 22a NEGATIVA sem a 22b: pede SÓ a 22b; nenhum apply", async () => {
  for (const [a, consulta] of [
    [null, A22],
    [NEG203, B22],
  ] as Array<[Estado203, string]>) {
    const { d } = depsLote22([], a);
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, r.relatorio);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r.relatorio, projeto);
      assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${consulta}"`);
      assertStringIncludes(cmds[0], `-f "expected_sha=${TOPO}"`);
    }
    assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
  }
});

Deno.test("lote 20261218+181+219 — 22a NEGATIVA + 22b POSITIVA mais nova: UM apply com os TRÊS arquivos na ordem, o SHA efetivo e nenhum backfill; a 22b mais VELHA não vale", async () => {
  const { d } = depsLote22([], NEG203, { quando: "2026-10-06T19:10:00Z" });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], "aplicar-migrations.yml");
    assertStringIncludes(
      cmds[0],
      `-f "migracoes=${ARQ2180},${ARQ2181},${ARQ219}"`,
    );
    assertStringIncludes(cmds[0], `-f "expected_sha=${TOPO}"`);
  }
  assert(!r.relatorio.includes("gravar_ledger"), r.relatorio);
  const velha = depsLote22(
    [],
    { ...NEG203, quando: "2026-10-06T19:30:00Z" },
    { quando: "2026-10-06T19:00:00Z" },
  );
  const r2 = await executar(velha.d, true);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r2.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r2.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B22}"`);
  }
  assert(!r2.relatorio.includes("aplicar-migrations.yml"), r2.relatorio);
});

Deno.test("lote 20261218+181+219 — 22a e 22b NEGATIVAS (a loja não está na base de antes ou parte do lote entrou): PARADO citando a 22b, nenhum comando de banco", async () => {
  for (const ledger of [[], [V2180]]) {
    const { d } = depsLote22(ledger, NEG203, { okFalse: 1 });
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, r.relatorio);
    assertEquals(comandosGh(r.relatorio), [], r.relatorio);
    for (const [ref] of LOJAS_203)
      assert(
        r.bloqueios.some(
          (b: any) => b.alvo.includes(ref) && b.motivo.includes("PARAR"),
        ),
        `${ledger}: ${JSON.stringify(r.bloqueios)}`,
      );
  }
});

Deno.test("lote 20261218+181+219 — SÓ a 20261218000100 no ledger (a 22b não a enxerga), 22a NEGATIVA e 22b POSITIVA: PARADO por contradição, nenhum apply", async () => {
  const { d, chamadas } = depsLote22([V2181], NEG203, {
    quando: "2026-10-06T19:10:00Z",
  });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(chamadas.promover.length, 0);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("PARAR") &&
          b.motivo.includes("contradição"),
      ),
      JSON.stringify(r.bloqueios),
    );
});

Deno.test("lote 20261218+181+219 — objetos JÁ no banco (22a POSITIVA) mas o ledger sem as versões: PARADO (sem backfillLedger); ledger parcial e 22a POSITIVA: nunca libera", async () => {
  const { d } = depsLote22([], {});
  const r = await executar(d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("não declara backfillLedger"),
      ),
      JSON.stringify(r.bloqueios),
    );
  const parcial = depsLote22([V2180, V2181], {});
  const r2 = await executar(parcial.d, true);
  assertEquals(r2.codigo, 1, r2.relatorio);
  assertEquals(parcial.chamadas.promover.length, 0);
  assertEquals(comandosGh(r2.relatorio), [], r2.relatorio);
});

Deno.test("lote 20261218+181+219 — apply feito (as três no ledger) e 22a POSITIVA: liberada; 22a NEGATIVA ou veredito sem rol=ok nunca libera; sem o lote no canais o portão BLOQUEIA", async () => {
  const feito = depsLote22([V2180, V2181, V219], {});
  const r = await executar(feito.d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  assertEquals(feito.chamadas.promover.length, 1);
  const divergiu = depsLote22([V2180, V2181, V219], NEG203);
  const rd = await executar(divergiu.d, true);
  assertEquals(rd.codigo, 1, rd.relatorio);
  assertEquals(divergiu.chamadas.promover.length, 0);
  assert(!rd.relatorio.includes("aplicar-migrations.yml"), rd.relatorio);
  for (const rol of ["invalido", null]) {
    const { d, chamadas } = depsLote22([V2180, V2181, V219], { rol });
    const r2 = await executar(d, true);
    assertEquals(r2.codigo, 1, `${rol}: ${r2.relatorio}`);
    assertEquals(chamadas.promover.length, 0, `${rol}`);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r2.relatorio, projeto);
      assertEquals(cmds.length, 1, `${rol}: ${r2.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${A22}"`);
    }
    const b = depsLote22([], NEG203, { rol, quando: "2026-10-06T19:10:00Z" });
    const rb = await executar(b.d, true);
    assertEquals(rb.codigo, 1, `${rol}: ${rb.relatorio}`);
    assert(
      !rb.relatorio.includes("aplicar-migrations.yml"),
      `${rol}: ${rb.relatorio}`,
    );
  }
  const sem = depsLote22([]);
  sem.d.canais = { ...canais, provasDeObjetos: [] };
  const r3 = await executar(sem.d, true);
  assertEquals(r3.codigo, 1, r3.relatorio);
  assertEquals(sem.chamadas.promover.length, 0);
  for (const [ref] of LOJAS_203)
    for (const v of [V2180, V2181, V219])
      assert(
        r3.bloqueios.some(
          (b: any) =>
            b.alvo.includes(ref) &&
            b.motivo.includes(
              `migration nova ${v} sem prova de objetos declarada`,
            ),
        ),
        `${v}: ${JSON.stringify(r3.bloqueios)}`,
      );
});

// ===========================================================================
// O LOTE 20261220000000 (a consulta antiga de pedido por codigo fecha para o visitante) do
// canais-de-backend.json REAL — como o portão o enxerga nas duas lojas assinantes. Lote de UMA
// migration, de apply normal. A consulta do lote é a 23a (5 linhas), a de ausência a 23b (5).
// ===========================================================================
const V220 = "20261220000000";
const ARQ220 =
  "20261220000000_a_consulta_antiga_de_pedido_por_codigo_fecha_para_o_visitante.sql";
const LOTE_REAL_217_ORDEM = lerCanais().provasDeObjetos.find(
  (p: any) => p.consulta === A21,
);
const LOTE_REAL_220 = lerCanais().provasDeObjetos.find(
  (p: any) => p.consulta === A23,
);
function depsLote220(
  ledgerTem220: boolean,
  a: Estado203 = null,
  b: Estado203 = null,
) {
  const runs: any[] = [];
  const logs: Record<number, string> = {};
  let id = 1700;
  for (const [ref, projeto] of LOJAS_203) {
    for (const [consulta, st, linhas] of [
      [A23, a, 5],
      [B23, b, 5],
    ] as Array<[string, Estado203, number]>) {
      if (!st) continue;
      id += 1;
      runs.push(
        runConferir(id, consulta, projeto, st.quando ?? "2026-10-06T19:00:00Z"),
      );
      logs[id] = logConsulta(
        consulta,
        ref,
        OUTRO,
        st.okFalse ?? 0,
        linhas,
        st.rol,
      );
    }
  }
  const ledger = ledgerTem220 ? ["20261190000000", V220] : ["20261190000000"];
  const x = deps({
    ledger: { [CAF]: ledger, [SAVY]: ledger },
    runsConferir: runs,
    logs,
    // as duas lojas servem o BASE: a 20261220000000 é NOVA para elas
    sondas: [
      sonda("ickous-marketplace.vercel.app", CAF, "IKCOUS - imports", BASE),
      sonda("savycollection.vercel.app", SAVY, "Savy", BASE),
      sonda("almeidastore.vercel.app", TESTE, "Almeida Store", BASE),
      {
        dominio: "manut.vercel.app",
        ficha: { status: 503, caderneta: "miss", refs: [] },
      },
    ],
  });
  x.d.listarMigrationsNoSha = async (sha: string) =>
    sha === SHA
      ? ["20261190000000_a.sql", ARQ220, `rollback-manual-${ARQ220}`]
      : ["20261190000000_a.sql"];
  x.d.canais = { ...canais, provasDeObjetos: [LOTE_REAL_220] };
  return x;
}

Deno.test("lote 20261220000000 — o canais-de-backend.json real o declara como lote de UMA migration de apply normal: consulta 23a, ausência 23b, sem backfill, sem nuncaAplicar, nas duas lojas", async () => {
  assert(LOTE_REAL_220, "o lote da 23a não está no canais-de-backend.json");
  assertEquals(LOTE_REAL_220.versoes, [V220]);
  assertEquals(LOTE_REAL_220.ausenciaConfirmadaPor, B23);
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assertEquals(LOTE_REAL_220[campo], undefined, campo);
  assert(
    CONSULTAS_DE_ROL_FECHADO.has(A23) && CONSULTAS_DE_ROL_FECHADO.has(B23),
  );
  assertEquals(ROL_FECHADO_POR_CONSULTA[A23], ROL_DA_23A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B23], ROL_DA_23B);
  assertEquals(ROL_DA_23A.length, 5);
  assertEquals(ROL_DA_23B.length, 5);
  const migracoes = new Set<string>();
  for await (const e of Deno.readDir("supabase/migrations"))
    if (e.isFile) migracoes.add(e.name);
  assert(migracoes.has(ARQ220), ARQ220);
  assert(migracoes.has(`rollback-manual-${ARQ220}`));
  const workflow = await Deno.readTextFile(
    ".github/workflows/conferir-banco-da-loja.yml",
  );
  assertStringIncludes(workflow, `- ${A23}`);
  assertStringIncludes(workflow, `- ${B23}`);
  // o lote vem DEPOIS do lote 22 no arquivo
  const consultas = lerCanais().provasDeObjetos.map((p: any) => p.consulta);
  assertEquals(consultas.indexOf(A23), consultas.indexOf(A22) + 1);
  const c = String(LOTE_REAL_220._comentario);
  for (const trecho of [
    "UMA migration",
    "APPLY NORMAL",
    "sem backfillLedger",
    "ROL FECHADO",
    "SO muda a ACL de uma funcao",
    "Exige o lote 21 (20261217000000) ja aplicado",
    "Nenhuma edge function muda",
    "Quem quebra: so um app antigo",
    "ORDEM DE DESFAZER",
    "ANTES de qualquer rollback ou reaplicacao da 20261217000000",
    "rollback-manual-20261090500000",
    "TO PUBLIC",
    "rollback-manual-20261220000000",
    "item 20 de docs/runbooks/producao-unica-fonte.md",
  ])
    assertStringIncludes(c, trecho);
  // o texto do lote 21 nao promete uma 21b POSITIVA depois do rollback sem a ressalva da v1 aberta
  const c21 = String(LOTE_REAL_217_ORDEM._comentario);
  assertStringIncludes(c21, "DESDE QUE a v1 esteja aberta");
  assertStringIncludes(c21, "rollback-manual-20261220000000");
  // a runbook registra a ordem de desfazer nos itens 18 e 20
  const runbook = (
    await Deno.readTextFile("docs/runbooks/producao-unica-fonte.md")
  ).replace(/\s+/g, " ");
  assertStringIncludes(
    runbook,
    "o rollback da 20261220 vem SEMPRE ANTES de qualquer rollback ou reaplicacao",
  );
  assertStringIncludes(runbook, "20261220000000_a_consulta_antiga_de_pedido");
});

Deno.test("lote 20261220000000 — SEM evidência: pede a 23a; 23a NEGATIVA sem a 23b: pede a 23b; nenhum apply", async () => {
  for (const [a, consulta] of [
    [null, A23],
    [{ okFalse: 3 }, B23],
  ] as Array<[Estado203, string]>) {
    const { d } = depsLote220(false, a);
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, r.relatorio);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r.relatorio, projeto);
      assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${consulta}"`);
    }
    assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
  }
});

Deno.test("lote 20261220000000 — 23a NEGATIVA + 23b POSITIVA mais nova: o comando é o APPLY do arquivo com o SHA efetivo, sem backfill; 23b mais VELHA não vale", async () => {
  const ok = depsLote220(
    false,
    { okFalse: 3 },
    { quando: "2026-10-06T19:10:00Z" },
  );
  const r = await executar(ok.d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], "aplicar-migrations.yml");
    assertStringIncludes(cmds[0], `-f "migracoes=${ARQ220}"`);
    assertStringIncludes(cmds[0], `-f "expected_sha=${TOPO}"`);
  }
  assert(!r.relatorio.includes("gravar_ledger"), r.relatorio);
  const velha = depsLote220(
    false,
    { okFalse: 3, quando: "2026-10-06T19:30:00Z" },
    { quando: "2026-10-06T19:00:00Z" },
  );
  const r2 = await executar(velha.d, true);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r2.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r2.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B23}"`);
  }
  assert(!r2.relatorio.includes("aplicar-migrations.yml"), r2.relatorio);
});

Deno.test("lote 20261220000000 — 23a e 23b NEGATIVAS (a loja não está na base de antes): PARADO; 23a POSITIVA com o ledger sem a versão: PARADO", async () => {
  const dupla = depsLote220(false, { okFalse: 3 }, { okFalse: 3 });
  const r = await executar(dupla.d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("PARAR") &&
          b.motivo.includes(B23),
      ),
      JSON.stringify(r.bloqueios),
    );
  const semLedger = depsLote220(false, {});
  const r2 = await executar(semLedger.d, true);
  assertEquals(r2.codigo, 1, r2.relatorio);
  assertEquals(comandosGh(r2.relatorio), [], r2.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r2.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("não declara backfillLedger"),
      ),
      JSON.stringify(r2.bloqueios),
    );
});

Deno.test("lote 20261220000000 — apply feito e 23a POSITIVA: liberada; veredito sem rol=ok nunca libera; sem o lote no canais o portão BLOQUEIA", async () => {
  const feito = depsLote220(true, {});
  const r = await executar(feito.d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(feito.chamadas.promover.length, 1);
  for (const rol of ["invalido", null]) {
    const { d } = depsLote220(true, { rol });
    const r2 = await executar(d, true);
    assertEquals(r2.codigo, 1, `${rol}: ${r2.relatorio}`);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r2.relatorio, projeto);
      assertEquals(cmds.length, 1, `${rol}: ${r2.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${A23}"`);
    }
  }
  const sem = depsLote220(false);
  sem.d.canais = { ...canais, provasDeObjetos: [] };
  const r3 = await executar(sem.d, true);
  assertEquals(r3.codigo, 1, r3.relatorio);
  assertEquals(sem.chamadas.promover.length, 0);
  for (const [ref] of LOJAS_203)
    assert(
      r3.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes(
            `migration nova ${V220} sem prova de objetos declarada`,
          ),
      ),
      JSON.stringify(r3.bloqueios),
    );
});

// ===========================================================================
// O LOTE 20261221000000 (a media de avaliacoes e o voto util fecham para o visitante) do
// canais-de-backend.json REAL — como o portão o enxerga nas duas lojas assinantes. Lote de UMA
// migration, de apply normal. A consulta do lote é a 24a (3 linhas), a de ausência a 24b (3).
// ===========================================================================
const V221 = "20261221000000";
const ARQ221 =
  "20261221000000_a_media_de_avaliacoes_e_o_voto_util_fecham_para_o_visitante.sql";
const LOTE_REAL_221 = lerCanais().provasDeObjetos.find(
  (p: any) => p.consulta === A24,
);
function depsLote221(
  ledgerTem221: boolean,
  a: Estado203 = null,
  b: Estado203 = null,
) {
  const runs: any[] = [];
  const logs: Record<number, string> = {};
  let id = 1800;
  for (const [ref, projeto] of LOJAS_203) {
    for (const [consulta, st, linhas] of [
      [A24, a, 3],
      [B24, b, 3],
    ] as Array<[string, Estado203, number]>) {
      if (!st) continue;
      id += 1;
      runs.push(
        runConferir(id, consulta, projeto, st.quando ?? "2026-10-06T19:00:00Z"),
      );
      logs[id] = logConsulta(
        consulta,
        ref,
        OUTRO,
        st.okFalse ?? 0,
        linhas,
        st.rol,
      );
    }
  }
  const ledger = ledgerTem221 ? ["20261190000000", V221] : ["20261190000000"];
  const x = deps({
    ledger: { [CAF]: ledger, [SAVY]: ledger },
    runsConferir: runs,
    logs,
    // as duas lojas servem o BASE: a 20261221000000 é NOVA para elas
    sondas: [
      sonda("ickous-marketplace.vercel.app", CAF, "IKCOUS - imports", BASE),
      sonda("savycollection.vercel.app", SAVY, "Savy", BASE),
      sonda("almeidastore.vercel.app", TESTE, "Almeida Store", BASE),
      {
        dominio: "manut.vercel.app",
        ficha: { status: 503, caderneta: "miss", refs: [] },
      },
    ],
  });
  x.d.listarMigrationsNoSha = async (sha: string) =>
    sha === SHA
      ? ["20261190000000_a.sql", ARQ221, `rollback-manual-${ARQ221}`]
      : ["20261190000000_a.sql"];
  x.d.canais = { ...canais, provasDeObjetos: [LOTE_REAL_221] };
  return x;
}

Deno.test("lote 20261221000000 — o canais-de-backend.json real o declara como lote de UMA migration de apply normal: consulta 24a, ausência 24b, sem backfill, sem nuncaAplicar, nas duas lojas", async () => {
  assert(LOTE_REAL_221, "o lote da 24a não está no canais-de-backend.json");
  assertEquals(LOTE_REAL_221.versoes, [V221]);
  assertEquals(LOTE_REAL_221.ausenciaConfirmadaPor, B24);
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assertEquals(LOTE_REAL_221[campo], undefined, campo);
  assert(
    CONSULTAS_DE_ROL_FECHADO.has(A24) && CONSULTAS_DE_ROL_FECHADO.has(B24),
  );
  assertEquals(ROL_FECHADO_POR_CONSULTA[A24], ROL_DA_24A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B24], ROL_DA_24B);
  assertEquals(ROL_DA_24A.length, 3);
  assertEquals(ROL_DA_24B.length, 3);
  const migracoes = new Set<string>();
  for await (const e of Deno.readDir("supabase/migrations"))
    if (e.isFile) migracoes.add(e.name);
  assert(migracoes.has(ARQ221), ARQ221);
  assert(migracoes.has(`rollback-manual-${ARQ221}`));
  const workflow = await Deno.readTextFile(
    ".github/workflows/conferir-banco-da-loja.yml",
  );
  assertStringIncludes(workflow, `- ${A24}`);
  assertStringIncludes(workflow, `- ${B24}`);
  // o lote vem DEPOIS do lote 23 no arquivo
  const consultas = lerCanais().provasDeObjetos.map((p: any) => p.consulta);
  assertEquals(consultas.indexOf(A24), consultas.indexOf(A23) + 1);
  const c = String(LOTE_REAL_221._comentario);
  for (const trecho of [
    "UMA migration",
    "APPLY NORMAL",
    "sem backfillLedger",
    "ROL FECHADO",
    "SO muda a ACL de duas funcoes",
    "Nenhuma edge function muda",
    "Quem quebra: so quem chamasse as duas SEM login",
    "rollback-manual-20261090500000",
    "TO PUBLIC",
    "rollback-manual-20261221000000",
    "item 21 de docs/runbooks/producao-unica-fonte.md",
  ])
    assertStringIncludes(c, trecho);
  // a runbook registra o lote no item 21 e o aviso do rollback da 20261090500000
  const runbook = (
    await Deno.readTextFile("docs/runbooks/producao-unica-fonte.md")
  ).replace(/\s+/g, " ");
  assertStringIncludes(
    runbook,
    "20261221000000_a_media_de_avaliacoes_e_o_voto_util_fecham_para_o_visitante.sql",
  );
  assertStringIncludes(
    runbook,
    "faz `GRANT EXECUTE ... TO PUBLIC` nas duas funcoes",
  );
});

Deno.test("lote 20261221000000 — SEM evidência: pede a 24a; 24a NEGATIVA sem a 24b: pede a 24b; nenhum apply", async () => {
  for (const [a, consulta] of [
    [null, A24],
    [{ okFalse: 3 }, B24],
  ] as Array<[Estado203, string]>) {
    const { d } = depsLote221(false, a);
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, r.relatorio);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r.relatorio, projeto);
      assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${consulta}"`);
    }
    assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
  }
});

Deno.test("lote 20261221000000 — 24a NEGATIVA + 24b POSITIVA mais nova: o comando é o APPLY do arquivo com o SHA efetivo, sem backfill; 24b mais VELHA não vale", async () => {
  const ok = depsLote221(
    false,
    { okFalse: 3 },
    { quando: "2026-10-06T19:10:00Z" },
  );
  const r = await executar(ok.d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], "aplicar-migrations.yml");
    assertStringIncludes(cmds[0], `-f "migracoes=${ARQ221}"`);
    assertStringIncludes(cmds[0], `-f "expected_sha=${TOPO}"`);
  }
  assert(!r.relatorio.includes("gravar_ledger"), r.relatorio);
  const velha = depsLote221(
    false,
    { okFalse: 3, quando: "2026-10-06T19:30:00Z" },
    { quando: "2026-10-06T19:00:00Z" },
  );
  const r2 = await executar(velha.d, true);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r2.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r2.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B24}"`);
  }
  assert(!r2.relatorio.includes("aplicar-migrations.yml"), r2.relatorio);
});

Deno.test("lote 20261221000000 — 24a e 24b NEGATIVAS (a loja não está na base de antes): PARADO; 24a POSITIVA com o ledger sem a versão: PARADO", async () => {
  const dupla = depsLote221(false, { okFalse: 3 }, { okFalse: 3 });
  const r = await executar(dupla.d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("PARAR") &&
          b.motivo.includes(B24),
      ),
      JSON.stringify(r.bloqueios),
    );
  const semLedger = depsLote221(false, {});
  const r2 = await executar(semLedger.d, true);
  assertEquals(r2.codigo, 1, r2.relatorio);
  assertEquals(comandosGh(r2.relatorio), [], r2.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r2.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("não declara backfillLedger"),
      ),
      JSON.stringify(r2.bloqueios),
    );
});

Deno.test("lote 20261221000000 — apply feito e 24a POSITIVA: liberada; veredito sem rol=ok nunca libera; sem o lote no canais o portão BLOQUEIA", async () => {
  const feito = depsLote221(true, {});
  const r = await executar(feito.d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(feito.chamadas.promover.length, 1);
  for (const rol of ["invalido", null]) {
    const { d } = depsLote221(true, { rol });
    const r2 = await executar(d, true);
    assertEquals(r2.codigo, 1, `${rol}: ${r2.relatorio}`);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r2.relatorio, projeto);
      assertEquals(cmds.length, 1, `${rol}: ${r2.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${A24}"`);
    }
  }
  const sem = depsLote221(false);
  sem.d.canais = { ...canais, provasDeObjetos: [] };
  const r3 = await executar(sem.d, true);
  assertEquals(r3.codigo, 1, r3.relatorio);
  assertEquals(sem.chamadas.promover.length, 0);
  for (const [ref] of LOJAS_203)
    assert(
      r3.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes(
            `migration nova ${V221} sem prova de objetos declarada`,
          ),
      ),
      JSON.stringify(r3.bloqueios),
    );
});

// ===========================================================================
// O LOTE 20261222000000 (a media de avaliacoes so responde ao administrador) do
// canais-de-backend.json REAL — como o portão o enxerga nas duas lojas assinantes. Lote de UMA
// migration, de apply normal. A consulta do lote é a 25a (5 linhas), a de ausência a 25b (4).
// ===========================================================================
const V222 = "20261222000000";
const ARQ222 =
  "20261222000000_a_media_de_avaliacoes_so_responde_ao_administrador.sql";
const LOTE_REAL_222 = lerCanais().provasDeObjetos.find(
  (p: any) => p.consulta === A25,
);
function depsLote222(
  ledgerTem222: boolean,
  a: Estado203 = null,
  b: Estado203 = null,
) {
  const runs: any[] = [];
  const logs: Record<number, string> = {};
  let id = 1800;
  for (const [ref, projeto] of LOJAS_203) {
    for (const [consulta, st, linhas] of [
      [A25, a, 5],
      [B25, b, 4],
    ] as Array<[string, Estado203, number]>) {
      if (!st) continue;
      id += 1;
      runs.push(
        runConferir(id, consulta, projeto, st.quando ?? "2026-10-06T19:00:00Z"),
      );
      logs[id] = logConsulta(
        consulta,
        ref,
        OUTRO,
        st.okFalse ?? 0,
        linhas,
        st.rol,
      );
    }
  }
  const ledger = ledgerTem222 ? ["20261190000000", V222] : ["20261190000000"];
  const x = deps({
    ledger: { [CAF]: ledger, [SAVY]: ledger },
    runsConferir: runs,
    logs,
    // as duas lojas servem o BASE: a 20261222000000 é NOVA para elas
    sondas: [
      sonda("ickous-marketplace.vercel.app", CAF, "IKCOUS - imports", BASE),
      sonda("savycollection.vercel.app", SAVY, "Savy", BASE),
      sonda("almeidastore.vercel.app", TESTE, "Almeida Store", BASE),
      {
        dominio: "manut.vercel.app",
        ficha: { status: 503, caderneta: "miss", refs: [] },
      },
    ],
  });
  x.d.listarMigrationsNoSha = async (sha: string) =>
    sha === SHA
      ? ["20261190000000_a.sql", ARQ222, `rollback-manual-${ARQ222}`]
      : ["20261190000000_a.sql"];
  x.d.canais = { ...canais, provasDeObjetos: [LOTE_REAL_222] };
  return x;
}

Deno.test("lote 20261222000000 — o canais-de-backend.json real o declara como lote de UMA migration de apply normal: consulta 25a, ausência 25b, sem backfill, sem nuncaAplicar, nas duas lojas", async () => {
  assert(LOTE_REAL_222, "o lote da 25a não está no canais-de-backend.json");
  assertEquals(LOTE_REAL_222.versoes, [V222]);
  assertEquals(LOTE_REAL_222.ausenciaConfirmadaPor, B25);
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assertEquals(LOTE_REAL_222[campo], undefined, campo);
  assert(
    CONSULTAS_DE_ROL_FECHADO.has(A25) && CONSULTAS_DE_ROL_FECHADO.has(B25),
  );
  assertEquals(ROL_FECHADO_POR_CONSULTA[A25], ROL_DA_25A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B25], ROL_DA_25B);
  assertEquals(ROL_DA_25A.length, 5);
  assertEquals(ROL_DA_25B.length, 4);
  const migracoes = new Set<string>();
  for await (const e of Deno.readDir("supabase/migrations"))
    if (e.isFile) migracoes.add(e.name);
  assert(migracoes.has(ARQ222), ARQ222);
  assert(migracoes.has(`rollback-manual-${ARQ222}`));
  const workflow = await Deno.readTextFile(
    ".github/workflows/conferir-banco-da-loja.yml",
  );
  assertStringIncludes(workflow, `- ${A25}`);
  assertStringIncludes(workflow, `- ${B25}`);
  // o lote vem DEPOIS do lote 24 no arquivo
  const consultas = lerCanais().provasDeObjetos.map((p: any) => p.consulta);
  assertEquals(
    consultas.indexOf(A25),
    consultas.indexOf("24a-conferir-avaliacoes-fechadas-ao-visitante") + 1,
  );
  const c = String(LOTE_REAL_222._comentario);
  for (const trecho of [
    "UMA migration",
    "APPLY NORMAL",
    "sem backfillLedger",
    "ROL FECHADO",
    "E PERMISSAO, nao so ACL",
    "IF NOT public.is_admin()",
    "NAO muda assinatura, tipo de retorno, SECURITY DEFINER, VOLATILE, search_path nem ACL",
    "o lote 24 TEM DE ESTAR aplicado",
    "NAO mede a ACL",
    "Nenhuma edge function muda",
    "Quem quebra: so uma conta logada que NAO e admin",
    "rollback-manual-20261090500000",
    "TO PUBLIC",
    "rollback-manual-20261222000000",
    "item 22 de docs/runbooks/producao-unica-fonte.md",
  ])
    assertStringIncludes(c, trecho);
  // a runbook registra o lote no item 22 e o aviso do rollback da 20261090500000
  const runbook = (
    await Deno.readTextFile("docs/runbooks/producao-unica-fonte.md")
  ).replace(/\s+/g, " ");
  assertStringIncludes(
    runbook,
    "20261222000000_a_media_de_avaliacoes_so_responde_ao_administrador.sql",
  );
  assertStringIncludes(
    runbook,
    "faz `GRANT EXECUTE ... TO PUBLIC` nesta funcao",
  );
});

Deno.test("lote 20261222000000 — SEM evidência: pede a 25a; 25a NEGATIVA sem a 25b: pede a 25b; nenhum apply", async () => {
  for (const [a, consulta] of [
    [null, A25],
    [{ okFalse: 2 }, B25],
  ] as Array<[Estado203, string]>) {
    const { d } = depsLote222(false, a);
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, r.relatorio);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r.relatorio, projeto);
      assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${consulta}"`);
    }
    assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
  }
});

Deno.test("lote 20261222000000 — 25a NEGATIVA + 25b POSITIVA mais nova: o comando é o APPLY do arquivo com o SHA efetivo, sem backfill; 25b mais VELHA não vale", async () => {
  const ok = depsLote222(
    false,
    { okFalse: 2 },
    { quando: "2026-10-06T19:10:00Z" },
  );
  const r = await executar(ok.d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], "aplicar-migrations.yml");
    assertStringIncludes(cmds[0], `-f "migracoes=${ARQ222}"`);
    assertStringIncludes(cmds[0], `-f "expected_sha=${TOPO}"`);
  }
  assert(!r.relatorio.includes("gravar_ledger"), r.relatorio);
  const velha = depsLote222(
    false,
    { okFalse: 3, quando: "2026-10-06T19:30:00Z" },
    { quando: "2026-10-06T19:00:00Z" },
  );
  const r2 = await executar(velha.d, true);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r2.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r2.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B25}"`);
  }
  assert(!r2.relatorio.includes("aplicar-migrations.yml"), r2.relatorio);
});

Deno.test("lote 20261222000000 — 25a e 25b NEGATIVAS (a loja não está na base de antes): PARADO; 25a POSITIVA com o ledger sem a versão: PARADO", async () => {
  const dupla = depsLote222(false, { okFalse: 2 }, { okFalse: 2 });
  const r = await executar(dupla.d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("PARAR") &&
          b.motivo.includes(B25),
      ),
      JSON.stringify(r.bloqueios),
    );
  const semLedger = depsLote222(false, {});
  const r2 = await executar(semLedger.d, true);
  assertEquals(r2.codigo, 1, r2.relatorio);
  assertEquals(comandosGh(r2.relatorio), [], r2.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r2.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("não declara backfillLedger"),
      ),
      JSON.stringify(r2.bloqueios),
    );
});

Deno.test("lote 20261222000000 — apply feito e 25a POSITIVA: liberada; veredito sem rol=ok nunca libera; sem o lote no canais o portão BLOQUEIA", async () => {
  const feito = depsLote222(true, {});
  const r = await executar(feito.d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(feito.chamadas.promover.length, 1);
  for (const rol of ["invalido", null]) {
    const { d } = depsLote222(true, { rol });
    const r2 = await executar(d, true);
    assertEquals(r2.codigo, 1, `${rol}: ${r2.relatorio}`);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r2.relatorio, projeto);
      assertEquals(cmds.length, 1, `${rol}: ${r2.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${A25}"`);
    }
  }
  const sem = depsLote222(false);
  sem.d.canais = { ...canais, provasDeObjetos: [] };
  const r3 = await executar(sem.d, true);
  assertEquals(r3.codigo, 1, r3.relatorio);
  assertEquals(sem.chamadas.promover.length, 0);
  for (const [ref] of LOJAS_203)
    assert(
      r3.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes(
            `migration nova ${V222} sem prova de objetos declarada`,
          ),
      ),
      JSON.stringify(r3.bloqueios),
    );
});

// ===========================================================================
// O LOTE 20261223000000 (o voto util so vale em avaliacao que o publico ve) do
// canais-de-backend.json REAL — como o portão o enxerga nas duas lojas assinantes. Lote de UMA
// migration, de apply normal. A consulta do lote é a 26a (5 linhas), a de ausência a 26b (4).
// ===========================================================================
const V223 = "20261223000000";
const ARQ223 =
  "20261223000000_o_voto_util_so_em_avaliacao_que_o_publico_ve.sql";
const LOTE_REAL_223 = lerCanais().provasDeObjetos.find(
  (p: any) => p.consulta === A26,
);
function depsLote223(
  ledgerTem223: boolean,
  a: Estado203 = null,
  b: Estado203 = null,
) {
  const runs: any[] = [];
  const logs: Record<number, string> = {};
  let id = 1900;
  for (const [ref, projeto] of LOJAS_203) {
    for (const [consulta, st, linhas] of [
      [A26, a, 5],
      [B26, b, 4],
    ] as Array<[string, Estado203, number]>) {
      if (!st) continue;
      id += 1;
      runs.push(
        runConferir(id, consulta, projeto, st.quando ?? "2026-10-06T19:00:00Z"),
      );
      logs[id] = logConsulta(
        consulta,
        ref,
        OUTRO,
        st.okFalse ?? 0,
        linhas,
        st.rol,
      );
    }
  }
  const ledger = ledgerTem223 ? ["20261190000000", V223] : ["20261190000000"];
  const x = deps({
    ledger: { [CAF]: ledger, [SAVY]: ledger },
    runsConferir: runs,
    logs,
    // as duas lojas servem o BASE: a 20261223000000 é NOVA para elas
    sondas: [
      sonda("ickous-marketplace.vercel.app", CAF, "IKCOUS - imports", BASE),
      sonda("savycollection.vercel.app", SAVY, "Savy", BASE),
      sonda("almeidastore.vercel.app", TESTE, "Almeida Store", BASE),
      {
        dominio: "manut.vercel.app",
        ficha: { status: 503, caderneta: "miss", refs: [] },
      },
    ],
  });
  x.d.listarMigrationsNoSha = async (sha: string) =>
    sha === SHA
      ? ["20261190000000_a.sql", ARQ223, `rollback-manual-${ARQ223}`]
      : ["20261190000000_a.sql"];
  x.d.canais = { ...canais, provasDeObjetos: [LOTE_REAL_223] };
  return x;
}

Deno.test("lote 20261223000000 — o canais-de-backend.json real o declara como lote de UMA migration de apply normal: consulta 26a, ausência 26b, sem backfill, sem nuncaAplicar, nas duas lojas", async () => {
  assert(LOTE_REAL_223, "o lote da 26a não está no canais-de-backend.json");
  assertEquals(LOTE_REAL_223.versoes, [V223]);
  assertEquals(LOTE_REAL_223.ausenciaConfirmadaPor, B26);
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assertEquals(LOTE_REAL_223[campo], undefined, campo);
  assert(
    CONSULTAS_DE_ROL_FECHADO.has(A26) && CONSULTAS_DE_ROL_FECHADO.has(B26),
  );
  assertEquals(ROL_FECHADO_POR_CONSULTA[A26], ROL_DA_26A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B26], ROL_DA_26B);
  assertEquals(ROL_DA_26A.length, 5);
  assertEquals(ROL_DA_26B.length, 4);
  const migracoes = new Set<string>();
  for await (const e of Deno.readDir("supabase/migrations"))
    if (e.isFile) migracoes.add(e.name);
  assert(migracoes.has(ARQ223), ARQ223);
  assert(migracoes.has(`rollback-manual-${ARQ223}`));
  const workflow = await Deno.readTextFile(
    ".github/workflows/conferir-banco-da-loja.yml",
  );
  assertStringIncludes(workflow, `- ${A26}`);
  assertStringIncludes(workflow, `- ${B26}`);
  // o lote vem DEPOIS do lote 25 (e do 24) no arquivo
  const consultas = lerCanais().provasDeObjetos.map((p: any) => p.consulta);
  assertEquals(
    consultas.indexOf(A26),
    consultas.indexOf("25a-conferir-media-de-avaliacoes-so-admin") + 1,
  );
  const c = String(LOTE_REAL_223._comentario);
  for (const trecho of [
    "UMA migration",
    "APPLY NORMAL",
    "sem backfillLedger",
    "ROL FECHADO",
    "E PERMISSAO, nao so ACL",
    "status = 'publicada'",
    "NAO muda assinatura, tipo de retorno, SECURITY DEFINER, VOLATILE, search_path nem ACL",
    "o lote 24 TEM DE ESTAR aplicado",
    "NAO mede a ACL",
    "Nenhuma edge function muda",
    "Quem quebra: so uma conta logada que votasse util",
    "rollback-manual-20261090500000",
    "TO PUBLIC",
    "rollback-manual-20261223000000",
    "item 23 de docs/runbooks/producao-unica-fonte.md",
  ])
    assertStringIncludes(c, trecho);
  // a runbook registra o lote no item 22 e o aviso do rollback da 20261090500000
  const runbook = (
    await Deno.readTextFile("docs/runbooks/producao-unica-fonte.md")
  ).replace(/\s+/g, " ");
  assertStringIncludes(
    runbook,
    "20261223000000_o_voto_util_so_em_avaliacao_que_o_publico_ve.sql",
  );
  assertStringIncludes(
    runbook,
    "faz `GRANT EXECUTE ... TO PUBLIC` nesta funcao",
  );
});

Deno.test("lote 20261223000000 — SEM evidência: pede a 26a; 26a NEGATIVA sem a 26b: pede a 26b; nenhum apply", async () => {
  for (const [a, consulta] of [
    [null, A26],
    [{ okFalse: 2 }, B26],
  ] as Array<[Estado203, string]>) {
    const { d } = depsLote223(false, a);
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, r.relatorio);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r.relatorio, projeto);
      assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${consulta}"`);
    }
    assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
  }
});

Deno.test("lote 20261223000000 — 26a NEGATIVA + 26b POSITIVA mais nova: o comando é o APPLY do arquivo com o SHA efetivo, sem backfill; 26b mais VELHA não vale", async () => {
  const ok = depsLote223(
    false,
    { okFalse: 2 },
    { quando: "2026-10-06T19:10:00Z" },
  );
  const r = await executar(ok.d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], "aplicar-migrations.yml");
    assertStringIncludes(cmds[0], `-f "migracoes=${ARQ223}"`);
    assertStringIncludes(cmds[0], `-f "expected_sha=${TOPO}"`);
  }
  assert(!r.relatorio.includes("gravar_ledger"), r.relatorio);
  const velha = depsLote223(
    false,
    { okFalse: 3, quando: "2026-10-06T19:30:00Z" },
    { quando: "2026-10-06T19:00:00Z" },
  );
  const r2 = await executar(velha.d, true);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r2.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r2.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B26}"`);
  }
  assert(!r2.relatorio.includes("aplicar-migrations.yml"), r2.relatorio);
});

Deno.test("lote 20261223000000 — 26a e 26b NEGATIVAS (a loja não está na base de antes): PARADO; 26a POSITIVA com o ledger sem a versão: PARADO", async () => {
  const dupla = depsLote223(false, { okFalse: 2 }, { okFalse: 2 });
  const r = await executar(dupla.d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("PARAR") &&
          b.motivo.includes(B26),
      ),
      JSON.stringify(r.bloqueios),
    );
  const semLedger = depsLote223(false, {});
  const r2 = await executar(semLedger.d, true);
  assertEquals(r2.codigo, 1, r2.relatorio);
  assertEquals(comandosGh(r2.relatorio), [], r2.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r2.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("não declara backfillLedger"),
      ),
      JSON.stringify(r2.bloqueios),
    );
});

Deno.test("lote 20261223000000 — apply feito e 26a POSITIVA: liberada; veredito sem rol=ok nunca libera; sem o lote no canais o portão BLOQUEIA", async () => {
  const feito = depsLote223(true, {});
  const r = await executar(feito.d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(feito.chamadas.promover.length, 1);
  for (const rol of ["invalido", null]) {
    const { d } = depsLote223(true, { rol });
    const r2 = await executar(d, true);
    assertEquals(r2.codigo, 1, `${rol}: ${r2.relatorio}`);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r2.relatorio, projeto);
      assertEquals(cmds.length, 1, `${rol}: ${r2.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${A26}"`);
    }
  }
  const sem = depsLote223(false);
  sem.d.canais = { ...canais, provasDeObjetos: [] };
  const r3 = await executar(sem.d, true);
  assertEquals(r3.codigo, 1, r3.relatorio);
  assertEquals(sem.chamadas.promover.length, 0);
  for (const [ref] of LOJAS_203)
    assert(
      r3.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes(
            `migration nova ${V223} sem prova de objetos declarada`,
          ),
      ),
      JSON.stringify(r3.bloqueios),
    );
});

// ===========================================================================
// O LOTE 20261224000000 (a avaliacao nasce sem a resposta da loja) do
// canais-de-backend.json REAL — como o portão o enxerga nas duas lojas assinantes. Lote de UMA
// migration, de apply normal. A consulta do lote é a 27a (6 linhas), a de ausência a 27b (6).
// ===========================================================================
const V224 = "20261224000000";
const ARQ224 = "20261224000000_a_avaliacao_nasce_sem_a_resposta_da_loja.sql";
const LOTE_REAL_224 = lerCanais().provasDeObjetos.find(
  (p: any) => p.consulta === A27,
);
function depsLote224(
  ledgerTem224: boolean,
  a: Estado203 = null,
  b: Estado203 = null,
) {
  const runs: any[] = [];
  const logs: Record<number, string> = {};
  let id = 1900;
  for (const [ref, projeto] of LOJAS_203) {
    for (const [consulta, st, linhas] of [
      [A27, a, 6],
      [B27, b, 6],
    ] as Array<[string, Estado203, number]>) {
      if (!st) continue;
      id += 1;
      runs.push(
        runConferir(id, consulta, projeto, st.quando ?? "2026-10-06T19:00:00Z"),
      );
      logs[id] = logConsulta(
        consulta,
        ref,
        OUTRO,
        st.okFalse ?? 0,
        linhas,
        st.rol,
      );
    }
  }
  const ledger = ledgerTem224 ? ["20261190000000", V224] : ["20261190000000"];
  const x = deps({
    ledger: { [CAF]: ledger, [SAVY]: ledger },
    runsConferir: runs,
    logs,
    // as duas lojas servem o BASE: a 20261224000000 é NOVA para elas
    sondas: [
      sonda("ickous-marketplace.vercel.app", CAF, "IKCOUS - imports", BASE),
      sonda("savycollection.vercel.app", SAVY, "Savy", BASE),
      sonda("almeidastore.vercel.app", TESTE, "Almeida Store", BASE),
      {
        dominio: "manut.vercel.app",
        ficha: { status: 503, caderneta: "miss", refs: [] },
      },
    ],
  });
  x.d.listarMigrationsNoSha = async (sha: string) =>
    sha === SHA
      ? ["20261190000000_a.sql", ARQ224, `rollback-manual-${ARQ224}`]
      : ["20261190000000_a.sql"];
  x.d.canais = { ...canais, provasDeObjetos: [LOTE_REAL_224] };
  return x;
}

Deno.test("lote 20261224000000 — o canais-de-backend.json real o declara como lote de UMA migration de apply normal: consulta 27a, ausência 27b, sem backfill, sem nuncaAplicar, nas duas lojas", async () => {
  assert(LOTE_REAL_224, "o lote da 27a não está no canais-de-backend.json");
  assertEquals(LOTE_REAL_224.versoes, [V224]);
  assertEquals(LOTE_REAL_224.ausenciaConfirmadaPor, B27);
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assertEquals(LOTE_REAL_224[campo], undefined, campo);
  assert(
    CONSULTAS_DE_ROL_FECHADO.has(A27) && CONSULTAS_DE_ROL_FECHADO.has(B27),
  );
  assertEquals(ROL_FECHADO_POR_CONSULTA[A27], ROL_DA_27A);
  assertEquals(ROL_FECHADO_POR_CONSULTA[B27], ROL_DA_27B);
  assertEquals(ROL_DA_27A.length, 6);
  assertEquals(ROL_DA_27B.length, 6);
  const migracoes = new Set<string>();
  for await (const e of Deno.readDir("supabase/migrations"))
    if (e.isFile) migracoes.add(e.name);
  assert(migracoes.has(ARQ224), ARQ224);
  assert(migracoes.has(`rollback-manual-${ARQ224}`));
  const workflow = await Deno.readTextFile(
    ".github/workflows/conferir-banco-da-loja.yml",
  );
  assertStringIncludes(workflow, `- ${A27}`);
  assertStringIncludes(workflow, `- ${B27}`);
  // o lote vem DEPOIS do lote 26 (e do 25) no arquivo
  const consultas = lerCanais().provasDeObjetos.map((p: any) => p.consulta);
  assertEquals(
    consultas.indexOf(A27),
    consultas.indexOf("26a-conferir-voto-util-so-em-avaliacao-publica") + 1,
  );
  const c = String(LOTE_REAL_224._comentario);
  for (const trecho of [
    "UMA migration",
    "APPLY NORMAL",
    "sem backfillLedger",
    "ROL FECHADO",
    "E PERMISSAO e DADO PUBLICO",
    "O gatilho NAO recusa nada",
    "NAO e administrador (rls_admin_atual)",
    "Nenhuma edge function muda e nenhum front muda",
    "27m-medir-avaliacao-forjada",
    "que NAO e portao",
    "rollback-manual-20261224000000",
    "item 24 de docs/runbooks/producao-unica-fonte.md",
  ])
    assertStringIncludes(c, trecho);
  // a runbook registra o lote no item 24
  const runbook = (
    await Deno.readTextFile("docs/runbooks/producao-unica-fonte.md")
  ).replace(/\s+/g, " ");
  assertStringIncludes(
    runbook,
    "20261224000000_a_avaliacao_nasce_sem_a_resposta_da_loja.sql",
  );
  assertStringIncludes(runbook, "27m-medir-avaliacao-forjada");
});

Deno.test("lote 20261224000000 — SEM evidência: pede a 27a; 27a NEGATIVA sem a 27b: pede a 27b; nenhum apply", async () => {
  for (const [a, consulta] of [
    [null, A27],
    [{ okFalse: 2 }, B27],
  ] as Array<[Estado203, string]>) {
    const { d } = depsLote224(false, a);
    const r = await executar(d, true);
    assertEquals(r.codigo, 1, r.relatorio);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r.relatorio, projeto);
      assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${consulta}"`);
    }
    assert(!r.relatorio.includes("aplicar-migrations.yml"), r.relatorio);
  }
});

Deno.test("lote 20261224000000 — 27a NEGATIVA + 27b POSITIVA mais nova: o comando é o APPLY do arquivo com o SHA efetivo, sem backfill; 27b mais VELHA não vale", async () => {
  const ok = depsLote224(
    false,
    { okFalse: 2 },
    { quando: "2026-10-06T19:10:00Z" },
  );
  const r = await executar(ok.d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r.relatorio}`);
    assertStringIncludes(cmds[0], "aplicar-migrations.yml");
    assertStringIncludes(cmds[0], `-f "migracoes=${ARQ224}"`);
    assertStringIncludes(cmds[0], `-f "expected_sha=${TOPO}"`);
  }
  assert(!r.relatorio.includes("gravar_ledger"), r.relatorio);
  const velha = depsLote224(
    false,
    { okFalse: 3, quando: "2026-10-06T19:30:00Z" },
    { quando: "2026-10-06T19:00:00Z" },
  );
  const r2 = await executar(velha.d, true);
  for (const [, projeto] of LOJAS_203) {
    const cmds = comandosDaLoja(r2.relatorio, projeto);
    assertEquals(cmds.length, 1, `${projeto}: ${r2.relatorio}`);
    assertStringIncludes(cmds[0], `-f "consulta=${B27}"`);
  }
  assert(!r2.relatorio.includes("aplicar-migrations.yml"), r2.relatorio);
});

Deno.test("lote 20261224000000 — 27a e 27b NEGATIVAS (a loja não está na base de antes): PARADO; 27a POSITIVA com o ledger sem a versão: PARADO", async () => {
  const dupla = depsLote224(false, { okFalse: 2 }, { okFalse: 2 });
  const r = await executar(dupla.d, true);
  assertEquals(r.codigo, 1, r.relatorio);
  assertEquals(comandosGh(r.relatorio), [], r.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("PARAR") &&
          b.motivo.includes(B27),
      ),
      JSON.stringify(r.bloqueios),
    );
  const semLedger = depsLote224(false, {});
  const r2 = await executar(semLedger.d, true);
  assertEquals(r2.codigo, 1, r2.relatorio);
  assertEquals(comandosGh(r2.relatorio), [], r2.relatorio);
  for (const [ref] of LOJAS_203)
    assert(
      r2.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes("não declara backfillLedger"),
      ),
      JSON.stringify(r2.bloqueios),
    );
});

Deno.test("lote 20261224000000 — apply feito e 27a POSITIVA: liberada; veredito sem rol=ok nunca libera; sem o lote no canais o portão BLOQUEIA", async () => {
  const feito = depsLote224(true, {});
  const r = await executar(feito.d, true);
  assertEquals(r.codigo, 0, r.relatorio);
  assertEquals(feito.chamadas.promover.length, 1);
  for (const rol of ["invalido", null]) {
    const { d } = depsLote224(true, { rol });
    const r2 = await executar(d, true);
    assertEquals(r2.codigo, 1, `${rol}: ${r2.relatorio}`);
    for (const [, projeto] of LOJAS_203) {
      const cmds = comandosDaLoja(r2.relatorio, projeto);
      assertEquals(cmds.length, 1, `${rol}: ${r2.relatorio}`);
      assertStringIncludes(cmds[0], `-f "consulta=${A27}"`);
    }
  }
  const sem = depsLote224(false);
  sem.d.canais = { ...canais, provasDeObjetos: [] };
  const r3 = await executar(sem.d, true);
  assertEquals(r3.codigo, 1, r3.relatorio);
  assertEquals(sem.chamadas.promover.length, 0);
  for (const [ref] of LOJAS_203)
    assert(
      r3.bloqueios.some(
        (b: any) =>
          b.alvo.includes(ref) &&
          b.motivo.includes(
            `migration nova ${V224} sem prova de objetos declarada`,
          ),
      ),
      JSON.stringify(r3.bloqueios),
    );
});
