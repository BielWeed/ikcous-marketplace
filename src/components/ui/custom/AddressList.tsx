import { memo } from 'react';
import { MapPin, Edit, Trash2, CheckCircle2 } from 'lucide-react';
import type { Address } from '@/types';

interface AddressListProps {
    addresses: Address[];
    onEdit?: (address: Address) => void;
    onDelete?: (id: string) => void;
    onSelect?: (address: Address) => void;
    selectedId?: string;
    selectable?: boolean;
}

export const AddressList = memo(function AddressList({
    addresses,
    onEdit,
    onDelete,
    onSelect,
    selectedId,
    selectable = false
}: AddressListProps) {
    if (addresses.length === 0) {
        return (
            <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                <MapPin className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">Nenhum endereço cadastrado</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {addresses.map((address) => (
                <div
                    key={address.id}
                    role={selectable ? "button" : undefined}
                    tabIndex={selectable ? 0 : undefined}
                    className={`relative bg-zinc-50/50 p-6 rounded-3xl border-2 transition-all duration-500 ${selectable && selectedId === address.id
                        ? 'border-zinc-900 bg-white shadow-2xl shadow-zinc-100 z-10'
                        : 'border-transparent hover:border-zinc-200 hover:bg-white'
                        } ${selectable ? 'cursor-pointer active:scale-[0.98]' : ''}`}
                    onClick={() => selectable && onSelect?.(address)}
                    onKeyDown={(e) => {
                        if (selectable && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            onSelect?.(address);
                        }
                    }}
                >
                    {/* Header */}
                    <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-sm ${selectable && selectedId === address.id ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-400'}`}>
                                <MapPin className="w-5 h-5" />
                            </div>
                            <div>
                                <span className="block text-sm font-black text-zinc-900 leading-tight">{address.name}</span>
                                {address.is_default && (
                                    <span className="text-[8px] font-black uppercase tracking-widest text-emerald-500 mt-1 block">
                                        Endereço Principal
                                    </span>
                                )}
                            </div>
                        </div>
                        {selectable && selectedId === address.id && (
                            <CheckCircle2 className="w-6 h-6 text-zinc-900 animate-in zoom-in-50 duration-300" />
                        )}
                        {(onEdit || onDelete) && (
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={(e) => { e.stopPropagation(); onEdit?.(address); }}
                                    className="w-10 h-10 flex items-center justify-center bg-white hover:bg-zinc-900 hover:text-white rounded-xl text-zinc-400 transition-all shadow-sm"
                                    aria-label="Editar"
                                >
                                    <Edit className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onDelete?.(address.id); }}
                                    className="w-10 h-10 flex items-center justify-center bg-white hover:bg-red-50 hover:text-red-500 rounded-xl text-red-400 transition-all shadow-sm"
                                    aria-label="Excluir"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Details */}
                    <div className="text-[11px] text-zinc-500 font-medium space-y-1 pl-13">
                        <p className="font-black text-zinc-900 uppercase tracking-tighter text-xs mb-1">{address.recipient_name}</p>
                        <p className="leading-relaxed">{address.street}, {address.number}{address.complement ? ` - ${address.complement}` : ''}</p>
                        <p className="leading-relaxed">{address.neighborhood}, {address.city} - {address.state}</p>
                        <p className="font-black text-[10px] text-zinc-400 mt-2">CEP: {address.cep}</p>
                    </div>
                </div>
            ))}
        </div>
    );
});
