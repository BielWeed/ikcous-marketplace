import { beforeEach, vi } from "vitest";
import { buildIdentityFixture } from "./fixtures/build-identity";

function instalarFixture() {
  vi.stubGlobal("__STORE_IDENTITY__", buildIdentityFixture);
}

// Antes dos imports estáticos e novamente após testes que limpam os globals.
instalarFixture();
beforeEach(instalarFixture);
