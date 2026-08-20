// @ts-nocheck
/**
 * O mapa VERIFICACOES contra o .sql de CADA migration — scripts/db-apply.cjs
 *
 * O ERRO DE MÉTODO QUE ESTE ARQUIVO FECHA: as contagens do mapa são fáceis de
 * medir no lugar errado. O contrato de cada entrada é o corpo que AQUELA
 * migration cria — não o corpo vivo da função no banco. Quando uma migration
 * posterior redefine a mesma função (confirmar_pagamento em 20260808000000 e
 * de novo em 20260810000000; pagamentos_a_reconciliar em 20260808000100 e de
 * novo em 20260812000000; expirar_pedidos_vencidos em 20260807000000 e de novo
 * em 20260901000000), o corpo vivo é o da ÚLTIMA, e um número medido ali
 * descreve o objeto errado.
 *
 * O estrago é fail-closed e caro: aplicar a migration sozinha faz o db-apply
 * gritar "ATENÇÃO" e apontar o arquivo de rollback para uma aplicação
 * CORRETA — depois do COMMIT do passo 2, com quem lê o terminal decidindo ali
 * se desfaz. Já aconteceu duas vezes nesta linha de trabalho.
 *
 * Este teste é a régua que faltava: cada marcador é conferido contra o .sql da
 * própria migration, offline, de graça, no `npm run test:unit`, sem chegar
 * perto de um banco.
 *
 * SOBRE A CIRCULARIDADE: derivar a contagem do .sql e conferir contra o mesmo
 * .sql é circular no instante em que se escreve — e não é aí que este teste
 * vale. Ele vale DEPOIS: no dia em que alguém edita o .sql, escreve marcador
 * novo com número errado, ou reordena o WHERE. Por isso os números não foram
 * gerados por este laço: cada duplicata foi aberta no arquivo e olhada, uma a
 * uma, para decidir se a segunda ocorrência era CÓDIGO (vira contagem) ou
 * COMENTÁRIO (vira marcador contíguo — ver o teste dos endurecidos no fim).
 */
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  VERIFICACOES,
  conferirMarcador,
  checagemBemFormada,
} = require("../scripts/db-apply.cjs");

const PASTA_MIGRATIONS = new URL("../supabase/migrations/", import.meta.url);

/**
 * O que foi medido à mão em 20/08/2026, arquivo por arquivo. É PISO, não
 * igualdade: se o laço começar a pular entrada do mapa, o número desaba e o
 * teste reprova em vez de imprimir "nada divergiu" — que é exatamente o mesmo
 * resultado de um extrator quebrado. Apagar entrada do mapa também reprova
 * aqui, e é para isso que o piso existe.
 *
 * Subiu de 22/85 para 25/97 em 20/08/2026, com a entrada nova da
 * 20260729000002 (3 checagens, 10 marcadores) e o bloco de frete grátis
 * acrescentado nas duas checagens da 20260821000200 (+2).
 */
const CHECAGENS_MEDIDAS = 25;
// 97 -> 99: dois marcadores contiguos a mais em `is_local_cep`, para os dois
// ramos que a contagem de `RETURN true;` sozinha nao protegia.
const MARCADORES_MEDIDOS = 99;

/** Uma entrada do mapa vira sempre uma lista de checagens. */
const checagensDe = (registro) =>
  Array.isArray(registro) ? registro : [registro];

function lerMigration(arquivo) {
  try {
    return Deno.readTextFileSync(new URL(arquivo, PASTA_MIGRATIONS));
  } catch (erro) {
    // Falha ALTA, nunca `skip`: entrada no mapa apontando para arquivo que não
    // existe quer dizer que ninguém está conferindo aquela migration.
    throw new Error(
      `${arquivo}: o mapa VERIFICACOES tem entrada para esta migration, mas o arquivo não está em supabase/migrations/ (${erro?.message})`,
    );
  }
}

/**
 * Corpos de função de um .sql, por nome — o texto ENTRE os dollar-quotes.
 *
 * Precisa entender dollar-quote porque os arquivos usam rótulos diferentes
 * (`$function$`, `$candidatos$`, `$expirar$`, `$$`), e porque um rótulo
 * diferente pode aparecer ANINHADO dentro do corpo (`$cron$` dentro de `$$`) —
 * o corpo só termina no MESMO rótulo que o abriu.
 *
 * Devolve lista por nome: um arquivo pode criar mais de uma função, e nada
 * impede que crie a mesma duas vezes. Quem decide o que fazer com isso é o
 * chamador — aqui não se escolhe uma calada.
 */
function corposDeFuncao(sql) {
  const texto = sql.replace(/\r\n/g, "\n");
  const corpos = new Map();
  // Literais dentro da função de propósito: `new RegExp` acorda o
  // security/detect-non-literal-regexp, e um literal reavaliado a cada chamada
  // já nasce com `lastIndex` zerado.
  const abertura = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?(\w+)/gi;
  let cabecalho = abertura.exec(texto);
  while (cabecalho) {
    const rotulo = /\$\w*\$/g;
    rotulo.lastIndex = cabecalho.index + cabecalho[0].length;
    const abre = rotulo.exec(texto);
    if (abre) {
      const inicio = abre.index + abre[0].length;
      const fim = texto.indexOf(abre[0], inicio);
      if (fim !== -1) {
        const lista = corpos.get(cabecalho[1]) ?? [];
        // Do CABEÇALHO até o fechamento da dollar-quote — o mesmo recorte que
        // `pg_get_functiondef` devolve, e que é o que a ferramenta compara.
        // Ver o comentário de corpoDaMigration: medir só o miolo faria esta
        // régua discordar da ferramenta em marcador que toca a assinatura.
        lista.push(texto.slice(cabecalho.index, fim + abre[0].length));
        corpos.set(cabecalho[1], lista);
        // Retoma DEPOIS do corpo: um `CREATE OR REPLACE FUNCTION` citado
        // dentro do próprio corpo não pode virar uma segunda definição.
        abertura.lastIndex = fim + abre[0].length;
      }
    }
    cabecalho = abertura.exec(texto);
  }
  return corpos;
}

/**
 * O corpo único da função que a migration cria. Falha alto em vez de escolher.
 *
 * ⚠️ Devolve CABEÇALHO + CORPO, não só o miolo entre as dollar-quotes, porque
 * é isso que a ferramenta compara: `conferirMarcador` recebe a saída inteira
 * de `pg_get_functiondef`, que traz assinatura, `RETURNS`, `LANGUAGE`,
 * `SECURITY DEFINER` e `SET search_path` antes do corpo.
 *
 * Se esta régua medisse só o miolo, ela e a ferramenta discordariam sobre
 * marcador que toca o cabeçalho — um `"SECURITY DEFINER"` ou `"RETURNS TABLE"`
 * casaria N vezes aqui e N+1 no banco, o teste aprovaria, e o db-apply diria
 * A MAIS **depois do COMMIT**. Que é exatamente a falha que este arquivo
 * existe para impedir. Medido em 20/08/2026: 0 marcadores do mapa tocam o
 * cabeçalho hoje — a diferença é latente, não ativa, e é por isso que ela
 * precisa estar fechada agora e não quando aparecer.
 */
function corpoDaMigration(arquivo, funcao) {
  const corpos = corposDeFuncao(lerMigration(arquivo));
  const definicoes = corpos.get(funcao) ?? [];
  assertEquals(
    definicoes.length,
    1,
    `${arquivo}: esperava exatamente 1 CREATE OR REPLACE FUNCTION de ${funcao}, achei ${definicoes.length}. Este arquivo cria: ${[...corpos.keys()].join(", ") || "nenhuma função"}`,
  );
  return definicoes[0];
}

const SQL_SINTETICO = `-- Rascunho velho, fora de qualquer funcao: SELECT ANTIGO FROM x;
CREATE OR REPLACE FUNCTION public.uma()
RETURNS void LANGUAGE plpgsql AS $function$
BEGIN
  -- comentario DENTRO do corpo
  PERFORM 1;
END
$function$;

CREATE OR REPLACE FUNCTION public.outra()
RETURNS TABLE (x int) LANGUAGE sql AS $candidatos$
    SELECT 1;
$candidatos$;

CREATE OR REPLACE FUNCTION public.terceira() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM cron.schedule('j', '* * * * *', $cron$ SELECT 1; $cron$);
END
$$;
`;

// --------------------------------------------------------------------------
// Os controles do extrator, na MESMA rodada da medição. Sem eles, "nada
// divergiu" é indistinguível de um extrator que devolve corpo vazio (ou o
// arquivo inteiro) para tudo.
// --------------------------------------------------------------------------

Deno.test("o extrator de corpo entende os dollar-quotes do Postgres", async (t) => {
  const sintetico = corposDeFuncao(SQL_SINTETICO);

  await t.step("acha as três funções, com rótulos diferentes", () => {
    assertEquals([...sintetico.keys()], ["uma", "outra", "terceira"]);
    for (const nome of ["uma", "outra", "terceira"]) {
      assertEquals(sintetico.get(nome).length, 1);
    }
  });

  await t.step("o corpo é o que está ENTRE os rótulos", () => {
    assertStringIncludes(sintetico.get("uma")[0], "PERFORM 1;");
    // Se o extrator devolvesse o arquivo inteiro, tudo casaria sempre e o
    // teste grande abaixo viraria enfeite.
    assert(
      !sintetico.get("uma")[0].includes("SELECT ANTIGO"),
      "o extrator arrastou texto de FORA do corpo",
    );
    assert(
      !sintetico.get("uma")[0].includes("SELECT 1;"),
      "o extrator arrastou o corpo da função seguinte",
    );
  });

  await t.step("rótulo aninhado diferente não encerra o corpo", () => {
    assertStringIncludes(
      sintetico.get("terceira")[0],
      "$cron$ SELECT 1; $cron$",
    );
  });

  await t.step("o extrator PRESERVA comentário dentro do corpo", () => {
    // Controle da classe que o teste dos endurecidos exercita: lá se afirma
    // que um texto aparece 2x porque a segunda ocorrência é COMENTÁRIO. Se o
    // extrator estivesse comendo comentário, aquela afirmação passaria a se
    // apoiar em nada — e o marcador contíguo perderia o motivo em silêncio.
    assertStringIncludes(sintetico.get("uma")[0], "-- comentario DENTRO");
  });

  await t.step("controle positivo num .sql de verdade", () => {
    const corpo = corpoDaMigration(
      "20260808000100_reconciliacao.sql",
      "pagamentos_a_reconciliar",
    );
    assertEquals(conferirMarcador(corpo, "ORDER BY expires_at DESC").achou, 1);
  });

  await t.step("controle positivo de COMENTÁRIO num .sql de verdade", () => {
    // Mesma classe do passo sintético, agora no material real: um marcador
    // feito só de comentário casa no corpo extraído.
    const corpo = corpoDaMigration(
      "20260807000000_reserva_com_expiracao.sql",
      "expirar_pedidos_vencidos",
    );
    assertEquals(
      conferirMarcador(corpo, "-- FOR UPDATE SKIP LOCKED protege contra OUTRA")
        .achou,
      1,
    );
  });

  await t.step("controle negativo: texto inventado NÃO casa", () => {
    const corpo = corpoDaMigration(
      "20260808000100_reconciliacao.sql",
      "pagamentos_a_reconciliar",
    );
    const r = conferirMarcador(corpo, "ORDER BY expires_at CRESCENTE");
    assertEquals(r.achou, 0);
    assert(!r.ok);
  });
});

// --------------------------------------------------------------------------
// A varredura: TODO marcador do mapa, contra o .sql da própria migration.
// --------------------------------------------------------------------------

Deno.test("cada marcador do mapa casa no .sql da própria migration, na contagem declarada", () => {
  const divergencias = [];
  let checagensConferidas = 0;
  let marcadoresConferidos = 0;

  for (const [arquivo, registro] of Object.entries(VERIFICACOES)) {
    for (const checagem of checagensDe(registro)) {
      // Entrada malformada no mapa vira "pulada" no db-apply — e "pulada" é
      // silenciosa o bastante para o mapa inteiro parar de ser conferido sem
      // ninguém notar. Aqui ela reprova, offline, antes de qualquer banco.
      assert(
        checagemBemFormada(checagem),
        `${arquivo}: entrada malformada no mapa — o db-apply a trataria como "sem verificação"`,
      );
      const corpo = corpoDaMigration(arquivo, checagem.funcao);
      checagensConferidas += 1;
      for (const marcador of checagem.esperado) {
        marcadoresConferidos += 1;
        const r = conferirMarcador(corpo, marcador);
        if (r.ok) continue;
        divergencias.push(
          `${arquivo} / ${checagem.funcao}: aparece ${r.achou}x no arquivo, o mapa declara ${r.esperado}x — ${JSON.stringify(r.texto.slice(0, 70))}`,
        );
      }
    }
  }

  // O denominador ao lado do resultado: "0 divergências" só vale acompanhado
  // de quanto foi efetivamente olhado.
  console.log(
    `[mapa x .sql] ${checagensConferidas} checagens, ${marcadoresConferidos} marcadores conferidos, ${divergencias.length} divergência(s)`,
  );
  assert(
    checagensConferidas >= CHECAGENS_MEDIDAS,
    `só ${checagensConferidas} checagens conferidas, contra ${CHECAGENS_MEDIDAS} medidas em 20/08/2026 — sumiu entrada do mapa, ou o laço está pulando`,
  );
  assert(
    marcadoresConferidos >= MARCADORES_MEDIDOS,
    `só ${marcadoresConferidos} marcadores conferidos, contra ${MARCADORES_MEDIDOS} medidos em 20/08/2026 — sumiu marcador do mapa, ou o laço está pulando`,
  );
  assertEquals(
    divergencias,
    [],
    `\nO mapa declara contagem que o .sql da migration não tem:\n   ${divergencias.join("\n   ")}\n`,
  );
});

// --------------------------------------------------------------------------
// Os cinco que viraram CONTAGEM: aparecem mais de uma vez no arquivo que os
// cria, e todas as ocorrências são CÓDIGO que precisa sobreviver ao REPLACE.
// --------------------------------------------------------------------------

Deno.test("as contagens acima de 1 batem com o arquivo da própria migration", () => {
  const medidos = [
    [
      "20260819000000_identidade_da_loja.sql",
      "upsert_store_config",
      "config_json->>'store_name'",
      2,
    ],
    [
      "20260819000000_identidade_da_loja.sql",
      "upsert_store_config",
      "config_json->>'store_city'",
      2,
    ],
    [
      "20260819000000_identidade_da_loja.sql",
      "upsert_store_config",
      "config_json->>'store_state'",
      2,
    ],
    [
      "20260821000200_cupom_sem_limite_e_ilimitado.sql",
      "create_marketplace_order_v23",
      "Estoque insuficiente para o produto",
      3,
    ],
    [
      "20260822000100_analitico_conta_so_dinheiro_reconhecido.sql",
      "get_admin_analytics_v2",
      "AND (o.payment_status IS NULL OR o.payment_status IN ('pago', 'pago_apos_expirar'))",
      3,
    ],
  ];

  // Map em vez de índice por variável: `VERIFICACOES[arquivo]` dispara
  // security/detect-object-injection no eslint, e warning novo reprova o CI.
  const mapa = new Map(Object.entries(VERIFICACOES));

  for (const [arquivo, funcao, texto, vezes] of medidos) {
    const checagem = checagensDe(mapa.get(arquivo)).find(
      (c) => c.funcao === funcao,
    );
    assert(checagem, `${arquivo}: sem checagem para ${funcao}`);
    const marcador = checagem.esperado.find((m) => m?.texto === texto);
    assert(
      marcador,
      `${arquivo}/${funcao}: marcador voltou a ser string (que vale 1) e o furo volta com ele: ${texto}`,
    );
    assertEquals(marcador.vezes, vezes, `${arquivo}/${funcao}: ${texto}`);
    // E o número não é folclore herdado de uma medição antiga: ele é conferido
    // agora, contra o corpo que ESTA migration cria.
    assertEquals(
      conferirMarcador(corpoDaMigration(arquivo, funcao), texto).achou,
      vezes,
      `${arquivo}/${funcao}: o mapa declara ${vezes}x, o arquivo diz outra coisa — ${texto}`,
    );
  }
});

// --------------------------------------------------------------------------
// Os que NÃO viraram contagem: a segunda ocorrência é COMENTÁRIO ou texto
// cosmético. Contagem resolveria o furo e abriria outro — `vezes: 2` amarra a
// checagem à REDAÇÃO de um comentário, e editar prosa (ato inofensivo) passa a
// reprovar código correto. Marcador contíguo prende o código e deixa a prosa
// livre.
// --------------------------------------------------------------------------

Deno.test("os marcadores endurecidos não voltam a ser o texto fraco", () => {
  const endurecidos = [
    [
      "20260807000000_reserva_com_expiracao.sql",
      "expirar_pedidos_vencidos",
      "FOR UPDATE SKIP LOCKED",
      "AND expires_at < now()\n        FOR UPDATE SKIP LOCKED",
    ],
    [
      "20260901000000_devolver_uso_de_cupom_ao_desfazer_pedido.sql",
      "expirar_pedidos_vencidos",
      "FOR UPDATE SKIP LOCKED",
      "AND expires_at < now()\n        FOR UPDATE SKIP LOCKED",
    ],
    [
      "20260820000000_otp_v2_devolve_o_codigo.sql",
      "generate_order_otp_v2",
      "INTERVAL '60 seconds'",
      "AND created_at > NOW() - INTERVAL '60 seconds'",
    ],
    [
      "20260808000100_reconciliacao.sql",
      "pagamentos_a_reconciliar",
      "AND paid_at IS NULL",
      "AND gateway_payment_id IS NOT NULL\n       AND paid_at IS NULL",
    ],
  ];

  const mapa = new Map(Object.entries(VERIFICACOES));

  for (const [arquivo, funcao, fraco, forte] of endurecidos) {
    const checagem = checagensDe(mapa.get(arquivo)).find(
      (c) => c.funcao === funcao,
    );
    assert(checagem, `${arquivo}: sem checagem para ${funcao}`);

    const textos = checagem.esperado.map((m) =>
      typeof m === "string" ? m : m?.texto,
    );

    assert(
      textos.includes(forte),
      `${arquivo}/${funcao}: sumiu o marcador contíguo: ${forte}`,
    );
    assert(
      !textos.includes(fraco),
      `${arquivo}/${funcao}: o texto fraco voltou como marcador solto: ${fraco}`,
    );
    // E o forte tem de CONTER o fraco: se alguém "endurecer" para um trecho
    // que nem fala do mecanismo, o marcador deixa de provar o que dizia.
    assert(
      forte.includes(fraco),
      `${arquivo}/${funcao}: o marcador contíguo não cobre ${fraco}`,
    );

    // A EVIDÊNCIA, medida agora no corpo que esta migration cria — sem ela as
    // três linhas acima são só declaração, e declaração errada foi exatamente
    // o defeito que este trabalho inteiro existe para não repetir.
    const corpo = corpoDaMigration(arquivo, funcao);
    assert(
      conferirMarcador(corpo, fraco).achou > 1,
      `${arquivo}/${funcao}: o texto fraco aparece uma vez só — o endurecimento perdeu o motivo: ${fraco}`,
    );
    assertEquals(
      conferirMarcador(corpo, forte).achou,
      1,
      `${arquivo}/${funcao}: o marcador contíguo tem de casar exatamente 1x: ${forte}`,
    );
    // E ele é feito de CÓDIGO: marcador que atravessa comentário volta a
    // amarrar a checagem à prosa, que é de onde estávamos saindo.
    assert(
      !forte.includes("--"),
      `${arquivo}/${funcao}: o marcador contíguo atravessa comentário: ${forte}`,
    );
  }
});

// --------------------------------------------------------------------------
// A regra de FRETE GRÁTIS, e o segundo erro de método que este arquivo fecha:
// medir o marcador certo contra o OBJETO errado.
//
// A 20260729000002 criou a v23 e reescreveu a v22 como FACHADA — de lá para
// cá quem carrega a regra do dinheiro é a v23 (e a v24), que é o que
// `src/hooks/useOrders.ts` chama. Os marcadores que guardavam a regra
// apontavam para a v22, cujo corpo vivo hoje é `RETURN
// public.create_marketplace_order_v23(...)` e mais nada: um CREATE OR REPLACE
// futuro podia derrubar o frete grátis do caminho vivo com o mapa inteiro
// dizendo "ok", e isso viaja para toda loja clonada deste repositório.
//
// A entrada da 20260729000000 NÃO se reaponta: ela descreve corretamente o
// corpo que ELA cria (histórico), e é contra esse .sql que a varredura acima
// a confere. Reapontá-la para o corpo vivo seria trocar uma entrada certa por
// uma errada.
// --------------------------------------------------------------------------

const MIGRATION_DA_V23 = "20260729000002_shipping_quote_validation_v23.sql";
const MIGRATION_DO_CUPOM = "20260821000200_cupom_sem_limite_e_ilimitado.sql";

/** O que prova que a v22 continua DELEGANDO, em vez de ter cópia própria da regra. */
// Colado no BEGIN, e nao o `RETURN ...` solto: solto ele prova que a
// delegacao EXISTE, nao que ela e' a UNICA coisa que o corpo faz. Uma v22 que
// ganhasse um INSERT proprio entre o BEGIN e o RETURN passava como
// "verificada" com o marcador solto — e gravaria o pedido duas vezes.
const MARCADOR_DELEGACAO =
  "BEGIN\n    RETURN public.create_marketplace_order_v23(";
const DELEGACAO_SOLTA = "RETURN public.create_marketplace_order_v23(";

// Os dois textos SOLTOS que guardavam a regra até aqui. Eles provam que o
// texto existe em ALGUM ponto da função — não que um governa o outro. Ficam
// nomeados para servir de controle negativo (a v22 não os tem) e para travar
// que NÃO voltem como marcador solto nas entradas do caminho vivo.
const FRETE_TEXTO_FRACO_SENTINELA =
  "NULLIF(v_store_config.free_shipping_min, 0)";
const FRETE_TEXTO_FRACO_PARIDADE =
  "v_user_id IS NOT NULL AND v_calculated_subtotal >= v_free_shipping_min";

/**
 * O bloco CONTÍGUO que substitui os dois soltos nas três checagens do caminho
 * vivo. Medido em 20/08/2026: idêntico caractere a caractere e 1x em cada um
 * dos três corpos, sem atravessar comentário.
 */
const FRETE_BLOCO = `    v_free_shipping_min := COALESCE(NULLIF(v_store_config.free_shipping_min, 0), 999999);

    IF v_has_free_shipping_item = true
       OR (v_user_id IS NOT NULL AND v_calculated_subtotal >= v_free_shipping_min)
    THEN
        v_shipping_validated := 0;`;

/**
 * M3 — a mutação que decide se o bloco vale alguma coisa: troca a sentinela
 * `999999` (que faz `free_shipping_min = 0` significar "frete grátis
 * DESLIGADO") por `0`, que faz o mesmo campo significar "grátis a partir de
 * R$ 0". Loja com frete grátis desligado passa a dar frete zero para qualquer
 * cliente logado, com qualquer carrinho (`10 >= 0`).
 *
 * É a mutação que a contagem exata NÃO pega: os dois textos fracos continuam
 * casando 1x cada, `ok=true`, e a loja para de cobrar frete. Só o bloco, que
 * ATRAVESSA a sentinela, acusa.
 *
 * Devolve o corpo INALTERADO quando o trecho não existe — quem chama tem de
 * provar que a sabotagem entrou antes de concluir qualquer coisa do resultado.
 */
function aplicarMutacaoM3(corpo) {
  return corpo.replace(
    "COALESCE(NULLIF(v_store_config.free_shipping_min, 0), 999999)",
    "COALESCE(NULLIF(v_store_config.free_shipping_min, 0), 0)",
  );
}

Deno.test("a v22 vira fachada na 20260729000002, e o mapa confere a DELEGAÇÃO", async (t) => {
  const mapa = new Map(Object.entries(VERIFICACOES));

  await t.step(
    "a entrada existe e tem as TRÊS checagens que a migration cria",
    () => {
      // Esta migration cria três funções. Com só duas cobertas, a última linha
      // do terminal deixaria de dizer "1 migration ficou SEM CONFERÊNCIA
      // AUTOMÁTICA" e passaria a dizer "Tudo aplicado e verificado" — um aviso
      // honesto trocado por uma afirmação falsa, DEPOIS do COMMIT.
      const checagens = checagensDe(mapa.get(MIGRATION_DA_V23));
      assertEquals(checagens.length, 3);
      assertEquals(checagens.map((c) => c.funcao).sort(), [
        "create_marketplace_order_v22",
        "create_marketplace_order_v23",
        "is_local_cep",
      ]);
    },
  );

  await t.step("a checagem da v22 é a da delegação, e ela casa 1x", () => {
    const checagem = checagensDe(mapa.get(MIGRATION_DA_V23)).find(
      (c) => c.funcao === "create_marketplace_order_v22",
    );
    assert(checagem, "sem checagem para create_marketplace_order_v22");
    const textos = checagem.esperado.map((m) =>
      typeof m === "string" ? m : m?.texto,
    );
    assert(
      textos.includes(MARCADOR_DELEGACAO),
      `checagem da v22 sem o marcador de delegação: ${JSON.stringify(textos)}`,
    );
    // A direção que importa: o texto FRACO não pode voltar sozinho. Ele casa
    // no mesmo lugar, então trocar o contíguo por ele não quebra nada — só
    // deixa de provar que a delegação é a PRIMEIRA coisa do corpo.
    assert(
      !textos.includes(DELEGACAO_SOLTA),
      `o marcador solto da delegação voltou — ele aprova uma v22 com lógica própria antes de delegar: ${JSON.stringify(textos)}`,
    );
    assertEquals(
      conferirMarcador(
        corpoDaMigration(MIGRATION_DA_V23, "create_marketplace_order_v22"),
        MARCADOR_DELEGACAO,
      ).achou,
      1,
    );
  });

  await t.step(
    "controle negativo: o corpo da v22 desta migration NÃO tem mais a regra",
    () => {
      // É isto que prova que a v22 virou fachada — e não que o extrator
      // devolveu corpo vazio para tudo, caso em que os dois zeros abaixo
      // sairiam iguais sem provar nada.
      const corpo = corpoDaMigration(
        MIGRATION_DA_V23,
        "create_marketplace_order_v22",
      );
      assert(corpo.length > 0, "corpo da v22 veio vazio — extrator quebrado");
      assertEquals(
        conferirMarcador(corpo, FRETE_TEXTO_FRACO_SENTINELA).achou,
        0,
      );
      assertEquals(
        conferirMarcador(corpo, FRETE_TEXTO_FRACO_PARIDADE).achou,
        0,
      );
      // Controle POSITIVO na mesma rodada: a regra não sumiu do arquivo, ela
      // MUDOU DE FUNÇÃO. Sem esta linha, "0 ocorrências" na v22 é o mesmo
      // resultado de um extrator quebrado.
      assertEquals(
        conferirMarcador(
          corpoDaMigration(MIGRATION_DA_V23, "create_marketplace_order_v23"),
          FRETE_TEXTO_FRACO_PARIDADE,
        ).achou,
        1,
      );
    },
  );
});

Deno.test("o bloco de frete grátis guarda as três checagens do caminho vivo", async (t) => {
  const mapa = new Map(Object.entries(VERIFICACOES));
  const ALVOS = [
    [MIGRATION_DA_V23, "create_marketplace_order_v23"],
    [MIGRATION_DO_CUPOM, "create_marketplace_order_v23"],
    [MIGRATION_DO_CUPOM, "create_marketplace_order_v24"],
  ];

  for (const [arquivo, funcao] of ALVOS) {
    await t.step(
      `${arquivo} / ${funcao}: o mapa declara o BLOCO, não os dois textos soltos`,
      () => {
        const checagem = checagensDe(mapa.get(arquivo)).find(
          (c) => c.funcao === funcao,
        );
        assert(checagem, `${arquivo}: sem checagem para ${funcao}`);
        const textos = checagem.esperado.map((m) =>
          typeof m === "string" ? m : m?.texto,
        );
        assert(
          textos.includes(FRETE_BLOCO),
          `${arquivo}/${funcao}: sumiu o bloco contíguo de frete grátis`,
        );
        assert(
          !textos.includes(FRETE_TEXTO_FRACO_SENTINELA),
          `${arquivo}/${funcao}: o texto fraco da sentinela voltou como marcador solto`,
        );
        assert(
          !textos.includes(FRETE_TEXTO_FRACO_PARIDADE),
          `${arquivo}/${funcao}: o texto fraco da paridade voltou como marcador solto`,
        );
        // O bloco tem de CONTER os dois fracos: "endurecer" para um trecho
        // que nem fala do mecanismo faria o marcador deixar de provar o que diz.
        assert(FRETE_BLOCO.includes(FRETE_TEXTO_FRACO_SENTINELA));
        assert(FRETE_BLOCO.includes(FRETE_TEXTO_FRACO_PARIDADE));
        // E ele é feito de CÓDIGO: marcador que atravessa comentário volta a
        // amarrar a checagem à prosa.
        assert(!FRETE_BLOCO.includes("--"));
      },
    );

    await t.step(
      `${arquivo} / ${funcao}: o bloco casa exatamente 1x no .sql desta migration`,
      () => {
        assertEquals(
          conferirMarcador(corpoDaMigration(arquivo, funcao), FRETE_BLOCO)
            .achou,
          1,
        );
      },
    );

    await t.step(
      `${arquivo} / ${funcao}: M3 (999999 → 0) derruba o bloco, e os soltos NÃO acusam`,
      () => {
        // O passo que documenta por que a colagem existe. Sem ele, o teste só
        // afirmaria que trocamos de string — e contagem exata já pegaria
        // sumiço parcial. O que ela NÃO pega é troca de VALOR, e é isso aqui.
        const corpo = corpoDaMigration(arquivo, funcao);
        const corpoMutado = aplicarMutacaoM3(corpo);
        assert(
          corpoMutado !== corpo,
          `${arquivo}/${funcao}: a mutação M3 não achou o trecho a trocar — o passo não prova nada`,
        );
        // Os dois soltos continuam 1x cada, ou seja: sob contagem exata eles
        // imprimiriam "ok" com a loja tendo parado de cobrar frete.
        assertEquals(
          conferirMarcador(corpoMutado, FRETE_TEXTO_FRACO_SENTINELA).achou,
          1,
          `${arquivo}/${funcao}: era este o furo — o texto fraco casando com a regra quebrada`,
        );
        assertEquals(
          conferirMarcador(corpoMutado, FRETE_TEXTO_FRACO_PARIDADE).achou,
          1,
        );
        assertEquals(
          conferirMarcador(corpoMutado, FRETE_BLOCO).achou,
          0,
          `${arquivo}/${funcao}: o bloco tinha de deixar de casar depois de M3`,
        );
      },
    );
  }
});
