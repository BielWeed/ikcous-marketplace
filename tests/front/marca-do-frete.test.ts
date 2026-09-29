import {
  logoDaTransportadora,
  logoDoAgregador,
  marcaDoFrete,
} from "@/lib/marca-do-frete";
// MARCA DO FRETE (peça 2 da tarefa "cart-frete-logos") — normalizador central
// de nome de transportadora e agregador para os cartões de cotação de frete
// (carrinho, checkout e painel admin). Só EXIBIÇÃO: não altera id, código
// nem o objeto persistido — ver o contrato completo no topo de
// `src/lib/marca-do-frete.ts`.
import { describe, expect, it } from "vitest";

describe("marcaDoFrete — serviço limpo (exemplos da captura do dono)", () => {
  it("Jadlog — .Package: remove o ponto solto", () => {
    const r = marcaDoFrete({ transportadora: "Jadlog", servico: ".Package" });
    expect(r.transportadora).toEqual({ slug: "jadlog", nome: "Jadlog" });
    expect(r.servico).toBe("Package");
    expect(r.titulo).toBe("Jadlog Package");
    expect(r.subtitulo).toBeNull();
  });

  it("Jadlog — .Com: o ponto é parte do NOME do produto e fica", () => {
    const r = marcaDoFrete({ transportadora: "Jadlog", servico: ".Com" });
    expect(r.servico).toBe(".Com");
    expect(r.titulo).toBe("Jadlog .Com");
  });

  it("Jadlog — .Package Centralizado: preserva a especificidade completa", () => {
    const r = marcaDoFrete({
      transportadora: "Jadlog",
      servico: ".Package Centralizado",
    });
    expect(r.servico).toBe("Package Centralizado");
    expect(r.titulo).toBe("Jadlog Package Centralizado");
  });

  it("Jadlog — Jadlog Package: tira o nome da transportadora repetido no serviço", () => {
    const r = marcaDoFrete({
      transportadora: "Jadlog",
      servico: "Jadlog Package",
    });
    expect(r.servico).toBe("Package");
    expect(r.titulo).toBe("Jadlog Package");
  });

  it("Loggi — Express: título sem duplicar nada", () => {
    const r = marcaDoFrete({ transportadora: "Loggi", servico: "Express" });
    expect(r.transportadora).toEqual({ slug: "loggi", nome: "Loggi" });
    expect(r.servico).toBe("Express");
    expect(r.titulo).toBe("Loggi Express");
    expect(r.subtitulo).toBeNull();
  });

  it("Total Express — Standard", () => {
    const r = marcaDoFrete({
      transportadora: "Total Express",
      servico: "Standard",
    });
    expect(r.transportadora).toEqual({
      slug: "total-express",
      nome: "Total Express",
    });
    expect(r.servico).toBe("Standard");
    expect(r.titulo).toBe("Total Express Standard");
  });

  it("JeT — Standard: apelido reconhecido vira J&T Express", () => {
    const r = marcaDoFrete({ transportadora: "JeT", servico: "Standard" });
    expect(r.transportadora).toEqual({
      slug: "jt-express",
      nome: "J&T Express",
    });
    expect(r.servico).toBe("Standard");
    expect(r.titulo).toBe("J&T Express Standard");
  });

  it("J&T Express — .Standard: mesmo apelido por extenso, com ponto solto", () => {
    const r = marcaDoFrete({
      transportadora: "J&T Express",
      servico: ".Standard",
    });
    expect(r.transportadora?.slug).toBe("jt-express");
    expect(r.servico).toBe("Standard");
  });

  it("'JeT Standard' inteiro dentro do campo serviço também limpa o prefixo", () => {
    const r = marcaDoFrete({
      transportadora: "J&T Express",
      servico: "JeT Standard",
    });
    expect(r.servico).toBe("Standard");
  });

  it("'J&T Standard' inteiro dentro do campo serviço também limpa o prefixo", () => {
    const r = marcaDoFrete({
      transportadora: "J&T Express",
      servico: "J&T Standard",
    });
    expect(r.servico).toBe("Standard");
  });
});

describe("marcaDoFrete — Correios: econômica/expressa não duplicam com o subtítulo", () => {
  it("Correios PAC vira 'Entrega econômica', subtítulo mostra o serviço real", () => {
    const r = marcaDoFrete({ transportadora: "Correios", servico: "PAC" });
    expect(r.transportadora).toEqual({ slug: "correios", nome: "Correios" });
    expect(r.servico).toBe("PAC");
    expect(r.titulo).toBe("Entrega econômica");
    expect(r.subtitulo).toBe("Correios · PAC");
  });

  it("Correios SEDEX vira 'Entrega expressa'", () => {
    const r = marcaDoFrete({ transportadora: "Correios", servico: "SEDEX" });
    expect(r.titulo).toBe("Entrega expressa");
    expect(r.subtitulo).toBe("Correios · SEDEX");
  });

  it("'Correios PAC' inteiro no campo serviço também limpa o prefixo repetido", () => {
    const r = marcaDoFrete({
      transportadora: "Correios",
      servico: "Correios PAC",
    });
    expect(r.servico).toBe("PAC");
    expect(r.titulo).toBe("Entrega econômica");
  });

  it("Correios Mini Envios: fora de PAC/SEDEX, sem genérico nem subtítulo redundante", () => {
    const r = marcaDoFrete({
      transportadora: "Correios",
      servico: "Mini Envios",
    });
    expect(r.titulo).toBe("Correios Mini Envios");
    expect(r.subtitulo).toBeNull();
  });
});

describe("marcaDoFrete — as demais transportadoras nacionais do catálogo", () => {
  it("LATAM Cargo", () => {
    const r = marcaDoFrete({
      transportadora: "LATAM Cargo",
      servico: "Standard",
    });
    expect(r.transportadora).toEqual({
      slug: "latam-cargo",
      nome: "LATAM Cargo",
    });
    expect(r.titulo).toBe("LATAM Cargo Standard");
  });

  it("Azul Cargo (forma curta) reconhece o mesmo slug de Azul Cargo Express", () => {
    const r = marcaDoFrete({ transportadora: "Azul Cargo", servico: "Rodo" });
    expect(r.transportadora).toEqual({
      slug: "azul-cargo",
      nome: "Azul Cargo Express",
    });
  });

  it("Azul Cargo Express (forma completa)", () => {
    const r = marcaDoFrete({
      transportadora: "Azul Cargo Express",
      servico: "Rodo",
    });
    expect(r.transportadora?.slug).toBe("azul-cargo");
    expect(r.titulo).toBe("Azul Cargo Express Rodo");
  });

  it("Buslog", () => {
    const r = marcaDoFrete({ transportadora: "Buslog", servico: "Rodo" });
    expect(r.transportadora).toEqual({ slug: "buslog", nome: "Buslog" });
    expect(r.titulo).toBe("Buslog Rodo");
  });

  it("reconhecimento é robusto a caixa, acento e pontuação (JADLOG maiúsculo)", () => {
    const r = marcaDoFrete({ transportadora: "JADLOG", servico: "Package" });
    expect(r.transportadora?.slug).toBe("jadlog");
  });
});

describe("marcaDoFrete — transportadora desconhecida", () => {
  it("mantém o texto original aparado, sem slug (sem logo)", () => {
    const r = marcaDoFrete({
      transportadora: "  Transportadora Nova Ltda  ",
      servico: "Rodoviário",
    });
    expect(r.transportadora).toEqual({
      slug: null,
      nome: "Transportadora Nova Ltda",
    });
    expect(r.titulo).toBe("Transportadora Nova Ltda Rodoviário");
  });
});

describe("marcaDoFrete — sem transportadora (local, retirada, grátis)", () => {
  it("retirada na loja: devolve o name original, sem transportadora e sem agregador", () => {
    const r = marcaDoFrete({
      id: "store-pickup",
      name: "Retirar na loja",
      provider: "store-pickup",
    });
    expect(r.transportadora).toBeNull();
    expect(r.servico).toBeNull();
    expect(r.titulo).toBe("Retirar na loja");
    expect(r.subtitulo).toBeNull();
    expect(r.agregador).toBeNull();
  });

  it("entrega local da loja", () => {
    const r = marcaDoFrete({ id: "local-delivery", name: "Entrega local" });
    expect(r.transportadora).toBeNull();
    expect(r.titulo).toBe("Entrega local");
    expect(r.agregador).toBeNull();
  });

  it("frete grátis sem transportadora informada", () => {
    const r = marcaDoFrete({ id: "free", name: "Frete grátis" });
    expect(r.transportadora).toBeNull();
    expect(r.titulo).toBe("Frete grátis");
  });

  it("entrada vazia (sem name nem transportadora): título vazio, nunca undefined", () => {
    const r = marcaDoFrete({});
    expect(r.transportadora).toBeNull();
    expect(r.titulo).toBe("");
    expect(r.agregador).toBeNull();
  });
});

describe("marcaDoFrete — agregador (provedor)", () => {
  it("Melhor Envio", () => {
    const r = marcaDoFrete({
      transportadora: "Loggi",
      servico: "Express",
      provedorRotulo: "Melhor Envio",
    });
    expect(r.agregador).toEqual({ slug: "melhor-envio", nome: "Melhor Envio" });
  });

  it("Frenet", () => {
    const r = marcaDoFrete({
      transportadora: "J&T Express",
      servico: "Standard",
      provedorRotulo: "Frenet",
    });
    expect(r.agregador).toEqual({ slug: "frenet", nome: "Frenet" });
  });

  it("SuperFrete", () => {
    const r = marcaDoFrete({
      transportadora: "Correios",
      servico: "PAC",
      provedorRotulo: "SuperFrete",
    });
    expect(r.agregador).toEqual({ slug: "superfrete", nome: "SuperFrete" });
  });

  it("agregador nunca é confundido com transportadora mesmo se o texto se parecer", () => {
    const r = marcaDoFrete({
      transportadora: "Correios",
      servico: "PAC",
      provedorRotulo: "SuperFrete",
    });
    expect(r.transportadora?.nome).toBe("Correios");
    expect(r.agregador?.nome).toBe("SuperFrete");
  });

  it("rótulo de provedor desconhecido não vira agregador inventado", () => {
    const r = marcaDoFrete({
      transportadora: "Loggi",
      servico: "Express",
      provedorRotulo: "Transportadora Interna XPTO",
    });
    expect(r.agregador).toBeNull();
  });

  it("sem provedorRotulo, tenta o campo provider bruto", () => {
    const r = marcaDoFrete({
      transportadora: "Loggi",
      servico: "Express",
      provider: "frenet-LOGGI",
    });
    expect(r.agregador).toEqual({ slug: "frenet", nome: "Frenet" });
  });
});

describe("marcaDoFrete — admin usa só (transportadora, servico, provedor)", () => {
  it("funciona sem id, name nem provider — só os três campos do admin", () => {
    const r = marcaDoFrete({
      transportadora: "Jadlog",
      servico: ".Package",
      provedorRotulo: "Frenet",
    });
    expect(r.transportadora).toEqual({ slug: "jadlog", nome: "Jadlog" });
    expect(r.servico).toBe("Package");
    expect(r.agregador).toEqual({ slug: "frenet", nome: "Frenet" });
  });
});

describe("marcaDoFrete — prefixo com espaços repetidos e consulta de logo segura", () => {
  it.each([
    ["J & T Express   Standard", "Standard"],
    ["JeT	Standard", "Standard"],
    ["Azul  Cargo  Express  Standard", "Standard"],
    ["Azul Cargo Standard", "Standard"],
  ])("serviço %j perde o prefixo da transportadora", (servico, esperado) => {
    const transportadora = servico.startsWith("Azul")
      ? "Azul Cargo Express"
      : "J&T Express";
    expect(marcaDoFrete({ transportadora, servico }).servico).toBe(esperado);
  });

  it("slug que é nome de membro do protótipo não devolve logo", () => {
    for (const slug of ["constructor", "toString", "__proto__"]) {
      expect(logoDaTransportadora(slug)).toBeUndefined();
      expect(logoDoAgregador(slug)).toBeUndefined();
    }
    expect(logoDaTransportadora("correios")).toBe(
      "/logos/transportadoras/correios.svg",
    );
    expect(logoDoAgregador("frenet")).toBe("/logos/provedores/frenet.svg");
  });
});
