/**
 * Por que o botão Publicar/Salvar do formulário de produto está desligado.
 *
 * O botão fica desligado enquanto faltar um campo obrigatório ou houver um
 * campo com erro — mas um botão cinza sem frase não diz à lojista o que
 * consertar (relato de cliente, 03/10/2026: "não consigo salvar o produto").
 * Esta função devolve a frase. Quem chama só a usa quando o botão JÁ está
 * desligado por validação, então ela sempre devolve algo útil.
 *
 * Os campos obrigatórios espelham o `isValid` de `AdminProductFormView`:
 * nome, descrição, categoria, preço de venda e estoque. Preço zero ou
 * negativo e estoque inválido já têm a própria mensagem embaixo do campo
 * (`priceError`/`stockError`) e chegam aqui como `temErroNoCampo`.
 */
export interface CamposObrigatoriosDoProduto {
  name: string;
  description: string;
  price: string;
  stock: string;
  category: string;
}

export function motivoDoBloqueioDoProduto(
  campos: CamposObrigatoriosDoProduto,
  temErroNoCampo: boolean,
  editando: boolean,
): string {
  const faltando: string[] = [];
  if (!campos.name) faltando.push("nome");
  if (!campos.description) faltando.push("descrição");
  if (campos.category === "") faltando.push("categoria");
  if (!campos.price) faltando.push("preço de venda");
  if (!campos.stock) faltando.push("estoque");

  const verbo = editando ? "salvar" : "publicar";
  if (faltando.length > 0) {
    return `Para ${verbo}, falta preencher: ${faltando.join(", ")}.`;
  }
  if (temErroNoCampo) {
    return `Para ${verbo}, corrija os campos que estão com aviso em vermelho.`;
  }
  return `Para ${verbo}, confira os campos do formulário.`;
}

/**
 * A frase de quando o botão está desligado porque há foto subindo. Sem ela o
 * botão ficava cinza sem explicação enquanto a compressão/o upload rodavam
 * (relato de cliente em rede lenta, 03/10/2026). `progresso` é a foto da vez
 * dentro do lote ("1 de 2"); `ajustando` é o envio do recorte de uma foto.
 */
export function motivoDoEnvioDeFotos(
  progresso: { atual: number; total: number } | null,
  ajustando: boolean,
): string {
  if (ajustando) {
    return "Enviando a foto ajustada… O botão libera quando terminar.";
  }
  if (!progresso) {
    return "Enviando fotos… O botão libera quando terminar.";
  }
  return `Enviando fotos… (${progresso.atual} de ${progresso.total}). O botão libera quando terminar.`;
}
