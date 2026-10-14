// Quem renomeou, escondeu ou apagou uma categoria avisa aqui; as telas que
// guardam o NOME da categoria (o filtro lembrado da lista de produtos, o campo
// "Categoria" do formulário aberto) se acertam sozinhas, de onde quer que a
// tela "Gerenciar categorias" tenha sido aberta.
//
// Módulo próprio, sem dependência, de propósito: as telas só precisam OUVIR, e
// não devem importar o hook de categorias (que carrega cofre e rede) só para isso.

import type { MudancaDeCategoria } from "@/lib/gestao-de-categorias";

type Ouvinte = (mudanca: MudancaDeCategoria) => void;

const ouvintes = new Set<Ouvinte>();

/** Passa a ouvir; devolve a função que para de ouvir. */
export function assinarMudancasDeCategoria(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function publicarMudancaDeCategoria(mudanca: MudancaDeCategoria): void {
  for (const ouvinte of [...ouvintes]) ouvinte(mudanca);
}
