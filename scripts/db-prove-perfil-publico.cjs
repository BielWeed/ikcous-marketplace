#!/usr/bin/env node
/**
 * PROVA de `perfil_publico_avaliacoes`/`perfil_publico_perguntas` (P1 —
 * brief equipe/entregas/20260911-brief-perfil-publico-pela-vitrine-do-autor.md,
 * 11/09/2026).
 *
 * NADA É GRAVADO: a migration 20261130000000, a migration 20261111000000
 * (não aditiva, aplicada por cima na fase 4 só DENTRO desta transação) e o
 * rollback-manual da 20261130000000 são LIDOS DO DISCO e executados DENTRO
 * de uma transação desfeita com ROLLBACK no final — nada redigitado, nada
 * aplicado de verdade.
 *
 * DATABASE_URL vem SÓ do ambiente (injetada por com-env-main.cjs/
 * com-env-savy.cjs ou equivalente) — este script NUNCA lê `.env`.
 *
 * O QUE ELE PROVA, NA ORDEM:
 *   0. CONTROLE NEGATIVO (estado vivo de hoje, antes de qualquer
 *      migration): as duas funções NÃO existem em pg_proc, e `anon` AINDA
 *      lê `user_id` de uma avaliação publicada
 *      (`SELECT user_id FROM reviews WHERE status='publicada' LIMIT 1`
 *      devolve linha) — prova que o instrumento discrimina; se isto já
 *      desse zero linhas, a suíte inteira seria vácuo.
 *   1. Fixture DENTRO da transação: escolhe um `public_profiles.id` SEM
 *      review/question própria (`NOT EXISTS`, para a contagem de linhas da
 *      RPC não depender de dado alheio que já exista no banco) e um
 *      `produtos.id` ativo já existente; insere 1 review 'publicada', 1
 *      review 'pendente' e 1 question com 1 answer no produto ativo, MAIS
 *      TRÊS produtos criados só para esta prova, cada um com 1 review
 *      'publicada' e 1 question do mesmo autor: (a) um produto PÚBLICO
 *      (`ativo = true, deleted_at NULL`) — controle positivo, deveria
 *      aparecer com produto_nome/product_id preenchidos; (b) um produto
 *      `ativo = false` — deveria continuar aparecendo (LEFT JOIN), com
 *      produto_nome/produto_imagem_url/product_id NULL; (c) um produto
 *      `ativo = true` MAS `deleted_at = now()` (soft delete) — mesmo
 *      resultado NULL do caso (b); é o par (b)+(c) que discrimina "ativo
 *      = true AND deleted_at IS NULL" vivendo no ON do LEFT JOIN (ADENDO
 *      11/09 item 1) de qualquer uma das duas condições vivendo num WHERE
 *      (que esconderia a linha inteira em vez de só os campos de produto).
 *   2. Aplica a 20261130000000, lida do disco.
 *   3. Como `anon`, por PERTINÊNCIA (id da linha, nunca por contagem):
 *      `perfil_publico_avaliacoes(autor)` devolve a publicada e as dos três
 *      produtos extras, NÃO a pendente; a do produto público tem
 *      `product_id`/`produto_nome` preenchidos (`product_id` igual ao id do
 *      produto — ADENDO item 2: nunca o `r.product_id` cru, sempre `p.id`);
 *      as dos produtos desativado e apagado (soft delete) têm
 *      `product_id`/`produto_nome`/`produto_imagem_url` NULL mas CONTINUAM
 *      aparecendo; `perfil_publico_perguntas(autor)` devolve as três
 *      perguntas extras, a do produto público com `answers` de tamanho 1 e
 *      `product_id` preenchido, as dos produtos desativado/apagado com
 *      `product_id`/`produto_nome` NULL; nenhuma das duas devolve a coluna
 *      `user_id` (`pg_get_function_result`); `authenticated` também
 *      executa; `PUBLIC` não tem EXECUTE
 *      (`information_schema.role_routine_grants`).
 *   4. Aplica a 20261111000000 (não aditiva) do disco EM CIMA, dentro da
 *      MESMA transação, e repete o passo 3 como `anon` — as RPCs
 *      continuam devolvendo (SECURITY DEFINER sobrevive à RLS nova),
 *      inclusive a linha do produto desativado, enquanto
 *      `SELECT * FROM reviews` como `anon` devolve ZERO linhas (a peça nova
 *      sobrevive à trava que a 20261111 abre).
 *   5. Roda o rollback-manual da 20261130000000, lido do disco — as duas
 *      funções somem de `pg_proc`.
 *   6. `ROLLBACK` — nada do que rodou aqui fica gravado.
 *
 * Exit 0 = todas as afirmativas OK. Exit 1 = alguma afirmativa caiu. Exit 2 =
 * a prova NÃO chegou ao fim (pré-condição da fixture, ferramenta, OU erro de
 * SQL ao aplicar uma migration — a mensagem do Postgres sai no stdout; ler
 * antes de tratar como problema de ambiente).
 *
 * NÃO RODAR CONTRA BANCO POR ESTE AGENTE (trava da bancada) — a hub roda.
 * Prova deste arquivo, aqui, se limita a `node --check` (sintaxe).
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MIG_DIR = path.join(PROJECT_ROOT, "supabase/migrations");

const NOSSA_MIGRATION = path.join(
  MIG_DIR,
  "20261130000000_o_perfil_publico_le_pela_vitrine_do_autor.sql",
);
const NOSSO_ROLLBACK = path.join(
  MIG_DIR,
  "rollback-manual-20261130000000_o_perfil_publico_le_pela_vitrine_do_autor.sql",
);
const MIGRATION_20261111 = path.join(
  MIG_DIR,
  "20261111000000_o_visitante_para_de_ler_o_autor_direto_da_tabela.sql",
);

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  throw new Error(
    "DATABASE_URL não encontrada no ambiente — rode com com-env-main.cjs/com-env-savy.cjs (nunca lendo .env).",
  );
}

function lerSql(caminho) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho vem sempre da lista fixa deste arquivo, sem entrada externa
  return fs.readFileSync(caminho, "utf8");
}

let falhas = 0;
function afirmar(descricao, condicao, extra = "") {
  if (condicao) {
    console.log(`  [OK   ] ${descricao}`);
  } else {
    falhas += 1;
    console.log(`  [FALHOU] ${descricao}${extra ? ` — ${extra}` : ""}`);
  }
}

function titulo(t) {
  console.log(`\n-- ${t}`);
}

/** Roda `sql` como `papel`, dentro de um SAVEPOINT desfeito no `finally` —
 * a conexão volta a ser o papel de entrada (dono da transação) depois de
 * cada sonda, mesmo quando a query falha. Mesmo molde de
 * scripts/db-prove-i3-i4.cjs. */
async function sondar(client, papel, sql, params = []) {
  await client.query("SAVEPOINT sonda");
  try {
    await client.query(`SET LOCAL ROLE ${papel}`);
    try {
      const r = await client.query(sql, params);
      return { ok: true, rows: r.rows, rowCount: r.rowCount };
    } catch (e) {
      return { ok: false, code: e.code, message: e.message };
    }
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT sonda");
    await client.query("RESET ROLE").catch(() => {});
  }
}

async function existemAsDuasFuncoes(client) {
  const r = await client.query(
    `SELECT proname FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND proname IN ('perfil_publico_avaliacoes', 'perfil_publico_perguntas')`,
  );
  return new Set(r.rows.map((row) => row.proname));
}

async function resultadoSemUserId(client, nomeFuncao) {
  const r = await client.query(
    `SELECT pg_get_function_result(p.oid) AS def
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = $1`,
    [nomeFuncao],
  );
  if (r.rows.length === 0) return { encontrada: false, contemUserId: null };
  return {
    encontrada: true,
    contemUserId: /\buser_id\b/.test(r.rows[0].def),
    def: r.rows[0].def,
  };
}

async function podeExecutar(client, papel, assinatura) {
  const r = await client.query(
    "SELECT has_function_privilege($1, $2, 'EXECUTE') AS pode",
    [papel, assinatura],
  );
  return r.rows[0].pode;
}

async function publicTemExecute(client, nomeFuncao) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.role_routine_grants
      WHERE routine_schema = 'public' AND routine_name = $1
        AND grantee = 'PUBLIC' AND privilege_type = 'EXECUTE'`,
    [nomeFuncao],
  );
  return r.rows.length > 0;
}

async function rodar(rotulo) {
  const client = new Client({ connectionString: lerDatabaseUrl() });
  await client.connect();
  console.log(`\n===== ${rotulo} =====`);

  try {
    await client.query("BEGIN");

    // ---- 0. Controle negativo: estado vivo de hoje ------------------------
    titulo("0. Controle negativo (estado vivo, antes de qualquer migration)");
    const funcoesAntes = await existemAsDuasFuncoes(client);
    afirmar(
      "as duas RPCs NÃO existem ainda (pg_proc)",
      funcoesAntes.size === 0,
      `encontradas: ${[...funcoesAntes].join(",") || "(nenhuma)"}`,
    );

    const reviewPublicadaHoje = await client.query(
      `SELECT id, user_id FROM public.reviews
        WHERE status = 'publicada' AND user_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
    );
    if (reviewPublicadaHoje.rows.length > 0) {
      const alvo = reviewPublicadaHoje.rows[0];
      const antes = await sondar(
        client,
        "anon",
        "SELECT user_id FROM public.reviews WHERE id = $1",
        [alvo.id],
      );
      afirmar(
        "anon AINDA lê user_id de reviews hoje (instrumento discrimina — sem RLS restritiva, o teste seria vácuo)",
        antes.ok &&
          antes.rows.length === 1 &&
          antes.rows[0].user_id === alvo.user_id,
        JSON.stringify(antes),
      );
    } else {
      console.log(
        "  [N/A  ] controle negativo por leitura direta — nenhuma avaliação publicada com user_id no banco (fixture do passo 1 cobre o resto da prova).",
      );
    }

    // ---- 1. Fixture DENTRO da transação ------------------------------------
    titulo(
      "1. Fixture (autor sem review/question própria; TRÊS produtos criados na tx — público, apagado por soft delete, desativado — cada um com 1 review 'publicada' + 1 pergunta; mais 1 review 'pendente' no produto público)",
    );
    // Autor: um public_profiles EXISTENTE sem review/question própria. Não se
    // cria o perfil na tx porque public_profiles.id -> profiles.id ->
    // auth.users.id (baseline: public_profiles_id_fkey e profiles_id_fkey):
    // criar o autor exigiria inserir em auth.users. O NOT EXISTS força
    // "antes = 0", e toda afirmativa abaixo é por pertinência de id, nunca por
    // contagem.
    const autorRow = await client.query(
      `SELECT pp.id FROM public.public_profiles pp
        WHERE NOT EXISTS (SELECT 1 FROM public.reviews r WHERE r.user_id = pp.id)
          AND NOT EXISTS (SELECT 1 FROM public.questions q WHERE q.user_id = pp.id)
        LIMIT 1`,
    );
    if (autorRow.rows.length === 0) {
      throw new Error(
        "INCONCLUSIVO: nenhum public_profiles sem review/question própria — pré-condição da fixture não bateu.",
      );
    }
    const autor = autorRow.rows[0].id;
    console.log(`  autor=${autor}`);

    // Três produtos, criados só para esta prova (nascem e somem dentro do
    // ROLLBACK do passo 6) — é esse trio que discrimina "ativo = true AND
    // deleted_at IS NULL" vivendo no ON do LEFT JOIN (ADENDO 11/09 item 1)
    // de qualquer uma das duas condições vivendo num WHERE: com WHERE, a
    // linha inteira some (INNER JOIN de fato); com ON (o contrato), ela
    // continua aparecendo com product_id/produto_nome/produto_imagem_url
    // NULL — só o produto PÚBLICO tem os três preenchidos.
    const produtoPublico = await client.query(
      `INSERT INTO public.produtos (nome, custo, preco_venda, ativo, deleted_at)
       VALUES ('prova P1 — produto público', 1, 1, true, NULL)
       RETURNING id`,
    );
    const produtoApagado = await client.query(
      `INSERT INTO public.produtos (nome, custo, preco_venda, ativo, deleted_at)
       VALUES ('prova P1 — produto apagado (soft delete)', 1, 1, true, now())
       RETURNING id`,
    );
    const produtoInativo = await client.query(
      `INSERT INTO public.produtos (nome, custo, preco_venda, ativo, deleted_at)
       VALUES ('prova P1 — produto desativado', 1, 1, false, NULL)
       RETURNING id`,
    );
    const produto = produtoPublico.rows[0].id;

    const reviewPublicada = await client.query(
      `INSERT INTO public.reviews (product_id, user_id, rating, comment, status)
       VALUES ($1, $2, 5, 'prova P1 — publicada (produto público)', 'publicada')
       RETURNING id`,
      [produto, autor],
    );
    const reviewPendente = await client.query(
      `INSERT INTO public.reviews (product_id, user_id, rating, comment, status)
       VALUES ($1, $2, 4, 'prova P1 — pendente (NÃO pode vazar)', 'pendente')
       RETURNING id`,
      [produto, autor],
    );
    const question = await client.query(
      `INSERT INTO public.questions (product_id, user_id, question)
       VALUES ($1, $2, 'prova P1 — pergunta com resposta (produto público)')
       RETURNING id`,
      [produto, autor],
    );
    await client.query(
      `INSERT INTO public.answers (question_id, user_id, answer)
       VALUES ($1, $2, 'prova P1 — resposta única')`,
      [question.rows[0].id, autor],
    );

    const reviewProdutoApagado = await client.query(
      `INSERT INTO public.reviews (product_id, user_id, rating, comment, status)
       VALUES ($1, $2, 5, 'prova P1 — review de produto apagado (soft delete)', 'publicada')
       RETURNING id`,
      [produtoApagado.rows[0].id, autor],
    );
    const perguntaProdutoApagado = await client.query(
      `INSERT INTO public.questions (product_id, user_id, question)
       VALUES ($1, $2, 'prova P1 — pergunta de produto apagado (soft delete)')
       RETURNING id`,
      [produtoApagado.rows[0].id, autor],
    );

    const reviewProdutoInativo = await client.query(
      `INSERT INTO public.reviews (product_id, user_id, rating, comment, status)
       VALUES ($1, $2, 5, 'prova P1 — review de produto desativado', 'publicada')
       RETURNING id`,
      [produtoInativo.rows[0].id, autor],
    );
    const perguntaProdutoInativo = await client.query(
      `INSERT INTO public.questions (product_id, user_id, question)
       VALUES ($1, $2, 'prova P1 — pergunta de produto desativado')
       RETURNING id`,
      [produtoInativo.rows[0].id, autor],
    );
    console.log(
      `  [OK   ] fixture inserida: produto público=${produto}, produto apagado=${produtoApagado.rows[0].id}, ` +
        `produto desativado=${produtoInativo.rows[0].id}, review publicada=${reviewPublicada.rows[0].id}, ` +
        `review pendente=${reviewPendente.rows[0].id}, question=${question.rows[0].id}, ` +
        `review produto apagado=${reviewProdutoApagado.rows[0].id}, question produto apagado=${perguntaProdutoApagado.rows[0].id}, ` +
        `review produto desativado=${reviewProdutoInativo.rows[0].id}, question produto desativado=${perguntaProdutoInativo.rows[0].id}`,
    );

    // ---- 2. Aplica a 20261130000000, lida do disco -------------------------
    titulo("2. Aplicando a 20261130000000 (lida do disco)");
    await client.query(lerSql(NOSSA_MIGRATION));
    console.log(`  [OK   ] aplicada: ${path.basename(NOSSA_MIGRATION)}`);

    // ---- 3. Como anon, antes da 20261111 -----------------------------------
    titulo("3. anon chama as duas RPCs (ainda sem a 20261111 aplicada)");
    const avaliacoesAntes = await sondar(
      client,
      "anon",
      "SELECT * FROM public.perfil_publico_avaliacoes($1)",
      [autor],
    );
    const linhaPublicaAntes = avaliacoesAntes.ok
      ? avaliacoesAntes.rows.find((x) => x.id === reviewPublicada.rows[0].id)
      : undefined;
    const linhaApagadaAntes = avaliacoesAntes.ok
      ? avaliacoesAntes.rows.find(
          (x) => x.id === reviewProdutoApagado.rows[0].id,
        )
      : undefined;
    const linhaInativaAntes = avaliacoesAntes.ok
      ? avaliacoesAntes.rows.find(
          (x) => x.id === reviewProdutoInativo.rows[0].id,
        )
      : undefined;
    afirmar(
      "perfil_publico_avaliacoes devolve a publicada e as dos produtos apagado/desativado, NÃO a pendente",
      avaliacoesAntes.ok &&
        avaliacoesAntes.rows.some((x) => x.id === reviewPublicada.rows[0].id) &&
        avaliacoesAntes.rows.some(
          (x) => x.id === reviewProdutoApagado.rows[0].id,
        ) &&
        avaliacoesAntes.rows.some(
          (x) => x.id === reviewProdutoInativo.rows[0].id,
        ) &&
        !avaliacoesAntes.rows.some((x) => x.id === reviewPendente.rows[0].id),
      JSON.stringify(avaliacoesAntes),
    );
    afirmar(
      "a avaliação do produto PÚBLICO tem product_id (igual ao id do produto, vindo de p.id, ADENDO item 2) e produto_nome preenchidos",
      linhaPublicaAntes !== undefined &&
        linhaPublicaAntes.product_id === produto &&
        linhaPublicaAntes.produto_nome !== null,
      JSON.stringify(linhaPublicaAntes),
    );
    afirmar(
      "a avaliação do produto APAGADO (soft delete, ativo=true) CONTINUA aparecendo, com product_id/produto_nome/produto_imagem_url NULL (prova 'deleted_at IS NULL' no ON — ADENDO item 1; sem isso o product_id do produto apagado vazaria — ADENDO item 2)",
      linhaApagadaAntes !== undefined &&
        linhaApagadaAntes.product_id === null &&
        linhaApagadaAntes.produto_nome === null &&
        linhaApagadaAntes.produto_imagem_url === null,
      JSON.stringify(linhaApagadaAntes),
    );
    afirmar(
      "a avaliação do produto DESATIVADO CONTINUA aparecendo, com product_id/produto_nome/produto_imagem_url NULL (prova que 'ativo = true' vive no ON, não no WHERE)",
      linhaInativaAntes !== undefined &&
        linhaInativaAntes.product_id === null &&
        linhaInativaAntes.produto_nome === null &&
        linhaInativaAntes.produto_imagem_url === null,
      JSON.stringify(linhaInativaAntes),
    );

    const perguntasAntes = await sondar(
      client,
      "anon",
      "SELECT * FROM public.perfil_publico_perguntas($1)",
      [autor],
    );
    const perguntaPublicaAntes = perguntasAntes.ok
      ? perguntasAntes.rows.find((x) => x.id === question.rows[0].id)
      : undefined;
    const perguntaApagadaAntes = perguntasAntes.ok
      ? perguntasAntes.rows.find(
          (x) => x.id === perguntaProdutoApagado.rows[0].id,
        )
      : undefined;
    const perguntaInativaAntes = perguntasAntes.ok
      ? perguntasAntes.rows.find(
          (x) => x.id === perguntaProdutoInativo.rows[0].id,
        )
      : undefined;
    afirmar(
      "perfil_publico_perguntas devolve as três perguntas do autor (produto público, apagado e desativado)",
      perguntasAntes.ok &&
        perguntasAntes.rows.some((x) => x.id === question.rows[0].id) &&
        perguntasAntes.rows.some(
          (x) => x.id === perguntaProdutoApagado.rows[0].id,
        ) &&
        perguntasAntes.rows.some(
          (x) => x.id === perguntaProdutoInativo.rows[0].id,
        ),
      JSON.stringify(perguntasAntes),
    );
    afirmar(
      "a pergunta do produto PÚBLICO tem product_id preenchido (igual ao id do produto) e answers de tamanho 1",
      perguntaPublicaAntes !== undefined &&
        perguntaPublicaAntes.product_id === produto &&
        Array.isArray(perguntaPublicaAntes.answers) &&
        perguntaPublicaAntes.answers.length === 1,
      JSON.stringify(perguntaPublicaAntes),
    );
    afirmar(
      "a pergunta do produto APAGADO (soft delete) CONTINUA aparecendo, com product_id/produto_nome NULL",
      perguntaApagadaAntes !== undefined &&
        perguntaApagadaAntes.product_id === null &&
        perguntaApagadaAntes.produto_nome === null,
      JSON.stringify(perguntaApagadaAntes),
    );
    afirmar(
      "a pergunta do produto DESATIVADO CONTINUA aparecendo, com product_id/produto_nome NULL",
      perguntaInativaAntes !== undefined &&
        perguntaInativaAntes.product_id === null &&
        perguntaInativaAntes.produto_nome === null,
      JSON.stringify(perguntaInativaAntes),
    );

    for (const nome of [
      "perfil_publico_avaliacoes",
      "perfil_publico_perguntas",
    ]) {
      const resultado = await resultadoSemUserId(client, nome);
      afirmar(
        `${nome}: o RETURNS TABLE não contém user_id (pg_get_function_result)`,
        resultado.encontrada && resultado.contemUserId === false,
        JSON.stringify(resultado),
      );
      const podeAnon = await podeExecutar(
        client,
        "anon",
        `public.${nome}(uuid)`,
      );
      const podeAuth = await podeExecutar(
        client,
        "authenticated",
        `public.${nome}(uuid)`,
      );
      afirmar(`${nome}: anon TEM EXECUTE`, podeAnon === true);
      afirmar(`${nome}: authenticated TEM EXECUTE`, podeAuth === true);
      const publicTem = await publicTemExecute(client, nome);
      afirmar(`${nome}: PUBLIC NÃO TEM EXECUTE`, publicTem === false);
    }

    // ---- 4. Aplica a 20261111 (não aditiva) em cima ------------------------
    titulo(
      "4. Aplicando a 20261111000000 EM CIMA (dentro da mesma transação) e repetindo o passo 3",
    );
    await client.query(lerSql(MIGRATION_20261111));
    console.log(`  [OK   ] aplicada: ${path.basename(MIGRATION_20261111)}`);

    const semReviews = await sondar(
      client,
      "anon",
      "SELECT * FROM public.reviews",
    );
    afirmar(
      "anon: SELECT * FROM reviews devolve ZERO linhas depois da 20261111 (a trava está de pé)",
      semReviews.ok && semReviews.rowCount === 0,
      JSON.stringify(semReviews),
    );

    const avaliacoesDepois = await sondar(
      client,
      "anon",
      "SELECT * FROM public.perfil_publico_avaliacoes($1)",
      [autor],
    );
    afirmar(
      "perfil_publico_avaliacoes SOBREVIVE à 20261111: ainda devolve a publicada e as dos produtos apagado/desativado (SECURITY DEFINER ignora a RLS nova)",
      avaliacoesDepois.ok &&
        avaliacoesDepois.rows.some(
          (x) => x.id === reviewPublicada.rows[0].id,
        ) &&
        avaliacoesDepois.rows.some(
          (x) => x.id === reviewProdutoApagado.rows[0].id,
        ) &&
        avaliacoesDepois.rows.some(
          (x) => x.id === reviewProdutoInativo.rows[0].id,
        ) &&
        !avaliacoesDepois.rows.some((x) => x.id === reviewPendente.rows[0].id),
      JSON.stringify(avaliacoesDepois),
    );

    const perguntasDepois = await sondar(
      client,
      "anon",
      "SELECT * FROM public.perfil_publico_perguntas($1)",
      [autor],
    );
    const perguntaAtivaDepois = perguntasDepois.ok
      ? perguntasDepois.rows.find((x) => x.id === question.rows[0].id)
      : undefined;
    afirmar(
      "perfil_publico_perguntas SOBREVIVE à 20261111: ainda devolve as três perguntas, a do produto público com 1 resposta",
      perguntasDepois.ok &&
        perguntasDepois.rows.some(
          (x) => x.id === perguntaProdutoApagado.rows[0].id,
        ) &&
        perguntasDepois.rows.some(
          (x) => x.id === perguntaProdutoInativo.rows[0].id,
        ) &&
        perguntaAtivaDepois !== undefined &&
        Array.isArray(perguntaAtivaDepois.answers) &&
        perguntaAtivaDepois.answers.length === 1,
      JSON.stringify(perguntasDepois),
    );

    // ---- 5. Rollback da 20261130000000 -------------------------------------
    titulo("5. Rollback-manual da 20261130000000 (lido do disco)");
    await client.query(lerSql(NOSSO_ROLLBACK));
    const funcoesDepoisDoRollback = await existemAsDuasFuncoes(client);
    afirmar(
      "as duas RPCs SOMEM de pg_proc depois do rollback",
      funcoesDepoisDoRollback.size === 0,
      `ainda presentes: ${[...funcoesDepoisDoRollback].join(",") || "(nenhuma)"}`,
    );
  } finally {
    // ---- 6. Nada fica gravado -----------------------------------------------
    await client.query("ROLLBACK");
    await client.end();
  }

  console.log(
    `\n${rotulo}: ${falhas === 0 ? "TODAS AS AFIRMATIVAS OK" : `${falhas} FALHA(S)`}`,
  );
}

(async () => {
  falhas = 0;
  await rodar(process.argv[2] || "banco");
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error("INCONCLUSIVO:", e.message);
  process.exit(2);
});
