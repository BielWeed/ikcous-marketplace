// Quando a LOJA não consegue mandar e-mail (confirmação do cadastro, reenvio
// dela, link de recuperação de senha), a cliente não pode ler "tente
// novamente" nem "muitas tentativas": a causa não é dela, e repetir não
// conserta. Sem import de runtime de propósito (mesmo motivo de
// `mensagens-auth.ts`): os testes leem estas frases sem arrastar o cliente do
// Supabase.
//
// Sinais conferidos na doc oficial
// (https://supabase.com/docs/guides/auth/debugging/error-codes) e na fonte do
// supabase/auth (internal/api/mail.go, internal/api/errors.go):
// - `email_address_not_authorized` (400, "Email address "<e-mail>" cannot be
//   used as it is not authorized"): projeto no SMTP padrão, que só manda para
//   membros da organização — o caso da loja nova sem SMTP nem gancho ligado.
// - 500 "Error sending confirmation email" / "Error sending recovery email":
//   o envio falhou no SMTP próprio ou no gancho de e-mail.
// - `over_email_send_rate_limit` (429) sai por DUAS causas com o mesmo
//   código: o limite de e-mails do projeto inteiro (mensagem "email rate limit
//   exceeded") e o intervalo POR ENDEREÇO ("For security purposes, you can
//   only request this after N seconds."). Só o primeiro é da loja; o segundo é
//   a própria cliente pedindo de novo cedo e fica com a frase de cada fluxo,
//   assim como o código sem nenhuma das duas mensagens.
//
// - Gancho de e-mail da loja ("Send Email Hook", edge `auth-send-email`, que
//   manda pelo Gmail da loja e responde 500 em toda falha): o Auth NÃO repassa
//   o corpo da edge (internal/hooks/hookshttp/hookshttp.go, `runHTTPHook`) e
//   devolve o erro sem embrulho (mail.go, `sendConfirmation` e
//   `sendPasswordRecovery` repassam o `*HTTPError` como veio). Chega 500
//   `unexpected_failure` com mensagem de gancho ("Unexpected status code
//   returned from hook: 500", "Service currently unavailable due to hook"…)
//   ou 422 `hook_timeout` / `hook_timeout_after_retry` (o gancho não respondeu
//   no prazo). Pode ser passageiro (Gmail fora do ar, partida fria), então é
//   categoria PRÓPRIA, não "loja sem envio": a frase manda tentar de novo e só
//   então avisar a loja. `unexpected_failure` sem "hook" na mensagem continua
//   genérico (é o mesmo código de qualquer 500 do Auth).
//
// `email_provider_disabled` NÃO entra: é o cadastro por e-mail desligado na
// loja, não falha de envio.
//
// Enumeração (#120): estes erros só existem quando o servidor TENTA mandar o
// e-mail, e na recuperação isso só acontece para conta existente — o que já
// separava "erro" de "sucesso" antes desta frase. Nomear a causa não acrescenta
// nada sobre a conta.

export type FalhaDeEnvioDeEmail =
  | "loja_sem_envio"
  | "envio_da_loja_falhou"
  | "limite_da_loja";

export const MENSAGEM_CADASTRO_LOJA_SEM_ENVIO =
  "Esta loja não está conseguindo enviar e-mails de confirmação agora, então o cadastro por e-mail não foi concluído. Avise a loja para ela resolver.";

export const MENSAGEM_REENVIO_LOJA_SEM_ENVIO =
  "Esta loja não está conseguindo enviar e-mails de confirmação agora. Avise a loja para ela resolver.";

export const MENSAGEM_RECUPERACAO_LOJA_SEM_ENVIO =
  "Esta loja não está conseguindo enviar e-mails de recuperação de senha agora. Avise a loja para ela resolver.";

export const MENSAGEM_CADASTRO_ENVIO_DA_LOJA_FALHOU =
  "A loja não conseguiu enviar o e-mail de confirmação agora, então o cadastro por e-mail não foi concluído. Tente de novo em alguns minutos; se continuar, avise a loja.";

export const MENSAGEM_REENVIO_ENVIO_DA_LOJA_FALHOU =
  "A loja não conseguiu enviar o e-mail de confirmação agora. Tente de novo em alguns minutos; se continuar, avise a loja.";

export const MENSAGEM_RECUPERACAO_ENVIO_DA_LOJA_FALHOU =
  "A loja não conseguiu enviar o e-mail de recuperação de senha agora. Tente de novo em alguns minutos; se continuar, avise a loja.";

export const MENSAGEM_LIMITE_DE_EMAIL_DA_LOJA =
  "A loja atingiu o limite de envio de e-mails por agora. Tente de novo daqui a alguns minutos.";

interface ErroDoAuth {
  readonly code?: unknown;
  readonly message?: unknown;
}

export function falhaDeEnvioDeEmail(
  erro: ErroDoAuth | null | undefined,
): FalhaDeEnvioDeEmail | null {
  if (!erro) return null;
  const codigo = typeof erro.code === "string" ? erro.code : "";
  const mensagem = typeof erro.message === "string" ? erro.message : "";
  if (
    codigo === "email_address_not_authorized" ||
    /cannot be used as it is not authorized/i.test(mensagem) ||
    /error sending (confirmation|recovery) email/i.test(mensagem)
  ) {
    return "loja_sem_envio";
  }
  if (
    codigo === "hook_timeout" ||
    codigo === "hook_timeout_after_retry" ||
    (codigo === "unexpected_failure" && /\bhook\b/i.test(mensagem))
  ) {
    return "envio_da_loja_falhou";
  }
  // Só a mensagem separa o limite da loja do intervalo por endereço; código
  // sozinho (mensagem desconhecida) fica com a frase de antes de cada fluxo.
  if (/email rate limit exceeded/i.test(mensagem)) return "limite_da_loja";
  return null;
}

/** O servidor ecoa o endereço na mensagem: ele não vai ao console. */
export function semEnderecoDeEmail(mensagem: unknown): unknown {
  return typeof mensagem === "string"
    ? mensagem.replace(/[^\s"'<>@]+@[^\s"'<>@]+/g, "[e-mail]")
    : mensagem;
}
