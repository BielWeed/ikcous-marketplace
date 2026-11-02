"use strict";

/**
 * PROVA VIVA da migration 20261399100000_o_nome_do_perfil_tem_teto_no_banco.sql contra o Postgres EFEMERO (clone do
 * rodar-isolado.cjs: a arvore migrada). Nunca banco de loja. Esqueleto: tests/banco/prova-de-objeto-novo.cjs; a irma e'
 * o-texto-da-avaliacao-tem-teto-no-banco-viva.cjs (20261396200000).
 *
 * O defeito: `profiles.full_name` e' `text` sem teto; o gatilho sync_public_profile copia o nome para `public_profiles` e as views
 * `vw_questions_public`/`vw_reviews_public` o devolvem ao visitante como `author_name`. Uma conta qualquer grava 2 milhoes de
 * caracteres (update_my_profile_secure ou UPDATE direto) e cada pergunta dela faz a pagina do produto baixar megabytes.
 * O conserto: tres CHECKs NOT VALID (nome ate 120 em profiles e em public_profiles; WhatsApp ate 20 em profiles).
 *
 *  ANTES       controle: sem os CHECKs 121 e 2 milhoes de caracteres entram e chegam ao visitante pela vitrine (o defeito).
 *  DEPOIS      120 caracteres entram (letras, acentos, emojis), nulo e vazio entram; 121 e 2 milhoes sao recusados (23514, pela
 *              restricao certa) pela RPC, por UPDATE direto, por INSERT, para administrador, service_role e sessao direta; a copia
 *              publica tambem recusa; WhatsApp ate 20 entra, 21 recusa; a vitrine nunca devolve nome acima de 120; trocar a foto e
 *              gravar o CPF seguem funcionando.
 *  GUARDA      perfil antigo acima do teto (nome, copia publica ou WhatsApp): a migration se RECUSA (B1_BASELINE_DIVERGENT) e nada
 *              muda (o CHECK reavaliado em todo UPDATE travaria foto, CPF e cargo da conta); sem a guarda (mutante) o UPDATE de OUTRA
 *              coluna da conta antiga falha; o fluxo de pagamento do pedido dessa conta segue registrando nos dois estados.
 *  SO NOVO     o apply cria so as tres restricoes: nenhuma funcao, tabela, politica, gatilho ou outra restricao muda.
 *  MUTANTES    o mesmo roteiro sobre restricoes sabotadas (teto de 121/119/5000, bytes, exige texto, sem a regra; WhatsApp 21/19/bytes)
 *              FICA VERMELHO na expectativa certa.
 *  MIGRATION   reaplicar (2x) e CRLF = mesmo estado; rollback sem tocar dado, 2x no-op, ida e volta igual; o pre-voo recusa SEM
 *              escrever; a conferencia final recusa cada estrago; o pre-voo do rollback recusa o que nao e' dele.
 *  ATOMICIDADE conexao SEM BEGIN: a conferencia sabotada derruba o arquivo inteiro; gravacao em voo (em profiles OU em public_profiles)
 *              faz a migration FALHAR LIMPA no lock_timeout, sem deixar CHECK nenhum, e depois aplica.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-nome-do-perfil-tem-teto-no-banco-viva.cjs
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova, sha256, emCRLF } = P;
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const NOME = "20261399100000_o_nome_do_perfil_tem_teto_no_banco.sql";
const MIGRATION = P.lerMigration(NOME);
const ROLLBACK = P.lerMigration(`rollback-manual-${NOME}`);
const CK_NOME = "profiles_full_name_ate_120_caracteres";
const CK_PUBLICO = "public_profiles_full_name_ate_120_caracteres";
const CK_WHATSAPP = "profiles_whatsapp_ate_20_caracteres";
const NOVOS = {
  funcoes: [],
  gatilhos: [],
  restricoes: [CK_NOME, CK_PUBLICO, CK_WHATSAPP],
};
const DEF_NOME = "CHECK ((char_length(full_name) <= 120))";
const DEF_WHATSAPP = "CHECK ((char_length(whatsapp) <= 20))";
const NOT_VALID = " NOT VALID";

const U = {
  autor1: "b1399100-0000-4000-8000-0000000000a1",
  autor2: "b1399100-0000-4000-8000-0000000000a2",
  autor3: "b1399100-0000-4000-8000-0000000000a3",
  novo: "b1399100-0000-4000-8000-0000000000a9",
  admin: "b1399100-0000-4000-8000-0000000000ad",
};
const PROD = "b1399100-0000-4000-8000-0000000000f1";
const CPF_VALIDO = "52998224725"; // CPF de teste conhecido (digitos verificadores corretos)
const JWT_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});

const depois = () => P.conexao().query(MIGRATION);
const antes = () => P.conexao().query(ROLLBACK);

async function semear() {
  const c = P.conexao();
  for (const id of Object.values(U))
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@399100.teste', '{}'::jsonb)",
      [id],
    );
  // o novo usuario fica SEM perfil (para o teste de INSERT); o gatilho sync_public_profile preenche public_profiles dos demais
  await c.query(
    `INSERT INTO public.profiles (id, full_name, whatsapp, role) VALUES
       ($1, 'Autora Um', '(11) 91234-5678', 'customer'), ($2, 'Autora Dois', NULL, 'customer'),
       ($3, 'Admin 399100', NULL, 'admin'), ($4, 'Autora Tres', NULL, 'customer')`,
    [U.autor1, U.autor2, U.admin, U.autor3],
  );
  await c.query(
    'UPDATE auth.users SET raw_app_meta_data = \'{"role":"admin"}\'::jsonb WHERE id = $1',
    [U.admin],
  );
  await c.query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo) VALUES ($1, 'Camiseta 399100', 100, 10, true, 40)",
    [PROD],
  );
  // a pergunta da autora 1: e' por ela que o nome chega ao visitante (vw_questions_public.author_name)
  await c.query(
    "INSERT INTO public.questions (product_id, user_id, question) VALUES ($1, $2, 'Tem na cor azul?')",
    [PROD, U.autor1],
  );
}

const SQL_RPC =
  "SELECT public.update_my_profile_secure(p_full_name => $1::text, p_whatsapp => $2::text, p_avatar_url => $3::text)";
const rpc = (uid, nome, whatsapp = null, foto = null) =>
  P.tentar("authenticated", SQL_RPC, [nome, whatsapp, foto], { uid });
const direto = (papel, uid, coluna, valor, id = uid) =>
  P.tentar(
    papel,
    `UPDATE public.profiles SET ${coluna} = $2 WHERE id = $1::uuid RETURNING id`,
    [id, valor],
    { uid },
  );
const lerPerfil = async (id) =>
  (
    await P.conexao().query(
      `SELECT p.full_name, p.whatsapp, p.cpf, p.avatar_url, pp.full_name AS publico
         FROM public.profiles p LEFT JOIN public.public_profiles pp ON pp.id = p.id WHERE p.id = $1`,
      [id],
    )
  ).rows[0];
const entrou = (r) => Boolean(r.linhas);
const recusada = (r, ck) =>
  !r.linhas && r.codigo === "23514" && r.restricao === ck;
const nomeNaVitrine = async () =>
  (
    await P.tentar(
      "anon",
      "SELECT max(char_length(author_name))::int AS n FROM public.vw_questions_public WHERE product_id = $1::uuid",
      [PROD],
    )
  ).linhas?.[0]?.n ?? -1;

/** O roteiro inteiro; cada chave vale `true` quando o comportamento e' o desta migration. */
async function roteiro() {
  const r = {};
  // ---- o nome pela RPC do app
  r.ok120 = entrou(await rpc(U.autor1, "a".repeat(120)));
  r.okAcento = entrou(await rpc(U.autor1, "ã".repeat(120)));
  r.okEmoji = entrou(await rpc(U.autor1, "😀".repeat(120)));
  r.okCurto = entrou(await rpc(U.autor1, "Maria da Silva"));
  r.okVazio = entrou(await rpc(U.autor1, ""));
  r.recusa121 = recusada(await rpc(U.autor1, "b".repeat(121)), CK_NOME);
  r.recusaGrande = recusada(
    await rpc(U.autor1, "c".repeat(2_000_000)),
    CK_NOME,
  );
  // 121 contado em CARACTERES: 121 emojis (484 bytes) recusa, 120 emojis (480 bytes) ja entrou acima
  r.recusaEmoji121 = recusada(await rpc(U.autor1, "😀".repeat(121)), CK_NOME);
  // ---- o nome por UPDATE direto (a tabela tem policy de update na propria linha) e pelos outros papeis
  r.okDireto120 = entrou(
    await direto("authenticated", U.autor1, "full_name", "d".repeat(120)),
  );
  r.okNulo = entrou(await direto("authenticated", U.autor1, "full_name", null));
  r.recusaDireto = recusada(
    await direto("authenticated", U.autor1, "full_name", "e".repeat(121)),
    CK_NOME,
  );
  r.recusaAdmin = recusada(
    await P.tentar(
      "authenticated",
      "UPDATE public.profiles SET full_name = $2 WHERE id = $1::uuid RETURNING id",
      [U.autor2, "f".repeat(121)],
      { uid: U.admin, claims: JWT_ADMIN },
    ),
    CK_NOME,
  );
  // No Supabase o service_role tem BYPASSRLS; o papel do efemero nao tem. A transacao desfaz o ALTER ROLE.
  await P.conexao().query("ALTER ROLE service_role BYPASSRLS");
  r.recusaServico = recusada(
    await direto("service_role", U.autor2, "full_name", "g".repeat(121)),
    CK_NOME,
  );
  r.recusaSessao = recusada(
    await direto(null, U.autor2, "full_name", "h".repeat(121)),
    CK_NOME,
  );
  r.recusaInsert = recusada(
    await P.tentar(
      null,
      "INSERT INTO public.profiles (id, full_name, role) VALUES ($1::uuid, $2, 'customer')",
      [U.novo, "i".repeat(121)],
    ),
    CK_NOME,
  );
  // ---- a copia publica (a que o visitante le) tem o proprio teto, mesmo sem passar pelo gatilho
  r.recusaPublico = recusada(
    await P.tentar(
      null,
      "UPDATE public.public_profiles SET full_name = $2 WHERE id = $1::uuid",
      [U.autor2, "j".repeat(121)],
    ),
    CK_PUBLICO,
  );
  r.okPublico120 = entrou(
    await P.tentar(
      null,
      "UPDATE public.public_profiles SET full_name = $2 WHERE id = $1::uuid RETURNING id",
      [U.autor2, "k".repeat(120)],
    ),
  );
  // ---- o WhatsApp
  r.okWhats20 = entrou(
    await rpc(U.autor1, "Maria", "+55 (11) 91234-567".padEnd(20, "8")),
  );
  r.okWhats19 = entrou(await rpc(U.autor1, "Maria", "+55 (11) 91234-5678"));
  r.okWhatsMascara = entrou(await rpc(U.autor1, "Maria", "(11) 91234-5678"));
  r.okWhatsNulo = entrou(
    await direto("authenticated", U.autor1, "whatsapp", null),
  );
  r.recusaWhats21 = recusada(
    await rpc(U.autor1, "Maria", "1".repeat(21)),
    CK_WHATSAPP,
  );
  r.recusaWhatsGrande = recusada(
    await rpc(U.autor1, "Maria", "2".repeat(1_000_000)),
    CK_WHATSAPP,
  );
  r.recusaWhatsDireto = recusada(
    await direto("authenticated", U.autor1, "whatsapp", "3".repeat(21)),
    CK_WHATSAPP,
  );
  // ---- o que um perfil legitimo continua fazendo: trocar a foto e gravar o CPF
  r.fotoSegue = entrou(
    await rpc(U.autor1, "Maria", null, "data:image/jpeg;base64,AAAA"),
  );
  r.cpfSegue = Boolean(
    (
      await P.tentar(
        "authenticated",
        "SELECT public.set_my_cpf($1)",
        [CPF_VALIDO],
        {
          uid: U.autor1,
        },
      )
    ).linhas,
  );
  // ---- o que o visitante recebe: com o nome em 120 a vitrine nunca passa de 120; sem o teto chegou a 2 milhoes
  await rpc(U.autor1, "v".repeat(2_000_000)); // com o teto e' recusado e o nome fica curto; sem ele grava e a vitrine entrega tudo
  const n = await nomeNaVitrine();
  r.vitrineLimitada = n >= 0 && n <= 120;
  return r;
}
const falhou = (r) =>
  Object.entries(r)
    .filter(([, v]) => v !== true)
    .map(([k]) => k)
    .sort();
const CHAVES_DE_RECUSA = [
  "recusa121",
  "recusaGrande",
  "recusaEmoji121",
  "recusaDireto",
  "recusaAdmin",
  "recusaServico",
  "recusaSessao",
  "recusaInsert",
  "recusaPublico",
  "recusaWhats21",
  "recusaWhatsGrande",
  "recusaWhatsDireto",
];
const CHAVES_DE_ACEITE = [
  "ok120",
  "okAcento",
  "okEmoji",
  "okCurto",
  "okVazio",
  "okDireto120",
  "okNulo",
  "okPublico120",
  "okWhats20",
  "okWhats19",
  "okWhatsMascara",
  "okWhatsNulo",
  "fotoSegue",
  "cpfSegue",
];

const restricoes = async (c = P.conexao()) =>
  (
    await c.query(
      `SELECT conrelid::regclass::text AS t, conname, oid::text AS oid, pg_get_constraintdef(oid) AS def, convalidated,
              contype, conislocal
         FROM pg_constraint
        WHERE conname = ANY ($1::text[]) ORDER BY conname`,
      [[CK_NOME, CK_PUBLICO, CK_WHATSAPP]],
    )
  ).rows;
const quantas = async (c = P.conexao()) => (await restricoes(c)).length;
const aplicado = async (c = P.conexao()) => (await quantas(c)) === 3;
const semOid = (linhas) => linhas.map(({ oid, ...resto }) => resto);
const dadosDosPerfis = async () =>
  (
    await P.conexao().query(
      `SELECT (SELECT count(*)::int FROM public.profiles) AS n,
              (SELECT count(*)::int FROM public.public_profiles) AS np,
              coalesce((SELECT md5(string_agg(x::text, '|' ORDER BY x.id::text)) FROM public.profiles x), '') AS h,
              coalesce((SELECT md5(string_agg(x::text, '|' ORDER BY x.id::text)) FROM public.public_profiles x), '') AS hp`,
    )
  ).rows[0];
/** Troca uma restricao por outra (sabotagem): mesma tabela, mesmo nome, outra regra. */
const trocarRegra = (tabela, nome, regra) =>
  `ALTER TABLE public.${tabela} DROP CONSTRAINT ${nome};
   ALTER TABLE public.${tabela} ADD CONSTRAINT ${nome} CHECK (${regra}) NOT VALID`;
const tirar = (tabela, nome) =>
  `ALTER TABLE public.${tabela} DROP CONSTRAINT ${nome}`;

// ---------------------------------------------------------------------------------------------------------------------------
prova(
  "ANTES (controle): sem os CHECKs 121 e 2 milhoes de caracteres entram e a vitrine entrega megabytes ao visitante (o defeito)",
  async () => {
    await P.emTransacao(
      async () => {
        assert.equal(await quantas(), 0, "o estado ANTES nao montou");
        const r = await roteiro();
        const f = falhou(r);
        for (const k of [...CHAVES_DE_RECUSA, "vitrineLimitada"])
          assert.ok(f.includes(k), `controle: ${k} devia falhar sem os CHECKs`);
        // o que ja era certo antes continua certo
        for (const k of CHAVES_DE_ACEITE)
          assert.equal(new Map(Object.entries(r)).get(k), true, k);
      },
      async () => {
        await semear();
        await antes();
      },
    );
  },
);

prova(
  "ANTES (controle da vitrine): o nome de 2 milhoes de caracteres chega ao visitante por author_name",
  async () => {
    await P.emTransacao(
      async () => {
        const gravou = await rpc(U.autor1, "z".repeat(2_000_000));
        assert.ok(gravou.linhas, `sem o CHECK devia gravar: ${gravou.erro}`);
        assert.equal(await nomeNaVitrine(), 2_000_000);
      },
      async () => {
        await semear();
        await antes();
      },
    );
  },
);

prova(
  "DEPOIS: 120 caracteres entram (letra, acento, emoji, nulo, vazio); 121 e 2 milhoes sao recusados para todos; foto e CPF seguem; a vitrine fica em 120",
  async () => {
    await P.emTransacao(
      async () => {
        assert.equal(await aplicado(), true, "o estado DEPOIS nao montou");
        const r = await roteiro();
        assert.deepEqual(falhou(r), [], JSON.stringify(r));
        const maior = (
          await P.conexao().query(
            `SELECT greatest((SELECT max(char_length(full_name)) FROM public.profiles),
                             (SELECT max(char_length(full_name)) FROM public.public_profiles))::int AS maior,
                    (SELECT max(char_length(whatsapp)) FROM public.profiles)::int AS maior_whats`,
          )
        ).rows[0];
        assert.ok(
          maior.maior <= 120,
          `ficou nome de ${maior.maior} caracteres`,
        );
        assert.ok(
          maior.maior_whats <= 20,
          `ficou WhatsApp de ${maior.maior_whats} caracteres`,
        );
      },
      async () => {
        await semear();
        await depois();
      },
    );
  },
);

prova(
  "DEPOIS: a recusa da RPC nao grava nada (nem na copia publica) e o nome anterior fica",
  async () => {
    await P.emTransacao(
      async () => {
        const a0 = await lerPerfil(U.autor1);
        assert.equal(a0.full_name, "Autora Um");
        assert.ok(recusada(await rpc(U.autor1, "m".repeat(121)), CK_NOME));
        assert.deepEqual(await lerPerfil(U.autor1), a0);
        // a recusa por WhatsApp tambem nao deixa o nome novo gravado (a RPC e' um UPDATE so)
        assert.ok(
          recusada(
            await rpc(U.autor1, "Outro Nome", "9".repeat(21)),
            CK_WHATSAPP,
          ),
        );
        assert.deepEqual(await lerPerfil(U.autor1), a0);
      },
      async () => {
        await semear();
        await depois();
      },
    );
  },
);

prova(
  "Os CHECKs nascem NOT VALID, uma restricao de cada nome, com a regra exata",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await antes();
      await depois();
      const linhas = await restricoes();
      assert.equal(linhas.length, 3);
      const porNome = new Map(linhas.map((l) => [l.conname, l]));
      assert.equal(porNome.get(CK_NOME).t, "profiles");
      assert.equal(porNome.get(CK_NOME).def, DEF_NOME + NOT_VALID);
      assert.equal(porNome.get(CK_PUBLICO).t, "public_profiles");
      assert.equal(porNome.get(CK_PUBLICO).def, DEF_NOME + NOT_VALID);
      assert.equal(porNome.get(CK_WHATSAPP).t, "profiles");
      assert.equal(porNome.get(CK_WHATSAPP).def, DEF_WHATSAPP + NOT_VALID);
      for (const l of linhas) {
        assert.equal(l.convalidated, false);
        assert.equal(l.contype, "c");
      }
    });
  },
);

// ---- GUARDA: perfil antigo acima do teto -------------------------------------------------------------------------------------
const LEGADO = {
  nome: "n".repeat(500),
  whatsapp: "(11) 91234-5678 ramal 4321 sala 9", // 33 caracteres
};
/** A migration SEM a guarda (mutante): tira o `IF v_achados <> '' THEN ... END IF;`. */
const SEM_A_GUARDA = MIGRATION.replace(
  /\n {2}IF v_achados <> '' THEN[\s\S]*?\n {2}END IF;\n/,
  "\n",
);

// Pedido + item + avaliacao da mesma conta, para provar que o PAGAMENTO do pedido dela nao quebra.
const PEDIDO = "b1399100-0000-4000-8000-000000000d01";
async function semearPedido(uid) {
  const c = P.conexao();
  await c.query(
    `INSERT INTO public.marketplace_orders (id, user_id, customer_data, customer_name, subtotal, total, payment_status, status)
     VALUES ($1, $2, '{}'::jsonb, 'Autora Dois', 100, 100, 'aguardando', 'pending')`,
    [PEDIDO, uid],
  );
  await c.query(
    "INSERT INTO public.marketplace_order_items (order_id, product_id, quantity, price) VALUES ($1, $2, 1, 100)",
    [PEDIDO, PROD],
  );
  await c.query(
    "INSERT INTO public.reviews (product_id, user_id, rating, comment, status) VALUES ($1, $2, 5, 'chegou certinho', 'pendente')",
    [PROD, uid],
  );
}
const marcarComoPago = () =>
  P.tentar(
    null,
    "UPDATE public.marketplace_orders SET payment_status = 'pago' WHERE id = $1 RETURNING payment_status",
    [PEDIDO],
    { uid: "" },
  );

prova(
  "GUARDA: com perfil antigo acima do teto a migration se RECUSA (B1_BASELINE_DIVERGENT), nenhum CHECK fica e nada muda; no limite (120 e 20) aplica; encurtado, aplica",
  async () => {
    assert.notEqual(SEM_A_GUARDA, MIGRATION, "o mutante nao tirou a guarda");
    await P.emTransacao(async () => {
      await semear();
      await antes();
      const c = P.conexao();
      // a autora 2 tem nome de 500 (o gatilho copia para a publica); a autora 3 tem WhatsApp de 33; a autora 1 esta no limite
      await c.query("UPDATE public.profiles SET full_name = $2 WHERE id = $1", [
        U.autor2,
        LEGADO.nome,
      ]);
      await c.query("UPDATE public.profiles SET whatsapp = $2 WHERE id = $1", [
        U.autor3,
        LEGADO.whatsapp,
      ]);
      await c.query(
        "UPDATE public.profiles SET full_name = $2, whatsapp = $3 WHERE id = $1",
        [U.autor1, "l".repeat(120), "4".repeat(20)],
      );
      const d0 = await dadosDosPerfis();
      const r0 = await P.retrato(NOVOS);
      // so a de 500 conta no nome (a de exatamente 120 esta dentro do teto); a copia publica herdou o 500 pelo gatilho
      await P.recusa(
        MIGRATION,
        /B1_BASELINE_DIVERGENT: há perfil com valor acima do teto — profiles\.full_name: 1 linha\(s\) acima de 120 \(a maior tem 500\); public_profiles\.full_name: 1 linha\(s\) acima de 120 \(a maior tem 500\); profiles\.whatsapp: 1 linha\(s\) acima de 20 \(a maior tem 33\); a migration NÃO foi aplicada/,
      );
      assert.equal(await quantas(), 0, "algum CHECK ficou depois da recusa");
      assert.deepEqual(await P.retrato(NOVOS), r0, "a recusa mudou o esquema");
      assert.deepEqual(await dadosDosPerfis(), d0, "a recusa mexeu em perfil");
      // so o WhatsApp antigo: a recusa cita so ele
      await c.query(
        "UPDATE public.profiles SET full_name = 'Autora Dois' WHERE id = $1",
        [U.autor2],
      );
      await P.recusa(
        MIGRATION,
        /acima do teto — profiles\.whatsapp: 1 linha\(s\) acima de 20 \(a maior tem 33\); a migration NÃO/,
      );
      assert.equal(await quantas(), 0);
      // encurtados os dois (decisao da lojista), a migration aplica
      await c.query(
        "UPDATE public.profiles SET whatsapp = left(whatsapp, 20) WHERE char_length(whatsapp) > 20",
      );
      assert.equal(
        await P.aplicar(MIGRATION),
        null,
        "encurtado, devia aplicar",
      );
      assert.equal(await aplicado(), true);
    });
  },
);

prova(
  "GUARDA: so a copia publica antiga (public_profiles acima de 120, profiles limpo) tambem recusa e cita so ela",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await antes();
      await P.conexao().query(
        "UPDATE public.public_profiles SET full_name = $2 WHERE id = $1",
        [U.autor2, "p".repeat(300)],
      );
      const d0 = await dadosDosPerfis();
      await P.recusa(
        MIGRATION,
        /acima do teto — public_profiles\.full_name: 1 linha\(s\) acima de 120 \(a maior tem 300\); a migration NÃO/,
      );
      assert.equal(await quantas(), 0);
      assert.deepEqual(await dadosDosPerfis(), d0);
    });
  },
);

prova(
  "GUARDA so varre a coluna cujo CHECK nasce agora: estado parcial (so o do WhatsApp falta) com WhatsApp antigo recusa citando so ele",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await depois();
      // estado parcial: alguem tirou so o CHECK do WhatsApp e gravou um valor longo antes de a migration ser repetida
      await P.conexao().query(tirar("profiles", CK_WHATSAPP));
      await P.conexao().query(
        "UPDATE public.profiles SET whatsapp = $2 WHERE id = $1",
        [U.autor3, LEGADO.whatsapp],
      );
      await P.recusa(
        MIGRATION,
        /acima do teto — profiles\.whatsapp: 1 linha\(s\) acima de 20 \(a maior tem 33\); a migration NÃO/,
      );
      assert.equal(await quantas(), 2, "a recusa deixou ou tirou CHECK");
    });
  },
);

prova(
  "GUARDA sem linha acima do teto e com as restricoes ja presentes: reaplicar nao revarre nem reclama",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await antes();
      await P.conexao().query(
        "UPDATE public.profiles SET full_name = $2, whatsapp = $3 WHERE id = $1",
        [U.autor2, "q".repeat(120), "5".repeat(20)],
      );
      await depois();
      const e1 = await restricoes();
      await depois();
      assert.deepEqual(await restricoes(), e1);
    });
  },
);

prova(
  "CONTA ANTIGA (controle): sem os CHECKs o pagamento do pedido e a troca de foto/CPF da conta com nome de 500 caracteres funcionam",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await antes();
      await P.conexao().query(
        "UPDATE public.profiles SET full_name = $2 WHERE id = $1",
        [U.autor2, LEGADO.nome],
      );
      await semearPedido(U.autor2);
      const pago = await marcarComoPago();
      assert.ok(
        pago.linhas,
        `sem os CHECKs o pagamento devia registrar: ${pago.erro}`,
      );
      assert.ok(
        (await rpc(U.autor2, null, null, "data:image/jpeg;base64,AAAA")).linhas,
        "sem os CHECKs a foto devia trocar",
      );
    });
  },
);

prova(
  "MUTANTE sem a guarda: a migration aplica por cima da conta antiga e o UPDATE de OUTRA coluna dela (foto, CPF) FALHA (23514) - e' o que a guarda impede; com a migration REAL a recusa deixa a conta editavel e o pagamento registra",
  async () => {
    // sem a guarda: aplica e a conta antiga fica impossivel de editar
    await P.emTransacao(async () => {
      await semear();
      await antes();
      await P.conexao().query(
        "UPDATE public.profiles SET full_name = $2 WHERE id = $1",
        [U.autor2, LEGADO.nome],
      );
      assert.equal(
        await P.aplicar(SEM_A_GUARDA),
        null,
        "sem a guarda a migration devia aplicar (e' o defeito)",
      );
      const foto = await rpc(
        U.autor2,
        null,
        null,
        "data:image/jpeg;base64,AAAA",
      );
      assert.ok(
        !foto.linhas,
        "a troca de foto devia falhar com o CHECK e a linha antiga",
      );
      assert.equal(foto.codigo, "23514", foto.erro);
      assert.equal(foto.restricao, CK_NOME);
      const cpf = await P.tentar(
        "authenticated",
        "SELECT public.set_my_cpf($1)",
        [CPF_VALIDO],
        {
          uid: U.autor2,
        },
      );
      assert.ok(
        !cpf.linhas,
        "gravar o CPF devia falhar com o CHECK e a linha antiga",
      );
      assert.equal(cpf.codigo, "23514", cpf.erro);
    });
    // O pagamento do pedido dessa conta NAO depende da guarda HOJE: nenhum gatilho de marketplace_orders escreve em profiles (diferente
    // da avaliacao da 20261396200000, onde tr_compra_verifica_avaliacoes reescrevia a linha). Se um dia um gatilho do pedido passar a
    // atualizar o perfil, este caso fica vermelho e a guarda vira peca do dinheiro: avisar a revisao.
    await P.emTransacao(async () => {
      await semear();
      await antes();
      await P.conexao().query(
        "UPDATE public.profiles SET full_name = $2 WHERE id = $1",
        [U.autor2, LEGADO.nome],
      );
      await semearPedido(U.autor2);
      assert.equal(await P.aplicar(SEM_A_GUARDA), null);
      const pago = await marcarComoPago();
      assert.ok(
        pago.linhas,
        `um gatilho do pedido passou a escrever em profiles? o pagamento falhou: ${pago.erro}`,
      );
    });
    // com a migration REAL e a mesma conta antiga: recusa, nada muda, a conta segue editavel e o pagamento registra
    await P.emTransacao(async () => {
      await semear();
      await antes();
      await P.conexao().query(
        "UPDATE public.profiles SET full_name = $2 WHERE id = $1",
        [U.autor2, LEGADO.nome],
      );
      await semearPedido(U.autor2);
      await P.recusa(MIGRATION, /B1_BASELINE_DIVERGENT/);
      assert.equal(await quantas(), 0);
      const foto = await rpc(
        U.autor2,
        null,
        null,
        "data:image/jpeg;base64,AAAA",
      );
      assert.ok(foto.linhas, `apos a recusa a foto devia trocar: ${foto.erro}`);
      const cpf = await P.tentar(
        "authenticated",
        "SELECT public.set_my_cpf($1)",
        [CPF_VALIDO],
        {
          uid: U.autor2,
        },
      );
      assert.ok(cpf.linhas, `apos a recusa o CPF devia gravar: ${cpf.erro}`);
      const pago = await marcarComoPago();
      assert.ok(
        pago.linhas,
        `apos a recusa o pagamento devia registrar: ${pago.erro}`,
      );
      assert.equal(pago.linhas[0].payment_status, "pago");
    });
  },
);

prova(
  "PAGAMENTO com a migration aplicada e conta normal: marcar o pedido como pago registra (nenhum gatilho do pedido toca o perfil)",
  async () => {
    await P.emTransacao(
      async () => {
        assert.equal(await aplicado(), true);
        const pago = await marcarComoPago();
        assert.ok(pago.linhas, `o pagamento devia registrar: ${pago.erro}`);
        assert.equal(pago.linhas[0].payment_status, "pago");
      },
      async () => {
        await semear();
        await antes();
        await semearPedido(U.autor1);
        await depois();
      },
    );
  },
);

prova(
  "VALIDATE: com as restricoes aplicadas o VALIDATE passa (nao ha linha antiga); reaplicar sobre as validadas e' no-op; o rollback aceita as validadas",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await antes();
      const c = P.conexao();
      await depois();
      await c.query(
        `ALTER TABLE public.profiles VALIDATE CONSTRAINT ${CK_NOME}`,
      );
      await c.query(
        `ALTER TABLE public.profiles VALIDATE CONSTRAINT ${CK_WHATSAPP}`,
      );
      await c.query(
        `ALTER TABLE public.public_profiles VALIDATE CONSTRAINT ${CK_PUBLICO}`,
      );
      const validadas = await restricoes();
      assert.deepEqual(validadas.map((l) => l.def).sort(), [
        DEF_NOME,
        DEF_NOME,
        DEF_WHATSAPP,
      ]);
      assert.ok(validadas.every((l) => l.convalidated === true));
      await depois();
      assert.deepEqual(
        await restricoes(),
        validadas,
        "reaplicar sobre as restricoes validadas mudou algo",
      );
      await antes();
      assert.equal(
        await quantas(),
        0,
        "o rollback aceita as restricoes validadas",
      );
    });
  },
);

prova(
  "SO NOVO: o apply cria so as tres restricoes; nada mais muda (funcoes, tabelas, politicas, gatilhos, outras restricoes)",
  async () => {
    await P.emTransacao(async () => {
      await antes();
      const r0 = await P.retrato(NOVOS);
      assert.equal(await quantas(), 0);
      await depois();
      assert.equal(await aplicado(), true);
      assert.deepEqual(
        await P.retrato(NOVOS),
        r0,
        "o apply mexeu em objeto que nao era dele",
      );
    });
  },
);

// ---- MUTANTES: o mesmo roteiro sobre restricoes sabotadas fica vermelho na expectativa certa --------------------------------
const RECUSAS_DO_NOME = [
  "recusa121",
  "recusaEmoji121",
  "recusaDireto",
  "recusaAdmin",
  "recusaServico",
  "recusaSessao",
  "recusaInsert",
];
const MUTANTES = [
  [
    "nome: teto de 121",
    trocarRegra("profiles", CK_NOME, "char_length(full_name) <= 121"),
    ["recusa121", "recusaDireto", "recusaAdmin", "recusaServico"],
  ],
  [
    "nome: teto de 119",
    trocarRegra("profiles", CK_NOME, "char_length(full_name) <= 119"),
    ["ok120", "okAcento", "okEmoji", "okDireto120"],
  ],
  [
    "nome: teto de 5000",
    trocarRegra("profiles", CK_NOME, "char_length(full_name) <= 5000"),
    ["recusa121", "recusaDireto", "recusaAdmin"],
  ],
  [
    "nome: bytes em vez de caracteres",
    trocarRegra("profiles", CK_NOME, "octet_length(full_name) <= 120"),
    ["okAcento", "okEmoji"],
  ],
  [
    "nome: exige texto",
    trocarRegra(
      "profiles",
      CK_NOME,
      "full_name IS NOT NULL AND char_length(full_name) <= 120",
    ),
    ["okNulo"],
  ],
  [
    "nome: sem a regra em profiles (a copia publica ainda segura o nome longo, mas o erro vem da outra restricao)",
    tirar("profiles", CK_NOME),
    RECUSAS_DO_NOME,
  ],
  [
    "copia publica: teto de 5000",
    trocarRegra(
      "public_profiles",
      CK_PUBLICO,
      "char_length(full_name) <= 5000",
    ),
    ["recusaPublico"],
  ],
  [
    "copia publica: sem a regra",
    tirar("public_profiles", CK_PUBLICO),
    ["recusaPublico"],
  ],
  [
    "WhatsApp: teto de 21",
    trocarRegra("profiles", CK_WHATSAPP, "char_length(whatsapp) <= 21"),
    ["recusaWhats21", "recusaWhatsDireto"],
  ],
  [
    "WhatsApp: teto de 19",
    trocarRegra("profiles", CK_WHATSAPP, "char_length(whatsapp) <= 19"),
    ["okWhats20"],
  ],
  [
    "WhatsApp: teto de 5000",
    trocarRegra("profiles", CK_WHATSAPP, "char_length(whatsapp) <= 5000"),
    ["recusaWhats21", "recusaWhatsDireto"],
  ],
  [
    "WhatsApp: sem a regra",
    tirar("profiles", CK_WHATSAPP),
    ["recusaWhats21", "recusaWhatsGrande", "recusaWhatsDireto"],
  ],
];
for (const [nome, sabotagem, esperado] of MUTANTES) {
  prova(
    `MUTANTE ${nome}: o roteiro fica vermelho nas expectativas certas`,
    async () => {
      await P.emTransacao(
        async () => {
          const f = falhou(await roteiro());
          assert.ok(
            f.length > 0,
            `o mutante '${nome}' passou no roteiro inteiro`,
          );
          for (const k of esperado)
            assert.ok(
              f.includes(k),
              `o mutante '${nome}' devia reprovar ${k}, reprovou ${JSON.stringify(f)}`,
            );
        },
        async () => {
          await semear();
          await depois();
          await P.conexao().query(sabotagem);
        },
      );
    },
  );
}

// ---- MIGRATION --------------------------------------------------------------------------------------------------------------
prova(
  "reaplicar 2x e em CRLF = mesmo estado (mesmas restricoes, mesmos OIDs)",
  async () => {
    await P.emTransacao(async () => {
      await antes();
      await depois();
      const e1 = await restricoes();
      await depois();
      await depois();
      assert.deepEqual(await restricoes(), e1, "reaplicar 2x mudou o estado");
      await P.conexao().query(emCRLF(MIGRATION));
      assert.deepEqual(await restricoes(), e1, "em CRLF o estado mudou");
    });
  },
);

prova(
  "rollback: apaga so as restricoes sem tocar dado; 2x e' no-op; ida e volta termina igual; o esquema volta byte a byte",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await antes();
      const r0 = await P.retrato({}); // o esquema SEM a migration, com tudo
      await depois();
      const d0 = await dadosDosPerfis();
      const e0 = await restricoes();
      await antes();
      assert.equal(await quantas(), 0);
      assert.deepEqual(
        await dadosDosPerfis(),
        d0,
        "o rollback mexeu em perfil",
      );
      assert.deepEqual(
        await P.retrato({}),
        r0,
        "o rollback nao devolveu o esquema de antes byte a byte",
      );
      await antes();
      assert.equal(await quantas(), 0, "o segundo rollback nao foi no-op");
      await depois();
      assert.deepEqual(semOid(await restricoes()), semOid(e0));
      assert.deepEqual(await dadosDosPerfis(), d0);
      assert.equal(sha256(ROLLBACK).length, 64);
    });
  },
);

prova("pre-voo recusa SEM escrever em cada estado ruim", async () => {
  const sabotagens = [
    [
      "CHECK do nome com outra regra",
      `ALTER TABLE public.profiles ADD CONSTRAINT ${CK_NOME} CHECK (char_length(full_name) <= 60)`,
    ],
    [
      "CHECK do nome com outra coluna",
      `ALTER TABLE public.profiles ADD CONSTRAINT ${CK_NOME} CHECK (char_length(COALESCE(cpf, '')) <= 120)`,
    ],
    [
      "CHECK da copia publica com outra regra",
      `ALTER TABLE public.public_profiles ADD CONSTRAINT ${CK_PUBLICO} CHECK (char_length(full_name) <= 255)`,
    ],
    [
      "CHECK do WhatsApp com outra regra",
      `ALTER TABLE public.profiles ADD CONSTRAINT ${CK_WHATSAPP} CHECK (char_length(whatsapp) <= 30)`,
    ],
    [
      "profiles.whatsapp inexistente",
      "ALTER TABLE public.profiles RENAME COLUMN whatsapp TO telefone",
    ],
    [
      "public_profiles.full_name inexistente",
      "ALTER TABLE public.public_profiles RENAME COLUMN full_name TO nome",
    ],
  ];
  for (const [nome, sabotar] of sabotagens) {
    await P.emTransacao(
      async () => {
        await P.conexao().query(sabotar);
        const r0 = await P.retrato(NOVOS);
        const antesDeTentar = await restricoes();
        await P.recusa(MIGRATION, /B1_BASELINE_DIVERGENT/);
        assert.deepEqual(
          await P.retrato(NOVOS),
          r0,
          `pre-voo (${nome}) escreveu antes de recusar`,
        );
        assert.deepEqual(
          await restricoes(),
          antesDeTentar,
          `pre-voo (${nome}) mexeu nas restricoes`,
        );
      },
      async () => {
        await semear();
        await antes();
      },
    );
  }
});

prova(
  "a conferencia final recusa cada estrago (restricao ausente, regra trocada, outro teto) nas tres restricoes",
  async () => {
    const bloco = P.blocoDe(MIGRATION, "conferencia_20261399100000");
    const estragos = [
      ["nome ausente", tirar("profiles", CK_NOME)],
      ["copia publica ausente", tirar("public_profiles", CK_PUBLICO)],
      ["WhatsApp ausente", tirar("profiles", CK_WHATSAPP)],
      [
        "nome com teto de 500",
        trocarRegra("profiles", CK_NOME, "char_length(full_name) <= 500"),
      ],
      [
        "copia publica em bytes",
        trocarRegra(
          "public_profiles",
          CK_PUBLICO,
          "octet_length(full_name) <= 120",
        ),
      ],
      [
        "WhatsApp com teto de 21",
        trocarRegra("profiles", CK_WHATSAPP, "char_length(whatsapp) <= 21"),
      ],
    ];
    for (const [, estrago] of estragos) {
      await P.emTransacao(
        async () => {
          await P.conexao().query(estrago);
          await P.recusa(bloco, /conferencia 20261399100000/);
        },
        async () => {
          await semear();
          await depois();
        },
      );
    }
    // o bloco aceita as restricoes como foram desenhadas
    await P.emTransacao(
      async () => {
        assert.equal(await P.aplicar(bloco), null);
      },
      async () => {
        await semear();
        await depois();
      },
    );
  },
);

prova(
  "pre-voo do rollback recusa o que nao e' dele (restricao redefinida) sem apagar nada",
  async () => {
    for (const [tabela, nome, regra] of [
      ["profiles", CK_NOME, "char_length(full_name) <= 60"],
      ["public_profiles", CK_PUBLICO, "octet_length(full_name) <= 120"],
      ["profiles", CK_WHATSAPP, "char_length(whatsapp) <= 30"],
    ]) {
      await P.emTransacao(
        async () => {
          await P.conexao().query(trocarRegra(tabela, nome, regra));
          const antesDeTentar = await restricoes();
          await P.recusa(ROLLBACK, /B1_BASELINE_DIVERGENT/);
          assert.deepEqual(
            await restricoes(),
            antesDeTentar,
            `o pre-voo do rollback (${nome}: ${regra}) apagou antes de recusar`,
          );
        },
        async () => {
          await semear();
          await depois();
        },
      );
    }
  },
);

// ---- ATOMICIDADE e TRAVA (conexoes proprias; deixam o clone no estado ANTES — ficam por ULTIMO) -------------------------------
prova(
  "ATOMICIDADE: sem BEGIN, a conferencia sabotada derruba o arquivo inteiro e nao deixa restricao nenhuma",
  async () => {
    const c3 = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await c3.connect();
    try {
      await c3.query(ROLLBACK);
      assert.equal(await quantas(c3), 0);
      const i = MIGRATION.indexOf("DO $conferencia_20261399100000$");
      const quebrada =
        MIGRATION.slice(0, i) +
        MIGRATION.slice(i)
          .replace(
            "'CHECK ((char_length(whatsapp) <= 20)) NOT VALID'",
            "'CHECK ((char_length(whatsapp) <= 21)) NOT VALID'",
          )
          .replace(
            "'CHECK ((char_length(whatsapp) <= 20))')",
            "'CHECK ((char_length(whatsapp) <= 21))')",
          );
      assert.notEqual(
        quebrada,
        MIGRATION,
        "a sabotagem da conferencia nao pegou",
      );
      await assert.rejects(
        () => c3.query(quebrada),
        /conferencia 20261399100000: o CHECK de 20 caracteres do WhatsApp/,
      );
      assert.equal(
        await quantas(c3),
        0,
        "alguma restricao ficou depois da conferencia reprovar (meia aplicacao)",
      );
    } finally {
      await c3.end();
    }
  },
);

prova(
  "TRAVA: gravacao de perfil em voo faz a migration falhar limpa no lock_timeout, sem CHECK nenhum, e depois dela aplicar",
  async () => {
    await P.travaAberta({
      sqlMigracao: MIGRATION,
      gravar: async (c2) => {
        await c2.query(
          "INSERT INTO public.profiles (id, full_name, role) VALUES (gen_random_uuid(), 'em voo', 'customer')",
        );
      },
      aplicado: contador(),
    });
  },
);

prova(
  "TRAVA: gravacao em voo na copia publica (a SEGUNDA tabela a trancar) tambem falha limpa e NAO deixa os CHECKs de profiles (nada de meia aplicacao)",
  async () => {
    await P.travaAberta({
      sqlMigracao: MIGRATION,
      gravar: async (c2) => {
        await c2.query(
          "INSERT INTO public.public_profiles (id, full_name) VALUES (gen_random_uuid(), 'em voo')",
        );
      },
      aplicado: contador(),
    });
  },
);

/**
 * `travaAberta` chama `aplicado` duas vezes: depois da FALHA (tem de ser falso: nenhuma das tres restricoes pode ter ficado, nem a
 * de profiles que e' trancada antes da copia publica) e depois do SUCESSO (tem de ser verdadeiro: as tres).
 */
function contador() {
  let chamada = 0;
  return async (c) => {
    chamada += 1;
    const n = await quantas(c);
    return chamada === 1 ? n > 0 : n === 3;
  };
}

(async () => {
  await P.conectar();
  try {
    await P.executar("o-nome-do-perfil-tem-teto-no-banco");
  } finally {
    await P.conexao()
      .end()
      .catch(() => {});
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
