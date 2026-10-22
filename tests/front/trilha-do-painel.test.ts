import type { View } from "@/types";
import {
  TAMANHO_MAXIMO_DA_TRILHA,
  avancarTrilha,
  origemDaTrilha,
} from "@/utils/trilha-do-painel";
import { describe, expect, it } from "vitest";

/**
 * src/utils/trilha-do-painel.ts — a memória de "de onde a pessoa veio" do
 * `AdminLayout`. Tela nova entra na trilha; voltar para a tela anterior
 * (pelo botão ou pelo Voltar do celular) DESFAZ a última entrada em vez de
 * gravar mais uma — é isso que impede o laço Avisar clientes <-> Notificações.
 */
describe("avancarTrilha / origemDaTrilha", () => {
  it("trilha vazia de origem: uma tela só não tem de onde ter vindo", () => {
    expect(origemDaTrilha(["admin-push"])).toBeNull();
    expect(origemDaTrilha([])).toBeNull();
  });

  it("ir para uma tela nova a empilha, e a origem é a anterior", () => {
    const t = avancarTrilha(["admin-customers"], "admin-push");
    expect(t).toEqual(["admin-customers", "admin-push"]);
    expect(origemDaTrilha(t)).toBe("admin-customers");
  });

  it("repetir a tela atual não muda nada (mesma referência: sem render extra)", () => {
    const antes = ["admin-customers", "admin-push"] as const;
    expect(avancarTrilha(antes, "admin-push")).toBe(antes);
  });

  it("voltar para a tela anterior desfaz a entrada, em vez de empilhar", () => {
    const t = avancarTrilha(
      ["admin-customers", "admin-push", "admin-notifications"],
      "admin-push",
    );
    expect(t).toEqual(["admin-customers", "admin-push"]);
    // O ponto do conserto: a origem de Avisar clientes continua sendo Clientes,
    // não Notificações.
    expect(origemDaTrilha(t)).toBe("admin-customers");
  });

  it("o par nunca se alterna: ir e voltar muitas vezes não faz a trilha crescer", () => {
    let t: readonly View[] = ["admin-customers", "admin-push"];
    for (let i = 0; i < 10; i++) {
      t = avancarTrilha(t, "admin-notifications");
      expect(origemDaTrilha(t)).toBe("admin-push");
      t = avancarTrilha(t, "admin-push");
      expect(origemDaTrilha(t)).toBe("admin-customers");
    }
    expect(t).toEqual(["admin-customers", "admin-push"]);
  });

  it("cada Voltar encolhe a trilha: seguir a origem sempre termina", () => {
    let t: readonly View[] = [
      "admin-dashboard",
      "admin-whatsapp-config",
      "admin-notifications",
    ];
    const caminho: View[] = [];
    while (origemDaTrilha(t) !== null) {
      const destino = origemDaTrilha(t) as View;
      caminho.push(destino);
      t = avancarTrilha(t, destino);
    }
    expect(caminho).toEqual(["admin-whatsapp-config", "admin-dashboard"]);
  });

  it("tela sem relação com a anterior é avanço normal (origem = a tela de antes)", () => {
    const t = avancarTrilha(["admin-customers", "admin-push"], "admin-orders");
    expect(t).toEqual(["admin-customers", "admin-push", "admin-orders"]);
    expect(origemDaTrilha(t)).toBe("admin-push");
  });

  it("a trilha tem teto: uma sessão longa não faz a memória crescer sem fim", () => {
    let t: readonly View[] = ["admin-dashboard"];
    const telas: View[] = ["admin-orders", "admin-products", "admin-settings"];
    for (let i = 0; i < TAMANHO_MAXIMO_DA_TRILHA * 4; i++) {
      t = avancarTrilha(t, telas[i % 3]);
    }
    expect(t.length).toBeLessThanOrEqual(TAMANHO_MAXIMO_DA_TRILHA);
    expect(origemDaTrilha(t)).not.toBeNull();
  });
});
