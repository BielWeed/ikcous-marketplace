// REGISTRO DE OPERAÇÕES SENSÍVEIS — upload, fila offline, gravação de venda.
// Enquanto houver QUALQUER marca, o momento seguro devolve "ocupado".
import { describe, expect, it, vi } from "vitest";

import { decidirMomentoSeguro } from "@/lib/atualizacao/momento-seguro";
import {
  assinarOperacoesSensiveis,
  haOperacaoSensivel,
  marcarOperacaoSensivel,
  motivosDeOperacaoSensivel,
} from "@/lib/atualizacao/operacao-sensivel";

const SEGURO = {
  view: "home",
  adminDirty: false,
  pedidoPendenteDoCheckout: false,
  documentoOculto: true,
  trocouDeTela: true,
} as const;

describe("registro de operações sensíveis", () => {
  it("sem marca, não há operação sensível", () => {
    expect(haOperacaoSensivel()).toBe(false);
    expect(motivosDeOperacaoSensivel()).toEqual([]);
  });

  it("marcar liga; a função devolvida desliga", () => {
    const desmarcar = marcarOperacaoSensivel("upload-de-imagem");
    expect(haOperacaoSensivel()).toBe(true);
    expect(motivosDeOperacaoSensivel()).toEqual(["upload-de-imagem"]);
    desmarcar();
    expect(haOperacaoSensivel()).toBe(false);
  });

  it("contador POR motivo: dois uploads só liberam quando os DOIS terminam", () => {
    const a = marcarOperacaoSensivel("upload");
    const b = marcarOperacaoSensivel("upload");
    a();
    expect(haOperacaoSensivel()).toBe(true);
    b();
    expect(haOperacaoSensivel()).toBe(false);
  });

  it("motivos diferentes são independentes", () => {
    const upload = marcarOperacaoSensivel("upload");
    const fila = marcarOperacaoSensivel("fila-offline");
    upload();
    expect(haOperacaoSensivel()).toBe(true);
    expect(motivosDeOperacaoSensivel()).toEqual(["fila-offline"]);
    fila();
    expect(haOperacaoSensivel()).toBe(false);
  });

  it("desmarcar DUAS vezes não desconta a operação de outro (à prova de duplo finally)", () => {
    const primeira = marcarOperacaoSensivel("pdv");
    const segunda = marcarOperacaoSensivel("pdv");
    primeira();
    primeira();
    primeira();
    expect(haOperacaoSensivel()).toBe(true); // a segunda ainda vive
    segunda();
    expect(haOperacaoSensivel()).toBe(false);
  });

  it("motivo vazio ainda conta (não vira marca invisível)", () => {
    const desmarcar = marcarOperacaoSensivel("");
    expect(haOperacaoSensivel()).toBe(true);
    desmarcar();
    expect(haOperacaoSensivel()).toBe(false);
  });

  it("avisa os assinantes ao marcar e ao desmarcar; cancelar a assinatura funciona; ouvinte que lança não derruba", () => {
    const ouvinte = vi.fn();
    const quebrado = vi.fn(() => {
      throw new Error("defeito do ouvinte");
    });
    const cancelar = assinarOperacoesSensiveis(ouvinte);
    const cancelarQuebrado = assinarOperacoesSensiveis(quebrado);
    const desmarcar = marcarOperacaoSensivel("x");
    desmarcar();
    expect(ouvinte).toHaveBeenCalledTimes(2);
    cancelar();
    cancelarQuebrado();
    const d2 = marcarOperacaoSensivel("y");
    d2();
    expect(ouvinte).toHaveBeenCalledTimes(2);
  });

  describe("o momento seguro consulta o registro", () => {
    it("com operação sensível em andamento, bloqueia mesmo em ponto de parada numa tela segura", () => {
      expect(decidirMomentoSeguro(SEGURO).instalarAgora).toBe(true); // controle
      const desmarcar = marcarOperacaoSensivel("upload-de-imagem");
      const d = decidirMomentoSeguro(SEGURO);
      expect(d.instalarAgora).toBe(false);
      expect(d.livre).toBe(false);
      expect(d.bloqueio).toBe("operacao-sensivel");
      desmarcar();
      expect(decidirMomentoSeguro(SEGURO).instalarAgora).toBe(true);
    });

    it("o fato explícito do chamador vence a leitura do registro", () => {
      const desmarcar = marcarOperacaoSensivel("upload");
      expect(
        decidirMomentoSeguro({ ...SEGURO, operacaoSensivel: false }).livre,
      ).toBe(true);
      desmarcar();
      expect(
        decidirMomentoSeguro({ ...SEGURO, operacaoSensivel: true }).livre,
      ).toBe(false);
    });
  });
});
