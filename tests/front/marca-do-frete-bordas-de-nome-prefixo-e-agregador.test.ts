// Bordas do normalizador de marca do frete que os testes vizinhos não prendiam
// (caça por mutação, 25/11/2026). Cada caso abaixo derruba um defeito de UMA
// linha em `marca-do-frete.ts` que antes passava despercebido:
//  - a transportadora é reconhecida mesmo com acento ("Jádlog") e na grafia
//    "JeT Express" (colada);
//  - o prefixo repetido no serviço cai com qualquer caixa e com os espaços que
//    a transportadora escrever ("LOGGI Express", "Jad Log Package",
//    "TotalExpress Standard"), mas NUNCA come uma palavra que só começa igual
//    ("Loggistica");
//  - ponto solto: todos caem, e um serviço que era só pontuação vira `null`;
//  - o rótulo do provedor ganha do `provider` bruto; "Super Frete" separado é
//    reconhecido; opção sem transportadora (entrega local, retirada) nunca
//    carrega agregador;
//  - o nome sem transportadora sai aparado; e o conjunto dos logos que
//    precisam de selo escuro é exatamente a Azul Cargo.
import { describe, expect, it } from "vitest";

import {
  LOGO_SOBRE_FUNDO_ESCURO,
  logoDaTransportadora,
  marcaDoFrete,
} from "@/lib/marca-do-frete";

describe("marcaDoFrete: reconhecimento da transportadora", () => {
  it("acento no nome não impede o reconhecimento (Jádlog = Jadlog)", () => {
    const r = marcaDoFrete({ transportadora: "Jádlog", servico: "Package" });

    expect(r.transportadora).toEqual({ slug: "jadlog", nome: "Jadlog" });
    expect(r.titulo).toBe("Jadlog Package");
  });

  it.each(["JeT Express", "JetExpress", "J&T Express", "JT"])(
    "%s é a J&T Express",
    (nome) => {
      const r = marcaDoFrete({ transportadora: nome, servico: "Standard" });

      expect(r.transportadora).toEqual({
        slug: "jt-express",
        nome: "J&T Express",
      });
      expect(r.titulo).toBe("J&T Express Standard");
    },
  );
});

describe("marcaDoFrete: prefixo da transportadora repetido no serviço", () => {
  it.each([
    ["Loggi", "LOGGI Express", "Express"],
    ["Jadlog", "Jad Log Package", "Package"],
    ["Jadlog", "JADLOG Package", "Package"],
    ["Total Express", "TotalExpress Standard", "Standard"],
    ["Total Express", "TOTAL EXPRESS Standard", "Standard"],
    ["LATAM Cargo", "LatamCargo Standard", "Standard"],
    ["LATAM Cargo", "latam cargo Standard", "Standard"],
    ["Buslog", "BUSLOG Standard", "Standard"],
    ["Correios", "CORREIOS Mini Envios", "Mini Envios"],
  ])(
    "%s com serviço %s mostra só %s",
    (transportadora, servicoBruto, servico) => {
      const r = marcaDoFrete({ transportadora, servico: servicoBruto });

      expect(r.servico).toBe(servico);
    },
  );

  it("serviço que só COMEÇA com as letras da transportadora não perde a palavra", () => {
    const r = marcaDoFrete({ transportadora: "Loggi", servico: "Loggistica" });

    expect(r.servico).toBe("Loggistica");
    expect(r.titulo).toBe("Loggi Loggistica");
  });
});

describe("marcaDoFrete: pontuação solta no começo do serviço", () => {
  it("todos os pontos do começo caem", () => {
    const r = marcaDoFrete({ transportadora: "Jadlog", servico: "..Package" });

    expect(r.servico).toBe("Package");
    expect(r.titulo).toBe("Jadlog Package");
  });

  it("serviço que era só ponto vira null e o título é só o nome", () => {
    const r = marcaDoFrete({ transportadora: "Jadlog", servico: "." });

    expect(r.servico).toBeNull();
    expect(r.titulo).toBe("Jadlog");
  });
});

describe("marcaDoFrete: agregador", () => {
  it("o rótulo do provedor vale mais que o campo provider bruto", () => {
    const r = marcaDoFrete({
      transportadora: "Loggi",
      servico: "Express",
      provedorRotulo: "SuperFrete",
      provider: "frenet",
    });

    expect(r.agregador).toEqual({ slug: "superfrete", nome: "SuperFrete" });
  });

  it("'Super Frete' escrito separado também é a SuperFrete", () => {
    const r = marcaDoFrete({
      transportadora: "Loggi",
      servico: "Express",
      provedorRotulo: "Super Frete",
    });

    expect(r.agregador).toEqual({ slug: "superfrete", nome: "SuperFrete" });
  });

  it("opção sem transportadora (entrega local) nunca carrega agregador", () => {
    const r = marcaDoFrete({
      name: "Entrega local",
      provedorRotulo: "Melhor Envio",
      provider: "melhor_envio",
    });

    expect(r.transportadora).toBeNull();
    expect(r.agregador).toBeNull();
    expect(r.titulo).toBe("Entrega local");
  });
});

describe("marcaDoFrete: nome sem transportadora", () => {
  it("devolve o nome original aparado como título", () => {
    const r = marcaDoFrete({ name: "  Retirada na loja  " });

    expect(r.titulo).toBe("Retirada na loja");
    expect(r.subtitulo).toBeNull();
  });
});

describe("logos que precisam de selo escuro", () => {
  it("são exatamente os da Azul Cargo, e todos têm arquivo de logo", () => {
    expect([...LOGO_SOBRE_FUNDO_ESCURO]).toEqual(["azul-cargo"]);
    for (const slug of LOGO_SOBRE_FUNDO_ESCURO) {
      expect(logoDaTransportadora(slug)).toBeTruthy();
    }
  });
});
