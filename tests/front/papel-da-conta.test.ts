// O banco guarda o tipo de conta em inglês cru (`profiles.role`, CHECK com
// quatro valores). A lojista lê português: a função pura traduz.
import { describe, expect, it } from "vitest";

import { rotuloDoPapel } from "@/lib/papel-da-conta";

describe("rotuloDoPapel — o tipo de conta na língua da loja", () => {
  it("traduz os quatro papéis que o banco aceita", () => {
    expect(rotuloDoPapel("customer")).toBe("Cliente");
    expect(rotuloDoPapel("admin")).toBe("Administrador");
    expect(rotuloDoPapel("gerente")).toBe("Gerente");
    expect(rotuloDoPapel("vendedor")).toBe("Vendedor");
  });

  it("vazio ou ausente cai em Cliente", () => {
    expect(rotuloDoPapel(null)).toBe("Cliente");
    expect(rotuloDoPapel(undefined)).toBe("Cliente");
    expect(rotuloDoPapel("")).toBe("Cliente");
  });

  it("valor desconhecido cai em Cliente e nunca devolve o texto cru", () => {
    expect(rotuloDoPapel("superuser")).toBe("Cliente");
  });
});
