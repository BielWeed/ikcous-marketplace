// @ts-nocheck
/**
 * A PRIMEIRA ADMINISTRADORA da loja nova (plano nova-loja, B3, 26/11/2026;
 * scripts/frota/primeira-admin.mjs). Substitui as Telas P0–P3 do passo 8 de
 * docs/runbooks/producao-unica-fonte.md (SQL Editor) por UMA chamada à
 * Management API.
 *
 * O QUE ESTES TESTES TRAVAM (sem rede e sem banco: todo fetch é falso; o
 * cliente de verdade, supabase-gestao.mjs, fica no meio):
 *  - o e-mail entra por STDIN e não sai em lugar nenhum: nem na saída, nem no
 *    erro, nem com outra caixa; o token também não;
 *  - sem --aplicar: só leitura (read_only: true, nenhum UPDATE na rede);
 *  - com --aplicar: UMA requisição, BEGIN → SET LOCAL ROLE postgres → DO com as
 *    guardas (conta única, confirmada, 0 admins, conferência 1,1,1) → COMMIT;
 *  - já era a admin única: nada é gravado e o veredito é SIM;
 *  - existe OUTRA admin, e-mail não confirmado, sem conta: NÃO, sem escrita;
 *  - aspas, ponto e vírgula e dollar-quote no e-mail não viram SQL;
 *  - resposta ambígua da API: INCERTO, nunca SIM.
 */
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  decidir,
  executar,
  literalDoEmail,
  sqlDaPromocao,
  sqlDoDiagnostico,
} from "../scripts/frota/primeira-admin.mjs";

const { dividirEmStatements } = createRequire(import.meta.url)(
  "../scripts/publicacao/conferir-banco.cjs",
);

const TOKEN = "sbp_oauth_TOKEN_FALSO_inventado_0123456789";
const REF = "abcdefghijklmnopqrst";
// e-mail inventado (repositório público: nada de endereço real)
const EMAIL = "Lojista.Teste@exemplo.invalid";
const ARGV = ["--projeto", REF, "--loja", "loja-teste"];

/** Linha do diagnóstico: cliente confirmada, loja sem admin. */
function diag(extra = {}) {
  return {
    contas: 1,
    confirmada: true,
    cargo_login: "customer",
    tem_perfil: true,
    cargo_perfil: "customer",
    admins: 0,
    alvo_admin: false,
    ...extra,
  };
}

const PROMOVIDA = JSON.stringify({
  acao: "promovida",
  usuarios: 1,
  linhas: 1,
  admins: 1,
});

function resposta(status, corpo) {
  const texto =
    corpo === undefined
      ? null
      : typeof corpo === "string"
        ? corpo
        : JSON.stringify(corpo);
  return new Response(texto, {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** fetch falso: devolve as respostas na ordem e anota cada chamada. */
function fetchFalso(...respostas) {
  const chamadas = [];
  const f = (url, init = {}) => {
    chamadas.push({
      url: String(url),
      init,
      corpo: init.body ? JSON.parse(init.body) : undefined,
    });
    const r = respostas.shift();
    if (typeof r === "function") return r(url, init);
    if (r === undefined) throw new Error("fetch falso sem resposta");
    return Promise.resolve(r);
  };
  f.chamadas = chamadas;
  return f;
}

function deps(f, { entrada = `${EMAIL}\n`, token = TOKEN } = {}) {
  return {
    fetch: f,
    lerEntrada: async () => entrada,
    obterToken: async () => token,
    prazoMs: 2_000,
  };
}

/** Nada da saída (nem dos erros) pode carregar o e-mail ou o token. */
function assertSemVazamento(r, email = EMAIL) {
  const tudo = [...r.saida, ...r.erros].join("\n");
  for (const p of [email, email.toLowerCase(), TOKEN]) {
    assert(!tudo.includes(p), `a saída vazou um trecho proibido: ${p}`);
  }
}

function veredito(r) {
  const linha = r.saida.find((l) => l.startsWith("VEREDITO: "));
  assert(linha, `sem linha de VEREDITO:\n${r.saida.join("\n")}`);
  return linha;
}

function topo(sql) {
  return dividirEmStatements(sql)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

// ------------------------------------------------------------ caminho SIM --

Deno.test("SIM: com --aplicar, diagnóstico só-leitura e UMA transação de escrita", async () => {
  const f = fetchFalso(
    resposta(201, [diag()]),
    resposta(201, [{ resultado: PROMOVIDA }]),
  );
  const r = await executar([...ARGV, "--aplicar"], deps(f));
  assertEquals(r.codigo, 0);
  assertMatch(veredito(r), /^VEREDITO: SIM\b/);
  assertEquals(f.chamadas.length, 2);
  for (const c of f.chamadas) {
    assertEquals(
      c.url,
      `https://api.supabase.com/v1/projects/${REF}/database/query`,
    );
    assertEquals(c.init.method, "POST");
  }
  // 1ª: leitura
  assertEquals(f.chamadas[0].corpo.read_only, true);
  assert(!/\bUPDATE\b/i.test(f.chamadas[0].corpo.query));
  // 2ª: a escrita, na ordem do roteiro manual (passo 8, Tela P2)
  assertEquals(f.chamadas[1].corpo.read_only, false);
  const s = topo(f.chamadas[1].corpo.query);
  assertEquals(s[0], "BEGIN");
  assertEquals(s[1], "SET LOCAL ROLE postgres");
  assertEquals(s[2], "SET LOCAL lock_timeout = '10s'");
  assertMatch(s[3], /^SET LOCAL ikcous\.primeira_admin_email = '/);
  assertMatch(s[4], /^DO \$primeira_admin\$/);
  assertEquals(s[5], "COMMIT");
  // a ÚLTIMA instrução com linhas é a única que volta (pg-meta): uma linha só
  assertEquals(
    s[6],
    "SELECT current_setting('ikcous.primeira_admin_resultado', true) AS resultado",
  );
  assertEquals(s.length, 7);
  assertSemVazamento(r);
});

Deno.test("o e-mail chega ao SQL em minúsculas só DENTRO do banco; a saída diz só o tamanho", async () => {
  const f = fetchFalso(
    resposta(201, [diag()]),
    resposta(201, [{ resultado: PROMOVIDA }]),
  );
  const r = await executar([...ARGV, "--aplicar"], deps(f));
  assert(r.saida.includes(`e-mail recebido (${EMAIL.length} caracteres)`));
  // o literal vai como está; quem baixa a caixa é o lower() no SQL
  assertStringIncludes(f.chamadas[1].corpo.query, `'${EMAIL}'`);
  assertStringIncludes(f.chamadas[0].corpo.query, `lower('${EMAIL}')`);
  assertSemVazamento(r);
});

// --------------------------------------------------- sem --aplicar = leitura --

Deno.test("sem --aplicar: só o diagnóstico (read_only), nenhum UPDATE, veredito NÃO com o plano", async () => {
  const f = fetchFalso(resposta(201, [diag()]));
  const r = await executar(ARGV, deps(f));
  assertEquals(f.chamadas.length, 1);
  for (const c of f.chamadas) {
    assertEquals(c.corpo.read_only, true);
    assert(!/\b(UPDATE|INSERT|DELETE|BEGIN|COMMIT)\b/i.test(c.corpo.query));
  }
  assertEquals(r.codigo, 1);
  assertMatch(veredito(r), /^VEREDITO: NÃO\b/);
  assert(r.saida.some((l) => l.includes("--aplicar")));
  assertSemVazamento(r);
});

// ------------------------------------------------------------- já admin --

Deno.test("já era a admin única: nada é gravado e o veredito é SIM (já era admin)", async () => {
  for (const aplicar of [false, true]) {
    const f = fetchFalso(
      resposta(201, [
        diag({
          cargo_login: "admin",
          cargo_perfil: "admin",
          admins: 1,
          alvo_admin: true,
        }),
      ]),
    );
    const argv = aplicar ? [...ARGV, "--aplicar"] : ARGV;
    const r = await executar(argv, deps(f));
    assertEquals(f.chamadas.length, 1, "só a leitura");
    assertEquals(r.codigo, 0);
    assertMatch(veredito(r), /^VEREDITO: SIM\b.*já era admin/);
    assertSemVazamento(r);
  }
});

// ----------------------------------------------------------- recusas --

const RECUSAS = [
  {
    nome: "outra admin",
    linha: diag({ admins: 1, alvo_admin: false }),
    texto: /outra administradora/,
  },
  {
    nome: "duas admins, ela entre elas",
    linha: diag({
      admins: 2,
      alvo_admin: true,
      cargo_login: "admin",
      cargo_perfil: "admin",
    }),
    texto: /outra administradora/,
  },
  {
    nome: "e-mail não confirmado",
    linha: diag({ confirmada: false }),
    texto: /não confirmou o e-mail.*link/,
  },
  {
    nome: "sem conta",
    linha: diag({
      contas: 0,
      confirmada: false,
      cargo_login: null,
      tem_perfil: false,
      cargo_perfil: null,
    }),
    texto: /nenhuma conta/,
  },
  {
    nome: "conta repetida",
    linha: diag({ contas: 2 }),
    texto: /mais de uma conta/,
  },
  {
    nome: "sem perfil",
    linha: diag({ tem_perfil: false, cargo_perfil: null }),
    texto: /sem perfil/,
  },
  {
    nome: "fontes do cargo divergem",
    linha: diag({ cargo_login: "admin", admins: 1, alvo_admin: true }),
    texto: /fontes do cargo discordam/,
  },
  {
    nome: "cargo inesperado",
    linha: diag({ cargo_login: null }),
    texto: /cargo inesperado/,
  },
];

for (const caso of RECUSAS) {
  Deno.test(`recusa (${caso.nome}): NÃO, e nenhuma escrita mesmo com --aplicar`, async () => {
    const f = fetchFalso(resposta(201, [caso.linha]));
    const r = await executar([...ARGV, "--aplicar"], deps(f));
    assertEquals(f.chamadas.length, 1, "parou na leitura");
    assertEquals(f.chamadas[0].corpo.read_only, true);
    assertEquals(r.codigo, 1);
    assertMatch(veredito(r), /^VEREDITO: NÃO\b/);
    assertMatch(veredito(r), caso.texto);
    assertSemVazamento(r);
  });
}

// ------------------------------------------ a transação recusa por dentro --

Deno.test("a guarda DENTRO da transação (corrida entre leitura e escrita): SQLSTATE próprio vira NÃO, nada gravado", async () => {
  const f = fetchFalso(
    resposta(201, [diag()]),
    resposta(
      400,
      // o corpo de erro ecoa o SQL (com o e-mail): não pode sair
      `{"message":"Failed to run sql query: ERROR:  IKA05: primeira-admin: a loja ja tem administradora\\nQUERY: SET LOCAL ikcous.primeira_admin_email = '${EMAIL}'"}`,
    ),
  );
  const r = await executar([...ARGV, "--aplicar"], deps(f));
  assertEquals(r.codigo, 1);
  assertMatch(veredito(r), /^VEREDITO: NÃO\b.*outra administradora/);
  assertMatch(veredito(r), /nada foi gravado/);
  assertSemVazamento(r);
});

Deno.test("SET LOCAL ROLE recusado pelo banco (P5): NÃO dizendo o que falhou", async () => {
  const f = fetchFalso(
    resposta(201, [diag()]),
    resposta(
      400,
      '{"message":"Failed to run sql query: ERROR:  42501: permission denied to set role \\"postgres\\""}',
    ),
  );
  const r = await executar([...ARGV, "--aplicar"], deps(f));
  assertEquals(r.codigo, 1);
  assertMatch(veredito(r), /^VEREDITO: NÃO\b.*42501/);
  assertMatch(veredito(r), /SET LOCAL ROLE postgres/);
  assertSemVazamento(r);
});

// --------------------------------------------------------- ambíguo = INCERTO --

const AMBIGUAS = [
  ["lista vazia", () => resposta(201, [])],
  ["linha sem resultado", () => resposta(201, [{ outra: 1 }])],
  ["resultado vazio", () => resposta(201, [{ resultado: "" }])],
  ["JSON torto", () => resposta(201, [{ resultado: "{promovida" }])],
  [
    "conferência 1,1,2",
    () =>
      resposta(201, [
        {
          resultado: JSON.stringify({
            acao: "promovida",
            usuarios: 1,
            linhas: 1,
            admins: 2,
          }),
        },
      ]),
  ],
  [
    "conferência 1,0,1 dizendo promovida",
    () =>
      resposta(201, [
        {
          resultado: JSON.stringify({
            acao: "promovida",
            usuarios: 1,
            linhas: 0,
            admins: 1,
          }),
        },
      ]),
  ],
  [
    "chave a mais",
    () =>
      resposta(201, [
        {
          resultado: JSON.stringify({
            acao: "promovida",
            usuarios: 1,
            linhas: 1,
            admins: 1,
            extra: true,
          }),
        },
      ]),
  ],
  [
    "duas linhas",
    () => resposta(201, [{ resultado: PROMOVIDA }, { resultado: PROMOVIDA }]),
  ],
  ["corpo com error", () => resposta(201, { error: "x" })],
  ["200 que não é JSON", () => resposta(200, "<html>")],
  ["HTTP 202", () => resposta(202, [{ resultado: PROMOVIDA }])],
  ["502 do gateway, sem SQLSTATE", () => resposta(502, "bad gateway")],
  ["401 no meio", () => resposta(401, "{}")],
  ["rede caiu", () => Promise.reject(new TypeError("rede caiu"))],
];

for (const [nome, r2] of AMBIGUAS) {
  Deno.test(`resposta ambígua na escrita (${nome}): INCERTO, nunca SIM`, async () => {
    const f = fetchFalso(resposta(201, [diag()]), r2);
    const r = await executar([...ARGV, "--aplicar"], deps(f));
    assertEquals(r.codigo, 2);
    assertMatch(veredito(r), /^VEREDITO: INCERTO\b/);
    assertSemVazamento(r);
  });
}

Deno.test("diagnóstico ilegível: INCERTO, e nenhuma escrita", async () => {
  for (const ruim of [
    [],
    [diag(), diag()],
    [{ ...diag(), contas: "1" }],
    [{ ...diag(), extra: 1 }],
    [{ contas: 1 }],
    { error: "x" },
  ]) {
    const f = fetchFalso(resposta(201, ruim));
    const r = await executar([...ARGV, "--aplicar"], deps(f));
    assertEquals(f.chamadas.length, 1);
    assertEquals(r.codigo, 2);
    assertMatch(veredito(r), /^VEREDITO: INCERTO\b/);
    assertSemVazamento(r);
  }
});

Deno.test("sem token (cofre falhou): INCERTO sem rede", async () => {
  const f = fetchFalso();
  const r = await executar([...ARGV, "--aplicar"], {
    ...deps(f),
    obterToken: async () => {
      throw new Error(`cofre quebrou ${TOKEN}`);
    },
  });
  assertEquals(f.chamadas.length, 0);
  assertEquals(r.codigo, 2);
  assertMatch(veredito(r), /^VEREDITO: INCERTO\b/);
  assertSemVazamento(r);
});

// ----------------------------------------------------- injeção e entrada --

// Sem espaço (a validação já recusa espaço; aqui o alvo é o ESCAPE): o
// comentário /**/ faz o papel do espaço para o Postgres.
const MALICIOSOS = [
  "a');UPDATE/**/public.profiles/**/SET/**/role='admin';--@exemplo.invalid",
  "x';COMMIT;DELETE/**/FROM/**/auth.users;--@exemplo.invalid",
  "a';SET/**/ROLE/**/authenticated;SELECT/**/'@exemplo.invalid",
  "a$primeira_admin$;DROP/**/TABLE/**/public.profiles;$primeira_admin$@exemplo.invalid",
  "o''brien@exemplo.invalid",
  "a/*@exemplo.invalid",
  "a$$@exemplo.invalid",
];

Deno.test("injeção: aspas, ; e dollar-quote no e-mail não mudam a forma do SQL", () => {
  const base = topo(sqlDaPromocao("lojista@exemplo.invalid"));
  const baseDiag = topo(sqlDoDiagnostico("lojista@exemplo.invalid"));
  assertEquals(baseDiag.length, 1);
  for (const email of MALICIOSOS) {
    const s = topo(sqlDaPromocao(email));
    assertEquals(s.length, base.length, `statements a mais com ${email}`);
    // tudo que não é a linha do literal é idêntico ao do e-mail inocente
    for (const i of [0, 1, 2, 4, 5, 6]) assertEquals(s.at(i), base.at(i));
    // e o literal devolve exatamente o e-mail
    const m = /^SET LOCAL ikcous\.primeira_admin_email = '(.*)'$/s.exec(s[3]);
    assert(m, s[3]);
    assertEquals(m[1].replaceAll("''", "'"), email);
    assert(!/(^|[^'])'([^']|$)/.test(m[1]), "aspa simples sem dobrar");
    const d = topo(sqlDoDiagnostico(email));
    assertEquals(d.length, 1, `diagnóstico partido com ${email}`);
  }
});

Deno.test("literalDoEmail: dobra a aspa e recusa o que não é e-mail, sem ecoar a entrada", () => {
  assertEquals(
    literalDoEmail("o'brien@exemplo.invalid"),
    "'o''brien@exemplo.invalid'",
  );
  const ruins = [
    "",
    "sem-arroba",
    "a@b\\c.invalid",
    "a b@exemplo.invalid",
    "a@exemplo.invalid\nSEGUNDA",
    "a\u0000@exemplo.invalid",
    "a\u007f@exemplo.invalid",
    `${"a".repeat(250)}@exemplo.invalid`,
    "@exemplo.invalid",
    "a@",
    42,
    null,
  ];
  for (const r of ruins) {
    const e = assertThrows(() => literalDoEmail(r));
    if (typeof r === "string" && r.length > 3) {
      assert(!String(e.message).includes(r), "a recusa ecoou a entrada");
    }
  }
});

Deno.test("entrada inválida no stdin: NÃO, nenhuma rede, sem ecoar", async () => {
  for (const entrada of [
    "",
    "\n",
    "duas@exemplo.invalid\noutra@exemplo.invalid\n",
    "a b@x.invalid",
  ]) {
    const f = fetchFalso();
    const r = await executar([...ARGV, "--aplicar"], {
      ...deps(f),
      entrada: undefined,
      lerEntrada: async () => entrada,
    });
    assertEquals(f.chamadas.length, 0);
    assertEquals(r.codigo, 1);
    assertMatch(veredito(r), /^VEREDITO: NÃO\b/);
    const tudo = [...r.saida, ...r.erros].join("\n");
    for (const p of entrada.split("\n").filter((x) => x.length > 3)) {
      assert(!tudo.includes(p), "a recusa ecoou a entrada");
    }
  }
});

Deno.test("argumentos: --projeto obrigatório e válido; e-mail nunca por argumento", async () => {
  const casos = [
    [],
    ["--loja", "loja-teste"],
    ["--projeto", "curto", "--loja", "loja-teste"],
    ["--projeto", REF],
    ["--projeto", REF, "--loja", "Loja Teste"],
    [...ARGV, "--email", EMAIL],
    [...ARGV, EMAIL],
    [...ARGV, "--aplicar", "--aplicar"],
  ];
  for (const argv of casos) {
    let leu = false;
    const f = fetchFalso();
    const r = await executar(argv, {
      ...deps(f),
      lerEntrada: async () => {
        leu = true;
        return EMAIL;
      },
    });
    assertEquals(f.chamadas.length, 0, argv.join(" "));
    assertEquals(leu, false, "leu o stdin com argumento inválido");
    assertEquals(r.codigo, 1);
    assertMatch(veredito(r), /^VEREDITO: NÃO\b/);
    assertSemVazamento(r);
  }
});

// ------------------------------------------------- as guardas do SQL de escrita --

Deno.test("o SQL de escrita carrega as guardas: trava, conta única confirmada, 0 admins, conferência 1,1,1", () => {
  const sql = sqlDaPromocao("lojista@exemplo.invalid");
  const corpo = topo(sql)[4];
  // trava contra duas rodadas ao mesmo tempo (com e-mails diferentes)
  assertMatch(corpo, /pg_advisory_xact_lock\(/);
  // conta: 0 / >1 / não confirmada / sem perfil
  assertMatch(corpo, /ERRCODE = 'IKA01'/);
  assertMatch(corpo, /ERRCODE = 'IKA02'/);
  assertMatch(corpo, /email_confirmed_at/);
  assertMatch(corpo, /ERRCODE = 'IKA03'/);
  assertMatch(corpo, /ERRCODE = 'IKA04'/);
  // 0 admins nas DUAS fontes do cargo, ANTES do UPDATE
  const antes = corpo.slice(0, corpo.indexOf("UPDATE public.profiles"));
  assertMatch(antes, /FROM public\.profiles p WHERE p\.role = 'admin'/);
  assertMatch(antes, /raw_app_meta_data ->> 'role' = 'admin'/);
  assertMatch(antes, /IF v_admins > 0[\s\S]*ERRCODE = 'IKA05'/);
  assertMatch(antes, /ERRCODE = 'IKA06'/);
  assertMatch(antes, /ERRCODE = 'IKA07'/);
  // o UPDATE é por id, e só de cliente para admin
  assertMatch(
    corpo,
    /UPDATE public\.profiles SET role = 'admin' WHERE id = v_id AND role = 'customer';/,
  );
  // conferência 1,1,1 DEPOIS do UPDATE (e as duas fontes como admin)
  const depois = corpo.slice(corpo.indexOf("UPDATE public.profiles"));
  assertMatch(depois, /GET DIAGNOSTICS v_linhas = ROW_COUNT/);
  assertMatch(
    depois,
    /v_contas <> 1 OR v_linhas <> 1 OR v_admins <> 1[\s\S]*ERRCODE = 'IKA08'/,
  );
  assertMatch(
    depois,
    /u\.raw_app_meta_data ->> 'role' = 'admin' AND p\.role = 'admin'/,
  );
  // o e-mail não entra no corpo dollar-quoted (lá ele poderia fechar a aspa)
  assert(!corpo.includes("lojista@exemplo.invalid"));
});

Deno.test("decidir: só a linha exata do diagnóstico decide algo", () => {
  assertEquals(decidir([diag()]).tipo, "promover");
  assertEquals(
    decidir([
      diag({
        cargo_login: "admin",
        cargo_perfil: "admin",
        admins: 1,
        alvo_admin: true,
      }),
    ]).tipo,
    "ja_admin",
  );
  assertEquals(decidir([diag({ admins: 1 })]).tipo, "recusar");
  assertEquals(decidir(null).tipo, "incerto");
  assertEquals(decidir([{ ...diag(), admins: -1 }]).tipo, "incerto");
  assertEquals(decidir([{ ...diag(), admins: 1.5 }]).tipo, "incerto");
});
