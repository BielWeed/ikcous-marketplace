// Caça por mutação em `endereco-de-entrega`: QUAL endereço recebe o pedido e
// COMO o carrinho/checkout o descrevem em uma linha.
//
// Protege: (1) a ordem de escolha — o endereço que a cliente escolheu vence o
// principal, o principal vence o primeiro da lista, e sem nada disso volta
// `undefined` (nunca um endereço inventado); (2) o formato do resumo
// "rua, número — bairro — cidade/UF · CEP 00000-000", com cada parte vazia ou
// só de espaços sumindo SEM deixar separador sobrando. Só endereços fictícios.
import {
  enderecoDeEntregaEfetivo,
  resumoDoEndereco,
} from "@/lib/endereco-de-entrega";
import type { Address } from "@/types";
import { describe, expect, it } from "vitest";

function endereco(id: string, extra: Partial<Address> = {}): Address {
  return {
    id,
    user_id: "conta-1",
    name: `Endereço ${id}`,
    recipient_name: "Fulana de Tal",
    cep: "38500000",
    street: "Rua Exemplo",
    number: "10",
    neighborhood: "Centro",
    city: "Cidade Exemplo",
    state: "MG",
    is_default: false,
    ...extra,
  };
}

describe("enderecoDeEntregaEfetivo — escolhido, principal, primeiro", () => {
  const primeiro = endereco("a");
  const principal = endereco("b", { is_default: true });
  const outro = endereco("c");
  const lista = [primeiro, principal, outro];

  it("o escolhido vence o principal, mesmo estando depois dele na lista", () => {
    expect(enderecoDeEntregaEfetivo(lista, "c")).toBe(outro);
  });

  it("sem escolha (null, undefined ou vazio), o principal vence o primeiro", () => {
    expect(enderecoDeEntregaEfetivo(lista, null)).toBe(principal);
    expect(enderecoDeEntregaEfetivo(lista, undefined)).toBe(principal);
    expect(enderecoDeEntregaEfetivo(lista, "")).toBe(principal);
  });

  it("escolha que não está mais na lista (apagado em outro aparelho) cai no principal", () => {
    expect(enderecoDeEntregaEfetivo(lista, "apagado")).toBe(principal);
  });

  it("sem principal marcado, cai no PRIMEIRO da lista — não em undefined", () => {
    expect(enderecoDeEntregaEfetivo([primeiro, outro], null)).toBe(primeiro);
    expect(enderecoDeEntregaEfetivo([primeiro, outro], "apagado")).toBe(
      primeiro,
    );
  });

  it("lista vazia não tem destino: undefined", () => {
    expect(enderecoDeEntregaEfetivo([], null)).toBeUndefined();
    expect(enderecoDeEntregaEfetivo([], "qualquer")).toBeUndefined();
  });

  it("com dois principais (lista em transição), vale o primeiro marcado", () => {
    const p1 = endereco("p1", { is_default: true });
    const p2 = endereco("p2", { is_default: true });
    expect(enderecoDeEntregaEfetivo([outro, p1, p2], null)).toBe(p1);
  });
});

describe("resumoDoEndereco — uma linha, sem separador sobrando", () => {
  it("endereço completo: rua, número — bairro — cidade/UF · CEP formatado", () => {
    expect(resumoDoEndereco(endereco("a"))).toBe(
      "Rua Exemplo, 10 — Centro — Cidade Exemplo/MG · CEP 38500-000",
    );
  });

  it("sem número: só a rua, sem vírgula pendurada", () => {
    expect(resumoDoEndereco(endereco("a", { number: "" }))).toBe(
      "Rua Exemplo — Centro — Cidade Exemplo/MG · CEP 38500-000",
    );
  });

  it("número só de espaços conta como ausente", () => {
    expect(resumoDoEndereco(endereco("a", { number: "   " }))).toBe(
      "Rua Exemplo — Centro — Cidade Exemplo/MG · CEP 38500-000",
    );
  });

  it("'S/N' é número como outro qualquer", () => {
    expect(resumoDoEndereco(endereco("a", { number: "S/N" }))).toBe(
      "Rua Exemplo, S/N — Centro — Cidade Exemplo/MG · CEP 38500-000",
    );
  });

  it("espaços nas pontas de rua, número, bairro, cidade e UF são aparados", () => {
    expect(
      resumoDoEndereco(
        endereco("a", {
          street: "  Rua Exemplo ",
          number: " 10 ",
          neighborhood: " Centro  ",
          city: "  Cidade Exemplo ",
          state: " MG ",
        }),
      ),
    ).toBe("Rua Exemplo, 10 — Centro — Cidade Exemplo/MG · CEP 38500-000");
  });

  it("bairro vazio ou só de espaços some junto com o separador", () => {
    for (const neighborhood of ["", "   "]) {
      expect(resumoDoEndereco(endereco("a", { neighborhood }))).toBe(
        "Rua Exemplo, 10 — Cidade Exemplo/MG · CEP 38500-000",
      );
    }
  });

  it("CEP de cidade pequena (sem rua nem bairro): só o que existe", () => {
    expect(
      resumoDoEndereco(
        endereco("a", { street: "", number: "", neighborhood: "" }),
      ),
    ).toBe("Cidade Exemplo/MG · CEP 38500-000");
  });

  it("cidade sem UF e UF sem cidade: sem barra sobrando", () => {
    expect(resumoDoEndereco(endereco("a", { state: "  " }))).toBe(
      "Rua Exemplo, 10 — Centro — Cidade Exemplo · CEP 38500-000",
    );
    expect(resumoDoEndereco(endereco("a", { city: "" }))).toBe(
      "Rua Exemplo, 10 — Centro — MG · CEP 38500-000",
    );
  });

  it("sem CEP: a linha termina nas partes, sem ' · ' nem 'CEP' soltos", () => {
    expect(resumoDoEndereco(endereco("a", { cep: "" }))).toBe(
      "Rua Exemplo, 10 — Centro — Cidade Exemplo/MG",
    );
  });

  it("CEP que não tem 8 dígitos aparece como veio, atrás de 'CEP'", () => {
    expect(resumoDoEndereco(endereco("a", { cep: "3850" }))).toBe(
      "Rua Exemplo, 10 — Centro — Cidade Exemplo/MG · CEP 3850",
    );
  });

  it("só o CEP: sem partes, sem ' · ' na frente", () => {
    expect(
      resumoDoEndereco({
        street: "",
        number: "",
        neighborhood: "",
        city: "",
        state: "",
        cep: "38500-000",
      }),
    ).toBe("CEP 38500-000");
  });

  it("tudo vazio: texto vazio, nunca 'CEP ' nem 'undefined'", () => {
    expect(
      resumoDoEndereco({
        street: "",
        number: "",
        neighborhood: "",
        city: "",
        state: "",
        cep: "",
      }),
    ).toBe("");
  });
});
