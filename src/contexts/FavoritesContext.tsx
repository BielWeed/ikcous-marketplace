import { useAuth } from "@/hooks/useAuth";
import { useLeaderElection } from "@/hooks/useLeaderElection";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useProducts } from "@/hooks/useProducts";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types";
import React, {
  createContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { toast } from "sonner";

const FAVORITES_KEY = "ikcous_favorites";

// Achado 2 da revisão de contexto limpo (26/08/2026) — a chave anônima
// (FAVORITES_KEY) estava guardando DUAS coisas diferentes: (a) o favorito
// de um visitante sem conta, do aparelho, sem dono; e (b) a sincronização
// pendente de um usuário IDENTIFICADO que falhou ao subir. Num aparelho
// compartilhado (balcão da loja, tablet de casa), isso vazava o que o
// usuário A favoritou para o próximo visitante B, porque os dois liam a
// MESMA chave. A correção separa: o que falha ao gravar vai para uma
// chave POR USUÁRIO, nunca de volta para o balde anônimo.
//
// ⚠️ Nota para quem mexer em limpeza de dado pessoal no logout
// (`AuthContext.tsx`, a varredura por prefixo perto de `isCriticalTransition`):
// a chave que esta função gera (`ikcous_favorites_pendentes:<uuid>`) fica DE
// PROPÓSITO fora dessa varredura. Ela é uma escrita PENDENTE — apagá-la no
// logout perderia, para sempre, um favorito que só existe ali porque a rede
// falhou. Se um dia a varredura de aparelho compartilhado passar a incluir
// esse prefixo, o vazamento entre contas que este arquivo inteiro existe
// para evitar volta a acontecer, por outro caminho.
function getPendingFavoritesKey(userId: string): string {
  return `ikcous_favorites_pendentes:${userId}`;
}

function lerFavoritosPendentes(userId: string): Product[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(getPendingFavoritesKey(userId));
    return raw ? (JSON.parse(raw) as Product[]) : [];
  } catch (err) {
    console.error("Failed to read pending favorites", err);
    return [];
  }
}

function gravarFavoritosPendentes(userId: string, items: Product[]): void {
  if (typeof window === "undefined") return;
  try {
    if (items.length === 0) {
      localStorage.removeItem(getPendingFavoritesKey(userId));
    } else {
      localStorage.setItem(
        getPendingFavoritesKey(userId),
        JSON.stringify(items),
      );
    }
  } catch (err) {
    console.error("Failed to write pending favorites", err);
  }
}

// Correção (26/08/2026) — a fila pendente só sabia ENTRAR. `addToFavorites`
// e `removeFromFavorites` nunca a tocavam: um favorito que confirmava (ou
// era removido) por um desses dois caminhos — fora da retentativa — ficava
// "esquecido" em disco, e a próxima retentativa (evento `online`, ou
// simplesmente montar o Provider de novo — o efeito de sync lê a fila em
// TODA montagem, inclusive um F5) o ressuscitava, mesmo depois de a pessoa
// ter removido de propósito.
//
// Este helper faz LEIA-MODIFIQUE-ESCREVA sobre a fila em disco: nunca
// sobrescreve o arquivo inteiro a partir de um retrato antigo (`candidatos`
// capturado antes de um `await`) — isso reintroduziria a corrida que matou
// as rodadas 2 a 4 (ver o comentário grande acima do memo de `favorites`).
// Ele só remove os ids indicados do que estiver em disco NO INSTANTE da
// chamada, então uma retirada concorrente (o usuário removeu enquanto uma
// drenagem de outro caminho estava em voo) nunca é desfeita por uma escrita
// tardia: cada chamador relê o disco fresco, nunca um retrato antigo.
function retirarDaFilaPendentes(userId: string, ids: string[]): Product[] {
  const atual = lerFavoritosPendentes(userId);
  if (ids.length === 0) return atual;
  const restante = atual.filter((p) => !ids.includes(p.id));
  if (restante.length !== atual.length) {
    gravarFavoritosPendentes(userId, restante);
  }
  return restante;
}

function mesclarSemDuplicar(listas: Product[][]): Product[] {
  const mapa = new Map<string, Product>();
  for (const lista of listas) {
    for (const p of lista) mapa.set(p.id, p);
  }
  return Array.from(mapa.values());
}

interface FavoritesContextType {
  favorites: Product[];
  toggleFavorite: (product: Product) => void;
  isFavorite: (productId: string) => boolean;
  loading: boolean;
  // Falha de fetch ≠ lista vazia: sem este estado, a tela de Favoritos
  // dizia "sua lista tá tão vazia" para uma lista que a consulta não
  // conseguiu trazer — e o refresh dá à cliente o tentar de novo.
  erro: string | null;
  refresh: () => void;
  // Redesenho subtrativo (26/08/2026, revisão de contexto limpo) — quantos
  // favoritos estão retidos na fila write-ahead esperando a rede voltar.
  // Este número NUNCA soma à contagem de favoritos confirmados
  // (`favorites.length`) e não descreve itens tocáveis: é só o material
  // para uma linha informativa ("N favoritos ainda estão sendo salvos") em
  // quem consumir este contexto. Ver o comentário grande abaixo, antes do
  // memo de `favorites`, sobre por que os pendentes pararam de entrar nele.
  pendingCount: number;
}

export const FavoritesContext = createContext<FavoritesContextType | undefined>(
  undefined,
);

export function FavoritesProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { user } = useAuth();
  const { isLeader } = useLeaderElection();
  const { products: allProducts } = useProducts();
  const [localFavorites, setLocalFavorites] = useLocalStorage<Product[]>(
    FAVORITES_KEY,
    [],
  );
  const [dbFavoriteIds, setDbFavoriteIds] = useState<string[]>([]);
  // Escrita pendente de um usuário IDENTIFICADO que falhou ao sincronizar
  // — chave por usuário, nunca a chave anônima (ver getPendingFavoritesKey
  // acima). Inicializa direto do localStorage para não piscar `pendingCount`
  // errado no primeiro render de quem já tinha pendência de uma sessão
  // anterior. Esta fila é só um BUFFER DE RETENTATIVA: ela não entra em
  // `favorites`, `isFavorite` nem `toggleFavorite` (ver o comentário grande
  // mais abaixo) — só alimenta `pendingCount`.
  const [pendingFavorites, setPendingFavorites] = useState<Product[]>(() =>
    user ? lerFavoritosPendentes(user.id) : [],
  );
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Detecta troca de conta SEM passar por `null` (AuthContext.tsx:579-583,
  // `isCriticalTransition`) — é o gatilho real do vazamento entre A e B: sem
  // isto, o efeito de sync abaixo só sabe que `user` MUDOU, nunca se o
  // usuário anterior era outra pessoa (troca) ou ninguém (login normal).
  const previousUserIdRef = useRef<string | null>(user?.id ?? null);

  const fetchDbFavorites = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("favorites")
        .select("product_id")
        .eq("user_id", user.id);

      if (error) {
        console.error("Error fetching favorites", error);
        setErro("Não conseguimos carregar seus favoritos.");
      } else if (data) {
        const newIds = data.map((f) => f.product_id);
        setDbFavoriteIds(newIds);
        setErro(null);
      }
    } catch (err) {
      console.error("Fetch favorites failed", err);
      setErro("Não conseguimos carregar seus favoritos.");
    }
  }, [user]);

  // Tenta gravar `candidatos` no servidor para `userId`, grava o que
  // falhar na fila PENDENTE daquele usuário (nunca no balde anônimo) e
  // atualiza o estado em memória. Usada tanto no login (mesclando o balde
  // anônimo com uma pendência que já existia) quanto na retentativa.
  //
  // Redesenho subtrativo (26/08/2026) — esta função tinha uma segunda
  // responsabilidade: desfazer, com um DELETE compensatório, um upsert que
  // aterrissasse DEPOIS que a pessoa já tivesse cancelado o mesmo produto
  // pendente (via um `Set` de marcas, `canceladosRef`, checado aqui dentro
  // depois do `await`). Essa marca não distinguia DE QUEM era o
  // cancelamento — era um `Set<productId>` só, vivo pelo tempo de vida do
  // Provider inteiro, nunca esvaziado na troca de conta. Se o produto p1
  // fosse cancelado enquanto o upsert de A ainda estava em voo, e DEPOIS —
  // antes desse upsert resolver — outra conta B (mesmo aparelho, sem
  // logout) sincronizasse com sucesso o MESMO product_id p1 (coincidência
  // de catálogo, não de dono), o sucesso de B também consumia a marca
  // deixada por A e disparava um DELETE usando o `userId` de B — apagando
  // o favorito de B por uma ação que nunca foi dele. Esse mecanismo saiu
  // inteiro: a razão de existir dele (permitir cancelar um favorito ainda
  // pendente) também saiu — ver o comentário grande antes do memo de
  // `favorites` sobre por que pendente deixou de ser tocável.
  const tentarSincronizarComServidor = useCallback(
    async (userId: string, candidatos: Product[]) => {
      if (candidatos.length === 0) {
        gravarFavoritosPendentes(userId, []);
        setPendingFavorites([]);
        return { total: 0, sincronizados: 0 };
      }

      // O cliente do Supabase não rejeita a promessa em falha
      // (shouldThrowOnError=false por padrão), então o `{ error }` de cada
      // upsert precisa ser lido individualmente.
      const resultados = await Promise.all(
        candidatos.map(async (p) => {
          const { error } = await supabase
            .from("favorites")
            .upsert(
              { user_id: userId, product_id: p.id },
              { onConflict: "user_id,product_id", ignoreDuplicates: true },
            );
          return { produto: p, error };
        }),
      );

      const naoSincronizados = resultados
        .filter((r) => r.error)
        .map((r) => r.produto);

      if (naoSincronizados.length > 0) {
        console.error(
          "Sync parcial de favoritos falhou",
          resultados.filter((r) => r.error),
        );
      }

      // Armadilha (26/08/2026): a versão anterior desta linha era
      // `gravarFavoritosPendentes(userId, naoSincronizados)` — sobrescrevia o
      // disco inteiro com um retrato calculado ANTES do `await Promise.all`
      // acima. Se, enquanto os upserts estavam em voo, `addToFavorites` ou
      // `removeFromFavorites` retirasse um item da fila (ver
      // `retirarDaFilaPendentes`), essa sobrescrita cega o devolvia — "o
      // último que escreve ganha" contra uma retirada que já tinha
      // acontecido. Retirar só os ids que SINCRONIZARAM AGORA, de cima do
      // que estiver em disco no instante em que este `await` termina, evita
      // isso: uma retirada concorrente já não está mais lá para ser
      // retirada de novo, e não é reintroduzida.
      const idsSincronizadosAgora = resultados
        .filter((r) => !r.error)
        .map((r) => r.produto.id);
      const restante = retirarDaFilaPendentes(userId, idsSincronizadosAgora);
      setPendingFavorites(restante);

      return {
        total: resultados.length,
        sincronizados: resultados.length - naoSincronizados.length,
      };
    },
    [],
  );

  // 1. Sync Logic: When User logs in, merge Local -> DB
  useEffect(() => {
    const userIdAnterior = previousUserIdRef.current;
    const userIdAtual = user?.id ?? null;
    const trocouDeConta = userIdAnterior !== userIdAtual;
    previousUserIdRef.current = userIdAtual;

    if (!user) {
      setDbFavoriteIds([]);
      setPendingFavorites([]);
      setLoading(false);
      return;
    }

    // Achado 1 da revisão de contexto limpo (26/08/2026) — troca de conta
    // SEM passar por `null` (AuthContext.tsx:579-583, `isCriticalTransition`)
    // deixava `dbFavoriteIds`/`pendingFavorites` com os dados do usuário
    // ANTERIOR na tela até este efeito assíncrono terminar (fetchDbFavorites
    // + tentativa de sync). Zera os dois ANTES de qualquer `await`: a pessoa
    // que acabou de entrar não pode ver, nem por um instante mais longo do
    // que o necessário, o que a anterior favoritou no mesmo aparelho — e,
    // com o redesenho abaixo, `pendingFavorites` só alimenta `pendingCount`,
    // então isto também impede o CONTADOR de A aparecer, mesmo que só por um
    // instante, na tela de B.
    if (trocouDeConta) {
      setDbFavoriteIds([]);
      setPendingFavorites([]);
    }

    const syncFavorites = async () => {
      setLoading(true);

      try {
        // A lista anônima ("ikcous_favorites") muda de dono no login —
        // SEMPRE, com sucesso ou com falha na gravação. Se ela ficasse
        // parada esperando confirmação, o próximo visitante no mesmo
        // aparelho (balcão da loja, tablet de casa) herdaria o favorito de
        // quem acabou de sair. O que não gravar vai para a fila deste
        // usuário, nunca de volta para o balde anônimo.
        const pendentesDaSessaoAnterior = lerFavoritosPendentes(user.id);
        const candidatos = mesclarSemDuplicar([
          localFavorites,
          pendentesDaSessaoAnterior,
        ]);

        // Achado 2 (26/08/2026) — WRITE-AHEAD, e correção da MINHA instrução
        // original ("a chave anônima muda de dono SEMPRE"): implementada ao
        // pé da letra, o balde anônimo era apagado ANTES do `await` da
        // gravação no servidor, e a fila por usuário só era escrita DEPOIS
        // que a rede respondia — entre os dois instantes os favoritos
        // existiam só na memória do React. A aba morrendo nessa janela
        // (fechar, recarregar, o navegador matando a aba, ou o próprio
        // GlobalErrorBoundary chamando `window.location.reload()`) perdia
        // tudo para sempre — uma perda que o balde anônimo, sozinho, não
        // tinha. Gravar `candidatos` na fila deste usuário AQUI, antes de
        // tocar no balde anônimo (abaixo) e antes de qualquer tentativa de
        // rede, garante que o disco NUNCA fica sem os favoritos: o pior caso
        // vira "sobrou fila que já sincronizou" (recuperável na próxima
        // retentativa), nunca "sumiu" (irrecuperável). O resultado do upsert
        // só ENCOLHE esta fila — `tentarSincronizarComServidor` retira (não
        // sobrescreve) o que sincronizou ao final, e `addToFavorites` /
        // `removeFromFavorites` também retiram pontualmente (ver
        // `retirarDaFilaPendentes`). Isto continua valendo palavra por
        // palavra no redesenho: só MUDOU o que a fila alimenta na tela.
        gravarFavoritosPendentes(user.id, candidatos);
        setPendingFavorites(candidatos);

        if (localFavorites.length > 0) {
          setLocalFavorites([]);
          if (typeof window !== "undefined") {
            localStorage.removeItem(FAVORITES_KEY);
          }
        }

        if (candidatos.length > 0) {
          const { total, sincronizados } = await tentarSincronizarComServidor(
            user.id,
            candidatos,
          );

          if (sincronizados < total) {
            if (sincronizados > 0) {
              toast.error(
                `${sincronizados} de ${total} favoritos foram sincronizados. Os demais continuam salvos e vamos tentar de novo quando a conexão voltar.`,
              );
            } else {
              toast.error(
                "Não conseguimos sincronizar seus favoritos agora. Vamos tentar de novo quando a conexão voltar.",
              );
            }
          } else {
            toast.success("Seus favoritos locais foram sincronizados!");
          }
        }

        // B. Fetch from DB
        await fetchDbFavorites();
      } catch (err) {
        console.error("Sync failed", err);
      } finally {
        setLoading(false);
      }
    };

    syncFavorites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, fetchDbFavorites]);

  // Retentativa da fila pendente: a promessa que o toast acima faz
  // ("vamos tentar de novo quando a conexão voltar") só é verdadeira se
  // algo de fato tentar de novo nesta mesma sessão — antes disso, o efeito
  // acima só reagia a uma nova montagem. `online` é o sinal mais direto de
  // "a conexão voltou" para o cenário que gerou a pendência (escrita feita
  // sem rede).
  useEffect(() => {
    if (!user || typeof window === "undefined") return;

    // Achado 1 (26/08/2026) — a fila é lida do DISCO, pelo `user.id` deste
    // fechamento, NO INSTANTE em que o evento dispara — nunca do
    // `pendingFavorites` do render. `user` e `pendingFavorites` mudam em
    // COMMITS diferentes (troca de conta A->B sem passar por `null`,
    // AuthContext.tsx:579-583, `isCriticalTransition`): um efeito que
    // dependesse de `pendingFavorites` podia religar já com o `user` NOVO
    // mas com a fila do usuário ANTERIOR ainda presa no fechamento — e
    // gravar os favoritos de A na conta de B quando `online` disparasse
    // (o gatilho real: rede instável é a mesma causa que gerou a
    // pendência). Ler do disco aqui dentro, e tirar `pendingFavorites` das
    // deps, elimina essa janela: a fila é sempre a de quem está logado
    // AGORA, porque `gravarFavoritosPendentes` só grava sob a chave deste
    // usuário.
    const retentar = () => {
      const filaAtual = lerFavoritosPendentes(user.id);
      if (filaAtual.length === 0) return;

      tentarSincronizarComServidor(user.id, filaAtual).then(
        ({ total, sincronizados }) => {
          // Achado 1 da revisão de contexto limpo (26/08/2026) — a
          // retentativa bem-sucedida não relia o servidor: o aviso dizia
          // "foram sincronizados!" e `favorites` continuava com o retrato
          // antigo de `dbFavoriteIds`, porque nada tinha chamado
          // `fetchDbFavorites()` de novo. A tela só se corrigia sozinha se
          // ALGO MAIS disparasse um novo fetch depois — nada garantia isso.
          if (sincronizados > 0) {
            fetchDbFavorites();
          }
          if (total > 0 && sincronizados === total) {
            toast.success("Seus favoritos pendentes foram sincronizados!");
          }
        },
      );
    };

    window.addEventListener("online", retentar);
    return () => window.removeEventListener("online", retentar);
  }, [user, tentarSincronizarComServidor, fetchDbFavorites]);

  // Realtime Sync for Favorites
  useEffect(() => {
    const bc =
      typeof window !== "undefined"
        ? new BroadcastChannel("ikcous_favorites_sync")
        : null;
    let channel: any = null;
    let bcListener: ((event: MessageEvent) => void) | null = null;

    if (user) {
      if (isLeader) {
        console.log(
          "[Favorites] Leader tab subscribing to database favorites...",
        );
        channel = supabase
          .channel(`favorites:${user.id}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "favorites",
              filter: `user_id=eq.${user.id}`,
            },
            () => {
              console.log(
                "[Favorites-Leader] Favorites change detected in database",
              );
              fetchDbFavorites();
              bc?.postMessage({ type: "favorites_update" });
            },
          )
          .subscribe((status: any, err?: any) => {
            if (status === "CHANNEL_ERROR") {
              const errMessage =
                err?.message || (typeof err === "string" ? err : "");
              const isNormalClose =
                errMessage.includes("1000") || errMessage.includes("normal");
              const isAbnormalClose =
                errMessage.includes("1006") || errMessage.includes("abnormal");
              if (isNormalClose) {
                console.log(
                  "[Favorites] Channel closed normally (socket closed: 1000)",
                );
              } else if (isAbnormalClose) {
                console.warn(
                  "[Favorites] Channel closed abnormally (socket closed: 1006). SDK will auto-reconnect.",
                );
              } else {
                console.error(
                  "[Favorites] Channel error:",
                  err?.message || err,
                );
              }
            }
          });
      } else {
        console.log(
          "[Favorites] Secondary tab listening via BroadcastChannel...",
        );
        if (bc) {
          bcListener = (event: MessageEvent) => {
            if (event.data?.type === "favorites_update") {
              console.log(
                "[Favorites-Secondary] Favorites update received via BroadcastChannel",
              );
              fetchDbFavorites();
            }
          };
          bc.addEventListener("message", bcListener);
        }
      }
    }

    return () => {
      if (channel) {
        supabase.removeChannel(channel).catch(() => {});
      }
      if (bcListener && bc) {
        bc.removeEventListener("message", bcListener);
      }
      bc?.close();
    };
  }, [user, isLeader, fetchDbFavorites]);

  // 2. Computed Favorites List
  //
  // Redesenho subtrativo (26/08/2026, revisão de contexto limpo) — até aqui,
  // `pendingFavorites` entrava nesta lista (`mesclarSemDuplicar([pendingFavorites,
  // daBase])`) para a pessoa não ver a lista encolher enquanto a gravação não
  // confirmava. Essa decisão foi a raiz de TRÊS defeitos, todos com teste
  // reproduzindo antes desta correção: (1) o cancelamento de um pendente
  // vazava entre contas, porque o mecanismo que permitia "desfavoritar um
  // pendente" (canceladosRef, removido acima) não sabia de quem era o
  // cancelamento; (2) o mesmo cancelamento, no caminho de erro comum (rede
  // lenta, não caída), podia perder a corrida contra o upsert em voo e o
  // favorito removido "ressuscitava" na tela; (3) a fila de um usuário podia
  // aparecer, mesmo que por um instante, na tela do usuário seguinte no
  // mesmo aparelho. Os três só existiam porque havia um item PENDENTE
  // renderizado como favorito, com um coração para tocar.
  //
  // A fila continua existindo (ela é o que garante que o favorito não se
  // perde — ver `pendingFavorites` acima e o write-ahead no efeito de sync),
  // mas vira um BUFFER DE RETENTATIVA INVISÍVEL: não entra em `favorites`,
  // não entra em `isFavorite` nem em `toggleFavorite` (abaixo). Isso tem um
  // custo aceito conscientemente — enquanto um favorito está pendente, ele
  // não aparece como favoritado em lugar nenhum da interface, então a pessoa
  // pode achar que perdeu o favorito e tentar de novo — mas o disco nunca
  // perde o dado (write-ahead) e a retentativa (efeito de `online` acima)
  // resolve sozinha assim que a rede volta. O contrato para pagar esse custo
  // sem reintroduzir os três defeitos é informar SEM criar superfície: o
  // número de pendentes sai por `pendingCount`, nunca por um item da lista.
  const favorites = React.useMemo(() => {
    if (!user) return localFavorites;
    return allProducts.filter((p) => dbFavoriteIds.includes(p.id));
  }, [user, allProducts, dbFavoriteIds, localFavorites]);

  // 3. Actions
  const addToFavorites = useCallback(
    async (product: Product) => {
      if (user) {
        // Optimistic
        setDbFavoriteIds((prev) => [...prev, product.id]);
        // `upsert` com `ignoreDuplicates`, não `insert` — desde que
        // `isFavorite` deixou de considerar `pendingFavorites` (ver o
        // comentário grande acima do memo de `favorites`), um produto ainda
        // pendente de sincronizar aparece como NÃO favoritado, e tocar o
        // coração de novo chama esta função em cima de um produto que já
        // tem uma gravação em voo. `insert` faria essa segunda tentativa
        // colidir (chave única `user_id,product_id`) e devolver erro para
        // um favorito que, na verdade, está indo pro ar sem problema.
        const { error } = await supabase
          .from("favorites")
          .upsert(
            { user_id: user.id, product_id: product.id },
            { onConflict: "user_id,product_id", ignoreDuplicates: true },
          );

        if (error) {
          console.error(error);
          toast.error("Erro ao salvar favorito");
          setDbFavoriteIds((prev) => prev.filter((id) => id !== product.id));
        } else {
          // Correção (26/08/2026) — aposenta este id da fila pendente se ele
          // estiver lá (ex.: uma tentativa anterior tinha falhado e ficado
          // retida). Sem isto, a próxima retentativa lia o disco, achava o
          // id de novo e refazia um upsert redundante mas, pior, mantinha o
          // registro vivo além da hora certa de morrer — ver o comentário
          // grande em `retirarDaFilaPendentes`.
          setPendingFavorites(retirarDaFilaPendentes(user.id, [product.id]));
          toast.success("Adicionado aos favoritos");
        }
      } else {
        setLocalFavorites((prev) => {
          if (prev.find((p) => p.id === product.id)) return prev;
          return [...prev, product];
        });
        toast.success("Adicionado aos favoritos");
      }
    },
    [user, setLocalFavorites],
  );

  const removeFromFavorites = useCallback(
    async (productId: string) => {
      if (user) {
        // Optimistic
        setDbFavoriteIds((prev) => prev.filter((id) => id !== productId));
        const { error } = await supabase
          .from("favorites")
          .delete()
          .eq("user_id", user.id)
          .eq("product_id", productId);

        if (error) {
          console.error(error);
          toast.error("Erro ao remover favorito");
          setDbFavoriteIds((prev) => [...prev, productId]);
        } else {
          // Correção (26/08/2026) — o defeito que motivou esta rodada: sem
          // isto, remover um favorito que também estava preso na fila
          // pendente (ex.: a gravação original tinha falhado, e a pessoa
          // depois conseguiu confirmar e desfez a ideia) deixava o registro
          // vivo em disco. A próxima retentativa (evento `online`, ou uma
          // nova montagem do Provider — inclusive um F5) lia a fila, achava
          // o id "esquecido" e o gravava de novo no servidor, ressuscitando
          // algo que a pessoa removeu de propósito.
          setPendingFavorites(retirarDaFilaPendentes(user.id, [productId]));
          toast.success("Removido dos favoritos");
        }
      } else {
        setLocalFavorites((prev) => prev.filter((p) => p.id !== productId));
        toast.success("Removido dos favoritos");
      }
    },
    [user, setLocalFavorites],
  );

  const toggleFavorite = useCallback(
    (product: Product) => {
      const isFav = user
        ? dbFavoriteIds.includes(product.id)
        : localFavorites.some((p) => p.id === product.id);
      if (isFav) {
        removeFromFavorites(product.id);
      } else {
        addToFavorites(product);
      }
    },
    [user, dbFavoriteIds, localFavorites, removeFromFavorites, addToFavorites],
  );

  const isFavorite = useCallback(
    (productId: string) => {
      if (user) {
        return dbFavoriteIds.includes(productId);
      }
      return localFavorites.some((p) => p.id === productId);
    },
    [user, dbFavoriteIds, localFavorites],
  );

  const contextValue = React.useMemo(
    () => ({
      favorites,
      toggleFavorite,
      isFavorite,
      loading,
      erro,
      refresh: () => void fetchDbFavorites(),
      pendingCount: pendingFavorites.length,
    }),
    [
      favorites,
      toggleFavorite,
      isFavorite,
      loading,
      erro,
      fetchDbFavorites,
      pendingFavorites,
    ],
  );

  return (
    <FavoritesContext.Provider value={contextValue}>
      {children}
    </FavoritesContext.Provider>
  );
}
