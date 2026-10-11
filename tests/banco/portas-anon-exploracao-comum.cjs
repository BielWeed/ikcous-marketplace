"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (QUEM, os nomes
 * de tabela do catálogo do Postgres efêmero); nunca de entrada de rede nem de
 * payload de terceiro. */

/**
 * MOTOR da medição "o que um estranho faz com as portas abertas" (auditoria de
 * pagamento e segurança, 10/10/2026, tarefas A5a, A5b e A5c). Os três scripts
 * `portas-anon-exploracao-{dinheiro,dados,estoque-otp}.cjs` só descrevem os
 * CASOS; este arquivo faz a medição, igual para todos.
 *
 * O QUE ELA PERGUNTA, por função: se o `EXECUTE` do visitante sem login (anon)
 * estivesse aberto — como está nos bancos restaurados sem as permissões —, o que
 * ele conseguiria? O banco de teste do CI nasce das migrations, onde quase tudo
 * já foi fechado; por isso cada caso REPRODUZ a porta aberta de propósito:
 *
 *   BEGIN
 *     fixtures SINTÉTICAS (criadas aqui, dentro da transação)
 *     CONTROLE: o mesmo chamado feito por quem pode (admin, dono do pedido ou
 *               service_role), para provar que a fixture é válida; desfeito
 *     GRANT EXECUTE ... TO anon          (reproduz a porta aberta)
 *     SET LOCAL ROLE anon + claims anônimos + chamar
 *     impressão digital das tabelas de `public` e de `auth.users` ANTES e DEPOIS
 *   ROLLBACK                              (nada fica no banco)
 *
 * VEREDITO por linha `PORTA <função> -> <veredito> <detalhe>`:
 *   escreveu      a chamada passou e alguma tabela mudou (as tabelas vêm no detalhe)
 *   vazou         a chamada passou, nada mudou e a resposta traz dado sentinela
 *                 (CPF, custo, e-mail de outra pessoa) ou o oráculo respondeu
 *   recusou       a função barrou (código e frase no detalhe). Em função de LEITURA
 *                 ou de DML, "passou mas não devolveu nada nem mudou nada" também é
 *                 `recusou`, marcado "silencioso"
 *   executou      a chamada passou sem efeito observável (a porta abre, mas a
 *                 fixture não deu o que observar)
 *   inconclusivo  o CONTROLE legítimo recebeu a MESMA recusa (a função falha para
 *                 todos: fixture inválida, função morta) ou o próprio caso quebrou
 *   AUSENTE       a assinatura esperada não existe neste banco
 *
 * É MEDIÇÃO, NÃO PORTÃO: o script sempre sai 0 (o resultado é a tabela no log e
 * no resumo do job). O que faz um resultado valer é o AUTOTESTE: antes dos casos
 * reais, cinco funções sintéticas provam que o classificador enxerga uma escrita,
 * um vazamento e uma recusa. Se o autoteste falhar, a tabela inteira vem marcada
 * "MEDIÇÃO INVÁLIDA". A única saída diferente de 0 é a trava de banco (efemero.cjs
 * recusa qualquer banco que não seja o efêmero do job).
 *
 * A "definição viva" de cada função é a da última migration que a recria: o banco
 * efêmero do rpc-ci aplica todas, e cada linha traz o `md5` do corpo (a mesma
 * fórmula da consulta 18a) para ligar a medição ao que está no repositório.
 */

const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

// ---- Identidades sintéticas (prefixo a5, nunca colidem com as outras provas) ----
const U_ADMIN = "a5000000-0000-4000-8000-000000000001";
const U_CLIENTE = "a5000000-0000-4000-8000-000000000002";
const U_VITIMA = "a5000000-0000-4000-8000-000000000003";
const P_PRODUTO = "a5aaaaaa-0000-4000-8000-000000000001";

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });

// Quem chama: o papel do Postgres (o que o PostgREST faz com SET ROLE), o
// "login" (o auth.uid() desta suíte lê app.rpc.user_id) e o JWT.
const QUEM = {
  anon: { papel: "anon", uid: "", jwt: JSON.stringify({ role: "anon" }) },
  cliente: {
    papel: "authenticated",
    uid: U_CLIENTE,
    jwt: claims(U_CLIENTE, null),
  },
  vitima: {
    papel: "authenticated",
    uid: U_VITIMA,
    jwt: claims(U_VITIMA, null),
  },
  admin: {
    papel: "authenticated",
    uid: U_ADMIN,
    jwt: claims(U_ADMIN, "admin"),
  },
  service: { papel: "service_role", uid: "", jwt: "" },
  // O cliente logado, chamando com o privilégio do dono do banco: para o CONTROLE
  // de funções que o repositório não concede a authenticated (só ao service_role)
  // e que precisam de sessão — prova que a fixture é válida.
  donoCliente: {
    papel: "postgres",
    uid: U_CLIENTE,
    jwt: claims(U_CLIENTE, null),
  },
};

const LIMITE_DETALHE = 260;
const recorta = (texto, n = LIMITE_DETALHE) => {
  const t = String(texto ?? "").replace(/\s+/g, " ");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * Roda UM comando como `quem`, dentro de um SAVEPOINT: erro não derruba a
 * transação do caso, e o ROLLBACK TO desfaz o SET LOCAL ROLE.
 */
async function como(c, quem, sql, params = []) {
  const q = QUEM[quem];
  await c.query("SAVEPOINT como");
  try {
    await c.query(`SET LOCAL ROLE ${q.papel}`);
    await c.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [q.uid, q.jwt],
    );
    const r = await c.query(sql, params);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT como");
    return { ok: true, dados: r.rows, rowCount: r.rowCount };
  } catch (erro) {
    await c.query("ROLLBACK TO SAVEPOINT como");
    await c.query("RELEASE SAVEPOINT como");
    return { ok: false, code: erro.code, message: erro.message };
  }
}

/** Atalho: um chamado simples; `params` pode ser função do contexto do caso. */
const chamar =
  (quem, sql, params = []) =>
  (c, ctx) =>
    como(c, quem, sql, typeof params === "function" ? params(ctx) : params);

/**
 * Impressão digital de tudo que uma porta aberta poderia escrever: cada tabela
 * de `public` (hash do texto de todas as linhas) e `auth.users`.
 */
async function foto(c) {
  const t = await c.query(
    `SELECT c.relname FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
      ORDER BY 1`,
  );
  const partes = t.rows.map(
    (l) =>
      `SELECT ${c.escapeLiteral(`public.${l.relname}`)} AS t,
              md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) AS h
         FROM public.${c.escapeIdentifier(l.relname)} x`,
  );
  partes.push(
    `SELECT 'auth.users' AS t, md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM auth.users x`,
  );
  const r = await c.query(partes.join("\nUNION ALL\n"));
  return Object.fromEntries(r.rows.map((l) => [l.t, l.h]));
}

const mudou = (antes, depois) =>
  Object.keys(depois)
    .filter((k) => antes[k] !== depois[k])
    .concat(Object.keys(antes).filter((k) => !(k in depois)))
    .sort();

/** Fixtures que TODO caso usa: admin e cliente de verdade, loja, um produto. */
async function prepararBase(c) {
  // Fábrica do Supabase que o provisionar.cjs não emula (mesmo motivo do
  // admin-atual-viva.cjs): as políticas e as funções leem `auth.*` e `extensions`
  // como o papel que chama. Desfeito no ROLLBACK do caso.
  await c.query(
    "GRANT USAGE ON SCHEMA auth, extensions TO anon, authenticated, service_role",
  );
  // Colunas do auth.users REAL que o stub não tem e que algumas funções leem.
  await c.query(
    "ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb",
  );
  await c.query(
    "ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz",
  );
  for (const [id, email] of [
    [U_ADMIN, "admin.sintetico@teste.invalid"],
    [U_CLIENTE, "cliente.sintetico@teste.invalid"],
    [U_VITIMA, "vitima.sintetica@teste.invalid"],
  ]) {
    await c.query(
      `INSERT INTO auth.users (id, email, phone, raw_app_meta_data, email_confirmed_at)
       VALUES ($1::uuid, $2, NULL, '{}'::jsonb, now())`,
      [id, email],
    );
  }
  // O papel nasce em profiles e o gatilho o leva a auth.users: o caminho real.
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Admin Sintetico', 'admin'),
       ($2, 'Cliente Sintetico', 'customer'),
       ($3, 'Vitima Sintetica', 'customer')`,
    [U_ADMIN, U_CLIENTE, U_VITIMA],
  );
  await c.query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage)
     VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national')
     ON CONFLICT (id) DO UPDATE
       SET origin_cep = EXCLUDED.origin_cep,
           local_cep_range = EXCLUDED.local_cep_range,
           free_shipping_min = EXCLUDED.free_shipping_min,
           shipping_coverage = EXCLUDED.shipping_coverage`,
  );
  await c.query(
    `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo, frete_gratis)
     VALUES ($1, 'Produto Sintetico', 30.00, 50.00, 10, true, false)`,
    [P_PRODUTO],
  );
}

let seq = 0;
const novoId = (prefixo) => {
  seq += 1;
  return `${prefixo}-0000-4000-8000-${String(seq).padStart(12, "0")}`;
};

/** Pedido sintético inserido direto (fixture), com um item do produto-base. */
async function pedidoSintetico(c, o = {}) {
  const id = o.id || novoId("a5cccccc");
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_phone, customer_data, total, subtotal, status, canal,
        payment_method, payment_status, paid_at, gateway_payment_id, metodo_online,
        expires_at, valor_estornado, cancelled_after_shipping)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6, $7, 'online', $8, $9,
             CASE WHEN $10::boolean THEN now() ELSE NULL END, $11, $12, $13, 0, false)`,
    [
      id,
      o.userId === undefined ? U_CLIENTE : o.userId,
      o.nome || "Cliente Sintetico",
      o.telefone === undefined ? null : o.telefone,
      JSON.stringify(o.dados || {}),
      o.total === undefined ? 100 : o.total,
      o.status || "pending",
      o.pagamento || "online",
      o.paymentStatus === undefined ? "aguardando" : o.paymentStatus,
      o.pago === true,
      o.gateway === undefined ? null : o.gateway,
      o.metodoOnline === undefined ? null : o.metodoOnline,
      o.expiraEm === undefined ? "2099-01-01T00:00:00Z" : o.expiraEm,
    ],
  );
  const item = await c.query(
    `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
     VALUES ($1, $2, 'Item Sintetico', $3, 50) RETURNING id`,
    [id, P_PRODUTO, o.quantidade || 2],
  );
  return { id, itemId: item.rows[0].id };
}

async function umaLinha(c, sql, params = []) {
  const r = await c.query(sql, params);
  return r.rows[0] || null;
}

/** Texto que a medição procura na resposta: marcadores sentinela. */
function acharMarcadores(dados, marcadores) {
  const texto = JSON.stringify(dados ?? null);
  return (marcadores || []).filter((m) => texto.includes(m));
}

/**
 * Mede UM caso. Forma do caso:
 *   porta        rótulo da linha (função ou recurso + a variante testada)
 *   assinatura   `public.f(tipos)` — o GRANT reproduz a porta; null = não é função
 *   tambemAbre   outras assinaturas que o ataque encadeado também precisa abertas
 *   leitura      true: "passou sem devolver nada" conta como recusa silenciosa
 *   dml          true: idem para escrita direta (0 linhas afetadas)
 *   preparar     async (c) -> ctx   fixtures do caso (como superusuário)
 *   controle     async (c, ctx) -> resultado   o chamado legítimo (opcional)
 *   ataque       async (c, ctx) -> resultado   o chamado do estranho
 *   marcadores   (ctx) -> [string]  texto sentinela que não pode sair
 *   vazouSe      (dados, ctx) -> string|null  critério próprio de vazamento
 *   observar     async (c, ctx) -> string     antes/depois de valores nomeados
 *   esperado     veredito que o AUTOTESTE exige (só nos casos sintéticos)
 */
async function medir(c, caso) {
  const linha = { porta: caso.porta, veredito: "inconclusivo", detalhe: "" };
  await c.query("BEGIN");
  try {
    await prepararBase(c);
    const ctx = (caso.preparar ? await caso.preparar(c) : {}) || {};
    let abertaNoRepo = "n/a";
    let corpo = "";
    if (caso.assinatura) {
      const f = await umaLinha(
        c,
        `SELECT p.oid,
                md5(replace(p.prosrc, chr(13), '')) AS md5,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
           FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
        [caso.assinatura],
      );
      if (!f) {
        linha.veredito = "AUSENTE";
        linha.detalhe = `a assinatura ${caso.assinatura} não existe neste banco`;
        return linha;
      }
      abertaNoRepo = f.anon ? "sim" : "nao";
      corpo = f.md5.slice(0, 10);
    }

    // CONTROLE: o chamado legítimo, desfeito logo depois.
    let ctl = null;
    if (caso.controle) {
      await c.query("SAVEPOINT controle");
      const a = await foto(c);
      ctl = await caso.controle(c, ctx);
      ctl.mudou = mudou(a, await foto(c));
      await c.query("ROLLBACK TO SAVEPOINT controle");
      await c.query("RELEASE SAVEPOINT controle");
    }

    // A PORTA ABERTA, de propósito.
    for (const assinatura of [caso.assinatura, ...(caso.tambemAbre || [])]) {
      if (assinatura) {
        await c.query(`GRANT EXECUTE ON FUNCTION ${assinatura} TO anon`);
      }
    }
    const antesObs = caso.observar ? await caso.observar(c, ctx) : null;
    const antes = await foto(c);
    const ataque = await caso.ataque(c, ctx);
    const tabelas = mudou(antes, await foto(c));
    const depoisObs = caso.observar ? await caso.observar(c, ctx) : null;

    const extras = [];
    if (caso.assinatura)
      extras.push(`aberta_no_repo=${abertaNoRepo}`, `corpo=${corpo}`);
    const notaCtl = ctl
      ? ctl.ok
        ? ctl.mudou.length
          ? `controle ok (gravou ${ctl.mudou.length} tabela(s))`
          : "controle ok (sem escrita)"
        : `controle falhou: ${ctl.code} ${recorta(ctl.message, 90)}`
      : null;
    if (notaCtl) extras.push(notaCtl);
    const obs =
      antesObs !== null && depoisObs !== null
        ? `${antesObs} -> ${depoisObs}`
        : null;

    if (!ataque.ok) {
      const igual =
        ctl &&
        !ctl.ok &&
        ctl.code === ataque.code &&
        ctl.message === ataque.message;
      if (igual) {
        linha.veredito = "inconclusivo";
        linha.detalhe = `o controle legítimo recebeu a MESMA recusa (${ataque.code} ${recorta(ataque.message, 110)}): a função falha para todos`;
      } else {
        linha.veredito = "recusou";
        linha.detalhe = `${ataque.code || "?"} ${recorta(ataque.message, 140)}`;
      }
      linha.detalhe = recorta(`${linha.detalhe} | ${extras.join(" | ")}`);
      return linha;
    }

    const marcou = acharMarcadores(ataque.dados, caso.marcadores?.(ctx));
    const criterio = caso.vazouSe ? caso.vazouSe(ataque.dados, ctx) : null;
    const vazou = marcou.length > 0 || Boolean(criterio);
    const vazouTxt = [
      marcou.length ? `marcadores na resposta: ${marcou.join(",")}` : null,
      criterio,
    ]
      .filter(Boolean)
      .join("; ");
    if (tabelas.length) {
      linha.veredito = "escreveu";
      linha.detalhe = `tabelas alteradas: ${tabelas.join(",")}${vazou ? ` | e vazou: ${vazouTxt}` : ""}`;
    } else if (vazou) {
      linha.veredito = "vazou";
      linha.detalhe = vazouTxt;
    } else if (
      (caso.leitura || (caso.dml && ataque.rowCount === 0)) &&
      !tabelas.length
    ) {
      // "Passou e não devolveu nada" só é RECUSA se o controle legítimo, com a
      // mesma fixture, viu o que o estranho não viu — senão a fixture é que está
      // vazia e a medição não diz nada.
      const controleViu =
        ctl?.ok &&
        (caso.dml
          ? ctl.rowCount > 0
          : ctl.dados.length > 0 &&
            JSON.stringify(ctl.dados) !== JSON.stringify(ataque.dados));
      if (controleViu) {
        linha.veredito = "recusou";
        linha.detalhe = `silencioso: passou, mas ${caso.dml ? "0 linhas afetadas" : "devolveu vazio/NULL, sem dado sentinela"} e nada mudou, enquanto o controle legítimo viu o dado (${recorta(JSON.stringify(ataque.dados), 60)})`;
      } else {
        linha.veredito = "inconclusivo";
        linha.detalhe = `passou sem dado e sem escrita, mas o controle legítimo também não viu nada diferente: a fixture não deu o que observar (${recorta(JSON.stringify(ataque.dados), 60)})`;
      }
    } else {
      linha.veredito = "executou";
      linha.detalhe = `sem efeito observável (${recorta(JSON.stringify(ataque.dados), 100)})`;
    }
    if (obs) linha.detalhe += ` | ${obs}`;
    if (ataque.nota) linha.detalhe += ` | ${ataque.nota}`;
    linha.detalhe = recorta(`${linha.detalhe} | ${extras.join(" | ")}`, 640);
    return linha;
  } catch (erro) {
    linha.veredito = "inconclusivo";
    linha.detalhe = `a medição quebrou neste caso: ${erro.code || ""} ${recorta(erro.message, 200)}`;
    return linha;
  } finally {
    await c.query("ROLLBACK").catch(() => {});
  }
}

// ---- AUTOTESTE: o classificador enxerga escrita, vazamento e recusa ----------
const SENTINELA = "SEGREDO-SINTETICO-18A";
const CASOS_AUTOTESTE = [
  {
    porta: "autoteste: função que escreve sem guarda",
    assinatura: "public.zz_porta_escreve(integer)",
    esperado: "escreveu",
    preparar: async (c) => {
      await c.query(
        "CREATE TABLE public.zz_alvo (id integer PRIMARY KEY, v text)",
      );
      await c.query("INSERT INTO public.zz_alvo VALUES (1, 'antes')");
      await c.query(
        `CREATE FUNCTION public.zz_porta_escreve(p integer) RETURNS integer
           LANGUAGE sql SECURITY DEFINER SET search_path = public
           AS $$ UPDATE public.zz_alvo SET v = 'depois' WHERE id = p RETURNING 1 $$`,
      );
      return {};
    },
    ataque: chamar("anon", "SELECT public.zz_porta_escreve(1) AS r"),
  },
  {
    porta: "autoteste: função que devolve dado sentinela",
    assinatura: "public.zz_porta_vaza()",
    esperado: "vazou",
    preparar: async (c) => {
      await c.query(
        `CREATE FUNCTION public.zz_porta_vaza() RETURNS text
           LANGUAGE sql SECURITY DEFINER SET search_path = public
           AS $$ SELECT '${SENTINELA}'::text $$`,
      );
      return {};
    },
    marcadores: () => [SENTINELA],
    ataque: chamar("anon", "SELECT public.zz_porta_vaza() AS r"),
  },
  {
    porta: "autoteste: função com guarda de sessão",
    assinatura: "public.zz_porta_fechada()",
    esperado: "recusou",
    preparar: async (c) => {
      await c.query(
        `CREATE FUNCTION public.zz_porta_fechada() RETURNS integer
           LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
           AS $$ BEGIN
                   IF auth.uid() IS NULL THEN
                     RAISE EXCEPTION 'sem sessao' USING ERRCODE = '42501';
                   END IF;
                   RETURN 1;
                 END $$`,
      );
      return {};
    },
    controle: chamar("cliente", "SELECT public.zz_porta_fechada() AS r"),
    ataque: chamar("anon", "SELECT public.zz_porta_fechada() AS r"),
  },
  {
    porta: "autoteste: função que falha para todos",
    assinatura: "public.zz_porta_quebrada()",
    esperado: "inconclusivo",
    preparar: async (c) => {
      await c.query(
        `CREATE FUNCTION public.zz_porta_quebrada() RETURNS integer
           LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
           AS $$ BEGIN RAISE EXCEPTION 'quebrada para todos'; END $$`,
      );
      return {};
    },
    controle: chamar("cliente", "SELECT public.zz_porta_quebrada() AS r"),
    ataque: chamar("anon", "SELECT public.zz_porta_quebrada() AS r"),
  },
  {
    porta: "autoteste: assinatura que não existe",
    assinatura: "public.zz_porta_inexistente()",
    esperado: "AUSENTE",
    ataque: chamar("anon", "SELECT 1"),
  },
];

/**
 * Roda o autoteste e os casos, imprime a tabela e o resumo. SEMPRE sai 0
 * (medição), a não ser a trava de banco efêmero.
 */
async function rodar(titulo, casos) {
  const url = lerDatabaseUrlEfemera();
  const c = new Client({ connectionString: url });
  try {
    await c.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  const linhas = [];
  let autotesteOk = true;
  const problemasAutoteste = [];
  try {
    console.log(`\n[${titulo}] AUTOTESTE do classificador`);
    for (const caso of CASOS_AUTOTESTE) {
      const r = await medir(c, caso);
      const ok = r.veredito === caso.esperado;
      if (!ok) {
        autotesteOk = false;
        problemasAutoteste.push(
          `${caso.porta}: esperado ${caso.esperado}, saiu ${r.veredito} (${r.detalhe})`,
        );
      }
      console.log(`  ${ok ? "ok " : "ERRO"} ${caso.porta} -> ${r.veredito}`);
    }
    console.log(
      autotesteOk
        ? `[${titulo}] AUTOTESTE: ok — o classificador enxerga escrita, vazamento, recusa, falha geral e função ausente`
        : `[${titulo}] AUTOTESTE: FALHOU — MEDIÇÃO INVÁLIDA, as linhas PORTA abaixo NÃO valem`,
    );
    for (const caso of casos) {
      const r = await medir(c, caso);
      linhas.push(r);
      console.log(`PORTA ${r.porta} -> ${r.veredito} ${r.detalhe}`);
    }
  } catch (erro) {
    console.log(`[${titulo}] ERRO DA MEDIÇÃO: ${erro.message}`);
    problemasAutoteste.push(`erro fora dos casos: ${erro.message}`);
    autotesteOk = false;
  } finally {
    await c.end().catch(() => {});
  }

  const contagem = {};
  for (const l of linhas)
    contagem[l.veredito] = (contagem[l.veredito] || 0) + 1;
  const resumo = Object.entries(contagem)
    .sort()
    .map(([k, v]) => `${v} ${k}`)
    .join(", ");
  console.log(
    `\n[${titulo}] ${linhas.length} porta(s) medida(s): ${resumo || "nenhuma"}${autotesteOk ? "" : " — MEDIÇÃO INVÁLIDA (autoteste falhou)"}`,
  );
  const tabela = [
    "| porta | veredito | detalhe |",
    "|---|---|---|",
    ...linhas.map(
      (l) =>
        `| \`${l.porta}\` | **${l.veredito}** | ${l.detalhe.replace(/\|/g, "\\|")} |`,
    ),
  ].join("\n");
  anexarAoSummary(
    `Portas do anônimo — ${titulo} (medição, não portão)`,
    `${autotesteOk ? "Autoteste do classificador: ok." : `**MEDIÇÃO INVÁLIDA**: ${problemasAutoteste.join("; ")}`}\n\n${tabela}\n\n**${linhas.length} porta(s)**: ${resumo || "nenhuma"}.`,
  );
  // Medição: sempre 0.
  process.exitCode = 0;
}

module.exports = {
  U_ADMIN,
  U_CLIENTE,
  U_VITIMA,
  P_PRODUTO,
  QUEM,
  claims,
  como,
  chamar,
  foto,
  mudou,
  novoId,
  pedidoSintetico,
  umaLinha,
  recorta,
  rodar,
};
