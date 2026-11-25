// Caça por mutação (25/11/2026), e-mail da loja: o TEXTO que a lojista lê.
// Os testes que já existiam conferiam a estrutura (qual selo, qual motivo), mas
// trocar a frase de 5 dos 6 motivos de falha, a frase "não está disponível" ou
// o detalhe de dois selos por "x" não derrubava nenhum teste. Aqui cada frase
// que diz à lojista o que fazer fica fixada (escrita à mão, não calculada).
import { describe, expect, it } from "vitest";

import {
  MENSAGEM_INDISPONIVEL,
  type MotivoDaFalha,
  type StatusDoEmail,
  mensagemDoMotivo,
  seloDoEmail,
  textoDaSaudeDoEnvio,
  traduzirFalha,
} from "@/components/admin/settings/email-da-loja-conteudo";

const comFalha = (motivo: MotivoDaFalha): StatusDoEmail => ({
  usuario: "loja@gmail.com",
  senhaGuardada: true,
  ultimoTeste: null,
  origem: "painel",
  cofrePronto: true,
  registroIlegivel: false,
  falha: { em: null, motivo, origem: "painel" },
});

const painel = (ultimoTeste: StatusDoEmail["ultimoTeste"]): StatusDoEmail => ({
  usuario: "loja@gmail.com",
  senhaGuardada: true,
  ultimoTeste,
  origem: "painel",
  cofrePronto: true,
  registroIlegivel: false,
  falha: null,
});

describe("textoDaSaudeDoEnvio: a causa curta de cada motivo", () => {
  it.each([
    ["senha_errada", "o Google recusou a senha"],
    ["precisa_senha_de_app", "o Google exige uma senha de app"],
    ["acesso_bloqueado", "o Google bloqueou o acesso"],
    ["limite_diario", "o Google atingiu o limite de envios da conta por hoje"],
    ["sem_conexao", "não foi possível falar com o Google"],
    ["recusado", "o Google não aceitou o envio"],
  ] as const)("%s", (motivo, causa) => {
    expect(textoDaSaudeDoEnvio(comFalha(motivo))).toBe(
      `Seus e-mails pararam — ${causa}.`,
    );
  });
});

describe("mensagemDoMotivo: o que fazer em cada caso", () => {
  it.each([
    [
      "senha_errada",
      "O Google recusou a senha. Confira se você colou a senha de APP (as 16 letras), e não a senha normal do Gmail.",
    ],
    [
      "precisa_senha_de_app",
      "Parece que foi colada a senha normal do Gmail. Aqui precisa ser a senha de app: volte ao passo 3, crie uma e cole as 16 letras.",
    ],
    [
      "acesso_bloqueado",
      "O Google bloqueou o acesso vindo do servidor. Abra o Gmail dessa conta, procure o alerta de segurança e toque em «Fui eu»;",
    ],
    [
      "limite_diario",
      "O Google atingiu o limite de envios desta conta por hoje. O envio volta ao normal em até 24 horas.",
    ],
    [
      "sem_conexao",
      "Não consegui falar com o Google agora. Tente de novo em instantes.",
    ],
    [
      "recusado",
      "O Google não aceitou o envio. Tente de novo; se continuar, confira a senha de app no passo 3.",
    ],
  ] as const)("%s começa com a orientação certa", (motivo, comeco) => {
    expect(mensagemDoMotivo(motivo).startsWith(comeco)).toBe(true);
  });

  it("sem motivo conhecido, usa a orientação do envio recusado", () => {
    expect(mensagemDoMotivo(null)).toBe(mensagemDoMotivo("recusado"));
  });
});

describe("a frase de 'recurso não disponível'", () => {
  it("diz que não está disponível nesta loja e manda falar com o suporte", () => {
    expect(MENSAGEM_INDISPONIVEL).toBe(
      "Este recurso ainda não está disponível nesta loja. Fale com o suporte.",
    );
    expect(traduzirFalha({ status: 404 }, "salvar").mensagem).toBe(
      "Este recurso ainda não está disponível nesta loja. Fale com o suporte.",
    );
  });
});

describe("seloDoEmail: o detalhe de cada selo de problema e de espera", () => {
  it("falha de envio que ainda vale: 'O Google recusou o último envio'", () => {
    expect(seloDoEmail(comFalha("senha_errada"))).toEqual({
      tipo: "problema",
      titulo: "Com problema",
      detalhe: "O Google recusou o último envio. Veja o aviso abaixo.",
    });
  });

  it("último teste falhou: título e orientação de testar de novo", () => {
    expect(
      seloDoEmail(
        painel({ ok: false, em: "2026-11-01T10:00:00Z", motivo: null }),
      ),
    ).toEqual({
      tipo: "problema",
      titulo: "Salvo, mas o último teste falhou",
      detalhe: "Veja o aviso abaixo e envie o e-mail de teste de novo.",
    });
  });

  it("salvo e nunca testado: pede o e-mail de teste", () => {
    expect(seloDoEmail(painel(null))).toEqual({
      tipo: "salvo_sem_teste",
      titulo: "Salvo, ainda não testado",
      detalhe:
        "Falta enviar o e-mail de teste para ter certeza de que está tudo certo.",
    });
  });
});
