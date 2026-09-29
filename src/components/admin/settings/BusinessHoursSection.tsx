import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/hooks/useAuth";
import { lerSupabaseUrl } from "@/lib/env-valores";
import { cn } from "@/lib/utils";
import { memo, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// Editor do horário de atendimento (store_config.business_hours), EXTRAÍDO
// de AdminSettingsView em 20/09/2026: a tela "Sobre a Loja"
// (AdminAboutStoreView) edita o mesmo campo com o MESMO componente — o campo
// é um só no banco; não nasceram duas lógicas de salvamento. Corte e cola
// literal do que vivia lá (BusinessHoursEditor memo + wrapper
// BusinessHoursSection com guarda de admin), contrato inalterado:
// { onDirtyChange, active } e save próprio silencioso com toast.
const BusinessHoursEditor = memo(function BusinessHoursEditor({
  onDirtyChange,
  active = true,
}: { onDirtyChange: (dirty: boolean) => void; active?: boolean }) {
  const { config, updateConfig } = useStore();
  const saved = config.businessHours ?? "";
  const [baseline, setBaseline] = useState(saved);
  const [value, setValue] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const lifecycle = useRef({ mounted: true, active, serial: 0 });
  if (lifecycle.current.active && !active) lifecycle.current.serial++;
  lifecycle.current.active = active;
  useEffect(() => {
    // Sair da aba invalida o pedido, mas preserva o texto para uma nova tentativa.
    if (!active) setSaving(false);
  }, [active]);
  const lastIncoming = useRef(saved);
  const dirty = value !== baseline;
  // Incoming data only refreshes a pristine editor. A shipping refresh cannot erase typing.
  useEffect(() => {
    if (saved === lastIncoming.current) return;
    lastIncoming.current = saved;
    if (!dirty && !saving) {
      setBaseline(saved);
      setValue(saved);
    }
  }, [saved, dirty, saving]);
  useEffect(() => {
    onDirtyChange(dirty || saving);
  }, [dirty, saving, onDirtyChange]);
  useEffect(() => {
    const life = lifecycle.current;
    life.mounted = true;
    return () => {
      life.mounted = false;
      life.serial++;
    };
  }, []);
  async function save() {
    if (saving || !active) return;
    const life = lifecycle.current;
    const serial = ++life.serial;
    const isCurrent = () =>
      life.mounted && life.active && life.serial === serial;
    const chosen = value.trim();
    setSaving(true);
    setError(false);
    try {
      const success = await updateConfig(
        { businessHours: chosen || null },
        { isCurrent, silent: true },
      );
      if (!isCurrent()) return;
      if (success) {
        setBaseline(chosen);
        setValue(chosen);
        toast.success("Horário de atendimento salvo");
      } else setError(true);
    } catch {
      if (isCurrent()) setError(true);
    } finally {
      if (isCurrent()) setSaving(false);
    }
  }
  return (
    <div className={cn("space-y-3 text-sm text-zinc-300")}>
      <p>
        Informe quando a loja atende. Em branco, o aplicativo omite o horário.
      </p>
      <label htmlFor="store-business-hours">Horário de atendimento</label>
      <input
        id="store-business-hours"
        value={value}
        disabled={saving || !active}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Ex: Ter a Sáb, 9h às 18h"
        className="h-10 w-full rounded-xl border border-white/10 bg-black/50 px-3.5 text-sm text-white"
      />
      {error && (
        <p role="alert">
          Não foi possível salvar o horário. O texto foi preservado.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={saving || !active || !dirty}
          onClick={() => void save()}
          className="rounded-lg border border-white/10 px-3 py-2"
        >
          {saving ? "Salvando…" : "Salvar horário"}
        </button>
        <button
          type="button"
          disabled={saving || !active || !dirty}
          onClick={() => {
            setBaseline(saved);
            setValue(saved);
            setError(false);
          }}
          className="rounded-lg border border-white/10 px-3 py-2"
        >
          Descartar horário
        </button>
      </div>
    </div>
  );
});

export function BusinessHoursSection({
  onDirtyChange,
  active,
}: {
  onDirtyChange: (dirty: boolean) => void;
  active?: boolean;
}) {
  const { user, session, isAdmin, adminStatus } = useAuth();
  const allowed =
    isAdmin &&
    adminStatus === "admin" &&
    !!user &&
    session?.user.id === user.id;
  useEffect(() => {
    if (!allowed) onDirtyChange(false);
  }, [allowed, onDirtyChange]);
  if (!allowed)
    return <p role="alert">Entre como administrador para editar o horário.</p>;
  return (
    <BusinessHoursEditor
      key={`${lerSupabaseUrl()}|${user.id}`}
      onDirtyChange={onDirtyChange}
      active={active}
    />
  );
}
