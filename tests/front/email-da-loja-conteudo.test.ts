import {
  MENSAGEM_INDISPONIVEL,
  MENSAGEM_SEM_COFRE,
  MENSAGEM_SEM_INTERNET,
  MENSAGEM_SEM_RESPOSTA,
  PASSOS_DO_EMAIL,
  RECADO_DE_SEGURANCA,
  dataCurta,
  descreverEspera,
  lerStatusDoEmail,
  mensagemDoMotivo,
  normalizarSenhaDeApp,
  seloDoEmail,
  textoDaContagem,
  textoDaSaudeDoEnvio,
  traduzirFalha,
  validarGmailDaLoja,
} from "@/components/admin/settings/email-da-loja-conteudo";
// O que as regras PURAS da seção "E-mail da loja" prometem (14/10/2026):
//   - o selo de estado só diz "Funcionando" com teste aprovado e sem falha nova;
//   - a senha de app é normalizada como o servidor (qualquer espaço, inclusive o
//     que não quebra, hífen e invisíveis) e a colagem boa nunca é recusada;
//   - toda falha vira frase da casa pelo CÓDIGO/status — texto do servidor
//     nunca passa;
//   - a resposta do servidor é lida de forma defensiva (cofre só vale se true).
import { describe, expect, it } from "vitest";

const BASE = {
  usuario: null,
  senha_guardada: false,
  ultimo_teste: null,
  origem: "nenhuma",
  cofre_pronto: true,
  problema: null,
  saude: null,
};

function status(extra: Record<string, unknown> = {}) {
  const lido = lerStatusDoEmail({ ...BASE, ...extra });
  if (!lido) throw new Error("status inválido no teste");
  return lido;
}

const SALVO = {
  usuario: "loja@gmail.com",
  senha_guardada: true,
  origem: "painel",
};

describe("seloDoEmail — o selo de estado do topo", () => {
  it("nada cadastrado: 'Não configurado' e diz que o cliente NÃO recebe e-mail", () => {
    const selo = seloDoEmail(status());
    expect(selo.tipo).toBe("nao_configurado");
    expect(selo.titulo).toBe("Não configurado");
    expect(selo.detalhe).toContain("NÃO recebem e-mail do pedido");
  });

  it("origem ambiente: 'Configurado no servidor'", () => {
    const selo = seloDoEmail(status({ origem: "ambiente" }));
    expect(selo.tipo).toBe("servidor");
    expect(selo.titulo).toBe("Configurado no servidor");
  });

  it("salvo sem teste gravado: 'Salvo, ainda não testado' (NUNCA 'Funcionando')", () => {
    const selo = seloDoEmail(status({ ...SALVO, ultimo_teste: null }));
    expect(selo.tipo).toBe("salvo_sem_teste");
    expect(selo.titulo).toBe("Salvo, ainda não testado");
  });

  it("teste aprovado: 'Funcionando' — e o detalhe manda enviar o e-mail de teste para provar que CHEGA", () => {
    const selo = seloDoEmail(
      status({
        ...SALVO,
        ultimo_teste: { ok: true, em: "2026-10-14T12:00:00Z", motivo: null },
      }),
    );
    expect(selo.tipo).toBe("funcionando");
    expect(selo.titulo).toBe("Funcionando");
    expect(selo.detalhe).toContain("Google aceitou o login");
    expect(selo.detalhe).toContain("CHEGA");
    expect(selo.detalhe).toContain("Enviar e-mail de teste");
  });

  it("último teste reprovado: NÃO é 'Funcionando'", () => {
    const selo = seloDoEmail(
      status({
        ...SALVO,
        ultimo_teste: {
          ok: false,
          em: "2026-10-14T12:00:00Z",
          motivo: "senha_errada",
        },
      }),
    );
    expect(selo.tipo).toBe("problema");
    expect(selo.titulo).not.toBe("Funcionando");
  });

  it("falha de envio do painel mais NOVA que o teste aprovado: 'Com problema', não 'Funcionando'", () => {
    const selo = seloDoEmail(
      status({
        ...SALVO,
        ultimo_teste: { ok: true, em: "2026-10-10T12:00:00Z", motivo: null },
        saude: {
          codigo_falha: "senha_errada",
          ultima_falha_em: "2026-10-13T12:00:00Z",
          ultima_falha_origem: "painel",
        },
      }),
    );
    expect(selo.tipo).toBe("problema");
  });

  it("falha MAIS VELHA que o teste aprovado é ignorada (a limpeza da edge é melhor esforço)", () => {
    const s = status({
      ...SALVO,
      ultimo_teste: { ok: true, em: "2026-10-14T12:00:00Z", motivo: null },
      saude: {
        codigo_falha: "senha_errada",
        ultima_falha_em: "2026-10-13T12:00:00Z",
        ultima_falha_origem: "painel",
      },
    });
    expect(seloDoEmail(s).tipo).toBe("funcionando");
    expect(textoDaSaudeDoEnvio(s)).toBeNull();
  });
});

describe("textoDaSaudeDoEnvio — 'Seus e-mails pararam em DD/MM'", () => {
  it("falha recente do painel: data e causa em palavras", () => {
    const s = status({
      ...SALVO,
      saude: {
        codigo_falha: "senha_errada",
        ultima_falha_em: "2026-10-13T15:00:00Z",
        ultima_falha_origem: "painel",
      },
    });
    expect(textoDaSaudeDoEnvio(s)).toBe(
      "Seus e-mails pararam em 13/10 — o Google recusou a senha.",
    );
  });

  it("sem falha: nada a dizer", () => {
    expect(textoDaSaudeDoEnvio(status(SALVO))).toBeNull();
  });

  it("falha de OUTRA origem (o ambiente, com o painel enviando) não é a do remetente de agora", () => {
    const s = status({
      ...SALVO,
      saude: {
        codigo_falha: "recusado",
        ultima_falha_em: "2026-10-13T15:00:00Z",
        ultima_falha_origem: "ambiente",
      },
    });
    expect(textoDaSaudeDoEnvio(s)).toBeNull();
  });

  it("código de falha que a tela não conhece não vira texto", () => {
    const s = status({
      ...SALVO,
      saude: {
        codigo_falha: "smtp://usuario:SEGREDO@host",
        ultima_falha_em: "2026-10-13T15:00:00Z",
        ultima_falha_origem: "painel",
      },
    });
    expect(textoDaSaudeDoEnvio(s)).toBeNull();
  });
});

describe("lerStatusDoEmail — leitura defensiva da resposta", () => {
  it("cofre_pronto só vale se for exatamente true", () => {
    expect(status({ cofre_pronto: true }).cofrePronto).toBe(true);
    expect(status({ cofre_pronto: "true" }).cofrePronto).toBe(false);
    expect(status({ cofre_pronto: undefined }).cofrePronto).toBe(false);
  });

  it("origem desconhecida vira 'nenhuma'; resposta que nem é objeto vira null", () => {
    expect(status({ origem: "outra-coisa" }).origem).toBe("nenhuma");
    expect(lerStatusDoEmail(null)).toBeNull();
    expect(lerStatusDoEmail("texto")).toBeNull();
  });

  it("registro ilegível é lido do campo `problema`", () => {
    expect(status({ problema: "registro_ilegivel" }).registroIlegivel).toBe(
      true,
    );
    expect(status().registroIlegivel).toBe(false);
  });
});

describe("normalizarSenhaDeApp — colagem boa nunca é recusada", () => {
  it.each([
    ["abcdefghijklmnop", "sem espaços"],
    ["abcd efgh ijkl mnop", "em 4 grupos (como o Google mostra)"],
    ["ABCD EFGH IJKL MNOP", "em maiúsculas"],
    [
      "abcd\u00a0efgh\u00a0ijkl\u00a0mnop",
      "com espaço que não quebra (U+00A0)",
    ],
    ["  abcd efgh ijkl mnop \n", "com espaços e quebra de linha nas pontas"],
    ["abcd\u200befgh\u200bijkl\u200bmnop", "com invisível de largura zero"],
    ["abcd-efgh-ijkl-mnop", "com hífens"],
    ["abcd\u202fefgh\u2009ijkl\u3000mnop", "com outros espaços Unicode"],
  ])("aceita %j (%s) e devolve as 16 letras", (entrada) => {
    expect(normalizarSenhaDeApp(entrada)).toEqual({
      ok: true,
      senha: "abcdefghijklmnop",
    });
  });

  it.each([
    ["", "vazia"],
    ["abcdefghijklmno", "15 letras"],
    ["abcdefghijklmnopq", "17 letras"],
    ["abcd efgh ijkl mn0p", "com número"],
    ["minhaSenhaDoGmail123", "a senha normal"],
    ["abcd efgh ijkl mn@p", "com símbolo"],
  ])(
    "recusa %j (%s) com texto orientando e SEM ecoar o que foi digitado",
    (entrada) => {
      const r = normalizarSenhaDeApp(entrada);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.erro.length).toBeGreaterThan(10);
        if (entrada.trim()) expect(r.erro).not.toContain(entrada.trim());
      }
    },
  );
});

describe("validarGmailDaLoja", () => {
  it("aceita Gmail, tira espaços e põe em minúsculas", () => {
    expect(validarGmailDaLoja("  Loja.Nome@Gmail.com ")).toEqual({
      ok: true,
      usuario: "loja.nome@gmail.com",
    });
    expect(validarGmailDaLoja("a@googlemail.com").ok).toBe(true);
  });

  it.each([
    "",
    "   ",
    "loja",
    "loja@outlook.com",
    "loja@gmail.com.br",
    "a b@gmail.com",
    "@gmail.com",
  ])("recusa %j", (entrada) => {
    expect(validarGmailDaLoja(entrada).ok).toBe(false);
  });
});

describe("traduzirFalha — erro do servidor vira frase da casa", () => {
  const TEXTO_CRU =
    "smtp://loja@gmail.com:SEGREDO-NO-ERRO@smtp.gmail.com Invalid login";

  it("o motivo (lista fechada) escolhe a frase; o texto cru do servidor nunca aparece", () => {
    for (const motivo of [
      "senha_errada",
      "precisa_senha_de_app",
      "acesso_bloqueado",
      "limite_diario",
      "sem_conexao",
      "recusado",
    ]) {
      const r = traduzirFalha({ status: 422, motivo }, "salvar");
      expect(r.mensagem).toBe(mensagemDoMotivo(motivo as never));
      expect(r.mensagem).not.toContain("SEGREDO");
    }
  });

  it("acesso bloqueado orienta a tocar em 'Fui eu' no alerta do Gmail", () => {
    const r = traduzirFalha(
      { status: 422, motivo: "acesso_bloqueado" },
      "salvar",
    );
    expect(r.mensagem).toContain("Fui eu");
    expect(r.mensagem).toContain("alerta de segurança");
  });

  it("senha normal colada: manda criar senha de APP", () => {
    const r = traduzirFalha(
      { status: 422, motivo: "precisa_senha_de_app" },
      "salvar",
    );
    expect(r.mensagem).toContain("senha de app");
    expect(r.mensagem).toContain("senha normal");
  });

  it("motivo que a tela não conhece cai na frase genérica de recusa, sem vazar", () => {
    const r = traduzirFalha({ status: 422, motivo: TEXTO_CRU }, "salvar");
    expect(r.mensagem).not.toContain("SEGREDO");
    expect(r.mensagem).not.toContain("smtp");
  });

  it("429 mostra quanto falta quando o servidor informa, e não inventa quando não informa", () => {
    expect(
      traduzirFalha({ status: 429, espereSegundos: 45 }, "testar").mensagem,
    ).toContain("45 segundos");
    expect(
      traduzirFalha({ status: 429, espereSegundos: 61 }, "testar").mensagem,
    ).toContain("2 minutos");
    expect(
      traduzirFalha({ status: 429, espereSegundos: 7200 }, "testar").mensagem,
    ).toContain("2 horas");
    expect(traduzirFalha({ status: 429 }, "testar").mensagem).toContain(
      "alguns instantes",
    );
    expect(
      traduzirFalha({ status: 429, espereSegundos: "abc" }, "testar").mensagem,
    ).toContain("alguns instantes");
  });

  it("não escreve número de limite diário do Gmail", () => {
    const todas = [
      ...PASSOS_DO_EMAIL.flatMap((p) => [
        ...p.fazer,
        p.aparece,
        p.deuCerto,
        p.seDiferente,
      ]),
      mensagemDoMotivo("limite_diario"),
      traduzirFalha({ status: 429, espereSegundos: 30 }, "salvar").mensagem,
    ].join(" ");
    expect(todas).not.toMatch(/\b(100|500|2\.?000)\b/);
    expect(todas).not.toMatch(/por dia|diários/);
  });

  it("404 = recurso indisponível nesta loja", () => {
    expect(traduzirFalha({ status: 404 }, "status")).toEqual({
      mensagem: MENSAGEM_INDISPONIVEL,
      indisponivel: true,
    });
  });

  it("queda de rede COM internet NÃO vira 'indisponível': é frase de conexão, para tentar de novo", () => {
    const r = traduzirFalha({ semResposta: true, offline: false }, "status");
    expect(r.indisponivel).toBe(false);
    expect(r.mensagem).toBe(MENSAGEM_SEM_RESPOSTA);
    expect(r.mensagem).not.toBe(MENSAGEM_INDISPONIVEL);
    expect(r.mensagem).toContain("tente de novo");
  });

  it("erro de rede SEM internet é 'sem conexão', e não 'indisponível'", () => {
    expect(
      traduzirFalha({ semResposta: true, offline: true }, "salvar"),
    ).toEqual({
      mensagem: MENSAGEM_SEM_INTERNET,
      indisponivel: false,
    });
  });

  it("503: ao salvar é 'sem cofre'; ao ler o status é 'indisponível'", () => {
    expect(traduzirFalha({ status: 503 }, "salvar").mensagem).toBe(
      MENSAGEM_SEM_COFRE,
    );
    expect(traduzirFalha({ status: 503 }, "status").indisponivel).toBe(true);
  });

  it("status sem tradução específica cai na frase genérica", () => {
    const r = traduzirFalha({ status: 500 }, "testar");
    expect(r.indisponivel).toBe(false);
    expect(r.mensagem).toContain("Tente de novo em instantes");
  });
});

describe("descreverEspera e dataCurta", () => {
  it("fala no singular e no plural", () => {
    expect(descreverEspera(1)).toBe("1 segundo");
    expect(descreverEspera(60)).toBe("1 minuto");
    expect(descreverEspera(3600)).toBe("1 hora");
    expect(descreverEspera(0)).toBe("alguns instantes");
  });

  it("DD/MM, e nada quando a data é inválida", () => {
    expect(dataCurta("2026-10-13T15:00:00Z")).toBe("13/10");
    expect(dataCurta("lixo")).toBeNull();
    expect(dataCurta(null)).toBeNull();
  });
});

describe("PASSOS_DO_EMAIL — o passo a passo", () => {
  it("são 5 passos e cada um diz o que fazer, o que aparece, como saber que deu certo e o que fazer se for diferente", () => {
    expect(PASSOS_DO_EMAIL).toHaveLength(5);
    for (const passo of PASSOS_DO_EMAIL) {
      expect(passo.titulo.length).toBeGreaterThan(5);
      expect(passo.fazer.length).toBeGreaterThan(0);
      expect(passo.aparece.length).toBeGreaterThan(5);
      expect(passo.deuCerto.length).toBeGreaterThan(5);
      expect(passo.seDiferente.length).toBeGreaterThan(5);
    }
  });

  it("os links do Google apontam para as páginas oficiais, em https", () => {
    const links = PASSOS_DO_EMAIL.flatMap((p) => (p.link ? [p.link.href] : []));
    expect(links).toContain("https://myaccount.google.com/apppasswords");
    for (const href of links) expect(href.startsWith("https://")).toBe(true);
  });

  it("o passo da senha de app avisa quando a opção NÃO aparece (chave de segurança, trabalho/escola, Proteção Avançada)", () => {
    const passo3 = PASSOS_DO_EMAIL[2].seDiferente;
    expect(passo3).toContain("chave de segurança");
    expect(passo3).toContain("trabalho");
    expect(passo3).toContain("Proteção Avançada");
  });

  it("o passo do teste explica onde achar o e-mail: ENVIADOS e Spam", () => {
    const passo5 = PASSOS_DO_EMAIL[4].fazer.join(" ");
    expect(passo5).toContain("ENVIADOS");
    expect(passo5).toContain("Spam");
  });
});

describe("espera entre tentativas (salvar e testar dividem o mesmo limite do servidor)", () => {
  it("429 devolve o tempo que falta como número, para a tela segurar o botão", () => {
    expect(
      traduzirFalha({ status: 429, espereSegundos: 42 }, "testar")
        .espereSegundos,
    ).toBe(42);
  });

  it("429 sem tempo válido não inventa número", () => {
    expect(
      traduzirFalha({ status: 429 }, "testar").espereSegundos,
    ).toBeUndefined();
    expect(
      traduzirFalha({ status: 429, espereSegundos: "abc" }, "testar")
        .espereSegundos,
    ).toBeUndefined();
    expect(
      traduzirFalha({ status: 429, espereSegundos: -5 }, "testar")
        .espereSegundos,
    ).toBeUndefined();
  });

  it("falha que não é 429 não traz espera", () => {
    expect(
      traduzirFalha({ status: 500 }, "testar").espereSegundos,
    ).toBeUndefined();
  });

  it("textoDaContagem: segundos até 1 minuto, depois minutos", () => {
    expect(textoDaContagem(42)).toBe("42 s");
    expect(textoDaContagem(59.2)).toBe("60 s");
    expect(textoDaContagem(61)).toBe("2 min");
    expect(textoDaContagem(3300)).toBe("55 min");
  });
});

describe("RECADO_DE_SEGURANCA — só diz o que é verdade", () => {
  it("não promete que ninguém do sistema alcança a senha (a cifra é reversível no servidor)", () => {
    expect(RECADO_DE_SEGURANCA).not.toContain("quem trabalha no sistema");
    expect(RECADO_DE_SEGURANCA).not.toMatch(/ningu[eé]m/i);
  });

  it("diz o que vale: guardada cifrada, nunca mostrada nem enviada ao navegador, e como revogar", () => {
    expect(RECADO_DE_SEGURANCA).toContain("cifrada");
    expect(RECADO_DE_SEGURANCA).toContain("nunca é mostrada de volta");
    expect(RECADO_DE_SEGURANCA).toContain("navegador");
    expect(RECADO_DE_SEGURANCA).toContain("revogue");
  });
});
