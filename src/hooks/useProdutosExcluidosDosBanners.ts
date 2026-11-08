import {
  aguardarComPrazo,
  erroDeConsultaSemResposta,
} from "@/lib/prazo-da-requisicao";
import { useEffect, useState } from "react";

// Excluir um produto deixa o banner dele no ar: a cliente toca e cai na Home
// com "Este produto não está mais disponível". A lista de produtos do painel é
// paginada, então "não achei na lista" não prova exclusão; quem prova é o banco.
//
// UMA consulta pequena, só dos ids que os banners apontam. Em `vw_produtos_admin`
// (a visão do painel NÃO filtra os excluídos: o produto excluído continua lá com
// `deleted_at` preenchido). Só conta como excluído o produto que o banco
// DEVOLVE com `deleted_at` — id ausente da resposta, erro e demora são "não
// sei": a visão responde vazio quando a sessão perde o acesso de administradora,
// e um aviso falso na tela da lojista é pior que nenhum aviso.
const PRAZO_DA_CONSULTA_MS = 15_000;
// Id fora deste formato derrubaria a consulta inteira (o banco recusa o id).
const ID_DE_PRODUTO =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Teto que guarda o tamanho do endereço da consulta.
const TETO_DE_IDS = 100;
const NENHUM: ReadonlySet<string> = new Set();

/**
 * Os ids (entre os pedidos) que o banco confirma como de produto excluído.
 * Só consulta com a tela ativa e refaz quando ela volta a ficar ativa: o
 * produto pode ter sido excluído na tela de Produtos, que fica montada por baixo.
 */
export function useProdutosExcluidosDosBanners(
  idsDeProdutos: readonly string[],
  ativo: boolean,
): ReadonlySet<string> {
  const chave = [
    ...new Set(idsDeProdutos.filter((id) => ID_DE_PRODUTO.test(id))),
  ]
    .sort()
    .slice(0, TETO_DE_IDS)
    .join(",");
  const [excluidos, setExcluidos] = useState<ReadonlySet<string>>(NENHUM);

  useEffect(() => {
    if (!ativo || chave === "") return;
    let cancelada = false;
    (async () => {
      try {
        const { data, error } = await aguardarComPrazo(
          // Import sob demanda (mesmo motivo de `descartar-fotos-do-produto.ts`):
          // o import estático faria toda tela que importa a lista de Banners
          // exigir as variáveis do Supabase já ao carregar (EnvGuard).
          import("@/lib/supabase").then(({ supabase }) =>
            supabase
              .from("vw_produtos_admin")
              .select("id, deleted_at")
              .in("id", chave.split(",")),
          ),
          PRAZO_DA_CONSULTA_MS,
          () => erroDeConsultaSemResposta(),
        );
        if (error || cancelada) return;
        setExcluidos(
          new Set(
            (data ?? [])
              .filter((linha) => linha.id && linha.deleted_at)
              .map((linha) => linha.id as string),
          ),
        );
      } catch {
        // Sem resposta ou erro: "não sei" — fica sem aviso.
      }
    })();
    return () => {
      cancelada = true;
    };
  }, [chave, ativo]);

  return chave === "" ? NENHUM : excluidos;
}
