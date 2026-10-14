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
 *   (f) o bloco "listar" só lê e devolve as contagens certas.
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
function sobras(nome, email, fone, cpf) {
  const q = (s) => `'${s.replaceAll("'", "''")}'`;
  const sql = BLOCOS.sobras.replace(
    /SELECT \* FROM pg_temp\.sobras\([^;]*\);/,
    `SELECT * FROM pg_temp.sobras(${q(nome)}, ${q(email)}, ${q(fone)}, ${q(cpf)});`,
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
}

// ---------------------------------------------------------------------------
// A cliente de mentira (e a vizinha), dentro da transação da prova.
// ---------------------------------------------------------------------------
const DATA_DO_PEDIDO = {
  whatsapp: FONE_ALVO_DIGITOS,
  address_id: null,
  address: {
    name: "Casa",
    street: "Rua das Flores",
    number: "123",
    complement: "apto 4",
    neighborhood: "Centro",
    city: "São Paulo",
    state: "SP",
    cep: "01001000",
    reference: "perto da padaria",
    cpf: CPF_ALVO,
  },
  shipping_option_id: "sedex",
  destination_cep: "01001000",
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
      `INSERT INTO public.user_addresses (user_id, name, recipient_name, cep, street, number, neighborhood, city, state)
       VALUES ($1, 'Casa', $2, '01001000', 'Rua das Flores', '123', 'Centro', 'São Paulo', 'SP')`,
      [uid, uid === ALVO ? NOME_ALVO : "Vizinha Silva"],
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
      pickup_address: "Av. da Loja, 10 - Centro",
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
    for (const col of ["raw_user_meta_data", "banned_until", "updated_at"]) {
      assert.ok(
        cols.rows.some((r) => r.column_name === col),
        `auth.users sem ${col}`,
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
                (SELECT customer_name FROM public.marketplace_orders WHERE id = '9b1caaaa-0000-4000-8000-000000000001') g`,
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
      assert.match(r.mensagem, /endereços apagados: 1/);
      assert.match(r.mensagem, /sessões abertas encerradas: 2/);
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
        "Av. da Loja, 10 - Centro",
      );
      assert.strictEqual(ped.rows[0].customer_data.shipping_option_id, "sedex");
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
      ]) {
        assert.ok(
          antes.some((x) => x.startsWith(`${esperado} (`)),
          `antes de anonimizar a varredura devia achar dados em ${esperado}; achou: ${antes.join(", ")}`,
        );
      }
      // 'sobras' do roteiro, ANTES: acha nos mesmos lugares de public.
      const rAntes = await c.query(
        sobras(NOME_ALVO, EMAIL_ALVO, FONE_ALVO_FORMATADO, CPF_ALVO_FORMATADO),
      );
      const linhasAntes = rAntes[rAntes.length - 1].rows.map(
        (x) => `${x.tabela}.${x.coluna}`,
      );
      for (const esperado of [
        "profiles.full_name",
        "marketplace_orders.customer_name",
        "marketplace_orders.customer_data",
        "otp_verifications.email",
        "reviews.merchant_reply",
        "devolucoes.detalhe",
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
      const rDepois = await c.query(
        sobras(NOME_ALVO, EMAIL_ALVO, FONE_ALVO_FORMATADO, CPF_ALVO_FORMATADO),
      );
      assert.deepStrictEqual(
        rDepois[rDepois.length - 1].rows.map(
          (x) => `${x.tabela}.${x.coluna}:${x.linhas}`,
        ),
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
