// @vitest-environment jsdom
import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("LocalBufferedInput — roda não altera número", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  for (const useShadcn of [false, true]) {
    it(`tira o foco numérico, preserva texto digitado e repassa wheel (shadcn: ${useShadcn})`, () => {
      const onFlush = vi.fn();
      const onWheel = vi.fn();
      act(() =>
        raiz.render(
          <LocalBufferedInput
            type="number"
            value="24"
            onFlush={onFlush}
            onWheel={onWheel}
            useShadcn={useShadcn}
          />,
        ),
      );
      const campo = hospedeiro.querySelector("input") as HTMLInputElement;
      act(() => campo.focus());
      act(() => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(campo, "25");
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      });
      act(() =>
        campo.dispatchEvent(
          new WheelEvent("wheel", { bubbles: true, deltaY: 100 }),
        ),
      );
      expect(document.activeElement).not.toBe(campo);
      expect(campo.value).toBe("25");
      expect(onFlush.mock.calls).toEqual([["25"]]);
      expect(onWheel).toHaveBeenCalledTimes(1);
    });

    it(`campo de texto mantém foco e evento do chamador (shadcn: ${useShadcn})`, () => {
      const onFlush = vi.fn();
      const onWheel = vi.fn();
      act(() =>
        raiz.render(
          <LocalBufferedInput
            type="text"
            value="24"
            onFlush={onFlush}
            onWheel={onWheel}
            useShadcn={useShadcn}
          />,
        ),
      );
      const campo = hospedeiro.querySelector("input") as HTMLInputElement;
      act(() => campo.focus());
      act(() =>
        campo.dispatchEvent(new WheelEvent("wheel", { bubbles: true })),
      );
      expect(document.activeElement).toBe(campo);
      expect(onFlush).not.toHaveBeenCalled();
      expect(onWheel).toHaveBeenCalledTimes(1);
    });
  }
});
