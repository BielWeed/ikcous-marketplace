// Enquanto as categorias carregam NADA é decidido, mesmo que já exista uma
// lista guardada de uma visita anterior (cópia do aparelho): a categoria nova,
// criada depois da cópia, ainda não está nela. Sem esta guarda o link
// `/?category=Calçados` caía em "Todas" no primeiro instante e, ao terminar de
// carregar, a cliente já tinha perdido o filtro que o banner prometeu.
// (O teste vizinho do "carregando" usa lista vazia, que a outra guarda já
// protege: aqui a lista tem categorias e só o `carregando` segura a decisão.)
import { categoriaValidaDaHome } from "@/lib/categoria-valida-da-home";
import { describe, expect, it } from "vitest";

const listaVelha = [{ name: "Roupas", isActive: true }];

describe("categoriaValidaDaHome — carregando com lista velha na mão", () => {
  it("carregando: mantém a categoria pedida, mesmo ausente da lista velha", () => {
    expect(categoriaValidaDaHome("Calçados", listaVelha, true)).toBe(
      "Calçados",
    );
  });

  it("terminou de carregar sem a categoria: aí sim cai em Todas", () => {
    expect(categoriaValidaDaHome("Calçados", listaVelha, false)).toBe("Todas");
  });

  it("carregando, a categoria que já existe segue como pedida (sem trocar a grafia ainda)", () => {
    expect(categoriaValidaDaHome("roupas", listaVelha, true)).toBe("roupas");
    expect(categoriaValidaDaHome("roupas", listaVelha, false)).toBe("Roupas");
  });
});
