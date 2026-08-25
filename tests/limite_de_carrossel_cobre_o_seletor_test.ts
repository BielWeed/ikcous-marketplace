// @ts-nocheck
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
/**
 * O limite de carga dos carrosséis cobre TODA opção que o painel oferece
 *
 * O DEFEITO QUE ESTE TESTE FECHA (revisão cruzada de 25/08/2026, `20260825-1050`):
 * a vitrine de Lançamentos cortava em 6 produtos por um `.slice(0, 6)` fixo,
 * enquanto o seletor "Max" do painel oferecia 8 e 10 e a PRÉVIA DO ADMIN
 * mostrava os 10. O lojista escolhia 10, via 10, e o cliente via 6 — a tela
 * prometendo o que o app não cumpre.
 *
 * O conserto trocou os três cortes literais (`6`, `10`, `10`) pela constante
 * `LIMITE_MAX_ITENS_CARROSSEL`. E aí ficou o buraco que este teste tapa: o
 * conserto DECLARA uma invariante em comentário — "este número tem de ser >= ao
 * maior valor oferecido pelo seletor" — e **nada a fiscaliza**. Medido no dia:
 * `grep -rl LIMITE_MAX_ITENS_CARROSSEL tests/` devolvia vazio.
 *
 * POR QUE UM TESTE DE VARREDURA, E NÃO UM TESTE DA TELA: o defeito é de CLASSE.
 * Consertar o 6 não impede alguém de acrescentar `<option value={12}>` no
 * seletor na semana que vem — e nesse dia o cliente volta a ver 10 enquanto o
 * painel promete 12, com o comentário do `carrossel.ts` ainda jurando que isso
 * não acontece. Renderizar a tela também não serviria: `AdminCarouselsView`
 * depende do `StoreContext`, que puxa `@/lib/supabase` na carga do módulo.
 *
 * A ARMADILHA, e por isso a calibragem existe: um extrator que deixa de casar
 * devolve zero opção, `Math.max()` de lista vazia devolve `-Infinity`, e a
 * comparação `LIMITE >= -Infinity` passa. O teste ficaria VERDE justamente
 * quando parou de medir. Por isso a calibragem prova as duas coisas na MESMA
 * rodada: que o extrator REAGE (achou as opções, e uma por `<option>`) e que
 * ele DISCRIMINA (não conta o `value={sec.maxItems ?? 6}` do próprio `<select>`,
 * que tem a mesma cara e não é uma opção).
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { LIMITE_MAX_ITENS_CARROSSEL } from "../src/config/carrossel.ts";

// `fromFileUrl` e não `.pathname`: o caminho deste projeto tem espaços, e o
// pathname devolve `%20` mais uma barra sobrando no Windows.
const PAINEL = fromFileUrl(
  new URL("../src/views/admin/AdminCarouselsView.tsx", import.meta.url),
);

const fonte = Deno.readTextFileSync(PAINEL);

/** Valores numéricos oferecidos pelo seletor de `maxItems`.
 *
 * O JSX quebra `<option` e `value={N}` em linhas diferentes, então casar os
 * dois juntos exigiria varrer entre eles. Como o arquivo tem UM ÚNICO
 * `<select>` (asserido abaixo), todo `value={<dígitos>}` do arquivo é opção
 * dele — e `value={sec.maxItems ?? 6}`, que é do `<select>` e não de uma
 * opção, não casa por não ser só dígitos. */
function opcoesDoSeletor(texto: string): number[] {
  return [...texto.matchAll(/value=\{(\d+)\}/g)].map((m) => Number(m[1]));
}

Deno.test("calibragem: o extrator reage e discrimina", () => {
  const opcoes = opcoesDoSeletor(fonte);

  // REAGE: achou opções de verdade. Sem isto, um extrator quebrado deixaria a
  // varredura verde medindo o vazio.
  assert(
    opcoes.length >= 2,
    `o extrator achou ${opcoes.length} opcao(oes) em AdminCarouselsView. ` +
      `Ou o seletor mudou de forma, ou o extrator quebrou — nos dois casos ` +
      `alguem tem de olhar, e nao seguir verde.`,
  );

  // Uma opção por `<option>`: se aparecer `value={N}` fora de uma opção, ou uma
  // opção sem valor numérico, os números divergem e o teste chama um humano.
  const quantosOption = [...fonte.matchAll(/<option\b/g)].length;
  assertEquals(
    opcoes.length,
    quantosOption,
    `achei ${opcoes.length} valor(es) numerico(s) e ${quantosOption} <option>. ` +
      `Divergiram: a premissa de que todo value={N} do arquivo e uma opcao do ` +
      `seletor de maxItems deixou de valer.`,
  );

  // DISCRIMINA: o próprio `<select>` tem `value={sec.maxItems ?? 6}`, que se
  // parece com uma opção e não é. Se um dia o extrator passar a contá-lo, este
  // caso cai antes de a varredura mentir.
  assert(
    fonte.includes("value={sec.maxItems ?? 6}"),
    "o `<select>` deixou de ter `value={sec.maxItems ?? 6}` — o caso de " +
      "discriminacao desta calibragem sumiu do arquivo e precisa ser refeito.",
  );
  assertEquals(
    opcoesDoSeletor("value={sec.maxItems ?? 6}").length,
    0,
    "o extrator passou a contar o value do proprio <select> como opcao",
  );

  // A premissa de "um select só" é do extrator, então ela também se assere.
  assertEquals(
    [...fonte.matchAll(/<select\b/g)].length,
    1,
    "AdminCarouselsView passou a ter mais de um <select>: os value={N} do " +
      "arquivo nao pertencem mais todos ao seletor de maxItems.",
  );
});

Deno.test("o limite de carga cobre a maior opcao que o painel oferece", () => {
  const opcoes = opcoesDoSeletor(fonte);
  const maiorOferecida = Math.max(...opcoes);

  assert(
    LIMITE_MAX_ITENS_CARROSSEL >= maiorOferecida,
    `LIMITE_MAX_ITENS_CARROSSEL vale ${LIMITE_MAX_ITENS_CARROSSEL}, mas o ` +
      `seletor de "Max" em AdminCarouselsView oferece ate ${maiorOferecida} ` +
      `(opcoes: ${opcoes.join(", ")}).\n\n` +
      `Efeito para quem usa a loja: o lojista escolhe ${maiorOferecida}, a ` +
      `previa do painel mostra ${maiorOferecida}, e o cliente ve ` +
      `${LIMITE_MAX_ITENS_CARROSSEL} — calado.\n\n` +
      `Conserto: suba LIMITE_MAX_ITENS_CARROSSEL em src/config/carrossel.ts ` +
      `para pelo menos ${maiorOferecida}, ou tire a opcao do seletor.`,
  );
});
