// @vitest-environment jsdom
// `emailDeContatoValido` é a régua do e-mail de contato exigido pela SuperFrete
// e pelo Melhor Envio (cópia da régua da edge): devolve o e-mail aparado ou
// `null`. Os testes de tela a trocam por um dublê (`() => true`) ou só passam
// por ela de raspão; nenhum a exercita nas bordas. É dela que a tela de Frete
// decide se uma chave salva está completa, então um falso "válido" liga um
// provedor que a edge vai recusar, e um falso "inválido" trava a lojista.
// E-mails abaixo são FICTÍCIOS.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: vi.fn() }, from: vi.fn() },
}));

import { emailDeContatoValido } from "@/components/admin/settings/TransportadorasCard";

describe("emailDeContatoValido — o que passa", () => {
  it("e-mail comum devolve ele mesmo", () => {
    expect(emailDeContatoValido("loja@exemplo.com.br")).toBe(
      "loja@exemplo.com.br",
    );
    expect(emailDeContatoValido("a@b.co")).toBe("a@b.co");
  });

  it("aparar espaços e quebras nas pontas, e devolver o texto já aparado", () => {
    expect(emailDeContatoValido("  loja@exemplo.com \n")).toBe(
      "loja@exemplo.com",
    );
  });

  it("parte local aceita letras, números e . _ % + -", () => {
    expect(emailDeContatoValido("Ab.c_d%e+f-9@exemplo.com")).toBe(
      "Ab.c_d%e+f-9@exemplo.com",
    );
  });

  it("domínio com subdomínios, hífen no meio, números e fim em maiúsculas", () => {
    expect(emailDeContatoValido("a@mail.minha-loja2.com.br")).toBe(
      "a@mail.minha-loja2.com.br",
    );
    expect(emailDeContatoValido("A@B.COM")).toBe("A@B.COM");
  });
});

describe("emailDeContatoValido — o que NÃO passa", () => {
  it("o que não é texto vira null (sem lançar erro)", () => {
    for (const lixo of [undefined, null, 0, 42, true, {}, [], ["a@b.co"]]) {
      expect(emailDeContatoValido(lixo), JSON.stringify(lixo)).toBeNull();
    }
  });

  it("vazio e só espaços viram null", () => {
    expect(emailDeContatoValido("")).toBeNull();
    expect(emailDeContatoValido("   \t ")).toBeNull();
  });

  it("sem @, @ no começo e mais de um @ viram null", () => {
    expect(emailDeContatoValido("ab.cd")).toBeNull();
    expect(emailDeContatoValido("a.bc")).toBeNull();
    expect(emailDeContatoValido("@exemplo.com")).toBeNull();
    expect(emailDeContatoValido("a@b@exemplo.com")).toBeNull();
    expect(emailDeContatoValido("a@@exemplo.com")).toBeNull();
  });

  it("caractere fora da lista na parte local vira null", () => {
    for (const local of [
      "a b",
      "a,b",
      "a(b)",
      "á",
      "a;b",
      "a/b",
      'a"b',
      "a'b",
    ]) {
      expect(emailDeContatoValido(`${local}@exemplo.com`), local).toBeNull();
    }
  });

  it("domínio sem ponto, ou com rótulo vazio, vira null", () => {
    expect(emailDeContatoValido("a@localhost")).toBeNull();
    expect(emailDeContatoValido("a@exemplo.")).toBeNull();
    expect(emailDeContatoValido("a@.com")).toBeNull();
    expect(emailDeContatoValido("a@exemplo..com")).toBeNull();
    expect(emailDeContatoValido("a@")).toBeNull();
  });

  it("o último rótulo (a terminação) tem de ter 2+ LETRAS", () => {
    expect(emailDeContatoValido("a@exemplo.c")).toBeNull();
    expect(emailDeContatoValido("a@exemplo.123")).toBeNull();
    expect(emailDeContatoValido("a@exemplo.c1")).toBeNull();
    expect(emailDeContatoValido("a@exemplo.co-m")).toBeNull();
    expect(emailDeContatoValido("a@exemplo.co")).toBe("a@exemplo.co");
  });

  it("caractere fora da lista em qualquer rótulo do domínio vira null", () => {
    for (const dominio of [
      "ex_emplo.com",
      "ex emplo.com",
      "exemplo!.com",
      "bücher.de",
      "mail.ex_emplo.com",
    ]) {
      expect(emailDeContatoValido(`a@${dominio}`), dominio).toBeNull();
    }
  });
});

describe("emailDeContatoValido — o limite de 254 caracteres", () => {
  const COM_TAMANHO = (total: number) =>
    `${"a".repeat(total - "@b.com".length)}@b.com`;

  it("254 caracteres ainda passa; 255 não", () => {
    expect(COM_TAMANHO(254)).toHaveLength(254);
    expect(emailDeContatoValido(COM_TAMANHO(254))).toBe(COM_TAMANHO(254));
    expect(emailDeContatoValido(COM_TAMANHO(255))).toBeNull();
  });

  it("o limite vale para o texto JÁ aparado (espaços das pontas não contam)", () => {
    expect(emailDeContatoValido(`  ${COM_TAMANHO(254)}  `)).toBe(
      COM_TAMANHO(254),
    );
    expect(emailDeContatoValido(`  ${COM_TAMANHO(255)}  `)).toBeNull();
  });
});
