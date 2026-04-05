import { useState } from 'react';
import type { Address } from '@/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

const addressSchema = z.object({
    name: z.string().min(1, 'Nome/Apelido é obrigatório'),
    cep: z.string().min(8, 'CEP inválido'),
    street: z.string().min(1, 'Logradouro é obrigatório'),
    number: z.string().min(1, 'Número é obrigatório'),
    complement: z.string().optional().or(z.literal('')),
    neighborhood: z.string().min(1, 'Bairro é obrigatório'),
    city: z.string().min(1, 'Cidade é obrigatória'),
    state: z.string().min(1, 'Estado é obrigatório'),
    reference: z.string().optional().or(z.literal('')),
    recipient_name: z.string().min(1, 'Nome do destinatário é obrigatório'),
    is_default: z.boolean(),
});

type AddressFormValues = z.infer<typeof addressSchema>;

interface AddressFormProps {
    initialData?: Address;
    onSubmit: (address: Omit<Address, 'id' | 'user_id'>) => Promise<void>;
    onCancel: () => void;
}

export function AddressForm({ initialData, onSubmit, onCancel }: AddressFormProps) {
    const [loading, setLoading] = useState(false);

    const form = useForm<AddressFormValues>({
        resolver: zodResolver(addressSchema),
        defaultValues: {
            name: initialData?.name || '',
            cep: initialData?.cep || '38500-000',
            street: initialData?.street || '',
            number: initialData?.number || '',
            complement: initialData?.complement || '',
            neighborhood: initialData?.neighborhood || '',
            city: initialData?.city || 'Monte Carmelo',
            state: initialData?.state || 'MG',
            reference: initialData?.reference || '',
            recipient_name: initialData?.recipient_name || '',
            is_default: !!initialData?.is_default,
        }
    });

    const handleSubmit = async (values: AddressFormValues) => {
        setLoading(true);
        try {
            const cleanData: Omit<Address, 'id' | 'user_id'> = {
                name: values.name,
                cep: values.cep,
                street: values.street,
                number: values.number,
                complement: values.complement || '',
                neighborhood: values.neighborhood,
                city: values.city,
                state: values.state,
                is_default: values.is_default,
                reference: values.reference || '',
                recipient_name: values.recipient_name,
            };
            await onSubmit(cleanData);
        } catch (error) {
            console.error('Submit error:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            <div className="space-y-6">
                {/* Nome/Apelido e CEP */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                        <label htmlFor="name" className="block text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400 ml-1">
                            Apelido (Ex: Casa, Trabalho)
                        </label>
                        <input
                            id="name"
                            {...form.register('name')}
                            placeholder="Apelido do endereço"
                            disabled={loading}
                            className="w-full px-5 py-4 bg-zinc-50 rounded-2xl text-sm font-black border-2 border-transparent focus:border-zinc-900 focus:bg-white focus:shadow-3xl focus:shadow-zinc-100 transition-all outline-none"
                            autoComplete="nickname"
                        />
                        {form.formState.errors.name && (
                            <p className="text-red-500 text-[10px] uppercase font-bold mt-2 ml-1">{form.formState.errors.name.message}</p>
                        )}
                    </div>

                    <div className="space-y-3">
                        <label htmlFor="recipient_name" className="block text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400 ml-1">
                            Nome do Destinatário
                        </label>
                        <input
                            id="recipient_name"
                            {...form.register('recipient_name')}
                            placeholder="Quem irá receber?"
                            disabled={loading}
                            className="w-full px-5 py-4 bg-zinc-50 rounded-2xl text-sm font-black border-2 border-transparent focus:border-zinc-900 focus:bg-white focus:shadow-3xl focus:shadow-zinc-100 transition-all outline-none"
                            autoComplete="name"
                        />
                        {form.formState.errors.recipient_name && (
                            <p className="text-red-500 text-[10px] uppercase font-bold mt-2 ml-1">{form.formState.errors.recipient_name.message}</p>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                        <label htmlFor="cep" className="block text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400 ml-1">
                            CEP
                        </label>
                        <Controller
                            control={form.control}
                            name="cep"
                            render={({ field }) => (
                                <input
                                    id="cep"
                                    value={field.value}
                                    readOnly
                                    placeholder="38500-000"
                                    maxLength={9}
                                    disabled={loading}
                                    className="w-full px-5 py-4 bg-zinc-100 rounded-2xl text-sm font-black border-2 border-transparent text-zinc-500 cursor-not-allowed outline-none"
                                    autoComplete="postal-code"
                                />
                            )}
                        />
                        {form.formState.errors.cep && (
                            <p className="text-red-500 text-[10px] uppercase font-bold mt-2 ml-1">{form.formState.errors.cep.message}</p>
                        )}
                    </div>
                </div>

                {/* Logradouro */}
                <div className="space-y-3">
                    <label htmlFor="street" className="block text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400 ml-1">
                        Logradouro (Rua / Avenida)
                    </label>
                    <input
                        id="street"
                        {...form.register('street')}
                        placeholder="Ex: Rua Tiradentes"
                        disabled={loading}
                        className="w-full px-6 py-5 bg-zinc-50 rounded-3xl text-sm font-black border-2 border-transparent focus:border-zinc-900 focus:bg-white focus:shadow-3xl focus:shadow-zinc-100 transition-all outline-none"
                        autoComplete="address-line1"
                    />
                    {form.formState.errors.street && (
                        <p className="text-red-500 text-[10px] uppercase font-bold mt-2 ml-1">{form.formState.errors.street.message}</p>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                    {/* Número */}
                    <div className="space-y-3">
                        <label htmlFor="number" className="block text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400 ml-1">
                            Número
                        </label>
                        <input
                            id="number"
                            {...form.register('number')}
                            placeholder="123"
                            disabled={loading}
                            className="w-full px-6 py-5 bg-zinc-50 rounded-3xl text-sm font-black border-2 border-transparent focus:border-zinc-900 focus:bg-white focus:shadow-3xl focus:shadow-zinc-100 transition-all outline-none"
                            autoComplete="address-line1"
                        />
                        {form.formState.errors.number && (
                            <p className="text-red-500 text-[10px] uppercase font-bold mt-2 ml-1">{form.formState.errors.number.message}</p>
                        )}
                    </div>

                    {/* Bairro */}
                    <div className="space-y-3">
                        <label htmlFor="neighborhood" className="block text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400 ml-1">
                            Bairro
                        </label>
                        <input
                            id="neighborhood"
                            {...form.register('neighborhood')}
                            placeholder="Seu bairro"
                            disabled={loading}
                            className="w-full px-5 py-4 bg-zinc-50 rounded-2xl text-sm font-black border-2 border-transparent focus:border-zinc-900 focus:bg-white focus:shadow-3xl focus:shadow-zinc-100 transition-all outline-none"
                            autoComplete="address-level3"
                        />
                        {form.formState.errors.neighborhood && (
                            <p className="text-red-500 text-[10px] uppercase font-bold mt-2 ml-1">{form.formState.errors.neighborhood.message}</p>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    {/* Cidade */}
                    <div className="space-y-3">
                        <label htmlFor="city" className="block text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400 ml-1">
                            Cidade
                        </label>
                        <input
                            id="city"
                            {...form.register('city')}
                            placeholder="Cidade"
                            readOnly
                            disabled={loading}
                            className="w-full px-5 py-4 bg-zinc-100 rounded-2xl text-sm font-black border-2 border-transparent text-zinc-500 cursor-not-allowed outline-none"
                            autoComplete="address-level2"
                        />
                        {form.formState.errors.city && (
                            <p className="text-red-500 text-[10px] uppercase font-bold mt-2 ml-1">{form.formState.errors.city.message}</p>
                        )}
                    </div>

                    {/* Estado */}
                    <div className="space-y-3">
                        <label htmlFor="state" className="block text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400 ml-1">
                            Estado
                        </label>
                        <input
                            id="state"
                            {...form.register('state')}
                            placeholder="UF"
                            readOnly
                            disabled={loading}
                            maxLength={2}
                            className="w-full px-5 py-4 bg-zinc-100 rounded-2xl text-sm font-black border-2 border-transparent text-zinc-500 cursor-not-allowed outline-none"
                            autoComplete="address-level1"
                        />
                        {form.formState.errors.state && (
                            <p className="text-red-500 text-[10px] uppercase font-bold mt-2 ml-1">{form.formState.errors.state.message}</p>
                        )}
                    </div>
                </div>

                {/* Complemento */}
                <div className="space-y-3">
                    <label htmlFor="complement" className="block text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400 ml-1">
                        Complemento (Opcional)
                    </label>
                    <input
                        id="complement"
                        {...form.register('complement')}
                        placeholder="Apto, Bloco, Fundos, etc."
                        disabled={loading}
                        className="w-full px-6 py-5 bg-zinc-50 rounded-3xl text-sm font-black border-2 border-transparent focus:border-zinc-900 focus:bg-white focus:shadow-3xl focus:shadow-zinc-100 transition-all outline-none"
                        autoComplete="address-line2"
                    />
                </div>

                {/* Referência */}
                <div className="space-y-3">
                    <label htmlFor="reference" className="block text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400 ml-1">
                        Ponto de Referência (Opcional)
                    </label>
                    <input
                        id="reference"
                        {...form.register('reference')}
                        placeholder="Ex: Próximo ao mercado principal"
                        disabled={loading}
                        className="w-full px-6 py-5 bg-zinc-50 rounded-3xl text-sm font-black border-2 border-transparent focus:border-zinc-900 focus:bg-white focus:shadow-3xl focus:shadow-zinc-100 transition-all outline-none"
                        autoComplete="off"
                    />
                </div>

                {/* Endereço Padrão */}
                <div className="flex items-center gap-4 px-2 pt-2">
                    <div className="relative inline-flex items-center cursor-pointer">
                        <Controller
                            control={form.control}
                            name="is_default"
                            render={({ field }) => (
                                <Checkbox
                                    id="is_default"
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                    disabled={loading}
                                    className="w-6 h-6 rounded-lg border-2 border-zinc-200 data-[state=checked]:bg-zinc-900 data-[state=checked]:border-zinc-900 transition-all"
                                />
                            )}
                        />
                    </div>
                    <label htmlFor="is_default" className="text-[10px] font-black uppercase tracking-[0.1em] text-zinc-500 cursor-pointer">
                        Definir como endereço padrão
                    </label>
                </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
                <Button
                    type="button"
                    variant="ghost"
                    onClick={onCancel}
                    disabled={loading}
                    className="h-14 px-6 text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-zinc-900 hover:bg-zinc-50 rounded-2xl transition-all"
                >
                    Cancelar
                </Button>
                <Button
                    type="submit"
                    className="h-14 px-8 bg-zinc-900 text-white text-[11px] font-black uppercase tracking-[0.2em] rounded-2xl hover:bg-black transition-all shadow-xl active:scale-95 min-w-[160px]"
                    disabled={loading}
                >
                    {loading ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                        'Salvar Endereço'
                    )}
                </Button>
            </div>
        </form>
    );
}
