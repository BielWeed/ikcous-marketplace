// Caça de provas fracas (24/11/2026), tela de e-mail da loja: as BORDAS das
// frases com número e data que a lojista lê.
//   - "Pode testar em 1 min" / "Dá para tentar de novo em 2 minutos": o tempo
//     arredonda sempre PARA CIMA (dizer "1 s" quando faltam 1,2 s faz a lojista
//     tocar cedo e levar outro bloqueio do Google), e na virada de 60 s / 3600 s
//     troca de unidade no lugar certo;
//   - número que não é número útil (NaN, infinito, texto, zero, negativo) vira
//     "alguns instantes", nunca "NaN horas" ou "Infinity horas";
//   - data curta sempre com dois dígitos ("05/01"), no fuso do aparelho;
//   - aviso de e-mails parados sem data conhecida não inventa "em ..".
import { describe, expect, it } from "vitest";

import {
  type StatusDoEmail,
  dataCurta,
  descreverEspera,
  textoDaContagem,
  textoDaSaudeDoEnvio,
} from "@/components/admin/settings/email-da-loja-conteudo";

describe("descreverEspera: arredonda para cima e troca de unidade na virada", () => {
  it.each([
    [0.2, "1 segundo"],
    [1, "1 segundo"],
    [1.2, "2 segundos"],
    [59, "59 segundos"],
    [59.1, "60 segundos"],
    [60, "1 minuto"],
    [61, "2 minutos"],
    [119, "2 minutos"],
    [120, "2 minutos"],
    [3599, "60 minutos"],
    [3600, "1 hora"],
    [3601, "2 horas"],
    [7200, "2 horas"],
  ])("%s s => %s", (segundos, esperado) => {
    expect(descreverEspera(segundos)).toBe(esperado);
  });

  it.each([
    ["NaN", Number.NaN],
    ["infinito", Number.POSITIVE_INFINITY],
    ["menos infinito", Number.NEGATIVE_INFINITY],
    ["zero", 0],
    ["negativo", -5],
    ["texto numérico", "30"],
    ["null", null],
    ["undefined", undefined],
    ["objeto", {}],
  ])("%s => 'alguns instantes'", (_nome, valor) => {
    expect(descreverEspera(valor)).toBe("alguns instantes");
  });
});

describe("textoDaContagem: segundos até 60, depois minutos (sempre para cima)", () => {
  it.each([
    [0, "1 s"],
    [-3, "1 s"],
    [0.2, "1 s"],
    [1, "1 s"],
    [42, "42 s"],
    [42.4, "43 s"],
    [60, "60 s"],
    [60.5, "2 min"],
    [61, "2 min"],
    [120, "2 min"],
    [121, "3 min"],
  ])("%s => %s", (segundos, esperado) => {
    expect(textoDaContagem(segundos)).toBe(esperado);
  });
});

describe("dataCurta: DD/MM com dois dígitos, no fuso do aparelho", () => {
  // Datas montadas no fuso local: o resultado não depende de onde o teste roda.
  const local = (mes: number, dia: number) =>
    new Date(2026, mes - 1, dia, 12, 0, 0).toISOString();

  it.each([
    [1, 5, "05/01"],
    [11, 24, "24/11"],
    [9, 30, "30/09"],
    [12, 1, "01/12"],
  ])("mês %i, dia %i => %s", (mes, dia, esperado) => {
    expect(dataCurta(local(mes, dia))).toBe(esperado);
  });

  it.each([[null], [undefined], [""], ["não é data"]])(
    "%j => null",
    (entrada) => {
      expect(dataCurta(entrada)).toBeNull();
    },
  );
});

describe("textoDaSaudeDoEnvio: sem data conhecida não inventa o 'em ..'", () => {
  const status = (em: string | null): StatusDoEmail => ({
    usuario: "loja@gmail.com",
    senhaGuardada: true,
    ultimoTeste: null,
    origem: "painel",
    cofrePronto: true,
    registroIlegivel: false,
    falha: { em, motivo: "senha_errada", origem: "painel" },
  });

  it("data ausente", () => {
    expect(textoDaSaudeDoEnvio(status(null))).toBe(
      "Seus e-mails pararam — o Google recusou a senha.",
    );
  });

  it("data ilegível", () => {
    expect(textoDaSaudeDoEnvio(status("ontem"))).toBe(
      "Seus e-mails pararam — o Google recusou a senha.",
    );
  });

  it("data boa vira 'em DD/MM'", () => {
    const iso = new Date(2026, 10, 3, 12, 0, 0).toISOString();
    expect(textoDaSaudeDoEnvio(status(iso))).toBe(
      "Seus e-mails pararam em 03/11 — o Google recusou a senha.",
    );
  });
});
