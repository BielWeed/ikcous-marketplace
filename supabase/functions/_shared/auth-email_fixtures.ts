// Somente dados fictícios e helpers de teste. Nunca lê ambiente ou rede.
import { Webhook } from "https://esm.sh/standardwebhooks@1.1.1?target=deno";
import { CHAVE_CIFRA_TESTE } from "./email-da-loja_fixtures.ts";

const SEGREDO = btoa("segredo-do-hook-totalmente-ficticio");
export const AMBIENTE_HOOK = {
  SEND_EMAIL_HOOK_SECRET: `v1,whsec_${SEGREDO}`,
  SUPABASE_URL: "https://projeto.exemplo.com",
  MP_CHAVES_ENCRYPTION_KEY: CHAVE_CIFRA_TESTE,
};

export function payload(acao = "signup") {
  return {
    user: {
      id: "usuario-ficticio",
      email: "cliente@example.com",
      new_email: "novo@example.com",
    },
    email_data: {
      email_action_type: acao,
      old_email: "antigo@example.com",
      token: "123456",
      token_hash: "hash-atual-ficticio",
      token_new: "",
      token_hash_new: "",
      redirect_to: 'https://loja.example.com/?type=recovery&origem="email"',
      site_url: "https://host-nao-confiavel.example.com",
    },
  };
}

export function requisicaoAssinada(
  corpo: unknown = payload(),
  opcoes: { assinatura?: string; quando?: Date; texto?: string } = {},
) {
  const texto = opcoes.texto ?? JSON.stringify(corpo);
  const quando = opcoes.quando ?? new Date();
  return new Request("https://host-do-pedido-inseguro.example.com", {
    method: "POST",
    headers: {
      "webhook-id": "evento-ficticio",
      "webhook-timestamp": String(Math.floor(quando.getTime() / 1000)),
      "webhook-signature": opcoes.assinatura ??
        new Webhook(SEGREDO).sign("evento-ficticio", quando, texto),
      "Content-Type": "application/json",
    },
    body: texto,
  });
}
