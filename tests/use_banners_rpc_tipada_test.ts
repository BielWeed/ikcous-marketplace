import { assert } from "https://deno.land/std@0.177.0/testing/asserts.ts";

Deno.test("useBanners reordena com RPC tipada sem cast para any", () => {
  const hook = Deno.readTextFileSync(
    new URL("../src/hooks/useBanners.ts", import.meta.url),
  );

  assert(!hook.includes("rpc as any"), "RPC voltou a ignorar os tipos");
  assert(
    hook.includes('supabase.rpc("reorder_banners_atomic"'),
    "chamada tipada de reordenacao ausente",
  );
});
