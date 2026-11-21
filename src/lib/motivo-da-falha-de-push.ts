export const AVISO_PUSH_PODE_CHEGAR =
  "O aviso ainda pode chegar; confira antes de reenviar";

type FalhaDePush = {
  status?: unknown;
  motivo?: unknown;
  quantidade?: unknown;
};

export function falhaDePushSemConfirmacao(falha: FalhaDePush): boolean {
  // O motivo vem de esperarComLimite (webpush.ts), sem código HTTP.
  return (
    typeof falha.motivo === "string" &&
    falha.motivo.startsWith("Sem resposta do serviço de push dentro do prazo;")
  );
}

function statusDaFalha(falha: FalhaDePush): number {
  // O código numérico tem prioridade; o texto técnico é a reserva.
  return typeof falha.status === "number"
    ? falha.status
    : Number(
        /push service respondeu (\d{3})/i.exec(String(falha.motivo ?? ""))?.[1],
      );
}

export function motivoDaFalhaEmPortugues(falha: FalhaDePush): string {
  if (falhaDePushSemConfirmacao(falha)) return "envio sem confirmação";

  const status = statusDaFalha(falha);
  if (status === 404 || status === 410)
    return Number(falha.quantidade) > 1
      ? "esses aparelhos não recebem mais avisos (as inscrições venceram)"
      : "esse aparelho não recebe mais avisos (a inscrição venceu)";
  if (status === 401 || status === 403)
    return "o serviço de avisos recusou o envio";
  if (status === 413) return "mensagem grande demais";
  if (status === 429) return "muitos envios, tente daqui a pouco";
  if (status >= 500) return "o serviço de avisos está fora do ar agora";
  return "motivo não identificado";
}

export function descricaoDePushSemConfirmacao(
  falhas: readonly FalhaDePush[],
): string {
  const recusas = falhas
    .filter((falha) =>
      [401, 403, 404, 410, 413, 429].includes(statusDaFalha(falha)),
    )
    .map((falha) => `${falha.quantidade}x ${motivoDaFalhaEmPortugues(falha)}`);
  return recusas.length
    ? `${AVISO_PUSH_PODE_CHEGAR}. Recusas confirmadas: ${recusas.join("; ")}.`
    : `${AVISO_PUSH_PODE_CHEGAR}.`;
}

export function contarPushSemConfirmacao(
  falhas: readonly FalhaDePush[] = [],
): number {
  return falhas.reduce((total, falha) => {
    const { quantidade } = falha;
    return falhaDePushSemConfirmacao(falha) &&
      typeof quantidade === "number" &&
      Number.isInteger(quantidade) &&
      quantidade > 0
      ? total + quantidade
      : total;
  }, 0);
}
