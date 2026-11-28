// @vitest-environment jsdom
//
// O cartão "Sua assinatura" da loja que SAIU (28/11/2026, decisão do sócio
// "loja vendendo depois do fim do contrato"). O dono registra a saída no app
// de gestão, que grava `cancelada`; com a pausa ligada nesta loja o banco
// (migration 20261661000000) recusa o pedido NOVO pela vitrine e
// `situacao_das_vendas_da_loja()` responde `vendas_pausadas`. O cartão diz que
// a assinatura terminou, que a loja parou de receber pedidos novos e que o
// painel segue aberto para entregar o que falta — nunca "Regularize", nunca
// mensalidade ou valor em aberto (não é dívida). Sem a pausa (o banco aceita)
// a cancelada continua o cartão de hoje. Dados inventados; nenhuma rede.
import { CartaoDaAssinatura } from "@/components/admin/inicio/CartaoDaAssinatura";
import { avisoDasVendasPausadas } from "@/lib/crm";
import { avisoDaSuspensa } from "@/lib/situacao-das-vendas";
import { classeDoPonto } from "@/lib/tons-de-estado";
import type { AssinaturaDaLoja, SituacaoDasVendas } from "@/types/painel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Meio-dia em Brasília (15h UTC) do dia pedido. */
const meioDia = (dia: string) => new Date(`${dia}T15:00:00Z`);

// Como a gestão grava a saída: sem próxima cobrança nem dia de pausa. O valor
// fica (a gestão não o apaga) e mesmo assim não pode aparecer como dívida.
const SAIU: AssinaturaDaLoja = {
  plano: "Plano Inventado",
  status: "cancelada",
  valorMensal: 250,
  ciclo: "mensal",
  inicioEm: "2026-02-27",
  proximaCobrancaEm: null,
  testeAte: null,
  pausaEm: null,
  recursos: ["PDV", "CRM"],
  gerenciarUrl: "https://cobranca.exemplo.com/minha-loja",
  suporteWhatsapp: "34999999999",
  atualizadoEm: null,
};

const PAUSADAS: SituacaoDasVendas = {
  aceita: false,
  motivo: "vendas_pausadas",
  pausadaDesde: null,
};
const ACEITA: SituacaoDasVendas = {
  aceita: true,
  motivo: null,
  pausadaDesde: null,
};

const SELO = "Assinatura encerrada";
const TEXTO =
  "Sua assinatura terminou e a loja parou de receber pedidos novos. O painel continua aberto para você entregar os pedidos que ainda faltam.";

let tela: HTMLDivElement;
let raiz: Root;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(meioDia("2027-03-10"));
  tela = document.createElement("div");
  document.body.appendChild(tela);
  raiz = createRoot(tela);
});
afterEach(() => {
  act(() => raiz.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
  tela.remove();
});

function desenhar(
  parcial: Partial<AssinaturaDaLoja>,
  situacao: SituacaoDasVendas | null = PAUSADAS,
) {
  act(() =>
    raiz.render(
      <CartaoDaAssinatura
        assinatura={{ ...SAIU, ...parcial }}
        situacaoDasVendas={situacao}
        lida
        carregando={false}
        erro={null}
        onTentarDeNovo={() => undefined}
      />,
    ),
  );
}

const paragrafos = () =>
  Array.from(tela.querySelectorAll("p")).map((p) => p.textContent ?? "");
const selo = () =>
  tela.querySelector<HTMLElement>("h3 + p > span.inline-flex") ?? null;
const ponto = () =>
  tela.querySelector<HTMLElement>("span.rounded-full[aria-hidden='true']");
const rotulos = () =>
  Array.from(tela.querySelectorAll("dl dt")).map((dt) => dt.textContent);

describe("avisoDaSuspensa: a loja que saiu", () => {
  const aviso = (a: AssinaturaDaLoja, s: SituacaoDasVendas | null) =>
    avisoDaSuspensa(a, s, avisoDasVendasPausadas(a, meioDia("2027-03-10")));

  it("cancelada e o banco diz vendas_pausadas: encerrada, sem vencimento", () => {
    expect(aviso(SAIU, PAUSADAS)).toEqual({ tipo: "encerrada" });
  });

  it("mesmo com datas e valor que a gestão deixou: encerrada, nunca dívida", () => {
    expect(
      aviso(
        { ...SAIU, proximaCobrancaEm: "2027-02-27", pausaEm: "2027-03-10" },
        PAUSADAS,
      ),
    ).toEqual({ tipo: "encerrada" });
  });

  it("cancelada e o banco aceita (pausa desligada), sem resposta ou manutenção: null", () => {
    expect(aviso(SAIU, ACEITA)).toBeNull();
    expect(aviso(SAIU, null)).toBeNull();
    expect(
      aviso(SAIU, { aceita: false, motivo: "manutencao", pausadaDesde: null }),
    ).toBeNull();
  });

  it("a suspensa pausada continua 'pausadas' (nada muda para ela)", () => {
    expect(
      aviso(
        {
          ...SAIU,
          status: "suspensa",
          proximaCobrancaEm: "2027-01-02",
          pausaEm: "2027-01-13",
        },
        { ...PAUSADAS, pausadaDesde: "2027-01-13" },
      )?.tipo,
    ).toBe("pausadas");
  });
});

describe("CartaoDaAssinatura: a loja que saiu", () => {
  it("com a pausa valendo: selo 'Assinatura encerrada' em vermelho e o texto do que parou e do que segue", () => {
    desenhar({});
    expect(selo()?.textContent).toBe(SELO);
    expect(ponto()?.className).toContain(classeDoPonto("negativo"));
    expect(paragrafos()).toContain(TEXTO);
  });

  it("nada de dívida: sem Regularize, mensalidade, venceu, valor em aberto ou como voltar pagando", () => {
    desenhar({ proximaCobrancaEm: "2027-02-27", pausaEm: "2027-03-10" });
    const texto = tela.textContent ?? "";
    for (const proibido of [
      "Regularize",
      "regularize",
      "mensalidade",
      "venceu",
      "Valor em aberto",
      "Próxima cobrança",
      "pague",
      "pagamento",
      "Vendas pela loja pausadas",
      "Cancelada",
    ])
      expect(texto).not.toContain(proibido);
    expect(rotulos()).toEqual(["Cliente desde"]);
  });

  it("sem a pausa (o banco aceita): o cartão de hoje da cancelada, sem afirmar que parou", () => {
    desenhar({}, ACEITA);
    expect(selo()?.textContent).toBe("Cancelada");
    expect(tela.textContent).not.toContain(SELO);
    expect(paragrafos()).not.toContain(TEXTO);
    expect(tela.textContent).not.toContain("Regularize");
  });

  it("sem a resposta do banco: também o cartão de hoje", () => {
    desenhar({}, null);
    expect(selo()?.textContent).toBe("Cancelada");
    expect(paragrafos()).not.toContain(TEXTO);
  });
});
