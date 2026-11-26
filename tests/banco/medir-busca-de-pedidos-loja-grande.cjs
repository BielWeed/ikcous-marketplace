"use strict";
/**
 * MEDICAO (nao prova) da busca de pedidos do painel numa loja grande, contra o Postgres EFEMERO com as migrations aplicadas
 * do zero (rpc-ci, job informacional). Nunca banco de loja. Roda num CLONE (rodar-isolado.cjs): o volume e COMMITADO (o
 * VACUUM nao roda dentro de transacao) e o clone some no fim.
 *
 * A pergunta (plano PLANO-LOJA-GRANDE-BANCO, item 3 e T11): com 5 mil e com 50 mil pedidos, a get_admin_orders_paged (corpo
 * vivo da 20261410000000) varre marketplace_orders e passa de 300 ms? A suspeita: o OR com EXISTS em itens impede o BitmapOr
 * sobre os 6 indices GIN de trigrama da 20261068000000. Se aparecer varredura E mais de 300 ms, vira lote proprio.
 *
 * O que mede, para cada volume (5 mil, depois 50 mil, semeados por cima) e cada tipo de termo:
 *   nome de cliente, trecho de e-mail, numero do pedido (os 6 ultimos do id, como o painel mostra), nome de produto dentro dos
 *   itens, termo vazio (a 1a pagina) e, a mais, os 4 ultimos digitos do telefone (o braco do OR que compara so digitos);
 *   - a FUNCAO REAL, chamada como o painel chama (admin atual, pagina 0 de 20, sem filtros), nunca uma copia da consulta;
 *   - o EXPLAIN (ANALYZE, BUFFERS) das duas consultas de dentro dela (a contagem e a pagina), capturado pelo auto_explain com
 *     log_nested_statements: e o plano que a funcao de fato executa;
 *   - a mediana de 5 execucoes, cronometradas SEM o auto_explain ligado (a instrumentacao do ANALYZE pesa no tempo);
 *   - nos dois modos do cache de planos do plpgsql: force_custom_plan (o termo vira constante; e o que as 5 primeiras chamadas
 *     de cada conexao recebem) e force_generic_plan (o termo vira $n; o que uma conexao aquecida do pool PODE receber depois
 *     da 5a chamada, quando o custo estimado do generico empata com o dos custom). O modo "auto" depende da historia da
 *     conexao; os dois forcados sao os dois extremos que ele escolhe.
 *
 * NAO reprova por tempo nem por plano: imprime. Reprova so por erro de execucao (seed, funcao recusando o admin, termo que
 * deveria achar pedido e nao acha -- sinal de que a medicao nao exercitou o caminho que diz medir). statement_timeout de 30 s
 * por chamada: estourar e um RESULTADO ("> 30 s"), nao erro.
 *
 * Estado: semeia em transacao unica por volume (replica: sem gatilho de pedido/estoque, os indices continuam mantidos), depois
 * VACUUM (ANALYZE) -- o autovacuum da loja faria o mesmo, e so o VACUUM esvazia a lista pendente do GIN (ANALYZE manual nao).
 * Ids de pedido aleatorios (gen_random_uuid), como na loja: o trigrama do id depende disso. Rodar duas vezes no mesmo banco
 * colidiria nas chaves fixas: por isso a trava do nome do clone abaixo.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/medir-busca-de-pedidos-loja-grande.cjs
 */
const assert = require("node:assert/strict");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, anexarAoSummary } = require("./efemero.cjs");

const U = (n) => `c0110000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = U(9001);
const CLIENTE = U(9002);
const VOL = (prefixo, g) =>
  `('${prefixo}-0000-4000-8000-' || lpad((${g})::text, 12, '0'))::uuid`;

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });
// O SET ROLE do PostgREST, o login (auth.uid() desta suite le app.rpc.user_id) e o JWT.
const QUEM = new Map([
  [
    "admin",
    { papel: "authenticated", uid: ADMIN, jwt: claims(ADMIN, "admin") },
  ],
]);

async function entrar(c, quem) {
  const q = QUEM.get(quem);
  assert.ok(q, `papel desconhecido: ${quem}`);
  await c.query(`SET LOCAL ROLE ${q.papel}`);
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [q.uid, q.jwt],
  );
}
/** Roda `sql` como `quem` dentro de um SAVEPOINT sempre desfeito. SAVEPOINT so existe dentro de BEGIN: quem chama abre a
 * transacao (emTransacao). */
async function comoQuem(c, quem, sql, params = []) {
  await c.query("SAVEPOINT quem11");
  try {
    await entrar(c, quem);
    const r = await c.query(sql, params);
    return { ok: true, linhas: r.rows };
  } catch (erro) {
    return { ok: false, code: erro.code, message: erro.message };
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT quem11");
    await c.query("RELEASE SAVEPOINT quem11");
  }
}
async function emTransacao(c, acao) {
  await c.query("BEGIN");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK");
  }
}

// ---------------------------------------------------------------------------
// Semente
// ---------------------------------------------------------------------------

const PRIMEIROS = [
  "Ana",
  "Maria",
  "José",
  "João",
  "Joana",
  "Lúcia",
  "Márcia",
  "Antônio",
  "Beatriz",
  "Camila",
  "Débora",
  "Fernanda",
  "Gabriela",
  "Helena",
  "Isabela",
  "Júlia",
  "Letícia",
  "Patrícia",
  "Renata",
  "Sérgio",
];
const SOBRENOMES = [
  "Silva",
  "Souza",
  "Oliveira",
  "Santos",
  "Pereira",
  "Lima",
  "Carvalho",
  "Ferreira",
  "Rodrigues",
  "Almeida",
  "Costa",
  "Gomes",
  "Martins",
  "Araújo",
  "Barbosa",
  "Ribeiro",
  "Alves",
  "Monteiro",
  "Mendes",
  "Cardoso",
  "Teixeira",
  "Correia",
  "Nascimento",
  "Moreira",
  "Rocha",
  "Dias",
  "Castro",
  "Campos",
  "Freitas",
  "Vieira",
];
const TIPOS = [
  "Macacão",
  "Body",
  "Vestido",
  "Conjunto",
  "Pijama",
  "Saída de Maternidade",
  "Manta",
  "Sapatinho",
  "Touca",
  "Calça",
  "Blusa",
  "Kit Fralda",
];
const ADJETIVOS = [
  "Floral",
  "Listrado",
  "Liso",
  "Estampado",
  "Algodão",
  "Plush",
  "Tricô",
  "Malha",
  "Moletom",
  "Suedine",
];
const CORES = [
  "Rosa",
  "Azul",
  "Branco",
  "Verde",
  "Amarelo",
  "Cinza",
  "Bege",
  "Lilás",
];
const TAMANHOS = ["RN", "P", "M", "G", "GG"];
const PRODUTOS = 2000;

async function preparar(c) {
  await c.query("BEGIN");
  // O auth emulado do CI nao da USAGE nos schemas da plataforma (a loja da).
  await c.query(
    "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
  );
  await c.query(
    "GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role",
  );
  for (const id of [ADMIN, CLIENTE])
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@medir11.teste', '{}'::jsonb)",
      [id],
    );
  // O INSERT em profiles leva o papel a auth.users (gatilho de sincronia): fora do modo replica.
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin T11', 'admin'), ($2, 'Cliente T11', 'customer')`,
    [ADMIN, CLIENTE],
  );
  // Catalogo: 2000 produtos, nome = tipo + tecido + cor + tamanho (cada combinacao de tipo e tecido em 1/120 do catalogo).
  await c.query("SET LOCAL session_replication_role = replica");
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, data_cadastro)
     SELECT ${VOL("c0120000", "g")},
            ($1::text[])[1 + g % 12] || ' ' || ($2::text[])[1 + (g / 12) % 10] || ' ' || ($3::text[])[1 + (g / 120) % 8]
              || ' ' || ($4::text[])[1 + (g / 960) % 5],
            59.90, 10, true, 20, now() - make_interval(mins => g)
       FROM generate_series(1, $5::int) g`,
    [TIPOS, ADJETIVOS, CORES, TAMANHOS, PRODUTOS],
  );
  await c.query("SET LOCAL session_replication_role = origin");
  await c.query("COMMIT");
}

/** Semeia os pedidos de numero `de` a `ate` (inclusive), 1 a 3 itens cada, e deixa o banco como o autovacuum deixaria. */
async function semear(c, de, ate) {
  const t0 = Date.now();
  await c.query("BEGIN");
  await c.query("SET LOCAL session_replication_role = replica");
  await c.query(
    "CREATE TEMP TABLE semente_t11 (g integer PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP",
  );
  await c.query(
    "INSERT INTO semente_t11 (g, id) SELECT g, gen_random_uuid() FROM generate_series($1::int, $2::int) g",
    [de, ate],
  );
  // Nome de 3 palavras (18 mil combinacoes; "Lucia Pereira" casa 1 em 600), telefone mascarado como o checkout grava,
  // e-mail so no jsonb (a busca nao olha e-mail), cupom em 10%, rastreio em 1/3, datas espalhadas em 2 anos.
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_phone, customer_data, total, subtotal, status, canal, payment_method,
        payment_status, paid_at, coupon_code, tracking_code, created_at, updated_at)
     SELECT x.id, $1::uuid, x.primeiro || ' ' || x.meio || ' ' || x.ultimo, x.fone,
            jsonb_build_object(
              'email', lower(public.f_unaccent(x.primeiro)) || '.' || lower(public.f_unaccent(x.meio)) || x.g || '@gmail.com',
              'whatsapp', x.fone),
            100, 100,
            CASE x.g % 10 WHEN 0 THEN 'pending' WHEN 1 THEN 'processing' ELSE 'delivered' END,
            'online',
            CASE WHEN x.g % 10 IN (0, 1) THEN 'pix' ELSE 'online' END,
            CASE WHEN x.g % 10 IN (0, 1) THEN NULL ELSE 'pago' END,
            CASE WHEN x.g % 10 IN (0, 1) THEN NULL ELSE x.criado END,
            CASE WHEN x.g % 10 = 3 THEN 'BEMVINDA10' END,
            CASE WHEN x.g % 3 = 0 THEN 'AA' || lpad(x.g::text, 9, '0') || 'BR' END,
            x.criado, x.criado
       FROM (
         SELECT s.id, s.g,
                ($2::text[])[1 + s.g % 20] AS primeiro,
                ($3::text[])[1 + (s.g / 20) % 30] AS meio,
                ($3::text[])[1 + (s.g / 600) % 30] AS ultimo,
                '(34) 9' || lpad(((s.g * 7919) % 10000)::text, 4, '0') || '-'
                  || lpad(((s.g::bigint * 104729) % 10000)::text, 4, '0') AS fone,
                now() - make_interval(mins => (s.g * 7919) % 1051200) AS criado
           FROM semente_t11 s
       ) x`,
    [CLIENTE, PRIMEIROS, SOBRENOMES],
  );
  await c.query(
    `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price, created_at)
     SELECT s.id, p.id, p.nome, 1, p.preco_venda, now()
       FROM semente_t11 s
       CROSS JOIN LATERAL generate_series(1, 1 + s.g % 3) k
       JOIN public.produtos p ON p.id = ${VOL("c0120000", `1 + ((s.g * 31 + k * 977) % ${PRODUTOS})`)}`,
  );
  await c.query("SET LOCAL session_replication_role = origin");
  await c.query("COMMIT");
  await c.query(
    "VACUUM (ANALYZE) public.marketplace_orders, public.marketplace_order_items, public.produtos",
  );
  const n = (
    await c.query(
      `SELECT (SELECT count(*) FROM public.marketplace_orders) AS pedidos,
              (SELECT count(*) FROM public.marketplace_order_items) AS itens,
              (SELECT count(*) FROM public.produtos) AS produtos,
              pg_size_pretty(pg_total_relation_size('public.marketplace_orders')) AS tamanho_pedidos,
              pg_size_pretty(pg_total_relation_size('public.marketplace_order_items')) AS tamanho_itens`,
    )
  ).rows[0];
  console.log(
    `   semeado em ${Date.now() - t0} ms (com VACUUM ANALYZE): ${n.pedidos} pedidos (${n.tamanho_pedidos}), ${n.itens} itens (${n.tamanho_itens}), ${n.produtos} produtos`,
  );
  assert.ok(Number(n.pedidos) >= ate, `pedidos ${n.pedidos} < ${ate}`);
  return Number(n.pedidos);
}

// ---------------------------------------------------------------------------
// Medicao
// ---------------------------------------------------------------------------

const SQL_BUSCA =
  "SELECT public.get_admin_orders_paged($1::text, 'all', '', '', 0, 20, 'all', 'all') AS r";
const MODOS = ["force_custom_plan", "force_generic_plan"];
const LIMIAR_MS = 300;
const VEZES = 5;

const mediana = (xs) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const fmt = (ms) => (ms === null ? "> 30 s" : `${ms.toFixed(1)} ms`);

let coletor = null;

/** Uma chamada da funcao real como admin atual, no modo de cache dado. Com `explicar`, liga o auto_explain (ANALYZE, BUFFERS,
 * consultas aninhadas) so dentro deste SAVEPOINT e devolve os planos que ele imprimiu. */
async function chamar(c, termo, modo, explicar = false) {
  assert.ok(MODOS.includes(modo));
  await c.query("SAVEPOINT medir11");
  try {
    await c.query(`SET LOCAL plan_cache_mode = ${modo}`);
    await c.query("SET LOCAL statement_timeout = '30s'");
    if (explicar) {
      // Parametros SUSET: antes do SET ROLE.
      for (const g of [
        "auto_explain.log_min_duration = 0",
        "auto_explain.log_analyze = on",
        "auto_explain.log_buffers = on",
        "auto_explain.log_timing = on",
        "auto_explain.log_nested_statements = on",
        "auto_explain.log_level = notice",
      ])
        await c.query(`SET LOCAL ${g}`);
      coletor = [];
    }
    await entrar(c, "admin");
    const t0 = process.hrtime.bigint();
    const r = (await c.query(SQL_BUSCA, [termo])).rows[0].r;
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(
      Array.isArray(r.data),
      `resposta sem data: ${JSON.stringify(r).slice(0, 200)}`,
    );
    return {
      ms,
      total: Number(r.total_count),
      pagina: r.data.length,
      planos: explicar ? coletor : [],
    };
  } catch (erro) {
    if (erro.code === "57014")
      return { ms: null, total: null, pagina: null, planos: coletor || [] };
    throw erro;
  } finally {
    coletor = null;
    await c.query("ROLLBACK TO SAVEPOINT medir11");
    await c.query("RELEASE SAVEPOINT medir11");
  }
}

/** Separa o plano do texto da consulta (o corpo traz comentarios longos) e diz de qual consulta da funcao ele e. */
function lerPlano(mensagem) {
  const linhas = mensagem.split("\n");
  const inicio = linhas.findIndex((l) => /\(cost=\d/.test(l));
  const texto = linhas.slice(0, Math.max(inicio, 0)).join("\n");
  const duracao = Number((mensagem.match(/duration: ([\d.]+) ms/) || [])[1]);
  let qual = null;
  if (/COUNT\(o\.id\)/.test(texto)) qual = "contagem";
  else if (/jsonb_agg\(t\)/.test(texto)) qual = "pagina";
  else if (/get_admin_orders_paged\(/.test(texto)) qual = "chamada";
  return {
    qual,
    duracao,
    plano: inicio >= 0 ? linhas.slice(inicio).join("\n") : "",
  };
}

function classificar(planos) {
  const juntos = planos.map((p) => p.plano).join("\n");
  const indices = [
    ...new Set(
      [
        ...juntos.matchAll(
          /(?:Index Scan|Index Only Scan)(?: Backward)? using (\w+)|Bitmap Index Scan on (\w+)/g,
        ),
      ].map((m) => m[1] || m[2]),
    ),
  ];
  return {
    varre: /Seq Scan on marketplace_orders/.test(juntos),
    bitmapOr: /BitmapOr/.test(juntos),
    indices,
  };
}

async function escolherTermos(c, semeados) {
  // Numero do pedido como o painel mostra (#3884BE): os 6 ultimos do id, em caixa alta, com ao menos uma letra (so digito
  // vira busca de telefone). Um pedido do meio da lista, nao o mais novo.
  const numero = (
    await c.query(
      `SELECT upper(right(id::text, 6)) AS n FROM public.marketplace_orders
        WHERE customer_data ? 'email' AND right(id::text, 6) ~ '[a-f]'
        ORDER BY created_at DESC, id OFFSET $1 LIMIT 1`,
      [Math.floor(semeados / 2)],
    )
  ).rows[0].n;
  // Os 4 ultimos digitos do telefone de um pedido semeado (a formula do semear, g = metade do volume).
  const g = Math.floor(semeados / 2);
  const fone = String((g * 104729) % 10000).padStart(4, "0");
  return [
    { tipo: "nome de cliente", termo: "lucia pereira", acha: true },
    { tipo: "trecho de e-mail", termo: "lucia.pereira", acha: false },
    { tipo: "numero do pedido", termo: numero, acha: true },
    { tipo: "produto nos itens", termo: "macacao plush", acha: true },
    { tipo: "termo vazio (1a pagina)", termo: "", acha: true },
    { tipo: "telefone (4 ultimos)", termo: fone, acha: true },
  ];
}

async function medirVolume(c, rotulo, semeados, pedidos) {
  const termos = await escolherTermos(c, semeados);
  const linhas = [];
  for (const t of termos) {
    for (const modo of MODOS) {
      // A 1a chamada e a do EXPLAIN (aquece o cache de paginas); as 5 seguintes sao cronometradas sem instrumentacao.
      const explicada = await emTransacao(c, () =>
        chamar(c, t.termo, modo, true),
      );
      const tempos = [];
      let ultima = explicada;
      await emTransacao(c, async () => {
        for (let i = 0; i < VEZES; i += 1) {
          ultima = await chamar(c, t.termo, modo);
          tempos.push(ultima.ms);
        }
      });
      const estourou = tempos.some((ms) => ms === null);
      const med = estourou ? null : mediana(tempos);
      if (!estourou && t.acha)
        assert.ok(
          ultima.total >= 1,
          `${rotulo} ${t.tipo} ${JSON.stringify(t.termo)}: total ${ultima.total}, a medicao nao exercitou a busca`,
        );
      if (!estourou && t.termo === "")
        assert.equal(
          ultima.total,
          pedidos,
          "termo vazio devolve todos os pedidos no total_count",
        );
      const planos = explicada.planos.map(lerPlano).filter((p) => p.qual);
      const consultas = planos.filter((p) => p.qual !== "chamada");
      assert.ok(
        estourou || explicada.ms === null || consultas.length === 2,
        `${rotulo} ${t.tipo}: o auto_explain devolveu ${consultas.length} planos das consultas da funcao (esperava 2)`,
      );
      const cls = classificar(consultas);
      console.log(
        `::group::${rotulo} | ${t.tipo} ${JSON.stringify(t.termo)} | ${modo} | mediana ${fmt(med)} | total ${ultima.total}`,
      );
      for (const p of planos)
        console.log(
          `--- ${p.qual} (auto_explain, ${p.duracao} ms com instrumentacao)\n${p.plano}`,
        );
      console.log(
        `--- tempos (ms): ${tempos.map((ms) => (ms === null ? "estourou" : ms.toFixed(1))).join(", ")}`,
      );
      console.log("::endgroup::");
      linhas.push({
        volume: rotulo,
        tipo: t.tipo,
        termo: t.termo,
        modo: modo.replace("force_", "").replace("_plan", ""),
        med,
        total: ultima.total,
        varre: cls.varre,
        bitmapOr: cls.bitmapOr,
        indices: cls.indices.filter((i) => /busca|trgm/.test(i)),
        // Estourar os 30 s conta como gatilho mesmo sem plano (a consulta cancelada nao chega ao auto_explain).
        gatilho: med === null || (cls.varre && med > LIMIAR_MS),
      });
    }
  }
  return linhas;
}

async function indicesDeTrigrama(c) {
  const r = await c.query(
    `SELECT i.indexname, pg_size_pretty(pg_relation_size(format('%I.%I', i.schemaname, i.indexname)::regclass)) AS tamanho
       FROM pg_indexes i
      WHERE i.schemaname = 'public' AND i.tablename IN ('marketplace_orders', 'marketplace_order_items')
        AND i.indexdef ILIKE '%gin_trgm_ops%'
      ORDER BY 1`,
  );
  return r.rows;
}

function tabela(linhas) {
  const cab =
    "| volume | termo | modo | mediana | total | varre pedidos | BitmapOr | indices de trigrama usados | varredura e > 300 ms |\n|---|---|---|---|---|---|---|---|---|";
  const corpo = linhas.map(
    (l) =>
      `| ${l.volume} | ${l.tipo} \`${l.termo}\` | ${l.modo} | ${fmt(l.med)} | ${l.total ?? "-"} | ${l.varre ? "sim" : "nao"} | ${l.bitmapOr ? "sim" : "nao"} | ${l.indices.join(", ") || "-"} | ${l.gatilho ? "**SIM**" : "nao"} |`,
  );
  return [cab, ...corpo].join("\n");
}

async function main() {
  const url = lerDatabaseUrlEfemera();
  assert.equal(
    new URL(url).pathname,
    "/prova_medir_busca_de_pedidos_loja_grande",
    "Rode somente no clone criado por rodar-isolado.cjs.",
  );
  const c = new Client({ connectionString: url });
  await c.connect();
  c.on("notice", (m) => {
    if (coletor) coletor.push(m.message);
  });
  try {
    // auto_explain vem no contrib do postgres:17 do job; sem ele a medicao nao tem o plano e reprova (erro de execucao).
    await c.query("LOAD 'auto_explain'");
    const antes = Number(
      (await c.query("SELECT count(*) AS n FROM public.marketplace_orders"))
        .rows[0].n,
    );
    console.log(`[T11] pedidos no clone antes da semente: ${antes}`);
    await preparar(c);
    // O admin atual passa na porta (senao todo o resto mediria a recusa).
    const porta = await emTransacao(c, () =>
      comoQuem(c, "admin", SQL_BUSCA, [""]),
    );
    assert.ok(porta.ok, `admin atual recusado: ${porta.code} ${porta.message}`);
    const trgm = await indicesDeTrigrama(c);
    console.log(
      `[T11] indices GIN de trigrama em pedidos/itens: ${trgm.length} (${trgm.map((i) => i.indexname).join(", ")})`,
    );
    const linhas = [];
    for (const [rotulo, de, ate] of [
      ["5 mil", 1, 5000],
      ["50 mil", 5001, 50000],
    ]) {
      console.log(`[T11] volume ${rotulo}: semeando pedidos ${de}..${ate}`);
      const pedidos = await semear(c, de, ate);
      const tam = await indicesDeTrigrama(c);
      console.log(
        `   tamanho dos indices: ${tam.map((i) => `${i.indexname} ${i.tamanho}`).join(", ")}`,
      );
      const doVolume = await medirVolume(c, rotulo, ate, pedidos);
      linhas.push(...doVolume);
      // Parcial por volume: se o passo estourar o teto no volume seguinte, este numero ja ficou no log.
      console.log(`[T11] parcial ${rotulo}:\n${tabela(doVolume)}`);
    }
    const resumo = tabela(linhas);
    console.log(
      `\n[T11] BUSCA DE PEDIDOS DO PAINEL (get_admin_orders_paged, pagina de 20, mediana de ${VEZES}; impresso, nao reprova):\n${resumo}`,
    );
    const gatilhos = linhas.filter((l) => l.gatilho).length;
    const conclusao = `Gatilho do plano (varredura em marketplace_orders E mais de ${LIMIAR_MS} ms): ${gatilhos} de ${linhas.length} medidas. O termo vazio varre por construcao (o total_count conta todos os pedidos).`;
    console.log(`[T11] ${conclusao}`);
    anexarAoSummary(
      "Medicao: busca de pedidos do painel na loja grande (T11)",
      `${resumo}\n\n${conclusao}\n\nOs planos completos (EXPLAIN ANALYZE, BUFFERS) estao no log do passo, um grupo por linha.`,
    );
  } finally {
    await c.end();
  }
}

main().catch((erro) => {
  console.error("[T11]", erro);
  process.exitCode = 1;
});
