// O banco guarda o tipo de conta em inglês cru (`profiles.role`, CHECK com
// quatro valores). A lojista lê português: a função pura traduz.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { rotuloDoPapel } from "@/lib/papel-da-conta";

/** Valores do CHECK `profiles_role_check`, lidos das migrations (a definição
 * mais recente vence). Se o banco ganhar um papel novo, o teste abaixo
 * reprova até o mapa de `papel-da-conta.ts` ganhar a entrada. */
function papeisDoBanco(): string[] {
  const dir = "supabase/migrations";
  let ultimo: string[] = [];
  for (const arquivo of readdirSync(dir).sort()) {
    if (!arquivo.endsWith(".sql")) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho vem da listagem da pasta de migrations do próprio repositório
    const sql = readFileSync(`${dir}/${arquivo}`, "utf8");
    for (const m of sql.matchAll(
      /profiles_role_check[^;]*?ARRAY\[([^\]]+)\]/g,
    )) {
      ultimo = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    }
  }
  return ultimo;
}

describe("rotuloDoPapel acompanha o CHECK do banco", () => {
  it("todo papel que o banco aceita tem rótulo próprio (só 'customer' é Cliente)", () => {
    const papeis = papeisDoBanco();
    expect(papeis).toContain("customer");
    expect(papeis.length).toBeGreaterThanOrEqual(4);
    for (const papel of papeis) {
      if (papel === "customer") continue;
      expect(rotuloDoPapel(papel), papel).not.toBe("Cliente");
    }
  });
});

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
