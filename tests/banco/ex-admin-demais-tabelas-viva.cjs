"use strict";
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Caminhos e chaves vem exclusivamente das constantes deste teste; banco exclusivamente efemero. */
/**
 * L2: 28 politicas, view gravavel e quatro RPCs. Papeis reais, JWT velho nas duas direcoes,
 * controle com rollback antigo, admin atual, cliente/anon, idempotencia, ACL/OID, rollback exato,
 * consultas oficiais e preflight fail-closed. Nao prova banco remoto nem servico HTTP de Storage.
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/ex-admin-demais-tabelas-viva.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");
const nome =
  "20261360000000_ex_admin_perde_o_acesso_na_hora_nas_demais_tabelas.sql";
const raiz = path.resolve(__dirname, "../..");
const ler = (rel) =>
  fs.readFileSync(path.join(raiz, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${nome}`);
const rollback = ler(`supabase/migrations/rollback-manual-${nome}`);
const antes = ler(
  "scripts/publicacao/consultas/82b-antes-ex-admin-nas-demais-tabelas.sql",
);
const depois = ler(
  "scripts/publicacao/consultas/82a-conferir-ex-admin-sem-acesso-nas-demais-tabelas.sql",
);
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");
const U = {
  admin: "b3600000-0000-4000-8000-000000000001",
  perfil: "b3600000-0000-4000-8000-000000000002",
  auth: "b3600000-0000-4000-8000-000000000003",
  cliente: "b3600000-0000-4000-8000-000000000004",
  outra: "b3600000-0000-4000-8000-000000000005",
};
const P = "b3600000-0000-4000-8000-000000000010";
const PA = "b3600000-0000-4000-8000-000000000011";
const Q = "b3600000-0000-4000-8000-000000000020";
const R = "b3600000-0000-4000-8000-000000000030";
const O = "b3600000-0000-4000-8000-000000000040";
let c;
async function catalogo() {
  const p = await c.query(
    `SELECT n.nspname||'.'||t.relname tabela,p.polname,p.polcmd,p.polroles,p.polpermissive,
   pg_get_expr(p.polqual,p.polrelid) qual,pg_get_expr(p.polwithcheck,p.polrelid) chk
   FROM pg_policy p JOIN pg_class t ON t.oid=p.polrelid JOIN pg_namespace n ON n.oid=t.relnamespace
   WHERE t.relname IN ('coupons','otp_verifications','produtos','product_variants','answers','questions','reviews')
      OR n.nspname='storage' ORDER BY tabela,polname`,
  );
  const f = await c.query(
    `SELECT p.oid,p.proname,replace(p.prosrc,chr(13),'') corpo,to_jsonb(p)-'prosrc' atributos
   FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
     AND p.proname IN ('answer_question_atomic','reply_review_atomic') ORDER BY p.oid`,
  );
  const v = await c.query(
    "SELECT oid,relowner,relacl,reloptions,pg_get_viewdef(oid,true) def FROM pg_class WHERE oid='public.vw_produtos_admin'::regclass",
  );
  return { politicas: p.rows, funcoes: f.rows, view: v.rows };
}
async function consulta(sql, stem, positiva) {
  await c.query("SAVEPOINT consulta");
  let rows;
  try {
    await c.query("SET LOCAL ROLE authenticated");
    rows = (await c.query(sql)).rows;
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT consulta");
    await c.query("RELEASE SAVEPOINT consulta");
  }
  assert.equal(rows.length, 36);
  assert.equal(new Set(rows.map((r) => r.item)).size, 36);
  assert.equal(
    rows.every((r) => r.ok === true),
    positiva,
    JSON.stringify(rows.filter((r) => !r.ok)),
  );
  assert.match(
    CONF.veredictoDaConsulta({
      consulta: stem,
      ref: "efemero",
      sha: "local",
      linhas: rows,
    }),
    /rol=ok/,
  );
  for (const incompleta of [rows.slice(1), [...rows, rows[0]]]) {
    assert.match(
      CONF.veredictoDaConsulta({
        consulta: stem,
        ref: "efemero",
        sha: "local",
        linhas: incompleta,
      }),
      /rol=invalido/,
    );
  }
  return rows;
}
async function aplicar(sql) {
  await c.query(sql);
}
async function como(quem, sql) {
  await c.query("SAVEPOINT acao");
  try {
    const role =
      quem === "anon"
        ? "anon"
        : quem === "servico"
          ? "service_role"
          : "authenticated";
    await c.query(`SET LOCAL ROLE ${role}`);
    const id = U[quem] || "";
    await c.query(
      "SELECT set_config('app.rpc.user_id',$1,true),set_config('request.jwt.claims',$2,true)",
      [
        id,
        JSON.stringify({
          sub: id,
          role,
          app_metadata: ["admin", "perfil", "auth"].includes(quem)
            ? { role: "admin" }
            : {},
        }),
      ],
    );
    try {
      const r = await c.query(sql);
      return { n: r.rowCount, rows: r.rows };
    } catch (e) {
      return { code: e.code, message: e.message };
    }
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT acao");
    await c.query("RELEASE SAVEPOINT acao");
  }
}
async function semear() {
  // auth.role e a emulacao da plataforma no provisionar (na fabrica e NULL); aqui espelha o JWT real.
  await c.query(
    `CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $stub$
   SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $stub$`,
  );
  await c.query(
    "GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role",
  );
  for (const [k, id] of Object.entries(U)) {
    await c.query(
      "INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES($1,$2,$3)",
      [
        id,
        `${k}@exemplo.invalid`,
        JSON.stringify(
          ["admin", "perfil"].includes(k) ? { role: "admin" } : {},
        ),
      ],
    );
    await c.query(
      "INSERT INTO public.profiles(id,full_name,role) VALUES($1,$2,$3)",
      [id, k, ["admin", "auth"].includes(k) ? "admin" : "customer"],
    );
  }
  // O gatilho de profiles sincroniza auth.users: os papeis contraditorios nascem DEPOIS dele.
  await c.query(
    'UPDATE auth.users SET raw_app_meta_data=\'{"role":"admin"}\'::jsonb WHERE id=$1',
    [U.perfil],
  );
  await c.query(
    'UPDATE auth.users SET raw_app_meta_data=\'{"role":"customer"}\'::jsonb WHERE id=$1',
    [U.auth],
  );
  const fontes = (
    await c.query(
      "SELECT p.id,p.role,u.raw_app_meta_data->>'role' auth_role FROM public.profiles p JOIN auth.users u ON u.id=p.id WHERE p.id IN ($1,$2) ORDER BY p.id",
      [U.perfil, U.auth],
    )
  ).rows;
  assert.deepEqual(
    fontes.map((f) => [f.role, f.auth_role]),
    [
      ["customer", "admin"],
      ["admin", "customer"],
    ],
  );
  await c.query(
    "INSERT INTO public.produtos(id,nome,preco_venda,estoque,ativo,custo) VALUES($1,'L2 pausado',10,10,false,2),($2,'L2 ativo',10,10,true,2)",
    [P, PA],
  );
  await c.query(
    "INSERT INTO public.product_variants(product_id,name,value,stock_increment) VALUES($1,'Tamanho','M',2)",
    [P],
  );
  await c.query(
    "INSERT INTO public.questions(id,product_id,user_id,question) VALUES($1,$2,$3,'Tem M?')",
    [Q, P, U.cliente],
  );
  await c.query(
    "INSERT INTO public.answers(question_id,user_id,answer) VALUES($1,$2,'Sim')",
    [Q, U.admin],
  );
  await c.query(
    "INSERT INTO public.reviews(id,product_id,user_id,rating,comment,status) VALUES($1,$2,$3,5,'Otimo','pendente')",
    [R, P, U.cliente],
  );
  await c.query(
    "INSERT INTO public.coupons(code,type,value,active) VALUES('L2FIXTURE','percentage',100,true)",
  );
  await c.query(
    "INSERT INTO public.marketplace_orders(id,customer_name,customer_data,total,subtotal,status,user_id) VALUES($1,'Pessoa ficticia','{}',10,10,'pending',$2)",
    [O, U.cliente],
  );
  await c.query(
    "INSERT INTO public.otp_verifications(email,whatsapp,otp_code,expires_at,order_id) VALUES('pessoa@exemplo.invalid','11900000000','123456',now()+interval '15 min',$1)",
    [O],
  );
  for (const bucket of ["products", "banners", "branding", "devolucoes"]) {
    await c.query("INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)", [
      bucket,
      `${U.cliente}/foto.png`,
    ]);
  }
}
const escritas = [
  [
    "cupom INSERT 100%",
    "INSERT INTO public.coupons(code,type,value) VALUES('L2NOVO','percentage',100)",
  ],
  [
    "cupom UPDATE",
    "UPDATE public.coupons SET value=100 WHERE code='L2FIXTURE'",
  ],
  ["cupom DELETE", "DELETE FROM public.coupons WHERE code='L2FIXTURE'"],
  [
    "OTP INSERT",
    `INSERT INTO public.otp_verifications(email,whatsapp,otp_code,expires_at,order_id) VALUES('nova@exemplo.invalid','11900000000','654321',now()+interval '1 min','${O}')`,
  ],
  ["OTP UPDATE", "UPDATE public.otp_verifications SET attempts=2"],
  ["OTP DELETE", "DELETE FROM public.otp_verifications"],
  [
    "produto INSERT",
    "INSERT INTO public.produtos(nome,preco_venda,estoque,ativo) VALUES('L2 novo',10,1,true)",
  ],
  [
    "produto UPDATE",
    `UPDATE public.produtos SET nome='L2 alterado' WHERE id='${P}'`,
  ],
  ["produto DELETE", `DELETE FROM public.produtos WHERE id='${P}'`],
  [
    "variante INSERT",
    `INSERT INTO public.product_variants(product_id,name,value) VALUES('${P}','Cor','Verde')`,
  ],
  [
    "variante UPDATE",
    `UPDATE public.product_variants SET value='G' WHERE product_id='${P}'`,
  ],
  [
    "variante DELETE",
    `DELETE FROM public.product_variants WHERE product_id='${P}'`,
  ],
  [
    "resposta INSERT",
    `INSERT INTO public.answers(question_id,user_id,answer) VALUES('${Q}','${U.admin}','Outra') ON CONFLICT(question_id) DO UPDATE SET answer=EXCLUDED.answer`,
  ],
  [
    "resposta UPDATE",
    `UPDATE public.answers SET answer='Nova' WHERE question_id='${Q}'`,
  ],
  ["resposta DELETE", `DELETE FROM public.answers WHERE question_id='${Q}'`],
  [
    "pergunta UPDATE",
    `UPDATE public.questions SET question='Nova?' WHERE id='${Q}'`,
  ],
  ["pergunta DELETE", `DELETE FROM public.questions WHERE id='${Q}'`],
  [
    "avaliacao UPDATE",
    `UPDATE public.reviews SET merchant_reply='Nova' WHERE id='${R}'`,
  ],
  ["avaliacao DELETE", `DELETE FROM public.reviews WHERE id='${R}'`],
  [
    "view UPDATE",
    `UPDATE public.vw_produtos_admin SET nome='L2 view' WHERE id='${P}'`,
  ],
  [
    "view INSERT",
    "INSERT INTO public.vw_produtos_admin(nome,preco_venda,estoque,ativo) VALUES('L2 pela view',10,1,true)",
  ],
  ...["products", "banners", "branding"].map((bucket) => [
    `storage INSERT ${bucket}`,
    `INSERT INTO storage.objects(bucket_id,name) VALUES('${bucket}','nova.png')`,
  ]),
  ["storage UPDATE", "UPDATE storage.objects SET name='atualizada.png'"],
  ["storage DELETE", "DELETE FROM storage.objects"],
];
const rpcs = [
  `SELECT public.answer_question_atomic('${Q}','Nova')`,
  `SELECT public.answer_question_atomic('${Q}','Nova','${U.admin}')`,
  `SELECT public.reply_review_atomic('${R}','Nova')`,
  `SELECT public.reply_review_atomic('${R}','Nova','${U.admin}')`,
];
async function comportamento(novo) {
  const papelProduto = (
    await c.query(
      "SELECT polroles=ARRAY['authenticated'::regrole::oid] auth FROM pg_policy WHERE polrelid='public.produtos'::regclass AND polname='produtos_select_policy'",
    )
  ).rows[0].auth;
  assert.equal(
    papelProduto,
    novo,
    "somente a politica de leitura direta muda de PUBLIC para authenticated",
  );
  const qualOTP = (
    await c.query(
      "SELECT pg_get_expr(polqual,polrelid) q FROM pg_policy WHERE polrelid='public.otp_verifications'::regclass AND polname='Admins full access on otp_verifications'",
    )
  ).rows[0].q;
  for (const quem of ["perfil", "auth"]) {
    assert.equal(
      (await como(quem, `SELECT (${qualOTP}) ok`)).rows[0].ok,
      !novo,
      "politica OTP endurecida, sem reabrir ACL",
    );
  }
  for (const quem of ["perfil", "auth"]) {
    for (const [nome, sql] of escritas) {
      const r = await como(quem, sql);
      if (nome.startsWith("OTP")) {
        assert.equal(r.code, "42501", "OTP ja fechado pelo GRANT anterior");
      } else if (novo) {
        assert(
          r.n === 0 ||
            r.code === "42501" ||
            (nome === "view INSERT" && r.code === "44000"),
          `${nome} ${quem} ${JSON.stringify(r)}`,
        );
      } else {
        // RPCs antigas de 2 args ja recusavam quem perdeu profiles; as escritas RLS nao recusavam.
        assert(r.n > 0, `${nome} controle ${quem} ${JSON.stringify(r)}`);
      }
    }
    for (const sql of rpcs) {
      const r = await como(quem, sql);
      if (novo) {
        assert.match(
          r.message || "",
          /Unauthorized/,
          `${sql} ${quem} ${JSON.stringify(r)}`,
        );
      }
    }
    for (const sql of [
      "SELECT code FROM public.coupons",
      `SELECT id FROM public.produtos WHERE id='${P}'`,
      `SELECT id FROM public.vw_produtos_admin WHERE id='${P}'`,
      `SELECT id FROM public.reviews WHERE id='${R}'`,
      "SELECT id FROM storage.objects WHERE bucket_id='devolucoes'",
    ]) {
      const r = await como(quem, sql);
      assert.equal(
        r.n,
        novo ? 0 : 1,
        `${quem} leitura ${sql} ${JSON.stringify(r)}`,
      );
    }
  }
  for (const [nome, sql] of escritas) {
    const r = await como("admin", sql);
    if (nome.startsWith("OTP")) {
      assert.equal(r.code, "42501", "OTP permanece fechado inclusive ao admin");
    } else assert(r.n > 0, `${nome} admin ${JSON.stringify(r)}`);
  }
  for (const sql of rpcs) assert.equal((await como("admin", sql)).n, 1, sql);
  assert.equal(
    (
      await como(
        "cliente",
        "SELECT id FROM storage.objects WHERE bucket_id='devolucoes'",
      )
    ).n,
    1,
  );
  assert.equal(
    (
      await como(
        "outra",
        "SELECT id FROM storage.objects WHERE bucket_id='devolucoes'",
      )
    ).n,
    0,
  );
  assert.equal(
    (await como("cliente", `SELECT id FROM public.reviews WHERE id='${R}'`)).n,
    1,
  );
  assert.equal(
    (
      await como(
        "anon",
        `SELECT id FROM public.vw_produtos_public WHERE id='${PA}'`,
      )
    ).n,
    1,
    "anon le produto ativo pela vitrine sem EXECUTE da porta",
  );
  assert.equal(
    (
      await como(
        "anon",
        `SELECT id FROM public.vw_produtos_public WHERE id='${P}'`,
      )
    ).n,
    0,
  );
  for (const quem of ["perfil", "auth", "admin", "cliente", "anon"]) {
    assert.equal(
      (await como(quem, "SELECT otp_code FROM public.otp_verifications")).code,
      "42501",
      "OTP sem GRANT, antes e depois",
    );
  }
  // O service_role do provisionar e NOLOGIN sem BYPASSRLS; nao emula o bypass do Supabase.
  assert.equal(
    (await como("servico", "SELECT otp_code FROM public.otp_verifications")).n,
    0,
  );
  assert.equal(
    (await como("servico", "SELECT public.rls_admin_atual() ok")).rows[0].ok,
    true,
  );
}
async function main() {
  c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL search_path=pg_catalog,public");
    // A fabrica local omite este USAGE, presente no Supabase e necessario ao catalogo da consulta.
    await c.query(
      "GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role",
    );
    const esta = (
      await c.query(
        "SELECT pg_get_expr(polqual,polrelid) LIKE '%rls_admin_atual%' sim FROM pg_policy WHERE polname='coupons_select_policy'",
      )
    ).rows[0].sim;
    if (esta) await aplicar(rollback);
    const original = await catalogo();
    await consulta(antes, "82b-antes-ex-admin-nas-demais-tabelas", true);
    await consulta(
      depois,
      "82a-conferir-ex-admin-sem-acesso-nas-demais-tabelas",
      false,
    );
    await semear();
    await comportamento(false);
    console.log(
      "[L2] controle antigo reproduz acesso indevido nas duas fontes",
    );
    await aplicar(migration);
    const atual = await catalogo();
    assert.deepEqual(
      atual.funcoes.map((f) => f.atributos),
      original.funcoes.map((f) => f.atributos),
      "OID/ACL/atributos identicos",
    );
    assert.deepEqual(
      atual.view.map(({ def, ...m }) => m),
      original.view.map(({ def, ...m }) => m),
      "ACL/dono/opcoes da view identicos",
    );
    await comportamento(true);
    console.log(
      "[L2] JWT velho recusado; admin atual, cliente, anon e servico preservados",
    );
    await consulta(
      depois,
      "82a-conferir-ex-admin-sem-acesso-nas-demais-tabelas",
      true,
    );
    await consulta(antes, "82b-antes-ex-admin-nas-demais-tabelas", false);
    await aplicar(migration);
    assert.deepEqual(await catalogo(), atual);
    await aplicar(migration.replace(/\n/g, "\r\n"));
    // prosrc pode guardar CRLF; o contrato compara somente o transporte sem CR.
    const sabotagens = [
      "DROP POLICY coupons_admin_insert_policy ON public.coupons",
      "ALTER POLICY produtos_select_policy ON public.produtos TO public",
      "GRANT SELECT(id) ON public.produtos TO anon",
      "ALTER POLICY coupons_admin_insert_policy ON public.coupons WITH CHECK (false)",
      "ALTER POLICY coupons_admin_update_policy ON public.coupons TO anon",
      "ALTER TABLE public.produtos FORCE ROW LEVEL SECURITY",
      "ALTER FUNCTION public.reply_review_atomic(uuid,text) SECURITY INVOKER",
      "GRANT EXECUTE ON FUNCTION public.answer_question_atomic(uuid,text) TO PUBLIC",
      "GRANT EXECUTE ON FUNCTION public.is_admin_atual() TO authenticated",
      "ALTER VIEW public.vw_produtos_admin SET (security_invoker=true)",
      "CREATE FUNCTION public.reply_review_atomic(uuid) RETURNS void LANGUAGE sql AS 'SELECT NULL::void'",
    ];
    for (const sql of sabotagens) {
      await c.query("SAVEPOINT sabotagem");
      await c.query(sql);
      const antesFalha = await catalogo();
      await c.query("SAVEPOINT tentativa");
      await assert.rejects(() => aplicar(migration), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT tentativa");
      assert.deepEqual(await catalogo(), antesFalha);
      await c.query("ROLLBACK TO SAVEPOINT sabotagem");
      await c.query("RELEASE SAVEPOINT sabotagem");
    }
    await aplicar(rollback);
    assert.deepEqual(
      await catalogo(),
      original,
      "rollback exato de corpos, politicas, view, OID e ACL",
    );
    await c.query("SAVEPOINT repetido");
    await assert.rejects(() => aplicar(rollback), /B1_BASELINE_DIVERGENT/);
    await c.query("ROLLBACK TO SAVEPOINT repetido");
    console.log(
      "[L2] 36 itens por consulta; reaplicacao LF/CRLF; 11 sabotagens sem escrita; rollback exato e repetido recusado",
    );
  } finally {
    await c.query("ROLLBACK");
    await c.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
