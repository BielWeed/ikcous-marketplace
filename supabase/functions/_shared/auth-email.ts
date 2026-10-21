import { modeloAuth, renderizarEmailAuth } from "./auth-email-modelos.ts";

export type EmailAuth = {
  para: string;
  assunto: string;
  html: string;
  texto: string;
};

function objeto(valor: unknown): Record<string, unknown> {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    throw new Error("payload_invalido");
  }
  return valor as Record<string, unknown>;
}

function texto(valor: unknown): string {
  if (typeof valor !== "string" || !valor.trim()) {
    throw new Error("payload_invalido");
  }
  return valor;
}

function destinatario(valor: unknown): string {
  const email = texto(valor);
  // Somente UM endereço, nunca lista/cabeçalho/nome interpretável pelo SMTP.
  if (
    email.length > 254 ||
    !/^[^\s@<>,;"\\]+@[^\s@<>,;"\\]+\.[^\s@<>,;"\\]+$/.test(email)
  ) {
    throw new Error("payload_invalido");
  }
  return email;
}

function linkDeVerificacao(
  urlDoProjeto: string,
  hash: unknown,
  acao: string,
  redirect: unknown,
): string {
  const projeto = new URL(urlDoProjeto);
  if (
    projeto.protocol !== "https:" || projeto.username || projeto.password ||
    projeto.pathname !== "/" || projeto.search || projeto.hash
  ) throw new Error("projeto_invalido");
  // Nunca usa site_url nem o host da Request: só o ambiente da própria função.
  const link = new URL("/auth/v1/verify", projeto);
  link.searchParams.set("token", texto(hash));
  link.searchParams.set("type", acao);
  if (typeof redirect !== "string") throw new Error("payload_invalido");
  link.searchParams.set("redirect_to", redirect);
  return link.href;
}

/** Mapeamento puro do contrato do Auth. Não gera nem verifica códigos. */
export function montarEmailsAuth(
  corpo: unknown,
  urlDoProjeto: string,
  nomeDaLoja: string,
): EmailAuth[] {
  const payload = objeto(corpo);
  const user = objeto(payload.user);
  const dados = objeto(payload.email_data);
  const acao = texto(dados.email_action_type);
  modeloAuth(acao); // Lista fechada; desconhecido nunca é confirmação de cadastro.
  const montar = (
    para: unknown,
    codigo?: unknown,
    hash?: unknown,
  ): EmailAuth => ({
    para: destinatario(para),
    ...renderizarEmailAuth(
      acao,
      nomeDaLoja,
      acao.endsWith("_notification") ? undefined : texto(codigo),
      acao.endsWith("_notification") || acao === "reauthentication"
        ? undefined
        : linkDeVerificacao(
          urlDoProjeto,
          hash,
          acao,
          dados.redirect_to,
        ),
    ),
  });
  // O Auth já trocou user.email quando emite este aviso; alerta o endereço antigo.
  if (acao === "email_changed_notification") return [montar(dados.old_email)];
  if (acao.endsWith("_notification")) return [montar(user.email)];
  if (acao === "reauthentication") return [montar(user.email, dados.token)];
  if (acao === "email_change") {
    if (dados.token_hash_new) {
      // Compatibilidade histórica do Auth: os nomes dos HASHES são invertidos.
      return [
        montar(user.email, dados.token, dados.token_hash_new),
        montar(user.new_email, dados.token_new, dados.token_hash),
      ];
    }
    return [
      montar(user.new_email, dados.token_new || dados.token, dados.token_hash),
    ];
  }
  return [montar(user.email, dados.token, dados.token_hash)];
}
