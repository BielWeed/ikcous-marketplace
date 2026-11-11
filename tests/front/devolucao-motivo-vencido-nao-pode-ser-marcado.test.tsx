// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { ElegibilidadeDevolucao } from "@/types/devolucao";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const elegibilidade: ElegibilidadeDevolucao = {
  pode: true,
  motivo_bloqueio: null,
  entregue_em: "2026-09-24T15:00:00Z",
  dias_desde_entrega: 40,
  modalidade: "nacional",
  metodos: ["etiqueta_reversa", "envio_proprio"],
  prazos: {
    arrependimento_ate: "2026-10-01",
    troca_ate: "2026-10-24",
    vicio_ate: "2026-12-23",
  },
  janelas: { arrependimento: false, troca: false, vicio: true },
  itens: [
    {
      order_item_id: "oi-1",
      product_id: "p-1",
      product_name: "Tênis",
      image_url: null,
      quantidade: 1,
      ja_devolvida: 0,
      disponivel: 1,
      valor_unitario: 100,
    },
  ],
  politica: {
    prazo_arrependimento_dias: 7,
    prazo_troca_dias: 30,
    prazo_vicio_dias: 90,
    aceita_troca: true,
    aceita_vale: true,
    exige_fotos_vicio: true,
    metodos_locais: ["entrega_na_loja", "coleta"],
    metodos_nacionais: ["etiqueta_reversa", "envio_proprio"],
    reembolso_momento: "ao_receber",
    frete_troca_pago_por: "cliente",
    categorias_sem_troca: [],
    texto_politica: null,
    endereco_devolucao: null,
    updated_at: null,
  },
};
let raiz: Root;
let hospedeiro: HTMLDivElement;
const radio = (valor: string) =>
  document.querySelector<HTMLInputElement>(
    `[data-testid="passo-motivo"] input[value="${valor}"]`,
  );
const botao = (texto: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) =>
      b.textContent?.trim() === texto || b.getAttribute("aria-label") === texto,
  );
async function clicar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el!.click();
  });
}
beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

it("motivo com prazo vencido fica desabilitado e o clique não troca o motivo válido", async () => {
  const { SolicitarDevolucaoSheet } = await import(
    "@/components/devolucao/SolicitarDevolucaoSheet"
  );
  await act(async () => {
    raiz.render(
      <SolicitarDevolucaoSheet
        aberto
        onAbertoMudou={vi.fn()}
        elegibilidade={elegibilidade}
        userId="u-1"
        enderecoDaLoja="Rua de teste, 10"
        horarioDaLoja={null}
        solicitar={vi.fn()}
        enviarFoto={vi.fn()}
      />,
    );
  });
  await clicar(botao("Aumentar Tênis"));
  await clicar(botao("Continuar"));
  const vencido = radio("tamanho_pequeno");
  const disponivel = radio("avariado_no_transporte");
  expect(vencido).not.toBeNull();
  expect(disponivel).not.toBeNull();

  // Controle positivo: problema no produto ainda está dentro dos 90 dias.
  expect(disponivel!.disabled).toBe(false);
  await clicar(disponivel);
  expect(disponivel!.checked).toBe(true);

  // Exercita o clique mesmo no caso proibido, além do atributo disabled.
  await clicar(vencido);
  expect(vencido!.checked).toBe(false);
  expect(disponivel!.checked).toBe(true);
  expect(vencido!.disabled).toBe(true);
});
