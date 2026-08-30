import { cepEhLocal } from "@/lib/cep-local";
import { describe, expect, it } from "vitest";

// Contrato espelhado de `is_local_cep` (baseline SQL) e `isLocalCep` (edge
// calculate-shipping). Se uma das três cópias mudar, as outras mudam junto —
// e estes casos são a prova de que a cópia front não divergiu.

describe("cepEhLocal — espelha is_local_cep do banco", () => {
  it("sem faixa: mesmo CEP único de cidade (5 primeiros dígitos) é local", () => {
    // Monte Carmelo/MG tem CEP único 38500-000.
    expect(cepEhLocal("38500-000", "38500-000", "")).toBe(true);
    expect(cepEhLocal("38500000", "38500-0000", undefined)).toBe(true);
  });

  it("sem faixa: cidade diferente não é local", () => {
    expect(cepEhLocal("38500-000", "01001-000", "")).toBe(false);
    expect(cepEhLocal("38500-000", "38180-000", undefined)).toBe(false);
  });

  it("origem ou destino vazio/inválido: nunca é local", () => {
    expect(cepEhLocal("", "38500-000", "")).toBe(false);
    expect(cepEhLocal("38500-000", "", "")).toBe(false);
    expect(cepEhLocal("abc", "38500-000", "")).toBe(false);
  });

  it("faixa explícita longa: destino dentro e fora", () => {
    expect(cepEhLocal("38500-000", "38503-123", "38500000-38505000")).toBe(
      true,
    );
    expect(cepEhLocal("38500-000", "38506-000", "38500000-38505000")).toBe(
      false,
    );
  });

  it("faixa invertida ainda casa (a cópia ordena)", () => {
    expect(cepEhLocal("38500-000", "38501-000", "38505000-38500000")).toBe(
      true,
    );
  });

  it("dois CEPs completos no formato do placeholder = início e fim de faixa", () => {
    expect(cepEhLocal("38500-000", "38500-500", "38500-000, 38500-999")).toBe(
      true,
    );
    expect(cepEhLocal("38500-000", "38501-000", "38500-000, 38500-999")).toBe(
      false,
    );
  });

  it("CEP único na faixa: casa exato com 8 dígitos", () => {
    expect(cepEhLocal("00000-000", "38500-000", "38500-000")).toBe(true);
    expect(cepEhLocal("00000-000", "38500-001", "38500-000")).toBe(false);
  });

  it("item curto na faixa vale como prefixo", () => {
    expect(cepEhLocal("00000-000", "38500-777", "38500")).toBe(true);
    expect(cepEhLocal("00000-000", "38501-000", "38500")).toBe(false);
  });

  it("o literal de sentinela NÃO é mais caso de teste — regra pura", () => {
    // Guarda do defeito achado no laudo caça-bugs: o horário 'Seg-Sáb:
    // 9h às 18h' chegou a ser gravado como se fosse dado real. Aqui a regra
    // de CEP é independente de texto de expediente.
    expect(cepEhLocal("38500-000", "38500-000", "   ")).toBe(true);
  });
});
