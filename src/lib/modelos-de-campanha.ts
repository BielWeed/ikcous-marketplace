/**
 * Modelos prontos da tela "Avisar clientes" e as regras puras que os cercam.
 *
 * Por que existe: os modelos antigos preenchiam "Use o cupom BEMVINDO" e
 * "10% OFF ativo por 1 hora" sem que a loja tivesse criado cupom nenhum — a
 * cliente digitava o código e lia "O cupom BEMVINDO não existe". Um modelo
 * não sabe qual cupom a lojista criou, então ele NÃO inventa código nem
 * desconto: deixa o MARCADOR no lugar do código, e a tela trava o envio
 * enquanto o marcador estiver no texto.
 */

import { normalizarCodigoDoCupom } from "@/lib/codigo-do-cupom";

/** Onde o código do cupom da lojista entra. Nunca deve chegar a um cliente. */
export const MARCADOR_DO_CUPOM = "[CÓDIGO DO SEU CUPOM]";

export interface MensagemDeCampanha {
  readonly title: string;
  readonly body: string;
  readonly url: string;
}

export interface ModeloDeCampanha {
  readonly id: "fomo" | "auth" | "value";
  /** Nome na pílula. */
  readonly title: string;
  /** Dica ao passar o mouse sobre a pílula. */
  readonly desc: string;
  readonly mensagem: MensagemDeCampanha;
}

/**
 * Os três modelos. Regra de ouro: nenhum cita código fixo, percentual, valor
 * em reais, prazo ou frete — tudo isso é decisão da lojista (cupom que ela
 * criou), não do modelo. Limites da notificação: título 60, texto 140.
 */
export const MODELOS_DE_CAMPANHA = {
  fomo: {
    id: "fomo",
    title: "Oferta com cupom",
    desc: "Avisa de um cupom seu — você escolhe o código",
    mensagem: {
      title: `Oferta na loja: use ${MARCADOR_DO_CUPOM} ⚡`,
      body: `Use o cupom ${MARCADOR_DO_CUPOM} na sua compra e aproveite o desconto na loja.`,
      url: "/search",
    },
  },
  auth: {
    id: "auth",
    title: "Lembrete de Carrinho",
    desc: "Lembrar de finalizar compra",
    mensagem: {
      title: "Seu carrinho de compras está te esperando! 🛒",
      body: "Finalize seu pedido agora e garanta seus produtos com rapidez. Não perca!",
      url: "/cart",
    },
  },
  value: {
    id: "value",
    title: "Cupom de boas-vindas",
    desc: "Presente de cupom — você escolhe o código",
    mensagem: {
      title: "Presente para você: um cupom! 🎁",
      body: `Use o cupom ${MARCADOR_DO_CUPOM} e garanta um desconto na sua próxima compra na loja.`,
      url: "/profile",
    },
  },
} as const satisfies Record<string, ModeloDeCampanha>;

/**
 * O texto ainda traz o marcador (inteiro, sem acento, em minúsculas ou só o
 * começo "[CÓDIGO")? Sim = a lojista não trocou pelo cupom dela, e enviar
 * mandaria "[CÓDIGO DO SEU CUPOM]" para a clientela.
 */
export function temMarcadorPendente(...textos: readonly string[]): boolean {
  return textos.some((t) => /\[\s*c[óo]digo/i.test(t.normalize("NFC")));
}

/**
 * Códigos de cupom que o texto cita: a palavra "cupom" seguida de uma palavra
 * em MAIÚSCULAS com 3+ caracteres ("Use o cupom BEMVINDO"). Palavra comum
 * ("Cupom Relâmpago", "cupom de desconto") não conta. É uma leitura de
 * apoio, não uma garantia: quem usa outra forma de citar passa sem conferir.
 */
export function codigosDeCupomCitados(...textos: readonly string[]): string[] {
  const achados = new Set<string>();
  const citacao =
    /\b[Cc][Uu][Pp][Oo][Mm]\s+([A-ZÀ-Ý0-9][A-ZÀ-Ý0-9_-]{2,})(?![a-zà-ÿ])/g;
  for (const texto of textos) {
    for (const m of texto.normalize("NFC").matchAll(citacao)) {
      const codigo = m[1].replace(/[-_]+$/, "");
      if (codigo.length >= 3) achados.add(codigo);
    }
  }
  return [...achados];
}

/**
 * Filtro `or` do PostgREST que traz os cupons citados SEM diferenciar maiúscula
 * de minúscula, como o checkout faz (`UPPER(code) = UPPER(...)`). Um código
 * antigo guardado como "Verao10" não pode virar "cupom não existe" só porque o
 * texto cita "VERAO10". O `_` do código vira curinga no `ilike` e pode trazer
 * linha a mais; a conferência final (`problemaDoCupom`) compara exato, então
 * a linha a mais não muda o resultado.
 */
export function filtroDosCodigosCitados(codigos: readonly string[]): string {
  const pedidos = new Set<string>();
  for (const codigo of codigos) {
    for (const grafia of grafiasDoCodigoCitado(codigo)) pedidos.add(grafia);
  }
  return [...pedidos].map((codigo) => `code.ilike.${codigo}`).join(",");
}

/**
 * As grafias que o checkout tenta, na ordem dele (`CouponInput`): primeiro o
 * código como citado, em maiúsculas; depois a versão que o painel grava
 * (`normalizarCodigoDoCupom`, sem acento). "VERÃO10" no texto acha o cupom
 * "VERAO10" que o painel gravou, como no checkout.
 */
function grafiasDoCodigoCitado(codigo: string): string[] {
  const citado = codigo.toUpperCase();
  const normalizado = normalizarCodigoDoCupom(codigo);
  return normalizado && normalizado !== citado
    ? [citado, normalizado]
    : [citado];
}

/**
 * O cupom da loja que o código citado alcança no checkout: a grafia citada
 * vence; a sem acento só vale se a citada não existir. O código GRAVADO não
 * perde o acento (o servidor compara sem ignorá-lo): "VERAO10" no texto não
 * acha um cupom antigo "VERÃO10", e a cliente também não acharia.
 */
export function cupomDoCodigoCitado(
  codigo: string,
  cupons: readonly CupomDaLoja[],
): CupomDaLoja | undefined {
  for (const grafia of grafiasDoCodigoCitado(codigo)) {
    const cupom = cupons.find((c) => c.code.toUpperCase() === grafia);
    if (cupom) return cupom;
  }
  return undefined;
}

/** Só as colunas de `coupons` que a conferência lê. */
export interface CupomDaLoja {
  readonly id?: string;
  readonly code: string;
  readonly active: boolean | null;
  readonly valid_until: string | null;
  readonly usage_limit: number | null;
  readonly usage_count: number | null;
  /**
   * Quem pode usar o cupom ("codigo" | "vitrine" | "exclusivo"). Ausente em
   * banco sem a migration 20261208000000: aí vale como "codigo".
   */
  readonly alcance?: string | null;
}

export type ProblemaDoCupom =
  | "nao-existe"
  | "desativado"
  | "vencido"
  | "esgotado"
  | "exclusivo"
  | "cliente-fora-da-lista";

/**
 * O cupom citado serve para uma cliente usar agora? `null` = serve.
 * O código se procura como o checkout procura (`cupomDoCodigoCitado`): exato
 * primeiro e, se não houver, sem acento — a segunda tentativa do checkout.
 */
export function problemaDoCupom(
  codigo: string,
  cupons: readonly CupomDaLoja[],
  agora: Date,
  opcoes: { readonly clienteNaListaDoCupom?: boolean } = {},
): ProblemaDoCupom | null {
  const cupom = cupomDoCodigoCitado(codigo, cupons);
  if (!cupom) return "nao-existe";
  if (cupom.active === false) return "desativado";
  if (cupom.valid_until && new Date(cupom.valid_until) <= agora) {
    return "vencido";
  }
  // Limite nulo, 0 ou negativo é cupom ilimitado (o formulário de cupom grava
  // 0 = "ilimitado"; o servidor trata `usage_limit <= 0` do mesmo jeito).
  if (
    cupom.usage_limit !== null &&
    cupom.usage_limit !== undefined &&
    cupom.usage_limit > 0 &&
    (cupom.usage_count ?? 0) >= cupom.usage_limit
  ) {
    return "esgotado";
  }
  // Aviso individual só dispensa a ressalva com a conta conferida na lista.
  // Ausente = campanha para mais gente; false = conta conferida, fora da lista.
  if (cupom.alcance === "exclusivo" && !opcoes.clienteNaListaDoCupom) {
    return opcoes.clienteNaListaDoCupom === false
      ? "cliente-fora-da-lista"
      : "exclusivo";
  }
  return null;
}

/** A frase que a lojista lê, em português, para cada problema. */
export function mensagemDoProblemaDoCupom(
  codigo: string,
  problema: ProblemaDoCupom,
): string {
  switch (problema) {
    case "nao-existe":
      return `O cupom ${codigo} não existe na sua loja`;
    case "desativado":
      return `O cupom ${codigo} está desativado`;
    case "vencido":
      return `O cupom ${codigo} já venceu`;
    case "esgotado":
      return `O cupom ${codigo} já usou todos os usos permitidos`;
    case "cliente-fora-da-lista":
      return `O cupom ${codigo} é exclusivo e este cliente não está na lista do cupom`;
    case "exclusivo":
      return `O cupom ${codigo} é exclusivo de clientes escolhidos e este aviso não vai só para eles`;
  }
}
