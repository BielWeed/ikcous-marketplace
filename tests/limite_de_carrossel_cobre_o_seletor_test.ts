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
 * maior valor oferecido pelo painel" — e **nada a fiscaliza**.
 *
 * REDESENHO DA TELA (03/10/2026): o seletor "Max" deixou de ser um `<select>`
 * com `<option value={N}>` literais dentro de `AdminCarouselsView` e virou uma
 * fileira de botões no painel de edição (`FolhaEditarVitrine`), desenhada a
 * partir de `OPCOES_MAX_ITENS_CARROSSEL` (src/config/carrossel.ts). A
 * invariante agora é comparada contra ESSA lista — que é exatamente o que a
 * tela oferece, porque a tela só sabe desenhar opção que vem dela.
 *
 * A ARMADILHA, e por isso a calibragem existe: se a tela voltasse a ter opções
 * literais (um `<select>` novo, ou botões escritos à mão), a lista deixaria de
 * ser o que o painel oferece e a comparação passaria sem medir nada. A
 * calibragem prova, na MESMA rodada, que (1) a lista existe e tem valores
 * válidos, (2) o painel DESENHA a partir dela, e (3) não há `<select>`/`<option>`
 * literal na tela nem no painel.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  LIMITE_MAX_ITENS_CARROSSEL,
  OPCOES_MAX_ITENS_CARROSSEL,
} from "../src/config/carrossel.ts";

// `fromFileUrl` e não `.pathname`: o caminho deste projeto tem espaços, e o
// pathname devolve `%20` mais uma barra sobrando no Windows.
const caminho = (relativo: string) =>
  fromFileUrl(new URL(relativo, import.meta.url));

const TELA = Deno.readTextFileSync(
  caminho("../src/views/admin/AdminCarouselsView.tsx"),
);
const PAINEL = Deno.readTextFileSync(
  caminho("../src/components/admin/vitrines/FolhaEditarVitrine.tsx"),
);

Deno.test("calibragem: a lista de opções existe e é a que o painel desenha", () => {
  // REAGE: a lista tem valores, todos inteiros positivos. Sem isto, uma lista
  // vazia deixaria `Math.max()` devolver -Infinity e a comparação passar.
  assert(
    OPCOES_MAX_ITENS_CARROSSEL.length >= 2,
    `OPCOES_MAX_ITENS_CARROSSEL tem ${OPCOES_MAX_ITENS_CARROSSEL.length} opcao(oes). O painel oferece escolha entre varias — alguem tem de olhar, e nao seguir verde.`,
  );
  for (const n of OPCOES_MAX_ITENS_CARROSSEL) {
    assert(
      Number.isInteger(n) && n > 0,
      `opcao invalida em OPCOES_MAX_ITENS_CARROSSEL: ${n}`,
    );
  }

  // O painel DESENHA a partir da lista (uma opção por item) e a importa de lá.
  assert(
    PAINEL.includes("OPCOES_MAX_ITENS_CARROSSEL.map("),
    "FolhaEditarVitrine deixou de desenhar as quantidades a partir de OPCOES_MAX_ITENS_CARROSSEL — se agora escreve opcoes a mao, esta varredura deixou de medir o que o painel oferece.",
  );
  assert(
    PAINEL.includes('from "@/config/carrossel"'),
    "FolhaEditarVitrine nao importa a lista de src/config/carrossel",
  );

  // DISCRIMINA: sem `<select>`/`<option>` literal na tela nem no painel. Se
  // voltar um, as opcoes dele nao passam pela lista e escapam da comparacao.
  for (const [nome, fonte] of [
    ["AdminCarouselsView", TELA],
    ["FolhaEditarVitrine", PAINEL],
  ]) {
    assertEquals(
      [...fonte.matchAll(/<select\b|<option\b/g)].length,
      0,
      `${nome} voltou a ter <select>/<option> literal: as opcoes dele nao passam por OPCOES_MAX_ITENS_CARROSSEL e a varredura nao as enxerga.`,
    );
  }
});

Deno.test("o limite de carga cobre a maior opcao que o painel oferece", () => {
  const maiorOferecida = Math.max(...OPCOES_MAX_ITENS_CARROSSEL);

  assert(
    LIMITE_MAX_ITENS_CARROSSEL >= maiorOferecida,
    `LIMITE_MAX_ITENS_CARROSSEL vale ${LIMITE_MAX_ITENS_CARROSSEL}, mas o painel de vitrines oferece ate ${maiorOferecida} (opcoes: ${OPCOES_MAX_ITENS_CARROSSEL.join(", ")}).\n\nEfeito para quem usa a loja: o lojista escolhe ${maiorOferecida}, a previa do painel mostra ${maiorOferecida}, e o cliente ve ${LIMITE_MAX_ITENS_CARROSSEL} — calado.\n\nConserto: suba LIMITE_MAX_ITENS_CARROSSEL em src/config/carrossel.ts para pelo menos ${maiorOferecida}, ou tire a opcao de OPCOES_MAX_ITENS_CARROSSEL.`,
  );
});
