/**
 * Telefone brasileiro só com dígitos, sem o código do país.
 *
 * WhatsApp colado como "+55 34 99999-1234" tem 13 dígitos; as máscaras liam
 * o "55" como DDD e cortavam os últimos. Aqui: fica só com dígitos e, se
 * sobrarem 12 ou 13 começando por 55, tira o 55. Com 10 ou 11 dígitos o "55"
 * é DDD de verdade (Rio Grande do Sul) e fica. Número estrangeiro (12+
 * dígitos sem 55 na frente) passa como está.
 *
 * `colagem: false` é a digitação tecla a tecla: ali o 55 NUNCA é tirado. Quem
 * tem DDD 55 e digita um 12º dígito por engano veria o número virar outro
 * (o "55" lido como país); na digitação o excedente é cortado pela máscara.
 *
 * ZERO NA FRENTE: DDD brasileiro nunca começa com 0. O "0" inicial é o
 * prefixo de tronco ("034 99999-1234") e é descartado na colagem e na
 * digitação — sem isso a máscara lia "03" como DDD e o número virava outro.
 * Só na colagem, "0" + 2 dígitos de operadora + DDD + número ("014 34
 * 99999-1234", sobram 12 ou 13 dígitos) também perde a operadora. "00" é
 * discagem internacional: só os zeros saem ("0055 34…" cai no 55 do país).
 */
export function limparTelefoneBrasileiro(
  valor: string | null | undefined,
  opcoes: { colagem?: boolean } = {},
): string {
  const colagem = opcoes.colagem ?? true;
  let digitos = (valor || "").replace(/\D/g, "");
  if (digitos.startsWith("0")) {
    const comOperadora = !digitos.startsWith("00");
    digitos = digitos.replace(/^0+/, "");
    if (
      colagem &&
      comOperadora &&
      (digitos.length === 12 || digitos.length === 13) &&
      !digitos.startsWith("55")
    ) {
      digitos = digitos.slice(2);
    }
  }
  if (
    colagem &&
    (digitos.length === 12 || digitos.length === 13) &&
    digitos.startsWith("55")
  ) {
    return digitos.slice(2);
  }
  return digitos;
}

/**
 * O campo recebeu uma COLAGEM (ou preenchimento automático)? Sim quando o
 * texto começa com "+" ou quando ganhou 2+ dígitos de uma vez em relação ao
 * valor anterior. Digitação tecla a tecla ganha 1; apagar ganha menos que 0.
 */
export function ehColagemDeTelefone(novo: string, anterior: string): boolean {
  if ((novo || "").trim().startsWith("+")) return true;
  const ganho =
    (novo || "").replace(/\D/g, "").length -
    (anterior || "").replace(/\D/g, "").length;
  return ganho >= 2;
}

/**
 * Dígitos do campo depois de uma alteração. `anterior` ausente (valor que
 * veio de fora, como o WhatsApp do perfil) conta como colagem.
 */
export function digitosDoTelefoneDoCampo(
  novo: string,
  anterior?: string,
): string {
  const colagem =
    anterior === undefined ? true : ehColagemDeTelefone(novo, anterior);
  return limparTelefoneBrasileiro(novo, { colagem });
}

/**
 * Máscara do WhatsApp do checkout e da busca de pedido: "(DD) NNNNN-NNNN",
 * no máximo 11 dígitos (o excedente da digitação é cortado).
 */
export function mascaraWhatsappBr(novo: string, anterior?: string): string {
  const numbers = digitosDoTelefoneDoCampo(novo, anterior);
  if (numbers.length <= 2) return numbers;
  if (numbers.length <= 7)
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7, 11)}`;
}

/**
 * Máscara do telefone do cadastro. Até 11 dígitos formata; acima disso
 * (número estrangeiro ou excedente da digitação) mantém o texto, cortado em
 * 15 caracteres, como sempre foi.
 */
export function mascaraTelefoneDoCadastro(
  novo: string,
  anterior?: string,
): string {
  const numbers = digitosDoTelefoneDoCampo(novo, anterior);
  if (numbers.length <= 11) {
    let formatted = numbers;
    if (numbers.length > 2)
      formatted = `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
    if (numbers.length > 7)
      formatted = `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7, 11)}`;
    return formatted;
  }
  return novo.slice(0, 15);
}
