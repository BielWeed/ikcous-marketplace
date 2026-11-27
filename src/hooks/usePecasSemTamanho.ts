import { lerChaveSupabase, lerSupabaseUrl } from "@/lib/env-valores";
import {
  type PecaSemTamanho,
  type ResolucaoDaPeca,
  contarPorProduto,
  lerPecasSemTamanho,
  lerResolucao,
} from "@/lib/pecas-sem-tamanho";
import { comPrazo } from "@/utils/com-prazo";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * As peças que voltaram sem tamanho (migration 20261642000000): a lista de um
 * produto (aviso no topo da tela do produto) e a contagem por produto (selo da
 * lista de produtos).
 *
 * A leitura é SILENCIOSA: loja sem a migration (RPC ausente), rede, prazo ou
 * forma torta deixam a lista como está — sem aviso não há o que decidir, e a
 * tela do produto segue funcionando. Só a DECISÃO da lojista mostra erro.
 */

const PRAZO_DA_LEITURA_MS = 15_000;
const PRAZO_DA_DECISAO_MS = 15_000;
const NENHUMA: readonly PecaSemTamanho[] = [];

/**
 * O cliente do banco, importado sob demanda (como `useProdutosExcluidosDosBanners`):
 * o import estático faria a lista de produtos exigir as variáveis do Supabase já
 * ao carregar. Sem URL ou chave (só acontece em teste de tela sem dublê do banco;
 * o app nem sobe assim) nem tenta: o import pintaria a tela de erro do boot.
 */
async function clienteDoBanco() {
  let configurado = false;
  try {
    configurado = Boolean(lerSupabaseUrl() && lerChaveSupabase());
  } catch {
    // ficha da loja inválida: o boot já mostra o erro dele
  }
  if (!configurado) return null;
  return (await import("@/lib/supabase")).supabase;
}

async function lerPendentes(
  produtoId: string | null,
): Promise<PecaSemTamanho[] | null> {
  try {
    const supabase = await clienteDoBanco();
    if (!supabase) return null;
    // Sem sessão a RPC recusa (só o admin de agora): nem pergunta.
    const {
      data: { session },
    } = await comPrazo(supabase.auth.getSession(), PRAZO_DA_LEITURA_MS);
    if (!session) return null;
    const { data, error } = await comPrazo(
      Promise.resolve(
        supabase.rpc(
          "pecas_sem_tamanho_pendentes",
          produtoId ? { p_produto_id: produtoId } : {},
        ),
      ),
      PRAZO_DA_LEITURA_MS,
    );
    if (error) return null;
    return lerPecasSemTamanho(data);
  } catch {
    return null;
  }
}

const mesmasPecas = (
  a: readonly PecaSemTamanho[],
  b: readonly PecaSemTamanho[],
) => a.length === b.length && a.every((p, i) => p.id === b.at(i)?.id);

export function usePecasSemTamanho(produtoId: string | undefined): {
  pecas: readonly PecaSemTamanho[];
  resolver: (
    pecaId: string,
    variantId: string | null,
  ) => Promise<ResolucaoDaPeca>;
} {
  const [pecas, setPecas] = useState<readonly PecaSemTamanho[]>(NENHUMA);
  const pecasRef = useRef(pecas);
  // Cada leitura leva o número dela: a resposta de uma leitura antiga (outro
  // produto, ou anterior a uma decisão) nunca sobrescreve a mais nova.
  const leituraRef = useRef(0);

  const trocar = useCallback((novas: readonly PecaSemTamanho[]) => {
    // Sem mudança, sem setState: nada de render (nem aviso de act nos testes
    // das telas que não sabem deste aviso).
    if (mesmasPecas(pecasRef.current, novas)) return;
    pecasRef.current = novas;
    setPecas(novas);
  }, []);

  const recarregar = useCallback(
    async (produto: string | undefined, valeAinda: () => boolean) => {
      const minha = ++leituraRef.current;
      if (!produto) {
        trocar(NENHUMA);
        return;
      }
      const lidas = await lerPendentes(produto);
      if (!valeAinda() || minha !== leituraRef.current || lidas === null)
        return;
      trocar(lidas);
    },
    [trocar],
  );

  useEffect(() => {
    let vale = true;
    void recarregar(produtoId, () => vale);
    return () => {
      vale = false;
    };
  }, [produtoId, recarregar]);

  const resolver = useCallback(
    async (pecaId: string, variantId: string | null) => {
      const supabase = await clienteDoBanco();
      if (!supabase) throw new Error("Banco não configurado.");
      const { data, error } = await comPrazo(
        Promise.resolve(
          supabase.rpc("resolver_peca_sem_tamanho", {
            p_peca_id: pecaId,
            p_variant_id: variantId,
          }),
        ),
        PRAZO_DA_DECISAO_MS,
      );
      if (error) {
        // A peça sumiu (outro aparelho, rollback): a lista na tela está velha.
        if ((error as { code?: string }).code === "P0002")
          void recarregar(produtoId, () => true);
        throw error;
      }
      const resolucao = lerResolucao(data);
      if (!resolucao) throw new Error("Resposta inesperada do banco.");
      leituraRef.current++;
      trocar(pecasRef.current.filter((p) => p.id !== pecaId));
      void recarregar(produtoId, () => true);
      return resolucao;
    },
    [produtoId, recarregar, trocar],
  );

  return { pecas, resolver };
}

/**
 * Quantas peças esperam, por produto (o selo da lista de produtos). Só lê com a
 * lista ATIVA (ela fica montada atrás das outras abas do painel) e relê a cada
 * vez que ela volta a ficar ativa — inclusive na volta da tela do produto, onde
 * a lojista decide as peças.
 */
export function useContagemDePecasSemTamanho(
  ativa: boolean,
): ReadonlyMap<string, number> {
  const [contagem, setContagem] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  const assinaturaRef = useRef("");
  const leituraRef = useRef(0);

  useEffect(() => {
    if (!ativa) return;
    let vivo = true;
    const ler = async () => {
      const minha = ++leituraRef.current;
      const lidas = await lerPendentes(null);
      if (!vivo || minha !== leituraRef.current || lidas === null) return;
      const nova = contarPorProduto(lidas);
      const assinatura = JSON.stringify([...nova].sort());
      if (assinatura === assinaturaRef.current) return;
      assinaturaRef.current = assinatura;
      setContagem(nova);
    };
    void ler();
    return () => {
      vivo = false;
    };
  }, [ativa]);

  return contagem;
}

/**
 * Os produtos com peça desta devolução esperando o tamanho (origem
 * 'devolucao', pedido `orderId`): a ficha da devolução troca "voltou ao
 * estoque" pelo aviso da peça sem tamanho. `undefined` não pergunta nada (a
 * ficha só pergunta quando há item sem variação que voltou). `null` = não sei
 * (loja sem a migration, rede, forma torta): a ficha diz o que dizia antes.
 * Peça já decidida sai da lista do banco, e o item volta a "voltou ao estoque".
 * `releitura` muda quando os itens que voltaram mudam (a ficha relida).
 */
export function useProdutosComPecaSemTamanhoDaDevolucao(
  orderId: string | undefined,
  releitura: string,
): ReadonlySet<string> | null {
  const [produtos, setProdutos] = useState<{
    chave: string;
    ids: ReadonlySet<string>;
  } | null>(null);
  const chave = orderId ? `${orderId}|${releitura}` : "";

  useEffect(() => {
    if (!orderId) return;
    let vivo = true;
    void lerPendentes(null).then((lidas) => {
      if (!vivo || lidas === null) return;
      const ids = new Set(
        lidas
          .filter((p) => p.orderId === orderId && p.origem === "devolucao")
          .map((p) => p.produtoId),
      );
      setProdutos({ chave: `${orderId}|${releitura}`, ids });
    });
    return () => {
      vivo = false;
    };
  }, [orderId, releitura]);

  return produtos?.chave === chave ? produtos.ids : null;
}
