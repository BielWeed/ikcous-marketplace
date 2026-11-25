// "Entrega econômica / Entrega expressa" é o rótulo dos serviços PAC e SEDEX
// DOS CORREIOS e de mais ninguém: um serviço que outra transportadora por acaso
// chame de "PAC" ou "SEDEX" mostra o nome dela, não o selo dos Correios (a
// cliente acreditaria que o pacote vai pelos Correios). Os Correios sem serviço
// informado continuam aparecendo (só o nome). E sem provedor (agregador) a marca
// diz `agregador: null`, nunca `undefined`.
import { describe, expect, it } from "vitest";

import { marcaDoFrete } from "@/lib/marca-do-frete";

describe("marcaDoFrete: PAC e SEDEX só valem para os Correios", () => {
  it.each([
    ["Jadlog", "Jadlog PAC", "PAC"],
    ["Jadlog", "Jadlog SEDEX", "SEDEX"],
    ["Loggi", "Loggi PAC", "PAC"],
    ["Transportadora Nova Ltda", "Transportadora Nova Ltda SEDEX", "SEDEX"],
  ])(
    "%s com serviço %s não usa o rótulo dos Correios",
    (transportadora, titulo, servico) => {
      const r = marcaDoFrete({ transportadora, servico });

      expect(r.titulo).toBe(titulo);
      expect(r.subtitulo).toBeNull();
      expect(r.titulo).not.toMatch(/Entrega (econômica|expressa)/);
    },
  );

  it("Correios sem serviço informado: só o nome, sem subtítulo e sem quebrar", () => {
    for (const servico of [undefined, "", "   "]) {
      const r = marcaDoFrete({ transportadora: "Correios", servico });

      expect(r.titulo).toBe("Correios");
      expect(r.subtitulo).toBeNull();
      expect(r.servico).toBeNull();
    }
  });

  it("Correios com serviço que não é PAC nem SEDEX mantém o nome composto", () => {
    const r = marcaDoFrete({
      transportadora: "Correios",
      servico: "Mini Envios",
    });

    expect(r.titulo).toBe("Correios Mini Envios");
    expect(r.subtitulo).toBeNull();
  });
});

describe("marcaDoFrete: agregador ausente é null", () => {
  it("transportadora conhecida sem provedor nenhum", () => {
    const r = marcaDoFrete({ transportadora: "Loggi", servico: "Express" });

    expect(r.agregador).toBeNull();
  });

  it("provedor só com espaços também não vira agregador", () => {
    const r = marcaDoFrete({
      transportadora: "Loggi",
      servico: "Express",
      provedorRotulo: "   ",
    });

    expect(r.agregador).toBeNull();
  });
});
