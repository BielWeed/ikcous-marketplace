const ROBOS =
  /whatsapp|facebookexternalhit|twitterbot|telegrambot|slackbot|googlebot|bingbot|baiduspider|yandexbot/i;

export const VARY_DA_PREVIA = "user-agent, sec-fetch-dest, sec-fetch-mode";

export function ehRoboDaPrevia(cabecalhos: Headers): boolean {
  if (!ROBOS.test(cabecalhos.get("user-agent") ?? "")) return false;

  // O navegador embutido do WhatsApp pode ter o mesmo nome do robô no UA.
  // Destino de documento basta quando o navegador não envia o modo.
  const modo = cabecalhos.get("sec-fetch-mode");
  const navegacao =
    cabecalhos.get("sec-fetch-dest") === "document" &&
    (modo === "navigate" || modo === null);
  return !navegacao;
}
