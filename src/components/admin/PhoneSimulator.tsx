import React, { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Smartphone,
  X,
  Image as ImageIcon,
  Flame,
  Truck,
  ArrowLeft,
  Heart,
  Share2,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Check,
  MessageCircle,
  ShoppingCart
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProductVariant } from '@/types';

interface PhoneSimulatorProps {
  readonly isOpen: boolean;
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
  readonly previewMode: 'card' | 'page';
  readonly setPreviewMode: (mode: 'card' | 'page') => void;
  readonly previewImgIndex: number;
  readonly setPreviewImgIndex: React.Dispatch<React.SetStateAction<number>>;
  readonly previewSelectedVariants: Record<string, string>;
  readonly setPreviewSelectedVariants: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  readonly activeDetailTab: 'description' | 'reviews' | 'questions';
  readonly setActiveDetailTab: (tab: 'description' | 'reviews' | 'questions') => void;
}

export const PhoneSimulator = memo(function PhoneSimulator({
  isOpen,
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
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] bg-zinc-950/98 lg:bg-zinc-950/90 lg:backdrop-blur-xl flex flex-col text-zinc-100"
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-zinc-900/40 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Smartphone className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-white">Simulador do Aplicativo</h3>
                <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Prévia em Tempo Real</p>
              </div>
            </div>

            {/* Controls & Close */}
            <div className="flex items-center gap-4">
              {/* Toggle Selector */}
              <div className="bg-zinc-900 p-1 rounded-xl flex items-center gap-1 border border-white/5">
                <button
                  type="button"
                  onClick={() => setPreviewMode('card')}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer",
                    previewMode === 'card'
                      ? "bg-emerald-500 text-emerald-950 shadow-md font-extrabold"
                      : "text-zinc-400 hover:text-white"
                  )}
                >
                  Card
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode('page')}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer",
                    previewMode === 'page'
                      ? "bg-emerald-500 text-emerald-950 shadow-md font-extrabold"
                      : "text-zinc-400 hover:text-white"
                  )}
                >
                  Página
                </button>
              </div>

              {/* Close Button */}
              <button
                type="button"
                onClick={onClose}
                className="w-9 h-9 rounded-xl bg-zinc-900 border border-white/5 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all active:scale-95 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Modal Simulator Body */}
          <div className="flex-1 overflow-y-auto flex items-center justify-center p-6 md:p-12">
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              transition={{ type: "spring", damping: 25, stiffness: 350 }}
              className="relative flex justify-center w-full max-w-sm"
            >
              {/* Phone frame styling wrapper (premium aesthetics) */}
              <div className="relative p-4 bg-zinc-900 border border-white/10 rounded-[3.25rem] shadow-[0_25px_60px_rgba(0,0,0,0.8)]">
                {/* Speaker / Notch simulator */}
                <div className="absolute top-6 left-1/2 -translate-x-1/2 w-24 h-4 bg-zinc-950 rounded-full z-20 flex items-center justify-center">
                  <div className="w-8 h-1 bg-zinc-850 rounded-full" />
                  <div className="w-1.5 h-1.5 bg-zinc-900 rounded-full ml-2" />
                </div>

                {/* Live Content Screen */}
                <div className="rounded-[2.5rem] overflow-hidden bg-zinc-950 border border-white/5 flex flex-col relative text-left">
                  {previewMode === 'card' ? (
                    <div className="w-[240px] bg-zinc-50/5 overflow-hidden flex flex-col relative text-left shadow-2xl transition-all duration-300">
                      {/* Image Container */}
                      <div className="relative aspect-[4/5] overflow-hidden bg-zinc-900/50">
                        {formData.images && formData.images.length > 0 ? (
                          <img
                            src={formData.images[0]}
                            alt={formData.name || 'Sem nome'}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-zinc-600 gap-2 bg-zinc-950/80">
                            <ImageIcon className="w-8 h-8 opacity-20" />
                            <span className="text-[8px] font-black uppercase tracking-widest opacity-40">Sem imagem</span>
                          </div>
                        )}

                        {/* Floating Badges */}
                        <div className="absolute top-3 left-3 flex flex-col gap-1.5 items-start max-w-[calc(100%-48px)]">
                          {/* Stock Badge */}
                          {parseInt(formData.stock) > 0 ? (
                            <span className={cn(
                              "px-2 py-0.5 rounded-md font-black text-[8px] uppercase tracking-wider text-white shadow-lg shrink-0",
                              parseInt(formData.stock) <= 3 ? "bg-amber-600 animate-pulse" : "bg-emerald-600"
                            )}>
                              {parseInt(formData.stock) <= 3 ? `Só restam ${formData.stock}` : 'Em estoque'}
                            </span>
                          ) : (
                            <span className="bg-zinc-800 text-zinc-400 border border-white/5 px-2 py-0.5 rounded-md font-black text-[8px] uppercase tracking-wider shadow-lg shrink-0">
                              Esgotado
                            </span>
                          )}

                          {/* Promotion Discount Badge */}
                          {formData.originalPrice && parseFloat(formData.originalPrice) > parseFloat(formData.price) && (
                            <span className="bg-rose-600 text-white px-2 py-0.5 rounded-md font-black text-[8px] uppercase tracking-wider shadow-lg shrink-0">
                              {Math.round(((parseFloat(formData.originalPrice) - parseFloat(formData.price)) / parseFloat(formData.originalPrice)) * 100)}% OFF
                            </span>
                          )}

                          {/* Bestseller (HOT) Badge */}
                          {formData.isBestseller && (
                            <span className="bg-slate-900 border border-white/10 px-2 py-0.5 rounded-md shadow-lg flex items-center gap-1 font-black text-[8px] text-white shrink-0">
                              <Flame className="w-2.5 h-2.5 text-orange-400 fill-orange-400 animate-pulse" />
                              HOT
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Content */}
                      <div className="p-3.5 flex-1 flex flex-col gap-1.5 bg-zinc-950 border-t border-white/5">
                        <div className="space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest truncate max-w-[65%]">
                              {formData.category || 'Categoria'}
                            </p>
                            {formData.freeShipping && (
                              <div className="flex shrink-0 items-center gap-1 bg-emerald-50/10 text-emerald-400 px-1.5 py-0.5 rounded-md text-[7px] font-black border border-emerald-50/20">
                                <Truck className="w-2 h-2 shrink-0" />
                                <span className="truncate">Frete Grátis</span>
                              </div>
                            )}
                          </div>
                          
                          <h3 className="text-xs font-black text-white line-clamp-2 leading-snug min-h-[2rem]">
                            {formData.name || 'Nome do produto'}
                          </h3>
                          
                          <div className="flex items-center text-amber-400 text-[9px]">
                            ★★★★★
                          </div>
                        </div>

                        {/* Price */}
                        <div className="flex items-end mt-auto pt-1">
                          <div className="flex flex-col w-full">
                            {formData.originalPrice && parseFloat(formData.originalPrice) > parseFloat(formData.price) ? (
                              <div className="flex flex-col">
                                <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider leading-none">
                                  De: <span className="line-through">R$ {parseFloat(formData.originalPrice).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </span>
                                <span className="text-xs font-black text-rose-500 tracking-tight leading-none mt-1">
                                  Por: R$ {parseFloat(formData.price).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs font-black text-white tracking-tight leading-none">
                                R$ {parseFloat(formData.price || '0').toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="w-[280px] h-[520px] bg-white rounded-[2rem] overflow-y-auto border border-zinc-200 flex flex-col relative text-left shadow-2xl [&::-webkit-scrollbar]:hidden scrollbar-none text-zinc-950">
                      {/* Simulated Phone Header Gallery */}
                      <div className="relative aspect-square bg-[#F8F9FA] shrink-0">
                        <div className="w-full h-full flex justify-center items-center overflow-hidden">
                          {formData.images && formData.images.length > 0 ? (
                            <img
                              src={formData.images[previewImgIndex] || formData.images[0]}
                              alt={formData.name || 'Preview'}
                              className="w-auto h-full max-w-full object-contain"
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-zinc-400 gap-1 bg-zinc-50">
                              <ImageIcon className="w-6 h-6 opacity-30" />
                              <span className="text-[7px] font-black uppercase tracking-widest opacity-50">Sem imagem</span>
                            </div>
                          )}
                        </div>

                        {/* Header overlay actions */}
                        <div className="absolute top-4 left-4 w-7 h-7 bg-white/85 backdrop-blur-md rounded-full flex items-center justify-center shadow-sm text-zinc-700">
                          <ArrowLeft className="w-4 h-4" />
                        </div>
                        <div className="absolute top-4 right-4 flex gap-2">
                          <div className="w-7 h-7 bg-white/85 backdrop-blur-md rounded-full flex items-center justify-center shadow-sm text-zinc-700">
                            <Heart className="w-4 h-4 text-zinc-400" />
                          </div>
                          <div className="w-7 h-7 bg-white/85 backdrop-blur-md rounded-full flex items-center justify-center shadow-sm text-zinc-700">
                            <Share2 className="w-4 h-4" />
                          </div>
                        </div>

                        {/* Gallery Navigation */}
                        {formData.images && formData.images.length > 1 && (
                          <>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewImgIndex(prev => (prev - 1 + formData.images.length) % formData.images.length);
                              }}
                              className="absolute left-2 top-1/2 -translate-y-1/2 w-6 h-6 bg-white/85 rounded-full flex items-center justify-center shadow-sm text-zinc-700 hover:bg-white transition-all cursor-pointer"
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewImgIndex(prev => (prev + 1) % formData.images.length);
                              }}
                              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 bg-white/85 rounded-full flex items-center justify-center shadow-sm text-zinc-700 hover:bg-white transition-all cursor-pointer"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </button>
                            
                            {/* Image indicators */}
                            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1 px-2.5 py-1 bg-black/10 backdrop-blur-md rounded-full">
                              {formData.images.map((_, idx) => (
                                <div
                                  key={idx}
                                  className={cn(
                                    "h-1 rounded-full transition-all duration-300",
                                    idx === previewImgIndex ? "bg-white w-4" : "bg-white/40 w-1"
                                  )}
                                />
                              ))}
                            </div>
                          </>
                        )}
                      </div>

                      {/* Simulated Content Body */}
                      <div className="p-4 flex-1 flex flex-col gap-3 bg-white">
                        {/* Breadcrumb / Category */}
                        <span className="text-[8px] font-black uppercase tracking-wider text-zinc-400 block">
                          Início &gt; {formData.category || 'Categoria'}
                        </span>

                        {/* Badges row */}
                        <div className="flex flex-wrap gap-1">
                          {formData.originalPrice && parseFloat(formData.originalPrice) > parseFloat(formData.price) && (
                            <span className="px-2 py-0.5 bg-red-600 text-white text-[8px] font-black tracking-wider rounded-full uppercase">
                              {Math.round(((parseFloat(formData.originalPrice) - parseFloat(formData.price)) / parseFloat(formData.originalPrice)) * 100)}% OFF
                            </span>
                          )}
                          {formData.isBestseller && (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[8px] font-black tracking-wider rounded-full flex items-center gap-1 uppercase border border-amber-200/50">
                              <Flame className="w-2.5 h-2.5 text-orange-500 fill-orange-500/20" />
                              HOT
                            </span>
                          )}
                          {formData.freeShipping && (
                            <span className="px-2 py-0.5 bg-emerald-600 text-white text-[8px] font-black tracking-wider rounded-full flex items-center gap-1 uppercase">
                              <Truck className="w-2.5 h-2.5" />
                              FRETE GRÁTIS
                            </span>
                          )}
                        </div>

                        {/* Product Name */}
                        <h1 className="text-sm font-black text-zinc-900 leading-snug tracking-tight">
                          {formData.name || 'Nome do produto'}
                        </h1>

                        {/* Stars rating */}
                        <div className="flex items-center gap-1 text-zinc-500 text-[9px] font-bold">
                          <span className="text-amber-400 text-xs">★★★★★</span>
                          <span>5.0 (15 avaliações)</span>
                        </div>

                        {/* Price Details */}
                        {formData.originalPrice && parseFloat(formData.originalPrice) > parseFloat(formData.price) ? (
                          <div className="flex flex-col">
                            <span className="text-[8px] font-black text-zinc-400 uppercase tracking-widest leading-none">
                              De: <span className="line-through">R$ {parseFloat(formData.originalPrice).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </span>
                            <span className="text-base font-black text-rose-600 tracking-tighter leading-none mt-1">
                              Por: R$ {parseFloat(formData.price).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        ) : (
                          <span className="text-base font-black text-zinc-900 tracking-tighter leading-none">
                            R$ {parseFloat(formData.price || '0').toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        )}

                        {/* Variants Grade Selection */}
                        {Object.entries(
                          formData.variants.reduce((acc, v) => {
                            if (!v.active) return acc;
                            if (!acc[v.name]) acc[v.name] = [];
                            acc[v.name].push(v);
                            return acc;
                          }, {} as Record<string, ProductVariant[]>)
                        ).map(([name, values]) => (
                          <div key={name} className="space-y-1.5 mt-1">
                            <label className="block text-[8px] font-black text-zinc-400 uppercase tracking-widest ml-0.5">
                              Selecione {name}
                            </label>
                            <div className="flex flex-wrap gap-1.5">
                              {values.map((v) => {
                                const isSelected = previewSelectedVariants[name] === v.value;
                                return (
                                  <button
                                    key={v.id}
                                    type="button"
                                    onClick={() => setPreviewSelectedVariants(prev => ({ ...prev, [name]: v.value }))}
                                    className={cn(
                                      "px-2.5 py-1 text-[9px] font-black rounded-xl border transition-all flex items-center gap-1 cursor-pointer",
                                      isSelected
                                        ? "border-zinc-900 bg-zinc-900 text-white"
                                        : "border-zinc-100 bg-zinc-50 text-zinc-500 hover:border-zinc-200"
                                    )}
                                  >
                                    {v.imageUrl && (
                                      <img src={v.imageUrl} className="w-3.5 h-3.5 rounded-full object-cover shadow-sm bg-white" />
                                    )}
                                    <span>{v.value}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}

                        {/* Stock Banner */}
                        {(() => {
                          const selectedVariantObjects = Object.entries(previewSelectedVariants).map(([name, value]) =>
                            formData.variants?.find(v => v.name === name && v.value === value)
                          ).filter(Boolean);
                          
                          const baseStock = parseInt(formData.stock) || 0;
                          const currentStock = baseStock + selectedVariantObjects.reduce((acc, v) => acc + (v?.stockIncrement || 0), 0);
                          
                          const isOutOfStock = currentStock === 0;
                          const isLowStock = currentStock <= 3 && currentStock > 0;
                          
                          return (
                            <div className={cn(
                              "flex items-center gap-1.5 p-2 rounded-xl text-[9px] font-bold mt-1 border",
                              isOutOfStock 
                                ? "bg-zinc-100 border-zinc-200 text-zinc-500" 
                                : isLowStock 
                                  ? "bg-red-50 border-red-100 text-red-650" 
                                  : "bg-green-50 border-green-100 text-green-650"
                            )}>
                              {isOutOfStock ? (
                                <>
                                  <ShieldCheck className="w-3.5 h-3.5 text-zinc-400" />
                                  <span>Produto Esgotado</span>
                                </>
                              ) : isLowStock ? (
                                <>
                                  <Flame className="w-3.5 h-3.5" />
                                  <span>Apenas {currentStock} un. restantes!</span>
                                </>
                              ) : (
                                <>
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Em estoque ({currentStock} un.)</span>
                                </>
                              )}
                            </div>
                          );
                        })()}

                        {/* Purchase Actions Container */}
                        <div className="flex gap-2 mt-1 w-full shrink-0">
                          <div className="w-9 h-9 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center border border-emerald-100 shrink-0">
                            <MessageCircle className="w-4 h-4" />
                          </div>
                          <div className="flex-1 h-9 bg-zinc-900 text-white text-[9px] font-black uppercase tracking-wider rounded-xl flex items-center justify-center gap-1">
                            <ShoppingCart className="w-3.5 h-3.5" />
                            <span>Adicionar ao Carrinho</span>
                          </div>
                        </div>

                        {/* Tabbed view iOS style */}
                        <div className="bg-zinc-100/60 p-1 rounded-xl flex items-center gap-0.5 mt-3 max-w-xs mx-auto w-full shrink-0">
                          {[
                            { id: 'description', label: 'Detalhes' },
                            { id: 'reviews', label: 'Reviews (15)' },
                            { id: 'questions', label: 'Chat' }
                          ].map((tab) => {
                            const isActive = activeDetailTab === tab.id;
                            return (
                              <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveDetailTab(tab.id as any)}
                                className={cn(
                                  "flex-1 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all cursor-pointer",
                                  isActive ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-400 hover:text-zinc-600"
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
                            {activeDetailTab === 'description' && (
                              <motion.div
                                key="desc"
                                initial={{ opacity: 0, y: 3 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -3 }}
                                transition={{ duration: 0.12 }}
                                className="text-[9px] text-zinc-600 leading-relaxed font-medium mt-1"
                              >
                                {formData.description ? (
                                  <div className="whitespace-pre-line">{formData.description}</div>
                                ) : (
                                  <p className="text-zinc-400 italic">Nenhuma descrição informada.</p>
                                )}
                                <div className="space-y-1.5 mt-3 pt-3 border-t border-zinc-100">
                                  <div className="flex items-center gap-1.5 text-[8px] text-zinc-500">
                                    <ShieldCheck className="w-3.5 h-3.5 text-zinc-400" />
                                    <span>Troca garantida em até 24h</span>
                                  </div>
                                  <div className="flex items-center gap-1.5 text-[8px] text-zinc-500">
                                    <Truck className="w-3.5 h-3.5 text-zinc-400" />
                                    <span>Entrega local rápida</span>
                                  </div>
                                </div>
                              </motion.div>
                            )}

                            {activeDetailTab === 'reviews' && (
                              <motion.div
                                key="reviews"
                                initial={{ opacity: 0, y: 3 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -3 }}
                                transition={{ duration: 0.12 }}
                                className="space-y-2 mt-1"
                              >
                                <div className="bg-zinc-950 rounded-xl p-3 text-white flex flex-col gap-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-2xl font-black">5.0</span>
                                    <div className="flex flex-col">
                                      <span className="text-amber-400 text-[10px]">★★★★★</span>
                                      <span className="text-[6px] text-zinc-500 uppercase tracking-widest font-black">Baseado em 15 reviews</span>
                                    </div>
                                  </div>
                                  <div className="space-y-1 pt-1 border-t border-white/5">
                                    {[5, 4, 3, 2, 1].map((star) => (
                                      <div key={star} className="flex items-center gap-1 text-[7px] font-black text-zinc-400">
                                        <span className="w-2">{star}</span>
                                        <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                                          <div className="h-full bg-white rounded-full" style={{ width: star === 5 ? '100%' : '0%' }} />
                                        </div>
                                        <span className="w-3 text-right">{star === 5 ? '15' : '0'}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                
                                <div className="p-2 border border-zinc-100 rounded-xl space-y-0.5 bg-zinc-50/50">
                                  <div className="flex justify-between items-center text-[7px] font-black">
                                    <span>Gabriel M.</span>
                                    <span className="text-amber-400">★★★★★</span>
                                  </div>
                                  <p className="text-[8px] text-zinc-500 leading-normal">Excelente produto, acabamento de altíssima qualidade. Recomendo muito!</p>
                                </div>
                              </motion.div>
                            )}

                            {activeDetailTab === 'questions' && (
                              <motion.div
                                key="questions"
                                initial={{ opacity: 0, y: 3 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -3 }}
                                transition={{ duration: 0.12 }}
                                className="space-y-2 mt-1"
                              >
                                <div className="p-2 border border-zinc-100 rounded-xl space-y-1 bg-zinc-50/50">
                                  <div className="flex items-center gap-1 text-[7px] font-black text-zinc-400 uppercase tracking-wider">
                                    <span>P: Vocês entregam hoje?</span>
                                  </div>
                                  <div className="p-1.5 bg-white rounded-lg border border-zinc-100 text-[8px] text-zinc-600">
                                    <span className="font-bold text-zinc-800 block text-[7px] uppercase tracking-wider mb-0.5">Resposta do Vendedor:</span>
                                    Sim! Se o pedido for realizado até as 18h entregamos hoje mesmo.
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
        </motion.div>
      )}
    </AnimatePresence>
  );
});
