/**
 * Telefone brasileiro só com dígitos, sem o código do país.
 *
 * WhatsApp colado como "+55 34 99999-1234" tem 13 dígitos; as máscaras liam
 * o "55" como DDD e cortavam os últimos. Aqui: fica só com dígitos e, se
 * sobrarem 12 ou 13 começando por 55, tira o 55. Com 10 ou 11 dígitos o "55"
 * é DDD de verdade (Rio Grande do Sul) e fica. Número estrangeiro (12+
 * dígitos sem 55 na frente) passa como está.
 *
 * O "+55" explícito identifica o país mesmo num número ainda incompleto.
 * `colagem: false` preserva o 55 sem "+". Quem tem DDD 55 e digita um
 * 12º dígito por engano não pode ter o número trocado: na digitação sem "+"
 * o excedente é cortado pela máscara, nunca reinterpretado como país.
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
    digitos.startsWith("55") &&
    ((valor || "").trim().startsWith("+55") ||
      (colagem && (digitos.length === 12 || digitos.length === 13)))
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

/** Dígitos de um celular completo (DDD + 9 + 8). */
const DIGITOS_DO_CELULAR = 11;
/** Teto de dígitos que o campo guarda quando passa do celular (excedente visível). */
const MAX_DIGITOS_COM_EXCEDENTE = 15;

/**
 * O que fazer com dígitos além do 11º. NUNCA cortar em silêncio: "1198765432199"
 * colado virava "(11) 98765-4321", um celular válido, e a cliente não via que o
 * número mudou. O excedente fica na tela, `celularBrasileiroCompleto` reprova e
 * a mensagem de erro que já existe aparece. Única exceção: a tecla extra
 * digitada NO FIM de um número já completo é ignorada, porque o número na tela
 * continua exatamente o de antes (quem tem DDD 55 e erra um dígito não perde
 * nada). Colagem enorme é limitada a 15 dígitos, o que continua reprovando.
 */
function digitosComExcedenteVisivel(
  digitos: string,
  anterior: string | undefined,
): string {
  if (digitos.length <= DIGITOS_DO_CELULAR) return digitos;
  const antes = (anterior ?? "").replace(/\D/g, "");
  if (
    antes.length === DIGITOS_DO_CELULAR &&
    digitos.length === DIGITOS_DO_CELULAR + 1 &&
    digitos.startsWith(antes)
  ) {
    return antes;
  }
  return digitos.slice(0, MAX_DIGITOS_COM_EXCEDENTE);
}

/**
 * Máscara do WhatsApp do checkout e da busca de pedido: "(DD) NNNNN-NNNN".
 * Dígitos além do 11º ficam depois do hífen (ver `digitosComExcedenteVisivel`),
 * para a validação reprovar em vez de a máscara trocar o número.
 */
export function mascaraWhatsappBr(novo: string, anterior?: string): string {
  if (/^\+5{0,2}$/.test(novo.trim())) return novo.trim();
  const numbers = digitosComExcedenteVisivel(
    digitosDoTelefoneDoCampo(novo, anterior),
    anterior,
  );
  if (numbers.length <= 2) return numbers;
  if (numbers.length <= 7)
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
}

/**
 * O WhatsApp do checkout é um CELULAR COMPLETO: DDD + 9 + 8 dígitos (11).
 * Conta DÍGITOS, nunca caracteres do texto formatado — com 10 dígitos a
 * máscara já chega a 14 caracteres ("(34) 98887-777"), e a régua antiga
 * (`length >= 14`) liberava o Finalizar com um número que não existe.
 * Aceita o texto da máscara, o número cru e o colado com +55.
 */
export function celularBrasileiroCompleto(
  valor: string | null | undefined,
): boolean {
  const digitos = limparTelefoneBrasileiro(valor);
  return digitos.length === 11 && digitos[2] === "9";
}

/** Texto do erro do campo WhatsApp do checkout quando o celular não está completo. */
export function mensagemDeWhatsappIncompleto(
  valor: string | null | undefined,
): string {
  const quantidade = limparTelefoneBrasileiro(valor).length;
  return quantidade === 10
    ? "Confira o WhatsApp: faltou um número (DDD + 9 + 8 dígitos)"
    : "Confira o WhatsApp: precisa de DDD + 9 + 8 dígitos";
}

/**
 * WhatsApp da LOJA para mostrar na tela: "(34) 99802-8216". O número da loja
 * costuma estar guardado com o 55 do país (13 dígitos); sem tirá-lo a máscara
 * não cabe e o número aparecia cru. Fixo (10 dígitos) e celular (11) formatam;
 * qualquer outro formato volta como veio — não inventa nem corta dígito.
 * Só para exibir: o link do WhatsApp continua usando o número gravado.
 */
export function telefoneDaLojaParaExibicao(
  valor: string | null | undefined,
): string {
  const nacional = limparTelefoneBrasileiro(valor);
  if (nacional.length === 11)
    return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 7)}-${nacional.slice(7)}`;
  if (nacional.length === 10)
    return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 6)}-${nacional.slice(6)}`;
  return valor ?? "";
}

/**
 * Máscara do telefone do cadastro. Até 11 dígitos formata; acima disso
 * (número estrangeiro ou excedente da digitação) mantém o texto, cortado em
 * 15 caracteres, como sempre foi — desde que o corte não leve dígito embora.
 * Se levaria ("(11) 98765-4321 99" tem 18 caracteres), o corte deixaria um
 * celular válido no lugar do que foi colado: ficam os dígitos (até 15), e a
 * validação reprova. A tecla extra no fim de um número completo é ignorada
 * (ver `digitosComExcedenteVisivel`).
 */
export function mascaraTelefoneDoCadastro(
  novo: string,
  anterior?: string,
): string {
  if (/^\+5{0,2}$/.test(novo.trim())) return novo.trim();
  const numbers = digitosComExcedenteVisivel(
    digitosDoTelefoneDoCampo(novo, anterior),
    anterior,
  );
  if (numbers.length <= 11) {
    let formatted = numbers;
    if (numbers.length > 2)
      formatted = `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
    if (numbers.length > 7)
      formatted = `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7, 11)}`;
    return formatted;
  }
  const corte = novo.slice(0, 15);
  return corte.replace(/\D/g, "").length === novo.replace(/\D/g, "").length
    ? corte
    : numbers;
}
