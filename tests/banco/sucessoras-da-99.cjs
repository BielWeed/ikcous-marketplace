"use strict";

/**
 * As SUCESSORAS da 20261199000000_portas_do_painel_exigem_admin_atual.sql: as
 * migrations posteriores que redefinem um dos 42 corpos que a 99 deixa.
 *
 * POR QUE ISTO EXISTE: as provas que fixam os corpos da 99 (admin-atual-portas-
 * viva, admin-atual-viva, pagamentos-rpc-viva) medem o estado "99 no ar" — o
 * hash de cada corpo, reaplicar a 99, o rollback dela. O rollback-manual da 99
 * RECUSA (B1_BASELINE_DIVERGENT, rollback-manual-20261199000000…:93) enquanto
 * uma redefinição posterior estiver no ar, e é o comportamento CERTO. Então,
 * antes de medir a 99 isolada, a prova desfaz as sucessoras — cada uma pelo
 * próprio rollback-manual, na ordem INVERSA da aplicação, e só se o corpo
 * "desta" dela estiver no ar.
 *
 * A LISTA É FECHADA E VIGIADA: `conferirLista()` varre supabase/migrations e
 * falha se uma migration mais nova que a 99 redefinir um dos 42 sem estar
 * aqui (a próxima sucessora entra sozinha na falha, não no silêncio).
 *
 * Os hashes vêm do PREFLIGHT de cada sucessora — `('public.f(...)', 'vigente',
 * 'desta')`; a prova de texto de cada uma amarra os dois ao md5 real.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos são montados de literais deste arquivo (a pasta de migrations do
 * repositório e os nomes da lista), nunca de entrada de rede nem de terceiro. */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const DIR_MIGRATIONS = path.join(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
const NOME_99 = "20261199000000_portas_do_painel_exigem_admin_atual.sql";

// Na ordem de APLICAÇÃO (a de nome de arquivo).
const NOMES = [
  "20261212000000_o_inicio_conta_estoque_baixo_pela_regra_da_loja.sql",
  "20261214000000_o_lucro_do_estoque_so_conta_produto_com_custo.sql",
  // Os números do painel (14/10/2026): crm_visao sucede o corpo da 99; painel_inicio
  // sucede o da 20261212 (a CADEIA 99 → 12 → 28: o `hashVigente` da 28 é o `hashDesta`
  // da 12, e desfazer em ordem inversa devolve cada corpo ao anterior).
  "20261227000000_o_crm_compara_o_que_e_comparavel.sql",
  "20261228000000_o_inicio_compara_ate_a_mesma_hora.sql",
  // A busca de clientes (14/10/2026): get_admin_customers_paged (por número do WhatsApp) e
  // crm_clientes (sem acento) sucedem, cada uma, o corpo da 99.
  "20261230000000_a_busca_de_clientes_acha_pelo_numero_do_whatsapp.sql",
  "20261231000000_a_busca_do_crm_ignora_acento.sql",
  // A grade do CRM (14/10/2026): crm_visao ganha a SEGUNDA sucessora (a CADEIA 99 → 27 → 32: o
  // `hashVigente` da 32 é o `hashDesta` da 27; desfazer em ordem inversa devolve cada corpo ao anterior).
  "20261232000000_a_grade_do_crm_mede_a_recencia_do_mesmo_instante_da_lista.sql",
  // O lucro só conta produto com custo (14/10/2026): get_admin_analytics_v2 sucede o corpo da 14
  // (a CADEIA 99 → 14 → 34: o `hashVigente` da 34 é o `hashDesta` da 14; desfazer em ordem inversa
  // devolve cada corpo ao anterior).
  "20261234000000_o_lucro_so_conta_produto_com_custo.sql",
  // A venda repetida do balcão (14/10/2026): registrar_venda_presencial sucede o corpo da 99 (trava consultiva
  // pela chave de idempotência antes de conferir a chave).
  "20261235000000_a_venda_repetida_do_balcao_devolve_a_venda_feita.sql",
  // A identidade legal da loja (14/10/2026): upsert_store_config passa a gravar razão social, documento e e-mail
  // de atendimento; sucede o corpo da 99 (hashVigente = o `hashDesta` da 99 para essa função).
  "20261239000000_a_loja_declara_quem_e_na_nota_e_como_falar_com_ela.sql",
  // O lucro usa o custo do dia da venda (15/10/2026): DUAS funções numa migration só (a tabela do custo do dia, o
  // gatilho e os dois corpos caem juntos ou não caem): get_admin_analytics_v2 sucede o corpo da 34 (a CADEIA
  // 99 → 14 → 34 → 42) e fin_dre sucede o corpo da 99 (99 → 42). Uma entrada por função, o mesmo rollback.
  "20261242000000_o_lucro_usa_o_custo_do_dia_da_venda.sql",
  // Como a loja entrega na cidade dela (15/10/2026): TRES funcoes numa migration so (v23, v24 e upsert_store_config).
  // So o upsert e um dos 42 da 99 (a CADEIA 99 -> 39 -> 44: o `hashVigente` da 44 e o `hashDesta` da 39); v23 e v24 entram
  // porque o rollback desfaz as tres de uma vez e a conferencia "devolveu o corpo anterior" vale para cada uma.
  "20261244000000_a_loja_escolhe_como_entrega_na_cidade.sql",
  // A 246 sucede fin_lancamento_salvar da 99; rollback preserva a tabela privada.
  "20261246000000_o_lancamento_repetido_nao_duplica.sql",
];
// Quantos pares (vigente, desta) o preflight de cada migration cita: UM, salvo as que redefinem mais de uma
// função (a mesma migration vira uma entrada por função; o rollback-manual dela desfaz todas de uma vez).
const PARES_POR_MIGRATION = new Map([
  ["20261242000000_o_lucro_usa_o_custo_do_dia_da_venda.sql", 2],
  ["20261244000000_a_loja_escolhe_como_entrega_na_cidade.sql", 3],
]);

const ler = (nome) => fs.readFileSync(path.join(DIR_MIGRATIONS, nome), "utf8");
const RE_PAR_DE_HASHES =
  /\('(public\.[a-z_0-9]+\([^)]*\))', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/g;

/** As 42 assinaturas que a 99 redefine (as do preflight dela, com dois hashes). */
function assinaturasDa99() {
  return [...ler(NOME_99).matchAll(RE_PAR_DE_HASHES)].map((m) => m[1]);
}

const SUCESSORAS_DA_99 = NOMES.flatMap((nome) => {
  const pares = [...ler(nome).matchAll(RE_PAR_DE_HASHES)];
  const esperados = PARES_POR_MIGRATION.get(nome) ?? 1;
  assert.equal(
    pares.length,
    esperados,
    `${nome}: o preflight tem de citar ${esperados} par(es) (vigente, desta)`,
  );
  return pares.map(([, assinatura, hashVigente, hashDesta]) => ({
    nome,
    rollback: `rollback-manual-${nome}`,
    assinatura,
    hashVigente,
    hashDesta,
    // "No ar" = o corpo vivo é exatamente o que a sucessora deixa.
    noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, E'\\r', '')) FROM pg_proc
                             WHERE oid = to_regprocedure('${assinatura}')) = '${hashDesta}', false) AS sim`,
  }));
});

/** Falha se uma migration mais nova que a 99 redefine um dos 42 sem estar na lista. */
function conferirLista() {
  const nomes42 = assinaturasDa99().map((a) =>
    a.slice("public.".length, a.indexOf("(")),
  );
  assert.equal(nomes42.length, 42, "a 99 deixou de listar 42 corpos");
  const foraDaLista = [];
  for (const arquivo of fs.readdirSync(DIR_MIGRATIONS).sort()) {
    if (!/^\d{14}_.*\.sql$/.test(arquivo)) continue;
    if (arquivo.slice(0, 14) <= NOME_99.slice(0, 14)) continue;
    const semComentarios = ler(arquivo)
      .split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n");
    // Toda grafia que o Postgres aceita para a mesma função: `public.f(`,
    // `"public"."f"(`, `f(` sem esquema (search_path) e espaço antes do `(`.
    // O nome inteiro até o `(` (com ou sem aspas e esquema), normalizado
    // depois: sem aspas, minúsculo, sem o `public.`; outro esquema não conta.
    const criadas = [
      ...semComentarios.matchAll(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+([^\s(]+)\s*\(/gi,
      ),
      ...semComentarios.matchAll(/CREATE\s+FUNCTION\s+([^\s(]+)\s*\(/gi),
    ]
      .map((m) => m[1].replace(/"/g, "").toLowerCase())
      .map((n) => (n.startsWith("public.") ? n.slice("public.".length) : n))
      .filter((n) => !n.includes("."));
    const redefine = nomes42.filter((n) => criadas.includes(n));
    if (redefine.length > 0 && !NOMES.includes(arquivo)) {
      foraDaLista.push(`${arquivo} (${redefine.join(", ")})`);
    }
  }
  assert.deepEqual(
    foraDaLista,
    [],
    `migration posterior à 99 redefine corpo dela e não está em tests/banco/sucessoras-da-99.cjs: ${foraDaLista.join("; ")}`,
  );
  for (const s of SUCESSORAS_DA_99) {
    assert.ok(
      fs.existsSync(path.join(DIR_MIGRATIONS, s.rollback)),
      `${s.rollback} ausente`,
    );
  }
}

async function hashVivo(c, assinatura) {
  const r = await c.query(
    `SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)`,
    [assinatura],
  );
  return r.rows[0] ? r.rows[0].h : null;
}

// A migration do custo do dia (20261242): o rollback-manual dela DEIXA a tabela com os registros (o custo do dia nao
// se reconstroi); so o rollback-destrutivo, a parte e so com o dono, a apaga. Desfazer a cadeia aqui nao toca nos dados.
const NOME_CUSTO_DO_DIA =
  "20261242000000_o_lucro_usa_o_custo_do_dia_da_venda.sql";

/**
 * Devolve o clone ao estado ANTERIOR à migration do custo do dia (20261242): o analytics volta ao corpo da
 * 20261234 e o fin_dre ao da 99. Para as provas de migrations ANTERIORES (14, 34, 12...), que medem o corpo da
 * própria migration e cujo rollback-manual recusa com uma redefinição posterior no ar. Não faz nada se a 42 não
 * estiver no ar (idempotente). Devolve true se desfez.
 */
async function devolverAoEstadoAnteriorAoCustoDoDia(c) {
  const alvo = SUCESSORAS_DA_99.find((s) => s.nome === NOME_CUSTO_DO_DIA);
  assert.ok(alvo, "a migration do custo do dia sumiu da lista de sucessoras");
  if ((await hashVivo(c, alvo.assinatura)) !== alvo.hashDesta) return false;
  await c.query(ler(alvo.rollback));
  return true;
}

/**
 * Desfaz as sucessoras no ar, na ordem inversa da aplicação, cada uma pelo
 * rollback-manual dela (que tem preflight próprio). Devolve os nomes desfeitos
 * (um por ENTRADA: uma migration de duas funções aparece duas vezes, uma ao lado da outra).
 * Quem chama decide a transação: dentro de BEGIN/ROLLBACK o estado volta; no
 * clone do rodar-isolado.cjs, fica.
 */
async function desfazerSucessorasDa99(c) {
  conferirLista();
  const desfeitas = [];
  const desfeitasNestaChamada = new Set();
  for (const s of [...SUCESSORAS_DA_99].reverse()) {
    if (desfeitasNestaChamada.has(s.nome)) {
      // A irmã (mesma migration, outra função) foi devolvida junto pelo mesmo rollback: confere e conta.
      assert.equal(
        await hashVivo(c, s.assinatura),
        s.hashVigente,
        `${s.rollback} não devolveu o corpo de ${s.assinatura}`,
      );
      desfeitas.push(s.nome);
      continue;
    }
    if ((await hashVivo(c, s.assinatura)) !== s.hashDesta) continue;
    await c.query(ler(s.rollback));
    assert.equal(
      await hashVivo(c, s.assinatura),
      s.hashVigente,
      `${s.rollback} não devolveu o corpo da 99`,
    );
    desfeitasNestaChamada.add(s.nome);
    desfeitas.push(s.nome);
  }
  return desfeitas;
}

/** Reaplica as sucessoras por cima, na ordem da aplicação (o estado da árvore). */
async function reaplicarSucessorasDa99(c) {
  for (const s of SUCESSORAS_DA_99) {
    await c.query(ler(s.nome));
    assert.equal(
      await hashVivo(c, s.assinatura),
      s.hashDesta,
      `${s.nome}: reaplicar não deixou o corpo dela`,
    );
  }
}

module.exports = {
  SUCESSORAS_DA_99,
  conferirLista,
  desfazerSucessorasDa99,
  devolverAoEstadoAnteriorAoCustoDoDia,
  reaplicarSucessorasDa99,
  NOME_CUSTO_DO_DIA,
};
