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
 *      para servir de rollback. ATENÇÃO AO ALCANCE: é só isso que ele salva.
 *      ADD COLUMN, CREATE INDEX, constraint e qualquer UPDATE/INSERT/DELETE da
 *      migration NÃO entram no rollback e continuam sendo desfeitos à mão. O
 *      cabeçalho do arquivo gerado diz isso, e grita quando o arquivo sai sem
 *      nenhuma instrução.
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

/**
 * O `pg` é carregado só na hora de conectar, e não no topo, para que
 * `montarRollback` possa ser importado por um teste sem exigir node_modules
 * (a suíte deste projeto roda em Deno, sem `npm ci`).
 */
function carregarClient() {
  try {
    return require("pg").Client;
  } catch {
    console.error(
      "Pacote 'pg' não encontrado. Instale uma vez com:\n\n  npm i -D pg\n",
    );
    process.exit(1);
  }
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
  "20260808000000_confirmar_pagamento.sql": [
    {
      funcao: "confirmar_pagamento",
      esperado: [
        // FOR UPDATE sem SKIP LOCKED: e' o que faz o webhook ESPERAR a
        // varredura em vez de pular a linha. Trocado por SKIP LOCKED, o
        // pagamento fica sem registro e o teste nao pega.
        "FOR UPDATE;",
        // A releitura que decide. Sem ela volta o UPDATE cego que produz
        // pedido 'pago' com status 'cancelled'.
        "IF v_pedido.payment_status = 'expirado' THEN",
        "RETURN 'pago_apos_expirar';",
        // A guarda que impede credito de estoque em dobro.
        "IF v_pedido.payment_status <> 'aguardando' THEN",
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

/**
 * Monta o texto do arquivo de rollback a partir do que já foi lido do banco.
 *
 * `restauracoes` é uma lista de `{ funcao, defs }` — `defs` vazio quer dizer
 * que a função ainda não existe no banco, então não há definição a restaurar.
 *
 * POR QUE O CABEÇALHO É CONDICIONAL: até 06/08/2026 ele afirmava, sempre,
 * "para desfazer, rode este arquivo inteiro no SQL Editor". Isso só é verdade
 * quando a migration redefine função, porque `funcoesAlteradas()` é a única
 * coisa que este script sabe ler. Naquele dia dois rollbacks saíram sem uma
 * única instrução — um deles referente a uma migration que já tinha cancelado
 * 13 pedidos e creditado 33 unidades de estoque — e mesmo assim mandavam
 * rodar o arquivo para desfazer. Quem lê esse arquivo lê durante um incidente,
 * com backup de até 24 h de idade e sem PITR neste projeto: um "rodei e não
 * aconteceu nada" vira "então já estava desfeito".
 *
 * Devolve `{ conteudo, instrucoes }`, onde `instrucoes` é o número de
 * definições de função efetivamente gravadas — 0 significa arquivo inerte.
 */
function montarRollback(arquivos, restauracoes) {
  const corpo = [];
  let instrucoes = 0;
  for (const { funcao, defs } of restauracoes) {
    if (defs.length === 0) {
      corpo.push(`-- ${funcao}: não existe hoje no banco (será criada).`, "");
      continue;
    }
    corpo.push(`-- ${funcao}`, ...defs.map((d) => `${d};`), "");
    instrucoes += defs.length;
  }

  // `restauracoes` mistura dois casos que o cabeçalho não pode tratar como
  // iguais: função que já existia (dá para restaurar a definição anterior) e
  // função que a migration está CRIANDO (não existe definição anterior — o
  // único jeito de desfazer é DROP FUNCTION, que este script não gera).
  const restauradas = restauracoes.filter((r) => r.defs.length > 0);
  const criadas = restauracoes.filter((r) => r.defs.length === 0);
  const nomesCriadas = criadas.map((r) => r.funcao).join(", ");

  const cabecalho = [
    `-- Rollback gerado automaticamente antes de aplicar: ${arquivos.join(", ")}`,
    "--",
  ];

  if (restauracoes.length === 0) {
    // Nenhum CREATE OR REPLACE FUNCTION em nenhuma migration: só aqui "não
    // redefine função" é verdade.
    cabecalho.push(
      "-- ATENÇÃO: ESTE ROLLBACK NÃO CONTÉM NENHUM COMANDO EXECUTÁVEL.",
      "-- Rodar este arquivo NÃO DESFAZ NADA.",
      "--",
      "-- Esta migration não redefine função, e o db-apply só sabe restaurar",
      "-- definição de função (CREATE OR REPLACE FUNCTION public.<nome>).",
      "-- Desfazer o resto dela — coisas como ADD COLUMN, CREATE INDEX,",
      "-- constraint, UPDATE/INSERT/DELETE — é MANUAL, e o ponto de partida",
      "-- é ler a própria migration em supabase/migrations/.",
    );
  } else if (restauradas.length === 0) {
    // Toca função, mas todas novas: nada a restaurar, arquivo continua
    // inerte — mas por um motivo diferente do caso acima, e o cabeçalho tem
    // de nomear a criação em vez de negá-la.
    cabecalho.push(
      "-- ATENÇÃO: ESTE ROLLBACK NÃO CONTÉM NENHUM COMANDO EXECUTÁVEL.",
      "-- Rodar este arquivo NÃO DESFAZ NADA.",
      "--",
      "-- Esta migration CRIA função nova — a função ainda não existia no",
      `-- banco, então não há definição anterior para restaurar: ${nomesCriadas}.`,
      "-- Desfazê-la(s) é DROP FUNCTION public.<nome>, manual (este script não",
      "-- gera esse comando). O resto da migration — coisas como ADD COLUMN,",
      "-- CREATE INDEX, constraint, UPDATE/INSERT/DELETE — também é MANUAL;",
      "-- o ponto de partida é ler a própria migration em",
      "-- supabase/migrations/.",
    );
  } else {
    // Restaura ao menos uma função que já existia.
    cabecalho.push(
      "-- ESCOPO: este arquivo restaura APENAS a definição anterior das funções",
      "-- listadas abaixo. É o único tipo de rollback que o db-apply sabe gerar.",
      "-- O resto da migration NÃO está aqui: coisas como ADD COLUMN, CREATE",
      "-- INDEX, constraint e UPDATE/INSERT/DELETE continuam aplicados e são",
      "-- manuais.",
      "--",
      "-- Para restaurar as funções, rode este arquivo no SQL Editor. Isso não",
      "-- desfaz a migration inteira.",
    );
    if (criadas.length > 0) {
      // Caso misto: a mesma migration restaura uma função e cria outra.
      // Rodar o arquivo some com a impressão de "desfiz tudo", mas a função
      // nova continua viva no banco.
      cabecalho.push(
        "--",
        "-- Esta migration também CRIA função nova, que não existia no banco:",
        `-- ${nomesCriadas}. Restaurar as funções acima NÃO remove as novas.`,
        "-- Desfazê-la(s) é DROP FUNCTION public.<nome>, manual (este script",
        "-- não gera esse comando).",
      );
    }
  }
  cabecalho.push("");

  return {
    conteudo: [...cabecalho, ...corpo].join("\n"),
    instrucoes,
    // Devolvido para o `main()` reaproveitar em vez de derivar de novo. A
    // mensagem do terminal e o cabeçalho do arquivo TÊM de concordar sobre o
    // que é "função criada" — duas derivações independentes divergiriam em
    // silêncio no dia em que a definição mudar, e o assunto deste script é
    // justamente arquivo e terminal contarem a mesma história.
    nomesCriadas,
  };
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

  const Client = carregarClient();
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const host = new URL(lerDatabaseUrl()).hostname;
  console.log(`Conectado em ${host}`);
  console.log(`Migrations a aplicar: ${arquivos.length}\n`);

  // 1. Rollback das definições atuais.
  const restauracoes = [];
  for (const nome of arquivos) {
    const sql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, path.basename(nome)),
      "utf8",
    );
    for (const fn of funcoesAlteradas(sql)) {
      restauracoes.push({ funcao: fn, defs: await definicaoAtual(client, fn) });
    }
  }
  const { conteudo, instrucoes, nomesCriadas } = montarRollback(
    arquivos,
    restauracoes,
  );
  const arquivoRollback = path.join(
    PROJECT_ROOT,
    `rollback-${arquivos[0].replace(/\.sql$/, "")}.sql`,
  );
  fs.writeFileSync(arquivoRollback, conteudo);
  const caminhoRollback = path.relative(PROJECT_ROOT, arquivoRollback);
  // Mesma distinção do cabeçalho do arquivo, aqui no terminal: quem aplica a
  // migration costuma ler só esta linha e nunca abrir o arquivo. O
  // `nomesCriadas` vem de `montarRollback` de propósito — ver o comentário lá.
  const temCriadas = nomesCriadas !== "";
  if (instrucoes === 0 && !temCriadas) {
    console.warn(
      `ATENÇÃO: o rollback gerado NÃO CONTÉM NENHUM COMANDO — rodá-lo não desfaz nada.
   Arquivo:  ${caminhoRollback}
   Motivo:   nenhuma destas migrations redefine função existente, e o db-apply
             só sabe restaurar definição de função. Desfazer o resto delas
             (ADD COLUMN, CREATE INDEX, constraint, UPDATE/INSERT/DELETE, entre
             outras coisas) é MANUAL. Escreva o desfazer À MÃO ANTES de seguir.\n`,
    );
  } else if (instrucoes === 0) {
    // Toca função, mas todas novas: nada a restaurar, e "não redefine
    // função" seria falso — foi exatamente essa frase que o achado da
    // revisão pegou.
    console.warn(
      `ATENÇÃO: o rollback gerado NÃO CONTÉM NENHUM COMANDO — rodá-lo não desfaz nada.
   Arquivo:  ${caminhoRollback}
   Motivo:   esta(s) migration(ões) CRIA(M) função nova, que ainda não existia
             no banco: ${nomesCriadas}. Não há definição anterior para
             restaurar. Desfazê-la(s) é DROP FUNCTION manual (este script não
             gera esse comando). Escreva o desfazer À MÃO ANTES de seguir.\n`,
    );
  } else if (!temCriadas) {
    console.log(
      `Rollback salvo em: ${caminhoRollback} (${instrucoes} definição(ões) de função; o resto da migration é manual)\n`,
    );
  } else {
    // Caso misto: restaura uma função e cria outra na mesma migration.
    console.log(
      `Rollback salvo em: ${caminhoRollback} (${instrucoes} definição(ões) de função; o resto da migration é manual)
   ATENÇÃO: esta(s) migration(ões) também CRIA(M) função nova (${nomesCriadas}) —
   restaurar as funções acima NÃO remove as novas. DROP FUNCTION é manual.\n`,
    );
  }

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

if (require.main === module) {
  main().catch((erro) => {
    console.error("Erro:", erro.message);
    process.exit(1);
  });
}

// Exportado para tests/db_apply_rollback_test.ts, que fixa o cabeçalho do
// arquivo de rollback. O guarda acima existe por causa disso: sem ele, importar
// o módulo dispararia a aplicação das migrations.
module.exports = { funcoesAlteradas, montarRollback };
