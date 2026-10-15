import { useSyncListener } from "@/hooks/useDataVault";
import { publicarMudancaDeCategoria } from "@/lib/avisos-de-categoria";
import { DataVault } from "@/lib/dataVault";
import {
  ErroDeCategoria,
  type ResultadoDoApagar,
  type ResultadoDoRenome,
  erroDoNomeReservado,
  lerResultadoDoApagar,
  lerResultadoDoRenome,
  mensagemDaFalhaDeCategoria,
} from "@/lib/gestao-de-categorias";
import { supabase } from "@/lib/supabase";
import type { Category } from "@/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
// Module-level cache to persist data across component mounts
let globalCategoriesCache: Category[] | null = null;
let categoriesFetchPromise: Promise<Category[]> | null = null;
let lastCategoriesFetchTime = 0;
const FETCH_THROTTLE = 60000; // 1 minute throttle for network checks

// Cada tela que lê as categorias tem a SUA cópia (a lista de produtos, o
// formulário do produto, banners, devolução). Renomear, esconder ou apagar numa
// delas precisa chegar nas outras NA HORA, sem esperar o Realtime nem o
// minuto de espera da releitura: as telas ficam montadas por baixo uma da outra.
const ouvintesDeMudanca = new Set<() => void>();
function avisarMudancaDeCategorias() {
  for (const ouvinte of [...ouvintesDeMudanca]) ouvinte();
}

// ── Rede ruim na PRIMEIRA carga ──
// Sem nada na tela (nem cópia do aparelho), uma falha de rede deixava a
// vitrine sem filtros até a cliente recarregar a página. Agora: até
// ESPERAS_DAS_CATEGORIAS_MS.length novas tentativas automáticas (o tamanho da
// lista É o teto, não há laço), nova tentativa quando a rede volta (`online`)
// ou a aba volta a ficar visível, e SEMPRE um pedido em voo por vez. O estado
// de erro continua: o aviso sai quando as tentativas acabam. O estado fica no
// módulo (como o cache) porque várias telas podem usar o hook ao mesmo tempo
// e a nova tentativa tem de ser uma só.
const ESPERAS_DAS_CATEGORIAS_MS: readonly number[] = [1000, 2000, 4000];
// Rajada de eventos de rede (sinal piscando, aba trocando) não vira rajada de pedidos.
const MINIMO_ENTRE_RETOMADAS_MS = 3000;

interface InstanciaDoHook {
  receber: (lista: Category[]) => void;
  buscar: () => Promise<void>;
}

const instanciasMontadas = new Set<InstanciaDoHook>();
let tentativasAutomaticas = 0;
let timerDaNovaTentativa: ReturnType<typeof setTimeout> | null = null;
let falhouSemNadaNaTela = false;
let ultimaConsultaEm = 0;

function cancelarNovaTentativa() {
  if (timerDaNovaTentativa) {
    clearTimeout(timerDaNovaTentativa);
    timerDaNovaTentativa = null;
  }
}

// Uma consulta de retomada: só uma tela pergunta, e as outras recebem a lista.
async function consultarPelaPrimeiraInstancia() {
  if (globalCategoriesCache !== null || categoriesFetchPromise) return;
  const [primeira] = instanciasMontadas;
  if (!primeira) return;
  await primeira.buscar();
  const lista = globalCategoriesCache;
  if (lista !== null) {
    for (const instancia of instanciasMontadas) instancia.receber(lista);
  }
}

// Devolve `true` se há (ou já havia) uma nova tentativa agendada.
function agendarNovaTentativa(): boolean {
  const espera = ESPERAS_DAS_CATEGORIAS_MS.at(tentativasAutomaticas);
  if (espera === undefined || instanciasMontadas.size === 0) return false;
  if (timerDaNovaTentativa) return true;
  tentativasAutomaticas += 1;
  timerDaNovaTentativa = setTimeout(() => {
    timerDaNovaTentativa = null;
    void consultarPelaPrimeiraInstancia();
  }, espera);
  return true;
}

// A rede voltou ou a aba voltou a ficar visível: tenta já, com fôlego novo.
function retomarSeAindaFalta() {
  if (!falhouSemNadaNaTela || globalCategoriesCache !== null) return;
  if (document.visibilityState === "hidden") return;
  if (categoriesFetchPromise) return;
  if (Date.now() - ultimaConsultaEm < MINIMO_ENTRE_RETOMADAS_MS) return;
  cancelarNovaTentativa();
  tentativasAutomaticas = 0;
  void consultarPelaPrimeiraInstancia();
}

function registrarInstancia(instancia: InstanciaDoHook) {
  if (instanciasMontadas.size === 0) {
    window.addEventListener("online", retomarSeAindaFalta);
    document.addEventListener("visibilitychange", retomarSeAindaFalta);
  }
  instanciasMontadas.add(instancia);
}

function removerInstancia(instancia: InstanciaDoHook) {
  instanciasMontadas.delete(instancia);
  if (instanciasMontadas.size === 0) {
    window.removeEventListener("online", retomarSeAindaFalta);
    document.removeEventListener("visibilitychange", retomarSeAindaFalta);
    cancelarNovaTentativa();
    tentativasAutomaticas = 0;
  }
}

export function useCategories() {
  const vaultRef = useRef<DataVault | null>(null);
  const [categories, setCategories] = useState<Category[]>(
    globalCategoriesCache || [],
  );
  const [isLoading, setIsLoading] = useState(!globalCategoriesCache);

  // Persist to DataVault (non-blocking helper)
  const persistToVault = useCallback((items: Category[]) => {
    vaultRef.current
      ?.replaceAll("categories", items)
      .then(() => {
        vaultRef.current?.setLastSync("categories");
      })
      .catch(() => {});
  }, []);

  // Load from DataVault on mount (instant, <5ms)
  useEffect(() => {
    let cancelled = false;
    const initVaultAndLoad = async () => {
      try {
        const vault = await DataVault.init();
        vaultRef.current = vault;
        if (!globalCategoriesCache) {
          const cached = await vault.getAll<Category>("categories");
          if (cached.length > 0 && !cancelled) {
            globalCategoriesCache = cached;
            setCategories(cached);
            setIsLoading(false);
          }
        }
      } catch (err) {
        console.error("[useCategories] DataVault load failed:", err);
      }
    };
    initVaultAndLoad();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchCategories = useCallback(
    async (isSilent = false, forceRefresh = false) => {
      if (categoriesFetchPromise && !forceRefresh) {
        try {
          const data = await categoriesFetchPromise;
          setCategories(data);
          setIsLoading(false);
        } catch {
          /* fallback */
          // A consulta que esta tela pegou carona falhou: sem isto o
          // "carregando" ficava ligado para sempre.
          setIsLoading(false);
        }
        return;
      }

      try {
        if (!isSilent) {
          setIsLoading(true);
        }

        const queryPromise = (async () => {
          ultimaConsultaEm = Date.now();
          const { data, error } = await supabase
            .from("categorias")
            .select("*")
            .order("nome");

          if (error) throw error;

          const adaptedCategories: Category[] = (data || []).map((item) => ({
            id: item.id,
            name: item.nome,
            slug: item.slug || "",
            description: item.descricao || "",
            isActive: item.ativo ?? true,
            createdAt: item.created_at,
          }));
          globalCategoriesCache = adaptedCategories;
          lastCategoriesFetchTime = Date.now();
          // Resposta de verdade (lista vazia inclusive): a falha acabou.
          falhouSemNadaNaTela = false;
          tentativasAutomaticas = 0;
          cancelarNovaTentativa();
          persistToVault(adaptedCategories);
          return adaptedCategories;
        })();

        categoriesFetchPromise = queryPromise;
        const data = await queryPromise;
        setCategories(data);
      } catch (error) {
        console.error("Error fetching categories:", error);
        // Sem nada na tela, ainda há nova tentativa automática? Então o aviso
        // espera (um toast por tentativa seria barulho); quando as tentativas
        // acabam, ou quando já há lista na tela, o aviso sai como sempre.
        falhouSemNadaNaTela = globalCategoriesCache === null;
        const vaiTentarDeNovo = falhouSemNadaNaTela && agendarNovaTentativa();
        if (!vaiTentarDeNovo) toast.error("Erro ao carregar categorias");
      } finally {
        setIsLoading(false);
        categoriesFetchPromise = null;
      }
    },
    [persistToVault],
  );

  // Entra na lista de telas que a nova tentativa automática atende (e sai ao
  // desmontar, soltando o relógio e os ouvidos de rede quando é a última).
  useEffect(() => {
    const instancia: InstanciaDoHook = {
      receber: (lista) => {
        setCategories(lista);
        setIsLoading(false);
      },
      buscar: () => fetchCategories(true),
    };
    registrarInstancia(instancia);
    return () => removerInstancia(instancia);
  }, [fetchCategories]);

  useEffect(() => {
    const hasCache = categories.length > 0;
    if (!hasCache) {
      fetchCategories(false);
    } else if (Date.now() - lastCategoriesFetchTime > FETCH_THROTTLE) {
      fetchCategories(true, true);
    }
  }, [fetchCategories, categories.length]);

  // Outra tela renomeou, escondeu ou apagou uma categoria: relê já.
  useEffect(() => {
    const ouvinte = () => {
      void fetchCategories(true, true);
    };
    ouvintesDeMudanca.add(ouvinte);
    return () => {
      ouvintesDeMudanca.delete(ouvinte);
    };
  }, [fetchCategories]);

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "");
  };

  const addCategory = useCallback(
    async (
      category: Omit<Category, "id" | "createdAt" | "slug">,
      silent?: boolean,
    ) => {
      // "Todas" e "all" são do filtro da vitrine e do painel: criar categoria com
      // esse nome a deixaria sem filtro. (Só a tela protege; o INSERT direto não.)
      const reservado = erroDoNomeReservado(category.name);
      if (reservado) {
        if (!silent) toast.error(reservado);
        throw new ErroDeCategoria(reservado);
      }
      const tempId = `temp-${Date.now()}`;
      const slug = generateSlug(category.name);
      const newCategory: Category = {
        id: tempId,
        name: category.name,
        slug,
        description: category.description,
        isActive: category.isActive,
        createdAt: new Date().toISOString(),
      };

      setCategories((prev) => {
        const next = [...prev, newCategory];
        persistToVault(next);
        return next;
      });

      try {
        const { data, error } = await supabase
          .from("categorias")
          .insert({
            nome: category.name,
            slug,
            descricao: category.description,
            ativo: category.isActive,
          })
          .select()
          .single();

        if (error) throw error;

        setCategories((prev) => {
          const final = prev.map((c) =>
            c.id === tempId
              ? {
                  id: data.id,
                  name: data.nome,
                  slug: data.slug || "",
                  description: data.descricao || "",
                  isActive: data.ativo ?? true,
                  createdAt: data.created_at,
                }
              : c,
          );
          persistToVault(final);
          return final;
        });

        if (!silent) toast.success("Categoria criada com sucesso!");
        return data;
      } catch (error) {
        setCategories((prev) => {
          const reverted = prev.filter((c) => c.id !== tempId);
          persistToVault(reverted);
          return reverted;
        });
        console.error("Error adding category:", error);
        if (!silent) toast.error("Erro ao criar categoria");
        throw error;
      }
    },
    [persistToVault],
  );

  // O NOME da categoria é a chave de produtos, banners e da regra de devolução
  // (texto, sem chave estrangeira). Trocar `categorias.nome` direto na tabela
  // deixava o produto órfão da vitrine, o banner apontando para página vazia e
  // a regra de "sem troca" apontando para um nome que não existe. Por isso
  // renomear e apagar passam SÓ pelas portas do banco (migration
  // 20261237000000), que trocam os quatro lugares numa transação e recusam o
  // que deixaria órfão. Nenhuma das duas mostra toast: quem chama decide o texto.
  const aplicarNaLista = useCallback(
    (trocar: (lista: Category[]) => Category[]) => {
      if (globalCategoriesCache) {
        globalCategoriesCache = trocar(globalCategoriesCache);
      }
      setCategories((prev) => {
        const next = trocar(prev);
        persistToVault(next);
        return next;
      });
    },
    [persistToVault],
  );

  const renameCategory = useCallback(
    async (id: string, novoNome: string): Promise<ResultadoDoRenome> => {
      const reservado = erroDoNomeReservado(novoNome);
      if (reservado) throw new ErroDeCategoria(reservado, "22023");
      const { data, error } = await supabase.rpc("renomear_categoria", {
        p_id: id,
        p_novo_nome: novoNome,
      });
      if (error) {
        throw new ErroDeCategoria(
          mensagemDaFalhaDeCategoria(error),
          error.code,
        );
      }
      const resultado = lerResultadoDoRenome(data);
      aplicarNaLista((lista) =>
        lista.map((c) =>
          c.id === id
            ? { ...c, name: resultado.nome, slug: resultado.slug }
            : c,
        ),
      );
      avisarMudancaDeCategorias();
      if (resultado.mudou) {
        publicarMudancaDeCategoria({
          tipo: "renomeada",
          de: resultado.nomeAntigo,
          para: resultado.nome,
        });
      }
      return resultado;
    },
    [aplicarNaLista],
  );

  const deleteCategory = useCallback(
    async (id: string): Promise<ResultadoDoApagar> => {
      const { data, error } = await supabase.rpc("apagar_categoria_vazia", {
        p_id: id,
      });
      if (error) {
        throw new ErroDeCategoria(
          mensagemDaFalhaDeCategoria(error),
          error.code,
        );
      }
      const resultado = lerResultadoDoApagar(data);
      aplicarNaLista((lista) => lista.filter((c) => c.id !== id));
      avisarMudancaDeCategorias();
      publicarMudancaDeCategoria({ tipo: "apagada", nome: resultado.nome });
      return resultado;
    },
    [aplicarNaLista],
  );

  // Esconder da vitrine é a coluna `ativo`, que já existia e que a vitrine já
  // respeita: não mexe em nome nem em produto.
  const setCategoryActive = useCallback(
    async (id: string, ativa: boolean) => {
      // `.select("id")` porque o PostgREST responde sucesso mesmo quando a
      // política de acesso não deixa nenhuma linha passar (0 linhas, sem erro).
      const { data, error } = await supabase
        .from("categorias")
        .update({ ativo: ativa })
        .eq("id", id)
        .select("id");
      if (error) {
        throw new ErroDeCategoria(
          mensagemDaFalhaDeCategoria(error),
          error.code,
        );
      }
      if (!data || data.length === 0) {
        throw new ErroDeCategoria(
          "Não foi possível mudar a categoria. Atualize a tela e tente de novo.",
        );
      }
      aplicarNaLista((lista) =>
        lista.map((c) => (c.id === id ? { ...c, isActive: ativa } : c)),
      );
      avisarMudancaDeCategorias();
      publicarMudancaDeCategoria({ tipo: "visibilidade" });
    },
    [aplicarNaLista],
  );

  const updateCategory = useCallback(
    async (
      id: string,
      updates: Partial<Omit<Category, "id" | "createdAt" | "slug">>,
    ) => {
      try {
        // O nome só muda pela porta do banco (veja acima); o slug é dela.
        if (updates.name !== undefined) await renameCategory(id, updates.name);
        if (updates.isActive !== undefined) {
          await setCategoryActive(id, updates.isActive);
        }
        if (updates.description !== undefined) {
          const { error } = await supabase
            .from("categorias")
            .update({ descricao: updates.description })
            .eq("id", id);
          if (error) throw error;
          aplicarNaLista((lista) =>
            lista.map((c) =>
              c.id === id ? { ...c, description: updates.description } : c,
            ),
          );
        }
        toast.success("Categoria atualizada com sucesso!");
      } catch (error) {
        console.error("Error updating category:", error);
        toast.error(
          error instanceof ErroDeCategoria
            ? error.message
            : "Erro ao atualizar categoria",
        );
        throw error;
      }
    },
    [renameCategory, setCategoryActive, aplicarNaLista],
  );

  // Realtime sync: re-read from DataVault when RealtimeSyncEngine updates categories
  useSyncListener(
    ["categories"],
    useCallback(async () => {
      if (vaultRef.current) {
        // SEM guarda de "lista vazia": ela engolia o caso em que a lista
        // ficou vazia, e a tela seguia mostrando a categoria excluída até
        // alguém recarregar a página.
        //
        // Mas lista vazia tem DOIS significados: pode ser a lojista
        // excluindo a ÚLTIMA categoria em outro dispositivo (esvaziar é o
        // certo) OU uma leitura que falhou (conexão fechada por outra aba
        // durante um purge, store ausente...) -- o `catch` de `getAll`
        // resolve `[]` nos dois casos. Por isso `getAllOrThrow`, que
        // REJEITA em vez de mascarar a falha como "vazio de verdade".
        try {
          const fresh =
            await vaultRef.current.getAllOrThrow<Category>("categories");
          setCategories(fresh);
        } catch (err) {
          // Leitura do cofre falhou -- manter o que já está na tela é
          // melhor que esvaziar a lista por causa de uma falha de leitura.
          console.warn(
            "[useCategories] Falha ao reler o cofre; mantendo a lista atual:",
            err,
          );
        }
      }
    }, []),
  );

  return {
    categories,
    isLoading,
    fetchCategories,
    addCategory,
    updateCategory,
    renameCategory,
    setCategoryActive,
    deleteCategory,
  };
}
