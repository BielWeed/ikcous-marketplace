// @vitest-environment jsdom
import { TransportadorasSection } from "@/components/admin/settings/TransportadorasCard";
import { HistoricoCotacoesSection } from "@/components/admin/settings/HistoricoCotacoesCard";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({ invoke: vi.fn(), logs: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: s.invoke },
    from: () => ({
      select: () => ({ order: () => ({ limit: s.logs }) }),
    }),
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const resposta = {
  data: {
    success: true,
    modo: "multi",
    ligados: ["melhor_envio"],
    provedores: {
      melhor_envio: { tem_chave: true, sandbox: false, servicos: null },
      superfrete: { tem_chave: false, sandbox: false, servicos: null },
      frenet: { tem_chave: false, sandbox: false, servicos: null },
    },
  },
  error: null,
};
let root: Root;
let host: HTMLDivElement;
const botao = (texto: RegExp) =>
  [...document.querySelectorAll("button")].find((b) =>
    texto.test(b.textContent ?? ""),
  );
const semResposta = () => new Promise(() => {});
const avancar = (ms: number) =>
  act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  s.invoke.mockResolvedValue(resposta);
  s.logs.mockResolvedValue({ data: [], error: null });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it("configuração sem resposta sai do esqueleto aos 20 s e permite tentar de novo", async () => {
  s.invoke.mockImplementationOnce(semResposta);
  await act(async () => root.render(<TransportadorasSection />));
  await avancar(19_999);
  expect(botao(/Tentar de novo/i)).toBeUndefined();
  await avancar(1);
  expect(host.textContent).toMatch(/Não deu para confirmar as transportadoras/i);
  expect(botao(/Tentar de novo/i)?.disabled).toBe(false);
  await act(async () => botao(/Tentar de novo/i)?.click());
  expect(host.textContent).not.toMatch(/Não deu para confirmar as transportadoras/i);
  expect(s.invoke).toHaveBeenCalledTimes(2);
});

it("serviços sem resposta soltam o botão aos 20 s e mostram a falha", async () => {
  await act(async () => root.render(<TransportadorasSection />));
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Melhor Envio"]')!.click(),
  );
  s.invoke.mockImplementationOnce(semResposta);
  await act(async () => botao(/Ver serviços da conta/)!.click());
  expect(botao(/Ver serviços da conta/)?.disabled).toBe(true);
  await avancar(19_999);
  expect(botao(/Ver serviços da conta/)?.disabled).toBe(true);
  await avancar(1);
  expect(botao(/Ver serviços da conta/)?.disabled).toBe(false);
  expect(document.body.textContent).toMatch(/Não foi possível carregar os serviços agora/);
});

it("histórico sem resposta sai dos esqueletos aos 20 s e Atualizar permite recuperar", async () => {
  s.logs.mockImplementationOnce(semResposta);
  await act(async () => root.render(<HistoricoCotacoesSection />));
  expect(botao(/^Atualizar$/)?.disabled).toBe(true);
  await avancar(19_999);
  expect(botao(/^Atualizar$/)?.disabled).toBe(true);
  await avancar(1);
  expect(botao(/^Atualizar$/)?.disabled).toBe(false);
  expect(host.textContent).toMatch(/Não foi possível carregar o histórico de cotações/);
  await act(async () => botao(/^Atualizar$/)?.click());
  expect(host.textContent).toMatch(/Nenhuma cotação registrada recentemente/);
  expect(s.logs).toHaveBeenCalledTimes(2);
});
