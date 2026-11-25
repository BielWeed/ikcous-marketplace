// @vitest-environment jsdom
//
// O Escape SINTÉTICO que o AdminLayout dispara a cada troca de tela
// (`src/lib/escape-sintetico.ts`) precisa ser reconhecido por quem trata Esc
// como "o lojista quis fechar". A marca é por EVENTO (WeakSet), não por tipo
// nem por tecla: um Escape de verdade, logo depois, tem de continuar valendo.
import {
  ehEscapeSintetico,
  marcarEscapeSintetico,
} from "@/lib/escape-sintetico";
import { describe, expect, it } from "vitest";

const novoEscape = () => new KeyboardEvent("keydown", { key: "Escape" });

describe("Escape sintético", () => {
  it("um evento nunca marcado não é sintético (é do lojista)", () => {
    expect(ehEscapeSintetico(novoEscape())).toBe(false);
  });

  it("o evento marcado antes do dispatch é reconhecido como sintético", () => {
    const evento = novoEscape();
    marcarEscapeSintetico(evento);
    expect(ehEscapeSintetico(evento)).toBe(true);
  });

  it("marcar um evento não contamina outro Escape idêntico", () => {
    const sintetico = novoEscape();
    const doLojista = novoEscape();
    marcarEscapeSintetico(sintetico);

    expect(ehEscapeSintetico(sintetico)).toBe(true);
    expect(ehEscapeSintetico(doLojista)).toBe(false);
  });

  it("a marca vale também depois de o evento passar pelos ouvintes (dispatch)", () => {
    const evento = novoEscape();
    const vistos: boolean[] = [];
    const ouvinte = (e: Event) => vistos.push(ehEscapeSintetico(e));
    document.addEventListener("keydown", ouvinte);
    try {
      marcarEscapeSintetico(evento);
      document.dispatchEvent(evento);
      document.dispatchEvent(novoEscape());
    } finally {
      document.removeEventListener("keydown", ouvinte);
    }
    expect(vistos).toEqual([true, false]);
    expect(ehEscapeSintetico(evento)).toBe(true);
  });

  it("marcar duas vezes o mesmo evento continua sendo uma marca só", () => {
    const evento = novoEscape();
    marcarEscapeSintetico(evento);
    marcarEscapeSintetico(evento);
    expect(ehEscapeSintetico(evento)).toBe(true);
  });
});
