// `aguardarComPrazo` e o aviso de consulta demorada do painel, direto, sem tela
// no meio. Até aqui só eram provados por tabela, através de dezenas de telas que
// os usam com prazos diferentes — e nenhuma delas prende o contrato exato:
//  - dentro do prazo vale o que a requisição responder (valor OU a rejeição
//    DELA, nunca a do prazo), e a mensagem de "sem resposta" nem é montada;
//  - estourou, rejeita com o erro de `erroAoEsgotar()` aos `prazoMs` exatos
//    (um milissegundo antes ainda espera);
//  - o relógio é sempre desarmado ao terminar (rede boa não deixa um timer de
//    20 s pendurado por tela aberta);
//  - o aviso do painel dispara UMA vez aos 20 s, e cancelar antes impede (e
//    cancelar de novo não faz mal).
import {
  CODIGO_CONSULTA_SEM_RESPOSTA,
  MENSAGEM_CONEXAO_LENTA,
  PRAZO_DA_CONSULTA_DO_PAINEL_MS,
  aguardarComPrazo,
  ehConsultaSemResposta,
  erroDeConsultaSemResposta,
  programarAvisoDeConsultaDoPainel,
} from "@/lib/prazo-da-requisicao";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("aguardarComPrazo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a requisição responde dentro do prazo: devolve o valor dela, não monta o erro e desarma o relógio", async () => {
    const montarErro = vi.fn(() => new Error("sem resposta"));
    const resultado = aguardarComPrazo(
      Promise.resolve("pronto"),
      1000,
      montarErro,
    );

    await expect(resultado).resolves.toBe("pronto");
    expect(montarErro).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a requisição rejeita dentro do prazo: vale a rejeição DELA, não a do prazo, e o relógio é desarmado", async () => {
    const dela = new Error("23505 duplicado");
    const resultado = aguardarComPrazo(
      Promise.reject(dela),
      1000,
      () => new Error("sem resposta"),
    );

    await expect(resultado).rejects.toBe(dela);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("estourou o prazo: rejeita com o erro montado por erroAoEsgotar, aos prazoMs exatos", async () => {
    const pendurada = new Promise<string>(() => {});
    const esgotado = new Error("sem resposta");
    const resultado = aguardarComPrazo(pendurada, 1000, () => esgotado);
    const desfecho = vi.fn();
    resultado.then(
      () => desfecho("resolveu"),
      (erro: unknown) => desfecho(erro),
    );

    await vi.advanceTimersByTimeAsync(999);
    expect(desfecho).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(desfecho).toHaveBeenCalledTimes(1);
    expect(desfecho).toHaveBeenCalledWith(esgotado);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a requisição que responde DEPOIS do prazo não muda o desfecho já dado", async () => {
    let responder: (valor: string) => void = () => {};
    const tardia = new Promise<string>((resolve) => {
      responder = resolve;
    });
    const resultado = aguardarComPrazo(
      tardia,
      500,
      () => new Error("sem resposta"),
    );
    const desfecho = vi.fn();
    resultado.then(
      () => desfecho("resolveu"),
      (erro: unknown) => desfecho((erro as Error).message),
    );

    await vi.advanceTimersByTimeAsync(500);
    responder("tarde demais");
    await vi.advanceTimersByTimeAsync(0);

    expect(desfecho).toHaveBeenCalledTimes(1);
    expect(desfecho).toHaveBeenCalledWith("sem resposta");
  });
});

describe("erro de consulta sem resposta", () => {
  it("traz a frase padrão para quem está na tela e o código que as telas reconhecem", () => {
    const erro = erroDeConsultaSemResposta();

    expect(erro.message).toBe(MENSAGEM_CONEXAO_LENTA);
    expect((erro as Error & { code?: string }).code).toBe(
      CODIGO_CONSULTA_SEM_RESPOSTA,
    );
    expect(ehConsultaSemResposta(erro)).toBe(true);
  });

  it("aceita frase própria e continua reconhecível", () => {
    const erro = erroDeConsultaSemResposta("Sem resposta da rede.");

    expect(erro.message).toBe("Sem resposta da rede.");
    expect(ehConsultaSemResposta(erro)).toBe(true);
  });

  it.each([
    ["erro de banco com outro código", { code: "23505" }],
    ["erro sem código", new Error("Failed to fetch")],
    ["texto solto", CODIGO_CONSULTA_SEM_RESPOSTA],
    ["null", null],
    ["undefined", undefined],
  ])("%s NÃO é consulta sem resposta", (_, valor) => {
    expect(ehConsultaSemResposta(valor)).toBe(false);
  });
});

describe("programarAvisoDeConsultaDoPainel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("avisa uma única vez, aos 20 s exatos", () => {
    const avisar = vi.fn();
    programarAvisoDeConsultaDoPainel(avisar);

    vi.advanceTimersByTime(PRAZO_DA_CONSULTA_DO_PAINEL_MS - 1);
    expect(avisar).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(avisar).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5 * PRAZO_DA_CONSULTA_DO_PAINEL_MS);
    expect(avisar).toHaveBeenCalledTimes(1);
  });

  it("o prazo do aviso é de 20 s", () => {
    expect(PRAZO_DA_CONSULTA_DO_PAINEL_MS).toBe(20_000);
  });

  it("cancelar antes do prazo impede o aviso e não deixa timer pendente", () => {
    const avisar = vi.fn();
    const cancelar = programarAvisoDeConsultaDoPainel(avisar);

    vi.advanceTimersByTime(PRAZO_DA_CONSULTA_DO_PAINEL_MS - 1);
    cancelar();
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(PRAZO_DA_CONSULTA_DO_PAINEL_MS);
    expect(avisar).not.toHaveBeenCalled();
  });

  it("cancelar duas vezes, ou depois de o aviso já ter saído, não faz mal", () => {
    const avisar = vi.fn();
    const cancelar = programarAvisoDeConsultaDoPainel(avisar);

    vi.advanceTimersByTime(PRAZO_DA_CONSULTA_DO_PAINEL_MS);
    expect(avisar).toHaveBeenCalledTimes(1);

    expect(() => {
      cancelar();
      cancelar();
    }).not.toThrow();
    expect(avisar).toHaveBeenCalledTimes(1);
  });
});
