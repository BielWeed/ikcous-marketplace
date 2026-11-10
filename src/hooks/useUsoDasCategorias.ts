// A lista da tela "Gerenciar categorias": cada categoria com QUANTOS produtos,
// banners e regras de devolução apontam para ela (RPC `categorias_com_uso`,
// migration 20261237000000, só para a administradora).
//
// Quem conta é o servidor, na mesma régua que renomear e apagar usam para
// decidir: a tela nunca habilita "Apagar" por uma conta própria que o banco
// recusaria depois. Resposta torta é erro, nunca "lista vazia".
//
// Sem cache de propósito: é uma tela de gestão, aberta de vez em quando, e a
// contagem velha é exatamente o que ela não pode mostrar.

import {
  type CategoriaComUso,
  ErroDeCategoria,
  lerCategoriasComUso,
  mensagemDaFalhaDeCategoria,
} from "@/lib/gestao-de-categorias";
import {
  PRAZO_DA_CONSULTA_DO_PAINEL_MS,
  aguardarComPrazo,
  ehConsultaSemResposta,
  erroDeConsultaSemResposta,
} from "@/lib/prazo-da-requisicao";
import { supabase } from "@/lib/supabase";
import { useCallback, useEffect, useRef, useState } from "react";

export function useUsoDasCategorias(): {
  readonly usos: readonly CategoriaComUso[] | null;
  readonly carregando: boolean;
  readonly erro: string | null;
  readonly recarregar: () => Promise<void>;
} {
  const [usos, setUsos] = useState<readonly CategoriaComUso[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Só a resposta do pedido MAIS NOVO vale (e nenhuma depois de a tela fechar).
  const pedidoRef = useRef(0);

  const recarregar = useCallback(async () => {
    pedidoRef.current += 1;
    const meu = pedidoRef.current;
    setCarregando(true);
    setErro(null);
    try {
      const { data, error } = await aguardarComPrazo(
        Promise.resolve(supabase.rpc("categorias_com_uso")),
        PRAZO_DA_CONSULTA_DO_PAINEL_MS,
        erroDeConsultaSemResposta,
      );
      if (error) {
        throw new ErroDeCategoria(
          mensagemDaFalhaDeCategoria(error),
          error.code,
        );
      }
      const lista = lerCategoriasComUso(data);
      if (meu === pedidoRef.current) setUsos(lista);
    } catch (e) {
      if (meu === pedidoRef.current) {
        setErro(
          e instanceof ErroDeCategoria || ehConsultaSemResposta(e)
            ? (e as Error).message
            : mensagemDaFalhaDeCategoria(e),
        );
      }
    } finally {
      if (meu === pedidoRef.current) setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void recarregar();
    return () => {
      pedidoRef.current += 1;
    };
  }, [recarregar]);

  return { usos, carregando, erro, recarregar };
}
