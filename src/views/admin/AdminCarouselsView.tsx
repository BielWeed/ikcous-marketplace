import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/contexts/StoreContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useProducts } from "@/hooks/useProducts";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Edit,
  Eye,
  EyeOff,
  Flame,
  GripVertical,
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

  const handleUpdateHomeSections = async (
    updated: typeof homeSections,
    showToast = false,
  ) => {
    try {
      await updateConfig({ homeSections: updated });
      onSetDirty?.(false);
      if (showToast) {
        toast.success("Vitrines salvas com sucesso!");
      }
    } catch (error) {
      console.error("Erro ao atualizar as vitrines:", error);
      toast.error("Erro ao salvar ordem das vitrines.");
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
    await handleUpdateHomeSections(updated, true);
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

  // Preview products for each vitrine section (respeitando a ordem exata de seleção de curadoria)
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
        // new_arrivals or default custom
        map[sec.id] = [...products]
          .sort((a, b) => (b.createdTime ?? 0) - (a.createdTime ?? 0))
          .slice(0, max);
      }
    });

    return map;
  }, [homeSections, products]);

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
      const q = searchCurationQuery.toLowerCase();
      list = products.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.category?.toLowerCase().includes(q),
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
  }, [products, searchCurationQuery, activeCurationSection, activeCurationProductIds]);

  return (
    <div className="relative h-auto w-full max-w-full overflow-x-hidden bg-[#09090b] pb-admin font-sans text-zinc-400 selection:bg-admin-gold/30 selection:text-white">
      {/* Ambient background */}
      <div className="pointer-events-none absolute left-1/3 top-0 h-[250px] w-[250px] rounded-full bg-admin-gold/5 blur-[90px]" />

      {/* Sticky Desktop Header */}
      <div className="hidden lg:block sticky top-0 z-40 w-full border-b border-white/10 bg-[#09090b]/95 px-3 py-1.5 shadow-md backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex size-6 items-center justify-center rounded-md border border-[#FFBF00]/30 bg-[#FFBF00]/10 text-[#FFBF00]">
              <Layers className="size-3" />
            </div>
            <h1 className="select-none text-xs font-black uppercase tracking-wider text-white truncate">
              Vitrines & Carrosséis
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleResetDefaultVitrines}
              className="flex items-center gap-1 rounded-xl border border-white/10 bg-zinc-900 px-2 py-1 text-[9px] font-bold text-zinc-400 hover:border-amber-500/40 hover:text-amber-400 transition-colors"
              title="Restaurar Vitrines Padrão"
            >
              <RotateCcw className="size-2.5" /> Restaurar Padrão
            </button>
            <button
              type="button"
              onClick={() => setShowHelpModal(true)}
              className="flex size-5 items-center justify-center rounded-full border border-white/10 bg-zinc-900 text-zinc-400 hover:border-[#FFBF00]/40 hover:text-[#FFBF00]"
              title="Ajuda"
            >
              <HelpCircle className="size-3" />
            </button>
          </div>
        </div>
      </div>

      <div className="relative z-10 mx-auto max-w-5xl space-y-3 p-2.5 sm:p-4">
        {/* Top Micro Stats Bar + Quick Action Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-zinc-950/80 p-2 text-[10px] backdrop-blur-md shadow-sm">
          {/* Stats Chips */}
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-xl bg-zinc-900/80 border border-white/5">
              <Eye className="size-3 text-emerald-400 shrink-0" />
              <span className="font-mono font-bold text-white">
                {activeVitrinesCount}/{homeSections.length}
              </span>
              <span className="hidden sm:inline text-zinc-400">Ativas</span>
            </div>

            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-xl bg-zinc-900/80 border border-white/5">
              <Package className="size-3 text-[#FFBF00] shrink-0" />
              <span className="font-mono font-bold text-white">
                ~{totalProductsInActiveVitrines}
              </span>
              <span className="hidden sm:inline text-zinc-400">Produtos</span>
            </div>
          </div>

          {/* Action Buttons: Add Vitrine + Reset */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowAddVitrineModal(true)}
              className="flex items-center gap-1 rounded-xl border border-[#FFBF00]/40 bg-[#FFBF00]/15 px-2.5 py-1 font-mono text-[9px] font-black text-[#FFBF00] hover:bg-[#FFBF00]/25 transition-all shadow-xs active:scale-95"
            >
              <Plus className="size-3" />+ Nova Vitrine
            </button>

            <button
              type="button"
              onClick={handleResetDefaultVitrines}
              className="sm:hidden flex items-center justify-center size-6 rounded-xl border border-white/10 bg-zinc-900 text-zinc-400"
              title="Restaurar Vitrines Padrão"
            >
              <RotateCcw className="size-3" />
            </button>
          </div>
        </div>

        {/* Vitrines Cards Section */}
        <div className="space-y-2">
          {/* Header Line */}
          <div className="flex items-center justify-between px-1 text-[11px] font-black uppercase tracking-wider text-white">
            <div className="flex items-center gap-1.5">
              <Edit className="size-3 text-[#FFBF00]" />
              <span>Gerenciador de Vitrines ({homeSections.length})</span>
            </div>
            <span className="text-[9px] font-normal normal-case text-zinc-500">
              Clique em "Produtos" para selecionar
            </span>
          </div>

          {/* Vitrines Cards List */}
          <div className="space-y-2">
            {homeSections.map((sec, index) => {
              const previewItems = previewProducts[sec.id] || [];
              const isNew = sec.id === "new_arrivals";
              const isOffers = sec.id === "offers";
              const isBestsellers = sec.id === "bestsellers";
              const curatedCount = sec.productIds?.length ?? 0;

              // Theme styling per section
              const theme = isNew
                ? {
                    badgeText: "Lançamentos",
                    badgeClass:
                      "bg-[#FFBF00]/15 text-[#FFBF00] border-[#FFBF00]/30",
                    glowClass:
                      "from-[#FFBF00]/10 via-zinc-950/90 to-zinc-950 border-[#FFBF00]/25",
                    icon: <Sparkles className="size-3 text-[#FFBF00]" />,
                  }
                : isOffers
                  ? {
                      badgeText: "Ofertas",
                      badgeClass:
                        "bg-rose-500/15 text-rose-400 border-rose-500/30",
                      glowClass:
                        "from-rose-500/10 via-zinc-950/90 to-zinc-950 border-rose-500/25",
                      icon: (
                        <Flame className="size-3 text-rose-500 fill-rose-500/20" />
                      ),
                    }
                  : isBestsellers
                    ? {
                        badgeText: "Destaques",
                        badgeClass:
                          "bg-amber-400/15 text-amber-300 border-amber-400/30",
                        glowClass:
                          "from-amber-500/10 via-zinc-950/90 to-zinc-950 border-amber-500/25",
                        icon: <Zap className="size-3 text-amber-400" />,
                      }
                    : {
                        badgeText: "Customizada",
                        badgeClass:
                          "bg-purple-500/15 text-purple-300 border-purple-500/30",
                        glowClass:
                          "from-purple-500/10 via-zinc-950/90 to-zinc-950 border-purple-500/25",
                        icon: <Layers className="size-3 text-purple-400" />,
                      };

              return (
                <div
                  key={sec.id}
                  className={cn(
                    "group relative overflow-hidden rounded-2xl border bg-gradient-to-r p-2.5 shadow-md backdrop-blur-md transition-all duration-200",
                    theme.glowClass,
                    !sec.active &&
                      "opacity-55 saturate-50 hover:opacity-100 hover:saturate-100",
                  )}
                >
                  <div className="flex flex-col gap-2">
                    {/* Top Row inside Card: Badges + Action Buttons */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <GripVertical className="size-3.5 text-zinc-600 shrink-0" />

                        <span className="rounded-md border border-white/10 bg-zinc-900/90 px-1.5 py-0.5 font-mono text-[9px] font-black text-white shrink-0">
                          #{index + 1}
                        </span>

                        <span
                          className={cn(
                            "flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[8px] font-black uppercase tracking-wider shrink-0",
                            theme.badgeClass,
                          )}
                        >
                          {theme.icon}
                          {theme.badgeText}
                        </span>

                        {/* Max items limit selector */}
                        <div className="flex items-center gap-1 rounded-md border border-white/10 bg-zinc-900 px-1.5 py-0.5 text-[8px] font-bold text-zinc-400 shrink-0">
                          <span>Max:</span>
                          <select
                            value={sec.maxItems ?? 6}
                            onChange={(e) =>
                              handleUpdateMaxItems(
                                sec.id,
                                Number(e.target.value),
                              )
                            }
                            className="bg-transparent text-white font-mono font-bold focus:outline-none cursor-pointer pr-1"
                          >
                            <option
                              value={4}
                              className="bg-zinc-900 text-white"
                            >
                              4
                            </option>
                            <option
                              value={6}
                              className="bg-zinc-900 text-white"
                            >
                              6
                            </option>
                            <option
                              value={8}
                              className="bg-zinc-900 text-white"
                            >
                              8
                            </option>
                            <option
                              value={10}
                              className="bg-zinc-900 text-white"
                            >
                              10
                            </option>
                          </select>
                        </div>
                      </div>

                      {/* Right Cluster: Delete Custom + Visibility Switch + Reorder */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* Delete Custom Section Button */}
                        {sec.isCustom && (
                          <button
                            type="button"
                            onClick={() => handleDeleteVitrine(sec.id)}
                            className="flex size-6 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 active:scale-95 transition-colors"
                            title="Excluir Vitrine"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        )}

                        {/* Visibility Switch */}
                        <div className="flex items-center gap-1 bg-zinc-900/80 px-1.5 py-0.5 rounded-xl border border-white/5">
                          <span className="text-[8px] font-bold uppercase tracking-wider text-zinc-400">
                            {sec.active ? (
                              <span className="text-emerald-400 flex items-center gap-0.5">
                                <Eye className="size-2.5" /> Exibir
                              </span>
                            ) : (
                              <span className="text-zinc-500 flex items-center gap-0.5">
                                <EyeOff className="size-2.5" /> Ocultar
                              </span>
                            )}
                          </span>
                          <Switch
                            checked={sec.active}
                            onCheckedChange={() =>
                              handleToggleSectionActive(sec.id)
                            }
                            className="scale-75 origin-right data-[state=checked]:bg-[#FFBF00]"
                          />
                        </div>

                        {/* Reorder Buttons */}
                        <div className="flex items-center gap-0.5 bg-zinc-900/90 p-0.5 rounded-xl border border-white/10">
                          <button
                            type="button"
                            onClick={() => moveSection(index, "up")}
                            disabled={index === 0}
                            className="flex size-6 items-center justify-center rounded-lg border border-white/5 bg-zinc-800 text-zinc-300 transition-colors hover:bg-[#FFBF00]/20 hover:text-[#FFBF00] active:scale-95 disabled:pointer-events-none disabled:opacity-20"
                            title="Subir"
                          >
                            <ArrowUp className="size-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveSection(index, "down")}
                            disabled={index === homeSections.length - 1}
                            className="flex size-6 items-center justify-center rounded-lg border border-white/5 bg-zinc-800 text-zinc-300 transition-colors hover:bg-[#FFBF00]/20 hover:text-[#FFBF00] active:scale-95 disabled:pointer-events-none disabled:opacity-20"
                            title="Descer"
                          >
                            <ArrowDown className="size-3" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Bottom Row inside Card: Editable Title Input + Manual Curation Button + Mini Avatars */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      {/* Title Input */}
                      <div className="relative flex-1">
                        <LocalBufferedInput
                          id={`vitrine-title-${sec.id}`}
                          name="title"
                          value={sec.title || ""}
                          onFlush={(val) => handleRenameSection(sec.id, val)}
                          placeholder="Título da vitrine"
                          useShadcn={true}
                          className="h-8 rounded-xl border-white/10 bg-zinc-900/90 pl-2.5 pr-8 text-xs font-bold text-white placeholder-zinc-600 focus:border-[#FFBF00]/50 focus:ring-1 focus:ring-[#FFBF00]"
                        />
                        <Edit className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
                      </div>

                      {/* Manual Curation Trigger Button */}
                      <button
                        type="button"
                        onClick={() => setCurationSectionId(sec.id)}
                        className={cn(
                          "flex items-center gap-1.5 h-8 px-2.5 rounded-xl border font-mono text-[9px] font-bold transition-all shrink-0 active:scale-95",
                          curatedCount > 0
                            ? "bg-[#FFBF00]/15 border-[#FFBF00]/40 text-[#FFBF00] hover:bg-[#FFBF00]/25"
                            : "bg-zinc-900/90 border-white/10 text-zinc-300 hover:border-white/20 hover:text-white",
                        )}
                        title="Selecionar produtos manualmente para esta vitrine"
                      >
                        <Package className="size-3" />
                        <span>
                          {curatedCount > 0
                            ? `Curadoria (${curatedCount})`
                            : "Selecionar Produtos"}
                        </span>
                      </button>

                      {/* Product Mini Avatars */}
                      <div className="flex items-center gap-1 shrink-0 overflow-x-auto py-0.5">
                        {previewItems.length === 0 ? (
                          <span className="text-[9px] text-zinc-600 italic">
                            Sem produtos
                          </span>
                        ) : (
                          previewItems.map((prod) => (
                            <div
                              key={prod.id}
                              className="relative size-6 shrink-0 rounded-md border border-white/10 bg-zinc-900 overflow-hidden"
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
                                  <Tag className="size-2.5" />
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Modal 1: Adicionar Nova Vitrine Customizada */}
      {showAddVitrineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md space-y-4 rounded-3xl border border-[#FFBF00]/30 bg-zinc-950 p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-xl border border-[#FFBF00]/30 bg-[#FFBF00]/10 text-[#FFBF00]">
                  <Plus className="size-4" />
                </div>
                <h3 className="text-xs font-black uppercase tracking-wider text-white">
                  Criar Nova Vitrine Personalizada
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddVitrineModal(false)}
                className="flex size-6 items-center justify-center rounded-full border border-white/10 bg-zinc-900 text-zinc-400 hover:text-white"
              >
                <X className="size-3.5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  Título da Vitrine
                </label>
                <input
                  type="text"
                  value={newVitrineTitle}
                  onChange={(e) => setNewVitrineTitle(e.target.value)}
                  placeholder="Ex: Kits Especiais de Beleza"
                  className="h-10 w-full rounded-xl border border-white/10 bg-zinc-900 px-3 text-xs font-bold text-white placeholder-zinc-600 focus:border-[#FFBF00] focus:outline-none"
                />
              </div>

              {/* Suggestions */}
              <div className="space-y-1">
                <span className="text-[9px] font-bold text-zinc-500 uppercase">
                  Sugestões rápidas:
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
                      className="rounded-lg border border-white/10 bg-zinc-900 px-2 py-1 text-[9px] font-medium text-zinc-300 hover:border-[#FFBF00]/40 hover:text-[#FFBF00] transition-colors"
                    >
                      + {sug}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowAddVitrineModal(false)}
                className="h-9 px-4 rounded-xl border border-white/10 bg-zinc-900 text-xs font-bold text-zinc-300 hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleAddCustomVitrine}
                className="h-9 px-4 rounded-xl border border-[#FFBF00]/40 bg-[#FFBF00] text-xs font-black text-black hover:bg-amber-400 transition-all shadow-md active:scale-95"
              >
                Criar Vitrine
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Seleção Manual de Produtos (Curadoria) */}
      {activeCurationSection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-xl max-h-[85vh] flex flex-col rounded-3xl border border-[#FFBF00]/30 bg-zinc-950 p-4 sm:p-5 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-xl border border-[#FFBF00]/30 bg-[#FFBF00]/10 text-[#FFBF00]">
                  <Package className="size-4" />
                </div>
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-white">
                    Curadoria de Produtos
                  </h3>
                  <p className="text-[10px] text-zinc-400">
                    Vitrine:{" "}
                    <span className="text-[#FFBF00] font-bold">
                      {activeCurationSection.title}
                    </span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCurationSectionId(null)}
                className="flex size-6 items-center justify-center rounded-full border border-white/10 bg-zinc-900 text-zinc-400 hover:text-white"
              >
                <X className="size-3.5" />
              </button>
            </div>

            {/* Search input */}
            <div className="py-3 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  value={searchCurationQuery}
                  onChange={(e) => setSearchCurationQuery(e.target.value)}
                  placeholder="Buscar produto por nome ou categoria..."
                  className="h-9 w-full rounded-xl border border-white/10 bg-zinc-900 pl-9 pr-8 text-xs font-bold text-white placeholder-zinc-600 focus:border-[#FFBF00] focus:outline-none"
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
            <div className="flex items-center justify-between text-[10px] font-bold text-zinc-400 pb-2 border-b border-white/5 shrink-0">
              {isManualCurated ? (
                <span className="text-[#FFBF00]">
                  {activeCurationSection.productIds?.length} produto(s) selecionado(s) manualmente
                </span>
              ) : (
                <span className="text-amber-400 flex items-center gap-1">
                  <Sparkles className="size-3 shrink-0" />
                  Modo Automático: {activeCurationProductIds.length} produto(s) pré-selecionados (Em exibição)
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
                  className="text-rose-400 hover:underline text-[9px]"
                >
                  Resetar Seleção (Voltar pro Automático)
                </button>
              )}
            </div>

            {/* Products Selection List */}
            <div className="flex-1 overflow-y-auto py-2 space-y-1.5 scrollbar-thin">
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
                        "w-full flex items-center justify-between p-2 rounded-xl border text-left transition-all",
                        isSelected
                          ? "bg-[#FFBF00]/15 border-[#FFBF00]/50 text-white"
                          : "bg-zinc-900/60 border-white/5 hover:border-white/20 text-zinc-300",
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {/* Image Avatar */}
                        <div className="size-8 rounded-lg border border-white/10 overflow-hidden bg-zinc-800 shrink-0">
                          {prod.images?.[0] ? (
                            <img
                              src={prod.images[0]}
                              alt={prod.name}
                              className="size-full object-cover"
                            />
                          ) : (
                            <div className="flex size-full items-center justify-center text-zinc-600">
                              <Tag className="size-3" />
                            </div>
                          )}
                        </div>

                        {/* Details */}
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs font-bold truncate text-white">
                              {prod.name}
                            </span>
                            {!isManualCurated && isSelected && (
                              <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[8px] font-bold text-amber-300 border border-amber-500/30">
                                Automático
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[9px] text-zinc-400 font-mono">
                            <span className="text-[#FFBF00] font-bold">
                              R$ {prod.price.toFixed(2)}
                            </span>
                            <span>• {prod.category}</span>
                          </div>
                        </div>
                      </div>

                      {/* Checkbox indicator */}
                      <div
                        className={cn(
                          "flex size-5 items-center justify-center rounded-lg border transition-all shrink-0 ml-2",
                          isSelected
                            ? "border-[#FFBF00] bg-[#FFBF00] text-black"
                            : "border-zinc-700 bg-zinc-900 text-transparent",
                        )}
                      >
                        <Check className="size-3 stroke-[3]" />
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end pt-3 border-t border-white/10 shrink-0">
              <button
                type="button"
                onClick={() => setCurationSectionId(null)}
                className="h-9 px-5 rounded-xl border border-[#FFBF00]/40 bg-[#FFBF00] text-xs font-black text-black hover:bg-amber-400 transition-all shadow-md active:scale-95"
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
            <ul className="list-disc pl-4 space-y-1 text-zinc-400">
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
