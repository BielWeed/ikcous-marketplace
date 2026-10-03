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
 * Consertar o 6 não impede alguém de acrescentar uma opção a mais no seletor na
 * semana que vem — e nesse dia o cliente volta a ver menos enquanto o painel
 * promete mais, com o comentário do `carrossel.ts` ainda jurando que isso não
 * acontece. Renderizar a tela também não serviria: `AdminCarouselsView` depende
 * do `StoreContext`, que puxa `@/lib/supabase` na carga do módulo.
 *
 * MUDANÇA DE FORMA (peça-22, 14/09/2026): o seletor "Máx" deixou de ser um
 * `<select>` nativo — cuja lista aberta é a branca/azul do navegador, "crua" no
 * tema escuro, a ponto do DONO reprovar ao vivo — e passou a ser o Select Radix
 * da casa (`src/components/ui/select.tsx`, popover temático). O próprio teste
 * exige olhar humano quando "o seletor muda de forma", e foi isto que
 * aconteceu: as opções hoje vivem como literais `value="N"` em `<SelectItem>`,
 * e o valor corrente é ligado na RAIZ como `value={String(sec.maxItems ?? 6)}`
 * — mesma cara de opção e NÃO é. Este extrator foi refeito para a nova forma;
 * a ARMADILHA original continua valendo e segue calibrada: um extrator que
 * deixa de casar devolve zero opção, `Math.max()` de lista vazia devolve
 * `-Infinity`, e a comparação `LIMITE >= -Infinity` passa. Por isso a
 * calibragem prova as duas coisas na MESMA rodada: que o extrator REAGE (achou
 * as opções, e uma por `<SelectItem>`) e que ele DISCRIMINA (não conta o
 * `value={String(...)}` da raiz do seletor).
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

/** Valores numéricos oferecidos pelas opções do seletor de `maxItems`.
 *
 * Cada opção é um `<SelectItem ... value="N">N</SelectItem>` — literal de
 * string com só dígitos. O valor CORRENTE na raiz é
 * `value={String(sec.maxItems ?? 6)}` (expressão JSX), que não casa com este
 * regex por não ser literal entre aspas. */
function opcoesDoSeletor(texto: string): number[] {
  return [...texto.matchAll(/value="(\d+)"/g)].map((m) => Number(m[1]));
}

Deno.test("calibragem: o extrator reage e discrimina", () => {
  const opcoes = opcoesDoSeletor(fonte);

  // REAGE: achou opções de verdade. Sem isto, um extrator quebrado deixaria a
  // varredura verde medindo o vazio.
  assert(
    opcoes.length >= 2,
    `o extrator achou ${opcoes.length} opcao(oes) em AdminCarouselsView. Ou o seletor mudou de forma (de novo), ou o extrator quebrou — nos dois casos alguem tem de olhar, e nao seguir verde.`,
  );

  // Uma opção por `<SelectItem>`: as opções do "Máx" vivem todas como
  // SelectItem com `value="N"`. Divergência = a premissa de que todo
  // value="dígitos" do arquivo é uma opção deixou de valer.
  const quantosItens = [...fonte.matchAll(/<SelectItem\b/g)].length;
  assertEquals(
    opcoes.length,
    quantosItens,
    `achei ${opcoes.length} valor(es) numerico(s) e ${quantosItens} <SelectItem>. Divergiram: a premissa de que todo value="N" do arquivo e uma opcao do seletor de maxItems deixou de valer.`,
  );

  // DISCRIMINA: a raiz do seletor liga o valor corrente como
  // `value={String(sec.maxItems ?? 6)}` — mesma cara de opção e não é. Se o
  // extrator passar a contá-lo, este caso cai antes de a varredura mentir.
  assert(
    fonte.includes("value={String(sec.maxItems ?? 6)}"),
    "a raiz do `<Select>` deixou de ter `value={String(sec.maxItems ?? 6)}` — o caso de " +
      "discriminacao desta calibragem sumiu do arquivo e precisa ser refeito.",
  );
  assertEquals(
    opcoesDoSeletor("value={String(sec.maxItems ?? 6)}").length,
    0,
    "o extrator passou a contar o value da raiz do seletor como opcao",
  );

  // A premissa de "um seletor só" é do extrator, então ela também se assere:
  // exatamente UMA raiz `<Select>` (SelectTrigger/Content/Item não casam por
  // causa do `\b`).
  assertEquals(
    [...fonte.matchAll(/<Select\b/g)].length,
    1,
    'AdminCarouselsView passou a ter mais de uma raiz <Select>: os value="N" do ' +
      "arquivo nao pertencem mais todos ao seletor de maxItems.",
  );
});

Deno.test("o limite de carga cobre a maior opcao que o painel oferece", () => {
  const opcoes = opcoesDoSeletor(fonte);
  const maiorOferecida = Math.max(...opcoes);

  assert(
    LIMITE_MAX_ITENS_CARROSSEL >= maiorOferecida,
    `LIMITE_MAX_ITENS_CARROSSEL vale ${LIMITE_MAX_ITENS_CARROSSEL}, mas o seletor de "Máx" em AdminCarouselsView oferece ate ${maiorOferecida} (opcoes: ${opcoes.join(", ")}).\n\nEfeito para quem usa a loja: o lojista escolhe ${maiorOferecida}, a previa do painel mostra ${maiorOferecida}, e o cliente ve ${LIMITE_MAX_ITENS_CARROSSEL} — calado.\n\nConserto: suba LIMITE_MAX_ITENS_CARROSSEL em src/config/carrossel.ts para pelo menos ${maiorOferecida}, ou tire a opcao do seletor.`,
  );
});
