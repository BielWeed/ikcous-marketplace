"use strict";
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename --
 * Toda chave indexada vem de constante do próprio teste; o único caminho de
 * arquivo é o do roteiro dentro do repositório. Nunca entrada de rede. */

/**
 * ENSAIO do roteiro de anonimização (docs/runbooks/atender-pedido-de-privacidade.md)
 * contra o Postgres EFÊMERO com as migrations aplicadas do zero.
 *
 * O SQL que roda aqui NÃO é uma cópia: é LIDO dos blocos ```sql do próprio
 * roteiro (`-- BLOCO: listar | anonimizar | sobras`). Se o roteiro mudar, o
 * ensaio muda junto; se o SQL do roteiro quebrar, esta prova cai.
 *
 * O QUE SE PROVA, com uma cliente de mentira (login, perfil, endereço, favorito,
 * carrinho, aviso, push, 3 pedidos com a forma REAL de customer_data, código de
 * verificação, devolução com foto, evento de navegação, avaliação com resposta
 * da loja que cita o nome dela) e uma vizinha que NÃO pode ser tocada:
 *   (a) o ensaio (v_confirmar := false) para com erro "ENSAIO", lista as
 *       contagens e NÃO grava nada;
 *   (b) valendo: perfil, endereços, favoritos, carrinho, avisos, push, códigos e
 *       texto livre dos pedidos somem ou perdem os dados pessoais; os pedidos
 *       CONTINUAM existindo, com os mesmos valores, itens e datas; o login NÃO
 *       é apagado: fica bloqueado, com e-mail sem identidade e sem dados de
 *       cadastro; a vizinha fica intacta; a linha do pedido de privacidade não
 *       muda;
 *   (c) varredura INDEPENDENTE (texto de cada linha de cada tabela de public e
 *       auth): depois da anonimização não sobra nome, e-mail, telefone nem CPF
 *       da cliente, exceto o que o roteiro manda caçar à mão (resposta da loja);
 *   (d) a "busca de sobras" do passo 6 acha essa resposta da loja (e, antes de
 *       anonimizar, acha os dados nos lugares certos);
 *   (e) as travas: pedido em andamento, devolução em andamento, foto ainda no
 *       Storage, sem pedido de exclusão aberto, cliente inexistente e
 *       identificador não trocado recusam — e nada muda;
 *   (f) o bloco "listar" só lê e devolve as contagens certas (e mostra o endereço
 *       em claro, para o passo 6 poder caçá-lo);
 *   (g) MUTANTES: com o roteiro inteiro nada sobra; tirando UM passo (registro de
 *       atividade do login, códigos de uso único, verificação em duas etapas,
 *       troca de e-mail/telefone pendente, IP, lista de permitidos do pedido) a
 *       varredura acha dado dela — a prova cai.
 *
 * Esquema `auth` do Supabase coberto: users (troca pendente e códigos),
 * identities, sessions, audit_log_entries (IP e payload), one_time_tokens e
 * mfa_factors, com as colunas reais do GoTrue. Pedido antigo com chave de
 * endereço de nome inesperado prova a lista de permitidos do `customer_data`.
 *
 * LIMITE HONESTO: o esquema `auth` aqui é uma emulação (as colunas e tabelas que
 * o roteiro toca são criadas por esta prova, com os nomes e tipos do Supabase).
 * O que só o Supabase real prova está marcado [CONFERIR EM LOJA DE TESTE] no
 * roteiro.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/anonimizar-conta-ensaio-viva.cjs
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const ROTEIRO = path.join(
  __dirname,
  "..",
  "..",
  "docs",
  "runbooks",
  "atender-pedido-de-privacidade.md",
);

const ALVO = "9b1c0000-0000-4000-8000-000000000001";
const VIZINHA = "9b1c0000-0000-4000-8000-000000000002";
const EMAIL_ALVO = "maria.alvo@exemplo.com";
const NOME_ALVO = "Maria Souza Teste";
const FONE_ALVO_FORMATADO = "(11) 91234-5678";
const FONE_ALVO_DIGITOS = "11912345678";
const CPF_ALVO = "12345678909";
const CPF_ALVO_FORMATADO = "123.456.789-09";
const NOVO_EMAIL = `excluido+${ALVO}@invalid.local`;
// Um administrador da loja (só aparece como autor de linhas do registro de atividade).
const ADMIN = "9b1c0000-0000-4000-8000-0000000000ad";
const EMAIL_TROCA = "maria.alvo.nova@exemplo.com";
const FONE_TROCA = "+5511988887777";
// Endereço dela (rua, complemento, bairro, CEP) — distinto do da vizinha e do da loja.
const RUA_ALVO = "Rua das Flores";
const COMPLEMENTO_ALVO = "apto 4";
const BAIRRO_ALVO = "Jardim Alvo";
const CEP_ALVO = "02002000";
const ENDERECO_ALVO = [RUA_ALVO, COMPLEMENTO_ALVO, BAIRRO_ALVO];
// O que o roteiro deixa passar do retrato do pedido (customer_data).
const CHAVES_PERMITIDAS = ["canal", "pickup_address", "shipping_option_id"];

// ---------------------------------------------------------------------------
// Os blocos SQL, lidos do roteiro.
// ---------------------------------------------------------------------------
function lerBlocos() {
  const md = fs.readFileSync(ROTEIRO, "utf8");
  const blocos = {};
  for (const m of md.matchAll(/```sql\n-- BLOCO: (\w+)\n([\s\S]*?)```/g)) {
    blocos[m[1]] = m[2];
  }
  for (const nome of ["listar", "anonimizar", "sobras"]) {
    assert.ok(blocos[nome], `o roteiro não tem o bloco SQL "${nome}"`);
    assert.ok(
      blocos[nome].includes("COLE-O-ID-AQUI") || nome === "sobras",
      `o bloco "${nome}" perdeu o marcador COLE-O-ID-AQUI`,
    );
  }
  return blocos;
}
const BLOCOS = lerBlocos();

const comId = (sql, id) => sql.replaceAll("COLE-O-ID-AQUI", id);
function anonimizar(id, valendo) {
  const sql = comId(BLOCOS.anonimizar, id);
  assert.strictEqual(
    sql.split("v_confirmar boolean := false;").length,
    2,
    "o bloco anonimizar tem de trazer v_confirmar := false uma única vez",
  );
  return valendo
    ? sql.replace(
        "v_confirmar boolean := false;",
        "v_confirmar boolean := true;",
      )
    : sql;
}
function sobras(nome, email, fone, cpf, endereco = [], cep = "") {
  const q = (s) => `'${s.replaceAll("'", "''")}'`;
  const lista = endereco.length
    ? `ARRAY[${endereco.map(q).join(", ")}]`
    : "ARRAY[]::text[]";
  const sql = BLOCOS.sobras.replace(
    /SELECT \* FROM pg_temp\.sobras\([^;]*\);/,
    `SELECT * FROM pg_temp.sobras(${q(nome)}, ${q(email)}, ${q(fone)}, ${q(cpf)}, ${lista}, ${q(cep)});`,
  );
  assert.ok(
    sql.includes(q(nome)),
    "não consegui trocar os valores na chamada de sobras do roteiro",
  );
  return sql;
}

// ---------------------------------------------------------------------------
// Emulação do esquema auth do Supabase (só o que o roteiro toca).
// ---------------------------------------------------------------------------
async function emularAuth(c) {
  await c.query(`
    ALTER TABLE auth.users
      ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS banned_until timestamptz,
      ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now()
  `);
  await c.query(`
    CREATE TABLE IF NOT EXISTS auth.identities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users (id),
      provider text NOT NULL,
      provider_id text NOT NULL,
      identity_data jsonb NOT NULL,
      email text GENERATED ALWAYS AS (lower(identity_data ->> 'email')) STORED,
      UNIQUE (provider_id, provider)
    )
  `);
  await c.query(`
    CREATE TABLE IF NOT EXISTS auth.sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users (id)
    )
  `);
  // Troca pendente e códigos do login (colunas reais de auth.users do GoTrue; aqui
  // NOT NULL DEFAULT '' = o caso mais estrito, que obriga o roteiro a usar '' e não NULL).
  await c.query(`
    ALTER TABLE auth.users
      ADD COLUMN IF NOT EXISTS email_change text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS phone_change text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS confirmation_token text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS recovery_token text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS email_change_token_new text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS email_change_token_current text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS phone_change_token text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS reauthentication_token text NOT NULL DEFAULT ''
  `);
  // Registro de atividade do GoTrue: payload json + ip_address varchar(64) NOT NULL.
  await c.query(`
    CREATE TABLE IF NOT EXISTS auth.audit_log_entries (
      instance_id uuid,
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      payload json,
      created_at timestamptz DEFAULT now(),
      ip_address varchar(64) NOT NULL DEFAULT ''
    )
  `);
  await c.query(`
    CREATE TABLE IF NOT EXISTS auth.one_time_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
      token_type text NOT NULL,
      token_hash text NOT NULL,
      relates_to text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await c.query(`
    CREATE TABLE IF NOT EXISTS auth.mfa_factors (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
      friendly_name text,
      factor_type text NOT NULL,
      status text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      secret text,
      phone text
    )
  `);
}

// ---------------------------------------------------------------------------
// A cliente de mentira (e a vizinha), dentro da transação da prova.
// ---------------------------------------------------------------------------
const DATA_DO_PEDIDO = {
  whatsapp: FONE_ALVO_DIGITOS,
  address_id: null,
  address: {
    name: "Casa",
    street: RUA_ALVO,
    number: "123",
    complement: COMPLEMENTO_ALVO,
    neighborhood: BAIRRO_ALVO,
    city: "São Paulo",
    state: "SP",
    cep: CEP_ALVO,
    reference: "perto da padaria",
    cpf: CPF_ALVO,
  },
  shipping_option_id: "sedex",
  destination_cep: CEP_ALVO,
  // Chaves de endereço com nomes que NENHUM roteiro previu (pedido antigo de outra
  // versão do app): só a lista de permitidos as pega.
  entrega_antiga: { logradouro: "Travessa Nova 77", obs: "portão dos fundos" },
  endereco_cobranca: `${RUA_ALVO} 123, ${BAIRRO_ALVO}`,
};

async function semear(c) {
  await c.query(
    `INSERT INTO auth.users (id, email, phone, raw_user_meta_data) VALUES
       ($1, $3, '+5511912345678', $4::jsonb),
       ($2, 'vizinha@exemplo.com', '+5521999990000',
        '{"full_name":"Vizinha Silva","phone":"(21) 99999-0000"}'::jsonb)`,
    [
      ALVO,
      VIZINHA,
      EMAIL_ALVO,
      JSON.stringify({ full_name: NOME_ALVO, phone: FONE_ALVO_FORMATADO }),
    ],
  );
  await c.query(
    `INSERT INTO auth.identities (user_id, provider, provider_id, identity_data) VALUES
       (($1::text)::uuid, 'email', $3::text, jsonb_build_object('sub', $1::text, 'email', $3::text, 'email_verified', true)),
       (($1::text)::uuid, 'google', 'google-sub-123', jsonb_build_object('sub', 'google-sub-123', 'email', $3::text, 'name', $4::text, 'picture', 'https://lh3/foto.jpg')),
       (($2::text)::uuid, 'email', 'vizinha@exemplo.com', jsonb_build_object('sub', $2::text, 'email', 'vizinha@exemplo.com'))`,
    [ALVO, VIZINHA, EMAIL_ALVO, NOME_ALVO],
  );
  await c.query("INSERT INTO auth.sessions (user_id) VALUES ($1), ($1), ($2)", [
    ALVO,
    VIZINHA,
  ]);
  await c.query(
    `INSERT INTO public.profiles (id, full_name, whatsapp, cpf, avatar_url, cover_url, role) VALUES
       ($1, $3, $4, $5, 'https://cdn/avatar-maria.png', 'https://cdn/capa-maria.png', 'customer'),
       ($2, 'Vizinha Silva', '(21) 99999-0000', '98765432100', 'https://cdn/avatar-viz.png', NULL, 'customer')`,
    [ALVO, VIZINHA, NOME_ALVO, FONE_ALVO_FORMATADO, CPF_ALVO],
  );
  for (const uid of [ALVO, VIZINHA]) {
    await c.query(
      `INSERT INTO public.user_addresses (user_id, name, recipient_name, cep, street, number, complement, neighborhood, city, state)
       VALUES ($1, 'Casa', $2, $3, $4, '123', $5, $6, 'São Paulo', 'SP')`,
      uid === ALVO
        ? [uid, NOME_ALVO, CEP_ALVO, RUA_ALVO, COMPLEMENTO_ALVO, BAIRRO_ALVO]
        : [
            uid,
            "Vizinha Silva",
            "01001000",
            "Rua da Vizinha",
            null,
            "Vila Vizinha",
          ],
    );
    await c.query(
      `INSERT INTO public.favorites (user_id, product_id) VALUES ($1, 'prod-1'), ($1, 'prod-2')`,
      [uid],
    );
    await c.query(
      `INSERT INTO public.cart_items (user_id, product_id) VALUES ($1, 'prod-1')`,
      [uid],
    );
    await c.query(
      `INSERT INTO public.notificacoes (usuario_id, titulo, mensagem) VALUES ($1, 'Pedido enviado', $2)`,
      [uid, uid === ALVO ? `Olá ${NOME_ALVO}, seu pedido saiu` : "Olá Vizinha"],
    );
    await c.query(
      `INSERT INTO public.push_subscriptions (user_id, endpoint, auth, p256dh) VALUES ($1, $2, 'a', 'p')`,
      [uid, `https://push.exemplo/${uid}`],
    );
    await c.query(
      `INSERT INTO public.analytics_events (event_type, user_id) VALUES ('view', $1)`,
      [uid],
    );
  }
  // Pedidos: 2 da cliente (entregue e cancelado) com a forma real do customer_data
  // + 1 da vizinha.
  const pedido = async (
    id,
    uid,
    nome,
    fone,
    status,
    dados,
    notes,
    observation,
  ) =>
    c.query(
      `INSERT INTO public.marketplace_orders
         (id, user_id, customer_name, customer_phone, customer_data, status, total, subtotal, shipping, payment_method, tracking_code, notes, observation)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, 110, 100, 10, 'pix', 'BR123456789', $7, $8)`,
      [id, uid, nome, fone, JSON.stringify(dados), status, notes, observation],
    );
  await pedido(
    "9b1caaaa-0000-4000-8000-000000000001",
    ALVO,
    NOME_ALVO,
    FONE_ALVO_DIGITOS,
    "delivered",
    DATA_DO_PEDIDO,
    `Entregar ao porteiro, falar com ${NOME_ALVO}`,
    null,
  );
  await pedido(
    "9b1caaaa-0000-4000-8000-000000000002",
    ALVO,
    NOME_ALVO,
    FONE_ALVO_FORMATADO,
    "cancelled",
    {
      ...DATA_DO_PEDIDO,
      shipping_option_id: "store-pickup",
      pickup_address: "Av. da Loja, 10 - Industrial",
      canal: "balcao",
      email: EMAIL_ALVO,
      cpf: CPF_ALVO_FORMATADO,
    },
    null,
    "mudei de ideia",
  );
  await pedido(
    "9b1caaaa-0000-4000-8000-0000000000aa",
    VIZINHA,
    "Vizinha Silva",
    "21999990000",
    "delivered",
    {
      whatsapp: "21999990000",
      address: { street: "Rua da Vizinha", number: "9" },
    },
    "deixar na portaria",
    null,
  );
  // Anotação interna da lojista (20261247): texto livre que cita a cliente. Duas dela, uma da vizinha.
  await c.query(
    `INSERT INTO public.marketplace_order_internal_notes (order_id, note) VALUES
       ('9b1caaaa-0000-4000-8000-000000000001', $1),
       ('9b1caaaa-0000-4000-8000-000000000002', $2),
       ('9b1caaaa-0000-4000-8000-0000000000aa', 'Vizinha pagou no balcao, sem pendencia')`,
    [
      `${NOME_ALVO} pediu para ligar no ${FONE_ALVO_FORMATADO} antes de entregar`,
      `${NOME_ALVO} desistiu; devolver o sinal`,
    ],
  );
  await c.query(
    `INSERT INTO public.otp_verifications (email, whatsapp, otp_code, expires_at, order_id) VALUES
       ($1, $2, '123456', now() + interval '1 hour', '9b1caaaa-0000-4000-8000-000000000001'),
       ('vizinha@exemplo.com', '21999990000', '654321', now() + interval '1 hour', '9b1caaaa-0000-4000-8000-0000000000aa')`,
    [EMAIL_ALVO, FONE_ALVO_DIGITOS],
  );
  await c.query(
    `INSERT INTO public.devolucoes
       (id, protocolo, order_id, user_id, tipo, motivo, detalhe, resolucao_desejada, modalidade, metodo_retorno, status, valor_itens, fotos, prazo_ate, politica)
     VALUES ('9b1cdddd-0000-4000-8000-000000000001', 'DEV-TESTE-1', '9b1caaaa-0000-4000-8000-000000000001', $1,
             'vicio', 'defeito', $2, 'reembolso', 'nacional', 'envio_proprio', 'concluida', 100,
             ARRAY[$3::text], current_date + 30, '{}'::jsonb)`,
    [
      ALVO,
      `Chegou quebrado. Meu telefone é ${FONE_ALVO_FORMATADO}`,
      `${ALVO}/foto1.jpg`,
    ],
  );
  await c.query(
    `INSERT INTO storage.objects (bucket_id, name) VALUES ('devolucoes', $1)`,
    [`${ALVO}/foto1.jpg`],
  );
  await c.query(
    `INSERT INTO public.pedidos_de_privacidade (user_id, tipo) VALUES ($1, 'excluir_conta')`,
    [ALVO],
  );
  await semearLogin(c);
}

// O que o Supabase guarda do LOGIN dela fora do que o app conhece: pedido pendente
// de troca de e-mail/telefone, códigos em andamento, códigos de uso único,
// verificação em duas etapas e o registro de atividade (com IP).
const IP_DELA = "203.0.113.7";
const IP_DO_ADMIN = "198.51.100.9";
const IP_DA_VIZINHA = "192.0.2.55";
async function semearLogin(c) {
  await c.query(
    `UPDATE auth.users SET email_change = $2, phone_change = $3,
            confirmation_token = 'conf-tok', recovery_token = 'rec-tok',
            email_change_token_new = 'ecn-tok', email_change_token_current = 'ecc-tok',
            phone_change_token = 'pct-tok', reauthentication_token = 'rea-tok'
      WHERE id = $1`,
    [ALVO, EMAIL_TROCA, FONE_TROCA],
  );
  await c.query(
    `UPDATE auth.users SET email_change = 'vizinha.nova@exemplo.com', phone_change = '+5521911112222',
            recovery_token = 'rec-viz'
      WHERE id = $1`,
    [VIZINHA],
  );
  await c.query(
    `INSERT INTO auth.one_time_tokens (user_id, token_type, token_hash, relates_to) VALUES
       ($1, 'recovery_token', 'hash1', $3),
       ($1, 'phone_change_token', 'hash2', $4),
       ($2, 'recovery_token', 'hash3', 'vizinha@exemplo.com')`,
    [ALVO, VIZINHA, EMAIL_ALVO, "5511988887777"],
  );
  await c.query(
    `INSERT INTO auth.mfa_factors (user_id, friendly_name, factor_type, status, phone) VALUES
       ($1, 'Celular da Maria', 'phone', 'verified', '+5511912345678'),
       ($2, 'Celular da Vizinha', 'phone', 'verified', '+5521999990000')`,
    [ALVO, VIZINHA],
  );
  const linha = (payload, ip) =>
    c.query(
      "INSERT INTO auth.audit_log_entries (payload, ip_address) VALUES ($1::json, $2)",
      [JSON.stringify(payload), ip],
    );
  // (1) o que ELA fez: nome, e-mail, telefone e IP dela.
  await linha(
    {
      actor_id: ALVO,
      actor_via_sso: false,
      actor_username: EMAIL_ALVO,
      actor_name: NOME_ALVO,
      action: "login",
      log_type: "account",
      traits: {
        provider: "email",
        user_email: EMAIL_ALVO,
        user_phone: "+5511912345678",
      },
    },
    IP_DELA,
  );
  // (2) o que um ADMIN fez no cadastro dela: o IP e o nome são do admin; o e-mail e o
  // telefone dentro de traits são DELA.
  await linha(
    {
      actor_id: ADMIN,
      actor_via_sso: false,
      actor_username: "admin@loja.com",
      action: "user_modified",
      log_type: "user",
      traits: {
        user_id: ALVO,
        user_email: EMAIL_ALVO,
        user_phone: "5511912345678",
      },
    },
    IP_DO_ADMIN,
  );
  // (3) e (4): a vizinha, que NÃO pode ser tocada.
  await linha(
    {
      actor_id: VIZINHA,
      actor_via_sso: false,
      actor_username: "vizinha@exemplo.com",
      actor_name: "Vizinha Silva",
      action: "login",
      log_type: "account",
      traits: { provider: "email", user_email: "vizinha@exemplo.com" },
    },
    IP_DA_VIZINHA,
  );
  await linha(
    {
      actor_id: ADMIN,
      actor_username: "admin@loja.com",
      action: "user_modified",
      log_type: "user",
      traits: { user_id: VIZINHA, user_email: "vizinha@exemplo.com" },
    },
    IP_DO_ADMIN,
  );
}

/** A foto some do Storage (passo 3 do roteiro, feito à mão no site). */
const apagarFotosDoStorage = (c) =>
  c.query(`DELETE FROM storage.objects WHERE split_part(name, '/', 1) = $1`, [
    ALVO,
  ]);

// Texto de cada linha de cada tabela: varredura independente da do roteiro.
async function varrer(c, padroes) {
  const tabelas = await c.query(
    `SELECT table_schema AS s, table_name AS t FROM information_schema.tables
      WHERE table_type = 'BASE TABLE' AND table_schema IN ('public', 'auth')
        AND NOT (table_schema = 'public' AND table_name = 'pedidos_de_privacidade')`,
  );
  const achados = [];
  for (const { s, t } of tabelas.rows) {
    const r = await c.query(
      `SELECT count(*)::int AS n FROM ${s}."${t}" x WHERE x::text ILIKE ANY ($1)`,
      [padroes],
    );
    if (r.rows[0].n > 0) achados.push(`${s}.${t} (${r.rows[0].n})`);
  }
  return achados.sort();
}
const PADROES_DA_CLIENTE = [
  `%${NOME_ALVO}%`,
  "%maria.alvo%",
  "%91234-5678%",
  "%912345678%",
  `%${CPF_ALVO}%`,
  `%${CPF_ALVO_FORMATADO}%`,
  // troca pendente, telefone da troca e nome do segundo fator
  "%88887777%",
  "%Celular da Maria%",
  // endereço dela, inclusive o que mora em chave de nome inesperado
  `%${RUA_ALVO}%`,
  `%${COMPLEMENTO_ALVO}%`,
  `%${BAIRRO_ALVO}%`,
  "%Travessa Nova%",
  `%${CEP_ALVO}%`,
  "%02002-000%",
];

async function emTransacao(c, fn) {
  await c.query("BEGIN");
  try {
    await semear(c);
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}

async function tentar(c, sql) {
  await c.query("SAVEPOINT tentativa");
  try {
    const r = await c.query(sql);
    await c.query("RELEASE SAVEPOINT tentativa");
    return { ok: true, r };
  } catch (erro) {
    await c.query("ROLLBACK TO SAVEPOINT tentativa");
    return { ok: false, mensagem: erro.message };
  }
}

const um = async (c, sql, params = []) => (await c.query(sql, params)).rows[0];

// ---------------------------------------------------------------------------
const PROVAS = [];

PROVAS.push({
  nome: "(0) o roteiro tem os blocos listar/anonimizar/sobras e a emulação do auth sobe",
  corpo: async (c) => {
    await emularAuth(c);
    const cols = await c.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users'`,
    );
    for (const col of [
      "raw_user_meta_data",
      "banned_until",
      "updated_at",
      "email_change",
      "phone_change",
      "confirmation_token",
      "recovery_token",
      "email_change_token_new",
      "email_change_token_current",
      "phone_change_token",
      "reauthentication_token",
    ]) {
      assert.ok(
        cols.rows.some((r) => r.column_name === col),
        `auth.users sem ${col}`,
      );
    }
    const tabelas = await c.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'auth'`,
    );
    for (const t of [
      "audit_log_entries",
      "one_time_tokens",
      "mfa_factors",
      "identities",
      "sessions",
    ]) {
      assert.ok(
        tabelas.rows.some((r) => r.table_name === t),
        `a cópia de teste não tem auth.${t}`,
      );
    }
  },
});

PROVAS.push({
  nome: "(f) 'listar' só lê e devolve as contagens certas",
  corpo: async (c) => {
    await emTransacao(c, async () => {
      const antes = await um(
        c,
        "SELECT count(*)::int AS n FROM public.profiles",
      );
      const r = await c.query(comId(BLOCOS.listar, ALVO));
      const v = Object.fromEntries(r.rows.map((x) => [x.o_que, x.valor]));
      assert.strictEqual(v["e-mail de entrada"], EMAIL_ALVO);
      assert.strictEqual(v.nome, NOME_ALVO);
      assert.strictEqual(v.cpf, CPF_ALVO);
      assert.strictEqual(v.endereços, "1");
      // o endereço aparece em claro: o passo 6 precisa dele para caçar o que sobrar
      assert.strictEqual(v["endereço: rua"], RUA_ALVO);
      assert.strictEqual(v["endereço: complemento"], COMPLEMENTO_ALVO);
      assert.strictEqual(v["endereço: bairro"], BAIRRO_ALVO);
      assert.strictEqual(v["endereço: CEP"], CEP_ALVO);
      assert.strictEqual(v["troca de e-mail pendente"], EMAIL_TROCA);
      assert.strictEqual(v["troca de telefone pendente"], FONE_TROCA);
      assert.strictEqual(v.favoritos, "2");
      assert.strictEqual(v["pedidos (todos)"], "2");
      assert.strictEqual(v["pedidos EM ANDAMENTO"], "0");
      assert.strictEqual(v["devoluções EM ANDAMENTO"], "0");
      assert.strictEqual(v["fotos de devolução guardadas"], "1");
      const depois = await um(
        c,
        "SELECT count(*)::int AS n FROM public.profiles",
      );
      assert.strictEqual(antes.n, depois.n);
      // Marcador não trocado: erro de formato, nada acontece.
      const crua = await tentar(c, BLOCOS.listar);
      assert.ok(
        !crua.ok && /uuid/i.test(crua.mensagem),
        "COLE-O-ID-AQUI devia dar erro",
      );
    });
  },
});

PROVAS.push({
  nome: "(e) as travas recusam e nada muda: sem pedido aberto, cliente inexistente, marcador não trocado, pedido/devolução em andamento, foto no Storage",
  corpo: async (c) => {
    await emTransacao(c, async () => {
      await apagarFotosDoStorage(c);
      const estado = async () =>
        JSON.stringify([
          (
            await um(c, "SELECT full_name FROM public.profiles WHERE id = $1", [
              ALVO,
            ])
          ).full_name,
          (await um(c, "SELECT email FROM auth.users WHERE id = $1", [ALVO]))
            .email,
          (
            await um(
              c,
              "SELECT count(*)::int n FROM public.user_addresses WHERE user_id = $1",
              [ALVO],
            )
          ).n,
        ]);
      const antes = await estado();
      const recusa = async (sql, esperado, rotulo) => {
        const r = await tentar(c, sql);
        assert.ok(!r.ok, `${rotulo}: devia recusar`);
        assert.match(r.mensagem, esperado, rotulo);
        assert.strictEqual(await estado(), antes, `${rotulo}: algo mudou`);
      };
      // marcador não trocado
      await recusa(BLOCOS.anonimizar, /uuid/i, "marcador");
      // cliente inexistente (e sem pedido aberto)
      await recusa(
        anonimizar("9b1c0000-0000-4000-8000-0000000000ff", true),
        /PARADO.*EXCLUSÃO aberto/,
        "sem pedido aberto",
      );
      // pedido em andamento
      await c.query(
        "UPDATE public.marketplace_orders SET status = 'processing' WHERE id = '9b1caaaa-0000-4000-8000-000000000002'",
      );
      await recusa(
        anonimizar(ALVO, true),
        /pedido EM ANDAMENTO/,
        "pedido em andamento",
      );
      await c.query(
        "UPDATE public.marketplace_orders SET status = 'cancelled' WHERE id = '9b1caaaa-0000-4000-8000-000000000002'",
      );
      // pedido pendente com pagamento aguardando conta como em andamento; expirado não
      await c.query(
        "UPDATE public.marketplace_orders SET status = 'pending', payment_status = 'aguardando' WHERE id = '9b1caaaa-0000-4000-8000-000000000002'",
      );
      await recusa(
        anonimizar(ALVO, true),
        /pedido EM ANDAMENTO/,
        "pendente aguardando",
      );
      await c.query(
        "UPDATE public.marketplace_orders SET status = 'cancelled', payment_status = 'expirado' WHERE id = '9b1caaaa-0000-4000-8000-000000000002'",
      );
      // devolução em andamento
      await c.query(
        "UPDATE public.devolucoes SET status = 'solicitada' WHERE id = '9b1cdddd-0000-4000-8000-000000000001'",
      );
      await recusa(
        anonimizar(ALVO, true),
        /DEVOLUÇÃO em andamento/,
        "devolução em andamento",
      );
      await c.query(
        "UPDATE public.devolucoes SET status = 'concluida' WHERE id = '9b1cdddd-0000-4000-8000-000000000001'",
      );
      // foto ainda no Storage
      await c.query(
        "INSERT INTO storage.objects (bucket_id, name) VALUES ('devolucoes', $1)",
        [`${ALVO}/foto2.jpg`],
      );
      await recusa(
        anonimizar(ALVO, true),
        /fotos de devolução/,
        "foto no Storage",
      );
    });
  },
});

PROVAS.push({
  nome: "(a) o ENSAIO para com erro, lista as contagens e NÃO grava nada",
  corpo: async (c) => {
    await emTransacao(c, async () => {
      await apagarFotosDoStorage(c);
      const foto = async () =>
        JSON.stringify(
          await c
            .query(
              `SELECT (SELECT full_name FROM public.profiles WHERE id = $1) a,
                (SELECT email FROM auth.users WHERE id = $1) b,
                (SELECT count(*) FROM public.user_addresses WHERE user_id = $1) c,
                (SELECT count(*) FROM public.otp_verifications) d,
                (SELECT count(*) FROM auth.sessions WHERE user_id = $1) e,
                (SELECT banned_until FROM auth.users WHERE id = $1) f,
                (SELECT customer_name FROM public.marketplace_orders WHERE id = '9b1caaaa-0000-4000-8000-000000000001') g,
                (SELECT customer_data FROM public.marketplace_orders WHERE id = '9b1caaaa-0000-4000-8000-000000000001') h,
                (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.ip_address, a.payload::text) FROM auth.audit_log_entries a) i,
                (SELECT count(*) FROM auth.one_time_tokens) j,
                (SELECT count(*) FROM auth.mfa_factors) k,
                (SELECT jsonb_agg(to_jsonb(u) ORDER BY u.id) FROM auth.users u) l`,
              [ALVO],
            )
            .then((r) => r.rows[0]),
        );
      const antes = await foto();
      const r = await tentar(c, anonimizar(ALVO, false));
      assert.ok(!r.ok, "o ensaio devia terminar em erro");
      assert.match(r.mensagem, /^ENSAIO \(nada foi gravado\)/);
      assert.match(
        r.mensagem,
        /pedidos anonimizados \(continuam existindo\): 2/,
      );
      assert.match(r.mensagem, /anotações internas dos pedidos apagadas: 2/);
      assert.strictEqual(
        (
          await um(
            c,
            "SELECT count(*)::int n FROM public.marketplace_order_internal_notes",
          )
        ).n,
        3,
        "o ensaio apagou anotação interna",
      );
      assert.match(r.mensagem, /endereços apagados: 1/);
      assert.match(r.mensagem, /sessões abertas encerradas: 2/);
      assert.match(
        r.mensagem,
        /códigos de troca\/recuperação do login apagados: 2/,
      );
      assert.match(r.mensagem, /verificações em duas etapas.*apagadas: 1/);
      assert.match(
        r.mensagem,
        /registro de atividade dela, sem IP e sem dados pessoais: 1/,
      );
      assert.match(
        r.mensagem,
        /registro de atividade de administrador sobre ela.*: 1/,
      );
      assert.strictEqual(await foto(), antes, "o ensaio gravou");
    });
  },
});

PROVAS.push({
  nome: "(b) valendo: dados pessoais saem, pedidos ficam com valores e itens, login bloqueado e NÃO apagado, vizinha e pedido de privacidade intocados",
  corpo: async (c) => {
    await emTransacao(c, async () => {
      await apagarFotosDoStorage(c);
      const vizinhaAntes = JSON.stringify([
        (
          await c.query("SELECT * FROM public.profiles WHERE id = $1", [
            VIZINHA,
          ])
        ).rows,
        (await c.query("SELECT * FROM auth.users WHERE id = $1", [VIZINHA]))
          .rows,
        (
          await c.query("SELECT * FROM auth.identities WHERE user_id = $1", [
            VIZINHA,
          ])
        ).rows,
        (
          await c.query(
            "SELECT count(*)::int n FROM auth.sessions WHERE user_id = $1",
            [VIZINHA],
          )
        ).rows,
        (
          await c.query(
            "SELECT * FROM public.marketplace_orders WHERE user_id = $1",
            [VIZINHA],
          )
        ).rows,
        (
          await c.query(
            "SELECT count(*)::int n FROM public.otp_verifications WHERE email = 'vizinha@exemplo.com'",
          )
        ).rows,
        (
          await c.query(
            "SELECT count(*)::int n FROM public.user_addresses WHERE user_id = $1",
            [VIZINHA],
          )
        ).rows,
        (
          await c.query(
            "SELECT count(*)::int n FROM public.favorites WHERE user_id = $1",
            [VIZINHA],
          )
        ).rows,
        (
          await c.query(
            "SELECT count(*)::int n FROM public.notificacoes WHERE usuario_id = $1",
            [VIZINHA],
          )
        ).rows,
        (
          await c.query(
            "SELECT count(*)::int n FROM public.push_subscriptions WHERE user_id = $1",
            [VIZINHA],
          )
        ).rows,
        (
          await c.query(
            "SELECT count(*)::int n FROM public.analytics_events WHERE user_id = $1",
            [VIZINHA],
          )
        ).rows,
      ]);
      const privacidadeAntes = JSON.stringify(
        (await c.query("SELECT * FROM public.pedidos_de_privacidade")).rows,
      );
      // o que o Supabase guarda do login da vizinha e o que a loja/admin fez nas linhas dela
      const loginDaVizinha = async () =>
        JSON.stringify([
          (
            await c.query(
              "SELECT email_change, phone_change, recovery_token, confirmation_token FROM auth.users WHERE id = $1",
              [VIZINHA],
            )
          ).rows,
          (
            await c.query(
              "SELECT user_id, token_type, token_hash, relates_to FROM auth.one_time_tokens WHERE user_id = $1",
              [VIZINHA],
            )
          ).rows,
          (
            await c.query(
              "SELECT user_id, friendly_name, phone FROM auth.mfa_factors WHERE user_id = $1",
              [VIZINHA],
            )
          ).rows,
          (
            await c.query(
              `SELECT id, payload::text, ip_address FROM auth.audit_log_entries
                WHERE payload ->> 'actor_id' = $1 OR payload -> 'traits' ->> 'user_id' = $1
                ORDER BY id`,
              [VIZINHA],
            )
          ).rows,
        ]);
      const loginDaVizinhaAntes = await loginDaVizinha();
      const valoresAntes = JSON.stringify(
        (
          await c.query(
            "SELECT id, total, subtotal, shipping, status, payment_method, tracking_code, created_at FROM public.marketplace_orders WHERE user_id = $1 ORDER BY id",
            [ALVO],
          )
        ).rows,
      );

      const r = await tentar(c, anonimizar(ALVO, true));
      assert.ok(r.ok, `valendo falhou: ${r.mensagem}`);

      // perfil
      const p = await um(c, "SELECT * FROM public.profiles WHERE id = $1", [
        ALVO,
      ]);
      assert.strictEqual(p.full_name, "Cliente removido");
      for (const k of ["whatsapp", "cpf", "avatar_url", "cover_url"])
        assert.strictEqual(p[k], null, k);
      // dados soltos
      for (const [tabela, col] of [
        ["user_addresses", "user_id"],
        ["favorites", "user_id"],
        ["cart_items", "user_id"],
        ["notificacoes", "usuario_id"],
        ["push_subscriptions", "user_id"],
        ["analytics_events", "user_id"],
      ]) {
        const n = (
          await um(
            c,
            `SELECT count(*)::int n FROM public.${tabela} WHERE ${col} = $1`,
            [ALVO],
          )
        ).n;
        assert.strictEqual(n, 0, `${tabela} ainda tem linha dela`);
      }
      assert.strictEqual(
        (
          await um(
            c,
            "SELECT count(*)::int n FROM public.otp_verifications WHERE lower(email) = $1",
            [EMAIL_ALVO],
          )
        ).n,
        0,
      );
      // o evento de navegação CONTINUA (só perdeu o vínculo)
      assert.strictEqual(
        (
          await um(
            c,
            "SELECT count(*)::int n FROM public.analytics_events WHERE user_id IS NULL",
          )
        ).n,
        1,
      );
      // pedidos continuam, com os mesmos valores
      const ped = await c.query(
        "SELECT * FROM public.marketplace_orders WHERE user_id = $1 ORDER BY id",
        [ALVO],
      );
      assert.strictEqual(
        ped.rowCount,
        2,
        "os pedidos têm de continuar existindo",
      );
      for (const o of ped.rows) {
        assert.strictEqual(o.customer_name, "Cliente removido");
        assert.strictEqual(o.customer_phone, null);
        for (const k of [
          "whatsapp",
          "phone",
          "name",
          "email",
          "cpf",
          "address",
          "addressData",
          "address_text",
          "address_id",
          "street",
          "number",
          "cep",
          "destination_cep",
        ]) {
          assert.ok(!(k in o.customer_data), `customer_data ainda tem ${k}`);
        }
      }
      assert.strictEqual(
        ped.rows[1].customer_data.shipping_option_id,
        "store-pickup",
      );
      assert.strictEqual(
        ped.rows[1].customer_data.pickup_address,
        "Av. da Loja, 10 - Industrial",
      );
      assert.strictEqual(ped.rows[0].customer_data.shipping_option_id, "sedex");
      // LISTA DE PERMITIDOS: só passam forma de entrega, endereço da loja e canal —
      // inclusive as chaves de endereço de nome que ninguém previu.
      for (const o of ped.rows) {
        assert.ok(
          Object.keys(o.customer_data).every((k) =>
            CHAVES_PERMITIDAS.includes(k),
          ),
          `customer_data guardou chave fora da lista: ${Object.keys(o.customer_data)}`,
        );
        assert.ok(!("entrega_antiga" in o.customer_data));
        assert.ok(!("endereco_cobranca" in o.customer_data));
      }
      assert.deepStrictEqual(Object.keys(ped.rows[0].customer_data).sort(), [
        "shipping_option_id",
      ]);
      assert.deepStrictEqual(Object.keys(ped.rows[1].customer_data).sort(), [
        "canal",
        "pickup_address",
        "shipping_option_id",
      ]);
      assert.strictEqual(
        ped.rows[0].notes,
        "[texto removido a pedido da cliente]",
      );
      assert.strictEqual(
        ped.rows[1].notes,
        null,
        "nota que já era nula continua nula",
      );
      assert.strictEqual(
        ped.rows[1].observation,
        "[texto removido a pedido da cliente]",
      );
      // anotação interna da lojista: as linhas dos pedidos dela SAEM; a da vizinha fica.
      assert.deepStrictEqual(
        (
          await c.query(
            "SELECT order_id::text, note FROM public.marketplace_order_internal_notes ORDER BY order_id",
          )
        ).rows,
        [
          {
            order_id: "9b1caaaa-0000-4000-8000-0000000000aa",
            note: "Vizinha pagou no balcao, sem pendencia",
          },
        ],
        "anotação interna da cliente sobrou ou a da vizinha mudou",
      );
      assert.strictEqual(
        JSON.stringify(
          (
            await c.query(
              "SELECT id, total, subtotal, shipping, status, payment_method, tracking_code, created_at FROM public.marketplace_orders WHERE user_id = $1 ORDER BY id",
              [ALVO],
            )
          ).rows,
        ),
        valoresAntes,
        "valores/itens/datas do pedido mudaram",
      );
      // devolução: o texto e a lista de fotos saem; o dinheiro e o estado ficam
      const d = await um(
        c,
        "SELECT * FROM public.devolucoes WHERE id = '9b1cdddd-0000-4000-8000-000000000001'",
      );
      assert.strictEqual(d.detalhe, null);
      assert.deepStrictEqual(d.fotos, []);
      assert.strictEqual(Number(d.valor_itens), 100);
      assert.strictEqual(d.status, "concluida");
      // login: NÃO apagado; bloqueado; sem identidade
      const u = await um(c, "SELECT * FROM auth.users WHERE id = $1", [ALVO]);
      assert.ok(u, "o login NÃO pode ser apagado");
      assert.strictEqual(u.email, NOVO_EMAIL);
      assert.strictEqual(u.phone, null);
      assert.deepStrictEqual(u.raw_user_meta_data, { anonimizado: true });
      assert.ok(
        new Date(u.banned_until) > new Date("2900-01-01"),
        "conta não bloqueada",
      );
      const ids = await c.query(
        "SELECT * FROM auth.identities WHERE user_id = $1",
        [ALVO],
      );
      assert.strictEqual(ids.rowCount, 1, "só a ligação de e-mail sobra");
      assert.strictEqual(ids.rows[0].provider, "email");
      assert.strictEqual(ids.rows[0].email, NOVO_EMAIL);
      assert.strictEqual(ids.rows[0].provider_id, ALVO);
      assert.strictEqual(
        (
          await um(
            c,
            "SELECT count(*)::int n FROM auth.sessions WHERE user_id = $1",
            [ALVO],
          )
        ).n,
        0,
      );
      // troca pendente e códigos do login: esvaziados ('' — a coluna é NOT NULL)
      for (const col of [
        "email_change",
        "phone_change",
        "confirmation_token",
        "recovery_token",
        "email_change_token_new",
        "email_change_token_current",
        "phone_change_token",
        "reauthentication_token",
      ]) {
        assert.strictEqual(u[col], "", `auth.users.${col} não foi esvaziada`);
      }
      // códigos de uso único e segundo fator: as linhas dela somem
      for (const t of ["one_time_tokens", "mfa_factors"]) {
        assert.strictEqual(
          (
            await um(
              c,
              `SELECT count(*)::int n FROM auth.${t} WHERE user_id = $1`,
              [ALVO],
            )
          ).n,
          0,
          `auth.${t} ainda tem linha dela`,
        );
      }
      // registro de atividade: as linhas FICAM, sem IP e só com os campos técnicos
      const registro = await c.query(
        "SELECT payload, ip_address FROM auth.audit_log_entries ORDER BY ip_address, payload::text",
      );
      assert.strictEqual(
        registro.rowCount,
        4,
        "nenhuma linha do registro pode sumir",
      );
      const dela = registro.rows.filter((x) => x.payload.actor_id === ALVO);
      assert.strictEqual(dela.length, 1);
      assert.strictEqual(dela[0].ip_address, "", "o IP dela não foi zerado");
      assert.deepStrictEqual(dela[0].payload, {
        actor_id: ALVO,
        actor_via_sso: false,
        action: "login",
        log_type: "account",
        traits: { provider: "email" },
      });
      const doAdmin = registro.rows.find(
        (x) => x.payload.traits?.user_id === ALVO,
      );
      assert.strictEqual(
        doAdmin.ip_address,
        IP_DO_ADMIN,
        "o IP do administrador é dele, não dela",
      );
      assert.deepStrictEqual(doAdmin.payload, {
        actor_id: ADMIN,
        actor_via_sso: false,
        actor_username: "admin@loja.com",
        action: "user_modified",
        log_type: "user",
        traits: { user_id: ALVO },
      });
      assert.strictEqual(
        await loginDaVizinha(),
        loginDaVizinhaAntes,
        "o login da vizinha foi tocado",
      );
      // a vizinha e o registro do pedido de privacidade, intocados
      assert.strictEqual(
        JSON.stringify([
          (
            await c.query("SELECT * FROM public.profiles WHERE id = $1", [
              VIZINHA,
            ])
          ).rows,
          (await c.query("SELECT * FROM auth.users WHERE id = $1", [VIZINHA]))
            .rows,
          (
            await c.query("SELECT * FROM auth.identities WHERE user_id = $1", [
              VIZINHA,
            ])
          ).rows,
          (
            await c.query(
              "SELECT count(*)::int n FROM auth.sessions WHERE user_id = $1",
              [VIZINHA],
            )
          ).rows,
          (
            await c.query(
              "SELECT * FROM public.marketplace_orders WHERE user_id = $1",
              [VIZINHA],
            )
          ).rows,
          (
            await c.query(
              "SELECT count(*)::int n FROM public.otp_verifications WHERE email = 'vizinha@exemplo.com'",
            )
          ).rows,
          (
            await c.query(
              "SELECT count(*)::int n FROM public.user_addresses WHERE user_id = $1",
              [VIZINHA],
            )
          ).rows,
          (
            await c.query(
              "SELECT count(*)::int n FROM public.favorites WHERE user_id = $1",
              [VIZINHA],
            )
          ).rows,
          (
            await c.query(
              "SELECT count(*)::int n FROM public.notificacoes WHERE usuario_id = $1",
              [VIZINHA],
            )
          ).rows,
          (
            await c.query(
              "SELECT count(*)::int n FROM public.push_subscriptions WHERE user_id = $1",
              [VIZINHA],
            )
          ).rows,
          (
            await c.query(
              "SELECT count(*)::int n FROM public.analytics_events WHERE user_id = $1",
              [VIZINHA],
            )
          ).rows,
        ]),
        vizinhaAntes,
        "a vizinha foi tocada",
      );
      assert.strictEqual(
        JSON.stringify(
          (await c.query("SELECT * FROM public.pedidos_de_privacidade")).rows,
        ),
        privacidadeAntes,
        "o registro do pedido de privacidade mudou",
      );
    });
  },
});

PROVAS.push({
  nome: "(c)+(d) varredura INDEPENDENTE: depois de anonimizar só sobra a resposta da loja que cita o nome; a 'busca de sobras' do roteiro acha exatamente isso",
  corpo: async (c) => {
    await emTransacao(c, async () => {
      // Texto escrito pela LOJA citando o nome dela: o bloco automático não sabe.
      await c.query(
        `INSERT INTO public.produtos (id, nome, custo, preco_venda) VALUES ('9b1c9999-0000-4000-8000-000000000001', 'Produto Teste', 5, 10)`,
      );
      const nota = await tentar(
        c,
        `INSERT INTO public.reviews (product_id, user_id, rating, comment, merchant_reply, status)
         VALUES ('9b1c9999-0000-4000-8000-000000000001', '${ALVO}', 5, 'ótimo', 'Obrigada, ${NOME_ALVO}!', 'publicada')`,
      );
      assert.ok(nota.ok, `não consegui semear a avaliação: ${nota.mensagem}`);
      await apagarFotosDoStorage(c);

      // ANTES: os dados da cliente estão espalhados em vários lugares (a varredura enxerga).
      const antes = await varrer(c, PADROES_DA_CLIENTE);
      for (const esperado of [
        "auth.users",
        "auth.identities",
        "public.profiles",
        "public.marketplace_orders",
        "public.devolucoes",
        "public.otp_verifications",
        "public.user_addresses",
        "public.notificacoes",
        "public.reviews",
        // o que o Supabase guarda do login fora das tabelas do app
        "auth.audit_log_entries",
        "auth.one_time_tokens",
        "auth.mfa_factors",
      ]) {
        assert.ok(
          antes.some((x) => x.startsWith(`${esperado} (`)),
          `antes de anonimizar a varredura devia achar dados em ${esperado}; achou: ${antes.join(", ")}`,
        );
      }
      // 'sobras' do roteiro, ANTES: acha nos mesmos lugares de public.
      const buscar = async () => {
        const rs = await c.query(
          sobras(
            NOME_ALVO,
            EMAIL_ALVO,
            FONE_ALVO_FORMATADO,
            CPF_ALVO_FORMATADO,
            ENDERECO_ALVO,
            "02002-000",
          ),
        );
        return rs[rs.length - 1].rows;
      };
      const linhasAntes = (await buscar()).map(
        (x) => `${x.tabela}.${x.coluna}`,
      );
      for (const esperado of [
        "profiles.full_name",
        "marketplace_orders.customer_name",
        "marketplace_orders.customer_data",
        "otp_verifications.email",
        "reviews.merchant_reply",
        "devolucoes.detalhe",
        // endereço (R2) e esquema auth (R1)
        "user_addresses.street",
        "user_addresses.neighborhood",
        "user_addresses.cep",
        // (a troca pendente tem e-mail NOVO, que a busca pelos dados antigos não vê:
        // quem a limpa é o passo 4, e o controle (g) prova isso)
        "auth.users.email",
        "auth.audit_log_entries.payload",
        "auth.one_time_tokens.relates_to",
        "auth.mfa_factors.phone",
      ]) {
        assert.ok(
          linhasAntes.includes(esperado),
          `sobras (antes) devia achar ${esperado}; achou ${linhasAntes.join(", ")}`,
        );
      }

      const r = await tentar(c, anonimizar(ALVO, true));
      assert.ok(r.ok, `valendo falhou: ${r.mensagem}`);

      // DEPOIS: só a avaliação com a resposta da loja.
      const depois = await varrer(c, PADROES_DA_CLIENTE);
      assert.deepStrictEqual(
        depois,
        ["public.reviews (1)"],
        `sobrou dado pessoal: ${depois.join(", ")}`,
      );
      assert.deepStrictEqual(
        (await buscar()).map((x) => `${x.tabela}.${x.coluna}:${x.linhas}`),
        ["reviews.merchant_reply:1"],
        "a busca de sobras devia achar só a resposta da loja",
      );
      // Valores vazios: a busca não acha tudo nem quebra.
      const vazia = await c.query(sobras("", "", "", ""));
      assert.strictEqual(
        vazia[vazia.length - 1].rowCount,
        0,
        "sem valores, a busca não pode achar nada",
      );
    });
  },
});

// ---------------------------------------------------------------------------
// MUTANTES do roteiro: tira UM passo do SQL que a loja roda e a prova tem de cair.
// Sem isto, "não sobra nada" poderia ser verdade só porque a varredura é fraca.
// ---------------------------------------------------------------------------
/** Tira do SQL o comando que começa em `inicio` até o seu GET DIAGNOSTICS. */
function semOPasso(sql, inicio) {
  const de = sql.indexOf(inicio);
  assert.ok(de >= 0, `mutante: o roteiro não tem mais o trecho ${inicio}`);
  const ate = sql.indexOf("GET DIAGNOSTICS", de);
  assert.ok(ate > de, `mutante: sem GET DIAGNOSTICS depois de ${inicio}`);
  return sql.slice(0, de) + sql.slice(ate);
}
function trocando(sql, de, para) {
  assert.ok(sql.includes(de), `mutante: o roteiro não tem mais o trecho ${de}`);
  return sql.replace(de, para);
}

const MUTANTES = [
  {
    nome: "sem limpar o registro de atividade dela",
    mutar: (sql) =>
      semOPasso(
        sql,
        "UPDATE auth.audit_log_entries a\n     SET ip_address = '',",
      ),
    sobra: "auth.audit_log_entries",
    ip: true,
  },
  {
    nome: "sem limpar o registro de atividade de administrador sobre ela",
    mutar: (sql) =>
      semOPasso(
        sql,
        "UPDATE auth.audit_log_entries a\n     SET payload = jsonb_set(",
      ),
    sobra: "auth.audit_log_entries",
  },
  {
    nome: "sem apagar as anotações internas dos pedidos",
    mutar: (sql) =>
      semOPasso(sql, "DELETE FROM public.marketplace_order_internal_notes"),
    sobra: "public.marketplace_order_internal_notes",
  },
  {
    nome: "sem apagar os códigos de uso único",
    mutar: (sql) => semOPasso(sql, "DELETE FROM auth.one_time_tokens"),
    sobra: "auth.one_time_tokens",
  },
  {
    nome: "sem apagar a verificação em duas etapas",
    mutar: (sql) => semOPasso(sql, "DELETE FROM auth.mfa_factors"),
    sobra: "auth.mfa_factors",
  },
  {
    nome: "sem esvaziar a troca de e-mail pendente",
    mutar: (sql) => trocando(sql, "email_change = '',", ""),
    sobra: "auth.users",
  },
  {
    nome: "sem esvaziar a troca de telefone pendente",
    mutar: (sql) => trocando(sql, "phone_change = '',", ""),
    sobra: "auth.users",
  },
  {
    nome: "só tira as chaves de endereço CONHECIDAS do pedido (a lista antiga)",
    mutar: (sql) => {
      const de = sql.indexOf("customer_data = CASE WHEN");
      const ate = sql.indexOf("notes = CASE", de);
      assert.ok(de >= 0 && ate > de, "mutante: bloco de customer_data mudou");
      return `${sql.slice(0, de)}customer_data = customer_data - 'whatsapp' - 'phone' - 'name' - 'email' - 'cpf' - 'address' - 'addressData' - 'address_text' - 'address_id' - 'street' - 'number' - 'complement' - 'neighborhood' - 'city' - 'state' - 'cep' - 'reference' - 'destination_cep',\n         ${sql.slice(ate)}`;
    },
    sobra: "public.marketplace_orders",
  },
];

PROVAS.push({
  nome: "(g) MUTANTES: o controle limpa tudo; tirar UM passo do roteiro (registro de atividade, anotações internas, códigos, 2 etapas, troca pendente, lista de permitidos do pedido) deixa dado dela e a prova cai",
  corpo: async (c) => {
    // CONTROLE: o roteiro inteiro, sem avaliação nem resposta da loja, não deixa nada.
    await emTransacao(c, async () => {
      await apagarFotosDoStorage(c);
      const r = await tentar(c, anonimizar(ALVO, true));
      assert.ok(r.ok, `controle falhou: ${r.mensagem}`);
      assert.deepStrictEqual(
        await varrer(c, PADROES_DA_CLIENTE),
        [],
        "o controle (roteiro inteiro) devia limpar tudo",
      );
      assert.strictEqual(
        (
          await um(
            c,
            "SELECT count(*)::int n FROM auth.audit_log_entries WHERE ip_address = $1",
            [IP_DELA],
          )
        ).n,
        0,
      );
    });
    for (const m of MUTANTES) {
      await emTransacao(c, async () => {
        await apagarFotosDoStorage(c);
        const r = await tentar(c, m.mutar(anonimizar(ALVO, true)));
        assert.ok(r.ok, `mutante "${m.nome}" não rodou: ${r.mensagem}`);
        const sobrou = await varrer(c, PADROES_DA_CLIENTE);
        if (m.sobra) {
          assert.ok(
            sobrou.some((x) => x.startsWith(`${m.sobra} (`)),
            `mutante "${m.nome}" devia deixar dado em ${m.sobra}; a varredura achou: ${sobrou.join(", ") || "nada"}`,
          );
        }
        if (m.ip) {
          const n = (
            await um(
              c,
              "SELECT count(*)::int n FROM auth.audit_log_entries WHERE ip_address = $1",
              [IP_DELA],
            )
          ).n;
          assert.strictEqual(
            n,
            1,
            `mutante "${m.nome}" devia deixar o IP dela no registro`,
          );
        }
      });
    }
    // mutante só do IP (a varredura de texto não enxerga IP): a asserção do IP tem de cair.
    await emTransacao(c, async () => {
      await apagarFotosDoStorage(c);
      const sql = trocando(
        anonimizar(ALVO, true),
        "SET ip_address = '',",
        "SET",
      );
      const r = await tentar(c, sql);
      assert.ok(r.ok, `mutante do IP não rodou: ${r.mensagem}`);
      const n = (
        await um(
          c,
          "SELECT count(*)::int n FROM auth.audit_log_entries WHERE ip_address = $1",
          [IP_DELA],
        )
      ).n;
      assert.strictEqual(n, 1, "sem zerar o IP, o IP dela tem de continuar lá");
    });
  },
});

async function main() {
  const url = lerDatabaseUrlEfemera();
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  const linhas = [];
  const titulo =
    "Ensaio da anonimização de conta do roteiro de privacidade (rpc-ci)";
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo(cliente);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.message}`);
        linhas.push(`- ❌ ${nome}\n  - \`${erro.message}\``);
        anexarAoSummary(titulo, linhas.join("\n"));
        falhar(
          "FALHOU",
          "O roteiro de anonimização não faz o que promete — ver acima qual prova caiu.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(
    `\n[anonimizar-conta] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    titulo,
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero (auth emulado).`,
  );
}

main();
