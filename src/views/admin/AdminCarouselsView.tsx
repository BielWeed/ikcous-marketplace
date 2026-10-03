import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/contexts/StoreContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useProducts } from "@/hooks/useProducts";
import { cn, normalizeText } from "@/lib/utils";
import { ordenarParaVitrine } from "@/lib/vitrine";
import type { View } from "@/types";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Edit,
  Eye,
  EyeOff,
  Flame,
  HelpCircle,
  Layers,
  Package,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Tag,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

interface CarouselSection {
  id: string;
  title: string;
  active: boolean;
  type?: "new_arrivals" | "offers" | "bestsellers" | "custom";
  maxItems?: number;
  productIds?: string[];
  isCustom?: boolean;
}

interface AdminCarouselsViewProps {
  onNavigate: (view: View) => void;
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
}

/**
 * Identidade visual por tipo de vitrine — SÓ apresentação (redesenho da
 * peça-22). A cor do tipo mora no chip do ícone, na trilha à esquerda do
 * card e no rótulo; o card em si é neutro, para a lista não virar sopa de
 * tinta. Nada aqui muda dados nem comportamento: os ids seguem os mesmos.
 */
const IDENTIDADE_DA_VITRINE = {
  new_arrivals: {
    badge: "Lançamentos",
    chip: "border-[#FFBF00]/25 bg-[#FFBF00]/10 text-[#FFBF00]",
    trilha: "bg-[#FFBF00]/70",
    texto: "text-[#FFBF00]",
    icon: <Sparkles className="size-5" />,
  },
  offers: {
    badge: "Ofertas",
    chip: "border-rose-500/25 bg-rose-500/10 text-rose-400",
    trilha: "bg-rose-500/70",
    texto: "text-rose-400",
    icon: <Flame className="size-5 fill-rose-500/20" />,
  },
  bestsellers: {
    badge: "Destaques",
    chip: "border-amber-400/25 bg-amber-400/10 text-amber-300",
    trilha: "bg-amber-400/70",
    texto: "text-amber-300",
    icon: <Zap className="size-5" />,
  },
  custom: {
    badge: "Customizada",
    chip: "border-purple-500/25 bg-purple-500/10 text-purple-300",
    trilha: "bg-purple-500/70",
    texto: "text-purple-300",
    icon: <Layers className="size-5" />,
  },
} as const;

type IdDaVitrine = keyof typeof IDENTIDADE_DA_VITRINE;

const identidadeDaVitrine = (id: string) =>
  IDENTIDADE_DA_VITRINE[id as IdDaVitrine] ?? IDENTIDADE_DA_VITRINE.custom;

export const AdminCarouselsView = memo(function AdminCarouselsView({
  onNavigate: _onNavigate,
  onSetDirty,
}: AdminCarouselsViewProps) {
  const { config, updateConfig } = useStore();
  const { products } = useProducts();
  const isOffline = useOnlineStatus();

  // Modals state
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showAddVitrineModal, setShowAddVitrineModal] = useState(false);
  const [newVitrineTitle, setNewVitrineTitle] = useState("");
  const [curationSectionId, setCurationSectionId] = useState<string | null>(
    null,
  );
  const [searchCurationQuery, setSearchCurationQuery] = useState("");

  const defaultHomeSections = useMemo<CarouselSection[]>(
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

  // Tecla Esc para fechar modais
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (curationSectionId) setCurationSectionId(null);
        else if (showAddVitrineModal) setShowAddVitrineModal(false);
        else if (showHelpModal) setShowHelpModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [curationSectionId, showAddVitrineModal, showHelpModal]);

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

  const handleAddCustomVitrine = async () => {
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
    // Só limpa o título e fecha o modal se a vitrine foi mesmo gravada. Antes
    // isso acontecia incondicionalmente: o admin via o modal fechar, o campo
    // esvaziar, e a vitrine não existia (ADMIN-010, #94).
    if (!(await handleUpdateHomeSections(updated, true))) return;
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
      const max = sec.maxItems ?? 6;
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

  // Section currently being curated
  const activeCurationSection = useMemo(() => {
    if (!curationSectionId) return null;
    return homeSections.find((s) => s.id === curationSectionId) ?? null;
  }, [curationSectionId, homeSections]);

  const isManualCurated = useMemo(() => {
    return Boolean(
      activeCurationSection?.productIds &&
        activeCurationSection.productIds.length > 0,
    );
  }, [activeCurationSection]);

  const activeCurationProductIds = useMemo(() => {
    if (!activeCurationSection) return [];
    if (
      activeCurationSection.productIds &&
      activeCurationSection.productIds.length > 0
    ) {
      return activeCurationSection.productIds;
    }
    // In automatic mode, active products are the ones computed in previewProducts
    return (previewProducts[activeCurationSection.id] || []).map((p) => p.id);
  }, [activeCurationSection, previewProducts]);

  // Products filtered and sorted inside curation modal (active products appear at top first)
  const filteredCurationProducts = useMemo(() => {
    let list = products;
    if (searchCurationQuery.trim()) {
      // Busca sem acento acha produto acentuado ("alianca" acha "Aliança") —
      // mesma regra (normalizeText) da busca da loja.
      const q = normalizeText(searchCurationQuery);
      list = products.filter(
        (p) =>
          normalizeText(p.name).includes(q) ||
          normalizeText(p.category).includes(q),
      );
    }
    if (!activeCurationSection) return list;

    const activeSet = new Set(activeCurationProductIds);
    const activeProducts: typeof products = [];
    const activeMap = new Map(list.map((p) => [p.id, p]));

    // Preserve activeCurationProductIds order first
    activeCurationProductIds.forEach((id) => {
      const p = activeMap.get(id);
      if (p) activeProducts.push(p);
    });

    const inactiveProducts = list.filter((p) => !activeSet.has(p.id));

    return [...activeProducts, ...inactiveProducts];
  }, [
    products,
    searchCurationQuery,
    activeCurationSection,
    activeCurationProductIds,
  ]);

  return (
    <div className="pb-admin relative h-auto w-full max-w-full overflow-x-hidden bg-[#09090b] font-sans text-zinc-400 selection:bg-admin-gold/30 selection:text-white">
      {/* Ambient background */}
      <div className="pointer-events-none absolute left-1/3 top-0 h-[250px] w-[250px] rounded-full bg-admin-gold/5 blur-[90px]" />

      {/* Sticky Desktop Header */}
      <div className="sticky top-0 z-40 hidden w-full border-b border-white/10 bg-[#09090b]/95 px-3 py-1.5 shadow-md backdrop-blur-md lg:block">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded-md border border-[#FFBF00]/30 bg-[#FFBF00]/10 text-[#FFBF00]">
              <Layers className="size-3" />
            </div>
            {/* Onda 3 da reforma visual (03/09): o título minúsculo (text-xs)
                virou o AdminPageHeader, igual ao das listas aprovadas. */}
            <AdminPageHeader titulo="Vitrines & Carrosséis" />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleResetDefaultVitrines}
              className="flex h-7 items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900 px-2.5 text-[10px] font-bold text-zinc-400 transition-colors hover:border-amber-500/40 hover:text-amber-400"
              title="Restaurar Vitrines Padrão"
            >
              <RotateCcw className="size-3" /> Restaurar Padrão
            </button>
            <button
              type="button"
              onClick={() => setShowHelpModal(true)}
              className="flex size-7 items-center justify-center rounded-lg border border-white/10 bg-zinc-900 text-zinc-400 transition-colors hover:border-[#FFBF00]/40 hover:text-[#FFBF00]"
              title="Ajuda"
            >
              <HelpCircle className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="relative z-10 mx-auto max-w-5xl space-y-4 p-3 sm:p-4">
        {/* Resumo + ação principal — tipografia no lugar de chips */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <Eye className="size-4 shrink-0 text-emerald-400" />
              <span className="font-mono text-sm font-black text-white">
                {activeVitrinesCount}/{homeSections.length}
              </span>
              <span className="text-xs text-zinc-400">no ar</span>
            </div>
            <span aria-hidden="true" className="h-4 w-px bg-white/10" />
            <div className="flex items-center gap-1.5">
              <Package className="size-4 shrink-0 text-[#FFBF00]" />
              <span className="font-mono text-sm font-black text-white">
                ~{totalProductsInActiveVitrines}
              </span>
              <span className="text-xs text-zinc-400">produtos</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAddVitrineModal(true)}
              className="flex h-9 items-center gap-1.5 rounded-xl bg-[#FFBF00] px-3.5 text-xs font-black text-black shadow-md shadow-[#FFBF00]/20 transition-all hover:bg-amber-400 active:scale-95"
            >
              <Plus className="size-4" /> Nova Vitrine
            </button>
            {/* No celular não há cabeçalho sticky: Restaurar e Ajuda moram
                aqui, junto da ação principal. No desktop ficam no topo. */}
            <button
              type="button"
              onClick={handleResetDefaultVitrines}
              className="flex size-9 items-center justify-center rounded-xl border border-white/10 bg-zinc-950/60 text-zinc-400 transition-colors hover:border-amber-500/40 hover:text-amber-400 lg:hidden"
              title="Restaurar Vitrines Padrão"
            >
              <RotateCcw className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setShowHelpModal(true)}
              className="flex size-9 items-center justify-center rounded-xl border border-white/10 bg-zinc-950/60 text-zinc-400 transition-colors hover:border-[#FFBF00]/40 hover:text-[#FFBF00] lg:hidden"
              title="Ajuda"
            >
              <HelpCircle className="size-4" />
            </button>
          </div>
        </div>

        {/* Gerenciador */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-2 px-0.5">
            <h2 className="text-[11px] font-black uppercase tracking-widest text-white">
              Gerenciador de Vitrines
              <span className="text-zinc-500"> ({homeSections.length})</span>
            </h2>
            <span className="hidden text-[10px] text-zinc-600 sm:block">
              Toque em "Selecionar Produtos" para escolher
            </span>
          </div>

          {/* Vitrines Cards List */}
          <div className="space-y-3">
            {homeSections.map((sec, index) => {
              const previewItems = previewProducts[sec.id] || [];
              const curatedCount = sec.productIds?.length ?? 0;
              const identidade = identidadeDaVitrine(sec.id);

              return (
                <article
                  key={sec.id}
                  className={cn(
                    "group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-900/40 shadow-lg backdrop-blur-md transition-all duration-200",
                    !sec.active &&
                      "opacity-60 saturate-50 hover:opacity-100 hover:saturate-100",
                  )}
                >
                  {/* trilha de identidade — a cor do tipo mora aqui e no chip */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute inset-y-0 left-0 w-1",
                      sec.active ? identidade.trilha : "bg-zinc-700",
                    )}
                  />

                  <div className="space-y-3 p-3 pl-4 sm:p-4 sm:pl-5">
                    {/* identidade: tipo + nome + estado */}
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "flex size-10 shrink-0 items-center justify-center rounded-xl border",
                          sec.active
                            ? identidade.chip
                            : "border-white/10 bg-zinc-900 text-zinc-500",
                        )}
                      >
                        {identidade.icon}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="relative">
                          <LocalBufferedInput
                            id={`vitrine-title-${sec.id}`}
                            name="title"
                            value={sec.title || ""}
                            onFlush={(val) => handleRenameSection(sec.id, val)}
                            placeholder="Título da vitrine"
                            useShadcn={true}
                            className="h-9 rounded-lg border-white/5 bg-black/20 pl-2.5 pr-8 text-[15px] font-bold text-white placeholder-zinc-600 focus:border-[#FFBF00]/60 focus:ring-1 focus:ring-[#FFBF00]"
                          />
                          <Edit className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" />
                        </div>
                        <div className="mt-1.5 flex items-center gap-2 pl-0.5">
                          <span className="font-mono text-[10px] font-black text-zinc-500">
                            #{index + 1}
                          </span>
                          <span
                            className={cn(
                              "text-[10px] font-black uppercase tracking-widest",
                              sec.active ? identidade.texto : "text-zinc-500",
                            )}
                          >
                            {identidade.badge}
                          </span>
                        </div>
                      </div>

                      {/* estado — o primeiro olhar responde: está no ar? */}
                      <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5">
                        <Switch
                          checked={sec.active}
                          onCheckedChange={() =>
                            handleToggleSectionActive(sec.id)
                          }
                          className="scale-125 data-[state=checked]:bg-emerald-500"
                        />
                        <span
                          className={cn(
                            "flex items-center gap-0.5 text-[9px] font-black uppercase tracking-wider",
                            sec.active ? "text-emerald-400" : "text-zinc-500",
                          )}
                        >
                          {sec.active ? (
                            <Eye className="size-3" />
                          ) : (
                            <EyeOff className="size-3" />
                          )}
                          {sec.active ? "Exibir" : "Ocultar"}
                        </span>
                      </div>
                    </div>

                    {/* a vitrine em si: a prévia dos produtos */}
                    <div className="flex items-center rounded-xl border border-white/5 bg-black/30 p-2">
                      <div className="scrollbar-thin flex flex-1 items-center gap-1.5 overflow-x-auto py-0.5">
                        {previewItems.length === 0 ? (
                          <span className="flex items-center gap-1.5 px-1 py-1.5 text-[10px] italic text-zinc-600">
                            <Tag className="size-3" /> Sem produtos
                          </span>
                        ) : (
                          previewItems.map((prod) => (
                            <div
                              key={prod.id}
                              className="size-10 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-zinc-900"
                              title={`${prod.name} - R$ ${prod.price.toFixed(2)}`}
                            >
                              {prod.images?.[0] ? (
                                <img
                                  src={prod.images[0]}
                                  alt={prod.name}
                                  className="size-full object-cover"
                                />
                              ) : (
                                <div className="flex size-full items-center justify-center text-zinc-600">
                                  <Tag className="size-3.5" />
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* ações: curadoria numa linha; ordem, limite e exclusão
                        na outra — cada controle no seu lugar, sem quebra surpresa */}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <button
                        type="button"
                        onClick={() => setCurationSectionId(sec.id)}
                        className={cn(
                          "flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border text-xs font-bold transition-all active:scale-[0.98] sm:w-auto",
                          curatedCount > 0
                            ? "border-[#FFBF00]/40 bg-[#FFBF00]/15 text-[#FFBF00] hover:bg-[#FFBF00]/25"
                            : "border-white/10 bg-zinc-950/60 text-zinc-200 hover:border-white/20 hover:text-white",
                        )}
                        title="Selecionar produtos manualmente para esta vitrine"
                      >
                        <Package className="size-3.5" />
                        <span>
                          {curatedCount > 0
                            ? `Curadoria (${curatedCount})`
                            : "Selecionar Produtos"}
                        </span>
                      </button>

                      <div className="flex items-center justify-between gap-2 sm:justify-end">
                        {/* ordem na Home */}
                        <div className="flex items-center gap-0.5 rounded-xl border border-white/10 bg-black/30 p-0.5">
                          <button
                            type="button"
                            onClick={() => moveSection(index, "up")}
                            disabled={index === 0}
                            className="flex h-8 w-9 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-[#FFBF00]/15 hover:text-[#FFBF00] active:scale-95 disabled:pointer-events-none disabled:opacity-20"
                            title="Subir"
                          >
                            <ArrowUp className="size-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveSection(index, "down")}
                            disabled={index === homeSections.length - 1}
                            className="flex h-8 w-9 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-[#FFBF00]/15 hover:text-[#FFBF00] active:scale-95 disabled:pointer-events-none disabled:opacity-20"
                            title="Descer"
                          >
                            <ArrowDown className="size-4" />
                          </button>
                        </div>

                        {/* limite por vitrine */}
                        <div className="flex h-9 items-center gap-1 rounded-xl border border-white/10 bg-black/30 pl-2 pr-1">
                          <span className="text-[9px] font-black uppercase tracking-wider text-zinc-500">
                            Máx
                          </span>
                          <Select
                            value={String(sec.maxItems ?? 6)}
                            onValueChange={(valor) =>
                              handleUpdateMaxItems(sec.id, Number(valor))
                            }
                          >
                            <SelectTrigger
                              size="sm"
                              aria-label={`Máximo de produtos em ${sec.title}`}
                              className="h-7 gap-0.5 rounded-lg border-white/10 bg-transparent pl-1.5 pr-1 font-mono text-xs font-bold text-white shadow-none hover:bg-white/5 focus-visible:ring-1 data-[size=sm]:h-7"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent
                              position="popper"
                              align="end"
                              sideOffset={6}
                              className="border-white/10 bg-zinc-950/95 backdrop-blur-md"
                            >
                              <SelectItem
                                className="rounded-lg font-mono text-xs font-bold text-zinc-300 focus:bg-white/10 focus:text-white"
                                value="4"
                              >
                                4
                              </SelectItem>
                              <SelectItem
                                className="rounded-lg font-mono text-xs font-bold text-zinc-300 focus:bg-white/10 focus:text-white"
                                value="6"
                              >
                                6
                              </SelectItem>
                              <SelectItem
                                className="rounded-lg font-mono text-xs font-bold text-zinc-300 focus:bg-white/10 focus:text-white"
                                value="8"
                              >
                                8
                              </SelectItem>
                              <SelectItem
                                className="rounded-lg font-mono text-xs font-bold text-zinc-300 focus:bg-white/10 focus:text-white"
                                value="10"
                              >
                                10
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* exclusão: só vitrine customizada tem */}
                        {sec.isCustom && (
                          <button
                            type="button"
                            onClick={() => handleDeleteVitrine(sec.id)}
                            className="flex size-9 items-center justify-center rounded-xl border border-rose-500/25 bg-rose-500/10 text-rose-400 transition-colors hover:bg-rose-500/20 active:scale-95"
                            title="Excluir Vitrine"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>

      {/* Modal 1: Adicionar Nova Vitrine Customizada */}
      {showAddVitrineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm duration-200 animate-in fade-in">
          <div className="w-full max-w-md space-y-4 rounded-3xl border border-white/10 bg-zinc-950 p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-xl border border-[#FFBF00]/30 bg-[#FFBF00]/10 text-[#FFBF00]">
                  <Plus className="size-4" />
                </div>
                <h3 className="text-sm font-black uppercase tracking-wide text-white">
                  Nova Vitrine
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddVitrineModal(false)}
                className="flex size-8 items-center justify-center rounded-full border border-white/10 bg-zinc-900 text-zinc-400 transition-colors hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="titulo-da-nova-vitrine"
                  className="text-[10px] font-black uppercase tracking-wider text-zinc-400"
                >
                  Título da Vitrine
                </label>
                <input
                  id="titulo-da-nova-vitrine"
                  type="text"
                  value={newVitrineTitle}
                  onChange={(e) => setNewVitrineTitle(e.target.value)}
                  placeholder="Ex: Kits Especiais de Beleza"
                  className="h-11 w-full rounded-xl border border-white/10 bg-zinc-900 px-3 text-sm font-bold text-white placeholder-zinc-600 focus:border-[#FFBF00] focus:outline-none"
                />
              </div>

              {/* Suggestions */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
                  Sugestões rápidas
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "Kits de Presente",
                    "Mais Vendidos da Semana",
                    "Linha Skincare",
                    "Coleção Verão",
                    "Recomendados para Você",
                  ].map((sug) => (
                    <button
                      key={sug}
                      type="button"
                      onClick={() => setNewVitrineTitle(sug)}
                      className="rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 transition-colors hover:border-[#FFBF00]/40 hover:text-[#FFBF00]"
                    >
                      + {sug}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-white/10 pt-3">
              <button
                type="button"
                onClick={() => setShowAddVitrineModal(false)}
                className="h-10 rounded-xl border border-white/10 bg-zinc-900 px-4 text-xs font-bold text-zinc-300 hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleAddCustomVitrine}
                className="h-10 rounded-xl bg-[#FFBF00] px-5 text-xs font-black text-black shadow-md transition-all hover:bg-amber-400 active:scale-95"
              >
                Criar Vitrine
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Seleção Manual de Produtos (Curadoria) */}
      {activeCurationSection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm duration-200 animate-in fade-in sm:p-4">
          <div className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 p-4 shadow-2xl sm:p-5">
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 pb-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-[#FFBF00]/30 bg-[#FFBF00]/10 text-[#FFBF00]">
                  <Package className="size-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-black uppercase tracking-wide text-white">
                    Curadoria de Produtos
                  </h3>
                  <p className="truncate text-[11px] text-zinc-400">
                    Vitrine:{" "}
                    <span className="font-bold text-[#FFBF00]">
                      {activeCurationSection.title}
                    </span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCurationSectionId(null)}
                className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-900 text-zinc-400 transition-colors hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Search input */}
            <div className="shrink-0 py-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  value={searchCurationQuery}
                  onChange={(e) => setSearchCurationQuery(e.target.value)}
                  placeholder="Buscar produto por nome ou categoria..."
                  className="h-10 w-full rounded-xl border border-white/10 bg-zinc-900 pl-9 pr-8 text-xs font-bold text-white placeholder-zinc-600 focus:border-[#FFBF00] focus:outline-none"
                />
                {searchCurationQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchCurationQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Counter bar */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/5 pb-2 text-[10px] font-bold text-zinc-400">
              {isManualCurated ? (
                <span className="text-[#FFBF00]">
                  {activeCurationSection.productIds?.length} produto(s)
                  selecionado(s) manualmente
                </span>
              ) : (
                <span className="flex items-center gap-1 text-amber-400">
                  <Sparkles className="size-3 shrink-0" />
                  Modo Automático: {activeCurationProductIds.length} produto(s)
                  pré-selecionados (Em exibição)
                </span>
              )}

              {isManualCurated && (
                <button
                  type="button"
                  onClick={() =>
                    handleUpdateHomeSections(
                      homeSections.map((s) =>
                        s.id === activeCurationSection.id
                          ? { ...s, productIds: [] }
                          : s,
                      ),
                      false,
                    )
                  }
                  className="shrink-0 text-[10px] font-bold text-rose-400 hover:underline"
                >
                  Resetar (voltar pro automático)
                </button>
              )}
            </div>

            {/* Products Selection List */}
            <div className="scrollbar-thin flex-1 space-y-1.5 overflow-y-auto py-2">
              {filteredCurationProducts.length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-500">
                  Nenhum produto encontrado na busca.
                </div>
              ) : (
                filteredCurationProducts.map((prod) => {
                  const isSelected = activeCurationProductIds.includes(prod.id);

                  return (
                    <button
                      key={prod.id}
                      type="button"
                      onClick={() =>
                        handleToggleProductInCuration(
                          activeCurationSection.id,
                          prod.id,
                        )
                      }
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-xl border p-2.5 text-left transition-all",
                        isSelected
                          ? "border-[#FFBF00]/50 bg-[#FFBF00]/15 text-white"
                          : "border-white/5 bg-zinc-900/60 text-zinc-300 hover:border-white/20",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        {/* Image Avatar */}
                        <div className="size-10 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-zinc-800">
                          {prod.images?.[0] ? (
                            <img
                              src={prod.images[0]}
                              alt={prod.name}
                              className="size-full object-cover"
                            />
                          ) : (
                            <div className="flex size-full items-center justify-center text-zinc-600">
                              <Tag className="size-3.5" />
                            </div>
                          )}
                        </div>

                        {/* Details */}
                        <div className="flex min-w-0 flex-col">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-[13px] font-bold text-white">
                              {prod.name}
                            </span>
                            {!isManualCurated && isSelected && (
                              <span className="shrink-0 rounded border border-amber-500/30 bg-amber-500/20 px-1.5 py-0.5 text-[8px] font-bold text-amber-300">
                                Automático
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-400">
                            <span className="font-bold text-[#FFBF00]">
                              R$ {prod.price.toFixed(2)}
                            </span>
                            <span>• {prod.category}</span>
                          </div>
                        </div>
                      </div>

                      {/* Checkbox indicator */}
                      <div
                        className={cn(
                          "ml-2 flex size-6 shrink-0 items-center justify-center rounded-lg border transition-all",
                          isSelected
                            ? "border-[#FFBF00] bg-[#FFBF00] text-black"
                            : "border-zinc-700 bg-zinc-900 text-transparent",
                        )}
                      >
                        <Check className="size-3.5 stroke-[3]" />
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="flex shrink-0 items-center justify-end border-t border-white/10 pt-3">
              <button
                type="button"
                onClick={() => setCurationSectionId(null)}
                className="h-10 rounded-xl bg-[#FFBF00] px-5 text-xs font-black text-black shadow-md transition-all hover:bg-amber-400 active:scale-95"
              >
                Concluir Curadoria
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Ajuda */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Guia do Gerenciador de Vitrines (Carrosséis)"
      >
        <div className="space-y-3 text-xs leading-relaxed text-zinc-400">
          <p>
            Esta tela permite organizar a exibição dos carrosséis de produtos na
            página inicial do aplicativo.
          </p>
          <div className="space-y-2">
            <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-wider text-white">
              Recursos Avançados
            </h4>
            <ul className="list-disc space-y-1 pl-4 text-zinc-400">
              <li>
                <strong>+ Nova Vitrine:</strong> Crie seções personalizadas com
                seus próprios títulos.
              </li>
              <li>
                <strong>Curadoria de Produtos:</strong> Escolha manualmente
                quais produtos específicos aparecem em cada vitrine.
              </li>
              <li>
                <strong>Limite Max:</strong> Altere a quantidade de produtos
                exibidos (4, 6, 8 ou 10).
              </li>
              <li>
                <strong>Reordenar:</strong> Use as setas para alterar qual
                vitrine aparece primeiro na Home.
              </li>
            </ul>
          </div>
        </div>
      </AdminHelpModal>
    </div>
  );
});
