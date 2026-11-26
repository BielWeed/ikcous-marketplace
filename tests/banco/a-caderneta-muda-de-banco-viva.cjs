"use strict";
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename --
 * Toda chave indexada vem de constante do próprio teste; os únicos caminhos de arquivo são os scripts da caderneta e as
 * migrations dentro do repositório. */
/**
 * PROVA VIVA da virada da caderneta da frota para outro banco (plano PLANO-CADERNETA-FORA-DO-DEKXAB-26-11, T1 a T4), contra
 * DOIS Postgres efêmeros com as migrations aplicadas do zero: a ORIGEM é o clone do rodar-isolado.cjs; o DESTINO é um segundo
 * banco criado do mesmo molde (CREATE DATABASE ... TEMPLATE) e apagado no fim. Nunca banco real.
 *
 * O DEFEITO: a caderneta (que diz a cada porteiro "este endereço é a loja X, banco Y") mora num banco antigo que pode pausar.
 * Ela vai ser copiada para o banco da IKCOUS. Uma linha errada na cópia tira uma loja do ar; a medição que compara os dois
 * bancos não pode escrever nem vazar a chave; e depois da cópia um rollback rodado no banco da IKCOUS não pode apagar a
 * caderneta de produção sem pergunta.
 *
 * O QUE SE PROVA:
 *   T1 (scripts/frota/banco-da-caderneta/caderneta-impressao-digital.sql): a MESMA caderneta nos dois bancos (gravada em outra
 *      ordem, lida com outro fuso) dá a MESMA digital; mudar UMA coisa (uma coluna de uma loja, um microssegundo, o estado, uma
 *      linha do histórico, o hash, o corpo de uma porta, um grant, uma coluna, o gatilho desligado, uma versão do ledger, um
 *      endereço que encaminha) muda SÓ o bloco dela; a saída nunca traz o hash, o atalho nem dado de loja (nem o endereço que
 *      encaminha); roda em transação só de leitura.
 *   T2 (copiar-caderneta-gerar.sql): gerado na origem (só leitura) e executado no destino, dá a digital IGUAL, exceto o atalho
 *      (que não viaja); as três portas do visitante (v1, v2 e a do encaminhamento) respondem igual nos dois, como anon, para todo
 *      endereço e chave; os endereços que encaminham chegam INTEIROS (com o quem e o criado_em da origem, nunca o padrão do
 *      destino); rodar duas vezes recusa sem gravar; a próxima linha de histórico do destino nasce depois do último id da origem.
 *      Recusa sem gravar: destino com linha em cada uma das quatro tabelas, sem os corpos da 20261490, sem as colunas do atalho,
 *      sem o gatilho, gatilho desligado, sem a tabela dos endereços (COPIA_DESTINO_SEM_CADERNETA), sem as portas da 20261570,
 *      com a tabela dos endereços em outra forma ou com o gatilho dela desligado, origem vazia; e a origem sem a 20261570 faz o
 *      gerador e a digital falharem na própria origem. Mutantes do gerador (sem a variável da porta, copiando o atalho, sem
 *      ajustar a sequência, sem a trava do destino vazio, sem copiar os endereços, endereços antes das lojas) caem cada um na
 *      guarda certa.
 *   T3/T4 (rollback-manual-20261141000000, rollback-manual-destrutivo-20261460000000 e -20261470000000): com a caderneta
 *      semeada, recusam (CADERNETA_SEMEADA) e nada some, mesmo com o APAGAR de cada arquivo e com a confirmação escrita
 *      errada; com ikcous.apagar_caderneta = 'sim', apagam; com qualquer UMA das três tabelas com linha, recusam nomeando-a;
 *      com a caderneta vazia (o banco de uma loja), apagam como antes.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/a-caderneta-muda-de-banco-viva.cjs
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const RAIZ = path.join(__dirname, "..", "..");
const lerArquivo = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const lerMig = (n) => lerArquivo(`supabase/migrations/${n}`);
const PASTA = "scripts/frota/banco-da-caderneta";
const DIGITAL = lerArquivo(`${PASTA}/caderneta-impressao-digital.sql`);
const GERADOR = lerArquivo(`${PASTA}/copiar-caderneta-gerar.sql`);

const NOME_1141 = "20261141000000_caderneta_da_frota.sql";
const NOME_1460 = "20261460000000_a_loja_tem_estado_de_vida.sql";
const NOME_1470 = "20261470000000_a_loja_muda_de_estado_so_pela_porta.sql";
const NOME_1490 =
  "20261490000000_a_caderneta_confere_a_chave_sem_bcrypt_por_chamada.sql";
const ROLLBACK_1141 = lerMig(`rollback-manual-${NOME_1141}`);
const ROLLBACK_1460 = lerMig(`rollback-manual-${NOME_1460}`);
const DESTRUTIVO_1460 = lerMig(`rollback-manual-destrutivo-${NOME_1460}`);
const ROLLBACK_1470 = lerMig(`rollback-manual-${NOME_1470}`);
const DESTRUTIVO_1470 = lerMig(`rollback-manual-destrutivo-${NOME_1470}`);
const ROLLBACK_1490 = lerMig(`rollback-manual-${NOME_1490}`);
const DESTRUTIVO_1490 = lerMig(`rollback-manual-destrutivo-${NOME_1490}`);
const MIGRATION_1490 = lerMig(NOME_1490);
const NOME_1570 = "20261570000000_o_endereco_antigo_encaminha_para_o_novo.sql";
const ROLLBACK_1570 = lerMig(`rollback-manual-${NOME_1570}`);
const DESTRUTIVO_1570 = lerMig(`rollback-manual-destrutivo-${NOME_1570}`);

const VERSOES = [
  "20261141000000",
  "20261460000000",
  "20261470000000",
  "20261480000000",
  "20261490000000",
  "20261570000000",
];
// Os corpos que a digital tem de ler num banco com as migrations do repositório (os mesmos md5 que os pré-voos conferem).
const MD5_DAS_FUNCOES = {
  resolver_loja: "0c60eb13c0016d2129b51def3ec7c255",
  resolver_loja_com_estado: "a30e752cff5ae4edc2db612866eb8bcd",
  frota_mudar_estado: "d1dd1ae579be7a6f5c8687ea039cb3b8",
  frota_lojas_estado_so_pela_porta: "58d85afbab0acb79eef70d03c304fb80",
  frota_enderecos_que_encaminham_nao_e_principal:
    "874d5af8ef1504daa9e602d6f991353a",
  resolver_encaminhamento: "5ca45d858b56991facb8d2052f0aecfb",
  frota_trocar_dominio: "5758ff83113e042fc927d83c254291bd",
};
// 11 de conteúdo (linhas e md5 de 4 tabelas, hash, atalho, sequência), 10 de tabela (forma e ACL de 4 tabelas e da sequência),
// 21 de função (corpo, atributos e ACL de 7), 6 do ledger.
const BLOCOS = 48;
const PORTA =
  "public.frota_mudar_estado(text, text, text, text, text, text, text, text, timestamptz)";
const LIGAR_A_PORTA =
  "SELECT set_config('ikcous.frota_estado_pela_porta', 'sim', true)";
const DESLIGAR_A_PORTA =
  "SELECT set_config('ikcous.frota_estado_pela_porta', '', true)";
const CONFIRMAR_CADERNETA = "SET LOCAL ikcous.apagar_caderneta = 'sim'";

// ---------------------------------------------------------------------------
// fixtures inventadas (repo público: nenhum domínio, ref nem chave real)
// ---------------------------------------------------------------------------
const CHAVE = "prova-cmb-chave-da-frota-inventada";
const ATALHO = crypto.createHash("sha256").update(CHAVE).digest("hex");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const REF = {
  ativa: "qazwsxedcrfvtgbyhnuj",
  dormindo: "plokmijnuhbygvtfcrdx",
  encerrada: "mnbvcxzlkjhgfdsapoiu",
  desligada: "zxcvbnmasdfghjklqwer",
};
const SHA_1 = "0123456789abcdef0123456789abcdef01234567";
const SHA_2 = "fedcba9876543210fedcba9876543210fedcba98";
const SHA_3 = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
for (const r of Object.values(REF)) assert.match(r, /^[a-z]{20}$/);
for (const s of [SHA_1, SHA_2, SHA_3]) assert.match(s, /^[0-9a-f]{40}$/);

const loja = (id, ref, estado, extra = {}) => ({
  id: `cmb-${id}`,
  nome: `Loja ${id} da prova da virada`,
  dominio_publico: `loja-${id}.exemplo.test`,
  project_ref: ref,
  supabase_url: `https://${ref}.supabase.co`,
  publishable_key: `pk_prova_cmb_${id}`,
  ativa: true,
  estado,
  estado_sha: null,
  created_at: "2026-09-11T10:00:00.123456+00:00",
  updated_at: "2026-10-01T12:30:00.5+00:00",
  estado_desde: "2026-11-20T08:00:00+00:00",
  ...extra,
});
const LOJAS = [
  loja("ativa", REF.ativa, "ativa"),
  loja("dormindo", REF.dormindo, "adormecida", { estado_sha: SHA_1 }),
  loja("encerrada", REF.encerrada, "encerrada", { estado_sha: SHA_2 }),
  loja("desligada", REF.desligada, "ativa", { ativa: false }),
];
const COLUNAS_LOJA = Object.keys(LOJAS[0]);
// Ids salteados (13 a 15 queimados por transação desfeita na origem): a sequência da origem está em 15.
const HISTORICO = [
  {
    id: 3,
    loja_id: "cmb-dormindo",
    project_ref: REF.dormindo,
    de: "ativa",
    para: "adormecida",
    sha: SHA_1,
    motivo: "por prova: parou de pagar",
    quem: "sessao-da-prova",
    em: "2026-11-20T08:00:00+00:00",
  },
  {
    id: 7,
    loja_id: "cmb-encerrada",
    project_ref: REF.encerrada,
    de: "ativa",
    para: "adormecida",
    sha: SHA_2,
    motivo: "por prova: parou de pagar",
    quem: "sessao-da-prova",
    em: "2026-11-21T09:15:00.25+00:00",
  },
  {
    id: 12,
    loja_id: "cmb-encerrada",
    project_ref: REF.encerrada,
    de: "adormecida",
    para: "encerrada",
    sha: SHA_2,
    motivo: "por prova: saiu da frota",
    quem: "sessao-da-prova",
    em: "2026-11-22T18:00:00+00:00",
  },
];
const COLUNAS_HISTORICO = Object.keys(HISTORICO[0]);
const SEQUENCIA_DA_ORIGEM = 15;
// Os endereços que encaminham (20261570): o quem e o criado_em NÃO são os padrões (session_user, now()) — a cópia que deixasse o
// destino preencher sozinho daria outra digital.
const endereco = (host, loja_id, motivo, criado_em) => ({
  host,
  loja_id,
  motivo,
  criado_em,
  quem: "sessao-da-prova-do-endereco",
});
const ENDERECOS = [
  endereco(
    "loja-ativa-antiga.exemplo.test",
    "cmb-ativa",
    "antigo",
    "2026-11-23T10:00:00.654321+00:00",
  ),
  endereco(
    "www.loja-ativa.exemplo.test",
    "cmb-ativa",
    "www",
    "2026-11-23T10:00:01+00:00",
  ),
  endereco(
    "loja-dormindo-nova.exemplo.test",
    "cmb-dormindo",
    "novo-em-preparo",
    "2026-11-24T08:30:00.5+00:00",
  ),
  endereco(
    "loja-desligada-antiga.exemplo.test",
    "cmb-desligada",
    "antigo",
    "2026-11-24T09:00:00+00:00",
  ),
];
const COLUNAS_ENDERECO = Object.keys(ENDERECOS[0]);
const TABELAS_DA_CADERNETA = [
  "frota_lojas",
  "frota_segredo",
  "frota_estado_historico",
  "frota_enderecos_que_encaminham",
];
const LINHAS_DA_CADERNETA =
  LOJAS.length + 1 + HISTORICO.length + ENDERECOS.length;

// ---------------------------------------------------------------------------
// apoio
// ---------------------------------------------------------------------------
const marcadores = (n) =>
  Array.from({ length: n }, (_, i) => `$${i + 1}`).join(", ");
let contaSavepoint = 0;
/** Roda `fn` num SAVEPOINT sempre desfeito; devolve o que `fn` devolveu. */
async function noSavepoint(c, fn) {
  const sp = `sp_cmb_${++contaSavepoint}`;
  await c.query(`SAVEPOINT ${sp}`);
  try {
    return await fn();
  } finally {
    await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await c.query(`RELEASE SAVEPOINT ${sp}`);
  }
}
/** Roda `fn` num SAVEPOINT sempre desfeito; devolve o erro (ou null). */
async function tentar(c, fn) {
  try {
    await noSavepoint(c, fn);
    return null;
  } catch (e) {
    return e;
  }
}
/** Roda `fn` numa transação SEMPRE desfeita. */
async function desfeita(c, fn) {
  await c.query("BEGIN");
  try {
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}
const sim = async (c, sql) => (await c.query(sql)).rows[0].sim === true;
async function linhasDaCaderneta(c) {
  let n = 0;
  for (const t of TABELAS_DA_CADERNETA) {
    const existe = await sim(
      c,
      `SELECT to_regclass('public.${t}') IS NOT NULL AS sim`,
    );
    if (existe)
      n += (await c.query(`SELECT count(*)::int AS n FROM public.${t}`)).rows[0]
        .n;
  }
  return n;
}

/** Grava a caderneta de prova DENTRO da transação do chamador (a porta do gatilho ligada só enquanto grava). */
async function semear(c, hash, { atalho = false, inverter = false } = {}) {
  await c.query(LIGAR_A_PORTA);
  await c.query(
    "INSERT INTO public.frota_segredo (id, hash, updated_at) VALUES (1, $1, '2026-09-11T10:00:00+00:00')",
    [hash],
  );
  if (atalho)
    await c.query(
      "UPDATE public.frota_segredo SET hash_rapido = $1, hash_rapido_de = hash WHERE id = 1",
      [ATALHO],
    );
  for (const l of inverter ? [...LOJAS].reverse() : LOJAS)
    await c.query(
      `INSERT INTO public.frota_lojas (${COLUNAS_LOJA.join(", ")}) VALUES (${marcadores(COLUNAS_LOJA.length)})`,
      COLUNAS_LOJA.map((k) => l[k]),
    );
  for (const h of inverter ? [...HISTORICO].reverse() : HISTORICO)
    await c.query(
      `INSERT INTO public.frota_estado_historico (${COLUNAS_HISTORICO.join(", ")}) OVERRIDING SYSTEM VALUE VALUES (${marcadores(COLUNAS_HISTORICO.length)})`,
      COLUNAS_HISTORICO.map((k) => h[k]),
    );
  for (const e of inverter ? [...ENDERECOS].reverse() : ENDERECOS)
    await c.query(
      `INSERT INTO public.frota_enderecos_que_encaminham (${COLUNAS_ENDERECO.join(", ")}) VALUES (${marcadores(COLUNAS_ENDERECO.length)})`,
      COLUNAS_ENDERECO.map((k) => e[k]),
    );
  await c.query(DESLIGAR_A_PORTA);
}

async function digital(c) {
  const r = await c.query(DIGITAL);
  const m = new Map(r.rows.map((l) => [l.bloco, l.valor]));
  assert.equal(m.size, r.rows.length, "digital: blocos sem repetição");
  assert.equal(m.size, BLOCOS, `digital: ${BLOCOS} blocos`);
  return m;
}
/** A digital numa transação SÓ DE LEITURA própria (qualquer escrita dela daria 25006). */
async function digitalSoLeitura(c) {
  await c.query("BEGIN TRANSACTION READ ONLY");
  try {
    return await digital(c);
  } finally {
    await c.query("ROLLBACK");
  }
}
const diferentes = (a, b) =>
  [...new Set([...a.keys(), ...b.keys()])]
    .filter((k) => a.get(k) !== b.get(k))
    .sort();

/** O CREATE OR REPLACE FUNCTION `nome` inteiro de uma migration (do CREATE até o `$$;`). */
function blocoDaFuncao(sql, nome) {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION ${nome}(`);
  assert(i >= 0, `${nome} não encontrada`);
  return sql.slice(i, sql.indexOf("$$;", sql.indexOf("AS $$", i)) + 3);
}

// ---------------------------------------------------------------------------
// T1: a impressão digital
// ---------------------------------------------------------------------------
const V2_OUTRO_CORPO = (() => {
  const original = blocoDaFuncao(
    MIGRATION_1490,
    "public.resolver_loja_com_estado",
  );
  const mudado = original.replace(
    "-- ativa = false continua",
    "-- ativa=false continua",
  );
  assert.notEqual(mudado, original, "o corpo trocado difere do original");
  return mudado;
})();
const DIVERGENCIAS = [
  [
    "uma coluna de uma loja (o nome)",
    [
      "UPDATE public.frota_lojas SET nome = nome || ' (outra)' WHERE id = 'cmb-ativa'",
    ],
    ["frota_lojas.conteudo"],
  ],
  [
    "um microssegundo no updated_at de uma loja",
    [
      "UPDATE public.frota_lojas SET updated_at = updated_at + interval '1 microsecond' WHERE id = 'cmb-dormindo'",
    ],
    ["frota_lojas.conteudo"],
  ],
  [
    "o estado de uma loja (pela variável da porta)",
    [
      LIGAR_A_PORTA,
      "UPDATE public.frota_lojas SET estado = 'ativa' WHERE id = 'cmb-dormindo'",
    ],
    ["frota_lojas.conteudo"],
  ],
  [
    "uma linha do histórico",
    [
      "UPDATE public.frota_estado_historico SET motivo = motivo || '.' WHERE id = 7",
    ],
    ["frota_estado_historico.conteudo"],
  ],
  [
    "o hash da chave",
    [
      "UPDATE public.frota_segredo SET hash = extensions.crypt('outra-chave', extensions.gen_salt('bf', 4)) WHERE id = 1",
    ],
    ["frota_segredo.hash"],
  ],
  [
    "o updated_at do segredo",
    [
      "UPDATE public.frota_segredo SET updated_at = updated_at + interval '1 second' WHERE id = 1",
    ],
    ["frota_segredo.conteudo"],
  ],
  [
    "o corpo de resolver_loja_com_estado (um espaço num comentário)",
    [V2_OUTRO_CORPO],
    ["funcao.resolver_loja_com_estado.corpo"],
  ],
  [
    "um grant na tabela",
    ["GRANT SELECT ON public.frota_lojas TO authenticated"],
    ["tabela.frota_lojas.acl"],
  ],
  [
    "um grant na porta do estado",
    [`GRANT EXECUTE ON FUNCTION ${PORTA} TO service_role`],
    ["funcao.frota_mudar_estado.acl"],
  ],
  [
    "uma coluna nova",
    ["ALTER TABLE public.frota_lojas ADD COLUMN sobra text"],
    ["frota_lojas.conteudo", "tabela.frota_lojas.forma"],
  ],
  [
    "o gatilho desligado",
    [
      "ALTER TABLE public.frota_lojas DISABLE TRIGGER frota_lojas_estado_so_pela_porta",
    ],
    ["tabela.frota_lojas.forma"],
  ],
  [
    "uma versão fora do ledger",
    [
      "DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261490000000'",
    ],
    ["ledger.20261490000000"],
  ],
  [
    "o motivo de um endereço que encaminha",
    [
      "UPDATE public.frota_enderecos_que_encaminham SET motivo = 'antigo' WHERE host = 'www.loja-ativa.exemplo.test'",
    ],
    ["frota_enderecos_que_encaminham.conteudo"],
  ],
  [
    "um microssegundo no criado_em de um endereço que encaminha",
    [
      "UPDATE public.frota_enderecos_que_encaminham SET criado_em = criado_em + interval '1 microsecond' WHERE host = 'loja-ativa-antiga.exemplo.test'",
    ],
    ["frota_enderecos_que_encaminham.conteudo"],
  ],
  [
    "um endereço que encaminha a mais",
    [
      "INSERT INTO public.frota_enderecos_que_encaminham (host, loja_id, motivo, criado_em, quem) VALUES ('mais-um.exemplo.test', 'cmb-ativa', 'antigo', '2026-11-24T10:00:00+00:00', 'x')",
    ],
    [
      "frota_enderecos_que_encaminham.conteudo",
      "frota_enderecos_que_encaminham.linhas",
    ],
  ],
  [
    "um grant na porta do encaminhamento",
    [
      "GRANT EXECUTE ON FUNCTION public.resolver_encaminhamento(text, text) TO authenticated",
    ],
    ["funcao.resolver_encaminhamento.acl"],
  ],
  [
    "o gatilho dos endereços desligado",
    [
      "ALTER TABLE public.frota_enderecos_que_encaminham DISABLE TRIGGER frota_enderecos_que_encaminham_nao_e_principal",
    ],
    ["tabela.frota_enderecos_que_encaminham.forma"],
  ],
  [
    "a 20261570 fora do ledger",
    [
      "DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261570000000'",
    ],
    ["ledger.20261570000000"],
  ],
];

async function impressaoDigital(origem, destino, hash) {
  await origem.query("BEGIN");
  await destino.query("BEGIN");
  try {
    await semear(origem, hash);
    await semear(destino, hash, { inverter: true });
    // O mesmo instante lido com outro fuso tem de dar o mesmo texto.
    await destino.query("SET LOCAL TimeZone = 'America/Sao_Paulo'");
    const a = await digital(origem);
    const b = await digital(destino);
    assert.deepEqual(
      diferentes(a, b),
      [],
      "a mesma caderneta (gravada em outra ordem, lida com outro fuso) dá a mesma digital",
    );
    assert.equal(a.get("frota_lojas.linhas"), String(LOJAS.length));
    assert.equal(a.get("frota_segredo.linhas"), "1");
    assert.equal(
      a.get("frota_estado_historico.linhas"),
      String(HISTORICO.length),
    );
    assert.equal(
      a.get("frota_enderecos_que_encaminham.linhas"),
      String(ENDERECOS.length),
    );
    assert.equal(a.get("frota_segredo.hash"), md5(hash));
    assert.equal(a.get("frota_segredo.hash_rapido_nulo"), "sim");
    assert.equal(a.get("frota_estado_historico.sequencia"), "nunca chamada");
    for (const [f, h] of Object.entries(MD5_DAS_FUNCOES))
      assert.equal(a.get(`funcao.${f}.corpo`), h, `corpo de ${f}`);
    for (const v of VERSOES)
      assert.equal(a.get(`ledger.${v}`), "registrada", `ledger ${v}`);

    // Mudar UMA coisa muda SÓ o bloco dela.
    for (const [rotulo, comandos, esperados] of DIVERGENCIAS) {
      const d = await noSavepoint(destino, async () => {
        for (const s of comandos) await destino.query(s);
        return digital(destino);
      });
      assert.deepEqual(diferentes(a, d), esperados, `diverge só em: ${rotulo}`);
    }

    // A saída nunca traz o hash, o atalho (nem em md5) nem dado de loja.
    const saida = await noSavepoint(destino, async () => {
      await destino.query(
        "UPDATE public.frota_segredo SET hash_rapido = $1, hash_rapido_de = hash WHERE id = 1",
        [ATALHO],
      );
      return (await destino.query(DIGITAL)).rows;
    });
    const texto = JSON.stringify(saida);
    assert(!texto.includes(hash), "o hash bcrypt não sai em claro");
    assert(!texto.includes(ATALHO), "o atalho não sai");
    assert(!texto.includes(md5(ATALHO)), "o atalho não sai nem em md5");
    for (const l of LOJAS)
      for (const k of [
        "id",
        "dominio_publico",
        "project_ref",
        "publishable_key",
      ])
        assert(!texto.includes(l[k]), `dado de loja não sai (${k})`);
    for (const e of ENDERECOS)
      assert(!texto.includes(e.host), "o endereço que encaminha não sai");
    assert.equal(
      new Map(saida.map((l) => [l.bloco, l.valor])).get(
        "frota_segredo.hash_rapido_nulo",
      ),
      "nao",
      "com o atalho gravado, o bloco diz que não é nulo",
    );

    // Só leitura: a transação vira READ ONLY e a digital roda igual (qualquer escrita dela daria 25006).
    await origem.query("SET TRANSACTION READ ONLY");
    assert.deepEqual(diferentes(await digital(origem), a), []);
  } finally {
    await origem.query("ROLLBACK");
    await destino.query("ROLLBACK");
  }
}

// ---------------------------------------------------------------------------
// T2: a cópia
// ---------------------------------------------------------------------------
/** A caderneta da origem, COMITADA, com o atalho gravado (como a de produção) e a sequência em 15. */
async function semearOrigem(origem, hash) {
  await origem.query("BEGIN");
  try {
    await semear(origem, hash, { atalho: true });
    await origem.query(
      "SELECT setval(pg_get_serial_sequence('public.frota_estado_historico', 'id'), $1, true)",
      [SEQUENCIA_DA_ORIGEM],
    );
    await origem.query("COMMIT");
  } catch (e) {
    await origem.query("ROLLBACK");
    throw e;
  }
}
/** Roda o gerador numa transação SÓ DE LEITURA (ele não pode escrever na origem) e devolve o texto. */
async function gerar(c, gerador = GERADOR) {
  await c.query("BEGIN TRANSACTION READ ONLY");
  try {
    const r = await c.query(gerador);
    assert.equal(r.rows.length, 1, "o gerador devolve UMA linha");
    assert.equal(typeof r.rows[0].script, "string", "com o texto");
    return r.rows[0].script;
  } finally {
    await c.query("ROLLBACK");
  }
}
const sqlDaPorta = (versao) =>
  `SELECT * FROM public.${versao}($1, $2) ORDER BY ${versao === "resolver_encaminhamento" ? "destino" : "id"}`;
/** Chama a porta como anon num SAVEPOINT (a chamada certa grava o atalho; aqui nada fica). */
async function comoAnon(c, versao, host, chave) {
  return noSavepoint(c, async () => {
    await c.query("SET LOCAL ROLE anon");
    return (await c.query(sqlDaPorta(versao), [host, chave])).rows;
  });
}

async function copiaConfere(origem, destino, gerador = GERADOR) {
  const script = await gerar(origem, gerador);
  const a = await digitalSoLeitura(origem);
  await destino.query("BEGIN");
  try {
    // Primeiro o texto roda (as guardas dele falam antes das deste teste).
    await destino.query(script);
    assert(!script.includes(ATALHO), "o atalho da chave não viaja no texto");
    const b = await digital(destino);
    assert.deepEqual(
      diferentes(a, b),
      ["frota_segredo.hash_rapido_nulo"],
      "a cópia é igual à origem, exceto o atalho",
    );
    assert.equal(a.get("frota_segredo.hash_rapido_nulo"), "nao");
    assert.equal(b.get("frota_segredo.hash_rapido_nulo"), "sim");
    assert.equal(
      b.get("frota_estado_historico.sequencia"),
      String(SEQUENCIA_DA_ORIGEM),
    );

    // As duas portas respondem igual nos dois bancos, como anon.
    await origem.query("BEGIN");
    try {
      for (const host of [
        ...LOJAS.map((l) => l.dominio_publico),
        ...ENDERECOS.map((e) => e.host),
        "LOJA-ATIVA.exemplo.test",
        "WWW.LOJA-ATIVA.exemplo.test",
        "nao-existe.exemplo.test",
      ])
        for (const chave of [CHAVE, "chave-errada", ""])
          for (const versao of [
            "resolver_loja",
            "resolver_loja_com_estado",
            "resolver_encaminhamento",
          ]) {
            const naOrigem = await comoAnon(origem, versao, host, chave);
            const noDestino = await comoAnon(destino, versao, host, chave);
            assert.deepEqual(
              noDestino,
              naOrigem,
              `${versao}(${host}, ${chave || "vazia"}) igual nos dois`,
            );
          }
    } finally {
      await origem.query("ROLLBACK");
    }
    assert.equal(
      (
        await comoAnon(
          destino,
          "resolver_loja_com_estado",
          "loja-dormindo.exemplo.test",
          CHAVE,
        )
      )
        .map((l) => [l.id, l.estado, l.supabase_url])
        .join("|"),
      "cmb-dormindo,adormecida,",
      "controle: a loja adormecida chega ao destino adormecida, sem URL",
    );
    assert.deepEqual(
      await comoAnon(
        destino,
        "resolver_encaminhamento",
        "loja-ativa-antiga.exemplo.test",
        CHAVE,
      ),
      [{ destino: "loja-ativa.exemplo.test" }],
      "controle: o endereço antigo encaminha, no destino, para o endereço atual da loja",
    );
    assert.deepEqual(
      (
        await destino.query(
          `SELECT ${COLUNAS_ENDERECO.join(", ")} FROM public.frota_enderecos_que_encaminham ORDER BY host COLLATE "C"`,
        )
      ).rows.map((r) => ({ ...r, criado_em: r.criado_em.toISOString() })),
      [...ENDERECOS]
        .sort((x, y) => (x.host < y.host ? -1 : 1))
        .map((e) => ({
          ...e,
          criado_em: new Date(e.criado_em).toISOString(),
        })),
      "controle: os endereços chegam inteiros (quem e criado_em da origem; o microssegundo a digital confere)",
    );

    // Rodar duas vezes: recusa e não grava nada.
    const e = await tentar(destino, () => destino.query(script));
    assert.match(
      e?.message ?? "(rodou de novo)",
      /COPIA_DESTINO_NAO_VAZIO/,
      "rodar duas vezes recusa",
    );
    assert.deepEqual(
      diferentes(b, await digital(destino)),
      [],
      "a segunda vez não gravou nada",
    );

    // A próxima linha de histórico no destino nasce depois do último id entregue na origem.
    await destino.query(
      `SELECT * FROM ${PORTA.replace(/\(.*$/, "")}($1, $2, 'ativa', 'adormecida', $3, NULL, 'por prova: depois da cópia', NULL,
              clock_timestamp() + interval '30 minutes')`,
      ["cmb-ativa", REF.ativa, SHA_3],
    );
    const nova = (
      await destino.query(
        "SELECT max(id)::int AS id FROM public.frota_estado_historico",
      )
    ).rows[0].id;
    assert(
      nova > SEQUENCIA_DA_ORIGEM,
      `a linha nova (${nova}) nasce depois do último id da origem (${SEQUENCIA_DA_ORIGEM})`,
    );
  } finally {
    await destino.query("ROLLBACK");
  }
}

const RECUSAS = [
  [
    "destino com uma loja",
    [
      `INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key)
       VALUES ('cmb-intrusa', 'x', 'intrusa.exemplo.test', '${REF.ativa}', 'x', 'x')`,
    ],
    /COPIA_DESTINO_NAO_VAZIO/,
  ],
  [
    "destino com o segredo",
    ["INSERT INTO public.frota_segredo (id, hash) VALUES (1, 'x')"],
    /COPIA_DESTINO_NAO_VAZIO/,
  ],
  [
    "destino com uma linha de histórico",
    [
      `INSERT INTO public.frota_estado_historico (loja_id, project_ref, de, para, sha, motivo)
       VALUES ('cmb-x', '${REF.ativa}', 'ativa', 'adormecida', '${SHA_3}', 'por prova')`,
    ],
    /COPIA_DESTINO_NAO_VAZIO/,
  ],
  [
    "destino sem a 20261490 (as portas voltaram aos corpos da 20261460)",
    [ROLLBACK_1490],
    /COPIA_PORTAS_DIVERGENTES/,
  ],
  [
    "destino sem as colunas do atalho",
    [
      ROLLBACK_1490,
      "SET LOCAL app.confirmo_apagar_atalho_da_chave_da_frota = 'APAGAR'",
      DESTRUTIVO_1490,
    ],
    /COPIA_FORMA_DIVERGENTE: public\.frota_segredo/,
  ],
  [
    "destino sem o gatilho",
    ["DROP TRIGGER frota_lojas_estado_so_pela_porta ON public.frota_lojas"],
    /COPIA_GATILHO_AUSENTE/,
  ],
  [
    "destino com o gatilho desligado",
    [
      "ALTER TABLE public.frota_lojas DISABLE TRIGGER frota_lojas_estado_so_pela_porta",
    ],
    /COPIA_GATILHO_AUSENTE/,
  ],
  [
    "destino sem a tabela dos endereços que encaminham (comum e destrutivo da 20261570)",
    [
      ROLLBACK_1570,
      "SET LOCAL app.confirmo_apagar_enderecos_que_encaminham = 'APAGAR'",
      DESTRUTIVO_1570,
    ],
    /COPIA_DESTINO_SEM_CADERNETA/,
  ],
  [
    "destino sem as portas da 20261570 (só o comum: a tabela ficou)",
    [ROLLBACK_1570],
    /COPIA_PORTAS_DIVERGENTES/,
  ],
  [
    "destino com a tabela dos endereços em outra forma",
    ["ALTER TABLE public.frota_enderecos_que_encaminham ADD COLUMN sobra text"],
    /COPIA_FORMA_DIVERGENTE: public\.frota_enderecos_que_encaminham/,
  ],
  [
    "destino com o gatilho dos endereços desligado",
    [
      "ALTER TABLE public.frota_enderecos_que_encaminham DISABLE TRIGGER frota_enderecos_que_encaminham_nao_e_principal",
    ],
    /COPIA_GATILHO_AUSENTE/,
  ],
  [
    // A chave estrangeira impede um endereço sem loja; o modo réplica a desliga SÓ para plantar a linha (as outras três tabelas
    // ficam vazias: é a trava dos endereços, e só ela, que tem de recusar).
    "destino com um endereço que encaminha (e nenhuma loja)",
    [
      "SET LOCAL session_replication_role = replica",
      "INSERT INTO public.frota_enderecos_que_encaminham (host, loja_id, motivo) VALUES ('intruso.exemplo.test', 'cmb-fantasma', 'antigo')",
      "SET LOCAL session_replication_role = origin",
    ],
    /COPIA_DESTINO_NAO_VAZIO/,
  ],
];
async function recusas(origem, destino) {
  const script = await gerar(origem);
  for (const [rotulo, preparo, esperado] of RECUSAS)
    await desfeita(destino, async () => {
      for (const s of preparo) await destino.query(s);
      const antes = await linhasDaCaderneta(destino);
      const e = await tentar(destino, () => destino.query(script));
      assert.match(e?.message ?? "(copiou)", esperado, rotulo);
      assert.equal(
        await linhasDaCaderneta(destino),
        antes,
        `${rotulo}: nada gravado`,
      );
    });
  // O gerador rodado no banco errado (sem caderneta semeada): o texto recusa em qualquer destino.
  const doBancoVazio = await gerar(destino);
  await desfeita(destino, async () => {
    const e = await tentar(destino, () => destino.query(doBancoVazio));
    assert.match(
      e?.message ?? "(copiou)",
      /COPIA_ORIGEM_VAZIA/,
      "origem vazia recusa",
    );
    assert.equal(await linhasDaCaderneta(destino), 0);
  });
  // A origem sem a 20261570 (a tabela dos endereços não existe lá): o gerador e a digital falham NA ORIGEM, antes de haver texto
  // para o destino — a cópia nunca sai sem os endereços por esquecimento.
  await desfeita(origem, async () => {
    for (const s of [
      ROLLBACK_1570,
      "SET LOCAL app.confirmo_apagar_enderecos_que_encaminham = 'APAGAR'",
      CONFIRMAR_CADERNETA,
      DESTRUTIVO_1570,
    ])
      await origem.query(s);
    for (const [rotulo, sql] of [
      ["o gerador", GERADOR],
      ["a digital", DIGITAL],
    ]) {
      const e = await tentar(origem, () => origem.query(sql));
      assert.match(
        e?.message ?? "(rodou)",
        /relation "public\.frota_enderecos_que_encaminham" does not exist/,
        `${rotulo} na origem sem a 20261570 falha`,
      );
    }
  });
  return RECUSAS.length + 3;
}

/** Cada mutante do GERADOR tem de cair na guarda certa. */
const MUTANTES = [
  [
    "sem ligar a variável da porta: o gatilho recusa a loja adormecida",
    ["SET LOCAL ikcous.frota_estado_pela_porta = 'sim';", ""],
    /FROTA_ESTADO_SO_PELA_PORTA/,
  ],
  [
    "copiando o atalho da chave: o pós-voo recusa",
    [
      "WHERE NOT (v.tabela = 'frota_segredo' AND a.attname IN ('hash_rapido', 'hash_rapido_de'))",
      "",
    ],
    /POSVOO_COPIAR_CADERNETA: o atalho da chave/,
  ],
  [
    "sem ajustar a sequência: o pós-voo recusa",
    [
      "CASE WHEN m.sequencia > 0 THEN m.sequencia || ', true' ELSE '1, false' END",
      "'1, false'",
    ],
    /POSVOO_COPIAR_CADERNETA: a sequência/,
  ],
  [
    "sem copiar os endereços que encaminham: o pós-voo recusa",
    [
      "  || COALESCE((SELECT i.sql FROM insercoes i WHERE i.tabela = 'frota_enderecos_que_encaminham'), '')\n",
      "",
    ],
    /POSVOO_COPIAR_CADERNETA: as contagens/,
  ],
  [
    "os endereços antes das lojas: a chave estrangeira recusa",
    [
      `  || COALESCE((SELECT i.sql FROM insercoes i WHERE i.tabela = 'frota_lojas'), '')
  || COALESCE((SELECT i.sql FROM insercoes i WHERE i.tabela = 'frota_estado_historico'), '')
  || COALESCE((SELECT i.sql FROM insercoes i WHERE i.tabela = 'frota_enderecos_que_encaminham'), '')
`,
      `  || COALESCE((SELECT i.sql FROM insercoes i WHERE i.tabela = 'frota_enderecos_que_encaminham'), '')
  || COALESCE((SELECT i.sql FROM insercoes i WHERE i.tabela = 'frota_lojas'), '')
  || COALESCE((SELECT i.sql FROM insercoes i WHERE i.tabela = 'frota_estado_historico'), '')
`,
    ],
    /frota_enderecos_que_encaminham_loja_id_fkey/,
  ],
  [
    "sem a trava do destino vazio: rodar duas vezes já não recusa pela trava",
    [
      `IF EXISTS (SELECT 1 FROM public.frota_lojas) OR EXISTS (SELECT 1 FROM public.frota_segredo) OR EXISTS (SELECT 1 FROM public.frota_estado_historico)
     OR EXISTS (SELECT 1 FROM public.frota_enderecos_que_encaminham) THEN`,
      "IF false THEN",
    ],
    /rodar duas vezes recusa/,
  ],
];
async function mutantes(origem, destino) {
  let mortos = 0;
  for (const [rotulo, [de, para], esperado] of MUTANTES) {
    assert.equal(GERADOR.split(de).length, 2, `mutante "${rotulo}": um alvo`);
    const mutante = GERADOR.replace(de, para);
    const e = await copiaConfere(origem, destino, mutante).then(
      () => null,
      (erro) => erro,
    );
    assert.match(e?.message ?? "(o mutante passou)", esperado, rotulo);
    mortos++;
  }
  return mortos;
}

// ---------------------------------------------------------------------------
// T3/T4: os rollbacks que apagam a caderneta
// ---------------------------------------------------------------------------
const QUE_APAGAM = [
  {
    nome: "rollback da 20261141 (apaga frota_lojas e frota_segredo)",
    // A sucessora 20261570 sai antes (comum + destrutivo confirmado): a chave estrangeira dela depende de frota_lojas e o DROP sem
    // CASCADE recusaria. As duas confirmações são desligadas logo depois, para o rollback da 20261141 decidir sozinho.
    antes: [
      ROLLBACK_1570,
      "SET LOCAL app.confirmo_apagar_enderecos_que_encaminham = 'APAGAR'",
      CONFIRMAR_CADERNETA,
      DESTRUTIVO_1570,
      "SET LOCAL ikcous.apagar_caderneta = ''",
      "SET LOCAL app.confirmo_apagar_enderecos_que_encaminham = ''",
    ],
    arquivo: ROLLBACK_1141,
    // O destrutivo da 20261570 (confirmado) já levou os endereços: sobram as três tabelas de antes.
    linhas: LINHAS_DA_CADERNETA - ENDERECOS.length,
    existe:
      "SELECT to_regclass('public.frota_lojas') IS NOT NULL AND to_regclass('public.frota_segredo') IS NOT NULL AS sim",
  },
  {
    nome: "destrutivo da 20261460 (apaga o estado de cada loja)",
    // A ordem da casa: a sucessora 20261490 (comum), a 20261470 (comum: o gatilho depende das colunas) e a comum desta.
    antes: [
      ROLLBACK_1490,
      ROLLBACK_1470,
      ROLLBACK_1460,
      "SET LOCAL app.confirmo_apagar_estado_de_vida = 'APAGAR'",
    ],
    arquivo: DESTRUTIVO_1460,
    linhas: LINHAS_DA_CADERNETA,
    existe:
      "SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.frota_lojas'::regclass AND attname = 'estado' AND NOT attisdropped) AS sim",
  },
  {
    nome: "destrutivo da 20261470 (apaga o histórico)",
    antes: [
      ROLLBACK_1470,
      "SET LOCAL app.confirmo_apagar_historico_do_estado_da_loja = 'APAGAR'",
    ],
    arquivo: DESTRUTIVO_1470,
    linhas: LINHAS_DA_CADERNETA,
    existe:
      "SELECT to_regclass('public.frota_estado_historico') IS NOT NULL AS sim",
  },
];
const UMA_LINHA = {
  frota_lojas: `INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key)
                VALUES ('cmb-so', 'x', 'so.exemplo.test', '${REF.ativa}', 'x', 'x')`,
  frota_segredo: "INSERT INTO public.frota_segredo (id, hash) VALUES (1, 'x')",
  frota_estado_historico: `INSERT INTO public.frota_estado_historico (loja_id, project_ref, de, para, sha, motivo)
                           VALUES ('cmb-so', '${REF.ativa}', 'ativa', 'adormecida', '${SHA_3}', 'por prova')`,
};
async function rollbacksQueApagam(origem, destino) {
  let casos = 0;
  for (const q of QUE_APAGAM) {
    // Caderneta semeada (a origem, comitada): recusa e nada some — com o APAGAR do arquivo e com a confirmação escrita errada.
    await desfeita(origem, async () => {
      for (const s of q.antes) await origem.query(s);
      for (const errada of [null, "SIM", "true"]) {
        const e = await tentar(origem, async () => {
          if (errada !== null)
            await origem.query(
              `SET LOCAL ikcous.apagar_caderneta = '${errada}'`,
            );
          await origem.query(q.arquivo);
        });
        assert.match(
          e?.message ?? "(apagou)",
          /CADERNETA_SEMEADA: public\.frota_lojas tem linha/,
          `${q.nome}: caderneta semeada recusa (confirmação ${errada ?? "ausente"})`,
        );
        assert.equal(await sim(origem, q.existe), true, `${q.nome}: nada some`);
        assert.equal(
          await linhasDaCaderneta(origem),
          q.linhas,
          `${q.nome}: nenhuma linha some`,
        );
        casos++;
      }
      // Só com o dono: a confirmação explícita na transação.
      await origem.query(CONFIRMAR_CADERNETA);
      await origem.query(q.arquivo);
      assert.equal(
        await sim(origem, q.existe),
        false,
        `${q.nome}: com ikcous.apagar_caderneta = 'sim', apaga`,
      );
      casos++;
    });
    // Qualquer UMA das três tabelas com linha recusa, nomeando-a.
    for (const [tabela, insere] of Object.entries(UMA_LINHA)) {
      await desfeita(destino, async () => {
        for (const s of q.antes) await destino.query(s);
        await destino.query(insere);
        const e = await tentar(destino, () => destino.query(q.arquivo));
        assert.ok(
          (e?.message ?? "(apagou)").includes(
            `CADERNETA_SEMEADA: public.${tabela} tem linha`,
          ),
          `${q.nome}: só ${tabela} com linha recusa (veio: ${e?.message ?? "apagou"})`,
        );
        assert.equal(await sim(destino, q.existe), true);
      });
      casos++;
    }
    // Caderneta vazia (o banco de uma loja): apaga como antes, sem confirmação nenhuma.
    await desfeita(destino, async () => {
      assert.equal(await linhasDaCaderneta(destino), 0, "o destino está vazio");
      for (const s of q.antes) await destino.query(s);
      await destino.query(q.arquivo);
      assert.equal(
        await sim(destino, q.existe),
        false,
        `${q.nome}: caderneta vazia apaga como antes`,
      );
    });
    casos++;
  }
  return casos;
}

// ---------------------------------------------------------------------------
// os dois bancos
// ---------------------------------------------------------------------------
async function comAdmin(url, fn) {
  const u = new URL(url);
  u.pathname = "/template1";
  const admin = new Client({ connectionString: u.toString() });
  await admin.connect();
  try {
    return await fn(admin);
  } finally {
    await admin.end().catch(() => {});
  }
}
const nomeDoBanco = (url) =>
  decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
/** O DESTINO: um segundo banco do mesmo molde da origem (ninguém conectado nela ainda). */
async function criarDestino(url) {
  const base = nomeDoBanco(url);
  const nome = `${base}_destino`;
  assert(nome.length <= 63, "nome do banco de destino cabe no limite");
  await comAdmin(url, async (a) => {
    await a.query(`DROP DATABASE IF EXISTS "${nome}"`);
    await a.query(`CREATE DATABASE "${nome}" TEMPLATE "${base}"`);
  });
  const u = new URL(url);
  u.pathname = `/${nome}`;
  return { nome, url: u.toString() };
}
// O ledger do Supabase não existe no efêmero (aplicar-migrations.cjs não o grava): a prova o cria com as 5 versões.
const LEDGER = `CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY);
INSERT INTO supabase_migrations.schema_migrations (version) VALUES ${VERSOES.map((v) => `('${v}')`).join(", ")} ON CONFLICT DO NOTHING;`;

async function main() {
  const url = lerDatabaseUrlEfemera();
  const dest = await criarDestino(url);
  const origem = new Client({ connectionString: url });
  const destino = new Client({ connectionString: dest.url });
  let provas = 0;
  const provar = async (nome, fn) => {
    const r = await fn();
    provas++;
    console.log(`  ok ${provas}: ${nome}`);
    return r;
  };
  try {
    await origem.connect();
    await destino.connect();
    for (const c of [origem, destino]) await c.query(LEDGER);
    for (const c of [origem, destino])
      assert.equal(
        await linhasDaCaderneta(c),
        0,
        "os dois bancos começam com a caderneta vazia",
      );
    const hash = (
      await origem.query(
        "SELECT extensions.crypt($1, extensions.gen_salt('bf', 4)) AS h",
        [CHAVE],
      )
    ).rows[0].h;

    await provar(
      `T1: mesma caderneta = mesma digital; ${DIVERGENCIAS.length} mudanças, cada uma só no seu bloco; sem hash, atalho nem dado de loja; só leitura`,
      () => impressaoDigital(origem, destino, hash),
    );
    await semearOrigem(origem, hash);
    await provar(
      "T1: a digital da caderneta comitada roda em transação READ ONLY",
      async () => {
        const a = await digitalSoLeitura(origem);
        assert.equal(
          a.get("frota_estado_historico.sequencia"),
          String(SEQUENCIA_DA_ORIGEM),
        );
        assert.equal(a.get("frota_segredo.hash_rapido_nulo"), "nao");
      },
    );
    await provar(
      "T2: gerada na origem (só leitura), a cópia dá a mesma digital (menos o atalho), as portas respondem igual, 2x recusa, histórico continua",
      () => copiaConfere(origem, destino),
    );
    const nRecusas = await provar(
      "T2: recusas sem gravar (destino com linha, sem 20261490, sem atalho, sem gatilho, origem vazia)",
      () => recusas(origem, destino),
    );
    const mortos = await provar("T2: mutantes do gerador", () =>
      mutantes(origem, destino),
    );
    const casos = await provar(
      "T3/T4: rollback da 20261141 e destrutivos da 20261460 e 20261470 recusam caderneta com linha; apagam vazia ou confirmada",
      () => rollbacksQueApagam(origem, destino),
    );
    console.log(
      `\na-caderneta-muda-de-banco-viva: ${provas} provas ok; ${DIVERGENCIAS.length} divergências; ${nRecusas} recusas; ${mortos} mutantes mortos; ${casos} casos de rollback`,
    );
    anexarAoSummary(
      "A caderneta muda de banco (PG17)",
      `${provas} provas em dois bancos; ${DIVERGENCIAS.length} divergências da digital, ${nRecusas} recusas da cópia, ${mortos} mutantes do gerador mortos, ${casos} casos dos rollbacks que apagam a caderneta.`,
    );
  } finally {
    await origem.end().catch(() => {});
    await destino.end().catch(() => {});
    await comAdmin(url, (a) =>
      a.query(`DROP DATABASE IF EXISTS "${dest.nome}"`),
    ).catch(() => {});
  }
}
main().catch((e) => falhar("A_CADERNETA_MUDA_DE_BANCO", e.stack || e.message));
