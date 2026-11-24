// @vitest-environment jsdom
//
// A memória da última visita decide, ANTES do primeiro desenho, quanto espaço
// reservar para banner e vitrines. Ela só vale inteira: sem um dos três
// avisos obrigatórios (banner, ofertas, destaques) é lixo de outra versão ou
// de edição à mão, e a Home volta à aposta da primeira visita em vez de
// reservar espaço com base em meia memória. E uma vitrine gravada como lista
// (em vez de objeto) é descartada, sem inventar "layout padrão" no lugar do
// layout que o resto da memória conhece.
import { lerMemoriaDaHome } from "@/hooks/useMemoriaDaHome";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dados: Map<string, string>;
beforeEach(() => {
  dados = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => dados.set(k, v),
  });
});
afterEach(() => vi.unstubAllGlobals());

const completa = { temBanner: true, temOfertas: true, temBestsellers: false };
const grava = (memoria: Record<string, unknown>) =>
  dados.set(
    "ikcous_home_memoria",
    JSON.stringify({ ...memoria, gravadoEm: Date.now() }),
  );

describe("memória da Home — campos obrigatórios", () => {
  it("memória completa é lida", () => {
    grava(completa);
    expect(lerMemoriaDaHome()).toMatchObject(completa);
  });

  it.each(["temBanner", "temOfertas", "temBestsellers"])(
    "sem %s a memória inteira é descartada (volta à aposta da 1ª visita)",
    (campo) => {
      grava(
        Object.fromEntries(
          Object.entries(completa).filter(([chave]) => chave !== campo),
        ),
      );
      expect(lerMemoriaDaHome()).toBeNull();
    },
  );

  it.each(["temBanner", "temOfertas", "temBestsellers"])(
    "%s que não é verdadeiro/falso descarta a memória",
    (campo) => {
      grava({ ...completa, [campo]: "sim" });
      expect(lerMemoriaDaHome()).toBeNull();
    },
  );
});

describe("memória da Home — vitrine gravada torta", () => {
  it("vitrine que é lista some; as outras seguem com layout e quantidade", () => {
    grava({
      ...completa,
      vitrines: {
        offers: ["compacto", 3],
        curada: { layout: "compacto", qtd: 2 },
      },
    });
    expect(lerMemoriaDaHome()?.vitrines).toEqual({
      curada: { layout: "compacto", qtd: 2 },
    });
  });
});
