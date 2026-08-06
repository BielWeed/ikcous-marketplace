#!/usr/bin/env node
/**
 * Aplica migrations específicas no banco Supabase, uma por uma.
 *
 * POR QUE ISTO EXISTE, em vez de `supabase db push`:
 * o histórico deste projeto está fora de sincronia — em 29/07/2026 havia ~50
 * migrations locais nunca aplicadas e ~25 migrations no banco sem arquivo local
 * (aplicadas por fora, provavelmente pelo SQL Editor). Um `db push` tentaria
 * replayar as ~50 pendentes em cima de um banco que já divergiu, reescrevendo
 * políticas RLS e substituindo funções numa loja no ar. Aqui você escolhe
 * explicitamente o que aplicar.
 *
 * O QUE ELE FAZ, nesta ordem:
 *   1. Salva num arquivo a definição ATUAL de cada função que a migration toca,
 *      para servir de rollback.
 *   2. Aplica cada migration numa transação própria. Se falhar, faz ROLLBACK e para.
 *   3. Registra a versão em supabase_migrations.schema_migrations.
 *   4. Reexecuta uma verificação: confere se os marcadores esperados estão mesmo
 *      na função que ficou no banco.
 *
 * USO:
 *   node scripts/db-apply.cjs <arquivo.sql> [outro.sql ...]
 *   node scripts/db-apply.cjs --dry-run <arquivo.sql>    # só mostra o plano
 *
 * EXEMPLO:
 *   node scripts/db-apply.cjs \
 *     20260729000000_fix_free_shipping_rule_parity.sql \
 *     20260729000001_fix_upsert_store_config_partial.sql
 *
 * A conexão sai de DATABASE_URL (variável de ambiente ou .env do projeto).
 * Requer o pacote `pg`:  npm i -D pg
 */

const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "supabase", "migrations");

let Client;
try {
  ({ Client } = require("pg"));
} catch {
  console.error(
    "Pacote 'pg' não encontrado. Instale uma vez com:\n\n  npm i -D pg\n",
  );
  process.exit(1);
}

/** Marcadores que devem existir na função depois de aplicada. */
const VERIFICACOES = {
  "20260729000000_fix_free_shipping_rule_parity.sql": {
    funcao: "create_marketplace_order_v22",
    esperado: [
      "v_user_id IS NOT NULL AND v_calculated_subtotal >= v_free_shipping_min",
      "NULLIF(v_store_config.free_shipping_min, 0)",
      "Os valores do pedido mudaram",
    ],
  },
  "20260729000001_fix_upsert_store_config_partial.sql": {
    funcao: "upsert_store_config",
    esperado: [
      "config_json ? 'logo_url'",
      "config_json ? 'whatsapp_number'",
      "ELSE store_config.primary_color END",
    ],
  },
  "20260804000000_add_is_admin_guard_to_category_analytics.sql": {
    funcao: "get_category_analytics",
    esperado: [
      // A guarda em si (BANCO-020).
      "IF NOT public.is_admin() THEN",
      "Acesso negado: privilégios de administrador necessários.",
      // O corpo da consulta tem de sobreviver ao REPLACE: se a linha de Frete
      // sumir, o dashboard perde o bloco de faturamento por frete em silêncio.
      "'Frete'::text as name",
    ],
  },
  "20260804010000_fix_order_owner_check_null_safety.sql": {
    funcao: "update_order_status_atomic",
    esperado: [
      // Defesa em profundidade: hoje `anon` nao tem EXECUTE nesta funcao, entao
      // o unico caso que esta linha pega e token expirado (PEDIDO-010).
      "IF v_caller_id IS NULL THEN",
      // A comparação à prova de NULL na checagem de dono — é ela que fecha o furo.
      "v_user_id IS DISTINCT FROM v_caller_id AND NOT v_is_admin",
      // A restauração de estoque tem de sobreviver ao REPLACE: sem ela o
      // cancelamento deixaria de devolver o produto para a prateleira.
      "SET estoque = estoque + v_item.quantity",
    ],
  },
  "20260805120000_otp_aponta_para_o_projeto_certo.sql": {
    funcao: "handle_new_otp_verification",
    esperado: [
      // O destino certo. Entre 08/07 e 05/08/2026 o corpo vivo apontava para
      // jvgyjlbjhbfrncwbytls, onde send-otp-email nao existe — 404 silencioso.
      "https://cafkrminfnokvgjqtkle.functions.supabase.co/send-otp-email",
      // A credencial vem do Vault. Se esta linha sumir, voltou o caminho por
      // app_settings/header, que manda a chave anon e leva 401.
      "FROM vault.decrypted_secrets",
      "WHERE name = 'otp_trigger_secret'",
      // Sem segredo a funcao falha em vez de gravar um OTP que nao seria
      // entregue. E o PEDIDO-080 visto pelo lado do banco.
      "RAISE EXCEPTION USING",
    ],
  },
  "20260807000000_reserva_com_expiracao.sql": [
    {
      funcao: "devolver_estoque",
      esperado: [
        // Guarda do IF/ELSE (variante XOR produto), nao dois IF independentes.
        // Se alguem trocar por dois IF, este ELSE colado no UPDATE de produtos
        // deixa de existir no corpo, e a verificacao reprova. E essa a regra
        // que evita creditar variante E produto pai a cada expiracao.
        "ELSE\n            UPDATE public.produtos",
        "SET stock_increment = stock_increment + v_item.quantity",
      ],
    },
    {
      funcao: "expirar_pedidos_vencidos",
      esperado: [
        // So varre pedido 'aguardando': sem este filtro, a funcao passaria a
        // cancelar pedido ja pago ou historico (payment_status NULL).
        "WHERE payment_status = 'aguardando'",
        // So varre pedido 'pending': sem este filtro, um pedido que o
        // cliente ja cancelou pelo app (a update_order_status_atomic devolve
        // o estoque no cancelamento e nao escreve payment_status) seria
        // creditado uma segunda vez pela varredura.
        "AND status = 'pending'",
        // FOR UPDATE SKIP LOCKED: sem ele, a varredura disputa a linha com o
        // webhook da Fase 3 em vez de pular o pedido que ja esta sendo
        // confirmado — e pode expirar um pedido que acabou de ser pago.
        "FOR UPDATE SKIP LOCKED",
      ],
    },
    {
      funcao: "create_marketplace_order_v24",
      esperado: [
        // O carimbo desta task: sem ele o pedido nasce sem prazo e a
        // varredura nunca o alcanca.
        "'aguardando', now() + interval '30 minutes'",
        // Recalculo do total pelos precos do banco (Price Tampering
        // Protection da v23). Se um REPLACE mal copiado apagar esta linha, o
        // cliente volta a poder mandar o proprio total — e a verificacao tem
        // de gritar em vez de deixar passar em silencio.
        "IF ABS(v_calculated_total - p_total_amount) > 0.05 THEN",
        // Checagem de estoque contra o valor do banco (nao o do cliente).
        // Mesma logica: sem esta linha o pedido pode vender o que nao tem.
        "IF v_db_stock < v_quantity THEN",
        // Paridade de frete gratis para usuario logado (a correcao da
        // 20260729000000_fix_free_shipping_rule_parity.sql, hoje guardada
        // pela entrada da v22 acima). Quando a Task 6 apontar o front para a
        // v24, e esta linha que passa a ser a guarda que importa — sem
        // marcador aqui, um REPLACE mal copiado da v24 poderia perder o
        // predicado e ninguem notaria, porque a entrada da v22 continuaria
        // passando para uma funcao que ninguem mais chama.
        "OR (v_user_id IS NOT NULL AND v_calculated_subtotal >= v_free_shipping_min)",
      ],
    },
  ],
};

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    if (!fs.existsSync(caminho)) continue;
    const linha = fs
      .readFileSync(caminho, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  throw new Error(
    "DATABASE_URL não encontrada (nem no ambiente, nem em .env.local, nem em .env).",
  );
}

/** Descobre quais funções a migration redefine, para conseguir salvar o rollback. */
function funcoesAlteradas(sql) {
  const nomes = new Set();
  const re = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)/gi;
  let m;
  while ((m = re.exec(sql))) nomes.add(m[1]);
  return [...nomes];
}

async function definicaoAtual(client, nomeFuncao) {
  const { rows } = await client.query(
    `SELECT pg_get_functiondef(p.oid) AS def
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = $1`,
    [nomeFuncao],
  );
  return rows.map((r) => r.def);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const arquivos = args.filter((a) => !a.startsWith("--"));

  if (arquivos.length === 0) {
    console.error("Informe ao menos um arquivo de migration.\n");
    console.error("  node scripts/db-apply.cjs <arquivo.sql> [outro.sql ...]");
    process.exit(1);
  }

  for (const nome of arquivos) {
    const caminho = path.join(MIGRATIONS_DIR, path.basename(nome));
    if (!fs.existsSync(caminho)) {
      console.error(`Migration não encontrada: ${caminho}`);
      process.exit(1);
    }
  }

  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const host = new URL(lerDatabaseUrl()).hostname;
  console.log(`Conectado em ${host}`);
  console.log(`Migrations a aplicar: ${arquivos.length}\n`);

  // 1. Rollback das definições atuais.
  const partesRollback = [
    `-- Rollback gerado automaticamente antes de aplicar: ${arquivos.join(", ")}`,
    "-- Para desfazer, rode este arquivo inteiro no SQL Editor.",
    "",
  ];
  for (const nome of arquivos) {
    const sql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, path.basename(nome)),
      "utf8",
    );
    for (const fn of funcoesAlteradas(sql)) {
      const defs = await definicaoAtual(client, fn);
      if (defs.length === 0) {
        partesRollback.push(
          `-- ${fn}: não existe hoje no banco (será criada).`,
          "",
        );
        continue;
      }
      partesRollback.push(`-- ${fn}`, ...defs.map((d) => `${d};`), "");
    }
  }
  const arquivoRollback = path.join(
    PROJECT_ROOT,
    `rollback-${arquivos[0].replace(/\.sql$/, "")}.sql`,
  );
  fs.writeFileSync(arquivoRollback, partesRollback.join("\n"));
  console.log(
    `Rollback salvo em: ${path.relative(PROJECT_ROOT, arquivoRollback)}\n`,
  );

  if (dryRun) {
    console.log("--dry-run: nada foi aplicado.");
    await client.end();
    return;
  }

  // 2. Aplica cada uma em transação própria.
  for (const nome of arquivos) {
    const base = path.basename(nome);
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, base), "utf8");
    const versao = base.split("_")[0];
    const rotulo = base.replace(/^\d+_/, "").replace(/\.sql$/, "");

    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        `INSERT INTO supabase_migrations.schema_migrations (version, name)
         VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
        [versao, rotulo],
      );
      await client.query("COMMIT");
      console.log(`  aplicada  ${base}`);
    } catch (erro) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(`  FALHOU    ${base}\n            ${erro.message}`);
      console.error("\nNada foi comitado desta migration. Parando aqui.");
      await client.end();
      process.exit(1);
    }
  }

  // 3. Verificação pós-aplicação.
  console.log("\nVerificação:");
  let tudoOk = true;
  for (const nome of arquivos) {
    const base = path.basename(nome);
    const registro = VERIFICACOES[base];
    if (!registro) {
      console.log(`  ${base}: sem verificação registrada, pulando.`);
      continue;
    }
    // Um arquivo pode redefinir mais de uma função (ex.: a mesma migration
    // reaplicada task a task) — registro vira lista nesse caso.
    const checagens = Array.isArray(registro) ? registro : [registro];
    for (const checagem of checagens) {
      const [def] = await definicaoAtual(client, checagem.funcao);
      // Normaliza \r\n -> \n dos dois lados antes de comparar. O repo nao tem
      // .gitattributes e core.autocrlf converte as migrations para CRLF no
      // working tree a cada checkout/clone/stash; sem isso, um marcador que
      // cruza uma quebra de linha (ex.: "ELSE\n            UPDATE ...") deixa
      // de casar contra um corpo em CRLF e a verificacao grita AUSENTE para
      // uma migration que esta correta — DEPOIS do COMMIT ja ter acontecido.
      const defNormalizado = def?.replace(/\r\n/g, "\n");
      for (const marcador of checagem.esperado) {
        const marcadorNormalizado = marcador.replace(/\r\n/g, "\n");
        const ok = Boolean(defNormalizado?.includes(marcadorNormalizado));
        if (!ok) tudoOk = false;
        const rotulo = `${checagem.funcao}: ${marcador.slice(0, 64)}`;
        console.log(`  ${ok ? "ok     " : "AUSENTE"}  ${rotulo}`);
      }
    }
  }

  await client.end();
  console.log(
    tudoOk
      ? "\nTudo aplicado e verificado."
      : "\nATENÇÃO: algum marcador esperado não apareceu. Confira antes de confiar.",
  );
  process.exit(tudoOk ? 0 : 1);
}

main().catch((erro) => {
  console.error("Erro:", erro.message);
  process.exit(1);
});
