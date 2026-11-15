"use strict";

/**
 * PROVA VIVA da migration 20261399940000_o_cadastro_cria_o_perfil_em_toda_loja.sql contra o Postgres EFEMERO (clone do
 * rodar-isolado.cjs: a arvore migrada). Nunca banco de loja. Esqueleto: tests/banco/prova-de-objeto-novo.cjs; a irma e'
 * o-nome-do-perfil-tem-teto-no-banco-viva.cjs (20261399100000).
 *
 * O defeito: a loja clonada do baseline (a Savy) nao tem o gatilho on_auth_user_created de auth.users (o baseline despeja so o schema
 * public), entao o cadastro entra SEM PERFIL (Perfil sem dados, CPF do cadastro sem gravar). O conserto: cria o gatilho (so se ausente)
 * e insere o perfil de quem ja se cadastrou sem ele.
 *
 * ATENCAO: o efemero das outras provas deixa o gatilho DESLIGADO (tests/banco/aplicar-migrations.cjs: elas semeiam auth.users e depois
 * INSERT em profiles a mao). Aqui o estado ANTES e' o rollback (gatilho ausente) e o DEPOIS e' rollback + migration (gatilho LIGADO,
 * criado pela propria migration); nada depende do estado em que o clone nasceu.
 *
 *  ANTES       controle: sem o gatilho o cadastro nao cria perfil (o defeito).
 *  DEPOIS      o cadastro cria o perfil (nome do metadado full_name, senao name, senao 'Usuario'; phone vira whatsapp; cpf; papel customer;
 *              copia em public_profiles; papel customer em raw_app_meta_data); o gatilho e' o da loja principal (AFTER INSERT por
 *              linha, public.handle_new_user(), mesma definicao de pg_get_triggerdef); nome de 121 caracteres e telefone de 21 sao
 *              recusados no cadastro (os tetos da 20261399100000), 120/20 entram; um papel SEM EXECUTE na funcao (a ACL endurecida da
 *              20261090500000) ainda cria o perfil.
 *  REPARO      quem ja tinha se cadastrado sem perfil ganha o perfil; quem JA TEM perfil nao muda (linha inteira igual); usuario com papel
 *              admin sem perfil NAO ganha perfil (nem o papel dele muda); nome/telefone acima do teto nao derruba a migration (fica sem
 *              perfil); o NOTICE conta cada grupo. Mutantes (sem filtro de papel, sem o NOT EXISTS, sem o filtro de tamanho, gatilho BEFORE)
 *              FICAM VERMELHOS na expectativa certa.
 *  SO NOVO     o apply cria so o gatilho: nenhuma funcao, tabela, politica, gatilho, restricao ou ACL de public muda.
 *  MIGRATION   reaplicar (2x) e CRLF = mesmo estado e 0 perfis novos; gatilho desligado de antes e' aceito e nao e' religado; rollback tira
 *              so o gatilho (perfis ficam), 2x no-op, ida e volta igual; o pre-voo recusa SEM escrever (gatilho homonimo diferente, funcao
 *              sem SECURITY DEFINER, coluna ausente); a conferencia final recusa cada estrago; o pre-voo do rollback recusa o que nao
 *              e' dele; consultas 149a/149b.
 *  ATOMICIDADE conexao SEM BEGIN: a conferencia sabotada derruba o arquivo inteiro (sem gatilho e sem perfil reparado); gravacao em voo em
 *              auth.users faz a migration FALHAR LIMPA no lock_timeout e depois aplica.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-cadastro-cria-o-perfil-em-toda-loja-viva.cjs
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova, emCRLF } = P;
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const NOME = "20261399940000_o_cadastro_cria_o_perfil_em_toda_loja.sql";
const MIGRATION = P.lerMigration(NOME);
const ROLLBACK = P.lerMigration(`rollback-manual-${NOME}`);
const GATILHO = "on_auth_user_created";
const DEF_DA_PRINCIPAL =
  "CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user()";

const ID = (n) => `b1399930-0000-4000-8000-00000000000${n}`;
const U = {
  u1: ID(1),
  u2: ID(2),
  u3: ID(3),
  u4: ID(4),
  u5: ID(5),
  u6: ID(6),
  u7: ID(7),
  novo: ID(9),
};
const CPF1 = "52998224725"; // CPF de teste conhecido (digitos verificadores corretos)
const CPF3 = "11144477735";

const q = (sql, params = []) => P.conexao().query(sql, params);
const antes = () => q(ROLLBACK);
const depois = async () => {
  await q(ROLLBACK); // o clone pode ter nascido com o gatilho (desligado): parte sempre de "ausente"
  await q(MIGRATION); // e a PROPRIA migration o cria (ligado)
};

/** Um usuario de auth.users (o que o Supabase Auth grava no cadastro). `meta` null = sem metadado. */
async function usuario(id, { meta = null, app = {} } = {}) {
  await q(
    "INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES ($1::uuid, $1::text || '@399930.teste', $2::jsonb, $3::jsonb)",
    [id, JSON.stringify(app), meta === null ? null : JSON.stringify(meta)],
  );
}

/** Lojista antiga: usuarios que se cadastraram SEM o gatilho (estado ANTES), mais um que ja tem perfil. */
async function semearLegado() {
  await usuario(U.u1, {
    meta: { full_name: "Cadastro Um", phone: "(11) 91234-5678", cpf: CPF1 },
  });
  await usuario(U.u2, {
    meta: { name: "Cadastro Dois" },
    app: { role: "customer" },
  });
  await usuario(U.u3, { meta: { full_name: "Nome do Metadado" } });
  await q(
    "INSERT INTO public.profiles (id, full_name, whatsapp, cpf, role) VALUES ($1, 'Ja Tinha', '(21) 99999-0000', $2, 'customer')",
    [U.u3, CPF3],
  );
  await usuario(U.u4, {
    meta: { full_name: "Gerente Sem Perfil" },
    app: { role: "admin" },
  });
  await usuario(U.u5, { meta: { full_name: "n".repeat(121) } });
  await usuario(U.u6, {
    meta: { full_name: "Telefone Longo", phone: "9".repeat(21) },
  });
  await usuario(U.u7, { meta: null });
}

/** O retrato dos DADOS e dos gatilhos de auth.users: o que a migration pode mudar so por INSERT de perfil. */
async function foto(c = P.conexao()) {
  const l = async (sql) => (await c.query(sql)).rows;
  return {
    perfis: await l("SELECT * FROM public.profiles ORDER BY id"),
    publicos: await l("SELECT * FROM public.public_profiles ORDER BY id"),
    // a linha inteira em jsonb: continua valendo quando um pre-voo e' sabotado por RENAME de coluna
    usuarios: await l(
      "SELECT u.id, to_jsonb(u) AS linha FROM auth.users u ORDER BY u.id",
    ),
    gatilhos: await l(
      "SELECT tgname, tgtype, tgenabled, tgfoid::regproc::text AS f FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal ORDER BY 1",
    ),
  };
}
const perfil = (f, id) => f.perfis.find((p) => p.id === id);
const publico = (f, id) => f.publicos.find((p) => p.id === id);
const app = (f, id) =>
  f.usuarios.find((u) => u.id === id).linha.raw_app_meta_data;
const temGatilho = async (c = P.conexao()) =>
  (
    await c.query(
      "SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND tgname = $1 AND NOT tgisinternal",
      [GATILHO],
    )
  ).rows[0].n === 1;

/** O cadastro como o Supabase Auth faz: um INSERT em auth.users (com o erro que o gatilho der, sem derrubar a transacao). */
const cadastrar = (id, meta, papel = null) =>
  P.tentar(
    papel,
    "INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES ($1::uuid, $1::text || '@399930.teste', '{}'::jsonb, $2::jsonb) RETURNING id",
    [id, meta === null ? null : JSON.stringify(meta)],
  );

// ---- o roteiro do REPARO, parametrizado pelo texto da migration (para os mutantes) -----------------------------------------------
const avisos = [];
async function roteiro(sql) {
  return P.emTransacao(
    async () => {
      const f0 = await foto();
      avisos.length = 0;
      const r = await P.aplicar(sql);
      return { r, f0, f1: await foto(), avisos: [...avisos] };
    },
    async () => {
      await antes();
      await semearLegado();
    },
  );
}
/** Quais expectativas do reparo NAO se cumpriram (vazio = o comportamento desta migration). */
function falhas({ r, f0, f1 }) {
  const f = [];
  const ok = (rotulo, cond) => {
    if (!cond) f.push(rotulo);
  };
  ok("a migration aplicou", r === null);
  const p1 = perfil(f1, U.u1);
  ok(
    "u1 ganhou o perfil com os dados do cadastro",
    Boolean(p1) &&
      p1.full_name === "Cadastro Um" &&
      p1.whatsapp === "(11) 91234-5678" &&
      p1.cpf === CPF1 &&
      p1.role === "customer",
  );
  ok(
    "u2 ganhou o perfil pelo metadado name",
    perfil(f1, U.u2)?.full_name === "Cadastro Dois",
  );
  const p7 = perfil(f1, U.u7);
  ok(
    "u7 (sem metadado) ganhou o perfil 'Usuário'",
    Boolean(p7) &&
      p7.full_name === "Usuário" &&
      p7.whatsapp === null &&
      p7.cpf === null,
  );
  ok(
    "a copia publica dos tres reparados foi criada",
    [U.u1, U.u2, U.u7].every((id) => publico(f1, id)),
  );
  ok(
    "u3 (que ja tinha perfil) ficou com a linha inteira igual",
    JSON.stringify(perfil(f1, U.u3)) === JSON.stringify(perfil(f0, U.u3)) &&
      JSON.stringify(publico(f1, U.u3)) === JSON.stringify(publico(f0, U.u3)),
  );
  ok(
    "u4 (admin sem perfil) continua sem perfil e com o papel dele",
    !perfil(f1, U.u4) &&
      JSON.stringify(app(f1, U.u4)) === JSON.stringify(app(f0, U.u4)),
  );
  ok(
    "u5 (nome de 121) e u6 (telefone de 21) continuam sem perfil",
    !perfil(f1, U.u5) && !perfil(f1, U.u6),
  );
  ok("exatamente 3 perfis novos", f1.perfis.length === f0.perfis.length + 3);
  ok(
    "os reparados ganharam role customer em raw_app_meta_data e os outros nao mudaram",
    app(f1, U.u1).role === "customer" &&
      app(f1, U.u7).role === "customer" &&
      [U.u3, U.u5, U.u6].every(
        (id) => JSON.stringify(app(f1, id)) === JSON.stringify(app(f0, id)),
      ),
  );
  ok(
    "o gatilho foi criado, ligado",
    f1.gatilhos.some(
      (g) => g.tgname === GATILHO && g.tgenabled === "O" && g.tgtype === 5,
    ),
  );
  return f;
}

/** O trecho do INSERT do reparo, para os mutantes mexerem so nele. */
function noInsert(sql, fn) {
  const i = sql.indexOf(
    "INSERT INTO public.profiles (id, full_name, whatsapp, cpf, role)",
  );
  const j = sql.indexOf("ON CONFLICT (id) DO NOTHING;", i);
  assert.ok(i > 0 && j > i, "o INSERT do reparo nao foi achado");
  const bloco = sql.slice(i, j + "ON CONFLICT (id) DO NOTHING;".length);
  const novo = fn(bloco);
  assert.notEqual(novo, bloco, "o mutante nao pegou");
  return sql.slice(0, i) + novo + sql.slice(i + bloco.length);
}

// ---------------------------------------------------------------------------------------------------------------------------------
prova(
  "ANTES (controle): sem o gatilho o cadastro NAO cria perfil — o defeito da Savy",
  async () => {
    await P.emTransacao(
      async () => {
        assert.equal(await temGatilho(), false);
        const r = await cadastrar(U.novo, {
          full_name: "Maria Teste",
          phone: "(11) 91234-5678",
          cpf: CPF1,
        });
        assert.ok(r.linhas, `o cadastro em si funciona: ${r.erro}`);
        const f = await foto();
        assert.ok(
          f.usuarios.some((u) => u.id === U.novo),
          "o usuario nasceu",
        );
        assert.equal(
          perfil(f, U.novo),
          undefined,
          "sem o gatilho nao ha perfil",
        );
      },
      async () => {
        await antes();
      },
    );
  },
);

prova(
  "DEPOIS: o cadastro cria o perfil (nome, telefone, CPF, papel customer, copia publica, papel no metadado)",
  async () => {
    await P.emTransacao(
      async () => {
        assert.ok(
          (
            await cadastrar(U.u1, {
              full_name: "Maria Teste",
              phone: "(11) 91234-5678",
              cpf: CPF1,
            })
          ).linhas,
        );
        assert.ok((await cadastrar(U.u2, { name: "So Name" })).linhas);
        assert.ok(
          (
            await cadastrar(U.u3, {
              name: "Outro Nome",
              full_name: "Full Vence",
            })
          ).linhas,
        );
        assert.ok((await cadastrar(U.u7, null)).linhas);
        assert.ok((await cadastrar(U.u6, { phone: "(21) 98888-7777" })).linhas);
        const f = await foto();
        const p1 = perfil(f, U.u1);
        assert.equal(p1.full_name, "Maria Teste");
        assert.equal(p1.whatsapp, "(11) 91234-5678");
        assert.equal(p1.cpf, CPF1);
        assert.equal(p1.role, "customer");
        assert.equal(publico(f, U.u1).full_name, "Maria Teste");
        assert.equal(
          app(f, U.u1).role,
          "customer",
          "o gatilho de papel grava customer no metadado",
        );
        assert.equal(
          perfil(f, U.u2).full_name,
          "So Name",
          "sem full_name, vale name",
        );
        assert.equal(
          perfil(f, U.u3).full_name,
          "Full Vence",
          "full_name vence name",
        );
        const p7 = perfil(f, U.u7);
        assert.equal(p7.full_name, "Usuário", "sem metadado nenhum, 'Usuário'");
        assert.equal(p7.whatsapp, null);
        assert.equal(p7.cpf, null);
        assert.equal(
          perfil(f, U.u6).full_name,
          "Usuário",
          "so telefone no metadado",
        );
        assert.equal(perfil(f, U.u6).whatsapp, "(21) 98888-7777");
      },
      async () => {
        await depois();
      },
    );
  },
);

prova(
  "DEPOIS: o gatilho e' o da loja principal (mesma definicao, AFTER INSERT por linha, ligado) e e' o unico que chama handle_new_user",
  async () => {
    await P.emTransacao(
      async () => {
        const r = (
          await q(
            `SELECT pg_get_triggerdef(t.oid) AS d, t.tgenabled, t.tgtype
             FROM pg_trigger t WHERE t.tgrelid = 'auth.users'::regclass AND t.tgname = $1 AND NOT t.tgisinternal`,
            [GATILHO],
          )
        ).rows;
        assert.equal(r.length, 1);
        // pg_get_triggerdef qualifica a funcao conforme o search_path da sessao: so isso e' normalizado
        assert.equal(r[0].d.replaceAll("public.", ""), DEF_DA_PRINCIPAL);
        assert.equal(r[0].tgenabled, "O");
        assert.equal(r[0].tgtype, 5);
        const n = (
          await q(
            "SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal AND tgfoid = 'public.handle_new_user()'::regprocedure",
          )
        ).rows[0].n;
        assert.equal(n, 1);
      },
      async () => {
        await depois();
      },
    );
  },
);

prova(
  "DEPOIS: nome de 121 caracteres ou telefone de 21 sao RECUSADOS no cadastro (tetos da 20261399100000); 120 e 20 entram",
  async () => {
    await P.emTransacao(
      async () => {
        const longo = await cadastrar(U.u5, { full_name: "n".repeat(121) });
        assert.equal(longo.codigo, "23514", `nome de 121: ${longo.erro}`);
        assert.equal(longo.restricao, "profiles_full_name_ate_120_caracteres");
        const tel = await cadastrar(U.u6, { phone: "9".repeat(21) });
        assert.equal(tel.codigo, "23514", `telefone de 21: ${tel.erro}`);
        assert.equal(tel.restricao, "profiles_whatsapp_ate_20_caracteres");
        const f = await foto();
        assert.ok(
          !f.usuarios.some((u) => u.id === U.u5 || u.id === U.u6),
          "o cadastro recusado nao deixa usuario sem perfil",
        );
        assert.ok(
          (
            await cadastrar(U.u1, {
              full_name: "n".repeat(120),
              phone: "9".repeat(20),
            })
          ).linhas,
        );
        assert.equal(perfil(await foto(), U.u1).full_name.length, 120);
      },
      async () => {
        await depois();
      },
    );
  },
);

prova(
  "GRANTS: um papel SEM EXECUTE em handle_new_user (a ACL endurecida da 20261090500000) ainda cria o perfil no cadastro",
  async () => {
    await P.emTransacao(
      async () => {
        const acl = (
          await q(
            "SELECT has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE') AS anon, has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE') AS auth",
          )
        ).rows[0];
        assert.deepEqual(
          acl,
          { anon: false, auth: false },
          "o clone devia ter a ACL endurecida da 20261090500000",
        );
        await q("CREATE ROLE r_cadastro_399930 NOLOGIN");
        await q("GRANT USAGE ON SCHEMA auth TO r_cadastro_399930");
        await q("GRANT INSERT, SELECT ON auth.users TO r_cadastro_399930");
        assert.equal(
          (
            await q(
              "SELECT has_function_privilege('r_cadastro_399930', 'public.handle_new_user()', 'EXECUTE') AS ok",
            )
          ).rows[0].ok,
          false,
        );
        const r = await cadastrar(
          U.u1,
          { full_name: "Por Papel Sem Execute" },
          "r_cadastro_399930",
        );
        assert.ok(r.linhas, `o INSERT por papel sem EXECUTE falhou: ${r.erro}`);
        assert.equal(
          perfil(await foto(), U.u1).full_name,
          "Por Papel Sem Execute",
        );
      },
      async () => {
        await depois();
      },
    );
  },
);

prova(
  "REPARO: quem se cadastrou sem perfil ganha; quem tem perfil nao muda; admin sem perfil e cadastro acima do teto ficam de fora; o NOTICE conta",
  async () => {
    const res = await roteiro(MIGRATION);
    assert.deepEqual(falhas(res), []);
    const aviso = res.avisos.find((a) => a.includes("20261399940000:"));
    assert.ok(aviso, `sem NOTICE: ${JSON.stringify(res.avisos)}`);
    assert.match(aviso, /: 3 perfil\(is\) criado\(s\)/);
    assert.match(aviso, /; 1 usuário\(s\) sem perfil com outro papel/);
    assert.match(aviso, / e 2 com nome ou telefone acima do teto/);
  },
);

prova(
  "REPARO, loja vazia ou sem ninguem sem perfil: nao escreve nada e avisa 0",
  async () => {
    await P.emTransacao(
      async () => {
        const f0 = await foto();
        avisos.length = 0;
        assert.equal(await P.aplicar(MIGRATION), null);
        const f1 = await foto();
        assert.deepEqual({ ...f1, gatilhos: [] }, { ...f0, gatilhos: [] });
        assert.match(
          avisos.find((a) => a.includes("20261399940000:")),
          /: 0 perfil\(is\) criado\(s\)/,
        );
      },
      async () => {
        await antes();
        await usuario(U.u3, { meta: { full_name: "Ja Tem" } });
        await q(
          "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Ja Tem', 'customer')",
          [U.u3],
        );
      },
    );
  },
);

prova(
  "MUTANTES do reparo: sem o filtro de papel, sem o NOT EXISTS, sem o filtro de tamanho e com gatilho BEFORE FICAM VERMELHOS na expectativa certa",
  async () => {
    // (1) sem o filtro de papel: o admin sem perfil ganha um perfil customer
    const semPapel = noInsert(MIGRATION, (b) =>
      b.replace(
        "     AND COALESCE(u.raw_app_meta_data->>'role', 'customer') = 'customer'\n",
        "",
      ),
    );
    assert.ok(
      falhas(await roteiro(semPapel)).includes(
        "u4 (admin sem perfil) continua sem perfil e com o papel dele",
      ),
      "sem o filtro de papel o admin deveria ganhar perfil",
    );
    // (2) sem o NOT EXISTS (e com DO UPDATE): o perfil que ja existia e' sobrescrito
    const semNotExists = noInsert(MIGRATION, (b) =>
      b
        .replace(
          "WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)\n     AND ",
          "WHERE ",
        )
        .replace(
          "ON CONFLICT (id) DO NOTHING;",
          "ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;",
        ),
    );
    assert.ok(
      falhas(await roteiro(semNotExists)).includes(
        "u3 (que ja tinha perfil) ficou com a linha inteira igual",
      ),
      "sem o NOT EXISTS o perfil existente deveria mudar",
    );
    // (3) sem o filtro de tamanho: um cadastro acima do teto derruba a migration inteira (23514)
    const semTamanho = noInsert(MIGRATION, (b) =>
      b
        .replace(
          "     AND char_length(COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', 'Usuário')) <= 120\n",
          "",
        )
        .replace(
          "     AND COALESCE(char_length(u.raw_user_meta_data->>'phone'), 0) <= 20\n",
          "",
        ),
    );
    const r3 = await roteiro(semTamanho);
    assert.ok(
      r3.r && r3.r.codigo === "23514",
      `sem o filtro de tamanho devia abortar com 23514: ${JSON.stringify(r3.r)}`,
    );
    assert.ok(falhas(r3).includes("a migration aplicou"));
    // (4) gatilho BEFORE em vez de AFTER: a conferencia final recusa
    const antesDoInsert = MIGRATION.replace(
      "AFTER INSERT ON auth.users\n      FOR EACH ROW",
      "BEFORE INSERT ON auth.users\n      FOR EACH ROW",
    );
    assert.notEqual(antesDoInsert, MIGRATION);
    const r4 = await roteiro(antesDoInsert);
    assert.ok(
      r4.r && /conferencia 20261399940000: o gatilho/.test(r4.r.erro),
      JSON.stringify(r4.r),
    );
  },
);

prova(
  "SO NOVO: o apply cria so o gatilho — nenhuma funcao, tabela, politica, gatilho, restricao ou ACL de public muda",
  async () => {
    await P.emTransacao(
      async () => {
        const r0 = await P.retrato();
        const g0 = (await foto()).gatilhos;
        assert.equal(await P.aplicar(MIGRATION), null);
        assert.deepEqual(await P.retrato(), r0);
        const g1 = (await foto()).gatilhos;
        assert.deepEqual(g0, []);
        assert.deepEqual(
          g1.map((g) => g.tgname),
          [GATILHO],
        );
      },
      async () => {
        await antes();
      },
    );
  },
);

prova("REAPLICAR 2x e em CRLF = mesmo estado, com 0 perfis novos", async () => {
  await P.emTransacao(
    async () => {
      const f1 = await foto();
      avisos.length = 0;
      assert.equal(await P.aplicar(MIGRATION), null);
      assert.deepEqual(await foto(), f1, "a 2a aplicacao mudou algo");
      assert.match(
        avisos.find((a) => a.includes("20261399940000:")),
        /: 0 perfil\(is\) criado\(s\)/,
      );
      assert.equal(await P.aplicar(emCRLF(MIGRATION)), null);
      assert.deepEqual(await foto(), f1, "a aplicacao em CRLF mudou algo");
    },
    async () => {
      await antes();
      await semearLegado();
      await depois(); // o reparo ja rodou uma vez
    },
  );
});

prova(
  "gatilho DESLIGADO de antes (como o efemero das provas) e' aceito: a migration e' no-op e NAO o religa",
  async () => {
    await P.emTransacao(
      async () => {
        await q("ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created");
        const f1 = await foto();
        assert.equal(f1.gatilhos[0].tgenabled, "D");
        assert.equal(await P.aplicar(MIGRATION), null);
        assert.deepEqual(await foto(), f1);
      },
      async () => {
        await depois();
      },
    );
  },
);

prova(
  "ROLLBACK: tira SO o gatilho, os perfis reparados ficam, 2x e' no-op e a ida e volta e' igual",
  async () => {
    await P.emTransacao(
      async () => {
        const comGatilho = await foto();
        assert.ok(await temGatilho());
        assert.equal(await P.aplicar(ROLLBACK), null);
        assert.equal(await temGatilho(), false);
        const sem = await foto();
        assert.deepEqual(
          { ...sem, gatilhos: [] },
          { ...comGatilho, gatilhos: [] },
          "o rollback tocou dado",
        );
        assert.ok(perfil(sem, U.u1), "o perfil reparado tem de ficar");
        assert.equal(await P.aplicar(ROLLBACK), null);
        assert.deepEqual(await foto(), sem, "o 2o rollback mudou algo");
        assert.equal(await P.aplicar(MIGRATION), null);
        assert.deepEqual(await foto(), comGatilho, "ida e volta diferente");
      },
      async () => {
        await antes();
        await semearLegado();
        await depois();
      },
    );
  },
);

const SABOTAGENS_DE_GATILHO = [
  [
    "gatilho homonimo que chama OUTRA funcao",
    `CREATE FUNCTION public.prova_outro_gatilho() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$;
     CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.prova_outro_gatilho()`,
  ],
  [
    "gatilho homonimo BEFORE INSERT",
    "CREATE TRIGGER on_auth_user_created BEFORE INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()",
  ],
  [
    "gatilho homonimo com condicao WHEN",
    "CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW WHEN (new.email IS NOT NULL) EXECUTE FUNCTION public.handle_new_user()",
  ],
  [
    "gatilho homonimo tambem no UPDATE",
    "CREATE TRIGGER on_auth_user_created AFTER INSERT OR UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()",
  ],
];

prova(
  "PRE-VOO recusa SEM escrever em cada estado ruim (gatilho homonimo diferente, funcao sem SECURITY DEFINER, coluna ausente)",
  async () => {
    const sabotagens = [
      ...SABOTAGENS_DE_GATILHO,
      [
        "handle_new_user sem SECURITY DEFINER",
        "ALTER FUNCTION public.handle_new_user() SECURITY INVOKER",
      ],
      [
        "auth.users sem raw_user_meta_data",
        "ALTER TABLE auth.users RENAME COLUMN raw_user_meta_data TO meta",
      ],
      [
        "profiles sem a coluna cpf",
        "ALTER TABLE public.profiles RENAME COLUMN cpf TO documento",
      ],
    ];
    for (const [nome, sabotar] of sabotagens) {
      await P.emTransacao(
        async () => {
          await q(sabotar);
          const f0 = await foto();
          const r0 = await P.retrato();
          await P.recusa(MIGRATION, /B1_BASELINE_DIVERGENT/);
          assert.deepEqual(
            await foto(),
            f0,
            `pre-voo (${nome}) escreveu antes de recusar`,
          );
          assert.deepEqual(
            await P.retrato(),
            r0,
            `pre-voo (${nome}) mexeu no esquema`,
          );
        },
        async () => {
          await antes();
          await semearLegado(); // o reparo NAO pode rodar: quem esta sem perfil continua sem
        },
      );
    }
  },
);

prova(
  "a conferencia final recusa cada estrago (gatilho ausente, gatilho trocado, usuario de cliente sem perfil) e aceita o estado certo e o admin sem perfil",
  async () => {
    const bloco = P.blocoDe(MIGRATION, "conferencia_20261399940000");
    const estragos = [
      [
        /o gatilho on_auth_user_created/,
        `DROP TRIGGER ${GATILHO} ON auth.users`,
      ],
      [
        /o gatilho on_auth_user_created/,
        `DROP TRIGGER ${GATILHO} ON auth.users; CREATE TRIGGER ${GATILHO} BEFORE INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()`,
      ],
      [
        /ainda h. usu.rio de cliente sem perfil/,
        `SET LOCAL session_replication_role = replica;
       INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES ('${U.novo}'::uuid, 'x@399930.teste', '{}'::jsonb, '{"full_name":"Sem Perfil"}'::jsonb);
       SET LOCAL session_replication_role = origin`,
      ],
    ];
    for (const [padrao, estrago] of estragos) {
      await P.emTransacao(
        async () => {
          await q(estrago);
          await P.recusa(bloco, padrao);
        },
        async () => {
          await depois();
        },
      );
    }
    await P.emTransacao(
      async () => {
        assert.equal(
          await P.aplicar(bloco),
          null,
          "o estado certo (com admin e cadastro longo sem perfil de fora) devia passar",
        );
      },
      async () => {
        await antes();
        await semearLegado();
        await depois();
      },
    );
  },
);

prova(
  "pre-voo do rollback recusa o gatilho que nao e' dele, sem apagar nada",
  async () => {
    for (const [nome, sabotar] of SABOTAGENS_DE_GATILHO) {
      await P.emTransacao(
        async () => {
          await q(`DROP TRIGGER ${GATILHO} ON auth.users`);
          await q(sabotar);
          const g0 = (await foto()).gatilhos;
          await P.recusa(ROLLBACK, /B1_BASELINE_DIVERGENT/);
          assert.deepEqual(
            (await foto()).gatilhos,
            g0,
            `o rollback (${nome}) apagou antes de recusar`,
          );
        },
        async () => {
          await depois();
        },
      );
    }
  },
);

const A149 = "149a-conferir-o-cadastro-cria-o-perfil-em-toda-loja-aplicado";
const B149 = "149b-antes-o-cadastro-cria-o-perfil-em-toda-loja-ausente";
prova(
  "consultas 149a/149b nos dois sentidos, com o rol fechado, e cada linha reprova no estrago certo",
  async () => {
    await P.emTransacao(
      async () => {
        assert.deepEqual(await P.consulta(A149), [], "149a no estado DEPOIS");
        assert.equal(
          (await P.consulta(B149)).length,
          1,
          "149b depois do apply devia reprovar so a linha do gatilho ausente",
        );
        await antes();
        assert.deepEqual(await P.consulta(B149), [], "149b no estado ANTES");
        const naoAplicado = await P.consulta(A149);
        assert.equal(
          naoAplicado.length,
          3,
          `149a no estado ANTES: ${JSON.stringify(naoAplicado)}`,
        );
        await depois();
        for (const [estrago, linha] of [
          [
            "ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created",
            /LIGADO/,
          ],
          [
            `DROP TRIGGER ${GATILHO} ON auth.users`,
            /gatilho on_auth_user_created existe/,
          ],
          [
            `DROP TRIGGER ${GATILHO} ON auth.users; CREATE TRIGGER ${GATILHO} BEFORE INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()`,
            /gatilho on_auth_user_created existe/,
          ],
          [
            "CREATE TRIGGER prova_concorrente AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()",
            /so existe UM gatilho/,
          ],
          [
            "ALTER FUNCTION public.handle_new_user() SECURITY INVOKER",
            /SECURITY DEFINER/,
          ],
          [
            `SET LOCAL session_replication_role = replica;
           INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES ('${U.novo}'::uuid, 'x@399930.teste', '{}'::jsonb, '{"full_name":"Sem Perfil"}'::jsonb);
           SET LOCAL session_replication_role = origin`,
            /nenhum usuario de cliente/,
          ],
        ]) {
          await q("SAVEPOINT estrago");
          await q(estrago);
          const reprovadas = await P.consulta(A149);
          assert.ok(
            reprovadas.some((i) => linha.test(i)),
            `a 149a nao reprovou a linha certa para '${estrago.slice(0, 70)}': ${JSON.stringify(reprovadas)}`,
          );
          await q("ROLLBACK TO SAVEPOINT estrago");
        }
        // admin sem perfil, de fora do reparo, NAO reprova a 149a
        await q(
          `SET LOCAL session_replication_role = replica;
         INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES ('${U.u4}'::uuid, 'adm@399930.teste', '{"role":"admin"}'::jsonb, '{"full_name":"Admin"}'::jsonb);
         SET LOCAL session_replication_role = origin`,
        );
        assert.deepEqual(
          await P.consulta(A149),
          [],
          "admin sem perfil nao e' cliente",
        );
      },
      async () => {
        await depois();
      },
    );
  },
);

// ---- ATOMICIDADE e TRAVA (conexoes proprias; deixam o clone no estado ANTES — ficam por ULTIMO) -------------------------------
prova(
  "ATOMICIDADE: sem BEGIN, a conferencia sabotada derruba o arquivo inteiro: nem gatilho nem perfil reparado ficam",
  async () => {
    const c3 = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await c3.connect();
    try {
      await c3.query(ROLLBACK);
      await c3.query(
        "INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES ($1::uuid, 'a@399930.teste', '{}'::jsonb, '{\"full_name\":\"Atomica\"}'::jsonb)",
        [U.u1],
      );
      assert.equal(await temGatilho(c3), false);
      const i = MIGRATION.indexOf("DO $conferencia_20261399940000$");
      const quebrada =
        MIGRATION.slice(0, i) +
        MIGRATION.slice(i).replace("AND t.tgtype = 5", "AND t.tgtype = 6");
      assert.notEqual(
        quebrada,
        MIGRATION,
        "a sabotagem da conferencia nao pegou",
      );
      await assert.rejects(
        () => c3.query(quebrada),
        /conferencia 20261399940000: o gatilho/,
      );
      assert.equal(
        await temGatilho(c3),
        false,
        "o gatilho ficou depois da conferencia reprovar (meia aplicacao)",
      );
      const n = (
        await c3.query(
          "SELECT count(*)::int AS n FROM public.profiles WHERE id = $1",
          [U.u1],
        )
      ).rows[0].n;
      assert.equal(
        n,
        0,
        "o perfil reparado ficou depois da conferencia reprovar (meia aplicacao)",
      );
      await c3.query("DELETE FROM auth.users WHERE id = $1", [U.u1]);
    } finally {
      await c3.end();
    }
  },
);

prova(
  "TRAVA: gravacao em voo em auth.users faz a migration falhar limpa no lock_timeout, sem gatilho, e depois dela aplicar",
  async () => {
    await P.travaAberta({
      sqlMigracao: MIGRATION,
      gravar: async (c2) => {
        await c2.query(
          "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES (gen_random_uuid(), 'voo@399930.teste', '{}'::jsonb)",
        );
      },
      aplicado: (c) => temGatilho(c),
    });
  },
);

(async () => {
  await P.conectar();
  P.conexao().on("notice", (m) => avisos.push(m.message));
  try {
    await P.executar("o-cadastro-cria-o-perfil-em-toda-loja");
  } finally {
    await P.conexao()
      .end()
      .catch(() => {});
  }
})();
