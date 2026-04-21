import { useState, useEffect, type ChangeEvent } from 'react';
import { Plus, ArrowLeft, Upload, ArrowUp, ArrowDown, Layout, Sparkles, Eye, Zap, Trash, Edit, ExternalLink } from 'lucide-react';
import { useBanners } from '@/hooks/useBanners';
import type { Banner, View } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';

interface AdminBannersViewProps {
    onNavigate: (view: View) => void;
}

export function AdminBannersView({ onNavigate }: AdminBannersViewProps) {
    const { banners, isLoaded, uploadBannerImage, addBanner, updateBanner, deleteBanner, reorderBanners, refreshBanners } = useBanners();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingBanner, setEditingBanner] = useState<Banner | null>(null);
    const [uploading, setUploading] = useState(false);
    const [formData, setFormData] = useState<Partial<Banner>>({
        title: '',
        imageUrl: '',
        link: '',
        position: 'home_top',
        active: true,
        order: 0
    });

    useEffect(() => {
        refreshBanners(false, true);
    }, [refreshBanners]);

    const handleBack = () => onNavigate('admin-dashboard');

    const handleOpenDialog = (banner?: Banner) => {
        if (banner) {
            setEditingBanner(banner);
            setFormData({ ...banner });
        } else {
            setEditingBanner(null);
            setFormData({
                title: '',
                imageUrl: '',
                link: '',
                position: 'home_top',
                active: true,
                order: banners.length + 1
            });
        }
        setIsDialogOpen(true);
    };

    const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
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
        try {
            if (!formData.imageUrl) {
                toast.error('Imagem é obrigatória');
                return;
            }

            if (editingBanner) {
                await updateBanner(editingBanner.id, formData);
            } else {
                await addBanner(formData as Required<Omit<Banner, 'id'>>);
            }
            await refreshBanners(false, true);
            setIsDialogOpen(false);
            toast.success(editingBanner ? 'Banner atualizado' : 'Banner criado');
        } catch {
            // Error handled in hook
        }
    };

    const handleDelete = async (id: string, imageUrl: string) => {
        if (confirm('Tem certeza que deseja excluir este banner?')) {
            await deleteBanner(id, imageUrl);
            await refreshBanners(false, true);
            toast.success('Banner removido');
        }
    };

    const moveBanner = async (banner: Banner, direction: 'up' | 'down') => {
        const bannersInPosition = banners
            .filter(b => b.position === banner.position)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        const currentIndex = bannersInPosition.findIndex(b => b.id === banner.id);
        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

        if (targetIndex >= 0 && targetIndex < bannersInPosition.length) {
            const targetBanner = bannersInPosition[targetIndex];
            await reorderBanners(banner.id, targetBanner.id);
        }
    };

    const positions = [
        { value: 'home_top', label: 'Home Header (Top)' },
        { value: 'home_middle', label: 'Mid Section' },
        { value: 'home_bottom', label: 'Footer Base' }
    ];

    return (
        <div className="min-h-screen bg-[var(--admin-bg)] text-white pb-32 font-sans selection:bg-[var(--admin-gold)]/30">
            {/* Header Elite */}
            <div className="px-6 py-8">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <button
                            onClick={handleBack}
                            className="w-12 h-12 flex items-center justify-center bg-zinc-950/50 text-zinc-400 rounded-2xl hover:bg-[var(--admin-gold)] hover:text-black transition-all active:scale-95 border border-white/5 group shadow-2xl"
                        >
                            <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                        </button>
                        <div>
                            <div className="flex items-center gap-3 mb-1">
                                <Layout className="w-5 h-5 text-[var(--admin-gold)] animate-pulse" />
                                <h1 className="text-2xl font-black tracking-tighter uppercase italic bg-gradient-to-r from-white via-zinc-400 to-zinc-600 bg-clip-text text-transparent">
                                    Visual Engine
                                </h1>
                            </div>
                            <p className="text-[10px] font-bold text-[var(--admin-gold)] uppercase tracking-[0.3em] opacity-80">
                                Premium Banners Curatorship
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={() => handleOpenDialog()}
                        className="group relative flex items-center gap-3 px-8 py-4 bg-[var(--admin-gold)] text-black rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] hover:scale-105 transition-all active:scale-95 shadow-[0_0_30px_rgba(212,175,55,0.3)] overflow-hidden"
                    >
                        <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-500" />
                        <Plus className="w-4 h-4 relative z-10" />
                        <span className="relative z-10">New Visual Asset</span>
                    </button>
                </div>
            </div>

            <div className="max-w-7xl mx-auto p-8 space-y-12">
                {/* Stats Dashboard */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="group relative bg-zinc-950/40 backdrop-blur-md border border-white/5 p-8 rounded-[2.5rem] flex items-center gap-8 overflow-hidden hover:border-[var(--admin-gold)]/30 transition-all duration-500 shadow-2xl">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--admin-gold)]/5 blur-[60px] rounded-full -mr-16 -mt-16 group-hover:bg-[var(--admin-gold)]/10 transition-all" />
                        <div className="w-20 h-20 bg-zinc-900 rounded-3xl flex items-center justify-center border border-white/5 text-[var(--admin-gold)] shadow-inner relative z-10">
                            <Eye className="w-10 h-10 animate-pulse" />
                        </div>
                        <div className="relative z-10">
                            <p className="text-[11px] font-black text-zinc-500 uppercase tracking-[0.3em] mb-1">Active Exposure</p>
                            <h3 className="text-4xl font-black tracking-tighter text-white uppercase italic">{banners.filter(b => b.active).length} Assets</h3>
                        </div>
                    </div>
                    <div className="group relative bg-zinc-950/40 backdrop-blur-md border border-white/5 p-8 rounded-[2.5rem] flex items-center gap-8 overflow-hidden hover:border-emerald-500/30 transition-all duration-500 shadow-2xl">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 blur-[60px] rounded-full -mr-16 -mt-16 group-hover:bg-emerald-500/10 transition-all" />
                        <div className="w-20 h-20 bg-zinc-900 rounded-3xl flex items-center justify-center border border-white/5 text-emerald-500 shadow-inner relative z-10">
                            <Zap className="w-10 h-10" />
                        </div>
                        <div className="relative z-10">
                            <p className="text-[11px] font-black text-zinc-500 uppercase tracking-[0.3em] mb-1">Visual Impact</p>
                            <h3 className="text-4xl font-black tracking-tighter text-white uppercase italic tracking-widest text-[#00ff88]">High</h3>
                        </div>
                    </div>
                </div>

                {!isLoaded ? (
                    <div className="text-center py-32 flex flex-col items-center justify-center">
                        <div className="relative w-20 h-20 mb-6">
                            <div className="absolute inset-0 border-4 border-[var(--admin-gold)]/10 rounded-full" />
                            <div className="absolute inset-0 border-4 border-t-[var(--admin-gold)] rounded-full animate-spin" />
                            <Layout className="absolute inset-0 m-auto w-8 h-8 text-[var(--admin-gold)] animate-pulse" />
                        </div>
                        <p className="text-[11px] font-black text-zinc-500 uppercase tracking-[0.5em] animate-pulse">Sincronizando Galeria de Elite...</p>
                    </div>
                ) : (
                    <div className="space-y-16">
                        {positions.map((pos) => {
                            const positionBanners = banners.filter(b => b.position === pos.value).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

                            return (
                                <div key={pos.value} className="space-y-8">
                                    <div className="flex items-center gap-6 px-4">
                                        <h2 className="text-[12px] font-black text-white uppercase tracking-[0.4em] italic whitespace-nowrap">{pos.label}</h2>
                                        <div className="h-[1px] flex-1 bg-gradient-to-r from-white/10 to-transparent" />
                                    </div>

                                    {positionBanners.length === 0 ? (
                                        <div className="bg-zinc-950/20 p-20 rounded-[4rem] border border-white/5 backdrop-blur-sm border-dashed text-center">
                                            <p className="text-[11px] font-black text-zinc-700 uppercase tracking-[0.3em]">No Assets Deployed in this Sector</p>
                                        </div>
                                    ) : (
                                        <div className="grid gap-10">
                                            {positionBanners.map(banner => (
                                                <div
                                                    key={banner.id}
                                                    className={`group relative bg-zinc-950/40 backdrop-blur-md border border-white/5 rounded-[3.5rem] p-8 transition-all duration-700 hover:border-[var(--admin-gold)]/30 hover:shadow-[0_40px_100px_rgba(0,0,0,0.6)] ${!banner.active ? 'opacity-30 grayscale' : ''}`}
                                                >
                                                    <div className="flex flex-col xl:flex-row gap-10 items-center">
                                                        {/* Preview Imagem Premium */}
                                                        <div className="relative w-full xl:w-[550px] aspect-[21/9] rounded-[2.5rem] overflow-hidden border border-white/5 shadow-[0_20px_50px_rgba(0,0,0,0.5)] bg-zinc-900 group-hover:scale-[1.02] transition-transform duration-700">
                                                            <img
                                                                src={banner.imageUrl}
                                                                alt={banner.title || 'Banner'}
                                                                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000"
                                                            />
                                                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-80" />
                                                            {!banner.active && (
                                                                <div className="absolute inset-0 bg-black/40 backdrop-blur-md flex items-center justify-center text-[12px] font-black uppercase tracking-[0.5em] text-white/50 italic border border-[var(--admin-gold)]/20 rounded-[2.5rem]">
                                                                    Protocol Suspended
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* Infos & Controles */}
                                                        <div className="flex-1 space-y-6 w-full relative z-10">
                                                            <div className="flex items-center justify-between">
                                                                <div>
                                                                    <h3 className="text-3xl font-black text-white uppercase italic tracking-tighter leading-none mb-2 bg-gradient-to-r from-white to-zinc-500 bg-clip-text text-transparent">
                                                                        {banner.title || 'Untitled Campaign'}
                                                                    </h3>
                                                                    <div className="flex items-center gap-3">
                                                                        <div className="px-3 py-1 bg-zinc-900 border border-white/5 rounded-full">
                                                                            <p className="text-[10px] font-bold text-[var(--admin-gold)] uppercase tracking-widest">
                                                                                Deployment Order: <span className="text-white">#{banner.order}</span>
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="flex gap-3">
                                                                    <button
                                                                        onClick={() => moveBanner(banner, 'up')}
                                                                        className="w-12 h-12 bg-zinc-900/50 text-zinc-500 rounded-2xl flex items-center justify-center hover:bg-[var(--admin-gold)] hover:text-black disabled:opacity-20 border border-white/5 shadow-xl transition-all active:scale-90"
                                                                    >
                                                                        <ArrowUp className="w-5 h-5" />
                                                                    </button>
                                                                    <button
                                                                        onClick={() => moveBanner(banner, 'down')}
                                                                        className="w-12 h-12 bg-zinc-900/50 text-zinc-500 rounded-2xl flex items-center justify-center hover:bg-[var(--admin-gold)] hover:text-black disabled:opacity-20 border border-white/5 shadow-xl transition-all active:scale-90"
                                                                    >
                                                                        <ArrowDown className="w-5 h-5" />
                                                                    </button>
                                                                </div>
                                                            </div>

                                                            <div className="flex flex-wrap items-center gap-6 py-6 border-y border-white/5">
                                                                <div className="px-6 py-3 bg-zinc-900/50 rounded-2xl border border-white/5 text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-3 group/link cursor-default">
                                                                    <ExternalLink className="w-4 h-4 text-[var(--admin-gold)] group-hover/link:scale-110 transition-transform" />
                                                                    Redirect: <span className="text-white font-mono">{banner.link || 'Root'}</span>
                                                                </div>
                                                                <div className={`px-6 py-3 rounded-2xl border text-[10px] font-black uppercase tracking-widest flex items-center gap-3 ${banner.active ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' : 'bg-red-500/10 border-red-500/20 text-red-500'}`}>
                                                                    <div className={`w-2 h-2 rounded-full ${banner.active ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)] animate-pulse' : 'bg-red-500'}`} />
                                                                    {banner.active ? 'Operational' : 'Off-line'}
                                                                </div>
                                                            </div>

                                                            <div className="flex items-center gap-4 pt-2">
                                                                <button
                                                                    onClick={() => handleOpenDialog(banner)}
                                                                    className="flex-1 h-14 px-8 bg-zinc-900/80 border border-white/5 rounded-2xl text-[11px] font-black uppercase tracking-widest text-zinc-400 hover:bg-[var(--admin-gold)] hover:text-black hover:border-[var(--admin-gold)] transition-all flex items-center justify-center gap-3 shadow-xl active:scale-95"
                                                                >
                                                                    <Edit className="w-4 h-4" /> Finalize Asset
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDelete(banner.id, banner.imageUrl)}
                                                                    className="h-14 px-8 bg-red-500/10 border border-red-500/20 rounded-2xl text-[11px] font-black uppercase tracking-widest text-red-500 hover:bg-red-500 hover:text-white transition-all flex items-center gap-3 shadow-xl active:scale-95"
                                                                >
                                                                    <Trash className="w-4 h-4" /> Purge
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Dialog Elite */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="sm:max-w-2xl bg-zinc-950 border-white/5 text-white p-0 overflow-hidden rounded-[3.5rem] shadow-[0_0_80px_rgba(0,0,0,0.9)] mx-auto">
                    <div className="absolute -top-40 -right-40 w-80 h-80 bg-[var(--admin-gold)]/5 blur-[120px] rounded-full" />
                    <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-emerald-500/5 blur-[120px] rounded-full" />

                    <div className="p-12 space-y-10 relative z-10">
                        <DialogHeader>
                            <DialogTitle className="text-3xl font-black text-white tracking-widest uppercase italic flex items-center gap-4">
                                <Sparkles className="w-8 h-8 text-[var(--admin-gold)]" />
                                {editingBanner ? 'Optimize Asset' : 'Blueprint Creation'}
                            </DialogTitle>
                            <DialogDescription className="text-zinc-500 font-bold uppercase text-[11px] tracking-[0.3em] mt-3">
                                Structural Design & Protocol Configuration
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-8">
                            <div className="space-y-4">
                                <Label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest ml-1 italic opacity-80">Visual Source Control</Label>
                                <div className="flex flex-col gap-6">
                                    {formData.imageUrl ? (
                                        <div className="group relative w-full aspect-[21/9] rounded-[2.5rem] overflow-hidden border border-white/10 bg-zinc-900 shadow-2xl">
                                            <img src={formData.imageUrl} alt="Preview" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                <Label htmlFor="banner-upload" className="cursor-pointer px-8 py-3 bg-[var(--admin-gold)] text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all">Change Master Asset</Label>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="relative">
                                            <Label htmlFor="banner-upload" className="cursor-pointer w-full h-40 flex flex-col items-center justify-center gap-4 bg-zinc-900/50 border-2 border-dashed border-white/5 rounded-[2.5rem] text-[11px] font-black uppercase tracking-[0.2em] text-zinc-600 hover:bg-zinc-900 hover:border-[var(--admin-gold)]/30 transition-all group">
                                                <Upload className="w-10 h-10 group-hover:text-[var(--admin-gold)] transition-colors" />
                                                <span>Deploy Main Image</span>
                                            </Label>
                                        </div>
                                    )}
                                    <Input id="banner-upload" type="file" accept="image/*" className="hidden" onChange={handleFileUpload} disabled={uploading} />
                                </div>
                            </div>

                            <div className="space-y-4">
                                <Label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest ml-1 italic">Asset Designation</Label>
                                <Input
                                    value={formData.title || ''}
                                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                    placeholder="EX: CORE_SUMMER_COLLECTION"
                                    className="h-16 bg-zinc-900/50 border-white/10 rounded-2xl focus:ring-[var(--admin-gold)] focus:border-[var(--admin-gold)]/50 text-xl font-black tracking-widest uppercase italic transition-all"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-8">
                                <div className="space-y-4">
                                    <Label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest ml-1 italic">Spatial Position</Label>
                                    <Select
                                        value={formData.position}
                                        onValueChange={(value: any) => setFormData({ ...formData, position: value })}
                                    >
                                        <SelectTrigger className="h-16 bg-zinc-900/50 border-white/10 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] focus:ring-[var(--admin-gold)]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="bg-zinc-950 border-white/10 text-white">
                                            {positions.map(pos => (
                                                <SelectItem key={pos.value} value={pos.value} className="font-bold uppercase tracking-widest text-[10px]">{pos.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-4">
                                    <Label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest ml-1 italic">Sequence Priority</Label>
                                    <Input
                                        type="number"
                                        value={formData.order ?? ''}
                                        onChange={(e) => setFormData({ ...formData, order: Number(e.target.value) })}
                                        className="h-16 bg-zinc-900/50 border-white/10 rounded-2xl text-xl font-black focus:ring-[var(--admin-gold)]"
                                    />
                                </div>
                            </div>

                            <div className="space-y-4">
                                <Label className="text-[11px] font-black text-zinc-500 uppercase tracking-widest ml-1 italic">Redirect Logic (Endpoint)</Label>
                                <Input
                                    value={formData.link || ''}
                                    onChange={(e) => setFormData({ ...formData, link: e.target.value })}
                                    placeholder="/elite/curated-selection"
                                    className="h-16 bg-zinc-900/50 border-white/10 rounded-2xl focus:ring-[var(--admin-gold)] focus:border-[var(--admin-gold)]/50 text-xs font-black font-mono tracking-widest placeholder:text-zinc-700 transition-all opacity-80"
                                />
                            </div>

                            <div className="flex items-center justify-between p-8 bg-black/40 rounded-[2.5rem] border border-white/5 shadow-inner">
                                <div className="space-y-2">
                                    <Label className="text-[12px] font-black text-white uppercase tracking-widest flex items-center gap-3 italic">
                                        Active Protocol <Zap className="w-4 h-4 text-[var(--admin-gold)]" />
                                    </Label>
                                    <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Enable immediate global visibility</p>
                                </div>
                                <Switch
                                    checked={formData.active}
                                    onCheckedChange={(checked) => setFormData({ ...formData, active: checked })}
                                    className="data-[state=checked]:bg-[var(--admin-gold)]"
                                />
                            </div>
                        </div>

                        <div className="flex gap-6 pt-6">
                            <Button
                                variant="ghost"
                                onClick={() => setIsDialogOpen(false)}
                                className="h-16 flex-1 rounded-2xl text-zinc-500 hover:text-white hover:bg-white/5 text-[11px] font-black uppercase tracking-[0.3em] transition-all"
                            >
                                Abort
                            </Button>
                            <Button
                                onClick={handleSubmit}
                                disabled={uploading}
                                className="flex-[2] h-16 rounded-2xl bg-[var(--admin-gold)] text-black hover:bg-white text-[11px] font-black uppercase tracking-[0.3em] shadow-[0_20px_40px_rgba(212,175,55,0.2)] transition-all active:scale-95"
                            >
                                {uploading ? 'Processing Architecture...' : 'Syndicate Global Asset'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
