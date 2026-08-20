#!/usr/bin/env node
/**
 * Prova a migration 20260821000200_cupom_sem_limite_e_ilimitado.sql
 * (auditoria de 20/08/2026, achado 1).
 *
 * TUDO roda em UMA transacao terminada em ROLLBACK. Nada e gravado — nem o
 * produto de teste, nem os cupons, nem os pedidos, nem o CREATE OR REPLACE das
 * duas funcoes. Isso so e verdade porque a migration NAO tem BEGIN/COMMIT
 * embutido: se alguem acrescentar um, este script passa a gravar de verdade
 * sem avisar.
 *
 * RISCO — DDL dentro da transacao: o script roda `CREATE OR REPLACE FUNCTION`
 * nas duas funcoes que criam pedido, que sao o caminho do dinheiro. E seguro
 * porque tudo, sem excecao, esta dentro do mesmo BEGIN/ROLLBACK de main(): a
 * versao nova nunca existe fora desta transacao.
 *
 * O QUE ESTE SCRIPT PRECISA PROVAR, E POR QUE CADA CASO EXISTE
 *
 *   O defeito nao e "o cupom nao funciona". E "duas regras que decidem a mesma
 *   coisa discordam": a validacao que o checkout chama
 *   (`validate_coupon_secure_v2`) dizia SIM para limite 0 e a criacao do pedido
 *   dizia NAO. Entao a prova nao pode ser so "agora o pedido passa" — ela tem
 *   de comparar as DUAS regras, cupom a cupom. E o que os casos de paridade
 *   fazem.
 *
 *   E a correcao tem um modo de falhar obvio: afrouxar demais e deixar todo
 *   cupom valido para sempre. Trocar o predicado por `true` faria "limite 0
 *   passa" ficar verde. Por isso os casos 4 e 7 existem — limite de VERDADE
 *   esgotado tem de continuar recusado, na v23 e na v24. Sem eles esta prova
 *   nao distingue conserto de buraco.
 *
 * CENARIO FIXADO DE PROPOSITO
 *   O script altera `store_config` DENTRO da transacao (frete fixo 10, sem
 *   frete gratis por valor) para que os totais esperados sejam numeros
 *   literais deste arquivo, e nao a mesma conta que a funcao sob teste faz.
 *   Comparar o resultado com a formula que o proprio codigo usa nao prova nada.
 *
 * USO:  node scripts/db-prove-cupom-sem-limite.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const RAIZ = path.resolve(__dirname, "..");
const MIGRATION = "20260821000200_cupom_sem_limite_e_ilimitado.sql";

// Cenario: 1 unidade de um produto de R$ 100,00 + frete fixo de R$ 10,00.
const PRECO = 100;
const FRETE = 10;

let passou = 0;
let falhou = 0;

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(RAIZ, arquivo);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(caminho)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const linha = fs
      .readFileSync(caminho, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  throw new Error("DATABASE_URL nao encontrada.");
}

function conferir(nome, condicao, detalhe) {
  if (condicao) {
    passou++;
    console.log(`  ok   ${nome}`);
  } else {
    falhou++;
    console.error(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

async function migrationJaAplicadaAoVivo(client) {
  const { rows } = await client.query(`
    SELECT bool_and(prosrc ~ 'usage_limit <= 0') AS aplicada
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('create_marketplace_order_v23','create_marketplace_order_v24')`);
  return rows[0]?.aplicada === true;
}

async function criarProduto(client) {
  // `custo` e NOT NULL sem default nesta tabela — omitir quebra o INSERT.
  const { rows } = await client.query(
    `INSERT INTO public.produtos (nome, custo, preco_venda, estoque, categoria, ativo, frete_gratis)
     VALUES ('PROVA CUPOM SEM LIMITE', 10.00, $1, 500, 'teste', true, false)
     RETURNING id`,
    [PRECO],
  );
  return rows[0].id;
}

/** Cria um cupom percentual de 10%, sem minimo e sem validade. */
async function criarCupom(client, { code, usageLimit, usageCount = 0 }) {
  const { rows } = await client.query(
    `INSERT INTO public.coupons (code, type, value, min_purchase, usage_limit, usage_count, valid_until, active)
     VALUES ($1, 'percentage', 10, NULL, $2, $3, NULL, true)
     RETURNING id`,
    [code, usageLimit, usageCount],
  );
  return rows[0].id;
}

/**
 * Chama a criacao de pedido como CONVIDADO (auth.uid() e NULL fora de sessao
 * do PostgREST). Devolve { ok: true, orderId } ou { ok: false, erro }.
 *
 * O SAVEPOINT nao e detalhe de estilo: metade dos casos aqui ESPERA que a
 * funcao levante excecao, e uma excecao aborta a transacao inteira no
 * PostgreSQL — sem o savepoint, o primeiro caso de recusa derruba todos os
 * seguintes com "current transaction is aborted".
 */
let seqSavepoint = 0;
async function criarPedido(client, { rpc, produtoId, codigo, total }) {
  const itens = JSON.stringify([{ product_id: produtoId, quantity: 1 }]);
  const sp = `sp_${seqSavepoint++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    const { rows } = await client.query(
      `SELECT public.${rpc}(
         $1::jsonb, $2::numeric, $3::numeric, 'pix'::text, NULL::uuid, $4::text,
         'PROVA CUPOM'::text, '34999999999'::text, NULL::text, NULL::jsonb,
         NULL::text, NULL::text
       ) AS id`,
      [itens, total, FRETE, codigo],
    );
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return { ok: true, orderId: rows[0].id };
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return { ok: false, erro: e.message };
  }
}

/** O que a validacao do checkout responde para o mesmo cupom. */
async function validacaoDoCheckout(client, codigo) {
  const { rows } = await client.query(
    "SELECT public.validate_coupon_secure_v2($1, $2) AS r",
    [codigo, PRECO],
  );
  return rows[0].r;
}

async function estadoDoPedido(client, orderId) {
  const { rows } = await client.query(
    `SELECT total::numeric AS total, discount::numeric AS discount,
            subtotal::numeric AS subtotal, coupon_id, coupon_code
       FROM public.marketplace_orders WHERE id = $1`,
    [orderId],
  );
  return rows[0];
}

async function usosDoCupom(client, cupomId) {
  const { rows } = await client.query(
    "SELECT usage_count FROM public.coupons WHERE id = $1",
    [cupomId],
  );
  return rows[0].usage_count;
}

const recusouPorCupom = (r) =>
  r.ok === false && /inv[aá]lido ou expirado/i.test(r.erro);

async function main() {
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("BEGIN");

  try {
    const jaAplicada = await migrationJaAplicadaAoVivo(client);
    console.log(
      jaAplicada
        ? `banco: ${MIGRATION} JA aplicada (as assercoes provam o BANCO real)`
        : `banco: ${MIGRATION} AINDA NAO aplicada (as assercoes provam o ARQUIVO, dentro da transacao)`,
    );

    // Cenario fixo: frete de R$ 10,00 e nenhuma regra de frete gratis por valor.
    await client.query(
      `UPDATE public.store_config
          SET shipping_fee = $1, free_shipping_min = 0
        WHERE id = 1`,
      [FRETE],
    );
    const produtoId = await criarProduto(client);

    // =========================================================================
    // ANTES da migration: o defeito, reproduzido
    // =========================================================================
    console.log("\n=== antes da migration ===");

    const cupomZeroAntes = await criarCupom(client, {
      code: "PROVAZERO_ANTES",
      usageLimit: 0,
    });

    const vAntes = await validacaoDoCheckout(client, "PROVAZERO_ANTES");
    const pAntes = await criarPedido(client, {
      rpc: "create_marketplace_order_v23",
      produtoId,
      codigo: "PROVAZERO_ANTES",
      total: PRECO + FRETE - PRECO * 0.1,
    });

    if (jaAplicada) {
      console.log(
        "  (pulado: a migration ja esta viva no banco, entao o estado 'antes' nao existe mais)",
      );
    } else {
      conferir(
        "checkout ACEITA o cupom de limite 0",
        vAntes.is_valid === true && Number(vAntes.discount_value) === 10,
        JSON.stringify(vAntes),
      );
      conferir(
        "criacao do pedido RECUSA o mesmo cupom (o defeito)",
        recusouPorCupom(pAntes),
        pAntes.ok ? "o pedido foi criado" : pAntes.erro,
      );
      conferir(
        "as duas regras DISCORDAM sobre o mesmo cupom",
        vAntes.is_valid === true && pAntes.ok === false,
      );
      conferir(
        "o cupom nao foi consumido na recusa",
        (await usosDoCupom(client, cupomZeroAntes)) === 0,
      );
    }

    // =========================================================================
    // Aplica a migration DENTRO da transacao
    // =========================================================================
    // O caminho e montado de constantes deste arquivo, nao de entrada.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const sql = fs.readFileSync(
      path.join(RAIZ, "supabase", "migrations", MIGRATION),
      "utf8",
    );
    if (/^\s*(BEGIN|COMMIT)\s*;/im.test(sql)) {
      throw new Error(
        `${MIGRATION} tem BEGIN/COMMIT embutido: o ROLLBACK desta prova viraria no-op e a mudanca ficaria gravada. Abortando.`,
      );
    }
    await client.query(sql);
    conferir(
      "migration aplicada na transacao",
      await migrationJaAplicadaAoVivo(client),
    );

    // =========================================================================
    // DEPOIS: o conserto, e o que ele NAO pode ter afrouxado
    // =========================================================================
    console.log("\n=== depois da migration ===");

    // --- caso 1: limite 0 = ilimitado, o pedido fecha ------------------------
    const cupomZero = await criarCupom(client, {
      code: "PROVAZERO",
      usageLimit: 0,
    });
    const vZero = await validacaoDoCheckout(client, "PROVAZERO");
    const pZero = await criarPedido(client, {
      rpc: "create_marketplace_order_v23",
      produtoId,
      codigo: "PROVAZERO",
      total: PRECO + FRETE - PRECO * 0.1,
    });
    conferir(
      "limite 0: o pedido e criado",
      pZero.ok === true,
      pZero.ok ? undefined : pZero.erro,
    );
    conferir(
      "limite 0: checkout e criacao CONCORDAM",
      vZero.is_valid === true && pZero.ok === true,
    );

    if (pZero.ok) {
      const e = await estadoDoPedido(client, pZero.orderId);
      // Numeros literais do cenario, nao a formula da funcao: subtotal 100,00,
      // desconto de 10% = 10,00, frete 10,00 -> total 100,00.
      conferir(
        "limite 0: subtotal gravado = 100,00",
        Number(e.subtotal) === 100,
        `veio ${e.subtotal}`,
      );
      conferir(
        "limite 0: desconto gravado = 10,00",
        Number(e.discount) === 10,
        `veio ${e.discount}`,
      );
      conferir(
        "limite 0: total gravado = 100,00 (100 + 10 de frete - 10 de desconto)",
        Number(e.total) === 100,
        `veio ${e.total}`,
      );
      conferir(
        "limite 0: o pedido guarda de qual cupom veio",
        e.coupon_id === cupomZero && e.coupon_code === "PROVAZERO",
      );
      conferir(
        "limite 0: o uso do cupom foi contado",
        (await usosDoCupom(client, cupomZero)) === 1,
      );
    }

    // --- caso 2: limite negativo tambem e ilimitado (paridade com a v2) ------
    // A validate_coupon_secure_v2 so bloqueia quando `usage_limit > 0`, entao
    // ela ja tratava negativo como ilimitado. Se a criacao de pedido nao fizer
    // o mesmo, o desencontro volta pela outra ponta.
    const cupomNeg = await criarCupom(client, {
      code: "PROVANEG",
      usageLimit: -1,
    });
    const vNeg = await validacaoDoCheckout(client, "PROVANEG");
    const pNeg = await criarPedido(client, {
      rpc: "create_marketplace_order_v23",
      produtoId,
      codigo: "PROVANEG",
      total: PRECO + FRETE - PRECO * 0.1,
    });
    conferir(
      "limite negativo: checkout e criacao CONCORDAM (os dois aceitam)",
      vNeg.is_valid === true && pNeg.ok === true,
      `validacao=${vNeg.is_valid} pedido=${pNeg.ok} ${pNeg.erro ?? ""}`,
    );
    conferir(
      "limite negativo: uso contado",
      (await usosDoCupom(client, cupomNeg)) === 1,
    );

    // --- caso 3: limite de VERDADE, ainda com folga -> passa -----------------
    const cupomFolga = await criarCupom(client, {
      code: "PROVAFOLGA",
      usageLimit: 2,
      usageCount: 1,
    });
    const pFolga = await criarPedido(client, {
      rpc: "create_marketplace_order_v23",
      produtoId,
      codigo: "PROVAFOLGA",
      total: PRECO + FRETE - PRECO * 0.1,
    });
    conferir(
      "limite 2 com 1 uso: o pedido e criado",
      pFolga.ok === true,
      pFolga.ok ? undefined : pFolga.erro,
    );
    conferir(
      "limite 2 com 1 uso: contador vai a 2",
      (await usosDoCupom(client, cupomFolga)) === 2,
    );

    // --- caso 4: limite de VERDADE esgotado -> CONTINUA recusado -------------
    // Este e o caso que separa conserto de buraco. Se alguem trocar o predicado
    // por algo que sempre aceita, e aqui que a prova fica vermelha.
    const cupomCheio = await criarCupom(client, {
      code: "PROVACHEIO",
      usageLimit: 1,
      usageCount: 1,
    });
    const vCheio = await validacaoDoCheckout(client, "PROVACHEIO");
    const pCheio = await criarPedido(client, {
      rpc: "create_marketplace_order_v23",
      produtoId,
      codigo: "PROVACHEIO",
      total: PRECO + FRETE - PRECO * 0.1,
    });
    conferir(
      "limite 1 esgotado: o pedido CONTINUA recusado",
      recusouPorCupom(pCheio),
      pCheio.ok ? "o pedido foi criado — a trava sumiu" : pCheio.erro,
    );
    conferir(
      "limite 1 esgotado: checkout e criacao CONCORDAM (os dois recusam)",
      vCheio.is_valid === false && pCheio.ok === false,
      `validacao=${vCheio.is_valid} (${vCheio.error_message}) pedido=${pCheio.ok}`,
    );
    conferir(
      "limite 1 esgotado: contador nao mexeu",
      (await usosDoCupom(client, cupomCheio)) === 1,
    );

    // --- caso 5: cupom desativado continua recusado --------------------------
    await client.query(
      `INSERT INTO public.coupons (code, type, value, usage_limit, usage_count, active)
       VALUES ('PROVAOFF', 'percentage', 10, 0, 0, false)`,
    );
    const pOff = await criarPedido(client, {
      rpc: "create_marketplace_order_v23",
      produtoId,
      codigo: "PROVAOFF",
      total: PRECO + FRETE - PRECO * 0.1,
    });
    conferir(
      "cupom desativado com limite 0: continua recusado",
      recusouPorCupom(pOff),
      pOff.ok ? "o pedido foi criado" : pOff.erro,
    );

    // --- caso 6: cupom vencido com limite 0 continua recusado ----------------
    await client.query(
      `INSERT INTO public.coupons (code, type, value, usage_limit, usage_count, active, valid_until)
       VALUES ('PROVAVENC', 'percentage', 10, 0, 0, true, NOW() - INTERVAL '1 day')`,
    );
    const pVenc = await criarPedido(client, {
      rpc: "create_marketplace_order_v23",
      produtoId,
      codigo: "PROVAVENC",
      total: PRECO + FRETE - PRECO * 0.1,
    });
    conferir(
      "cupom vencido com limite 0: continua recusado",
      recusouPorCupom(pVenc),
      pVenc.ok ? "o pedido foi criado" : pVenc.erro,
    );

    // --- caso 7: a v24 (pagamento online) tem o MESMO comportamento ----------
    // A v24 e a que roda quando o cliente paga PIX pelo site. Se so a v23 for
    // corrigida, o defeito continua vivo exatamente no caminho do dinheiro.
    console.log("\n=== v24 (pagamento online) ===");

    const cupomZero24 = await criarCupom(client, {
      code: "PROVAZERO24",
      usageLimit: 0,
    });
    const pZero24 = await criarPedido(client, {
      rpc: "create_marketplace_order_v24",
      produtoId,
      codigo: "PROVAZERO24",
      total: PRECO + FRETE - PRECO * 0.1,
    });
    conferir(
      "v24, limite 0: o pedido e criado",
      pZero24.ok === true,
      pZero24.ok ? undefined : pZero24.erro,
    );
    conferir(
      "v24, limite 0: uso contado",
      (await usosDoCupom(client, cupomZero24)) === 1,
    );
    if (pZero24.ok) {
      const e24 = await estadoDoPedido(client, pZero24.orderId);
      conferir(
        "v24, limite 0: desconto gravado = 10,00",
        Number(e24.discount) === 10,
        `veio ${e24.discount}`,
      );
    }

    const cupomCheio24 = await criarCupom(client, {
      code: "PROVACHEIO24",
      usageLimit: 1,
      usageCount: 1,
    });
    const pCheio24 = await criarPedido(client, {
      rpc: "create_marketplace_order_v24",
      produtoId,
      codigo: "PROVACHEIO24",
      total: PRECO + FRETE - PRECO * 0.1,
    });
    conferir(
      "v24, limite 1 esgotado: CONTINUA recusado",
      recusouPorCupom(pCheio24),
      pCheio24.ok ? "o pedido foi criado — a trava sumiu" : pCheio24.erro,
    );
    conferir(
      "v24, limite 1 esgotado: contador nao mexeu",
      (await usosDoCupom(client, cupomCheio24)) === 1,
    );

    // --- caso 8: pedido SEM cupom continua igual ----------------------------
    // A migration reescreve as duas funcoes inteiras. Este caso existe para
    // dizer que o resto do caminho do dinheiro sobreviveu.
    const pSemCupom = await criarPedido(client, {
      rpc: "create_marketplace_order_v23",
      produtoId,
      codigo: null,
      total: PRECO + FRETE,
    });
    conferir(
      "sem cupom: o pedido e criado",
      pSemCupom.ok === true,
      pSemCupom.ok ? undefined : pSemCupom.erro,
    );
    if (pSemCupom.ok) {
      const e = await estadoDoPedido(client, pSemCupom.orderId);
      conferir(
        "sem cupom: total = 110,00 (100 + 10 de frete, sem desconto)",
        Number(e.total) === 110 && Number(e.discount) === 0,
        `total ${e.total}, desconto ${e.discount}`,
      );
      conferir("sem cupom: nenhum cupom amarrado", e.coupon_id === null);
    }

    // --- caso 9: cupom inexistente continua recusado -------------------------
    const pInexistente = await criarPedido(client, {
      rpc: "create_marketplace_order_v23",
      produtoId,
      codigo: "NAOEXISTE",
      total: PRECO + FRETE,
    });
    conferir(
      "cupom inexistente: continua recusado",
      recusouPorCupom(pInexistente),
      pInexistente.ok ? "o pedido foi criado" : pInexistente.erro,
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }

  console.log(`\n${passou} passaram, ${falhou} falharam.`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
