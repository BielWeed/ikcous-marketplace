// @ts-nocheck
// CANCELAR_DEVOLUCAO BARRA A COMPRA EM VOO — prova offline do par
// 20261179000000 + rollback (achado A1 da revisão de risco pré-publicação de
// 26/09/2026 sobre a etiqueta reversa do Melhor Envio). A prova VIVA (RPC de
// verdade no Postgres efêmero) mora em tests/banco/devolucoes-viva.cjs; aqui
// fica o que se prova só lendo o texto.
//
// Cada asserção está amarrada a um risco: sem o guard novo, o cliente cancela
// enquanto a etiqueta reversa está sendo comprada e a loja paga por uma
// devolução que não existe mais; sem o evento extra, uma etiqueta já paga
// fica órfã sem ninguém saber; rollback infiel devolveria um corpo diferente
// do que a 20261175000000 (já aprovada) publicou.
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME = "20261179000000_cancelar_devolucao_barra_compra_em_voo.sql";
const NOME_BASE = "20261175000000_a_devolucao_nasce_no_pedido.sql";

const migration = Deno.readTextFileSync(`${DIR}../supabase/migrations/${NOME}`);
const rollback = Deno.readTextFileSync(
  `${DIR}../supabase/migrations/rollback-manual-${NOME}`,
);
const migrationBase = Deno.readTextFileSync(
  `${DIR}../supabase/migrations/${NOME_BASE}`,
);

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const m = norm(migration);
const r = norm(rollback);

/** O bloco `CREATE OR REPLACE FUNCTION public.cancelar_devolucao(...) ... $$;`
 * inteiro, de um texto de migration já normalizado por `norm`. */
function extrairCancelarDevolucao(sqlNormalizado: string): string {
  const ini = sqlNormalizado.indexOf(
    "CREATE OR REPLACE FUNCTION public.cancelar_devolucao(p_id uuid)",
  );
  assert(ini >= 0, "cancelar_devolucao não encontrada no texto");
  const fim = sqlNormalizado.indexOf("$$;", ini);
  assert(fim >= 0, "fim do corpo ($$;) não encontrado");
  return sqlNormalizado.slice(ini, fim + 3);
}

Deno.test("avaliarFase0 não recusa o par migration+rollback", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
});

Deno.test("nenhum arquivo do par abre ou fecha transação de nível superior", () => {
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
});

Deno.test("cancelar_devolucao continua SECURITY DEFINER com search_path fixo, mesma assinatura da 20261175000000", () => {
  const ini = m.indexOf(
    "CREATE OR REPLACE FUNCTION public.cancelar_devolucao(p_id uuid)",
  );
  assert(ini >= 0);
  const cabecalho = m.slice(ini, m.indexOf("AS $$", ini));
  assertStringIncludes(cabecalho, "SECURITY DEFINER");
  assertStringIncludes(cabecalho, "SET search_path = public");
});

Deno.test("guard novo (achado R1, rodada 2): só barra com id REAL (NOT LIKE 'reservando:%'), nunca na fase de reserva", () => {
  assertStringIncludes(
    m,
    "IF v_d.me_reverse_id IS NOT NULL AND v_d.me_reverse_id NOT LIKE 'reservando:%' AND v_d.codigo_postagem IS NULL THEN",
  );
  // Sem promessa de prazo (achado R1: "aguarde instantes" prendia o cliente
  // por dias quando o vínculo nunca se resolvia sozinho — Sandbox do Melhor
  // Envio, edge que morreu, liberação que falhou). A frase manda falar com a
  // loja, que tem a RPC de liberar (teste abaixo).
  assertStringIncludes(
    m,
    "A loja está gerando o código de postagem desta devolução. Se precisar cancelar, fale com a loja.",
  );
  assert(
    !m.includes("aguarde alguns instantes e tente cancelar de novo"),
    "a frase da rodada 1 prometia prazo — não pode sobreviver",
  );
  assertStringIncludes(
    norm(
      m.slice(
        m.indexOf(
          "IF v_d.me_reverse_id IS NOT NULL AND v_d.me_reverse_id NOT LIKE",
        ),
        m.indexOf(
          "IF v_d.me_reverse_id IS NOT NULL AND v_d.me_reverse_id NOT LIKE",
        ) + 400,
      ),
    ),
    "USING ERRCODE = '22023';",
  );
});

Deno.test("guard preservado: os dois guards originais (dono e status) continuam intactos, na mesma ordem", () => {
  const ini = m.indexOf(
    "CREATE OR REPLACE FUNCTION public.cancelar_devolucao(p_id uuid)",
  );
  const corpo = m.slice(ini, m.indexOf("$$;", ini));
  const posDono = corpo.indexOf("v_d.user_id IS DISTINCT FROM auth.uid()");
  const posStatus = corpo.indexOf(
    "v_d.status NOT IN ('solicitada', 'aprovada')",
  );
  const posEmVoo = corpo.indexOf(
    "v_d.me_reverse_id IS NOT NULL AND v_d.me_reverse_id NOT LIKE 'reservando:%'",
  );
  assert(posDono >= 0 && posStatus >= 0 && posEmVoo >= 0);
  assert(
    posDono < posStatus && posStatus < posEmVoo,
    "a ordem dos guards mudou: dono -> status -> compra em voo",
  );
});

Deno.test("evento ao lojista: código já emitido grava um evento PRÓPRIO (ator sistema) com texto NEUTRO (achado R2 — o cliente também pode ler)", () => {
  assertStringIncludes(m, "IF v_d.codigo_postagem IS NOT NULL THEN");
  assertStringIncludes(m, "p_id, 'cancelada', 'cancelada', 'sistema',");
  // Achado N3: COALESCE — sem ele, me_reverse_id NULL faria a nota inteira
  // virar NULL (concatenação `||` com NULL em Postgres).
  assertStringIncludes(
    m,
    "(envio reverso ' || COALESCE(v_d.me_reverse_id, 'sem id registrado') ||",
  );
  assertStringIncludes(m, "Melhor Envio");
  // Achado R2: nada de imperativo dirigido a alguém ("cancele você") — o
  // texto só CONSTATA o fato, porque o dono da devolução também pode lê-lo.
  assert(
    !m.includes("Cancele esse envio reverso no Melhor Envio."),
    "a frase imperativa da rodada 1 endereçava a loja — não pode sobreviver num texto que o cliente também lê",
  );
  assertStringIncludes(
    m,
    "Convém conferir se esse envio também precisa ser cancelado por lá.",
  );
  // O evento do CLIENTE (o que a 20261175000000 já gravava) continua
  // separado, sem o texto do Melhor Envio dentro da nota dele.
  assertStringIncludes(
    m,
    "PERFORM public.devolucao__registrar_evento(p_id, v_d.status, 'cancelada', 'cliente', NULL);",
  );
});

Deno.test("RPC nova (achado R1): admin_devolucao_liberar_vinculo_reverso — admin, trava a linha, recusa sem vínculo ou com código já emitido, texto neutro", () => {
  const ini = m.indexOf(
    "CREATE OR REPLACE FUNCTION public.admin_devolucao_liberar_vinculo_reverso(p_id uuid, p_conferi_no_melhor_envio boolean DEFAULT false)",
  );
  assert(ini >= 0, "admin_devolucao_liberar_vinculo_reverso não encontrada");
  const fim = m.indexOf("$$;", ini);
  const corpo = m.slice(ini, fim + 3);
  const cabecalho = m.slice(ini, m.indexOf("AS $$", ini));
  assertStringIncludes(cabecalho, "SECURITY DEFINER");
  assertStringIncludes(cabecalho, "SET search_path = public");
  // Achado 3 (rodada 4): auth.uid() IS NOT NULL — is_admin() sozinho aceita
  // service_role/postgres sem sessão nenhuma (SET ROLE, sem JWT).
  assertStringIncludes(
    corpo,
    "IF NOT public.is_admin() OR auth.uid() IS NULL THEN",
  );
  assertStringIncludes(corpo, "FOR UPDATE;");
  assertStringIncludes(corpo, "IF v_d.me_reverse_id IS NULL THEN");
  assertStringIncludes(corpo, "IF v_d.codigo_postagem IS NOT NULL THEN");
  assertStringIncludes(
    corpo,
    "UPDATE public.devolucoes SET me_reverse_id = NULL WHERE id = p_id;",
  );
  assertStringIncludes(corpo, "p_id, v_d.status, v_d.status, 'sistema',");
  assertStringIncludes(
    corpo,
    "Convém conferir se esse envio precisa ser cancelado por lá.",
  );
  assertStringIncludes(
    m,
    "REVOKE ALL ON FUNCTION public.admin_devolucao_liberar_vinculo_reverso(uuid, boolean) FROM PUBLIC, anon;",
  );
  assertStringIncludes(
    m,
    "GRANT EXECUTE ON FUNCTION public.admin_devolucao_liberar_vinculo_reverso(uuid, boolean) TO authenticated;",
  );
});

Deno.test("achado 1 (rodada 4): a assinatura ganha p_conferi_no_melhor_envio (default false), e um DROP limpa o overload de 1 argumento das rodadas 2/3 antes do CREATE OR REPLACE", () => {
  const posDrop1arg = m.indexOf(
    "DROP FUNCTION IF EXISTS public.admin_devolucao_liberar_vinculo_reverso(uuid);",
  );
  const posCreate2arg = m.indexOf(
    "CREATE OR REPLACE FUNCTION public.admin_devolucao_liberar_vinculo_reverso(p_id uuid, p_conferi_no_melhor_envio boolean DEFAULT false)",
  );
  assert(posDrop1arg >= 0, "falta o DROP do overload de 1 argumento");
  assert(posCreate2arg >= 0);
  assert(
    posDrop1arg < posCreate2arg,
    "o DROP do overload antigo tem que vir ANTES do CREATE OR REPLACE de 2 argumentos — senão os dois convivem",
  );
});

Deno.test("achado R5 (rodada 3, dinheiro): a RPC recusa soltar um vínculo com pagamento CONFIRMADO — guard checa o marcador de devolucao_eventos ANTES do UPDATE", () => {
  const ini = m.indexOf(
    "CREATE OR REPLACE FUNCTION public.admin_devolucao_liberar_vinculo_reverso(p_id uuid, p_conferi_no_melhor_envio boolean DEFAULT false)",
  );
  assert(ini >= 0);
  const fim = m.indexOf("$$;", ini);
  const corpo = m.slice(ini, fim + 3);
  // O texto do strpos é o CONTRATO com `notaPagamentoConfirmadoReverso`
  // (index.ts) — mudar um lado sem o outro quebra a proteção em silêncio.
  // Achado 4 (rodada 4): strpos (substring literal), nunca LIKE — ver
  // tests/marcador_pagamento_reverso_contrato_test.ts para a amarração com a
  // edge, e o teste "achado 4" abaixo para o LIKE nunca voltar.
  assertStringIncludes(
    corpo,
    "IF EXISTS (SELECT 1 FROM public.devolucao_eventos WHERE devolucao_id = p_id AND ator = 'sistema' AND strpos(nota, 'confirmou o pagamento do envio reverso ' || v_d.me_reverse_id || ';') > 0) THEN",
  );
  assertStringIncludes(
    corpo,
    "O Melhor Envio já confirmou o pagamento deste envio reverso — aguarde o código de postagem chegar ou cancele o envio direto no Melhor Envio antes de liberar o vínculo aqui.",
  );
  // A ordem importa: o guard do marcador de pago vem ANTES do UPDATE que
  // solta o vínculo — senão a checagem não impede nada.
  const posGuardPago = corpo.indexOf("strpos(nota, 'confirmou o pagamento");
  const posUpdate = corpo.indexOf(
    "UPDATE public.devolucoes SET me_reverse_id = NULL WHERE id = p_id;",
  );
  assert(posGuardPago >= 0 && posUpdate >= 0);
  assert(
    posGuardPago < posUpdate,
    "o guard do marcador de pago tem que vir ANTES do UPDATE que solta o vínculo",
  );
});

Deno.test("achado 4 (rodada 4): a RPC nunca usa LIKE contra a nota — só strpos (F5 do scratchpad: '_'/'%' do próprio id não pode virar curinga)", () => {
  const ini = m.indexOf(
    "CREATE OR REPLACE FUNCTION public.admin_devolucao_liberar_vinculo_reverso(p_id uuid, p_conferi_no_melhor_envio boolean DEFAULT false)",
  );
  const fim = m.indexOf("$$;", ini);
  const corpo = m.slice(ini, fim + 3);
  assert(!/nota\s+LIKE/i.test(corpo), "a RPC voltou a usar LIKE contra a nota");
});

Deno.test("achado 1 (rodada 5, dinheiro — negar por padrão): QUALQUER me_reverse_id REAL exige p_conferi_no_melhor_envio = true, com ou sem marcador indeterminado; o marcador CONFIRMADO nunca aceita esse parâmetro", () => {
  const ini = m.indexOf(
    "CREATE OR REPLACE FUNCTION public.admin_devolucao_liberar_vinculo_reverso(p_id uuid, p_conferi_no_melhor_envio boolean DEFAULT false)",
  );
  const fim = m.indexOf("$$;", ini);
  const corpo = m.slice(ini, fim + 3);
  // Achado 1 (rodada 5): o guard da rodada 4 só recusava quando o marcador
  // INDETERMINADO existia — um vínculo REAL sem NENHUM marcador (achado G5
  // do scratchpad rev79/ataque4.cjs) passava direto. Agora QUALQUER id REAL
  // (a fase de reserva continua isenta) exige o parâmetro, com ou sem
  // marcador nenhum.
  assertStringIncludes(
    corpo,
    "IF v_d.me_reverse_id NOT LIKE 'reservando:%' AND p_conferi_no_melhor_envio IS NOT TRUE THEN",
  );
  // O marcador indeterminado (quando existe) virou só INFORMAÇÃO na
  // mensagem — não decide mais sozinho se a RPC recusa (achado 3, rodada 5:
  // a âncora também mudou de texto, ver
  // tests/marcador_pagamento_reverso_contrato_test.ts).
  assertStringIncludes(
    corpo,
    "strpos(nota, 'Pagamento do envio reverso ' || v_d.me_reverse_id || ' em verificação;')",
  );
  assertStringIncludes(
    corpo,
    "Há registro de pagamento indeterminado para este envio reverso",
  );
  // Sem marcador NENHUM, a mensagem também recusa (é o achado G5 fechado).
  assertStringIncludes(
    corpo,
    "Não há nenhum registro de pagamento para este envio reverso",
  );
  // O guard do marcador CONFIRMADO não cita p_conferi_no_melhor_envio em
  // lugar nenhum — não tem exceção possível.
  const guardConfirmado = corpo.slice(
    corpo.indexOf("strpos(nota, 'confirmou o pagamento"),
    corpo.indexOf("strpos(nota, 'confirmou o pagamento") + 400,
  );
  assert(!guardConfirmado.includes("p_conferi_no_melhor_envio"));
});

Deno.test("achado 1 (rodada 5): o guard 'negar por padrão' vem DEPOIS do guard do marcador CONFIRMADO e ANTES do UPDATE que solta o vínculo", () => {
  const ini = m.indexOf(
    "CREATE OR REPLACE FUNCTION public.admin_devolucao_liberar_vinculo_reverso(p_id uuid, p_conferi_no_melhor_envio boolean DEFAULT false)",
  );
  const fim = m.indexOf("$$;", ini);
  const corpo = m.slice(ini, fim + 3);
  const posConfirmado = corpo.indexOf("strpos(nota, 'confirmou o pagamento");
  const posNegarPorPadrao = corpo.indexOf(
    "IF v_d.me_reverse_id NOT LIKE 'reservando:%' AND p_conferi_no_melhor_envio IS NOT TRUE THEN",
  );
  const posUpdate = corpo.indexOf(
    "UPDATE public.devolucoes SET me_reverse_id = NULL WHERE id = p_id;",
  );
  assert(posConfirmado >= 0 && posNegarPorPadrao >= 0 && posUpdate >= 0);
  assert(
    posConfirmado < posNegarPorPadrao,
    "o guard do marcador confirmado tem que vir ANTES do guard de negar por padrão",
  );
  assert(
    posNegarPorPadrao < posUpdate,
    "o guard de negar por padrão tem que vir ANTES do UPDATE que solta o vínculo",
  );
});

Deno.test("achado 2 (rodada 6a, scratchpad rev79/ataque5.cjs, G8): o guard usa IS NOT TRUE, nunca NOT <parâmetro> — um NULL explícito não pode passar batido", () => {
  const ini = m.indexOf(
    "CREATE OR REPLACE FUNCTION public.admin_devolucao_liberar_vinculo_reverso(p_id uuid, p_conferi_no_melhor_envio boolean DEFAULT false)",
  );
  const fim = m.indexOf("$$;", ini);
  const corpo = m.slice(ini, fim + 3);
  // Achado 2 (rodada 6a): `NOT p_conferi_no_melhor_envio` em SQL é `NULL`
  // quando o parâmetro chega `NULL` explícito (PostgREST aceita
  // `{"p_conferi_no_melhor_envio": null}` no corpo JSON — diferente de OMITIR
  // o parâmetro, que usaria o DEFAULT) — e um `IF` com condição `NULL` nunca
  // entra no corpo, soltando o vínculo do mesmo jeito que o achado G5 que a
  // rodada 5 fechou. `IS NOT TRUE` trata `NULL` igual a `false`: nenhum dos
  // dois libera sem confirmação de verdade.
  assertStringIncludes(corpo, "p_conferi_no_melhor_envio IS NOT TRUE");
  assert(
    !/NOT\s+p_conferi_no_melhor_envio\b/.test(corpo),
    "o padrão vulnerável a NULL (NOT p_conferi_no_melhor_envio) não pode voltar a aparecer",
  );
});

Deno.test("achado N-a (rodada 3): a nota do evento distingue RESERVA (prefixo reservando:) de vínculo REAL — nunca chama uma reserva de 'envio reverso (id reservando:...)'", () => {
  const ini = m.indexOf(
    "CREATE OR REPLACE FUNCTION public.admin_devolucao_liberar_vinculo_reverso(p_id uuid, p_conferi_no_melhor_envio boolean DEFAULT false)",
  );
  const fim = m.indexOf("$$;", ini);
  const corpo = m.slice(ini, fim + 3);
  assertStringIncludes(
    corpo,
    "WHEN v_d.me_reverse_id LIKE 'reservando:%' THEN",
  );
  assertStringIncludes(
    corpo,
    "Uma reserva em andamento desta devolução com o Melhor Envio foi liberada manualmente pela loja.",
  );
  // O ramo do vínculo REAL continua com o texto da rodada 2, citando o id.
  assertStringIncludes(
    corpo,
    "'O vínculo desta devolução com um envio reverso no Melhor Envio (id ' || v_d.me_reverse_id || ') foi liberado manualmente pela loja.",
  );
});

Deno.test("o rollback restaura o corpo de cancelar_devolucao da 20261175000000 BYTE A BYTE e derruba a RPC nova", () => {
  const original = extrairCancelarDevolucao(norm(migrationBase));
  const restaurado = extrairCancelarDevolucao(r);
  assertEquals(
    restaurado,
    original,
    "o rollback tem que devolver exatamente o corpo já aprovado em 20261175000000, não uma versão reescrita",
  );
  // Nem o guard novo nem o evento ao lojista sobrevivem ao rollback.
  assert(!restaurado.includes("codigo_postagem IS NULL"));
  assert(!restaurado.includes("'sistema',"));
  // As DUAS assinaturas possíveis (1 e 2 argumentos — rodadas 2/3 e 4) são
  // derrubadas, cobrindo quem só chegou até uma rodada intermediária.
  assertStringIncludes(
    r,
    "DROP FUNCTION IF EXISTS public.admin_devolucao_liberar_vinculo_reverso(uuid, boolean);",
  );
  assertStringIncludes(
    r,
    "DROP FUNCTION IF EXISTS public.admin_devolucao_liberar_vinculo_reverso(uuid);",
  );
});

Deno.test("achado do addendum (rodada 4): o rollback recusa cedo se public.devolucoes (75) já não existir mais — sem isso, o corpo restaurado de cancelar_devolucao nasceria quebrado", () => {
  assertStringIncludes(r, "IF to_regclass('public.devolucoes') IS NULL THEN");
  assertStringIncludes(r, "RAISE EXCEPTION 'reverta esta migration (79)");
  // A ordem importa: a guarda vem ANTES de qualquer DROP/CREATE — recusar
  // cedo tem que acontecer sem nenhum efeito colateral já aplicado.
  const posGuarda = r.indexOf("to_regclass('public.devolucoes') IS NULL");
  const posDrop = r.indexOf(
    "DROP FUNCTION IF EXISTS public.admin_devolucao_liberar_vinculo_reverso",
  );
  assert(posGuarda >= 0 && posDrop >= 0);
  assert(
    posGuarda < posDrop,
    "a guarda de public.devolucoes tem que vir ANTES de qualquer DROP/CREATE do rollback",
  );
});
