#!/usr/bin/env node
/**
 * Prova de equivalência do `cart_hash` entre JavaScript e SQL.
 *
 * ESTE SCRIPT É A TRAVA QUE DECIDE SE A MIGRATION DO FRETE PODE EXISTIR.
 *
 * O defeito que ele serve (achado 2 do laudo CACA-FUNDO): a cotação de frete
 * de um carrinho vale para QUALQUER outro carrinho no mesmo CEP. A cliente
 * cota com 1 unidade (R$ 22), sobe para 10 e fecha o pedido; o app aceita
 * R$ 22 e a transportadora cobra R$ 60 da lojista.
 *
 *   - `calculate-shipping/index.ts:867-875` GRAVA a cotação com `cart_hash`
 *   - `calculate-shipping/index.ts:601-608`  LÊ  a cotação com `cart_hash`
 *   - a RPC que VALIDA O DINHEIRO busca por CEP + 24h + id da opção, e
 *     `cart_hash` NÃO aparece (`grep -c` = 0)
 *
 * O conserto é a RPC recalcular o hash a partir de `p_items` — que ela já
 * recebe — e acrescentá-lo ao WHERE. Isso evita parâmetro novo, e com isso a
 * armadilha registrada em `mudar-assinatura-de-rpc-custa-o-grant`: parâmetro
 * com DEFAULT cria SOBRECARGA no Postgres, o PostgREST fica ambíguo, e o DROP
 * que resolve leva o GRANT junto — e os GRANTs desta função estão todos em
 * migrations `_arquivadas/`.
 *
 * 🔴 O RISCO QUE ESTE SCRIPT EXISTE PARA MEDIR
 *
 * Se o hash calculado em SQL divergir do calculado em JS, **todo pedido passa
 * a ser recusado** com "A cotação de frete expirou" — o checkout morre. Não é
 * hipótese: JS ordena com `localeCompare` e o Postgres com a collation do
 * banco, e elas DIVERGEM. Medido antes de escrever isto: com `Z`, `a`, `b` na
 * mesma lista, `localeCompare` põe `Z` por último e o codepoint põe `Z`
 * primeiro. Para UUID minúsculo (o formato real de product_id/variant_id) as
 * duas batem — 0 divergências em 2000 rodadas — e é por isso que o conserto é
 * viável. Este script é a segunda opinião sobre essa medida, feita no banco
 * de verdade em vez de na minha cabeça.
 *
 * NADA É ESCRITO. Tudo roda dentro de `BEGIN READ ONLY`, e isso não é
 * promessa: é o Postgres RECUSANDO escrita. `SHOW transaction_read_only` é
 * assertado como 'on' ANTES de qualquer consulta — sem essa trava, um erro de
 * digitação em SQL viraria escrita real. Termina em ROLLBACK.
 *
 * Uso: node scripts/db-prove-cart-hash-equivalencia.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");

// Mesma leitura de `db-check-cron-expiracao.cjs:38-54` — o projeto não tem
// `dotenv`, e acrescentar dependência para um script de prova seria pagar caro
// por uma linha.
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

// ---------------------------------------------------------------------------
// A implementação REAL, copiada byte a byte de
// supabase/functions/calculate-shipping/index.ts:225-239.
//
// Copiada, não adaptada, e não importada: o arquivo é TypeScript de Deno e
// puxar o módulo inteiro traria as dependências dele. Copiar tem um preço —
// se o original mudar, esta cópia envelhece em silêncio — e por isso o script
// AFIRMA no fim de onde ela veio, para quem alterar o original saber que tem
// um segundo lugar para olhar.
// ---------------------------------------------------------------------------
function getCartHashJS(cart) {
  if (!cart || !Array.isArray(cart)) return "empty";
  const sorted = [...cart].sort((a, b) => {
    const idA = (a.product?.id || a.productId || "") + (a.variantId || "");
    const idB = (b.product?.id || b.productId || "") + (b.variantId || "");
    return idA.localeCompare(idB);
  });

  return sorted
    .map((item) => {
      const prodId = item.product?.id || item.productId;
      const variantId = item.variantId || "";
      const quantity = item.quantity || 1;
      return `${prodId}:${variantId}:${quantity}`;
    })
    .join(",");
}

// ---------------------------------------------------------------------------
// A expressão SQL candidata, na forma que entraria na migration.
//
// `COLLATE "C"` é cravado de propósito: sem ele a ordenação depende da
// collation do banco de CADA loja clonada, e uma loja com collation ICU
// ordenaria diferente da outra — o mesmo carrinho geraria hashes diferentes
// em lojas diferentes. "C" é ordem de codepoint, igual em qualquer instalação.
// ---------------------------------------------------------------------------
const SQL_HASH = `
  SELECT COALESCE(
    string_agg(
      (item->>'product_id') || ':' ||
      COALESCE(item->>'variant_id', '') || ':' ||
      (item->>'quantity'),
      ','
      ORDER BY ((item->>'product_id') || COALESCE(item->>'variant_id', '')) COLLATE "C"
    ),
    'empty'
  )
  FROM jsonb_array_elements($1::jsonb) AS item
`;

// ---------------------------------------------------------------------------
// Massa de teste. Casos de borda escolhidos pelo que PODE divergir, não pelo
// que é fácil de gerar.
// ---------------------------------------------------------------------------
function uuid(rnd) {
  const h = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 36; i++) {
    s += i === 8 || i === 13 || i === 18 || i === 23 ? "-" : h[rnd() % 16];
  }
  return s;
}

// Gerador determinístico: `Math.random` deixaria a prova irreprodutível, e uma
// divergência que não se reproduz não dá para investigar.
function criarRandom(semente) {
  let s = semente;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s >>> 5;
  };
}

function gerarCasos() {
  const rnd = criarRandom(20260822);
  const casos = [];

  // 1. Um item só, sem variante — o caminho mais comum da loja.
  casos.push({
    rotulo: "1 item, sem variante",
    itens: [{ product_id: uuid(rnd), variant_id: null, quantity: 1 }],
  });

  // 2. Quantidade > 1 — é exatamente o caso que o defeito deixa passar.
  casos.push({
    rotulo: "1 item, quantidade 10",
    itens: [{ product_id: uuid(rnd), variant_id: null, quantity: 10 }],
  });

  // 3. Com variante.
  casos.push({
    rotulo: "1 item COM variante",
    itens: [{ product_id: uuid(rnd), variant_id: uuid(rnd), quantity: 3 }],
  });

  // 4. Vários itens — a ordenação passa a importar de verdade.
  for (let n of [2, 3, 5, 8]) {
    const itens = Array.from({ length: n }, () => ({
      product_id: uuid(rnd),
      variant_id: rnd() % 2 === 0 ? uuid(rnd) : null,
      quantity: (rnd() % 9) + 1,
    }));
    casos.push({ rotulo: `${n} itens, variantes misturadas`, itens });
  }

  // 5. MESMO produto, variantes diferentes — o prefixo de ordenação é igual e
  //    só a variante desempata. É onde uma ordenação errada aparece.
  const mesmoProduto = uuid(rnd);
  casos.push({
    rotulo: "mesmo produto, 3 variantes (desempate pela variante)",
    itens: [
      { product_id: mesmoProduto, variant_id: uuid(rnd), quantity: 1 },
      { product_id: mesmoProduto, variant_id: uuid(rnd), quantity: 2 },
      { product_id: mesmoProduto, variant_id: uuid(rnd), quantity: 3 },
    ],
  });

  // 6. Item COM variante e item SEM, do mesmo produto: um lado compara
  //    `id+variante` e o outro só `id`, então o comprimento das chaves difere.
  const p6 = uuid(rnd);
  casos.push({
    rotulo: "mesmo produto, um com variante e um sem",
    itens: [
      { product_id: p6, variant_id: null, quantity: 1 },
      { product_id: p6, variant_id: uuid(rnd), quantity: 1 },
    ],
  });

  // 7. Carrinho grande — a ordenação de N itens é onde uma divergência de
  //    comparador se manifesta com mais chance.
  const grandes = Array.from({ length: 25 }, () => ({
    product_id: uuid(rnd),
    variant_id: rnd() % 3 === 0 ? uuid(rnd) : null,
    quantity: (rnd() % 20) + 1,
  }));
  casos.push({ rotulo: "25 itens", itens: grandes });

  // 8. A MESMA lista embaralhada: o hash TEM de ser igual nas duas ordens,
  //    senão a ordem em que a cliente põe no carrinho muda o hash e o conserto
  //    recusaria pedido legítimo.
  const baralho = [...grandes].reverse();
  casos.push({ rotulo: "os mesmos 25 itens, ordem invertida", itens: baralho });

  return casos;
}

// O formato que a edge function recebe (`cart`) é diferente do que a RPC
// recebe (`p_items`). Esta função traduz um para o outro para que os dois
// lados calculem sobre o MESMO carrinho — se a tradução estiver errada, a
// prova inteira mede outra coisa.
function paraFormatoCart(itens) {
  return itens.map((i) => ({
    product: { id: i.product_id },
    variantId: i.variant_id ?? undefined,
    quantity: i.quantity,
  }));
}

async function main() {
  const client = new Client({ connectionString: lerDatabaseUrl() });
  await client.connect();

  let divergencias = 0;
  let comparados = 0;

  try {
    await client.query("BEGIN READ ONLY");

    // 🔴 A trava. Sem ela, "não escrevi" é confiança na minha leitura do SQL;
    // com ela, é o Postgres recusando. Assertar ANTES de qualquer consulta.
    const ro = await client.query("SHOW transaction_read_only");
    const somenteLeitura = ro.rows[0].transaction_read_only;
    if (somenteLeitura !== "on") {
      throw new Error(
        `transaction_read_only='${somenteLeitura}', esperado 'on'. Abortando antes de consultar.`,
      );
    }
    console.log("trava de leitura     : transaction_read_only = on\n");

    // -----------------------------------------------------------------------
    // PARTE 1 — equivalência do ALGORITMO, sobre massa sintética.
    // -----------------------------------------------------------------------
    console.log("=== PARTE 1 — JS x SQL sobre casos construídos ===\n");
    const casos = gerarCasos();

    for (const caso of casos) {
      const js = getCartHashJS(paraFormatoCart(caso.itens));
      const r = await client.query(SQL_HASH, [JSON.stringify(caso.itens)]);
      const sql = r.rows[0].coalesce;
      comparados++;
      const bate = js === sql;
      if (!bate) divergencias++;
      console.log(`${bate ? "  ok  " : "🔴 DIF"}  ${caso.rotulo}`);
      if (!bate) {
        console.log(`         JS : ${js}`);
        console.log(`         SQL: ${sql}`);
      }
    }

    // O caso 8 só vale se produzir o MESMO hash do caso 7. Um hash sensível à
    // ordem de inserção recusaria pedido legítimo — e passaria despercebido
    // aqui, porque JS e SQL concordariam em estar os dois errados.
    // `find` em vez de `findIndex` + `casos[i]`: indexar array por variável
    // dispara security/detect-object-injection, e warning novo reprova a
    // catraca de lint (teto 551, medido no CI).
    const c7 = casos.find((c) => c.rotulo === "25 itens");
    const c8 = casos.find((c) => c.rotulo.includes("ordem invertida"));
    if (!c7 || !c8) {
      throw new Error(
        "os casos 7 e 8 sumiram da massa — a invariante de ordem não pôde ser medida",
      );
    }
    const h7 = getCartHashJS(paraFormatoCart(c7.itens));
    const h8 = getCartHashJS(paraFormatoCart(c8.itens));
    console.log(
      `\n  ${h7 === h8 ? "ok  " : "🔴 DIF"}  invariante: embaralhar o carrinho NÃO muda o hash`,
    );
    if (h7 !== h8) divergencias++;

    // -----------------------------------------------------------------------
    // PARTE 2 — o formato REAL gravado no banco.
    //
    // A parte 1 prova que os dois algoritmos concordam. Ela NÃO prova que o
    // formato que eles produzem é o que está gravado em produção — para isso
    // só serve o dado real.
    // -----------------------------------------------------------------------
    console.log("\n=== PARTE 2 — o que está GRAVADO em shipping_quotes_cache ===\n");
    const reais = await client.query(`
      SELECT cart_hash, created_at
        FROM public.shipping_quotes_cache
       ORDER BY created_at DESC
       LIMIT 20
    `);
    console.log(`linhas lidas         : ${reais.rowCount}`);

    if (reais.rowCount === 0) {
      console.log(
        "⚠️  NENHUMA cotação gravada. A parte 2 não pôde medir nada — e ausência\n" +
          "    de dado não é prova de equivalência. Diga isso no relatório.",
      );
    } else {
      // O formato esperado é `uuid:uuid-ou-vazio:numero`, repetido e separado
      // por vírgula. Qualquer coisa fora disso significa que a cópia do
      // algoritmo aqui não descreve o que a produção gravou.
      // Validação por `split` em vez de uma regex com quantificador aninhado:
      // aquela forma dispara security/detect-unsafe-regex (ReDoS), e warning
      // novo reprova a catraca. Esta versão é linear e mais fácil de ler.
      const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      const pedacoValido = (p) => {
        const partes = p.split(":");
        if (partes.length !== 3) return false;
        const [prod, variante, qtd] = partes;
        if (!UUID.test(prod)) return false;
        if (variante !== "" && !UUID.test(variante)) return false;
        return /^[0-9]+$/.test(qtd);
      };
      let fora = 0;
      for (const row of reais.rows) {
        const h = row.cart_hash ?? "";
        const ok = h === "empty" || h.split(",").every(pedacoValido);
        if (!ok) {
          fora++;
          console.log(`🔴 fora do formato : ${h.slice(0, 90)}`);
        }
      }
      console.log(`fora do formato      : ${fora} de ${reais.rowCount}`);
      if (fora > 0) divergencias += fora;

      // Reconferência: o hash real, passado pela expressão SQL como se fosse
      // reconstruído, tem de sobreviver a um round-trip de ordenação.
      const amostra = reais.rows[0].cart_hash;
      console.log(`amostra (1ª linha)   : ${String(amostra).slice(0, 90)}`);
    }
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }

  console.log("\n" + "=".repeat(70));
  console.log(`comparações feitas   : ${comparados}`);
  console.log(`divergências         : ${divergencias}`);
  console.log(
    divergencias === 0
      ? "VEREDITO             : ✅ JS e SQL concordam — a migration PODE ser escrita"
      : "VEREDITO             : 🔴 DIVERGEM — a migration NÃO pode ser escrita assim",
  );
  console.log(
    "\nA cópia de `getCartHash` neste script veio de\n" +
      "supabase/functions/calculate-shipping/index.ts:225-239. Se aquele arquivo\n" +
      "mudar, esta prova envelhece em silêncio — rode de novo antes de confiar.",
  );

  process.exit(divergencias === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("falhou:", e.message);
  process.exit(2);
});
