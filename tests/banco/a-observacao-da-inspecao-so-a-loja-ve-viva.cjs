"use strict";

/**
 * Prova VIVA da migration 20261404000000 (a "Observação da inspeção" da devolução é só da loja) num Postgres EFÊMERO, com os papéis de verdade
 * (SET LOCAL ROLE authenticated / anon / service_role + claims) e as funções e políticas reais de toda a fila de migrations.
 *
 *  O DEFEITO     (estado ANTES, com o rollback aplicado) a cliente dona da devolução lê a nota interna da loja por DUAS portas: a RPC
 *                devolucao_detalhe (linha inteira) e a leitura direta da coluna (GRANT SELECT na tabela inteira).
 *  A CORREÇÃO    (estado DEPOIS) (i) a RPC não traz a chave para a cliente; (ii) SELECT observacao_inspecao e SELECT * dão permission denied;
 *                (iii) as outras colunas, os itens, a trilha e a política de fotos seguem funcionando para ela; (iv) o admin atual continua
 *                recebendo a nota pela RPC e a lista do painel segue; (v) outra cliente não vê nada; (vi) admin REBAIXADO que também é dono não
 *                recebe a nota; (vii) service_role continua lendo; (viii) admin_devolucao_concluir continua GRAVANDO a nota.
 *  DADO EXISTENTE a nota gravada ANTES da migration continua gravada e o admin a recebe; a cliente deixa de recebê-la.
 *  MIGRATION     o corpo novo é o vigente com SÓ a troca declarada; o rollback traz o vigente byte a byte; reaplicar (LF, CRLF) = mesmo estado;
 *                o rollback devolve o ESTADO de antes (corpo md5/sha256, ACL, atributos, ACL da tabela e das colunas) e o segundo recusa;
 *                o pré-voo recusa cada estado ruim; o pós-voo recusa o REVOKE que não revogou (grant de outro grantor) e a migration INTEIRA
 *                cai junto (conexão SEM BEGIN: o arquivo vai como UMA mensagem), inclusive o corpo da função.
 *  MUTANTES      sem o filtro da RPC; sem o REVOKE/GRANT por coluna; REVOKE sem o GRANT; filtro invertido; filtro pelo JWT em vez do papel
 *                ATUAL; chave errada no filtro; migration sem a conferência diante do grant de outro grantor: cada um fica VERMELHO na guarda certa.
 *
 * Só Postgres EFÊMERO e só clone descartável (rodar-isolado.cjs): ela confirma COMMIT na parte de atomicidade.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-observacao-da-inspecao-so-a-loja-ve-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos são das migrations do próprio repositório e os índices vêm de listas fechadas deste arquivo, nunca de entrada de rede. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");
const {
  detectarTransacaoExplicita,
  removerRuido,
} = require("../../scripts/db-prove-rollback.cjs");

const ARQ = "20261404000000_a_observacao_da_inspecao_so_a_loja_ve.sql";
const ORIGEM =
  "20261399992000_o_item_que_nao_veio_pode_ser_devolvido_de_novo.sql";
const H_ANTES = "a439e320641d553e3a21883c6606c6f2";
const H_DEPOIS = "b4eb7a928f8a6ff04c34e93f4f56188c";
const SIG = "public.devolucao_detalhe(uuid)";
const NOTA = "NOTA INTERNA DA LOJA: caixa amassada, peca com cheiro de uso";
const NOTA_ADMIN = "NOTA ESCRITA AGORA PELA LOJA ao concluir";

const MIGRATIONS = path.join(__dirname, "..", "..", "supabase", "migrations");
const norm = (s) => s.replace(/\r\n/g, "\n");
const emCRLF = (s) => norm(s).replace(/\n/g, "\r\n");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const lerMigration = (nome) =>
  norm(fs.readFileSync(path.join(MIGRATIONS, nome), "utf8"));

const url = lerDatabaseUrlEfemera();
if (!/\/prova_[a-z0-9_]+$/.test(new URL(url).pathname)) {
  falhar(
    "RECUSADO",
    "esta prova confirma COMMIT (parte de atomicidade): rode por tests/banco/rodar-isolado.cjs, que a executa num clone descartavel.",
  );
}

// ---------------------------------------------------------------------------
// O TEXTO: o corpo novo e' o vigente com SO a troca declarada; o rollback traz o vigente byte a byte
// ---------------------------------------------------------------------------
const MIGRATION = lerMigration(ARQ);
const ROLLBACK = lerMigration(`rollback-manual-${ARQ}`);
const ORIGEM_SQL = lerMigration(ORIGEM);

/** Do `CREATE OR REPLACE FUNCTION public.devolucao_detalhe(` ao `$$;`: { cabeca (ate o `$$` de abertura), corpo }. */
function funcaoDe(sql) {
  const ini = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.devolucao_detalhe(",
  );
  assert.ok(ini >= 0, "declaracao de devolucao_detalhe nao achada");
  assert.equal(
    sql.split("CREATE OR REPLACE FUNCTION public.devolucao_detalhe(").length -
      1,
    1,
    "uma so declaracao",
  );
  const ab = sql.indexOf("$$", ini) + 2;
  const fim = sql.indexOf("$$", ab);
  return {
    cabeca: sql.slice(ini, ab),
    corpo: sql.slice(ab, fim),
    texto: sql.slice(ini, fim + 3),
  };
}
const VIGENTE = funcaoDe(ORIGEM_SQL);
const NOVA = funcaoDe(MIGRATION);
const ROL = funcaoDe(ROLLBACK);

const TROCA_DE = "  RETURN to_jsonb(v_d) || jsonb_build_object(\n";
const TROCA_PARA =
  '  -- 20261404000000: a "Observação da inspeção" é INTERNA da loja; só o admin ATUAL a recebe (a cliente dona da devolução recebe o resto, sem a chave).\n' +
  "  RETURN CASE WHEN public.is_admin_atual() THEN to_jsonb(v_d) ELSE to_jsonb(v_d) - 'observacao_inspecao' END || jsonb_build_object(\n";
/** O inverso, escrito a parte: desfaz a troca declarada e tem de dar o vigente byte a byte. */
const inverso = (corpo) => {
  assert.equal(corpo.split(TROCA_PARA).length - 1, 1, "a troca nao e' unica");
  return corpo.replace(TROCA_PARA, () => TROCA_DE);
};

assert.equal(
  md5(VIGENTE.corpo),
  H_ANTES,
  "o corpo vigente (20261399992000) mudou",
);
assert.equal(md5(NOVA.corpo), H_DEPOIS, "o corpo desta migration mudou");
assert.equal(
  inverso(NOVA.corpo),
  VIGENTE.corpo,
  "o corpo novo nao e' o vigente com SO a troca declarada",
);
assert.equal(
  ROL.corpo,
  VIGENTE.corpo,
  "o rollback nao traz o corpo vigente byte a byte",
);
assert.equal(
  NOVA.cabeca,
  VIGENTE.cabeca,
  "a declaracao mudou (assinatura, atributos)",
);
assert.equal(ROL.cabeca, VIGENTE.cabeca, "a declaracao do rollback mudou");
for (const [nome, sql] of [
  [ARQ, MIGRATION],
  [`rollback-manual-${ARQ}`, ROLLBACK],
]) {
  const t = detectarTransacaoExplicita(removerRuido(sql));
  assert.ok(
    !t.begin && !t.commit && !t.rollback,
    `${nome}: BEGIN/COMMIT/ROLLBACK de nivel superior`,
  );
}
for (const h of [H_ANTES, H_DEPOIS])
  assert.ok(MIGRATION.includes(h), `a migration nao cita o hash ${h}`);
// Os pedacos, para montar os mutantes.
const pedaco = (sql, ini, fimMarca) => {
  const a = sql.indexOf(ini);
  assert.ok(a >= 0, `pedaco ${ini} nao achado`);
  const b = sql.indexOf(fimMarca, a);
  assert.ok(b > a, `fim do pedaco ${ini} nao achado`);
  return sql.slice(a, b + fimMarca.length);
};
const P_FUNC = `${NOVA.texto};`;
const P_REVOGA = pedaco(
  MIGRATION,
  "DO $revoga_20261404000000$",
  "END $revoga_20261404000000$;",
);
const P_GRANT = pedaco(
  MIGRATION,
  "GRANT SELECT (\n  id,",
  ") ON public.devolucoes TO authenticated;",
);
const P_POS = pedaco(
  MIGRATION,
  "DO $posvoo_20261404000000$",
  "END $posvoo_20261404000000$;",
);
assert.equal(P_GRANT.split(",\n").length, 34, "o GRANT lista 34 colunas");
assert.ok(
  !P_GRANT.includes("observacao_inspecao"),
  "o GRANT nao pode listar a observacao",
);

// ---------------------------------------------------------------------------
// Fixtures (ids fixos desta prova; tudo dentro de UMA transacao desfeita no fim)
// ---------------------------------------------------------------------------
const id = (grupo, n) =>
  `7e404000-${grupo}-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = id("0000", 1);
const CLIENTE = id("0000", 2);
const OUTRA = id("0000", 3);
const REBAIXADO = id("0000", 4);
const PRODUTO = id("0001", 1);
const PED = {
  cliente: id("0002", 1),
  aberta: id("0002", 2),
  outra: id("0002", 3),
  reb: id("0002", 4),
};
const DEV = {
  cliente: id("0003", 1),
  aberta: id("0003", 2),
  outra: id("0003", 3),
  reb: id("0003", 4),
};
const CLAIMS_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});
const CLAIMS_CLIENTE = JSON.stringify({ role: "authenticated" });
const CLAIMS_SERVICO = JSON.stringify({ role: "service_role" });

const novoCliente = async () => {
  const c = new Client({ connectionString: url });
  await c.connect();
  return c;
};

async function semear(c) {
  // O service_role da fabrica do Supabase tem BYPASSRLS; o do efemero nao. Dentro desta transacao (desfeita no fim) ele passa a ter.
  await c.query("ALTER ROLE service_role BYPASSRLS");
  await c.query(
    `INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
       ($1,'admin404@fixture.test','{"role":"admin"}'),($2,'cliente404@fixture.test','{}'),
       ($3,'outra404@fixture.test','{}'),($4,'reb404@fixture.test','{"role":"admin"}')
     ON CONFLICT DO NOTHING`,
    [ADMIN, CLIENTE, OUTRA, REBAIXADO],
  );
  // REBAIXADO: o auth.users ainda diz admin e o JWT dele tambem, mas profiles.role ja nao (is_admin_atual() exige os dois).
  await c.query(
    `INSERT INTO public.profiles(id,full_name,role) VALUES
       ($1,'Admin 404','admin'),($2,'Cliente 404','customer'),($3,'Outra 404','customer'),($4,'Rebaixado 404','customer')
     ON CONFLICT DO NOTHING`,
    [ADMIN, CLIENTE, OUTRA, REBAIXADO],
  );
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis)
     VALUES ($1,'Produto 404',10,100,true,5,false) ON CONFLICT (id) DO NOTHING`,
    [PRODUTO],
  );
  const donos = {
    cliente: CLIENTE,
    aberta: CLIENTE,
    outra: OUTRA,
    reb: REBAIXADO,
  };
  for (const k of Object.keys(PED)) {
    await c.query(
      `INSERT INTO public.marketplace_orders
         (id,user_id,customer_name,customer_data,total,subtotal,shipping,status,canal,payment_method,payment_status,paid_at,
          pagamento_recebido_em,gateway_payment_id,valor_estornado)
       VALUES ($1,$2,'Fixture 404','{}',100,100,0,'delivered','online','online','pago',now(),now(),$3,0)`,
      [PED[k], donos[k], `ORD404-${k}`],
    );
    // Estas notas ja existiam ANTES da migration (o dado que ja estava la).
    const concluida = k !== "aberta";
    await c.query(
      `INSERT INTO public.devolucoes
         (id,protocolo,order_id,user_id,tipo,motivo,resolucao_desejada,resolucao_final,modalidade,metodo_retorno,status,valor_itens,
          valor_frete_ida,prazo_ate,politica,observacao_inspecao,concluida_em,mensagem_loja)
       VALUES ($1,$2,$3,$4,'arrependimento','outro','troca',$5,'nacional','envio_proprio',$6,40,0,current_date+7,'{}',$7,$8,'mensagem pensada para a cliente')`,
      [
        DEV[k],
        `DEV404-${k}`,
        PED[k],
        donos[k],
        concluida ? "troca" : null,
        concluida ? "concluida" : "recebida",
        concluida ? `${NOTA} (${k})` : null,
        concluida ? new Date().toISOString() : null,
      ],
    );
    const oi = (
      await c.query(
        `INSERT INTO public.marketplace_order_items (order_id, product_id, variant_id, product_name, quantity, price)
         VALUES ($1,$2,NULL,'Item 404',1,10) RETURNING id`,
        [PED[k], PRODUTO],
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO public.devolucao_itens (devolucao_id, order_item_id, product_id, variant_id, product_name, quantidade, valor_unitario)
       VALUES ($1,$2,$3,NULL,'Item 404',1,10)`,
      [DEV[k], oi, PRODUTO],
    );
    await c.query(
      `INSERT INTO public.devolucao_eventos (devolucao_id, de_status, para_status, ator, nota) VALUES ($1,NULL,'solicitada','cliente','oi')`,
      [DEV[k]],
    );
  }
}

// ---------------------------------------------------------------------------
// Como cada papel: SAVEPOINT por consulta (um erro nao derruba a transacao), RESET ROLE no fim
// ---------------------------------------------------------------------------
const QUEM = {
  admin: { uid: ADMIN, papel: "authenticated", claims: CLAIMS_ADMIN },
  cliente: { uid: CLIENTE, papel: "authenticated", claims: CLAIMS_CLIENTE },
  outra: { uid: OUTRA, papel: "authenticated", claims: CLAIMS_CLIENTE },
  // O JWT dele ainda diz admin; o papel ATUAL (profiles) ja nao.
  rebaixado: { uid: REBAIXADO, papel: "authenticated", claims: CLAIMS_ADMIN },
  servico: { uid: null, papel: "service_role", claims: CLAIMS_SERVICO },
  anon: { uid: null, papel: "anon", claims: "{}" },
};
async function como(c, quem, sql, params = []) {
  const q = QUEM[quem];
  await c.query("SAVEPOINT como");
  try {
    await c.query(
      "SELECT set_config('app.rpc.user_id',$1,true), set_config('request.jwt.claims',$2,true)",
      [q.uid ?? "", q.claims],
    );
    await c.query(`SET LOCAL ROLE ${q.papel}`);
    const r = await c.query(sql, params);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT como");
    return { ok: true, rows: r.rows };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT como");
    await c.query("RELEASE SAVEPOINT como");
    return { ok: false, erro: e.code, msg: e.message };
  }
}
const detalhe = (c, quem, dev) =>
  como(c, quem, "SELECT public.devolucao_detalhe($1::uuid) AS j", [dev]);
const temChave = (r) =>
  r.ok &&
  Object.prototype.hasOwnProperty.call(r.rows[0].j, "observacao_inspecao");

/** A medida: tudo o que a prova afirma, num objeto (cada afirmacao do DEPOIS e' calculada de um campo daqui). */
async function medir(c) {
  const m = {};
  const dCli = await detalhe(c, "cliente", DEV.cliente);
  m.cli_rpc = dCli;
  m.cli_rpc_tem_chave = temChave(dCli);
  const dAdm = await detalhe(c, "admin", DEV.cliente);
  m.adm_rpc = dAdm;
  m.adm_rpc_obs = dAdm.ok ? dAdm.rows[0].j.observacao_inspecao : undefined;
  // O resto do retorno e' o MESMO para as duas: as chaves da cliente = as do admin menos a observacao.
  m.cli_resto_igual =
    dCli.ok && dAdm.ok
      ? JSON.stringify(Object.keys(dCli.rows[0].j).sort()) ===
          JSON.stringify(
            Object.keys(dAdm.rows[0].j)
              .filter((k) => k !== "observacao_inspecao")
              .sort(),
          ) &&
        JSON.stringify(dCli.rows[0].j.itens) ===
          JSON.stringify(dAdm.rows[0].j.itens) &&
        JSON.stringify(dCli.rows[0].j.eventos) ===
          JSON.stringify(dAdm.rows[0].j.eventos) &&
        JSON.stringify(dCli.rows[0].j.pedido) ===
          JSON.stringify(dAdm.rows[0].j.pedido) &&
        dCli.rows[0].j.mensagem_loja === "mensagem pensada para a cliente" &&
        dCli.rows[0].j.id === DEV.cliente
      : false;
  m.cli_direta_obs = await como(
    c,
    "cliente",
    "SELECT observacao_inspecao FROM public.devolucoes WHERE id = $1",
    [DEV.cliente],
  );
  m.cli_direta_estrela = await como(
    c,
    "cliente",
    "SELECT * FROM public.devolucoes WHERE id = $1",
    [DEV.cliente],
  );
  m.cli_direta_filtro_pela_obs = await como(
    c,
    "cliente",
    "SELECT id FROM public.devolucoes WHERE observacao_inspecao IS NOT NULL",
  );
  m.cli_colunas = await como(
    c,
    "cliente",
    "SELECT id, status, protocolo, valor_reembolso, fotos, mensagem_loja, concluida_em FROM public.devolucoes ORDER BY protocolo",
  );
  m.cli_itens = await como(
    c,
    "cliente",
    "SELECT count(*)::int AS n FROM public.devolucao_itens",
  );
  m.cli_eventos = await como(
    c,
    "cliente",
    "SELECT count(*)::int AS n FROM public.devolucao_eventos",
  );
  m.cli_fotos_soltas = await como(
    c,
    "cliente",
    "SELECT public.devolucao__fotos_soltas_da_conta($1::uuid, 30) AS n",
    [CLIENTE],
  );
  m.adm_lista = await como(
    c,
    "admin",
    "SELECT public.admin_devolucoes_listar(NULL, NULL, 50, 0) AS j",
  );
  m.adm_direta_obs = await como(
    c,
    "admin",
    "SELECT observacao_inspecao FROM public.devolucoes WHERE id = $1",
    [DEV.cliente],
  );
  m.outra_rpc = await detalhe(c, "outra", DEV.cliente);
  m.outra_direta = await como(
    c,
    "outra",
    "SELECT id FROM public.devolucoes WHERE id = $1",
    [DEV.cliente],
  );
  m.outra_rpc_propria = await detalhe(c, "outra", DEV.outra);
  const dReb = await detalhe(c, "rebaixado", DEV.reb);
  m.reb_rpc = dReb;
  m.reb_rpc_tem_chave = temChave(dReb);
  m.reb_em_devolucao_alheia = await detalhe(c, "rebaixado", DEV.cliente);
  m.servico_direta_obs = await como(
    c,
    "servico",
    "SELECT observacao_inspecao FROM public.devolucoes WHERE id = $1",
    [DEV.cliente],
  );
  m.anon_direta = await como(c, "anon", "SELECT id FROM public.devolucoes");
  // (viii) o admin conclui a devolucao aberta com uma observacao NOVA: a funcao (dono) continua gravando; leitura por papel.
  await c.query("SAVEPOINT concluir");
  const item = (
    await c.query(
      "SELECT id FROM public.devolucao_itens WHERE devolucao_id = $1",
      [DEV.aberta],
    )
  ).rows[0].id;
  const conc = await como(
    c,
    "admin",
    "SELECT public.admin_devolucao_concluir($1::uuid, 'troca', $2::jsonb, NULL, $3) AS r",
    [
      DEV.aberta,
      JSON.stringify([{ item_id: item, condicao: "nova", reestocar: false }]),
      NOTA_ADMIN,
    ],
  );
  m.concluir = conc;
  m.gravada = (
    await c.query(
      "SELECT observacao_inspecao AS o FROM public.devolucoes WHERE id = $1",
      [DEV.aberta],
    )
  ).rows[0]?.o;
  m.apos_concluir_cli = temChave(await detalhe(c, "cliente", DEV.aberta));
  const dAdmAberta = await detalhe(c, "admin", DEV.aberta);
  m.apos_concluir_adm = dAdmAberta.ok
    ? dAdmAberta.rows[0].j.observacao_inspecao
    : undefined;
  await c.query("ROLLBACK TO SAVEPOINT concluir");
  await c.query("RELEASE SAVEPOINT concluir");
  return m;
}

/** As afirmacoes do DEPOIS, nomeadas; devolve a lista das que FALHAM. (O ANTES e os mutantes tem de reprovar as certas.) */
function falhas(m, outras) {
  const f = [];
  const nega = (res, codigo) => !res.ok && res.erro === codigo;
  // (i) a RPC nao traz a chave para a cliente e o resto do retorno e' o mesmo.
  // (inclui a dona na devolucao que o admin acabou de concluir com nota nova, e a outra cliente na dela)
  if (
    !(
      m.cli_rpc.ok &&
      !m.cli_rpc_tem_chave &&
      m.cli_resto_igual &&
      m.apos_concluir_cli === false &&
      m.outra_rpc_propria.ok &&
      !temChave(m.outra_rpc_propria)
    )
  )
    f.push("i_rpc_sem_a_chave");
  // (ii) a leitura direta da coluna (e o SELECT *) da cliente e' negada; filtrar pela coluna tambem.
  if (
    !(
      nega(m.cli_direta_obs, "42501") &&
      nega(m.cli_direta_estrela, "42501") &&
      nega(m.cli_direta_filtro_pela_obs, "42501")
    )
  )
    f.push("ii_leitura_direta_negada");
  // (iii) o resto segue funcionando para ela: colunas, itens, trilha, fotos soltas.
  if (
    !(
      m.cli_colunas.ok &&
      m.cli_colunas.rows.length === 2 &&
      m.cli_itens.ok &&
      m.cli_itens.rows[0].n === 2 &&
      m.cli_eventos.ok &&
      m.cli_eventos.rows[0].n === 2 &&
      m.cli_fotos_soltas.ok
    )
  )
    f.push("iii_o_resto_segue_lendo");
  // (iv) o admin atual continua recebendo a nota pela RPC e a lista do painel segue.
  if (
    !(
      m.adm_rpc.ok &&
      m.adm_rpc_obs === `${NOTA} (cliente)` &&
      m.adm_lista.ok &&
      m.adm_lista.rows[0].j.total >= 4
    )
  )
    f.push("iv_admin_recebe_a_nota");
  // (v) outra cliente nao ve nada (RPC recusa; a leitura direta nao enxerga a linha) e a dela segue como a dela.
  if (
    !(
      nega(m.outra_rpc, "P0002") &&
      m.outra_direta.ok &&
      m.outra_direta.rows.length === 0 &&
      m.outra_rpc_propria.ok
    )
  )
    f.push("v_outra_cliente_nao_ve");
  // (vi) admin REBAIXADO (JWT admin, profiles customer): na devolucao dele nao recebe a nota; na alheia continua recusado.
  if (
    !(
      m.reb_rpc.ok &&
      !m.reb_rpc_tem_chave &&
      nega(m.reb_em_devolucao_alheia, "P0002")
    )
  )
    f.push("vi_rebaixado_nao_recebe");
  // (vii) service_role (edge functions) continua lendo a coluna; anon nunca leu a tabela.
  if (
    !(
      m.servico_direta_obs.ok &&
      m.servico_direta_obs.rows[0]?.observacao_inspecao ===
        `${NOTA} (cliente)` &&
      nega(m.anon_direta, "42501")
    )
  )
    f.push("vii_servico_le_e_anon_nao");
  // (viii) a conclusao da devolucao continua GRAVANDO a nota, e o admin a recebe (a cliente nao: ver (i)).
  if (
    !(
      m.concluir.ok &&
      m.gravada === NOTA_ADMIN &&
      m.apos_concluir_adm === NOTA_ADMIN
    )
  )
    f.push("viii_concluir_grava_e_o_admin_le");
  // (ix) por desenho, o admin tambem nao le a coluna DIRETO pelo PostgREST (o painel le por RPC): so informativo, fixo no DEPOIS.
  if (!(outras?.pularIx || nega(m.adm_direta_obs, "42501")))
    f.push("ix_admin_direto_negado_por_desenho");
  return f;
}

/** O ESTADO: corpo (md5 sem \r, md5 e sha256 do texto cru), atributos/OID/dono/ACL da funcao, ACL da tabela e das colunas, matriz EFETIVA de leitura. */
async function estado(c) {
  const fn = (
    await c.query(
      `SELECT md5(replace(prosrc, E'\\r', '')) AS h, md5(prosrc) AS raw, encode(sha256(convert_to(prosrc,'UTF8')),'hex') AS sha,
              to_jsonb(p) - 'prosrc' AS attrs
         FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
      [SIG],
    )
  ).rows[0];
  const tab = (
    await c.query(
      `SELECT relacl::text AS relacl, relrowsecurity AS rls, relowner::regrole::text AS dono
         FROM pg_class WHERE oid = 'public.devolucoes'::regclass`,
    )
  ).rows[0];
  const colunas = (
    await c.query(
      `SELECT attname, attacl::text AS attacl FROM pg_attribute
        WHERE attrelid = 'public.devolucoes'::regclass AND attnum > 0 AND NOT attisdropped AND attacl IS NOT NULL ORDER BY attnum`,
    )
  ).rows;
  const matriz = (
    await c.query(
      `SELECT r.rolname, a.attname, has_column_privilege(r.rolname, a.attrelid, a.attname, 'SELECT') AS le
         FROM pg_roles r CROSS JOIN pg_attribute a
        WHERE r.rolname IN ('anon','authenticated','service_role') AND a.attrelid = 'public.devolucoes'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped ORDER BY r.rolname, a.attnum`,
    )
  ).rows;
  return { fn, tab, colunas, matriz };
}
const resumo = (e) => ({
  h: e.fn.h,
  tabela_authenticated: /authenticated=r\//.test(e.tab.relacl ?? ""),
  colunas_com_grant: e.colunas.length,
  authenticated_le: e.matriz.filter(
    (x) => x.rolname === "authenticated" && x.le,
  ).length,
  obs_authenticated: e.matriz.find(
    (x) => x.rolname === "authenticated" && x.attname === "observacao_inspecao",
  )?.le,
});

async function recusa(c, sql, marca, rotulo) {
  await c.query("SAVEPOINT recusa");
  let msg = null;
  try {
    await c.query(sql);
  } catch (e) {
    msg = e.message;
  }
  await c.query("ROLLBACK TO SAVEPOINT recusa");
  await c.query("RELEASE SAVEPOINT recusa");
  assert.ok(msg !== null, `${rotulo}: devia recusar e aplicou`);
  assert.ok(
    msg.includes(marca),
    `${rotulo}: recusou, mas por outro motivo: ${msg}`,
  );
  return msg;
}

// ---------------------------------------------------------------------------
async function main() {
  const c = await novoCliente();
  const linhas = [];
  const dizer = (s) => {
    linhas.push(s);
    console.log(s);
  };
  const tinha = (
    await c.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [SIG],
    )
  ).rows[0].h;
  dizer(
    `[prova] corpo vivo ao chegar: ${tinha} (${tinha === H_DEPOIS ? "migration JA aplicada no clone" : tinha === H_ANTES ? "estado de antes" : "DESCONHECIDO"})`,
  );
  assert.ok(
    [H_ANTES, H_DEPOIS].includes(tinha),
    "o corpo vivo nao e' nem o vigente nem o desta migration",
  );

  await c.query("BEGIN");
  try {
    // Chegou com a migration (CI: a fila inteira ja foi aplicada)? Desfaz DENTRO da transacao: o ANTES e' o estado de antes dela.
    if (tinha === H_DEPOIS) await c.query(ROLLBACK);
    await semear(c);
    const ANTES = await estado(c);
    assert.equal(ANTES.fn.h, H_ANTES);
    assert.ok(
      /authenticated=r\//.test(ANTES.tab.relacl),
      "ANTES: authenticated le a tabela inteira",
    );
    assert.equal(ANTES.colunas.length, 0, "ANTES: nenhum grant de coluna");
    assert.ok(ANTES.tab.rls, "ANTES: a tabela tem RLS");
    dizer(`[ANTES]  ${JSON.stringify(resumo(ANTES))}`);

    // ---- 1. O DEFEITO, medido no estado de antes -------------------------------------------------------------------
    const mAntes = await medir(c);
    const fAntes = falhas(mAntes);
    dizer(
      `[ANTES]  cliente: RPC tem a chave=${mAntes.cli_rpc_tem_chave}; leitura direta da coluna ok=${mAntes.cli_direta_obs.ok} (${mAntes.cli_direta_obs.rows?.[0]?.observacao_inspecao ?? mAntes.cli_direta_obs.erro})`,
    );
    dizer(`[ANTES]  afirmacoes que FALHAM (o defeito): ${fAntes.join(", ")}`);
    if (process.env.PROVA_DEBUG === "1")
      for (const k of [
        "outra_rpc",
        "outra_direta",
        "outra_rpc_propria",
        "servico_direta_obs",
        "anon_direta",
        "concluir",
        "reb_rpc",
        "reb_em_devolucao_alheia",
      ])
        console.log("[debug]", k, JSON.stringify(mAntes[k]).slice(0, 400));
    assert.equal(
      mAntes.cli_rpc_tem_chave,
      true,
      "ANTES: a RPC devia trazer a nota a cliente",
    );
    assert.equal(
      mAntes.cli_direta_obs.ok,
      true,
      "ANTES: a leitura direta devia funcionar",
    );
    assert.equal(
      mAntes.cli_direta_obs.rows[0].observacao_inspecao,
      `${NOTA} (cliente)`,
    );
    // O defeito sao 4 afirmacoes (o rebaixado que tambem e' dono recebia a nota como qualquer dono); o resto ja valia antes.
    assert.deepEqual(
      [...fAntes].sort(),
      [
        "i_rpc_sem_a_chave",
        "ii_leitura_direta_negada",
        "ix_admin_direto_negado_por_desenho",
        "vi_rebaixado_nao_recebe",
      ],
      `ANTES: so as afirmacoes do defeito falham (falharam: ${fAntes.join(", ")})`,
    );

    // ---- 2. A MIGRATION: aplica e o DEPOIS ------------------------------------------------------------------------
    await c.query("SAVEPOINT depois");
    await c.query(MIGRATION);
    const DEPOIS = await estado(c);
    dizer(`[DEPOIS] ${JSON.stringify(resumo(DEPOIS))}`);
    assert.equal(DEPOIS.fn.h, H_DEPOIS);
    assert.deepEqual(
      DEPOIS.fn.attrs,
      ANTES.fn.attrs,
      "atributos/OID/dono/ACL da funcao mudaram",
    );
    assert.equal(
      DEPOIS.tab.relacl?.includes("authenticated"),
      false,
      "a tabela inteira ainda esta com authenticated",
    );
    assert.equal(DEPOIS.colunas.length, 34, "34 colunas com grant de coluna");
    assert.ok(
      DEPOIS.colunas.every((x) => x.attacl === "{authenticated=r/postgres}"),
      "o grant de coluna e' so authenticated=r/postgres",
    );
    const obsAuth = DEPOIS.matriz.find(
      (x) =>
        x.rolname === "authenticated" && x.attname === "observacao_inspecao",
    );
    assert.equal(obsAuth.le, false);
    assert.equal(
      DEPOIS.matriz.filter((x) => x.rolname === "authenticated" && x.le).length,
      34,
    );
    assert.equal(
      DEPOIS.matriz.filter((x) => x.rolname === "anon" && x.le).length,
      0,
      "anon nao le nada",
    );
    // service_role e dono: a mesma ACL de antes.
    assert.equal(
      DEPOIS.matriz.filter((x) => x.rolname === "service_role" && x.le).length,
      ANTES.matriz.filter((x) => x.rolname === "service_role" && x.le).length,
    );
    assert.equal(DEPOIS.tab.dono, ANTES.tab.dono);
    assert.ok(
      /service_role=arwdDxtm\/postgres/.test(DEPOIS.tab.relacl),
      "service_role manteve tudo",
    );
    // As 34 colunas sao exatamente as da tabela menos a observacao.
    const todas = (
      await c.query(
        "SELECT attname FROM pg_attribute WHERE attrelid='public.devolucoes'::regclass AND attnum>0 AND NOT attisdropped",
      )
    ).rows.map((x) => x.attname);
    assert.deepEqual(
      DEPOIS.matriz
        .filter((x) => x.rolname === "authenticated" && x.le)
        .map((x) => x.attname)
        .sort(),
      todas.filter((x) => x !== "observacao_inspecao").sort(),
    );

    const mDepois = await medir(c);
    const fDepois = falhas(mDepois);
    dizer(
      `[DEPOIS] cliente: RPC tem a chave=${mDepois.cli_rpc_tem_chave}; leitura direta da coluna: ${mDepois.cli_direta_obs.erro} (${mDepois.cli_direta_obs.msg}); SELECT *: ${mDepois.cli_direta_estrela.erro}`,
    );
    dizer(
      `[DEPOIS] admin: RPC obs="${mDepois.adm_rpc_obs}"; lista ok=${mDepois.adm_lista.ok}; leitura direta pelo admin: ${mDepois.adm_direta_obs.erro} (por desenho: o painel le por RPC)`,
    );
    dizer(
      `[DEPOIS] afirmacoes que FALHAM: ${fDepois.length ? fDepois.join(", ") : "(nenhuma)"}`,
    );
    assert.deepEqual(
      fDepois,
      [],
      `DEPOIS: afirmacoes falhando: ${fDepois.join(", ")}`,
    );

    // ---- 3. REAPLICAR (LF, CRLF) = mesmo estado; a nota existente nao muda --------------------------------------
    for (const [nome, sql] of [
      ["LF", MIGRATION],
      ["CRLF", emCRLF(MIGRATION)],
    ]) {
      await c.query("SAVEPOINT reaplica");
      await c.query(sql);
      const E2 = await estado(c);
      assert.deepEqual(
        { ...E2, fn: { ...E2.fn, raw: null, sha: null } },
        { ...DEPOIS, fn: { ...DEPOIS.fn, raw: null, sha: null } },
        `reaplicar (${nome}) mudou o estado`,
      );
      assert.deepEqual(
        await medir(c).then((m) => falhas(m)),
        [],
        `reaplicar (${nome}) quebrou uma afirmacao`,
      );
      await c.query("ROLLBACK TO SAVEPOINT reaplica");
      await c.query("RELEASE SAVEPOINT reaplica");
    }
    assert.equal(
      (
        await c.query(
          "SELECT observacao_inspecao AS o FROM public.devolucoes WHERE id = $1",
          [DEV.cliente],
        )
      ).rows[0].o,
      `${NOTA} (cliente)`,
      "a nota que ja existia mudou",
    );
    dizer(
      "[prova] reaplicar (LF e CRLF) = mesmo estado; a nota ja gravada continua a mesma",
    );

    // ---- 4. Reaplicar com coluna FUTURA ja concedida: nao a apaga; com coluna futura sem grant: ainda aplica ---------
    await c.query("SAVEPOINT futura");
    await c.query("ALTER TABLE public.devolucoes ADD COLUMN futura_404 text");
    await c.query(
      "GRANT SELECT (futura_404) ON public.devolucoes TO authenticated",
    );
    await c.query(MIGRATION);
    assert.equal(
      (
        await c.query(
          "SELECT has_column_privilege('authenticated','public.devolucoes','futura_404','SELECT') AS le",
        )
      ).rows[0].le,
      true,
      "reaplicar apagou o grant de uma coluna futura",
    );
    assert.equal(
      (
        await c.query(
          "SELECT has_column_privilege('authenticated','public.devolucoes','observacao_inspecao','SELECT') AS le",
        )
      ).rows[0].le,
      false,
    );
    await c.query("ROLLBACK TO SAVEPOINT futura");
    await c.query("RELEASE SAVEPOINT futura");
    dizer(
      "[prova] coluna futura com grant proprio sobrevive a reaplicacao; a observacao segue fechada",
    );

    // ---- 5. ROLLBACK: o estado de ANTES, byte a byte; o segundo recusa; ida e volta -----------------------------
    await c.query("SAVEPOINT rollback");
    await c.query(ROLLBACK);
    const VOLTOU = await estado(c);
    assert.deepEqual(
      VOLTOU,
      ANTES,
      "o rollback nao devolveu o estado de antes (corpo, ACL, atributos, ACL da tabela e das colunas)",
    );
    assert.equal(VOLTOU.fn.raw, ANTES.fn.raw, "prosrc cru diferente (md5)");
    assert.equal(VOLTOU.fn.sha, ANTES.fn.sha, "prosrc cru diferente (sha256)");
    assert.deepEqual(
      falhas(await medir(c)),
      fAntes,
      "depois do rollback o comportamento nao e' o de antes",
    );
    dizer(
      `[ROLLBACK] estado identico ao de antes (md5 ${VOLTOU.fn.raw}, sha256 ${VOLTOU.fn.sha.slice(0, 16)}...); comportamento de antes de volta`,
    );
    await recusa(c, ROLLBACK, "B1_BASELINE_DIVERGENT", "segundo rollback");
    await c.query(MIGRATION);
    assert.deepEqual(await estado(c), DEPOIS, "ida e volta nao terminou igual");
    await c.query("ROLLBACK TO SAVEPOINT rollback");
    await c.query("RELEASE SAVEPOINT rollback");
    dizer(
      "[ROLLBACK] o segundo rollback recusa; aplicar, desfazer e aplicar termina igual",
    );

    // ---- 5b. o modulo `posterior` (as provas das migrations ANTERIORES o chamam): desfaz so se no ar; repetir e' no-op ----
    {
      const {
        desfazerAObservacaoDaInspecaoNaTransacao,
      } = require("./a-observacao-da-inspecao-posterior.cjs");
      await c.query("SAVEPOINT posterior");
      // Aqui o estado ainda e' o DEPOIS (a migration aplicada no passo 2).
      assert.equal(await desfazerAObservacaoDaInspecaoNaTransacao(c), true);
      assert.deepEqual(
        await estado(c),
        ANTES,
        "o modulo posterior nao devolveu o estado de antes",
      );
      assert.equal(await desfazerAObservacaoDaInspecaoNaTransacao(c), false);
      await c.query("ROLLBACK TO SAVEPOINT posterior");
      await c.query("RELEASE SAVEPOINT posterior");
      dizer(
        "[POSTERIOR] a-observacao-da-inspecao-posterior.cjs desfaz a migration (so se no ar) e devolve o estado de antes",
      );
    }

    // ---- 6. PRE-VOO recusa cada estado ruim (no ANTES, com a tabela inteira) -----------------------------------
    await c.query("ROLLBACK TO SAVEPOINT depois");
    await c.query("RELEASE SAVEPOINT depois");
    const MARCA = "B1_BASELINE_DIVERGENT";
    const corpoQualquer = `${VIGENTE.cabeca}${VIGENTE.corpo.replace("BEGIN\n", "BEGIN\n  -- estranho\n")}$$;`;
    const casos = [
      ["corpo vivo desconhecido", corpoQualquer],
      [
        "coluna desconhecida com a tabela inteira",
        "ALTER TABLE public.devolucoes ADD COLUMN estranha_404 text",
      ],
      [
        "coluna conhecida ausente",
        "ALTER TABLE public.devolucoes RENAME COLUMN encerrada_em TO encerrada_em_x",
      ],
      ["anon le a tabela", "GRANT SELECT ON public.devolucoes TO anon"],
      ["anon le uma coluna", "GRANT SELECT (id) ON public.devolucoes TO anon"],
      [
        "authenticated escreve",
        "GRANT UPDATE ON public.devolucoes TO authenticated",
      ],
      [
        "authenticated tem UPDATE por coluna",
        "GRANT UPDATE (detalhe) ON public.devolucoes TO authenticated",
      ],
      ["PUBLIC le a tabela", "GRANT SELECT ON public.devolucoes TO PUBLIC"],
      [
        "PUBLIC le uma coluna",
        "GRANT SELECT (id) ON public.devolucoes TO PUBLIC",
      ],
      [
        "authenticated e' membro de pg_read_all_data",
        "GRANT pg_read_all_data TO authenticated",
      ],
      [
        "tabela sem RLS",
        "ALTER TABLE public.devolucoes DISABLE ROW LEVEL SECURITY",
      ],
      [
        "funcao aberta ao anon",
        "GRANT EXECUTE ON FUNCTION public.devolucao_detalhe(uuid) TO anon",
      ],
      [
        "funcao fechada ao authenticated",
        "REVOKE EXECUTE ON FUNCTION public.devolucao_detalhe(uuid) FROM authenticated",
      ],
      [
        "funcao sem SECURITY DEFINER",
        "ALTER FUNCTION public.devolucao_detalhe(uuid) SECURITY INVOKER",
      ],
      [
        "funcao VOLATILE",
        "ALTER FUNCTION public.devolucao_detalhe(uuid) VOLATILE",
      ],
      [
        "funcao com outro search_path",
        "ALTER FUNCTION public.devolucao_detalhe(uuid) SET search_path = public, extensions",
      ],
      [
        "sobrecarga de devolucao_detalhe",
        "CREATE FUNCTION public.devolucao_detalhe(p_id uuid, p_x int) RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{}'::jsonb $f$",
      ],
      [
        "falta is_admin_atual",
        "ALTER FUNCTION public.is_admin_atual() RENAME TO is_admin_atual_x",
      ],
    ];
    for (const [rotulo, estrago] of casos) {
      await c.query("SAVEPOINT pre");
      await c.query(estrago);
      await recusa(c, MIGRATION, MARCA, `pre-voo: ${rotulo}`);
      await c.query("ROLLBACK TO SAVEPOINT pre");
      await c.query("RELEASE SAVEPOINT pre");
    }
    // O mesmo estado de partida e' aceito sem os estragos (controle: o pre-voo nao recusa tudo).
    await c.query("SAVEPOINT controle");
    await c.query(MIGRATION);
    await c.query("ROLLBACK TO SAVEPOINT controle");
    await c.query("RELEASE SAVEPOINT controle");
    // O rollback recusa corpo que nao e' o desta migration, e funcao sobrecarregada.
    await c.query("SAVEPOINT rpre");
    await recusa(
      c,
      ROLLBACK,
      MARCA,
      "rollback sobre o estado de antes (corpo vigente)",
    );
    await c.query("ROLLBACK TO SAVEPOINT rpre");
    await c.query("RELEASE SAVEPOINT rpre");
    dizer(
      `[PRE-VOO] ${casos.length} estados ruins recusam com ${MARCA}, sem aplicar; o controle (estado de antes) aplica`,
    );

    // ---- 7. POS-VOO: o REVOKE que nao revogou (grant de OUTRO grantor) derruba a migration -------------------------
    await c.query("SAVEPOINT pos");
    await c.query("CREATE ROLE prova404_grantor NOLOGIN");
    await c.query(
      "GRANT SELECT ON public.devolucoes TO prova404_grantor WITH GRANT OPTION",
    );
    await c.query("SET LOCAL ROLE prova404_grantor");
    await c.query("GRANT SELECT ON public.devolucoes TO authenticated");
    await c.query("RESET ROLE");
    const msgPos = await recusa(
      c,
      MIGRATION,
      "POSVOO_20261404000000",
      "pos-voo: grant de outro grantor",
    );
    dizer(
      `[POS-VOO] grant de outro grantor: a migration recusa -> ${msgPos.slice(0, 120)}`,
    );
    await c.query("ROLLBACK TO SAVEPOINT pos");
    await c.query("RELEASE SAVEPOINT pos");

    // ---- 8. MUTANTES: cada um tem de reprovar a guarda CERTA (todos a partir do estado de ANTES) --------------------
    const semFiltro = P_FUNC.replace(
      "CASE WHEN public.is_admin_atual() THEN to_jsonb(v_d) ELSE to_jsonb(v_d) - 'observacao_inspecao' END",
      () => "to_jsonb(v_d)",
    );
    assert.notEqual(semFiltro, P_FUNC);
    const invertido = P_FUNC.replace(
      "CASE WHEN public.is_admin_atual() THEN",
      () => "CASE WHEN NOT public.is_admin_atual() THEN",
    );
    const peloJwt = P_FUNC.replace(
      "CASE WHEN public.is_admin_atual() THEN",
      () => "CASE WHEN public.is_admin() THEN",
    );
    const chaveErrada = P_FUNC.replace(
      "to_jsonb(v_d) - 'observacao_inspecao' END",
      () => "to_jsonb(v_d) - 'mensagem_loja' END",
    );
    for (const m of [semFiltro, invertido, peloJwt, chaveErrada])
      assert.ok(m !== P_FUNC, "mutante igual ao original");
    const MUTANTES = [
      [
        "sem o filtro da RPC",
        [semFiltro, P_REVOGA, P_GRANT],
        ["i_rpc_sem_a_chave", "vi_rebaixado_nao_recebe"],
      ],
      [
        "sem o REVOKE/GRANT por coluna",
        [P_FUNC],
        ["ii_leitura_direta_negada", "ix_admin_direto_negado_por_desenho"],
      ],
      [
        "REVOKE sem o GRANT por coluna",
        [P_FUNC, P_REVOGA],
        ["iii_o_resto_segue_lendo"],
      ],
      [
        "filtro invertido (tira do admin)",
        [invertido, P_REVOGA, P_GRANT],
        [
          "i_rpc_sem_a_chave",
          "iv_admin_recebe_a_nota",
          "viii_concluir_grava_e_o_admin_le",
        ],
      ],
      [
        "filtro pelo JWT (is_admin) em vez do papel ATUAL",
        [peloJwt, P_REVOGA, P_GRANT],
        ["vi_rebaixado_nao_recebe"],
      ],
      [
        "chave errada no filtro",
        [chaveErrada, P_REVOGA, P_GRANT],
        ["i_rpc_sem_a_chave"],
      ],
    ];
    for (const [rotulo, partes, esperadas] of MUTANTES) {
      await c.query("SAVEPOINT mut");
      for (const p of partes) await c.query(p);
      const f = falhas(await medir(c));
      await c.query("ROLLBACK TO SAVEPOINT mut");
      await c.query("RELEASE SAVEPOINT mut");
      for (const e of esperadas)
        assert.ok(
          f.includes(e),
          `MUTANTE "${rotulo}": ${e} devia ficar VERMELHO e passou (falhas: ${f.join(", ")})`,
        );
      dizer(
        `[MUTANTE] ${rotulo}: vermelho em ${esperadas.join(", ")} (todas as que falharam: ${f.join(", ")})`,
      );
    }
    // O mutante da conferencia: sem o pos-voo, o grant de outro grantor passa em silencio e a cliente SEGUE lendo a nota.
    await c.query("SAVEPOINT mutpos");
    await c.query("CREATE ROLE prova404_grantor2 NOLOGIN");
    await c.query(
      "GRANT SELECT ON public.devolucoes TO prova404_grantor2 WITH GRANT OPTION",
    );
    await c.query("SET LOCAL ROLE prova404_grantor2");
    await c.query("GRANT SELECT ON public.devolucoes TO authenticated");
    await c.query("RESET ROLE");
    const semPos = MIGRATION.replace(P_POS, () => "");
    assert.notEqual(semPos, MIGRATION);
    await c.query(semPos); // aplica "com sucesso" (e' o furo)
    const fSemPos = falhas(await medir(c), { pularIx: false });
    assert.ok(
      fSemPos.includes("ii_leitura_direta_negada"),
      "MUTANTE sem a conferencia: devia deixar a leitura direta ABERTA (vermelho em ii)",
    );
    await c.query("ROLLBACK TO SAVEPOINT mutpos");
    await c.query("RELEASE SAVEPOINT mutpos");
    dizer(
      "[MUTANTE] migration sem a conferencia: o grant de outro grantor passa e a cliente SEGUE lendo a nota (vermelho em ii) -- e' por isso que a conferencia mede o privilegio EFETIVO",
    );

    await c.query("ROLLBACK");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await c.end().catch(() => {});
  }

  // ---- 9. ATOMICIDADE de verdade: conexao SEM BEGIN (o arquivo vai como UMA mensagem), COMMIT no clone -----------------
  const a = await novoCliente();
  try {
    if ((await estado(a)).fn.h === H_DEPOIS) await a.query(ROLLBACK); // clone da fila inteira: volta ao ANTES, COMMITADO
    const E0 = await estado(a);
    assert.equal(E0.fn.h, H_ANTES);
    // Papel e' do CLUSTER (sobrevive ao clone): se uma rodada anterior morreu no meio, limpa antes de criar.
    if (
      (await a.query("SELECT 1 FROM pg_roles WHERE rolname = 'prova404_g3'"))
        .rowCount
    ) {
      await a.query("DROP OWNED BY prova404_g3 CASCADE");
      await a.query("DROP ROLE prova404_g3");
    }
    await a.query("CREATE ROLE prova404_g3 NOLOGIN");
    try {
      await a.query(
        "GRANT SELECT ON public.devolucoes TO prova404_g3 WITH GRANT OPTION",
      );
      await a.query("SET ROLE prova404_g3");
      await a.query("GRANT SELECT ON public.devolucoes TO authenticated");
      await a.query("RESET ROLE");
      const E1 = await estado(a);
      let msg = null;
      try {
        await a.query(MIGRATION);
      } catch (e) {
        msg = e.message;
      }
      assert.ok(
        msg?.includes("POSVOO_20261404000000"),
        `a migration devia recusar no pos-voo: ${msg}`,
      );
      const E2 = await estado(a);
      assert.deepEqual(
        E2,
        E1,
        "a migration que recusou deixou meia mudanca gravada (corpo, ACL ou colunas)",
      );
      assert.equal(
        E2.fn.h,
        H_ANTES,
        "o corpo da funcao foi trocado e NAO desfeito apos o pos-voo recusar",
      );
      dizer(
        "[ATOMICIDADE] conexao SEM BEGIN: o pos-voo recusou e NADA ficou gravado (nem o corpo novo da funcao, nem o REVOKE, nem o GRANT por coluna)",
      );
    } finally {
      await a.query("RESET ROLE").catch(() => {});
      // DROP OWNED ... CASCADE tira o grant dele E o que ele concedeu a authenticated (a dependencia da opcao de grant).
      await a.query("DROP OWNED BY prova404_g3 CASCADE");
      await a.query("DROP ROLE prova404_g3");
    }
    assert.deepEqual(
      await estado(a),
      E0,
      "a limpeza nao devolveu o estado de antes",
    );
    // Aplicar de verdade (COMMIT), duas vezes: o mesmo estado; o segundo rollback recusa.
    await a.query(MIGRATION);
    const D1 = await estado(a);
    await a.query(MIGRATION);
    assert.deepEqual(
      await estado(a),
      D1,
      "reaplicar (COMMITADO) mudou o estado",
    );
    assert.equal(D1.fn.h, H_DEPOIS);
    dizer("[ATOMICIDADE] aplicar e reaplicar COMMITADO: mesmo estado");
  } finally {
    await a.end().catch(() => {});
  }

  console.log(
    "\n[OK] prova viva da 20261404000000: a observacao da inspecao so a loja ve",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
