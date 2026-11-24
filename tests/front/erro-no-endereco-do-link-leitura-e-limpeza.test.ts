// Link de e-mail (recuperação de senha ou confirmação de cadastro) que volta
// COM ERRO no fim do endereço — no `#hash` ou, em alguns caminhos, na query.
// `src/lib/erro-no-endereco-do-link.ts` LÊ o endereço (traz erro? é de
// recuperação?) e o LIMPA depois do aviso (o que vai para `replaceState`). Só
// o AuthContext as chamava, e os testes de tela passam por ele inteiro; este
// arquivo prende as três funções diretamente, com os limites da leitura do
// hash (com e sem `#`), cada chave de erro e o que a limpeza NÃO pode apagar
// (outros parâmetros, caminho e o resto do hash).
import { describe, expect, it } from "vitest";

import {
  enderecoEhDeRecuperacao,
  enderecoSemOErroDoLink,
  enderecoTrazErroDeLink,
} from "@/lib/erro-no-endereco-do-link";

describe("enderecoTrazErroDeLink — só o `error_code` conta", () => {
  it("no hash (com o # na frente, como o navegador entrega)", () => {
    expect(
      enderecoTrazErroDeLink("", "#error=access_denied&error_code=otp_expired"),
    ).toBe(true);
  });

  it("no hash sem o #", () => {
    expect(enderecoTrazErroDeLink("", "error_code=otp_expired")).toBe(true);
  });

  it("na query", () => {
    expect(enderecoTrazErroDeLink("?error_code=otp_expired", "")).toBe(true);
  });

  it("vazio também é presença: o servidor mandou a chave", () => {
    expect(enderecoTrazErroDeLink("?error_code=", "")).toBe(true);
    expect(enderecoTrazErroDeLink("", "#error_code=")).toBe(true);
  });

  it("LIMITE: `error` e `error_description` sozinhos NÃO são o erro do link (sem o código)", () => {
    expect(enderecoTrazErroDeLink("?error=access_denied", "")).toBe(false);
    expect(
      enderecoTrazErroDeLink("", "#error=access_denied&error_description=x"),
    ).toBe(false);
  });

  it("endereço sem nada, ou só com o tipo, não traz erro", () => {
    expect(enderecoTrazErroDeLink("", "")).toBe(false);
    expect(enderecoTrazErroDeLink("?type=recovery", "#type=recovery")).toBe(
      false,
    );
  });

  it("LIMITE: o nome da chave tem de ser exato (um prefixo `#` colado não conta como chave)", () => {
    // Sem tirar o `#`, a chave lida seria "#error_code" e o erro passaria batido.
    expect(enderecoTrazErroDeLink("", "#error_code=x")).toBe(true);
    expect(enderecoTrazErroDeLink("", "#x_error_code=1")).toBe(false);
  });
});

describe("enderecoEhDeRecuperacao — `type=recovery` na query ou no hash", () => {
  it.each([
    ["?type=recovery", "", true],
    ["", "#type=recovery&access_token=abc", true],
    ["", "type=recovery", true],
    ["?type=signup", "#type=recovery", true],
    ["?type=recovery", "#type=signup", true],
  ])("search=%j hash=%j → %s", (search, hash, esperado) => {
    expect(enderecoEhDeRecuperacao(search, hash)).toBe(esperado);
  });

  it.each([
    ["", "", false],
    ["?type=signup", "", false],
    ["?type=signup", "#type=signup", false],
    // o valor tem de ser exatamente `recovery`
    ["?type=Recovery", "", false],
    ["", "#type=recovery2", false],
    // `recovery` em OUTRA chave não é o tipo
    ["?modo=recovery", "", false],
  ])(
    "search=%j hash=%j → %s (confirmação de cadastro NÃO é recuperação)",
    (search, hash, esperado) => {
      expect(enderecoEhDeRecuperacao(search, hash)).toBe(esperado);
    },
  );
});

describe("enderecoSemOErroDoLink — o que `replaceState` recebe depois do aviso", () => {
  const limpo = (endereco: string) =>
    enderecoSemOErroDoLink(new URL(endereco, "https://loja.example"));

  it("tira o erro e o tipo do hash e da query, e sobra só o caminho", () => {
    expect(
      limpo(
        "/auth?type=recovery#error=access_denied&error_code=otp_expired&error_description=Link+expired",
      ),
    ).toBe("/auth");
  });

  it.each(["error", "error_code", "error_description", "type"])(
    "a chave %s é tirada da QUERY",
    (chave) => {
      expect(limpo(`/auth?${chave}=x&modo=recuperar`)).toBe(
        "/auth?modo=recuperar",
      );
    },
  );

  it.each(["error", "error_code", "error_description", "type"])(
    "a chave %s é tirada do HASH",
    (chave) => {
      expect(limpo(`/auth#${chave}=x&foo=bar`)).toBe("/auth#foo=bar");
    },
  );

  it("LIMITE: o resto da query e do hash NÃO é apagado, e a ordem é a de antes", () => {
    expect(
      limpo(
        "/auth?modo=recuperar&type=recovery&origem=painel#error_code=x&foo=bar&type=recovery&baz=1",
      ),
    ).toBe("/auth?modo=recuperar&origem=painel#foo=bar&baz=1");
  });

  it("LIMITE: sem parâmetro sobrando não deixa `?` nem `#` soltos", () => {
    expect(limpo("/auth?type=recovery")).toBe("/auth");
    expect(limpo("/auth#error_code=x")).toBe("/auth");
    expect(limpo("/auth?error_code=x#type=recovery")).toBe("/auth");
    expect(limpo("/auth#")).toBe("/auth");
  });

  it("endereço sem erro volta igual (caminho, query e hash)", () => {
    expect(limpo("/admin/orders?id=1")).toBe("/admin/orders?id=1");
    expect(limpo("/product-detail?id=abc#aba=fotos")).toBe(
      "/product-detail?id=abc#aba=fotos",
    );
    expect(limpo("/")).toBe("/");
  });

  it("não mexe no caminho (nem nas barras dele)", () => {
    expect(limpo("/admin/orders/?error_code=x")).toBe("/admin/orders/");
  });
});
