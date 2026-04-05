import { useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Filter,
  MoreVertical,
  Edit2,
  Trash2,
  Copy,
  Eye,
  Package,
  TrendingUp,
  DollarSign,
  Wallet,
  ArrowUpRight,
  LayoutGrid
} from 'lucide-react';
import { useProducts } from '@/hooks/useProducts';
import type { View } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface AdminProductsViewProps {
  onNavigate: (view: View, id?: string) => void;
}

export function AdminProductsView({ onNavigate }: AdminProductsViewProps) {
  const { products, loading, deleteProduct, toggleProductStatus } = useProducts();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');

  const filteredProducts = useMemo(() => {
    return products?.filter(product => {
      const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.id.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = filterCategory === 'all' || product.category === filterCategory;
      return matchesSearch && matchesCategory;
    }) || [];
  }, [products, searchTerm, filterCategory]);

  // Lógica de cálculo financeiro global
  const financialStats = useMemo(() => {
    if (!filteredProducts) return { invested: 0, potential: 0, avgRoi: 0, activeCount: 0 };

    const totalInvested = filteredProducts.reduce((acc, p) => acc + ((p.costPrice || 0) * p.stock), 0);
    const totalPotentialValue = filteredProducts.reduce((acc, p) => acc + ((p.price || 0) * p.stock), 0);
    const potentialProfit = totalPotentialValue - totalInvested;
    const avgRoi = totalInvested > 0 ? (potentialProfit / totalInvested) * 100 : 0;

    return {
      invested: totalInvested,
      potential: potentialProfit,
      avgRoi: avgRoi,
      activeCount: filteredProducts.filter(p => p.isActive).length,
      totalCount: filteredProducts.length
    };
  }, [filteredProducts]);

  const handleDelete = async (id: string) => {
    if (globalThis.confirm('Tem certeza que deseja excluir este ativo?')) {
      try {
        await deleteProduct(id);
        toast.success("Ativo Removido", {
          description: "O produto foi excluído com sucesso do portfólio.",
        });
      } catch (_error) {
        toast.error("Erro na Exclusão", {
          description: "Não foi possível remover o ativo.",
        });
      }
    }
  };

  const categories = useMemo(() => {
    const cats = new Set(products?.map(p => p.category) || []);
    return ['all', ...Array.from(cats)];
  }, [products]);

  if (loading) {
    return (
      <div className="p-8 space-y-8 animate-in fade-in duration-500">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 rounded-2xl bg-white/5" />)}
        </div>
        <Skeleton className="h-[600px] w-full rounded-3xl bg-white/5" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--admin-bg)] py-6 sm:p-6 md:p-10 space-y-12 animate-in fade-in duration-1000">

      {/* Header & Main Actions */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-8 px-4 sm:px-0 pb-4 border-b border-white/5">
        <div className="space-y-2">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-admin-gold to-amber-600 flex items-center justify-center shadow-[0_0_30px_rgba(234,179,8,0.3)]">
              <Package className="text-black w-6 h-6 stroke-[2.5]" />
            </div>
            <h1 className="text-5xl font-black tracking-tighter leading-none">
              Gestão <span className="text-zinc-700 italic font-medium">Ativos</span>
            </h1>
          </div>
          <p className="text-[10px] font-bold text-[var(--admin-gold)] uppercase tracking-[0.3em] mt-1 opacity-80">
            Portfólio de Ativos e Controle Financeiro
          </p>
        </div>

        <div className="flex items-center gap-4 relative z-10">
          <Button
            className="bg-admin-gold text-white hover:bg-admin-gold/90 rounded-2xl h-14 px-10 font-black text-[10px] uppercase tracking-widest shadow-[0_10px_30px_rgba(234,179,8,0.2)] transition-all duration-500 hover:-translate-y-1 active:scale-95"
            onClick={() => onNavigate('admin-product-form')}
          >
            <Plus className="w-4 h-4 mr-3 stroke-[3]" /> Novo Produto
          </Button>
        </div>
      </div>

      {/* Financial Overview Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="admin-glass p-6 sm:p-8 sm:rounded-[2.5rem] border-y sm:border-x border-white/5 flex flex-col justify-between group hover:border-emerald-500/30 transition-all duration-500 relative overflow-hidden">
          <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-emerald-500/0 via-emerald-500/20 to-emerald-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex justify-between items-start relative z-10">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Wallet className="w-6 h-6 text-emerald-400" />
            </div>
            <div className="flex flex-col items-end">
              <ArrowUpRight className="w-4 h-4 text-zinc-600 group-hover:text-emerald-400 transition-colors" />
              <span className="text-[9px] font-black text-emerald-500/50 mt-1 uppercase tracking-tighter">Capital Líquido</span>
            </div>
          </div>
          <div className="mt-8 relative z-10">
            <p className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-2">Capital Alocado</p>
            <h3 className="admin-stat-value text-3xl">
              R$ {financialStats.invested.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </h3>
          </div>
        </div>

        <div className="admin-glass p-6 sm:p-8 sm:rounded-[2.5rem] border-y sm:border-x border-white/5 flex flex-col justify-between group hover:border-admin-gold/30 transition-all duration-500 relative overflow-hidden">
          <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-admin-gold/0 via-admin-gold/20 to-admin-gold/0 opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex justify-between items-start relative z-10">
            <div className="w-12 h-12 rounded-2xl bg-admin-gold/10 border border-admin-gold/20 flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-admin-gold" />
            </div>
            <div className="flex flex-col items-end">
              <TrendingUp className="w-4 h-4 text-zinc-600 group-hover:text-admin-gold transition-colors" />
              <span className="text-[9px] font-black text-admin-gold/50 mt-1 uppercase tracking-tighter">Margem Bruta</span>
            </div>
          </div>
          <div className="mt-8 relative z-10">
            <p className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-2">Lucro Potencial</p>
            <h3 className="admin-stat-value text-3xl">
              R$ {financialStats.potential.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </h3>
          </div>
        </div>

        <div className="admin-glass p-6 sm:p-8 sm:rounded-[2.5rem] border-y sm:border-x border-white/5 flex flex-col justify-between group hover:border-blue-500/30 transition-all duration-500 relative overflow-hidden">
          <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-blue-500/0 via-blue-500/20 to-blue-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex justify-between items-start relative z-10">
            <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <DollarSign className="w-6 h-6 text-blue-400" />
            </div>
            <div className="flex flex-col items-end">
              <ArrowUpRight className="w-4 h-4 text-zinc-600 group-hover:text-blue-400 transition-colors" />
              <span className="text-[9px] font-black text-blue-500/50 mt-1 uppercase tracking-tighter">Rendimento %</span>
            </div>
          </div>
          <div className="mt-8 relative z-10">
            <p className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-2">ROI do Portfólio</p>
            <h3 className="admin-stat-value text-3xl">
              {financialStats.avgRoi.toFixed(2)}%
            </h3>
          </div>
        </div>

        <div className="admin-glass p-6 sm:p-8 sm:rounded-[2.5rem] border-y sm:border-x border-white/5 flex flex-col justify-between group hover:border-purple-500/30 transition-all duration-500 relative overflow-hidden">
          <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-purple-500/0 via-purple-500/20 to-purple-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex justify-between items-start relative z-10">
            <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <Package className="w-6 h-6 text-purple-400" />
            </div>
            <div className="flex flex-col items-end">
              <LayoutGrid className="w-4 h-4 text-zinc-600 group-hover:text-purple-400 transition-colors" />
              <span className="text-[9px] font-black text-purple-500/50 mt-1 uppercase tracking-tighter">Slots Ativos</span>
            </div>
          </div>
          <div className="mt-8 relative z-10">
            <p className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-2">Ativos em Operação</p>
            <h3 className="admin-stat-value text-3xl">
              {financialStats.activeCount} <span className="text-sm text-zinc-700 font-medium">/ {financialStats.totalCount}</span>
            </h3>
          </div>
        </div>
      </div>

      {/* Control Bar */}
      <div className="admin-glass p-6 sm:rounded-[2rem] border-y sm:border-x border-white/5 flex flex-col md:flex-row gap-6 items-center justify-between shadow-2xl">
        <div className="relative w-full md:max-w-xl group">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600 group-focus-within:text-admin-gold transition-colors" />
          <label htmlFor="search-assets" className="sr-only">Buscar ativos</label>
          <Input
            id="search-assets"
            name="search-assets"
            placeholder="Buscar por nome ou ID do ativo..."
            className="bg-black/40 border-white/5 text-white pl-14 h-14 rounded-2xl focus:ring-admin-gold/20 focus:border-admin-gold/30 transition-all placeholder:text-zinc-700 font-bold text-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-4 w-full md:w-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="admin-glass border-white/10 text-zinc-400 h-14 px-6 rounded-2xl hover:text-white transition-all font-black text-[10px] uppercase tracking-widest">
                <Filter className="w-4 h-4 mr-3" />
                {filterCategory === 'all' ? 'Filtrar Categoria' : filterCategory}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-zinc-950 border-white/10 p-2 rounded-2xl backdrop-blur-3xl">
              {categories.map(cat => (
                <DropdownMenuItem
                  key={cat}
                  onClick={() => setFilterCategory(cat)}
                  className="capitalize text-zinc-400 focus:text-white focus:bg-white/5 rounded-xl px-4 py-3 cursor-pointer transition-all font-bold text-xs mb-1 last:mb-0"
                >
                  {cat === 'all' ? 'Todas as Categorias' : cat}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Grid view of Products as Assets */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 pb-10">
        {filteredProducts?.map((product) => {
          const margin = product.price > 0 ? ((product.price - (product.costPrice || 0)) / product.price) * 100 : 0;
          const roi = (product.costPrice || 0) > 0 ? ((product.price - (product.costPrice || 0)) / (product.costPrice || 0)) * 100 : 0;
          const invested = (product.costPrice || 0) * product.stock;
          const totalProfit = ((product.price || 0) * product.stock) - invested;

          return (
            <div
              key={product.id}
              className="group relative"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-admin-gold to-transparent rounded-[2.5rem] blur-2xl opacity-0 group-hover:opacity-5 transition-opacity duration-700" />

              <div className="relative admin-glass sm:rounded-[2.5rem] border-y sm:border-x border-white/5 overflow-hidden group-hover:border-white/10 transition-all duration-500 flex flex-col h-full shadow-[0_20px_50px_rgba(0,0,0,0.3)]">

                {/* Header Action Overlay */}
                <div className="absolute right-4 top-4 z-20">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-10 w-10 bg-black/40 backdrop-blur-md border border-white/5 text-zinc-500 hover:text-white hover:bg-black/60 rounded-xl p-0 transition-all">
                        <MoreVertical className="w-5 h-5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="bg-zinc-950 border-white/10 p-2 rounded-2xl backdrop-blur-3xl min-w-[180px]">
                      <DropdownMenuItem onClick={() => onNavigate('admin-product-form', product.id)} className="cursor-pointer focus:bg-white/5 text-zinc-400 focus:text-white rounded-xl px-4 py-3 transition-colors font-bold text-xs mb-1">
                        <Edit2 className="w-4 h-4 mr-3 text-admin-gold" /> Editar Asset
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toggleProductStatus(product.id, product.isActive)} className="cursor-pointer focus:bg-white/5 text-zinc-400 focus:text-white rounded-xl px-4 py-3 transition-colors font-bold text-xs mb-1">
                        <Eye className="w-4 h-4 mr-3 text-blue-400" /> {product.isActive ? 'Pausar Ativo' : 'Ativar Stock'}
                      </DropdownMenuItem>
                      <DropdownMenuItem className="cursor-pointer focus:bg-white/5 text-zinc-400 focus:text-white rounded-xl px-4 py-3 transition-colors font-bold text-xs mb-1">
                        <Copy className="w-4 h-4 mr-3 text-purple-400" /> Duplicar Asset
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDelete(product.id)} className="cursor-pointer focus:bg-rose-500/10 text-zinc-400 focus:text-rose-500 rounded-xl px-4 py-3 transition-colors font-bold text-xs">
                        <Trash2 className="w-4 h-4 mr-3" /> Encerrar Ativo
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Main Content */}
                <div className="p-8 space-y-8 h-full flex flex-col">
                  {/* Visual Identity */}
                  <div className="flex gap-6 items-start">
                    <div className="w-24 h-24 rounded-3xl overflow-hidden bg-zinc-900 border border-white/5 flex-shrink-0 relative group-hover:scale-105 transition-transform duration-700 shadow-2xl">
                      <img
                        src={product.images[0] || 'https://via.placeholder.com/150'}
                        alt={product.name}
                        className="w-full h-full object-cover transition-all duration-700"
                      />
                      {!product.isActive && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-sm">
                          <Eye className="w-6 h-6 text-white/20" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 pt-2">
                      <h4 className="text-xl font-black text-white truncate group-hover:text-admin-gold transition-colors leading-[1.2]">{product.name}</h4>
                      <p className="text-[10px] text-zinc-600 mt-2 font-black uppercase tracking-[0.2em]">{product.category}</p>
                      <div className="flex flex-wrap gap-2 mt-4">
                        <Badge className={`${product.isActive ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-zinc-800 text-zinc-500 border-white/5'} text-[8px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border backdrop-blur-md transition-all`}>
                          {product.isActive ? 'Em Operação' : 'Offline'}
                        </Badge>
                        {product.costPrice !== undefined && product.costPrice <= 0.1 && (
                          <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[8px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border backdrop-blur-md animate-pulse">
                            Custo Suspeito
                          </Badge>
                        )}
                        {product.stock <= 5 && (
                          <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[8px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border animate-pulse shadow-[0_0_15px_rgba(234,179,8,0.2)]">
                            Crítico
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Operational Metrics Grid */}
                  <div className="grid grid-cols-2 gap-3 pt-6 border-t border-white/5">
                    <div className="p-4 bg-zinc-900/50 rounded-2xl border border-white/5 group-hover:border-white/10 transition-colors">
                      <p className="text-[8px] text-zinc-600 uppercase font-black tracking-[0.2em] mb-2">Margem de Lucro</p>
                      <div className="flex items-center justify-between">
                        <span className={`text-lg font-black tracking-tighter ${margin >= 40 ? 'text-emerald-500' : margin >= 20 ? 'text-admin-gold' : 'text-rose-500'}`}>
                          {margin.toFixed(1)}%
                        </span>
                        <div className={cn(
                          "w-6 h-6 rounded-lg flex items-center justify-center border",
                          margin >= 20 ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" : "bg-rose-500/10 border-rose-500/20 text-rose-500"
                        )}>
                          <TrendingUp className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    </div>
                    <div className="p-4 bg-zinc-900/50 rounded-2xl border border-white/5 group-hover:border-white/10 transition-colors">
                      <p className="text-[8px] text-zinc-600 uppercase font-black tracking-[0.2em] mb-2">ROI de Rendimento</p>
                      <div className="flex items-center justify-between">
                        <span className={`text-lg font-black tracking-tighter ${roi >= 100 ? 'text-emerald-500' : roi >= 50 ? 'text-admin-gold' : 'text-rose-500'}`}>
                          {roi.toFixed(1)}%
                        </span>
                        <div className="w-6 h-6 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center">
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Inventory Specs */}
                  <div className="space-y-4 pt-2 flex-1">
                    <div className="flex justify-between items-center group/spec">
                      <span className="text-[10px] font-bold text-zinc-700 uppercase tracking-widest group-hover/spec:text-zinc-500 transition-colors">Unidades em Estoque</span>
                      <div className="flex items-center gap-2">
                        <div className="w-12 h-1 bg-zinc-900 rounded-full overflow-hidden">
                          <div
                            className={cn("h-full transition-all duration-1000", product.stock <= 5 ? "bg-rose-500" : "bg-admin-gold")}
                            style={{ width: `${Math.min(product.stock * 5, 100)}%` }}
                          />
                        </div>
                        <span className={cn("text-xs font-black font-mono", product.stock <= 5 ? "text-rose-500" : "text-white")}>
                          {product.stock.toString().padStart(2, '0')}
                        </span>
                      </div>
                    </div>

                    <div className="flex justify-between items-center group/spec">
                      <span className="text-[10px] font-bold text-zinc-700 uppercase tracking-widest group-hover/spec:text-zinc-500 transition-colors">Capital Alocado</span>
                      <span className="font-mono text-xs font-bold text-zinc-400">R$ {invested.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                    </div>

                    <div className="flex justify-between items-end pt-6 border-t border-white/5 mt-auto">
                      <div className="space-y-1">
                        <p className="text-[8px] font-black text-admin-gold uppercase tracking-[0.3em]">Valor de Mercado</p>
                        <h4 className="text-3xl font-black text-white tracking-tighter">
                          R$ {product.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </h4>
                      </div>
                      <div className="text-right space-y-1">
                        <p className="text-[8px] font-black text-emerald-500 uppercase tracking-[0.3em]">Potencial</p>
                        <p className="text-sm font-black text-white/80 tracking-tight">
                          + R$ {totalProfit.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer Gradient Strip */}
                <div className="h-1.5 w-full bg-gradient-to-r from-zinc-900 via-admin-gold/20 to-zinc-900 group-hover:via-admin-gold/50 transition-all duration-1000" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty State */}
      {filteredProducts?.length === 0 && (
        <div className="admin-glass p-32 rounded-[3rem] border border-white/5 flex flex-col items-center justify-center text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-admin-gold/5 animate-pulse" />
          <div className="p-8 bg-zinc-900 border border-white/5 rounded-[2rem] mb-8 shadow-2xl relative z-10">
            <Search className="w-16 h-16 text-zinc-800" />
          </div>
          <h3 className="text-xl font-black text-white uppercase italic tracking-tighter mb-2">Nenhum Registro Detectado</h3>
          <p className="text-sm font-medium text-zinc-500 uppercase tracking-widest max-w-xs mx-auto mb-8">O sistema de inteligência não localizou ativos para os parâmetros definidos.</p>
          <Button
            variant="outline"
            onClick={() => { setSearchTerm(''); setFilterCategory('all'); }}
            className="bg-black/40 border-white/5 text-[10px] font-black uppercase tracking-[0.2em] rounded-2xl px-10 h-14 hover:bg-[var(--admin-gold)] hover:text-black transition-all"
          >
            Resetar Filtros Mestres
          </Button>
        </div>
      )}
    </div>

  );
};

export default AdminProductsView;
