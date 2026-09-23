"use strict";

/**
 * Ensaio local da migration
 * 20261171000000_o_frete_nacional_ganha_estrategia_propria.sql (T1/banco,
 * estratégias de frete local e nacional, 23/09/2026). Ver README.md desta
 * pasta: NÃO é rodado pelo CI automático; roda Postgres 17 efêmero e
 * descartável via Docker, criado e destruído por este próprio script —
 * mesmo molde de tests/frete-revisao-database/run.cjs.
 *
 * USO: node tests/frete-estrategias-database/run.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos lidos aqui (migrations, rollback, diretório temporário desta
 * pasta) são montados só a partir de ROOT (__dirname) e de literais deste
 * arquivo — nunca de entrada de rede nem de terceiro. Mesma convenção de
 * tests/banco/aplicar-migrations.cjs e tests/frete-revisao-database/run.cjs. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Client } = require("pg");

const ROOT = path.join(__dirname, "..", "..");
const MIGRATION =
  "20261171000000_o_frete_nacional_ganha_estrategia_propria.sql";
const ROLLBACK =
  "rollback-manual-20261171000000_o_frete_nacional_ganha_estrategia_propria.sql";
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");

/**
 * `--com-migration <caminho absoluto>` (repetível): depois de aplicar a
 * raiz inteira de supabase/migrations, aplica o(s) arquivo(s) extra(s) por
 * cima, no MESMO mecanismo de tests/banco/aplicar-migrations.cjs (arquivo
 * inteiro numa query só — o Postgres embrulha o texto inteiro numa
 * transação implícita). Existe para rodar este ensaio de novo com uma
 * migration downstream (ex.: o CPF, 20261172, que reescreve o mesmo corpo
 * de create_marketplace_order_v23/_v24) já aplicada por cima, sem este
 * worktree precisar CONTER o arquivo da outra frente.
 */
function lerExtras(argv) {
  const extras = [];
  for (let i = 0; i < argv.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- argv é a linha de comando da PRÓPRIA invocação (nunca rede/terceiro).
    if (argv[i] !== "--com-migration") continue;
    const valor = argv[i + 1]; // `i + 1` não é sink simples -- eslint não acusa aqui.
    if (!valor)
      throw new Error("--com-migration exige um caminho absoluto depois.");
    extras.push(valor);
    i++;
  }
  return extras;
}
const EXTRA_MIGRATIONS = lerExtras(process.argv.slice(2));

function log(msg) {
  console.log(`[frete-estrategias] ${msg}`);
}

function novoNomeContainer() {
  return `ikcous-frete-estrategias-ci-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function achaPortaLivre() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function rodar(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    windowsHide: true,
    ...opts,
  });
  if (r.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} falhou (status ${r.status}):\n${r.stderr || r.stdout}`,
    );
  }
  return r.stdout;
}

function rodarNode(scriptRelativo, args, env) {
  const r = spawnSync(process.execPath, [scriptRelativo, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...env },
    timeout: 120000,
  });
  console.log(r.stdout);
  if (r.stderr) console.error(r.stderr);
  if (r.status !== 0) {
    throw new Error(`${scriptRelativo} falhou (status ${r.status})`);
  }
}

async function esperarPostgresPronto(container, tentativas = 40) {
  for (let i = 0; i < tentativas; i++) {
    const r = spawnSync(
      "docker",
      ["exec", container, "pg_isready", "-U", "postgres"],
      { encoding: "utf8" },
    );
    if (r.status === 0) return;
    await new Promise((r2) => setTimeout(r2, 500));
  }
  throw new Error("Postgres efêmero não ficou pronto a tempo.");
}

/**
 * Diretório temporário com uma CÓPIA de supabase/migrations, só com os
 * arquivos de nome ESTRITAMENTE MENOR que `limiteExclusivo` — usado para
 * aplicar "até a 20261170", isto é, o estado do banco IMEDIATAMENTE ANTES
 * desta migration nascer (item a do plano: preservação). Rollback-manual-*
 * nunca entra aqui (aplicar-migrations.cjs já os ignora por nome, mas o
 * filtro abaixo os exclui de qualquer forma, por clareza).
 */
function prepararDiretorioAte(limiteExclusivo) {
  const alvo = fs.mkdtempSync(path.join(os.tmpdir(), "frete-estrategias-ate-"));
  for (const nome of fs.readdirSync(MIGRATIONS_DIR)) {
    if (!nome.endsWith(".sql")) continue;
    if (nome.startsWith("rollback-")) continue;
    if (nome >= limiteExclusivo) continue;
    fs.copyFileSync(path.join(MIGRATIONS_DIR, nome), path.join(alvo, nome));
  }
  return alvo;
}

// ---- Hashes EXATOS do prosrc (LF) que a 20261170000000/20261167000000 ----
// deixam -- os mesmos números do preflight da própria migration nova.
const HASH_V23_ANTERIOR =
  "77dd477d32159569e1061a2170d1e852ab0c2272e332e188b11054927ea538b5";
const HASH_V24_ANTERIOR =
  "2462205d062b2d5a5c760b5e99528a95ac45937fd68286ef818eae864882c442";
const HASH_UPSERT_ANTERIOR =
  "a6cbf93b1a9cd4b043f01ec0f03e8c2e800f5f53b3167ee2bb6ff915756e2c3b";

// ---- Fixtures determinísticos --------------------------------------------
const U_CLIENTE = "11111111-1111-1111-1111-111111111111";
const P_NORMAL = "aaaaaaaa-0000-0000-0000-0000000000e1"; // preco_venda 50.00, frete_gratis false
const P_GRATIS = "aaaaaaaa-0000-0000-0000-0000000000e2"; // preco_venda 30.00, frete_gratis true
const ORIGEM_CEP = "38500-000";
const FAIXA_LOCAL = "38500000-38505000";

let contadorIdemKey = 0;
function idemKey() {
  contadorIdemKey += 1;
  const n = String(contadorIdemKey).padStart(4, "0");
  return `bbbbbbbb-${n.slice(0, 4)}-4bbb-8bbb-${"0".repeat(8)}${n}`.slice(
    0,
    36,
  );
}

function num(v) {
  return v === null || v === undefined ? v : Number(v);
}

async function logar(cliente, userId) {
  await cliente.query("SELECT set_config('app.rpc.user_id', $1, false)", [
    userId || "",
  ]);
}

async function garantirUsuario(cliente, userId) {
  await cliente.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1, 'prova@example.com', '{}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [userId],
  );
}

async function garantirEnderecoDaConta(cliente, { id, userId, cep }) {
  await cliente.query(
    `INSERT INTO public.user_addresses
       (id, user_id, cep, city, complement, name, neighborhood, number, recipient_name, state, street, is_default)
     VALUES ($1, $2, $3, 'Cidade de Prova', NULL, 'Casa', 'Bairro', '10', 'Cliente de Prova', 'SP', 'Rua de Prova', true)
     ON CONFLICT (id) DO UPDATE SET cep = EXCLUDED.cep`,
    [id, userId, cep],
  );
  return id;
}

/** Cria/atualiza a linha id=1 de store_config com os campos LOCAIS de sempre. */
async function garantirLojaFixture(cliente, extra = {}) {
  await cliente.query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage,
        enabled_shipping_methods, store_address, local_delivery_fee)
     VALUES (1, $1, $2, $3, 'national', $4, $5, $6)
     ON CONFLICT (id) DO UPDATE
       SET origin_cep = EXCLUDED.origin_cep,
           local_cep_range = EXCLUDED.local_cep_range,
           free_shipping_min = EXCLUDED.free_shipping_min,
           shipping_coverage = EXCLUDED.shipping_coverage,
           enabled_shipping_methods = EXCLUDED.enabled_shipping_methods,
           store_address = EXCLUDED.store_address,
           local_delivery_fee = EXCLUDED.local_delivery_fee`,
    [
      ORIGEM_CEP,
      FAIXA_LOCAL,
      extra.freeShippingMin ?? 0,
      extra.enabledShippingMethods || null,
      extra.storeAddress || null,
      extra.localDeliveryFee ?? 12.5,
    ],
  );
}

/** Só depois que a linha id=1 já existe (colunas nacionais só existem pós-171). */
async function definirConfigNacional(
  cliente,
  { strategy, min, discountType, discountValue, scope },
) {
  await cliente.query(
    `UPDATE public.store_config
        SET national_shipping_strategy = $1,
            national_shipping_min = $2,
            national_discount_type = $3,
            national_discount_value = $4,
            national_benefit_scope = $5
      WHERE id = 1`,
    [strategy, min, discountType, discountValue, scope],
  );
}

async function lerConfigNacional(cliente) {
  const r = await cliente.query(
    `SELECT national_shipping_strategy, national_shipping_min, national_discount_type,
            national_discount_value, national_benefit_scope, free_shipping_min
       FROM public.store_config WHERE id = 1`,
  );
  const row = r.rows[0];
  return {
    strategy: row.national_shipping_strategy,
    min: num(row.national_shipping_min),
    discountType: row.national_discount_type,
    discountValue: num(row.national_discount_value),
    scope: row.national_benefit_scope,
    freeShippingMin: num(row.free_shipping_min),
  };
}

async function garantirProdutos(cliente) {
  await cliente.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, frete_gratis)
     VALUES ($1, 'Produto normal', 50.00, 999, true, false)
     ON CONFLICT (id) DO UPDATE SET estoque = 999, ativo = true, preco_venda = 50.00, frete_gratis = false`,
    [P_NORMAL],
  );
  await cliente.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, frete_gratis)
     VALUES ($1, 'Produto frete grátis por produto', 30.00, 999, true, true)
     ON CONFLICT (id) DO UPDATE SET estoque = 999, ativo = true, preco_venda = 30.00, frete_gratis = true`,
    [P_GRATIS],
  );
}

/** cart_hash no formato que a edge grava (getCartHash): "product::qty" por item, vírgula. */
function cartHashDe(itens) {
  return itens.map((i) => `${i.productId}::${i.quantity ?? 1}`).join(",");
}

function itensPayload(itens) {
  return JSON.stringify(
    itens.map((i) => ({
      product_id: i.productId,
      variant_id: null,
      quantity: i.quantity ?? 1,
    })),
  );
}

async function gravarCotacao(
  cliente,
  {
    destino,
    optId,
    itens,
    price,
    precoCheio,
    revisaoCredenciais,
    estrategiaNacional,
    subtotalCotacao,
  },
) {
  const opcao = { id: optId, price };
  if (precoCheio !== undefined) opcao.precoCheio = precoCheio;
  if (revisaoCredenciais !== undefined)
    opcao.revisaoCredenciais = revisaoCredenciais;
  // `estrategiaNacional` aceita `null`/`{}` DE PROPÓSITO (!== undefined, não
  // truthy) -- é assim que os casos (e5)/(e6) da EMENDA (revisão T1) forjam
  // um carimbo PRESENTE mas malformado, distinto de carimbo AUSENTE (chave
  // nunca escrita, quando este parâmetro fica undefined).
  if (estrategiaNacional !== undefined)
    opcao.estrategiaNacional = estrategiaNacional;
  // EMENDA (revisão T1): subtotal (preços do BANCO) com que a regra foi
  // aplicada no instante da cotação -- campo novo lido pela RPC para pegar
  // carrinho que mudou de lado do mínimo depois de cotado.
  if (subtotalCotacao !== undefined) opcao.subtotalCotacao = subtotalCotacao;
  // A chave única é (origin_cep, destination_cep, cart_hash) — 20261166000000.
  // Cada chamada deste helper REESCREVE a linha inteira (options com a opção
  // única desta chamada), no mesmo molde do `.upsert` do edge real. Como os
  // casos deste ensaio rodam em SEQUÊNCIA e cada um lê a cotação logo depois
  // de gravá-la, a reescrita nunca invalida um caso anterior já concluído.
  await cliente.query(
    `INSERT INTO public.shipping_quotes_cache (origin_cep, destination_cep, cart_hash, options, created_at)
     VALUES ($1, $2, $3, $4::jsonb, now())
     ON CONFLICT (origin_cep, destination_cep, cart_hash)
     DO UPDATE SET options = EXCLUDED.options, created_at = EXCLUDED.created_at`,
    [ORIGEM_CEP, destino, cartHashDe(itens), JSON.stringify([opcao])],
  );
}

/**
 * Grava UMA linha do cache com VÁRIAS opções (o formato real da edge: uma
 * cotação devolve todas as transportadoras do carrinho na MESMA linha).
 * `opcoes` já vem pronta, uma por transportadora -- usado pelo caso (e11)
 * para provar que a RPC lê o `price` da opção ESCOLHIDA (por id), não da
 * primeira nem da mais barata da lista.
 */
async function gravarCotacaoComOpcoes(cliente, { destino, itens, opcoes }) {
  await cliente.query(
    `INSERT INTO public.shipping_quotes_cache (origin_cep, destination_cep, cart_hash, options, created_at)
     VALUES ($1, $2, $3, $4::jsonb, now())
     ON CONFLICT (origin_cep, destination_cep, cart_hash)
     DO UPDATE SET options = EXCLUDED.options, created_at = EXCLUDED.created_at`,
    [ORIGEM_CEP, destino, cartHashDe(itens), JSON.stringify(opcoes)],
  );
}

async function chamarRpc(
  cliente,
  fn,
  {
    optId,
    destino,
    total,
    pagamento,
    itens,
    addressId,
    addressCep,
    semAddressData,
    cpf,
  },
) {
  // `cpf` só entra no jsonb de p_address_data quando informado -- usado só
  // pelo caso conjunto (j1), que testa a hipótese registrada no plano (CPF
  // viajando por p_address_data->>'cpf') contra uma migration extra real.
  const addressData = semAddressData
    ? null
    : JSON.stringify({
        cep: addressCep ?? destino,
        rua: "Rua da Prova",
        numero: "1",
        ...(cpf !== undefined ? { cpf } : {}),
      });
  const params = [
    itensPayload(itens),
    total,
    0,
    pagamento,
    addressId || null,
    null,
    "Cliente de Prova",
    "5539000000000",
    null,
    addressData,
    destino,
    optId,
    idemKey(),
  ];
  return cliente.query(
    `SELECT public.${fn}(
       $1::jsonb, $2::numeric, $3::numeric, $4::text, $5::uuid,
       $6::text, $7::text, $8::text, $9::text, $10::jsonb,
       $11::text, $12::text, $13::uuid
     ) AS id`,
    params,
  );
}

async function lerPedido(cliente, orderId) {
  const r = await cliente.query(
    "SELECT shipping, total, subtotal FROM public.marketplace_orders WHERE id = $1",
    [orderId],
  );
  const row = r.rows[0];
  return {
    shipping: num(row.shipping),
    total: num(row.total),
    subtotal: num(row.subtotal),
  };
}

async function contarPedidos(cliente) {
  const r = await cliente.query(
    "SELECT count(*)::int AS n FROM public.marketplace_orders",
  );
  return r.rows[0].n;
}
async function contarItens(cliente) {
  const r = await cliente.query(
    "SELECT count(*)::int AS n FROM public.marketplace_order_items",
  );
  return r.rows[0].n;
}

// Assinatura montada por concatenação direta de `fn` (nunca indexação de
// objeto por variável -- eslint security/detect-object-injection, mesmo
// padrão de tests/frete-revisao-database/run.cjs). `fn` só chega das 3
// chamadas literais deste próprio arquivo, nunca de entrada externa.
async function hashCorpo(cliente, fn) {
  const sig =
    fn === "upsert_store_config"
      ? `${fn}(jsonb)`
      : `${fn}(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)`;
  const r = await cliente.query(
    "SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
    [`public.${sig}`],
  );
  return r.rows[0] ? r.rows[0].h : null;
}

/** O texto fonte da função -- usado pelo caso (j3) para provar que a regra
 * nacional (o texto 'estrategiaNacional') sobrevive a uma migration extra
 * aplicada por cima, mesmo quando ela reescreve o mesmo corpo (CPF). Mesma
 * assinatura montada por concatenação direta de `hashCorpo` -- sem indexar
 * objeto por variável. */
async function lerCorpoFuncao(cliente, fn) {
  const sig =
    fn === "upsert_store_config"
      ? `${fn}(jsonb)`
      : `${fn}(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)`;
  const r = await cliente.query(
    "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
    [`public.${sig}`],
  );
  return r.rows[0] ? r.rows[0].prosrc : null;
}

async function colunasNacionaisNaView(cliente) {
  const r = await cliente.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'v_store_config'
        AND column_name LIKE 'national_%'`,
  );
  return r.rows.map((row) => row.column_name).sort();
}

async function assertRejeitado(promessa, regex, contexto) {
  try {
    await promessa;
    throw new Error(
      `Esperava rejeição em "${contexto}", mas a RPC teve sucesso.`,
    );
  } catch (erro) {
    const msg = erro.message || "";
    assert.match(msg, regex, `"${contexto}": mensagem inesperada: ${msg}`);
  }
}

async function assertCheckViola(cliente, sql, params, contexto) {
  try {
    await cliente.query(sql, params);
    throw new Error(
      `Esperava violação de CHECK em "${contexto}", mas a UPDATE teve sucesso.`,
    );
  } catch (erro) {
    assert.equal(
      erro.code,
      "23514",
      `"${contexto}": esperava SQLSTATE 23514 (check_violation), veio ${erro.code}: ${erro.message}`,
    );
  }
}

/** Regra legada (a MESMA sentinela do bloco 4 antes e depois desta migration). */
function freteGratisLegado(freeShippingMin, hasFreeItem, subtotal) {
  return (
    (freeShippingMin < 0 && hasFreeItem) ||
    freeShippingMin === 0.01 ||
    (freeShippingMin > 0 && subtotal >= freeShippingMin)
  );
}

// ===========================================================================
// CASO (a): PRESERVAÇÃO -- um container por valor de free_shipping_min.
// ===========================================================================

async function casoPreservacao(
  freeShippingMin,
  hasFreeItemAntes,
  verificarSubtotalAcimaDoMinimo = false,
) {
  const container = novoNomeContainer();
  const porta = await achaPortaLivre();
  const databaseUrl = `postgres://postgres:postgres@127.0.0.1:${porta}/postgres`;
  log(
    `[preservação fsm=${freeShippingMin}] subindo container ${container} na porta ${porta}`,
  );
  rodar("docker", [
    "run",
    "-d",
    "--name",
    container,
    "-e",
    "POSTGRES_PASSWORD=postgres",
    "-e",
    "POSTGRES_DB=postgres",
    "-p",
    `${porta}:5432`,
    "postgres:17",
  ]);

  const dirAte = prepararDiretorioAte("20261171000000");
  try {
    await esperarPostgresPronto(container);
    const env = { DATABASE_URL: databaseUrl, CI_BANCO_EFEMERO: "1" };
    rodarNode("tests/banco/provisionar.cjs", [], env);
    rodarNode("tests/banco/aplicar-migrations.cjs", [dirAte], env);

    const cliente = new Client({ connectionString: databaseUrl });
    cliente.on("error", () => {});
    await cliente.connect();

    await garantirProdutos(cliente);
    await garantirUsuario(cliente, U_CLIENTE);
    await logar(cliente, U_CLIENTE);
    await garantirLojaFixture(cliente, { freeShippingMin });

    const itens = [
      { productId: hasFreeItemAntes ? P_GRATIS : P_NORMAL, quantity: 1 },
    ];
    const precoUnit = hasFreeItemAntes ? 30 : 50;
    const subtotal = precoUnit;
    const cheio = 22.5;
    const destinoNacional = "10000-000";
    const destinoLocal = "38500-020";

    const antesGratisNacional = freteGratisLegado(
      freeShippingMin,
      hasFreeItemAntes,
      subtotal,
    );
    await gravarCotacao(cliente, {
      destino: destinoNacional,
      optId: "frenet-preserv",
      itens,
      price: cheio, // ANTES: nenhum campo novo é conhecido, a edge sempre cota o preço cheio
    });
    const totalNacionalAntesEsperado =
      subtotal + (antesGratisNacional ? 0 : cheio);
    const rNacAntes = await chamarRpc(cliente, "create_marketplace_order_v24", {
      optId: "frenet-preserv",
      destino: destinoNacional,
      total: totalNacionalAntesEsperado,
      pagamento: "online",
      itens,
    });
    const pedidoNacAntes = await lerPedido(cliente, rNacAntes.rows[0].id);
    assert.equal(
      pedidoNacAntes.shipping,
      antesGratisNacional ? 0 : cheio,
      `preservação fsm=${freeShippingMin}: frete nacional ANTES`,
    );

    const antesGratisLocal = freteGratisLegado(
      freeShippingMin,
      hasFreeItemAntes,
      subtotal,
    );
    const totalLocalAntesEsperado = subtotal + (antesGratisLocal ? 0 : 12.5);
    const rLocAntes = await chamarRpc(cliente, "create_marketplace_order_v24", {
      optId: "local-delivery",
      destino: destinoLocal,
      total: totalLocalAntesEsperado,
      pagamento: "pix",
      itens,
    });
    const pedidoLocAntes = await lerPedido(cliente, rLocAntes.rows[0].id);
    assert.equal(
      pedidoLocAntes.shipping,
      antesGratisLocal ? 0 : 12.5,
      `preservação fsm=${freeShippingMin}: frete local ANTES`,
    );

    // MENOR (revisão T1): este caso de preservação usa sempre subtotal ==
    // precoUnit (50 ou 30) -- para fsm=150 (acima_de_valor) isso nunca
    // cruza o mínimo, e o ramo "carimbo ausente + acima_de_valor com
    // subtotal >= mínimo zera" (tanto antes quanto depois da migration)
    // nunca roda. Um segundo carrinho, maior, com subtotal >= 150, cobre
    // esse ramo dos dois lados da migration.
    const itensAlto = [{ productId: P_NORMAL, quantity: 4 }]; // subtotal 200 >= 150
    let pedidoNacAntesAlto;
    let pedidoLocAntesAlto;
    if (verificarSubtotalAcimaDoMinimo) {
      await gravarCotacao(cliente, {
        destino: destinoNacional,
        optId: "frenet-preserv-alto",
        itens: itensAlto,
        price: cheio,
      });
      const rNacAntesAlto = await chamarRpc(
        cliente,
        "create_marketplace_order_v24",
        {
          optId: "frenet-preserv-alto",
          destino: destinoNacional,
          total: 200,
          pagamento: "online",
          itens: itensAlto,
        },
      );
      pedidoNacAntesAlto = await lerPedido(cliente, rNacAntesAlto.rows[0].id);
      assert.equal(
        pedidoNacAntesAlto.shipping,
        0,
        `preservação fsm=${freeShippingMin}: frete nacional ANTES com subtotal (200) >= mínimo zera`,
      );

      const rLocAntesAlto = await chamarRpc(
        cliente,
        "create_marketplace_order_v24",
        {
          optId: "local-delivery",
          destino: destinoLocal,
          total: 200,
          pagamento: "pix",
          itens: itensAlto,
        },
      );
      pedidoLocAntesAlto = await lerPedido(cliente, rLocAntesAlto.rows[0].id);
      assert.equal(
        pedidoLocAntesAlto.shipping,
        0,
        `preservação fsm=${freeShippingMin}: frete local ANTES com subtotal (200) >= mínimo zera`,
      );
    }

    // ---- Aplica a 20261171 (a única, sozinha) sobre o banco em pé. ----
    const migrationSql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, MIGRATION),
      "utf8",
    );
    await cliente.query(migrationSql);

    const config = await lerConfigNacional(cliente);
    const esperado = espelhoDe(freeShippingMin);
    assert.equal(
      config.strategy,
      esperado.strategy,
      `preservação fsm=${freeShippingMin}: strategy copiada`,
    );
    assert.equal(
      config.min,
      esperado.min,
      `preservação fsm=${freeShippingMin}: min copiado`,
    );
    assert.equal(
      config.discountType,
      null,
      `preservação fsm=${freeShippingMin}: discountType copiado`,
    );
    assert.equal(
      config.discountValue,
      0,
      `preservação fsm=${freeShippingMin}: discountValue copiado`,
    );
    assert.equal(
      config.scope,
      esperado.scope,
      `preservação fsm=${freeShippingMin}: scope copiado`,
    );
    log(
      `[preservação fsm=${freeShippingMin}] colunas copiadas: ${JSON.stringify(config)}`,
    );

    // ---- DEPOIS: nova cotação (SEM carimbo -- edge ainda não mudou), novo pedido. ----
    await gravarCotacao(cliente, {
      destino: destinoNacional,
      optId: "frenet-preserv-depois",
      itens,
      price: cheio,
    });
    const rNacDepois = await chamarRpc(
      cliente,
      "create_marketplace_order_v24",
      {
        optId: "frenet-preserv-depois",
        destino: destinoNacional,
        total: totalNacionalAntesEsperado,
        pagamento: "online",
        itens,
      },
    );
    const pedidoNacDepois = await lerPedido(cliente, rNacDepois.rows[0].id);
    assert.equal(
      pedidoNacDepois.shipping,
      pedidoNacAntes.shipping,
      `preservação fsm=${freeShippingMin}: frete nacional ANTES == DEPOIS`,
    );

    const rLocDepois = await chamarRpc(
      cliente,
      "create_marketplace_order_v24",
      {
        optId: "local-delivery",
        destino: "38500-021",
        total: totalLocalAntesEsperado,
        pagamento: "pix",
        itens,
      },
    );
    const pedidoLocDepois = await lerPedido(cliente, rLocDepois.rows[0].id);
    assert.equal(
      pedidoLocDepois.shipping,
      pedidoLocAntes.shipping,
      `preservação fsm=${freeShippingMin}: frete local ANTES == DEPOIS`,
    );

    if (verificarSubtotalAcimaDoMinimo) {
      // DEPOIS (mesmo carrinho grande, subtotal 200 >= 150): carimbo AUSENTE
      // (edge ainda não mudou) + config = espelho legado (acima_de_valor,
      // min=150) -> regra legada, lida com v_calculated_subtotal AO VIVO,
      // continua zerando o frete -- mesmo ramo do "antes", agora do outro
      // lado da migration.
      await gravarCotacao(cliente, {
        destino: destinoNacional,
        optId: "frenet-preserv-alto-depois",
        itens: itensAlto,
        price: cheio,
      });
      const rNacDepoisAlto = await chamarRpc(
        cliente,
        "create_marketplace_order_v24",
        {
          optId: "frenet-preserv-alto-depois",
          destino: destinoNacional,
          total: 200,
          pagamento: "online",
          itens: itensAlto,
        },
      );
      const pedidoNacDepoisAlto = await lerPedido(
        cliente,
        rNacDepoisAlto.rows[0].id,
      );
      assert.equal(
        pedidoNacDepoisAlto.shipping,
        0,
        `preservação fsm=${freeShippingMin}: frete nacional DEPOIS com subtotal (200) >= mínimo zera`,
      );
      assert.equal(
        pedidoNacDepoisAlto.shipping,
        pedidoNacAntesAlto.shipping,
        `preservação fsm=${freeShippingMin}: frete nacional (subtotal alto) ANTES == DEPOIS`,
      );

      const rLocDepoisAlto = await chamarRpc(
        cliente,
        "create_marketplace_order_v24",
        {
          optId: "local-delivery",
          destino: "38500-022",
          total: 200,
          pagamento: "pix",
          itens: itensAlto,
        },
      );
      const pedidoLocDepoisAlto = await lerPedido(
        cliente,
        rLocDepoisAlto.rows[0].id,
      );
      assert.equal(
        pedidoLocDepoisAlto.shipping,
        0,
        `preservação fsm=${freeShippingMin}: frete local DEPOIS com subtotal (200) >= mínimo zera`,
      );
      assert.equal(
        pedidoLocDepoisAlto.shipping,
        pedidoLocAntesAlto.shipping,
        `preservação fsm=${freeShippingMin}: frete local (subtotal alto) ANTES == DEPOIS`,
      );
      log(
        `PASS preservação fsm=${freeShippingMin} (subtotal alto >= mínimo): nacional e local zeram ANTES e DEPOIS (${pedidoNacAntesAlto.shipping} == ${pedidoNacDepoisAlto.shipping}, ${pedidoLocAntesAlto.shipping} == ${pedidoLocDepoisAlto.shipping})`,
      );
    }

    await cliente.end();
    log(
      `PASS preservação fsm=${freeShippingMin}: nacional ${pedidoNacAntes.shipping} == ${pedidoNacDepois.shipping}, local ${pedidoLocAntes.shipping} == ${pedidoLocDepois.shipping}`,
    );
  } finally {
    rodar("docker", ["rm", "-f", container], { encoding: "utf8" });
    fs.rmSync(dirAte, { recursive: true, force: true });
  }
}

function espelhoDe(freeShippingMin) {
  if (freeShippingMin === 0.01)
    return { strategy: "sempre", min: 0, scope: "todas" };
  if (freeShippingMin < 0)
    return { strategy: "por_produto", min: 0, scope: "todas" };
  if (freeShippingMin > 0)
    return { strategy: "acima_de_valor", min: freeShippingMin, scope: "todas" };
  return { strategy: "desligado", min: 0, scope: "mais_barata" };
}

// ===========================================================================
// Container(s) para os casos (b) a (i) -- roda DEPOIS da migration já estar
// na raiz (aplicação normal, de ponta a ponta). Com --com-migration, o
// MESMO (b)-(h) roda de novo num SEGUNDO container que tem a(s) extra(s)
// aplicada(s) por cima, mais os casos conjuntos (j1)-(j3).
// ===========================================================================

/**
 * (b) a (h): tudo que NÃO envolve o rollback-manual da própria 20261171.
 * Roda nos dois containers; (b) não reaplica a 20261171 sobre uma extra. A prova
 * de que a regra nacional continua funcionando com uma migration extra
 * aplicada por cima.
 */
async function rodarCasosBAteH(cliente, migrationSql) {
  let config;
  const itens = [{ productId: P_NORMAL, quantity: 1 }];

  // =======================================================================
  // (b) Reaplicar depois de a lojista escolher 'desligado' não reescreve.
  // =======================================================================
  // Muda o free_shipping_min para um valor que, se a cópia rodasse de
  // novo, produziria 'acima_de_valor' -- e MANTÉM 'desligado' na coluna
  // nacional (a escolha real que a lojista já fez pela tela).
  await cliente.query(
    "UPDATE public.store_config SET free_shipping_min = 999 WHERE id = 1",
  );
  await definirConfigNacional(cliente, {
    strategy: "desligado",
    min: 0,
    discountType: null,
    discountValue: 0,
    scope: "mais_barata",
  });
  if (migrationSql) {
    await cliente.query(migrationSql); // só no banco sem migration posterior
  }
  config = await lerConfigNacional(cliente);
  assert.equal(
    config.strategy,
    "desligado",
    "(b) reaplicar não sobrescreve a escolha da lojista",
  );
  assert.equal(
    config.freeShippingMin,
    999,
    "(b) free_shipping_min continua o que foi setado (não é tocado pela migration)",
  );
  log(
    migrationSql
      ? "PASS (b) reaplicar a migration depois de a lojista escolher 'desligado' não reescreve"
      : "SKIP (b) com migration posterior: reaplicação da 20261171 já verificada no banco principal",
  );
  // Devolve free_shipping_min a um valor neutro para os casos seguintes.
  await cliente.query(
    "UPDATE public.store_config SET free_shipping_min = 0 WHERE id = 1",
  );
  await definirConfigNacional(cliente, {
    strategy: "desligado",
    min: 0,
    discountType: null,
    discountValue: 0,
    scope: "mais_barata",
  });

  // =======================================================================
  // (c) CHECKs recusam.
  // =======================================================================
  await assertCheckViola(
    cliente,
    "UPDATE public.store_config SET national_shipping_strategy = 'acima_de_valor', national_shipping_min = 0 WHERE id = 1",
    [],
    "acima_de_valor com min 0",
  );
  await assertCheckViola(
    cliente,
    "UPDATE public.store_config SET national_shipping_strategy = 'desconto_na_mais_barata', national_discount_type = NULL, national_discount_value = 10 WHERE id = 1",
    [],
    "desconto sem tipo",
  );
  await assertCheckViola(
    cliente,
    "UPDATE public.store_config SET national_shipping_strategy = 'desconto_na_mais_barata', national_discount_type = 'percentual', national_discount_value = 101 WHERE id = 1",
    [],
    "percentual 101",
  );
  await assertCheckViola(
    cliente,
    "UPDATE public.store_config SET national_shipping_strategy = 'desconto_na_mais_barata', national_discount_type = 'percentual', national_discount_value = 12.5 WHERE id = 1",
    [],
    "percentual 12.5 (não inteiro)",
  );
  await assertCheckViola(
    cliente,
    "UPDATE public.store_config SET national_discount_value = -5 WHERE id = 1",
    [],
    "valor negativo",
  );
  config = await lerConfigNacional(cliente);
  assert.equal(
    config.strategy,
    "desligado",
    "(c) nenhuma tentativa recusada deixou resíduo (statement é atômico)",
  );
  log(
    "PASS (c) os 5 CHECKs recusam (acima_de_valor min 0, desconto sem tipo, percentual 101, percentual 12.5, valor negativo)",
  );

  // =======================================================================
  // (d) upsert_store_config: salvar só colunas LOCAIS não mexe nas
  // NACIONAIS, e vice-versa.
  // =======================================================================
  await definirConfigNacional(cliente, {
    strategy: "sempre",
    min: 0,
    discountType: null,
    discountValue: 0,
    scope: "todas",
  });
  await cliente.query(
    "UPDATE public.store_config SET free_shipping_min = 5 WHERE id = 1",
  );
  // upsert_store_config exige is_admin() -- current_setting('role') não
  // reflete o usuário da conexão (postgres) sem um SET ROLE explícito.
  await cliente.query("SET ROLE postgres");
  await cliente.query("SELECT public.upsert_store_config($1::jsonb)", [
    JSON.stringify({ free_shipping_min: 77 }),
  ]);
  let r = await cliente.query(
    "SELECT free_shipping_min, national_shipping_strategy, national_benefit_scope FROM public.store_config WHERE id = 1",
  );
  assert.equal(
    num(r.rows[0].free_shipping_min),
    77,
    "(d) upsert só-local mudou free_shipping_min",
  );
  assert.equal(
    r.rows[0].national_shipping_strategy,
    "sempre",
    "(d) upsert só-local NÃO mexeu na estratégia nacional",
  );
  assert.equal(
    r.rows[0].national_benefit_scope,
    "todas",
    "(d) upsert só-local NÃO mexeu no alcance nacional",
  );

  await cliente.query("SELECT public.upsert_store_config($1::jsonb)", [
    JSON.stringify({
      national_shipping_strategy: "acima_de_valor",
      national_shipping_min: 199,
      national_benefit_scope: "mais_barata",
    }),
  ]);
  r = await cliente.query(
    "SELECT free_shipping_min, national_shipping_strategy, national_shipping_min, national_benefit_scope FROM public.store_config WHERE id = 1",
  );
  assert.equal(
    num(r.rows[0].free_shipping_min),
    77,
    "(d) upsert só-nacional NÃO mexeu no free_shipping_min local",
  );
  assert.equal(
    r.rows[0].national_shipping_strategy,
    "acima_de_valor",
    "(d) upsert só-nacional mudou a estratégia",
  );
  assert.equal(
    num(r.rows[0].national_shipping_min),
    199,
    "(d) upsert só-nacional mudou o mínimo",
  );
  assert.equal(
    r.rows[0].national_benefit_scope,
    "mais_barata",
    "(d) upsert só-nacional mudou o alcance",
  );
  log(
    "PASS (d) upsert_store_config separa as colunas locais das nacionais nos dois sentidos",
  );

  // Volta a um estado neutro e conhecido para os casos seguintes.
  await cliente.query(
    "UPDATE public.store_config SET free_shipping_min = 0 WHERE id = 1",
  );
  await definirConfigNacional(cliente, {
    strategy: "desligado",
    min: 0,
    discountType: null,
    discountValue: 0,
    scope: "mais_barata",
  });

  // =======================================================================
  // (e) opção nacional: carimbo igual / divergente / ausente+espelho /
  // ausente+não-espelho.
  // =======================================================================
  // (e1) carimbo IGUAL -> cobra `price` do cache (com desconto: cheio
  // 24.90, price 21.16 -- fórmula do contrato em CENTAVOS inteiros:
  // cheioC=2490, 2490 × 15 / 100 = 373.5, Math.round(373.5) = 374,
  // 2490 − 374 = 2116 -> 21.16. Corrigido na rodada final de revisão T1:
  // o valor anterior (21.17) não vinha da fórmula do plano).
  await definirConfigNacional(cliente, {
    strategy: "desconto_na_mais_barata",
    min: 0,
    discountType: "percentual",
    discountValue: 15,
    scope: "mais_barata",
  });
  const estrategiaE1 = {
    estrategia: "desconto_na_mais_barata",
    minimo: 0,
    tipoDesconto: "percentual",
    valorDesconto: 15,
    alcance: "mais_barata",
  };
  await gravarCotacao(cliente, {
    destino: "20000-000",
    optId: "frenet-e1",
    itens,
    price: 21.16,
    precoCheio: 24.9,
    estrategiaNacional: estrategiaE1,
  });
  const rE1 = await chamarRpc(cliente, "create_marketplace_order_v24", {
    optId: "frenet-e1",
    destino: "20000-000",
    total: 71.16,
    pagamento: "online",
    itens,
  });
  const pedidoE1 = await lerPedido(cliente, rE1.rows[0].id);
  assert.equal(
    pedidoE1.shipping,
    21.16,
    "(e1) carimbo igual cobra o price do cache (com desconto)",
  );
  log(
    "PASS (e1) carimbo igual cobra price do cache (cheio 24.90 / price 21.16)",
  );

  // (e2) carimbo DIVERGENTE -> FRETE_COTACAO_DESATUALIZADA, nada gravado.
  const estrategiaE2 = { ...estrategiaE1, valorDesconto: 10 }; // divergente do config atual (15)
  await gravarCotacao(cliente, {
    destino: "20000-000",
    optId: "frenet-e2",
    itens,
    price: 22.41,
    precoCheio: 24.9,
    estrategiaNacional: estrategiaE2,
  });
  const antesPedidosE2 = await contarPedidos(cliente);
  const antesItensE2 = await contarItens(cliente);
  await assertRejeitado(
    chamarRpc(cliente, "create_marketplace_order_v24", {
      optId: "frenet-e2",
      destino: "20000-000",
      total: 72.41,
      pagamento: "online",
      itens,
    }),
    /^FRETE_COTACAO_DESATUALIZADA/,
    "(e2) carimbo divergente",
  );
  assert.equal(
    await contarPedidos(cliente),
    antesPedidosE2,
    "(e2) nenhum pedido gravado",
  );
  assert.equal(
    await contarItens(cliente),
    antesItensE2,
    "(e2) nenhum item gravado",
  );
  log(
    "PASS (e2) carimbo divergente -> FRETE_COTACAO_DESATUALIZADA, nada gravado",
  );

  // (e3) carimbo AUSENTE + config = ESPELHO legado -> regra legada decide.
  await cliente.query(
    "UPDATE public.store_config SET free_shipping_min = -1 WHERE id = 1",
  );
  await definirConfigNacional(cliente, {
    strategy: "por_produto",
    min: 0,
    discountType: null,
    discountValue: 0,
    scope: "todas",
  });
  const itensGratis = [{ productId: P_GRATIS, quantity: 1 }];
  await gravarCotacao(cliente, {
    destino: "20000-000",
    optId: "frenet-e3",
    itens: itensGratis,
    price: 18.0,
  }); // sem estrategiaNacional
  const rE3 = await chamarRpc(cliente, "create_marketplace_order_v24", {
    optId: "frenet-e3",
    destino: "20000-000",
    total: 30.0,
    pagamento: "online",
    itens: itensGratis,
  });
  const pedidoE3 = await lerPedido(cliente, rE3.rows[0].id);
  assert.equal(
    pedidoE3.shipping,
    0,
    "(e3) carimbo ausente + espelho (por_produto, item marcado) -> regra legada zera",
  );
  log(
    "PASS (e3) carimbo ausente + config espelho -> regra legada decide (zerou por item marcado)",
  );

  // (e4) carimbo AUSENTE + config NÃO-espelho -> FRETE_COTACAO_DESATUALIZADA.
  await definirConfigNacional(cliente, {
    strategy: "sempre",
    min: 0,
    discountType: null,
    discountValue: 0,
    scope: "todas",
  }); // não é mais o espelho de fsm=-1
  await gravarCotacao(cliente, {
    destino: "20000-000",
    optId: "frenet-e4",
    itens: itensGratis,
    price: 18.0,
  });
  const antesPedidosE4 = await contarPedidos(cliente);
  await assertRejeitado(
    chamarRpc(cliente, "create_marketplace_order_v24", {
      optId: "frenet-e4",
      destino: "20000-000",
      total: 30.0,
      pagamento: "online",
      itens: itensGratis,
    }),
    /^FRETE_COTACAO_DESATUALIZADA/,
    "(e4) carimbo ausente + config não-espelho",
  );
  assert.equal(
    await contarPedidos(cliente),
    antesPedidosE4,
    "(e4) nenhum pedido gravado",
  );
  log(
    "PASS (e4) carimbo ausente + config NÃO-espelho -> FRETE_COTACAO_DESATUALIZADA",
  );

  // =======================================================================
  // (e5)-(e7) EMENDA (revisão T1): carimbo PRESENTE mas que não é um
  // objeto JSON completo (a CHAVE existe, mas o valor é json null, `{}`,
  // ou um objeto faltando campo) -- nenhum destes é "carimbo ausente"
  // (não têm direito ao espelho legado): todos recusam direto, mesmo com
  // uma config que "bateria" se o carimbo fosse lido ingenuamente.
  // =======================================================================
  await definirConfigNacional(cliente, {
    strategy: "sempre",
    min: 0,
    discountType: null,
    discountValue: 0,
    scope: "todas",
  });

  // (e5) carimbo json `null` (chave existe, valor null -- distinto de
  // chave ausente, que é SQL NULL de verdade).
  await gravarCotacao(cliente, {
    destino: "20000-000",
    optId: "frenet-e5",
    itens,
    price: 0,
    precoCheio: 25.0,
    estrategiaNacional: null,
  });
  const antesPedidosE5 = await contarPedidos(cliente);
  await assertRejeitado(
    chamarRpc(cliente, "create_marketplace_order_v24", {
      optId: "frenet-e5",
      destino: "20000-000",
      total: 50.0,
      pagamento: "online",
      itens,
    }),
    /^FRETE_COTACAO_DESATUALIZADA/,
    "(e5) carimbo presente como json null",
  );
  assert.equal(
    await contarPedidos(cliente),
    antesPedidosE5,
    "(e5) nenhum pedido gravado",
  );
  log(
    "PASS (e5) carimbo presente como json null (não confundido com carimbo ausente) -> FRETE_COTACAO_DESATUALIZADA",
  );

  // (e6) carimbo `{}` (objeto vazio -- typeof 'object', mas toda comparação
  // de campo dá NULL; sem o COALESCE(...,false) da correção, `NOT NULL`
  // não dispara o RAISE e o carimbo vazio passava batido).
  await gravarCotacao(cliente, {
    destino: "20000-000",
    optId: "frenet-e6",
    itens,
    price: 0,
    precoCheio: 25.0,
    estrategiaNacional: {},
  });
  const antesPedidosE6 = await contarPedidos(cliente);
  await assertRejeitado(
    chamarRpc(cliente, "create_marketplace_order_v24", {
      optId: "frenet-e6",
      destino: "20000-000",
      total: 50.0,
      pagamento: "online",
      itens,
    }),
    /^FRETE_COTACAO_DESATUALIZADA/,
    "(e6) carimbo presente como objeto vazio {}",
  );
  assert.equal(
    await contarPedidos(cliente),
    antesPedidosE6,
    "(e6) nenhum pedido gravado",
  );
  log(
    "PASS (e6) carimbo presente como {} (objeto vazio) -> FRETE_COTACAO_DESATUALIZADA",
  );

  // (e7) carimbo PARCIAL (objeto com 4 dos 5 campos -- falta 'alcance').
  // Mesmo com os outros 4 campos batendo perfeitamente com a config atual
  // (estrategia=sempre, minimo=0), o campo faltando derruba o AND inteiro
  // para NULL, e o COALESCE(...,false) tem de pegar isso.
  const estrategiaParcial = {
    estrategia: "sempre",
    minimo: 0,
    tipoDesconto: null,
    valorDesconto: 0,
  }; // falta 'alcance'
  await gravarCotacao(cliente, {
    destino: "20000-000",
    optId: "frenet-e7",
    itens,
    price: 0,
    precoCheio: 25.0,
    estrategiaNacional: estrategiaParcial,
  });
  const antesPedidosE7 = await contarPedidos(cliente);
  await assertRejeitado(
    chamarRpc(cliente, "create_marketplace_order_v24", {
      optId: "frenet-e7",
      destino: "20000-000",
      total: 50.0,
      pagamento: "online",
      itens,
    }),
    /^FRETE_COTACAO_DESATUALIZADA/,
    "(e7) carimbo presente mas parcial (falta 'alcance')",
  );
  assert.equal(
    await contarPedidos(cliente),
    antesPedidosE7,
    "(e7) nenhum pedido gravado",
  );
  log(
    "PASS (e7) carimbo presente mas parcial (falta um campo, os outros 4 batendo) -> FRETE_COTACAO_DESATUALIZADA",
  );

  // =======================================================================
  // (e8)-(e10) EMENDA (revisão T1): subtotal velho -- estratégia
  // acima_de_valor/desconto_na_mais_barata com mínimo > 0. O carrinho é o
  // MESMO (mesmo cart_hash) dos dois lados; o preco_venda do produto MUDA
  // entre a cotação e o pedido (a lojista editou o preço no meio do
  // caminho), fazendo v_calculated_subtotal (lido AO VIVO no pedido)
  // divergir do subtotalCotacao (congelado no carimbo).
  // =======================================================================
  await definirConfigNacional(cliente, {
    strategy: "acima_de_valor",
    min: 199,
    discountType: null,
    discountValue: 0,
    scope: "todas",
  });
  const estrategiaSubtotal = {
    estrategia: "acima_de_valor",
    minimo: 199,
    tipoDesconto: null,
    valorDesconto: 0,
    alcance: "todas",
  };

  // (e8) cotado com subtotal 200 (>= 199, price 0 -- grátis) e o preço do
  // produto CAI depois: subtotal recalculado no pedido fica 150 (< 199).
  // O `price=0` do cache não se sustenta mais -> recusa.
  const itensE8 = [{ productId: P_NORMAL, quantity: 4 }]; // 4 x 50 = 200 na cotação
  await gravarCotacao(cliente, {
    destino: "20000-000",
    optId: "frenet-e8",
    itens: itensE8,
    price: 0,
    precoCheio: 25.0,
    estrategiaNacional: estrategiaSubtotal,
    subtotalCotacao: 200,
  });
  await cliente.query(
    "UPDATE public.produtos SET preco_venda = 37.5 WHERE id = $1",
    [P_NORMAL],
  ); // 4 x 37.5 = 150
  const antesPedidosE8 = await contarPedidos(cliente);
  await assertRejeitado(
    chamarRpc(cliente, "create_marketplace_order_v24", {
      optId: "frenet-e8",
      destino: "20000-000",
      total: 150.0,
      pagamento: "online",
      itens: itensE8,
    }),
    /^FRETE_COTACAO_DESATUALIZADA/,
    "(e8) subtotal caiu abaixo do mínimo depois da cotação (cotado 200, pedido 150, mínimo 199)",
  );
  assert.equal(
    await contarPedidos(cliente),
    antesPedidosE8,
    "(e8) nenhum pedido gravado",
  );
  await cliente.query(
    "UPDATE public.produtos SET preco_venda = 50.00 WHERE id = $1",
    [P_NORMAL],
  ); // devolve o preço
  log(
    "PASS (e8) cotado 200 (>= 199, grátis) / pedido 150 (< 199) -> FRETE_COTACAO_DESATUALIZADA",
  );

  // (e9) o sentido inverso: cotado com subtotal 150 (< 199, preço cheio) e
  // o preço do produto SOBE depois: subtotal recalculado no pedido fica
  // 210 (>= 199). O `price` cheio do cache não reflete mais o desconto
  // que o subtotal de agora garantiria -> recusa também (defende a
  // LOJISTA tanto quanto a cliente: o banco nunca decide sozinho qual dos
  // dois lados "favorece" -- qualquer divergência recota).
  const itensE9 = [{ productId: P_NORMAL, quantity: 3 }]; // 3 x 50 = 150 na cotação
  await gravarCotacao(cliente, {
    destino: "20001-000",
    optId: "frenet-e9",
    itens: itensE9,
    price: 25.0,
    precoCheio: 25.0,
    estrategiaNacional: estrategiaSubtotal,
    subtotalCotacao: 150,
  });
  await cliente.query(
    "UPDATE public.produtos SET preco_venda = 70.00 WHERE id = $1",
    [P_NORMAL],
  ); // 3 x 70 = 210
  const antesPedidosE9 = await contarPedidos(cliente);
  await assertRejeitado(
    chamarRpc(cliente, "create_marketplace_order_v24", {
      optId: "frenet-e9",
      destino: "20001-000",
      total: 235.0,
      pagamento: "online",
      itens: itensE9,
    }),
    /^FRETE_COTACAO_DESATUALIZADA/,
    "(e9) subtotal subiu acima do mínimo depois da cotação (cotado 150, pedido 210, mínimo 199)",
  );
  assert.equal(
    await contarPedidos(cliente),
    antesPedidosE9,
    "(e9) nenhum pedido gravado",
  );
  await cliente.query(
    "UPDATE public.produtos SET preco_venda = 50.00 WHERE id = $1",
    [P_NORMAL],
  ); // devolve o preço
  log(
    "PASS (e9) cotado 150 (< 199, cheio) / pedido 210 (>= 199) -> FRETE_COTACAO_DESATUALIZADA",
  );

  // (e10) mesmo lado do mínimo dos dois lados (cotado 250, pedido 220 --
  // os dois >= 199): aceita normalmente, cobra o `price` do cache (0).
  const itensE10 = [{ productId: P_NORMAL, quantity: 5 }]; // 5 x 50 = 250 na cotação
  await gravarCotacao(cliente, {
    destino: "20002-000",
    optId: "frenet-e10",
    itens: itensE10,
    price: 0,
    precoCheio: 25.0,
    estrategiaNacional: estrategiaSubtotal,
    subtotalCotacao: 250,
  });
  await cliente.query(
    "UPDATE public.produtos SET preco_venda = 44.00 WHERE id = $1",
    [P_NORMAL],
  ); // 5 x 44 = 220
  const rE10 = await chamarRpc(cliente, "create_marketplace_order_v24", {
    optId: "frenet-e10",
    destino: "20002-000",
    total: 220.0,
    pagamento: "online",
    itens: itensE10,
  });
  const pedidoE10 = await lerPedido(cliente, rE10.rows[0].id);
  assert.equal(
    pedidoE10.shipping,
    0,
    "(e10) mesmo lado do mínimo (cotado 250, pedido 220) -> aceita, cobra o price do cache",
  );
  await cliente.query(
    "UPDATE public.produtos SET preco_venda = 50.00 WHERE id = $1",
    [P_NORMAL],
  ); // devolve o preço
  log(
    "PASS (e10) subtotal mudou mas continua do mesmo lado do mínimo -> aceita normalmente",
  );

  // =======================================================================
  // (e11) rodada final de revisão T1: desconto_na_mais_barata com DUAS
  // opções na MESMA linha do cache (o formato real da edge -- uma
  // cotação devolve todas as transportadoras do carrinho juntas). Só a de
  // menor cheio é a beneficiada (alcance mais_barata); a outra cobra o
  // PRÓPRIO price (cheio, sem desconto) -- prova que a RPC lê o price da
  // opção ESCOLHIDA por id, nunca da primeira/mais barata da lista.
  // =======================================================================
  await definirConfigNacional(cliente, {
    strategy: "desconto_na_mais_barata",
    min: 0,
    discountType: "percentual",
    discountValue: 15,
    scope: "mais_barata",
  });
  await gravarCotacaoComOpcoes(cliente, {
    destino: "20000-000",
    itens,
    opcoes: [
      {
        id: "frenet-e11-desconto",
        price: 21.16,
        precoCheio: 24.9,
        estrategiaNacional: estrategiaE1,
      },
      {
        id: "correios-e11-cheio",
        price: 30,
        precoCheio: 30,
        estrategiaNacional: estrategiaE1,
      },
    ],
  });
  const rE11 = await chamarRpc(cliente, "create_marketplace_order_v24", {
    optId: "correios-e11-cheio",
    destino: "20000-000",
    total: 80.0,
    pagamento: "online",
    itens,
  });
  const pedidoE11 = await lerPedido(cliente, rE11.rows[0].id);
  assert.equal(
    pedidoE11.shipping,
    30,
    "(e11) opção NÃO mais barata (mesma cotação) cobra o price PRÓPRIO, sem desconto",
  );
  log(
    "PASS (e11) duas opções na mesma cotação: escolher a NÃO mais barata cobra 30 (cheio, sem desconto), não o 21.16 da outra",
  );

  // =======================================================================
  // (e12)-(e13) rodada final de revisão T1: a checagem de subtotal velho
  // (EMENDA, e8-e10) TAMBÉM vale para desconto_na_mais_barata com
  // mínimo > 0 -- não só para acima_de_valor.
  // =======================================================================
  await definirConfigNacional(cliente, {
    strategy: "desconto_na_mais_barata",
    min: 100,
    discountType: "percentual",
    discountValue: 15,
    scope: "mais_barata",
  });
  const estrategiaDescontoComMinimo = {
    estrategia: "desconto_na_mais_barata",
    minimo: 100,
    tipoDesconto: "percentual",
    valorDesconto: 15,
    alcance: "mais_barata",
  };

  // (e12) cotado com subtotal 120 (>= 100, desconto aplicado: 21.16) e
  // pedido com subtotal 120 também (preço do produto INTOCADO) -> mesmo
  // lado do mínimo, aceita e cobra 21.16.
  const itensE12 = [{ productId: P_NORMAL, quantity: 2 }];
  await cliente.query(
    "UPDATE public.produtos SET preco_venda = 60.00 WHERE id = $1",
    [P_NORMAL],
  ); // 2 x 60 = 120
  await gravarCotacao(cliente, {
    destino: "20003-000",
    optId: "frenet-e12",
    itens: itensE12,
    price: 21.16,
    precoCheio: 24.9,
    estrategiaNacional: estrategiaDescontoComMinimo,
    subtotalCotacao: 120,
  });
  const rE12 = await chamarRpc(cliente, "create_marketplace_order_v24", {
    optId: "frenet-e12",
    destino: "20003-000",
    total: 141.16,
    pagamento: "online",
    itens: itensE12,
  });
  const pedidoE12 = await lerPedido(cliente, rE12.rows[0].id);
  assert.equal(
    pedidoE12.shipping,
    21.16,
    "(e12) desconto com mínimo > 0, subtotal 120/120 (mesmo lado) -> aceita, cobra 21.16",
  );
  log(
    "PASS (e12) desconto_na_mais_barata com mínimo > 0: cotado 120 / pedido 120 -> aceita, cobra 21.16",
  );

  // (e13) cotado com subtotal 120 (>= 100, desconto 21.16) e o preço do
  // produto CAI depois: subtotal recalculado no pedido fica 80 (< 100) ->
  // cruzou para o outro lado do mínimo -> DESATUALIZADA (mesma checagem
  // de e8-e10, agora provada também para desconto_na_mais_barata).
  const itensE13 = [{ productId: P_NORMAL, quantity: 2 }];
  await gravarCotacao(cliente, {
    destino: "20004-000",
    optId: "frenet-e13",
    itens: itensE13,
    price: 21.16,
    precoCheio: 24.9,
    estrategiaNacional: estrategiaDescontoComMinimo,
    subtotalCotacao: 120,
  });
  await cliente.query(
    "UPDATE public.produtos SET preco_venda = 40.00 WHERE id = $1",
    [P_NORMAL],
  ); // 2 x 40 = 80
  const antesPedidosE13 = await contarPedidos(cliente);
  await assertRejeitado(
    chamarRpc(cliente, "create_marketplace_order_v24", {
      optId: "frenet-e13",
      destino: "20004-000",
      total: 80.0,
      pagamento: "online",
      itens: itensE13,
    }),
    /^FRETE_COTACAO_DESATUALIZADA/,
    "(e13) desconto com mínimo > 0, subtotal caiu de 120 para 80 (cruzou o mínimo)",
  );
  assert.equal(
    await contarPedidos(cliente),
    antesPedidosE13,
    "(e13) nenhum pedido gravado",
  );
  await cliente.query(
    "UPDATE public.produtos SET preco_venda = 50.00 WHERE id = $1",
    [P_NORMAL],
  ); // devolve o preço
  log(
    "PASS (e13) desconto_na_mais_barata com mínimo > 0: cotado 120 / pedido 80 -> FRETE_COTACAO_DESATUALIZADA",
  );

  // Volta a um estado neutro.
  await cliente.query(
    "UPDATE public.store_config SET free_shipping_min = 0 WHERE id = 1",
  );
  await definirConfigNacional(cliente, {
    strategy: "desligado",
    min: 0,
    discountType: null,
    discountValue: 0,
    scope: "mais_barata",
  });

  // =======================================================================
  // (f) local grátis + nacional desligado (e o inverso).
  // =======================================================================
  // (f1) local SEMPRE grátis (0.01), nacional DESLIGADO explícito (carimbo
  // presente, preço cheio) -- o pedido nacional cobra o preço do cache.
  await cliente.query(
    "UPDATE public.store_config SET free_shipping_min = 0.01 WHERE id = 1",
  );
  await definirConfigNacional(cliente, {
    strategy: "desligado",
    min: 0,
    discountType: null,
    discountValue: 0,
    scope: "mais_barata",
  });
  const estrategiaDesligado = {
    estrategia: "desligado",
    minimo: 0,
    tipoDesconto: null,
    valorDesconto: 0,
    alcance: "mais_barata",
  };
  await gravarCotacao(cliente, {
    destino: "20000-000",
    optId: "frenet-f1",
    itens,
    price: 25.0,
    precoCheio: 25.0,
    estrategiaNacional: estrategiaDesligado,
  });
  const rF1Nac = await chamarRpc(cliente, "create_marketplace_order_v24", {
    optId: "frenet-f1",
    destino: "20000-000",
    total: 75.0,
    pagamento: "online",
    itens,
  });
  const pedidoF1Nac = await lerPedido(cliente, rF1Nac.rows[0].id);
  assert.equal(
    pedidoF1Nac.shipping,
    25.0,
    "(f1) nacional desligado cobra o preço cheio, mesmo com local sempre grátis",
  );
  const rF1Loc = await chamarRpc(cliente, "create_marketplace_order_v24", {
    optId: "local-delivery",
    destino: "38500-030",
    total: 50.0,
    pagamento: "pix",
    itens,
  });
  const pedidoF1Loc = await lerPedido(cliente, rF1Loc.rows[0].id);
  assert.equal(
    pedidoF1Loc.shipping,
    0,
    "(f1) local sai 0 (free_shipping_min=0.01)",
  );
  log(
    "PASS (f1) local grátis (0.01) + nacional desligado: nacional cobra o cache, local sai 0",
  );

  // (f2) o inverso: local DESLIGADO (0), nacional SEMPRE (carimbo presente,
  // preço zerado) -- local cobra local_delivery_fee.
  await cliente.query(
    "UPDATE public.store_config SET free_shipping_min = 0 WHERE id = 1",
  );
  await definirConfigNacional(cliente, {
    strategy: "sempre",
    min: 0,
    discountType: null,
    discountValue: 0,
    scope: "todas",
  });
  const rF2Loc = await chamarRpc(cliente, "create_marketplace_order_v24", {
    optId: "local-delivery",
    destino: "38500-031",
    total: 62.5,
    pagamento: "pix",
    itens,
  });
  const pedidoF2Loc = await lerPedido(cliente, rF2Loc.rows[0].id);
  assert.equal(
    pedidoF2Loc.shipping,
    12.5,
    "(f2) local desligado cobra local_delivery_fee, mesmo com nacional sempre",
  );
  const estrategiaSempre = {
    estrategia: "sempre",
    minimo: 0,
    tipoDesconto: null,
    valorDesconto: 0,
    alcance: "todas",
  };
  await gravarCotacao(cliente, {
    destino: "20000-000",
    optId: "frenet-f2",
    itens,
    price: 0,
    precoCheio: 25.0,
    estrategiaNacional: estrategiaSempre,
  });
  const rF2Nac = await chamarRpc(cliente, "create_marketplace_order_v24", {
    optId: "frenet-f2",
    destino: "20000-000",
    total: 50.0,
    pagamento: "online",
    itens,
  });
  const pedidoF2Nac = await lerPedido(cliente, rF2Nac.rows[0].id);
  assert.equal(pedidoF2Nac.shipping, 0, "(f2) nacional sempre sai 0");
  log(
    "PASS (f2) local desligado + nacional sempre: local cobra local_delivery_fee, nacional sai 0",
  );

  // Volta a um estado neutro.
  await cliente.query(
    "UPDATE public.store_config SET free_shipping_min = 0 WHERE id = 1",
  );
  await definirConfigNacional(cliente, {
    strategy: "desligado",
    min: 0,
    discountType: null,
    discountValue: 0,
    scope: "mais_barata",
  });

  // =======================================================================
  // (g) portões de CEP e o atalho free-shipping-promo.
  // =======================================================================
  // (g1) id nacional com CEP LOCAL -> recusa.
  await assertRejeitado(
    chamarRpc(cliente, "create_marketplace_order_v24", {
      optId: "frenet-g1",
      destino: "38500-040",
      total: 75.0,
      pagamento: "online",
      itens,
    }),
    /^Opção de entrega inválida\./,
    "(g1) id nacional com CEP local",
  );
  log("PASS (g1) id nacional com CEP local -> recusa");

  // (g2) id nacional sem CEP válido (garbage, vira '' depois do regexp) -> recusa.
  await assertRejeitado(
    chamarRpc(cliente, "create_marketplace_order_v24", {
      optId: "frenet-g2",
      destino: "abc-xyz",
      total: 75.0,
      pagamento: "online",
      itens,
    }),
    /^Opção de entrega inválida\./,
    "(g2) id nacional sem CEP",
  );
  log("PASS (g2) id nacional sem CEP -> recusa");

  // (g3) p_address_id de conta com CEP LOCAL salvo + p_address_data.cep
  // DISTANTE (cotação também distante, para não cair na reconciliação
  // 2-bis antes de chegar aqui) -> recusa "cotado para outro CEP".
  const enderecoLocalId = "cccccccc-0000-0000-0000-000000000001";
  await garantirEnderecoDaConta(cliente, {
    id: enderecoLocalId,
    userId: U_CLIENTE,
    cep: "38500-050",
  });
  await gravarCotacao(cliente, {
    destino: "20000-000",
    optId: "frenet-g3",
    itens,
    price: 20.0,
    estrategiaNacional: {
      estrategia: "desligado",
      minimo: 0,
      tipoDesconto: null,
      valorDesconto: 0,
      alcance: "mais_barata",
    },
  });
  await assertRejeitado(
    chamarRpc(cliente, "create_marketplace_order_v24", {
      optId: "frenet-g3",
      destino: "20000-000",
      total: 70.0,
      pagamento: "online",
      itens,
      addressId: enderecoLocalId,
      addressCep: "20000-000",
    }),
    /^O frete foi cotado para outro CEP\./,
    "(g3) endereço de conta local + address_data.cep distante",
  );
  log("PASS (g3) p_address_id local + p_address_data.cep distante -> recusa");

  // (g4) 'free-shipping-promo' com strategy != por_produto -> recusa.
  await definirConfigNacional(cliente, {
    strategy: "desligado",
    min: 0,
    discountType: null,
    discountValue: 0,
    scope: "mais_barata",
  });
  await assertRejeitado(
    chamarRpc(cliente, "create_marketplace_order_v24", {
      optId: "free-shipping-promo",
      destino: "20000-000",
      total: 50.0,
      pagamento: "online",
      itens: itensGratis,
    }),
    /^Opção de entrega inválida\./,
    "(g4) free-shipping-promo sem estratégia por_produto",
  );
  log("PASS (g4) free-shipping-promo com strategy != por_produto -> recusa");

  // (g5) 'free-shipping-promo' com por_produto + item marcado -> 0.
  await definirConfigNacional(cliente, {
    strategy: "por_produto",
    min: 0,
    discountType: null,
    discountValue: 0,
    scope: "todas",
  });
  const rG5 = await chamarRpc(cliente, "create_marketplace_order_v24", {
    optId: "free-shipping-promo",
    destino: "20000-000",
    total: 30.0,
    pagamento: "online",
    itens: itensGratis,
  });
  const pedidoG5 = await lerPedido(cliente, rG5.rows[0].id);
  assert.equal(
    pedidoG5.shipping,
    0,
    "(g5) free-shipping-promo com por_produto + item marcado -> 0",
  );
  log("PASS (g5) free-shipping-promo com por_produto + item marcado -> 0");

  // Volta a um estado neutro.
  await definirConfigNacional(cliente, {
    strategy: "desligado",
    min: 0,
    discountType: null,
    discountValue: 0,
    scope: "mais_barata",
  });

  // =======================================================================
  // (h) retirada/local intocados; v23 continua recusando transportadora.
  // =======================================================================
  const rH1 = await chamarRpc(cliente, "create_marketplace_order_v24", {
    optId: "store-pickup",
    destino: "38500-060",
    total: 50.0,
    pagamento: "pix",
    itens,
  });
  const pedidoH1 = await lerPedido(cliente, rH1.rows[0].id);
  assert.equal(pedidoH1.shipping, 0, "(h) store-pickup continua grátis");

  const rH2 = await chamarRpc(cliente, "create_marketplace_order_v24", {
    optId: "local-delivery",
    destino: "38500-061",
    total: 62.5,
    pagamento: "pix",
    itens,
  });
  const pedidoH2 = await lerPedido(cliente, rH2.rows[0].id);
  assert.equal(
    pedidoH2.shipping,
    12.5,
    "(h) local-delivery cobra a taxa configurada normalmente",
  );

  await assertRejeitado(
    chamarRpc(cliente, "create_marketplace_order_v23", {
      optId: "frenet-h3",
      destino: "20000-000",
      total: 75.0,
      pagamento: "cash",
      itens,
    }),
    /^Envio por transportadora exige pagamento antecipado\./,
    "(h) v23 continua recusando transportadora",
  );
  const rH4 = await chamarRpc(cliente, "create_marketplace_order_v23", {
    optId: "local-delivery",
    destino: "38500-062",
    total: 62.5,
    pagamento: "pix",
    itens,
  });
  const pedidoH4 = await lerPedido(cliente, rH4.rows[0].id);
  assert.equal(
    pedidoH4.shipping,
    12.5,
    "(h) v23 continua servindo local-delivery normalmente",
  );
  log(
    "PASS (h) retirada e local intocados; v23 continua recusando transportadora e servindo local-delivery",
  );
}

/**
 * (i): o rollback-manual da PRÓPRIA 20261171 -- hash EXATO de volta, view
 * sem as colunas, dado nacional preservado; reaplicar volta aos hashes
 * novos. Roda SÓ no container SEM --com-migration: o rollback-manual da
 * 20261171 restaura os corpos ORIGINAIS de v23/v24 (20261170) e a
 * REAPLICAÇÃO reaplica só a 20261171, sem saber de nenhuma migration
 * downstream -- rodar (i) no container COM extra faria a reaplicação
 * "perder" o que a extra tinha escrito, e a comparação de hash falharia por
 * um motivo que não é bug nenhum (é o contrato do próprio rollback-manual:
 * ele desfaz UMA migration, nunca as que vieram depois). Ver a decisão
 * registrada no relatório desta rodada.
 */
async function rodarCasoI(cliente, migrationSql) {
  // =======================================================================
  // (i) rollback-manual: hash EXATO de volta, view sem as colunas, dado
  // nacional preservado; reaplicar volta aos hashes novos.
  // =======================================================================
  const hashV23DepoisDoApply = await hashCorpo(
    cliente,
    "create_marketplace_order_v23",
  );
  const hashV24DepoisDoApply = await hashCorpo(
    cliente,
    "create_marketplace_order_v24",
  );
  const hashUpsertDepoisDoApply = await hashCorpo(
    cliente,
    "upsert_store_config",
  );
  // Deixa um valor de fantasia na configuração nacional, para provar que
  // o rollback NÃO apaga dado (não dropa colunas).
  await definirConfigNacional(cliente, {
    strategy: "acima_de_valor",
    min: 321.5,
    discountType: null,
    discountValue: 0,
    scope: "todas",
  });

  const rollbackSql = fs.readFileSync(
    path.join(MIGRATIONS_DIR, ROLLBACK),
    "utf8",
  );
  await cliente.query(rollbackSql);

  const hashV23PosRollback = await hashCorpo(
    cliente,
    "create_marketplace_order_v23",
  );
  const hashV24PosRollback = await hashCorpo(
    cliente,
    "create_marketplace_order_v24",
  );
  const hashUpsertPosRollback = await hashCorpo(cliente, "upsert_store_config");
  assert.equal(
    hashV23PosRollback,
    HASH_V23_ANTERIOR,
    "(i) rollback devolve o hash EXATO de v23 (20261170)",
  );
  assert.equal(
    hashV24PosRollback,
    HASH_V24_ANTERIOR,
    "(i) rollback devolve o hash EXATO de v24 (20261170)",
  );
  assert.equal(
    hashUpsertPosRollback,
    HASH_UPSERT_ANTERIOR,
    "(i) rollback devolve o hash EXATO de upsert_store_config (20261167)",
  );

  const colunasNaViewPosRollback = await colunasNacionaisNaView(cliente);
  assert.deepEqual(
    colunasNaViewPosRollback,
    [],
    "(i) a view volta a NÃO ter as colunas nacionais",
  );

  // A configuração nacional continua NA TABELA, intocada -- o rollback não
  // dropou coluna nenhuma.
  const configPosRollback = await lerConfigNacional(cliente);
  assert.equal(
    configPosRollback.strategy,
    "acima_de_valor",
    "(i) rollback NÃO apagou o dado nacional (coluna sobrevive)",
  );
  assert.equal(
    configPosRollback.min,
    321.5,
    "(i) rollback NÃO apagou o valor nacional",
  );
  log(
    "PASS (i) rollback devolve hashes EXATOS, tira as colunas da VIEW, e preserva a COLUNA (dado da lojista intacto)",
  );

  // Reaplicar devolve o corpo exato de antes, e reaplicar de novo é
  // idempotente.
  await cliente.query(migrationSql);
  assert.equal(
    await hashCorpo(cliente, "create_marketplace_order_v23"),
    hashV23DepoisDoApply,
    "(i) reaplicar devolve o hash exato de v23",
  );
  assert.equal(
    await hashCorpo(cliente, "create_marketplace_order_v24"),
    hashV24DepoisDoApply,
    "(i) reaplicar devolve o hash exato de v24",
  );
  assert.equal(
    await hashCorpo(cliente, "upsert_store_config"),
    hashUpsertDepoisDoApply,
    "(i) reaplicar devolve o hash exato de upsert_store_config",
  );
  const colunasNaViewPosReapply = await colunasNacionaisNaView(cliente);
  assert.equal(
    colunasNaViewPosReapply.length,
    5,
    "(i) a view volta a ter as 5 colunas nacionais",
  );
  const configPosReapply = await lerConfigNacional(cliente);
  assert.equal(
    configPosReapply.strategy,
    "acima_de_valor",
    "(i) reaplicar NÃO reescreveu o dado (coluna já existia)",
  );
  assert.equal(
    configPosReapply.min,
    321.5,
    "(i) reaplicar NÃO reescreveu o valor",
  );
  log(
    "PASS (i) reaplicar a migration depois do rollback volta ao hash exato e preserva o dado nacional",
  );

  await cliente.query(migrationSql); // idempotência: reaplicar de novo não muda nada
  assert.equal(
    await hashCorpo(cliente, "create_marketplace_order_v23"),
    hashV23DepoisDoApply,
  );
  log("PASS (i) migration reaplicada duas vezes seguidas é idempotente");
}

// ===========================================================================
// Casos conjuntos (j1)-(j3) -- SÓ rodam quando --com-migration foi passado.
// Provam que uma migration extra aplicada por cima (ex.: o CPF, 20261172,
// que reescreve o MESMO corpo de create_marketplace_order_v23/_v24) não
// apaga a regra nacional desta migration.
// ===========================================================================

async function rodarCasosConjuntos(cliente, rotulo, extras) {
  const itens = [{ productId: P_NORMAL, quantity: 1 }];

  // Prova do MECANISMO da própria flag --com-migration (não é um dos
  // casos numerados j1-j3, mas sustenta os três): se a extra aplicada é
  // a sintética deste ensaio, a função de marca que ela cria responde
  // com o valor esperado -- confirma que o TEXTO do arquivo passado
  // realmente rodou no banco por cima da raiz, e não foi só "aceito sem
  // efeito". Fica em silêncio quando a extra é outra (uma migration real
  // não define essa função).
  const marca = await cliente.query(
    "SELECT to_regprocedure('public._prova_ensaio_frete_migration_extra()') AS oid",
  );
  if (marca.rows[0].oid) {
    const r = await cliente.query(
      "SELECT public._prova_ensaio_frete_migration_extra() AS v",
    );
    assert.equal(
      r.rows[0].v,
      "marca-da-migration-extra-sintetica-23092026",
      "(mecanismo) a extra sintética respondeu com a marca esperada",
    );
    log(
      `PASS (mecanismo) [${rotulo}] a migration extra foi realmente aplicada por cima da raiz (função de marca respondeu)`,
    );
  }

  const textoExtras = extras
    .map((caminho) => fs.readFileSync(caminho, "utf8"))
    .join("\n");
  const temCpf = /cpf/i.test(textoExtras);
  // O plano (docs/superpowers/plans/2026-09-23-integracao-rpc-frete-nacional-e-cpf.md)
  // registra a INTENÇÃO: CPF viaja em p_address_data->>'cpf' (ou
  // equivalente). Sem essa marca no texto real da extra, não há como
  // saber por qual campo injetar o CPF no teste -- não é seguro supor.
  const usaAddressDataCpf =
    /p_address_data\s*->>?\s*'cpf'|address_data\s*->>?\s*'cpf'/i.test(
      textoExtras,
    );

  // =======================================================================
  // (j1) v24 nacional com desconto (price 21.16) + CPF.
  // =======================================================================
  if (!temCpf) {
    log(
      `SKIP (j1) [${rotulo}] nenhuma migration extra menciona 'cpf' -- não dá para saber por qual campo o CPF chegaria (a extra usada nesta rodada é sintética e não mexe com CPF).`,
    );
  } else if (!usaAddressDataCpf) {
    log(
      `SKIP (j1) [${rotulo}] a(s) migration(ões) extra mencionam 'cpf', mas não no padrão esperado (p_address_data->>'cpf' ou equivalente) -- não dá para saber por qual campo injetar o CPF no teste sem adivinhar.`,
    );
  } else {
    await definirConfigNacional(cliente, {
      strategy: "desconto_na_mais_barata",
      min: 0,
      discountType: "percentual",
      discountValue: 15,
      scope: "mais_barata",
    });
    const estrategiaJ1 = {
      estrategia: "desconto_na_mais_barata",
      minimo: 0,
      tipoDesconto: "percentual",
      valorDesconto: 15,
      alcance: "mais_barata",
    };
    await gravarCotacao(cliente, {
      destino: "20005-000",
      optId: "frenet-j1",
      itens,
      price: 21.16,
      precoCheio: 24.9,
      estrategiaNacional: estrategiaJ1,
    });
    const rJ1 = await chamarRpc(cliente, "create_marketplace_order_v24", {
      optId: "frenet-j1",
      destino: "20005-000",
      total: 71.16,
      pagamento: "online",
      itens,
      addressCep: "20005-000",
      cpf: "52998224725", // CPF válido para exercitar a verificação da 20261172
    });
    const pedidoJ1 = await lerPedido(cliente, rJ1.rows[0].id);
    assert.equal(
      pedidoJ1.shipping,
      21.16,
      "(j1) total inclui o frete com desconto (21.16)",
    );
    const rCustomerData = await cliente.query(
      "SELECT customer_data->>'cpf' AS cpf FROM public.marketplace_orders WHERE id = $1",
      [rJ1.rows[0].id],
    );
    const cpfGravado = rCustomerData.rows[0] ? rCustomerData.rows[0].cpf : null;
    assert.equal(
      cpfGravado,
      "52998224725",
      "(j1) customer_data.cpf preserva exatamente o CPF válido enviado",
    );
    log(
      `PASS (j1) [${rotulo}] v24 nacional com desconto + CPF: frete com desconto e CPF de 11 dígitos gravado`,
    );
  }

  // =======================================================================
  // (j2) chamada de 13 argumentos, sem CPF (app antigo) -- continua
  // criando pedido local normalmente.
  // =======================================================================
  const rJ2 = await chamarRpc(cliente, "create_marketplace_order_v24", {
    optId: "local-delivery",
    destino: "38500-070",
    total: 62.5,
    pagamento: "pix",
    itens,
  });
  const pedidoJ2 = await lerPedido(cliente, rJ2.rows[0].id);
  assert.equal(
    pedidoJ2.shipping,
    12.5,
    "(j2) chamada de 13 argumentos sem CPF continua criando pedido local normalmente",
  );
  log(
    `PASS (j2) [${rotulo}] chamada de 13 argumentos (app antigo, sem CPF) continua criando pedido local`,
  );

  // =======================================================================
  // (j3) a extra NÃO apagou a regra nacional: hash de v23/v24 não é mais
  // o da 20261170, e o corpo ainda contém 'estrategiaNacional'.
  // =======================================================================
  const hashV23Extra = await hashCorpo(cliente, "create_marketplace_order_v23");
  const hashV24Extra = await hashCorpo(cliente, "create_marketplace_order_v24");
  assert.notEqual(
    hashV23Extra,
    HASH_V23_ANTERIOR,
    "(j3) hash de v23 com a extra aplicada não é mais o da 20261170",
  );
  assert.notEqual(
    hashV24Extra,
    HASH_V24_ANTERIOR,
    "(j3) hash de v24 com a extra aplicada não é mais o da 20261170",
  );
  const corpoV23 = await lerCorpoFuncao(
    cliente,
    "create_marketplace_order_v23",
  );
  const corpoV24 = await lerCorpoFuncao(
    cliente,
    "create_marketplace_order_v24",
  );
  assert.match(
    corpoV23 || "",
    /estrategiaNacional/,
    "(j3) o corpo de v23 ainda contém a checagem do carimbo estrategiaNacional (a extra não apagou a regra nacional)",
  );
  assert.match(
    corpoV24 || "",
    /estrategiaNacional/,
    "(j3) o corpo de v24 ainda contém a checagem do carimbo estrategiaNacional",
  );
  log(
    `PASS (j3) [${rotulo}] hash de v23/v24 mudou (não é mais o da 20261170) e o corpo continua com a regra nacional (estrategiaNacional)`,
  );
}

/** Sobe um container, aplica a raiz inteira e (se `extras` não for vazio)
 * a(s) migration(ões) extra(s) por cima, roda a suíte (b)-(h), e (i) ou os
 * casos conjuntos (j1)-(j3), conforme o container tem extra ou não. */
async function prepararContainerCompleto(rotulo, extras) {
  const container = novoNomeContainer();
  const porta = await achaPortaLivre();
  const databaseUrl = `postgres://postgres:postgres@127.0.0.1:${porta}/postgres`;
  log(`[${rotulo}] subindo container ${container} na porta ${porta}`);
  rodar("docker", [
    "run",
    "-d",
    "--name",
    container,
    "-e",
    "POSTGRES_PASSWORD=postgres",
    "-e",
    "POSTGRES_DB=postgres",
    "-p",
    `${porta}:5432`,
    "postgres:17",
  ]);

  try {
    await esperarPostgresPronto(container);
    const env = { DATABASE_URL: databaseUrl, CI_BANCO_EFEMERO: "1" };
    rodarNode("tests/banco/provisionar.cjs", [], env);
    rodarNode(
      "tests/banco/aplicar-migrations.cjs",
      ["supabase/migrations"],
      env,
    );

    const cliente = new Client({ connectionString: databaseUrl });
    cliente.on("error", () => {});
    await cliente.connect();

    if (extras.length > 0) {
      for (const caminhoExtra of extras) {
        const nomeExtra = path.basename(caminhoExtra);
        const sqlExtra = fs.readFileSync(caminhoExtra, "utf8");
        log(
          `[${rotulo}] aplicando migration extra por cima da raiz -- ${nomeExtra}`,
        );
        // Mesmo mecanismo de tests/banco/aplicar-migrations.cjs: search_path
        // de fábrica antes de CADA arquivo, arquivo inteiro numa query só
        // (o Postgres embrulha o texto inteiro numa transação implícita).
        await cliente.query('SET search_path = "$user", public, extensions');
        await cliente.query(sqlExtra);
      }
      log(
        `[${rotulo}] ${extras.length} migration(ões) extra aplicada(s) por cima: ${extras.map((p) => path.basename(p)).join(", ")}`,
      );
    }

    await garantirProdutos(cliente);
    await garantirUsuario(cliente, U_CLIENTE);
    await logar(cliente, U_CLIENTE);
    await garantirLojaFixture(cliente, {
      freeShippingMin: 0,
      enabledShippingMethods: ["store-pickup"],
      storeAddress: "Rua da Loja, 123",
    });
    // A cópia legada (fsm=0) deixa a config nacional em 'desligado' -- o
    // "espelho" natural desta loja recém-migrada.
    const config = await lerConfigNacional(cliente);
    assert.equal(
      config.strategy,
      "desligado",
      `[${rotulo}] espelho inicial é desligado`,
    );

    const migrationSql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, MIGRATION),
      "utf8",
    );
    await rodarCasosBAteH(cliente, extras.length > 0 ? null : migrationSql);

    if (extras.length > 0) {
      await rodarCasosConjuntos(cliente, rotulo, extras);
    } else {
      await rodarCasoI(cliente, migrationSql);
    }

    await cliente.end();
    console.log(`\n[frete-estrategias] [${rotulo}] TODOS OS CASOS PASSARAM.`);
  } finally {
    log(`[${rotulo}] derrubando container ${container}`);
    spawnSync("docker", ["rm", "-f", container], { encoding: "utf8" });
  }
}

async function main() {
  const dockerVersion = spawnSync("docker", ["version"], { encoding: "utf8" });
  if (dockerVersion.status !== 0) {
    log(
      "Docker não disponível nesta máquina -- ensaio não pode rodar aqui. Escreva a migration como está e valide num ambiente com Docker.",
    );
    process.exitCode = 1;
    return;
  }

  // Item (a): 4 valores, 4 containers independentes -- cada um faz a
  // transição "até 20261170" -> "com 20261171" do zero, porque a cópia
  // legada só roda UMA vez por banco (guarda por information_schema).
  await casoPreservacao(0, false); // desligado
  await casoPreservacao(0.01, false); // sempre
  await casoPreservacao(-1, true); // por_produto (com item marcado, senão nunca zera)
  await casoPreservacao(150, false, true); // acima_de_valor (+ subtotal >= mínimo, MENOR da revisão T1)

  // ---- Container principal, sem --com-migration (sempre roda). ----
  await prepararContainerCompleto(
    "container principal, sem --com-migration",
    [],
  );

  // ---- Container extra, só se --com-migration foi passado. ----
  if (EXTRA_MIGRATIONS.length > 0) {
    await prepararContainerCompleto(
      "container com --com-migration",
      EXTRA_MIGRATIONS,
    );
  } else {
    log(
      "Nenhum --com-migration informado -- pulando o container extra (comportamento de hoje, sem mudança).",
    );
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
