import { destinoPosLogin } from "@/lib/destinoPosLogin";
import { describe, expect, it } from "vitest";

/**
 * src/lib/destinoPosLogin.ts — follow-up do PR #561 (issue #487), rodada 2.
 *
 * O #561 fechou o perfil público (`user-profile`) para visitante sem conta:
 * o App.tsx (`handleNavigate` e a sincronização de rota via `popstate`)
 * manda a pessoa ao `auth` e grava `requested: "user-profile"` no
 * `history.state` — e, como toda entrada em user-profile leva o `id` do
 * perfil, o `id` segue vivo nesse state. Honrar o `requested` SEM o id
 * mandaria a pessoa à view certa sem perfil nenhum: `UserProfileView` só
 * desenha com `userId`, e sem ele o skeleton carrega para sempre — pior
 * que o defeito original (cair no perfil próprio). Por isso "user-profile"
 * só é honrado COM um `id` utilizável; sem id, cai nas regras seguintes
 * (from/perfil), que é o comportamento de antes do conserto.
 *
 * Este arquivo cobre a regra de unidade; a jornada inteira App→lib
 * (repasse do id, URL, view montada) mora em
 * `destino-pos-login-volta-com-id.test.tsx`, e as regras gerais
 * (precedência, defaults, formato lixo) em `destino-pos-login.test.ts`.
 */
describe("destinoPosLogin — user-profile no conjunto redirecionável", () => {
  it("requested user-profile COM o id no state, view auth, manda para user-profile (quem foi barrada no perfil público e entrou)", () => {
    expect(
      destinoPosLogin({
        view: "auth",
        id: "outra-pessoa",
        requested: "user-profile",
      }),
    ).toBe("user-profile");
  });

  it("PRECEDÊNCIA: from checkout + requested user-profile (com id) manda para user-profile, não volta ao checkout", () => {
    // Mesma régua do teste de precedência de `destino-pos-login.test.ts`:
    // a view que a pessoa PEDIU vence de onde ela veio. Payload na forma
    // exata que `handleNavigate` grava ao barrar visitante:
    // {view: "auth", id, from, requested: "user-profile"}.
    expect(
      destinoPosLogin({
        view: "auth",
        id: "outra-pessoa",
        from: "checkout",
        requested: "user-profile",
      }),
    ).toBe("user-profile");
  });

  it("requested user-profile SEM id utilizável NÃO é honrado — cai nas regras seguintes (view sem id é skeleton eterno)", () => {
    // Toda entrada em user-profile leva id; um state de login sem id (ou
    // com id vazio/não-string) não veio do gate do clique — e mandar a
    // pessoa à view sem perfil é pior que o comportamento de sempre.
    expect(
      destinoPosLogin({
        view: "auth",
        from: "checkout",
        requested: "user-profile",
      }),
    ).toBe("checkout");
    expect(destinoPosLogin({ view: "auth", requested: "user-profile" })).toBe(
      "profile",
    );
    expect(
      destinoPosLogin({
        view: "auth",
        id: "",
        from: "checkout",
        requested: "user-profile",
      }),
    ).toBe("checkout");
    expect(
      destinoPosLogin({
        view: "auth",
        id: 42,
        from: "checkout",
        requested: "user-profile",
      }),
    ).toBe("checkout");
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
