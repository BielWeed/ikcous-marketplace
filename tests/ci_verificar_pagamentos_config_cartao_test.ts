// @ts-nocheck
/**
 * A checagem da config do cartão em scripts/publicacao/verificar-pagamentos-ikcous.cjs
 * (a prova somente leitura que o publicar-functions.yml roda ANTES de publicar
 * na loja `ikcous-publicada`).
 *
 * Até 03/10/2026 ela exigia o estado EXATO da fase de blindagem — crédito
 * ligado, débito desligado, 1 parcela — e por isso recusou publicar a edge
 * `criar-pagamento` depois que o dono ligou "parcelar em até 2x" no painel
 * (run 37119556162). Com a blindagem no ar, quem escolhe crédito, débito e o
 * teto de parcelas é o dono pelo painel (autorizado por ele em 03/10/2026).
 * A trava passa a conferir só que a config é VÁLIDA: uma linha (id 1),
 * crédito e débito booleanos, parcelas de 1 a 12. Linha ausente, duplicada
 * ou fora de forma continua recusando.
 */
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  avaliar,
} = require("../scripts/publicacao/verificar-pagamentos-ikcous.cjs");

const NOME = "config de cartao valida (uma linha, booleanos, 1 a 12 parcelas)";

function checagemDaConfig(config) {
  const checks = avaliar(
    { funcoes: [], colunas: [], config },
    {
      liberar: "x",
      expirar: "y",
    },
  );
  const achadas = checks.filter((c) => c.checagem === NOME);
  assertEquals(
    achadas.length,
    1,
    "a checagem da config tem de existir uma vez",
  );
  return achadas[0].ok;
}

const linha = (campos) => ({
  id: 1,
  credito: true,
  debito: false,
  parcelas_max: 1,
  ...campos,
});

Deno.test("aceita o estado escolhido pelo dono no painel", () => {
  assert(checagemDaConfig([linha({})]), "crédito 1x");
  assert(checagemDaConfig([linha({ parcelas_max: 2 })]), "crédito até 2x");
  assert(
    checagemDaConfig([linha({ parcelas_max: 12, debito: true })]),
    "12x com débito",
  );
  assert(
    checagemDaConfig([linha({ credito: false, debito: false })]),
    "cartão desligado",
  );
});

Deno.test("recusa config ausente, duplicada ou fora de forma", () => {
  assert(!checagemDaConfig([]), "sem linha");
  assert(!checagemDaConfig([linha({}), linha({})]), "duas linhas");
  assert(!checagemDaConfig([linha({ id: null })]), "id diferente de 1");
  // `verificar` normaliza parcelas fora de 1..12 e booleano inválido para null.
  assert(
    !checagemDaConfig([linha({ parcelas_max: null })]),
    "parcelas inválidas",
  );
  assert(!checagemDaConfig([linha({ credito: null })]), "crédito não booleano");
  assert(!checagemDaConfig([linha({ debito: null })]), "débito não booleano");
  assert(!checagemDaConfig([linha({ parcelas_max: 13 })]), "13 parcelas");
  assert(!checagemDaConfig([linha({ parcelas_max: 0 })]), "0 parcelas");
});

Deno.test("a exigência antiga de 1x/sem débito não existe mais", () => {
  const checks = avaliar(
    { funcoes: [], colunas: [], config: [linha({ parcelas_max: 2 })] },
    {
      liberar: "x",
      expirar: "y",
    },
  );
  assert(
    !checks.some(
      (c) => c.checagem === "credito ligado, debito desligado, 1 parcela",
    ),
    "a checagem da fase de blindagem voltou",
  );
});

// ---------------------------------------------------------------------------
// O pin dos hashes esperados não pode envelhecer em silêncio (04/10/2026).
// `hashesEsperados()` tira o corpo de `liberar_cobranca_do_pedido` da 20261176
// e o de `expirar_pedidos_vencidos` da 20261393 (era a 20261186 ate 26/10/2026: a 20261393 deu
// folga de 10 minutos ao PIX com cobranca na vaga). Se uma migration POSTERIOR
// redefinir uma das duas, a prova somente leitura que roda ANTES do deploy
// das edges passa a recusar um banco que está certo (ou, pior, a aceitar um
// banco que não tem a definição nova).
//
// Medido em 04/10/2026: a 20261190 só põe um COMMENT em liberar_cobranca_do_pedido
// (não redefine o corpo); a última definição do corpo continua sendo a 20261176.
// ---------------------------------------------------------------------------
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";

const PINS = {
  liberar_cobranca_do_pedido: "20261176000000_o_cartao_online_nasce.sql",
  expirar_pedidos_vencidos:
    "20261393000000_o_pix_pago_no_ultimo_minuto_nao_perde_o_pedido.sql",
};

/** Migrations de 14 dígitos (nunca rollback-manual) POSTERIORES à fonte que
 * definem `fn` com CREATE [OR REPLACE] FUNCTION (corpo novo). */
function redefinicoesPosteriores(dir, fn, fonte) {
  const re = new RegExp(
    `CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+(public\\.)?${fn}\\s*\\(`,
    "i",
  );
  return [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n) && n > fonte)
    .sort()
    .filter((n) => re.test(Deno.readTextFileSync(join(dir, n))));
}

const MIGRATIONS = fromFileUrl(
  new URL("../supabase/migrations", import.meta.url),
);

Deno.test("o pin dos hashes: nenhuma migration posterior à fonte redefine liberar_cobranca_do_pedido nem expirar_pedidos_vencidos", () => {
  for (const [fn, fonte] of Object.entries(PINS)) {
    assert(
      Deno.readTextFileSync(join(MIGRATIONS, fonte)).match(
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`),
      ),
      `${fonte} deveria definir ${fn}`,
    );
    assertEquals(
      redefinicoesPosteriores(MIGRATIONS, fn, fonte),
      [],
      `${fn}: uma migration posterior à ${fonte} redefiniu a função — troque a fonte de hashesEsperados() em verificar-pagamentos-ikcous.cjs (e PINS aqui) antes de publicar`,
    );
  }
});

Deno.test("o pin dos hashes: as fontes deste teste são as que o script usa", () => {
  const script = Deno.readTextFileSync(
    fromFileUrl(
      new URL(
        "../scripts/publicacao/verificar-pagamentos-ikcous.cjs",
        import.meta.url,
      ),
    ),
  );
  for (const fonte of Object.values(PINS)) {
    assert(script.includes(fonte), `o script não usa mais ${fonte}`);
  }
});

Deno.test("o detector do pin enxerga uma redefinição posterior (mutante: fixture com uma migration nova que redefine a função)", () => {
  const dir = Deno.makeTempDirSync();
  try {
    for (const fonte of Object.values(PINS)) {
      Deno.copyFileSync(join(MIGRATIONS, fonte), join(dir, fonte));
    }
    for (const [fn, fonte] of Object.entries(PINS)) {
      assertEquals(
        redefinicoesPosteriores(dir, fn, fonte),
        [],
        "controle: sem mutante, nada",
      );
    }
    // a 20261190 real só faz COMMENT ON FUNCTION: não é redefinição
    Deno.writeTextFileSync(
      join(dir, "20261190000000_so_comenta.sql"),
      "COMMENT ON FUNCTION public.liberar_cobranca_do_pedido(uuid, text) IS 'x';\n",
    );
    assertEquals(
      redefinicoesPosteriores(
        dir,
        "liberar_cobranca_do_pedido",
        PINS.liberar_cobranca_do_pedido,
      ),
      [],
      "COMMENT ON FUNCTION não redefine o corpo",
    );
    // mutante: uma migration posterior com o corpo novo
    Deno.writeTextFileSync(
      join(dir, "20261195000000_redefine.sql"),
      "CREATE OR REPLACE FUNCTION public.liberar_cobranca_do_pedido(p uuid, q text)\nRETURNS void LANGUAGE sql AS $$ SELECT 1 $$;\n",
    );
    assertEquals(
      redefinicoesPosteriores(
        dir,
        "liberar_cobranca_do_pedido",
        PINS.liberar_cobranca_do_pedido,
      ),
      ["20261195000000_redefine.sql"],
    );
    // anterior à fonte não conta; rollback-manual não conta
    Deno.writeTextFileSync(
      join(dir, "rollback-manual-20261199000000_x.sql"),
      "CREATE OR REPLACE FUNCTION public.expirar_pedidos_vencidos() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;\n",
    );
    assertEquals(
      redefinicoesPosteriores(
        dir,
        "expirar_pedidos_vencidos",
        PINS.expirar_pedidos_vencidos,
      ),
      [],
    );
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// A prova do dinheiro para QUALQUER loja assinante (A16 do plano da org
// central, 27/11/2026). Até aqui o script só conhecia dois refs fixos (DEK sem
// argumento, CAF com `--site-publicado-caf`), e a Savy e as lojas novas
// publicavam as functions de dinheiro sem prova nenhuma do banco. Agora
// `--loja <nome>` resolve o ref SÓ pelo cadastro (scripts/frota/lojas.json),
// só para loja assinante, e recusa ANTES de qualquer fetch (e antes de olhar o
// token) loja legado, desconhecida ou argumento fora da forma: não existe
// caminho para um ref livre.
// ---------------------------------------------------------------------------
const verificarMod = require("../scripts/publicacao/verificar-pagamentos-ikcous.cjs");
const { validarCadastro } = require("../scripts/frota/lojas.cjs");

const REF_NOVA = "qwertyuiopasdfghjklz";
// Cadastro de FIXTURE (nenhuma loja real além da IKCOUS, que o teste cita pelo
// nome): uma assinante nova no segredo da org e um legado com o ref da CAF.
const CADASTRO = validarCadastro({
  lojas: {
    "ikcous-publicada": {
      ref: "cafkrminfnokvgjqtkle",
      classe: "assinante",
      apelido: "CAF",
      segredoDoToken: "SUPABASE_ACCESS_TOKEN_IKCOUS",
      functionsNomeadas: true,
    },
    "loja-nova-x": {
      ref: REF_NOVA,
      classe: "assinante",
      apelido: "Nova",
      segredoDoToken: "SUPABASE_ACCESS_TOKEN_LOJAS",
      functionsNomeadas: false,
    },
    loja: {
      ref: "cafkrminfnokvgjqtkle",
      classe: "legado",
      apelido: "loja",
      segredoDoToken: "SUPABASE_ACCESS_TOKEN",
      refDasFunctions: "dekxabvqdsuukijblazl",
    },
  },
});
// Token de teste montado em tempo de execução (o secretlint barra literal).
const TOKEN = `sbp_${"ab".repeat(20)}`;

/** fetch de mentira: registra cada chamada e responde um banco CERTO (os
 * corpos pinados das migrations), salvo `corpoErrado`. */
function fetchFalso({ corpoErrado = false } = {}) {
  const chamadas: { url: string; query: string }[] = [];
  const hashes = verificarMod.hashesEsperados();
  const impl = (url: string, init: { body: string }) => {
    const { query } = JSON.parse(init.body);
    chamadas.push({ url, query });
    let linhas;
    if (query.includes("pg_proc")) {
      const fn = (chave: string, md5: string) => ({
        chave,
        existe: true,
        corpo_md5: md5,
        definer: true,
        caminho_fixo: true,
        anon_executa: false,
        authenticated_executa: false,
        service_executa: true,
      });
      linhas = [
        fn("expirar", corpoErrado ? "0".repeat(32) : hashes.expirar),
        fn("liberar", hashes.liberar),
      ];
    } else if (query.includes("pg_attribute")) {
      linhas = [
        "expires_at",
        "gateway_payment_id",
        "metodo_online",
        "paid_at",
        "parcelas",
        "payment_status",
        "status",
        "tentativas_de_pagamento",
      ].map((coluna) => ({ coluna, existe: true, nao_nula: true }));
    } else {
      linhas = [{ id: 1, credito: true, debito: false, parcelas_max: 2 }];
    }
    return Promise.resolve(
      new Response(JSON.stringify(linhas), { status: 200 }),
    );
  };
  return { chamadas, impl };
}

const endpointDe = (ref: string) =>
  `https://api.supabase.com/v1/projects/${ref}/database/query/read-only`;

Deno.test("--loja: loja assinante -> o ref vem do cadastro, e é o único destino das três consultas", async () => {
  const f = fetchFalso();
  const r = await verificarMod.verificar({
    token: TOKEN,
    fetchImpl: f.impl,
    args: ["--loja", "loja-nova-x"],
    cadastro: CADASTRO,
  });
  assertEquals(r.projeto, REF_NOVA);
  assertEquals(r.loja, "loja-nova-x");
  assertEquals(r.ok, true, JSON.stringify(r.checks));
  assertEquals(f.chamadas.length, 3);
  for (const c of f.chamadas) assertEquals(c.url, endpointDe(REF_NOVA));
});

Deno.test("--loja com o cadastro REAL: ikcous-publicada e savy resolvem os refs delas", () => {
  assertEquals(
    verificarMod.resolverDestino(["--loja", "ikcous-publicada"]).ref,
    "cafkrminfnokvgjqtkle",
  );
  assertEquals(
    verificarMod.resolverDestino(["--loja", "savy"]).ref,
    "gnjsrucsmjkajijrakzr",
  );
});

Deno.test("--site-publicado-caf continua, como nome antigo da ikcous-publicada; sem argumento continua o DEK de sempre", () => {
  const antigo = verificarMod.resolverDestino(
    ["--site-publicado-caf"],
    CADASTRO,
  );
  const novo = verificarMod.resolverDestino(
    ["--loja", "ikcous-publicada"],
    CADASTRO,
  );
  assertEquals(antigo, novo);
  assertEquals(antigo.ref, "cafkrminfnokvgjqtkle");
  assertEquals(
    verificarMod.resolverDestino([], CADASTRO).ref,
    "dekxabvqdsuukijblazl",
  );
});

/** Cada forma de pedir um destino que NÃO é loja assinante do cadastro. */
const RECUSADOS: [string, string[]][] = [
  ["loja legado (mesmo com o ref da CAF)", ["--loja", "loja"]],
  ["loja desconhecida", ["--loja", "loja-ausente"]],
  ["ref cru no lugar do nome", ["--loja", REF_NOVA]],
  ["ref cru da CAF no lugar do nome", ["--loja", "cafkrminfnokvgjqtkle"]],
  ["__proto__", ["--loja", "__proto__"]],
  ["--loja sem valor", ["--loja"]],
  ["--loja vazio", ["--loja", ""]],
  ["--loja=nome (forma não aceita)", ["--loja=loja-nova-x"]],
  ["--ref livre", ["--ref", REF_NOVA]],
  ["--project-ref livre", ["--project-ref", REF_NOVA]],
  ["argumento extra depois da loja", ["--loja", "loja-nova-x", REF_NOVA]],
  ["argumento extra no modo antigo", ["--site-publicado-caf", "--loja", "x"]],
  ["duas lojas", ["--loja", "loja-nova-x", "--loja", "ikcous-publicada"]],
  ["argumento solto (antes caía no DEK em silêncio)", ["savy"]],
  ["linha forjada no log", ["--loja", "x\n::error::forjado"]],
];

Deno.test("recusa loja legado, desconhecida e qualquer ref livre ANTES de qualquer fetch (e antes do token)", async (t) => {
  for (const [caso, args] of RECUSADOS) {
    await t.step(caso, async () => {
      for (const token of ["", TOKEN]) {
        const f = fetchFalso();
        let erro: Error | null = null;
        try {
          // sem token: a recusa do destino vem ANTES da conferência do token
          await verificarMod.verificar({
            token,
            fetchImpl: f.impl,
            args,
            cadastro: CADASTRO,
          });
        } catch (e) {
          erro = e;
        }
        assert(erro, `${caso}: devia recusar`);
        assert(
          erro.message.startsWith("Destino recusado: "),
          `${caso}: ${erro.message}`,
        );
        assert(!erro.message.includes("\n"), `${caso}: quebra de linha no log`);
        assertEquals(f.chamadas.length, 0, `${caso}: fez fetch`);
      }
    });
  }
});

Deno.test("não existe parâmetro de ref: verificar ignora `ref`/`endpoint` de quem chama", async () => {
  const f = fetchFalso();
  const r = await verificarMod.verificar({
    token: TOKEN,
    fetchImpl: f.impl,
    args: ["--loja", "loja-nova-x"],
    cadastro: CADASTRO,
    ref: "dekxabvqdsuukijblazl",
    endpoint: "https://exemplo.invalid/",
    projeto: "dekxabvqdsuukijblazl",
  });
  assertEquals(r.projeto, REF_NOVA);
  for (const c of f.chamadas) assertEquals(c.url, endpointDe(REF_NOVA));
  // o módulo não exporta mais um ref/endpoint "global" fixado no carregamento
  assertEquals(verificarMod.REF, undefined);
  assertEquals(verificarMod.ENDPOINT, undefined);
});

Deno.test("o hash esperado continua vindo das migrations: banco certo passa, corpo diferente reprova, em loja nova também", async () => {
  const certo = await verificarMod.verificar({
    token: TOKEN,
    fetchImpl: fetchFalso().impl,
    args: ["--loja", "loja-nova-x"],
    cadastro: CADASTRO,
  });
  assertEquals(certo.ok, true);
  const errado = await verificarMod.verificar({
    token: TOKEN,
    fetchImpl: fetchFalso({ corpoErrado: true }).impl,
    args: ["--loja", "loja-nova-x"],
    cadastro: CADASTRO,
  });
  assertEquals(errado.ok, false);
  assert(
    errado.checks.some(
      (c) =>
        c.checagem === "expirar: corpo identico a migration revisada" && !c.ok,
    ),
  );
  // verificar não recebe hashes de quem chama
  const comHashFalso = await verificarMod.verificar({
    token: TOKEN,
    fetchImpl: fetchFalso({ corpoErrado: true }).impl,
    args: ["--loja", "loja-nova-x"],
    cadastro: CADASTRO,
    hashes: { liberar: "x", expirar: "0".repeat(32) },
  });
  assertEquals(comHashFalso.ok, false);
});

Deno.test("a linha de comando: destino recusado sai 1, imprime só a recusa e não faz fetch", async () => {
  const f = fetchFalso();
  const saida: string[] = [];
  const codigo = await verificarMod.principal(["--loja", "loja"], {
    env: { SUPABASE_ACCESS_TOKEN: TOKEN },
    fetchImpl: f.impl,
    cadastro: CADASTRO,
    log: (s: string) => saida.push(`out:${s}`),
    erro: (s: string) => saida.push(`err:${s}`),
  });
  assertEquals(codigo, 1);
  assertEquals(f.chamadas.length, 0);
  assertEquals(saida.length, 1);
  assert(saida[0].startsWith("err:Destino recusado: "), saida[0]);
  assert(!saida.join("").includes(TOKEN));
  // e a loja certa passa pelo mesmo caminho, sem vazar o token
  const g = fetchFalso();
  const ok: string[] = [];
  const codigoOk = await verificarMod.principal(["--loja", "loja-nova-x"], {
    env: { SUPABASE_ACCESS_TOKEN: TOKEN },
    fetchImpl: g.impl,
    cadastro: CADASTRO,
    log: (s: string) => ok.push(s),
    erro: (s: string) => ok.push(s),
  });
  assertEquals(codigoOk, 0, ok.join("\n"));
  assertEquals(g.chamadas.length, 3);
  assert(!ok.join("").includes(TOKEN));
  assertStringIncludes(ok.join(""), REF_NOVA);
});
