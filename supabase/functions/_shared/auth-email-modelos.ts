import { escaparHtml } from "./pedido.ts";

type Conteudo = { assunto: string; mensagem: string; botao?: string };
const MODELOS = new Map<string, Conteudo>([
  ["signup", {
    assunto: "Confirme seu cadastro",
    mensagem: "Confirme seu e-mail para concluir seu cadastro.",
    botao: "Confirmar cadastro",
  }],
  ["recovery", {
    assunto: "Redefina sua senha",
    mensagem:
      "Você pediu para redefinir sua senha. Use o link ou digite o código na tela de recuperação.",
    botao: "Redefinir senha",
  }],
  ["magiclink", {
    assunto: "Seu acesso",
    mensagem: "Use o link ou o código para entrar na sua conta.",
    botao: "Entrar na loja",
  }],
  ["email", {
    assunto: "Seu acesso",
    mensagem: "Use o link ou o código para entrar na sua conta.",
    botao: "Entrar na loja",
  }],
  ["invite", {
    assunto: "Seu convite",
    mensagem: "Você recebeu um convite para criar sua conta na loja.",
    botao: "Aceitar convite",
  }],
  ["email_change", {
    assunto: "Confirme a troca de e-mail",
    mensagem:
      "Você pediu para trocar o e-mail da sua conta. Confirme esta alteração.",
    botao: "Confirmar e-mail",
  }],
  ["reauthentication", {
    assunto: "Seu código de confirmação",
    mensagem:
      "Use este código para confirmar a ação que você solicitou na sua conta.",
  }],
  ["password_changed_notification", {
    assunto: "Sua senha foi alterada",
    mensagem: "A senha da sua conta foi alterada.",
  }],
  ["email_changed_notification", {
    assunto: "Seu e-mail foi alterado",
    mensagem: "O e-mail da sua conta foi alterado.",
  }],
  ["phone_changed_notification", {
    assunto: "Seu telefone foi alterado",
    mensagem: "O telefone da sua conta foi alterado.",
  }],
  ["identity_linked_notification", {
    assunto: "Novo acesso vinculado",
    mensagem: "Um provedor de acesso foi vinculado à sua conta.",
  }],
  ["identity_unlinked_notification", {
    assunto: "Acesso desvinculado",
    mensagem: "Um provedor de acesso foi desvinculado da sua conta.",
  }],
  ["mfa_factor_enrolled_notification", {
    assunto: "Proteção adicionada",
    mensagem: "Um fator de autenticação foi adicionado à sua conta.",
  }],
  ["mfa_factor_unenrolled_notification", {
    assunto: "Proteção removida",
    mensagem: "Um fator de autenticação foi removido da sua conta.",
  }],
]);

export function modeloAuth(acao: string): Conteudo {
  const modelo = MODELOS.get(acao);
  if (!modelo) throw new Error("acao_desconhecida");
  return modelo;
}

/** Conteúdo simples, sem rastreamento; todo valor variável é escapado no HTML. */
export function renderizarEmailAuth(
  acao: string,
  nomeDaLoja: string,
  codigo?: string,
  link?: string,
): { assunto: string; html: string; texto: string } {
  const modelo = modeloAuth(acao);
  const nome = Array.from(
    nomeDaLoja,
    (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? " " : c,
  )
    .join("").trim() || "Nossa loja";
  const rodape = acao.endsWith("_notification")
    ? "Se você não reconhece esta alteração, entre em contato com a loja."
    : "Se você não solicitou esta ação, ignore este e-mail. Nunca compartilhe seu código.";
  return {
    assunto: `${modelo.assunto} — ${nome}`,
    texto: [
      nome,
      modelo.mensagem,
      ...(codigo ? [`Código: ${codigo}`] : []),
      ...(link ? [`${modelo.botao}: ${link}`] : []),
      rodape,
    ].join("\n\n"),
    html: `<!doctype html><html lang="pt-BR"><body>
<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#18181b">
<h1 style="font-size:22px">${escaparHtml(nome)}</h1>
<p>${escaparHtml(modelo.mensagem)}</p>
${codigo ? `<p>Código: <strong>${escaparHtml(codigo)}</strong></p>` : ""}
${
      link
        ? `<p><a href="${escaparHtml(link)}">${
          escaparHtml(modelo.botao)
        }</a></p>`
        : ""
    }
<p>${escaparHtml(rodape)}</p>
</div></body></html>`,
  };
}
