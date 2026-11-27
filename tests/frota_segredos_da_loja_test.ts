// @ts-nocheck
/**
 * OS SEGREDOS DA LOJA NOVA (plano nova-loja, B1; scripts/frota/segredos-da-loja.mjs).
 *
 * O QUE ESTES TESTES TRAVAM (sem rede: todo fetch é um dublê com estado, a
 * "loja falsa"; a prova real é a T1, P4/P8):
 *  - tudo novo: UM POST /secrets só com os nomes da lista branca (nunca
 *    MP_ACCESS_TOKEN nem MP_WEBHOOK_SECRET) e UMA transação no banco com o
 *    Vault e a vapid_public_key; veredito SIM;
 *  - NUNCA substitui: o que já existe fica (0 escritas quando tudo existe);
 *    metade existe = só a outra metade é gravada;
 *  - o Vault recebe o MESMO valor de RECONCILIACAO_SECRET e a store_config a
 *    MESMA chave pública de VAPID_PUBLIC_KEY (o dublê compara sem imprimir);
 *  - estado incoerente (metade de um par) não grava aquele grupo: NÃO;
 *  - sem --aplicar: 0 escritas;
 *  - nenhum log, erro ou relatório contém valor gerado, prefixo dele ou token;
 *  - o SQL do Vault é escapado;
 *  - falha de escrita: ESTADO_DESCONHECIDO vira INCERTO (nunca SIM).
 */
import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  NOMES_NAS_FUNCTIONS,
  NOMES_NO_VAULT,
  NUNCA_CRIADOS,
  gerarValores,
  instalarSegredos,
  literalSql,
  main,
  sqlDoBanco,
  urlDaReconciliacao,
} from "../scripts/frota/segredos-da-loja.mjs";
import { criarClienteGestao } from "../scripts/frota/supabase-gestao.mjs";

const REF = "abcdefghijklmnopqrst";
const TOKEN = "sbp_oauth_TOKEN_FALSO_inventado_0123456789";

// ─── valores falsos, no formato certo (o módulo confere o formato) ─────────

function base64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}
function base64Url(bytes) {
  return base64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Cada chamada devolve valores DIFERENTES (o nº da rodada entra nos bytes). */
function geradorFalso() {
  let n = 0;
  const gerados = [];
  const gerar = () => {
    n += 1;
    const v = {
      chaveMp: base64(
        new TextEncoder().encode(
          `FALSO_chave_mp_de_teste_rodada${n}`.slice(0, 32).padEnd(32, "x"),
        ),
      ),
      reconciliacao: `${n}`
        .padStart(2, "0")
        .repeat(32)
        .slice(0, 64)
        .replace(/[^0-9a-f]/g, "a"),
      vapidPublica: base64Url(
        Uint8Array.from([0x04, ...new Array(64).fill(0x10 + n)]),
      ),
      vapidPrivada: base64Url(new Uint8Array(32).fill(0x40 + n)),
    };
    gerados.push(v);
    return v;
  };
  gerar.gerados = gerados;
  return gerar;
}

// ─── a loja falsa: o dublê do fetch, com estado ─────────────────────────────

function lojaFalsa({
  segredos = [],
  vault = [],
  vaultExiste = true,
  storeConfigLinha = true,
  temVapid = false,
  saudeExiste = true,
  idadeRodada = null,
  statusProjeto = "ACTIVE_HEALTHY",
  falhas = {},
  aoLer = undefined,
} = {}) {
  const estado = {
    segredos: new Set(segredos),
    vault: new Set(vault),
    temVapid,
    statusProjeto,
  };
  const chamadas = [];
  const escritas = [];
  const capturado = { segredosPost: [], sqlEscrita: [] };
  let leiturasDeNomes = 0;

  const resp = (status, corpo) =>
    Promise.resolve(
      new Response(corpo === undefined ? "" : JSON.stringify(corpo), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );

  const f = async (url, init = {}) => {
    const u = new URL(String(url));
    const metodo = init.method ?? "GET";
    chamadas.push({ caminho: u.pathname, metodo });
    if (u.pathname === `/v1/projects/${REF}` && metodo === "GET") {
      if (falhas.projeto) return falhas.projeto();
      return resp(200, { id: REF, ref: REF, status: estado.statusProjeto });
    }
    if (u.pathname === `/v1/projects/${REF}/secrets` && metodo === "GET") {
      leiturasDeNomes += 1;
      if (aoLer) aoLer(leiturasDeNomes, estado);
      if (falhas.lerSegredos) return falhas.lerSegredos();
      return resp(
        200,
        [...estado.segredos].map((name) => ({
          name,
          value: "digest-falso-0000",
        })),
      );
    }
    if (u.pathname === `/v1/projects/${REF}/secrets` && metodo === "POST") {
      escritas.push("secrets");
      const corpo = JSON.parse(init.body);
      capturado.segredosPost.push(corpo);
      if (falhas.postSegredos) return falhas.postSegredos();
      for (const s of corpo) estado.segredos.add(s.name);
      return resp(201, undefined);
    }
    if (
      u.pathname === `/v1/projects/${REF}/database/query` &&
      metodo === "POST"
    ) {
      const { query } = JSON.parse(init.body);
      if (/^\s*BEGIN;/.test(query)) {
        escritas.push("banco");
        capturado.sqlEscrita.push(query);
        if (falhas.banco) return falhas.banco();
        for (const nome of Object.values(NOMES_NO_VAULT)) {
          if (query.includes(`'${nome}'`) && query.includes("create_secret"))
            estado.vault.add(nome);
        }
        if (/UPDATE public\.store_config/.test(query)) estado.temVapid = true;
        // pg-meta devolve só o ÚLTIMO resultado com linhas (pesquisa T1, P3)
        return resp(201, [{ gravado: true }]);
      }
      if (query.includes("to_regclass('vault.secrets')")) {
        if (falhas.lerBanco) return falhas.lerBanco();
        return resp(201, [
          {
            vault_existe: vaultExiste,
            store_config_existe: true,
            saude_existe: saudeExiste,
          },
        ]);
      }
      if (query.includes("FROM public.store_config")) {
        return resp(201, [
          { linhas: storeConfigLinha ? 1 : 0, tem_vapid: estado.temVapid },
        ]);
      }
      if (query.includes("FROM vault.secrets")) {
        return resp(
          201,
          [...estado.vault].sort().map((name) => ({ name })),
        );
      }
      if (query.includes("saude_da_loja()")) {
        if (falhas.saude) return falhas.saude();
        return resp(201, [
          { saude: { medidor: 1, idade_rodada_s: idadeRodada } },
        ]);
      }
      throw new Error("loja falsa: SQL inesperado");
    }
    throw new Error(`loja falsa: caminho inesperado ${metodo} ${u.pathname}`);
  };
  return { fetch: f, chamadas, escritas, capturado, estado };
}

function cliente(loja) {
  return criarClienteGestao({ token: TOKEN, fetch: loja.fetch });
}

const TODAS_AS_FUNCTIONS = [
  "MP_CHAVES_ENCRYPTION_KEY",
  "RECONCILIACAO_SECRET",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
];
const TODO_O_VAULT = ["reconciliacao_secret", "reconciliacao_url"];

/** Nenhum valor gerado (nem os 8 primeiros caracteres) nem o token no texto. */
function assertSemValores(texto, gerados) {
  const proibidos = [TOKEN, TOKEN.slice(0, 12)];
  for (const v of gerados) {
    for (const valor of Object.values(v)) {
      proibidos.push(valor, valor.slice(0, 8));
    }
  }
  for (const p of proibidos) {
    // mensagem fixa: nunca imprimir o trecho proibido
    assert(!texto.includes(p), "um valor de segredo (ou prefixo) vazou");
  }
}

function textoDo(r) {
  return [...r.linhas, r.veredito].join("\n");
}

// ─── tudo novo ──────────────────────────────────────────────────────────────

Deno.test("tudo novo + aplicar: UM POST só com a lista branca, UMA transação no banco, veredito SIM", async () => {
  const loja = lojaFalsa();
  const gerar = geradorFalso();
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar,
  });
  assertEquals(r.veredito, "SIM");
  assertEquals(loja.escritas, ["secrets", "banco"]);
  const nomes = loja.capturado.segredosPost[0].map((s) => s.name).sort();
  assertEquals(nomes, [...TODAS_AS_FUNCTIONS].sort());
  for (const proibido of ["MP_ACCESS_TOKEN", "MP_WEBHOOK_SECRET"]) {
    assert(!nomes.includes(proibido));
    assert(NUNCA_CRIADOS.includes(proibido));
  }
  const sql = loja.capturado.sqlEscrita[0];
  assert(/^BEGIN;\n/.test(sql), "abre transação");
  assert(
    /\nCOMMIT;\nSELECT true AS gravado;\n?$/.test(sql),
    "fecha e confirma",
  );
  assert(sql.includes("vault.create_secret"));
  assert(sql.includes("UPDATE public.store_config SET vapid_public_key"));
  for (const nome of [...TODAS_AS_FUNCTIONS, ...TODO_O_VAULT]) {
    assert(
      r.linhas.some((l) => l.includes(nome) && l.includes("gravado")),
      `relatório sem "gravado" para ${nome}`,
    );
  }
  assert(
    r.linhas.some(
      (l) =>
        l.includes("store_config.vapid_public_key") && l.includes("gravado"),
    ),
  );
  assert(
    r.linhas.some((l) => /10 min/.test(l)),
    "diz que até 10 min é normal",
  );
  assertSemValores(textoDo(r), gerar.gerados);
});

Deno.test("tudo novo: o Vault recebe o MESMO valor de RECONCILIACAO_SECRET, a URL certa, e a store_config a MESMA pública", async () => {
  const loja = lojaFalsa();
  const gerar = geradorFalso();
  await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar,
  });
  const post = Object.fromEntries(
    loja.capturado.segredosPost[0].map((s) => [s.name, s.value]),
  );
  const sql = loja.capturado.sqlEscrita[0];
  // comparações com mensagem fixa: os valores nunca vão para a saída
  assert(
    sql.includes(
      `vault.create_secret('${post.RECONCILIACAO_SECRET}', 'reconciliacao_secret'`,
    ),
    "o Vault não recebeu o MESMO valor de RECONCILIACAO_SECRET",
  );
  assert(
    sql.includes(
      `vault.create_secret('${urlDaReconciliacao(REF)}', 'reconciliacao_url'`,
    ),
    "reconciliacao_url fora do esperado",
  );
  assertEquals(
    urlDaReconciliacao(REF),
    `https://${REF}.supabase.co/functions/v1/reconciliar-pagamentos`,
  );
  assert(
    sql.includes(`SET vapid_public_key = '${post.VAPID_PUBLIC_KEY}'`),
    "a store_config não recebeu a MESMA chave pública",
  );
  assert(!sql.includes(post.VAPID_PRIVATE_KEY), "a privada foi para o banco");
  assert(
    !sql.includes(post.MP_CHAVES_ENCRYPTION_KEY),
    "a chave MP foi para o banco",
  );
  // gerado uma vez só: os valores do POST são os da 1ª (e única) geração
  assertEquals(gerar.gerados.length, 1);
  assert(
    post.RECONCILIACAO_SECRET === gerar.gerados[0].reconciliacao,
    "valor diferente do gerado",
  );
});

Deno.test("store_config só muda onde está vazia, e o Vault recusa nome que já existe (guarda DENTRO da transação)", async () => {
  const loja = lojaFalsa();
  await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
  });
  const sql = loja.capturado.sqlEscrita[0];
  assert(
    /WHERE id = 1 AND \(vapid_public_key IS NULL OR btrim\(vapid_public_key\) = ''\)/.test(
      sql,
    ),
  );
  assert(/IF NOT FOUND THEN\s+RAISE EXCEPTION/.test(sql));
  for (const nome of TODO_O_VAULT) {
    assert(
      sql.includes(
        `IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = '${nome}') THEN`,
      ),
      `sem guarda de nome existente para ${nome}`,
    );
  }
});

Deno.test("com contato: VAPID_SUBJECT entra no MESMO POST; contato inválido recusa antes da rede", async () => {
  const loja = lojaFalsa();
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
    vapidContato: "mailto:loja@example.org",
  });
  assertEquals(r.veredito, "SIM");
  const post = loja.capturado.segredosPost[0];
  assert(
    post.some(
      (s) =>
        s.name === "VAPID_SUBJECT" && s.value === "mailto:loja@example.org",
    ),
  );

  const loja2 = lojaFalsa();
  const r2 = await instalarSegredos({
    cliente: cliente(loja2),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
    vapidContato: "javascript:alert(1)",
  });
  assertEquals(r2.veredito, "NÃO");
  assertEquals(loja2.chamadas.length, 0);
});

Deno.test("sem contato: VAPID_SUBJECT não é gravado e o relatório avisa (não derruba o SIM)", async () => {
  const loja = lojaFalsa();
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
  });
  assertEquals(r.veredito, "SIM");
  assert(
    !loja.capturado.segredosPost[0].some((s) => s.name === "VAPID_SUBJECT"),
  );
  assert(
    r.linhas.some((l) => l.includes("VAPID_SUBJECT") && /não gravado/.test(l)),
  );
});

// ─── nunca substitui ────────────────────────────────────────────────────────

Deno.test("tudo já existe: 0 escritas, 'já existia' em cada nome, SIM", async () => {
  const loja = lojaFalsa({
    segredos: [...TODAS_AS_FUNCTIONS, "VAPID_SUBJECT", "MP_ACCESS_TOKEN"],
    vault: TODO_O_VAULT,
    temVapid: true,
    idadeRodada: 120,
  });
  const gerar = geradorFalso();
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar,
    vapidContato: "mailto:loja@example.org",
  });
  assertEquals(loja.escritas, []);
  assertEquals(r.veredito, "SIM");
  for (const nome of [
    ...TODAS_AS_FUNCTIONS,
    ...TODO_O_VAULT,
    "VAPID_SUBJECT",
  ]) {
    assert(
      r.linhas.some((l) => l.includes(nome) && l.includes("já existia")),
      `relatório sem "já existia" para ${nome}`,
    );
  }
  assert(
    r.linhas.some((l) => /já rodou/.test(l)),
    "saúde: já rodou",
  );
});

Deno.test("metade existe: só a outra metade é gravada, nada do que existia volta no POST", async () => {
  const loja = lojaFalsa({
    segredos: [
      "MP_CHAVES_ENCRYPTION_KEY",
      "VAPID_PUBLIC_KEY",
      "VAPID_PRIVATE_KEY",
    ],
    temVapid: true,
  });
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
  });
  assertEquals(r.veredito, "SIM");
  assertEquals(loja.escritas, ["secrets", "banco"]);
  assertEquals(
    loja.capturado.segredosPost[0].map((s) => s.name),
    ["RECONCILIACAO_SECRET"],
  );
  const sql = loja.capturado.sqlEscrita[0];
  assert(
    sql.includes("'reconciliacao_secret'") &&
      sql.includes("'reconciliacao_url'"),
  );
  assert(
    !sql.includes("store_config"),
    "mexeu na store_config que já tinha chave",
  );
  assert(
    r.linhas.some(
      (l) => l.includes("MP_CHAVES_ENCRYPTION_KEY") && l.includes("já existia"),
    ),
  );
});

Deno.test("só a reconciliacao_url falta: grava só ela no banco, nenhum POST de secret", async () => {
  const loja = lojaFalsa({
    segredos: TODAS_AS_FUNCTIONS,
    vault: ["reconciliacao_secret"],
    temVapid: true,
  });
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
  });
  assertEquals(loja.escritas, ["banco"]);
  const sql = loja.capturado.sqlEscrita[0];
  assert(sql.includes("'reconciliacao_url'"));
  assert(!/create_secret\('[^']*', 'reconciliacao_secret'/.test(sql));
  assertEquals(r.veredito, "SIM");
});

// ─── estados incoerentes: o grupo não é gravado ─────────────────────────────

Deno.test("RECONCILIACAO_SECRET existe mas o Vault não: nada da reconciliação é gravado, NÃO", async () => {
  const loja = lojaFalsa({ segredos: ["RECONCILIACAO_SECRET"] });
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
  });
  const post = loja.capturado.segredosPost[0].map((s) => s.name);
  assert(!post.includes("RECONCILIACAO_SECRET"));
  const sql = loja.capturado.sqlEscrita[0] ?? "";
  assert(
    !/create_secret\('[^']*', 'reconciliacao_secret'/.test(sql),
    "gravou o Vault sem o par",
  );
  assertEquals(r.veredito, "NÃO");
  assert(
    r.linhas.some(
      (l) =>
        l.includes("reconciliacao_secret") && /incoerente|bloqueado/i.test(l),
    ),
  );
});

Deno.test("Vault tem reconciliacao_secret mas a function não: nada da reconciliação é gravado, NÃO", async () => {
  const loja = lojaFalsa({ vault: ["reconciliacao_secret"] });
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
  });
  assert(
    !loja.capturado.segredosPost[0].some(
      (s) => s.name === "RECONCILIACAO_SECRET",
    ),
  );
  assertEquals(r.veredito, "NÃO");
});

Deno.test("só metade do par VAPID: nenhum VAPID gravado, store_config intacta, NÃO", async () => {
  for (const meio of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"]) {
    const loja = lojaFalsa({ segredos: [meio] });
    const r = await instalarSegredos({
      cliente: cliente(loja),
      ref: REF,
      aplicar: true,
      gerar: geradorFalso(),
    });
    const post = loja.capturado.segredosPost[0].map((s) => s.name);
    assert(
      !post.includes("VAPID_PUBLIC_KEY") && !post.includes("VAPID_PRIVATE_KEY"),
    );
    assert(!(loja.capturado.sqlEscrita[0] ?? "").includes("store_config"));
    assertEquals(r.veredito, "NÃO");
  }
});

Deno.test("store_config já tem chave pública mas o par não existe: não gera par novo, NÃO", async () => {
  const loja = lojaFalsa({ temVapid: true });
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
  });
  const post = loja.capturado.segredosPost[0].map((s) => s.name);
  assert(!post.includes("VAPID_PUBLIC_KEY"));
  assertEquals(r.veredito, "NÃO");
});

Deno.test("par VAPID existe mas a store_config está vazia: não substitui o par, NÃO com o conserto", async () => {
  const loja = lojaFalsa({
    segredos: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"],
  });
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
  });
  const post = loja.capturado.segredosPost[0].map((s) => s.name);
  assert(!post.includes("VAPID_PUBLIC_KEY"));
  assert(!(loja.capturado.sqlEscrita[0] ?? "").includes("store_config"));
  assertEquals(r.veredito, "NÃO");
});

Deno.test("sem o Vault (extensão ausente): a reconciliação inteira fica de fora, NÃO", async () => {
  const loja = lojaFalsa({ vaultExiste: false });
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
  });
  assert(
    !loja.capturado.segredosPost[0].some(
      (s) => s.name === "RECONCILIACAO_SECRET",
    ),
  );
  assert(!(loja.capturado.sqlEscrita[0] ?? "").includes("create_secret"));
  assertEquals(r.veredito, "NÃO");
  assert(r.linhas.some((l) => /Vault/.test(l)));
});

Deno.test("store_config sem a linha id = 1: VAPID fica de fora, NÃO", async () => {
  const loja = lojaFalsa({ storeConfigLinha: false });
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
  });
  assert(
    !loja.capturado.segredosPost[0].some((s) => s.name.startsWith("VAPID_")),
  );
  assertEquals(r.veredito, "NÃO");
});

// ─── o projeto tem de estar ACTIVE_HEALTHY (pesquisa T1, P1/P3) ──────────────

Deno.test("projeto fora de ACTIVE_HEALTHY: nenhuma consulta ao banco, 0 escritas, NÃO", async () => {
  for (const status of ["COMING_UP", "INIT_FAILED", "INACTIVE"]) {
    const loja = lojaFalsa({ statusProjeto: status });
    const r = await instalarSegredos({
      cliente: cliente(loja),
      ref: REF,
      aplicar: true,
      gerar: geradorFalso(),
    });
    assertEquals(loja.escritas, []);
    assert(!loja.chamadas.some((c) => c.caminho.endsWith("/database/query")));
    assertEquals(r.veredito, "NÃO");
    assert(
      r.linhas.some((l) => l.includes(status) && l.includes("ACTIVE_HEALTHY")),
    );
  }
});

Deno.test("status com texto estranho não é ecoado; GET do projeto que falha = INCERTO", async () => {
  const loja = lojaFalsa({ statusProjeto: "<script>x</script>" });
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
  });
  assertEquals(r.veredito, "NÃO");
  assert(!textoDo(r).includes("<script>"));

  const loja2 = lojaFalsa({
    falhas: { projeto: () => Promise.reject(new TypeError("rede")) },
  });
  const r2 = await instalarSegredos({
    cliente: cliente(loja2),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
  });
  assertEquals(loja2.escritas, []);
  assertEquals(r2.veredito, "INCERTO");
});

Deno.test("projeto saiu de ACTIVE_HEALTHY entre o plano e a escrita: 0 escritas, NÃO", async () => {
  const loja = lojaFalsa({
    aoLer: (n, estado) => {
      if (n === 1) estado.statusProjeto = "COMING_UP";
    },
  });
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
  });
  assertEquals(loja.escritas, []);
  assertEquals(r.veredito, "NÃO");
});

Deno.test("banco grava mas a resposta não traz a confirmação (gravado) → INCERTO", async () => {
  const loja = lojaFalsa({
    falhas: {
      banco: () =>
        Promise.resolve(
          new Response("[]", {
            status: 201,
            headers: { "content-type": "application/json" },
          }),
        ),
    },
  });
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
  });
  assertEquals(r.veredito, "INCERTO");
});

// ─── sem --aplicar ──────────────────────────────────────────────────────────

Deno.test("sem aplicar: 0 escritas mesmo com tudo faltando; o plano diz o que criaria; NÃO", async () => {
  const loja = lojaFalsa();
  const gerar = geradorFalso();
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: false,
    gerar,
  });
  assertEquals(loja.escritas, []);
  assert(
    loja.chamadas.every(
      (c) => c.metodo === "GET" || c.caminho.endsWith("/database/query"),
    ),
  );
  assertEquals(gerar.gerados.length, 0, "nem gerou valor");
  assertEquals(r.veredito, "NÃO");
  for (const nome of [...TODAS_AS_FUNCTIONS, ...TODO_O_VAULT]) {
    assert(
      r.linhas.some((l) => l.includes(nome) && /criaria/.test(l)),
      `plano sem ${nome}`,
    );
  }
});

Deno.test('aplicar só vale com true literal ("sim", 1 não gravam)', async () => {
  for (const aplicar of ["sim", 1, "true"]) {
    const loja = lojaFalsa();
    await instalarSegredos({
      cliente: cliente(loja),
      ref: REF,
      aplicar,
      gerar: geradorFalso(),
    });
    assertEquals(loja.escritas, []);
  }
});

// ─── o banco mudou entre o plano e a escrita ───────────────────────────────

Deno.test("alguém criou um secret entre o plano e a escrita: 0 escritas, NÃO", async () => {
  const loja = lojaFalsa({
    aoLer: (n, estado) => {
      if (n === 2) estado.segredos.add("MP_CHAVES_ENCRYPTION_KEY");
    },
  });
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
  });
  assertEquals(loja.escritas, []);
  assertEquals(r.veredito, "NÃO");
  assert(r.linhas.some((l) => /mudou/.test(l)));
});

// ─── falhas de escrita ──────────────────────────────────────────────────────

Deno.test("POST /secrets cai no meio (ESTADO_DESCONHECIDO): banco NÃO é chamado, INCERTO", async () => {
  const loja = lojaFalsa({
    falhas: {
      postSegredos: () => Promise.reject(new TypeError("rede caiu")),
    },
  });
  const gerar = geradorFalso();
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar,
  });
  assertEquals(loja.escritas, ["secrets"]);
  assertEquals(r.veredito, "INCERTO");
  assertSemValores(textoDo(r), gerar.gerados);
});

Deno.test("POST /secrets recusado com 400: banco NÃO é chamado, NÃO", async () => {
  const loja = lojaFalsa({
    falhas: {
      postSegredos: () =>
        Promise.resolve(new Response('{"message":"bad"}', { status: 400 })),
    },
  });
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
  });
  assertEquals(loja.escritas, ["secrets"]);
  assertEquals(r.veredito, "NÃO");
});

Deno.test("banco recusa (SQLSTATE) depois do POST: NÃO, e o relatório diz o que ficou e o conserto", async () => {
  const loja = lojaFalsa({
    falhas: {
      banco: () =>
        Promise.resolve(
          new Response('{"message":"ERROR:  P0001: B1 algo"}', { status: 400 }),
        ),
    },
  });
  const gerar = geradorFalso();
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar,
  });
  assertEquals(loja.escritas, ["secrets", "banco"]);
  assertEquals(r.veredito, "NÃO");
  assert(r.linhas.some((l) => l.includes("P0001")));
  assert(
    r.linhas.some((l) => /apag/i.test(l) && l.includes("RECONCILIACAO_SECRET")),
  );
  assertSemValores(textoDo(r), gerar.gerados);
});

Deno.test("banco cai no meio (ESTADO_DESCONHECIDO): INCERTO, nunca SIM", async () => {
  const loja = lojaFalsa({
    falhas: { banco: () => Promise.reject(new TypeError("rede caiu")) },
  });
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
  });
  assertEquals(r.veredito, "INCERTO");
});

Deno.test("leitura inicial falha: 0 escritas, INCERTO", async () => {
  const loja = lojaFalsa({
    falhas: {
      lerSegredos: () => Promise.resolve(new Response("x", { status: 500 })),
    },
  });
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
  });
  assertEquals(loja.escritas, []);
  assertEquals(r.veredito, "INCERTO");
});

Deno.test("a conferência final não lê (depois de gravar): INCERTO, nunca SIM", async () => {
  const loja = lojaFalsa({
    aoLer: (n) => {
      if (n === 3) throw new TypeError("rede caiu na conferência");
    },
  });
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
  });
  assertEquals(loja.escritas, ["secrets", "banco"]);
  assertEquals(r.veredito, "INCERTO");
});

Deno.test("saúde: sem saude_da_loja() o relatório diz; falha ao ler a saúde não derruba o veredito dos nomes", async () => {
  let saudeChamada = false;
  const loja = lojaFalsa({
    saudeExiste: false,
    falhas: {
      saude: () => {
        saudeChamada = true;
        return Promise.resolve(new Response("x", { status: 500 }));
      },
    },
  });
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
  });
  assertEquals(r.veredito, "SIM");
  assert(r.linhas.some((l) => /saude_da_loja/.test(l) && /não existe/.test(l)));
  assert(!saudeChamada, "chamou saude_da_loja() que não existe");

  const loja2 = lojaFalsa({
    falhas: {
      saude: () => Promise.resolve(new Response("x", { status: 500 })),
    },
  });
  const r2 = await instalarSegredos({
    cliente: cliente(loja2),
    ref: REF,
    aplicar: true,
    gerar: geradorFalso(),
  });
  assertEquals(r2.veredito, "SIM");
  assert(
    r2.linhas.some(
      (l) => /saude_da_loja/.test(l) && /não deu para ler/.test(l),
    ),
  );
});

// ─── SQL escapado ───────────────────────────────────────────────────────────

Deno.test("literalSql dobra a aspa e recusa NUL e $ (o literal vive dentro de DO $b1$)", () => {
  assertEquals(literalSql("a'b"), "'a''b'");
  assertEquals(literalSql("''"), "''''''");
  assertThrows(() => literalSql("a\0b"));
  assertThrows(() => literalSql("a$b1$b"));
  assertThrows(() => literalSql(42));
});

Deno.test("sqlDoBanco escapa o valor do Vault e a chave pública (aspa não fecha o literal)", () => {
  const sql = sqlDoBanco({
    vault: [{ nome: "reconciliacao_secret", valor: "x'); DROP TABLE t; --" }],
    vapidPublica: "p'q",
  });
  assert(
    sql.includes(
      "vault.create_secret('x''); DROP TABLE t; --', 'reconciliacao_secret'",
    ),
  );
  assert(sql.includes("SET vapid_public_key = 'p''q'"));
  assert(!sql.includes("'x');"));
  assertThrows(() =>
    sqlDoBanco({ vault: [{ nome: "outro_nome", valor: "v" }] }),
  );
  assertEquals(sqlDoBanco({ vault: [] }), null);
});

// ─── o gerador real ─────────────────────────────────────────────────────────

Deno.test("gerarValores: formatos que as functions leem, e o par VAPID assina e confere", async () => {
  const v = gerarValores();
  const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const deB64Url = (s) =>
    deB64(
      s
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(s.length / 4) * 4, "="),
    );
  assertEquals(deB64(v.chaveMp).length, 32); // credenciais-mp.ts: base64 de 32 bytes
  assert(/^[0-9a-f]{64}$/.test(v.reconciliacao));
  const pub = deB64Url(v.vapidPublica);
  const priv = deB64Url(v.vapidPrivada);
  assert(/^[A-Za-z0-9_-]{87}$/.test(v.vapidPublica));
  assert(/^[A-Za-z0-9_-]{43}$/.test(v.vapidPrivada));
  assertEquals(pub.length, 65);
  assertEquals(pub[0], 0x04);
  assertEquals(priv.length, 32);
  // o mesmo JWK que webpush.ts (jwkDoParVapidCru) monta: o par tem de casar
  const x = base64Url(pub.slice(1, 33));
  const y = base64Url(pub.slice(33, 65));
  const chavePriv = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x, y, d: v.vapidPrivada },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const chavePub = await crypto.subtle.importKey(
    "raw",
    pub,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const dado = new TextEncoder().encode("teste");
  const assinatura = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    chavePriv,
    dado,
  );
  assert(
    await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      chavePub,
      assinatura,
      dado,
    ),
  );
  // duas gerações nunca repetem
  const w = gerarValores();
  assert(w.reconciliacao !== v.reconciliacao && w.chaveMp !== v.chaveMp);
});

Deno.test("gerador quebrado (formato errado) não grava nada: NÃO", async () => {
  const loja = lojaFalsa();
  const r = await instalarSegredos({
    cliente: cliente(loja),
    ref: REF,
    aplicar: true,
    gerar: () => ({
      chaveMp: "curta",
      reconciliacao: "zz",
      vapidPublica: "a",
      vapidPrivada: "b",
    }),
  });
  assertEquals(loja.escritas, []);
  assertEquals(r.veredito, "NÃO");
});

// ─── o comando (main) ───────────────────────────────────────────────────────

async function rodarMain(
  argv,
  { env = { SUPABASE_ACCESS_TOKEN: TOKEN }, loja, gerar } = {},
) {
  const saida = [];
  const orig = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
  };
  const pega = (...a) => saida.push(a.map(String).join(" "));
  console.log = pega;
  console.error = pega;
  console.warn = pega;
  console.info = pega;
  let codigo;
  try {
    codigo = await main(argv, { env, fetch: loja?.fetch, gerar });
  } finally {
    Object.assign(console, orig);
  }
  return { codigo, texto: saida.join("\n") };
}

Deno.test("main: --projeto obrigatório e validado ANTES da rede; sem token, nada sai", async () => {
  for (const argv of [
    [],
    ["--projeto"],
    ["--projeto", "CURTO"],
    ["--projeto", REF, "--estranho"],
  ]) {
    const loja = lojaFalsa();
    const { codigo } = await rodarMain(argv, { loja, gerar: geradorFalso() });
    assert(codigo !== 0);
    assertEquals(loja.chamadas.length, 0);
  }
  const loja = lojaFalsa();
  const { codigo, texto } = await rodarMain(["--projeto", REF, "--aplicar"], {
    env: {},
    loja,
    gerar: geradorFalso(),
  });
  assert(codigo !== 0);
  assertEquals(loja.chamadas.length, 0);
  assert(texto.includes("SUPABASE_ACCESS_TOKEN"));
});

Deno.test("main: sem --aplicar 0 escritas; com --aplicar grava; códigos 0 (SIM), 1 (NÃO), 2 (INCERTO); última linha é o veredito", async () => {
  const lojaA = lojaFalsa();
  const a = await rodarMain(["--projeto", REF], {
    loja: lojaA,
    gerar: geradorFalso(),
  });
  assertEquals(lojaA.escritas, []);
  assertEquals(a.codigo, 1);
  assert(
    /VEREDITO-SEGREDOS-DA-LOJA projeto=abcdefghijklmnopqrst veredito=NAO aplicar=false$/.test(
      a.texto,
    ),
  );

  const lojaB = lojaFalsa();
  const b = await rodarMain(
    [
      "--projeto",
      REF,
      "--aplicar",
      "--vapid-subject",
      "mailto:loja@example.org",
    ],
    {
      loja: lojaB,
      gerar: geradorFalso(),
    },
  );
  assertEquals(lojaB.escritas, ["secrets", "banco"]);
  assertEquals(b.codigo, 0);
  assert(/veredito=SIM aplicar=true$/.test(b.texto));

  const lojaC = lojaFalsa({
    falhas: { banco: () => Promise.reject(new TypeError("x")) },
  });
  const c = await rodarMain(["--projeto", REF, "--aplicar"], {
    loja: lojaC,
    gerar: geradorFalso(),
  });
  assertEquals(c.codigo, 2);
  assert(/veredito=INCERTO aplicar=true$/.test(c.texto));
});

Deno.test("main: nenhuma linha do console (sucesso, falhas e incoerências) traz valor gerado, prefixo ou token", async () => {
  const cenarios = [
    {},
    { falhas: { postSegredos: () => Promise.reject(new TypeError("rede")) } },
    {
      falhas: {
        postSegredos: () =>
          Promise.resolve(new Response("{}", { status: 500 })),
      },
    },
    {
      falhas: {
        banco: () =>
          Promise.resolve(
            new Response('{"message":"ERROR:  23505: dup"}', { status: 400 }),
          ),
      },
    },
    { falhas: { banco: () => Promise.reject(new TypeError("rede")) } },
    { segredos: ["RECONCILIACAO_SECRET"] },
    { segredos: ["VAPID_PUBLIC_KEY"] },
    {
      aoLer: (n) => {
        if (n === 3) throw new TypeError("rede");
      },
    },
  ];
  for (const c of cenarios) {
    const loja = lojaFalsa(c);
    const gerar = geradorFalso();
    const { texto } = await rodarMain(
      [
        "--projeto",
        REF,
        "--aplicar",
        "--vapid-subject",
        "mailto:loja@example.org",
      ],
      {
        loja,
        gerar,
      },
    );
    assert(gerar.gerados.length > 0 || c.segredos);
    assertSemValores(texto, gerar.gerados);
  }
});

Deno.test("as listas: nomes das functions e do Vault são os que o código lê", () => {
  assertEquals(NOMES_NAS_FUNCTIONS, {
    chaveMp: "MP_CHAVES_ENCRYPTION_KEY",
    reconciliacao: "RECONCILIACAO_SECRET",
    vapidPublica: "VAPID_PUBLIC_KEY",
    vapidPrivada: "VAPID_PRIVATE_KEY",
    vapidContato: "VAPID_SUBJECT",
  });
  assertEquals(NOMES_NO_VAULT, {
    segredo: "reconciliacao_secret",
    url: "reconciliacao_url",
  });
  assertEquals([...NUNCA_CRIADOS].sort(), [
    "MP_ACCESS_TOKEN",
    "MP_WEBHOOK_SECRET",
  ]);
});
