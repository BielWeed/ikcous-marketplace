import { VARY_DA_PREVIA, ehRoboDaPrevia } from "@/hospedagem/roboDaPrevia";
import { describe, expect, it } from "vitest";

/**
 * `src/hospedagem/roboDaPrevia.ts` — QUEM recebe a prévia do link (og:title,
 * og:image) em vez do app. Os testes do worker e do porteiro só exercitavam o
 * robô do WhatsApp, do Facebook e do Google; trocar o nome de qualquer um dos
 * outros seis robôs da lista, ou afrouxar a regra do navegador embutido, passava
 * sem nenhum teste reclamar (caça por mutação, 25/11/2026). Aqui cada nome da
 * lista e cada fronteira da regra do navegador embutido tem o seu caso.
 */

function cabecalhos(init: Record<string, string>): Headers {
  return new Headers(init);
}

// Um user-agent real de cada robô, escrito à mão.
const ROBOS = [
  ["WhatsApp", "WhatsApp/2.23.20.0 A"],
  [
    "Facebook",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  ],
  ["Twitter", "Twitterbot/1.0"],
  ["Telegram", "TelegramBot/1.0 (+https://core.telegram.org/bots)"],
  ["Slack", "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)"],
  [
    "Google",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  ],
  [
    "Bing",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  ],
  [
    "Baidu",
    "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)",
  ],
  [
    "Yandex",
    "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
  ],
] as const;

describe("ehRoboDaPrevia — quem é robô de prévia", () => {
  it.each(ROBOS)(
    "o robô %s, sem cabeçalhos de navegação, recebe a prévia",
    (_nome, userAgent) => {
      expect(ehRoboDaPrevia(cabecalhos({ "user-agent": userAgent }))).toBe(
        true,
      );
    },
  );

  it("o nome do robô vale em qualquer caixa (o user-agent chega como o robô escreveu)", () => {
    expect(ehRoboDaPrevia(cabecalhos({ "user-agent": "WHATSAPP/2.23" }))).toBe(
      true,
    );
    expect(ehRoboDaPrevia(cabecalhos({ "user-agent": "YANDEXBOT/3.0" }))).toBe(
      true,
    );
    expect(ehRoboDaPrevia(cabecalhos({ "user-agent": "twitterBOT" }))).toBe(
      true,
    );
  });

  it("navegador comum (Chrome no celular) nunca é robô", () => {
    const chrome =
      "Mozilla/5.0 (Linux; Android 13; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36";
    expect(ehRoboDaPrevia(cabecalhos({ "user-agent": chrome }))).toBe(false);
  });

  it("pedido sem user-agent nenhum não é robô (a ausência não vira WhatsApp)", () => {
    expect(ehRoboDaPrevia(cabecalhos({}))).toBe(false);
    expect(ehRoboDaPrevia(cabecalhos({ "sec-fetch-dest": "image" }))).toBe(
      false,
    );
  });
});

describe("ehRoboDaPrevia — o navegador embutido do WhatsApp é pessoa, não robô", () => {
  const ua =
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 WhatsApp/2.23.20.0";

  it("destino documento + modo navigate: é a pessoa abrindo o link", () => {
    expect(
      ehRoboDaPrevia(
        cabecalhos({
          "user-agent": ua,
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
        }),
      ),
    ).toBe(false);
  });

  it("destino documento e o navegador não manda o modo: ainda é a pessoa", () => {
    expect(
      ehRoboDaPrevia(
        cabecalhos({ "user-agent": ua, "sec-fetch-dest": "document" }),
      ),
    ).toBe(false);
  });

  it.each(["cors", "no-cors", "same-origin", "websocket"])(
    "destino documento mas modo %s não é navegação de pessoa: segue sendo robô",
    (modo) => {
      expect(
        ehRoboDaPrevia(
          cabecalhos({
            "user-agent": ua,
            "sec-fetch-dest": "document",
            "sec-fetch-mode": modo,
          }),
        ),
      ).toBe(true);
    },
  );

  it("modo navigate mas destino que não é documento (imagem): segue sendo robô", () => {
    expect(
      ehRoboDaPrevia(
        cabecalhos({
          "user-agent": ua,
          "sec-fetch-dest": "image",
          "sec-fetch-mode": "navigate",
        }),
      ),
    ).toBe(true);
  });

  it("modo navigate sem destino nenhum: sem prova de documento, segue sendo robô", () => {
    expect(
      ehRoboDaPrevia(
        cabecalhos({ "user-agent": ua, "sec-fetch-mode": "navigate" }),
      ),
    ).toBe(true);
  });
});

describe("VARY_DA_PREVIA — a resposta da prévia varia por quem pede", () => {
  it("lista exatamente os três cabeçalhos que decidem a resposta", () => {
    expect(VARY_DA_PREVIA).toBe("user-agent, sec-fetch-dest, sec-fetch-mode");
  });
});
