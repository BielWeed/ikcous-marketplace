import { descartarCodigoParaCadastro } from "@/lib/codigo-para-cadastro";
import type { View } from "@/types";
import { useEffect } from "react";

/**
 * O recado "código lido no balcão" (ver `@/lib/codigo-para-cadastro`) só vale
 * para o formulário de produto que o toque em "Cadastrar produto" abriu. Toda
 * troca de tela que NÃO termina nele o descarta, mesmo com o formulário ainda
 * baixando: senão a lojista sai para "Produtos", abre outro produto novo e o
 * código velho aparece nesse cadastro. Quem chama passa o `view` do App.
 */
export function useDescartarCodigoParaCadastro(view: View): void {
  useEffect(() => {
    if (view !== "admin-product-form") descartarCodigoParaCadastro();
  }, [view]);
}
