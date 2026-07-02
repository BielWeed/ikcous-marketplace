import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, Plus, Camera, Check, Layers, Trash2, Edit2, DollarSign, TrendingUp, TrendingDown, AlertTriangle, Info, Package, ShieldCheck, Image as ImageIcon, Flame, Truck, Heart, Share2, MessageCircle, ShoppingCart, ChevronLeft, ChevronRight, Scissors, BookOpen, Smartphone, X, HelpCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { View, ProductVariant } from '@/types';
import { useProducts } from '@/hooks/useProducts';
import { cn } from '@/lib/utils';
import { useCategories } from '@/hooks/useCategories';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ImageAdjuster } from '@/components/ui/custom/ImageAdjuster';
interface AdminProductFormViewProps {
  productId?: string;
  onNavigate: (view: View) => void;
  onBack?: () => void;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2
    }
  }
};

// const itemVariants = {
//   hidden: { opacity: 0, y: 20 },
//   visible: { opacity: 1, y: 0 }
// };

export function AdminProductFormView({ productId, onNavigate, onBack }: AdminProductFormViewProps) {
  const { addProduct, updateProduct, addVariant, updateVariant, deleteVariants, uploadProductImages, fetchProduct } = useProducts({ autoFetch: false });
  const { categories: dbCategories, addCategory } = useCategories();

  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    costPrice: '',
    originalPrice: '',
    stock: '',
    category: '',
    images: [] as string[],
    freeShipping: false,
    isBestseller: false,
    isActive: true,
    metaTitle: '',
    metaDescription: '',
    sku: '',
    variants: [] as ProductVariant[],
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showVariantForm, setShowVariantForm] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);
  const [variantFormData, setVariantFormData] = useState({
    name: '',
    value: '',
    sku: '',
    stockIncrement: '0',
    priceOverride: '',
    active: true,
    imageUrl: ''
  });
  const [currentProduct, setCurrentProduct] = useState<any>(null);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [deletedVariantIds, setDeletedVariantIds] = useState<string[]>([]);
  const [isPromoActive, setIsPromoActive] = useState(false);
  const [previewMode, setPreviewMode] = useState<'card' | 'page'>('card');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState<'description' | 'reviews' | 'questions'>('description');
  const [previewImgIndex, setPreviewImgIndex] = useState(0);
  const [previewSelectedVariants, setPreviewSelectedVariants] = useState<Record<string, string>>({});

  // Image Adjustment and Quality state variables
  const [imageMetadata, setImageMetadata] = useState<Record<string, { width: number, height: number, status: 'loading' | 'excellent' | 'warning_aspect' | 'warning_res' | 'good' }>>({});
  const evaluatedImagesRef = useRef<Set<string>>(new Set());
  const [isAdjusterOpen, setIsAdjusterOpen] = useState(false);
  const [adjustingImgUrl, setAdjustingImgUrl] = useState('');
  const [adjustingImgIndex, setAdjustingImgIndex] = useState<number | null>(null);
  const [isUploadingAdjusted, setIsUploadingAdjusted] = useState(false);

  const [showPhotoGuide, setShowPhotoGuide] = useState(false);
  const [expandedHelp, setExpandedHelp] = useState<Record<string, boolean>>({});

  const toggleHelp = (key: string) => {
    console.log('[HelpToggle] toggleHelp called for key:', key);
    setExpandedHelp(prev => {
      const next = {
        ...prev,
        [key]: !prev[key]
      };
      console.log('[HelpToggle] next state:', next);
      return next;
    });
  };

  const suggestedAttributes = Array.from(
    new Set(['Cor', 'Tamanho', 'Voltagem', ...formData.variants.map(v => v.name)])
  ).filter(Boolean);

  useEffect(() => {
    formData.images.forEach((url) => {
      if (evaluatedImagesRef.current.has(url)) return;
      evaluatedImagesRef.current.add(url);

      setImageMetadata(prev => ({
        ...prev,
        [url]: { width: 0, height: 0, status: 'loading' }
      }));

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const ratio = w / h;
        const res = w * h;

        let status: 'excellent' | 'warning_aspect' | 'warning_res' | 'good' = 'good';
        
        if (res < 600 * 600) {
          status = 'warning_res';
        } else if ((ratio < 0.7 || ratio > 0.9) && (ratio < 0.95 || ratio > 1.05)) {
          status = 'warning_aspect';
        } else if (res >= 1000 * 1000) {
          status = 'excellent';
        }

        setImageMetadata(prev => ({
          ...prev,
          [url]: { width: w, height: h, status }
        }));
      };
      img.onerror = () => {
        setImageMetadata(prev => ({
          ...prev,
          [url]: { width: 0, height: 0, status: 'good' }
        }));
      };
      img.src = url;
    });
  }, [formData.images]);

  const openAdjuster = (url: string, index: number) => {
    setAdjustingImgUrl(url);
    setAdjustingImgIndex(index);
    setIsAdjusterOpen(true);
  };

  const handleAdjustConfirm = async (croppedBlob: Blob) => {
    if (adjustingImgIndex === null) return;
    setIsUploadingAdjusted(true);

    const file = new File([croppedBlob], `product-image-${Date.now()}.jpg`, { type: 'image/jpeg' });
    const loadingToast = toast.loading('Enviando imagem recortada...');

    try {
      const urls = await uploadProductImages([file]);
      if (urls && urls.length > 0) {
        const newUrl = urls[0];
        setFormData(prev => {
          const newImages = [...prev.images];
          newImages[adjustingImgIndex] = newUrl;
          return {
            ...prev,
            images: newImages
          };
        });

        // Pre-evaluate the newly cropped image immediately
        const img = new Image();
        img.onload = () => {
          setImageMetadata(prev => ({
            ...prev,
            [newUrl]: { width: img.naturalWidth, height: img.naturalHeight, status: 'excellent' }
          }));
        };
        img.src = newUrl;

        toast.success('Imagem ajustada com sucesso!', { id: loadingToast });
        setIsAdjusterOpen(false);
        setAdjustingImgIndex(null);
      } else {
        throw new Error('Upload returned empty list');
      }
    } catch (error) {
      console.error('Error uploading adjusted image:', error);
      toast.error('Erro ao salvar imagem ajustada', { id: loadingToast });
    } finally {
      setIsUploadingAdjusted(false);
    }
  };

  useEffect(() => {
    if (productId) {
      const loadProduct = async () => {
        setIsLoading(true);
        const product = await fetchProduct(productId);
        if (product) {
          setFormData({
            name: product.name,
            description: product.description,
            price: product.price.toString(),
            costPrice: product.costPrice?.toString() || '',
            originalPrice: product.originalPrice?.toString() || '',
            stock: product.stock.toString(),
            category: product.category,
            images: product.images,
            freeShipping: product.freeShipping,
            isBestseller: product.isBestseller,
            isActive: product.isActive,
            metaTitle: product.metaTitle || '',
            metaDescription: product.metaDescription || '',
            sku: product.sku || '',
            variants: product.variants || [],
          });
          setIsPromoActive(!!product.originalPrice);
          setCurrentProduct(product);
        } else {
          toast.error('Produto não encontrado');
          onNavigate('admin-products');
        }
        setIsLoading(false);
      };
      loadProduct();
    }
  }, [productId, fetchProduct, onNavigate]);

  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const loadingToast = toast.loading(`Enviando ${files.length} imagem(ns)...`);

    try {
      const urls = await uploadProductImages(files);
      setFormData(prev => ({
        ...prev,
        images: [...prev.images, ...urls]
      }));
      toast.success('Imagens enviadas com sucesso!', { id: loadingToast });
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Erro ao enviar imagens', { id: loadingToast });
    }
  }, [uploadProductImages]);

  const removeImage = useCallback((index: number) => {
    setFormData(prev => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index)
    }));
  }, []);

  const handleVariantSubmit = () => {
    if (!variantFormData.name.trim()) {
      toast.error('O nome do atributo (ex: Cor, Tamanho) é obrigatório.');
      return;
    }
    if (!variantFormData.value.trim()) {
      toast.error('O valor do atributo (ex: Espacial Grey) é obrigatório.');
      return;
    }

    const parsedPriceOverride = variantFormData.priceOverride ? parseFloat(variantFormData.priceOverride) : undefined;

    const vData = {
      productId: productId || '',
      name: variantFormData.name,
      value: variantFormData.value,
      sku: variantFormData.sku,
      stockIncrement: parseInt(variantFormData.stockIncrement) || 0,
      priceOverride: parsedPriceOverride !== undefined ? Math.max(0, parsedPriceOverride) : undefined,
      active: variantFormData.active,
      imageUrl: variantFormData.imageUrl || undefined
    };

    if (editingVariant) {
      setFormData(prev => ({
        ...prev,
        variants: prev.variants.map(v => v.id === editingVariant.id ? { ...v, ...vData } : v)
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        variants: [...prev.variants, { ...vData, id: `temp-${Date.now()}` } as any]
      }));
    }

    setShowVariantForm(false);
    setEditingVariant(null);
    setVariantFormData({
      name: '', value: '', sku: '', stockIncrement: '0', priceOverride: '', active: true, imageUrl: ''
    });
  };

  const handleDeleteVariant = (vId: string) => {
    if (globalThis.confirm('Excluir esta variante?')) {
      if (!vId.startsWith('temp-')) {
        setDeletedVariantIds(prev => [...prev, vId]);
      }
      setFormData(prev => ({
        ...prev,
        variants: prev.variants.filter(v => v.id !== vId)
      }));
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSubmitting(true);

    const pPrice = parseFloat(formData.price) || 0;
    const pCostRaw = formData.costPrice ? parseFloat(formData.costPrice) : undefined;
    const pCost = (pCostRaw !== undefined && !isNaN(pCostRaw)) ? pCostRaw : undefined;
    const pOriginalRaw = formData.originalPrice ? parseFloat(formData.originalPrice) : undefined;
    const pOriginal = (pOriginalRaw !== undefined && !isNaN(pOriginalRaw)) ? pOriginalRaw : undefined;
    const pStock = parseInt(formData.stock) || 0;

    const productData = {
      name: formData.name,
      description: formData.description,
      price: Math.max(0, pPrice),
      costPrice: pCost !== undefined ? Math.max(0, pCost) : undefined,
      originalPrice: isPromoActive && pOriginal !== undefined ? Math.max(0, pOriginal) : undefined,
      stock: Math.max(0, pStock),
      category: formData.category,
      images: formData.images,
      freeShipping: formData.freeShipping,
      isBestseller: formData.isBestseller,
      isActive: formData.isActive,
      metaTitle: formData.metaTitle,
      metaDescription: formData.metaDescription,
      sku: formData.sku || undefined,
      variants: formData.variants,
      sold: productId ? (currentProduct?.sold || 0) : 0,
    };

    try {
      if (productId) {
        // 1. Atualizar produto principal
        await updateProduct(productId, productData);

        // 2. Deletar variantes que foram excluídas localmente
        if (deletedVariantIds.length > 0) {
          await deleteVariants(deletedVariantIds);
        }

        // 3. Atualizar ou adicionar as variantes restantes
        for (const v of formData.variants) {
          const vData = {
            productId: productId,
            name: v.name,
            value: v.value,
            sku: v.sku || undefined,
            stockIncrement: v.stockIncrement,
            priceOverride: v.priceOverride,
            active: v.active,
            imageUrl: v.imageUrl || undefined
          };

          if (v.id.startsWith('temp-')) {
            await addVariant(vData);
          } else {
            await updateVariant(v.id, vData);
          }
        }
      } else {
        await addProduct(productData);
      }

      setIsSubmitting(false);
      setShowSuccess(true);

      setTimeout(() => {
        onNavigate('admin-products');
      }, 1500);
    } catch (error) {
      setIsSubmitting(false);
      console.error('Erro ao salvar produto:', error);
      toast.error('Erro ao processar as modificações do produto.');
    }
  };

  const isValid =
    formData.name &&
    formData.description &&
    formData.price &&
    formData.stock &&
    formData.category !== '' &&
    parseFloat(formData.price) > 0 &&
    parseInt(formData.stock) >= 0;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-6">
          <div className="w-12 h-12 border-4 border-white/5 border-t-emerald-500 rounded-full animate-spin shadow-[0_0_15px_rgba(16,185,129,0.3)]" />
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em] animate-pulse">Iniciando Protocolo de Carga</p>
        </div>
      </div>
    );
  }

  const priceVal = parseFloat(formData.price) || 0;
  const costPriceVal = parseFloat(formData.costPrice) || 0;
  const marginPct = priceVal > 0 ? ((priceVal - costPriceVal) / priceVal) * 100 : 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-white pb-12">
      {/* Background Decor */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-emerald-500/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-blue-500/5 blur-[120px] rounded-full" />
      </div>

      <AnimatePresence>
        {showCategoryForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[110] flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-zinc-900 border border-white/10 rounded-[2.5rem] w-full max-w-md p-8 shadow-2xl relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                <Layers className="w-24 h-24 text-white" />
              </div>

              <div className="flex items-center gap-4 mb-8 relative z-10">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                  <Layers className="w-6 h-6 text-emerald-500" />
                </div>
                <div>
                  <h3 className="font-black text-xl tracking-tight">Nova Categoria</h3>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest leading-none mt-1">Classificação de Estoque</p>
                </div>
              </div>

              <div className="space-y-6 relative z-10">
                <div className="space-y-2">
                  <label htmlFor="cat-name" className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Nome do Setor / Categoria</label>
                  <input
                    id="cat-name"
                    autoFocus
                    type="text"
                    value={newCategoryName}
                    onChange={e => setNewCategoryName(e.target.value)}
                    className="w-full px-5 py-4 bg-zinc-950 border border-white/5 rounded-2xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition-all"
                    placeholder="Ex: Vestuário"
                  />
                </div>
              </div>

              <div className="flex gap-4 pt-8 relative z-10">
                <button
                  type="button"
                  onClick={() => {
                    setShowCategoryForm(false);
                    setNewCategoryName('');
                    setFormData(prev => ({ ...prev, category: formData.category || '' }));
                  }}
                  className="flex-1 py-5 text-xs font-black text-zinc-500 uppercase tracking-widest hover:text-white transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (newCategoryName.trim()) {
                      const loadingId = toast.loading('Criando categoria...');
                      try {
                        await addCategory({ name: newCategoryName.trim(), description: '', isActive: true });
                        setFormData(prev => ({ ...prev, category: newCategoryName.trim() }));
                        toast.success('Categoria criada com sucesso!', { id: loadingId });
                        setShowCategoryForm(false);
                        setNewCategoryName('');
                      } catch (_err) {
                        toast.error('Erro ao salvar categoria', { id: loadingId });
                      }
                    }
                  }}
                  className="flex-[2] py-5 bg-emerald-500 text-emerald-950 rounded-2xl text-xs font-black uppercase tracking-widest shadow-[0_10px_30px_rgba(16,185,129,0.3)] hover:scale-105 active:scale-95 transition-all"
                >
                  Criar Setor
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showVariantForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-zinc-900 border border-white/10 rounded-[2.5rem] w-full max-w-md shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
            >
              <div className="flex items-center gap-4 p-8 pb-5 border-b border-white/5 shrink-0 bg-zinc-900 relative z-10">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                  <Layers className="w-6 h-6 text-emerald-500" />
                </div>
                <div>
                  <h3 className="font-black text-xl tracking-tight">{editingVariant ? 'Editar Variante' : 'Nova Variante'}</h3>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest leading-none mt-1">Grade de Produto</p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-8 py-6 space-y-6 scrollbar-hide">
                {/* Atributo */}
                <div className="space-y-2">
                  <label htmlFor="variant-name" className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Atributo (ex: Cor, Tamanho)</label>
                  <input
                    id="variant-name"
                    name="variant-name"
                    type="text"
                    value={variantFormData.name}
                    onChange={e => setVariantFormData(p => ({ ...p, name: e.target.value }))}
                    className="w-full px-5 py-4 bg-zinc-950 border border-white/5 rounded-2xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition-all"
                    placeholder="Ex: Cor"
                  />
                  {suggestedAttributes.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5 ml-1">
                      {suggestedAttributes.map((attr) => (
                        <button
                          key={attr}
                          type="button"
                          onClick={() => setVariantFormData(p => ({ ...p, name: attr }))}
                          className={cn(
                            "px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border transition-all active:scale-95",
                            variantFormData.name === attr
                              ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                              : "bg-zinc-950 border-white/5 text-zinc-500 hover:text-zinc-300 hover:border-white/10"
                          )}
                        >
                          {attr}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Valor do Atributo */}
                <div className="space-y-2">
                  <label htmlFor="variant-value" className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Valor do Atributo</label>
                  <input
                    id="variant-value"
                    name="variant-value"
                    type="text"
                    value={variantFormData.value}
                    onChange={e => setVariantFormData(p => ({ ...p, value: e.target.value }))}
                    className="w-full px-5 py-4 bg-zinc-950 border border-white/5 rounded-2xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition-all"
                    placeholder="Ex: Espacial Grey"
                  />
                </div>

                {/* SKU & Status */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label htmlFor="variant-sku" className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Código SKU</label>
                    <input
                      id="variant-sku"
                      name="variant-sku"
                      type="text"
                      value={variantFormData.sku}
                      onChange={e => setVariantFormData(p => ({ ...p, sku: e.target.value.toUpperCase() }))}
                      className="w-full px-5 py-4 bg-zinc-950 border border-white/5 rounded-2xl text-sm font-bold font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition-all uppercase"
                      placeholder="Ex: SKU-COR-TAM"
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="variant-status" className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Status no Catálogo</label>
                    <button
                      id="variant-status"
                      type="button"
                      onClick={() => setVariantFormData(p => ({ ...p, active: !p.active }))}
                      className={cn(
                        "w-full px-5 py-4 border rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-between active:scale-95 select-none",
                        variantFormData.active
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500 hover:bg-emerald-500/20"
                          : "bg-zinc-950 border-white/5 text-zinc-500 hover:bg-white/5"
                      )}
                    >
                      <span>{variantFormData.active ? 'Ativo' : 'Offline'}</span>
                      <span className={cn(
                        "w-2.5 h-2.5 rounded-full shadow-[0_0_8px_currentColor] transition-all",
                        variantFormData.active ? "bg-emerald-500 text-emerald-500/50 scale-100" : "bg-zinc-700 text-zinc-700/50 scale-90"
                      )} />
                    </button>
                  </div>
                </div>

                {/* Saldo Extra & Sobrescrever Preço */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label htmlFor="variant-stock" className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Saldo Extra</label>
                    <input
                      id="variant-stock"
                      name="variant-stock"
                      type="number"
                      value={variantFormData.stockIncrement}
                      onChange={e => setVariantFormData(p => ({ ...p, stockIncrement: e.target.value }))}
                      className="w-full px-5 py-4 bg-zinc-950 border border-white/5 rounded-2xl text-sm font-black focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition-all"
                    />
                    <span className="text-[10px] text-zinc-500 leading-tight block mt-1 ml-1">
                      Soma ou subtrai do estoque base do produto.
                    </span>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="variant-price" className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Sobrescrever R$</label>
                    <div className="relative flex items-center">
                      <span className="absolute left-5 text-xs font-black text-zinc-600">R$</span>
                      <input
                        id="variant-price"
                        name="variant-price"
                        type="number"
                        min="0"
                        step="0.01"
                        value={variantFormData.priceOverride}
                        onChange={e => setVariantFormData(p => ({ ...p, priceOverride: e.target.value }))}
                        className="w-full pl-11 pr-5 py-4 bg-zinc-950 border border-white/5 rounded-2xl text-sm font-black focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition-all"
                        placeholder="Auto"
                      />
                    </div>
                    <span className="text-[10px] text-zinc-500 leading-tight block mt-1 ml-1">
                      Deixe em branco para usar o preço padrão.
                    </span>
                  </div>
                </div>
                
                {/* Imagem da Variante */}
                <div className="space-y-2">
                  <label htmlFor="variant-image-input" className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Imagem da Variante (Opcional)</label>
                  <div className="flex items-center gap-4">
                    {variantFormData.imageUrl ? (
                      <div className="relative w-16 h-16 rounded-full overflow-hidden border border-white/10 group/vimg shrink-0">
                        <img src={variantFormData.imageUrl} className="w-full h-full object-cover" />
                        <button type="button" onClick={() => setVariantFormData(p => ({ ...p, imageUrl: '' }))} className="absolute inset-0 bg-red-500/80 flex items-center justify-center opacity-0 group-hover/vimg:opacity-100 transition-opacity">
                          <Trash2 className="w-4 h-4 text-white" />
                        </button>
                      </div>
                    ) : (
                      <label htmlFor="variant-image-input" className="w-16 h-16 rounded-full border-2 border-dashed border-white/10 flex flex-col items-center justify-center cursor-pointer hover:bg-white/5 transition-all shrink-0">
                        <Plus className="w-5 h-5 text-zinc-500" />
                        <input id="variant-image-input" type="file" accept="image/*" onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const loadingToast = toast.loading('Enviando imagem...');
                          try {
                            const [url] = await uploadProductImages([file]);
                            if (url) {
                              setVariantFormData(p => ({ ...p, imageUrl: url }));
                              toast.success('Imagem anexada!', { id: loadingToast });
                            }
                          } catch {
                            toast.error('Erro no upload', { id: loadingToast });
                          }
                        }} className="hidden" />
                      </label>
                    )}
                    <span className="text-[10px] text-zinc-500 leading-tight flex-1">Facilita a visualização do produto na tela de checkout e na seleção de atributos.</span>
                  </div>
                </div>
              </div>

              <div className="p-8 pt-5 border-t border-white/5 bg-zinc-950/40 flex gap-4 shrink-0 relative z-10">
                <button
                  type="button"
                  onClick={() => {
                    setShowVariantForm(false);
                    setEditingVariant(null);
                  }}
                  className="flex-1 py-4 text-xs font-black text-zinc-500 uppercase tracking-widest hover:text-white transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault();
                    await handleVariantSubmit();
                  }}
                  className="flex-[2] py-4 bg-emerald-500 text-emerald-950 rounded-2xl text-xs font-black uppercase tracking-widest shadow-[0_10px_30px_rgba(16,185,129,0.3)] hover:scale-105 active:scale-95 transition-all"
                >
                  {editingVariant ? 'Salvar Protocolo' : 'Efetivar Variante'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="sticky top-0 z-30 bg-zinc-950/80 backdrop-blur-md border-b border-white/5 px-4 py-3 md:px-6 md:py-4">
        <div className="flex items-center justify-between mx-auto max-w-5xl">
          <div className="flex items-center gap-3 md:gap-4">
            <button
              onClick={() => onBack ? onBack() : onNavigate('admin-products')}
              className="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center bg-white/5 hover:bg-white/10 text-white rounded-xl border border-white/10 transition-all active:scale-90 group shrink-0"
            >
              <ArrowLeft className="w-4 h-4 md:w-4.5 md:h-4.5 group-hover:-translate-x-1 transition-transform" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm md:text-base font-black tracking-tight text-white uppercase italic whitespace-nowrap flex items-center gap-2">
                  <span>{productId ? 'Editar ' : 'Novo '}</span>
                  <span className="text-emerald-500">Produto</span>
                </h1>
                <button
                  type="button"
                  onClick={() => setShowHelpModal(true)}
                  className="w-7 h-7 rounded-full flex items-center justify-center border transition-all duration-300 active:scale-95 bg-zinc-900/60 border-white/5 text-zinc-500 hover:text-white hover:border-white/10 shrink-0"
                  title="Guia de Cadastro e Ajuda"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="hidden sm:flex items-center gap-1.5 text-[9px] md:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mt-0.5">
                <ShieldCheck className="w-3 h-3 text-emerald-500 shrink-0" />
                Ambiente de Gerenciamento Unificado
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            <div className="hidden md:flex flex-col items-end">
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">ID do Sistema</span>
              <span className="text-xs font-bold font-mono text-zinc-300">{productId || 'NEW_ENTRY'}</span>
            </div>

            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={!isValid || isSubmitting}
              className="px-3 py-2 md:px-4 md:py-2.5 rounded-xl flex items-center justify-center gap-1.5 md:gap-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-600 transition-all active:scale-[0.98] font-black uppercase tracking-wider text-[9px] md:text-[10px] shadow-lg shadow-emerald-500/20 text-emerald-950 border border-white/10 shrink-0"
            >
              {isSubmitting ? (
                <div className="w-3.5 h-3.5 border-2 border-emerald-950/30 border-t-emerald-950 rounded-full animate-spin" />
              ) : showSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Salvo
                </>
              ) : (
                <>
                  {productId ? <Edit2 className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                  {productId ? 'Salvar' : 'Publicar'}
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <motion.form
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        onSubmit={handleSubmit}
        className="max-w-screen-xl mx-auto p-6 space-y-8"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column - Main Details */}
          <div className="lg:col-span-8 space-y-8">

            {/* Visual Media Section */}
            <section className="relative group">
              <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
                <ImageIcon className="w-24 h-24 text-white" />
              </div>

              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                    <Camera className="w-5 h-5 text-emerald-500" />
                  </div>
                  <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">Fotos do Produto</h3>
                  <button
                    type="button"
                    onClick={() => {
                      console.log('[HelpToggle] Toggling photo guide. Current:', showPhotoGuide);
                      setShowPhotoGuide(prev => !prev);
                    }}
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-xs font-black border transition-all shrink-0 active:scale-95 select-none touch-manipulation",
                      showPhotoGuide 
                        ? "bg-emerald-500 border-emerald-400 text-emerald-950 shadow-md shadow-emerald-500/10 scale-110" 
                        : "bg-zinc-950/50 border-white/10 text-zinc-400"
                    )}
                    title="Ajuda / Guia de Fotos"
                  >
                    ?
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-6">
                <AnimatePresence>
                  {formData.images.map((image, index) => {
                    const meta = imageMetadata[image];
                    return (
                      <motion.div
                        key={index}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.8, opacity: 0 }}
                        className="relative w-36 h-36 group/img"
                      >
                        {/* Wrapper with rounded-3xl and overflow-hidden specifically for the image and its hover overlay */}
                        <div className="absolute inset-0 rounded-3xl overflow-hidden border border-white/10 shadow-lg z-0">
                          <img src={image} className="w-full h-full object-cover transition-transform duration-700 group-hover/img:scale-110" />
                          
                          {/* Hover action overlay */}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                type="button"
                                onClick={() => openAdjuster(image, index)}
                                className="w-8 h-8 bg-emerald-500 text-emerald-950 rounded-xl flex items-center justify-center hover:bg-emerald-400 hover:scale-110 transition-all shadow-lg"
                                title="Ajustar e Cortar"
                              >
                                <Scissors className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeImage(index)}
                                className="w-8 h-8 bg-red-500 text-white rounded-xl flex items-center justify-center hover:bg-red-400 hover:scale-110 transition-all shadow-lg"
                                title="Excluir"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Status warning badge and tooltip box (placed outside of overflow-hidden inner wrapper to prevent clipping) */}
                        {meta && meta.status !== 'loading' && (
                          <div className="absolute top-3 right-3 z-20">
                            <div className={`relative group/tooltip transition-opacity duration-300 ${
                              (meta.status === 'warning_aspect' || meta.status === 'warning_res')
                                ? 'opacity-100'
                                : 'opacity-0 group-hover/img:opacity-100'
                            }`}>
                              <span className={`w-5 h-5 rounded-full flex items-center justify-center font-black text-[9px] shadow-lg border border-white/10 cursor-help ${
                                meta.status === 'excellent' ? 'bg-emerald-500 text-emerald-950' :
                                meta.status === 'warning_aspect' ? 'bg-amber-500 text-zinc-950' :
                                meta.status === 'warning_res' ? 'bg-red-500 text-white' :
                                'bg-blue-500 text-white'
                              }`}>
                                {meta.status === 'excellent' ? '✓' :
                                 meta.status === 'warning_aspect' ? '!' :
                                 meta.status === 'warning_res' ? '⚠' : 'i'}
                              </span>
                              
                              {/* Tooltip box - aligned exactly with the card boundaries (w-36) and positioned above the card (bottom-10 right-[-12px]) to prevent screen-edge clipping */}
                              <div className="absolute bottom-10 right-[-12px] w-36 bg-zinc-950 text-white text-[8px] font-black uppercase tracking-wider p-2.5 rounded-xl border border-white/10 opacity-0 pointer-events-none group-hover/tooltip:opacity-100 transition-opacity shadow-2xl z-30 leading-normal">
                                <span className="text-emerald-400 block mb-0.5">Dim: {meta.width}x{meta.height}</span>
                                {meta.status === 'excellent' && "Excelente Proporção e Resolução!"}
                                {meta.status === 'warning_aspect' && "Proporção inadequada. Clique na tesoura para ajustar para 4:5."}
                                {meta.status === 'warning_res' && "Baixa resolução. Recomendado > 800px."}
                                {meta.status === 'good' && "Proporção e resolution boas."}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Bottom position/index badge */}
                        <div className={`absolute bottom-3 left-3 px-2 py-1 rounded-lg border text-[7px] font-black uppercase tracking-widest z-10 ${index === 0 ? 'bg-emerald-500 border-emerald-400 text-emerald-950 shadow-md' : 'bg-black/40 backdrop-blur-md border-white/10 text-white/50'}`}>
                          {index === 0 ? 'Principal' : `#${index + 1}`}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>

                <label className="flex-shrink-0 w-36 h-36 rounded-3xl border-2 border-dashed border-white/10 border-emerald-500/10 flex flex-col items-center justify-center cursor-pointer hover:bg-emerald-500/5 hover:border-emerald-500/30 transition-all group/upload relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/0 to-emerald-500/5" />
                  <Plus className="w-8 h-8 text-zinc-600 group-hover/upload:text-emerald-500 group-hover/upload:scale-110 transition-all mb-1 relative z-10" />
                  <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest relative z-10 group-hover/upload:text-emerald-400">Adicionar Imagem</span>
                  <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                </label>
              </div>
            </section>

            {/* Guide Section */}
            <AnimatePresence>
              {showPhotoGuide && (
                <motion.section
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="pt-6 border-t border-white/5 space-y-4"
                >
                  <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-emerald-400" />
                    Guia de Fotos do Produto
                  </h3>
                  <div className="p-5 bg-zinc-950/40 border border-white/5 rounded-2xl space-y-4">
                    <p className="text-[10px] text-zinc-400 leading-relaxed font-medium">
                      Imagens de alta qualidade aumentam a conversão de vendas. Siga as orientações recomendadas:
                    </p>
                    <ul className="space-y-2 text-[10px] font-medium text-zinc-500 list-disc pl-4">
                      <li><b className="text-zinc-350">Proporção 4:5 (Card):</b> Essencial para que os produtos caibam no card da vitrine sem cortes laterais automáticos. Use o enquadramento "Vitrine".</li>
                      <li><b className="text-zinc-350">Proporção 1:1 (Detalhe):</b> Ideal para a galeria interna do produto. Mantém a consistência visual em carrosséis.</li>
                      <li><b className="text-zinc-350">Resolução Recomendada:</b> Imagens com pelo menos 800px a 1200px de altura garantem nitidez no zoom.</li>
                      <li><b className="text-zinc-350">Fundo e Contraste:</b> Fundos neutros (branco/cinza) e produtos bem iluminados destacam os detalhes e transmitem profissionalismo.</li>
                    </ul>
                    <div className="pt-3 border-t border-white/5 flex items-center justify-between text-[9px] font-black text-emerald-400 uppercase tracking-widest">
                      <span>Proporção ideal: 4:5 ou 1:1</span>
                      <span>Res: &gt; 800px</span>
                    </div>
                  </div>
                </motion.section>
              )}
            </AnimatePresence>

            {/* Content Section */}
            <section className="pt-12 border-t border-white/5 space-y-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                  <Info className="w-5 h-5 text-blue-500" />
                </div>
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">Dados do Produto</h3>
                <button
                  type="button"
                  onClick={() => toggleHelp('productData')}
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-black border transition-all shrink-0 active:scale-95 select-none touch-manipulation",
                    expandedHelp['productData']
                      ? "bg-blue-500 border-blue-400 text-blue-950 shadow-md shadow-blue-500/10 scale-110"
                      : "bg-zinc-950/50 border-white/10 text-zinc-400"
                  )}
                  title="Ajuda / Guia de Dados do Produto"
                >
                  ?
                </button>
              </div>

              {/* Data Guide Section */}
              <AnimatePresence>
                {expandedHelp['productData'] && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="pt-2 pb-6 border-b border-white/5 space-y-4"
                  >
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-blue-400" />
                      Guia de Cadastro e Informações
                    </h3>
                    <div className="p-5 bg-zinc-950/40 border border-white/5 rounded-2xl space-y-4">
                      <p className="text-[10px] text-zinc-400 leading-relaxed font-medium">
                        O preenchimento correto dos dados melhora a indexação do produto e facilita a decisão do cliente.
                      </p>
                      <ul className="space-y-3 text-[10px] font-medium text-zinc-500 list-none pl-0">
                        <li className="flex items-start gap-2.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                          <span><b className="text-zinc-300">Nome do Produto:</b> Seja claro, indicando o tipo do item, a marca e a característica principal (ex: <i>Camiseta Algodão Egípcio Slim - Preta</i>). Evite excesso de adjetivos promocionais.</span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                          <span><b className="text-zinc-350">Descrição Detalhada:</b> Informe materiais, dimensões, tabelas de medidas, garantia e cuidados de conservação. Uma boa descrição reduz as dúvidas no WhatsApp e diminui devoluções.</span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                          <span><b className="text-zinc-350">Setor / Categoria:</b> Classifique adequadamente para que o produto seja filtrado na vitrine da loja e apareça nos setores corretos do catálogo.</span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                          <span><b className="text-zinc-350">Código SKU:</b> Código identificador único do produto (Stock Keeping Unit). Útil para controle interno, integração de estoque e identificação ágil.</span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                          <span><b className="text-zinc-350">Estoque Base:</b> Quantidade física disponível. Se utilizar variações, o estoque de cada variante será somado ou deduzido deste total conforme as vendas.</span>
                        </li>
                      </ul>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="md:col-span-2 space-y-3">
                  <label htmlFor="product-name" className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Nome do Produto *</label>
                  <input
                    id="product-name"
                    name="product-name"
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Ex: Camiseta Básica Preta - Tamanho M"
                    className="w-full px-6 py-5 bg-zinc-950/50 border border-white/5 rounded-2xl text-base font-black text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:text-zinc-800"
                  />
                </div>

                <div className="md:col-span-2 space-y-3">
                  <label htmlFor="product-description" className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Descrição do Produto *</label>
                  <textarea
                    id="product-description"
                    name="product-description"
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Digite os detalhes e informações do produto..."
                    rows={6}
                    className="w-full px-6 py-5 bg-zinc-950/50 border border-white/5 rounded-3xl text-sm font-medium text-zinc-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all resize-none placeholder:text-zinc-800 leading-relaxed"
                  />
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Setor / Categoria *</label>
                  <div className="relative group">
                    <Select
                      value={formData.category || ""}
                      onValueChange={async (val) => {
                        if (val === 'NEW_CATEGORY') {
                          setShowCategoryForm(true);
                        } else {
                          setFormData(prev => ({ ...prev, category: val }));
                        }
                      }}
                    >
                      <SelectTrigger className="w-full px-6 py-5 h-auto bg-zinc-950/50 border border-white/5 rounded-2xl text-sm font-black text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all hover:bg-zinc-900/50 hover:border-white/10 [&>svg]:opacity-50">
                        <SelectValue placeholder="Selecionar Setor" />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-900/95 border-white/10 backdrop-blur-xl rounded-xl p-2 shadow-[0_10px_40px_rgba(0,0,0,0.8)]">
                        {dbCategories.map((category) => (
                          <SelectItem key={category.id} value={category.name} className="py-3 px-4 rounded-lg cursor-pointer font-bold text-zinc-300 focus:bg-white/5 focus:text-emerald-400">
                            {category.name.toUpperCase()}
                          </SelectItem>
                        ))}
                        <div className="h-px bg-white/10 my-2 mx-1" />
                        <SelectItem value="NEW_CATEGORY" className="py-3 px-4 rounded-lg cursor-pointer font-black text-emerald-500 focus:bg-emerald-500/10 focus:text-emerald-400">
                          <span className="flex items-center gap-2">➕ CRIAR NOVA CATEGORIA</span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="absolute right-12 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-600 group-hover:text-emerald-500 transition-colors">
                      <Layers className="w-5 h-5" />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <label htmlFor="product-sku" className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Código SKU</label>
                  <div className="relative group">
                    <input
                      id="product-sku"
                      name="product-sku"
                      type="text"
                      value={formData.sku}
                      onChange={(e) => setFormData(prev => ({ ...prev, sku: e.target.value.toUpperCase() }))}
                      placeholder="Ex: SKU-PROD-BASE"
                      className="w-full px-6 py-5 bg-zinc-950/50 border border-white/5 rounded-2xl text-sm font-black text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:text-zinc-800"
                    />
                    <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-600">
                      <Layers className="w-5 h-5" />
                    </div>
                  </div>
                </div>

                <div className="md:col-span-2 space-y-3">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Quantidade em Estoque *</label>
                  <div className="relative group">
                    <input
                      type="number"
                      min="0"
                      value={formData.stock}
                      onChange={(e) => setFormData(prev => ({ ...prev, stock: e.target.value }))}
                      className="w-full px-6 py-5 bg-zinc-950/50 border border-white/5 rounded-2xl text-sm font-black text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all tabular-nums"
                    />
                    <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-600">
                      <Package className="w-5 h-5" />
                    </div>
                  </div>
                </div>

                {/* Product Variants Grade (Moved inside Product Data section) */}
                <div className="md:col-span-2 pt-8 border-t border-white/5 space-y-4">
                  <div className="flex items-center justify-between px-2">
                    <div className="flex items-center gap-3">
                      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2">
                        <Layers className="w-4 h-4" />
                        Variações do Produto
                      </h3>
                      <button
                        type="button"
                        onClick={() => toggleHelp('productVariants')}
                        className={cn(
                          "w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black border transition-all shrink-0 active:scale-95 select-none touch-manipulation",
                          expandedHelp['productVariants']
                            ? "bg-emerald-500 border-emerald-400 text-emerald-950 shadow-md shadow-emerald-500/10 scale-110"
                            : "bg-zinc-950/50 border-white/10 text-zinc-400"
                        )}
                        title="Ajuda / Guia de Variações"
                      >
                        ?
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingVariant(null);
                        setVariantFormData({
                          name: '',
                          value: '',
                          sku: '',
                          stockIncrement: '0',
                          priceOverride: '',
                          active: true,
                          imageUrl: ''
                        });
                        setShowVariantForm(true);
                      }}
                      className="px-3 py-1.5 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-emerald-500 hover:text-emerald-950 transition-all active:scale-95"
                    >
                      + Novo
                    </button>
                  </div>

                  {/* Variants Guide Section */}
                  <AnimatePresence>
                    {expandedHelp['productVariants'] && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                        className="pb-4 border-b border-white/5 space-y-3 w-full"
                      >
                        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2">
                          <BookOpen className="w-4 h-4 text-emerald-400" />
                          Como usar as Variações
                        </h3>
                        <div className="p-4 bg-zinc-950/40 border border-white/5 rounded-2xl space-y-3">
                          <p className="text-[10px] text-zinc-400 leading-relaxed font-medium">
                            Variações permitem vender o mesmo produto com diferentes opções de cor, tamanho, voltagem, etc.
                          </p>
                          <ul className="space-y-2 text-[10px] font-medium text-zinc-500 list-none pl-0">
                            <li className="flex items-start gap-2.5">
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                              <span><b className="text-zinc-350">Atributo (Nome e Valor):</b> Defina a característica (ex: Nome: <i>Tamanho</i>, Valor: <i>G</i>; ou Nome: <i>Cor</i>, Valor: <i>Azul</i>).</span>
                            </li>
                            <li className="flex items-start gap-2.5">
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                              <span><b className="text-zinc-350">Ajuste de Preço (Opcional):</b> Se uma variante custar mais caro (ex: tamanho especial ou material premium), preencha o campo de preço substituto. Se deixar em branco, o preço principal do produto será usado.</span>
                            </li>
                            <li className="flex items-start gap-2.5">
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                              <span><b className="text-zinc-350">Ajuste de Estoque:</b> Defina a variação de estoque (ex: se o produto principal tem 10 unidades e a variante G tem mais 5, use o incremento correto de estoque para que o cliente saiba exatamente o que há disponível).</span>
                            </li>
                            <li className="flex items-start gap-2.5">
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                              <span><b className="text-zinc-350">Foto da Variante:</b> Vincule uma foto específica da variação. Quando o comprador selecioná-la na página do produto, o carrossel exibirá automaticamente a foto correspondente.</span>
                            </li>
                          </ul>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="space-y-3">
                    {formData.variants.length === 0 ? (
                      <div className="bg-zinc-900 border border-dashed border-white/5 rounded-3xl p-8 text-center">
                        <p className="text-[10px] font-black text-zinc-700 uppercase tracking-[0.3em]">Nenhuma Variação Adicionada</p>
                      </div>
                    ) : (
                      formData.variants.map((v) => (
                        <div key={v.id} className="bg-zinc-900 border border-white/5 rounded-2xl p-4 flex items-center justify-between group hover:border-emerald-500/30 transition-all">
                          <div className="flex items-center gap-3">
                            {v.imageUrl && (
                              <div className="w-12 h-12 rounded-lg overflow-hidden border border-white/5 shrink-0">
                                <img src={v.imageUrl} className="w-full h-full object-cover" />
                              </div>
                            )}
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-black text-white uppercase italic tracking-tight">{v.name}: {v.value}</span>
                                {!v.active && <span className="text-[7px] font-black bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded uppercase border border-white/5">Offline</span>}
                              </div>
                              <div className="flex items-center gap-4 text-[9px] font-black uppercase tracking-tighter text-zinc-500">
                                <span className="flex items-center gap-1.5 py-1 px-2 bg-white/5 rounded-md border border-white/5">
                                  <Package className="w-3 h-3 text-zinc-400" />
                                  <span className="text-zinc-300">{v.stockIncrement > 0 ? `+${v.stockIncrement}` : v.stockIncrement} UND</span>
                                </span>
                                {v.priceOverride && (
                                  <span className="flex items-center gap-1.5 py-1 px-2 bg-emerald-500/10 rounded-md border border-emerald-500/20 text-emerald-500">
                                    <DollarSign className="w-3 h-3" />
                                    R$ {v.priceOverride.toFixed(2)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingVariant(v);
                                setVariantFormData({
                                  name: v.name,
                                  value: v.value,
                                  sku: v.sku || '',
                                  stockIncrement: v.stockIncrement.toString(),
                                  priceOverride: v.priceOverride?.toString() || '',
                                  active: v.active,
                                  imageUrl: v.imageUrl || ''
                                });
                                setShowVariantForm(true);
                              }}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-600 hover:text-white hover:bg-white/5 transition-all"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteVariant(v.id)}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-600 hover:text-red-500 hover:bg-red-500/5 transition-all"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* Pricing Section */}
            <section className="pt-12 border-t border-white/5 space-y-8 relative">

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                    <DollarSign className="w-5 h-5 text-emerald-500" />
                  </div>
                  <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">Precificação do Produto</h3>
                  <button
                    type="button"
                    onClick={() => toggleHelp('productPricing')}
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-xs font-black border transition-all shrink-0 active:scale-95 select-none touch-manipulation",
                      expandedHelp['productPricing']
                        ? "bg-emerald-500 border-emerald-400 text-emerald-950 shadow-md shadow-emerald-500/10 scale-110"
                        : "bg-zinc-950/50 border-white/10 text-zinc-400"
                    )}
                    title="Ajuda / Guia de Precificação"
                  >
                    ?
                  </button>
                </div>

                {priceVal > 0 && (
                  <div className="flex gap-3">
                    <div className="flex flex-col items-end">
                      <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest mb-1 text-right">Margem Líquida</span>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1 bg-zinc-800 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(100, Math.max(0, marginPct))}%` }}
                            className={`h-full ${marginPct > 30 ? 'bg-emerald-500' : 'bg-orange-500'}`}
                          />
                        </div>
                        <span className={`text-sm font-black ${marginPct > 30 ? 'text-emerald-500' : 'text-orange-500'}`}>
                          {marginPct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Pricing Guide Section */}
              <AnimatePresence>
                {expandedHelp['productPricing'] && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="pb-4 border-b border-white/5 space-y-4"
                  >
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-emerald-400" />
                      Guia de Custos e Margens
                    </h3>
                    <div className="p-5 bg-zinc-950/40 border border-white/5 rounded-2xl space-y-4">
                      <p className="text-[10px] text-zinc-400 leading-relaxed font-medium">
                        Configure os preços de forma estratégica. O sistema calcula a lucratividade automaticamente em tempo real.
                      </p>
                      <ul className="space-y-3 text-[10px] font-medium text-zinc-500 list-none pl-0">
                        <li className="flex items-start gap-2.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                          <span><b className="text-zinc-350">Preço de Custo (Opcional):</b> O valor total que você pagou para adquirir ou fabricar o produto. Esse dado é estritamente confidencial e é usado apenas pelo sistema para calcular a margem de lucro e o retorno sobre investimento (ROI) exibidos abaixo.</span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                          <span><b className="text-zinc-350">Preço de Venda:</b> O preço final cobrado do cliente. Pense em embutir custos fixos, impostos e taxas para manter sua operação saudável.</span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                          <span><b className="text-zinc-350">Produto em Promoção:</b> Ative para indicar um preço promocional riscado (ex: De: R$ 100,00 por R$ 79,90). No aplicativo do cliente, isso criará etiquetas com o percentual de desconto (ex: 20% OFF), incentivando a compra impulsiva.</span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                          <span><b className="text-zinc-350">Painel de Lucratividade:</b> O sistema analisa a diferença entre o preço de venda e o preço de custo. É recomendada uma margem de lucro líquida de pelo menos 30%. O sistema emitirá um alerta caso a margem esteja zerada ou negativa.</span>
                        </li>
                      </ul>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Preço de Custo</label>
                  <div className="relative group">
                    <span className="absolute left-6 top-1/2 -translate-y-1/2 text-zinc-600 font-bold text-sm">R$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.costPrice}
                      onChange={(e) => setFormData(prev => ({ ...prev, costPrice: e.target.value }))}
                      className="w-full pl-14 pr-6 py-5 bg-zinc-950/50 border border-white/5 rounded-2xl text-lg font-black text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all tabular-nums"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Preço de Venda</label>
                  <div className="relative group">
                    <span className="absolute left-6 top-1/2 -translate-y-1/2 text-emerald-500/50 font-bold text-sm">R$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.price}
                      onChange={(e) => setFormData(prev => ({ ...prev, price: e.target.value }))}
                      className="w-full pl-14 pr-6 py-5 bg-zinc-950 shadow-inner border border-emerald-500/20 rounded-2xl text-lg font-black text-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 transition-all tabular-nums"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="flex items-center justify-between p-3.5 bg-zinc-900/40 border border-white/5 rounded-2xl cursor-pointer hover:border-emerald-500/10 transition-all select-none">
                    <div className="space-y-0.5">
                      <span className="text-[10px] font-black uppercase tracking-tight text-white group-hover:text-emerald-400 transition-colors uppercase italic">Produto em Promoção</span>
                      <span className="text-[8px] font-medium text-zinc-500 uppercase tracking-wider block">Ativar preço cortado (De/Por)</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={isPromoActive}
                      onChange={(e) => {
                        setIsPromoActive(e.target.checked);
                        if (!e.target.checked) {
                          setFormData(prev => ({ ...prev, originalPrice: '' }));
                        }
                      }}
                      className="w-5 h-5 rounded bg-zinc-950 border-white/10 text-emerald-500 focus:ring-emerald-500/20 transition-all"
                    />
                  </label>

                  {isPromoActive && (
                    <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                      <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Preço Original ("De:")</label>
                      <div className="relative group">
                        <span className="absolute left-6 top-1/2 -translate-y-1/2 text-zinc-600 font-bold text-sm">R$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={formData.originalPrice}
                          onChange={(e) => setFormData(prev => ({ ...prev, originalPrice: e.target.value }))}
                          placeholder="Ex: 99.90"
                          className="w-full pl-14 pr-6 py-5 bg-zinc-950/50 border border-white/5 rounded-2xl text-lg font-black text-zinc-600 focus:outline-none transition-all tabular-nums"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {priceVal > 0 && costPriceVal > 0 && (
                <div className="relative group/roi mt-4">
                  {/* Glassmorphism Background with animated border logic */}
                  <div className={cn(
                    "absolute -inset-[1px] rounded-[2rem] blur-[2px] opacity-50 group-hover/roi:opacity-100 transition-opacity duration-500",
                    marginPct <= 0 
                      ? "bg-gradient-to-r from-rose-500/20 via-rose-400/40 to-rose-500/20" 
                      : "bg-gradient-to-r from-emerald-500/20 via-emerald-400/40 to-emerald-500/20"
                  )} />
                  
                  <div className="relative p-7 bg-zinc-950/40 border border-white/10 backdrop-blur-3xl rounded-[2rem] flex flex-col md:flex-row items-center justify-between gap-6 overflow-hidden">
                    {/* Animated Glow Decor */}
                    <div className={cn(
                      "absolute top-0 right-0 w-32 h-32 blur-[50px] rounded-full pointer-events-none transition-all duration-700",
                      marginPct <= 0 ? "bg-rose-500/10 group-hover/roi:bg-rose-500/20" : "bg-emerald-500/10 group-hover/roi:bg-emerald-500/20"
                    )} />
                    
                    <div className="flex items-center gap-6 w-full md:w-auto">
                      <div className="relative">
                        <div className={cn(
                          "absolute inset-0 blur-xl rounded-2xl transition-all",
                          marginPct <= 0 ? "bg-rose-500/20 group-hover/roi:bg-rose-500/40" : "bg-emerald-500/20 group-hover/roi:bg-emerald-500/40"
                        )} />
                        <div className={cn(
                          "relative w-16 h-16 rounded-2xl flex items-center justify-center border transition-transform duration-500 shadow-lg",
                          marginPct <= 0 
                            ? "bg-gradient-to-br from-rose-500/20 to-rose-600/10 border-rose-500/30 group-hover/roi:scale-110 shadow-rose-500/10 text-rose-400" 
                            : "bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 border-emerald-500/30 group-hover/roi:scale-110 shadow-emerald-500/10 text-emerald-400"
                        )}>
                          {marginPct <= 0 ? (
                            <TrendingDown className="w-8 h-8 text-rose-400 drop-shadow-[0_0_8px_rgba(244,63,94,0.5)]" />
                          ) : (
                            <TrendingUp className="w-8 h-8 text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
                          )}
                        </div>
                      </div>
                      
                      <div className="flex flex-col">
                        <p className={cn(
                          "text-[10px] font-black uppercase tracking-[0.3em] mb-1.5 opacity-80",
                          marginPct <= 0 ? "text-rose-400" : "text-emerald-400"
                        )}>
                          {marginPct <= 0 ? "Alerta de Margem" : "Análise de Lucro"}
                        </p>
                        <div className="flex items-baseline gap-2.5">
                          <span className="text-3xl font-black text-white tracking-tighter tabular-nums drop-shadow-sm">
                            R$ {(priceVal - costPriceVal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </span>
                          <span className={cn(
                            "text-[10px] font-black uppercase tracking-widest italic",
                            marginPct <= 0 ? "text-rose-500/40" : "text-emerald-500/40"
                          )}>/ por unidade</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-center md:items-end gap-3 w-full md:w-auto pt-4 md:pt-0 border-t md:border-t-0 border-white/5">
                      <div className="flex flex-col items-center md:items-end">
                        <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-1.5">Análise do Sistema</span>
                        <div className="relative group/badge">
                          <div className={cn(
                            "absolute inset-0 blur-md rounded-xl opacity-0 group-hover/roi:opacity-100 transition-opacity",
                            marginPct <= 0 ? "bg-rose-500/40" : "bg-emerald-500/40"
                          )} />
                          <div className={cn(
                            "px-5 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-wider relative z-10 flex items-center gap-2 group-hover/roi:scale-105 transition-transform duration-500",
                            marginPct <= 0 
                              ? "bg-rose-500 text-rose-950 shadow-[0_10px_20px_rgba(244,63,94,0.3)]" 
                              : "bg-emerald-500 text-emerald-950 shadow-[0_10px_20px_rgba(16,185,129,0.3)]"
                          )}>
                             {marginPct <= 0 ? (
                               <>
                                 <AlertTriangle className="w-3.5 h-3.5" />
                                 Margem Negativa
                               </>
                             ) : (
                               <>
                                 <Check className="w-3.5 h-3.5" />
                                 Alta Performance
                               </>
                             )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Interactive background lines */}
                    <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent opacity-20" />
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* Right Column - Secondary Controls */}
          <div className="lg:col-span-4 space-y-8">

            {/* Status & Options */}
            <section className="space-y-6">
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500 mb-2">Configurações de Exibição</h3>

              <div className="space-y-4">
                {[
                  { 
                    id: 'freeShipping', 
                    label: 'Incentivo Frete Grátis', 
                    sub: 'Reduz objeção de compra', 
                    key: 'freeShipping',
                    desc: 'Oferece frete grátis exclusivamente para este produto, independentemente do valor da compra. Isso anula a taxa de entrega quando o produto está no carrinho e ajuda a reduzir o abandono de compra.',
                    renderPreview: (checked: boolean) => (
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "transition-all duration-300",
                          checked ? "opacity-100 scale-100" : "opacity-35 scale-95 saturate-[0.25]"
                        )}>
                          <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-600 px-2.5 py-1 rounded-lg text-[9px] font-black border border-emerald-100/50 w-fit">
                            <Truck className="w-3.5 h-3.5 animate-bounce-subtle shrink-0" />
                            <span>FRETE GRÁTIS</span>
                          </div>
                        </div>
                        <span className={cn(
                          "text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border transition-all duration-300",
                          checked 
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
                            : "bg-zinc-800/80 text-zinc-500 border-white/5"
                        )}>
                          {checked ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                    )
                  },
                  { 
                    id: 'isBestseller', 
                    label: 'Flag de Destaque (Best)', 
                    sub: 'Prioridade no Algoritmo', 
                    key: 'isBestseller',
                    desc: 'Sinaliza o produto com o selo "HOT" de mais vendido (chama a atenção visual na listagem) e o exibe no carrossel de "Destaques em Alta" na página inicial da loja.',
                    renderPreview: (checked: boolean) => (
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "transition-all duration-300",
                          checked ? "opacity-100 scale-100" : "opacity-35 scale-95 saturate-[0.25]"
                        )}>
                          <div className="bg-slate-900 border border-white/10 px-2.5 py-1 rounded-lg flex items-center gap-1.5 font-black text-[9px] text-white w-fit shadow-md">
                            <Flame className="w-3.5 h-3.5 text-orange-400 fill-orange-400 shrink-0" />
                            <span>HOT</span>
                          </div>
                        </div>
                        <span className={cn(
                          "text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border transition-all duration-300",
                          checked 
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
                            : "bg-zinc-800/80 text-zinc-500 border-white/5"
                        )}>
                          {checked ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                    )
                  },
                  { 
                    id: 'isActive', 
                    label: 'Status de Ativo', 
                    sub: 'Visibilidade no Catálogo', 
                    key: 'isActive',
                    desc: 'Define se o produto está disponível para compra imediata na loja. Quando inativo, o produto fica oculto do catálogo e da busca (ideal para pausar vendas temporariamente).',
                    renderPreview: (checked: boolean) => (
                      <div className="mt-1">
                        {checked ? (
                          <div className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-lg text-[9px] font-black border border-emerald-500/20 w-fit">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                            <span>EM OPERAÇÃO (VISÍVEL)</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 bg-zinc-800 text-zinc-400 px-2.5 py-1 rounded-lg text-[9px] font-black border border-white/5 w-fit">
                            <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 shrink-0" />
                            <span>OFFLINE (OCULTO)</span>
                          </div>
                        )}
                      </div>
                    )
                  }
                ].map((opt) => {
                  const isChecked = (formData as any)[opt.key];
                  return (
                    <div key={opt.id} className="p-5 bg-zinc-950/40 border border-white/5 rounded-2xl transition-all space-y-3.5 hover:border-white/10">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="space-y-0.5">
                            <span className="text-[11px] font-black uppercase tracking-tight text-white uppercase italic">{opt.label}</span>
                            <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest block">{opt.sub}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              toggleHelp(opt.id);
                            }}
                            className={cn(
                              "w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black border transition-all shrink-0 active:scale-95 select-none touch-manipulation",
                              expandedHelp[opt.id]
                                ? "bg-emerald-500 border-emerald-400 text-emerald-950 shadow-md shadow-emerald-500/10 scale-110"
                                : "bg-zinc-950 border-white/10 text-zinc-500"
                            )}
                            title="Saiba mais"
                          >
                            ?
                          </button>
                        </div>
                        <label className="flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => setFormData(prev => ({ ...prev, [opt.key]: e.target.checked }))}
                            className="w-5 h-5 rounded bg-zinc-900 border-white/10 text-emerald-500 focus:ring-emerald-500/20 focus:ring-offset-zinc-900 transition-all cursor-pointer"
                          />
                        </label>
                      </div>
                      
                      <AnimatePresence>
                        {expandedHelp[opt.id] && (
                          <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                          >
                            <div className="pt-3 border-t border-white/5 space-y-2 mt-3">
                              <p className="text-[10px] text-zinc-400 leading-relaxed font-medium">{opt.desc}</p>
                              
                              <div className="space-y-1">
                                <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest block">Como aparece no aplicativo:</span>
                                <div className="min-h-[28px] flex items-center">
                                  {opt.renderPreview(isChecked)}
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Preview section moved to floating simulator modal */}

          </div>
        </div>
      </motion.form>

      {/* Image Cropper Modal */}
      <AnimatePresence>
        {isAdjusterOpen && (
          <ImageAdjuster
            isOpen={isAdjusterOpen}
            onClose={() => {
              setIsAdjusterOpen(false);
              setAdjustingImgIndex(null);
            }}
            imageUrl={adjustingImgUrl}
            onConfirm={handleAdjustConfirm}
            isSubmitting={isUploadingAdjusted}
          />
        )}
      </AnimatePresence>

      {/* Floating Action Button */}
      <div className="fixed bottom-28 right-6 z-50">
        <button
          type="button"
          onClick={() => setIsPreviewOpen(true)}
          className="bg-zinc-900 border border-white/10 hover:border-emerald-500/30 hover:shadow-[0_15px_30px_rgba(16,185,129,0.15)] text-white rounded-full px-5 py-3.5 flex items-center gap-2.5 shadow-[0_15px_30px_rgba(0,0,0,0.6)] backdrop-blur-xl transition-all hover:bg-zinc-800 hover:scale-105 active:scale-95 group select-none cursor-pointer"
        >
          <div className="relative flex items-center justify-center">
            <span className="absolute inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </div>
          <Smartphone className="w-4 h-4 text-zinc-400 group-hover:text-emerald-400 transition-colors" />
          <span className="text-[10px] font-black uppercase tracking-wider">Visualizar App</span>
        </button>
      </div>

      {/* Live Preview Fullscreen Modal */}
      <AnimatePresence>
        {isPreviewOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] bg-zinc-950/95 backdrop-blur-xl flex flex-col text-zinc-100"
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
                  onClick={() => setIsPreviewOpen(false)}
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
                              <span className="bg-rose-600 text-white px-2 py-0.5 rounded-md font-black text-[8px] uppercase tracking-wider shadow-lg shrink-0 animate-bounce-subtle">
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
                                  <Truck className="w-2 h-2 animate-bounce-subtle shrink-0" />
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
                                <Truck className="w-2.5 h-2.5 animate-bounce-subtle" />
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
                            }, {} as Record<string, typeof formData.variants>)
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
                            {activeDetailTab === 'description' && (
                              <div className="text-[9px] text-zinc-600 leading-relaxed font-medium mt-1">
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
                              </div>
                            )}

                            {activeDetailTab === 'reviews' && (
                              <div className="space-y-2 mt-1">
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
                              </div>
                            )}

                            {activeDetailTab === 'questions' && (
                              <div className="space-y-2 mt-1">
                                <div className="p-2 border border-zinc-100 rounded-xl space-y-1 bg-zinc-50/50">
                                  <div className="flex items-center gap-1 text-[7px] font-black text-zinc-400 uppercase tracking-wider">
                                    <span>P: Vocês entregam hoje?</span>
                                  </div>
                                  <div className="p-1.5 bg-white rounded-lg border border-zinc-100 text-[8px] text-zinc-600">
                                    <span className="font-bold text-zinc-800 block text-[7px] uppercase tracking-wider mb-0.5">Resposta do Vendedor:</span>
                                    Sim! Se o pedido for realizado até as 18h entregamos hoje mesmo.
                                  </div>
                                </div>
                              </div>
                            )}
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
        {/* Modal de Ajuda */}
        {showHelpModal && (
          <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300">
            <div className="relative bg-zinc-950/95 border border-white/10 rounded-[2rem] sm:rounded-[2.5rem] w-full max-w-2xl p-5 sm:p-8 flex flex-col max-h-[88vh] sm:max-h-[85vh] shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden animate-in zoom-in-95 duration-300 text-left">
              {/* Header */}
              <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4 shrink-0">
                <h3 className="text-sm font-black text-admin-gold uppercase tracking-[0.2em] flex items-center gap-2">
                  <HelpCircle className="w-5 h-5 text-admin-gold animate-pulse" />
                  Engenharia & Cadastro de Produtos
                </h3>
                <button
                  type="button"
                  onClick={() => setShowHelpModal(false)}
                  className="w-8 h-8 rounded-xl bg-zinc-900/50 border border-white/5 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all flex items-center justify-center font-bold text-sm"
                >
                  ✕
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto space-y-6 pr-1 pb-6 custom-scrollbar text-zinc-300 text-sm">
                <div className="space-y-4">
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Nesta tela você pode cadastrar novos produtos ou editar produtos existentes no catálogo da sua loja. Preencha os campos com atenção para garantir a melhor experiência para os compradores.
                  </p>

                  <div className="space-y-3">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 border-l-2 border-admin-gold pl-2">
                      Estrutura do Formulário
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                        <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                          <Package className="w-4 h-4 text-emerald-500" />
                          Informações Básicas & SKU
                        </div>
                        <p className="text-xs text-zinc-400">
                          Nome do produto, descrição detalhada e o <strong className="text-white">SKU</strong> (código único de controle de estoque interno da sua loja).
                        </p>
                      </div>

                      <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                        <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                          <DollarSign className="w-4 h-4 text-admin-gold" />
                          Precificação & Custos
                        </div>
                        <p className="text-xs text-zinc-400">
                          Configure o preço de venda e o custo unitário. O sistema calcula automaticamente o lucro líquido e a margem de contribuição.
                        </p>
                      </div>

                      <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                        <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                          <Layers className="w-4 h-4 text-sky-500" />
                          Grade de Variações
                        </div>
                        <p className="text-xs text-zinc-400">
                          Adicione variantes (como cores, tamanhos ou voltagens) com estoques separados e possíveis acréscimos ou descontos de preço.
                        </p>
                      </div>

                      <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                        <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                          <ShieldCheck className="w-4 h-4 text-purple-500" />
                          Exibição & Mídia
                        </div>
                        <p className="text-xs text-zinc-400">
                          Adicione fotos, defina se o produto está ativo/visível aos clientes, se possui frete grátis ou se é um destaque de vendas.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 border-l-2 border-admin-gold pl-2">
                      Dicas para um Cadastro de Sucesso
                    </h4>
                    <ul className="space-y-2 text-xs text-zinc-400 list-disc list-inside">
                      <li>Use fotos de alta qualidade com fundo claro ou neutro (idealmente quadradas ou 1:1).</li>
                      <li>Descreva detalhadamente o produto, incluindo dimensões, materiais e políticas de garantia.</li>
                      <li>Certifique-se de que o SKU cadastrado é único na loja para evitar problemas na baixa de estoque.</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="pt-4 border-t border-white/5 flex justify-end shrink-0">
                <button
                  type="button"
                  onClick={() => setShowHelpModal(false)}
                  className="px-5 py-2.5 rounded-xl bg-admin-gold text-black text-[10px] font-black uppercase tracking-widest hover:bg-admin-gold/90 transition-all"
                >
                  Entendi
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
