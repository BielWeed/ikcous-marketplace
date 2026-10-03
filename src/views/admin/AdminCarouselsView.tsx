import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { CartaoDaVitrine } from "@/components/admin/vitrines/CartaoDaVitrine";
import { FolhaEditarVitrine } from "@/components/admin/vitrines/FolhaEditarVitrine";
import { FolhaNovaVitrine } from "@/components/admin/vitrines/FolhaNovaVitrine";
import {
  QUANTIDADE_PADRAO,
  type SecaoDaHome,
  tituloExibido,
} from "@/components/admin/vitrines/tipos";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useStore } from "@/contexts/StoreContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useProducts } from "@/hooks/useProducts";
import { ordenarParaVitrine } from "@/lib/vitrine";
import type { View } from "@/types";
import { Reorder } from "framer-motion";
import {
  HelpCircle,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

interface AdminCarouselsViewProps {
  onNavigate: (view: View) => void;
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
}

/** "Some a vitrine X" / "Somem as N vitrines personalizadas", sem encher a tela. */
function efeitosDeRestaurar(secoes: readonly SecaoDaHome[]): string[] {
  const efeitos: string[] = [];
  const personalizadas = secoes.filter((s) => s.isCustom);
  if (personalizadas.length > 0 && personalizadas.length <= 3) {
    for (const s of personalizadas) {
      efeitos.push(`Some a vitrine "${tituloExibido(s)}"`);
    }
  } else if (personalizadas.length > 3) {
    efeitos.push(`Somem as ${personalizadas.length} vitrines personalizadas`);
  }
  const escolhidos = secoes.reduce(
    (soma, s) => soma + (s.productIds?.length ?? 0),
    0,
  );
  if (escolhidos === 1) {
    efeitos.push("Some o produto escolhido à mão");
  } else if (escolhidos > 1) {
    efeitos.push(`Somem os ${escolhidos} produtos escolhidos à mão`);
  }
  efeitos.push("Nomes, quantidades, ordem e visibilidade voltam ao original");
  return efeitos;
}

export const AdminCarouselsView = memo(function AdminCarouselsView({
  onNavigate: _onNavigate,
  onSetDirty,
}: AdminCarouselsViewProps) {
  const { config, updateConfig } = useStore();
  const { products } = useProducts();
  const isOffline = useOnlineStatus();

  // Painéis e diálogos
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showAddVitrineModal, setShowAddVitrineModal] = useState(false);
  const [newVitrineTitle, setNewVitrineTitle] = useState("");
  const [criandoVitrine, setCriandoVitrine] = useState(false);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [confirmarRestaurar, setConfirmarRestaurar] = useState(false);
  const [vitrineParaExcluir, setVitrineParaExcluir] =
    useState<SecaoDaHome | null>(null);

  const defaultHomeSections = useMemo<SecaoDaHome[]>(
    () => [
      {
        id: "new_arrivals",
        title: "Últimos Lançamentos",
        active: true,
        maxItems: 6,
        productIds: [],
        isCustom: false,
      },
      {
        id: "offers",
        title: "Ofertas Imperdíveis",
        active: true,
        maxItems: 6,
        productIds: [],
        isCustom: false,
      },
      {
        id: "bestsellers",
        title: "Destaques em Alta",
        active: true,
        maxItems: 6,
        productIds: [],
        isCustom: false,
      },
    ],
    [],
  );

  const homeSections = useMemo(() => {
    return config.homeSections ?? defaultHomeSections;
  }, [config.homeSections, defaultHomeSections]);

  // Tecla Esc fecha a ajuda. O painel de edição e os diálogos de confirmação
  // são do Radix e já fecham sozinhos com Esc.
  useEffect(() => {
    if (!showHelpModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowHelpModal(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showHelpModal]);

  /**
   * Devolve `true` só quando a gravação foi confirmada.
   *
   * Antes o `updateConfig` engolia a falha e devolvia normalmente, então esta
   * função chamava `onSetDirty(false)` e anunciava "Vitrines salvas com
   * sucesso!" em cima de uma gravação que não aconteceu — e a vitrine sumia da
   * lista no próximo carregamento (ADMIN-010, #94).
   */
  const handleUpdateHomeSections = async (
    updated: typeof homeSections,
    showToast = false,
  ): Promise<boolean> => {
    try {
      // O toast de erro sai de dentro do `updateConfig`; não duplicar aqui.
      const salvou = await updateConfig({ homeSections: updated });
      if (!salvou) return false;
      onSetDirty?.(false);
      if (showToast) {
        toast.success("Vitrines salvas com sucesso!");
      }
      return true;
    } catch (error) {
      console.error("Erro ao atualizar as vitrines:", error);
      toast.error("Erro ao salvar ordem das vitrines.");
      return false;
    }
  };

  const handleToggleSectionActive = (sectionId: string) => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para alterar a visibilidade.",
      });
      return;
    }
    const updated = homeSections.map((s) =>
      s.id === sectionId ? { ...s, active: !s.active } : s,
    );
    handleUpdateHomeSections(updated, false);
  };

  const handleRenameSection = (sectionId: string, newTitle: string) => {
    // O campo de nome grava ao sair dele, mesmo sem ter mudado nada: sem este
    // corte, abrir e fechar o painel regravava a vitrine (e, sem internet,
    // reclamava de uma edição que ninguém fez).
    if (homeSections.find((s) => s.id === sectionId)?.title === newTitle) {
      return;
    }
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para renomear as vitrines.",
      });
      return;
    }
    const updated = homeSections.map((s) =>
      s.id === sectionId ? { ...s, title: newTitle } : s,
    );
    handleUpdateHomeSections(updated, false);
  };

  const handleUpdateMaxItems = (sectionId: string, maxItems: number) => {
    if (
      (homeSections.find((s) => s.id === sectionId)?.maxItems ??
        QUANTIDADE_PADRAO) === maxItems
    ) {
      return;
    }
    if (isOffline) {
      toast.error("Sem conexão", { description: "Você precisa estar online." });
      return;
    }
    const updated = homeSections.map((s) =>
      s.id === sectionId ? { ...s, maxItems } : s,
    );
    handleUpdateHomeSections(updated, false);
  };

  const moveSection = (index: number, direction: "up" | "down") => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para reordenar.",
      });
      return;
    }
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= homeSections.length) return;

    const updated = [...homeSections];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;

    handleUpdateHomeSections(updated, false);
  };

  // ── Arrastar para reordenar ───────────────────────────────────────────
  // Enquanto o dedo arrasta, a ordem nova vive só na tela (`ordemArrastada`);
  // grava UMA vez, ao soltar, pelo mesmo `handleUpdateHomeSections` das setas.
  // Depois da gravação a tela volta a ler `homeSections`: se gravou, é a ordem
  // nova; se falhou, é a ordem antiga — sem remendo de "desfazer".
  const [ordemArrastada, setOrdemArrastada] = useState<SecaoDaHome[] | null>(
    null,
  );
  const ordemArrastadaRef = useRef<SecaoDaHome[] | null>(null);
  const secoesNaLista = ordemArrastada ?? homeSections;

  const handleReordenando = (novaOrdem: SecaoDaHome[]) => {
    ordemArrastadaRef.current = novaOrdem;
    setOrdemArrastada(novaOrdem);
  };

  const handleSoltou = async () => {
    const novaOrdem = ordemArrastadaRef.current;
    ordemArrastadaRef.current = null;
    if (!novaOrdem) return;
    const mudou = novaOrdem.some((s, i) => s.id !== homeSections.at(i)?.id);
    if (!mudou) {
      setOrdemArrastada(null);
      return;
    }
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para reordenar.",
      });
      setOrdemArrastada(null);
      return;
    }
    await handleUpdateHomeSections(novaOrdem, false);
    setOrdemArrastada(null);
  };

  const handleAddCustomVitrine = async () => {
    if (criandoVitrine) return;
    if (!newVitrineTitle.trim()) {
      toast.error("Informe um título para a vitrine");
      return;
    }
    if (isOffline) {
      toast.error("Sem conexão com a internet");
      return;
    }

    const newId = `custom_${Date.now()}`;
    const newSection = {
      id: newId,
      title: newVitrineTitle.trim(),
      active: true,
      isCustom: true,
      maxItems: 6,
      productIds: [],
    };

    const updated = [...homeSections, newSection];
    // Só limpa o título e fecha o painel se a vitrine foi mesmo gravada. Antes
    // isso acontecia incondicionalmente: o admin via o modal fechar, o campo
    // esvaziar, e a vitrine não existia (ADMIN-010, #94).
    setCriandoVitrine(true);
    const salvou = await handleUpdateHomeSections(updated, true);
    setCriandoVitrine(false);
    if (!salvou) return;
    setNewVitrineTitle("");
    setShowAddVitrineModal(false);
  };

  const handleDeleteVitrine = async (sectionId: string) => {
    if (isOffline) {
      toast.error("Sem conexão com a internet");
      return;
    }
    const updated = homeSections.filter((s) => s.id !== sectionId);
    await handleUpdateHomeSections(updated, true);
  };

  const handleResetDefaultVitrines = async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet");
      return;
    }
    await handleUpdateHomeSections(defaultHomeSections, true);
  };

  // Preview products for each vitrine section (respeitando a ordem exata de seleção de curadoria)
  //
  // Este bloco estava DEPOIS de `handleToggleProductInCuration`, que o usa. Em
  // tempo de execução funcionava (a função só roda depois do render), mas o
  // React Compiler não consegue provar isso e desistia de compilar o arquivo —
  // três erros `react-hooks/preserve-manual-memoization`, que travavam o hook
  // de pre-commit para qualquer um que tocasse nesta tela. Mover é reordenação
  // pura: nenhuma dependência mudou.
  const previewProducts = useMemo(() => {
    const map: Record<string, typeof products> = {};
    const productMap = new Map(products.map((p) => [p.id, p]));

    homeSections.forEach((sec) => {
      const max = sec.maxItems ?? QUANTIDADE_PADRAO;
      if (sec.productIds && sec.productIds.length > 0) {
        // Manual curated products preserving exact selection order
        map[sec.id] = sec.productIds
          .map((id) => productMap.get(id))
          .filter((p): p is (typeof products)[0] => Boolean(p))
          .slice(0, max);
      } else if (sec.id === "offers") {
        map[sec.id] = products
          .filter((p) => p.originalPrice && p.originalPrice > p.price)
          .slice(0, max);
      } else if (sec.id === "bestsellers") {
        map[sec.id] = products.filter((p) => p.isBestseller).slice(0, max);
      } else {
        // new_arrivals or default custom — a MESMA ordenação da loja
        // (ordenarParaVitrine, src/lib/vitrine.ts): sem-estoque no fim antes
        // de cortar. Item 15 do laudo de 29/08: o preview ordenava só por
        // data e a lojista montava a vitrine vendo uma ordem que a loja não
        // mostrava.
        map[sec.id] = ordenarParaVitrine(products).slice(0, max);
      }
    });

    return map;
  }, [homeSections, products]);

  const handleToggleProductInCuration = async (
    sectionId: string,
    productId: string,
  ) => {
    if (isOffline) {
      toast.error("Sem conexão com a internet");
      return;
    }
    const updated = homeSections.map((sec) => {
      if (sec.id !== sectionId) return sec;
      const initialIds =
        sec.productIds && sec.productIds.length > 0
          ? sec.productIds
          : (previewProducts[sec.id] || []).map((p) => p.id);

      const exists = initialIds.includes(productId);
      const newIds = exists
        ? initialIds.filter((id) => id !== productId)
        : [...initialIds, productId];
      return { ...sec, productIds: newIds };
    });
    await handleUpdateHomeSections(updated, false);
  };

  /** "Automático": a loja volta a escolher sozinha (lista de produtos vazia). */
  const handleVoltarAoAutomatico = async (sectionId: string) => {
    const atual = homeSections.find((s) => s.id === sectionId);
    if (!atual || (atual.productIds?.length ?? 0) === 0) return;
    if (isOffline) {
      toast.error("Sem conexão com a internet");
      return;
    }
    await handleUpdateHomeSections(
      homeSections.map((s) =>
        s.id === sectionId ? { ...s, productIds: [] } : s,
      ),
      false,
    );
  };

  /**
   * "Escolher": fixa os produtos que a loja mostra hoje como ponto de partida
   * — o mesmo que o primeiro toque num produto já fazia — para a lojista tirar
   * e pôr a partir dali.
   */
  const handleEscolherManualmente = async (sectionId: string) => {
    const atual = homeSections.find((s) => s.id === sectionId);
    if (!atual || (atual.productIds?.length ?? 0) > 0) return;
    const idsHoje = (previewProducts[sectionId] || []).map((p) => p.id);
    if (idsHoje.length === 0) return;
    if (isOffline) {
      toast.error("Sem conexão com a internet");
      return;
    }
    await handleUpdateHomeSections(
      homeSections.map((s) =>
        s.id === sectionId ? { ...s, productIds: idsHoje } : s,
      ),
      false,
    );
  };

  const activeVitrinesCount = useMemo(
    () => homeSections.filter((sec) => sec.active).length,
    [homeSections],
  );

  const totalProductsInActiveVitrines = useMemo(() => {
    let count = 0;
    homeSections.forEach((sec) => {
      if (sec.active) {
        const items = previewProducts[sec.id] || [];
        count += items.length;
      }
    });
    return count;
  }, [homeSections, previewProducts]);

  // Vitrine aberta no painel de edição
  const secaoEmEdicao = useMemo(() => {
    if (!editingSectionId) return null;
    return homeSections.find((s) => s.id === editingSectionId) ?? null;
  }, [editingSectionId, homeSections]);

  const idsEmExibicaoNaEdicao = useMemo(() => {
    if (!secaoEmEdicao) return [];
    if (secaoEmEdicao.productIds && secaoEmEdicao.productIds.length > 0) {
      return secaoEmEdicao.productIds;
    }
    // Modo automático: os que aparecem são os calculados em previewProducts
    return (previewProducts[secaoEmEdicao.id] || []).map((p) => p.id);
  }, [secaoEmEdicao, previewProducts]);

  return (
    <div className="pb-admin relative h-auto w-full max-w-full overflow-x-hidden bg-admin-bg font-sans text-zinc-400 selection:bg-admin-gold/30 selection:text-white">
      <div className="relative z-10 mx-auto max-w-5xl space-y-4 p-4">
        <div>
          <div className="flex items-center justify-between gap-3">
            <AdminPageHeader
              titulo="Vitrines"
              acoes={
                <>
                  <button
                    type="button"
                    onClick={() => setShowHelpModal(true)}
                    aria-label="Ajuda"
                    title="Ajuda"
                    className="flex size-9 items-center justify-center rounded-[12px] border border-white/5 bg-zinc-900 text-zinc-300 transition-colors hover:text-white"
                  >
                    <HelpCircle className="size-[17px]" />
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="Mais ações"
                        title="Mais ações"
                        className="flex size-9 items-center justify-center rounded-[12px] border border-white/5 bg-zinc-900 text-zinc-300 transition-colors hover:text-white"
                      >
                        <MoreHorizontal className="size-[17px]" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="min-w-56 rounded-2xl border-white/10 bg-zinc-900 p-1.5 text-zinc-200"
                    >
                      <DropdownMenuItem
                        onSelect={() => setConfirmarRestaurar(true)}
                        className="gap-2.5 rounded-[12px] px-3 py-2.5 text-[13.5px] font-semibold focus:bg-white/5 focus:text-white"
                      >
                        <RotateCcw className="size-4 text-zinc-400" />
                        Restaurar padrão
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              }
            />
          </div>
          <p className="mt-2 text-[13px] leading-snug text-zinc-400">
            Carrosséis da página inicial, na ordem do cliente.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
          <div className="grid flex-1 grid-cols-2 overflow-hidden rounded-[20px] border border-white/5 bg-zinc-900/40">
            <div className="px-4 py-3.5">
              <b className="block text-[22px] font-extrabold tabular-nums tracking-tight text-white">
                {activeVitrinesCount}
                <small className="ml-0.5 text-sm font-semibold text-zinc-500">
                  /{homeSections.length}
                </small>
              </b>
              <span className="text-xs font-medium text-zinc-400">
                ligadas na loja
              </span>
            </div>
            <div className="border-l border-white/5 px-4 py-3.5">
              <b className="block text-[22px] font-extrabold tabular-nums tracking-tight text-white">
                {totalProductsInActiveVitrines}
              </b>
              <span className="text-xs font-medium text-zinc-400">
                produtos em exibição
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowAddVitrineModal(true)}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-admin-gold px-6 text-[14.5px] font-extrabold text-zinc-950 shadow-[0_10px_24px_-10px] shadow-admin-gold/55 transition-all hover:bg-admin-gold/90 active:scale-[0.99] sm:h-auto sm:w-56"
          >
            <Plus className="size-[18px] stroke-[2.5]" />
            Nova vitrine
          </button>
        </div>

        <Reorder.Group
          as="div"
          axis="y"
          values={secoesNaLista}
          onReorder={handleReordenando}
          className="flex flex-col gap-2.5"
        >
          {secoesNaLista.map((sec, index) => (
            <CartaoDaVitrine
              key={sec.id}
              secao={sec}
              indice={index}
              total={secoesNaLista.length}
              produtosEmExibicao={previewProducts[sec.id] ?? []}
              aoAbrir={setEditingSectionId}
              aoAlternarAtiva={handleToggleSectionActive}
              aoMover={moveSection}
              aoSoltar={handleSoltou}
            />
          ))}
        </Reorder.Group>
      </div>

      {/* Painel: nova vitrine */}
      {showAddVitrineModal && (
        <FolhaNovaVitrine
          titulo={newVitrineTitle}
          aoMudarTitulo={setNewVitrineTitle}
          aoCriar={handleAddCustomVitrine}
          aoFechar={() => setShowAddVitrineModal(false)}
          criando={criandoVitrine}
        />
      )}

      {/* Painel: editar vitrine (nome, quantidade e produtos) */}
      {secaoEmEdicao && (
        <FolhaEditarVitrine
          secao={secaoEmEdicao}
          posicao={homeSections.findIndex((s) => s.id === secaoEmEdicao.id) + 1}
          produtos={products}
          idsEmExibicao={idsEmExibicaoNaEdicao}
          aoFechar={() => setEditingSectionId(null)}
          aoRenomear={(titulo) => handleRenameSection(secaoEmEdicao.id, titulo)}
          aoMudarQuantidade={(quantidade) =>
            handleUpdateMaxItems(secaoEmEdicao.id, quantidade)
          }
          aoAlternarProduto={(idDoProduto) =>
            handleToggleProductInCuration(secaoEmEdicao.id, idDoProduto)
          }
          aoVoltarAoAutomatico={() =>
            handleVoltarAoAutomatico(secaoEmEdicao.id)
          }
          aoEscolherManualmente={() =>
            handleEscolherManualmente(secaoEmEdicao.id)
          }
          aoPedirExclusao={
            secaoEmEdicao.isCustom
              ? () => {
                  // O painel fecha ANTES do diálogo abrir: o clique no
                  // diálogo (portal fora do painel) seria engolido pelo
                  // guardião do clique fora da folha.
                  setVitrineParaExcluir(secaoEmEdicao);
                  setEditingSectionId(null);
                }
              : undefined
          }
        />
      )}

      {/* Confirmação: restaurar as vitrines de fábrica */}
      <AlertDialog
        open={confirmarRestaurar}
        onOpenChange={setConfirmarRestaurar}
      >
        <AlertDialogContent className="max-w-md rounded-3xl border border-white/10 bg-zinc-950">
          <AlertDialogHeader>
            <div className="flex size-11 items-center justify-center rounded-[14px] bg-rose-500/10 text-rose-400">
              <RotateCcw className="size-5" />
            </div>
            <AlertDialogTitle className="mt-2 text-lg font-extrabold tracking-tight text-white">
              Voltar às 3 vitrines de fábrica?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13.5px] leading-relaxed text-zinc-400">
              A loja volta a mostrar Lançamentos, Ofertas e Destaques,
              escolhidos automaticamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="space-y-1.5">
            {efeitosDeRestaurar(homeSections).map((efeito) => (
              <li
                key={efeito}
                className="flex items-center gap-2 text-[13px] text-zinc-300"
              >
                <span
                  aria-hidden="true"
                  className="h-0.5 w-3 shrink-0 rounded bg-rose-400"
                />
                {efeito}
              </li>
            ))}
          </ul>
          <AlertDialogFooter className="mt-2 gap-2">
            <AlertDialogCancel className="h-11 rounded-[14px] border-0 bg-zinc-900 px-5 text-sm font-bold text-zinc-300 hover:bg-zinc-800 hover:text-white">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleResetDefaultVitrines}
              className="h-11 rounded-[14px] border-0 bg-red-600 px-5 text-sm font-bold text-white hover:bg-red-700"
            >
              Restaurar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmação: excluir uma vitrine personalizada */}
      <AlertDialog
        open={vitrineParaExcluir !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setVitrineParaExcluir(null);
        }}
      >
        <AlertDialogContent className="max-w-md rounded-3xl border border-white/10 bg-zinc-950">
          <AlertDialogHeader>
            <div className="flex size-11 items-center justify-center rounded-[14px] bg-rose-500/10 text-rose-400">
              <Trash2 className="size-5" />
            </div>
            <AlertDialogTitle className="mt-2 text-lg font-extrabold tracking-tight text-white">
              Excluir a vitrine "
              {vitrineParaExcluir ? tituloExibido(vitrineParaExcluir) : ""}"?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13.5px] leading-relaxed text-zinc-400">
              Ela some da loja e não dá para desfazer. Os produtos continuam no
              catálogo; só deixam de estar nesta vitrine.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-2 gap-2">
            <AlertDialogCancel
              onClick={() => {
                // Desistiu: volta ao painel de onde pediu a exclusão.
                if (vitrineParaExcluir) {
                  setEditingSectionId(vitrineParaExcluir.id);
                }
              }}
              className="h-11 rounded-[14px] border-0 bg-zinc-900 px-5 text-sm font-bold text-zinc-300 hover:bg-zinc-800 hover:text-white"
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (vitrineParaExcluir) {
                  handleDeleteVitrine(vitrineParaExcluir.id);
                }
              }}
              className="h-11 rounded-[14px] border-0 bg-red-600 px-5 text-sm font-bold text-white hover:bg-red-700"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal de Ajuda */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Guia do Gerenciador de Vitrines (Carrosséis)"
      >
        <div className="space-y-3 text-xs leading-relaxed text-zinc-400">
          <p>
            Esta tela permite organizar a exibição dos carrosséis de produtos na
            página inicial do aplicativo. Toque em uma vitrine para editar.
          </p>
          <div className="space-y-2">
            <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-wider text-white">
              Recursos Avançados
            </h4>
            <ul className="list-disc space-y-1 pl-4 text-zinc-400">
              <li>
                <strong>Nova vitrine:</strong> Crie seções personalizadas com
                seus próprios títulos.
              </li>
              <li>
                <strong>Escolher produtos:</strong> Escolha manualmente quais
                produtos específicos aparecem em cada vitrine.
              </li>
              <li>
                <strong>Quantidade:</strong> Altere quantos produtos são
                exibidos (4, 6, 8 ou 10).
              </li>
              <li>
                <strong>Reordenar:</strong> Segure e arraste a alça de pontinhos
                do cartão, ou use as setas, para alterar qual vitrine aparece
                primeiro na Home.
              </li>
              <li>
                <strong>Restaurar padrão:</strong> No menu de três pontinhos;
                pergunta antes de apagar.
              </li>
            </ul>
          </div>
        </div>
      </AdminHelpModal>
    </div>
  );
});
