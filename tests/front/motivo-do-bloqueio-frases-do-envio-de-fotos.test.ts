// As frases de "o botão está desligado porque há foto subindo"
// (`src/utils/motivo-do-bloqueio-do-produto.ts`). O envio do RECORTE de uma
// foto (`ajustando`) não tem progresso "1 de N": quando as duas coisas
// acontecem juntas, a frase é a do recorte, e quando só há recorte (sem
// progresso) também. Se o `progresso` ganhasse a prioridade, a lojista leria
// "Enviando fotos…" durante o ajuste de uma foto que já subiu.
import {
  fraseCurtaDoEnvioDeFotos,
  motivoDoEnvioDeFotos,
} from "@/utils/motivo-do-bloqueio-do-produto";
import { describe, expect, it } from "vitest";

describe("fraseCurtaDoEnvioDeFotos", () => {
  it("ajustando sem progresso diz que é a foto ajustada", () => {
    expect(fraseCurtaDoEnvioDeFotos(null, true)).toBe(
      "Enviando a foto ajustada…",
    );
  });

  it("ajustando tem prioridade sobre o progresso do lote", () => {
    expect(fraseCurtaDoEnvioDeFotos({ atual: 1, total: 2 }, true)).toBe(
      "Enviando a foto ajustada…",
    );
  });

  it("sem progresso e sem ajuste: frase genérica", () => {
    expect(fraseCurtaDoEnvioDeFotos(null, false)).toBe("Enviando fotos…");
  });

  it("com progresso: mostra 'N de M'", () => {
    expect(fraseCurtaDoEnvioDeFotos({ atual: 2, total: 3 }, false)).toBe(
      "Enviando fotos… (2 de 3)",
    );
  });
});

describe("motivoDoEnvioDeFotos", () => {
  it("ajustando sem progresso diz que é a foto ajustada", () => {
    expect(motivoDoEnvioDeFotos(null, true)).toBe(
      "Enviando a foto ajustada… O botão libera quando terminar.",
    );
  });

  it("ajustando tem prioridade sobre o progresso do lote", () => {
    expect(motivoDoEnvioDeFotos({ atual: 1, total: 2 }, true)).toBe(
      "Enviando a foto ajustada… O botão libera quando terminar.",
    );
  });

  it("sem progresso e sem ajuste: frase genérica", () => {
    expect(motivoDoEnvioDeFotos(null, false)).toBe(
      "Enviando fotos… O botão libera quando terminar.",
    );
  });

  it("com progresso: mostra 'N de M' e que o botão libera no fim", () => {
    expect(motivoDoEnvioDeFotos({ atual: 2, total: 3 }, false)).toBe(
      "Enviando fotos… (2 de 3). O botão libera quando terminar.",
    );
  });
});
