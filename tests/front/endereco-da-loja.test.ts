// O endereço da loja como função pura (src/lib/endereco-da-loja.ts): Minha loja
// é a fonte única do endereço (painel simples, §4). O texto de `storeAddress` é
// montado a partir das partes e lido de volta pelo inverso exato; texto livre
// de antes (escrito à mão no campo único) NÃO se lê — vira `null` e a tela pede
// "Confirme pelo CEP". Formato: "Rua, nº[, compl.] — Bairro, Cidade/UF — CEP
// 00000-000".
import {
  type PartesDoEndereco,
  divergenciaDoEndereco,
  lerEnderecoConferido,
  lerEnderecoDaLoja,
  montarEnderecoDaLoja,
  motivoDoEnderecoIncompleto,
} from "@/lib/endereco-da-loja";
import { describe, expect, it } from "vitest";

const PAULISTA: PartesDoEndereco = {
  cep: "01310100",
  rua: "Avenida Paulista",
  numero: "1578",
  complemento: "",
  bairro: "Bela Vista",
  cidade: "São Paulo",
  uf: "SP",
};

describe("montarEnderecoDaLoja", () => {
  it("monta as quatro colunas que já existem (sem migration)", () => {
    expect(montarEnderecoDaLoja(PAULISTA)).toEqual({
      originCep: "01310-100",
      storeAddress:
        "Avenida Paulista, 1578 — Bela Vista, São Paulo/SP — CEP 01310-100",
      storeCity: "São Paulo",
      storeState: "SP",
    });
  });

  it("o CEP gravado é o de hoje: oito dígitos com hífen depois do quinto", () => {
    expect(
      montarEnderecoDaLoja({ ...PAULISTA, cep: "01310-100" }).originCep,
    ).toBe("01310-100");
  });

  it("com complemento, ele entra depois do número", () => {
    expect(
      montarEnderecoDaLoja({ ...PAULISTA, complemento: "Sala 12" })
        .storeAddress,
    ).toBe(
      "Avenida Paulista, 1578, Sala 12 — Bela Vista, São Paulo/SP — CEP 01310-100",
    );
  });

  it("sem bairro (CEP único de cidade pequena), o trecho do bairro some", () => {
    expect(montarEnderecoDaLoja({ ...PAULISTA, bairro: "" }).storeAddress).toBe(
      "Avenida Paulista, 1578 — São Paulo/SP — CEP 01310-100",
    );
  });

  it("UF sai em maiúsculas e espaços sobrando saem", () => {
    const gravado = montarEnderecoDaLoja({
      ...PAULISTA,
      rua: "  Avenida   Paulista ",
      uf: "sp",
    });
    expect(gravado.storeState).toBe("SP");
    expect(gravado.storeAddress).toContain("Avenida Paulista, 1578");
  });

  it("vírgula e travessão são os separadores do formato: dentro das partes viram espaço/hífen", () => {
    const gravado = montarEnderecoDaLoja({
      ...PAULISTA,
      rua: "Rua A, Bloco 2",
      bairro: "Centro — Velho",
    });
    expect(gravado.storeAddress).toBe(
      "Rua A Bloco 2, 1578 — Centro - Velho, São Paulo/SP — CEP 01310-100",
    );
    // e o que foi gravado continua legível
    expect(lerEnderecoDaLoja(gravado.storeAddress)).not.toBeNull();
  });
});

describe("lerEnderecoDaLoja", () => {
  it("é o inverso exato do montar, sem complemento", () => {
    const { storeAddress } = montarEnderecoDaLoja(PAULISTA);
    expect(lerEnderecoDaLoja(storeAddress)).toEqual({
      ...PAULISTA,
      cep: "01310-100",
    });
  });

  it("é o inverso exato do montar, com complemento (que pode ter vírgula)", () => {
    const partes = { ...PAULISTA, complemento: "Sala 12, 3º andar" };
    const { storeAddress } = montarEnderecoDaLoja(partes);
    expect(lerEnderecoDaLoja(storeAddress)).toEqual({
      ...partes,
      cep: "01310-100",
    });
  });

  it("é o inverso exato do montar, sem bairro", () => {
    const partes = { ...PAULISTA, bairro: "" };
    const { storeAddress } = montarEnderecoDaLoja(partes);
    expect(lerEnderecoDaLoja(storeAddress)).toEqual({
      ...partes,
      cep: "01310-100",
    });
  });

  it.each([
    "Avenida Paulista, 1578",
    "Rua das Flores, 123 - Centro, Monte Carmelo",
    "Perto da praça, ao lado da padaria",
    "Avenida Paulista, 1578 — Bela Vista, São Paulo/SP",
    "Avenida Paulista, 1578 — Bela Vista, São Paulo/SP — CEP 0131",
    "",
    "   ",
  ])("texto livre antigo %j não se lê: null", (texto) => {
    expect(lerEnderecoDaLoja(texto)).toBeNull();
  });

  it("ausente (null/undefined) também é null", () => {
    expect(lerEnderecoDaLoja(null)).toBeNull();
    expect(lerEnderecoDaLoja(undefined)).toBeNull();
  });
});

describe("lerEnderecoConferido", () => {
  const { storeAddress } = montarEnderecoDaLoja(PAULISTA);

  it("devolve as partes quando o CEP do texto é o CEP da loja", () => {
    expect(lerEnderecoConferido(storeAddress, "01310-100")?.rua).toBe(
      "Avenida Paulista",
    );
    expect(lerEnderecoConferido(storeAddress, "01310100")?.rua).toBe(
      "Avenida Paulista",
    );
  });

  it("null quando o CEP do texto diverge do CEP da loja (o frete já mexeu no CEP)", () => {
    expect(lerEnderecoConferido(storeAddress, "13010-000")).toBeNull();
  });

  it("null quando a loja não tem CEP", () => {
    expect(lerEnderecoConferido(storeAddress, undefined)).toBeNull();
    expect(lerEnderecoConferido(storeAddress, "")).toBeNull();
  });
});

describe("motivoDoEnderecoIncompleto", () => {
  it("completo: null", () => {
    expect(motivoDoEnderecoIncompleto(PAULISTA)).toBeNull();
  });

  it("sem número, o motivo é o número", () => {
    expect(motivoDoEnderecoIncompleto({ ...PAULISTA, numero: " " })).toMatch(
      /número/i,
    );
  });

  it("CEP incompleto vem antes de tudo", () => {
    expect(
      motivoDoEnderecoIncompleto({ ...PAULISTA, cep: "0131", numero: "" }),
    ).toMatch(/CEP/);
  });

  it("sem rua, sem cidade ou UF de 2 letras também explicam", () => {
    expect(motivoDoEnderecoIncompleto({ ...PAULISTA, rua: "" })).toMatch(
      /rua/i,
    );
    expect(motivoDoEnderecoIncompleto({ ...PAULISTA, cidade: "" })).toMatch(
      /cidade/i,
    );
    expect(motivoDoEnderecoIncompleto({ ...PAULISTA, uf: "S" })).toMatch(/UF/);
  });
});

describe("divergenciaDoEndereco", () => {
  it("cidade do CEP diferente da cadastrada: mensagem com as duas", () => {
    const aviso = divergenciaDoEndereco("Campinas", "SP", "São Paulo", "SP");
    expect(aviso).toContain("Seu CEP é de Campinas/SP");
    expect(aviso).toContain("São Paulo/SP");
  });

  it("UF diferente também diverge", () => {
    expect(
      divergenciaDoEndereco("Uberlândia", "MG", "Uberlândia", "SP"),
    ).not.toBeNull();
  });

  it("ignora acento e maiúscula", () => {
    expect(
      divergenciaDoEndereco("SAO PAULO", "sp", "São Paulo", "SP"),
    ).toBeNull();
    expect(
      divergenciaDoEndereco("São Paulo", "SP", "sao paulo", "sp"),
    ).toBeNull();
  });

  it("sem cidade cadastrada ou sem cidade do CEP, não há o que comparar", () => {
    expect(divergenciaDoEndereco("Campinas", "SP", "", "")).toBeNull();
    expect(divergenciaDoEndereco("Campinas", "SP", null, undefined)).toBeNull();
    expect(divergenciaDoEndereco("", "", "São Paulo", "SP")).toBeNull();
    expect(
      divergenciaDoEndereco(undefined, undefined, "São Paulo", "SP"),
    ).toBeNull();
  });
});
