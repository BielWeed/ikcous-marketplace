// O motivo gravado vem em inglês técnico da função de envio (ex.: "push
// service respondeu 410 Gone"). Aqui só se traduz para exibir; o dado não muda.
// Usado por Avisar clientes e pelo aviso de status do pedido.
export function motivoDaFalhaEmPortugues(falha: {
  status?: unknown;
  motivo?: unknown;
  quantidade?: unknown;
}): string {
  // A função de envio já manda o código numérico; o texto em inglês só serve
  // de reserva.
  const status =
    typeof falha.status === "number"
      ? falha.status
      : Number(
          /push service respondeu (\d{3})/i.exec(
            String(falha.motivo ?? ""),
          )?.[1],
        );
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
