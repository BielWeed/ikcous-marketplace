import { destinoPosLogin } from "@/lib/destinoPosLogin";
import { describe, expect, it } from "vitest";

/**
 * src/lib/destinoPosLogin.ts — follow-up do PR #561 (issue #487).
 *
 * O #561 fechou o perfil público (`user-profile`) para visitante sem conta:
 * o App.tsx (`handleNavigate` e a sincronização de rota via `popstate`)
 * manda a pessoa ao `auth` e grava `requested: "user-profile"` no
 * `history.state`. Mas `destinoPosLogin` só honra `requested` que pertença
 * a `VIEWS_REDIRECIONAVEIS` — e "user-profile" não estava no conjunto.
 * Quem foi barrada no perfil público e ENTROU caía no `from` (ou no perfil
 * próprio) em vez de voltar ao que pediu: exatamente a falha em silêncio
 * que o docstring do conjunto descreve para "esquecer este aqui".
 *
 * Este arquivo cobre SÓ a entrada de "user-profile" no conjunto; as regras
 * gerais (precedência, defaults, formato lixo, dupla chamada de
 * `onSuccess`) moram em `destino-pos-login.test.ts`.
 */
describe("destinoPosLogin — user-profile no conjunto redirecionável", () => {
  it("requested user-profile, view auth, manda para user-profile (quem foi barrada no perfil público e entrou)", () => {
    expect(
      destinoPosLogin({
        view: "auth",
        requested: "user-profile",
      }),
    ).toBe("user-profile");
  });

  it("PRECEDÊNCIA: from checkout + requested user-profile manda para user-profile, não volta ao checkout", () => {
    // Mesma régua do teste de precedência de `destino-pos-login.test.ts`:
    // a view que a pessoa PEDIU vence de onde ela veio. Payload na forma
    // exata que `handleNavigate` grava ao barrar visitante:
    // {view: "auth", from, requested: "user-profile"}.
    expect(
      destinoPosLogin({
        view: "auth",
        from: "checkout",
        requested: "user-profile",
      }),
    ).toBe("user-profile");
  });

  it("REGRESSÃO: sem requested, from checkout continua mandando para checkout", () => {
    expect(destinoPosLogin({ view: "auth", from: "checkout" })).toBe(
      "checkout",
    );
  });

  it("REGRESSÃO: state nulo (link de confirmação de e-mail em outra aba) continua caindo no perfil", () => {
    expect(destinoPosLogin(null)).toBe("profile");
  });
});
