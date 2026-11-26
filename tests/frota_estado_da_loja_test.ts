// @ts-nocheck
/* eslint-disable security/detect-object-injection -- dublês de teste: as chaves vêm de constantes e mapas fechados do próprio arquivo. */
/**
 * scripts/frota/estado-da-loja.mjs — o comando que decide e IMPRIME a única chamada SQL que muda o estado de uma loja
 * (plano L8, Lote 4). Todas as dependências são dublês: nenhuma rede, nenhum CLI, nenhum banco.
 *
 * O QUE ESTES TESTES MEDEM:
 *  - uso errado (ação, argumento, formato de id/ref/sha/motivo) sai 2 e não imprime SQL;
 *  - sem politica.json lojasQueNuncaDormem (ou vazia, ou com ref inválido) NADA sai, nem o --ver;
 *  - IKCOUS e Savy são recusadas em toda ação que muda, antes de qualquer leitura de rede;
 *  - --sha tem de ser a release que a produção serve (version.json no contrato); falha de rede = recusa;
 *  - --acordar roda a prontidão DAQUELA loja contra a release atual com base = a release em que ela dormiu; não pronta = os comandos de
 *    conserto dela e saída 1, sem a chamada da porta (o caso que dói: dormiu na A, a B trouxe migration nova);
 *  - a instrução impressa é UMA, com valores escapados e validade de 30 minutos pelo relógio injetado;
 *  - contextoDaRelease + prontidaoDaLoja (exportados do publicar-release.mjs) dão a prontidão de UMA loja.
 *  - loja OAuth: o --acordar lê pelo leitor OAuth (o mesmo roteamento do portão), nunca pelo CLI; sem token não acorda e diz o que
 *    fazer; loja CLI fica idêntica à de antes.
 */
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { criarAcessoOAuth } from "../scripts/frota/acesso-oauth.mjs";
import { criarCofreMemoria } from "../scripts/frota/cofre-local.mjs";
import {
  VALIDADE_MINUTOS,
  executar,
  lerReleaseEmProducao,
  literal,
  sqlDaPorta,
  sqlDeVer,
} from "../scripts/frota/estado-da-loja.mjs";
import {
  AVISO_DA_SESSAO_OAUTH,
  arquivosEsperados,
  contextoDaRelease,
  prontidaoDaLoja,
} from "../scripts/frota/publicar-release.mjs";

const { validarCadastro } = createRequire(import.meta.url)(
  "../scripts/frota/lojas.cjs",
);

const CAF = "cafkrminfnokvgjqtkle";
const SAVY = "gnjsrucsmjkajijrakzr";
const REF = "lojatesteaaaaaaaaaaa";
const LOJA = "loja-teste";
const SHA_A = "a".repeat(40); // a release em que a loja dormiu
const SHA_B = "b".repeat(40); // a release que a produção serve agora
const RUN_SHA = "c".repeat(40);
const TOPO = "d".repeat(40);
const IDENT = "e".repeat(64);
const AGORA = Date.parse("2026-11-26T03:00:00Z");
const M1 = "20261460000000";
const M2 = "20261470000000"; // a migration nova da release B
const LOTE_A = "99a-conferir-a-migration-nova-aplicado";
const LOTE_B = "99b-antes-a-migration-nova-ausente";
// O autor de verdade vai no motivo: o rastro do banco grava quem = session_user (postgres, pelo MCP).
const MOTIVO = "por Gabriel: assinatura vencida ha 7 dias (aviso enviado)";

const politicaBase = () => ({
  lojasSemBackendGerenciado: [],
  lojasQueNuncaDormem: [
    { ref: CAF, nome: "IKCOUS" },
    { ref: SAVY, nome: "Savy" },
  ],
  enderecosDeReserva: [
    "ickous-marketplace.vercel.app",
    "savycollection.vercel.app",
  ],
  migrationsForaDaRelease: [],
});
const canaisBase = () => ({
  ramoDaRelease: "claude/app-major-upgrade-wmc8x2",
  validadeDaEvidenciaHoras: 6,
  funcoesNaoPublicadas: [],
  provasDeObjetos: [
    { consulta: LOTE_A, versoes: [M2], ausenciaConfirmadaPor: LOTE_B },
  ],
  canais: {
    [REF]: {
      nome: "Loja Teste",
      migrations: "loja-teste",
      functions: "loja-teste",
      projetosNoMesmoBanco: [],
      functionsPublicaveis: ["criar-pagamento"],
    },
  },
});

// A release B mudou a function criar-pagamento (x = 1); na A ela era x = 0.
// conferir-frete é IGUAL nas duas (a release não a mudou); frete-novo só existe na B. Nenhuma das duas aparece na lista de functions do
// SHA a menos que o cenário peça (funcoesNoSha).
const ARVORE = {
  [SHA_A]: {
    "supabase/functions/criar-pagamento/index.ts": "export const x = 0;",
    "supabase/functions/conferir-frete/index.ts": "export const y = 2;",
    "supabase/config.toml": "",
  },
  [SHA_B]: {
    "supabase/functions/criar-pagamento/index.ts": "export const x = 1;",
    "supabase/functions/conferir-frete/index.ts": "export const y = 2;",
    "supabase/functions/frete-novo/index.ts": "export const z = 3;",
    "supabase/config.toml": "",
  },
};
const MIGRATIONS = {
  [SHA_A]: [`${M1}_a_loja_tem_estado_de_vida.sql`],
  [SHA_B]: [
    `${M1}_a_loja_tem_estado_de_vida.sql`,
    `${M2}_a_loja_muda_de_estado_so_pela_porta.sql`,
    `rollback-manual-${M2}_a_loja_muda_de_estado_so_pela_porta.sql`,
  ],
};
const pacote = () =>
  [
    ...arquivosEsperados("criar-pagamento", (c) => ARVORE[SHA_B][c] ?? null),
  ].map(([caminho, conteudo]) => ({ caminho, conteudo }));
/** A saída real do `supabase migration list` (tabela). */
const tabelaDoLedger = (versoes) =>
  [
    "   Local | Remote           | Time (UTC)            ",
    "  -------|------------------|-----------------------",
    ...versoes.map((v) => `   \` \`   | \`${v}\` | \`${v}\`      `),
    "",
  ].join("\n");

/** Dependências da prontidão (as do publicar-release.mjs), com estado ajustável por cenário. */
function depsDaRelease(ajuste = {}) {
  const estado = {
    ledger: [M1, M2],
    funcoesNoAr: [{ slug: "criar-pagamento", verify_jwt: true }],
    pacote: pacote(),
    evidencia: true,
    falhaNoLedger: null,
    falhaNasMigrations: null,
    funcoesNoSha: ["_shared", "criar-pagamento"],
    topo: TOPO,
    arvoreIgual: true,
    ...ajuste,
  };
  const chamadas = { migrationList: [], listarMigrationsNoSha: [] };
  return {
    chamadas,
    d: {
      listarMigrationsNoSha: async (sha) => {
        chamadas.listarMigrationsNoSha.push(sha);
        if (estado.falhaNasMigrations) throw estado.falhaNasMigrations;
        return (estado.migracoes ?? MIGRATIONS)[sha] ?? [];
      },
      listarFuncoesNoSha: async () => estado.funcoesNoSha,
      lerArquivoNoSha: (sha, caminho) => ARVORE[sha]?.[caminho] ?? null,
      topoDoRamo: async () => {
        if (estado.topo instanceof Error) throw estado.topo;
        return estado.topo;
      },
      arvoreIgual: async (x, y, caminhos) =>
        typeof estado.arvoreIgual === "function"
          ? estado.arvoreIgual(x, y, caminhos)
          : estado.arvoreIgual,
      migrationList: async (ref) => {
        chamadas.migrationList.push(ref);
        if (estado.falhaNoLedger) throw estado.falhaNoLedger;
        return tabelaDoLedger(estado.ledger);
      },
      listarFuncoes: async () => estado.funcoesNoAr,
      baixarFuncao: async () => estado.pacote,
      listarRuns: async (wf) =>
        wf === "conferir-banco-da-loja.yml" && estado.evidencia
          ? [
              {
                databaseId: 77,
                displayTitle: `conferir ${LOTE_A} em loja-teste`,
                headSha: RUN_SHA,
                createdAt: new Date(AGORA - 3600 * 1000).toISOString(),
                conclusion: "success",
                status: "completed",
              },
            ]
          : [],
      logDoRun: async () =>
        `VEREDITO-CONSULTA consulta=${LOTE_A} ref=${REF} sha=${RUN_SHA} linhas=4 ok_false=0 ok_nao_booleano=0\n`,
    },
  };
}

/** As dependências do comando; `lidas` conta as leituras de rede (version.json) e da prontidão. */
function deps({
  politica = politicaBase(),
  canais = canaisBase(),
  producao = SHA_B,
  release = {},
  extras = null,
} = {}) {
  const lidas = { producao: 0, release: 0 };
  const r = depsDaRelease(release);
  // `extras`: o que dependenciasReais() acrescenta para a loja OAuth (cadastro, fetchGestao, tokenOAuth, baixarOAuth).
  if (extras) Object.assign(r.d, extras);
  return {
    lidas,
    chamadas: r.chamadas,
    d: {
      politica,
      canais,
      agora: () => AGORA,
      lerReleaseEmProducao: async () => {
        lidas.producao++;
        if (producao instanceof Error) throw producao;
        return producao;
      },
      depsDaRelease: () => {
        lidas.release++;
        return r.d;
      },
    },
  };
}

const ADORMECER = [
  "--adormecer",
  "--loja",
  LOJA,
  "--ref",
  REF,
  "--sha",
  SHA_B,
  "--motivo",
  MOTIVO,
];
const ACORDAR = [
  "--acordar",
  "--loja",
  LOJA,
  "--ref",
  REF,
  "--base",
  SHA_A,
  "--sha",
  SHA_B,
  "--motivo",
  MOTIVO,
];
const ENCERRAR = [
  "--encerrar",
  "--loja",
  LOJA,
  "--ref",
  REF,
  "--sha",
  SHA_B,
  "--motivo",
  MOTIVO,
  "--confirmar",
  `ENCERRAR ${LOJA}`,
];
const VALIDO_ATE = new Date(AGORA + 30 * 60000).toISOString();
const temPorta = (r) => r.saida.some((l) => l.includes("frota_mudar_estado"));

// ---------------------------------------------------------------- uso errado (2)

for (const [nome, argv] of [
  ["sem ação", ["--loja", LOJA]],
  ["duas ações", ["--ver", "--adormecer"]],
  ["argumento desconhecido", ["--ver", "--tudo"]],
  ["opção sem valor", ["--ver", "--loja"]],
  ["opção repetida", [...ADORMECER, "--loja", LOJA]],
  ["adormecer sem motivo", ADORMECER.slice(0, -2)],
  ["acordar sem base", ACORDAR.filter((_, i) => i !== 5 && i !== 6)],
  ["encerrar sem confirmar", ENCERRAR.slice(0, -2)],
  [
    "adormecer não aceita --confirmar",
    [...ADORMECER, "--confirmar", `ENCERRAR ${LOJA}`],
  ],
  ["--ver não aceita --ref", ["--ver", "--ref", REF]],
  [
    "ref com maiúscula",
    ADORMECER.map((x) => (x === REF ? "LOJATESTEAAAAAAAAAAA" : x)),
  ],
  ["ref curto", ADORMECER.map((x) => (x === REF ? "abc" : x))],
  ["loja com espaço", ADORMECER.map((x) => (x === LOJA ? "loja teste" : x))],
  ["loja com aspas", ADORMECER.map((x) => (x === LOJA ? "a'b" : x))],
  ["sha curto", ADORMECER.map((x) => (x === SHA_B ? "b".repeat(39) : x))],
  ["sha maiúsculo", ADORMECER.map((x) => (x === SHA_B ? "B".repeat(40) : x))],
  [
    "motivo com aspas simples",
    ADORMECER.map((x) => (x === MOTIVO ? "venceu'; drop table x; --" : x)),
  ],
  ["motivo curto", ADORMECER.map((x) => (x === MOTIVO ? "ok" : x))],
  ["motivo de 201", ADORMECER.map((x) => (x === MOTIVO ? "a".repeat(201) : x))],
  [
    "motivo sem o autor",
    ADORMECER.map((x) =>
      x === MOTIVO ? "Assinatura vencida ha 7 dias (aviso enviado)" : x,
    ),
  ],
  [
    "motivo com autor vazio",
    ADORMECER.map((x) => (x === MOTIVO ? "por : assinatura vencida" : x)),
  ],
  [
    "motivo só com o autor",
    ADORMECER.map((x) => (x === MOTIVO ? "por Gabriel: " : x)),
  ],
  [
    "motivo com o autor sem os dois-pontos",
    ADORMECER.map((x) => (x === MOTIVO ? "por Gabriel assinatura vencida" : x)),
  ],
  ["--de inválido", [...ENCERRAR, "--de", "encerrada"]],
]) {
  Deno.test(`uso errado (${nome}): sai 2, não imprime SQL e não lê a rede`, async () => {
    const { d, lidas } = deps();
    const r = await executar(argv, d);
    assertEquals(r.codigo, 2, r.erros.join("\n"));
    assertEquals(r.saida, []);
    assertEquals(lidas, { producao: 0, release: 0 });
  });
}

Deno.test("motivo de exatamente 200 caracteres com acento, número e pontuação permitida passa", async () => {
  const motivo = `por Gabriel: loja não pagou (2 avisos): ${"á".repeat(160)}`;
  assertEquals(motivo.length, 200);
  const { d } = deps();
  const r = await executar(
    ADORMECER.map((x) => (x === MOTIVO ? motivo : x)),
    d,
  );
  assertEquals(r.codigo, 0, r.erros.join("\n"));
  assertStringIncludes(r.saida[0], `p_motivo => '${motivo}'`);
});

// ---------------------------------------------------------------- política (1, recusa TUDO)

for (const [nome, ajuste] of [
  ["sem lojasQueNuncaDormem", (p) => (p.lojasQueNuncaDormem = undefined)],
  ["lojasQueNuncaDormem vazia", (p) => (p.lojasQueNuncaDormem = [])],
  [
    "lojasQueNuncaDormem não é lista",
    (p) => (p.lojasQueNuncaDormem = { ref: CAF }),
  ],
  ["ref inválido na lista", (p) => (p.lojasQueNuncaDormem = [{ ref: "CAF" }])],
]) {
  for (const argv of [["--ver"], ADORMECER, ACORDAR, ENCERRAR]) {
    Deno.test(`política ${nome}: ${argv[0]} é recusado (1) sem SQL e sem rede`, async () => {
      const politica = politicaBase();
      ajuste(politica);
      const { d, lidas } = deps({ politica });
      const r = await executar(argv, d);
      assertEquals(r.codigo, 1);
      assertEquals(r.saida, []);
      assertStringIncludes(r.erros.join("\n"), "lojasQueNuncaDormem");
      assertEquals(lidas, { producao: 0, release: 0 });
    });
  }
}

for (const [nome, ref] of [
  ["IKCOUS", CAF],
  ["Savy", SAVY],
]) {
  for (const base of [ADORMECER, ACORDAR, ENCERRAR]) {
    Deno.test(`${nome} nunca dorme: ${base[0]} é recusado antes de qualquer leitura`, async () => {
      const { d, lidas } = deps();
      const r = await executar(
        base.map((x) => (x === REF ? ref : x)),
        d,
      );
      assertEquals(r.codigo, 1);
      assertEquals(r.saida, []);
      assertStringIncludes(r.erros.join("\n"), "nunca dorme");
      assertEquals(lidas, { producao: 0, release: 0 });
    });
  }
}

// ---------------------------------------------------------------- --ver

Deno.test("--ver: UMA instrução só de leitura, sem supabase_url nem publishable_key, 20 últimas do histórico", async () => {
  const { d, lidas } = deps();
  const r = await executar(["--ver"], d);
  assertEquals(r.codigo, 0);
  assertEquals(r.saida.length, 1);
  const sql = r.saida[0];
  assertEquals(sql, sqlDeVer(undefined));
  assert(sql.startsWith("select "), sql);
  assertEquals(sql.split(";").length, 2, "um statement só");
  assert(!/supabase_url|publishable_key|frota_segredo/.test(sql), sql);
  assert(
    !/\b(insert|update|delete|frota_mudar_estado|set_config)\b/i.test(sql),
    sql,
  );
  assertStringIncludes(sql, "limit 20");
  assertStringIncludes(
    sql,
    "from public.frota_estado_historico hi order by hi.id desc limit 20",
  );
  assertEquals(lidas, { producao: 0, release: 0 });
});

Deno.test("--ver --loja filtra as lojas e o histórico pela mesma loja (literal escapado)", async () => {
  const { d } = deps();
  const r = await executar(["--ver", "--loja", LOJA], d);
  assertEquals(r.codigo, 0);
  assertStringIncludes(r.saida[0], `where fl.id = '${LOJA}'`);
  assertStringIncludes(r.saida[0], `where hi.loja_id = '${LOJA}'`);
});

// ---------------------------------------------------------------- release em produção

Deno.test("--sha diferente da release servida em produção: recusa (1), sem SQL", async () => {
  const { d } = deps({ producao: SHA_A });
  const r = await executar(ADORMECER, d);
  assertEquals(r.codigo, 1);
  assertEquals(r.saida, []);
  assertStringIncludes(r.erros.join("\n"), SHA_A);
});

Deno.test("falha de rede ao ler a release em produção: recusa (1), nunca imprime a chamada", async () => {
  for (const argv of [ADORMECER, ACORDAR, ENCERRAR]) {
    const { d, lidas } = deps({ producao: new TypeError("fetch failed") });
    const r = await executar(argv, d);
    assertEquals(r.codigo, 1, argv[0]);
    assertEquals(r.saida, []);
    assertStringIncludes(r.erros.join("\n"), "fetch failed");
    assertEquals(
      lidas.release,
      0,
      "sem a release em produção a prontidão nem começa",
    );
  }
});

// ---------------------------------------------------------------- adormecer e encerrar

Deno.test("adormecer: UMA chamada da porta, de ativa para adormecida, sem base nem confirmação, válida por 30 minutos", async () => {
  const { d, lidas } = deps();
  const r = await executar(ADORMECER, d);
  assertEquals(r.codigo, 0, r.erros.join("\n"));
  assertEquals(VALIDADE_MINUTOS, 30);
  assertEquals(r.saida, [
    `select * from public.frota_mudar_estado(p_id => '${LOJA}', p_ref => '${REF}', p_de => 'ativa', p_para => 'adormecida', p_sha => '${SHA_B}', p_base => null, p_motivo => '${MOTIVO}', p_confirmacao => null, p_valido_ate => '${VALIDO_ATE}'::timestamptz);`,
  ]);
  assertEquals(
    lidas,
    { producao: 1, release: 0 },
    "adormecer não roda prontidão",
  );
});

Deno.test("encerrar: exige a frase exata ENCERRAR <id>; sai de adormecida por padrão e de ativa com --de ativa", async () => {
  for (const errada of [
    `ENCERRAR ${LOJA} `,
    `encerrar ${LOJA}`,
    "ENCERRAR outra-loja",
    "ENCERRAR",
  ]) {
    const { d, lidas } = deps();
    const r = await executar(
      ENCERRAR.map((x) => (x === `ENCERRAR ${LOJA}` ? errada : x)),
      d,
    );
    assertEquals(r.codigo, 1, errada);
    assertEquals(r.saida, []);
    assertEquals(lidas.producao, 0);
  }
  const { d } = deps();
  const r = await executar(ENCERRAR, d);
  assertEquals(r.codigo, 0, r.erros.join("\n"));
  assertStringIncludes(
    r.saida[0],
    "p_de => 'adormecida', p_para => 'encerrada'",
  );
  assertStringIncludes(r.saida[0], `p_confirmacao => 'ENCERRAR ${LOJA}'`);
  assertStringIncludes(r.saida[0], "p_base => null");
  const r2 = await executar([...ENCERRAR, "--de", "ativa"], deps().d);
  assertEquals(r2.codigo, 0);
  assertStringIncludes(r2.saida[0], "p_de => 'ativa', p_para => 'encerrada'");
});

// ---------------------------------------------------------------- acordar

Deno.test("acordar loja PRONTA (ledger com a migration nova e prova fresca): UMA chamada da porta com a base; prontidão lida com a base", async () => {
  const { d, lidas, chamadas } = deps();
  const r = await executar(ACORDAR, d);
  assertEquals(r.codigo, 0, r.erros.join("\n"));
  assertEquals(r.saida, [
    `select * from public.frota_mudar_estado(p_id => '${LOJA}', p_ref => '${REF}', p_de => 'adormecida', p_para => 'ativa', p_sha => '${SHA_B}', p_base => '${SHA_A}', p_motivo => '${MOTIVO}', p_confirmacao => null, p_valido_ate => '${VALIDO_ATE}'::timestamptz);`,
  ]);
  assertEquals(lidas, { producao: 1, release: 1 });
  assertEquals(chamadas.migrationList, [REF], "o ledger DESTA loja foi lido");
  assert(
    chamadas.listarMigrationsNoSha.includes(SHA_A),
    "a base é a release em que a loja dormiu",
  );
});

Deno.test("O CASO QUE DÓI: a loja dormiu na release A, a B trouxe migration nova, o banco dela não tem — NÃO acorda; imprime só o conserto DELA", async () => {
  const { d } = deps({ release: { ledger: [M1], evidencia: false } });
  const r = await executar(ACORDAR, d);
  assertEquals(r.codigo, 1);
  assert(!temPorta(r), r.saida.join("\n"));
  const erros = r.erros.join("\n");
  assertStringIncludes(erros, "NÃO PRONTA");
  assertStringIncludes(erros, M2);
  const cmds = r.saida.filter((l) => l.startsWith("gh "));
  assert(cmds.length >= 1, r.saida.join("\n"));
  for (const c of cmds) {
    assertStringIncludes(c, '-f "projeto=loja-teste"');
    assertStringIncludes(c, `-f "expected_sha=${TOPO}"`);
  }
  assert(
    !r.saida.join("\n").includes("ikcous-publicada") &&
      !r.saida.join("\n").includes("savy"),
    "nenhum comando de outra loja",
  );
});

Deno.test("acordar com a migration no ledger mas SEM prova fresca de objetos: não acorda", async () => {
  const { d } = deps({ release: { evidencia: false } });
  const r = await executar(ACORDAR, d);
  assertEquals(r.codigo, 1);
  assert(!temPorta(r));
  assertStringIncludes(r.saida.join("\n"), `consulta=${LOTE_A}`);
});

Deno.test("acordar com function da release velha no ar: não acorda e pede a publicação da function", async () => {
  const velho = pacote().map((a) => ({
    ...a,
    conteudo: "export const x = 0;",
  }));
  const { d } = deps({ release: { pacote: velho } });
  const r = await executar(ACORDAR, d);
  assertEquals(r.codigo, 1);
  assert(!temPorta(r));
  assertStringIncludes(r.erros.join("\n"), "function criar-pagamento");
  assertStringIncludes(r.saida.join("\n"), "publicar-functions.yml");
});

// Function que FALTA na loja e que a release NÃO mudou (DERIVA_ANTIGA com `ausente`): não impede o acordar, mas o comando de publicá-la
// sai — antes ela ficava sem comando para sempre, porque o conserto só era impresso para loja NÃO pronta. O comando vai no AVISO (stderr):
// o stdout continua sendo UMA instrução só, a que se roda pelo MCP.
const CMD_FRETE = `gh workflow run publicar-functions.yml --ref "claude/app-major-upgrade-wmc8x2" -f "projeto=loja-teste" -f "functions=conferir-frete" -f "expected_sha=${TOPO}"`;
const SQL_ACORDAR = `select * from public.frota_mudar_estado(p_id => '${LOJA}', p_ref => '${REF}', p_de => 'adormecida', p_para => 'ativa', p_sha => '${SHA_B}', p_base => '${SHA_A}', p_motivo => '${MOTIVO}', p_confirmacao => null, p_valido_ate => '${VALIDO_ATE}'::timestamptz);`;
const comFreteNoSha = {
  funcoesNoSha: ["_shared", "criar-pagamento", "conferir-frete"],
};
const canaisQuePublicamFrete = () => {
  const canais = canaisBase();
  canais.canais[REF].functionsPublicaveis = [
    "criar-pagamento",
    "conferir-frete",
  ];
  return canais;
};
const ghDe = (linhas) => linhas.filter((l) => l.startsWith("gh "));

Deno.test("acordar loja PRONTA sem uma function que a release não mudou (publicável): acorda, e o aviso traz o comando de publicá-la", async () => {
  const { d } = deps({
    canais: canaisQuePublicamFrete(),
    release: comFreteNoSha,
  });
  const r = await executar(ACORDAR, d);
  assertEquals(r.codigo, 0, r.erros.join("\n"));
  // o stdout é SÓ a instrução da porta: nenhum gh misturado ao SQL que vai ao MCP
  assertEquals(r.saida, [SQL_ACORDAR]);
  assertEquals(ghDe(r.erros), [CMD_FRETE]);
  const erros = r.erros.join("\n");
  assertStringIncludes(erros, "conferir-frete");
  assertStringIncludes(erros, "não impedem o acordar");
  assertStringIncludes(erros, "Para publicá-las");
  assert(!erros.includes("NÃO PRONTA"), erros);
});

Deno.test("acordar loja PRONTA sem uma function inalterada que o canal NÃO publica: acorda, sem comando gh, e o aviso diz por quê sem prometer comando", async () => {
  const { d } = deps({ release: comFreteNoSha });
  const r = await executar(ACORDAR, d);
  assertEquals(r.codigo, 0, r.erros.join("\n"));
  assertEquals(r.saida, [SQL_ACORDAR]);
  assertEquals(ghDe(r.erros), []);
  const erros = r.erros.join("\n");
  assertStringIncludes(erros, "functions conferir-frete faltam nesta loja");
  assert(!erros.includes("Para publicá-las"), erros);
  assertStringIncludes(erros, "Nenhuma tem comando de publicar daqui");
});

Deno.test("acordar loja PRONTA sem function inalterada, mas com o topo ilegível ou com functions diferentes da release: acorda, NENHUM comando gh", async () => {
  for (const [nome, ajuste, trecho] of [
    // sem migration nova na release (A = B no banco): nenhuma prova pede o topo, e a loja fica pronta com ele ilegível
    [
      "topo ilegível",
      {
        topo: new Error("git falhou"),
        migracoes: { [SHA_A]: MIGRATIONS[SHA_B], [SHA_B]: MIGRATIONS[SHA_B] },
      },
      "não foi lido",
    ],
    // só as functions do topo diferem (o banco e as provas continuam iguais)
    [
      "topo com outras functions",
      {
        arvoreIgual: (_x, _y, caminhos) =>
          !caminhos.includes("supabase/functions"),
      },
      "nenhum comando de functions",
    ],
  ]) {
    const { d } = deps({
      canais: canaisQuePublicamFrete(),
      release: { ...comFreteNoSha, ...ajuste },
    });
    const r = await executar(ACORDAR, d);
    assertEquals(r.codigo, 0, `${nome}: ${r.erros.join("\n")}`);
    assertEquals(r.saida, [SQL_ACORDAR], nome);
    assertEquals(ghDe(r.erros), [], nome);
    assertStringIncludes(r.erros.join("\n"), trecho, nome);
    assert(!r.erros.join("\n").includes("Para publicá-las"), nome);
  }
});

Deno.test("acordar: function PRESENTE com deriva antiga (conteúdo velho que a release não mudou) continua sem aviso e sem comando", async () => {
  // conferir-frete no ar, com o pacote de criar-pagamento (diferente, mas nada que a release mudou)
  const { d: dPresente } = deps({
    canais: canaisQuePublicamFrete(),
    release: {
      ...comFreteNoSha,
      funcoesNoAr: [
        { slug: "criar-pagamento", verify_jwt: true },
        { slug: "conferir-frete", verify_jwt: true },
      ],
    },
  });
  const r = await executar(ACORDAR, dPresente);
  assertEquals(r.codigo, 0, r.erros.join("\n"));
  assertEquals(r.saida, [SQL_ACORDAR]);
  assertEquals(ghDe(r.erros), []);
  assert(!r.erros.join("\n").includes("conferir-frete"), r.erros.join("\n"));
  // controle do mesmo cenário com a function AUSENTE: o aviso existe
  const { d: dAusente } = deps({
    canais: canaisQuePublicamFrete(),
    release: comFreteNoSha,
  });
  const ausente = await executar(ACORDAR, dAusente);
  assertEquals(ghDe(ausente.erros), [CMD_FRETE]);
});

Deno.test("acordar sem uma function que a release CRIOU (mudou): não acorda, e o comando de publicá-la vai com o conserto", async () => {
  const canais = canaisBase();
  canais.canais[REF].functionsPublicaveis = ["criar-pagamento", "frete-novo"];
  const { d } = deps({
    canais,
    release: { funcoesNoSha: ["_shared", "criar-pagamento", "frete-novo"] },
  });
  const r = await executar(ACORDAR, d);
  assertEquals(r.codigo, 1);
  assert(!temPorta(r), r.saida.join("\n"));
  assertStringIncludes(r.erros.join("\n"), "function frete-novo");
  assertStringIncludes(r.saida.join("\n"), '-f "functions=frete-novo"');
});

Deno.test("acordar com falha de rede na prontidão (ledger ilegível ou árvore da release ilegível): recusa, sem a chamada", async () => {
  for (const release of [
    { falhaNoLedger: new Error("ECONNRESET") },
    { falhaNasMigrations: new Error("git falhou") },
  ]) {
    const { d } = deps({ release });
    const r = await executar(ACORDAR, d);
    assertEquals(r.codigo, 1, JSON.stringify(Object.keys(release)));
    assert(!temPorta(r));
  }
});

Deno.test("acordar loja SEM canal de backend: recusa (não há como conferir nem consertar o banco dela)", async () => {
  const canais = canaisBase();
  delete canais.canais[REF];
  const { d, lidas } = deps({ canais });
  const r = await executar(ACORDAR, d);
  assertEquals(r.codigo, 1);
  assert(!temPorta(r));
  assertStringIncludes(r.erros.join("\n"), "canal de backend");
  assertEquals(lidas.release, 0);
});

Deno.test("NUNCA PÔR PARA DORMIR O QUE NÃO SE ACORDA: adormecer e encerrar loja SEM canal de backend são recusados com a MESMA razão do acordar, antes de qualquer leitura", async () => {
  const semCanal = () => {
    const canais = canaisBase();
    delete canais.canais[REF];
    return canais;
  };
  const doAcordar = await executar(ACORDAR, deps({ canais: semCanal() }).d);
  const razao = doAcordar.erros.find((l) => l.includes("canal de backend"));
  assert(razao, doAcordar.erros.join("\n"));
  for (const argv of [ADORMECER, ENCERRAR, [...ENCERRAR, "--de", "ativa"]]) {
    const { d, lidas } = deps({ canais: semCanal() });
    const r = await executar(argv, d);
    assertEquals(r.codigo, 1, `${argv[0]}: ${r.erros.join("\n")}`);
    assert(!temPorta(r), r.saida.join("\n"));
    assertEquals(r.saida, []);
    assertEquals(r.erros, [razao], argv[0]);
    assertEquals(lidas, { producao: 0, release: 0 }, argv[0]);
  }
});

Deno.test("loja em lojasSemBackendGerenciado (só front) dorme e acorda sem canal, como no publicar-release", async () => {
  const canais = canaisBase();
  delete canais.canais[REF];
  const politica = politicaBase();
  politica.lojasSemBackendGerenciado = [{ ref: REF, nome: "só front" }];
  for (const argv of [ADORMECER, ENCERRAR, ACORDAR]) {
    const { d, lidas } = deps({ canais, politica });
    const r = await executar(argv, d);
    assertEquals(r.codigo, 0, `${argv[0]}: ${r.erros.join("\n")}`);
    assert(temPorta(r));
    assertEquals(lidas.release, 0, argv[0]);
  }
});

Deno.test("motivo sem o autor: o erro diz o formato (por <nome>: ...) e por quê (o banco grava quem = postgres)", async () => {
  const { d } = deps();
  const r = await executar(
    ADORMECER.map((x) => (x === MOTIVO ? "Assinatura vencida" : x)),
    d,
  );
  assertEquals(r.codigo, 2);
  const erro = r.erros.join("\n");
  assertStringIncludes(erro, '"por <nome>: <motivo>"');
  assertStringIncludes(erro, "postgres");
});

Deno.test("reabrir encerrada: só com REABRIR <id> exato; sem ele o comando acorda de adormecida (a porta recusa se estiver encerrada)", async () => {
  const { d } = deps();
  const errado = await executar(
    [...ACORDAR, "--confirmar", "REABRIR outra"],
    d,
  );
  assertEquals(errado.codigo, 1);
  assertEquals(errado.saida, []);
  const certo = await executar(
    [...ACORDAR, "--confirmar", `REABRIR ${LOJA}`],
    deps().d,
  );
  assertEquals(certo.codigo, 0, certo.erros.join("\n"));
  assertStringIncludes(
    certo.saida[0],
    "p_de => 'encerrada', p_para => 'ativa'",
  );
  assertStringIncludes(certo.saida[0], `p_confirmacao => 'REABRIR ${LOJA}'`);
  assertStringIncludes(certo.saida[0], `p_base => '${SHA_A}'`);
});

// ---------------------------------------------------------------- depois de acordar (a corrida com a publicação)
// 10:00 a instrução de acordar sai para a release A (pronta); 10:10 a frota publica a B com migration nova; 10:20 alguém roda a
// instrução das 10:00: a porta aceita (ela não sabe qual release está no ar) e a loja volta servindo a B com o banco pronto só para a A.

const DEPOIS = [
  "--depois-de-acordar",
  "--loja",
  LOJA,
  "--ref",
  REF,
  "--sha",
  SHA_A,
  "--base",
  SHA_A,
];

Deno.test("acordar: a mensagem da instrução manda rodar o --depois-de-acordar com os argumentos exatos, como passo obrigatório", async () => {
  const { d } = deps();
  const r = await executar(ACORDAR, d);
  assertEquals(r.codigo, 0, r.erros.join("\n"));
  const msg = r.erros.find((l) => l.startsWith("Instrução válida até"));
  assert(msg, r.erros.join("\n"));
  assertStringIncludes(msg, "OBRIGATÓRIO");
  assertStringIncludes(
    msg,
    `node scripts/frota/estado-da-loja.mjs --depois-de-acordar --loja ${LOJA} --ref ${REF} --sha ${SHA_B} --base ${SHA_A}`,
  );
  // adormecer não acorda nada: sem o passo pós-acordar
  const ad = await executar(ADORMECER, deps().d);
  assert(!ad.erros.join("\n").includes("--depois-de-acordar"));
});

Deno.test("depois de acordar, release igual à da instrução: OK (0), a prontidão da impressão vale e nada mais é lido", async () => {
  const { d, lidas } = deps({ producao: SHA_A });
  const r = await executar(DEPOIS, d);
  assertEquals(r.codigo, 0, r.erros.join("\n"));
  assertEquals(r.saida, []);
  assertStringIncludes(r.erros.join("\n"), "OK");
  assertEquals(lidas, { producao: 1, release: 0 });
});

Deno.test("depois de acordar, a release MUDOU e a loja está pronta para a nova: OK (0) com aviso; prontidão lida contra a release ATUAL", async () => {
  const { d, lidas, chamadas } = deps({ producao: SHA_B });
  const r = await executar(DEPOIS, d);
  assertEquals(r.codigo, 0, r.erros.join("\n"));
  assert(!temPorta(r), r.saida.join("\n"));
  const erros = r.erros.join("\n");
  assertStringIncludes(erros, "AVISO");
  assertStringIncludes(erros, SHA_B);
  assertEquals(lidas, { producao: 1, release: 1 });
  assertEquals(chamadas.migrationList, [REF]);
  assert(
    chamadas.listarMigrationsNoSha.includes(SHA_B),
    "a prontidão é para a release que está no ar agora",
  );
});

Deno.test("O CASO QUE DÓI: depois de acordar a release mudou (B trouxe migration nova) e o banco não tem: CRÍTICO, saída 1, conserto DELA e o adormecer de volta", async () => {
  const { d } = deps({
    producao: SHA_B,
    release: { ledger: [M1], evidencia: false },
  });
  const r = await executar(DEPOIS, d);
  assertEquals(r.codigo, 1);
  assert(!temPorta(r), r.saida.join("\n"));
  const erros = r.erros.join("\n");
  assertStringIncludes(erros, "CRÍTICO");
  assertStringIncludes(erros, "no ar");
  assertStringIncludes(erros, M2);
  assertStringIncludes(
    erros,
    `node scripts/frota/estado-da-loja.mjs --adormecer --loja ${LOJA} --ref ${REF} --sha ${SHA_B}`,
  );
  const cmds = r.saida.filter((l) => l.startsWith("gh "));
  assert(cmds.length >= 1, r.saida.join("\n"));
  for (const c of cmds) assertStringIncludes(c, '-f "projeto=loja-teste"');
  // A loja JÁ está no ar: nada do texto do --acordar ("não acorda", "nada foi impresso").
  assertStringIncludes(erros, "JÁ está no ar");
  assert(!erros.includes("Nada foi impresso"), erros);
  assert(!erros.includes("não acorda"), erros);
});

Deno.test("depois de acordar, prontidão ilegível (ledger ou árvore da release) com a release mudada: falha (1), nunca OK, com o texto de quem JÁ está no ar", async () => {
  for (const release of [
    { falhaNoLedger: new Error("ECONNRESET") },
    { falhaNasMigrations: new Error("git falhou") },
  ]) {
    const { d } = deps({ producao: SHA_B, release });
    const r = await executar(DEPOIS, d);
    const nome = JSON.stringify(Object.keys(release));
    assertEquals(r.codigo, 1, nome);
    const erros = r.erros.join("\n");
    assertStringIncludes(erros, "CRÍTICO");
    assert(!/^OK/m.test(erros), erros);
    assertStringIncludes(erros, "JÁ está no ar");
    assert(!erros.includes("sem ela a loja não acorda"), erros);
    assert(!erros.includes("Nada foi impresso"), erros);
  }
});

Deno.test("depois de acordar, produção ilegível: falha (1), nunca OK, e a prontidão nem começa", async () => {
  const { d, lidas } = deps({ producao: new TypeError("fetch failed") });
  const r = await executar(DEPOIS, d);
  assertEquals(r.codigo, 1);
  assertEquals(r.saida, []);
  const erros = r.erros.join("\n");
  assertStringIncludes(erros, "fetch failed");
  assertStringIncludes(erros, "CRÍTICO");
  assertEquals(lidas.release, 0);
});

Deno.test("depois de acordar: uso errado (sem --base, sem --sha, com --motivo) sai 2 sem ler a rede", async () => {
  for (const argv of [
    DEPOIS.slice(0, -2),
    DEPOIS.filter((_, i) => i !== 5 && i !== 6),
    [...DEPOIS, "--motivo", MOTIVO],
  ]) {
    const { d, lidas } = deps();
    const r = await executar(argv, d);
    assertEquals(r.codigo, 2, argv.join(" "));
    assertEquals(lidas, { producao: 0, release: 0 });
  }
});

// ---------------------------------------------------------------- loja OAuth (acesso: "oauth" no lojas.json)
// A loja aberta pelo nova-loja só tem acesso OAuth: o CLI do dono não a enxerga. O --acordar lê a prontidão dela pelo MESMO roteamento
// do portão (publicar-release.mjs, comRoteamentoOAuth): ledger, lista e código das functions pelo leitor OAuth, com o token do cofre.
// Sem token = "não lida" = não acorda, com o que fazer; nunca cai no CLI.

// canário montado em tempo de execução (literal no fonte dispara o secretlint)
const CANARIO = `sbp_oauth_${"ab".repeat(20)}`;
const REF_OUTRA = "oauthoutralojabbbbbb";

/** O cadastro (lojas.json) normalizado pelo código de verdade; `loja-teste` com o `acesso` pedido. */
function cadastroCom({ acesso = "oauth", slug = LOJA, extras = {} } = {}) {
  return validarCadastro({
    lojas: {
      "ikcous-publicada": {
        ref: CAF,
        classe: "assinante",
        apelido: "CAF",
        segredoDoToken: "SUPABASE_ACCESS_TOKEN_IKCOUS",
        functionsNomeadas: true,
      },
      savy: {
        ref: SAVY,
        classe: "assinante",
        apelido: "Savy",
        segredoDoToken: "SUPABASE_ACCESS_TOKEN_SAVY",
        functionsNomeadas: true,
      },
      [slug]: {
        ref: REF,
        classe: "assinante",
        apelido: "Teste",
        segredoDoToken: "SUPABASE_ACCESS_TOKEN_LOJA_TESTE",
        functionsNomeadas: false,
        ...(acesso === "oauth" ? { acesso: "oauth" } : {}),
      },
      ...extras,
    },
  });
}

/** O que dependenciasReais() acrescenta para a loja OAuth, em dublê; `oauth.chamadas` anota quem foi chamado. */
function extrasOAuth({
  cadastro = cadastroCom(),
  ledger = [M1, M2],
  tokenOAuth,
} = {}) {
  const chamadas = { gestao: [], token: [], baixarOAuth: [] };
  return {
    chamadas,
    extras: {
      cadastro,
      fetchGestao: async (url, init) => {
        const u = new URL(url);
        chamadas.gestao.push({
          caminho: u.pathname,
          auth: init.headers.authorization,
        });
        const m =
          /^\/v1\/projects\/([a-z]{20})\/(database\/migrations|functions)$/.exec(
            u.pathname,
          );
        if (!m || m[1] !== REF) return new Response("", { status: 404 });
        const corpo =
          m[2] === "functions"
            ? [{ slug: "criar-pagamento", verify_jwt: true, status: "ACTIVE" }]
            : ledger.map((v) => ({ version: v, name: "m" }));
        return new Response(JSON.stringify(corpo), { status: 200 });
      },
      tokenOAuth:
        tokenOAuth ??
        (async ({ slug, ref }) => {
          chamadas.token.push([slug, ref]);
          return { accessToken: CANARIO, expiraEm: AGORA + 20 * 3600 * 1000 };
        }),
      baixarOAuth: async (ref, nome, gestao) => {
        chamadas.baixarOAuth.push([ref, nome, typeof gestao?.pedir]);
        return pacote();
      },
    },
  };
}

/** O cofre de verdade, vazio: o acesso não tem o refresh da loja (nunca conectada neste PC). */
const tokenSemRefresh = () => {
  const acesso = criarAcessoOAuth({
    cofre: criarCofreMemoria(),
    fetch: () => {
      throw new Error("sem rede no teste");
    },
    agora: () => AGORA,
  });
  return ({ slug }) => acesso.tokenVigente({ slug, minimoMs: 2 * 3600 * 1000 });
};

const semCanario = (r) =>
  assert(
    ![...r.saida, ...r.erros].join("\n").includes(CANARIO),
    "o token nunca aparece na saída",
  );

Deno.test("loja OAuth COM token: acorda pelo leitor OAuth (ledger e functions pela API, um token só); o CLI nunca recebe o ref dela", async () => {
  const o = extrasOAuth();
  const { d, chamadas } = deps({ extras: o.extras });
  const r = await executar(ACORDAR, d);
  assertEquals(r.codigo, 0, r.erros.join("\n"));
  assertEquals(r.saida, [SQL_ACORDAR]);
  assertEquals(chamadas.migrationList, [], "o CLI nunca lê a loja OAuth");
  assertEquals(o.chamadas.gestao.map((g) => g.caminho).sort(), [
    `/v1/projects/${REF}/database/migrations`,
    `/v1/projects/${REF}/functions`,
  ]);
  assert(o.chamadas.gestao.every((g) => g.auth === `Bearer ${CANARIO}`));
  assertEquals(o.chamadas.token, [[LOJA, REF]], "um pedido de token só");
  assertEquals(o.chamadas.baixarOAuth, [[REF, "criar-pagamento", "function"]]);
  semCanario(r);
});

Deno.test("loja OAuth SEM token (o cofre deste PC não tem o refresh): NÃO acorda, diz por quê e manda rodar o abrir/receber do nova-loja; nada cai no CLI", async () => {
  const o = extrasOAuth({ tokenOAuth: tokenSemRefresh() });
  const { d, chamadas } = deps({ extras: o.extras });
  const r = await executar(ACORDAR, d);
  assertEquals(r.codigo, 1);
  assert(!temPorta(r), r.saida.join("\n"));
  const erros = r.erros.join("\n");
  assertStringIncludes(erros, "NÃO PRONTA");
  assertStringIncludes(
    erros,
    "ledger não lido: loja OAuth loja-teste não lida",
  );
  assertStringIncludes(erros, "sem acesso");
  assertStringIncludes(
    erros,
    "node scripts/frota/nova-loja.mjs abrir --loja loja-teste",
  );
  assertStringIncludes(erros, "receber --loja loja-teste --aplicar");
  assertEquals(
    chamadas.migrationList,
    [],
    "nem na falha a loja OAuth cai no CLI",
  );
  assertEquals(o.chamadas.gestao, [], "sem token, nenhuma chamada à API");
});

Deno.test("loja OAuth SEM token no --depois-de-acordar com a release mudada: CRÍTICO (1), nunca OK, e nada cai no CLI", async () => {
  const o = extrasOAuth({ tokenOAuth: tokenSemRefresh() });
  const { d, chamadas } = deps({ extras: o.extras });
  const r = await executar(DEPOIS, d);
  assertEquals(r.codigo, 1);
  const erros = r.erros.join("\n");
  assertStringIncludes(erros, "CRÍTICO");
  assertStringIncludes(erros, "loja OAuth loja-teste não lida");
  assert(!erros.includes("OK:"), erros);
  assertEquals(chamadas.migrationList, []);
});

Deno.test("loja OAuth com cadastro INCOERENTE (o canal do ref aponta outro slug): NÃO acorda, nada dela é lido (nem pela API, nem pelo CLI)", async () => {
  const o = extrasOAuth({ cadastro: cadastroCom({ slug: "loja-torta" }) });
  const { d, chamadas } = deps({ extras: o.extras });
  const r = await executar(ACORDAR, d);
  assertEquals(r.codigo, 1);
  assert(!temPorta(r));
  assertStringIncludes(r.erros.join("\n"), "cadastro OAuth incoerente");
  assertEquals(chamadas.migrationList, []);
  assertEquals(o.chamadas.gestao, []);
  assertEquals(o.chamadas.token, []);
});

Deno.test("loja OAuth não pronta (a API mostra o ledger sem a migration nova): os comandos de conserto saem com o aviso de que só valem dentro de --sessao", async () => {
  const o = extrasOAuth({ ledger: [M1] });
  const { d, chamadas } = deps({
    release: { evidencia: false },
    extras: o.extras,
  });
  const r = await executar(ACORDAR, d);
  assertEquals(r.codigo, 1);
  assert(!temPorta(r));
  assertStringIncludes(r.erros.join("\n"), M2);
  assert(ghDe(r.saida).length >= 1, r.saida.join("\n"));
  assertEquals(r.saida[0], AVISO_DA_SESSAO_OAUTH);
  assertEquals(chamadas.migrationList, []);
  semCanario(r);
});

Deno.test("loja CLI (sem `acesso`, o padrão): o --acordar é IDÊNTICO ao de antes, mesmo com o cadastro e o acesso OAuth montados e outra loja OAuth (incoerente) no cadastro", async () => {
  for (const [nome, release] of [
    ["pronta", {}],
    ["sem a migration nova", { ledger: [M1], evidencia: false }],
    ["ledger ilegível", { falhaNoLedger: new Error("ECONNRESET") }],
  ]) {
    const antes = await executar(ACORDAR, deps({ release }).d);
    const o = extrasOAuth({
      cadastro: cadastroCom({
        acesso: "cli",
        extras: {
          "outra-loja": {
            ref: REF_OUTRA,
            classe: "assinante",
            apelido: "Outra",
            segredoDoToken: "SUPABASE_ACCESS_TOKEN_OUTRA_LOJA",
            functionsNomeadas: false,
            acesso: "oauth",
          },
        },
      }),
    });
    const { d, chamadas } = deps({ release, extras: o.extras });
    const r = await executar(ACORDAR, d);
    assertEquals(r, antes, nome);
    assertEquals(chamadas.migrationList, [REF], `${nome}: pelo CLI`);
    assertEquals(o.chamadas.gestao, [], nome);
    assertEquals(o.chamadas.token, [], nome);
  }
});

// ---------------------------------------------------------------- peças

Deno.test("literal: dobra a aspa simples, null vira null e caractere nulo é recusado", () => {
  assertEquals(literal("d'Ávila"), "'d''Ávila'");
  assertEquals(literal(null), "null");
  assertEquals(literal(undefined), "null");
  let erro = null;
  try {
    literal("a\0b");
  } catch (e) {
    erro = e;
  }
  assert(erro, "caractere nulo recusado");
  // Mesmo que um valor com aspas escapasse da validação, a instrução continua sendo UMA chamada.
  const sql = sqlDaPorta({
    loja: "x');drop table t;--",
    ref: REF,
    de: "ativa",
    para: "adormecida",
    sha: SHA_B,
    base: null,
    motivo: "m",
    confirmacao: null,
    validoAte: VALIDO_ATE,
  });
  assertStringIncludes(sql, "p_id => 'x'');drop table t;--'");
});

Deno.test("lerReleaseEmProducao: version.json de TODOS os endereços, no contrato e iguais; fora disso lança", async () => {
  const versao = (sha, extra = {}) =>
    JSON.stringify({
      version: `1.5.240-sha.${sha.slice(0, 7)}-identity.${IDENT}`,
      codeVersion: "1.5.240",
      codeSha: sha,
      identityRevision: IDENT,
      source: "database",
      promotable: true,
      ...extra,
    });
  const pedidos = [];
  const fetchDe = (porDominio) => async (url, init) => {
    pedidos.push({ url, init });
    const host = new URL(url).hostname;
    const r = porDominio[host];
    if (r instanceof Error) throw r;
    return new Response(r.corpo, { status: r.status ?? 200 });
  };
  const p = politicaBase();
  const ok = {
    "ickous-marketplace.vercel.app": { corpo: versao(SHA_B) },
    "savycollection.vercel.app": { corpo: versao(SHA_B) },
  };
  assertEquals(
    await lerReleaseEmProducao(p, { fetchImpl: fetchDe(ok), agora: AGORA }),
    SHA_B,
  );
  assertEquals(pedidos.length, 2);
  for (const x of pedidos) {
    assertEquals(x.init.cache, "no-store");
    assertEquals(x.init.redirect, "manual");
    assertStringIncludes(x.url, "/version.json?t=");
  }
  for (const [nome, porDominio] of [
    [
      "releases diferentes",
      { ...ok, "savycollection.vercel.app": { corpo: versao(SHA_A) } },
    ],
    [
      "HTTP 503",
      { ...ok, "savycollection.vercel.app": { corpo: "x", status: 503 } },
    ],
    ["não é JSON", { ...ok, "savycollection.vercel.app": { corpo: "<html>" } }],
    [
      "fora do contrato",
      {
        ...ok,
        "savycollection.vercel.app": {
          corpo: versao(SHA_B, { promotable: "true" }),
        },
      },
    ],
    [
      "rede",
      { ...ok, "savycollection.vercel.app": new TypeError("fetch failed") },
    ],
  ])
    await assertRejects(
      () =>
        lerReleaseEmProducao(p, {
          fetchImpl: fetchDe(porDominio),
          agora: AGORA,
        }),
      Error,
      undefined,
      nome,
    );
  await assertRejects(() =>
    lerReleaseEmProducao(
      { ...p, enderecosDeReserva: [] },
      { fetchImpl: fetchDe(ok) },
    ),
  );
});

// ---------------------------------------------------------------- prontidão de UMA loja (exportada do publicar-release)

Deno.test("contextoDaRelease + prontidaoDaLoja: UMA loja pronta não tem problema; com o ledger sem a migration nova, falta ela e o lote pede prova", async () => {
  const canais = canaisBase();
  const politica = politicaBase();
  const loja = {
    ref: REF,
    titulo: "Loja Teste",
    dominios: [],
    shasServidos: [SHA_A],
  };
  for (const [nome, ajuste, esperaPronta] of [
    ["pronta", {}, true],
    ["sem a migration nova", { ledger: [M1], evidencia: false }, false],
  ]) {
    const { d } = depsDaRelease(ajuste);
    const ctx = await contextoDaRelease({
      sha: SHA_B,
      politica,
      canais,
      deps: d,
    });
    assertEquals(ctx.requeridas, [M1, M2], nome);
    assertEquals(ctx.topo, TOPO);
    assertEquals(ctx.problemas, []);
    assertEquals(
      ctx.ctxConserto.nomesPorVersao.get(M2),
      `${M2}_a_loja_muda_de_estado_so_pela_porta.sql`,
    );
    const pront = await prontidaoDaLoja(loja, canais.canais[REF], {
      sha: SHA_B,
      deps: d,
      requeridas: ctx.requeridas,
      funcoesDoSha: ctx.funcoesDoSha,
      verifyJwt: ctx.verifyJwt,
      canais,
      agora: AGORA,
      topo: ctx.topo,
    });
    assertEquals(
      pront.problemas.length === 0,
      esperaPronta,
      `${nome}: ${pront.problemas.join("; ")}`,
    );
    assertEquals(pront.faltamMigrations, esperaPronta ? [] : [M2], nome);
    assertEquals(
      pront.funcoes.map((f) => f.estado),
      ["EM_DIA"],
      nome,
    );
  }
});

Deno.test("contextoDaRelease: topo ilegível vira problema (não exceção) e desliga as comparações de árvore", async () => {
  const { d } = depsDaRelease();
  d.topoDoRamo = async () => "nao-e-sha";
  const ctx = await contextoDaRelease({
    sha: SHA_B,
    politica: politicaBase(),
    canais: canaisBase(),
    deps: d,
  });
  assertEquals(ctx.topo, null);
  assertEquals(ctx.topoBancoIgual, false);
  assertEquals(ctx.topoFunctionsIgual, false);
  assertEquals(ctx.problemas.length, 1);
  assertStringIncludes(ctx.problemas[0].motivo, "não lido");
});
