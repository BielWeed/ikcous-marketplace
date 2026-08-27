// @ts-nocheck
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { avaliarFase0 } = require("../scripts/db-prove-rollback.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME = "20261020000000_lojista_registra_pagamento_recebido.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../rollback-manual-${NOME}`;
const DB_APPLY_PATH = `${DIR}../scripts/db-apply.cjs`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);
const dbApply = Deno.readTextFileSync(DB_APPLY_PATH);

// `avaliarFase0` avalia o PAR de uma vez — assinatura conferida no codigo real
// (scripts/db-prove-rollback.cjs:308) e no arquivo-molde
// (tests/migration_vitrine_sabe_que_produto_mudou_test.ts:99). Ela recebe UM
// OBJETO NOMEADO e devolve `{ recusado, motivos }` — nao `{ recusas }`, e nao
// aceita a string solta. Alem de BEGIN/COMMIT escondido, ela ja recusa
// `CREATE FUNCTION` sem `OR REPLACE` nos DOIS arquivos, entao nao existe teste
// separado para isso: seria assercao mais fraca que a que ja esta aqui.
Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

// 🔴 Toda assercao de guarda daqui para baixo e' BLOCO AMARRADO: a condicao E a
// consequencia, na mesma string. Marcador solto afere que a LINHA existe, nao que
// ela FAZ algo — medido: mantendo `IF NOT public.is_admin() THEN` no lugar e
// trocando so' o `RAISE` por `NULL;`, a guarda vira no-op, qualquer cliente logado
// marca qualquer pedido como pago, e a bateria inteira continua VERDE.
// `norm` existe para a assercao nao depender de indentacao.
const norm = (s) => s.replace(/\s+/g, " ").trim();
const migrationN = norm(migration);
const rollbackN = norm(rollback);

Deno.test("a migration alarga a CHECK constraint para aceitar o valor novo", () => {
  // Sem isto a funcionalidade nao funciona UMA vez: a constraint de
  // 20260807000000 tem seis valores e recusa o setimo. Medido em 27/08/2026.
  assertStringIncludes(
    migrationN,
    norm("DROP CONSTRAINT IF EXISTS marketplace_orders_payment_status_check"),
  );
  assertStringIncludes(migrationN, norm("'recebido_na_entrega'::text"));
  // ADITIVA: os seis originais continuam todos la.
  for (const v of [
    "aguardando",
    "pago",
    "recusado",
    "expirado",
    "estornado",
    "pago_apos_expirar",
  ]) {
    assertStringIncludes(migrationN, norm(`'${v}'::text`));
  }
});

Deno.test("a migration cria as duas colunas e a tabela de historico", () => {
  assertStringIncludes(
    migrationN,
    norm("ADD COLUMN IF NOT EXISTS pagamento_recebido_em timestamptz"),
  );
  assertStringIncludes(
    migrationN,
    norm("ADD COLUMN IF NOT EXISTS pagamento_recebido_por uuid"),
  );
  assertStringIncludes(
    migrationN,
    norm("CREATE TABLE IF NOT EXISTS public.marketplace_order_payment_history"),
  );
});

Deno.test("as QUATRO recusas da RPC sao blocos amarrados, nao linhas soltas", () => {
  assertStringIncludes(
    migrationN,
    norm(`IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado: só a loja registra pagamento recebido.';`),
  );
  assertStringIncludes(
    migrationN,
    norm(`IF v_status = 'cancelled' THEN
        RAISE EXCEPTION 'Pedido cancelado não recebe pagamento.';`),
  );
  assertStringIncludes(
    migrationN,
    norm(`IF v_payment_method = 'online' THEN
        RAISE EXCEPTION 'Este pedido é pago pelo site:`),
  );
  // A palavra do lojista NAO sobrescreve a do gateway.
  assertStringIncludes(
    migrationN,
    norm(`ELSIF v_payment_status IS NOT NULL THEN
            RAISE EXCEPTION 'Este pedido já tem pagamento registrado`),
  );
});

Deno.test("os tres pontos que o plano chama de 'a correcao em si' tem assercao", () => {
  // 1. FOR UPDATE: dois cliques simultaneos nao gravam duas linhas de historico.
  assertStringIncludes(migrationN, norm("WHERE id = p_order_id FOR UPDATE;"));
  // 2. O UPDATE grava o valor NOVO — amarrado a atribuicao que o define, porque a
  //    string 'recebido_na_entrega' aparece em 3 lugares do arquivo e so' UMA
  //    decide o que e' gravado.
  assertStringIncludes(
    migrationN,
    norm(`v_depois := 'recebido_na_entrega';
            UPDATE public.marketplace_orders
               SET payment_status = v_depois,`),
  );
  // 3. Segundo clique nao gera linha de historico fantasma.
  assertStringIncludes(
    migrationN,
    norm(`IF NOT v_ja_estava THEN
        INSERT INTO public.marketplace_order_payment_history`),
  );
});

Deno.test("a RPC nasce SECURITY DEFINER, sem privilegio para anon", () => {
  assertStringIncludes(
    migrationN,
    norm("CREATE OR REPLACE FUNCTION public.registrar_pagamento_recebido"),
  );
  assertStringIncludes(migrationN, norm("SECURITY DEFINER"));
  assertStringIncludes(migrationN, norm("SET search_path = public"));
  // Funcao nova nasce com EXECUTE para `anon` por default deste banco
  // (pg_default_acl) — o REVOKE e' o que desfaz isso, e sem assercao ninguem nota
  // se ele sumir.
  assertStringIncludes(
    migrationN,
    norm(
      "REVOKE ALL ON FUNCTION public.registrar_pagamento_recebido(uuid, boolean) FROM anon",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "GRANT EXECUTE ON FUNCTION public.registrar_pagamento_recebido(uuid, boolean) TO authenticated",
    ),
  );
});

Deno.test("o rollback derruba TUDO que a migration cria — os QUATRO objetos", () => {
  assertStringIncludes(
    rollbackN,
    norm(
      "DROP FUNCTION IF EXISTS public.registrar_pagamento_recebido(uuid, boolean)",
    ),
  );
  assertStringIncludes(
    rollbackN,
    norm("DROP TABLE IF EXISTS public.marketplace_order_payment_history"),
  );
  // As duas colunas: apagar estas duas linhas do rollback deixava a bateria verde.
  assertStringIncludes(
    rollbackN,
    norm("DROP COLUMN IF EXISTS pagamento_recebido_em"),
  );
  assertStringIncludes(
    rollbackN,
    norm("DROP COLUMN IF EXISTS pagamento_recebido_por"),
  );
});

// A lista da constraint restaurada, extraida do ARRAY[...] em vez de procurada
// no arquivo inteiro. Contar ocorrencia no arquivo todo foi medido furado nos
// DOIS sentidos: exigindo `::text`, um setimo valor sem o cast entrava na
// constraint e passava verde (e o Postgres aceita o literal nu num text[]);
// sem exigir, o texto do portao derrubava o teste a toa.
function listaDaConstraintRestaurada(sql) {
  const m = sql.match(
    /ADD CONSTRAINT marketplace_orders_payment_status_check[\s\S]*?ARRAY\s*\[([\s\S]*?)\]/,
  );
  if (!m) return null;
  // `[^']+` e nao `[a-z_]+`: com a classe estreita, um setimo valor como
  // 'recebido_na_entrega2' ou 'PIX' NAO casava e sumia em silencio da lista
  // comparada — medido passando verde. Descartar em silencio e' o modo de
  // falha que nao levanta suspeita.
  return (m[1].match(/'([^']+)'/g) || []).map((x) => x.slice(1, -1));
}

Deno.test("o rollback restaura a constraint com EXATAMENTE os seis originais", () => {
  const lista = listaDaConstraintRestaurada(rollback);
  assert(lista !== null, "nao achei o ARRAY da constraint no rollback");
  assertEquals(
    lista,
    [
      "aguardando",
      "pago",
      "recusado",
      "expirado",
      "estornado",
      "pago_apos_expirar",
    ],
    `a constraint restaurada tem de ter os seis originais, na ordem, e nada mais — achei: ${JSON.stringify(lista)}`,
  );
});

Deno.test("a reversao inteira e' UM bloco atomico, com o portao dentro", () => {
  // 🔴 Bloco DO e' UM comando, logo UMA transacao: ou reverte inteiro ou nada.
  // Sem isso, portao / DROP CONSTRAINT / ADD CONSTRAINT sao tres comandos com
  // confirmacao propria, e uma falha no meio deixa a marketplace_orders SEM
  // TRAVA em payment_status. Medido: com a versao em tres comandos, bastava o
  // portao cair entre o DROP e o ADD — ou alguem clicar "recebi" no painel
  // nesse intervalo — para a guarda viva desde 20260807000000 sumir.
  // Conta so' nas linhas de CODIGO. Sem isto, citar o literal num comentario
  // do cabecalho derruba o teste a toa — e o conserto tentador de quem tropecar
  // nisso e' AFROUXAR a assercao, que e' o pior desfecho possivel.
  // (Medido: `removerRuido` de db-prove-rollback.cjs NAO serve aqui — ele trata
  //  `$$ ... $$` como string e apaga o bloco inteiro, entao dois blocos reais
  //  contam ZERO. Filtrar linha de comentario e' o que funciona: conferido com
  //  controle positivo, dois blocos -> 2, e negativo, so' prosa -> 0.)
  const codigo = rollback
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  assertEquals(
    (codigo.match(/DO \$\$/g) || []).length,
    1,
    "a reversao tem de ser UM bloco atomico so'",
  );
  assertEquals(
    (codigo.match(/END \$\$;/g) || []).length,
    1,
    "a reversao tem de fechar UM bloco atomico so'",
  );

  // O portao existe, e e' bloco amarrado: a condicao E a recusa.
  assertStringIncludes(
    rollbackN,
    norm(`IF EXISTS (
        SELECT 1 FROM public.marketplace_orders
         WHERE payment_status = 'recebido_na_entrega'
    ) THEN
        RAISE EXCEPTION 'Reversao recusada:`),
  );

  // NADA que destroi pode ficar FORA do bloco — e "fora" tem DOIS lados.
  // 🔴 A versao anterior olhava so' o que vinha DEPOIS do `END $$;`. Medido: um
  // `ALTER TABLE ... DROP CONSTRAINT` inserido ANTES do `DO $$` passava verde —
  // e ele e' comando de topo, confirma sozinho, entao o portao aborta so' a si
  // mesmo e a tabela fica SEM TRAVA, com o operador lendo "reversao recusada" e
  // achando que nada aconteceu. Era o mesmo dano, pelo lado que ninguem olhava.
  // Usa `codigo` (sem linhas de comentario) porque o cabecalho cita DROP em prosa.
  const iAbre = codigo.indexOf("DO $$");
  const iFecha = codigo.indexOf("END $$;");
  assert(iAbre > -1 && iFecha > iAbre, "nao achei o bloco atomico no codigo");
  const antesDoBloco = codigo.slice(0, iAbre);
  const depoisDoBloco = codigo.slice(iFecha + "END $$;".length);
  const perigosos = [
    "DROP ",
    "ALTER TABLE ",
    "CREATE ",
    "TRUNCATE ",
    "UPDATE ",
    "DELETE ",
  ];
  for (const [onde, trecho] of [
    ["ANTES", antesDoBloco],
    ["DEPOIS", depoisDoBloco],
  ]) {
    for (const perigoso of perigosos) {
      assertEquals(
        trecho.includes(perigoso),
        false,
        `"${perigoso.trim()}" nao pode aparecer ${onde} do bloco atomico — la ele confirma sozinho`,
      );
    }
  }
});

Deno.test("a tabela nova nasce com RLS ligado e policy so' para admin", () => {
  // 🔴 Tabela nova em `public` NASCE com INSERT/SELECT/UPDATE/DELETE para `anon`
  // por pg_default_acl deste banco (medido), e a chave anonima vai no bundle do
  // front. O RLS e' a UNICA coisa entre ela e essa tabela. Medido: apagar o
  // ENABLE ROW LEVEL SECURITY, ou apagar a policy, deixava a bateria verde.
  assertStringIncludes(
    migrationN,
    norm(
      "ALTER TABLE public.marketplace_order_payment_history ENABLE ROW LEVEL SECURITY",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(`CREATE POLICY mkt_order_payment_history_select
    ON public.marketplace_order_payment_history
    FOR SELECT
    USING (public.is_admin())`),
  );
  // Nenhuma policy de ESCRITA: quem escreve e' a RPC, que e' SECURITY DEFINER.
  // Uma policy de INSERT/UPDATE/DELETE/ALL aqui abriria a tabela para `anon`.
  //
  // 🔴 REGEX, nao lista de strings. Medido: a versao com quatro literais
  // (`ON public.<tabela> FOR INSERT`) pegava a grafia canonica e PERDIA duas
  // igualmente validas — sem qualificar o schema (`ON <tabela> FOR INSERT`) e
  // com clausula no meio (`ON public.<tabela> AS PERMISSIVE FOR ALL`). Quatro
  // strings literais nao enumeram uma gramatica.
  // Aspas opcionais: `ON "public"."tabela"` e forma valida e existe neste
  // repositorio. Sem isso, a grafia entre aspas escapava — medido verde.
  const policyDeEscrita =
    /* eslint-disable-next-line security/detect-unsafe-regex --
     * O pior caso e' QUADRATICO, nao exponencial -- refeito em 27/08/2026
     * porque a primeira medicao usou entrada facil (aspas/"public" repetidos
     * nunca criam a ambiguidade real). Entrada adversarial de verdade: o
     * PREFIXO QUE CASA ("ON marketplace_order_payment_history ") repetido,
     * sem ';' nem 'FOR', forcando o [^;]*? a varrer ate o fim a partir de
     * cada ocorrencia:
     *   666 mil chars    -> 3,03 s
     *   1,37 milhao      -> 12,51 s
     *   2,74 milhoes     -> 49,90 s
     *   5,48 milhoes     -> 201,89 s
     *   crescimento ao dobrar o tamanho: 4,13x / 3,99x / 4,05x, CONSTANTE
     *   -- QUADRATICO.
     * Controle positivo, regex sabidamente exponencial no mesmo motor
     * ((a+)+ contra 'a'.repeat(n)+'X'): n=20 -> 96 ms, n=24 -> 201 ms,
     * n=28 -> 3,15 s -- o crescimento ACELERA a cada passo (2,1x, depois
     * 15,7x), o oposto da razao constante acima. E' isso que separa
     * quadratico de exponencial aqui.
     * O que torna isto seguro NAO e' a regex ser rapida -- no pior caso
     * ela nao e' -- e' a entrada ser SEMPRE um arquivo local do
     * repositorio (migration/rollback), nunca rede nem entrada de
     * usuario. Extrapolando a curva medida (k ~= 6,7e-9 ms/char^2) para os
     * 201 KB da maior migration do repositorio, no formato MAIS
     * adversarial possivel (que uma migration real nunca tem), da ~0,29 s;
     * a migration desta tarefa tem 7 KB, onde o mesmo calculo da ~0,0003 s. */
    /ON (?:"?public"?\.)?"?marketplace_order_payment_history"?[^;]*?\bFOR (?:INSERT|UPDATE|DELETE|ALL)\b/;
  assertEquals(
    policyDeEscrita.test(migrationN),
    false,
    "a tabela de historico nao pode ter policy de escrita: quem escreve e' a RPC",
  );
});

Deno.test("a entrada em VERIFICACOES existe e nomeia a funcao", () => {
  assertStringIncludes(dbApply, `"${NOME}"`);
  const i = dbApply.indexOf(`"${NOME}"`);
  assert(i > -1);
  const trecho = dbApply.slice(i, i + 1200);
  assertStringIncludes(trecho, "registrar_pagamento_recebido");
});
