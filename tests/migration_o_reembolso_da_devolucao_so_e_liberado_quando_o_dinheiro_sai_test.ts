// @ts-nocheck
// O REEMBOLSO DA DEVOLUCAO SO E "LIBERADO" QUANDO O DINHEIRO SAI — prova offline do par 20261225000000 + rollback
// (dinheiro; decisao do dono de 14/10/2026). O COMPORTAMENTO (aviso por estado real do reembolso, "liberado" uma
// vez so mesmo com duas conexoes, aviso que falha nao desfaz o dinheiro, auxiliar fechada, rollback com o mesmo md5,
// pre-voo, conferencia, mutantes) e' provado em tests/banco/reembolso-da-devolucao-viva.cjs e o portao da release
// em tests/banco/reembolso-da-devolucao-portao-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: o aviso da conclusao nao pode voltar a prometer "liberado" antes do dinheiro sair; os OUTROS ramos do
// gatilho (aprovada, recusada, recebida, reprovada, troca, vale) nao podem mudar; os avisos sao best-effort (um
// aviso que falha nunca desfaz o dinheiro, porque o gatilho novo roda DENTRO de concluir_estorno); NENHUMA das
// tres funcoes pode travar linha (a ordem global de travas e devolucao -> linhas -> pedido -> linha, e o gatilho
// roda segurando linha e pedido: um FOR UPDATE em `devolucoes` ali inverteria a ordem); o rollback devolve o corpo
// antigo byte a byte; ACL explicita; sem BEGIN/COMMIT.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = new URL("../", import.meta.url);
const NOME =
  "20261225000000_o_reembolso_da_devolucao_so_e_liberado_quando_o_dinheiro_sai.sql";
const ANTIGA = "20261175000000_a_devolucao_nasce_no_pedido.sql";
const ler = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR)).replace(
    /\r\n/g,
    "\n",
  );
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const migrationAntiga = ler(ANTIGA);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

const corpoDaTag = (sql, tag) => {
  const a = sql.indexOf(`AS $${tag}$`) + `AS $${tag}$`.length;
  return sql.slice(a, sql.indexOf(`$${tag}$;`, a));
};
const CORPO_ANTIGO = (() => {
  const i = migrationAntiga.indexOf(
    "CREATE OR REPLACE FUNCTION public.devolucao_avisa_o_cliente()",
  );
  const a = migrationAntiga.indexOf("AS $$", i) + "AS $$".length;
  return migrationAntiga.slice(a, migrationAntiga.indexOf("$$;", a));
})();
const CORPO_AVISA = corpoDaTag(migration, "avisa_o_cliente");
const CORPO_AVISAR = corpoDaTag(migration, "avisar_reembolso");
const CORPO_LIBERADO = corpoDaTag(migration, "avisa_liberado");
const H_ANTIGO = "0bf0bf168c1c0db817220329c47b64ef";
const H_AVISA = md5(CORPO_AVISA);
const H_AVISAR = md5(CORPO_AVISAR);
const H_LIBERADO = md5(CORPO_LIBERADO);

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assert.equal(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
});

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior (regra da casa: o aplicador abre a transacao)", () => {
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(migration)).achados,
    [],
  );
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(rollback)).achados,
    [],
  );
});

Deno.test("o corpo antigo e' o da 20261175000000 (md5 conhecido); os tres corpos novos tem md5 conhecido e diferente; o rollback recria o antigo BYTE A BYTE e declara os mesmos hashes que o pre-voo e a conferencia", () => {
  assert.equal(md5(CORPO_ANTIGO), H_ANTIGO);
  assert.equal(new Set([H_ANTIGO, H_AVISA, H_AVISAR, H_LIBERADO]).size, 4);
  assert.equal(corpoDaTag(rollback, "rollback_avisa"), CORPO_ANTIGO);
  assert.equal(md5(corpoDaTag(rollback, "rollback_avisa")), H_ANTIGO);
  for (const h of [H_ANTIGO, H_AVISA, H_AVISAR, H_LIBERADO]) {
    assert.ok(rollback.includes(`'${h}'`), `rollback cita ${h}`);
  }
  // pre-voo e conferencia da migration declaram os hashes novos e o antigo
  const iPre = migration.indexOf("DO $preflight_20261225$");
  const fimPre = migration.indexOf("END $preflight_20261225$;");
  const iConf = migration.indexOf("DO $conferencia_20261225$");
  assert.ok(iPre >= 0 && fimPre > iPre && iConf > fimPre);
  const pre = migration.slice(iPre, fimPre);
  const conf = migration.slice(iConf);
  assert.ok(pre.includes(`'${H_ANTIGO}'`));
  for (const h of [H_AVISA, H_AVISAR, H_LIBERADO]) {
    assert.ok(conf.includes(`'${h}'`), `conferencia cita ${h}`);
    assert.ok(pre.includes(`'${h}'`), `pre-voo cita ${h}`);
  }
  assert.ok(pre.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
  assert.ok(conf.includes("RAISE EXCEPTION 'conferencia 20261225:"));
  // o pre-voo vem ANTES de qualquer CREATE; a conferencia, depois de todos
  const primeiroCreate = migration.indexOf("\nCREATE OR REPLACE FUNCTION");
  assert.ok(
    fimPre < primeiroCreate &&
      migration.lastIndexOf("\nCREATE TRIGGER") < iConf,
  );
});

Deno.test("o corpo novo do gatilho de aviso mantem TODOS os outros ramos do antigo e so troca o ramo do reembolso: nunca promete 'liberado' fora do estado 'concluido'", () => {
  for (const trecho of [
    "v_titulo := 'Devolução aprovada';",
    "A loja aprovou a devolução ' || NEW.protocolo || '. Veja as instruções no pedido.",
    "v_titulo := 'Devolução não aprovada';",
    "A loja respondeu a devolução ' || NEW.protocolo || '. Veja o motivo no pedido.",
    "v_titulo := 'Produto recebido pela loja';",
    "A loja recebeu o produto da devolução ' || NEW.protocolo || '.",
    "v_titulo := 'Produto não aceito na inspeção';",
    "Veja no pedido o retorno da loja sobre a devolução ' || NEW.protocolo || '.",
    "A troca da devolução ' || NEW.protocolo || ' foi confirmada.",
    "O vale-troca da devolução ' || NEW.protocolo || ' foi emitido.",
    "v_titulo := 'Devolução concluída';",
    "IF OLD.status IS NOT DISTINCT FROM NEW.status THEN",
  ]) {
    assert.ok(CORPO_ANTIGO.includes(trecho), `antigo: ${trecho}`);
    assert.ok(CORPO_AVISA.includes(trecho), `novo: ${trecho}`);
  }
  // o antigo prometia liberado na conclusao (o defeito); o novo so no estado 'concluido'
  assert.ok(CORPO_ANTIGO.includes("foi liberado"));
  const ocorrencias =
    CORPO_AVISA.split("foi liberado pelo Mercado Pago").length - 1;
  assert.equal(ocorrencias, 1, "uma unica frase de 'foi liberado'");
  const iConcluido = CORPO_AVISA.indexOf("WHEN 'concluido' THEN");
  const iLiberado = CORPO_AVISA.indexOf("foi liberado pelo Mercado Pago");
  const iProximo = CORPO_AVISA.indexOf(
    "WHEN 'solicitado', 'em_processamento' THEN",
  );
  assert.ok(
    iConcluido > 0 && iLiberado > iConcluido && iLiberado < iProximo,
    "so dentro do ramo 'concluido'",
  );
  // os quatro estados do reembolso, cada um com seu evento
  for (const evento of [
    "v_evento := 'reembolso_combinado';",
    "v_evento := 'reembolso_liberado';",
    "v_evento := 'reembolso_em_processamento';",
    "v_evento := 'reembolso_nao_liberado';",
  ])
    assert.equal(CORPO_AVISA.split(evento).length - 1, 1, evento);
  assert.ok(
    CORPO_AVISA.includes(
      "SELECT r.status INTO v_estado FROM public.order_refunds r WHERE r.id = NEW.refund_id;",
    ),
  );
  assert.ok(
    CORPO_AVISA.includes(
      "ELSE\n            v_evento := 'reembolso_nao_liberado';",
    ),
    "sem linha ou status ruim = nao liberado",
  );
  assert.ok(CORPO_AVISA.includes("COALESCE(v_estado, 'sem_linha')"));
});

Deno.test("os avisos sao BEST-EFFORT (EXCEPTION WHEN OTHERS) e NENHUM corpo trava linha: nada de FOR UPDATE, LOCK TABLE, UPDATE ou DELETE (a ordem global devolucao -> linhas -> pedido -> linha nao pode ser invertida pelo gatilho de order_refunds)", () => {
  for (const [rotulo, corpo] of [
    ["avisa_o_cliente", CORPO_AVISA],
    ["avisar_reembolso", CORPO_AVISAR],
    ["avisa_liberado", CORPO_LIBERADO],
  ]) {
    const c = limpo(corpo);
    assert.doesNotMatch(
      c,
      /\bFOR\s+(UPDATE|SHARE|NO KEY UPDATE)\b/i,
      `${rotulo}: trava de linha`,
    );
    assert.doesNotMatch(c, /\bLOCK\s+TABLE\b/i, rotulo);
    assert.doesNotMatch(
      c,
      /\b(UPDATE|DELETE|TRUNCATE)\b/i,
      `${rotulo}: escreve alem do aviso`,
    );
    assert.doesNotMatch(c, /\b(GRANT|REVOKE|ALTER|DROP|CREATE)\b/i, rotulo);
  }
  // so a auxiliar e o gatilho do reembolso tem o bloco que engole o erro; o do aviso generico ja o tinha
  assert.ok(CORPO_AVISAR.includes("EXCEPTION WHEN OTHERS THEN"));
  assert.ok(CORPO_AVISAR.includes("RAISE WARNING"));
  assert.ok(CORPO_LIBERADO.includes("EXCEPTION WHEN OTHERS THEN"));
  assert.ok(CORPO_LIBERADO.includes("RAISE WARNING"));
  assert.ok(CORPO_AVISA.includes("EXCEPTION WHEN OTHERS THEN"));
  // a deduplicacao: trava consultiva por (devolucao, evento) + conferencia em notificacoes, antes do INSERT
  const iLock = CORPO_AVISAR.indexOf("pg_advisory_xact_lock(");
  const iExiste = CORPO_AVISAR.indexOf("n.dados ->> 'evento' = p_evento");
  const iInsert = CORPO_AVISAR.indexOf("INSERT INTO public.notificacoes");
  assert.ok(iLock > 0 && iLock < iExiste && iExiste < iInsert);
});

Deno.test("o gatilho de order_refunds dispara so na virada para 'concluido' (WHEN no CREATE TRIGGER e guarda no corpo) e avisa so devolucao concluida, com reembolso, nao manual", () => {
  const i = migration.indexOf(
    "CREATE TRIGGER tr_order_refunds_avisa_reembolso_liberado",
  );
  assert.ok(i > 0);
  const trg = migration.slice(i, migration.indexOf(";", i));
  assert.ok(trg.includes("AFTER UPDATE OF status ON public.order_refunds"));
  assert.ok(trg.includes("FOR EACH ROW"));
  assert.ok(
    trg.includes(
      "WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'concluido')",
    ),
  );
  assert.ok(
    trg.includes(
      "EXECUTE FUNCTION public.devolucao_avisa_reembolso_liberado()",
    ),
  );
  assert.ok(
    CORPO_LIBERADO.includes(
      "IF NEW.status IS DISTINCT FROM 'concluido' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN",
    ),
  );
  for (const filtro of [
    "d.refund_id = NEW.id",
    "d.status = 'concluida'",
    "d.resolucao_final = 'reembolso'",
    "NOT d.reembolso_manual",
  ])
    assert.ok(CORPO_LIBERADO.includes(filtro), filtro);
  // so o PROPRIO gatilho e' apagado e recriado
  assert.equal(limpo(migration).split("DROP TRIGGER IF EXISTS").length - 1, 1);
  assert.ok(
    migration.includes(
      "DROP TRIGGER IF EXISTS tr_order_refunds_avisa_reembolso_liberado ON public.order_refunds;",
    ),
  );
});

Deno.test("ACL explicita e so objetos desta migration: a auxiliar fechada a TODOS (nem service_role), a funcao de gatilho fechada a PUBLIC/anon/authenticated; nenhum GRANT; nada de tabela, coluna, policy ou dado fora dos corpos", () => {
  assert.ok(
    migration.includes(
      "REVOKE ALL ON FUNCTION public.devolucao__avisar_reembolso(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;",
    ),
  );
  assert.ok(
    migration.includes(
      "REVOKE ALL ON FUNCTION public.devolucao_avisa_reembolso_liberado() FROM PUBLIC, anon, authenticated;",
    ),
  );
  const fora = limpo(
    migration
      .replace(CORPO_AVISA, "")
      .replace(CORPO_AVISAR, "")
      .replace(CORPO_LIBERADO, "")
      .replace(
        /DO \$preflight_20261225\$[\s\S]*?END \$preflight_20261225\$;/,
        "",
      )
      .replace(
        /DO \$conferencia_20261225\$[\s\S]*?END \$conferencia_20261225\$;/,
        "",
      ),
  );
  assert.doesNotMatch(fora, /\bGRANT\b/i);
  assert.doesNotMatch(
    fora.replace(/AFTER UPDATE OF/g, ""),
    /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
  );
  assert.doesNotMatch(fora, /\bALTER\s+(TABLE|POLICY)\b/i);
  assert.doesNotMatch(
    fora,
    /\bCREATE\s+(TABLE|POLICY|INDEX|SEQUENCE|TYPE|VIEW)\b/i,
  );
  assert.doesNotMatch(
    fora,
    /\bDROP\s+(TABLE|COLUMN|POLICY|FUNCTION|VIEW|INDEX)\b/i,
  );
  // tres CREATE OR REPLACE FUNCTION, todos SECURITY DEFINER com search_path=public
  const criacoes = migration.split("\nCREATE OR REPLACE FUNCTION").length - 1;
  assert.equal(criacoes, 3);
  assert.equal(
    migration.split("SECURITY DEFINER\nSET search_path = public").length - 1,
    3,
  );
  assert.doesNotMatch(migration, /RAISE\s+(NOTICE|INFO|LOG|DEBUG)/i);
  // o rollback: so o corpo antigo, as drops dos objetos novos e a conferencia; nenhum GRANT/REVOKE
  const foraRb = limpo(
    rollback.replace(corpoDaTag(rollback, "rollback_avisa"), ""),
  );
  assert.doesNotMatch(
    foraRb,
    /\b(GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
  );
  assert.doesNotMatch(foraRb, /\bDROP\s+(TABLE|COLUMN|POLICY|VIEW|INDEX)\b/i);
  for (const drop of [
    "DROP TRIGGER IF EXISTS tr_order_refunds_avisa_reembolso_liberado ON public.order_refunds;",
    "DROP FUNCTION IF EXISTS public.devolucao_avisa_reembolso_liberado();",
    "DROP FUNCTION IF EXISTS public.devolucao__avisar_reembolso(uuid, text, text, text, text);",
  ])
    assert.ok(rollback.includes(drop), drop);
  // o gatilho de order_refunds cai ANTES da funcao que ele chama; a de devolucoes volta ANTES de a auxiliar cair
  assert.ok(
    rollback.indexOf("DROP TRIGGER IF EXISTS tr_order_refunds") <
      rollback.indexOf(
        "DROP FUNCTION IF EXISTS public.devolucao_avisa_reembolso_liberado",
      ),
  );
  assert.ok(
    rollback.indexOf("AS $rollback_avisa$") <
      rollback.indexOf(
        "DROP FUNCTION IF EXISTS public.devolucao__avisar_reembolso",
      ),
  );
});

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261225000000 (sem ela a migration sai PULADA, codigo 2), uma por funcao, todas com contagem exata 1, e os marcadores existem UMA vez nos corpos", () => {
  const src = Deno.readTextFileSync(
    new URL("scripts/db-apply.cjs", DIR),
  ).replace(/\r\n/g, "\n");
  // o Biome quebra a chave longa em duas linhas (`"nome.sql":\n    [`): aceita as duas formas
  const inicio = new RegExp(`"${NOME}":\\s*\\[`).exec(src);
  assert.ok(inicio, "sem entrada em VERIFICACOES");
  const i = inicio.index;
  const fim = src.slice(i).search(/\n {2,4}\],\n {2}(?:"|\/\/)/);
  assert.ok(fim > 0, "nao achei o fim da entrada");
  const entrada = src.slice(i, i + fim);
  for (const funcao of [
    "devolucao_avisa_o_cliente",
    "devolucao__avisar_reembolso",
    "devolucao_avisa_reembolso_liberado",
  ])
    assert.ok(entrada.includes(`funcao: "${funcao}"`), funcao);
  assert.ok(!/vezes:\s*[02-9]/.test(entrada), "todas as contagens sao 1");
  const marcadores = [...entrada.matchAll(/texto:\s*"((?:[^"\\]|\\.)*)"/g)].map(
    (m) => m[1],
  );
  const quebrados = [
    ...entrada.matchAll(/texto:\s*\n\s*"((?:[^"\\]|\\.)*)"/g),
  ].map((m) => m[1]);
  const todos = [...new Set([...marcadores, ...quebrados])];
  assert.equal(todos.length, 8, `8 marcadores, achei ${todos.length}`);
  const corpos = [CORPO_AVISA, CORPO_AVISAR, CORPO_LIBERADO].join("\n");
  for (const m of todos)
    assert.equal(
      corpos.split(m).length - 1,
      1,
      `marcador fora do corpo ou repetido: ${m}`,
    );
});

Deno.test("a lista L8 de portas do visitante NAO muda: as funcoes novas nascem fechadas (nenhuma executavel por anon, authenticated ou PUBLIC)", () => {
  const lista = Deno.readTextFileSync(
    new URL("tests/banco/portas-do-visitante-permitidas.json", DIR),
  );
  for (const f of [
    "devolucao__avisar_reembolso",
    "devolucao_avisa_reembolso_liberado",
    "devolucao_avisa_o_cliente",
  ])
    assert.ok(
      !lista.includes(f),
      `${f} nao pode estar na lista de portas abertas`,
    );
});

// A SUCESSORA conhecida: a 20261241000000 (o reembolso em duvida prende o saldo) troca o texto do aviso da
// devolucao em processamento; o rollback dela devolve o corpo DESTA migration byte a byte.
const SUCESSORA = "20261241000000_o_reembolso_em_duvida_prende_o_saldo.sql";
Deno.test("so a 20261175000000, esta migration e a sucessora 20261241000000 (e seus rollbacks) definem devolucao_avisa_o_cliente", () => {
  const todas = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("_"));
  const definem = [];
  for (const n of todas)
    if (
      /create (?:or replace )?function public\.devolucao_avisa_o_cliente\b/.test(
        limpo(ler(n)).toLowerCase(),
      )
    )
      definem.push(n);
  assert.deepEqual(
    definem.sort(),
    [
      ANTIGA,
      NOME,
      `rollback-manual-${NOME}`,
      SUCESSORA,
      `rollback-manual-${SUCESSORA}`,
    ].sort(),
  );
  // e o rollback da sucessora devolve o corpo DESTA (o mesmo md5 que a conferencia daqui declara)
  const daSucessora = ler(`rollback-manual-${SUCESSORA}`);
  const a =
    daSucessora.indexOf("AS $avisa_o_cliente$") + "AS $avisa_o_cliente$".length;
  const corpoDevolvido = daSucessora.slice(
    a,
    daSucessora.indexOf("$avisa_o_cliente$;", a),
  );
  assert.equal(md5(corpoDevolvido), "2cd21f47021cafc15cae4ccd0c8c67e5");
  assert.ok(
    migration.includes("'2cd21f47021cafc15cae4ccd0c8c67e5'"),
    "o md5 desta migration",
  );
});
