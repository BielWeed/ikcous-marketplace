import { useState, useEffect } from 'react';
import {
    User,
    Mail,
    Loader2,
    Shield,
    Phone,
    KeyRound,
    AlertTriangle,
    CheckCircle2
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';


export function AccountSettingsView() {
    const { user, fetchProfile } = useAuth();
    const [loading, setLoading] = useState(false);
    const [updatingPassword, setUpdatingPassword] = useState(false);

    const [profileData, setProfileData] = useState({
        name: '',
        phone: '',
        email: ''
    });

    const [passwordData, setPasswordData] = useState({
        newPassword: '',
        confirmPassword: ''
    });

    useEffect(() => {
        if (user) {
            const fetchLocalProfile = async () => {
                const { data, error } = await (supabase as any).rpc('get_my_complete_profile');

                if (data && !error) {
                    const profile = (data as any)[0];
                    if (profile) {
                        setProfileData({
                            name: profile.full_name || '',
                            phone: profile.whatsapp || '',
                            email: user.email || ''
                        });
                    }
                }
            };
            fetchLocalProfile();
        }
    }, [user]);

    const handleUpdateProfile = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const { error } = await (supabase as any).rpc('update_my_profile_secure', {
                p_full_name: profileData.name,
                p_whatsapp: profileData.phone
            });

            if (error) throw error;

            // Refresh global profile in context (ZENITH v21.7)
            await fetchProfile();

            toast.success('Perfil atualizado com sucesso');
        } catch (error) {
            console.error('Update error:', error);
            toast.error('Erro ao atualizar perfil');
        } finally {
            setLoading(false);
        }
    };

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (passwordData.newPassword !== passwordData.confirmPassword) {
            toast.error('As senhas não coincidem');
            return;
        }

        if (passwordData.newPassword.length < 6) {
            toast.error('A senha deve ter pelo menos 6 caracteres');
            return;
        }

        setUpdatingPassword(true);
        try {
            const { error } = await supabase.auth.updateUser({
                password: passwordData.newPassword
            });

            if (error) throw error;

            toast.success('Senha alterada com sucesso!');
            setPasswordData({ newPassword: '', confirmPassword: '' });
        } catch (error: any) {
            console.error('Password update error:', error);
            toast.error('Erro ao alterar senha: ' + (error.message || 'Erro inesperado'));
        } finally {
            setUpdatingPassword(false);
        }
    };

    if (!user) return null;

    return (
        <div className="min-h-full bg-zinc-50/50 pb-24">


            <div className="max-w-md mx-auto px-6 py-8 space-y-10">
                {/* Profile Section */}
                <section className="space-y-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-zinc-900 rounded-2xl flex items-center justify-center shadow-lg shadow-zinc-200">
                            <User className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-black tracking-tighter text-zinc-900">Perfil</h2>
                            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Informações públicas</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 ml-1">Nome Completo</label>
                            <Input
                                id="full_name"
                                name="full_name"
                                autoComplete="name"
                                value={profileData.name}
                                onChange={e => setProfileData(p => ({ ...p, name: e.target.value }))}
                                className="h-14 bg-zinc-50 border-none rounded-2xl font-bold px-6 focus-visible:ring-2 focus-visible:ring-zinc-200"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 ml-1">WhatsApp</label>
                            <div className="relative">
                                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                                <Input
                                    id="phone"
                                    name="phone"
                                    autoComplete="tel"
                                    value={profileData.phone}
                                    onChange={e => setProfileData(p => ({ ...p, phone: e.target.value }))}
                                    className="h-14 bg-zinc-50 border-none rounded-2xl font-bold pl-12 pr-6 focus-visible:ring-2 focus-visible:ring-zinc-200"
                                    placeholder="(00) 00000-0000"
                                />
                            </div>
                        </div>
                        <Button
                            onClick={handleUpdateProfile}
                            disabled={loading}
                            className="w-full h-14 bg-zinc-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-zinc-100"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar Alterações'}
                        </Button>
                    </div>
                </section>

                <div className="h-px bg-zinc-100" />

                {/* Security Section */}
                <section className="space-y-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-amber-500 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-200">
                            <Shield className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-black tracking-tighter text-zinc-900">Segurança</h2>
                            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Proteção da conta</p>
                        </div>
                    </div>

                    {/* Password compromised warning if applicable */}
                    <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex gap-4">
                        <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
                        <div className="space-y-1">
                            <p className="text-[10px] font-black uppercase tracking-widest text-red-600">Alerta de Senha</p>
                            <p className="text-[10px] font-bold text-red-400 leading-relaxed uppercase tracking-tighter">
                                Use uma senha forte e exclusiva. Evite reutilizar senhas de outros sites.
                            </p>
                        </div>
                    </div>

                    <form onSubmit={handleChangePassword} className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 ml-1">E-mail (Login)</label>
                            <div className="relative">
                                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                                <Input
                                    id="email"
                                    name="email"
                                    autoComplete="email"
                                    value={profileData.email}
                                    disabled
                                    className="h-14 bg-zinc-50/50 border-none rounded-2xl font-bold pl-12 pr-6 opacity-60 italic"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 ml-1">Nova Chave de Acesso</label>
                            <div className="relative">
                                <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                                <Input
                                    id="new_password"
                                    name="new_password"
                                    type="password"
                                    autoComplete="new-password"
                                    value={passwordData.newPassword}
                                    onChange={e => setPasswordData(d => ({ ...d, newPassword: e.target.value }))}
                                    className="h-14 bg-zinc-50 border-none rounded-2xl font-bold pl-12 pr-6 focus-visible:ring-2 focus-visible:ring-zinc-200"
                                    placeholder="No mínimo 6 caracteres"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 ml-1">Confirmar Nova Chave</label>
                            <div className="relative">
                                <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                                <Input
                                    id="confirm_password"
                                    name="confirm_password"
                                    type="password"
                                    autoComplete="new-password"
                                    value={passwordData.confirmPassword}
                                    onChange={e => setPasswordData(d => ({ ...d, confirmPassword: e.target.value }))}
                                    className="h-14 bg-zinc-50 border-none rounded-2xl font-bold pl-12 pr-6 focus-visible:ring-2 focus-visible:ring-zinc-200"
                                    placeholder="Repita a nova senha"
                                    required
                                />
                            </div>
                        </div>

                        <Button
                            type="submit"
                            disabled={updatingPassword}
                            className="w-full h-16 bg-zinc-900 text-white rounded-[1.5rem] font-black uppercase tracking-widest text-[11px] shadow-2xl shadow-zinc-200 hover:bg-black transition-all active:scale-[0.98]"
                        >
                            {updatingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                                <div className="flex items-center gap-2">
                                    <Shield className="w-4 h-4" />
                                    Atualizar Senha Agora
                                </div>
                            )}
                        </Button>
                    </form>
                </section>

                {/* Footer simple info */}
                <div className="text-center pt-6">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-zinc-50 rounded-full">
                        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                        <span className="text-[8px] font-black uppercase tracking-widest text-zinc-400">Proteção Supabase Auth Ativa</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
