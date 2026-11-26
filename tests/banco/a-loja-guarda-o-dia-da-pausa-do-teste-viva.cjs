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
 *  MUTANTES      pausa_em obrigatoria, ausente que nao apaga, data solta, pausa_em validada antes de autenticar, pausa_em fora do laco das datas (so o cast),
 *                lista branca sem a opcional, simulacao sem pausa_em: cada um FICA VERMELHO na expectativa certa.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-loja-guarda-o-dia-da-pausa-do-teste-viva.cjs
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova, md5, sha256 } = P;

const NOME = "20261590000000_a_loja_guarda_o_dia_da_pausa_do_teste.sql";
const MIGRATION = P.lerMigration(NOME);
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
