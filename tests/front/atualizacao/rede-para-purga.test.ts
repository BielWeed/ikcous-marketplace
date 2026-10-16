// A purga de versão obrigatória só roda com REDE PROVADA: navegador não
// offline E leitura bem-sucedida de /version.json recente. Sem isso, aguarda.
import { describe, expect, it } from "vitest";

import {
  VALIDADE_DA_LEITURA_DE_VERSAO_MS,
  redeVerificadaParaPurga,
} from "@/lib/atualizacao/rede-para-purga";

const AGORA = 1_000_000_000;

describe("redeVerificadaParaPurga", () => {
  it("leitura recente e navegador online: verificada", () => {
    expect(
      redeVerificadaParaPurga({
        ultimaLeituraBemSucedidaEm: AGORA - 1000,
        agora: AGORA,
        online: true,
      }),
    ).toBe(true);
  });

  it("ambiente que não informa onLine (undefined) conta como não-offline", () => {
    expect(
      redeVerificadaParaPurga({
        ultimaLeituraBemSucedidaEm: AGORA - 1000,
        agora: AGORA,
        online: undefined,
      }),
    ).toBe(true);
  });

  it("navegador DECLARA offline: não, mesmo com leitura recente", () => {
    expect(
      redeVerificadaParaPurga({
        ultimaLeituraBemSucedidaEm: AGORA - 1000,
        agora: AGORA,
        online: false,
      }),
    ).toBe(false);
  });

  it("NUNCA houve leitura bem-sucedida: não (aguarda)", () => {
    expect(
      redeVerificadaParaPurga({
        ultimaLeituraBemSucedidaEm: null,
        agora: AGORA,
        online: true,
      }),
    ).toBe(false);
  });

  it("leitura VELHA (passou da validade): não — a rede pode ter caído depois", () => {
    expect(
      redeVerificadaParaPurga({
        ultimaLeituraBemSucedidaEm:
          AGORA - VALIDADE_DA_LEITURA_DE_VERSAO_MS - 1,
        agora: AGORA,
        online: true,
      }),
    ).toBe(false);
    // o limite é inclusivo
    expect(
      redeVerificadaParaPurga({
        ultimaLeituraBemSucedidaEm: AGORA - VALIDADE_DA_LEITURA_DE_VERSAO_MS,
        agora: AGORA,
        online: true,
      }),
    ).toBe(true);
  });

  it("relógio que andou para trás (leitura 'no futuro'): não prova nada", () => {
    expect(
      redeVerificadaParaPurga({
        ultimaLeituraBemSucedidaEm: AGORA + 5000,
        agora: AGORA,
        online: true,
      }),
    ).toBe(false);
  });
});
