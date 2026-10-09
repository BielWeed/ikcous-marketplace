// A função pura da lista "sua loja está pronta para vender?" (src/lib/loja-pronta.ts).
// Dois jeitos convivem até o cartão do Início mudar (E3): a lista de 3 itens
// (`passosDaLojaPronta`, que o cartão de hoje usa) e a de SEIS passos do painel
// simples (`seisPassosDaLojaPronta`, §8 da spec). O conserto que as duas
// trazem: uma loja que só recebe na entrega NÃO fica com "Configurar pagamento
// PIX" pendente — "Como você recebe" vale PIX OU alguma forma de pagamento na
// entrega.
import { montarEnderecoDaLoja } from "@/lib/endereco-da-loja";
import {
  type ChaveDosSeisPassos,
  contagemDosPassos,
  entradaDosSeisPassos,
  passosDaLojaPronta,
  proximoPasso,
  seisPassosDaLojaPronta,
} from "@/lib/loja-pronta";
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

  it("só o destino do item CEP muda: o endereço agora se edita em Minha loja", () => {
    const itens = passosDaLojaPronta(entrada());
    expect(itens.map((item) => item.destino)).toEqual([
      "admin-settings",
      "admin-about-store",
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

// ── Os SEIS passos do painel simples (spec §8) ────────────────────────────

type Config = Parameters<typeof entradaDosSeisPassos>[0];
type Fatos = Parameters<typeof entradaDosSeisPassos>[1];

const ENDERECO_PRONTO = montarEnderecoDaLoja({
  cep: "01310100",
  rua: "Avenida Paulista",
  numero: "1578",
  complemento: "",
  bairro: "Bela Vista",
  cidade: "São Paulo",
  uf: "SP",
});

/** Loja toda pronta; cada teste estraga só o que quer provar. */
function loja(config: Partial<Config> = {}, fatos: Partial<Fatos> = {}) {
  return seisPassosDaLojaPronta(
    entradaDosSeisPassos(
      {
        storeName: "Ateliê da Serra",
        logoUrl: "https://exemplo.test/logo.png",
        originCep: ENDERECO_PRONTO.originCep,
        storeAddress: ENDERECO_PRONTO.storeAddress,
        whatsappNumber: "(34) 99999-9999",
        ...config,
      },
      {
        pixOk: true,
        formasNaEntrega: [],
        produtos: [{ isActive: true }],
        configCarregando: false,
        produtosCarregando: false,
        entrega: "feito",
        ...fatos,
      },
    ),
  );
}

function passoDosSeis(
  chave: ChaveDosSeisPassos,
  config: Partial<Config> = {},
  fatos: Partial<Fatos> = {},
) {
  const achado = loja(config, fatos).find((item) => item.chave === chave);
  if (!achado) throw new Error(`passo ${chave} não existe`);
  return achado;
}

describe("seisPassosDaLojaPronta", () => {
  it("são seis, nesta ordem, com o destino de cada um", () => {
    const passos = loja();
    expect(passos.map((p) => p.chave)).toEqual([
      "marca",
      "endereco",
      "whatsapp",
      "recebe",
      "entrega",
      "produto",
    ]);
    expect(passos.map((p) => p.destino)).toEqual([
      "admin-about-store",
      "admin-about-store",
      "admin-about-store",
      "admin-settings",
      "admin-shipping",
      "admin-products",
    ]);
  });

  it("o horário NÃO é um passo: nenhum rótulo fala dele", () => {
    const rotulos = loja().flatMap((p) => [
      p.rotulo,
      p.rotuloFeito,
      p.rotuloPendente,
    ]);
    expect(rotulos.some((r) => /hor[áa]rio/i.test(r))).toBe(false);
  });

  describe("Nome e logo", () => {
    it("com nome e logo: feito", () => {
      expect(passoDosSeis("marca").estado).toBe("feito");
    });
    it.each([
      { storeName: "", logoUrl: "https://x.test/l.png" },
      { storeName: "Loja", logoUrl: "" },
      { storeName: "   ", logoUrl: "https://x.test/l.png" },
      { storeName: undefined, logoUrl: undefined },
    ])("nome %j: pendente", (parcial) => {
      expect(passoDosSeis("marca", parcial).estado).toBe("pendente");
    });
    it("config carregando: carregando", () => {
      expect(passoDosSeis("marca", {}, { configCarregando: true }).estado).toBe(
        "carregando",
      );
    });
  });

  describe("Endereço (CEP + número)", () => {
    it("CEP e endereço montado com número: feito", () => {
      expect(passoDosSeis("endereco").estado).toBe("feito");
    });
    it("só o CEP (loja de antes do endereço por CEP): pendente — falta o número", () => {
      expect(passoDosSeis("endereco", { storeAddress: null }).estado).toBe(
        "pendente",
      );
    });
    it("endereço em texto livre antigo: pendente — confirme pelo CEP", () => {
      expect(
        passoDosSeis("endereco", {
          storeAddress: "Rua das Flores, 123 - Centro",
        }).estado,
      ).toBe("pendente");
    });
    it("endereço montado mas CEP da loja de outro lugar (o Frete antigo mexeu): pendente", () => {
      expect(passoDosSeis("endereco", { originCep: "38500-000" }).estado).toBe(
        "pendente",
      );
    });
    it("sem CEP: pendente", () => {
      expect(passoDosSeis("endereco", { originCep: "" }).estado).toBe(
        "pendente",
      );
    });
    it("config carregando: carregando", () => {
      expect(
        passoDosSeis("endereco", {}, { configCarregando: true }).estado,
      ).toBe("carregando");
    });
  });

  describe("WhatsApp", () => {
    it.each([
      { numero: "(34) 99999-9999", estado: "feito" },
      { numero: "34999999999", estado: "feito" },
      { numero: "3499999", estado: "pendente" },
      { numero: "", estado: "pendente" },
      { numero: null, estado: "pendente" },
      { numero: undefined, estado: "pendente" },
    ])("número $numero: $estado", ({ numero, estado }) => {
      expect(passoDosSeis("whatsapp", { whatsappNumber: numero }).estado).toBe(
        estado,
      );
    });
    it("o texto do passo pendente é o do botão 'Próximo passo'", () => {
      expect(
        passoDosSeis("whatsapp", { whatsappNumber: "" }).rotuloPendente,
      ).toBe("Cadastrar WhatsApp");
    });
  });

  describe("Como você recebe", () => {
    it("só na entrega (sem PIX): feito", () => {
      const recebe = passoDosSeis(
        "recebe",
        {},
        { pixOk: false, formasNaEntrega: ["cash"] },
      );
      expect(recebe.estado).toBe("feito");
      expect(recebe.rotuloFeito).not.toMatch(/pix/i);
    });
    it("PIX ok, sem forma na entrega: feito", () => {
      expect(
        passoDosSeis("recebe", {}, { pixOk: true, formasNaEntrega: [] }).estado,
      ).toBe("feito");
    });
    it("sem PIX e sem forma na entrega: pendente", () => {
      expect(
        passoDosSeis("recebe", {}, { pixOk: false, formasNaEntrega: [] })
          .estado,
      ).toBe("pendente");
    });
    it("sem PIX e config carregando: carregando (as formas padrão não valem)", () => {
      expect(
        passoDosSeis(
          "recebe",
          {},
          {
            pixOk: false,
            formasNaEntrega: ["pix", "card", "cash"],
            configCarregando: true,
          },
        ).estado,
      ).toBe("carregando");
    });
  });

  describe("Como você entrega", () => {
    it.each(["feito", "pendente", "carregando"] as const)(
      "o estado %s chega pronto de quem chama (a régua é do Frete)",
      (entrega) => {
        expect(passoDosSeis("entrega", {}, { entrega }).estado).toBe(entrega);
      },
    );
  });

  describe("Primeiro produto", () => {
    it("só produto inativo: pendente; com um ativo: feito", () => {
      expect(
        passoDosSeis("produto", {}, { produtos: [{ isActive: false }] }).estado,
      ).toBe("pendente");
      expect(
        passoDosSeis(
          "produto",
          {},
          { produtos: [{ isActive: false }, { isActive: true }] },
        ).estado,
      ).toBe("feito");
    });
    it("produtos carregando: carregando; config carregando não segura", () => {
      expect(
        passoDosSeis("produto", {}, { produtos: [], produtosCarregando: true })
          .estado,
      ).toBe("carregando");
      expect(
        passoDosSeis("produto", {}, { configCarregando: true }).estado,
      ).toBe("feito");
    });
  });
});

describe("contagemDosPassos e proximoPasso", () => {
  it("loja pronta: 6 de 6 e nenhum próximo passo", () => {
    const passos = loja();
    expect(contagemDosPassos(passos)).toEqual({ feitos: 6, total: 6 });
    expect(proximoPasso(passos)).toBeNull();
  });

  it("falta o WhatsApp e o produto: 4 de 6 e o próximo é o WhatsApp (o primeiro pendente)", () => {
    const passos = loja(
      { whatsappNumber: "" },
      { produtos: [{ isActive: false }] },
    );
    expect(contagemDosPassos(passos)).toEqual({ feitos: 4, total: 6 });
    expect(proximoPasso(passos)?.chave).toBe("whatsapp");
    expect(proximoPasso(passos)?.destino).toBe("admin-about-store");
  });

  it("passo carregando não conta como feito nem vira o próximo", () => {
    const passos = loja({}, { configCarregando: true, pixOk: false });
    // marca, endereço, WhatsApp e recebe carregando; entrega e produto feitos
    expect(contagemDosPassos(passos)).toEqual({ feitos: 2, total: 6 });
    expect(proximoPasso(passos)).toBeNull();
  });

  it("o total é sempre 6, mesmo com tudo pendente", () => {
    const passos = loja(
      { storeName: "", whatsappNumber: "", originCep: "", storeAddress: "" },
      { pixOk: false, produtos: [], entrega: "pendente" },
    );
    expect(contagemDosPassos(passos)).toEqual({ feitos: 0, total: 6 });
    expect(proximoPasso(passos)?.chave).toBe("marca");
  });
});
