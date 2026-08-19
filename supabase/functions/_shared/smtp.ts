// @ts-nocheck
/**
 * O unico lugar do projeto que fala SMTP.
 *
 * PORTA 465, E NAO 587
 *   Medido na propria edge function em 19/08/2026, com uma sonda descartavel:
 *   a 465 abre em 48 ms e `verify()` autentica com a senha de aplicativo do
 *   Gmail. A doc do Supabase declara que "outgoing connections to ports 25 and
 *   587 are not allowed" — e a 587 e' justamente a porta que o painel de Auth
 *   usa e que funciona LA, porque o GoTrue nao e' a edge function. Confundir os
 *   dois lados ja custou tempo antes.
 *
 *   (No mesmo teste o TCP da 587 tambem abriu, contra a doc. NAO tome isso como
 *   permissao: so' o TCP foi medido, nunca a autenticacao por ela. O que esta'
 *   provado ponta a ponta e' a 465.)
 *
 * npm:nodemailer@9.0.5
 *   Tambem medido na mesma sonda: roda neste runtime, importado por
 *   especificador `npm:`, sem gambiarra. O relato de que "nodemailer nao roda
 *   em edge function" vale para Deno Deploy, que NAO e' o mesmo produto.
 *
 * A SENHA NUNCA SAI DAQUI
 *   Nem em log, nem em mensagem de erro, nem em resposta HTTP. O erro do
 *   transporte e' reembrulhado antes de subir, porque ele carrega a config
 *   inteira junto — e config inclui a senha. `remetenteConfigurado()` devolve
 *   booleano exatamente para quem chama poder decidir sem ler o valor.
 *
 * POR QUE LANCA EM VEZ DE DEVOLVER `false`
 *   Quem chama precisa da causa para decidir o que dizer na tela. Engolir a
 *   excecao aqui recriaria o defeito que esta inversao existe para matar: a
 *   promessa de entrega que ninguem sabe se aconteceu (#86).
 *
 * POR QUE O IMPORT E' TARDIO, E NAO NO TOPO
 *   `npm run test:edge` roda `deno test` sobre esta pasta numa maquina que tem
 *   node_modules do npm. Vendo node_modules, o Deno se recusa a resolver
 *   `npm:` sozinho e o import ESTATICO derruba a suite inteira com
 *   "Could not find a matching package" — no CI tambem, que roda `npm ci`
 *   antes. Medido em 19/08/2026.
 *
 *   Import dentro da funcao resolve isso sem trocar o especificador `npm:`,
 *   que e' o unico que foi PROVADO no runtime da edge function. De quebra, loja
 *   com SMTP nao configurado nunca paga o custo de carregar a biblioteca.
 *
 *   O preco, dito na cara: nenhum teste desta suite chega a carregar o
 *   nodemailer, entao o CI nao prova que ele carrega. Quem provou foi a sonda,
 *   no ar. Se um dia o import quebrar, o sintoma aparece no envio, nao no CI.
 */

const HOST = "smtp.gmail.com";
const PORTA = 465;

/** Os dois segredos presentes. Meio configurado conta como nao configurado. */
export function remetenteConfigurado(): boolean {
  return (
    Boolean(Deno.env.get("SMTP_USER")) && Boolean(Deno.env.get("SMTP_PASSWORD"))
  );
}

export async function enviarEmail(
  { para, assunto, html }: { para: string; assunto: string; html: string },
): Promise<void> {
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASSWORD");
  if (!user || !pass) {
    throw new Error("SMTP nao configurado: falta SMTP_USER ou SMTP_PASSWORD");
  }
  if (!para) {
    throw new Error("SMTP: destinatario vazio");
  }

  // Ver o cabecalho: tardio de proposito, para a suite de testes nao morrer na
  // resolucao do especificador `npm:`.
  const { default: nodemailer } = await import("npm:nodemailer@9.0.5");

  const transporter = nodemailer.createTransport({
    host: HOST,
    port: PORTA,
    secure: true,
    auth: { user, pass },
  });

  try {
    await transporter.sendMail({ from: user, to: para, subject: assunto, html });
  } catch (e) {
    // Reembrulha: o erro do nodemailer carrega o objeto de configuracao, e com
    // ele a senha, para o log de quem chamar.
    throw new Error(`SMTP: envio recusado (${e?.code ?? "sem codigo"})`);
  } finally {
    transporter.close?.();
  }
}
