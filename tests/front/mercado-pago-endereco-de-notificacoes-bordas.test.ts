// Caça de provas fracas (24/11/2026), tela "Mercado Pago" de Ajustes: o
// endereço de notificações (webhook) que o prompt manda a lojista colar no
// painel do Mercado Pago. Endereço torto nunca pode ir para o prompt como se
// fosse o certo: sem origem válida o prompt PEDE o endereço, não inventa.
// Bordas que a suíte antiga não fechava: espaço em volta (copiar e colar da
// configuração) e lixo ANTES do "https://".
import { describe, expect, it } from "vitest";

import { urlDeNotificacoesDoWebhook } from "@/components/admin/settings/mercado-pago-conteudo";

const ALVO = "https://x.supabase.co/functions/v1/webhook-mercadopago";

describe("urlDeNotificacoesDoWebhook: origem válida", () => {
  it.each([
    ["espaços e quebra de linha em volta", "  \n https://x.supabase.co \t\n"],
    ["barra no fim", "https://x.supabase.co/"],
    ["várias barras no fim", "https://x.supabase.co///"],
    ["espaço E barra", " https://x.supabase.co/ "],
  ])("%s => endereço certo", (_nome, entrada) => {
    expect(urlDeNotificacoesDoWebhook(entrada)).toBe(ALVO);
  });
});

describe("urlDeNotificacoesDoWebhook: o que NÃO é uma origem", () => {
  it.each([
    ["lixo antes do https", "xhttps://x.supabase.co"],
    ["texto antes", "endereço: https://x.supabase.co"],
    ["protocolo ftp", "ftp://x.supabase.co"],
    ["sem protocolo", "x.supabase.co"],
    ["só o protocolo", "https://"],
    ["com caminho", "https://x.supabase.co/rest/v1"],
    ["com espaço no meio", "https://x supabase.co"],
    ["vazio", ""],
    ["só espaços", "   "],
    ["null", null],
    ["undefined", undefined],
  ])("%s => null", (_nome, entrada) => {
    expect(urlDeNotificacoesDoWebhook(entrada)).toBeNull();
  });
});
