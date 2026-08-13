#!/usr/bin/env node
/**
 * Prova a correcao do ADMIN-080 (issue #100) sem comitar nada no banco.
 *
 * TUDO roda em UMA transacao terminada em ROLLBACK. Nada e gravado. Isso so
 * e' verdade porque a migration NAO tem BEGIN/COMMIT embutido — se alguem
 * acrescentar um, este script passa a gravar em producao sem avisar.
 *
 * POR QUE `SET LOCAL ROLE authenticated` + `request.jwt.claims`:
 *   answer_question_atomic(uuid,text) le `v_admin_id := auth.uid()` e confere
 *   contra `profiles.role = 'admin'`; a sobrecarga de 3 args usa
 *   `public.is_admin()`, que comeca com "IF current_setting('role') IN
 *   ('postgres','service_role') THEN RETURN true". A DATABASE_URL conecta
 *   como `postgres` — sem trocar o papel e sem as claims, tudo passaria sem
 *   medir nada.
 *
 * O ADMIN E' REAL: `profiles.id` tem FK para `auth.users`, e
 * `questions.user_id` tem FK para `public_profiles` — UUID inventado quebra a
 * constraint antes de medir qualquer coisa. O script pega um admin de
 * verdade do banco (so leitura) e usa o mesmo id como autor da pergunta de
 * teste, para nao precisar inventar um segundo usuario.
 *
 * OS CASOS:
 *   ANTES da migration (funcao viva hoje em producao, so sabe INSERT)
 *     1. Responder Q1 duas vezes -> 2 linhas em answers (o bug da issue #100)
 *   Setup, ainda ANTES da migration, para os casos de deduplicacao (Q4-Q7):
 *   respostas inseridas direto (nao via RPC) para controlar created_at.
 *   Guarda extra (achado 5b da revisao), ainda ANTES da migration: captura
 *   o estado da duplicata REAL de producao (question_id=880b0fbb-..., que o
 *   proprio script NAO criou) e dois numeros globais -- count(*) da tabela
 *   inteira e quantas linhas a regra de dedup removeria se rodasse agora --
 *   para comparar depois da migration e pegar "apagou mais do que devia".
 *   Migration aplicada DENTRO da transacao (1a vez)
 *     Guarda extra (achados 2 e 5b): count(*) global bate com o previsto: a
 *     tabela de backup (answers_dedup_backup_20260812, criada pela propria
 *     migration) recebeu exatamente as linhas removidas, nem mais nem
 *     menos; a duplicata REAL converge para 1 linha com a resposta mais
 *     recente sobrevivendo, e a linha apagada dela aparece no backup.
 *     2. Q1 (que tinha 2 linhas) converge para 1: a deduplicacao da propria
 *        migration ja resolve a duplicata, e sobra a resposta MAIS RECENTE
 *        (criterio de aceite da #100). Editar de novo continua em 1 linha —
 *        o indice unico criado pela migration impede reabrir a duplicata.
 *     3. Q2 (pergunta nova, sem resposta previa) -> 1 linha
 *     4. "Editar" Q2 (segunda chamada da RPC) -> continua em 1 linha, com o
 *        texto novo e o MESMO id de resposta (upsert de verdade)
 *     5. Sobrecarga de 3 args (Q3) -> mesmo comportamento dos casos 3-4
 *     6. Q4 (3 respostas em tempos diferentes) -> a dedup converge para 1,
 *        e e' a de created_at mais recente (confere id E texto)
 *     7. Q5 (1 resposta) -> a dedup nao mexe: continua 1, mesmo id
 *     8. Q6 (0 respostas) -> a dedup nao quebra com question_id sem resposta
 *     9. Q7 (2 respostas com created_at EXATAMENTE igual) -> a dedup resolve
 *        o empate pelo maior id, nao pela ordem fisica das linhas
 *   Migration reaplicada DENTRO da transacao (2a vez, idempotente)
 *    10. Depois da 1a aplicacao toda question_id ja convergiu para 1 linha
 *        (particao de 1 linha tem sempre row_number()=1), entao reaplicar
 *        NAO tem mais duplicata nenhuma pra achar -- o que prova de verdade
 *        e' que o indice (IF NOT EXISTS) e as funcoes (CREATE OR REPLACE)
 *        nao estouram erro de "ja existe" e que nao aparece nenhuma linha
 *        nova nem em answers nem no backup (achado 5a da revisao: a versao
 *        anterior deste caso reafirmava o desempate do empate de Q7, algo
 *        que rn>1 nunca mais vai ficar verdadeiro pra testar de novo).
 *
 * USO:  node scripts/db-prove-admin-080.cjs
 * Sai com codigo 0 so se todas as asserções passarem.
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MIGRATION = path.join(
  PROJECT_ROOT,
  "supabase",
  "migrations",
  "20260812000000_upsert_answer_question_atomic.sql",
);

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    // O caminho vem de PROJECT_ROOT + uma das duas strings literais acima.
    // Nada aqui e' entrada de usuario, entao o alerta e' falso positivo.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(caminho)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const conteudo = fs.readFileSync(caminho, "utf8");
    const linha = conteudo
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  throw new Error("DATABASE_URL não encontrada.");
}

let passou = 0;
let falhou = 0;

function conferir(nome, condicao, detalhe) {
  if (condicao) {
    passou++;
    console.log(`  ok    ${nome}`);
  } else {
    falhou++;
    console.error(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

/** So leitura: um admin de verdade que tambem tem linha em public_profiles. */
async function descobrirAdmin(client) {
  const { rows } = await client.query(`
    SELECT p.id
      FROM public.profiles p
      JOIN public.public_profiles pp ON pp.id = p.id
     WHERE p.role = 'admin'
     LIMIT 1`);
  if (rows.length === 0) {
    throw new Error(
      "Nenhum admin com linha em public_profiles encontrado — o teste nao tem com quem rodar.",
    );
  }
  return rows[0].id;
}

async function criarProduto(client, nome) {
  // `custo` e NOT NULL sem default nesta tabela — omitir quebra o INSERT.
  const r = await client.query(
    `INSERT INTO public.produtos (nome, custo, preco_venda, estoque, categoria)
     VALUES ($1, 5.00, 10.00, 1, 'teste')
     RETURNING id`,
    [nome],
  );
  return r.rows[0].id;
}

async function criarQuestion(client, produtoId, userId, texto) {
  const r = await client.query(
    `INSERT INTO public.questions (product_id, user_id, question)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [produtoId, userId, texto],
  );
  return r.rows[0].id;
}

async function respostasDe(client, questionId) {
  const r = await client.query(
    `SELECT id, answer, user_id
       FROM public.answers
      WHERE question_id = $1
      ORDER BY created_at`,
    [questionId],
  );
  return r.rows;
}

/** count(*) da tabela inteira -- inclui os dados sintéticos do script E
 * qualquer linha real já existente no banco (a duplicata de produção). */
async function contarAnswers(client) {
  const r = await client.query("SELECT count(*)::int AS n FROM public.answers");
  return r.rows[0].n;
}

/**
 * Roda `query` protegida por SAVEPOINT: se falhar (ex.: tabela não existe
 * porque a migration foi revertida/não rodou), faz ROLLBACK TO SAVEPOINT e
 * devolve `valorSeFalhar` em vez de deixar a exceção subir. Sem o savepoint,
 * um erro de SQL deixa a transação inteira "aborted" no Postgres -- TODO
 * comando seguinte falharia com "current transaction is aborted", mesmo os
 * que nada têm a ver com o problema original, abortando a prova inteira
 * antes de rodar o resto dos casos.
 */
let contadorSavepoint = 0;
async function comSavepoint(client, query, valorSeFalhar) {
  const nome = `sp_prova_${++contadorSavepoint}`;
  await client.query(`SAVEPOINT ${nome}`);
  try {
    const r = await query();
    await client.query(`RELEASE SAVEPOINT ${nome}`);
    return r;
  } catch (err) {
    // Achado da revisão da Trilha 3 (Correção 4): sem isto, "tabela não
    // existe" e "permissão negada" ficavam indistinguíveis no diagnóstico --
    // os dois caiam no mesmo `valorSeFalhar` em silêncio.
    console.error(`[comSavepoint:${nome}] ${err.message}`);
    await client.query(`ROLLBACK TO SAVEPOINT ${nome}`).catch(() => {});
    return valorSeFalhar;
  }
}

/** count(*) da tabela de backup criada pela migration (conserto 2 da
 * revisão). `null` se a tabela não existir -- ver comSavepoint acima. */
async function contarBackup(client) {
  return comSavepoint(
    client,
    async () => {
      const r = await client.query(
        "SELECT count(*)::int AS n FROM public.answers_dedup_backup_20260812",
      );
      return r.rows[0].n;
    },
    null,
  );
}

/** Linhas da tabela de backup para um id de resposta específico. `[]` se a
 * tabela não existir -- mesmo raciocínio de contarBackup acima. */
async function backupDoId(client, answerId) {
  return comSavepoint(
    client,
    async () => {
      const r = await client.query(
        "SELECT id, answer FROM public.answers_dedup_backup_20260812 WHERE id = $1",
        [answerId],
      );
      return r.rows;
    },
    [],
  );
}

/**
 * Quantas linhas o DELETE de deduplicação da migration removeria SE rodasse
 * agora, calculado com a MESMA regra de row_number()/partição que a
 * migration usa -- mas em SELECT puro, sem apagar nada. É a guarda contra
 * "apagou mais do que devia": mede o esperado ANTES da migration rodar de
 * verdade, sobre a tabela inteira (inclui a duplicata de produção que o
 * script não criou, não só os dados sintéticos de Q1/Q4/Q7).
 */
async function contarEsperadoParaRemover(client) {
  const r = await client.query(`
    SELECT count(*)::int AS n FROM (
      SELECT row_number() OVER (
                 PARTITION BY question_id
                 ORDER BY created_at DESC, id DESC
             ) AS rn
        FROM public.answers
    ) ranked WHERE rn > 1`);
  return r.rows[0].n;
}

// A duplicata de produção medida pela revisão da Trilha 3: duas linhas para
// a mesma pergunta, a mesma resposta "editada" 14 minutos depois virando uma
// segunda linha -- o próprio bug da #100 em ação, não um dado que este
// script criou.
const QUESTION_ID_DUPLICATA_REAL = "880b0fbb-c88e-4e3c-a7b4-256ff0d982ef";

/** Como respostasDe, mas com created_at e na MESMA ordem que a migration usa
 * para decidir quem sobrevive (created_at DESC, id DESC) -- rows[0] é sempre
 * quem o DELETE mantém; o resto é quem ele apaga. */
async function respostasComData(client, questionId) {
  const r = await client.query(
    `SELECT id, answer, user_id, created_at
       FROM public.answers
      WHERE question_id = $1
      ORDER BY created_at DESC, id DESC`,
    [questionId],
  );
  return r.rows;
}

/**
 * Insere uma resposta DIRETO na tabela (sem passar pela RPC), para controlar
 * created_at com precisao — a RPC sempre grava now(), o que nao serve para
 * montar os casos de empate e de "tempos diferentes" que a deduplicacao
 * precisa distinguir.
 */
async function inserirRespostaDireta(
  client,
  questionId,
  userId,
  texto,
  createdAt,
) {
  const r = await client.query(
    `INSERT INTO public.answers (question_id, user_id, answer, created_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [questionId, userId, texto, createdAt],
  );
  return r.rows[0].id;
}

/**
 * Chama a RPC como o admin de verdade, trocando papel e claims dentro da
 * MESMA transacao — sem SAVEPOINT porque nenhum destes casos espera excecao.
 */
async function responderComoAdmin(
  client,
  adminId,
  questionId,
  texto,
  comTresArgs = false,
) {
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({
      sub: adminId,
      role: "authenticated",
      app_metadata: { role: "admin" },
    }),
  ]);
  if (comTresArgs) {
    await client.query(
      "SELECT public.answer_question_atomic($1::uuid, $2::text, $3::uuid)",
      [questionId, texto, adminId],
    );
  } else {
    await client.query(
      "SELECT public.answer_question_atomic($1::uuid, $2::text)",
      [questionId, texto],
    );
  }
  await client.query("RESET ROLE");
}

async function main() {
  // MIGRATION e' constante de modulo, montada de __dirname. Falso positivo.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(MIGRATION))
    throw new Error(`Migration não encontrada: ${MIGRATION}`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const migrationSql = fs.readFileSync(MIGRATION, "utf8");

  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log(`Conectado em ${new URL(lerDatabaseUrl()).hostname}`);
  console.log(
    "Nada será comitado: tudo roda numa transação que termina em ROLLBACK.\n",
  );

  await client.query("BEGIN");

  try {
    const adminId = await descobrirAdmin(client);
    const produtoId = await criarProduto(client, "PROVA ADMIN-080");

    console.log("=== 1. O bug reproduz hoje (função ainda só INSERT)? ===");
    const q1 = await criarQuestion(
      client,
      produtoId,
      adminId,
      "PROVA ADMIN-080 — pergunta 1",
    );
    await responderComoAdmin(client, adminId, q1, "primeira resposta");
    await responderComoAdmin(client, adminId, q1, "resposta editada");
    const antesQ1 = await respostasDe(client, q1);
    console.log(`  linhas em answers para Q1: ${antesQ1.length}`);
    conferir(
      "ANTES da migration, editar cria uma segunda linha (o bug da #100)",
      antesQ1.length === 2,
      `veio ${antesQ1.length}`,
    );
    if (antesQ1.length !== 2) {
      throw new Error(
        "O bug não reproduziu ANTES da migration. Ou alguém já corrigiu por fora, ou o teste não está medindo o que promete — investigue antes de aplicar.",
      );
    }

    // `now()` fica congelado no horário de INÍCIO da transação (é STABLE, não
    // VOLATILE) — as duas chamadas RPC acima, embora sequenciais, gravam o
    // MESMO created_at. Em produção isso não acontece (cada RPC é uma
    // transação própria, minutos depois uma da outra — o caso real medido
    // teve 14 minutos de intervalo). Sem este ajuste, o desempate do DELETE
    // cairia no id (aleatório) em vez do created_at, e este teste ficaria
    // instável por um artefato da transação única, não por um bug da
    // migration. Reproduz o intervalo real deslocando a resposta mais antiga
    // para trás.
    await client.query(
      `UPDATE public.answers SET created_at = created_at - interval '14 minutes'
        WHERE question_id = $1 AND answer = $2`,
      [q1, "primeira resposta"],
    );

    console.log(
      "\n=== Setup (ainda ANTES da migration): perguntas para os casos de deduplicação ===",
    );
    const base = new Date("2026-08-01T10:00:00Z").getTime();
    const t0 = new Date(base);
    const t1 = new Date(base + 60_000);
    const t2 = new Date(base + 120_000);
    const tTie = new Date(base + 300_000);

    // Q4: 3 respostas em tempos diferentes -> deve sobrar a mais recente (t2)
    const q4 = await criarQuestion(
      client,
      produtoId,
      adminId,
      "PROVA ADMIN-080 — pergunta 4 (3 respostas)",
    );
    await inserirRespostaDireta(
      client,
      q4,
      adminId,
      "resposta mais antiga",
      t0,
    );
    await inserirRespostaDireta(client, q4, adminId, "resposta do meio", t1);
    const a4Recente = await inserirRespostaDireta(
      client,
      q4,
      adminId,
      "resposta mais recente",
      t2,
    );

    // Q5: 1 resposta -> a dedup não pode mexer
    const q5 = await criarQuestion(
      client,
      produtoId,
      adminId,
      "PROVA ADMIN-080 — pergunta 5 (1 resposta)",
    );
    const a5Unica = await inserirRespostaDireta(
      client,
      q5,
      adminId,
      "resposta única",
      t0,
    );

    // Q6: 0 respostas -> a dedup não pode quebrar
    const q6 = await criarQuestion(
      client,
      produtoId,
      adminId,
      "PROVA ADMIN-080 — pergunta 6 (0 respostas)",
    );

    // Q7: 2 respostas com created_at EXATAMENTE igual -> desempate por id
    const q7 = await criarQuestion(
      client,
      produtoId,
      adminId,
      "PROVA ADMIN-080 — pergunta 7 (empate)",
    );
    const a7A = await inserirRespostaDireta(
      client,
      q7,
      adminId,
      "resposta tie A",
      tTie,
    );
    const a7B = await inserirRespostaDireta(
      client,
      q7,
      adminId,
      "resposta tie B",
      tTie,
    );
    const idEsperadoQ7 = a7A > a7B ? a7A : a7B;
    const textoEsperadoQ7 =
      idEsperadoQ7 === a7A ? "resposta tie A" : "resposta tie B";

    console.log(
      "\n=== Guarda extra (achado 5b da revisão): a duplicata REAL de produção, não criada por este script ===",
    );
    const duplicataRealAntes = await respostasComData(
      client,
      QUESTION_ID_DUPLICATA_REAL,
    );
    console.log(
      `  linhas para question_id=${QUESTION_ID_DUPLICATA_REAL}: ${duplicataRealAntes.length}`,
    );
    if (duplicataRealAntes.length !== 2) {
      throw new Error(
        `A duplicata de produção medida pela revisão (question_id=${QUESTION_ID_DUPLICATA_REAL}) não tem mais 2 linhas (tem ${duplicataRealAntes.length}). Ou alguém já resolveu por fora, ou o dado mudou -- ajuste esta guarda antes de confiar no resto da prova.`,
      );
    }
    // rows[0] é sempre quem o DELETE mantém (ver respostasComData) -- maior
    // created_at, desempate por maior id.
    const sobreviventeRealEsperado = duplicataRealAntes[0];
    const removidaRealEsperada = duplicataRealAntes[1];

    // count(*) global e "quanto a regra de dedup removeria se rodasse agora"
    // medidos ANTES da migration -- inclui a duplicata real acima E os
    // dados sintéticos (Q1, e os de Q4/Q7 montados a seguir ainda não
    // existem neste ponto, então a Q1 duplicada de cima já entra aqui).
    const totalAntesMigracao = await contarAnswers(client);
    const esperadoRemover = await contarEsperadoParaRemover(client);

    console.log(
      "\n=== 2. Migration aplicada (dentro da transação, 1ª vez) ===",
    );
    await client.query(migrationSql);

    console.log(
      "\n=== Guarda extra (achado 5b): count(*) global e a duplicata real, depois da migration ===",
    );
    const totalDepoisMigracao = await contarAnswers(client);
    conferir(
      "a migration não apaga mais linhas do que a própria regra de dedup previa (guarda contra 'apagou mais do que devia')",
      totalDepoisMigracao === totalAntesMigracao - esperadoRemover,
      `antes ${totalAntesMigracao}, esperava remover ${esperadoRemover}, depois ${totalDepoisMigracao}`,
    );

    const totalBackupDepois = await contarBackup(client);
    conferir(
      "toda linha removida (sintética + a duplicata real) foi para a tabela de backup, nem mais nem menos",
      totalBackupDepois === esperadoRemover,
      `esperado ${esperadoRemover}, veio ${totalBackupDepois}`,
    );

    const duplicataRealDepois = await respostasComData(
      client,
      QUESTION_ID_DUPLICATA_REAL,
    );
    // As duas condições viraram UM `conferir` (achado do RED desta revisão:
    // separadas, "o id bate" passava mesmo com a migration revertida --
    // respostasComData ordena do mesmo jeito antes e depois, então, com a
    // duplicata intacta, o índice [0] já era o id certo por definição da
    // ordenação, não porque a migration convergiu nada).
    conferir(
      "a duplicata REAL de produção converge para 1 linha, e é a resposta mais recente que sobrevive",
      duplicataRealDepois.length === 1 &&
        duplicataRealDepois[0]?.id === sobreviventeRealEsperado.id,
      `linhas=${duplicataRealDepois.length}, id=${duplicataRealDepois[0]?.id} (esperado ${sobreviventeRealEsperado.id})`,
    );

    const backupDaReal = await backupDoId(client, removidaRealEsperada.id);
    conferir(
      "a linha apagada da duplicata real foi para answers_dedup_backup_20260812, com o mesmo texto",
      backupDaReal.length === 1 &&
        backupDaReal[0].answer === removidaRealEsperada.answer,
      `veio ${JSON.stringify(backupDaReal)}`,
    );

    console.log(
      "\n=== 3. Q1 (já duplicada): a dedup da própria migration converge para 1 ===",
    );
    const depoisQ1 = await respostasDe(client, q1);
    conferir(
      "após a migration, Q1 (que tinha 2 linhas) converge para 1 linha",
      depoisQ1.length === 1,
      `veio ${depoisQ1.length}`,
    );
    conferir(
      "a linha sobrevivente é a resposta MAIS RECENTE (critério de aceite da #100)",
      depoisQ1[0]?.answer === "resposta editada",
      `veio ${depoisQ1[0]?.answer}`,
    );

    await responderComoAdmin(client, adminId, q1, "resposta convergida");
    const depoisQ1Editada = await respostasDe(client, q1);
    conferir(
      "editar Q1 de novo (agora upsert protegido pelo índice) continua em 1 linha",
      depoisQ1Editada.length === 1,
      `veio ${depoisQ1Editada.length}`,
    );
    conferir(
      "o texto reflete a nova edição",
      depoisQ1Editada[0]?.answer === "resposta convergida",
      `veio ${depoisQ1Editada[0]?.answer}`,
    );

    console.log("\n=== 4. Q2 (pergunta nova): upsert de verdade ===");
    const q2 = await criarQuestion(
      client,
      produtoId,
      adminId,
      "PROVA ADMIN-080 — pergunta 2",
    );
    await responderComoAdmin(client, adminId, q2, "resposta 1");
    const primeiraQ2 = await respostasDe(client, q2);
    conferir(
      "primeira resposta insere 1 linha",
      primeiraQ2.length === 1,
      `veio ${primeiraQ2.length}`,
    );

    await responderComoAdmin(client, adminId, q2, "resposta 1 editada");
    const segundaQ2 = await respostasDe(client, q2);
    conferir(
      "editar (segunda chamada da RPC) continua com 1 linha, não cria uma segunda",
      segundaQ2.length === 1,
      `veio ${segundaQ2.length}`,
    );
    conferir(
      "o texto da linha única reflete a edição",
      segundaQ2[0]?.answer === "resposta 1 editada",
      `veio ${segundaQ2[0]?.answer}`,
    );
    // Achado do RED desta revisão: separado do length===1, este check
    // passava mesmo SEM upsert -- respostasDe ordena por created_at
    // ascendente, e sem ON CONFLICT a segunda chamada só ACRESCENTA uma
    // linha nova, deixando a linha ORIGINAL intocada no índice [0]. Ou
    // seja, "o id bate" dava positivo mesmo tendo virado insert+insert, que
    // é exatamente o comportamento que este caso existe para reprovar.
    // Combinado com length===1 (que só passa se for update de verdade), a
    // comparação de id volta a significar o que o nome promete.
    conferir(
      "e é a MESMA linha de antes (update, não insert+insert)",
      segundaQ2.length === 1 && segundaQ2[0]?.id === primeiraQ2[0]?.id,
      `${primeiraQ2[0]?.id} -> ${segundaQ2[0]?.id} (${segundaQ2.length} linha(s))`,
    );

    console.log("\n=== 5. Sobrecarga de 3 args tem o mesmo comportamento ===");
    const q3 = await criarQuestion(
      client,
      produtoId,
      adminId,
      "PROVA ADMIN-080 — pergunta 3",
    );
    await responderComoAdmin(client, adminId, q3, "resposta 1", true);
    await responderComoAdmin(client, adminId, q3, "resposta editada", true);
    const respostasQ3 = await respostasDe(client, q3);
    conferir(
      "sobrecarga de 3 args também faz upsert (1 linha após editar)",
      respostasQ3.length === 1,
      `veio ${respostasQ3.length}`,
    );
    conferir(
      "texto da sobrecarga de 3 args reflete a edição",
      respostasQ3[0]?.answer === "resposta editada",
      `veio ${respostasQ3[0]?.answer}`,
    );

    console.log(
      "\n=== 6. Q4 (3 respostas, tempos diferentes): sobra a mais recente ===",
    );
    const respostasQ4 = await respostasDe(client, q4);
    conferir(
      "Q4 com 3 respostas converge para 1 linha",
      respostasQ4.length === 1,
      `veio ${respostasQ4.length}`,
    );
    conferir(
      "a linha sobrevivente é a de created_at mais recente (mesmo id)",
      respostasQ4[0]?.id === a4Recente,
      `esperado ${a4Recente}, veio ${respostasQ4[0]?.id}`,
    );
    conferir(
      "o texto da sobrevivente é o da resposta mais recente",
      respostasQ4[0]?.answer === "resposta mais recente",
      `veio ${respostasQ4[0]?.answer}`,
    );

    console.log("\n=== 7. Q5 (1 resposta): a dedup não mexe ===");
    const respostasQ5 = await respostasDe(client, q5);
    conferir(
      "pergunta com 1 resposta continua com 1 linha após a dedup",
      respostasQ5.length === 1,
      `veio ${respostasQ5.length}`,
    );
    conferir(
      "o id da resposta única não muda (a dedup nunca apaga a única resposta)",
      respostasQ5[0]?.id === a5Unica,
      `esperado ${a5Unica}, veio ${respostasQ5[0]?.id}`,
    );

    console.log("\n=== 8. Q6 (0 respostas): nada quebra ===");
    const respostasQ6 = await respostasDe(client, q6);
    conferir(
      "pergunta sem resposta nenhuma continua sem resposta (dedup não quebra)",
      respostasQ6.length === 0,
      `veio ${respostasQ6.length}`,
    );

    console.log(
      "\n=== 9. Q7 (empate exato de created_at): desempate determinístico por id ===",
    );
    const respostasQ7 = await respostasDe(client, q7);
    conferir(
      "empate converge para 1 linha",
      respostasQ7.length === 1,
      `veio ${respostasQ7.length}`,
    );
    // Achado do RED desta revisão: com as DUAS linhas do empate ainda
    // vivas (migration revertida), a ordem entre elas em respostasDe (sem
    // desempate por id na query) fica por conta do Postgres para timestamps
    // IGUAIS -- e neste banco ela bateu por coincidência com o id maior nos
    // dois testes abaixo, fazendo as duas "ok" mesmo sem o DELETE ter
    // rodado. Combinar com length===1 fecha essa brecha: só passa se de
    // fato sobrou uma linha (e nesse caso, sim, a ordem de respostasDe é
    // inequívoca).
    conferir(
      "o desempate escolhe o maior id (não depende da ordem física das linhas)",
      respostasQ7.length === 1 && respostasQ7[0]?.id === idEsperadoQ7,
      `linhas=${respostasQ7.length}, esperado ${idEsperadoQ7}, veio ${respostasQ7[0]?.id}`,
    );
    conferir(
      "o texto da sobrevivente corresponde ao id escolhido",
      respostasQ7.length === 1 && respostasQ7[0]?.answer === textoEsperadoQ7,
      `linhas=${respostasQ7.length}, veio ${respostasQ7[0]?.answer}`,
    );

    // Achado 5a da revisão: depois da 1ª aplicação, TODA question_id já
    // convergiu para 1 linha -- e partição de 1 linha tem sempre rn=1, então
    // o `WHERE ranked.rn > 1` do DELETE nunca teria o que apagar na 2ª
    // aplicação. Reafirmar "o empate de Q7 não muda" aqui não prova nada
    // sobre REAPLICAR a migration -- prova só que o DELETE não apaga a
    // última linha, propriedade que o caso 7 (Q5) já cobre. O que a 2ª
    // aplicação PODE, de fato, quebrar -- e por isso vale medir -- é: (a) o
    // índice unico precisa do IF NOT EXISTS pra não estourar erro de "já
    // existe", (b) CREATE OR REPLACE FUNCTION precisa não recriar do zero, e
    // (c) nenhuma linha nova deve aparecer em answers nem em
    // answers_dedup_backup_20260812, já que não há mais duplicata nenhuma
    // para o DELETE achar.
    console.log(
      "\n=== 10. Migration reaplicada (idempotente): não falha e não altera nenhuma linha ===",
    );
    const totalAntesSegunda = await contarAnswers(client);
    const backupAntesSegunda = await contarBackup(client);
    await client.query(migrationSql);
    const totalDepoisSegunda = await contarAnswers(client);
    const backupDepoisSegunda = await contarBackup(client);
    conferir(
      "reaplicar a migration não insere nem apaga nenhuma linha de answers (índice IF NOT EXISTS, função CREATE OR REPLACE, DELETE sem duplicata pra achar)",
      totalDepoisSegunda === totalAntesSegunda,
      `antes ${totalAntesSegunda}, depois ${totalDepoisSegunda}`,
    );
    // `backupAntesSegunda === backupDepoisSegunda` sozinho passa até com
    // `null === null` (achado do RED desta revisão: se a tabela nunca
    // existiu, as duas leituras dão null e a comparação "bate" sem provar
    // nada). Exigir explicitamente que backupDepoisSegunda seja um número
    // fecha essa brecha -- só passa se a tabela existir de verdade.
    conferir(
      "reaplicar a migration não grava nada a mais na tabela de backup",
      typeof backupDepoisSegunda === "number" &&
        backupDepoisSegunda === backupAntesSegunda,
      `antes ${backupAntesSegunda}, depois ${backupDepoisSegunda}`,
    );
    const respostasQ7Depois = await respostasDe(client, q7);
    conferir(
      "Q7 continua com 1 linha e o MESMO sobrevivente do empate após a reaplicação",
      respostasQ7Depois.length === 1 &&
        respostasQ7Depois[0]?.id === idEsperadoQ7,
      `linhas=${respostasQ7Depois.length}, id=${respostasQ7Depois[0]?.id}`,
    );
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }

  console.log(`\n${passou} passaram, ${falhou} falharam.`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((erro) => {
  console.error("Erro:", erro.message);
  process.exit(1);
});
