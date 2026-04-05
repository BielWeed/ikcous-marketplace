import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Plus, Camera, Check, Layers, Trash2, Edit2, DollarSign, TrendingUp, Info, Package, ShieldCheck, Image as ImageIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { View, ProductVariant } from '@/types';
import { useProducts } from '@/hooks/useProducts';
import { useCategories } from '@/hooks/useCategories';
import { toast } from 'sonner';

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

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 }
};

export function AdminProductFormView({ productId, onNavigate, onBack }: AdminProductFormViewProps) {
  const { addProduct, updateProduct, addVariant, updateVariant, deleteVariant, uploadProductImages, fetchProduct } = useProducts({ autoFetch: false });
  const { categories: dbCategories } = useCategories();

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
    active: true
  });
  const [currentProduct, setCurrentProduct] = useState<any>(null);

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
            variants: product.variants || [],
          });
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

  const handleVariantSubmit = async () => {
    if (!productId) return;

    try {
      const parsedPriceOverride = variantFormData.priceOverride ? parseFloat(variantFormData.priceOverride) : undefined;

      const vData = {
        productId,
        name: variantFormData.name,
        value: variantFormData.value,
        sku: variantFormData.sku,
        stockIncrement: parseInt(variantFormData.stockIncrement) || 0,
        priceOverride: parsedPriceOverride !== undefined ? Math.max(0, parsedPriceOverride) : undefined,
        active: variantFormData.active
      };

      if (editingVariant) {
        await updateVariant(editingVariant.id, vData);
      } else {
        await addVariant(vData);
      }

      setShowVariantForm(false);
      setEditingVariant(null);
      setVariantFormData({
        name: '',
        value: '',
        sku: '',
        stockIncrement: '0',
        priceOverride: '',
        active: true
      });

      const updatedProduct = await fetchProduct(productId);
      if (updatedProduct) {
        setFormData(prev => ({ ...prev, variants: updatedProduct.variants || [] }));
      }
    } catch (err) {
      console.error('Variant error:', err);
    }
  };

  const handleDeleteVariant = async (vId: string) => {
    if (globalThis.confirm('Excluir esta variante?')) {
      await deleteVariant(vId);
      const updatedProduct = await fetchProduct(productId!);
      if (updatedProduct) {
        setFormData(prev => ({ ...prev, variants: updatedProduct.variants || [] }));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const pPrice = parseFloat(formData.price) || 0;
    const pCost = formData.costPrice ? parseFloat(formData.costPrice) : undefined;
    const pOriginal = formData.originalPrice ? parseFloat(formData.originalPrice) : undefined;
    const pStock = parseInt(formData.stock) || 0;

    const productData = {
      name: formData.name,
      description: formData.description,
      price: Math.max(0, pPrice),
      costPrice: pCost !== undefined ? Math.max(0, pCost) : undefined,
      originalPrice: pOriginal !== undefined ? Math.max(0, pOriginal) : undefined,
      stock: Math.max(0, pStock),
      category: formData.category,
      images: formData.images,
      freeShipping: formData.freeShipping,
      isBestseller: formData.isBestseller,
      isActive: formData.isActive,
      metaTitle: formData.metaTitle,
      metaDescription: formData.metaDescription,
      sold: productId ? (currentProduct?.sold || 0) : 0,
    };

    try {
      if (productId) {
        await updateProduct(productId, productData);
      } else {
        await addProduct(productData);
      }

      setIsSubmitting(false);
      setShowSuccess(true);

      setTimeout(() => {
        onNavigate('admin-products');
      }, 1500);
    } catch {
      setIsSubmitting(false);
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

  return (
    <div className="min-h-screen bg-zinc-950 text-white pb-32">
      {/* Background Decor */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-emerald-500/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-blue-500/5 blur-[120px] rounded-full" />
      </div>

      <AnimatePresence>
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
              className="bg-zinc-900 border border-white/10 rounded-[2.5rem] w-full max-w-md p-8 shadow-2xl"
            >
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                  <Layers className="w-6 h-6 text-emerald-500" />
                </div>
                <div>
                  <h3 className="font-black text-xl tracking-tight">{editingVariant ? 'Editar Variante' : 'Nova Variante'}</h3>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest leading-none mt-1">Grade de Produto</p>
                </div>
              </div>

              <div className="space-y-6">
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
                </div>
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
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Saldo Extra</label>
                    <input
                      type="number"
                      value={variantFormData.stockIncrement}
                      onChange={e => setVariantFormData(p => ({ ...p, stockIncrement: e.target.value }))}
                      className="w-full px-5 py-4 bg-zinc-950 border border-white/5 rounded-2xl text-sm font-black focus:outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Sobrescrever R$</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={variantFormData.priceOverride}
                      onChange={e => setVariantFormData(p => ({ ...p, priceOverride: e.target.value }))}
                      className="w-full px-5 py-4 bg-zinc-950 border border-white/5 rounded-2xl text-sm font-black focus:outline-none transition-all"
                      placeholder="Auto"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-4 pt-8">
                <button
                  onClick={() => {
                    setShowVariantForm(false);
                    setEditingVariant(null);
                  }}
                  className="flex-1 py-5 text-xs font-black text-zinc-500 uppercase tracking-widest hover:text-white transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleVariantSubmit}
                  className="flex-[2] py-5 bg-emerald-500 text-emerald-950 rounded-2xl text-xs font-black uppercase tracking-widest shadow-[0_10px_30px_rgba(16,185,129,0.3)] hover:scale-105 active:scale-95 transition-all"
                >
                  {editingVariant ? 'Salvar Protocolo' : 'Efetivar Variante'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="sticky top-0 z-[60] backdrop-blur-2xl bg-zinc-950/80 border-b border-white/5 px-6 py-6 overflow-hidden">
        {/* Glow Line */}
        <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />

        <div className="flex items-center justify-between max-w-screen-xl mx-auto">
          <div className="flex items-center gap-5">
            <button
              onClick={() => onBack ? onBack() : onNavigate('admin-products')}
              className="w-12 h-12 flex items-center justify-center bg-white/5 hover:bg-white/10 text-white rounded-2xl border border-white/10 transition-all active:scale-90 group"
            >
              <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
            </button>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <h1 className="text-xl font-black tracking-tight text-white uppercase italic">
                  {productId ? 'Edição de ' : 'Novo '}
                  <span className="text-emerald-500">Ativo</span>
                </h1>
                <div className="px-2 py-1 rounded bg-zinc-900 border border-white/5 text-[8px] font-black text-zinc-500 uppercase tracking-widest">v4.0 Elite</div>
              </div>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] flex items-center gap-2">
                <ShieldCheck className="w-3 h-3 text-emerald-500" />
                Ambiente de Gerenciamento Unificado
              </p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">ID do Sistema</span>
              <span className="text-xs font-bold font-mono text-zinc-300">{productId || 'NEW_ENTRY'}</span>
            </div>
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
            <motion.section variants={itemVariants} className="bg-zinc-900/40 border border-white/10 rounded-[3rem] p-8 shadow-2xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                <ImageIcon className="w-24 h-24 text-white" />
              </div>

              <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <Camera className="w-5 h-5 text-emerald-500" />
                </div>
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">Ativos Visuais</h3>
              </div>

              <div className="flex flex-wrap gap-6">
                <AnimatePresence>
                  {formData.images.map((image, index) => (
                    <motion.div
                      key={index}
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                      className="relative w-36 h-36 rounded-3xl overflow-hidden border border-white/10 shadow-lg group/img"
                    >
                      <img src={image} className="w-full h-full object-cover transition-transform duration-700 group-hover/img:scale-110" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => removeImage(index)}
                          className="w-10 h-10 bg-red-500/90 text-white rounded-full flex items-center justify-center hover:bg-red-500 hover:scale-110 transition-all shadow-lg"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className={`absolute top-3 left-3 px-2 py-1 rounded-lg border text-[7px] font-black uppercase tracking-widest ${index === 0 ? 'bg-emerald-500 border-emerald-400 text-emerald-950' : 'bg-black/40 backdrop-blur-md border-white/10 text-white/50'}`}>
                        {index === 0 ? 'Principal' : `#${index + 1}`}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>

                <label className="flex-shrink-0 w-36 h-36 rounded-3xl border-2 border-dashed border-white/10 border-emerald-500/10 flex flex-col items-center justify-center cursor-pointer hover:bg-emerald-500/5 hover:border-emerald-500/30 transition-all group/upload relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/0 to-emerald-500/5" />
                  <Plus className="w-8 h-8 text-zinc-600 group-hover/upload:text-emerald-500 group-hover/upload:scale-110 transition-all mb-1 relative z-10" />
                  <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest relative z-10 group-hover/upload:text-emerald-400">Append Media</span>
                  <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                </label>
              </div>
            </motion.section>

            {/* Content Section */}
            <motion.section variants={itemVariants} className="bg-zinc-900/40 border border-white/10 rounded-[3rem] p-8 space-y-8 shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                  <Info className="w-5 h-5 text-blue-500" />
                </div>
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">Metadados de Identificação</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="md:col-span-2 space-y-3">
                  <label htmlFor="product-name" className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Nomenclatura Técnica *</label>
                  <input
                    id="product-name"
                    name="product-name"
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Ex: IPHONE 16 CARBON BLACK - 256GB"
                    className="w-full px-6 py-5 bg-zinc-950/50 border border-white/5 rounded-2xl text-base font-black text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:text-zinc-800"
                  />
                </div>

                <div className="md:col-span-2 space-y-3">
                  <label htmlFor="product-description" className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Descrição do Ativo *</label>
                  <textarea
                    id="product-description"
                    name="product-description"
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Detalhamento técnico e comercial do produto..."
                    rows={6}
                    className="w-full px-6 py-5 bg-zinc-950/50 border border-white/5 rounded-3xl text-sm font-medium text-zinc-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all resize-none placeholder:text-zinc-800 leading-relaxed"
                  />
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Setor / Categoria *</label>
                  <div className="relative group">
                    <select
                      value={formData.category}
                      onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                      className="w-full px-6 py-5 bg-zinc-950/50 border border-white/5 rounded-2xl text-sm font-black text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all appearance-none cursor-pointer hover:bg-zinc-900/50 hover:border-white/10"
                    >
                      <option value="" className="bg-zinc-900">Selecionar Setor</option>
                      {dbCategories.map((category) => (
                        <option key={category.id} value={category.name} className="bg-zinc-900 text-zinc-400">{category.name.toUpperCase()}</option>
                      ))}
                    </select>
                    <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-600 group-hover:text-emerald-500 transition-colors">
                      <Layers className="w-5 h-5" />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Estoque Consolidado *</label>
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
              </div>
            </motion.section>

            {/* Pricing Section */}
            <motion.section variants={itemVariants} className="bg-zinc-900/40 border border-white/10 rounded-[3rem] p-8 space-y-8 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-8 opacity-5">
                <DollarSign className="w-24 h-24 text-white" />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                    <DollarSign className="w-5 h-5 text-emerald-500" />
                  </div>
                  <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">Engenharia Financeira</h3>
                </div>

                {formData.price && formData.costPrice && (
                  <div className="flex gap-3">
                    <div className="flex flex-col items-end">
                      <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest mb-1 text-right">Margem Líquida</span>
                      <div className="flex items-center gap-2">
                        {parseFloat(formData.price) > 0 && (
                          <div className="w-16 h-1 bg-zinc-800 rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${Math.min(100, Math.max(0, ((parseFloat(formData.price) - parseFloat(formData.costPrice)) / parseFloat(formData.price)) * 100))}%` }}
                              className={`h-full ${((parseFloat(formData.price) - parseFloat(formData.costPrice)) / parseFloat(formData.price)) * 100 > 30 ? 'bg-emerald-500' : 'bg-orange-500'}`}
                            />
                          </div>
                        )}
                        <span className={`text-sm font-black ${parseFloat(formData.price) > 0 && ((parseFloat(formData.price) - parseFloat(formData.costPrice)) / parseFloat(formData.price)) * 100 > 30 ? 'text-emerald-500' : 'text-orange-500'}`}>
                          {parseFloat(formData.price) > 0 ? (((parseFloat(formData.price) - parseFloat(formData.costPrice)) / parseFloat(formData.price)) * 100).toFixed(1) : '0.0'}%
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Preço de Custo (AQSC)</label>
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
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Preço de Oferta</label>
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

                <div className="space-y-3">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Markup (Ancoragem)</label>
                  <div className="relative group">
                    <span className="absolute left-6 top-1/2 -translate-y-1/2 text-zinc-600 font-bold text-sm">R$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.originalPrice}
                      onChange={(e) => setFormData(prev => ({ ...prev, originalPrice: e.target.value }))}
                      className="w-full pl-14 pr-6 py-5 bg-zinc-950/50 border border-white/5 rounded-2xl text-lg font-black text-zinc-600 focus:outline-none transition-all tabular-nums"
                    />
                  </div>
                </div>
              </div>

              {formData.price && formData.costPrice && parseFloat(formData.costPrice) > 0 && (
                <div className="relative group/roi mt-4">
                  {/* Glassmorphism Background with animated border logic */}
                  <div className="absolute -inset-[1px] bg-gradient-to-r from-emerald-500/20 via-emerald-400/40 to-emerald-500/20 rounded-[2rem] blur-[2px] opacity-50 group-hover/roi:opacity-100 transition-opacity duration-500" />
                  
                  <div className="relative p-7 bg-zinc-950/40 border border-white/10 backdrop-blur-3xl rounded-[2rem] flex flex-col md:flex-row items-center justify-between gap-6 overflow-hidden">
                    {/* Animated Glow Decor */}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 blur-[50px] rounded-full pointer-events-none group-hover/roi:bg-emerald-500/20 transition-all duration-700" />
                    
                    <div className="flex items-center gap-6 w-full md:w-auto">
                      <div className="relative">
                        <div className="absolute inset-0 bg-emerald-500/20 blur-xl rounded-2xl group-hover/roi:bg-emerald-500/40 transition-all" />
                        <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 flex items-center justify-center border border-emerald-500/30 group-hover/roi:scale-110 transition-transform duration-500 shadow-lg shadow-emerald-500/10">
                          <TrendingUp className="w-8 h-8 text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
                        </div>
                      </div>
                      
                      <div className="flex flex-col">
                        <p className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.3em] mb-1.5 opacity-80">Profit Distribution Analysis</p>
                        <div className="flex items-baseline gap-2.5">
                          <span className="text-3xl font-black text-white tracking-tighter tabular-nums drop-shadow-sm">
                            R$ {(Number.parseFloat(formData.price) - Number.parseFloat(formData.costPrice)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </span>
                          <span className="text-[10px] font-black text-emerald-500/40 uppercase tracking-widest italic">/ unidade bruta</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-center md:items-end gap-3 w-full md:w-auto pt-4 md:pt-0 border-t md:border-t-0 border-white/5">
                      <div className="flex flex-col items-center md:items-end">
                        <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-1.5">Score de Viabilidade</span>
                        <div className="relative group/badge">
                          <div className="absolute inset-0 bg-emerald-500/40 blur-md rounded-xl opacity-0 group-hover/roi:opacity-100 transition-opacity" />
                          <div className="px-5 py-2.5 bg-emerald-500 text-emerald-950 rounded-xl font-black text-[11px] uppercase tracking-wider shadow-[0_10px_20px_rgba(16,185,129,0.3)] relative z-10 flex items-center gap-2 group-hover/roi:scale-105 transition-transform duration-500">
                             <Check className="w-3.5 h-3.5" />
                             Alta Performance
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Interactive background lines */}
                    <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent opacity-20" />
                  </div>
                </div>
              )}
            </motion.section>
          </div>

          {/* Right Column - Secondary Controls */}
          <div className="lg:col-span-4 space-y-8">

            {/* Status & Options */}
            <motion.section variants={itemVariants} className="bg-zinc-900 border border-white/10 rounded-[2.5rem] p-8 space-y-6 shadow-2xl">
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500 mb-2">Configurações de Exibição</h3>

              <div className="space-y-4">
                {[
                  { id: 'freeShipping', label: 'Incentivo Frete Grátis', sub: 'Reduz objeção de compra', key: 'freeShipping' },
                  { id: 'isBestseller', label: 'Flag de Destaque (Best)', sub: 'Prioridade no Algoritmo', key: 'isBestseller' },
                  { id: 'isActive', label: 'Status de Ativo', sub: 'Visibilidade no Catálogo', key: 'isActive' }
                ].map((opt) => (
                  <label key={opt.id} className="flex items-center justify-between p-5 bg-zinc-950/50 border border-white/5 rounded-2xl cursor-pointer hover:bg-zinc-900/50 hover:border-emerald-500/20 transition-all group/opt">
                    <div className="space-y-1">
                      <span className="text-[11px] font-black uppercase tracking-tight text-white group-hover/opt:text-emerald-400 transition-colors uppercase italic">{opt.label}</span>
                      <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest block">{opt.sub}</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={(formData as any)[opt.key]}
                      onChange={(e) => setFormData(prev => ({ ...prev, [opt.key]: e.target.checked }))}
                      className="w-6 h-6 rounded-lg bg-zinc-900 border-white/10 text-emerald-500 focus:ring-emerald-500/20 focus:ring-offset-zinc-900 transition-all"
                    />
                  </label>
                ))}
              </div>
            </motion.section>

            {/* SEO Control */}
            <motion.section variants={itemVariants} className="bg-zinc-900/40 border border-white/10 rounded-[2.5rem] p-8 space-y-8 shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-orange-500" />
                </div>
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">Indexação Engine (SEO)</h3>
              </div>

              <div className="space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between ml-1">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Meta Title Pro</label>
                    <span className={`text-[9px] font-black ${formData.metaTitle.length > 60 ? 'text-orange-500' : 'text-zinc-600'}`}>{formData.metaTitle.length}/60</span>
                  </div>
                  <input
                    type="text"
                    value={formData.metaTitle}
                    onChange={(e) => setFormData(prev => ({ ...prev, metaTitle: e.target.value }))}
                    className="w-full px-5 py-4 bg-zinc-950/50 border border-white/5 rounded-2xl text-xs font-bold text-zinc-300 focus:ring-1 focus:ring-orange-500/30 focus:outline-none transition-all hover:border-white/10"
                    placeholder="Título otimizado para busca"
                  />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between ml-1">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Snippet Preview</label>
                    <span className={`text-[9px] font-black ${formData.metaDescription.length > 160 ? 'text-orange-500' : 'text-zinc-600'}`}>{formData.metaDescription.length}/160</span>
                  </div>
                  <textarea
                    value={formData.metaDescription}
                    onChange={(e) => setFormData(prev => ({ ...prev, metaDescription: e.target.value }))}
                    rows={4}
                    className="w-full px-5 py-4 bg-zinc-950/50 border border-white/5 rounded-2xl text-[11px] font-medium text-zinc-400 transition-all resize-none leading-relaxed hover:border-white/10 focus:ring-1 focus:ring-orange-500/30 focus:outline-none"
                    placeholder="Descrição para conversão orgânica..."
                  />
                </div>
              </div>
            </motion.section>

            {/* Variants Grade */}
            {productId && (
              <motion.section variants={itemVariants} className="space-y-4">
                <div className="flex items-center justify-between px-2">
                  <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2">
                    <Layers className="w-4 h-4" />
                    Grade Operacional
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowVariantForm(true)}
                    className="px-3 py-1.5 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-emerald-500 hover:text-emerald-950 transition-all"
                  >
                    + Novo
                  </button>
                </div>

                <div className="space-y-3">
                  {formData.variants.length === 0 ? (
                    <div className="bg-zinc-900 border border-dashed border-white/5 rounded-3xl p-8 text-center">
                      <p className="text-[10px] font-black text-zinc-700 uppercase tracking-[0.3em]">Grade Vazia</p>
                    </div>
                  ) : (
                    formData.variants.map((v) => (
                      <div key={v.id} className="bg-zinc-900 border border-white/5 rounded-2xl p-4 flex items-center justify-between group hover:border-emerald-500/30 transition-all">
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
                                active: v.active
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
              </motion.section>
            )}
          </div>
        </div>

        {/* Global Action Bar */}
        <motion.div
          initial={{ y: 100 }}
          animate={{ y: 0 }}
          className="fixed bottom-8 left-0 right-0 z-[70] px-6 max-w-screen-xl mx-auto pointer-events-none"
        >
          <div className="bg-zinc-900 border border-white/10 rounded-[2.5rem] p-3 shadow-[0_30px_60px_rgba(0,0,0,0.8)] backdrop-blur-xl flex items-center gap-4 pointer-events-auto">
            <div className="hidden md:flex flex-col ml-6 max-w-[200px]">
              <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest leading-tight">Status de Emissão</span>
              <span className={`text-[10px] font-bold uppercase truncate ${isValid ? 'text-emerald-500' : 'text-zinc-400'}`}>
                {isValid ? 'Pronto para Sincronização' : 'Aguardando Metadados Obligatórios'}
              </span>
            </div>

            <button
              type="submit"
              disabled={!isValid || isSubmitting}
              className="flex-1 py-5 rounded-2xl flex items-center justify-center gap-3 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-600 transition-all active:scale-[0.98] font-black uppercase tracking-[0.2em] text-[10px] shadow-lg shadow-emerald-500/20 text-emerald-950"
            >
              {isSubmitting ? (
                <div className="w-5 h-5 border-3 border-emerald-950/30 border-t-emerald-950 rounded-full animate-spin" />
              ) : showSuccess ? (
                <>
                  <Check className="w-5 h-5" />
                  Sincronizado com Sucesso
                </>
              ) : (
                <>
                  {productId ? <Edit2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  {productId ? 'Confirmar Atualização de Inventário' : 'Publicar Novo Ativo no Catálogo'}
                </>
              )}
            </button>
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border transition-all shrink-0 ${isValid ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.1)]' : 'border-zinc-800 bg-zinc-950 text-zinc-700'}`}>
              {isValid ? <ShieldCheck className="w-6 h-6 animate-pulse" /> : <Info className="w-6 h-6" />}
            </div>
          </div>
        </motion.div>
      </motion.form>
    </div>
  );
}
