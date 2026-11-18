// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import { PreviaImagemPropria } from "@/components/admin/banners/PreviaImagemPropria";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("descreve a prévia do banner em português", () => {
  const hospedeiro = document.createElement("div");
  const raiz = createRoot(hospedeiro);
  try {
    act(() => {
      raiz.render(
        <PreviaImagemPropria
          formData={{ imageUrl: "https://example.com/banner.webp" }}
          comTexto={false}
        />,
      );
    });
    expect(hospedeiro.querySelector('img[alt="Banner Preview"]')).toBeNull();
    expect(hospedeiro.querySelector("img")?.getAttribute("alt")).toBe(
      "Prévia do banner",
    );
  } finally {
    act(() => raiz.unmount());
  }
});
