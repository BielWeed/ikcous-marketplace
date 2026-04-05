import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Address } from '@/types';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export function useAddresses() {
    const { user } = useAuth();
    const [addresses, setAddresses] = useState<Address[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchAddresses = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('user_addresses')
                .select('*')
                .eq('user_id', user.id)
                .order('is_default', { ascending: false })
                .order('created_at', { ascending: false });

            if (error) throw error;
            setAddresses((data || []).map(a => ({
                id: a.id,
                user_id: a.user_id,
                name: a.name,
                recipient_name: a.recipient_name,
                cep: a.cep,
                street: a.street,
                number: a.number,
                complement: a.complement,
                neighborhood: a.neighborhood,
                city: a.city,
                state: a.state,
                reference: a.reference,
                is_default: a.is_default || false
            })));
        } catch (error) {
            console.error('Error fetching addresses:', error);
            toast.error('Erro ao carregar endereços');
        } finally {
            setLoading(false);
        }
    }, [user]);

    const addAddress = async (address: Omit<Address, 'id' | 'user_id'>) => {
        if (!user) return null;
        try {
            // If this is the first address, make it default automatically
            const isFirst = addresses.length === 0;
            const newAddress = {
                ...address,
                user_id: user.id,
                is_default: isFirst ? true : address.is_default
            };

            const { data, error } = await supabase
                .from('user_addresses')
                .insert(newAddress)
                .select()
                .single();

            if (error) throw error;

            const formattedAddress: Address = {
                id: data.id,
                user_id: data.user_id,
                name: data.name,
                recipient_name: data.recipient_name,
                cep: data.cep,
                street: data.street,
                number: data.number,
                complement: data.complement,
                neighborhood: data.neighborhood,
                city: data.city,
                state: data.state,
                reference: data.reference,
                is_default: data.is_default || false
            };

            setAddresses(prev => {
                // If new address is default, update others
                if (formattedAddress.is_default) {
                    return [formattedAddress, ...prev.map(a => ({ ...a, is_default: false }))];
                }
                return [...prev, formattedAddress];
            });

            toast.success('Endereço adicionado com sucesso');
            return formattedAddress;
        } catch (error) {
            console.error('Error adding address:', error);
            toast.error('Erro ao adicionar endereço');
            return null;
        }
    };

    const updateAddress = async (id: string, updates: Partial<Address>) => {
        if (!user) return false;
        try {
            const { data, error } = await supabase
                .from('user_addresses')
                .update(updates)
                .eq('id', id)
                .eq('user_id', user.id)
                .select()
                .single();

            if (error) throw error;

            const formattedAddress: Address = {
                id: data.id,
                user_id: data.user_id,
                name: data.name,
                recipient_name: data.recipient_name,
                cep: data.cep,
                street: data.street,
                number: data.number,
                complement: data.complement,
                neighborhood: data.neighborhood,
                city: data.city,
                state: data.state,
                reference: data.reference,
                is_default: data.is_default || false
            };

            setAddresses(prev => {
                if (updates.is_default) {
                    return prev.map(a =>
                        a.id === id ? formattedAddress : { ...a, is_default: false }
                    ).sort((a, b) => (a.is_default === b.is_default ? 0 : a.is_default ? -1 : 1));
                }
                return prev.map(a => a.id === id ? formattedAddress : a);
            });

            toast.success('Endereço atualizado');
            return true;
        } catch (error) {
            console.error('Error updating address:', error);
            toast.error('Erro ao atualizar endereço');
            return false;
        }
    };

    const deleteAddress = async (id: string) => {
        if (!user) return false;
        try {
            const { error } = await supabase
                .from('user_addresses')
                .delete()
                .eq('id', id)
                .eq('user_id', user.id);

            if (error) throw error;

            setAddresses(prev => prev.filter(a => a.id !== id));
            toast.success('Endereço removido');
            return true;
        } catch (error) {
            console.error('Error deleting address:', error);
            toast.error('Erro ao remover endereço');
            return false;
        }
    };

    return {
        addresses,
        loading,
        fetchAddresses,
        addAddress,
        updateAddress,
        deleteAddress
    };
}
