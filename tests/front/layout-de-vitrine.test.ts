import * as layouts from "@/lib/layout-de-ofertas";
import { describe, expect, it } from "vitest";

describe("layout de qualquer vitrine", () => {
  it("oferece o nome neutro sem romper os importadores de Ofertas", () => {
    expect(layouts).toHaveProperty(
      "normalizarLayoutDeVitrine",
      layouts.normalizarLayoutDeOfertas,
    );
  });

  it.each([undefined, null, "", "desconhecido", {}, 4])(
    "config antiga ou inválida %j mantém o Padrão",
    (valor) => expect(layouts.normalizarLayoutDeOfertas(valor)).toBe("padrao"),
  );
  it.each(["padrao", "compacto", "lateral", "lateral-duplo"])(
    "reconhece %s",
    (valor) => expect(layouts.normalizarLayoutDeOfertas(valor)).toBe(valor),
  );
});
