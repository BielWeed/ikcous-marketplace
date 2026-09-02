import { useStore } from "@/contexts/StoreContext";
import { cn } from "@/lib/utils";
import type { ProductVariant } from "@/types";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Flame,
  Heart,
  Image as ImageIcon,
  MessageCircle,
  Share2,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Truck,
  X,
} from "lucide-react";
import React, { memo } from "react";
import { createPortal } from "react-dom";

interface PhoneSimulatorProps {
  readonly onClose: () => void;
  readonly formData: {
    readonly name: string;
    readonly description: string;
    readonly price: string;
    readonly costPrice: string;
    readonly originalPrice: string;
    readonly stock: string;
    readonly category: string;
    readonly images: readonly string[];
    readonly freeShipping: boolean;
    readonly isBestseller: boolean;
    readonly isActive: boolean;
    readonly variants: readonly ProductVariant[];
  };
  readonly previewMode: "card" | "page";
  readonly setPreviewMode: (mode: "card" | "page") => void;
  readonly previewImgIndex: number;
  readonly setPreviewImgIndex: React.Dispatch<React.SetStateAction<number>>;
  readonly previewSelectedVariants: Record<string, string>;
  readonly setPreviewSelectedVariants: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  readonly activeDetailTab: "description" | "reviews" | "questions";
  readonly setActiveDetailTab: (
    tab: "description" | "reviews" | "questions",
  ) => void;
}

export const PhoneSimulator = memo(function PhoneSimulator({
  onClose,
  formData,
  previewMode,
  setPreviewMode,
  previewImgIndex,
  setPreviewImgIndex,
  previewSelectedVariants,
  setPreviewSelectedVariants,
  activeDetailTab,
  setActiveDetailTab,
}: PhoneSimulatorProps) {
  const { config } = useStore();

  const [failedImages, setFailedImages] = React.useState<
    Record<string, boolean>
  >({});

  const selectedVariant = React.useMemo(() => {
    // Find the first active variant matching selected values
    return (formData.variants || []).find((v) => {
      if (!v.active) return false;
      return previewSelectedVariants[v.name] === v.value;
    });
  }, [formData.variants, previewSelectedVariants]);

  const displayPrice = React.useMemo(() => {
    if (
      selectedVariant?.priceOverride !== undefined &&
      selectedVariant.priceOverride !== null
    ) {
      return selectedVariant.priceOverride.toString();
    }
    return formData.price;
  }, [formData.price, selectedVariant]);

  const validImages = React.useMemo(() => {
    const baseImages = (formData.images || []).filter(
      (img) => img && !failedImages[img],
    );
    if (selectedVariant?.imageUrl && !failedImages[selectedVariant.imageUrl]) {
      return [
        selectedVariant.imageUrl,
        ...baseImages.filter((img) => img !== selectedVariant.imageUrl),
      ];
    }
    return baseImages;
  }, [formData.images, selectedVariant, failedImages]);

  // Reset image carousel index when selected variant changes to show its custom image
  React.useEffect(() => {
    setPreviewImgIndex(0);
  }, [selectedVariant, setPreviewImgIndex]);

  const handleImageError = React.useCallback((imgUrl: string) => {
    setFailedImages((prev) => ({ ...prev, [imgUrl]: true }));
  }, []);

  // Lock body scroll when simulator is open
  React.useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[100] flex flex-col bg-zinc-950/70 text-zinc-100 backdrop-blur-xl"
    >
      {/* Modal Header — fundo mais sólido que o véu do overlay para o texto
          ficar nítido sobre o formulário embaçado atrás. */}
      <div className="flex items-center justify-between border-b border-white/5 bg-zinc-950/85 px-6 py-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
            <Smartphone className="size-4" />
          </div>
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-white">
              Simulador do Aplicativo
            </h3>
            <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
              Prévia em Tempo Real
            </p>
          </div>
        </div>

        {/* Controls & Close */}
        <div className="flex items-center gap-4">
          {/* Toggle Selector */}
          <div className="flex items-center gap-1 rounded-xl border border-white/5 bg-zinc-900 p-1">
            <button
              type="button"
              onClick={() => setPreviewMode("card")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer",
                previewMode === "card"
                  ? "bg-emerald-500 text-emerald-950 shadow-md font-extrabold"
                  : "text-zinc-400 hover:text-white",
              )}
            >
              Card
            </button>
            <button
              type="button"
              onClick={() => setPreviewMode("page")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer",
                previewMode === "page"
                  ? "bg-emerald-500 text-emerald-950 shadow-md font-extrabold"
                  : "text-zinc-400 hover:text-white",
              )}
            >
              Página
            </button>
          </div>

          {/* Close Button */}
          <button
            type="button"
            onClick={onClose}
            className="flex size-9 cursor-pointer items-center justify-center rounded-xl border border-white/5 bg-zinc-900 text-zinc-400 transition-all hover:bg-zinc-800 hover:text-white active:scale-95"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>

      {/* Modal Simulator Body */}
      <div className="flex flex-1 items-center justify-center overflow-y-auto p-6 md:p-12">
        <motion.div
          initial={{ scale: 0.95, y: 15 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.95, y: 15 }}
          transition={{ type: "spring", damping: 25, stiffness: 350 }}
          className="relative flex w-full max-w-sm justify-center"
        >
          {/* Phone frame styling wrapper (premium aesthetics) */}
          <div className="relative rounded-[3.25rem] border border-white/10 bg-zinc-900 p-4 shadow-[0_25px_60px_rgba(0,0,0,0.8)]">
            {/* Speaker / Notch simulator */}
            <div className="absolute left-1/2 top-6 z-20 flex h-4 w-24 -translate-x-1/2 items-center justify-center rounded-full bg-zinc-950">
              <div className="h-1 w-8 rounded-full bg-zinc-850" />
              <div className="ml-2 size-1.5 rounded-full bg-zinc-900" />
            </div>

            {/* Live Content Screen */}
            <div className="relative flex flex-col overflow-hidden rounded-[2.5rem] border border-white/5 bg-zinc-950 text-left">
              {previewMode === "card" ? (
                <div className="relative flex w-[240px] flex-col overflow-hidden bg-zinc-50/5 text-left shadow-2xl transition-all duration-300">
                  {/* Image Container */}
                  <div className="relative aspect-[4/5] overflow-hidden bg-zinc-900/50">
                    {validImages.length > 0 ? (
                      <img
                        src={validImages[0]}
                        alt={formData.name || "Sem nome"}
                        className="size-full object-cover"
                        onError={() => handleImageError(validImages[0])}
                      />
                    ) : (
                      <div className="flex size-full flex-col items-center justify-center gap-2 bg-zinc-950/80 text-zinc-600">
                        <ImageIcon className="size-8 opacity-20" />
                        <span className="text-[8px] font-black uppercase tracking-widest opacity-40">
                          Sem imagem
                        </span>
                      </div>
                    )}

                    {/* Floating Badges */}
                    <div className="absolute left-3 top-3 flex max-w-[calc(100%-48px)] flex-wrap items-center gap-1.5">
                      {/* Stock Badge */}
                      {Number.parseInt(formData.stock) > 0 ? (
                        Number.parseInt(formData.stock) <= 3 && (
                          <div className="flex shrink-0 select-none items-center gap-1 whitespace-nowrap rounded-full border border-amber-200/60 bg-amber-50/90 px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wider text-amber-700 shadow-sm backdrop-blur-md">
                            <span className="relative flex size-1 shrink-0">
                              <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
                              <span className="relative inline-flex size-1 rounded-full bg-amber-500" />
                            </span>
                            <span>Só restam {formData.stock}</span>
                          </div>
                        )
                      ) : (
                        <div className="flex shrink-0 select-none items-center gap-1 whitespace-nowrap rounded-full border border-zinc-200/60 bg-zinc-100/90 px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wider text-zinc-500 shadow-sm backdrop-blur-md">
                          <span className="size-1 shrink-0 rounded-full bg-zinc-400" />
                          <span>Esgotado</span>
                        </div>
                      )}

                      {/* Promotion Discount Badge */}
                      {formData.originalPrice &&
                        Number.parseFloat(formData.originalPrice) >
                          Number.parseFloat(displayPrice) && (
                          <div className="shrink-0 select-none whitespace-nowrap rounded-full border border-rose-200/60 bg-rose-50/90 px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wider text-rose-600 shadow-sm backdrop-blur-md">
                            {Math.round(
                              ((Number.parseFloat(formData.originalPrice) -
                                Number.parseFloat(displayPrice)) /
                                Number.parseFloat(formData.originalPrice)) *
                                100,
                            )}
                            % OFF
                          </div>
                        )}

                      {/* Bestseller (HOT) Badge */}
                      {formData.isBestseller && (
                        <div className="flex shrink-0 select-none items-center gap-1 whitespace-nowrap rounded-full border border-zinc-800 bg-zinc-900/95 px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wider text-white shadow-sm backdrop-blur-md">
                          <Flame className="size-2 fill-orange-400 text-orange-400" />
                          <span>EM ALTA</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex flex-1 flex-col gap-1.5 border-t border-white/5 bg-zinc-950 p-3.5">
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="max-w-[65%] truncate text-[8px] font-bold uppercase tracking-widest text-zinc-500">
                          {formData.category || "Categoria"}
                        </p>
                        {formData.freeShipping && (
                          <div className="flex shrink-0 items-center gap-1 rounded-md border border-emerald-50/20 bg-emerald-50/10 px-1.5 py-0.5 text-[7px] font-black text-emerald-400">
                            <Truck className="size-2 shrink-0" />
                            <span className="truncate">Frete Grátis</span>
                          </div>
                        )}
                      </div>

                      <h3 className="line-clamp-2 min-h-8 text-xs font-black leading-snug text-white">
                        {formData.name || "Nome do produto"}
                      </h3>

                      <div className="flex items-center text-[9px] text-amber-400">
                        ★★★★★
                      </div>
                    </div>

                    {/* Price */}
                    <div className="mt-auto flex items-end pt-1">
                      <div className="flex w-full flex-col">
                        {formData.originalPrice &&
                        Number.parseFloat(formData.originalPrice) >
                          Number.parseFloat(displayPrice) ? (
                          <div className="flex flex-col">
                            <span className="text-[8px] font-bold uppercase leading-none tracking-wider text-zinc-500">
                              De:{" "}
                              <span className="line-through">
                                R${" "}
                                {Number.parseFloat(
                                  formData.originalPrice,
                                ).toLocaleString("pt-BR", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                            </span>
                            <span className="mt-1 text-xs font-black leading-none tracking-tight text-rose-500">
                              Por: R${" "}
                              {Number.parseFloat(displayPrice).toLocaleString(
                                "pt-BR",
                                {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                },
                              )}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs font-black leading-none tracking-tight text-white">
                            R${" "}
                            {Number.parseFloat(
                              displayPrice || "0",
                            ).toLocaleString("pt-BR", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="scrollbar-none relative flex h-[520px] w-[280px] flex-col overflow-y-auto rounded-[2rem] border border-zinc-200 bg-white text-left text-zinc-950 shadow-2xl [&::-webkit-scrollbar]:hidden">
                  {/* Simulated Phone Header Gallery */}
                  <div className="relative aspect-square shrink-0 bg-[#F8F9FA]">
                    <div className="flex size-full items-center justify-center overflow-hidden">
                      {validImages.length > 0 ? (
                        <img
                          src={validImages[previewImgIndex] || validImages[0]}
                          alt={formData.name || "Preview"}
                          className="h-full w-auto max-w-full object-contain"
                          onError={() =>
                            handleImageError(
                              validImages[previewImgIndex] || validImages[0],
                            )
                          }
                        />
                      ) : (
                        <div className="flex size-full flex-col items-center justify-center gap-1 bg-zinc-50 text-zinc-400">
                          <ImageIcon className="size-6 opacity-30" />
                          <span className="text-[7px] font-black uppercase tracking-widest opacity-50">
                            Sem imagem
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Header overlay actions */}
                    <div className="absolute left-4 top-4 flex size-7 items-center justify-center rounded-full bg-white/85 text-zinc-700 shadow-sm backdrop-blur-md">
                      <ArrowLeft className="size-4" />
                    </div>
                    <div className="absolute right-4 top-4 flex gap-2">
                      <div className="flex size-7 items-center justify-center rounded-full bg-white/85 text-zinc-700 shadow-sm backdrop-blur-md">
                        <Heart className="size-4 text-zinc-400" />
                      </div>
                      <div className="flex size-7 items-center justify-center rounded-full bg-white/85 text-zinc-700 shadow-sm backdrop-blur-md">
                        <Share2 className="size-4" />
                      </div>
                    </div>

                    {/* Gallery Navigation */}
                    {validImages.length > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewImgIndex(
                              (prev) =>
                                (prev - 1 + validImages.length) %
                                validImages.length,
                            );
                          }}
                          className="absolute left-2 top-1/2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/85 text-zinc-700 shadow-sm transition-all hover:bg-white"
                        >
                          <ChevronLeft className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewImgIndex(
                              (prev) => (prev + 1) % validImages.length,
                            );
                          }}
                          className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/85 text-zinc-700 shadow-sm transition-all hover:bg-white"
                        >
                          <ChevronRight className="size-4" />
                        </button>

                        {/* Image indicators */}
                        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1 rounded-full bg-black/10 px-2.5 py-1 backdrop-blur-md">
                          {validImages.map((_, idx) => (
                            <div
                              key={idx}
                              className={cn(
                                "h-1 rounded-full transition-all duration-300",
                                idx === previewImgIndex
                                  ? "bg-white w-4"
                                  : "bg-white/40 w-1",
                              )}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Simulated Content Body */}
                  <div className="flex flex-1 flex-col gap-3 bg-white p-4">
                    {/* Breadcrumb / Category */}
                    <span className="block text-[8px] font-black uppercase tracking-wider text-zinc-400">
                      Início &gt; {formData.category || "Categoria"}
                    </span>

                    {/* Badges row */}
                    <div className="flex flex-wrap gap-1.5">
                      {formData.originalPrice &&
                        Number.parseFloat(formData.originalPrice) >
                          Number.parseFloat(displayPrice) && (
                          <span className="rounded-full border border-rose-200/60 bg-rose-50/90 px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-wider text-rose-600 shadow-sm backdrop-blur-md">
                            {Math.round(
                              ((Number.parseFloat(formData.originalPrice) -
                                Number.parseFloat(displayPrice)) /
                                Number.parseFloat(formData.originalPrice)) *
                                100,
                            )}
                            % OFF
                          </span>
                        )}
                      {formData.isBestseller && (
                        <span className="flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/95 px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-wider text-white shadow-sm backdrop-blur-md">
                          <Flame className="size-2.5 fill-orange-400 text-orange-400" />
                          EM ALTA
                        </span>
                      )}
                      {formData.freeShipping && (
                        <span className="flex items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-wider text-emerald-700 shadow-sm">
                          <Truck className="size-2.5 text-emerald-600" />
                          FRETE GRÁTIS
                        </span>
                      )}
                    </div>

                    {/* Product Name */}
                    <h1 className="text-sm font-black leading-snug tracking-tight text-zinc-900">
                      {formData.name || "Nome do produto"}
                    </h1>

                    {/* Stars rating */}
                    <div className="flex items-center gap-1 text-[9px] font-bold text-zinc-500">
                      <span className="text-xs text-amber-400">★★★★★</span>
                      <span>5.0 (15 avaliações)</span>
                    </div>

                    {/* Price Details */}
                    {formData.originalPrice &&
                    Number.parseFloat(formData.originalPrice) >
                      Number.parseFloat(displayPrice) ? (
                      <div className="flex flex-col">
                        <span className="text-[8px] font-black uppercase leading-none tracking-widest text-zinc-400">
                          De:{" "}
                          <span className="line-through">
                            R${" "}
                            {Number.parseFloat(
                              formData.originalPrice,
                            ).toLocaleString("pt-BR", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </span>
                        <span className="mt-1 text-base font-black leading-none tracking-tighter text-rose-600">
                          Por: R${" "}
                          {Number.parseFloat(displayPrice).toLocaleString(
                            "pt-BR",
                            {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            },
                          )}
                        </span>
                      </div>
                    ) : (
                      <span className="text-base font-black leading-none tracking-tighter text-zinc-900">
                        R${" "}
                        {Number.parseFloat(displayPrice || "0").toLocaleString(
                          "pt-BR",
                          {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          },
                        )}
                      </span>
                    )}

                    {/* Variants Grade Selection */}
                    {Object.entries(
                      formData.variants.reduce(
                        (acc, v) => {
                          if (!v.active) return acc;
                          if (!acc[v.name]) acc[v.name] = [];
                          acc[v.name].push(v);
                          return acc;
                        },
                        {} as Record<string, ProductVariant[]>,
                      ),
                    ).map(([name, values]) => (
                      <div key={name} className="mt-1 space-y-1.5">
                        <span className="ml-0.5 block text-[8px] font-black uppercase tracking-widest text-zinc-400">
                          Selecione {name}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {values.map((v) => {
                            const isSelected =
                              previewSelectedVariants[name] === v.value;

                            // Calculate stock for variant v in preview mode
                            const tentativeSelected = Object.entries(
                              previewSelectedVariants,
                            )
                              .map(([gName, val]) => {
                                if (gName === name) return v;
                                return formData.variants?.find(
                                  (varObj) =>
                                    varObj.name === gName &&
                                    varObj.value === val,
                                );
                              })
                              .filter(Boolean);

                            if (!previewSelectedVariants[name]) {
                              tentativeSelected.push(v);
                            }

                            const variantStock = Math.min(
                              ...tentativeSelected.map(
                                (varObj) => varObj?.stockIncrement || 0,
                              ),
                            );

                            return (
                              <button
                                key={v.id}
                                type="button"
                                onClick={() =>
                                  setPreviewSelectedVariants((prev) => ({
                                    ...prev,
                                    [name]: v.value,
                                  }))
                                }
                                className={cn(
                                  "px-2.5 py-1 text-[9px] font-black rounded-xl border transition-all flex items-center gap-1 cursor-pointer",
                                  isSelected
                                    ? "border-zinc-900 bg-zinc-900 text-white"
                                    : "border-zinc-100 bg-zinc-50 text-zinc-500 hover:border-zinc-200",
                                )}
                              >
                                {v.imageUrl && (
                                  <img
                                    src={v.imageUrl}
                                    alt=""
                                    className="size-3.5 rounded-full bg-white object-cover shadow-sm"
                                  />
                                )}
                                <span>{v.value}</span>
                                <span
                                  className={cn(
                                    "text-[7px] font-semibold opacity-70 ml-0.5",
                                    isSelected
                                      ? "text-white/80"
                                      : "text-zinc-400",
                                  )}
                                >
                                  (
                                  {variantStock > 0
                                    ? `${variantStock} un.`
                                    : "Esgotado"}
                                  )
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}

                    {/* Stock Banner */}
                    {(() => {
                      const selectedVariantObjects = Object.entries(
                        previewSelectedVariants,
                      )
                        .map(([name, value]) =>
                          formData.variants?.find(
                            (v) => v.name === name && v.value === value,
                          ),
                        )
                        .filter(Boolean);

                      const activeVariants =
                        formData.variants?.filter((v) => v.active) || [];
                      const hasVariants = activeVariants.length > 0;
                      const baseStock = Number.parseInt(formData.stock) || 0;

                      const currentStock = hasVariants
                        ? selectedVariantObjects.length > 0
                          ? Math.min(
                              ...selectedVariantObjects.map(
                                (v) => v?.stockIncrement || 0,
                              ),
                            )
                          : activeVariants.reduce(
                              (acc, v) => acc + (v.stockIncrement || 0),
                              0,
                            )
                        : baseStock;

                      const isOutOfStock = currentStock === 0;
                      const isLowStock = currentStock <= 3 && currentStock > 0;

                      return (
                        <div
                          className={cn(
                            "flex items-center gap-1.5 p-2 rounded-xl text-[9px] font-bold mt-1 border",
                            isOutOfStock
                              ? "bg-zinc-100 border-zinc-200 text-zinc-500"
                              : isLowStock
                                ? "bg-red-50 border-red-100 text-red-650"
                                : "bg-green-50 border-green-100 text-green-650",
                          )}
                        >
                          {isOutOfStock ? (
                            <>
                              <ShieldCheck className="size-3.5 text-zinc-400" />
                              <span>Produto Esgotado</span>
                            </>
                          ) : isLowStock ? (
                            <>
                              <Flame className="size-3.5" />
                              <span>Apenas {currentStock} un. restantes!</span>
                            </>
                          ) : (
                            <>
                              <Check className="size-3.5" />
                              <span>Em estoque ({currentStock} un.)</span>
                            </>
                          )}
                        </div>
                      );
                    })()}

                    {/* Purchase Actions Container */}
                    <div className="mt-1 flex w-full shrink-0 gap-2">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600">
                        <MessageCircle className="size-4" />
                      </div>
                      <div className="flex h-9 flex-1 items-center justify-center gap-1 rounded-xl bg-zinc-900 text-[9px] font-black uppercase tracking-wider text-white">
                        <ShoppingCart className="size-3.5" />
                        <span>Adicionar ao Carrinho</span>
                      </div>
                    </div>

                    {/* Tabbed view iOS style */}
                    <div className="mx-auto mt-3 flex w-full max-w-xs shrink-0 items-center gap-0.5 rounded-xl bg-zinc-100/60 p-1">
                      {[
                        { id: "description", label: "Detalhes" },
                        { id: "reviews", label: "Reviews (15)" },
                        { id: "questions", label: "Chat" },
                      ].map((tab) => {
                        const isActive = activeDetailTab === tab.id;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveDetailTab(tab.id as any)}
                            className={cn(
                              "flex-1 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all cursor-pointer",
                              isActive
                                ? "bg-white text-zinc-950 shadow-sm"
                                : "text-zinc-400 hover:text-zinc-600",
                            )}
                          >
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Tab Content */}
                    <div className="shrink-0 pb-4">
                      <AnimatePresence mode="wait">
                        {activeDetailTab === "description" && (
                          <motion.div
                            key="desc"
                            initial={{ opacity: 0, y: 3 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -3 }}
                            transition={{ duration: 0.12 }}
                            className="mt-1 text-[9px] font-medium leading-relaxed text-zinc-600"
                          >
                            {formData.description ? (
                              <div className="whitespace-pre-line">
                                {formData.description}
                              </div>
                            ) : (
                              <p className="italic text-zinc-400">
                                Nenhuma descrição informada.
                              </p>
                            )}
                            {/* Espelha o bloco de beneficios da pagina real
                                (ProductView.tsx): "Troca garantida" saiu de
                                la porque nao existe fluxo de troca/devolucao
                                neste app (issues #46 e #108 seguem abertas),
                                e o selo de entrega usa a cidade da loja, se
                                configurada -- nunca "local" numa loja com
                                cobertura nacional. */}
                            <div className="mt-3 space-y-1.5 border-t border-zinc-100 pt-3">
                              {config.storeCity && (
                                <div className="flex items-center gap-1.5 text-[8px] text-zinc-500">
                                  <Truck className="size-3.5 text-zinc-400" />
                                  <span>
                                    Entrega em {config.storeCity}
                                    {config.storeState
                                      ? `, ${config.storeState}`
                                      : ""}
                                  </span>
                                </div>
                              )}
                              <div className="flex items-center gap-1.5 text-[8px] text-zinc-500">
                                <ShoppingCart className="size-3.5 text-zinc-400" />
                                <span>Produto em estoque - Envio rápido</span>
                              </div>
                            </div>
                          </motion.div>
                        )}

                        {activeDetailTab === "reviews" && (
                          <motion.div
                            key="reviews"
                            initial={{ opacity: 0, y: 3 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -3 }}
                            transition={{ duration: 0.12 }}
                            className="mt-1 space-y-2"
                          >
                            <div className="flex flex-col gap-2 rounded-xl bg-zinc-950 p-3 text-white">
                              <div className="flex items-center gap-2">
                                <span className="text-2xl font-black">5.0</span>
                                <div className="flex flex-col">
                                  <span className="text-[10px] text-amber-400">
                                    ★★★★★
                                  </span>
                                  <span className="text-[6px] font-black uppercase tracking-widest text-zinc-500">
                                    Baseado em 15 reviews
                                  </span>
                                </div>
                              </div>
                              <div className="space-y-1 border-t border-white/5 pt-1">
                                {[5, 4, 3, 2, 1].map((star) => (
                                  <div
                                    key={star}
                                    className="flex items-center gap-1 text-[7px] font-black text-zinc-400"
                                  >
                                    <span className="w-2">{star}</span>
                                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/5">
                                      <div
                                        className="h-full rounded-full bg-white"
                                        style={{
                                          width: star === 5 ? "100%" : "0%",
                                        }}
                                      />
                                    </div>
                                    <span className="w-3 text-right">
                                      {star === 5 ? "15" : "0"}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-0.5 rounded-xl border border-zinc-100 bg-zinc-50/50 p-2">
                              <div className="flex items-center justify-between text-[7px] font-black">
                                <span>Gabriel M.</span>
                                <span className="text-amber-400">★★★★★</span>
                              </div>
                              <p className="text-[8px] leading-normal text-zinc-500">
                                Excelente produto, acabamento de altíssima
                                qualidade. Recomendo muito!
                              </p>
                            </div>
                          </motion.div>
                        )}

                        {activeDetailTab === "questions" && (
                          <motion.div
                            key="questions"
                            initial={{ opacity: 0, y: 3 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -3 }}
                            transition={{ duration: 0.12 }}
                            className="mt-1 space-y-2"
                          >
                            <div className="space-y-1 rounded-xl border border-zinc-100 bg-zinc-50/50 p-2">
                              <div className="flex items-center gap-1 text-[7px] font-black uppercase tracking-wider text-zinc-400">
                                <span>P: Vocês entregam hoje?</span>
                              </div>
                              <div className="rounded-lg border border-zinc-100 bg-white p-1.5 text-[8px] text-zinc-600">
                                <span className="mb-0.5 block text-[7px] font-bold uppercase tracking-wider text-zinc-800">
                                  Resposta do Vendedor:
                                </span>
                                Sim! Se o pedido for realizado até as 18h
                                entregamos hoje mesmo.
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>,
    document.body,
  );
});
