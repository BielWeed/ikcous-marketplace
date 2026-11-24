// Link de e-mail que volta com erro no endereço (src/lib/erro-no-endereco-do-link.ts).
// O que protege: depois que o aviso foi usado, o endereço que vai para o
// `history.replaceState` perde SÓ os sinais do erro e o `type=recovery` — no
// hash E na query — e mantém o resto (outros parâmetros, caminho). Um `type`
// esquecido no hash reabriria a tela "Nova Senha" sem sessão ao recarregar, e
// uma query vazia não pode deixar um "?" solto no endereço.
import {
  enderecoEhDeRecuperacao,
  enderecoSemOErroDoLink,
  enderecoTrazErroDeLink,
} from "@/lib/erro-no-endereco-do-link";
import { describe, expect, it } from "vitest";

const url = (caminho: string) => new URL(`https://loja.exemplo.test${caminho}`);

describe("enderecoSemOErroDoLink", () => {
  it("tira o type=recovery e os três sinais de erro do HASH", () => {
    expect(
      enderecoSemOErroDoLink(
        url(
          "/#error=access_denied&error_code=otp_expired&error_description=link+vencido&type=recovery",
        ),
      ),
    ).toBe("/");
  });

  it("tira o type=recovery e os três sinais de erro da QUERY", () => {
    expect(
      enderecoSemOErroDoLink(
        url(
          "/?error=access_denied&error_code=otp_expired&error_description=x&type=recovery",
        ),
      ),
    ).toBe("/");
  });

  it("só o type no hash sai: o resto do hash e da query continua", () => {
    expect(
      enderecoSemOErroDoLink(
        url("/loja?source=pwa#secao=ofertas&type=recovery"),
      ),
    ).toBe("/loja?source=pwa#secao=ofertas");
  });

  it("só o type na query sai: o resto continua, sem '?' nem '#' soltos", () => {
    expect(enderecoSemOErroDoLink(url("/loja?type=recovery&source=pwa"))).toBe(
      "/loja?source=pwa",
    );
    expect(enderecoSemOErroDoLink(url("/loja?type=recovery"))).toBe("/loja");
    expect(enderecoSemOErroDoLink(url("/loja#type=recovery"))).toBe("/loja");
  });

  it("endereço limpo volta igual (nada a apagar)", () => {
    expect(enderecoSemOErroDoLink(url("/produto/abc?source=pwa#topo=1"))).toBe(
      "/produto/abc?source=pwa#topo=1",
    );
  });
});

describe("enderecoTrazErroDeLink e enderecoEhDeRecuperacao", () => {
  it("error_code vale na query OU no hash; só 'error' sozinho não vale", () => {
    expect(enderecoTrazErroDeLink("?error_code=otp_expired", "")).toBe(true);
    expect(enderecoTrazErroDeLink("", "#error_code=otp_expired")).toBe(true);
    expect(enderecoTrazErroDeLink("?error=access_denied", "")).toBe(false);
    expect(enderecoTrazErroDeLink("", "")).toBe(false);
  });

  it("type=recovery vale na query OU no hash; outro type não vale", () => {
    expect(enderecoEhDeRecuperacao("?type=recovery", "")).toBe(true);
    expect(enderecoEhDeRecuperacao("", "#type=recovery")).toBe(true);
    expect(enderecoEhDeRecuperacao("?type=signup", "#type=signup")).toBe(false);
    expect(enderecoEhDeRecuperacao("", "")).toBe(false);
  });
});
