import {
  type VariacaoComIdParaEstoque,
  formComVariacoes,
} from "@/utils/estoque-das-variacoes";

/**
 * A peça que voltou sem tamanho foi somada a uma variação pelo aviso do topo
 * da tela do produto (`resolver_peca_sem_tamanho`, 20261642000000). O banco
 * somou 1 no estoque da variação e o gatilho avançou a versão do produto: sem
 * nada aqui, a tela continuava com o estoque de antes e a versão de antes, e o
 * Salvar seguinte era recusado ("O produto mudou enquanto você editava").
 *
 * A tela só adota a versão nova quando a ÚNICA diferença entre o produto que
 * ela tem como base e o produto relido é o estoque dessa variação (e a soma do
 * produto, que vem dela). Qualquer outra diferença é outro aparelho mexendo no
 * meio: aí a versão não é adotada e a conferência de versão do Salvar
 * continua recusando, como sempre fez — o caminho de conflito que já existe
 * junta tudo.
 */
interface CamposComGrade {
  stock: string;
  variants: VariacaoComIdParaEstoque[];
}

/** Base e banco iguais, fora o estoque de `variantId` (e a soma do produto). */
export function soMudouOEstoqueDaVariacao<F extends CamposComGrade>(
  base: F,
  banco: F,
  variantId: string,
): boolean {
  const tem = (f: F) => f.variants.some((v) => v.id === variantId);
  if (!tem(base) || !tem(banco)) return false;
  const semOEstoque = (f: F) =>
    JSON.stringify({
      ...f,
      stock: "",
      variants: f.variants.map((v) =>
        v.id === variantId ? { ...v, stockIncrement: 0 } : v,
      ),
    });
  return semOEstoque(base) === semOEstoque(banco);
}

/**
 * Os campos com o estoque de `variantId` trocado pelo do banco, e o estoque
 * do produto recalculado pela regra de sempre (`formComVariacoes`). O resto —
 * o que a lojista já digitou em qualquer outro campo — não muda.
 */
export function comOEstoqueDaVariacao<F extends CamposComGrade>(
  campos: F,
  variantId: string,
  estoque: number,
): F {
  if (!campos.variants.some((v) => v.id === variantId)) return campos;
  return formComVariacoes(
    campos,
    campos.variants.map((v) =>
      v.id === variantId ? { ...v, stockIncrement: estoque } : v,
    ),
  );
}

/**
 * Estoque é dinheiro: se a lojista já tinha mudado (sem salvar) o estoque do
 * tamanho que recebeu a peça, vale o do banco (com a peça) e a tela avisa o
 * número que ela tinha digitado (mesma regra do conflito de versão:
 * `variacoesAposConflito` também fica com o estoque do banco).
 */
export function avisoDoEstoqueDigitadoTrocado(
  rotulo: string,
  digitado: number,
  noBanco: number,
): string {
  return `O tamanho ${rotulo} recebeu a peça e agora tem ${noBanco} no estoque. O número que você tinha digitado nele (${digitado}) não foi salvo: confira e digite de novo se precisar.`;
}
