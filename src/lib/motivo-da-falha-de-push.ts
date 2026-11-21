export const AVISO_PUSH_PODE_CHEGAR =
  "O aviso ainda pode chegar. Se reenviar agora, quem já recebeu pode receber a mesma mensagem de novo";

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
  aviso = AVISO_PUSH_PODE_CHEGAR,
): string {
  const recusas: string[] = [];
  let outrasFalhas = 0;
  let outrasSemContagem = false;
  for (const falha of falhas) {
    if (falhaDePushSemConfirmacao(falha)) continue;
    if ([401, 403, 404, 410, 413, 429].includes(statusDaFalha(falha))) {
      recusas.push(`${falha.quantidade}x ${motivoDaFalhaEmPortugues(falha)}`);
    } else {
      const { quantidade } = falha;
      if (
        typeof quantidade === "number" &&
        Number.isSafeInteger(quantidade) &&
        quantidade > 0
      ) {
        outrasFalhas += quantidade;
      } else {
        outrasSemContagem = true;
      }
    }
  }
  const descricao = [`${aviso}.`];
  if (recusas.length)
    descricao.push(`Recusas confirmadas: ${recusas.join("; ")}.`);
  if (outrasSemContagem) {
    descricao.push("Também houve outras falhas de envio.");
  } else if (outrasFalhas > 0) {
    descricao.push(
      `Outras falhas: ${outrasFalhas} ${outrasFalhas === 1 ? "aparelho" : "aparelhos"}.`,
    );
  }
  return descricao.join(" ");
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
