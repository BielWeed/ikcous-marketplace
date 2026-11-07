// @vitest-environment jsdom
import { LocalErrorBoundary } from "@/components/ui/custom/LocalErrorBoundary";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each([false, true])(
  "detalhes técnicos disponíveis apenas em DEV=%s",
  (dev) => {
    vi.stubEnv("DEV", dev);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const host = document.createElement("div");
    document.body.appendChild(host);
    const raiz = createRoot(host);
    function Quebra(): never {
      throw new Error("falha técnica privada");
    }
    try {
      act(() =>
        raiz.render(
          <LocalErrorBoundary>
            <Quebra />
          </LocalErrorBoundary>,
        ),
      );
      expect(host.textContent).toContain("Esta parte não abriu");
      const detalhes = [...host.querySelectorAll("button")].find(
        (b) => b.textContent === "Ver detalhes",
      );
      expect(Boolean(detalhes)).toBe(dev);
      if (detalhes) {
        act(() => detalhes.click());
        expect(host.querySelector("pre")?.textContent).toContain(
          "falha técnica privada",
        );
      } else {
        expect(host.textContent).not.toContain("falha técnica privada");
        expect(host.querySelector("pre")).toBeNull();
      }
    } finally {
      act(() => raiz.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  },
);
