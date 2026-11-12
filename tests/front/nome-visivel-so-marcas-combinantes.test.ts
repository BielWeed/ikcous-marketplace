// Texto feito só de marcas combinantes (U+034F, acento solto U+0301...) não
// desenha nada: marca combinante precisa de uma letra antes para aparecer. A
// régua `nomeTemConteudoVisivel` só conhecia espaço, controle, formatação e
// preenchimentos, então um motivo "Outro" de devolução colado como U+034F
// passava como texto preenchido e aparecia em branco para a lojista.
// Caractere invisível só como escape \uXXXX, nunca literal.
import { describe, expect, it } from "vitest";

import { erroDoMotivo } from "@/lib/devolucao";
import { nomeOuReserva, nomeTemConteudoVisivel } from "@/lib/nome-visivel";

describe("nomeTemConteudoVisivel: marca combinante solta não desenha", () => {
  it.each([
    ["só o junta-grafemas (U+034F)", "\u034F"],
    ["vários junta-grafemas (U+034F)", "\u034F\u034F\u034F"],
    ["acento agudo solto (U+0301)", "\u0301"],
    ["marca envolvente solta (U+20DD)", "\u20DD"],
    ["seletor de variação sozinho (U+FE0F)", "\uFE0F"],
    ["marcas misturadas com espaço e invisível", " \u034F\u0301\u200B "],
    ["os casos antigos continuam: U+200B", "\u200B"],
    ["os casos antigos continuam: U+2800", "\u2800"],
    ["os casos antigos continuam: U+3164", "\u3164"],
    ["os casos antigos continuam: vazio", ""],
    ["os casos antigos continuam: espaço", "   "],
  ])("recusa %s", (_descricao, texto) => {
    expect(nomeTemConteudoVisivel(texto)).toBe(false);
  });

  it.each([
    ["marca antes de uma letra (U+034F + a)", "\u034Fa"],
    ["letra com acento solto depois (e + U+0301)", "e\u0301"],
    ["emoji com seletor de variação", "\u2764\uFE0F"],
    ["nome comum", "Ana"],
    ["marca no meio de um nome", "An\u034Fa"],
  ])("aceita %s", (_descricao, texto) => {
    expect(nomeTemConteudoVisivel(texto)).toBe(true);
  });

  it("null e undefined seguem sem conteúdo visível", () => {
    expect(nomeTemConteudoVisivel(null)).toBe(false);
    expect(nomeTemConteudoVisivel(undefined)).toBe(false);
  });

  it("nomeOuReserva herda: só marca combinante cai na reserva", () => {
    expect(nomeOuReserva("\u034F\u034F", "Cliente")).toBe("Cliente");
    expect(nomeOuReserva("\u0301", "Cliente")).toBe("Cliente");
    expect(nomeOuReserva(" e\u0301 ", "Cliente")).toBe("e\u0301");
    expect(nomeOuReserva("Ana", "Cliente")).toBe("Ana");
  });
});

describe("motivo 'Outro' da devolução com só marca combinante", () => {
  const args = {
    quantidadeDeFotos: 0,
    janelas: { arrependimento: true, troca: true, vicio: true },
    prazos: {
      arrependimento_ate: "2026-10-01",
      troca_ate: "2026-10-24",
    },
    politica: { exige_fotos_vicio: true },
  };

  it.each([
    ["U+034F", "\u034F\u034F\u034F"],
    ["U+0301", "\u0301"],
  ])("recusa o detalhe feito só de %s", (_descricao, detalhe) => {
    expect(erroDoMotivo({ ...args, motivo: "outro", detalhe })).toBe(
      "Conte em poucas palavras o motivo da devolução.",
    );
  });

  it("aceita o detalhe com letra, mesmo com marca combinante junto", () => {
    expect(
      erroDoMotivo({ ...args, motivo: "outro", detalhe: "Veio e\u0301 outro" }),
    ).toBeNull();
    expect(
      erroDoMotivo({ ...args, motivo: "outro", detalhe: "\u034Fcor errada" }),
    ).toBeNull();
  });
});
