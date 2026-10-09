// Erro amigável único do painel (src/lib/erro-do-painel.ts): "o que aconteceu
// + o que fazer", sem código, tabela, função, "Supabase" ou "migration". O
// erro bruto fica no console de quem chamou; a lojista só lê a frase daqui.
import * as crm from "@/lib/crm";
import { mensagemDeErroDoPainel } from "@/lib/erro-do-painel";
import { describe, expect, it } from "vitest";

const PROIBIDAS = /relation|function|supabase|migration/i;

describe("mensagemDeErroDoPainel", () => {
  it("PGRST202 (função inexistente) diz que ainda não foi ativado", () => {
    const frase = mensagemDeErroDoPainel(
      { code: "PGRST202", message: "Could not find the function public.x" },
      "carregar",
    );
    expect(frase).toMatch(/ainda não foram ativados/);
    expect(frase).not.toMatch(PROIBIDAS);
  });

  it("42883 (Postgres: função inexistente) tem a mesma frase", () => {
    expect(
      mensagemDeErroDoPainel({ code: "42883", message: "x" }, "carregar"),
    ).toMatch(/ainda não foram ativados/);
  });

  it("42501 e 'permission denied' viram frase de permissão", () => {
    expect(
      mensagemDeErroDoPainel({ code: "42501", message: "denied" }, "carregar"),
    ).toMatch(/Sem permissão/);
    expect(
      mensagemDeErroDoPainel(
        { message: "permission denied for table orders" },
        "carregar",
      ),
    ).toMatch(/Sem permissão/);
  });

  it("TypeError: Failed to fetch vira 'Sem conexão'", () => {
    expect(
      mensagemDeErroDoPainel(new TypeError("Failed to fetch"), "carregar"),
    ).toBe("Sem conexão — confira a internet e tente de novo.");
    expect(
      mensagemDeErroDoPainel(new TypeError("Load failed"), "carregar"),
    ).toBe("Sem conexão — confira a internet e tente de novo.");
  });

  it("22023 com mensagem em português passa direto (contrato do estorno manual)", () => {
    const recusa =
      "O Mercado Pago já está devolvendo este pagamento. Faça a devolução pelo painel do Mercado Pago.";
    expect(
      mensagemDeErroDoPainel({ code: "22023", message: recusa }, "estornar"),
    ).toBe(recusa);
  });

  it("22023 sem mensagem não passa nada em branco: cai na frase genérica", () => {
    expect(
      mensagemDeErroDoPainel({ code: "22023", message: "  " }, "estornar"),
    ).toBe("Não foi possível estornar agora. Tente de novo em instantes.");
  });

  it("mensagem com relation, function, supabase ou migration nunca aparece", () => {
    for (const bruto of [
      'relation "public.orders" does not exist',
      "function public.crm_visao() does not exist",
      "Supabase retornou erro",
      "migration 20261189 não aplicada",
    ]) {
      for (const codigo of [undefined, "22023", "XX000"]) {
        const frase = mensagemDeErroDoPainel(
          { code: codigo, message: bruto },
          "salvar",
        );
        expect(frase).not.toMatch(PROIBIDAS);
        expect(frase).toBe(
          "Não foi possível salvar agora. Tente de novo em instantes.",
        );
      }
    }
  });

  it("erro qualquer cai na frase genérica com a ação", () => {
    expect(mensagemDeErroDoPainel(new Error("boom"), "carregar o CRM")).toBe(
      "Não foi possível carregar o CRM agora. Tente de novo em instantes.",
    );
    expect(mensagemDeErroDoPainel(null, "carregar")).toBe(
      "Não foi possível carregar agora. Tente de novo em instantes.",
    );
  });

  it("sem a ação, a frase genérica ainda é de pessoa", () => {
    expect(mensagemDeErroDoPainel(new Error("boom"))).toBe(
      "Não foi possível concluir agora. Tente de novo em instantes.",
    );
  });

  it("crm.ts reexporta a mesma função (um só lugar para mudar a frase)", () => {
    expect(crm.mensagemDeErroDoPainel).toBe(mensagemDeErroDoPainel);
  });
});
