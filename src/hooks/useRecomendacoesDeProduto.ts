import {
  PREFIXO_DE_RECOMENDACOES,
  gravarCopiaPorProduto,
} from "@/lib/copias-por-produto";
import {
  PRAZO_DAS_RECOMENDACOES_DO_PRODUTO_MS,
  aguardarComPrazo,
  erroDeConsultaSemResposta,
} from "@/lib/prazo-da-requisicao";
import type { Product } from "@/types";
import { useCallback, useEffect, useRef, useState } from "react";

// ─── Cache SWR das recomendações (migrado do ProductView) ───────────────────

// v2 (14/10/2026): as cópias gravadas antes disto vieram da função do banco
// SEM as variações — peça com tamanho/cor aparecia como "sem variação" e ia ao
// carrinho sem escolha. Prefixo novo = nenhuma cópia antiga é servida (as
// chaves velhas ficam órfãs no aparelho, sem ninguém que as leia).
const RECS_CACHE_KEY_PREFIX = PREFIXO_DE_RECOMENDACOES;
const memoryRecsCache = new Map<string, Product[]>();

const getRecsCache = (productId: string): Product[] | null => {
  if (memoryRecsCache.has(productId)) {
    return memoryRecsCache.get(productId)!;
  }
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(
        `${RECS_CACHE_KEY_PREFIX}${productId}`,
      );
      if (stored) {
        const parsed = JSON.parse(stored);
        memoryRecsCache.set(productId, parsed);
        return parsed;
      }
    } catch (e) {
      console.error("Failed to parse recommendations cache", e);
    }
  }
  return null;
};

const updateRecsCache = (productId: string, newRecs: Product[]) => {
  // Achado 1 da revisão da frente (prova de rua 0109): lista VAZIA não é
  // valor de cache — é o resultado que congela a seção. Gravada, ela fazia
  // a próxima visita nascer "consultado" com zero itens, a seção nem
  // renderizava, o observer ficava sem alvo e a busca nunca rodava: uma
  // loja que crescia nunca ganhava recomendações de volta. Sem cache, a
  // próxima visita re-busca e a seção se cura sozinha.
  if (newRecs.length === 0) {
    memoryRecsCache.delete(productId);
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(`${RECS_CACHE_KEY_PREFIX}${productId}`);
      } catch (e) {
        console.error("Failed to clear recommendations cache", e);
      }
    }
    return;
  }
  memoryRecsCache.set(productId, newRecs);
  if (typeof window !== "undefined") {
    try {
      // Com teto (as últimas cópias) e liberando espaço se o aparelho encher.
      gravarCopiaPorProduto(
        RECS_CACHE_KEY_PREFIX,
        `${RECS_CACHE_KEY_PREFIX}${productId}`,
        JSON.stringify(newRecs),
      );
    } catch (e) {
      console.error("Failed to update recommendations cache", e);
    }
  }
};

export interface RecomendacoesDoProduto {
  recomendacoes: Product[];
  carregando: boolean;
  /** true depois que a busca do produto concluiu (ou veio do cache) — é o
   * que deixa a página DIFERENCIAR "sem recomendações" (seção some) de
   * "ainda buscando" (skeletons). */
  consultado: boolean;
  /** Relê as recomendações do produto SEM esqueleto: a lista atual fica na
   * tela até a nova chegar (falha mantém a antiga). A página chama ao voltar à
   * aba — preço, estoque ou pausa mudados no painel entram nos cards. Sem
   * efeito com a seção invisível (a próxima vez que ficar visível busca). */
  recarregar: () => void;
}

/**
 * Carrega as recomendações de um produto quando a seção fica visível.
 *
 * Defeito da prova de rua (01/09): o efeito que vivia no ProductView tinha
 * `fetchRecommendations` como dependência — e o buscador trocava de
 * identidade a cada troca da lista de produtos do contexto. Cada re-render
 * com lista nova re-disparava o efeito, o cleanup matava a busca anterior
 * (isMounted=false) e o cache nunca chegava a gravar: skeleton eterno na
 * "maioria dos produtos".
 *
 * O buscador vai por REF de propósito: re-render não re-dispara a busca —
 * só produto diferente ou a seção ficando visível. O resultado vazio é
 * DISTINGUÍVEL de "carregando" (`consultado`), para a página poder esconder
 * a seção em vez de exibir título com grid vazio.
 */
export function useRecomendacoesDeProduto(
  productId: string,
  visivel: boolean,
  buscar: (productId: string) => Promise<Product[]>,
): RecomendacoesDoProduto {
  // Cache vazio gravado por versões antigas NÃO é "já consultado": trata-se
  // como ausente para que a seção busque de novo (e se cure) — ver
  // updateRecsCache.
  const cachedInicial = getRecsCache(productId);
  const temCacheUtil = !!cachedInicial && cachedInicial.length > 0;
  const [recomendacoes, setRecomendacoes] = useState<Product[]>(() => {
    return temCacheUtil ? cachedInicial! : [];
  });
  const [carregando, setCarregando] = useState(!temCacheUtil);
  const [consultado, setConsultado] = useState(temCacheUtil);

  // O buscador troca de identidade a cada troca de `products` no contexto
  // (useCallback([products])) — e não é razão para re-buscar nada.
  const buscarRef = useRef(buscar);
  useEffect(() => {
    buscarRef.current = buscar;
  });

  // Ponte para `recarregar`: o efeito abaixo publica aqui a sua própria busca
  // (com o `isMounted` e o contador dele) e a despublica no cleanup. É por ref
  // — e não por dependência do efeito — que a releitura nunca reinicia a busca
  // em andamento nem cria laço (a armadilha de 01/09).
  const releituraRef = useRef<(() => void) | null>(null);
  const recarregar = useCallback(() => {
    releituraRef.current?.();
  }, []);

  // A busca do produto da tela FALHOU e ainda não houve resposta boa depois.
  // Sem isto, a seção ficava vazia (e sumida) mesmo depois que a internet
  // voltava. Ref, e não estado: só o efeito da volta da rede lê, e mudar isto
  // não deve render nada.
  const falhouRef = useRef(false);

  useEffect(() => {
    if (!visivel) return;

    // 1. Initial SWR cache sync
    const cached = getRecsCache(productId);
    if (cached && cached.length > 0) {
      setRecomendacoes(cached);
      setCarregando(false);
    } else {
      setRecomendacoes([]);
      setCarregando(true);
    }

    // 2. Fetch fresh data in background
    // Produto novo (ou seção que ficou visível de novo) começa limpo: uma
    // falha do produto anterior não autoriza releitura do atual.
    falhouRef.current = false;
    let isMounted = true;
    // Só a ÚLTIMA busca iniciada pode mexer na tela: a releitura de agora
    // não pode ser sobrescrita pela resposta tardia da anterior.
    let ultimaBusca = 0;
    const loadRecs = async () => {
      const minhaBusca = ++ultimaBusca;
      let recs: Product[];
      try {
        // Sem prazo, rede que conecta e não responde deixava os esqueletos
        // para sempre. Estourou = cai na falha abaixo; a resposta tardia da
        // busca abandonada é ignorada (nem tela nem cópia).
        recs = await aguardarComPrazo(
          buscarRef.current(productId),
          PRAZO_DAS_RECOMENDACOES_DO_PRODUTO_MS,
          () => erroDeConsultaSemResposta(),
        );
      } catch (err) {
        if (!isMounted || minhaBusca !== ultimaBusca) return;
        // Falha da busca (ou falta de resposta no prazo) NÃO é "sem
        // recomendações": mantém o que já está na tela e a cópia guardada
        // (memória + aparelho). Sem cópia, a lista segue vazia e a seção some
        // como sempre.
        console.error("Failed to load recommendations", err);
        falhouRef.current = true;
        setCarregando(false);
        setConsultado(true);
        return;
      }
      if (!isMounted || minhaBusca !== ultimaBusca) return;
      falhouRef.current = false;
      setRecomendacoes(recs);
      // Resposta com a leitura das variações falha é a do momento, não vale
      // como cópia: a próxima visita busca de novo.
      if (!recs.some((p) => p.variantsUnavailable)) {
        updateRecsCache(productId, recs);
      }
      setCarregando(false);
      setConsultado(true);
    };
    loadRecs();
    releituraRef.current = () => {
      void loadRecs();
    };

    return () => {
      isMounted = false;
      releituraRef.current = null;
    };
  }, [productId, visivel]);

  // A internet VOLTOU (evento `online` do navegador) depois de uma falha, com a
  // seção já pedida: refaz a consulta UMA vez. Zerar `falhouRef` ANTES de reler
  // é o que impede o laço: se a releitura falhar de novo, ela mesma volta a
  // marcar a falha, mas só o PRÓXIMO evento `online` tenta outra vez. Sucesso e
  // rede que nunca caiu não passam por aqui (`falhouRef` falso). Ouvimos o
  // evento direto, e não `useOnlineStatus`: aquele hook liga uma sonda de rede
  // a cada 15 s em toda página de produto, e aqui só a volta da rede importa.
  // Vem DEPOIS do efeito da busca para que `releituraRef` já esteja publicada.
  useEffect(() => {
    if (!visivel) return;
    const aoVoltarARede = () => {
      if (!falhouRef.current) return;
      falhouRef.current = false;
      releituraRef.current?.();
    };
    window.addEventListener("online", aoVoltarARede);
    return () => window.removeEventListener("online", aoVoltarARede);
  }, [visivel]);

  return { recomendacoes, carregando, consultado, recarregar };
}
