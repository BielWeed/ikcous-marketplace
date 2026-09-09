import { createRoot } from "react-dom/client";
import { IdentitySettingsSection } from "@/components/admin/settings/IdentitySettingsSection";
import { recordDirty, setFixtureContext, useFixtureContext } from "./contexts";

// This panel changes only the two replaced contexts; it cannot invoke editor actions.
function Bench() {
  const fixture = useFixtureContext();
  return <div data-bench-scroll className="admin-scroll-container active-scroll-container absolute left-0 top-0 size-full overflow-y-auto overflow-x-hidden">
    <main className="mx-auto max-w-4xl space-y-6 bg-zinc-950 p-4 text-zinc-200">
    <aside aria-label="Bancada sintética" className="rounded-xl border border-white/10 p-3 text-sm">
      <p>Ensaio local — imagens e usuário fictícios</p>
      <p data-fixture-state data-dirty={String(fixture.dirty)} data-refreshes={fixture.refreshes}
        data-active={String(fixture.active)} data-user={fixture.user.id}>
        Rascunho: {fixture.dirty ? "alterado" : "sem alterações"} · Atualizações: {fixture.refreshes}
      </p>
    </aside>
    <IdentitySettingsSection active={fixture.active} onDirtyChange={recordDirty} />
  </main></div>;
}
Object.assign(window, { identityFixtureContext: setFixtureContext });
createRoot(document.getElementById("root")!).render(<Bench />);
