// @vitest-environment jsdom
import { MENSAGEM_ERRO_LOGIN_GENERICA_LOJISTA } from "@/lib/mensagens-auth";
import { mensagemDeErroAdminLogin } from "@/views/admin/AdminLoginView";
import { describe, expect, it, vi } from "vitest";

// O AuthContext acessa message.includes antes de devolver o erro à view.
// Testar o tradutor diretamente impede que o catch da tela esconda a falha.
// O hook não é usado aqui; o mock evita inicializar o cliente Supabase.
vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));

describe("mensagemDeErroAdminLogin — leitura defensiva do erro", () => {
  it("usa a mensagem genérica do lojista sem lançar quando message é numérica", () => {
    expect(mensagemDeErroAdminLogin({ message: 503 })).toBe(
      MENSAGEM_ERRO_LOGIN_GENERICA_LOJISTA,
    );
  });

  it("reconhece o código de e-mail não confirmado sem message", () => {
    expect(mensagemDeErroAdminLogin({ code: "email_not_confirmed" })).toBe(
      "Este e-mail administrativo ainda não foi confirmado. Verifique a caixa de entrada.",
    );
  });

  it("reconhece o limite de tentativas pelo status numérico", () => {
    expect(mensagemDeErroAdminLogin({ status: 429 })).toBe(
      "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.",
    );
  });

  it("usa a mensagem genérica do lojista para erro nulo", () => {
    expect(mensagemDeErroAdminLogin(null)).toBe(
      MENSAGEM_ERRO_LOGIN_GENERICA_LOJISTA,
    );
  });

  it("preserva user_banned antes do status 400 de credenciais inválidas", () => {
    expect(mensagemDeErroAdminLogin({ code: "user_banned", status: 400 })).toBe(
      MENSAGEM_ERRO_LOGIN_GENERICA_LOJISTA,
    );
  });
});
