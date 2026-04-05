import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import type { Json } from '@/types/database.types';

export interface VORReceipt {
    id: string;
    action_type: string;
    input_data: Json;
    output_data: Json;
    proof_hash: string;
    previous_hash: string | null;
    created_at: string;
}

export function useVOR() {
    const [loading, setLoading] = useState(false);

    /**
     * Generates a SHA-256 hash for the given data string.
     */
    async function generateHash(data: string): Promise<string> {
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Records a new VOR receipt, maintaining the hash chain.
     */
    async function recordAction(
        actionType: string,
        input: Json,
        output: Json
    ) {
        setLoading(true);
        try {
            // 1. Prepare data for hashing
            const { data: latestReceipt } = await supabase
                .from('vor_receipts')
                .select('proof_hash')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            const previousHash = latestReceipt?.proof_hash || 'GENESIS_BLOCK_G19';

            const dataToHash = JSON.stringify({
                actionType,
                input,
                output,
                previousHash,
                timestamp: new Date().toISOString()
            });

            // 2. Generate the proof hash locally
            const proofHash = await generateHash(dataToHash);

            // 3. Save to database via RPC
            const { error: rpcError } = await supabase.rpc('record_vor_action', {
                p_action_type: actionType,
                p_input_data: input,
                p_output_data: output,
                p_proof_hash: proofHash
            });

            if (rpcError) throw rpcError;

            console.log(`[VOR] Action verified and recorded: ${proofHash.substring(0, 10)}...`);
            return { success: true, hash: proofHash };
        } catch (error) {
            console.error('[VOR] Verification failed:', error);
            toast.error('Falha na integridade VOR: Recibo não gerado.');
            return { success: false, error };
        } finally {
            setLoading(false);
        }
    }

    return {
        recordAction,
        loading
    };
}
