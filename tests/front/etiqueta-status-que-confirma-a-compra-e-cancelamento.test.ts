// A compra da etiqueta (dinheiro que saiu do saldo do Melhor Envio) só é dada
// como confirmada por prova: um evento de geração, um rastreio com código
// utilizável, ou o status da etiqueta no provedor. Os testes vizinhos cobrem
// `released`, `delivered` e `canceled`; aqui entram os OUTROS status da lista
// (paid, generated, posted, undelivered), a limpeza do texto e a ordem do
// cancelamento. Ids e códigos fictícios.
import {
  situacaoDaCompraPeloHistorico,
  statusDaEtiquetaCancelada,
  statusDaEtiquetaConfirmaCompra,
} from "@/lib/elegibilidade-da-etiqueta";
import { describe, expect, it } from "vitest";

const ETIQUETA = "lbl-fict-1";

const rastreio = (
  payload: Record<string, unknown>,
  quando = "2026-10-27T10:00:00Z",
  extra: Record<string, unknown> = {},
) => ({
  event_type: "rastreio_consultado",
  created_at: quando,
  payload: { label_id: ETIQUETA, ...payload },
  ...extra,
});

describe("status do provedor que provam a compra da etiqueta", () => {
  it.each([
    "paid",
    "released",
    "generated",
    "posted",
    "delivered",
    "undelivered",
  ])("%s confirma a compra", (status) => {
    expect(statusDaEtiquetaConfirmaCompra(status)).toBe(true);
    expect(
      situacaoDaCompraPeloHistorico(
        [rastreio({ status_etiqueta: status })],
        ETIQUETA,
      ),
    ).toBe("confirmada");
  });

  it("maiúscula e espaço nas pontas não atrapalham", () => {
    for (const status of ["PAID", " Released ", "\tPosted\n", "UNDELIVERED"]) {
      expect(statusDaEtiquetaConfirmaCompra(status)).toBe(true);
    }
  });

  it.each([
    "pending",
    "waiting",
    "canceled",
    "cancelled",
    "",
    "   ",
    "released_x",
    "unpaid",
    "paid out",
  ])(
    "%j NÃO prova a compra (ausência de prova não é confirmação)",
    (status) => {
      expect(statusDaEtiquetaConfirmaCompra(status)).toBe(false);
      expect(
        situacaoDaCompraPeloHistorico(
          [rastreio({ status_etiqueta: status })],
          ETIQUETA,
        ),
      ).not.toBe("confirmada");
    },
  );

  it("o que nem é texto não prova nada", () => {
    for (const lixo of [null, undefined, 1, true, {}, ["paid"]]) {
      expect(statusDaEtiquetaConfirmaCompra(lixo)).toBe(false);
    }
  });
});

describe("etiqueta cancelada no provedor", () => {
  it.each(["canceled", "cancelled", " CANCELED ", "Cancelled\n"])(
    "%j é cancelada",
    (status) => {
      expect(statusDaEtiquetaCancelada(status)).toBe(true);
    },
  );

  it.each(["cancel", "canceling", "pending", "", "released"])(
    "%j não é cancelada",
    (status) => {
      expect(statusDaEtiquetaCancelada(status)).toBe(false);
    },
  );

  it("o que nem é texto não é cancelada", () => {
    for (const lixo of [null, undefined, 0, false, {}]) {
      expect(statusDaEtiquetaCancelada(lixo)).toBe(false);
    }
  });

  it("cancelada no provedor vence a confirmação, qualquer que seja a ordem da lista", () => {
    const gerada = {
      event_type: "etiqueta_gerada",
      created_at: "2026-10-27T10:00:00Z",
      payload: { label_id: ETIQUETA },
    };
    const cancelada = rastreio(
      { status_etiqueta: "cancelled" },
      "2026-10-27T11:00:00Z",
    );
    expect(situacaoDaCompraPeloHistorico([gerada, cancelada], ETIQUETA)).toBe(
      "cancelada",
    );
    expect(situacaoDaCompraPeloHistorico([cancelada, gerada], ETIQUETA)).toBe(
      "cancelada",
    );
  });

  it("evento de cancelamento de OUTRA etiqueta não derruba esta", () => {
    const gerada = {
      event_type: "etiqueta_gerada",
      created_at: "2026-10-27T10:00:00Z",
      payload: { label_id: ETIQUETA },
    };
    const outra = {
      ...rastreio({ status_etiqueta: "canceled" }, "2026-10-27T11:00:00Z"),
      payload: { label_id: "lbl-fict-2", status_etiqueta: "canceled" },
    };
    expect(situacaoDaCompraPeloHistorico([gerada, outra], ETIQUETA)).toBe(
      "confirmada",
    );
  });

  it("o status 'canceled' só vale como cancelamento em evento de rastreio", () => {
    const gerada = {
      event_type: "etiqueta_gerada",
      created_at: "2026-10-27T10:00:00Z",
      payload: { label_id: ETIQUETA, status_etiqueta: "canceled" },
    };
    expect(situacaoDaCompraPeloHistorico([gerada], ETIQUETA)).toBe(
      "confirmada",
    );
  });
});

describe("rastreio com código utilizável confirma; sem código, não", () => {
  it("código com letra ou número confirma a compra", () => {
    expect(
      situacaoDaCompraPeloHistorico(
        [rastreio({}, undefined, { tracking_code: "AB123456789BR" })],
        ETIQUETA,
      ),
    ).toBe("confirmada");
  });

  it.each(["", "   ", "---", " / "])(
    "código %j (só espaço ou símbolo) não confirma",
    (codigo) => {
      expect(
        situacaoDaCompraPeloHistorico(
          [rastreio({}, undefined, { tracking_code: codigo })],
          ETIQUETA,
        ),
      ).toBe("sem_prova");
    },
  );

  it("código que não é texto não confirma", () => {
    for (const codigo of [null, undefined, 123456, {}]) {
      expect(
        situacaoDaCompraPeloHistorico(
          [rastreio({}, undefined, { tracking_code: codigo })],
          ETIQUETA,
        ),
      ).toBe("sem_prova");
    }
  });

  it("histórico que não é lista, vazio ou com lixo dentro não dá prova", () => {
    expect(situacaoDaCompraPeloHistorico(null, ETIQUETA)).toBe("sem_prova");
    expect(situacaoDaCompraPeloHistorico("x", ETIQUETA)).toBe("sem_prova");
    expect(situacaoDaCompraPeloHistorico([], ETIQUETA)).toBe("sem_prova");
    expect(
      situacaoDaCompraPeloHistorico([null, 3, "x", undefined], ETIQUETA),
    ).toBe("sem_prova");
  });

  it("evento de erro em etapa que não é a do débito não confirma", () => {
    const erro = (etapa: string) => ({
      event_type: "erro",
      created_at: "2026-10-27T10:00:00Z",
      payload: { label_id: ETIQUETA, etapa },
    });
    expect(situacaoDaCompraPeloHistorico([erro("cotacao")], ETIQUETA)).toBe(
      "sem_prova",
    );
    expect(situacaoDaCompraPeloHistorico([erro("generate")], ETIQUETA)).toBe(
      "confirmada",
    );
    expect(situacaoDaCompraPeloHistorico([erro("gravacao")], ETIQUETA)).toBe(
      "confirmada",
    );
  });
});
