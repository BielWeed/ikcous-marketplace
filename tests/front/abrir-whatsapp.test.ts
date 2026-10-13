// @vitest-environment jsdom
//
// Achado A8-d/L12 — `window.open(url, "_blank")` sem `noopener` deixa a aba
// do WhatsApp com `window.opener` apontando para o app. UM helper abre o
// WhatsApp sempre isolado, e os 8 pontos da loja/painel passam por ele.
import { abrirWhatsapp } from "@/lib/abrir-whatsapp";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("abrirWhatsapp — aba nova isolada do app", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("abre o link em nova aba com noopener e noreferrer", () => {
    const abrir = vi.spyOn(globalThis, "open").mockReturnValue(null);

    abrirWhatsapp("https://wa.me/5534999999999?text=oi");

    expect(abrir).toHaveBeenCalledTimes(1);
    expect(abrir).toHaveBeenCalledWith(
      "https://wa.me/5534999999999?text=oi",
      "_blank",
      "noopener,noreferrer",
    );
  });
});
