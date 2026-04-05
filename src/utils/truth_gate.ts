/**
 * VOR (Verified Observation Runtime) - Truth Gate G17
 * Garante a integridade lógica dos dados no domínio do marketplace.
 */

export interface VerificationReceipt {
    hash: string;
    timestamp: string;
    status: 'VERIFIED' | 'ABORTED';
    violations: string[];
}

export const TruthGate = {
    /**
     * Verifica axiomas fundamentais de um produto.
     * VOR Implementation: Prova ou Abortagem.
     */
    verifyProductAxiom: (product: any): VerificationReceipt => {
        const violations: string[] = [];

        // Axioma 1: Preço não pode ser negativo
        if (product.price < 0) {
            violations.push('Axiom violation: price_non_negative');
        }

        // Axioma 2: Estoque dentro do limite termodinâmico
        if (product.stock > 10000) {
            violations.push('Axiom violation: stock_limit_exceeded');
        }

        // Axioma 3: Nome do produto é mandatório (Identidade)
        if (!product.name || product.name.trim().length === 0) {
            violations.push('Axiom violation: identity_null_error');
        }

        // Axioma 4: Validação Financeira
        if (product.costPrice && product.costPrice < 0) {
            violations.push('Axiom violation: cost_price_negative');
        }
        if (product.costPrice && product.price > 0 && product.costPrice >= product.price) {
            violations.push('Axiom warning: price_margin_negative (Prejuízo detectado)');
        }

        const status = violations.length === 0 ? 'VERIFIED' : 'ABORTED';
        const timestamp = new Date().toISOString();
        const hash = btoa(`${product.id || 'new'}-${timestamp}-${status}`).slice(0, 16);

        const receipt: VerificationReceipt = {
            hash,
            timestamp,
            status,
            violations
        };

        // Protocolo SROS: Registro de recibo para auditoria de enxame
        console.log(`%c[VOR-G17] Receipt Generated: ${hash}`, 'color: #10b981; font-weight: bold;', receipt);

        if (status === 'ABORTED') {
            console.error(`[VOR-G17] Execution ABORTED due to violations`, violations);
            throw new Error(`Validação de Produto Falhou: ${violations.join(', ')}`);
        }

        return receipt;
    }
};
