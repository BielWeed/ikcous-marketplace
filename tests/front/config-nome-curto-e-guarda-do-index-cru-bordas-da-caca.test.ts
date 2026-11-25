// Caça por mutação (25/11/2026) em `src/config/nomeCurtoDaLoja.ts` e
// `src/config/guardaDoIndexCru.ts`. Cada caso nasceu de um defeito de uma linha
// plantado de propósito que os testes vizinhos deixavam passar:
//  - nome curto: o separador com TRAVESSÃO (– e —), as ligações "das"/"dos", a
//    ligação em CAIXA ALTA, a ligação olhada no FIM e não no começo, o nome que
//    começa com a barra "|", o corte de uma palavra gigante em exatamente 12
//    caracteres e a parte antes do separador que mede exatamente 12;
//  - guarda do índice cru: o que conta como endereço de máquina do dev (só os
//    nomes exatos; "meulocalhost" e "127x0x0x1" NÃO são locais).
import { describe, expect, it } from "vitest";

import { decidirBootSemFicha } from "@/config/guardaDoIndexCru";
import { nomeCurtoDaLoja } from "@/config/nomeCurtoDaLoja";

describe("nomeCurtoDaLoja — separadores com travessão", () => {
  it("travessão médio ' – ' separa: vale só o que vem antes", () => {
    expect(nomeCurtoDaLoja("Bela – Casa Moderna Ltda")).toBe("Bela");
  });

  it("travessão longo ' — ' separa: vale só o que vem antes", () => {
    expect(nomeCurtoDaLoja("Bela — Casa Moderna Ltda")).toBe("Bela");
  });

  it("hífen simples ' - ' separa; o mesmo nome sem espaço em volta do hífen NÃO separa", () => {
    expect(nomeCurtoDaLoja("Bela - Casa Moderna Ltda")).toBe("Bela");
    expect(nomeCurtoDaLoja("Bela-Casa Moderna Ltda")).toBe("Bela-Casa");
  });
});

describe("nomeCurtoDaLoja — a barra '|' no começo do nome", () => {
  it("nome que COMEÇA com '|': a primeira parte é vazia e vale a primeira parte com texto", () => {
    expect(nomeCurtoDaLoja("| Loja Central Moda Feminina")).toBe(
      "Loja Central",
    );
  });
});

describe("nomeCurtoDaLoja — a parte antes do separador mede exatamente 12", () => {
  it("12 caracteres cabem e ficam como estão, até com 'de' no fim (a regra de pendurado vale só no corte por palavras)", () => {
    expect(nomeCurtoDaLoja("Casa Bela de | Doces e Salgados")).toBe(
      "Casa Bela de",
    );
  });
});

describe("nomeCurtoDaLoja — palavra de ligação pendurada no fim", () => {
  it("'das' no fim sai: 'Doces das Flores Lindas' vira 'Doces'", () => {
    expect(nomeCurtoDaLoja("Doces das Flores Lindas")).toBe("Doces");
  });

  it("'dos' no fim sai: 'Bolos dos Anjos Felizes' vira 'Bolos'", () => {
    expect(nomeCurtoDaLoja("Bolos dos Anjos Felizes")).toBe("Bolos");
  });

  it("a ligação em CAIXA ALTA também sai: 'Doces DAS Flores Lindas' vira 'Doces'", () => {
    expect(nomeCurtoDaLoja("Doces DAS Flores Lindas")).toBe("Doces");
  });

  it("só o FIM é olhado: ligação na primeira palavra não derruba as seguintes ('De Volta Para Casa' vira 'De Volta')", () => {
    expect(nomeCurtoDaLoja("De Volta Para Casa")).toBe("De Volta");
  });
});

describe("nomeCurtoDaLoja — palavra sozinha maior que o limite", () => {
  it("é cortada em EXATAMENTE 12 caracteres", () => {
    const cortado = nomeCurtoDaLoja("Anticonstitucionalissimamente Loja");
    expect(cortado).toBe("Anticonstitu");
    expect(Array.from(cortado)).toHaveLength(12);
  });
});

describe("decidirBootSemFicha — só o endereço exato da máquina do dev é local", () => {
  const semFicha = (hostname: string) =>
    decidirBootSemFicha({
      ficha: null,
      pathname: "/x",
      hostname,
      dev: false,
      search: "",
      hash: "",
    });

  it.each(["localhost", "127.0.0.1", "[::1]", "loja-a.localhost"])(
    "%s é local: segue sem mexer",
    (hostname) => {
      expect(semFicha(hostname)).toEqual({ tipo: "seguir" });
    },
  );

  it.each([
    "meulocalhost",
    "minha-loja-localhost",
    "localhost.evil.com",
    "127x0x0x1",
    "1270.0.0.1",
    "x127.0.0.1",
  ])(
    "%s NÃO é local: o app sem ficha é mandado de volta para '/'",
    (hostname) => {
      expect(semFicha(hostname)).toEqual({
        tipo: "redirecionar",
        destino: "/",
      });
    },
  );
});
