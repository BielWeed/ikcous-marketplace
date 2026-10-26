// O rascunho de edição por cima do produto como está no banco HOJE: o campo
// que a lojista não editou (igual à base do rascunho) vale o do banco; o que
// ela editou volta. Rascunho sem base volta inteiro, como sempre foi.
import { rascunhoSobreOBancoDeHoje } from "@/lib/rascunho-do-produto";
import { describe, expect, it } from "vitest";

const variacao = (id: string, valor: string, estoque = 1, ativa = true) => ({
  id,
  productId: "p",
  name: "Cor",
  value: valor,
  stockIncrement: estoque,
  active: ativa,
});

const base = {
  name: "Camiseta",
  price: "100",
  isActive: true,
  images: ["a.jpg"],
  variants: [variacao("v1", "Rosa"), variacao("v2", "Azul")],
};

describe("rascunhoSobreOBancoDeHoje", () => {
  it("campo igual à base vale o banco; o editado volta; avisa que o banco mudou", () => {
    const banco = { ...base, price: "90", isActive: false };
    const rascunho = { ...base, name: "Camiseta nova", baseDoRascunho: base };

    const { campos, bancoMudou } = rascunhoSobreOBancoDeHoje(rascunho, banco);

    expect(campos.name).toBe("Camiseta nova");
    expect(campos.price).toBe("90");
    expect(campos.isActive).toBe(false);
    expect(bancoMudou).toBe(true);
  });

  it("banco igual à base: nada muda e não avisa", () => {
    const rascunho = { ...base, name: "Camiseta nova", baseDoRascunho: base };

    const { campos, bancoMudou } = rascunhoSobreOBancoDeHoje(rascunho, base);

    expect(campos).toMatchObject({ name: "Camiseta nova", price: "100" });
    expect(bancoMudou).toBe(false);
  });

  it("rascunho SEM base (anterior à regra) volta inteiro, mesmo com o banco diferente", () => {
    const banco = { ...base, price: "90", isActive: false };
    const rascunho = { ...base, name: "Camiseta nova" };

    const { campos, bancoMudou } = rascunhoSobreOBancoDeHoje(rascunho, banco);

    expect(campos).toBe(rascunho);
    expect(bancoMudou).toBe(false);
  });

  it("lista (fotos) editada volta; lista não editada vale o banco", () => {
    const banco = { ...base, images: ["a.jpg", "b.jpg"] };
    const editou = {
      ...base,
      images: ["a.jpg", "c.jpg"],
      baseDoRascunho: base,
    };
    const naoEditou = { ...base, baseDoRascunho: base };

    expect(rascunhoSobreOBancoDeHoje(editou, banco).campos.images).toEqual([
      "a.jpg",
      "c.jpg",
    ]);
    expect(rascunhoSobreOBancoDeHoje(naoEditou, banco).campos.images).toEqual([
      "a.jpg",
      "b.jpg",
    ]);
  });

  it("variação: a que ela editou volta; a que não editou vale o banco; a nova fica", () => {
    const editada = variacao("v1", "Rosa pink");
    const nova = variacao("temp-1", "Verde");
    const banco = {
      ...base,
      variants: [variacao("v1", "Rosa"), variacao("v2", "Azul", 1, false)],
    };
    const rascunho = {
      ...base,
      variants: [editada, variacao("v2", "Azul"), nova],
      baseDoRascunho: base,
    };

    const { campos, bancoMudou } = rascunhoSobreOBancoDeHoje(rascunho, banco);

    expect(campos.variants[0]).toEqual(editada);
    // v2 foi desligada no banco depois: o rascunho não a religa.
    expect(campos.variants[1].active).toBe(false);
    expect(campos.variants[2]).toEqual(nova);
    expect(bancoMudou).toBe(true);
  });

  it("estoque da variação que mudou por venda não conta como 'banco alterado'", () => {
    const banco = {
      ...base,
      variants: [variacao("v1", "Rosa", 0), variacao("v2", "Azul", 1)],
    };
    const rascunho = { ...base, name: "Outro", baseDoRascunho: base };

    expect(rascunhoSobreOBancoDeHoje(rascunho, banco).bancoMudou).toBe(false);
  });
});
