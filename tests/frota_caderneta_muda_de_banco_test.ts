// @ts-nocheck
// A CADERNETA MUDA DE BANCO — prova offline da FORMA dos dois scripts da virada (plano
// PLANO-CADERNETA-FORA-DO-DEKXAB-26-11, T1 e T2) e de onde a prova viva roda.
//
// O DEFEITO QUE ESTE TESTE FIXA: a caderneta da frota vai ser copiada do banco antigo para o banco da IKCOUS. A impressão digital
// é rodada nos dois bancos de PRODUÇÃO (pelo MCP): se ela escrever, ou se devolver o hash da chave em claro, a própria medição vira
// o incidente. O gerador da cópia roda na ORIGEM (só lê) e devolve o texto que vai ao DESTINO: se ele carregar o atalho da chave
// (hash_rapido) ou deixar de ligar a variável da porta, a cópia ou leva um verificador da chave que não precisava, ou é recusada
// pelo gatilho no meio da virada. O COMPORTAMENTO (dois bancos reais, cópia executada, recusas, mutantes) é da prova viva
// tests/banco/a-caderneta-muda-de-banco-viva.cjs, no Postgres efêmero do CI (rpc-ci.yml); aqui fica só o que se vê no texto.
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
const {
  contarStatements,
} = require("../scripts/publicacao/conferir-banco.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const RAIZ = `${DIR}..`;
const LER = (p) => Deno.readTextFileSync(`${RAIZ}/${p}`).replace(/\r/g, "");
const PASTA = "scripts/frota/banco-da-caderneta";
const DIGITAL = `${PASTA}/caderneta-impressao-digital.sql`;

const norm = (s) => s.replace(/\s+/g, " ").trim();
// `codigo` tira comentários, literais e corpos (só a estrutura); `semComentarios` tira só os comentários de linha.
const codigo = (s) => norm(removerRuido(s));
const semComentarios = (s) => norm(s.replace(/--.*$/gm, ""));

// Verbos que escrevem ou mudam a sessão: nenhum pode aparecer na ESTRUTURA de um script que só lê.
const RE_ESCRITA =
  /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE|COPY|LOCK|SET|NOTIFY|CALL|DO|set_config|nextval|setval|pg_advisory_lock)\b/i;

const FUNCOES = [
  "resolver_loja",
  "resolver_loja_com_estado",
  "frota_mudar_estado",
  "frota_lojas_estado_so_pela_porta",
  // A 20261570 (o endereço antigo encaminha para o novo): o gatilho da tabela nova e as duas portas.
  "frota_enderecos_que_encaminham_nao_e_principal",
  "resolver_encaminhamento",
  "frota_trocar_dominio",
];
const TABELAS = [
  "frota_lojas",
  "frota_segredo",
  "frota_estado_historico",
  "frota_enderecos_que_encaminham",
];
const VERSOES = [
  "20261141000000",
  "20261460000000",
  "20261470000000",
  "20261480000000",
  "20261490000000",
  "20261570000000",
];

Deno.test("impressao digital: UM statement, so SELECT, nenhum verbo de escrita, sem transacao propria", () => {
  const sql = LER(DIGITAL);
  assertEquals(contarStatements(sql), 1, "um statement so");
  const c = codigo(sql);
  assert(/^(SELECT|WITH)\b/i.test(c), "comeca por SELECT ou WITH");
  const achado = c.match(RE_ESCRITA);
  assertEquals(achado, null, `verbo de escrita na estrutura: ${achado?.[0]}`);
  assertEquals(detectarTransacaoExplicita(removerRuido(sql)).achados, []);
  // As portas do porteiro gravam o atalho da chave quando chamadas: a digital nunca as chama.
  assert(
    !/\bresolver_loja(_com_estado)?\s*\(/.test(c),
    "a digital nao chama a porta (ela grava o atalho)",
  );
});

Deno.test("impressao digital: o hash da chave so sai como md5, e o atalho so como 'e nulo?'", () => {
  const s = semComentarios(LER(DIGITAL));
  assertStringIncludes(s, "md5(fs.hash)");
  assert(
    !s.replace(/md5\(fs\.hash\)/g, "").includes("fs.hash"),
    "fs.hash fora do md5",
  );
  // O atalho (sha256 da chave) e o hash a que ele vale nunca entram no conteudo: saem do to_jsonb antes de qualquer md5.
  assertStringIncludes(s, "- 'hash' - 'hash_rapido' - 'hash_rapido_de'");
  assertStringIncludes(s, "->> 'hash_rapido') IS NULL");
});

Deno.test("impressao digital: blocos de conteudo, forma, ACL, as 7 funcoes e as 6 versoes, em ordem que nao depende da colacao do banco", () => {
  const s = LER(DIGITAL);
  for (const t of TABELAS) assertStringIncludes(s, `'${t}'`);
  for (const f of FUNCOES) assertStringIncludes(s, `'${f}'`);
  for (const v of VERSOES) assertStringIncludes(s, `'${v}'`);
  // Ordem de texto com a colacao C: dois bancos com colacao padrao diferente dariam md5 diferente para o mesmo conteudo.
  assertStringIncludes(s, 'COLLATE "C"');
  // Data com fuso: normalizada para UTC (dois bancos com TimeZone diferente dariam texto diferente para o mesmo instante).
  assertStringIncludes(s, "AT TIME ZONE 'UTC'");
  // O corpo das funcoes medido como o resto do repositorio mede (sem \r).
  assertStringIncludes(s, "md5(replace(p.prosrc, E'\\r', ''))");
  // Cada tabela da caderneta entra no conteudo (linhas e md5) e na forma/ACL — a dos enderecos que encaminham inclusive.
  const c = semComentarios(s);
  for (const t of TABELAS) {
    assertStringIncludes(c, `FROM public.${t} `, `${t}: linhas no conteudo`);
    assertStringIncludes(
      c,
      `('${t}')`,
      `${t}: nas listas de conteudo e de forma`,
    );
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
// T2: o gerador da cópia (roda na ORIGEM, só lê; devolve o texto que roda no DESTINO)
// ---------------------------------------------------------------------------------------------------------------------------
const GERADOR = `${PASTA}/copiar-caderneta-gerar.sql`;
const md5 = async (s) => {
  const { createHash } = await import("node:crypto");
  return createHash("md5").update(s).digest("hex");
};
/** O texto entre `AS $$` e `$$;` do CREATE OR REPLACE FUNCTION `nome` (o que o Postgres guarda em prosrc). */
function corpo(sql, nome) {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION ${nome}(`);
  assert(i >= 0, `${nome} nao encontrada`);
  const abre = sql.indexOf("AS $$", i) + "AS $$".length;
  return sql.slice(abre, sql.indexOf("$$;", abre));
}
/** Os pedaços $m$...$m$ do gerador, colados: o molde do texto que vai ao destino (sem os valores medidos na origem). */
function molde(sql) {
  return [...sql.matchAll(/\$m\$([\s\S]*?)\$m\$/g)].map((m) => m[1]).join("\n");
}

Deno.test("gerador: UM statement, so le na origem (nenhum verbo de escrita fora do molde), sem transacao propria", () => {
  const sql = LER(GERADOR);
  assertEquals(contarStatements(sql), 1, "um statement so");
  const c = codigo(sql);
  assert(/^(SELECT|WITH)\b/i.test(c), "comeca por SELECT ou WITH");
  const achado = c.match(RE_ESCRITA);
  assertEquals(achado, null, `verbo de escrita na estrutura: ${achado?.[0]}`);
  assert(
    !/\bresolver_loja(_com_estado)?\s*\(/.test(c),
    "o gerador nao chama a porta (ela grava o atalho na origem)",
  );
  // O molde (o que roda no destino) tambem nao abre nem fecha transacao: quem executa abre (begin; ... commit;).
  assertEquals(
    detectarTransacaoExplicita(removerRuido(molde(sql))).achados,
    [],
  );
});

Deno.test("gerador: o atalho da chave fica na origem; a porta do gatilho e' ligada e desligada; historico com o id da origem e a sequencia ajustada", () => {
  const sql = LER(GERADOR);
  const m = molde(sql);
  assertStringIncludes(
    semComentarios(sql),
    "WHERE NOT (v.tabela = 'frota_segredo' AND a.attname IN ('hash_rapido', 'hash_rapido_de'))",
  );
  assertStringIncludes(m, "SET LOCAL ikcous.frota_estado_pela_porta = 'sim';");
  assertStringIncludes(m, "SET LOCAL ikcous.frota_estado_pela_porta = '';");
  assert(
    m.indexOf("SET LOCAL ikcous.frota_estado_pela_porta = 'sim';") >
      m.indexOf("END $preflight_copiar_caderneta$;"),
    "a porta liga so depois do pre-voo",
  );
  assertStringIncludes(sql, "OVERRIDING SYSTEM VALUE");
  assertStringIncludes(
    m,
    "setval(pg_get_serial_sequence('public.frota_estado_historico', 'id'),",
  );
  // Valores sempre como literal citado (nunca colados crus no texto).
  assertStringIncludes(sql, "format('%L', l.j ->> n.nome)");
  // Ordem das linhas que nao depende da colacao do banco.
  assertStringIncludes(sql, 'COLLATE "C"');
});

Deno.test("gerador: os enderecos que encaminham viajam inteiros, depois das lojas (a chave estrangeira e o gatilho olham frota_lojas)", () => {
  const sql = LER(GERADOR);
  const c = semComentarios(sql);
  // As quatro tabelas na lista das colunas, na das linhas e na das formas.
  for (const t of TABELAS) {
    assertStringIncludes(
      c,
      `FROM public.${t} `,
      `${t}: linhas lidas na origem`,
    );
    assertStringIncludes(c, `('${t}')`, `${t}: colunas e forma`);
  }
  // A ordem das insercoes no texto gerado: segredo, lojas, historico, e os enderecos por ultimo.
  const ordem = TABELAS.map((t) =>
    sql.indexOf(`(SELECT i.sql FROM insercoes i WHERE i.tabela = '${t}')`),
  );
  assert(
    ordem.every((i) => i > 0),
    `as quatro insercoes: ${ordem}`,
  );
  const [lojas, segredo, historico, enderecos] = ordem;
  assert(
    segredo < lojas && lojas < historico && historico < enderecos,
    "segredo, lojas, historico, enderecos",
  );
  // Nenhuma coluna dos enderecos fica de fora (quem e criado_em viajam com o valor da origem, nunca com o padrao do destino).
  assert(
    !/v\.tabela = 'frota_enderecos_que_encaminham' AND/.test(c),
    "nenhuma coluna dos enderecos e' filtrada",
  );
});

// A origem (o banco antigo da caderneta) pode não ter a 20261570: tabela ausente = zero endereços. A tabela dos endereços só se
// lê pela CTE dinâmica (um FROM direto falha ao planejar, mesmo sem linha); o destino continua exigindo a tabela e as portas.
const LEITURA_DINAMICA = norm(`enderecos_da_origem AS (
  SELECT x.j::jsonb AS j
    FROM XMLTABLE('/table/row' PASSING
           CASE WHEN to_regclass('public.frota_enderecos_que_encaminham') IS NULL THEN '<table/>'::xml
                ELSE query_to_xml('SELECT to_jsonb(fe)::text AS j FROM public.frota_enderecos_que_encaminham fe', false, false, '') END
           COLUMNS j text PATH 'j') x
)`);
Deno.test("origem sem a 20261570: gerador e digital leem os enderecos SO pela leitura dinamica (tabela ausente = zero enderecos)", () => {
  for (const arq of [DIGITAL, GERADOR]) {
    const sql = LER(arq);
    const s = semComentarios(sql);
    assertStringIncludes(s, LEITURA_DINAMICA, `${arq}: a leitura dinamica`);
    assertStringIncludes(
      s,
      "SELECT 'frota_enderecos_que_encaminham', e.j ->> 'host', e.j FROM enderecos_da_origem e",
      `${arq}: as linhas dos enderecos vem da leitura dinamica`,
    );
    // Fora da leitura dinamica (e do molde que roda no destino), nenhuma referencia direta a tabela dos enderecos.
    const origem = sql
      .replace(/\$m\$[\s\S]*?\$m\$/g, " ")
      .replace(/--.*$/gm, " ")
      .replace(/'[^']*'/g, "''");
    assertEquals(
      origem.match(/public\.frota_enderecos_que_encaminham\b/g),
      null,
      `${arq}: a origem nao cita a tabela dos enderecos fora de literal`,
    );
  }
  const sql = LER(GERADOR);
  assertStringIncludes(
    semComentarios(sql),
    "(SELECT count(*) FROM enderecos_da_origem) AS n_enderecos",
  );
  assertStringIncludes(
    semComentarios(sql),
    "to_regclass('public.frota_enderecos_que_encaminham') IS NOT NULL AS tem_enderecos",
  );
  // No destino: a forma dos enderecos so deixa de ser comparada quando a ORIGEM nao tinha a tabela.
  const m = molde(sql);
  assertStringIncludes(
    m,
    "CONTINUE WHEN v_tabela = 'frota_enderecos_que_encaminham' AND NOT v_origem_tem_enderecos;",
  );
  assertStringIncludes(
    sql,
    "|| '  v_origem_tem_enderecos boolean := ' || m.tem_enderecos || E';\\n'",
  );
});

Deno.test("gerador: o pre-voo do destino recusa origem vazia, forma diferente, portas fora da 20261490 e destino com linha; o pos-voo confere", async () => {
  const m = molde(LER(GERADOR));
  const ini = m.indexOf("DO $preflight_copiar_caderneta$");
  const fim = m.indexOf("END $preflight_copiar_caderneta$;");
  assert(ini >= 0 && fim > ini, "pre-voo presente");
  const pre = m.slice(ini, fim);
  for (const codigoDeRecusa of [
    "COPIA_ORIGEM_VAZIA",
    "COPIA_ORIGEM_DIVERGENTE",
    "COPIA_DESTINO_SEM_CADERNETA",
    "COPIA_FORMA_DIVERGENTE",
    "COPIA_PORTAS_DIVERGENTES",
    "COPIA_GATILHO_AUSENTE",
    "COPIA_DESTINO_NAO_VAZIO",
  ])
    assertStringIncludes(pre, `RAISE EXCEPTION '${codigoDeRecusa}`);
  // O destino vazio e' a ultima trava (as outras dizem o que falta antes de olhar linha).
  assert(
    pre.lastIndexOf("RAISE EXCEPTION 'COPIA_DESTINO_NAO_VAZIO") >
      pre.lastIndexOf("RAISE EXCEPTION 'COPIA_GATILHO_AUSENTE"),
  );
  // A trava de escrita vem antes de olhar se o destino esta vazio (duas copias ao mesmo tempo: a segunda espera e recusa).
  const LOCK =
    "LOCK TABLE public.frota_lojas, public.frota_segredo, public.frota_estado_historico, public.frota_enderecos_que_encaminham IN SHARE ROW EXCLUSIVE MODE;";
  assertStringIncludes(pre, LOCK);
  assert(
    pre.indexOf(LOCK) < pre.indexOf("RAISE EXCEPTION 'COPIA_DESTINO_NAO_VAZIO"),
  );
  // As quatro tabelas: a que falta recusa com COPIA_DESTINO_SEM_CADERNETA; a que tem linha, com COPIA_DESTINO_NAO_VAZIO; a forma
  // de cada uma e' conferida; e os dois gatilhos (o do estado e o dos enderecos) precisam estar ligados.
  for (const t of TABELAS) {
    assertStringIncludes(
      pre,
      `to_regclass('public.${t}') IS NULL`,
      `${t}: falta recusa`,
    );
    assertStringIncludes(
      pre,
      `EXISTS (SELECT 1 FROM public.${t})`,
      `${t}: com linha recusa`,
    );
  }
  assertStringIncludes(
    pre,
    "('frota_enderecos_que_encaminham', v_forma_enderecos)",
  );
  assertStringIncludes(
    pre,
    "t.tgname = 'frota_enderecos_que_encaminham_nao_e_principal' AND NOT t.tgisinternal",
  );
  // Os md5 das portas sao os dos ARQUIVOS das migrations (20261490 para as duas portas do porteiro, 20261470 para as outras).
  const m1490 = LER(
    "supabase/migrations/20261490000000_a_caderneta_confere_a_chave_sem_bcrypt_por_chamada.sql",
  );
  const m1470 = LER(
    "supabase/migrations/20261470000000_a_loja_muda_de_estado_so_pela_porta.sql",
  );
  const m1570 = LER(
    "supabase/migrations/20261570000000_o_endereco_antigo_encaminha_para_o_novo.sql",
  );
  for (const h of [
    await md5(corpo(m1490, "public.resolver_loja")),
    await md5(corpo(m1490, "public.resolver_loja_com_estado")),
    await md5(corpo(m1470, "public.frota_mudar_estado")),
    await md5(corpo(m1470, "public.frota_lojas_estado_so_pela_porta")),
    await md5(
      corpo(m1570, "public.frota_enderecos_que_encaminham_nao_e_principal"),
    ),
    await md5(corpo(m1570, "public.resolver_encaminhamento")),
    await md5(corpo(m1570, "public.frota_trocar_dominio")),
  ])
    assertStringIncludes(pre, `'${h}'`);
  const pos = m.slice(m.indexOf("DO $posvoo_copiar_caderneta$"));
  assertStringIncludes(pos, "RAISE EXCEPTION 'POSVOO_COPIAR_CADERNETA");
  assertStringIncludes(pos, "hash_rapido IS NOT NULL");
  assertStringIncludes(pos, "pg_sequences");
  assertStringIncludes(
    pos,
    "(SELECT count(*) FROM public.frota_enderecos_que_encaminham) <> v_enderecos",
  );
});

// ---------------------------------------------------------------------------------------------------------------------------
// T3/T4: os três rollbacks que apagam a caderneta têm a MESMA trava (um texto só, para a revisão ler uma vez)
// ---------------------------------------------------------------------------------------------------------------------------
Deno.test("rollbacks que apagam a caderneta: o MESMO bloco CADERNETA_SEMEADA, byte a byte, nos tres arquivos", () => {
  const arquivos = [
    "rollback-manual-20261141000000_caderneta_da_frota.sql",
    "rollback-manual-destrutivo-20261460000000_a_loja_tem_estado_de_vida.sql",
    "rollback-manual-destrutivo-20261470000000_a_loja_muda_de_estado_so_pela_porta.sql",
  ];
  const blocos = arquivos.map((a) => {
    const sql = LER(`supabase/migrations/${a}`);
    const ini = sql.indexOf("DO $caderneta_semeada$");
    const fim = sql.indexOf("END $caderneta_semeada$;");
    assert(ini >= 0 && fim > ini, `${a}: bloco presente`);
    assertEquals(
      sql.split("DO $caderneta_semeada$").length,
      2,
      `${a}: um bloco so`,
    );
    return sql.slice(ini, fim);
  });
  assertEquals(blocos[1], blocos[0], arquivos[1]);
  assertEquals(blocos[2], blocos[0], arquivos[2]);
});

// ---------------------------------------------------------------------------------------------------------------------------
// T5: a prova viva roda no rpc-ci, e mexer nos dois scripts dispara o job (check ausente tem cara de check verde)
// ---------------------------------------------------------------------------------------------------------------------------
Deno.test("rpc-ci: passo da prova viva, junto das provas da caderneta, e os dois scripts nos caminhos do pull_request e do push", () => {
  const rpc = LER(".github/workflows/rpc-ci.yml");
  const passo =
    "run: node tests/banco/rodar-isolado.cjs tests/banco/a-caderneta-muda-de-banco-viva.cjs";
  assertEquals(rpc.split(passo).length, 2, "o passo aparece UMA vez");
  assert(
    rpc.indexOf(passo) >
      rpc.indexOf(
        "run: node tests/banco/rodar-isolado.cjs tests/banco/a-caderneta-confere-a-chave-sem-bcrypt-viva.cjs",
      ),
    "depois das provas da caderneta",
  );
  const iPush = rpc.indexOf("\n  push:");
  assert(iPush > 0);
  for (const arq of [DIGITAL, GERADOR]) {
    const linha = `      - "${arq}"`;
    assert(rpc.slice(0, iPush).includes(linha), `pull_request.paths: ${arq}`);
    assert(rpc.slice(iPush).includes(linha), `push.paths: ${arq}`);
  }
});
