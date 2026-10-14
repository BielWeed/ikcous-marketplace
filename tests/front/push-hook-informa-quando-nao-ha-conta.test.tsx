// @vitest-environment jsdom
//
// O banner de push só pode esconder o convite de quem não entrou na conta se
// o hook disser isso. `semConta` é a MESMA decisão que faz o subscribe()
// recusar com a origem "sem_conta" (`!user`) — um lugar só, sem o banner
// refazer a conta por conta própria.
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estadoAuth: { user: { id: string } | null } = { user: null };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: estadoAuth.user }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ upsert: vi.fn() }) },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { usePushNotifications } from "@/hooks/usePushNotifications";

describe("usePushNotifications — semConta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let ultimo: { semConta: boolean } | undefined;

  function Sonda() {
    const estado = usePushNotifications() as { semConta: boolean };
    useEffect(() => {
      ultimo = estado;
    });
    return null;
  }

  beforeEach(() => {
    ultimo = undefined;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("visitante (sem usuário): semConta é true", () => {
    estadoAuth.user = null;
    act(() => {
      raiz.render(createElement(Sonda));
    });
    expect(ultimo?.semConta).toBe(true);
  });

  it("controle: com usuário entrado, semConta é false", () => {
    estadoAuth.user = { id: "cliente-1" };
    act(() => {
      raiz.render(createElement(Sonda));
    });
    expect(ultimo?.semConta).toBe(false);
  });
});
