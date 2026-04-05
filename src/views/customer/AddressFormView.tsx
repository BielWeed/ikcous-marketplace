import { useEffect } from 'react';
import { AddressForm } from '@/components/ui/custom/AddressForm';
import { useAddresses } from '@/hooks/useAddresses';
import type { Address } from '@/types';
import { MapPin, Sparkles } from 'lucide-react';

interface AddressFormViewProps {
    addressId?: string | null;
    onBack: () => void;
}

export function AddressFormView({ addressId, onBack }: AddressFormViewProps) {
    const { addresses, fetchAddresses, addAddress, updateAddress } = useAddresses();

    useEffect(() => {
        fetchAddresses();
    }, [fetchAddresses]);

    const editingAddress = addressId ? addresses.find(a => a.id === addressId) : undefined;

    const handleSubmit = async (data: Omit<Address, 'id' | 'user_id'>) => {
        let success;
        if (addressId) {
            success = await updateAddress(addressId, data);
        } else {
            const newAddr = await addAddress(data);
            success = !!newAddr;
        }
        
        if (success) {
            onBack();
        }
    };

    return (
        <div className="min-h-full bg-white flex flex-col">
            <div className="max-w-md mx-auto px-4 py-8">
                {/* Visual Header */}
                <div className="mb-8 overflow-hidden rounded-[2.5rem] bg-zinc-900 p-8 shadow-2xl relative group">
                    {/* Decorative elements */}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-2xl group-hover:bg-white/10 transition-colors" />
                    <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full -ml-12 -mb-12 blur-xl" />
                    
                    <div className="relative z-10 flex items-start gap-5">
                        <div className="w-12 h-12 bg-white/10 rounded-2xl flex-shrink-0 flex items-center justify-center backdrop-blur-md border border-white/10 mt-1">
                            <MapPin className="w-6 h-6 text-white" />
                        </div>
                        <div className="flex flex-col">
                            <h2 className="text-3xl font-black text-white tracking-tighter mb-1 flex items-center gap-2">
                                {addressId ? 'Editar Endereço' : 'Novo Endereço'}
                                <Sparkles className="w-5 h-5 text-amber-400 animate-pulse" />
                            </h2>
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 leading-tight">
                                {addressId ? 'Atualize os dados para entrega' : 'Onde entregaremos seu produto da ICKOUS?'}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Form Container */}
                <div className="bg-white rounded-[2.5rem] border border-zinc-100 p-6 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <AddressForm
                        initialData={editingAddress}
                        onSubmit={handleSubmit}
                        onCancel={onBack}
                    />
                </div>
                
                {/* Hint/Footer info */}
                <div className="mt-8 px-6 text-center">
                    <p className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest leading-relaxed">
                        Seus dados estão seguros e serão usados apenas para a logística de entrega.
                    </p>
                </div>
            </div>
        </div>
    );
}
