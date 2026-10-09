// A função pura da lista "sua loja está pronta para vender?" (src/lib/loja-pronta.ts).
// Hoje são 3 itens (a lista final, com 6, é de uma onda futura). O conserto
// que esta função traz: uma loja que só recebe na entrega NÃO fica com
// "Configurar pagamento PIX" pendente — "Como você recebe" vale PIX OU
// alguma forma de pagamento na entrega.
import { passosDaLojaPronta } from "@/lib/loja-pronta";
import { describe, expect, it } from "vitest";

type Entrada = Parameters<typeof passosDaLojaPronta>[0];

/** Loja toda pronta; cada teste estraga só o que quer provar. */
function entrada(parcial: Partial<Entrada> = {}): Entrada {
  return {
    originCep: "38500-000",
    pixOk: true,
    formasNaEntrega: [],
    produtos: [{ isActive: true }],
    configCarregando: false,
    produtosCarregando: false,
    ...parcial,
  };
}

function passo(chave: string, parcial: Partial<Entrada> = {}) {
  const achado = passosDaLojaPronta(entrada(parcial)).find(
    (item) => item.chave === chave,
  );
  if (!achado) throw new Error(`passo ${chave} não existe`);
  return achado;
}

describe("passosDaLojaPronta", () => {
  it("devolve os 3 itens de hoje, nesta ordem, com os rótulos novos", () => {
    const itens = passosDaLojaPronta(entrada());
    expect(itens.map((item) => item.rotulo)).toEqual([
      "Como você recebe",
      "Endereço da loja (CEP)",
      "Primeiro produto à venda",
    ]);
  });

  it("não muda o destino de navegação dos itens", () => {
    const itens = passosDaLojaPronta(entrada());
    expect(itens.map((item) => item.destino)).toEqual([
      "admin-settings",
      "admin-shipping",
      "admin-products",
    ]);
  });

  describe("Como você recebe", () => {
    it("só na entrega (pixOk=false, formas=['cash']): feito", () => {
      const recebe = passo("recebe", {
        pixOk: false,
        formasNaEntrega: ["cash"],
      });
      expect(recebe.estado).toBe("feito");
      // Não pode dizer "PIX configurado" de uma loja que não tem PIX.
      expect(recebe.rotuloFeito).not.toMatch(/pix/i);
    });

    it("sem PIX e sem nenhuma forma na entrega: pendente", () => {
      const recebe = passo("recebe", { pixOk: false, formasNaEntrega: [] });
      expect(recebe.estado).toBe("pendente");
      expect(recebe.rotuloPendente).toBe("Configurar pagamento PIX");
    });

    it("PIX ok, sem forma na entrega: feito", () => {
      const recebe = passo("recebe", { pixOk: true, formasNaEntrega: [] });
      expect(recebe.estado).toBe("feito");
      expect(recebe.rotuloFeito).toBe("Pagamento PIX configurado");
    });

    it("PIX ok e forma na entrega: feito", () => {
      expect(
        passo("recebe", { pixOk: true, formasNaEntrega: ["pix", "card"] })
          .estado,
      ).toBe("feito");
    });

    it("config carregando e PIX não ok: carregando (as formas ainda não chegaram)", () => {
      expect(
        passo("recebe", {
          pixOk: false,
          formasNaEntrega: [],
          configCarregando: true,
        }).estado,
      ).toBe("carregando");
    });

    it("config carregando com as formas PADRÃO (as três, como nasce o StoreContext): carregando, não 'feito' falso", () => {
      expect(
        passo("recebe", {
          pixOk: false,
          formasNaEntrega: ["pix", "card", "cash"],
          configCarregando: true,
        }).estado,
      ).toBe("carregando");
    });

    it("PIX ok resolve na hora, mesmo com a config carregando (vem do build)", () => {
      expect(
        passo("recebe", { pixOk: true, configCarregando: true }).estado,
      ).toBe("feito");
    });
  });

  describe("Endereço da loja (CEP)", () => {
    it.each([
      { cep: "01310100", estado: "feito" },
      { cep: "01310-100", estado: "feito" },
      { cep: " 01310-100 ", estado: "feito" },
      { cep: "0131", estado: "pendente" },
      { cep: "", estado: "pendente" },
      { cep: undefined, estado: "pendente" },
      { cep: "1234-5678", estado: "pendente" },
      { cep: "abcdefgh", estado: "pendente" },
    ])("CEP $cep: $estado", ({ cep, estado }) => {
      expect(passo("cep", { originCep: cep }).estado).toBe(estado);
    });

    it("config carregando: carregando, mesmo com CEP preenchido", () => {
      expect(passo("cep", { configCarregando: true }).estado).toBe(
        "carregando",
      );
    });
  });

  describe("Primeiro produto à venda", () => {
    it("só produto inativo: pendente (conta isActive, não o tamanho da lista)", () => {
      expect(passo("produto", { produtos: [{ isActive: false }] }).estado).toBe(
        "pendente",
      );
    });

    it("com 1 produto ativo: feito", () => {
      expect(
        passo("produto", {
          produtos: [{ isActive: false }, { isActive: true }],
        }).estado,
      ).toBe("feito");
    });

    it("produtos carregando: carregando", () => {
      expect(
        passo("produto", { produtos: [], produtosCarregando: true }).estado,
      ).toBe("carregando");
    });

    it("config carregando não segura o item de produto", () => {
      expect(passo("produto", { configCarregando: true }).estado).toBe("feito");
    });
  });
});
