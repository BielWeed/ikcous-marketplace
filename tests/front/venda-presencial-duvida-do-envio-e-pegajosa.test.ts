// Balcão — a DÚVIDA "esta venda pode já ter sido gravada" é PEGAJOSA.
//
// O defeito: a venda de 2 peças é gravada no banco, a resposta se perde, e a
// tela diz certo ("não sei se registrou"). A lojista tenta de novo (mesma chave)
// e o banco responde algo passageiro (53300, conexões esgotadas). A tela passava
// a jurar "a venda não foi registrada… o estoque não foi descontado", o F5
// apagava a dúvida e o Cancelar dizia "Nada é registrado" — refazer a venda com
// chave nova duplicava o pedido e baixava o estoque duas vezes.
//
// A regra: uma vez que houve resposta perdida/rede com a chave, a dúvida só cai
// com uma resposta DEFINITIVA com a MESMA chave:
//   · a venda aparece (recibo, `ja_existia` ou não), ou
//   · uma recusa de NEGÓCIO (22023, PDV01). A RPC confere a chave ANTES de
//     validar qualquer coisa (migration 20261280000000, passo 2): se a venda
//     existisse, devolveria `ja_existia`; a recusa só vem quando ela NÃO existe.
// Erro passageiro/de infraestrutura (53xx, 40001, 57014, 55P03, 40P01, sessão,
// 42501, código desconhecido) NÃO prova nada sobre a tentativa anterior.
import { describe, expect, it } from "vitest";

import {
  type EstadoDaVenda,
  type ItemDoCupom,
  type ReciboDaVendaRegistrada,
  estadoInicialDaVenda,
  lerRascunho,
  reducerDaVenda,
  serializarRascunho,
} from "@/hooks/useVendaPresencial";
import {
  MENSAGEM_DE_REDE_DA_VENDA,
  efeitoDaFalhaNaDuvida,
  mensagemDaFalhaDaVenda,
} from "@/lib/erro-da-venda-presencial";

const AGORA = Date.parse("2026-11-13T15:00:00-03:00");

const DUAS_CANECAS: ItemDoCupom = {
  chave: "caneca::",
  productId: "caneca",
  variantId: null,
  nome: "Caneca Azul",
  variacao: null,
  preco: 50,
  quantidade: 2,
  estoque: 10,
  imagem: "",
};

function cupomPronto(): EstadoDaVenda {
  return {
    ...estadoInicialDaVenda(() => "chave-1"),
    etapa: "fechamento",
    pagamento: "cash",
    itens: [DUAS_CANECAS],
  };
}

/** O que `FechamentoDaVenda.aoClicarRegistrar` faz quando a venda lança. */
function clicarRegistrarEFalhar(
  estado: EstadoDaVenda,
  erro: unknown,
): EstadoDaVenda {
  const enviando = reducerDaVenda(estado, { tipo: "envio_iniciado" });
  const falha = mensagemDaFalhaDaVenda(erro, estado.talvezGravada);
  return reducerDaVenda(enviando, {
    tipo: "envio_falhou",
    mensagem: falha.mensagem,
    efeito: efeitoDaFalhaNaDuvida(erro),
  });
}

const RESPOSTA_PERDIDA = new TypeError("Failed to fetch");
const CONEXOES_ESGOTADAS = {
  code: "53300",
  message: "too many connections for role",
};
const SEM_ESTOQUE = {
  code: "22023",
  message: "Estoque insuficiente para o produto Caneca Azul",
};

const RECIBO: ReciboDaVendaRegistrada = {
  orderId: "11111111-1111-1111-1111-111111111111",
  numero: "111111",
  criadoEm: "2026-11-13T12:00:00.000Z",
  total: 100,
  subtotal: 100,
  desconto: 0,
  pagamento: "cash",
  cliente: { tipo: "sem_cliente" },
  itens: [DUAS_CANECAS],
  jaExistia: true,
};

describe("efeitoDaFalhaNaDuvida — quais respostas abrem, fecham ou deixam a dúvida como está", () => {
  it.each([
    ["erro sem código (fetch falhou)", RESPOSTA_PERDIDA],
    [
      "prazo da tela estourado",
      new Error("O registro da venda não respondeu a tempo."),
    ],
    ["08006 conexão caiu", { code: "08006", message: "connection failure" }],
    ["08001", { code: "08001", message: "unable to connect" }],
    ["57P01 servidor desligando", { code: "57P01", message: "terminating" }],
    ["57P03", { code: "57P03", message: "starting up" }],
    ["code vazio do postgrest-js", { code: "", message: "TypeError: fetch" }],
  ])("ABRE a dúvida: %s", (_nome, erro) => {
    expect(efeitoDaFalhaNaDuvida(erro)).toBe("abre");
  });

  it.each([
    ["22023 estoque", SEM_ESTOQUE],
    [
      "22023 motivo do desconto",
      { code: "22023", message: "Informe o motivo do desconto." },
    ],
    [
      "22023 peça saiu do catálogo",
      { code: "22023", message: "Produto Caneca não disponível." },
    ],
    ["22023 cliente", { code: "22023", message: "Cliente não encontrado." }],
    [
      "22023 venda já anulada (resposta sintética da tela: a venda é CONHECIDA)",
      {
        code: "22023",
        message:
          "Esta venda já foi anulada. Comece uma venda nova para registrar de novo.",
      },
    ],
    [
      "PDV01 total mudou",
      { code: "PDV01", message: "O valor da venda mudou." },
    ],
  ])(
    "FECHA a dúvida (nada foi gravado, ou a venda é conhecida): %s",
    (_nome, erro) => {
      expect(efeitoDaFalhaNaDuvida(erro)).toBe("fecha");
    },
  );

  it.each([
    ["53300 conexões esgotadas", CONEXOES_ESGOTADAS],
    ["53200 sem memória", { code: "53200", message: "out of memory" }],
    ["40001 serialização", { code: "40001", message: "could not serialize" }],
    ["57014 tempo do banco", { code: "57014", message: "statement timeout" }],
    ["55P03 trava", { code: "55P03", message: "could not obtain lock" }],
    ["40P01 deadlock", { code: "40P01", message: "deadlock detected" }],
    [
      "42501 sem permissão (o portão vem ANTES da chave)",
      { code: "42501", message: "Acesso negado" },
    ],
    ["PGRST301 sessão vencida", { code: "PGRST301", message: "JWT expired" }],
    ["PGRST302", { code: "PGRST302", message: "x" }],
    ["PGRST303", { code: "PGRST303", message: "x" }],
    ["PGRST202 função fora do cache", { code: "PGRST202", message: "x" }],
    ["23505 chave de outro pedido", { code: "23505", message: "x" }],
    ["código desconhecido", { code: "XX999", message: "something exploded" }],
    ["PGRST000", { code: "PGRST000", message: "x" }],
    ["P0001", { code: "P0001", message: "x" }],
  ])("MANTÉM a dúvida como está: %s", (_nome, erro) => {
    expect(efeitoDaFalhaNaDuvida(erro)).toBe("mantem");
  });

  it("coerência com a tradução: toda falha que a tela traduz como 'rede' ABRE a dúvida, e só ela", () => {
    const amostras: unknown[] = [
      RESPOSTA_PERDIDA,
      CONEXOES_ESGOTADAS,
      SEM_ESTOQUE,
      { code: "08006" },
      { code: "57P01" },
      { code: "42501" },
      { code: "PGRST301" },
      { code: "PDV01" },
      { code: "23505" },
      { code: "XX999" },
      { code: "40P01" },
      { code: "55P03" },
    ];
    for (const erro of amostras) {
      const ehRede =
        mensagemDaFalhaDaVenda(erro).mensagem === MENSAGEM_DE_REDE_DA_VENDA;
      expect(efeitoDaFalhaNaDuvida(erro) === "abre", JSON.stringify(erro)).toBe(
        ehRede,
      );
    }
  });
});

describe("mensagemDaFalhaDaVenda — com dúvida pendente, nunca afirma que a venda não foi registrada", () => {
  it("sem dúvida a frase de 53300 é a de sempre", () => {
    expect(mensagemDaFalhaDaVenda(CONEXOES_ESGOTADAS).mensagem).toContain(
      "o estoque não foi descontado",
    );
    expect(
      mensagemDaFalhaDaVenda(CONEXOES_ESGOTADAS, false).mensagem,
    ).toContain("a venda não foi registrada");
  });

  it("com dúvida, a frase de 53300 fala só desta tentativa", () => {
    const falha = mensagemDaFalhaDaVenda(CONEXOES_ESGOTADAS, true);
    expect(falha.mensagem).not.toContain("não foi registrada");
    expect(falha.mensagem).not.toContain("estoque não foi descontado");
    expect(falha.podeTentarDeNovo).toBe(true);
    expect(falha.precisaEntrarDeNovo).toBe(false);
  });

  it("a dúvida não muda o resto: sessão, permissão e rede seguem iguais", () => {
    for (const erro of [
      RESPOSTA_PERDIDA,
      { code: "42501", message: "Acesso negado" },
      { code: "PGRST301", message: "JWT expired" },
      SEM_ESTOQUE,
      { code: "40P01", message: "deadlock detected" },
    ]) {
      expect(mensagemDaFalhaDaVenda(erro, true), JSON.stringify(erro)).toEqual(
        mensagemDaFalhaDaVenda(erro, false),
      );
    }
  });
});

describe("estado da venda — a dúvida sobrevive à 2ª falha", () => {
  it("(a) resposta perdida, depois 53300: a dúvida continua, e a frase não nega a venda", () => {
    let estado = clicarRegistrarEFalhar(cupomPronto(), RESPOSTA_PERDIDA);
    expect(estado.talvezGravada).toBe(true);
    expect(estado.erro).toBe(MENSAGEM_DE_REDE_DA_VENDA);

    estado = clicarRegistrarEFalhar(estado, CONEXOES_ESGOTADAS);
    expect(estado.talvezGravada).toBe(true);
    expect(estado.erro).not.toBeNull();
    expect(estado.erro).not.toContain("não foi registrada");
    // a MESMA chave segue valendo: é ela que devolve o recibo da venda que entrou
    expect(estado.chaveDeIdempotencia).toBe("chave-1");
  });

  it("(a) a dúvida resiste a várias falhas passageiras seguidas, de todos os tipos", () => {
    let estado = clicarRegistrarEFalhar(cupomPronto(), RESPOSTA_PERDIDA);
    for (const erro of [
      CONEXOES_ESGOTADAS,
      { code: "40001", message: "x" },
      { code: "57014", message: "x" },
      { code: "55P03", message: "x" },
      { code: "40P01", message: "x" },
      { code: "42501", message: "Acesso negado" },
      { code: "PGRST301", message: "JWT expired" },
      { code: "PGRST202", message: "x" },
      { code: "23505", message: "x" },
      { code: "XX999", message: "x" },
    ]) {
      estado = clicarRegistrarEFalhar(estado, erro);
      expect(estado.talvezGravada, JSON.stringify(erro)).toBe(true);
    }
  });

  it("(a) F5: a dúvida vai ao disco e volta, mesmo com o erro de agora sendo 'ocupado'", () => {
    let estado = clicarRegistrarEFalhar(cupomPronto(), RESPOSTA_PERDIDA);
    estado = clicarRegistrarEFalhar(estado, CONEXOES_ESGOTADAS);
    expect(estado.erro).not.toBe(MENSAGEM_DE_REDE_DA_VENDA);

    const disco = serializarRascunho(estado, AGORA);
    expect(JSON.parse(disco).talvezGravada).toBe(true);
    // só o FATO vai ao disco, nunca o texto
    expect(disco).not.toContain(estado.erro as string);

    const lido = lerRascunho(disco, AGORA);
    expect(lido?.talvezGravada).toBe(true);
    expect(lido?.erro).toBe(MENSAGEM_DE_REDE_DA_VENDA);
    expect(lido?.chaveDeIdempotencia).toBe("chave-1");
  });

  it("(a) com a retentativa NO AR (envio_iniciado) a dúvida continua no estado e no disco", () => {
    const duvida = clicarRegistrarEFalhar(cupomPronto(), RESPOSTA_PERDIDA);
    const enviando = reducerDaVenda(duvida, { tipo: "envio_iniciado" });
    expect(enviando.erro).toBeNull();
    expect(enviando.talvezGravada).toBe(true);
    expect(JSON.parse(serializarRascunho(enviando, AGORA)).talvezGravada).toBe(
      true,
    );
  });

  it("(a) mexer no cupom com a dúvida aberta mantém o aviso (como frase de rede), não o apaga", () => {
    let estado = clicarRegistrarEFalhar(cupomPronto(), RESPOSTA_PERDIDA);
    estado = clicarRegistrarEFalhar(estado, CONEXOES_ESGOTADAS);
    const depois = reducerDaVenda(estado, {
      tipo: "quantidade_alterada",
      chave: DUAS_CANECAS.chave,
      delta: -1,
    });
    expect(depois.talvezGravada).toBe(true);
    expect(depois.erro).toBe(MENSAGEM_DE_REDE_DA_VENDA);
    expect(depois.chaveDeIdempotencia).toBe("chave-1");
  });

  it("(b) recusa de NEGÓCIO com a mesma chave fecha a dúvida (nada foi gravado)", () => {
    let estado = clicarRegistrarEFalhar(cupomPronto(), RESPOSTA_PERDIDA);
    estado = clicarRegistrarEFalhar(estado, CONEXOES_ESGOTADAS);
    estado = clicarRegistrarEFalhar(estado, SEM_ESTOQUE);
    expect(estado.talvezGravada).toBe(false);
    expect(estado.erro).toContain("Estoque insuficiente");
    expect(
      "talvezGravada" in JSON.parse(serializarRascunho(estado, AGORA)),
    ).toBe(false);
    expect(lerRascunho(serializarRascunho(estado, AGORA), AGORA)?.erro).toBe(
      null,
    );
  });

  it("(b) PDV01 (o valor mudou) também fecha", () => {
    let estado = clicarRegistrarEFalhar(cupomPronto(), RESPOSTA_PERDIDA);
    estado = clicarRegistrarEFalhar(estado, {
      code: "PDV01",
      message: "O valor da venda mudou.",
    });
    expect(estado.talvezGravada).toBe(false);
  });

  it.each([true, false])(
    "(b) o recibo (ja_existia=%s) fecha a dúvida",
    (jaExistia) => {
      const duvida = clicarRegistrarEFalhar(cupomPronto(), RESPOSTA_PERDIDA);
      const comRecibo = reducerDaVenda(
        reducerDaVenda(duvida, { tipo: "envio_iniciado" }),
        { tipo: "venda_registrada", recibo: { ...RECIBO, jaExistia } },
      );
      expect(comRecibo.talvezGravada).toBe(false);
      expect(comRecibo.erro).toBeNull();
      expect(comRecibo.etapa).toBe("recibo");
    },
  );

  it("(b) começar OUTRA venda (chave nova) zera a dúvida, que era da chave velha", () => {
    const duvida = clicarRegistrarEFalhar(cupomPronto(), RESPOSTA_PERDIDA);
    const nova = reducerDaVenda(duvida, {
      tipo: "cupom_limpo",
      novaChave: "chave-2",
    });
    expect(nova.talvezGravada).toBe(false);
    expect(nova.chaveDeIdempotencia).toBe("chave-2");
  });

  it("(c) controle: 1ª falha passageira SEM dúvida anterior continua dizendo 'não foi registrada'", () => {
    const estado = clicarRegistrarEFalhar(cupomPronto(), CONEXOES_ESGOTADAS);
    expect(estado.talvezGravada).toBe(false);
    expect(estado.erro).toContain("a venda não foi registrada");
    expect(estado.erro).toContain("o estoque não foi descontado");
    expect(
      "talvezGravada" in JSON.parse(serializarRascunho(estado, AGORA)),
    ).toBe(false);
  });

  it("(c) controle: várias falhas passageiras SEM nenhuma resposta perdida nunca criam dúvida", () => {
    let estado = cupomPronto();
    for (const erro of [
      CONEXOES_ESGOTADAS,
      { code: "40P01", message: "x" },
      { code: "42501", message: "Acesso negado" },
    ]) {
      estado = clicarRegistrarEFalhar(estado, erro);
      expect(estado.talvezGravada).toBe(false);
    }
  });

  it("(c) controle: recusa de negócio sem dúvida anterior segue como sempre", () => {
    const estado = clicarRegistrarEFalhar(cupomPronto(), SEM_ESTOQUE);
    expect(estado.talvezGravada).toBe(false);
    expect(estado.erro).toContain("Estoque insuficiente");
  });
});

describe("rascunho — a dúvida do disco", () => {
  it("rascunho gravado pela versão anterior (talvezGravada:true, sem campo no estado) volta com a dúvida", () => {
    const base = JSON.parse(serializarRascunho(cupomPronto(), AGORA));
    const antigo = JSON.stringify({ ...base, talvezGravada: true });
    const lido = lerRascunho(antigo, AGORA);
    expect(lido?.talvezGravada).toBe(true);
    expect(lido?.erro).toBe(MENSAGEM_DE_REDE_DA_VENDA);
  });

  it("rascunho sem o campo volta SEM dúvida", () => {
    const lido = lerRascunho(serializarRascunho(cupomPronto(), AGORA), AGORA);
    expect(lido?.talvezGravada).toBe(false);
    expect(lido?.erro).toBeNull();
  });

  it("valor torto no disco nunca vira dúvida: só `true` exato vale", () => {
    const base = JSON.parse(serializarRascunho(cupomPronto(), AGORA));
    for (const torto of ["true", 1, null, false, { a: 1 }]) {
      const lido = lerRascunho(
        JSON.stringify({ ...base, talvezGravada: torto }),
        AGORA,
      );
      expect(lido?.talvezGravada, JSON.stringify(torto)).toBe(false);
    }
  });
});
