// Receita, devoluções e imposto de UM mês, lidos da MESMA DRE que a lojista vê em
// Resultado. Assim o número da aba Impostos nunca diverge do Resultado, e não existe
// uma segunda definição de "receita" para manter em dia com o banco.
//
// Função pura (sem rede, sem React). Dinheiro aqui é `number` em reais já arredondado
// ao centavo pelos parsers de `src/lib/financeiro.ts`; a soma é feita em CENTAVOS
// inteiros (como `totaisDosPrevistos`) para 0,10 + 0,20 dar exatamente 0,30.
//
// O contrato é com `fin_dre` (corpo vigente na 20261405900000). O que ele garante e
// que esta função usa:
//   - `receitaOnline` / `receitaBalcao` são as vendas do mês (pela data do dinheiro);
//   - o array `linhas` começa pelo bloco DERIVADO (vendas pelo app > 0, vendas na loja
//     física > 0, "Estornos e devoluções" > 0, custo das mercadorias <> 0, só as que
//     existem) e SÓ DEPOIS vêm as linhas das categorias lançadas à mão;
//   - a DRE não manda o id da categoria, só o nome, e o nome da categoria NÃO é único.

import { paraCentavos } from "@/lib/financeiro";
import type {
  CategoriaFinanceira,
  DreFinanceira,
  GrupoDaDre,
  LinhaDaDre,
} from "@/types/financeiro";

/** Categoria de sistema "Impostos sobre vendas (DAS/Simples)"; o NOME dela a lojista pode trocar. */
export const CATEGORIA_DE_IMPOSTOS_ID = "f2000000-0000-4000-8000-000000000011";

/** Nome que o `fin_dre` escreve na linha de dedução derivada dos estornos e devoluções. */
export const NOME_DA_LINHA_DE_DEVOLUCOES = "Estornos e devoluções";

export interface ReceitaDoMes {
  /** Vendas pelo app + vendas na loja física. Não inclui "outras receitas" lançadas à mão. */
  readonly receita: number;
  /** Estornos e devoluções que o BANCO derivou dos pedidos (nunca a categoria manual homônima). */
  readonly devolucoes: number;
  /**
   * Linhas da categoria de impostos no mês (previstas e pagas, pela competência, como
   * o Resultado), no grupo em que ela está AGORA. `null` = não deu para saber: a
   * categoria não foi achada, está sem nome ou foi para `fora_dre` (o `fin_dre` nem
   * emite a linha dela). Isso NÃO é "zero imposto", e quem mostra o número tem de
   * dizer que não sabe.
   */
  readonly imposto: number | null;
}

const deCentavos = (centavos: number): number => centavos / 100;

/** A categoria de impostos como está AGORA: o nome e o grupo da DRE que a lojista deu a ela. */
export interface CategoriaDeImpostos {
  readonly nome: string;
  readonly grupoDre: GrupoDaDre;
}

/**
 * O nome e o grupo atuais da categoria de impostos, achada pelo ID fixo. A lojista pode
 * trocar os dois (tela "Linha do resultado"), e a DRE devolve a linha no grupo novo.
 * `null` se não achar ou se o nome estiver em branco.
 */
export function nomeDaCategoriaDeImpostos(
  categorias: readonly Pick<CategoriaFinanceira, "id" | "nome" | "grupoDre">[],
): CategoriaDeImpostos | null {
  const categoria = categorias.find((c) => c.id === CATEGORIA_DE_IMPOSTOS_ID);
  const nome = categoria?.nome.trim() ?? "";
  return categoria === undefined || nome === ""
    ? null
    : { nome, grupoDre: categoria.grupoDre };
}

/**
 * A linha DERIVADA de devoluções, ou `null` se o banco não a emitiu (ele só emite
 * quando houve estorno no mês).
 *
 * Por que posição e não "a primeira linha com esse nome": sem estorno no mês a derivada
 * não existe, e uma categoria manual da lojista com o mesmo nome viraria "a primeira".
 * O bloco derivado é previsível: as linhas de venda existem exatamente quando
 * `receitaOnline` / `receitaBalcao` são > 0, então a derivada, quando existe, é a
 * próxima.
 *
 * Limite conhecido, que a DRE não deixa resolver: sem estorno, sem custo (`cmv` zero)
 * e sem nenhuma receita manual, a primeira linha manual cai exatamente nessa posição e
 * é indistinguível da derivada. Acontece se a lojista criar uma categoria de dedução
 * com este mesmo nome, ou RENOMEAR a categoria de sistema "Devoluções e estornos"
 * (id ...010) para "Estornos e devoluções" e lançar nela. Nos dois casos a homônima
 * ainda precisa ser a maior dedução do mês, porque as manuais saem do banco da maior
 * para a menor e só a primeira cai na posição da derivada.
 */
function linhaDerivadaDeDevolucoes(dre: DreFinanceira): LinhaDaDre | null {
  const linhasDeVenda =
    (paraCentavos(dre.receitaOnline) > 0 ? 1 : 0) +
    (paraCentavos(dre.receitaBalcao) > 0 ? 1 : 0);
  // `slice` e não `linhas[n]`: a posição é calculada, e assim nunca vira índice negativo.
  const [candidata] = dre.linhas.slice(linhasDeVenda, linhasDeVenda + 1);
  return candidata?.grupo === "deducao" &&
    candidata.categoria === NOME_DA_LINHA_DE_DEVOLUCOES
    ? candidata
    : null;
}

/**
 * @param impostos a categoria de impostos como está AGORA (nome e grupo, que a lojista
 *   pode trocar), lida da lista de categorias pelo ID fixo (`nomeDaCategoriaDeImpostos`).
 *   Nunca um texto escrito no código. `null` = não achada.
 */
export function receitaDoMes(
  dre: DreFinanceira,
  impostos: CategoriaDeImpostos | null,
): ReceitaDoMes {
  const receita = deCentavos(
    paraCentavos(dre.receitaOnline) + paraCentavos(dre.receitaBalcao),
  );

  const derivada = linhaDerivadaDeDevolucoes(dre);
  const devolucoes = derivada ? deCentavos(paraCentavos(derivada.valor)) : 0;

  const nome = impostos?.nome.trim() ?? "";
  let imposto: number | null = null;
  // `fora_dre`: o `fin_dre` filtra essas categorias fora, então "sem linha" não quer
  // dizer "sem imposto", quer dizer que a DRE não olha para ela.
  if (impostos !== null && nome !== "" && impostos.grupoDre !== "fora_dre") {
    let centavos = 0;
    for (const l of dre.linhas) {
      // A derivada nunca é imposto, mesmo que a lojista tenha dado à categoria de
      // impostos o nome "Estornos e devoluções".
      if (l === derivada) continue;
      if (l.grupo === impostos.grupoDre && l.categoria.trim() === nome) {
        centavos += paraCentavos(l.valor);
      }
    }
    imposto = deCentavos(centavos);
  }

  return { receita, devolucoes, imposto };
}
