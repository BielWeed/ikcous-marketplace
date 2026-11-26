"use strict";
/* eslint-disable security/detect-object-injection --
 * Os indices vem de contadores e de listas fechadas deste arquivo (nomes de campos e de casos), nunca de entrada de rede. */

/**
 * PROVA VIVA da migration 20261590000000_a_loja_guarda_o_dia_da_pausa_do_teste.sql contra o Postgres EFEMERO (clone do rodar-isolado.cjs: a arvore migrada).
 * Nunca banco de loja. Esqueleto: tests/banco/prova-de-objeto-novo.cjs; molde: a-loja-recebe-o-plano-por-porta-unica-viva.cjs (a porta da 20261399998000).
 *
 * A migration poe a coluna assinatura_da_loja.pausa_em (date, anulavel, sem padrao) e redefine a porta assinatura_da_loja_gravar com a 11a chave OPCIONAL
 * pausa_em. O que esta prova mede:
 *
 *  GESTAO VELHA  o corpo de 10 chaves continua gravando; pausa_em fica NULL; e um envio sem a chave APAGA o dia que estava guardado.
 *  GESTAO NOVA   o corpo de 11 chaves grava pausa_em; null explicito grava NULL; so pausa_em mudando com o mesmo carimbo regrava (igual nao e' mais velho);
 *                o mais velho continua ignorado; recursos e observacao ficam intactos.
 *  LEITURA       assinatura_da_loja_ler() devolve pausa_em ao admin atual e continua recusando quem nao e'.
 *  VALIDACAO     pausa_em torta (infinity, 2026-02-31, 20261207, today, espaco, numero, booleano, objeto, lista) = valor_invalido com DETAIL 'campo: pausa_em'
 *                e nada gravado; chave errada com pausa_em torta = nao_autorizado (autentica antes); outra chave estranha continua campo_nao_permitido; as
 *                10 continuam obrigatorias.
 *  SIMULAR       mostra pausa_em em "mudaria" e "atual" sem gravar (xmin/ctid iguais); o corpo da gestao velha igual ao guardado nao inventa mudanca.
 *  RECUO         a porta VELHA (o corpo da 20261399998000) recusa o corpo da gestao nova com code 22023, message 'campo_nao_permitido' e DETAIL
 *                'campo: pausa_em', sem gravar nada; o MESMO corpo sem pausa_em grava. E' o contrato que o app de gestao usa para reenviar.
 *  MIGRATION     reaplicar (2x, CRLF) = mesmo estado (OID, ACL, corpo) com o cartao, o dia e a chave intactos; o rollback COMUM devolve a porta da 20261399998000
 *                (md5 565f82...) e MANTEM a coluna com os dias; o DESTRUTIVO exige confirmacao, o comum antes e nenhuma funcao citando pausa_em, e so apaga a
 *                coluna; depois dele a 20261399998000 volta a ser reaplicavel; retrato do resto igual; pre-voo recusa SEM escrever; pos-voo recusa cada
 *                estrago; falha no meio numa conexao SEM BEGIN nao deixa nada; lock_timeout de 5 s.
 *  MUTANTES      pausa_em obrigatoria, ausente que nao apaga, data solta, pausa_em validada antes de autenticar, pausa_em fora do laco das datas (so o cast),
 *                lista branca sem a opcional, simulacao sem pausa_em: cada um FICA VERMELHO na expectativa certa.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-loja-guarda-o-dia-da-pausa-do-teste-viva.cjs
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova, md5, sha256 } = P;
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const NOME = "20261590000000_a_loja_guarda_o_dia_da_pausa_do_teste.sql";
const MIGRATION = P.lerMigration(NOME);
const ROLLBACK_SQL = P.lerMigration(`rollback-manual-${NOME}`);
const DESTRUTIVO_SQL = P.lerMigration(`rollback-manual-destrutivo-${NOME}`);
/** O destrutivo como o dono o roda: com a confirmacao na MESMA transacao. */
const DESTRUTIVO_CONFIRMADO = `SET LOCAL app.confirmo_apagar_pausa_em = 'APAGAR';\n${DESTRUTIVO_SQL}`;
const ANTERIOR = P.lerMigration(
  "20261399998000_a_loja_recebe_o_plano_por_porta_unica.sql",
);
const GRAVAR = "public.assinatura_da_loja_gravar(text, jsonb, boolean)";

const corpoDe = (sql, nome) => {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  const a = sql.indexOf("AS $function$", i) + "AS $function$".length;
  return sql.slice(a, sql.indexOf("$function$;", a));
};
const textoDe = (sql, nome) => {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  const a = sql.indexOf("AS $function$", i);
  return sql.slice(i, sql.indexOf("$function$;", a) + "$function$;".length);
};
const H_NOVO = md5(corpoDe(MIGRATION, "assinatura_da_loja_gravar"));
const H_VELHO = md5(corpoDe(ANTERIOR, "assinatura_da_loja_gravar"));
/** A porta da 20261399998000, como o rollback a devolve. */
const PORTA_VELHA = textoDe(ANTERIOR, "assinatura_da_loja_gravar");
const PORTA_NOVA = textoDe(MIGRATION, "assinatura_da_loja_gravar");

const CHAVE = "chave-da-loja-de-teste-0b6e2d4a9c1f3e5d7a8b0c2e4f6a8b1d";
const HASH = sha256(CHAVE);
const U_ADMIN = "59222222-2222-4222-8222-222222222222";
const U_CLIENTE = "59111111-1111-4111-8111-111111111111";
/** O corpo da gestao VELHA: as 10 chaves, sem pausa_em. */
const VELHA = {
  plano: "Pro",
  status: "atrasada",
  ciclo: "mensal",
  valor_mensal: 250,
  inicio_em: "2026-11-03",
  teste_ate: "2026-12-03",
  proxima_cobranca_em: "2026-12-03",
  suporte_whatsapp: "5534999999999",
  gerenciar_url: "https://www.mercadopago.com.br/subscriptions/abc123",
  atualizado_em: "2026-11-20T10:00:00Z",
};
/** O corpo da gestao NOVA: as 10 + pausa_em. */
const NOVA = { ...VELHA, pausa_em: "2026-12-07" };
const com = (base, mudar) => ({ ...base, ...mudar });
/** O corpo sem uma chave (a chave AUSENTE, nao nula). */
const sem = (base, campo) =>
  Object.fromEntries(Object.entries(base).filter(([k]) => k !== campo));
const carimbo = (n) => `2026-11-20T10:${String(n).padStart(2, "0")}:00Z`;

const C = () => P.conexao();
const json = (d) => (d === null || d === undefined ? null : JSON.stringify(d));
const limpar = async () => {
  const c = C();
  await c.query("DELETE FROM public.assinatura_da_loja");
  await c.query("DELETE FROM public.assinatura_da_loja_chave");
  await c.query(
    "INSERT INTO public.assinatura_da_loja_chave (id, chave_hash) VALUES (1, $1)",
    [HASH],
  );
};
/** A porta, como anon (o hub usa a chave publica da loja). */
const gravar = (chave, dados, simular = false) =>
  P.tentar(
    "anon",
    "SELECT public.assinatura_da_loja_gravar($1::text, $2::jsonb, $3::boolean) AS j",
    [chave, json(dados), simular],
    {},
  );
const resultado = (x) => x.linhas?.[0]?.j;
const gravou = (x) => resultado(x)?.gravado === true;
const linha = async () =>
  (
    await C().query(
      `SELECT status, teste_ate::text AS teste_ate, proxima_cobranca_em::text AS proxima, pausa_em::text AS pausa_em,
              recursos, observacao, to_char(atualizado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS atualizado_em
         FROM public.assinatura_da_loja WHERE id = 1`,
    )
  ).rows[0] || null;
const pausa = async () => (await linha())?.pausa_em ?? null;
const foto = async () =>
  JSON.stringify(
    (
      await C().query(
        "SELECT xmin::text AS xmin, ctid::text AS ctid, to_jsonb(a)::text AS l FROM public.assinatura_da_loja a",
      )
    ).rows,
  );
const ehNegado = (x) => x.erro === "nao_autorizado" && x.codigo === "42501";
const ehInvalido = (x, campo, msg = "valor_invalido") =>
  x.erro === msg && x.codigo === "22023" && x.detalhe === `campo: ${campo}`;

const DIAG = [];
const anotar = (nome, x) => {
  DIAG.push(`${nome}: ${String(JSON.stringify(x)).slice(0, 200)}`);
};
const falhou = (r) =>
  Object.entries(r)
    .filter(([, v]) => v !== true)
    .map(([k]) => k)
    .sort();

async function semearAtores() {
  const c = C();
  for (const [id, meta] of [
    [U_CLIENTE, "{}"],
    [U_ADMIN, '{"role":"admin"}'],
  ]) {
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@pausa.teste', $2::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [id, meta],
    );
  }
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin Pausa', 'admin') ON CONFLICT (id) DO NOTHING`,
    [U_ADMIN],
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// O roteiro: cada chave e' uma expectativa que vale `true` quando o comportamento e' o desta migration.
// ---------------------------------------------------------------------------------------------------------------------------
async function roteiro() {
  const r = {};

  // ---- gestao VELHA (10 chaves): grava, pausa_em fica NULL
  const v1 = await gravar(CHAVE, com(VELHA, { atualizado_em: carimbo(1) }));
  r.velhaGrava = gravou(v1) && (await pausa()) === null;
  if (!r.velhaGrava) anotar("velhaGrava", v1);

  // ---- gestao NOVA (11 chaves): grava pausa_em
  const n1 = await gravar(CHAVE, com(NOVA, { atualizado_em: carimbo(2) }));
  r.novaGrava = gravou(n1) && (await pausa()) === "2026-12-07";
  if (!r.novaGrava) anotar("novaGrava", n1);

  // ---- a gestao velha, depois, APAGA o dia guardado (ausente = NULL)
  const v2 = await gravar(CHAVE, com(VELHA, { atualizado_em: carimbo(3) }));
  r.velhaApaga = gravou(v2) && (await pausa()) === null;
  if (!r.velhaApaga) anotar("velhaApaga", v2);

  // ---- null explicito grava NULL (depois de ter um dia)
  await gravar(CHAVE, com(NOVA, { atualizado_em: carimbo(4) }));
  const n2 = await gravar(
    CHAVE,
    com(NOVA, { pausa_em: null, atualizado_em: carimbo(5) }),
  );
  r.novaNullApaga = gravou(n2) && (await pausa()) === null;

  // ---- o mesmo carimbo regrava quando so pausa_em muda (igual nao e' mais velho); o mais velho e' ignorado
  const n3 = await gravar(
    CHAVE,
    com(NOVA, { pausa_em: "2026-12-08", atualizado_em: carimbo(5) }),
  );
  r.igualRegrava = gravou(n3) && (await pausa()) === "2026-12-08";
  const n4 = await gravar(
    CHAVE,
    com(NOVA, { pausa_em: "2026-12-09", atualizado_em: carimbo(4) }),
  );
  r.maisVelhoIgnorado =
    resultado(n4)?.gravado === false &&
    resultado(n4)?.motivo === "mais_velho" &&
    (await pausa()) === "2026-12-08";

  // ---- recursos e observacao intactos com a gestao nova
  await C().query(
    "UPDATE public.assinatura_da_loja SET recursos = ARRAY['a', 'b'], observacao = 'nota do dono' WHERE id = 1",
  );
  await gravar(
    CHAVE,
    com(NOVA, { pausa_em: "2026-12-07", atualizado_em: carimbo(6) }),
  );
  const l6 = await linha();
  r.recursosIntactos =
    JSON.stringify(l6?.recursos) === JSON.stringify(["a", "b"]) &&
    l6?.observacao === "nota do dono" &&
    l6?.pausa_em === "2026-12-07";

  // ---- a leitura: o admin atual ve pausa_em; quem nao e' admin continua recusado
  const lido = await P.tentar(
    "authenticated",
    "SELECT public.assinatura_da_loja_ler() AS j",
    [],
    { uid: U_ADMIN },
  );
  const lj = lido.linhas?.[0]?.j;
  r.leituraMostra =
    lj?.pausa_em === "2026-12-07" &&
    lj?.teste_ate === "2026-12-03" &&
    !("observacao" in (lj || {}));
  if (!r.leituraMostra) anotar("leituraMostra", lido);
  const recusas = [
    await P.tentar(
      "authenticated",
      "SELECT public.assinatura_da_loja_ler() AS j",
      [],
      { uid: U_CLIENTE },
    ),
    await P.tentar("anon", "SELECT public.assinatura_da_loja_ler() AS j", []),
  ];
  r.leituraRecusaQuemNaoE = recusas.every(
    (x) => x.codigo === "42501" || x.codigo === "42883",
  );
  if (!r.leituraRecusaQuemNaoE) anotar("leituraRecusaQuemNaoE", recusas);

  // ---- pausa_em torta: valor_invalido citando o campo, nada gravado
  const antes = await foto();
  const tortas = [
    "infinity",
    "-infinity",
    "2026-02-31",
    "20261207",
    "today",
    "2026-12-07 ",
    " 2026-12-07",
    "2026-12-07T00:00:00Z",
    "07/12/2026",
    "",
    20261207,
    true,
    {},
    [],
  ];
  const respTortas = [];
  for (const t of tortas)
    respTortas.push(
      await gravar(
        CHAVE,
        com(NOVA, { pausa_em: t, atualizado_em: carimbo(30) }),
      ),
    );
  r.pausaTortaRecusada =
    respTortas.every((x) => ehInvalido(x, "pausa_em")) &&
    (await foto()) === antes;
  if (!r.pausaTortaRecusada)
    anotar(
      "pausaTortaRecusada",
      respTortas.map((x, i) => [tortas[i], x.erro, x.detalhe]),
    );

  // ---- autentica ANTES: chave errada com pausa_em torta continua nao_autorizado
  const errada = [
    await gravar("errada", com(NOVA, { pausa_em: "infinity" })),
    await gravar(null, com(NOVA, { pausa_em: 5 })),
    await gravar("", com(NOVA, { pausa_em: "2026-02-31" })),
  ];
  r.autenticaAntesDaPausa = errada.every(ehNegado) && (await foto()) === antes;
  if (!r.autenticaAntesDaPausa) anotar("autenticaAntesDaPausa", errada);

  // ---- a lista branca: outra chave estranha continua campo_nao_permitido (com a pausa valida junto); as 10 continuam obrigatorias
  const estranhas = [
    [com(NOVA, { pausa: "2026-12-07" }), "pausa"],
    [com(NOVA, { recursos: [] }), "recursos"],
    [com(NOVA, { observacao: "x" }), "observacao"],
    [com(NOVA, { Pausa_em: "2026-12-07" }), "Pausa_em"],
  ];
  let lista = true;
  for (const [d, campo] of estranhas) {
    const x = await gravar(CHAVE, d);
    if (!ehInvalido(x, campo, "campo_nao_permitido")) {
      lista = false;
      anotar("listaBranca", [campo, x]);
    }
  }
  r.listaBranca = lista && (await foto()) === antes;
  let obrig = true;
  for (const campo of Object.keys(VELHA)) {
    const d = sem(NOVA, campo);
    const x = await gravar(CHAVE, d);
    if (!ehInvalido(x, campo, "campo_ausente")) obrig = false;
  }
  r.dezObrigatorias = obrig && (await foto()) === antes;

  // ---- simular: mostra pausa_em em mudaria e atual, sem gravar
  const s1 = await gravar(
    CHAVE,
    com(NOVA, { pausa_em: "2026-12-10", atualizado_em: carimbo(40) }),
    true,
  );
  const sj = resultado(s1);
  r.simularMostraPausa =
    sj?.simulado === true &&
    sj?.gravado === false &&
    sj?.atual?.pausa_em === "2026-12-07" &&
    JSON.stringify(sj?.mudaria?.pausa_em) ===
      JSON.stringify({ de: "2026-12-07", para: "2026-12-10" }) &&
    (await foto()) === antes;
  if (!r.simularMostraPausa) anotar("simularMostraPausa", s1);
  // a gestao velha simulando o MESMO cartao (sem pausa guardada) nao ve mudanca inventada
  await gravar(
    CHAVE,
    com(NOVA, { pausa_em: null, atualizado_em: carimbo(41) }),
  );
  const s2 = resultado(
    await gravar(CHAVE, com(VELHA, { atualizado_em: carimbo(41) }), true),
  );
  r.simularVelhaSemInvencao =
    s2?.simulado === true &&
    JSON.stringify(s2?.mudaria) === "{}" &&
    "pausa_em" in (s2?.atual || {});
  if (!r.simularVelhaSemInvencao) anotar("simularVelhaSemInvencao", s2);
  // simular com pausa torta passa pela mesma validacao
  r.simularValida = ehInvalido(
    await gravar(CHAVE, com(NOVA, { pausa_em: "infinity" }), true),
    "pausa_em",
  );
  return r;
}

const montarLimpo = async () => {
  await limpar();
  await semearAtores();
};

prova(
  "ESTADO: a arvore migrada tem a coluna pausa_em (date, anulavel, sem padrao) e a porta com o corpo desta migration",
  async () => {
    await P.emTransacao(async () => {
      const col = (
        await C().query(
          `SELECT format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull, (SELECT count(*)::int FROM pg_attrdef d WHERE d.adrelid = a.attrelid AND d.adnum = a.attnum) AS padroes
             FROM pg_attribute a WHERE a.attrelid = 'public.assinatura_da_loja'::regclass AND a.attname = 'pausa_em' AND NOT a.attisdropped`,
        )
      ).rows;
      assert.deepEqual(col, [{ tipo: "date", attnotnull: false, padroes: 0 }]);
      const h = (
        await C().query(
          `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = '${GRAVAR}'::regprocedure`,
        )
      ).rows[0].h;
      assert.equal(h, H_NOVO);
      assert.notEqual(H_NOVO, H_VELHO);
      assert.equal(H_VELHO, "565f82cb9a65ed96e4702db9d97bf0d6");
    });
  },
);

prova(
  "ROTEIRO: gestao velha e nova, leitura, validacao, lista branca e simulacao valem com o corpo desta migration",
  async () => {
    DIAG.length = 0;
    const r = await P.emTransacao(roteiro, montarLimpo);
    assert.deepEqual(falhou(r), [], DIAG.slice(0, 6).join(" | "));
    assert.ok(
      Object.keys(r).length >= 16,
      `o roteiro encolheu: ${Object.keys(r).length}`,
    );
  },
);

prova(
  "RECUO: a porta VELHA recusa o corpo da gestao nova com 22023 / campo_nao_permitido / 'campo: pausa_em' sem gravar nada, e o mesmo corpo sem pausa_em grava",
  async () => {
    await P.emTransacao(async () => {
      await C().query(PORTA_VELHA);
      const h = (
        await C().query(
          `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = '${GRAVAR}'::regprocedure`,
        )
      ).rows[0].h;
      assert.equal(h, H_VELHO, "a porta instalada nao e a da 20261399998000");
      const antes = await foto();
      const x = await gravar(CHAVE, NOVA);
      assert.equal(x.erro, "campo_nao_permitido");
      assert.equal(x.codigo, "22023");
      assert.equal(x.detalhe, "campo: pausa_em");
      assert.equal(await foto(), antes, "a recusa gravou algo");
      const nula = await gravar(CHAVE, com(NOVA, { pausa_em: null }));
      assert.equal(
        nula.detalhe,
        "campo: pausa_em",
        "null explicito tambem e' recusado pela velha",
      );
      const semPausa = sem(NOVA, "pausa_em");
      const y = await gravar(CHAVE, semPausa);
      assert.equal(gravou(y), true, JSON.stringify(y));
      assert.equal((await linha()).status, "atrasada");
    }, montarLimpo);
  },
);

// ---- MUTANTES: o mesmo roteiro sobre a porta sabotada fica vermelho na expectativa certa --------------------------------------
const trocar = (texto, de, para) => {
  assert.ok(texto.includes(de), `o trecho a sabotar sumiu: ${de.slice(0, 70)}`);
  const novo = texto.replace(de, () => para);
  assert.notEqual(novo, texto);
  return novo;
};
const MUTANTES = [
  [
    "pausa_em obrigatoria (a gestao velha quebra)",
    () =>
      trocar(
        PORTA_NOVA,
        "'gerenciar_url', 'atualizado_em'];\n  v_opcionais CONSTANT text[] := ARRAY['pausa_em'];",
        "'gerenciar_url', 'atualizado_em', 'pausa_em'];\n  v_opcionais CONSTANT text[] := ARRAY[]::text[];",
      ),
    ["velhaGrava", "velhaApaga"],
  ],
  [
    "pausa_em ausente nao apaga o dia velho (COALESCE no UPDATE)",
    () =>
      trocar(
        PORTA_NOVA,
        "    pausa_em = EXCLUDED.pausa_em,",
        "    pausa_em = COALESCE(EXCLUDED.pausa_em, a.pausa_em),",
      ),
    ["velhaApaga", "novaNullApaga"],
  ],
  [
    "data solta (so o cast, sem a forma AAAA-MM-DD)",
    () =>
      trocar(
        PORTA_NOVA,
        "IF v_texto IS NULL OR v_texto !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN",
        "IF v_texto IS NULL THEN",
      ),
    ["pausaTortaRecusada"],
  ],
  [
    "pausa_em validada ANTES de autenticar",
    () =>
      trocar(
        PORTA_NOVA,
        "BEGIN\n  -- a) Autentica",
        "BEGIN\n  IF jsonb_typeof(p_dados -> 'pausa_em') IS DISTINCT FROM 'null' AND (p_dados -> 'pausa_em') IS NOT NULL\n     AND COALESCE(p_dados ->> 'pausa_em', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN\n    RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023', DETAIL = 'campo: pausa_em';\n  END IF;\n  -- a) Autentica",
      ),
    ["autenticaAntesDaPausa"],
  ],
  [
    "pausa_em fora do laco das datas, so com o cast",
    () =>
      trocar(
        trocar(
          PORTA_NOVA,
          "ARRAY['inicio_em', 'teste_ate', 'proxima_cobranca_em', 'pausa_em'] LOOP",
          "ARRAY['inicio_em', 'teste_ate', 'proxima_cobranca_em'] LOOP",
        ),
        "(v_datas ->> 'proxima_cobranca_em')::date, (v_datas ->> 'pausa_em')::date, v_whatsapp",
        "(v_datas ->> 'proxima_cobranca_em')::date, (p_dados ->> 'pausa_em')::date, v_whatsapp",
      ),
    ["pausaTortaRecusada"],
  ],
  [
    "lista branca sem a opcional (a gestao nova e' recusada)",
    () =>
      trocar(
        PORTA_NOVA,
        "WHERE k <> ALL (v_chaves || v_opcionais)",
        "WHERE k <> ALL (v_chaves)",
      ),
    ["novaGrava"],
  ],
  [
    "a simulacao nao mostra pausa_em",
    () =>
      trocar(
        PORTA_NOVA,
        "(v_datas ->> 'proxima_cobranca_em')::date, 'pausa_em', (v_datas ->> 'pausa_em')::date,\n",
        "(v_datas ->> 'proxima_cobranca_em')::date,\n",
      ),
    ["simularMostraPausa"],
  ],
];
for (const [nome, sabotar, esperado] of MUTANTES) {
  prova(
    `MUTANTE ${nome}: o roteiro fica vermelho na expectativa certa`,
    async () => {
      const sql = sabotar();
      DIAG.length = 0;
      const r = await P.emTransacao(async () => {
        await C().query(sql);
        return roteiro();
      }, montarLimpo);
      const f = falhou(r);
      for (const k of esperado)
        assert.ok(
          f.includes(k),
          `o mutante '${nome}' devia reprovar ${k}, reprovou ${JSON.stringify(f)}`,
        );
    },
  );
}

// ---- A MIGRATION: reaplicar, rollback comum e destrutivo, retrato, pre-voo, pos-voo, atomicidade, trava ---------------------------------------------
const nova = async () => {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  return c;
};
const estado = async (c = C()) => {
  const q = async (sql) => (await c.query(sql)).rows;
  return {
    porta: await q(
      `SELECT p.oid::text AS oid, md5(replace(p.prosrc, chr(13), '')) AS md5, p.prosecdef, p.provolatile, p.proconfig::text AS cfg,
              p.proacl::text AS acl, pg_get_userbyid(p.proowner) AS dono, pg_get_function_arguments(p.oid) AS args,
              obj_description(p.oid, 'pg_proc') AS comentario
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'assinatura_da_loja_gravar' ORDER BY 1`,
    ),
    colunas: await q(
      `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS padrao,
              col_description(a.attrelid, a.attnum) AS comentario
         FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = 'public.assinatura_da_loja'::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attname`,
    ),
    tabela: await q(
      "SELECT relacl::text AS acl, relrowsecurity AS rls FROM pg_class WHERE oid = 'public.assinatura_da_loja'::regclass",
    ),
  };
};
const hPorta = async (c = C()) =>
  (
    await c.query(
      `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('${GRAVAR}')`,
    )
  ).rows[0]?.h ?? null;
const temColuna = async (c = C()) =>
  (
    await c.query(
      "SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'public.assinatura_da_loja'::regclass AND attname = 'pausa_em' AND NOT attisdropped",
    )
  ).rows[0].n === 1;
const cartaoCru = async () =>
  JSON.stringify(
    (
      await C().query(
        "SELECT to_jsonb(a) - 'pausa_em' AS l FROM public.assinatura_da_loja a ORDER BY id",
      )
    ).rows,
  );
const chaveGuardada = async () =>
  (await C().query("SELECT chave_hash FROM public.assinatura_da_loja_chave"))
    .rows;
/** O cartao como ja estava numa loja: com recursos, observacao e um dia guardado. */
const semearCartao = async () => {
  await limpar();
  await C().query(
    `INSERT INTO public.assinatura_da_loja (id, plano, status, ciclo, valor_mensal, teste_ate, proxima_cobranca_em, pausa_em, recursos, observacao, atualizado_em)
     VALUES (1, 'Pro', 'atrasada', 'mensal', 250, '2026-12-03', '2026-12-03', '2026-12-07', ARRAY['x'], 'nota', '2026-11-20T10:00:00Z')`,
  );
};
/** Colunas de TODAS as tabelas de public (menos a coluna nova): a migration nao pode mexer em mais nada. */
const colunasDePublic = async () =>
  (
    await C().query(
      `SELECT c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull AS x
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v', 'm', 'p') AND a.attnum > 0 AND NOT a.attisdropped
          AND NOT (c.relname = 'assinatura_da_loja' AND a.attname = 'pausa_em')
        ORDER BY 1`,
    )
  ).rows.map((r) => r.x);

prova(
  "MIGRATION: reaplicar (2x) e em CRLF deixa o MESMO estado (OID, corpo, ACL, coluna); o cartao, o dia guardado e a chave ficam como estavam",
  async () => {
    await P.emTransacao(async () => {
      await semearCartao();
      const antes = await estado();
      const cartaoAntes = await cartaoCru();
      await C().query(MIGRATION);
      await C().query(P.emCRLF(MIGRATION));
      assert.deepEqual(await estado(), antes);
      assert.equal(await cartaoCru(), cartaoAntes);
      assert.equal(await pausa(), "2026-12-07");
      assert.deepEqual(await chaveGuardada(), [{ chave_hash: HASH }]);
      assert.equal(
        gravou(await gravar(CHAVE, com(NOVA, { atualizado_em: carimbo(50) }))),
        true,
        "a chave guardada deixou de abrir a porta",
      );
    });
  },
);

prova(
  "ROLLBACK COMUM: a porta volta a da 20261399998000 (md5 565f82..., ACL, comentario) e MANTEM a coluna com o dia; repetir e reaplicar e' seguro",
  async () => {
    await P.emTransacao(async () => {
      await semearCartao();
      const cartaoAntes = await cartaoCru();
      const oidAntes = (await estado()).porta[0].oid;
      await C().query(ROLLBACK_SQL);
      const e = await estado();
      assert.equal(e.porta.length, 1);
      assert.equal(e.porta[0].md5, H_VELHO);
      assert.equal(e.porta[0].oid, oidAntes, "CREATE OR REPLACE guarda o OID");
      assert.equal(e.porta[0].cfg, '{"search_path=public, pg_temp"}');
      assert.equal(e.porta[0].prosecdef, true);
      assert.match(
        e.porta[0].comentario,
        /^Porta unica do app de gestao: grava o cartao da assinatura \(10 campos, lista branca;/,
      );
      assert.equal(await temColuna(), true, "o comum apagou a coluna");
      assert.equal(
        await pausa(),
        "2026-12-07",
        "o comum perdeu o dia guardado",
      );
      assert.equal(await cartaoCru(), cartaoAntes);
      assert.deepEqual(await chaveGuardada(), [{ chave_hash: HASH }]);
      // a porta velha: recusa a gestao nova (o recuo) e grava a velha sem tocar o dia
      const x = await gravar(CHAVE, com(NOVA, { atualizado_em: carimbo(51) }));
      assert.equal(x.detalhe, "campo: pausa_em");
      assert.equal(
        gravou(await gravar(CHAVE, com(VELHA, { atualizado_em: carimbo(52) }))),
        true,
      );
      assert.equal(await pausa(), "2026-12-07", "a porta velha tocou a coluna");
      const depois = await estado();
      await C().query(ROLLBACK_SQL); // no-op
      assert.deepEqual(await estado(), depois);
      await C().query(MIGRATION);
      assert.equal(await hPorta(), H_NOVO);
      assert.equal(await pausa(), "2026-12-07");
    });
  },
);

prova(
  "ROLLBACK COMUM: recusa (B1) porta com corpo desconhecido, sobrecarga e pausa_em de outro tipo, sem mudar nada",
  async () => {
    const casos = [
      [
        "porta com corpo desconhecido",
        "CREATE OR REPLACE FUNCTION public.assinatura_da_loja_gravar(p_chave text, p_dados jsonb, p_simular boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$",
        /nao e o da 20261590000000 nem o da 20261399998000/,
      ],
      [
        "sobrecarga da porta",
        "CREATE FUNCTION public.assinatura_da_loja_gravar(p_x text) RETURNS void LANGUAGE sql AS $$ SELECT $$",
        /ausente ou com sobrecarga/,
      ],
      [
        "pausa_em de outro tipo",
        "ALTER TABLE public.assinatura_da_loja ALTER COLUMN pausa_em TYPE text",
        /nao tem a forma de 13 nem a de 14 colunas/,
      ],
    ];
    for (const [nome, sql, padrao] of casos) {
      await P.emTransacao(async () => {
        await C().query(sql);
        const antes = await estado();
        const r = await P.recusa(ROLLBACK_SQL, padrao);
        assert.match(r.erro, /B1_BASELINE_DIVERGENT/, nome);
        assert.deepEqual(await estado(), antes, `${nome}: deixou rastro`);
      });
    }
  },
);

prova(
  "ROLLBACK DESTRUTIVO: exige confirmacao, o comum antes e nenhuma funcao citando pausa_em; depois so a coluna some, o cartao e a chave ficam, e a 20261399998000 volta a ser reaplicavel",
  async () => {
    await P.emTransacao(async () => {
      await semearCartao();
      await P.recusa(DESTRUTIVO_SQL, /PAUSA_SO_COM_O_DONO/);
      await P.recusa(DESTRUTIVO_CONFIRMADO, /PAUSA_ROLLBACK_COMUM_PRIMEIRO/);
      assert.equal(await temColuna(), true);
      await C().query(ROLLBACK_SQL);
      // uma funcao de outro lote que le a coluna: recusa (o plpgsql e o sql nao registram dependencia de coluna no corpo)
      await C().query(
        "CREATE FUNCTION public.le_o_dia_da_pausa_de_prova() RETURNS date LANGUAGE sql STABLE AS $$ SELECT pausa_em FROM public.assinatura_da_loja WHERE id = 1 $$",
      );
      await P.recusa(
        DESTRUTIVO_CONFIRMADO,
        /PAUSA_EM_USO: .*le_o_dia_da_pausa_de_prova/,
      );
      assert.equal(await temColuna(), true, "recusou mas apagou");
      await C().query("DROP FUNCTION public.le_o_dia_da_pausa_de_prova()");
      const cartaoAntes = await cartaoCru();
      await C().query(DESTRUTIVO_CONFIRMADO);
      assert.equal(await temColuna(), false);
      assert.equal(
        await cartaoCru(),
        cartaoAntes,
        "o destrutivo mexeu no resto do cartao",
      );
      assert.deepEqual(await chaveGuardada(), [{ chave_hash: HASH }]);
      assert.equal(await hPorta(), H_VELHO);
      await C().query(DESTRUTIVO_CONFIRMADO); // de novo: no-op
      assert.equal(await temColuna(), false);
      // a 20261399998000 volta a ser reaplicavel (o pre-voo dela exige as 13 colunas) e a porta velha grava
      await C().query(ANTERIOR);
      assert.equal(await hPorta(), H_VELHO);
      assert.equal(
        gravou(await gravar(CHAVE, com(VELHA, { atualizado_em: carimbo(53) }))),
        true,
      );
      // e a migration volta: a coluna renasce vazia, o resto do cartao fica
      await C().query(MIGRATION);
      assert.equal(await hPorta(), H_NOVO);
      assert.equal(await pausa(), null);
    });
  },
);

prova(
  "RETRATO: fora a coluna e a porta, NADA muda - funcoes (OID, corpo, ACL), ACL das tabelas, politicas, gatilhos, restricoes e colunas iguais com, sem e reaplicada",
  async () => {
    await P.emTransacao(async () => {
      const alvo = { funcoes: ["assinatura_da_loja_gravar"] };
      const comMig = { r: await P.retrato(alvo), c: await colunasDePublic() };
      await C().query(ROLLBACK_SQL);
      await C().query(DESTRUTIVO_CONFIRMADO);
      const semMig = { r: await P.retrato(alvo), c: await colunasDePublic() };
      await C().query(MIGRATION);
      const depois = { r: await P.retrato(alvo), c: await colunasDePublic() };
      assert.deepEqual(semMig, comMig, "a migration mudou algo que ja existia");
      assert.deepEqual(depois, comMig, "reaplicar mudou algo que ja existia");
    });
  },
);

prova(
  "PRE-VOO: recusa SEM escrever (porta estranha, ausente ou sobrecarregada, pausa_em de outro tipo ou NOT NULL, cartao torto, definir_chave estranha, tabela da chave ausente)",
  async () => {
    const voltar = async () => {
      await C().query(ROLLBACK_SQL);
      await C().query(DESTRUTIVO_CONFIRMADO);
    };
    const casos = [
      [
        "corpo desconhecido da porta",
        async () => {
          await voltar();
          await C().query(
            "CREATE OR REPLACE FUNCTION public.assinatura_da_loja_gravar(p_chave text, p_dados jsonb, p_simular boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$",
          );
        },
        /assinatura_da_loja_gravar\(text, jsonb, boolean\) tem corpo desconhecido/,
      ],
      [
        "porta ausente",
        async () => {
          await voltar();
          await C().query(`DROP FUNCTION ${GRAVAR}`);
        },
        /nao existe \(ausente ou com outra assinatura\)/,
      ],
      [
        "sobrecarga da porta",
        async () => {
          await C().query(
            "CREATE FUNCTION public.assinatura_da_loja_gravar(p_x text) RETURNS void LANGUAGE sql AS $$ SELECT $$",
          );
        },
        /tem sobrecarga em public/,
      ],
      [
        "pausa_em de outro tipo",
        async () => {
          await voltar();
          await C().query(
            "ALTER TABLE public.assinatura_da_loja ADD COLUMN pausa_em text",
          );
        },
        /nao tem a forma da 20261177000000 nem a desta migration/,
      ],
      [
        "pausa_em NOT NULL",
        async () => {
          await C().query("DELETE FROM public.assinatura_da_loja");
          await C().query(
            "ALTER TABLE public.assinatura_da_loja ALTER COLUMN pausa_em SET NOT NULL",
          );
        },
        /nao tem a forma da 20261177000000 nem a desta migration/,
      ],
      [
        "cartao com coluna a mais",
        async () => {
          await C().query(
            "ALTER TABLE public.assinatura_da_loja ADD COLUMN extra text",
          );
        },
        /nao tem a forma da 20261177000000 nem a desta migration/,
      ],
      [
        "definir_chave com corpo desconhecido",
        async () => {
          await C().query(
            "CREATE OR REPLACE FUNCTION public.assinatura_da_loja_definir_chave(p_hash text, p_substituir boolean DEFAULT false) RETURNS void LANGUAGE sql AS $$ SELECT $$",
          );
        },
        /assinatura_da_loja_definir_chave\(text, boolean\) tem corpo desconhecido/,
      ],
      [
        "tabela da chave ausente",
        async () => {
          await C().query("DROP TABLE public.assinatura_da_loja_chave");
        },
        /assinatura_da_loja_chave ausente ou com outra forma/,
      ],
    ];
    for (const [nome, montar, padrao] of casos) {
      await P.emTransacao(async () => {
        await montar();
        const antes = await estado();
        const r = await P.recusa(MIGRATION, padrao);
        assert.match(r.erro, /B1_BASELINE_DIVERGENT/, nome);
        assert.deepEqual(
          await estado(),
          antes,
          `${nome}: o pre-voo recusou mas deixou rastro`,
        );
      });
    }
  },
);

prova(
  "POS-VOO: passa no estado da migration e recusa cada estrago (coluna, padrao, ACL, PUBLIC, corpo, atributos, sobrecarga, definir_chave e leitor)",
  async () => {
    const bloco = P.blocoDe(MIGRATION, "conferencia_20261590000000");
    await P.emTransacao(async () => {
      assert.equal(
        await P.aplicar(bloco),
        null,
        "o pos-voo devia passar no estado da migration",
      );
    });
    const estragos = [
      [
        "padrao na coluna",
        "ALTER TABLE public.assinatura_da_loja ALTER COLUMN pausa_em SET DEFAULT current_date",
      ],
      [
        "coluna NOT NULL",
        "DELETE FROM public.assinatura_da_loja; ALTER TABLE public.assinatura_da_loja ALTER COLUMN pausa_em SET NOT NULL",
      ],
      [
        "coluna de outro tipo",
        "ALTER TABLE public.assinatura_da_loja ALTER COLUMN pausa_em TYPE timestamptz",
      ],
      [
        "coluna a mais",
        "ALTER TABLE public.assinatura_da_loja ADD COLUMN extra text",
      ],
      [
        "a porta ao service_role",
        `GRANT EXECUTE ON FUNCTION ${GRAVAR} TO service_role`,
      ],
      ["a porta a PUBLIC", `GRANT EXECUTE ON FUNCTION ${GRAVAR} TO PUBLIC`],
      ["a porta sem o anon", `REVOKE EXECUTE ON FUNCTION ${GRAVAR} FROM anon`],
      [
        "a porta sem o authenticated",
        `REVOKE EXECUTE ON FUNCTION ${GRAVAR} FROM authenticated`,
      ],
      [
        "corpo da porta trocado",
        "CREATE OR REPLACE FUNCTION public.assinatura_da_loja_gravar(p_chave text, p_dados jsonb, p_simular boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN '{}'::jsonb; END; $f$",
      ],
      [
        "search_path da porta",
        `ALTER FUNCTION ${GRAVAR} SET search_path = public`,
      ],
      [
        "porta como SECURITY INVOKER",
        `ALTER FUNCTION ${GRAVAR} SECURITY INVOKER`,
      ],
      ["porta STABLE", `ALTER FUNCTION ${GRAVAR} STABLE`],
      [
        "sobrecarga da porta",
        "CREATE FUNCTION public.assinatura_da_loja_gravar(p_x text) RETURNS void LANGUAGE sql AS $f$ SELECT $f$",
      ],
      [
        "definir_chave trocada",
        "CREATE OR REPLACE FUNCTION public.assinatura_da_loja_definir_chave(p_hash text, p_substituir boolean DEFAULT false) RETURNS void LANGUAGE sql AS $f$ SELECT $f$",
      ],
      [
        "leitor trocado",
        "CREATE OR REPLACE FUNCTION public.assinatura_da_loja_ler() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN NULL; END; $f$",
      ],
    ];
    for (const [nome, sql] of estragos) {
      await P.emTransacao(async () => {
        await C().query(sql);
        const r = await P.recusa(bloco, /B2_POSVOO_DIVERGENTE/);
        assert.ok(r, nome);
      });
    }
  },
);

prova(
  "ATOMICIDADE: pos-voo que falha numa conexao SEM BEGIN desfaz o arquivo inteiro (nem a coluna, nem a porta nova ficam)",
  async () => {
    const dono = await nova();
    try {
      await dono.query("BEGIN");
      await dono.query(ROLLBACK_SQL);
      await dono.query(DESTRUTIVO_CONFIRMADO);
      await dono.query("COMMIT"); // estado "antes", de verdade
      assert.equal(await temColuna(dono), false);
      const sabotada = MIGRATION.replace(
        `IS DISTINCT FROM '${H_NOVO}' THEN`,
        `IS DISTINCT FROM '${"0".repeat(32)}' THEN`,
      );
      assert.notEqual(sabotada, MIGRATION);
      let erro;
      try {
        await dono.query(sabotada);
      } catch (e) {
        erro = e;
      }
      assert.ok(erro, "o arquivo sabotado devia falhar no pos-voo");
      assert.match(erro.message, /B2_POSVOO_DIVERGENTE/);
      assert.equal(
        await temColuna(dono),
        false,
        "a falha no fim deixou a coluna",
      );
      assert.equal(
        await hPorta(dono),
        H_VELHO,
        "a falha no fim deixou a porta nova",
      );
    } finally {
      await dono.query("ROLLBACK").catch(() => {});
      await dono.query("BEGIN");
      await dono.query(MIGRATION);
      await dono.query("COMMIT");
      await dono.end();
    }
    const ok = await nova();
    try {
      assert.equal(
        await hPorta(ok),
        H_NOVO,
        "a migration nao foi restaurada no clone",
      );
      assert.equal(await temColuna(ok), true);
    } finally {
      await ok.end();
    }
  },
);

prova(
  "TRAVA: uma leitura em voo do cartao faz a migration FALHAR LIMPA no lock_timeout de 5 s (55P03) sem mudar nada, e depois aplica",
  async () => {
    const c2 = await nova();
    const c1 = await nova();
    try {
      await c2.query("BEGIN");
      await c2.query("SELECT count(*) FROM public.assinatura_da_loja"); // segura ACCESS SHARE
      await c1.query("BEGIN");
      const antes = await estado(c1);
      const t0 = Date.now();
      let erro;
      try {
        await c1.query(MIGRATION);
      } catch (e) {
        erro = e;
      }
      const espera = Date.now() - t0;
      await c1.query("ROLLBACK");
      assert.ok(
        erro,
        "a migration devia falhar no lock_timeout, nao travar nem passar",
      );
      assert.equal(
        erro.code,
        "55P03",
        `esperava lock_not_available, veio ${erro.code}: ${erro.message}`,
      );
      assert.ok(
        espera >= 4000 && espera < 15000,
        `esperou ${espera} ms (esperado ~5 s)`,
      );
      assert.deepEqual(await estado(c1), antes);
      await c2.query("ROLLBACK");
      await c1.query("BEGIN");
      await c1.query(MIGRATION);
      assert.equal(await hPorta(c1), H_NOVO);
      await c1.query("ROLLBACK");
    } finally {
      await c2.query("ROLLBACK").catch(() => {});
      await c1.query("ROLLBACK").catch(() => {});
      await c2.end().catch(() => {});
      await c1.end().catch(() => {});
    }
  },
);

// ---- A CONFERENCIA ANTIGA aprende a sucessora: a 150c (da 20261399998000) responde "sim" com e sem esta migration -----------------
const A150C = "150c-conferir-a-loja-recebe-o-plano-por-porta-unica-aplicado";
prova(
  "CONSULTA 150c: fecha 8 de 8 com esta migration no ar, depois do rollback comum e depois do destrutivo; um corpo alheio da porta continua reprovando",
  async () => {
    await P.emTransacao(async () => {
      assert.deepEqual(await P.consulta(A150C), [], "com a 20261590000000");
      await C().query(ROLLBACK_SQL);
      assert.deepEqual(await P.consulta(A150C), [], "depois do comum");
      await C().query(DESTRUTIVO_CONFIRMADO);
      assert.deepEqual(await P.consulta(A150C), [], "depois do destrutivo");
    });
    await P.emTransacao(async () => {
      await C().query(
        "CREATE OR REPLACE FUNCTION public.assinatura_da_loja_gravar(p_chave text, p_dados jsonb, p_simular boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ BEGIN RETURN '{}'::jsonb; END; $f$",
      );
      const f = await P.consulta(A150C);
      assert.ok(
        f.length >= 1 && f.every((x) => /gravar: uma so, com o corpo/.test(x)),
        JSON.stringify(f),
      );
    });
  },
);

(async () => {
  await P.conectar();
  try {
    await P.executar("a-loja-guarda-o-dia-da-pausa-do-teste");
  } finally {
    await P.conexao()
      .end()
      .catch(() => {});
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
