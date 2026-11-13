// A falha de registrar e de anular uma venda do balcão só mostra ao lojista
// uma frase que a CASA escreveu (os `RAISE EXCEPTION` das migrations do
// balcão, em português). Texto técnico do Postgres/PostgREST ("canceling
// statement due to statement timeout", "JWT expired", "permission denied for
// function ...") nunca chega à tela, mesmo quando o código SQLSTATE é um dos
// que a casa também usa (42501, 22023, P0001).
import {
  FRASE_SEM_CONEXAO_DA_ANULACAO,
  mensagemDaFalhaDaAnulacao,
} from "@/lib/anulacao-do-balcao";
import {
  MENSAGEM_DE_DEMORA_DA_VENDA,
  efeitoDaFalhaNaDuvida,
  mensagemDaFalhaDaVenda,
} from "@/lib/erro-da-venda-presencial";
import { fraseEscritaPelaCasa } from "@/lib/frase-escrita-pela-casa";
import { describe, expect, it } from "vitest";

/** O que NUNCA pode aparecer para o lojista. */
const JARGAO_TECNICO =
  /statement|timeout|jwt|permission denied|violates|row-level|policy|deadlock|exploded|invalid|_presencial|anular_venda|registrar_venda|expired/i;

describe("fraseEscritaPelaCasa — a frase do banco só passa quando é da casa", () => {
  it.each([
    // frases reais das migrations do balcão (controle: continuam passando)
    ["42501", "Acesso negado: só a loja registra venda no balcão."],
    ["42501", "Acesso negado"],
    [
      "42501",
      "Não autorizado: é preciso estar autenticado para anular a venda.",
    ],
    ["22023", "Informe o motivo para anular a venda."],
    ["22023", "Esta venda tem devolução registrada; resolva pela devolução."],
    ["22023", "Cliente não encontrado."],
    ["22023", "Venda com itens demais."],
    ["22023", "Produto Caneca não disponível."],
    // nome de produto em inglês dentro de uma frase em português
    [
      "22023",
      "Estoque insuficiente para o produto The Blue Shirt for Men (Disponível: 1, Solicitado: 2)",
    ],
    ["22023", "Escolha uma variação para o produto Black Friday of the Year."],
    // nome de produto parecido com identificador técnico (código do lojista)
    [
      "22023",
      "Estoque insuficiente para o produto KIT_BASICO (Disponível: 1, Solicitado: 2)",
    ],
    ["22023", "Produto KIT_BASICO não disponível."],
    ["P0001", "Pedido não encontrado."],
    [
      "P0001",
      "Este pedido tem uma cobrança aberta no Mercado Pago e não pode ser cancelado por aqui.",
    ],
    // palavra portuguesa solta basta (as frases de teste das telas)
    ["22023", "falha"],
  ])("%s · %s passa como está", (codigo, mensagem) => {
    expect(fraseEscritaPelaCasa(codigo, mensagem)).toBe(mensagem);
  });

  it.each([
    ["42501", "permission denied for function registrar_venda_presencial"],
    ["42501", 'new row violates row-level security policy for table "orders"'],
    ["42501", "must be owner of function anular_venda_presencial"],
    ["22023", "invalid parameter value"],
    ["22023", 'unrecognized configuration parameter "x"'],
    ["P0001", "something exploded in english"],
    ["P0001", "JWT expired"],
    ["P0001", "canceling statement due to statement timeout"],
    // texto técnico MISTURADO com palavra portuguesa solta
    ["22023", "falha em registrar_venda_presencial"],
    ["42501", "permissão negada para a função registrar_venda_presencial"],
    ["42501", "ERROR: permission denied (SQLSTATE 42501)"],
  ])("%s · %s é técnico e não passa", (codigo, mensagem) => {
    expect(fraseEscritaPelaCasa(codigo, mensagem)).toBeNull();
  });

  it("só vale para os códigos que a casa usa em RAISE próprio", () => {
    const frase = "Esta venda não pode ser anulada aqui.";
    for (const codigo of ["57014", "PGRST301", "XX000", "23514", "", "42883"]) {
      expect(fraseEscritaPelaCasa(codigo, frase), codigo).toBeNull();
    }
  });

  it("sem mensagem, ou só espaços, não há frase", () => {
    expect(fraseEscritaPelaCasa("22023", null)).toBeNull();
    expect(fraseEscritaPelaCasa("22023", "   ")).toBeNull();
  });
});

describe("mensagemDaFalhaDaAnulacao — nunca mostra o texto do banco que a casa não escreveu", () => {
  it.each([
    ["57014", "canceling statement due to statement timeout"],
    ["08006", "connection failure"],
    ["57P01", "terminating connection due to administrator command"],
  ])(
    "%s (o servidor demorou ou caiu) manda conferir antes de repetir",
    (code, message) => {
      const frase = mensagemDaFalhaDaAnulacao({ code, message });
      expect(frase).toBe(FRASE_SEM_CONEXAO_DA_ANULACAO);
      expect(frase).toContain("Confira a venda antes de tentar de novo");
      expect(frase).not.toMatch(JARGAO_TECNICO);
    },
  );

  it.each(["PGRST301", "PGRST302", "PGRST303"])(
    "%s (sessão vencida) pede para entrar de novo na conta",
    (code) => {
      const frase = mensagemDaFalhaDaAnulacao({ code, message: "JWT expired" });
      expect(frase).toContain("sessão expirou");
      expect(frase).toContain("entre de novo na conta");
      expect(frase).not.toMatch(JARGAO_TECNICO);
    },
  );

  it("42501 técnico (permissão negada do Postgres) cai na frase da casa", () => {
    for (const message of [
      "permission denied for function anular_venda_presencial",
      'new row violates row-level security policy for table "orders"',
    ]) {
      expect(mensagemDaFalhaDaAnulacao({ code: "42501", message })).toBe(
        "Só quem é da loja pode anular uma venda.",
      );
    }
  });

  it("22023 técnico cai na frase da casa", () => {
    expect(
      mensagemDaFalhaDaAnulacao({
        code: "22023",
        message: "invalid parameter",
      }),
    ).toBe("Esta venda não pode ser anulada aqui.");
  });

  it.each([
    ["XX000", "internal error in the planner"],
    ["23514", 'new row for relation "orders" violates check constraint'],
    ["40P01", "deadlock detected"],
    ["P0001", "something exploded in english"],
    // código que a casa não usa: nem uma frase em português passa por ele
    ["XX999", "Esta venda não pode ser anulada aqui."],
  ])("%s · %s vira a frase genérica", (code, message) => {
    const frase = mensagemDaFalhaDaAnulacao({ code, message });
    expect(frase).toBe("Não consegui anular agora. Tente de novo.");
    expect(frase).not.toMatch(JARGAO_TECNICO);
  });

  it("code vazio (fetch caiu no postgrest-js) é falta de conexão, não texto cru", () => {
    expect(
      mensagemDaFalhaDaAnulacao({ code: "", message: "FetchError: failed" }),
    ).toBe(FRASE_SEM_CONEXAO_DA_ANULACAO);
  });

  it("controle: as frases em português que a casa escreve continuam passando", () => {
    for (const [code, message] of [
      ["22023", "Esta venda tem devolução registrada; resolva pela devolução."],
      ["42501", "Acesso negado: só a loja anula venda do balcão."],
      ["P0001", "Pedido não encontrado."],
      ["P0002", "Devolução não encontrada."],
    ]) {
      expect(mensagemDaFalhaDaAnulacao({ code, message })).toBe(message);
    }
  });
});

describe("mensagemDaFalhaDaVenda — nunca mostra o texto do banco que a casa não escreveu", () => {
  it("42501 técnico cai na frase da casa e continua mandando entrar de novo", () => {
    for (const message of [
      "permission denied for function registrar_venda_presencial",
      'new row violates row-level security policy for table "orders"',
    ]) {
      expect(mensagemDaFalhaDaVenda({ code: "42501", message })).toEqual({
        mensagem: "Acesso negado: só a loja registra venda no balcão.",
        podeTentarDeNovo: false,
        precisaEntrarDeNovo: true,
      });
    }
  });

  it("controle: 42501 com a frase da casa repassa a frase", () => {
    expect(
      mensagemDaFalhaDaVenda({
        code: "42501",
        message:
          "Não autorizado: é preciso estar autenticado para registrar a venda.",
      }).mensagem,
    ).toBe(
      "Não autorizado: é preciso estar autenticado para registrar a venda.",
    );
  });

  it("22023 técnico cai na frase da casa, sem convidar a repetir", () => {
    expect(
      mensagemDaFalhaDaVenda({ code: "22023", message: "invalid parameter" }),
    ).toEqual({
      mensagem: "Não foi possível registrar a venda.",
      podeTentarDeNovo: false,
      precisaEntrarDeNovo: false,
    });
  });

  it("controle: 22023 de estoque com nome de produto em inglês segue repassado e repetível", () => {
    const message =
      "Estoque insuficiente para o produto The Blue Shirt for Men (Disponível: 1, Solicitado: 2)";
    expect(mensagemDaFalhaDaVenda({ code: "22023", message })).toEqual({
      mensagem: message,
      podeTentarDeNovo: true,
      precisaEntrarDeNovo: false,
    });
  });

  it("57014 (o servidor demorou): manda conferir antes de repetir, sem afirmar que falhou nem que gravou", () => {
    for (const haDuvida of [false, true]) {
      const falha = mensagemDaFalhaDaVenda(
        {
          code: "57014",
          message: "canceling statement due to statement timeout",
        },
        haDuvida,
      );
      expect(falha.mensagem).toBe(MENSAGEM_DE_DEMORA_DA_VENDA);
      expect(falha.mensagem).toContain("servidor demorou");
      expect(falha.mensagem).toContain("Confira");
      expect(falha.mensagem).toContain("antes de tentar de novo");
      expect(falha.mensagem).not.toContain("não foi registrada");
      expect(falha.mensagem).not.toContain("estoque não foi descontado");
      expect(falha.mensagem).not.toMatch(JARGAO_TECNICO);
      expect(falha.podeTentarDeNovo).toBe(true);
      expect(falha.precisaEntrarDeNovo).toBe(false);
    }
  });

  it("57014 ABRE a dúvida: a tela não sabe se a venda entrou", () => {
    expect(efeitoDaFalhaNaDuvida({ code: "57014", message: "x" })).toBe("abre");
  });

  it("os outros bancos ocupados seguem como eram (não abrem dúvida)", () => {
    for (const code of ["40001", "55P03", "40P01", "53300"]) {
      expect(efeitoDaFalhaNaDuvida({ code, message: "x" }), code).toBe(
        "mantem",
      );
    }
  });

  it.each(["PGRST301", "PGRST302", "PGRST303"])(
    "%s (JWT vencido) pede para entrar de novo, sem o texto do banco",
    (code) => {
      const falha = mensagemDaFalhaDaVenda({ code, message: "JWT expired" });
      expect(falha.precisaEntrarDeNovo).toBe(true);
      expect(falha.mensagem).not.toMatch(JARGAO_TECNICO);
    },
  );

  it("erro sem código segue sendo 'sem conexão'", () => {
    expect(
      mensagemDaFalhaDaVenda(new TypeError("Failed to fetch")).mensagem,
    ).toContain("Não consegui falar com o servidor");
  });
});
