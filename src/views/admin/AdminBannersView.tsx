import { useState, useMemo, type ChangeEvent, memo, useRef, useEffect } from 'react';
import { LazyImage } from '@/components/LazyImage';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, ArrowLeft, Upload, ArrowUp, ArrowDown, Layout, Sparkles, Eye, Zap, Trash, Edit, ExternalLink, HelpCircle, Smartphone, SlidersHorizontal, Loader2 } from 'lucide-react';
import { motion, type Variants } from 'framer-motion';
import { useBanners } from '@/hooks/useBanners';
import type { Banner, View } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LocalBufferedInput } from '@/components/admin/LocalBufferedInput';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { AdminKpiCarousel, type KpiCardConfig } from '@/components/admin/AdminKpiCarousel';
import { ImageAdjuster } from '@/components/ui/custom/ImageAdjuster';
import { Skeleton } from '@/components/ui/skeleton';

interface AdminBannersViewProps {
    onNavigate: (view: View) => void;
    active?: boolean;
    onSetDirty?: (dirty: boolean) => void;
}

const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.05 } }
};

const itemVariants: Variants = {
    hidden: { opacity: 0, y: 15, scale: 0.98 },
    visible: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 120, damping: 14 } }
};

export const AdminBannersView = memo(function AdminBannersView({ onNavigate, active = true, onSetDirty }: AdminBannersViewProps) {
    const { banners, isLoaded, uploadBannerImage, addBanner, updateBanner, deleteBanner, reorderBanners, refreshBanners } = useBanners(true);
    const isOffline = useOnlineStatus();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [showHelpModal, setShowHelpModal] = useState(false);
    const [editingBanner, setEditingBanner] = useState<Banner | null>(null);
    const [uploading, setUploading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedTab, setSelectedTab] = useState<'all' | 'home_top' | 'home_middle' | 'home_bottom'>('all');
    const [bannerToDelete, setBannerToDelete] = useState<{ id: string; imageUrl: string } | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [activeAction, setActiveAction] = useState<{ id: string; type: 'up' | 'down' | 'toggle' | 'delete' } | null>(null);

    // Auto-refresh when coming back online
    const wasOfflineRef = useRef(isOffline);
    useEffect(() => {
        if (wasOfflineRef.current && !isOffline && active) {
            toast.success('Conexão restabelecida. Atualizando banners...', {
                icon: '⚡'
            });
            refreshBanners(false, true);
        }
        wasOfflineRef.current = isOffline;
    }, [isOffline, active, refreshBanners]);

    // Image Adjuster integration
    const [isAdjusterOpen, setIsAdjusterOpen] = useState(false);
    const [adjustingImgUrl, setAdjustingImgUrl] = useState('');
    const [isUploadingAdjusted, setIsUploadingAdjusted] = useState(false);

    const openAdjuster = (url: string) => {
        setAdjustingImgUrl(url);
        setIsAdjusterOpen(true);
    };

    const handleAdjustConfirm = async (croppedBlob: Blob) => {
        if (isOffline) {
            toast.error('Sem conexão com a internet', {
                description: 'Você precisa estar online para salvar a imagem ajustada.'
            });
            return;
        }
        setIsUploadingAdjusted(true);
        const file = new File([croppedBlob], `banner-image-${Date.now()}.jpg`, { type: 'image/jpeg' });
        const loadingToast = toast.loading('Enviando imagem recortada...');
        try {
            const url = await uploadBannerImage(file);
            setFormData(prev => ({ ...prev, imageUrl: url }));
            toast.success('Imagem ajustada com sucesso!', { id: loadingToast });
            setIsAdjusterOpen(false);
        } catch (error) {
            console.error('Error uploading adjusted banner image:', error);
            toast.error('Erro ao salvar imagem ajustada', { id: loadingToast });
        } finally {
            setIsUploadingAdjusted(false);
        }
    };
    


    const [formData, setFormData] = useState<Partial<Banner>>({
        title: '',
        imageUrl: '',
        link: '',
        position: 'home_top',
        active: true,
        order: 0
    });

    // Controlar estado dirty do formulário para evitar descarte involuntário
    useEffect(() => {
        if (!onSetDirty) return;
        if (!isDialogOpen) {
            onSetDirty(false);
            return;
        }

        const defaultPosition = editingBanner?.position || (selectedTab !== 'all' ? selectedTab : 'home_top');
        const defaultOrder = banners.filter(b => b.position === defaultPosition).length + 1;

        const initial = editingBanner || {
            title: '',
            imageUrl: '',
            link: '',
            position: defaultPosition,
            active: true,
            order: defaultOrder
        };

        const isDirty =
            (formData.title || '') !== (initial.title || '') ||
            (formData.imageUrl || '') !== (initial.imageUrl || '') ||
            (formData.link || '') !== (initial.link || '') ||
            formData.position !== initial.position ||
            formData.active !== initial.active ||
            Number(formData.order) !== Number(initial.order);

        onSetDirty(isDirty);
    }, [isDialogOpen, formData, editingBanner, banners, selectedTab, onSetDirty]);

    const handleBack = () => onNavigate('admin-settings');

    const handleOpenDialog = (banner?: Banner) => {
        if (banner && banner.id) {
            setEditingBanner(banner);
            setFormData({ ...banner });
        } else {
            setEditingBanner(null);
            const defaultPosition = banner?.position || (selectedTab !== 'all' ? selectedTab : 'home_top');
            setFormData({
                title: '',
                imageUrl: '',
                link: '',
                position: defaultPosition,
                active: true,
                order: banners.filter(b => b.position === defaultPosition).length + 1
            });
        }
        setIsDialogOpen(true);
    };

    const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
        if (isOffline) {
            toast.error('Sem conexão com a internet', {
                description: 'Você precisa estar online para fazer o upload de imagens.'
            });
            return;
        }
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        try {
            const url = await uploadBannerImage(file);
            setFormData(prev => ({ ...prev, imageUrl: url }));
            toast.success('Imagem enviada com sucesso');
        } catch {
            toast.error('Erro ao enviar imagem');
        } finally {
            setUploading(false);
        }
    };

    const handleSubmit = async () => {
        if (isOffline) {
            toast.error('Sem conexão com a internet', {
                description: 'Você precisa estar online para salvar as alterações do banner.'
            });
            return;
        }
        if (isSubmitting) return;
        setIsSubmitting(true);
        try {
            if (!formData.imageUrl) {
                toast.error('Imagem é obrigatória');
                setIsSubmitting(false);
                return;
            }

            let sanitizedLink = formData.link ? formData.link.trim() : '';
            if (sanitizedLink && !sanitizedLink.startsWith('/') && !sanitizedLink.startsWith('http://') && !sanitizedLink.startsWith('https://')) {
                sanitizedLink = '/' + sanitizedLink;
            }

            const dataToSubmit = {
                ...formData,
                link: sanitizedLink
            };

            if (editingBanner) {
                await updateBanner(editingBanner.id, dataToSubmit);
            } else {
                await addBanner(dataToSubmit as Required<Omit<Banner, 'id'>>);
            }
            await refreshBanners(false, true);
            setIsDialogOpen(false);
        } catch (error) {
            console.error('Erro ao salvar banner:', error);
            toast.error('Erro ao salvar as configurações do banner.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = (id: string, imageUrl: string) => {
        if (isOffline) {
            toast.error('Sem conexão com a internet', {
                description: 'Você precisa estar online para excluir banners.'
            });
            return;
        }
        setBannerToDelete({ id, imageUrl });
    };

    const confirmDeleteBanner = async () => {
        if (!bannerToDelete) return;
        setIsProcessing(true);
        setActiveAction({ id: bannerToDelete.id, type: 'delete' });
        try {
            await deleteBanner(bannerToDelete.id, bannerToDelete.imageUrl);
            await refreshBanners(false, true);
        } catch (error) {
            console.error('Erro ao deletar banner:', error);
            toast.error('Erro ao deletar o banner.');
        } finally {
            setIsProcessing(false);
            setActiveAction(null);
            setBannerToDelete(null);
        }
    };

    const handleToggleActive = async (banner: Banner) => {
        if (isOffline) {
            toast.error('Sem conexão com a internet', {
                description: 'Você precisa estar online para alternar a visibilidade do banner.'
            });
            return;
        }
        setIsProcessing(true);
        setActiveAction({ id: banner.id, type: 'toggle' });
        try {
            await updateBanner(banner.id, { active: !banner.active });
            await refreshBanners(false, true);
        } catch (error) {
            console.error('Erro ao alternar status do banner:', error);
        } finally {
            setIsProcessing(false);
            setActiveAction(null);
        }
    };

    const moveBanner = async (banner: Banner, direction: 'up' | 'down') => {
        if (isOffline) {
            toast.error('Sem conexão com a internet', {
                description: 'Você precisa estar online para alterar a ordem dos banners.'
            });
            return;
        }
        const bannersInPosition = banners
            .filter(b => b.position === banner.position)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        const currentIndex = bannersInPosition.findIndex(b => b.id === banner.id);
        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

        if (targetIndex >= 0 && targetIndex < bannersInPosition.length) {
            const targetBanner = bannersInPosition[targetIndex];
            setIsProcessing(true);
            setActiveAction({ id: banner.id, type: direction });
            try {
                await reorderBanners(banner.id, targetBanner.id);
                await refreshBanners(false, true);
            } catch (error) {
                console.error('Erro ao reordenar banners:', error);
                toast.error('Erro ao reordenar banners.');
            } finally {
                setIsProcessing(false);
                setActiveAction(null);
            }
        }
    };

    const positions = [
        { value: 'home_top', label: 'Cabeçalho Inicial (Topo)' },
        { value: 'home_middle', label: 'Seção Intermediária (Meio)' },
        { value: 'home_bottom', label: 'Rodapé da Página (Base)' }
    ];

    // Compute Metrics
    const totalBanners = banners.length;
    const activeBanners = banners.filter(b => b.active).length;
    const topActive = banners.some(b => b.position === 'home_top' && b.active);
    const middleActive = banners.some(b => b.position === 'home_middle' && b.active);
    const bottomActive = banners.some(b => b.position === 'home_bottom' && b.active);
    const activeSectionsCount = [topActive, middleActive, bottomActive].filter(Boolean).length;
    const impactText = activeSectionsCount === 3 ? 'Máximo' : activeSectionsCount === 2 ? 'Alto' : activeSectionsCount === 1 ? 'Moderado' : 'Nenhum';

    const visiblePositions = selectedTab === 'all' 
        ? positions 
        : positions.filter(pos => pos.value === selectedTab);

    const kpiCards = useMemo<readonly KpiCardConfig[]>(() => [
        {
            id: 'ativos',
            label: 'Banners Ativos',
            icon: Eye,
            iconClass: "text-[#FFBF00] animate-pulse",
            iconBg: "bg-amber-500/10 border-amber-500/20",
            hoverBorder: "hover:border-[#FFBF00]/30 hover:shadow-[0_0_30px_rgba(255,191,0,0.05)]",
            value: activeBanners,
            accent: 'text-[#FFBF00]',
            subValue: `/ ${totalBanners} total`,
            footer: "Banners atualmente visíveis no app"
        },
        {
            id: 'distribuicao',
            label: 'Distribuição',
            icon: Layout,
            iconClass: "text-amber-500",
            iconBg: "bg-zinc-900 border-white/5",
            hoverBorder: "hover:border-amber-500/30 hover:shadow-[0_0_30px_rgba(245,158,11,0.05)]",
            value: `${banners.filter(b => b.position === 'home_top').length} Topo`,
            accent: 'text-amber-500',
            subValue: `Meio: ${banners.filter(b => b.position === 'home_middle').length} • Base: ${banners.filter(b => b.position === 'home_bottom').length}`,
            footer: "Posicionamento na Home"
        },
        {
            id: 'impacto',
            label: 'Impacto Estético',
            icon: Sparkles,
            iconClass: "text-[#FFBF00]",
            iconBg: "bg-[#FFBF00]/10 border-[#FFBF00]/20",
            hoverBorder: "hover:border-[#FFBF00]/30 hover:shadow-[0_0_30px_rgba(255,191,0,0.05)]",
            value: impactText,
            accent: 'text-[#FFBF00]',
            footer: "Preenchimento das seções"
        }
    ], [activeBanners, totalBanners, banners, impactText]);

    const renderSkeleton = () => (
        <div className="space-y-16 animate-pulse select-none">
            {visiblePositions.map((pos) => (
                <div key={pos.value} className="space-y-6">
                    {selectedTab === 'all' && (
                        <div className="flex items-center justify-between border-b border-white/5 pb-4 px-2">
                            <div className="flex items-center gap-3">
                                <Skeleton className="w-3.5 h-3.5 rounded-full bg-white/5" />
                                <Skeleton className="h-4.5 w-32 bg-white/5 rounded" />
                            </div>
                            <Skeleton className="h-3 w-16 bg-white/5 rounded" />
                        </div>
                    )}
                    <div className="grid gap-6">
                        {[1, 2].map((i) => (
                            <div key={i} className="bg-zinc-950/30 border border-white/5 rounded-[2.5rem] p-4 sm:p-5 h-[230px] sm:h-[180px] lg:h-[230px] xl:h-[180px] flex flex-col lg:flex-row gap-6 items-center">
                                <Skeleton className="w-full lg:w-[380px] xl:w-[440px] aspect-[21/9] rounded-2xl bg-white/5 shrink-0" />
                                <div className="flex-1 space-y-4 w-full">
                                    <div className="flex justify-between items-start gap-4">
                                        <div className="space-y-2 flex-1">
                                            <Skeleton className="h-5 w-1/2 bg-white/5 rounded" />
                                            <div className="flex gap-2">
                                                <Skeleton className="h-4.5 w-16 bg-white/5 rounded" />
                                                <Skeleton className="h-4.5 w-16 bg-white/5 rounded" />
                                            </div>
                                        </div>
                                        <Skeleton className="w-16 h-8 bg-white/5 rounded" />
                                    </div>
                                    <div className="h-px bg-white/5 w-full" />
                                    <div className="flex gap-3">
                                        <Skeleton className="h-9 flex-1 bg-white/5 rounded-xl" />
                                        <Skeleton className="h-9 w-20 bg-white/5 rounded-xl" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );

    return (
        <div className="h-auto bg-[#09090b] text-zinc-400 font-sans selection:bg-admin-gold/30 selection:text-white pb-8 relative overflow-x-hidden">
            {/* Ambient subtle glow */}
            <div className="absolute top-0 left-1/4 w-[400px] h-[400px] bg-admin-gold/5 blur-[120px] rounded-full pointer-events-none" />
            <div className="absolute top-1/3 right-1/4 w-[500px] h-[500px] bg-amber-500/5 blur-[150px] rounded-full pointer-events-none" />

            {/* Sticky Compact Header */}
            <div className="sticky top-0 z-40 p-4 pb-0">
                <div className="admin-glass rounded-[2rem] border border-white/5 p-4 sm:p-5 shadow-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={handleBack}
                            className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl transition-colors group active:scale-95"
                            title="Voltar ao Painel"
                        >
                            <ArrowLeft className="w-5 h-5 text-zinc-400 group-hover:text-white transition-colors" />
                        </button>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-lg font-black text-white tracking-tight flex items-center gap-2 uppercase select-none">
                                    <span className="bg-gradient-to-r from-[#FFBF00] to-amber-500 bg-clip-text text-transparent italic font-extrabold">GERENCIADOR VISUAL</span>
                                    <button
                                        type="button"
                                        onClick={() => setShowHelpModal(true)}
                                        className="w-6 h-6 rounded-full flex items-center justify-center border transition-all duration-300 active:scale-95 bg-zinc-900/60 border-white/5 text-zinc-500 hover:text-white hover:border-white/10 shrink-0"
                                        title="Guia do Gerenciador de Banners"
                                    >
                                        <HelpCircle className="w-3.5 h-3.5" />
                                    </button>
                                </h1>
                            </div>
                            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.18em] flex items-center gap-1.5 mt-0.5 select-none">
                                Curadoria de Banners Premium
                                <span className="w-1 h-1 rounded-full bg-admin-gold/70 animate-pulse" />
                                <span className="text-amber-500/80">Estética PWA</span>
                            </p>
                        </div>
                    </div>

                    {isLoaded && banners.length > 0 && (
                        <button
                            onClick={() => handleOpenDialog()}
                            disabled={isOffline}
                            className="flex items-center justify-center gap-2 px-5 py-2.5 bg-[#FFBF00] hover:bg-amber-500 text-black rounded-xl text-[9px] font-black uppercase tracking-wider hover:scale-[1.02] transition-all active:scale-95 shadow-lg shadow-amber-500/10 border border-amber-400/20 w-full sm:w-auto disabled:opacity-50 disabled:grayscale disabled:pointer-events-none"
                        >
                            <Plus className="w-3.5 h-3.5 stroke-[3px]" /> Novo Banner
                        </button>
                    )}
                </div>
            </div>

            <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-8 relative z-10">
                {/* Stats Carousel Row */}
                {isLoaded && banners.length > 0 && (
                    <div className="space-y-4">
                        <AdminKpiCarousel cards={kpiCards} active={active} title="Métricas Visuais" />
                    </div>
                )}

                {/* Filter Tabs & Options */}
                {isLoaded && banners.length > 0 && (
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-white/5 select-none">
                        <div className="flex flex-wrap p-1 bg-zinc-950 rounded-2xl border border-white/5 relative">
                            <button
                                onClick={() => setSelectedTab('all')}
                                className={cn(
                                    "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-300 relative",
                                    selectedTab === 'all' ? "text-black" : "text-zinc-500 hover:text-zinc-300"
                                )}
                            >
                                <span className="relative z-10">Todos</span>
                                {selectedTab === 'all' && (
                                    <motion.div
                                        layoutId="activeBannerTab"
                                        className="absolute inset-0 bg-gradient-to-r from-[#FFBF00] to-amber-500 rounded-xl shadow-md"
                                        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                                    />
                                )}
                            </button>
                            <button
                                onClick={() => setSelectedTab('home_top')}
                                className={cn(
                                    "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-300 relative",
                                    selectedTab === 'home_top' ? "text-black" : "text-zinc-500 hover:text-zinc-300"
                                )}
                            >
                                <span className="relative z-10">Topo</span>
                                {selectedTab === 'home_top' && (
                                    <motion.div
                                        layoutId="activeBannerTab"
                                        className="absolute inset-0 bg-gradient-to-r from-[#FFBF00] to-amber-500 rounded-xl shadow-md"
                                        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                                    />
                                )}
                            </button>
                            <button
                                onClick={() => setSelectedTab('home_middle')}
                                className={cn(
                                    "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-300 relative",
                                    selectedTab === 'home_middle' ? "text-black" : "text-zinc-500 hover:text-zinc-300"
                                )}
                            >
                                <span className="relative z-10">Meio</span>
                                {selectedTab === 'home_middle' && (
                                    <motion.div
                                        layoutId="activeBannerTab"
                                        className="absolute inset-0 bg-gradient-to-r from-[#FFBF00] to-amber-500 rounded-xl shadow-md"
                                        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                                    />
                                )}
                            </button>
                            <button
                                onClick={() => setSelectedTab('home_bottom')}
                                className={cn(
                                    "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-300 relative",
                                    selectedTab === 'home_bottom' ? "text-black" : "text-zinc-500 hover:text-zinc-300"
                                )}
                            >
                                <span className="relative z-10">Base</span>
                                {selectedTab === 'home_bottom' && (
                                    <motion.div
                                        layoutId="activeBannerTab"
                                        className="absolute inset-0 bg-gradient-to-r from-[#FFBF00] to-amber-500 rounded-xl shadow-md"
                                        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                                    />
                                )}
                            </button>
                        </div>
                        
                        <div className="flex items-center gap-2 text-[9px] font-bold text-zinc-500 uppercase tracking-widest">
                            <SlidersHorizontal className="w-3.5 h-3.5 text-amber-500" />
                            <span>Visualizando: {selectedTab === 'all' ? 'Todos os setores' : positions.find(p => p.value === selectedTab)?.label}</span>
                        </div>
                    </div>
                )}

                {/* Banner Content List */}
                {(!isLoaded && banners.length === 0) ? (
                    <div className="py-6">
                        {renderSkeleton()}
                    </div>
                ) : (
                    <motion.div
                        variants={containerVariants}
                        initial="hidden"
                        animate="visible"
                        className="space-y-16"
                    >
                        {visiblePositions.map((pos) => {
                            const positionBanners = banners.filter(b => b.position === pos.value).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

                            return (
                                <div key={pos.value} className="space-y-6">
                                    {selectedTab === 'all' && (
                                        <div className="flex items-center justify-between border-b border-white/5 pb-4 px-2 select-none">
                                            <div className="flex items-center gap-3">
                                                <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-br from-[#FFBF00] to-amber-500 shadow-[0_0_10px_rgba(255,191,0,0.5)] animate-pulse" />
                                                <h2 className="text-xs font-black text-white uppercase tracking-widest italic">{pos.label}</h2>
                                            </div>
                                            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">
                                                {positionBanners.length} {positionBanners.length === 1 ? 'Banner' : 'Banners'}
                                            </span>
                                        </div>
                                    )}

                                    {positionBanners.length === 0 ? (
                                        <div className="bg-zinc-950/20 p-12 rounded-[2.5rem] border border-dashed border-white/5 backdrop-blur-sm text-center flex flex-col items-center justify-center group/empty hover:border-zinc-800 transition-all duration-300">
                                            <Layout className="w-8 h-8 text-zinc-700 mb-3 group-hover/empty:text-zinc-500 transition-colors" />
                                            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Nenhum Banner cadastrado neste Setor</p>
                                            <button
                                                onClick={() => handleOpenDialog({ position: pos.value } as Banner)}
                                                disabled={isOffline}
                                                className="text-[10px] font-black text-[#FFBF00] hover:text-white uppercase tracking-widest underline transition-colors disabled:opacity-50 disabled:grayscale disabled:pointer-events-none"
                                            >
                                                + Adicionar Primeiro Banner
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="grid gap-6">
                                            {positionBanners.map((banner, index) => (
                                                <motion.div
                                                    key={banner.id}
                                                    variants={itemVariants}
                                                    className={cn(
                                                        "group relative bg-zinc-950/30 backdrop-blur-md border border-white/5 rounded-[2.5rem] p-4 sm:p-5 transition-all duration-500 hover:border-zinc-800 hover:bg-zinc-950/50 hover:shadow-2xl",
                                                        !banner.active && "opacity-50"
                                                    )}
                                                >
                                                    <div className="flex flex-col lg:flex-row gap-6 items-center w-full">
                                                        {/* Image Preview Card */}
                                                        <div className="relative w-full lg:w-[380px] xl:w-[440px] aspect-[21/9] rounded-2xl overflow-hidden border border-white/5 shadow-2xl bg-zinc-900 group-hover:scale-[1.01] transition-all duration-500 shrink-0">
                                                            <LazyImage
                                                                src={banner.imageUrl}
                                                                alt={banner.title || 'Banner'}
                                                                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                                                            />
                                                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-80" />
                                                            {!banner.active && (
                                                                <div className="absolute inset-0 bg-black/65 backdrop-blur-[2px] flex items-center justify-center text-[10px] font-black uppercase tracking-[0.4em] text-white/70 italic text-center px-4">
                                                                    Exibição Suspensa
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* Details and Controls Panel */}
                                                        <div className="flex-1 space-y-4 w-full relative z-10 min-w-0">
                                                            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                                                                <div className="min-w-0 w-full space-y-1">
                                                                    <h3 className="text-base sm:text-lg font-bold text-white tracking-tight leading-snug truncate w-full group-hover:text-admin-gold transition-colors duration-300">
                                                                        {banner.title || 'Campanha sem Título'}
                                                                    </h3>
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="px-2 py-0.5 bg-zinc-900 border border-white/5 rounded-md shrink-0">
                                                                            <p className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">
                                                                                Ordem: <span className="text-white font-mono">#{banner.order}</span>
                                                                            </p>
                                                                        </div>
                                                                        <div className="px-2 py-0.5 bg-zinc-900 border border-white/5 rounded-md shrink-0">
                                                                            <p className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">
                                                                                Setor: <span className="text-white font-mono">{pos.label.split(' ')[0]}</span>
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                
                                                                {/* Arrow Position Reordering pads */}
                                                                <div className="flex gap-1.5 shrink-0 self-start sm:self-center">
                                                                    <button
                                                                        onClick={() => moveBanner(banner, 'up')}
                                                                        disabled={index === 0 || isProcessing || isOffline}
                                                                        className="w-8 h-8 shrink-0 bg-zinc-900 border border-white/5 text-zinc-500 rounded-lg flex items-center justify-center hover:bg-zinc-800 hover:text-white disabled:opacity-10 disabled:pointer-events-none transition-all active:scale-95"
                                                                        title="Mover para cima"
                                                                    >
                                                                        {activeAction?.id === banner.id && activeAction?.type === 'up' ? (
                                                                            <Loader2 className="w-3.5 h-3.5 animate-spin text-admin-gold" />
                                                                        ) : (
                                                                            <ArrowUp className="w-4 h-4" />
                                                                        )}
                                                                    </button>
                                                                    <button
                                                                        onClick={() => moveBanner(banner, 'down')}
                                                                        disabled={index === positionBanners.length - 1 || isProcessing || isOffline}
                                                                        className="w-8 h-8 shrink-0 bg-zinc-900 border border-white/5 text-zinc-500 rounded-lg flex items-center justify-center hover:bg-zinc-800 hover:text-white disabled:opacity-10 disabled:pointer-events-none transition-all active:scale-95"
                                                                        title="Mover para baixo"
                                                                    >
                                                                        {activeAction?.id === banner.id && activeAction?.type === 'down' ? (
                                                                            <Loader2 className="w-3.5 h-3.5 animate-spin text-admin-gold" />
                                                                        ) : (
                                                                            <ArrowDown className="w-4 h-4" />
                                                                        )}
                                                                    </button>
                                                                </div>
                                                            </div>

                                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-3 border-y border-white/5 items-center">
                                                                <div className="px-3 py-1.5 bg-zinc-900/40 rounded-xl border border-white/5 text-[9px] font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-2 truncate max-w-full">
                                                                    <ExternalLink className="w-3.5 h-3.5 text-[#FFBF00] shrink-0" />
                                                                    <span>Link:</span>
                                                                    <span className="text-white font-mono truncate">{banner.link || 'Início (Sem Rota)'}</span>
                                                                </div>
                                                                
                                                                {/* Fast Status Switch Toggle directly in the card */}
                                                                <div className="flex items-center justify-between sm:justify-end gap-3 px-1">
                                                                    <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">
                                                                        Exibir no App
                                                                    </span>
                                                                    <Switch
                                                                        checked={banner.active}
                                                                        onCheckedChange={() => handleToggleActive(banner)}
                                                                        disabled={(activeAction?.id === banner.id && activeAction?.type === 'toggle') || isOffline}
                                                                        className="data-[state=checked]:bg-[#FFBF00]"
                                                                    />
                                                                </div>
                                                            </div>

                                                            <div className="flex items-center gap-3 pt-1">
                                                                <button
                                                                    onClick={() => handleOpenDialog(banner)}
                                                                    disabled={isProcessing || isOffline}
                                                                    className="flex-1 h-9 px-4 bg-zinc-900 hover:bg-zinc-800 border border-white/5 text-zinc-300 hover:text-white rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                                                                >
                                                                    <Edit className="w-3.5 h-3.5 shrink-0 text-[#FFBF00]" /> Editar
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDelete(banner.id, banner.imageUrl)}
                                                                    disabled={isProcessing || isOffline}
                                                                    className="h-9 px-4 bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white border border-red-500/20 hover:border-transparent rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                                                                >
                                                                    {activeAction?.id === banner.id && activeAction?.type === 'delete' ? (
                                                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                                    ) : (
                                                                        <Trash className="w-3.5 h-3.5 shrink-0" />
                                                                    )} Excluir
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </motion.div>
                )}
            </div>

            {/* Dialog de Cadastro / Edição */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="w-[95vw] sm:w-full sm:max-w-4xl bg-zinc-950 border-white/5 text-white p-0 overflow-x-hidden overflow-y-auto max-h-[90vh] rounded-[2rem] sm:rounded-[2.5rem] shadow-[0_0_80px_rgba(0,0,0,0.9)] mx-auto custom-scrollbar">
                    <div className="absolute -top-40 -right-40 w-80 h-80 bg-admin-gold/5 blur-[120px] rounded-full pointer-events-none" />
                    <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-[#FFBF00]/5 blur-[120px] rounded-full pointer-events-none" />

                    <div className="p-6 pb-24 sm:pb-12 sm:p-10 space-y-6 sm:space-y-8 relative z-10 w-full overflow-hidden">
                        <DialogHeader>
                            <DialogTitle className="text-lg sm:text-xl font-black text-white tracking-wider uppercase italic flex items-center gap-3 sm:gap-4 truncate">
                                <Sparkles className="w-6 h-6 sm:w-8 sm:h-8 text-[#FFBF00] shrink-0" />
                                <span className="truncate">{editingBanner ? 'Editar Banner' : 'Cadastrar Novo Banner'}</span>
                            </DialogTitle>
                            <DialogDescription className="text-zinc-500 font-bold uppercase text-[9px] sm:text-[10px] tracking-[0.2em] mt-2">
                                Configuração de Layout e Parâmetros de Exibição
                            </DialogDescription>
                        </DialogHeader>

                        {/* Two Columns: Left Form, Right Smartphone Simulator Mockup */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                            {/* Left Column: Form Controls */}
                            <div className="lg:col-span-7 space-y-5">
                                <div className="space-y-2">
                                    <div className="flex justify-between items-baseline select-none mb-1">
                                        <Label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1 italic opacity-85">Imagem do Banner</Label>
                                        <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">
                                            {formData.position === 'home_top' ? 'Recomendado: 4:1 (ex: 1200x300px)' : 'Recomendado: 21:9 (ex: 1200x500px)'}
                                        </span>
                                    </div>
                                    <div className="flex flex-col gap-6">
                                        {uploading ? (
                                            <div className="w-full h-40 flex flex-col items-center justify-center gap-4 bg-zinc-900/40 border border-white/5 rounded-2xl">
                                                <div className="w-8 h-8 border-2 border-zinc-700 border-t-[#FFBF00] rounded-full animate-spin" />
                                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Enviando Imagem...</span>
                                            </div>
                                        ) : formData.imageUrl ? (
                                            <div className="group relative w-full aspect-[21/9] rounded-2xl overflow-hidden border border-white/10 bg-zinc-900 shadow-2xl">
                                                <img src={formData.imageUrl} alt="Preview" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                                                <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                                                    <Label htmlFor="banner-upload" className="cursor-pointer px-4 py-2.5 bg-zinc-900 text-white border border-white/10 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-zinc-800 transition-all select-none">Alterar</Label>
                                                    <Button 
                                                        type="button" 
                                                        onClick={() => openAdjuster(formData.imageUrl!)}
                                                        className="px-4 py-2.5 bg-[#FFBF00] hover:bg-[#FFBF00]/90 text-black rounded-xl text-[9px] font-black uppercase tracking-widest transition-all select-none shadow-md active:scale-95 flex items-center gap-1.5 animate-in fade-in zoom-in-95 duration-200"
                                                    >
                                                        <SlidersHorizontal className="w-3.5 h-3.5" /> Ajustar
                                                    </Button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="relative">
                                                <Label htmlFor="banner-upload" className="cursor-pointer w-full h-40 flex flex-col items-center justify-center gap-4 bg-zinc-900/50 border-2 border-dashed border-white/5 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] text-zinc-600 hover:bg-zinc-900 hover:border-admin-gold/30 transition-all group">
                                                    <Upload className="w-10 h-10 group-hover:text-admin-gold transition-colors text-zinc-500" />
                                                    <span>Enviar Imagem Principal</span>
                                                </Label>
                                            </div>
                                        )}
                                        <Input id="banner-upload" type="file" accept="image/*" className="hidden" onChange={handleFileUpload} disabled={uploading} />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1 italic">Título da Campanha</Label>
                                    <LocalBufferedInput
                                        value={formData.title || ''}
                                        onFlush={(val) => setFormData(prev => ({ ...prev, title: val }))}
                                        placeholder="Ex: Coleção de Verão"
                                        useShadcn={true}
                                        className="h-12 bg-zinc-900/50 border-white/10 rounded-xl focus:ring-[#FFBF00] focus:border-[#FFBF00]/50 text-base font-bold text-white transition-all"
                                    />
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1 italic">Posição na Tela</Label>
                                        <Select
                                            value={formData.position}
                                            onValueChange={(value: any) => {
                                                const nextOrder = banners.filter(b => b.position === value).length + 1;
                                                setFormData(prev => ({ ...prev, position: value, order: nextOrder }));
                                            }}
                                        >
                                            <SelectTrigger className="h-12 bg-zinc-900/50 border-white/10 rounded-xl text-[10px] font-bold uppercase tracking-wider focus:ring-[#FFBF00]">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-zinc-950 border-white/10 text-white">
                                                {positions.map(pos => (
                                                    <SelectItem key={pos.value} value={pos.value} className="font-bold uppercase tracking-wider text-[9px]">{pos.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1 italic">Prioridade de Exibição</Label>
                                        <Input
                                            type="number"
                                            value={formData.order ?? ''}
                                            onChange={(e) => setFormData({ ...formData, order: Number(e.target.value) })}
                                            className="h-12 bg-zinc-900/50 border-white/10 rounded-xl text-base font-bold focus:ring-[#FFBF00]"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1 italic">Link de Redirecionamento (Rota)</Label>
                                    <LocalBufferedInput
                                        value={formData.link || ''}
                                        onFlush={(val) => setFormData(prev => ({ ...prev, link: val }))}
                                        placeholder="Ex: /produtos, /categoria/calcados ou URL completa"
                                        useShadcn={true}
                                        className="h-12 bg-zinc-900/50 border-white/10 rounded-xl focus:ring-[#FFBF00] focus:border-[#FFBF00]/50 text-xs font-mono tracking-wide placeholder:text-zinc-700 transition-all"
                                    />
                                </div>

                                <div className="flex items-center justify-between p-4 bg-black/40 rounded-2xl border border-white/5 shadow-inner">
                                    <div className="space-y-0.5">
                                        <Label className="text-[10px] font-black text-white uppercase tracking-wider flex items-center gap-2 italic">
                                            Banner Ativo <Zap className="w-3.5 h-3.5 text-[#FFBF00]" />
                                        </Label>
                                        <p className="text-[8px] font-medium text-zinc-500 uppercase tracking-wider">Habilitar visualização imediata no aplicativo</p>
                                    </div>
                                    <Switch
                                        checked={formData.active}
                                        onCheckedChange={(checked) => setFormData({ ...formData, active: checked })}
                                        className="data-[state=checked]:bg-[#FFBF00]"
                                    />
                                </div>
                            </div>

                            {/* Right Column: Mobile Live PWA Mockup Simulator */}
                            <div className="lg:col-span-5 flex flex-col items-center select-none">
                                <Label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-3 italic opacity-85 self-start lg:self-center">
                                    Preview em Tempo Real (PWA Mobile)
                                </Label>
                                
                                <div className="relative w-[280px] h-[480px] rounded-[2.5rem] border-4 border-zinc-800 bg-[#09090b] shadow-[0_15px_40px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col justify-between text-left select-none group/device">
                                    {/* Mock Notch */}
                                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-4.5 bg-zinc-800 rounded-b-2xl z-30 flex items-center justify-center border-x border-b border-zinc-700/30">
                                        <div className="w-2.5 h-2.5 rounded-full bg-zinc-950 border border-zinc-900" />
                                    </div>

                                    {/* Status Bar */}
                                    <div className="px-5 pt-5 pb-1 flex justify-between items-center text-[7px] text-zinc-500 font-mono shrink-0 select-none z-20">
                                        <span>09:41</span>
                                        <div className="flex items-center gap-1.5">
                                            <span>5G</span>
                                            <Smartphone className="w-2.5 h-2.5 text-zinc-500" />
                                        </div>
                                    </div>

                                    {/* App Container */}
                                    <div className="flex-1 px-4 py-2 overflow-y-auto flex flex-col gap-4 select-none relative custom-scrollbar">
                                        {/* Mock Header */}
                                        <div className="flex items-center justify-between pb-2 border-b border-white/5">
                                            <span className="text-[9px] font-black tracking-tight text-white uppercase italic">IKCOUS</span>
                                            <div className="w-3.5 h-3.5 rounded-full bg-zinc-800" />
                                        </div>

                                        {/* Top Banner Area Preview */}
                                        {formData.position === 'home_top' && (
                                            <div className="w-full aspect-[21/9] rounded-xl overflow-hidden bg-zinc-900 border border-white/5 relative flex items-center justify-center shadow-md">
                                                {formData.imageUrl ? (
                                                    <img src={formData.imageUrl} alt="Mockup Top" className="w-full h-full object-cover" />
                                                ) : (
                                                    <span className="text-[7px] font-bold text-zinc-500 uppercase tracking-widest">Banner Topo</span>
                                                )}
                                                {formData.title && (
                                                    <div className="absolute bottom-0 inset-x-0 bg-black/60 px-2 py-1 text-[7px] font-bold text-white truncate">
                                                        {formData.title}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Mock Search Bar */}
                                        <div className="h-7 w-full bg-zinc-900 border border-white/5 rounded-xl flex items-center px-3 text-[7px] text-zinc-600 gap-1.5 shrink-0">
                                            <span className="truncate">Buscar roupas e calçados...</span>
                                        </div>

                                        {/* Middle Banner Area Preview */}
                                        {formData.position === 'home_middle' && (
                                            <div className="w-full aspect-[21/9] rounded-xl overflow-hidden bg-zinc-900 border border-white/5 relative flex items-center justify-center shadow-md">
                                                {formData.imageUrl ? (
                                                    <img src={formData.imageUrl} alt="Mockup Middle" className="w-full h-full object-cover" />
                                                ) : (
                                                    <span className="text-[7px] font-bold text-zinc-500 uppercase tracking-widest">Banner Intermediário</span>
                                                )}
                                                {formData.title && (
                                                    <div className="absolute bottom-0 inset-x-0 bg-black/60 px-2 py-1 text-[7px] font-bold text-white truncate">
                                                        {formData.title}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Mock Products list */}
                                        <div className="space-y-1 shrink-0">
                                            <div className="flex justify-between text-[7px] font-black uppercase text-zinc-500 tracking-wider">
                                                <span>Promoções em Destaque</span>
                                                <span className="text-[#FFBF00]">Ver tudo</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="bg-zinc-900/40 border border-white/5 rounded-xl p-1.5 space-y-1">
                                                    <div className="w-full aspect-square bg-zinc-800 rounded-md" />
                                                    <div className="h-1 w-8 bg-zinc-700 rounded-sm" />
                                                    <div className="h-1.5 w-12 bg-[#FFBF00] rounded-sm" />
                                                </div>
                                                <div className="bg-zinc-900/40 border border-white/5 rounded-xl p-1.5 space-y-1">
                                                    <div className="w-full aspect-square bg-zinc-800 rounded-md" />
                                                    <div className="h-1 w-6 bg-zinc-700 rounded-sm" />
                                                    <div className="h-1.5 w-10 bg-[#FFBF00] rounded-sm" />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Bottom Banner Area Preview */}
                                        {formData.position === 'home_bottom' && (
                                            <div className="w-full aspect-[21/9] rounded-xl overflow-hidden bg-zinc-900 border border-white/5 relative flex items-center justify-center shadow-md">
                                                {formData.imageUrl ? (
                                                    <img src={formData.imageUrl} alt="Mockup Bottom" className="w-full h-full object-cover" />
                                                ) : (
                                                    <span className="text-[7px] font-bold text-zinc-500 uppercase tracking-widest">Banner Rodapé</span>
                                                )}
                                                {formData.title && (
                                                    <div className="absolute bottom-0 inset-x-0 bg-black/60 px-2 py-1 text-[7px] font-bold text-white truncate">
                                                        {formData.title}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Mock Navigation Bottom Bar */}
                                    <div className="border-t border-white/5 bg-zinc-950/80 backdrop-blur-md py-2.5 px-6 flex justify-between text-[7px] text-zinc-500 font-bold shrink-0">
                                        <span className="text-[#FFBF00]">Início</span>
                                        <span>Buscar</span>
                                        <span>Carrinho</span>
                                        <span>Perfil</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Footer Action buttons */}
                        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 pt-4 border-t border-white/5">
                            <Button
                                variant="ghost"
                                onClick={() => setIsDialogOpen(false)}
                                className="h-11 flex-1 rounded-xl text-zinc-500 hover:text-white hover:bg-white/5 text-[10px] font-black uppercase tracking-wider transition-all"
                            >
                                Cancelar
                            </Button>
                            <Button
                                onClick={handleSubmit}
                                disabled={uploading || isSubmitting}
                                className="flex-[2] h-11 rounded-xl bg-gradient-to-r from-[#FFBF00] to-amber-500 text-black hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(255,191,0,0.25)] text-[10px] font-black uppercase tracking-wider shadow-lg transition-all active:scale-95 border border-amber-400/20"
                            >
                                {uploading ? 'Enviando Imagem...' : isSubmitting ? 'Salvando Configurações...' : 'Salvar Alterações'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Modal de Ajuda */}
            {showHelpModal && (
                <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300 text-left">
                    <div className="relative bg-zinc-950 border border-white/10 rounded-[2.5rem] w-full max-w-2xl p-5 sm:p-8 flex flex-col max-h-[85vh] shadow-[0_0_80px_rgba(0,0,0,0.9)] overflow-hidden animate-in zoom-in-95 duration-300">
                        {/* Header */}
                        <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4 shrink-0 select-none">
                            <h3 className="text-xs font-black text-admin-gold uppercase tracking-[0.2em] flex items-center gap-2 text-[#FFBF00]">
                                <HelpCircle className="w-5 h-5 animate-pulse text-[#FFBF00]" />
                                Manual do Gerenciador de Banners
                            </h3>
                            <button
                                type="button"
                                onClick={() => setShowHelpModal(false)}
                                className="w-8 h-8 rounded-xl bg-zinc-900/50 border border-white/5 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all flex items-center justify-center font-bold text-xs"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Scrollable Manual Content */}
                        <div className="flex-1 overflow-y-auto space-y-6 pr-1 pb-6 custom-scrollbar text-zinc-400 text-xs">
                            <div className="space-y-4">
                                <p className="leading-relaxed">
                                    O Gerenciador de Banners permite que você faça a curadoria dos banners rotativos na página inicial do aplicativo do cliente. Essa seção é a principal vitrine de promoções e produtos em destaque.
                                </p>

                                <div className="space-y-3">
                                    <h4 className="text-[9px] font-black uppercase tracking-[0.2em] text-[#FFBF00] border-l-2 border-amber-500 pl-2">
                                        Parâmetros dos Banners
                                    </h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 select-none">
                                        <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                                            <div className="flex items-center gap-2 text-white font-bold text-[10px] uppercase tracking-wider">
                                                <Layout className="w-4 h-4 text-emerald-500" />
                                                Imagem Promocional
                                            </div>
                                            <p className="text-[10px] text-zinc-500">
                                                Ideal usar proporção horizontal de 21:9. Imagens com boa legibilidade aumentam a conversão.
                                            </p>
                                        </div>

                                        <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                                            <div className="flex items-center gap-2 text-white font-bold text-[10px] uppercase tracking-wider">
                                                <ExternalLink className="w-4 h-4 text-[#FFBF00]" />
                                                Link de Destino
                                            </div>
                                            <p className="text-[10px] text-zinc-500">
                                                A rota interna do app para onde o cliente será direcionado (ex: `/produtos` ou `/categoria/calcados`).
                                            </p>
                                        </div>

                                        <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                                            <div className="flex items-center gap-2 text-white font-bold text-[10px] uppercase tracking-wider">
                                                <ArrowUp className="w-4 h-4 text-sky-500" />
                                                Sequência / Ordenação
                                            </div>
                                            <p className="text-[10px] text-zinc-500">
                                                Prioridade de exibição na fila de slides. Ordene usando os controles simples no painel.
                                            </p>
                                        </div>

                                        <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                                            <div className="flex items-center gap-2 text-white font-bold text-[10px] uppercase tracking-wider">
                                                <Sparkles className="w-4 h-4 text-purple-500" />
                                                Status de Exibição
                                            </div>
                                            <p className="text-[10px] text-zinc-500">
                                                Suspenda ou ative a visibilidade de qualquer campanha instantaneamente usando o botão de alternar.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="pt-4 border-t border-white/5 flex justify-end shrink-0 select-none">
                            <button
                                type="button"
                                onClick={() => setShowHelpModal(false)}
                                className="px-6 py-3 rounded-xl bg-[#FFBF00] hover:bg-amber-500 text-black text-[9px] font-black uppercase tracking-widest transition-all shadow-md active:scale-95"
                            >
                                Entendido
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Image Adjuster Modal */}
            <ImageAdjuster
                isOpen={isAdjusterOpen}
                onClose={() => setIsAdjusterOpen(false)}
                imageUrl={adjustingImgUrl}
                onConfirm={handleAdjustConfirm}
                isSubmitting={isUploadingAdjusted}
                allowedPresets={['2:1', '4:1', 'free']}
                defaultPreset={formData.position === 'home_top' ? '4:1' : '2:1'}
            />

      {/* Diálogo de Confirmação de Exclusão de Banner */}
      <AlertDialog open={bannerToDelete !== null} onOpenChange={(open) => !open && setBannerToDelete(null)}>
        <AlertDialogContent className="bg-zinc-950 border border-white/10 rounded-3xl max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white font-black text-lg uppercase tracking-tight">Excluir Banner?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400 text-xs">
              Tem certeza que deseja excluir este banner? Esta ação não pode ser desfeita e removerá a campanha do catálogo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="bg-white/5 border border-white/10 text-zinc-400 hover:bg-white/10 hover:text-white rounded-xl text-xs font-bold px-4 py-2 border-0">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteBanner} className="bg-rose-650 hover:bg-rose-700 text-white rounded-xl text-xs font-bold px-4 py-2 border-0">
              Excluir Banner
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        </div>
    );
});
