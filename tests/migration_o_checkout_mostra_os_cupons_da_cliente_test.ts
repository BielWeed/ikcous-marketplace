// @ts-nocheck
// O CHECKOUT MOSTRA OS CUPONS DA CLIENTE — prova offline do par
// 20261208000000 + rollback (dinheiro + dado de cliente, 09/10/2026). A prova
// VIVA (lista, validação, gatilho do pedido, retentativa gêmea com 2 conexões,
// admin rebaixado, ida e volta, mutantes) mora em
// tests/banco/cupons-do-checkout-viva.cjs; aqui fica o que se prova só lendo o
// texto, e que o CI sem banco também cobra.
//
// Cada asserção está amarrada a um risco:
//  - migration com BEGIN/COMMIT grava metade em produção;
//  - pré-voo que não é o primeiro comando deixa a migration escrever antes de
//    recusar um banco que não é o que ela espera;
//  - hash do pré-voo que não é o sha256 real do corpo recusa a migration num
//    banco CORRETO (ou aceita um corpo errado);
//  - rollback que não devolve o corpo da 20261203 byte a byte deixa o
//    conserto dos cupons desligados (#777) apagado em silêncio;
//  - corpo novo da validação que difere do da 20261203 em mais do que o bloco
//    prometido ressuscita ou apaga regra de dinheiro sem ninguém ter pedido;
//  - gatilho sem o atalho de retentativa da 20261203 deixa nascer pedido em
//    DOBRO (cobrança e estoque em dobro) quando a lojista tira a cliente da
//    lista no meio de uma compra repetida;
//  - função do painel com `is_admin()` sozinho deixa ex-admin ler nome e
//    e-mail de clientes por até 1 h; função nova que usa `is_admin_atual` fora
//    do fim de POSTERIORES_A_97 faz o rollback da 20261197 recusar.
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const { createHash } = require("node:crypto");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const PASTA = `${DIR}../supabase/migrations`;
const NOME = "20261208000000_o_checkout_mostra_os_cupons_da_cliente.sql";
const NOME_203 = "20261203000000_cupons_desligados_nao_dao_desconto.sql";

const ler = (n) =>
  Deno.readTextFileSync(`${PASTA}/${n}`).replace(/\r\n/g, "\n");
const lerRaiz = (n) =>
  Deno.readTextFileSync(`${DIR}../${n}`).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const m203 = ler(NOME_203);
const tipos = lerRaiz("src/types/database.types.ts");

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const crlf = (s) => s.replace(/\n/g, "\r\n");
const semComentarios = (s) =>
  s
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
const norm = (s) => s.replace(/\s+/g, " ").trim();

// O corpo de uma função entre `AS $$` e `$$;`, a partir de um marcador.
function corpoDe(texto, aPartirDe) {
  const ini = texto.indexOf(aPartirDe);
  assert(ini >= 0, `não achei ${aPartirDe}`);
  const apos = texto.indexOf("AS $$", ini) + "AS $$".length;
  return texto.slice(apos, texto.indexOf("$$;", apos));
}
// O corpo de uma função entre dois `$tag$`, a partir de um marcador.
function corpoComTag(texto, aPartirDe, tag) {
  const ini = texto.indexOf(aPartirDe);
  assert(ini >= 0, `não achei ${aPartirDe}`);
  const a = texto.indexOf(`$${tag}$`, ini) + tag.length + 2;
  return texto.slice(a, texto.indexOf(`$${tag}$`, a));
}
const MARCA_VALIDATE =
  "CREATE OR REPLACE FUNCTION public.validate_coupon_secure_v2(";
const corpo203 = corpoDe(m203, MARCA_VALIDATE);
const corpoNovo = corpoDe(migration, MARCA_VALIDATE);
const corpoDoRollback = corpoDe(rollback, MARCA_VALIDATE);

const H203_LF =
  "489c0cd19b3529ef2d9cf341096ee9b0048e5787ff0a2d0a918df4db580e82f3";
const H203_CRLF =
  "4b096e67be79665d70e86ff5e94953ecf5842cd64abca882abac0f6cbe328279";

const corpoFuncao = (nome, tag) =>
  corpoComTag(migration, `CREATE OR REPLACE FUNCTION public.${nome}(`, tag);

// ---------------------------------------------------------------------------
// Tarefa 1 — os tipos do banco conhecem o que a migration cria
// ---------------------------------------------------------------------------
function bloco(texto, abre, fecha) {
  const i = texto.indexOf(abre);
  assert(i >= 0, `tipos sem ${abre.trim()}`);
  const j = texto.indexOf(fecha, i + abre.length);
  assert(j > i, `tipos sem o fim de ${abre.trim()}`);
  return texto.slice(i, j);
}

Deno.test("208 tipos: coupons ganha `alcance` (Row obrigatório, Insert/Update opcionais)", () => {
  const b = bloco(tipos, "      coupons: {\n", "      cupom_clientes: {\n");
  assertStringIncludes(b, "alcance: string;");
  assertEquals(b.match(/alcance\?: string;/g)?.length, 2);
  assert(!/used_count/.test(b), "a coluna duplicada morreu na 20261207");
});

Deno.test("208 tipos: cupom_clientes é uma tabela de 3 colunas com as 2 chaves estrangeiras", () => {
  const b = bloco(
    tipos,
    "      cupom_clientes: {\n",
    "      devolucao_eventos: {\n",
  );
  for (const c of [
    "coupon_id: string;",
    "user_id: string;",
    "criado_em: string;",
  ])
    assertStringIncludes(b, c);
  assertStringIncludes(b, 'foreignKeyName: "cupom_clientes_coupon_id_fkey"');
  assertStringIncludes(b, 'foreignKeyName: "cupom_clientes_user_id_fkey"');
});

Deno.test("208 tipos: as 3 funções novas com a forma da migration, e nenhuma coluna de id/contador/CPF na lista", () => {
  const lista = bloco(
    tipos,
    "      cupons_do_checkout: {\n",
    "      anular_venda_presencial: {\n",
  );
  assertStringIncludes(lista, "Args: { p_subtotal: number };");
  for (const c of [
    "aplica: boolean;",
    "codigo: string;",
    "desconto: number;",
    "exclusivo: boolean;",
    "falta: number;",
    "minimo: number;",
    "tipo: string;",
    "valido_ate: string | null;",
    "valor: number;",
  ])
    assertStringIncludes(lista, c);
  for (const proibido of ["id:", "usage", "user_id", "cpf", "email", "nome"])
    assert(!lista.includes(proibido), `lista do checkout expõe ${proibido}`);
  const painel = bloco(
    tipos,
    "      admin_cupom_clientes: {\n",
    "      cupons_do_checkout: {\n",
  );
  assertStringIncludes(painel, "Args: { p_coupon_id: string };");
  assertStringIncludes(
    painel,
    "Args: { p_clientes: string[]; p_coupon_id: string };",
  );
  assert(!/cpf/i.test(painel), "o painel nunca recebe CPF");
});

// ---------------------------------------------------------------------------
// Tarefa 3 — migration parte 1: pré-voo, alcance, lista
// ---------------------------------------------------------------------------
Deno.test("208: sem BEGIN/COMMIT de nível superior (migration e rollback)", () => {
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
});

// O primeiro comando executável (fora comentário) é o DO do pré-voo — nada
// (nem SET LOCAL, nem DDL) vem antes: o lock_timeout e as travas moram DENTRO
// dele, e tudo que ele recusa, recusa antes de escrever.
function primeiroComando(texto) {
  const m = semComentarios(texto).trim();
  return m.slice(0, m.indexOf("\n"));
}
Deno.test("208: o PRÉ-VOO é o primeiro comando da migration e do rollback", () => {
  assert(
    /^DO \$preflight_20261208\$/.test(primeiroComando(migration)),
    primeiroComando(migration),
  );
  assert(
    /^DO \$guarda_rollback_20261208\$/.test(primeiroComando(rollback)),
    primeiroComando(rollback),
  );
  // E nenhum DDL/escrita aparece antes do fim do pré-voo.
  const m = semComentarios(migration);
  const fimPre = m.indexOf("END $preflight_20261208$;");
  assert(fimPre > 0);
  assert(
    !/\b(CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|COMMENT)\b/.test(
      m.slice(0, fimPre).replace(/RAISE EXCEPTION '[^']*'/g, ""),
    ),
    "o pré-voo escreve alguma coisa",
  );
});

Deno.test("208: o pré-voo trava as tabelas (lock_timeout 5 s) ANTES de ler o que decide", () => {
  const pre = migration.slice(
    migration.indexOf("DO $preflight_20261208$"),
    migration.indexOf("END $preflight_20261208$;"),
  );
  assertStringIncludes(pre, "set_config('lock_timeout', '5s', true)");
  const iTrava = pre.indexOf(
    "LOCK TABLE public.coupons IN ACCESS EXCLUSIVE MODE",
  );
  assert(iTrava > 0, "sem a trava da tabela dos cupons");
  assert(pre.indexOf("lock_timeout") < iTrava);
  assertStringIncludes(
    pre,
    "LOCK TABLE public.marketplace_orders IN SHARE ROW EXCLUSIVE MODE",
  );
  assertStringIncludes(
    pre,
    "LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE",
  );
  // A leitura do corpo vivo da validação vem DEPOIS da trava.
  assert(pre.indexOf("validate_coupon_secure_v2") > iTrava);
});

Deno.test("208: o pré-voo aceita EXATAMENTE os 4 corpos (20261203 e 20261208, cada um LF e CRLF) — hashes são o sha256 real", () => {
  for (const [rotulo, texto, h] of [
    ["203 LF", corpo203, H203_LF],
    ["203 CRLF", crlf(corpo203), H203_CRLF],
    ["208 LF", corpoNovo, sha256(corpoNovo)],
    ["208 CRLF", crlf(corpoNovo), sha256(crlf(corpoNovo))],
  ]) {
    assertEquals(sha256(texto), h, `${rotulo}: hash de referência`);
    assertStringIncludes(migration, `'${h}'`, `migration sem o hash ${rotulo}`);
    assertStringIncludes(rollback, `'${h}'`, `rollback sem o hash ${rotulo}`);
  }
  // Nenhum outro literal de 64 hex no pré-voo da validação além desses 4.
  const pre = migration.slice(
    migration.indexOf("DO $preflight_20261208$"),
    migration.indexOf("END $preflight_20261208$;"),
  );
  const hashes = new Set(pre.match(/'[0-9a-f]{64}'/g) ?? []);
  assertEquals(hashes.size, 4, `hashes no pré-voo: ${[...hashes].join(",")}`);
});

Deno.test("208: o pré-voo recusa, SEM gravar, o que ele nomeia (gatilho da 203, índice único, funções do admin atual, formas existentes)", () => {
  const pre = migration.slice(
    migration.indexOf("DO $preflight_20261208$"),
    migration.indexOf("END $preflight_20261208$;"),
  );
  for (const trecho of [
    "tr_pedido_com_cupom_exige_a_chave_ligada",
    "marketplace_orders_chave_da_compra_unica",
    "public.is_admin_atual()",
    "public.rls_admin_atual()",
    "public.is_admin()",
    "B1_BASELINE_DIVERGENT",
    "coupons_alcance_check",
    "cupom_clientes",
    "cupons_do_checkout",
    "admin_cupom_clientes",
    "admin_cupom_definir_clientes",
  ])
    assertStringIncludes(pre, trecho, `pré-voo sem ${trecho}`);
  assert(
    (pre.match(/RAISE EXCEPTION/g) ?? []).length >= 10,
    "o pré-voo tem de nomear cada recusa",
  );
});

Deno.test("208: coupons.alcance nasce 'codigo' (todo cupom que já existe fica secreto), com CHECK dos 3 valores, sem reescrever linha", () => {
  const m = semComentarios(migration);
  assert(
    /ALTER TABLE public\.coupons\s+ADD COLUMN IF NOT EXISTS alcance text NOT NULL DEFAULT 'codigo';/.test(
      m,
    ),
  );
  assert(
    /ADD CONSTRAINT coupons_alcance_check\s+CHECK \(alcance IN \('codigo', 'vitrine', 'exclusivo'\)\)/.test(
      m,
    ),
  );
  // Nenhum UPDATE/DELETE de linha nesta migration (dado existente intocado).
  assert(!/\bUPDATE\s+public\./i.test(m), "a migration reescreve linha");
  assert(
    !/\bDELETE\s+FROM\b/i.test(
      m.replace(/DELETE FROM public\.cupom_clientes/g, ""),
    ),
    "a migration apaga linha",
  );
});

Deno.test("208: cupom_clientes — RLS ligada, sem escrita para authenticated, leitura só do admin ATUAL em subselect", () => {
  const m = semComentarios(migration);
  assertStringIncludes(
    m,
    "ALTER TABLE public.cupom_clientes ENABLE ROW LEVEL SECURITY;",
  );
  assertStringIncludes(
    m,
    "REVOKE ALL ON TABLE public.cupom_clientes FROM PUBLIC, anon, authenticated;",
  );
  assertStringIncludes(
    m,
    "GRANT SELECT ON TABLE public.cupom_clientes TO authenticated;",
  );
  assert(
    !/GRANT\s+(INSERT|UPDATE|DELETE|ALL)[^;]*TO[^;]*authenticated/i.test(m),
    "authenticated com escrita",
  );
  assert(
    /CREATE POLICY cupom_clientes_admin_select_policy\s+ON public\.cupom_clientes FOR SELECT\s+TO authenticated\s+USING \(\(SELECT public\.rls_admin_atual\(\)\)\);/.test(
      m,
    ),
  );
  // Nenhuma política cita is_admin() sozinho (JWT velho vale ~1 h).
  const politicas = m.match(/CREATE POLICY[\s\S]*?;/g) ?? [];
  assertEquals(politicas.length, 1);
  assert(!/is_admin\(\)/.test(politicas[0]));
});

Deno.test("208: nenhum corpo novo cita a coluna duplicada que morreu (#784)", () => {
  assert(!/used_count/.test(semComentarios(migration)));
  assert(!/used_count/.test(semComentarios(rollback)));
});

// ---------------------------------------------------------------------------
// Tarefa 4 — funções do painel
// ---------------------------------------------------------------------------
Deno.test("208: as 2 funções do painel exigem o admin ATUAL (nunca is_admin() sozinho), search_path fixo, sem anon", () => {
  for (const [nome, tag] of [
    ["admin_cupom_definir_clientes", "definir"],
    ["admin_cupom_clientes", "ler"],
  ]) {
    const corpo = corpoFuncao(nome, tag);
    assertStringIncludes(
      corpo,
      "IF NOT (public.is_admin() AND public.is_admin_atual()) THEN",
      `${nome} sem a porta do admin atual`,
    );
    assertStringIncludes(corpo, "USING ERRCODE = '42501'");
    // A porta é o PRIMEIRO comando do corpo.
    const primeiro = semComentarios(corpo).trim().split("\n");
    assert(
      primeiro.findIndex((l) => /^BEGIN/.test(l)) >= 0 &&
        /IF NOT \(public\.is_admin\(\) AND public\.is_admin_atual\(\)\)/.test(
          primeiro[primeiro.findIndex((l) => /^BEGIN/.test(l)) + 1],
        ),
      `${nome}: a porta não é o primeiro comando`,
    );
    const m = semComentarios(migration);
    const iCabeca = m.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
    assert(iCabeca >= 0, `${nome}: não achei a função`);
    const cabeca = norm(m.slice(iCabeca, m.indexOf(" AS $", iCabeca)));
    assertStringIncludes(
      cabeca,
      "SECURITY DEFINER SET search_path = public",
      `${nome}: SECURITY DEFINER com search_path = public`,
    );
  }
  const m = norm(semComentarios(migration));
  for (const assinatura of [
    "public.admin_cupom_definir_clientes(uuid, uuid[])",
    "public.admin_cupom_clientes(uuid)",
  ]) {
    assertStringIncludes(
      m,
      `REVOKE ALL ON FUNCTION ${assinatura} FROM PUBLIC, anon, authenticated;`,
    );
    assertStringIncludes(
      m,
      `GRANT EXECUTE ON FUNCTION ${assinatura} TO authenticated, service_role;`,
    );
  }
});

Deno.test("208: admin_cupom_clientes nunca seleciona CPF (nem de profiles nem de lugar nenhum) e devolve só id, nome e e-mail", () => {
  const corpo = corpoFuncao("admin_cupom_clientes", "ler");
  assert(!/cpf/i.test(corpo), "o painel lê CPF");
  assertStringIncludes(
    norm(migration),
    "RETURNS TABLE (user_id uuid, nome text, email text)",
  );
  // CPF não aparece em NENHUM comando da migration (só em comentário).
  assert(!/cpf/i.test(semComentarios(migration)));
});

Deno.test("208: a lista do painel é trocada inteira numa trava do cupom (duas abas nunca misturam), com teto e checagem de contas", () => {
  const corpo = corpoFuncao("admin_cupom_definir_clientes", "definir");
  assertStringIncludes(
    corpo,
    "FROM public.coupons WHERE id = p_coupon_id FOR UPDATE",
  );
  assertStringIncludes(corpo, "cardinality(v_lista) > 500");
  assertStringIncludes(corpo, "ON CONFLICT (coupon_id, user_id) DO NOTHING");
});

// ---------------------------------------------------------------------------
// Tarefa 6 — o gatilho do exclusivo
// ---------------------------------------------------------------------------
const NOME_GATILHO = "tr_pedido_com_cupom_so_nasce_para_a_lista";
const NOME_GATILHO_CHAVE = "tr_pedido_com_cupom_exige_a_chave_ligada";

Deno.test("208 gatilho: BEFORE INSERT só com cupom, roda DEPOIS do gatilho da chave (ordem alfabética), sem EXECUTE para o público", () => {
  const m = semComentarios(migration);
  assert(
    new RegExp(
      `CREATE OR REPLACE TRIGGER ${NOME_GATILHO}\\s+BEFORE INSERT ON public\\.marketplace_orders\\s+FOR EACH ROW\\s+WHEN \\(NEW\\.coupon_id IS NOT NULL\\)\\s+EXECUTE FUNCTION public\\.pedido_com_cupom_so_nasce_para_a_lista\\(\\);`,
    ).test(m),
  );
  // O Postgres dispara os gatilhos do mesmo tipo em ordem de nome (collation C).
  assert(
    NOME_GATILHO > NOME_GATILHO_CHAVE,
    "o gatilho do exclusivo tem de rodar depois do da chave",
  );
  assertStringIncludes(
    m,
    "REVOKE ALL ON FUNCTION public.pedido_com_cupom_so_nasce_para_a_lista() FROM PUBLIC, anon, authenticated;",
  );
  assert(m.includes(NOME_GATILHO_CHAVE), "o pré-voo nomeia o gatilho da 203");
});

Deno.test("208 gatilho: o ATALHO DE RETENTATIVA é idêntico ao da 20261203 (linhas do predicado do índice único)", () => {
  const corpo = corpoFuncao(
    "pedido_com_cupom_so_nasce_para_a_lista",
    "gatilho",
  );
  const atalho203 = [
    "IF NEW.idempotency_key IS NOT NULL",
    "AND EXISTS (SELECT 1 FROM public.marketplace_orders WHERE idempotency_key = NEW.idempotency_key) THEN",
    "RETURN NEW;",
    "END IF;",
  ];
  // As 4 linhas existem, na ordem, na 203 (de onde foram copiadas) ...
  const linhas203 = corpoComTag(
    m203,
    "CREATE OR REPLACE FUNCTION public.pedido_com_cupom_exige_a_chave_ligada(",
    "function",
  )
    .split("\n")
    .map((l) => l.trim());
  const i203 = linhas203.indexOf(atalho203[0]);
  assert(i203 >= 0, "a 203 mudou: o atalho não está mais lá");
  for (const [k, l] of atalho203.entries())
    assertEquals(linhas203[i203 + k], l, `203 linha ${k}`);
  // ... e idênticas, seguidas e na mesma ordem, no gatilho novo.
  const linhasNovo = corpo.split("\n").map((l) => l.trim());
  const iNovo = linhasNovo.indexOf(atalho203[0]);
  assert(iNovo >= 0, "o gatilho novo NÃO tem o atalho de retentativa");
  for (const [k, l] of atalho203.entries())
    assertEquals(linhasNovo[iNovo + k], l, `gatilho novo linha ${k}`);
  // O atalho vem DEPOIS de decidir que a cliente está fora da lista e ANTES do RAISE.
  const iRaise = corpo.indexOf("RAISE EXCEPTION");
  assert(corpo.indexOf(atalho203[0]) < iRaise);
});

Deno.test("208 gatilho: a frase da recusa é a do 'não existe' da v24, a chave da loja NÃO é lida e nada além de RETURN/RAISE", () => {
  const corpo = corpoFuncao(
    "pedido_com_cupom_so_nasce_para_a_lista",
    "gatilho",
  );
  assertStringIncludes(
    corpo,
    "RAISE EXCEPTION 'O cupom % não existe. Confira o código.', NEW.coupon_code;",
  );
  assert(!/enable_coupons/.test(semComentarios(corpo)));
  assertStringIncludes(corpo, "v_alcance = 'exclusivo'");
  assertStringIncludes(corpo, "NEW.user_id IS NULL");
  assertStringIncludes(corpo, "FROM public.cupom_clientes cc");
  assert(!/\b(INSERT|UPDATE|DELETE)\b/.test(semComentarios(corpo)));
});

Deno.test("208: nenhuma redefinição de create_marketplace_order_v23/v24 aqui (outras migrations travam o hash delas)", () => {
  assert(
    !/FUNCTION public\.create_marketplace_order_v2[34]/.test(
      semComentarios(migration),
    ),
  );
  assert(
    !/FUNCTION public\.devolver_uso_cupom/.test(semComentarios(migration)),
  );
});

// ---------------------------------------------------------------------------
// Tarefa 7 — validação nova e a lista do checkout
// ---------------------------------------------------------------------------
Deno.test("208 validação: o corpo novo é o da 20261203 + SÓ o bloco do exclusivo, o corte `<=` e a frase do mínimo", () => {
  const l203 = corpo203.split("\n");
  const lNovo = corpoNovo.split("\n");
  const conta = (ls) => {
    const m = new Map();
    for (const l of ls) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const c203 = conta(l203);
  const cNovo = conta(lNovo);
  const sumiram = [];
  for (const [l, n] of c203)
    if ((cNovo.get(l) ?? 0) < n) sumiram.push(l.trim());
  assertEquals(
    sumiram.sort(),
    [
      "IF v_coupon.id IS NULL THEN",
      "ELSIF v_coupon.valid_until IS NOT NULL AND v_coupon.valid_until < NOW() THEN",
      "v_error := 'Valor mínimo não atingido.';",
    ].sort(),
    "linhas da 203 que o corpo novo deixou de ter",
  );
  // O que a 203 consertou continua LITERALMENTE no corpo novo, em ordem.
  const blocoDesligada = l203
    .slice(
      l203.findIndex((l) => l.includes("CUPONS DESLIGADOS")),
      l203.findIndex((l) => l.includes("-- Fix: Standardize")),
    )
    .join("\n");
  assertStringIncludes(corpoNovo, blocoDesligada);
  assertStringIncludes(corpoNovo, "'Os cupons estão desativados nesta loja.'");
  // O bloco do exclusivo vem DEPOIS do bloco "desligada" e da busca do cupom.
  assert(
    corpoNovo.indexOf("Os cupons estão desativados nesta loja.") <
      corpoNovo.indexOf("v_coupon.alcance = 'exclusivo'"),
  );
  assert(
    corpoNovo.indexOf("SELECT * INTO v_coupon") <
      corpoNovo.indexOf("v_coupon.alcance = 'exclusivo'"),
  );
});

Deno.test("208 validação: exclusivo de OUTRA conta responde 'inválido' ANTES de qualquer outro motivo; a frase do limite NÃO muda um caractere", () => {
  // A primeira condição da cadeia IF é inexistente-ou-exclusivo-alheio.
  const iPrimeira = corpoNovo.indexOf("IF v_coupon.id IS NULL");
  const iExpirou = corpoNovo.indexOf("Este cupom expirou.");
  const iLimite = corpoNovo.indexOf("Cupom atingiu o limite de uso.");
  const iFaltam = corpoNovo.indexOf("'Faltam R$ '");
  assert(iPrimeira > 0 && iPrimeira < iExpirou && iExpirou < iLimite);
  assert(iLimite < iFaltam);
  assertStringIncludes(corpoNovo, "v_error := 'Cupom inválido ou expirado.';");
  assertStringIncludes(corpoNovo, "v_uid IS NULL");
  assertStringIncludes(
    corpoNovo,
    "WHERE cc.coupon_id = v_coupon.id AND cc.user_id = v_uid",
  );
  // A frase do limite: idêntica à da 203 (o front e o cupom preso a leem).
  assertStringIncludes(
    corpo203,
    "v_error := 'Cupom atingiu o limite de uso.';",
  );
  assertStringIncludes(
    corpoNovo,
    "v_error := 'Cupom atingiu o limite de uso.';",
  );
  assertStringIncludes(
    corpoDoRollback,
    "v_error := 'Cupom atingiu o limite de uso.';",
  );
  // E em nenhum outro arquivo de migration vivo a frase foi alterada por esta.
  assert(
    !/limite de uso\.'/.test(
      semComentarios(migration).replace(
        /v_error := 'Cupom atingiu o limite de uso\.';/g,
        "",
      ),
    ),
  );
  // O corte de validade é `<=` (o cupom morre NO instante), como a v24.
  assertStringIncludes(
    corpoNovo,
    "v_coupon.valid_until IS NOT NULL AND v_coupon.valid_until <= NOW()",
  );
  assertStringIncludes(corpoNovo, "v_uid uuid := auth.uid();");
  assert(!/used_count/.test(corpoNovo));
});

Deno.test("208 rollback: devolve o corpo da 20261203 BYTE A BYTE", () => {
  assertEquals(corpoDoRollback, corpo203);
  assertEquals(sha256(corpoDoRollback), H203_LF);
});

Deno.test("208 lista do checkout: SQL STABLE DEFINER, search_path fixo, só ativos e válidos, LIMIT 20, sem id nem contador, anon e authenticated", () => {
  const corpo = corpoFuncao("cupons_do_checkout", "lista");
  const m = semComentarios(migration);
  assert(
    /CREATE OR REPLACE FUNCTION public\.cupons_do_checkout\(p_subtotal numeric\)[\s\S]*?LANGUAGE sql\s+STABLE\s+SECURITY DEFINER\s+SET search_path = public\s+AS \$lista\$/.test(
      m,
    ),
  );
  for (const t of [
    "c.active = true",
    "c.value > 0",
    "c.valid_until IS NULL OR c.valid_until > now()",
    "c.usage_limit IS NOT NULL AND c.usage_limit > 0",
    "c.alcance = 'vitrine'",
    "c.alcance = 'exclusivo'",
    "e.uid IS NOT NULL",
    "cc.coupon_id = c.id AND cc.user_id = e.uid",
    "LIMIT 20",
    "enable_coupons",
  ])
    assertStringIncludes(corpo, t, `lista sem ${t}`);
  // Nunca devolve id nem contador: o SELECT final só tem as 9 colunas.
  const final = corpo.slice(corpo.lastIndexOf("  SELECT code"));
  assert(!/\bc\.id\b|usage|\bid\b/.test(final.split("FROM")[0]));
  assertStringIncludes(
    norm(m),
    "REVOKE ALL ON FUNCTION public.cupons_do_checkout(numeric) FROM PUBLIC, anon, authenticated;",
  );
  assertStringIncludes(
    norm(m),
    "GRANT EXECUTE ON FUNCTION public.cupons_do_checkout(numeric) TO anon, authenticated, service_role;",
  );
});

Deno.test("208 pós-voo: a migration só termina se o hash novo, o gatilho, as permissões e o default estão de pé", () => {
  const pos = migration.slice(migration.indexOf("DO $posvoo_20261208$"));
  assert(pos.includes("POSVOO_20261208"));
  for (const t of [
    sha256(corpoNovo),
    sha256(crlf(corpoNovo)),
    NOME_GATILHO,
    NOME_GATILHO_CHAVE,
    "has_function_privilege('anon'",
    "has_table_privilege('authenticated'",
    "''codigo''::text",
  ])
    assertStringIncludes(pos, t, `pós-voo sem ${t}`);
});

// ---------------------------------------------------------------------------
// Tarefa 5 — rollback
// ---------------------------------------------------------------------------
Deno.test("208 rollback: desativa os exclusivos ANTES de apagar a coluna, depois derruba funções, gatilho, tabela e coluna", () => {
  const m = semComentarios(rollback);
  const ordem = [
    "UPDATE public.coupons SET active = false WHERE alcance = ''exclusivo''",
    "DROP FUNCTION IF EXISTS public.cupons_do_checkout(numeric);",
    "DROP FUNCTION IF EXISTS public.admin_cupom_clientes(uuid);",
    "DROP FUNCTION IF EXISTS public.admin_cupom_definir_clientes(uuid, uuid[]);",
    "DROP TRIGGER IF EXISTS tr_pedido_com_cupom_so_nasce_para_a_lista ON public.marketplace_orders;",
    "DROP FUNCTION IF EXISTS public.pedido_com_cupom_so_nasce_para_a_lista();",
    "CREATE OR REPLACE FUNCTION public.validate_coupon_secure_v2(",
    "DROP TABLE IF EXISTS public.cupom_clientes;",
    "ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_alcance_check;",
    "ALTER TABLE public.coupons DROP COLUMN IF EXISTS alcance;",
  ];
  let ultimo = -1;
  for (const o of ordem) {
    const i = m.indexOf(o);
    assert(i > ultimo, `rollback: "${o}" fora de ordem ou ausente`);
    ultimo = i;
  }
  // Sem CASCADE: dependente que escapou do pré-voo faz o Postgres recusar.
  assert(!/CASCADE/i.test(m));
  // O gatilho da 203 (chave desligada) NÃO é tocado pelo rollback da 208.
  assert(!m.includes(`DROP TRIGGER IF EXISTS ${NOME_GATILHO_CHAVE}`));
});

Deno.test("208 rollback: o pré-voo recusa corpo de migration POSTERIOR e é idempotente (aceita o da 203 e o da 208)", () => {
  const g = rollback.slice(
    rollback.indexOf("DO $guarda_rollback_20261208$"),
    rollback.indexOf("END $guarda_rollback_20261208$;"),
  );
  assertStringIncludes(g, "migration posterior");
  for (const h of [
    H203_LF,
    H203_CRLF,
    sha256(corpoNovo),
    sha256(crlf(corpoNovo)),
  ])
    assertStringIncludes(g, h);
  assertStringIncludes(g, "set_config('lock_timeout', '5s', true)");
});

Deno.test("208 rollback: o aviso de que APAGA dado da lojista está no cabeçalho", () => {
  const cab = rollback.slice(
    0,
    rollback.indexOf("DO $guarda_rollback_20261208$"),
  );
  assert(/APAGA/.test(cab));
  assert(/lista de clientes/.test(cab));
  assert(/desativa/i.test(cab));
});

// ---------------------------------------------------------------------------
// A composição com as migrations do admin atual (licão do #779)
// ---------------------------------------------------------------------------
Deno.test("208 composição: a migration entra no FIM de POSTERIORES_A_97 em admin-atual-viva e pagamentos-rpc-viva", () => {
  for (const arq of [
    "tests/banco/admin-atual-viva.cjs",
    "tests/banco/pagamentos-rpc-viva.cjs",
  ]) {
    const t = lerRaiz(arq);
    const ini = t.indexOf("const POSTERIORES_A_97 = [");
    const fim = t.indexOf("\n];", ini);
    assert(ini > 0 && fim > ini, `${arq}: sem a lista`);
    const lista = t.slice(ini, fim);
    const ultimo = [...lista.matchAll(/nome: "([^"]+)"/g)]
      .map((x) => x[1])
      .pop();
    assertEquals(ultimo, NOME, `${arq}: a 208 não é o ÚLTIMO da lista`);
    assertStringIncludes(lista, "public.admin_cupom_clientes(uuid)");
  }
});

Deno.test("208 composição: a prova viva está no rpc-ci, na lista PROVAS_DO_DINHEIRO e no LEIA-ME", () => {
  const ci = lerRaiz(".github/workflows/rpc-ci.yml");
  assertStringIncludes(
    ci,
    "run: node tests/banco/rodar-isolado.cjs tests/banco/cupons-do-checkout-viva.cjs",
  );
  const lista = lerRaiz(
    "tests/migration_a_contestacao_decide_sob_a_trava_do_pedido_test.ts",
  );
  assertStringIncludes(lista, '"tests/banco/cupons-do-checkout-viva.cjs"');
  const leia = lerRaiz("tests/banco/LEIA-ME.md");
  assertStringIncludes(leia, "cupons-do-checkout-viva.cjs");
});
