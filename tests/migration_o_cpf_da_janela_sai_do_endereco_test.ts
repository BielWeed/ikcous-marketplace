// @ts-nocheck
// O CPF DA JANELA SAI DO ENDEREÇO — prova offline do par 20261182000000 +
// rollback (migration de DADOS: move `customer_data.address.cpf` para
// `customer_data.cpf` nos pedidos gravados entre a 20261171000000 e a
// 20261172000000, ou apaga a chave quando o CPF é inválido / a modalidade é
// local-delivery/store-pickup). RODADA 2 e RODADA 3 (revisão de risco):
// reforça as asserções contra os achados medium/low/info da revisão — ver
// cada teste.
//
// RODADA 3, ACHADO 4 (dois buracos na suíte estática, medidos pelo
// revisor): X1 -- trocar `RAISE EXCEPTION` por `RAISE NOTICE` no preflight
// da v23 passava 16/16 (as asserções conferiam fragmentos do `IF`, nunca o
// bloco INTEIRO -- nenhum fragmento sozinho exige a palavra `EXCEPTION`).
// X2 -- remover `jsonb_typeof(...) = 'object' AND` SÓ da `alvo` também
// passava 16/16, porque a MESMA substring sobrevive na verificação final
// (o `WHERE` dela tem o mesmo `jsonb_typeof(...) = 'object' AND (...) ?
// 'cpf'`) -- a asserção da `alvo` achava a substring ali, não na `alvo`.
// Comprovado com dois mutantes (`X1_v23_notice_em_vez_de_exception.sql`,
// `X2_sem_jsonb_typeof_no_alvo.sql`) rodados contra a suíte ANTERIOR: os
// dois passavam 16/16. A cura dos dois é a MESMA dos achados 2/3 da rodada
// 2 -- parar de checar fragmento e passar a checar o BLOCO INTEIRO,
// ancorado por texto que só existe naquele lugar específico.
//
// O DEFEITO QUE ESTE PAR FECHA: sem esta migration, todo pedido nacional de
// cliente logado criado naquela janela continua com
// `customer_data.address = {"cpf": "..."}` — um objeto TRUTHY que vence o
// endereço de verdade na cadeia `||` de `src/lib/mappers.ts` (`addressSource`)
// e deixa o endereço de entrega em branco no painel, no comprovante e em
// "Meus pedidos". Cada asserção abaixo está amarrada a uma peça que, se
// sumir, reabre esse furo ou grava o CPF onde ele não deveria ficar.
//
// A prova COM BANCO (as quatro/cinco condições de gravação, a opção do dono,
// a verificação final, a atomicidade contra um gatilho sabotador, e a
// paridade de `cpf_ok` contra o prosrc vivo da v24 em milhares de entradas)
// está no relatório desta tarefa e em `tests/banco/cpf-da-janela-viva.cjs` —
// rodada num Postgres 17 efêmero local, nunca em banco real. Este arquivo é
// só a prova ESTÁTICA (sem banco), no padrão de
// tests/migration_a_loja_declara_a_sua_configuracao_publica_test.ts.
//
// RODADA 2, ACHADO 1 (medium): a rodada 1 checava presença de código
// (`FOR UPDATE OF o`, etc.) contra `migrationN` — o texto normalizado do
// ARQUIVO INTEIRO, cabeçalho incluído. O cabeçalho descreve a migration em
// prosa e MENCIONA os mesmos trechos de código que a implementação real
// contém (`FOR UPDATE OF o`, `? 'cpf'`...) — então apagar a linha de código
// de verdade e deixar só a frase do cabeçalho fazia a asserção continuar
// passando (mutante M4, medido: 12/12 "verde" com o código real ausente).
// A correção NÃO é `removerRuido(migration)` ingenuamente: a partir da
// RODADA 2 (achado 4), a migration inteira é UM ÚNICO bloco
// `DO $migracao_20261182$ ... END $migracao_20261182$;` — e `removerRuido`
// trata bloco dollar-quoted como STRING OPACA (é assim que ele evita achar
// "BEGIN"/"COMMIT" de mentirinha dentro do corpo de uma função; correto para
// ESSE propósito). Rodar `removerRuido` no arquivo inteiro agora apaga o
// corpo do `DO` JUNTO com o cabeçalho — sobra quase nada para checar. A cura
// aqui é mais simples e não depende de dollar-quote nenhum: fatiar o arquivo
// em CABEÇALHO (tudo antes de `DO $migracao_20261182$`, só prosa em `--`) e
// CORPO (o `DO` inteiro) pelo ÍNDICE do marcador, e checar conteúdo de
// código só no CORPO. Cabeçalho nunca entra na comparação, então uma frase
// de prosa não pode mais "seguntar" um mutante que apagou o código real.
const CORPO_MARCADOR = "DO $migracao_20261182$";
// A tag do dollar-quote aparece de novo no CABEÇALHO (prosa, dentro de
// crase, explicando o achado 4 -- "é UM ÚNICO comando (`DO
// $migracao_20261182$ ... END $migracao_20261182$;`)"). Um `indexOf` simples
// acharia essa menção em prosa PRIMEIRO e fatiaria o "corpo" a partir dali —
// reintroduzindo o MESMO problema que este arquivo existe para evitar. A
// âncora real é a LINHA EXATA (só a tag, nada mais depois dela), que só
// existe uma vez: a abertura de verdade do bloco DO.
const MARCADOR_LINHA_EXATA = /^DO \$migracao_20261182\$\s*$/m;

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
const NOME = "20261182000000_o_cpf_da_janela_sai_do_endereco.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../supabase/migrations/rollback-manual-${NOME}`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);

const norm = (s) => s.replace(/\s+/g, " ").trim();

// CORPO: só o bloco DO executável (achado 1). Qualquer assertStringIncludes
// de CÓDIGO abaixo mira aqui, nunca em `migrationN` (que incluiria o
// cabeçalho e reabriria o mesmo furo do mutante M4).
const mArranque = MARCADOR_LINHA_EXATA.exec(migration);
const iCorpo = mArranque ? mArranque.index : -1;
const corpo = migration.slice(iCorpo);
const corpoN = norm(corpo);

Deno.test("o marcador do corpo executavel existe UMA UNICA VEZ como linha propria (pre-requisito dos demais testes)", () => {
  assert(
    iCorpo !== -1,
    `"${CORPO_MARCADOR}" não encontrado como linha própria -- os testes de conteúdo abaixo não têm onde fatiar`,
  );
  // Confere que a menção em PROSA do cabeçalho (achado 4, explicando a
  // atomicidade) não é a mesma ocorrência: ela vem embutida no meio de uma
  // frase, nunca sozinha numa linha -- é exatamente essa diferença que a
  // âncora por linha exata explora.
  assert(
    !corpoN.startsWith("... END"),
    "a fatia do corpo começou na menção em prosa do cabeçalho, não no código real",
  );
});

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior (regra da casa)", () => {
  const transMigration = detectarTransacaoExplicita(removerRuido(migration));
  const transRollback = detectarTransacaoExplicita(removerRuido(rollback));
  assertEquals(
    transMigration.achados,
    [],
    `migration contém controle de transação: ${transMigration.achados.join("/")}`,
  );
  assertEquals(
    transRollback.achados,
    [],
    `rollback contém controle de transação: ${transRollback.achados.join("/")}`,
  );
});

Deno.test("RODADA 2, achado 4: a migration inteira e' UM UNICO bloco DO (preflight + mover/apagar + verificacao final atomicos)", () => {
  // Exatamente 2 ocorrencias da tag do dollar-quote DENTRO do corpo: a
  // abertura (`DO $migracao_20261182$`) e o fechamento
  // (`END $migracao_20261182$;`) -- se alguem voltar a separar em blocos
  // distintos (a forma da rodada 1: 2 DO + 1 UPDATE como comandos de nivel
  // superior separados), essa contagem muda ou o preflight/update/checagem
  // final deixam de estar dentro do mesmo par.
  const ocorrencias = corpoN.split("$migracao_20261182$").length - 1;
  assertEquals(
    ocorrencias,
    2,
    "esperava exatamente 2 ocorrencias da tag $migracao_20261182$ (abertura + fechamento) -- a migration deixou de ser um unico bloco DO",
  );
  assert(corpoN.startsWith(CORPO_MARCADOR), "o corpo deve comecar pelo DO");
  assert(
    corpoN.endsWith("END $migracao_20261182$;"),
    "o corpo deve terminar fechando o MESMO DO -- preflight, update e verificacao final tem de estar dentro dele",
  );
  // Ordem: preflight ANTES do UPDATE ANTES da verificacao final -- os tres
  // tem de aparecer nessa ordem dentro do MESMO bloco.
  const iPreflight = corpoN.indexOf("PREFLIGHT_20261182");
  const iUpdate = corpoN.indexOf("UPDATE public.marketplace_orders o");
  const iVerificacao = corpoN.indexOf("VERIFICACAO_FINAL_20261182");
  assert(
    iPreflight !== -1 &&
      iUpdate !== -1 &&
      iVerificacao !== -1 &&
      iPreflight < iUpdate &&
      iUpdate < iVerificacao,
    "preflight, UPDATE e verificação final devem aparecer nessa ordem, dentro do mesmo bloco DO",
  );
});

Deno.test("preflight recusa quando v23 ou v24 nao carregam o splice v_address_data_sem_cpf da 20261172000000", () => {
  assertStringIncludes(corpoN, "PREFLIGHT_20261182");
  // As duas assinaturas conferidas são as MESMAS 13 posições que a
  // 20261172000000 já usa no preflight dela — sem parâmetro novo.
  assertStringIncludes(
    corpoN,
    norm(
      "to_regprocedure( 'public.create_marketplace_order_v23(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)' )",
    ),
  );
  assertStringIncludes(
    corpoN,
    norm(
      "to_regprocedure( 'public.create_marketplace_order_v24(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)' )",
    ),
  );
});

Deno.test("RODADA 3, achado 4 (X1): o preflight e' o bloco IF...RAISE EXCEPTION...END IF completo, para v23 E para v24", () => {
  // Bloco INTEIRO (não fragmentos soltos): pega o mutante que troca
  // `RAISE EXCEPTION` por `RAISE NOTICE` (a migration deixaria de recusar
  // sem RPC nova — só avisaria e seguiria em frente) porque a palavra
  // `EXCEPTION` faz parte do texto EXIGIDO, não é conferida à parte.
  assertStringIncludes(
    corpoN,
    norm(
      `IF v_prosrc_v23 IS NULL OR v_prosrc_v23 !~ 'v_address_data_sem_cpf' THEN
    RAISE EXCEPTION 'PREFLIGHT_20261182: create_marketplace_order_v23 nao carrega o splice v_address_data_sem_cpf da 20261172000000 -- aplique a 20261172000000 (e a 20261174000000, que a recria) antes desta migration.';
  END IF;`,
    ),
  );
  assertStringIncludes(
    corpoN,
    norm(
      `IF v_prosrc_v24 IS NULL OR v_prosrc_v24 !~ 'v_address_data_sem_cpf' THEN
    RAISE EXCEPTION 'PREFLIGHT_20261182: create_marketplace_order_v24 nao carrega o splice v_address_data_sem_cpf da 20261172000000 -- aplique a 20261172000000 (e a 20261174000000, que a recria) antes desta migration.';
  END IF;`,
    ),
  );
});

Deno.test("RODADA 3, achado 4 (X2): a CTE alvo INTEIRA (SELECT...WHERE jsonb_typeof...FOR UPDATE OF o) e' capturada, nao so' fragmentos que tambem existem na verificacao final", () => {
  // A verificação final tem uma WHERE quase idêntica (`jsonb_typeof(...) =
  // 'object' AND (...) ? 'cpf'`) -- um assertStringIncludes fragmentado
  // continuava achando essa substring ALI, mesmo que alguém apagasse
  // `jsonb_typeof(...) = 'object' AND` SÓ da `alvo`. Capturando o bloco
  // INTEIRO da CTE (com `FOR UPDATE OF o` e o fechamento `),` logo depois,
  // que só existem na `alvo`), a âncora fica única -- o mutante que tira só
  // o `jsonb_typeof` da `alvo` muda ESTE texto e não bate mais.
  assertStringIncludes(
    corpoN,
    norm(
      `alvo AS (
    SELECT
      o.id,
      o.status,
      o.payment_status,
      o.shipping_label_id,
      o.customer_data -> 'address' AS endereco,
      regexp_replace(COALESCE(o.customer_data -> 'address' ->> 'cpf', ''), '\\D', '', 'g') AS digitos,
      -- RODADA 2, achado 5: presença de CPF na raiz exige TEXTO NÃO-VAZIO —
      -- \`{"cpf": null}\` ou \`{"cpf": ""}\` NÃO contam como "já tem CPF" (NÃO é
      -- a régua de \`cpfDoDestinatario\`, que exige válido; ver RODADA 3,
      -- achado 6, no cabeçalho).
      (NULLIF(btrim(o.customer_data ->> 'cpf'), '') IS NOT NULL) AS raiz_tem_cpf,
      NULLIF(btrim(COALESCE(o.customer_data ->> 'shipping_option_id', '')), '') AS opcao
    FROM public.marketplace_orders o
    WHERE jsonb_typeof(o.customer_data -> 'address') = 'object'
      AND (o.customer_data -> 'address') ? 'cpf'
    FOR UPDATE OF o
  ),`,
    ),
  );
});

Deno.test("RODADA 2, achado 5: raiz_tem_cpf exige TEXTO de verdade (NULLIF(btrim(...)) IS NOT NULL), nao so' a chave existir", () => {
  assertStringIncludes(
    corpoN,
    norm(
      "(NULLIF(btrim(o.customer_data ->> 'cpf'), '') IS NOT NULL) AS raiz_tem_cpf",
    ),
  );
  // A regra ANTIGA (rodada 1, achado 5 do relatório): `customer_data ?
  // 'cpf'` sozinho não pode mais ser a definição de raiz_tem_cpf -- isso
  // tratava `{"cpf": null}`/`{"cpf": ""}` como "já tem CPF" e bloqueava o
  // move de um CPF válido do endereço (caso c25 do banco de prova).
  assert(
    !/\(o\.customer_data \? 'cpf'\) AS raiz_tem_cpf/.test(corpo),
    "raiz_tem_cpf voltou a usar só `? 'cpf'` -- reabre o achado 5 (chave presente com null/vazio conta como 'tem CPF')",
  );
});

Deno.test("RODADA 2, achado 2: cpf_ok e' o bloco CASE completo e normalizado (pega M2b/c/d/e -- DV invertido, peso errado, limiar errado)", () => {
  // Bloco INTEIRO, não fragmentos soltos -- qualquer caractere alterado
  // dentro dele (=/<>›, o range do generate_series, o limiar `< 2`) faz este
  // `assertStringIncludes` não achar mais o texto, porque o texto exigido é
  // o bloco INTEIRO normalizado.
  assertStringIncludes(
    corpoN,
    norm(`CASE
        WHEN length(a.digitos) <> 11 THEN false
        WHEN a.digitos ~ '^(\\d)\\1{10}$' THEN false
        ELSE (
          SELECT (dig.d[10] = (CASE WHEN sums.s1 < 2 THEN 0 ELSE 11 - sums.s1 END))
             AND (dig.d[11] = (CASE WHEN sums.s2 < 2 THEN 0 ELSE 11 - sums.s2 END))
            FROM (
              SELECT array_agg(substr(a.digitos, gs, 1)::int ORDER BY gs) AS d
                FROM generate_series(1, 11) AS gs
            ) dig
            CROSS JOIN LATERAL (
              SELECT
                (SELECT SUM(dig.d[i] * (11 - i)) FROM generate_series(1, 9) AS i) % 11 AS s1,
                (SELECT SUM(dig.d[i] * (12 - i)) FROM generate_series(1, 10) AS i) % 11 AS s2
            ) sums
        )
      END AS cpf_ok`),
  );
});

Deno.test("a chave cpf SEMPRE sai do endereco, e o objeto vazio vira JSON null (nao SQL 'null' de tres valores, nao '{}')", () => {
  assertStringIncludes(
    corpoN,
    norm(
      "CASE WHEN (v.endereco - 'cpf') = '{}'::jsonb THEN 'null'::jsonb ELSE (v.endereco - 'cpf') END",
    ),
  );
});

Deno.test("customer_data.cpf na raiz so' nasce com as CINCO condicoes juntas, com o OR NULL-safe (achado 1: NOT raiz_tem_cpf e' codigo do CORPO; RODADA 3, achado 2: payment_status IS NOT DISTINCT FROM)", () => {
  assertStringIncludes(
    corpoN,
    norm(
      `WHEN NOT v.raiz_tem_cpf
                     AND v.cpf_ok
                     AND v.opcao IS NOT NULL
                     AND v.opcao NOT IN ('local-delivery', 'store-pickup')
                     AND NOT (
                       v.apagar_em_vez_de_mover_cancelado_sem_etiqueta
                       AND (v.status = 'cancelled' OR v.payment_status IS NOT DISTINCT FROM 'expirado')
                       AND v.payment_status IS DISTINCT FROM 'pago_apos_expirar'
                       AND v.shipping_label_id IS NULL
                     )
                THEN jsonb_build_object('cpf', v.digitos)
                ELSE '{}'::jsonb`,
    ),
  );
});

Deno.test("RODADA 3, achado 2: a comparacao de expirado usa IS NOT DISTINCT FROM (NULL-safe), nunca '=' (que vira SQL NULL de tres valores quando payment_status e' NULL)", () => {
  assert(
    !/\bv\.payment_status = 'expirado'/.test(corpo),
    "voltou a usar `v.payment_status = 'expirado'` -- com payment_status NULL isso avalia NULL, e `false OR NULL` tambem e' NULL: o WHEN inteiro deixa de ser TRUE e a linha cai no ELSE (apaga) mesmo sem ser cancelado/expirado de verdade",
  );
  assertStringIncludes(
    corpoN,
    "v.payment_status IS NOT DISTINCT FROM 'expirado'",
  );
});

Deno.test("RODADA 2, achado 6: pago_apos_expirar fica FORA da condicao de so' apagar (dinheiro que chegou pode reativar o pedido)", () => {
  assertStringIncludes(
    corpoN,
    "AND v.payment_status IS DISTINCT FROM 'pago_apos_expirar'",
  );
});

Deno.test("RODADA 2, achado 6: a opcao do dono e' um booleano literal -- o teste aceita true OU false, nunca pina qual (comportamento, nao o literal)", () => {
  const m = corpo.match(
    /SELECT (true|false) AS apagar_em_vez_de_mover_cancelado_sem_etiqueta/,
  );
  assert(
    m,
    "a CTE opcao_do_dono deve ter `SELECT <true|false> AS apagar_em_vez_de_mover_cancelado_sem_etiqueta` -- nenhum dos dois valores é errado, o teste só confere que a linha existe e é um booleano",
  );
});

Deno.test("RODADA 2, achado 3: verificacao final e' o bloco IF completo e normalizado (pega M3a ausente, M3b chave errada, M3c zerada na origem)", () => {
  assertStringIncludes(
    corpoN,
    norm(
      `SELECT count(*) INTO v_restantes
    FROM public.marketplace_orders o
   WHERE jsonb_typeof(o.customer_data -> 'address') = 'object'
     AND (o.customer_data -> 'address') ? 'cpf';
  IF v_restantes > 0 THEN
    RAISE EXCEPTION 'VERIFICACAO_FINAL_20261182: % pedido(s) ainda com a chave cpf dentro de customer_data.address depois da migration -- aborte e investigue antes de reaplicar.', v_restantes;
  END IF;`,
    ),
  );
});

Deno.test("RODADA 4, achado C (X7): o RAISE NOTICE da contagem vem DEPOIS do END IF da verificacao final, nunca antes", () => {
  // A RODADA 3 (achado 5) moveu o NOTICE para depois da verificacao final --
  // se ele voltasse para logo apos o UPDATE (antes do IF), o log mostraria
  // uma contagem de linhas que a excecao, alguns comandos depois, desfaz
  // junto com o UPDATE inteiro (falso positivo operacional). Nenhuma
  // asserção anterior conferia a ORDEM relativa entre os dois -- só que os
  // dois EXISTEM em algum lugar do corpo (mutante X7, medido: passa 18/18
  // sem este teste). Ancora pelo "END IF;" que fecha especificamente a
  // verificacao final (o texto logo antes é o RAISE EXCEPTION dela, unico
  // no arquivo) -- os dois `END IF;` do preflight (v23/v24) vêm ANTES do
  // UPDATE, então não competem com esta âncora.
  const marcaVerificacao = "VERIFICACAO_FINAL_20261182";
  const iVerificacao = corpoN.indexOf(marcaVerificacao);
  assert(iVerificacao !== -1, "verificacao final nao encontrada no corpo");
  const iFimVerificacao = corpoN.indexOf("END IF;", iVerificacao);
  assert(iFimVerificacao !== -1, "END IF da verificacao final nao encontrado");
  const marcaNotice = "RAISE NOTICE '20261182:";
  const iNotice = corpoN.indexOf(marcaNotice);
  assert(iNotice !== -1, "RAISE NOTICE da contagem nao encontrado no corpo");
  assert(
    iNotice > iFimVerificacao,
    "o RAISE NOTICE aparece ANTES do END IF da verificacao final -- se a verificacao falhar, o log mostraria uma contagem que a excecao desfaz junto com o UPDATE inteiro",
  );
});

Deno.test("nenhuma outra coluna e' escrita -- so' customer_data no SET do UPDATE", () => {
  const inicioUpdate = corpo.indexOf("UPDATE public.marketplace_orders o");
  assert(inicioUpdate !== -1, "UPDATE nao encontrado no corpo");
  const fimUpdate = corpo.indexOf(";", inicioUpdate);
  assert(fimUpdate !== -1, "fim do UPDATE nao encontrado");
  const blocoUpdate = corpo.slice(inicioUpdate, fimUpdate);
  const setMatches = blocoUpdate.match(/\bSET\b/gi) || [];
  assertEquals(
    setMatches.length,
    1,
    "o UPDATE deve ter um unico SET (so' customer_data), nunca updated_at ou outra coluna",
  );
});

Deno.test("rollback e' um NO-OP documentado -- nenhuma instrucao SQL executavel", () => {
  const limpo = removerRuido(rollback).trim();
  assertEquals(
    limpo,
    "",
    "o rollback desta migration de dados deve ser só comentário (documentado como no-op) -- devolver o CPF para o endereço recriaria o defeito",
  );
});

Deno.test("rollback explica o motivo do no-op (recriar o defeito) e aponta o backup diario como caminho de volta", () => {
  assertStringIncludes(rollback, "NO-OP");
  assertStringIncludes(rollback, "BACKUP DIÁRIO");
  assertStringIncludes(rollback, "PITR");
});
