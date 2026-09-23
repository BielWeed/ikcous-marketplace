// ============================================================================
// CPF do destinatário — o Melhor Envio exige `to.document` (CPF, pessoa
// física) para inserir o frete no carrinho (doc oficial: "Documentos
// from/to", docs.melhorenvio.com.br/reference/inserir-fretes-no-carrinho).
// Módulo à parte porque é PII: validação, leitura e sanitização de log
// ficam isoladas do fluxo principal, nunca espalhadas.
//
// CONTRATO com a frente de checkout (outra branch): `marketplace_orders
// .customer_data.cpf` é uma STRING de 11 DÍGITOS SEM MÁSCARA, gravada só
// quando a entrega é por transportadora. Pedido antigo NÃO tem a chave —
// por isso `cpfDoDestinatario` devolve `null` tanto para ausente quanto
// para inválido; quem chama (index.ts) decide qual das duas mensagens
// mostrar olhando o valor bruto.
// ============================================================================

/**
 * Valida CPF: 11 dígitos depois de remover tudo que não é dígito, recusa
 * sequência de dígitos repetidos (000.000.000-00, 111.111.111-11, ...) e
 * confere os dois dígitos verificadores pelo algoritmo oficial (módulo 11).
 */
export function cpfValido(valor: unknown): boolean {
    if (typeof valor !== 'string' && typeof valor !== 'number') return false
    const digitos = String(valor).replace(/\D/g, '')
    if (digitos.length !== 11) return false
    if (/^(\d)\1{10}$/.test(digitos)) return false

    const digitoVerificador = (base: string): number => {
        let soma = 0
        let peso = base.length + 1
        for (const caractere of base) {
            soma += Number(caractere) * peso
            peso--
        }
        const resto = (soma * 10) % 11
        return resto === 10 ? 0 : resto
    }

    const primeirosNove = digitos.slice(0, 9)
    const d1 = digitoVerificador(primeirosNove)
    const d2 = digitoVerificador(primeirosNove + String(d1))

    return digitos[9] === String(d1) && digitos[10] === String(d2)
}

/**
 * O CPF do destinatário, SÓ do banco (`customer_data.cpf`) — nunca do corpo
 * da requisição de `gerar_etiqueta`. Devolve os 11 dígitos limpos quando
 * válido; `null` quando ausente OU inválido.
 */
export function cpfDoDestinatario(
    customerData: Record<string, any> | null | undefined,
): string | null {
    const cpf = customerData?.cpf
    if (typeof cpf !== 'string' && typeof cpf !== 'number') return null
    const digitos = String(cpf).replace(/\D/g, '')
    return cpfValido(digitos) ? digitos : null
}

// Máscara ddd.ddd.ddd-dd, OU 11 dígitos crus isolados — o lookaround evita
// comer um pedaço de sequência maior (protocolo, telefone com DDI etc.).
const REGEX_CPF_MASCARADO = /\d{3}\.\d{3}\.\d{3}-\d{2}/g
const REGEX_CPF_CRU = /(?<!\d)\d{11}(?!\d)/g

/**
 * Troca qualquer CPF (mascarado ou cru) encontrado no texto por `[cpf]` —
 * usada nos textos de erro que o Melhor Envio devolve (podem ecoar o `to`
 * que a function enviou) ANTES de log ou gravação de evento. Regra da casa:
 * NUNCA logar CPF (console.*, gravarEvento, payload de evento, toast).
 */
export function sanitizarCpfDoTexto(texto: string): string {
    if (typeof texto !== 'string') return texto
    return texto.replace(REGEX_CPF_MASCARADO, '[cpf]').replace(REGEX_CPF_CRU, '[cpf]')
}
