// Texto do teste de transportadora que a LOJISTA lê. O detalhe de um serviço
// que não cotou vem do provedor (Frenet, Melhor Envio, SuperFrete) e pode ser
// inglês técnico ("Service unavailable", corpo de erro, status HTTP). Só passa
// para a tela o que parece frase curta em português; o resto vira a frase
// fixa, e o texto cru fica no console (`registrarServicosQueNaoCotaram`).

export const FRASE_SERVICO_NAO_COTOU =
  "não conseguiu cotar agora — tente de novo em instantes";

/** Cara de texto técnico: JSON, URL, código HTTP ou vocabulário de erro. */
const PARECE_TECNICO =
  /[{}[\]<>]|https?:|\b\d{3}\b|\b(?:status|error|exception|unavailable|timeout|timed out|invalid|failed|failure|not found|forbidden|unauthorized|gateway|internal|server|undefined|null|bad request)\b/i;

/** Cara de português: letra acentuada ou palavra comum da língua. */
const PARECE_PORTUGUES =
  /[áàâãéêíóôõúç]|\b(?:n[ãa]o|de|do|da|dos|das|para|com|sem|em|no|na|por|uma|ou|que|fora|acima|abaixo)\b/i;

function detalheEmPortuguesSimples(detalhe: string): boolean {
  return !PARECE_TECNICO.test(detalhe) && PARECE_PORTUGUES.test(detalhe);
}

/** Linha de um serviço que não cotou: com o motivo, quando ele é uma frase
 * em português; senão, a frase fixa. Sem detalhe, "erro do serviço". */
export function textoDoServicoQueNaoCotou(detalhe: string | undefined): string {
  if (detalhe === undefined) return "não cotou (erro do serviço)";
  return detalheEmPortuguesSimples(detalhe)
    ? `não cotou (${detalhe})`
    : FRASE_SERVICO_NAO_COTOU;
}

/** O detalhe original do provedor vai para o console, não para a tela. */
export function registrarServicosQueNaoCotaram(
  provedor: string,
  servicos:
    | readonly {
        readonly codigo: string;
        readonly ok: boolean;
        readonly detalhe?: string;
      }[]
    | undefined,
): void {
  for (const s of servicos ?? []) {
    if (!s.ok && s.detalhe) {
      console.warn(
        `[TransportadorasCard] ${provedor}: serviço ${s.codigo} não cotou:`,
        s.detalhe,
      );
    }
  }
}
