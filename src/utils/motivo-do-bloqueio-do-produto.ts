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

/**
 * Os obrigatórios que ainda estão vazios, na ordem da tela, cada um com o id do
 * campo. A frase do bloqueio e o toque que leva ao campo usam ESTA lista: o
 * texto fala do mesmo campo para onde o toque leva.
 */
export function camposQueFaltam(
  campos: CamposObrigatoriosDoProduto,
): { nome: string; id: string }[] {
  const faltam: { nome: string; id: string }[] = [];
  if (!campos.name) faltam.push({ nome: "nome", id: "product-name" });
  if (!campos.description)
    faltam.push({ nome: "descrição", id: "product-description" });
  if (campos.category === "")
    faltam.push({ nome: "categoria", id: "product-category" });
  if (!campos.price)
    faltam.push({ nome: "preço de venda", id: "product-sale-price" });
  if (!campos.stock) faltam.push({ nome: "estoque", id: "product-stock" });
  return faltam;
}

export function motivoDoBloqueioDoProduto(
  campos: CamposObrigatoriosDoProduto,
  temErroNoCampo: boolean,
  editando: boolean,
  /** Promoção ligada com o "De:" vazio: sem o preço original não há promoção. */
  promocaoSemPrecoOriginal = false,
): string {
  const faltando = camposQueFaltam(campos).map((c) => c.nome);

  const verbo = editando ? "salvar" : "publicar";
  if (faltando.length > 0) {
    return `Para ${verbo}, falta preencher: ${faltando.join(", ")}.`;
  }
  if (promocaoSemPrecoOriginal) {
    return 'Escreva o preço de antes ("De") ou desligue a promoção.';
  }
  if (temErroNoCampo) {
    return `Para ${verbo}, corrija os campos que estão com aviso em vermelho.`;
  }
  return `Para ${verbo}, confira os campos do formulário.`;
}

/**
 * A mesma conta de `motivoDoBloqueioDoProduto`, em poucas palavras, para a
 * linha única da barra de baixo. A frase COMPLETA (com a lista do que falta)
 * continua no nome acessível e no título da barra: esta é só o que cabe na
 * tela do celular. A ordem das causas é a da frase completa.
 */
export function fraseCurtaDoBloqueio(
  campos: CamposObrigatoriosDoProduto,
  temErroNoCampo: boolean,
  promocaoSemPrecoOriginal = false,
): string {
  const faltam = camposQueFaltam(campos).length;
  if (faltam === 1) return "Falta 1 campo";
  if (faltam > 1) return `Faltam ${faltam} campos`;
  if (promocaoSemPrecoOriginal) return "Falta o preço de antes";
  if (temErroNoCampo) return "Corrija os avisos";
  return "Confira os campos";
}

/** A versão curta de `motivoDoEnvioDeFotos`, para a linha única da barra. */
export function fraseCurtaDoEnvioDeFotos(
  progresso: { atual: number; total: number } | null,
  ajustando: boolean,
): string {
  if (ajustando) return "Enviando a foto ajustada…";
  if (!progresso) return "Enviando fotos…";
  return `Enviando fotos… (${progresso.atual} de ${progresso.total})`;
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
