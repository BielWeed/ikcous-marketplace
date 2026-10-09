// A função pura da lista "sua loja está pronta para vender?" (src/lib/loja-pronta.ts):
// os SEIS passos do painel simples (`seisPassosDaLojaPronta`, §8 da spec) e o
// fato "entrega" que o Início calcula só com o que já está na config. O
// conserto de fundo: uma loja que só recebe na entrega NÃO fica com
// "Configurar pagamento PIX" pendente — "Como você recebe" vale PIX OU alguma
// forma de pagamento na entrega.
import { montarEnderecoDaLoja } from "@/lib/endereco-da-loja";
import {
  type ChaveDosSeisPassos,
  contagemDosPassos,
  entradaDosSeisPassos,
  estadoDaEntrega,
  proximoPasso,
  seisPassosDaLojaPronta,
} from "@/lib/loja-pronta";
import { statusDaEntrega } from "@/lib/status-da-entrega";
import { describe, expect, it } from "vitest";

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

// ── O fato "entrega" no Início: só o que já está na config, sem rede ─────────
//
// Regra: sem CEP de oito dígitos a loja não entrega (local, retirada e
// nacional partem do CEP da loja) e fica pendente; com CEP a entrega própria
// na cidade já funciona — não há interruptor dela, só a taxa, e a taxa 0 é
// "grátis na cidade". As transportadoras do "fora da cidade" dependem de
// credenciais (chamada de rede) e o Início não as pergunta.
describe("estadoDaEntrega", () => {
  it.each([
    { cep: "01310100", estado: "feito" },
    { cep: "01310-100", estado: "feito" },
    { cep: " 01310-100 ", estado: "feito" },
    { cep: "0131", estado: "pendente" },
    { cep: "", estado: "pendente" },
    { cep: null, estado: "pendente" },
    { cep: undefined, estado: "pendente" },
    { cep: "1234-5678", estado: "pendente" },
    { cep: "abcdefgh", estado: "pendente" },
  ])("CEP $cep: $estado", ({ cep, estado }) => {
    expect(estadoDaEntrega({ originCep: cep }, false)).toBe(estado);
  });

  it("config carregando: carregando, mesmo com CEP (a config ainda não chegou)", () => {
    expect(estadoDaEntrega({ originCep: "01310-100" }, true)).toBe(
      "carregando",
    );
    expect(estadoDaEntrega({}, true)).toBe("carregando");
  });

  // Só os casos em que as duas réguas já concordam: CEP completo, vazio e
  // ausente. Divergência conhecida, fora desta frente: `statusDaEntrega` testa
  // `!originCep` (CEP parcial como "1234" conta como preenchido lá), e o
  // passo exige os oito dígitos.
  it("CEP completo, vazio e ausente: concorda com a primeira linha da faixa do Frete ('Na sua cidade')", () => {
    for (const originCep of ["01310-100", "", undefined]) {
      const [naSuaCidade] = statusDaEntrega({
        config: { originCep } as Parameters<
          typeof statusDaEntrega
        >[0]["config"],
        credsErro: false,
        nomesLigados: [],
      });
      expect(estadoDaEntrega({ originCep }, false)).toBe(
        naSuaCidade.tom === "positivo" ? "feito" : "pendente",
      );
    }
  });

  it("alimenta o passo 'Como você entrega' dos seis", () => {
    const entrega = estadoDaEntrega({ originCep: "" }, false);
    expect(passoDosSeis("entrega", {}, { entrega }).estado).toBe("pendente");
  });
});
