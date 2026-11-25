// Central de Fornecedores, E1: as regras puras do cadastro (validação, normalização
// e os três atalhos de um toque). Espelham os CHECKs da migration
// 20261450000000_a_loja_guarda_os_fornecedores.sql: o front nunca aceita o que o
// banco recusaria, e o link só nasce de valor que passa na MESMA regra do banco
// (dado velho ou estranho no banco vira "sem atalho", nunca link perigoso).
import { describe, expect, it } from "vitest";

import {
  type FormularioDoFornecedor,
  UFS,
  linkDoInstagram,
  linkDoSite,
  linkDoWhatsapp,
  validarFornecedor,
} from "@/lib/fornecedores";

function form(
  extra: Partial<FormularioDoFornecedor> = {},
): FormularioDoFornecedor {
  return {
    nome: "Atacado Fixture",
    whatsapp: "",
    instagram: "",
    site: "",
    cidade: "",
    uf: "",
    observacoes: "",
    favorito: false,
    ...extra,
  };
}

function dadosOuFalha(f: FormularioDoFornecedor) {
  const r = validarFornecedor(f);
  if (!r.ok) throw new Error(`esperava ok: ${JSON.stringify(r.erros)}`);
  return r.dados;
}

describe("nome", () => {
  it("é obrigatório: vazio e só espaços são recusados", () => {
    for (const nome of ["", "   ", "\n\t"]) {
      const r = validarFornecedor(form({ nome }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.erros.nome).toMatch(/nome/i);
    }
  });

  it("apara as pontas e junta espaços repetidos", () => {
    expect(dadosOuFalha(form({ nome: "  Atacado   do   Zé " })).nome).toBe(
      "Atacado do Zé",
    );
  });

  it("80 caracteres passam; 81 não (conta letra, não byte nem emoji dobrado)", () => {
    expect(validarFornecedor(form({ nome: "a".repeat(80) })).ok).toBe(true);
    expect(validarFornecedor(form({ nome: "a".repeat(81) })).ok).toBe(false);
    // 80 emojis = 80 caracteres para o banco (char_length), mesmo ocupando 160 unidades em JS.
    expect(validarFornecedor(form({ nome: "😀".repeat(80) })).ok).toBe(true);
    expect(validarFornecedor(form({ nome: "😀".repeat(81) })).ok).toBe(false);
  });
});

describe("WhatsApp", () => {
  it("vazio vira nulo (campo opcional)", () => {
    expect(dadosOuFalha(form()).whatsapp).toBeNull();
  });

  it("guarda só os números, aceitando máscara comum", () => {
    expect(dadosOuFalha(form({ whatsapp: "(11) 90000-0000" })).whatsapp).toBe(
      "11900000000",
    );
    expect(dadosOuFalha(form({ whatsapp: "+55 11 90000-0000" })).whatsapp).toBe(
      "5511900000000",
    );
  });

  it("10 a 13 números passam; 9 e 14 não", () => {
    expect(validarFornecedor(form({ whatsapp: "1190000000" })).ok).toBe(true);
    expect(validarFornecedor(form({ whatsapp: "5511900000000" })).ok).toBe(
      true,
    );
    for (const w of ["119000000", "55119000000000"]) {
      const r = validarFornecedor(form({ whatsapp: w }));
      expect(r.ok, w).toBe(false);
      if (!r.ok) expect(r.erros.whatsapp).toMatch(/DDD/);
    }
  });

  it("letra no meio recusa em vez de ser jogada fora em silêncio", () => {
    const r = validarFornecedor(form({ whatsapp: "meu zap 11900000000" }));
    expect(r.ok).toBe(false);
    const r2 = validarFornecedor(form({ whatsapp: "abc" }));
    expect(r2.ok).toBe(false);
  });

  it("link: sem país ganha 55; com país fica como está", () => {
    expect(linkDoWhatsapp("11900000000")).toBe("https://wa.me/5511900000000");
    expect(linkDoWhatsapp("1130000000")).toBe("https://wa.me/551130000000");
    expect(linkDoWhatsapp("5511900000000")).toBe("https://wa.me/5511900000000");
  });

  it("link: zero antigo de operadora/DDD à esquerda é tirado só do LINK (o número salvo não muda)", () => {
    // "(011) 90000-0000" é guardado como 011900000000 (12 números, aceito pelo banco).
    const r = validarFornecedor(form({ whatsapp: "(011) 90000-0000" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dados.whatsapp).toBe("011900000000");
    expect(linkDoWhatsapp("011900000000")).toBe("https://wa.me/5511900000000");
    expect(linkDoWhatsapp("01130000000")).toBe("https://wa.me/551130000000");
    // Sem o zero, nada muda; com país, o 55 continua como está.
    expect(linkDoWhatsapp("5511900000000")).toBe("https://wa.me/5511900000000");
  });

  it("link: só zeros, ou pouco número depois de tirar os zeros, não vira atalho", () => {
    expect(linkDoWhatsapp("0000000000")).toBeNull();
    expect(linkDoWhatsapp("0123456789")).toBeNull();
  });

  it("link: valor fora do contrato do banco não vira atalho", () => {
    for (const v of [null, "", "abc", "123", "11 90000-0000", "../etc"]) {
      expect(linkDoWhatsapp(v), String(v)).toBeNull();
    }
  });
});

describe("Instagram", () => {
  it("aceita @usuario, usuario e link do perfil; guarda só o usuário", () => {
    for (const entrada of [
      "@loja.fixture",
      "loja.fixture",
      "instagram.com/loja.fixture",
      "https://www.instagram.com/loja.fixture/",
      "https://instagram.com/loja.fixture?hl=pt-br",
    ]) {
      expect(
        dadosOuFalha(form({ instagram: entrada })).instagram,
        entrada,
      ).toBe("loja.fixture");
    }
  });

  it("link de post, reel ou de outro site não é perfil: recusa", () => {
    for (const entrada of [
      "https://www.instagram.com/p/AbCd123/",
      "https://www.instagram.com/reel/AbCd123/",
      "https://www.facebook.com/loja",
      "https://evil.test/instagram.com/loja",
    ]) {
      const r = validarFornecedor(form({ instagram: entrada }));
      expect(r.ok, entrada).toBe(false);
      if (!r.ok) expect(r.erros.instagram).toBeTruthy();
    }
  });

  it("usuário com caractere inválido ou maior que 30 recusa", () => {
    for (const entrada of ["loja fixture", "loja/fixture", "a".repeat(31)]) {
      expect(validarFornecedor(form({ instagram: entrada })).ok, entrada).toBe(
        false,
      );
    }
    expect(validarFornecedor(form({ instagram: "a".repeat(30) })).ok).toBe(
      true,
    );
  });

  it("link: só de usuário válido", () => {
    expect(linkDoInstagram("loja.fixture")).toBe(
      "https://instagram.com/loja.fixture",
    );
    for (const v of [null, "", "a b", "x/../y", "javascript:alert(1)"]) {
      expect(linkDoInstagram(v), String(v)).toBeNull();
    }
  });
});

describe("site", () => {
  it("sem esquema ganha https://; http:// sobe para https://", () => {
    expect(dadosOuFalha(form({ site: "exemplo.fixture.invalid" })).site).toBe(
      "https://exemplo.fixture.invalid",
    );
    expect(
      dadosOuFalha(form({ site: "http://exemplo.fixture.invalid/loja" })).site,
    ).toBe("https://exemplo.fixture.invalid/loja");
  });

  it("recusa esquema perigoso, endereço sem ponto, usuário@ e espaço", () => {
    for (const s of [
      "javascript:alert(1)",
      "ftp://exemplo.fixture.invalid",
      "https://localhost",
      "https://user:senha@exemplo.fixture.invalid",
      "https://exemplo fixture.invalid",
    ]) {
      expect(validarFornecedor(form({ site: s })).ok, s).toBe(false);
    }
  });

  it("limite de 200 caracteres", () => {
    // O prefixo "https://exemplo.fixture.invalid/" tem 32 caracteres: 32 + 168 = 200 exatos.
    const longo = `https://exemplo.fixture.invalid/${"a".repeat(168)}`;
    expect(Array.from(longo)).toHaveLength(200);
    expect(validarFornecedor(form({ site: longo })).ok).toBe(true);
    expect(validarFornecedor(form({ site: `${longo}a` })).ok).toBe(false);
  });

  it("link: só https de verdade; o resto vira sem atalho", () => {
    expect(linkDoSite("https://exemplo.fixture.invalid")).toBe(
      "https://exemplo.fixture.invalid/",
    );
    for (const v of [
      null,
      "",
      "javascript:alert(1)",
      "http://exemplo.fixture.invalid",
      "exemplo.fixture.invalid",
    ]) {
      expect(linkDoSite(v), String(v)).toBeNull();
    }
  });
});

describe("cidade, UF, observações e favorito", () => {
  it("opcionais vazios viram nulo; favorito segue o formulário", () => {
    const d = dadosOuFalha(form({ favorito: true }));
    expect(d).toMatchObject({
      cidade: null,
      uf: null,
      observacoes: null,
      favorito: true,
    });
  });

  it("UF só das 27 siglas; cidade até 80", () => {
    expect(UFS).toHaveLength(27);
    expect(dadosOuFalha(form({ uf: "SP", cidade: "São Paulo" }))).toMatchObject(
      {
        uf: "SP",
        cidade: "São Paulo",
      },
    );
    expect(validarFornecedor(form({ uf: "XX" })).ok).toBe(false);
    expect(validarFornecedor(form({ uf: "sp" })).ok).toBe(false);
    expect(validarFornecedor(form({ cidade: "a".repeat(81) })).ok).toBe(false);
  });

  it("observações: 500 passam, 501 não; quebra de linha é mantida", () => {
    expect(validarFornecedor(form({ observacoes: "a".repeat(500) })).ok).toBe(
      true,
    );
    expect(validarFornecedor(form({ observacoes: "a".repeat(501) })).ok).toBe(
      false,
    );
    expect(
      dadosOuFalha(form({ observacoes: " linha 1\nlinha 2 " })).observacoes,
    ).toBe("linha 1\nlinha 2");
  });

  it("vários erros de uma vez, cada um no seu campo", () => {
    const r = validarFornecedor(
      form({ nome: "", whatsapp: "12", site: "javascript:x", uf: "ZZ" }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.erros).sort()).toEqual(
        ["nome", "site", "uf", "whatsapp"].sort(),
      );
    }
  });
});
