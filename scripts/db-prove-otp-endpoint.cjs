#!/usr/bin/env node
/**
 * Prova a migration 20260805120000 (OTP apontando para o projeto certo) sem
 * comitar nada no banco. Cobre AUTH-020 (#41), PEDIDO-050 (#85) e PEDIDO-080 (#86).
 *
 * O QUE ELE FAZ, tudo dentro de UMA transação que termina em ROLLBACK:
 *   1. Fotografa o corpo vivo e confirma o defeito: URL do projeto
 *      jvgyjlbjhbfrncwbytls, credencial vindo de app_settings/header.
 *   2. Confirma que `app_settings` está vazia — é o que faz o corpo atual cair
 *      no fallback e mandar a chave ANON como Bearer.
 *   3. Confere que o segredo `otp_trigger_secret` existe no Vault. Só formato:
 *      tamanho e prefixo. O valor não é lido para fora do banco.
 *   4. Apaga o segredo num savepoint e tenta aplicar: tem de ser RECUSADA pelo
 *      bloco DO. Desfaz o savepoint e confere que o segredo voltou.
 *   5. Aplica a migration.
 *   6. Confere o corpo novo: projeto certo, sem o projeto errado, sem header,
 *      sem app_settings, lendo o Vault.
 *   7. Confere que ACL e SECURITY DEFINER sobreviveram ao REPLACE.
 *   8. Ponta a ponta: insere uma linha em otp_verifications e confirma que o
 *      pg_net enfileirou UM POST, para a URL certa, com o Bearer igual ao
 *      segredo do Vault — a comparação acontece DENTRO do SQL e volta boolean.
 *   9. Apaga o segredo e repete o INSERT: tem de FALHAR, em vez de prometer
 *      entrega que não acontece.
 *  10. ROLLBACK. O banco fica exatamente como estava.
 *
 * POR QUE O PASSO 7 NÃO MANDA E-MAIL DE VERDADE:
 *   `net.http_post` não faz a requisição na hora — ele enfileira em
 *   `net.http_request_queue` e um worker de fundo envia DEPOIS do commit. Como
 *   esta transação termina em ROLLBACK, a linha da fila some junto e nada sai
 *   pela rede. Dá para provar o que foi enfileirado, não a entrega.
 *
 *   A entrega só se prova com um INSERT comitado de verdade, e aí o e-mail vai
 *   para o endereço da linha. Use o seu — ver o passo 4 do PR.
 *
 * USO:  node scripts/db-prove-otp-endpoint.cjs
 * Sai com código 0 só se todas as asserções passarem.
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const { resolverCaminhoMigration } = require("./ler-migration.cjs");
const NOME_DA_MIGRATION = "20260805120000_otp_aponta_para_o_projeto_certo.sql";
const MIGRATION = resolverCaminhoMigration(NOME_DA_MIGRATION);

const PROJETO_CERTO = "cafkrminfnokvgjqtkle";
const PROJETO_ERRADO = "jvgyjlbjhbfrncwbytls";
const NOME_SEGREDO = "otp_trigger_secret";

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(caminho)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const conteudo = fs.readFileSync(caminho, "utf8");
    const linha = conteudo
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  throw new Error(
    "DATABASE_URL não encontrada (nem no ambiente, nem em .env.local, nem em .env).",
  );
}

async function fotografar(client) {
  const { rows } = await client.query(`
    SELECT pg_get_functiondef(p.oid) AS def,
           p.prosecdef,
           COALESCE(p.proacl::text, '(sem ACL explícita)') AS acl
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'handle_new_otp_verification'`);
  if (rows.length !== 1) {
    throw new Error(
      `Esperava 1 handle_new_otp_verification, achei ${rows.length}.`,
    );
  }
  return rows[0];
}

/** Roda algo isolado num savepoint. Devolve { falhou, mensagem }. */
async function tentar(client, rotulo, fn) {
  await client.query(`SAVEPOINT s_${rotulo}`);
  try {
    const valor = await fn();
    await client.query(`RELEASE SAVEPOINT s_${rotulo}`);
    return { falhou: false, valor };
  } catch (erro) {
    await client.query(`ROLLBACK TO SAVEPOINT s_${rotulo}`);
    return { falhou: true, mensagem: erro.message };
  }
}

async function main() {
  if (!MIGRATION)
    throw new Error(
      `Migration não encontrada (raiz nem _arquivadas): ${NOME_DA_MIGRATION}`,
    );
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const sqlMigration = fs.readFileSync(MIGRATION, "utf8");

  // TRAVA QUE FALTOU EM 05/08/2026, e o preço foi alto.
  //
  // Este script roda a migration DENTRO de uma transação que termina em
  // ROLLBACK. Se o arquivo trouxer o próprio COMMIT, ele fecha a transação
  // externa: o ROLLBACK do final vira no-op e tudo o que era ensaio fica
  // gravado em produção — inclusive o INSERT de teste em otp_verifications e o
  // segredo falso no Vault. Foi exatamente isso que aconteceu.
  //
  // Só olha fora de comentário e de string, senão o próprio texto deste aviso
  // dispararia a trava.
  const semComentarios = sqlMigration
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/'[^']*'/g, "''");
  const controleDeTransacao = semComentarios.match(
    /(?:^|;)\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\s*;/gi,
  );
  if (controleDeTransacao) {
    const encontrados = controleDeTransacao.map((s) => s.trim()).join(" ");
    throw new Error(
      [
        `A migration controla transação por conta própria (${encontrados}).`,
        "Rodar isso aqui comitaria em produção o que devia ser ensaio.",
        "Tire o BEGIN/COMMIT: quem abre a transação é o db-apply.cjs.",
      ].join(" "),
    );
  }

  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log(`Conectado em ${new URL(lerDatabaseUrl()).hostname}`);
  console.log(
    "Nada será comitado: tudo roda numa transação que termina em ROLLBACK.\n",
  );

  const falhas = [];
  await client.query("BEGIN");

  try {
    // ---- 1. O defeito é real hoje? -----------------------------------------
    const antes = await fotografar(client);
    const apontaErrado = antes.def.includes(PROJETO_ERRADO);
    const usaHeader = antes.def.includes("request.headers");
    const usaAppSettings = antes.def.includes("app_settings");
    console.log("=== 1. Estado atual no banco ===");
    console.log(`  aponta para ${PROJETO_ERRADO} : ${apontaErrado}`);
    console.log(`  cai no header apikey         : ${usaHeader}`);
    console.log(`  lê app_settings              : ${usaAppSettings}`);
    console.log(
      `  secdef / acl                 : ${antes.prosecdef} / ${antes.acl}`,
    );
    if (!apontaErrado) {
      falhas.push(
        `O corpo vivo NÃO aponta mais para ${PROJETO_ERRADO}. Alguém já mexeu por fora — releia o corpo antes de aplicar.`,
      );
    }

    // ---- 2. app_settings está mesmo vazia? ---------------------------------
    const { rows: cfg } = await client.query(
      "SELECT count(*)::int AS n FROM public.app_settings WHERE key = 'supabase_service_role_key'",
    );
    console.log("\n=== 2. De onde sai a credencial hoje ===");
    console.log(
      `  linhas em app_settings['supabase_service_role_key'] : ${cfg[0].n}`,
    );
    console.log(
      cfg[0].n === 0
        ? "  => cai no fallback e manda a chave ANON de quem chamou como Bearer => 401"
        : "  => existe valor configurado; conferir se é a chave que a edge function aceita",
    );

    // ---- 3. O segredo real existe? -----------------------------------------
    // O valor nunca é lido para cá: só formato. A comparação com o que o trigger
    // manda é feita DENTRO do SQL, no passo 7, e volta como boolean.
    const { rows: seg } = await client.query(
      `SELECT length(decrypted_secret) AS tamanho,
              left(decrypted_secret, 9) AS prefixo
         FROM vault.decrypted_secrets WHERE name = $1`,
      [NOME_SEGREDO],
    );
    console.log(`\n=== 3. Segredo "${NOME_SEGREDO}" no Vault ===`);
    if (seg.length === 0) {
      console.log("  AUSENTE");
      throw new Error(
        `Sem o segredo "${NOME_SEGREDO}" no Vault não há o que provar. Instale os dois lados primeiro — ver o cabeçalho da migration.`,
      );
    }
    console.log(
      `  presente — ${seg[0].tamanho} chars, prefixo "${seg[0].prefixo}"`,
    );

    // ---- 4. A trava de apply funciona? -------------------------------------
    // Apaga o segredo dentro de um savepoint, tenta aplicar, desfaz. O segredo
    // volta intacto: o DELETE nunca sai desta transação.
    const semSegredo = await tentar(client, "gate", async () => {
      await client.query("DELETE FROM vault.secrets WHERE name = $1", [
        NOME_SEGREDO,
      ]);
      return client.query(sqlMigration);
    });
    console.log("\n=== 4. Aplicar SEM o segredo no Vault ===");
    console.log(
      semSegredo.falhou
        ? `  RECUSADA  ${semSegredo.mensagem}`
        : "  FALHOU    a migration foi aplicada mesmo sem segredo",
    );
    if (!semSegredo.falhou) {
      falhas.push(
        "A trava do bloco DO não barrou o apply sem segredo — aplicar assim troca 404 por 401.",
      );
    }
    const { rows: voltou } = await client.query(
      "SELECT count(*)::int AS n FROM vault.decrypted_secrets WHERE name = $1",
      [NOME_SEGREDO],
    );
    console.log(
      `  ${voltou[0].n === 1 ? "OK     " : "FALHOU "} o segredo voltou depois do savepoint (${voltou[0].n})`,
    );
    if (voltou[0].n !== 1)
      falhas.push("O segredo não voltou depois do ROLLBACK TO SAVEPOINT.");

    // ---- 5. Aplica a migration ----------------------------------------------
    await client.query(sqlMigration);
    console.log("\n=== 5. Migration aplicada (dentro da transação) ===");
    console.log("  ok");

    // ---- 6. O corpo novo ----------------------------------------------------
    const depois = await fotografar(client);
    const checagens = [
      [
        `aponta para ${PROJETO_CERTO}`,
        depois.def.includes(PROJETO_CERTO),
        true,
      ],
      [
        `não cita ${PROJETO_ERRADO}`,
        !depois.def.includes(PROJETO_ERRADO),
        true,
      ],
      [
        "não usa request.headers",
        !depois.def.includes("request.headers"),
        true,
      ],
      ["não lê app_settings", !depois.def.includes("app_settings"), true],
      ["lê o Vault", depois.def.includes("vault.decrypted_secrets"), true],
    ];
    console.log("\n=== 6. Corpo depois da migration ===");
    for (const [rotulo, valor] of checagens) {
      console.log(`  ${valor ? "OK     " : "FALHOU "} ${rotulo}`);
      if (!valor) falhas.push(`Corpo novo: ${rotulo} — não confere.`);
    }

    // ---- 7. ACL e SECURITY DEFINER preservados ------------------------------
    console.log("\n=== 7. ACL e SECURITY DEFINER preservados? ===");
    console.log(`  acl    antes/depois : ${antes.acl} / ${depois.acl}`);
    console.log(
      `  secdef antes/depois : ${antes.prosecdef} / ${depois.prosecdef}`,
    );
    if (antes.acl !== depois.acl)
      falhas.push("O proacl mudou depois do REPLACE.");
    if (antes.prosecdef !== depois.prosecdef)
      falhas.push("O prosecdef mudou depois do REPLACE.");

    // ---- 8. Ponta a ponta: o trigger enfileira o POST certo? ----------------
    const { rows: pedidos } = await client.query(
      "SELECT id FROM public.marketplace_orders ORDER BY created_at DESC LIMIT 1",
    );
    if (pedidos.length === 0) {
      throw new Error(
        "Não há pedido em marketplace_orders para amarrar o OTP (order_id é NOT NULL com FK).",
      );
    }
    const { rows: filaAntes } = await client.query(
      "SELECT count(*)::int AS n FROM net.http_request_queue",
    );
    await client.query(
      `INSERT INTO public.otp_verifications
         (email, whatsapp, otp_code, expires_at, order_id)
       VALUES ($1, $2, $3, NOW() + INTERVAL '15 minutes', $4)`,
      ["prova@exemplo.invalid", "34999990000", "123456", pedidos[0].id],
    );
    // `body` é bytea no pg_net 0.19 — precisa voltar para texto antes do ->>.
    // O Authorization é comparado com o Vault DENTRO do SQL: volta boolean, e o
    // valor do segredo nunca sai do banco.
    const { rows: fila } = await client.query(
      `SELECT q.url,
              q.headers->>'Authorization' = 'Bearer ' ||
                  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1)
                                                                    AS auth_bate,
              left(q.headers->>'Authorization', 16)                  AS auth_prefixo,
              convert_from(q.body, 'utf8')::jsonb->>'table'          AS tabela,
              convert_from(q.body, 'utf8')::jsonb#>>'{record,otp_code}' AS codigo
         FROM net.http_request_queue q
        ORDER BY q.id DESC LIMIT 1`,
      [NOME_SEGREDO],
    );
    const { rows: filaDepois } = await client.query(
      "SELECT count(*)::int AS n FROM net.http_request_queue",
    );
    const enfileirou = filaDepois[0].n === filaAntes[0].n + 1;
    const urlCerta = fila[0]?.url?.includes(PROJETO_CERTO) === true;
    const bearerDoVault = fila[0]?.auth_bate === true;
    console.log(
      "\n=== 8. INSERT em otp_verifications → o que foi enfileirado ===",
    );
    console.log(
      `  ${enfileirou ? "OK     " : "FALHOU "} exatamente 1 requisição nova na fila`,
    );
    console.log(`  url    : ${fila[0]?.url ?? "(nada na fila)"}`);
    console.log(
      `  ${urlCerta ? "OK     " : "FALHOU "} url é do projeto ${PROJETO_CERTO}`,
    );
    console.log(
      `  ${bearerDoVault ? "OK     " : "FALHOU "} Authorization bate com o segredo do Vault (prefixo "${fila[0]?.auth_prefixo ?? "-"}...")`,
    );
    const levaOCodigo = fila[0]?.codigo === "123456";
    console.log(`  body.table : ${fila[0]?.tabela ?? "-"}`);
    console.log(
      `  ${levaOCodigo ? "OK     " : "FALHOU "} body.record.otp_code é o código inserido`,
    );
    if (!enfileirou)
      falhas.push("O trigger não enfileirou requisição no pg_net.");
    if (!levaOCodigo)
      falhas.push(
        "O corpo enfileirado não leva o otp_code — a edge function exige record.otp_code (send-otp-email/index.ts:69).",
      );
    if (!urlCerta)
      falhas.push("A requisição enfileirada não vai para o projeto certo.");
    if (!bearerDoVault)
      falhas.push("O Authorization não trouxe o segredo do Vault.");

    // ---- 9. Sem segredo, falha alto em vez de prometer ----------------------
    const semChave = await tentar(client, "sem_chave", async () => {
      await client.query("DELETE FROM vault.secrets WHERE name = $1", [
        NOME_SEGREDO,
      ]);
      return client.query(
        `INSERT INTO public.otp_verifications
           (email, whatsapp, otp_code, expires_at, order_id)
         VALUES ($1, $2, $3, NOW() + INTERVAL '15 minutes', $4)`,
        ["prova2@exemplo.invalid", "34999990001", "654321", pedidos[0].id],
      );
    });
    console.log(
      "\n=== 9. Com o Vault vazio, o INSERT falha em vez de prometer? ===",
    );
    console.log(
      semChave.falhou
        ? `  OK      ${semChave.mensagem.split("\n")[0]}`
        : "  FALHOU  gravou o OTP mesmo sem poder enviar o código",
    );
    if (!semChave.falhou)
      falhas.push(
        "Sem segredo, o OTP continuou sendo gravado — é o PEDIDO-080 de volta.",
      );
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }

  console.log(`\n${"=".repeat(60)}`);
  if (falhas.length === 0) {
    console.log(
      "TUDO PROVADO. Nada foi comitado.\n" +
        "Para valer: guarde o segredo REAL no Vault e rode o db-apply.cjs.",
    );
    process.exit(0);
  }
  console.log("NÃO PROVADO:");
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}

main().catch((erro) => {
  console.error("Erro:", erro.message);
  process.exit(1);
});
