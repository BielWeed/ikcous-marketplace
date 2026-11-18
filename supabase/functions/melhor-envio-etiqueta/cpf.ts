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

// E-mail e telefone brasileiro. Telefone em duas passadas (sem quantificador
// aninhado — `security/detect-unsafe-regex`): corrida crua de 10 a 13
// dígitos (com ou sem DDI 55) e o formato com DDD entre parênteses, espaço
// ou hífen. Os dois exigem 10+ dígitos — CEP (8) passa intacto.
const REGEX_EMAIL = /[^\s@"'<>(),;:]+@[^\s@"'<>(),;:]+\.[^\s@"'<>(),;:]+/g
const REGEX_TELEFONE_CRU = /(?<!\d)\+?\d{10,13}(?!\d)/g
const REGEX_TELEFONE_FORMATADO = /\(?\d{2}\)?[\s-]?\d{4,5}-?\d{4}/g

/**
 * CPF + e-mail + telefone fora do texto. A devolução reversa manda ao Melhor
 * Envio o e-mail e o celular de quem devolve (`new_sender_mail`,
 * `new_sender_phone`) — a resposta de erro pode ecoá-los. Regra da casa:
 * nenhum desses dados vai para log nem para a mensagem devolvida ao painel.
 */
export function sanitizarDadosPessoaisDoTexto(texto: string): string {
    if (typeof texto !== 'string') return texto
    return sanitizarCpfDoTexto(texto)
        .replace(REGEX_EMAIL, '[email]')
        .replace(REGEX_TELEFONE_CRU, '[telefone]')
        .replace(REGEX_TELEFONE_FORMATADO, '[telefone]')
}

// Nomes de campo que o carrinho do ME recebe (`from`, `to`, `products`,
// `volumes`, `options`) — as chaves de `errors` da validação do Laravel são
// caminhos feitos só destes segmentos (`to.postal_code`, `volumes.0.weight`).
// Lista FECHADA de propósito: o texto de uma recusa pode ecoar nome, rua,
// número, bairro, cidade e CEP do destinatário, e `sanitizarDadosPessoaisDoTexto`
// só reconhece CPF, e-mail e telefone — não dá para limpar nome e endereço por
// padrão (abreviação, acento, caixa). O que não está na lista some.
const SEGMENTOS_DE_CAMPO_DO_CARRINHO: ReadonlySet<string> = new Set([
    'service', 'from', 'to', 'products', 'volumes', 'options',
    'name', 'phone', 'email', 'document', 'company_document', 'state_register',
    'address', 'complement', 'number', 'district', 'city', 'state_abbr', 'country_id', 'postal_code',
    'quantity', 'unitary_value', 'weight', 'width', 'height', 'length',
    'insurance_value', 'receipt', 'own_hand', 'reverse', 'non_commercial',
])
const REGEX_INDICE_DE_LISTA = /^\d{1,3}$/
const MAXIMO_DE_CAMPOS_NO_LOG = 6

/**
 * Os NOMES dos campos que o Melhor Envio recusou (`errors` do corpo de
 * validação), para o log de servidor — NUNCA o texto da recusa, que pode
 * carregar dado pessoal do destinatário. Só entra a chave cujos segmentos
 * (separados por `.`) são todos campos conhecidos do carrinho ou índice de
 * lista; texto, chave estranha, formato inesperado e corpo ilegível dão `[]`.
 * Sem repetição, no máximo 6.
 */
export function camposRecusadosDoProvedor(texto: string): string[] {
    if (typeof texto !== 'string') return []
    let dados: unknown
    try {
        dados = JSON.parse(texto)
    } catch {
        return []
    }
    const erros = (dados as { errors?: unknown } | null)?.errors
    if (!erros || typeof erros !== 'object' || Array.isArray(erros)) return []
    const campos: string[] = []
    for (const chave of Object.keys(erros)) {
        if (campos.length >= MAXIMO_DE_CAMPOS_NO_LOG) break
        const segmentos = chave.split('.')
        const conhecida = segmentos.every(
            (segmento) => SEGMENTOS_DE_CAMPO_DO_CARRINHO.has(segmento) || REGEX_INDICE_DE_LISTA.test(segmento),
        )
        if (conhecida && !campos.includes(chave)) campos.push(chave)
    }
    return campos
}
