// A visão do CRM (KPIs, funil, pipeline) fica guardada por período para a tela
// abrir sem esperar. Quando um pedido muda (`useAnalytics` invalida), duas
// coisas têm de acontecer juntas: o que estava guardado some, e a "geração"
// sobe — é ela que faz uma consulta que PARTIU antes da mudança descartar a
// resposta velha em vez de guardá-la por cima. Os testes dos hooks provam a
// ligação; aqui ficam as duas regras do módulo, sem React.
import { afterEach, describe, expect, it } from "vitest";

import {
  cacheDaVisao,
  invalidarVisaoDoCrm,
  lerGeracaoDaVisaoDoCrm,
} from "@/lib/cache-da-visao-do-crm";
import type { VisaoDoCrm } from "@/types/crm";

const visao = (rotulo: string) => ({ rotulo }) as unknown as VisaoDoCrm;

afterEach(() => {
  cacheDaVisao.clear();
});

describe("cache da visão do CRM", () => {
  it("invalidar apaga TODAS as visões guardadas, de qualquer período", () => {
    cacheDaVisao.set("7d", { visao: visao("a"), lidoEm: 1 });
    cacheDaVisao.set("30d", { visao: visao("b"), lidoEm: 2 });
    cacheDaVisao.set("90d", { visao: visao("c"), lidoEm: 3 });

    invalidarVisaoDoCrm();

    expect(cacheDaVisao.size).toBe(0);
    expect(cacheDaVisao.get("30d")).toBeUndefined();
  });

  it("cada invalidação sobe a geração em exatamente 1", () => {
    const antes = lerGeracaoDaVisaoDoCrm();

    invalidarVisaoDoCrm();
    expect(lerGeracaoDaVisaoDoCrm()).toBe(antes + 1);

    invalidarVisaoDoCrm();
    invalidarVisaoDoCrm();
    expect(lerGeracaoDaVisaoDoCrm()).toBe(antes + 3);
  });

  it("ler a geração não a altera", () => {
    const antes = lerGeracaoDaVisaoDoCrm();
    lerGeracaoDaVisaoDoCrm();
    lerGeracaoDaVisaoDoCrm();
    expect(lerGeracaoDaVisaoDoCrm()).toBe(antes);
  });

  it("com o cache JÁ vazio a geração sobe do mesmo jeito: a consulta em voo é descartada", () => {
    // Uma consulta que partiu com o cache vazio captura a geração; o pedido muda
    // no meio do caminho; a resposta, que reflete o estado ANTIGO, chega depois.
    const geracaoDaConsulta = lerGeracaoDaVisaoDoCrm();
    expect(cacheDaVisao.size).toBe(0);

    invalidarVisaoDoCrm();

    expect(lerGeracaoDaVisaoDoCrm()).not.toBe(geracaoDaConsulta);
  });

  it("o que for guardado DEPOIS da invalidação fica até a invalidação seguinte", () => {
    invalidarVisaoDoCrm();
    cacheDaVisao.set("7d", { visao: visao("nova"), lidoEm: 10 });

    expect(cacheDaVisao.get("7d")?.visao).toEqual({ rotulo: "nova" });

    invalidarVisaoDoCrm();
    expect(cacheDaVisao.size).toBe(0);
  });
});
