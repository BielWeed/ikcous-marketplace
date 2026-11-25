// A validade do recado "código lido no balcão -> cadastro de produto novo"
// (`src/lib/codigo-para-cadastro.ts`). O teste do módulo mede a validade usando
// a PRÓPRIA constante, então um valor de 1 minuto ou de 10 passaria. O que a
// lojista sente: o toque que a trava de "alterações não salvas" segurou não pode
// reaparecer horas depois, e dois minutos é a folga combinada para o cadastro
// abrir. Aqui o número fica preso em milissegundos.
import {
  VALIDADE_DO_CODIGO_PARA_CADASTRO_MS,
  guardarCodigoParaCadastro,
  tomarCodigoParaCadastro,
} from "@/lib/codigo-para-cadastro";
import { beforeEach, describe, expect, it } from "vitest";

const CODIGO = "7891234567890";
const INICIO = 5_000_000;

describe("validade do código para o cadastro", () => {
  beforeEach(() => {
    tomarCodigoParaCadastro();
  });

  it("a validade é de dois minutos (120 000 ms)", () => {
    expect(VALIDADE_DO_CODIGO_PARA_CADASTRO_MS).toBe(120_000);
  });

  it.each([
    ["1 ms depois", 1, CODIGO],
    ["59 s depois", 59_000, CODIGO],
    ["1 min 1 s depois (ainda vale)", 61_000, CODIGO],
    ["1 min 59 s depois", 119_000, CODIGO],
    ["exatamente 2 min depois", 120_000, CODIGO],
    ["2 min e 1 ms depois (venceu)", 120_001, null],
    ["3 min depois (venceu)", 180_000, null],
    ["1 hora depois (venceu)", 3_600_000, null],
  ])("%s", (_nome, passou, esperado) => {
    guardarCodigoParaCadastro(CODIGO, INICIO);
    expect(tomarCodigoParaCadastro(INICIO + passou)).toBe(esperado);
  });

  it("o relógio que anda para trás (aparelho acertou a hora) não vence o recado", () => {
    guardarCodigoParaCadastro(CODIGO, INICIO);
    expect(tomarCodigoParaCadastro(INICIO - 60_000)).toBe(CODIGO);
  });

  it("a contagem parte do momento em que o recado foi GUARDADO, não do primeiro 'tomar'", () => {
    guardarCodigoParaCadastro(CODIGO, INICIO);
    guardarCodigoParaCadastro(CODIGO, INICIO + 100_000);
    // 130 s depois do primeiro, 30 s depois do segundo: vale.
    expect(tomarCodigoParaCadastro(INICIO + 130_000)).toBe(CODIGO);
  });
});
