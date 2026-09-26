// @ts-nocheck
// CONTRATO DO MARCADOR DE PAGAMENTO DA ETIQUETA REVERSA — achado 4 da revisão
// de risco pré-publicação (rodada 4, scratchpad rev79/ataque3.cjs). O
// marcador de pagamento (achado R5, rodada 3) vive em DOIS lugares que
// precisam concordar byte a byte:
//   * `supabase/functions/melhor-envio-etiqueta/index.ts` GRAVA a nota, com
//     `notaPagamentoConfirmadoReverso`/`notaPagamentoIndeterminadoReverso`;
//   * `supabase/migrations/20261179000000_...sql` PROCURA a nota, com
//     `strpos(nota, '<âncora>' || v_d.me_reverse_id || ';')` dentro de
//     `admin_devolucao_liberar_vinculo_reverso`.
//
// Até a rodada 4, essa "amarração" vivia só em comentário — nada testava que
// as duas pontas realmente citavam a MESMA frase. Uma edição em qualquer um
// dos dois lados (reescrever a frase da edge, por exemplo) quebraria a
// proteção do achado R5 EM SILÊNCIO: a RPC voltaria a soltar um vínculo pago,
// porque o `strpos` nunca mais bateria com nada.
//
// Este teste lê o TEXTO CRU dos dois arquivos (nunca importa index.ts — ele
// tem efeito colateral de `serve()` fora do próprio index_test.ts, guardado
// por `Deno.mainModule.includes('index_test')`; importar daqui abriria um
// listener de verdade) e confere que a mesma âncora aparece nos dois.
import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const DIR = new URL(".", import.meta.url);
const edge = Deno.readTextFileSync(
  new URL("../supabase/functions/melhor-envio-etiqueta/index.ts", DIR),
);
const migration = Deno.readTextFileSync(
  new URL(
    "../supabase/migrations/20261179000000_cancelar_devolucao_barra_compra_em_voo.sql",
    DIR,
  ),
);

// As âncoras são o texto ESTÁVEL das duas frases — tudo antes do
// `${meId}`/`|| v_d.me_reverse_id ||` até o `;` (inclusive) que fecha o
// trecho. Hardcoded aqui de propósito: se mudar dos dois lados ao mesmo
// tempo, tudo bem — o teste é sobre os dois lados NUNCA divergirem, não
// sobre o texto exato ser este para sempre.
const ANCORA_CONFIRMADO = "confirmou o pagamento do envio reverso ";
const ANCORA_INDETERMINADO = "Pagamento indeterminado do envio reverso ";

Deno.test("marcador de pagamento CONFIRMADO: a âncora da edge e o strpos da RPC citam a MESMA frase", () => {
  // A edge grava: `O Melhor Envio ${ANCORA_CONFIRMADO}${meId}; ...`
  assertStringIncludes(
    edge,
    "confirmou o pagamento do envio reverso ${meId}; o código de postagem",
  );
  // A RPC procura: strpos(nota, 'confirmou o pagamento do envio reverso ' || v_d.me_reverse_id || ';')
  assertStringIncludes(
    migration,
    `strpos(nota, '${ANCORA_CONFIRMADO}' || v_d.me_reverse_id || ';')`,
  );
});

Deno.test("marcador de pagamento INDETERMINADO: a âncora da edge e o strpos da RPC citam a MESMA frase", () => {
  // A edge grava: `${ANCORA_INDETERMINADO}${meId}; o Melhor Envio não confirmou...`
  assertStringIncludes(
    edge,
    "Pagamento indeterminado do envio reverso ${meId}; o Melhor Envio não confirmou",
  );
  assertStringIncludes(
    migration,
    `strpos(nota, '${ANCORA_INDETERMINADO}' || v_d.me_reverse_id || ';')`,
  );
});

Deno.test("as duas âncoras são DISTINTAS entre si (senão o guard confirmado e o indeterminado colidiriam)", () => {
  assert(!ANCORA_CONFIRMADO.includes(ANCORA_INDETERMINADO));
  assert(!ANCORA_INDETERMINADO.includes(ANCORA_CONFIRMADO));
});

Deno.test("achado 4 (F5 do scratchpad): a RPC usa strpos (substring literal), NUNCA LIKE, para não deixar '_'/'%' do próprio id virar curinga", () => {
  const secaoDaRpc = migration.slice(
    migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.admin_devolucao_liberar_vinculo_reverso",
    ),
  );
  assert(
    !/nota\s+LIKE/i.test(secaoDaRpc),
    "a RPC não pode voltar a usar LIKE contra a nota — um id com '_' casaria com o marcador de outro id (F5)",
  );
  assertStringIncludes(secaoDaRpc, "strpos(nota,");
});

Deno.test("achado 4: as duas funções exportadas existem no arquivo da edge (índice para quem procurar o contrato)", () => {
  assertStringIncludes(edge, "export function notaPagamentoConfirmadoReverso(");
  assertStringIncludes(
    edge,
    "export function notaPagamentoIndeterminadoReverso(",
  );
});
