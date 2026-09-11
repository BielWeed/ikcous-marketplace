import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type IdentityUploadTarget,
  useStoreIdentityEditor,
} from "@/hooks/useStoreIdentityEditor";
import type { IdentityAsset, IdentityAssetRole } from "@/lib/storeIdentity";
import type { IdentityDraftFields } from "@/lib/storeIdentityDraft";
import { useEffect, useState } from "react";

export interface IdentitySettingsSectionProps {
  readonly active?: boolean;
  readonly onDirtyChange?: (dirty: boolean) => void;
}
const fields: readonly [keyof IdentityDraftFields, string, string][] = [
  ["storeName", "Nome da loja", "store-name"],
  ["storeCity", "Cidade", "store-city"],
  ["storeState", "Estado (UF)", "store-state"],
  ["primaryColor", "Cor principal", "store-color-hex"],
  ["secondaryColor", "Cor secundária", "store-secondary-color"],
  ["accentColor", "Cor de destaque", "store-accent-color"],
];
const previews: readonly [IdentityAssetRole, string, string][] = [
  ["header", "Cabeçalho", "PNG, JPEG, WebP ou SVG"],
  ["loader", "Abertura", "PNG, JPEG, WebP ou SVG"],
  ["icon_512", "Ícone do aplicativo", "PNG, 512 × 512"],
  ["og", "Compartilhamento", "PNG, 1200 × 630"],
];
const advanced: readonly [IdentityAssetRole, string, string][] = [
  ["favicon", "Favicon", "PNG, SVG ou ICO"],
  ["apple_touch", "Ícone Apple", "PNG, 180 × 180"],
  ["icon_192", "Ícone 192", "PNG, 192 × 192"],
  ["icon_512", "Ícone 512", "PNG, 512 × 512"],
  ["maskable_512", "Ícone com máscara", "PNG, 512 × 512"],
  ["og", "Arte de compartilhamento", "PNG, 1200 × 630"],
];
function url(origin: string, asset: IdentityAsset) {
  return `${origin}/storage/v1/object/public/branding/${asset.path}`;
}

export function IdentitySettingsSection({
  active = true,
  onDirtyChange,
}: IdentitySettingsSectionProps): React.JSX.Element {
  const editor = useStoreIdentityEditor(active);
  const [alsoOpening, setAlsoOpening] = useState(false);
  const [discardRequested, setDiscardRequested] = useState(false);
  useEffect(() => {
    onDirtyChange?.(editor.dirty);
  }, [editor.dirty, onDirtyChange]);
  const { draft } = editor;
  if (!editor.allowed)
    return (
      <p role="alert" className="text-sm text-zinc-300">
        Entre com uma sessão de administrador para editar a identidade.
      </p>
    );
  if (!editor.origin)
    return (
      <p role="alert">
        Não foi possível identificar a loja. Confira a configuração do
        aplicativo.
      </p>
    );
  if (!draft)
    return (
      <div className="space-y-3 text-sm text-zinc-300" aria-live="polite">
        <p>{editor.message ?? "Carregando identidade da loja…"}</p>
        {editor.phase === "error" && (
          <Button
            type="button"
            disabled={!active}
            onClick={() => void editor.read()}
          >
            Tentar novamente
          </Button>
        )}
      </div>
    );

  const uploadControl = (
    label: string,
    target: IdentityUploadTarget,
    hint: string,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`identity-upload-${encodeURIComponent(label)}`}>
        {label}
      </Label>
      <Input
        id={`identity-upload-${encodeURIComponent(label)}`}
        type="file"
        accept={
          target.kind === "asset" && target.roles.includes("og")
            ? "image/png"
            : "image/png,image/jpeg,image/webp,image/svg+xml,image/vnd.microsoft.icon,.ico"
        }
        disabled={
          editor.locked ||
          (target.kind === "source-add" && draft.assets.originals.length === 8)
        }
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void editor.upload(file, target);
        }}
      />
      <p className="text-xs text-zinc-400">
        {hint}. Até 20 MiB, sem alterar o arquivo original.
      </p>
    </div>
  );
  const hasConflict = editor.phase === "conflict";
  const waiting = editor.phase === "pending";
  return (
    <div className="space-y-5 text-zinc-200">
      <p className="text-sm text-zinc-400">
        Nome, localização, cores e imagens da sua loja. Confira o rascunho antes
        de salvar.
      </p>
      <fieldset
        disabled={editor.locked}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <legend className="sr-only">Dados da identidade</legend>
        {fields.map(([key, label, id]) => {
          // Keys belong exclusively to the closed field list above.
          // eslint-disable-next-line security/detect-object-injection
          const value = draft.fields[key];
          const color = key.endsWith("Color");
          return (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={id}>{label}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={id}
                  value={value}
                  maxLength={key === "storeState" ? 2 : undefined}
                  onChange={(e) =>
                    editor.setField(
                      key,
                      key === "storeState"
                        ? e.target.value.toUpperCase()
                        : e.target.value,
                    )
                  }
                />
                {color && (
                  <span
                    aria-label={`Amostra: ${label}`}
                    className="size-8 shrink-0 rounded-md border border-white/20"
                    style={{
                      backgroundColor: /^#[0-9a-f]{6}$/i.test(value)
                        ? value
                        : "transparent",
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </fieldset>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {previews.map(([role, label, hint]) => {
          // role comes from the closed preview list.
          // eslint-disable-next-line security/detect-object-injection
          const asset = draft.assets[role];
          return (
            <section
              key={role}
              aria-label={`Prévia: ${label}`}
              className="space-y-3 rounded-xl border border-white/10 bg-zinc-950/50 p-3"
            >
              <h3 className="text-sm font-semibold">{label}</h3>
              <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg bg-zinc-900 p-3">
                <img
                  src={url(editor.origin, asset)}
                  alt={`${label} — ${draft.fields.storeName}`}
                  className="h-20 max-w-full object-contain"
                />
                <span className="max-w-full break-words text-sm">
                  {draft.fields.storeName}
                </span>
              </div>
              {role === "header" && (
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={alsoOpening}
                    disabled={editor.locked}
                    onChange={(e) => setAlsoOpening(e.target.checked)}
                  />
                  Usar também na abertura
                </label>
              )}
              {uploadControl(
                `Trocar ${label.toLowerCase()}`,
                {
                  kind: "asset",
                  roles:
                    role === "header" && alsoOpening
                      ? ["header", "loader"]
                      : [role],
                },
                hint,
              )}
            </section>
          );
        })}
      </div>
      <p className="text-xs text-zinc-400">
        Estas prévias mostram as escolhas da identidade; o aplicativo instalado
        pode apresentá-las em outros tamanhos.
      </p>
      <details className="rounded-xl border border-white/10 p-3">
        <summary className="cursor-pointer text-sm font-semibold">
          Ajustes avançados de imagens
        </summary>
        <div className="mt-4 space-y-5">
          {advanced.map(([role, label, hint]) => (
            <div key={role}>
              {uploadControl(
                `Trocar ${label}`,
                { kind: "asset", roles: [role] },
                hint,
              )}
            </div>
          ))}
          <section
            aria-label="Fontes guardadas"
            className="space-y-3 border-t border-white/10 pt-4"
          >
            <h3 className="font-semibold">
              Fontes guardadas ({draft.assets.originals.length}/8)
            </h3>
            <p className="text-xs text-zinc-400">
              Retirar uma referência mantém o arquivo guardado, mas ele sai
              desta lista. Mantenha ao menos uma fonte.
            </p>
            {draft.assets.originals.map((asset, index) => (
              <div
                key={`${asset.path}-${index}`}
                className="space-y-2 rounded-lg border border-white/10 p-3"
              >
                <a
                  href={url(editor.origin, asset)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 text-sm underline"
                >
                  <img
                    src={url(editor.origin, asset)}
                    alt=""
                    className="size-12 object-contain"
                  />
                  Abrir fonte {index + 1}
                </a>
                {uploadControl(
                  `Substituir fonte ${index + 1}`,
                  { kind: "source-replace", index },
                  "PNG, JPEG, WebP, SVG ou ICO",
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    editor.locked || draft.assets.originals.length === 1
                  }
                  onClick={() => editor.removeSource(index)}
                >
                  Retirar referência {index + 1}
                </Button>
              </div>
            ))}
            {draft.assets.originals.length === 8 && (
              <p className="text-sm text-amber-300">
                Limite de oito fontes. Substitua ou retire uma referência para
                guardar outra.
              </p>
            )}
            {uploadControl(
              "Adicionar fonte",
              { kind: "source-add" },
              "PNG, JPEG, WebP, SVG ou ICO",
            )}
            <p className="text-xs text-zinc-400">
              Guardar também como fonte, usando uma imagem já conferida:
            </p>
            <div className="flex flex-wrap gap-2">
              {previews.map(([role, label]) => {
                // role is selected only from our closed preview list.
                // eslint-disable-next-line security/detect-object-injection
                const asset = draft.assets[role];
                return (
                  <Button
                    key={role}
                    type="button"
                    variant="outline"
                    disabled={
                      editor.locked ||
                      draft.assets.originals.length === 8 ||
                      draft.assets.originals.some(
                        (source) => source.path === asset.path,
                      )
                    }
                    onClick={() =>
                      editor.keepSource({
                        asset,
                        url: url(editor.origin, asset),
                      })
                    }
                  >
                    Guardar {label.toLowerCase()} como fonte
                  </Button>
                );
              })}
            </div>
          </section>
        </div>
      </details>
      {["preparing", "uploading", "verifying"].includes(editor.phase) && (
        <div role="status" className="space-y-2 text-sm">
          <p>
            {editor.phase === "preparing"
              ? "Preparando imagem"
              : editor.phase === "verifying"
                ? "Conferindo imagem"
                : "Enviando imagem"}
          </p>
          {editor.phase === "uploading" && editor.progress && (
            <p>
              {editor.progress.uploadedBytes.toLocaleString("pt-BR")} de{" "}
              {editor.progress.totalBytes.toLocaleString("pt-BR")} bytes
              confirmados
            </p>
          )}
          <Button type="button" variant="outline" onClick={editor.cancelUpload}>
            Cancelar envio
          </Button>
        </div>
      )}
      {editor.message && (
        <p role="status" aria-live="polite" className="text-sm leading-relaxed">
          {editor.message}
        </p>
      )}
      {(waiting || hasConflict) && (
        <div className="space-y-3 rounded-xl border border-amber-400/30 p-3">
          <Button
            type="button"
            disabled={!active || editor.busy}
            onClick={() => void editor.read()}
          >
            {waiting ? "Conferir novamente" : "Conferir configuração atual"}
          </Button>
          {hasConflict && editor.current && (
            <>
              <p className="text-sm">Sua escolha / configuração atual:</p>
              <ul className="space-y-1 text-sm">
                {fields.map(([key, label]) => {
                  const rawKey = new Map<keyof IdentityDraftFields, string>([
                    ["storeName", "store_name"],
                    ["storeCity", "store_city"],
                    ["storeState", "store_state"],
                    ["primaryColor", "primary_color"],
                    ["secondaryColor", "secondary_color"],
                    ["accentColor", "accent_color"],
                  ]).get(key)!;
                  const current = Object.entries(editor.current!.identity).find(
                    ([name]) => name === rawKey,
                  )?.[1];
                  // key comes exclusively from the closed local field list.
                  // eslint-disable-next-line security/detect-object-injection
                  const mine = draft.fields[key];
                  return mine !== (current ?? "") ? (
                    <li key={key}>
                      {label}: {mine || "Não informado"} /{" "}
                      {typeof current === "string" && current
                        ? current
                        : "Não informado"}
                    </li>
                  ) : null;
                })}
                {JSON.stringify(draft.assets) !==
                  JSON.stringify(editor.current.identity.branding_assets) && (
                  <li>
                    Imagens: há escolhas diferentes na configuração atual.
                  </li>
                )}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={!active}
                  onClick={() => editor.resolveConflict(true)}
                >
                  Revisar meu rascunho
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!active}
                  onClick={() => editor.resolveConflict(false)}
                >
                  Usar configuração atual
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={editor.locked || !editor.dirty}
          onClick={() => void editor.save()}
        >
          {editor.phase === "saving"
            ? "Salvando identidade…"
            : "Salvar identidade"}
        </Button>
        {editor.phase === "editing" && (
          <Button
            type="button"
            variant="outline"
            disabled={editor.locked || !editor.dirty}
            onClick={() => setDiscardRequested(true)}
          >
            Descartar alterações
          </Button>
        )}
      </div>
      {discardRequested && editor.phase === "editing" && (
        <div
          role="group"
          aria-label="Descartar rascunho de identidade"
          className="space-y-3 rounded-xl border border-amber-400/30 p-3"
        >
          <p>
            Descartar as alterações deste rascunho? Os arquivos enviados
            permanecem guardados.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={editor.locked}
              onClick={() => {
                editor.discard();
                setDiscardRequested(false);
              }}
            >
              Sim, descartar rascunho
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDiscardRequested(false)}
            >
              Continuar editando
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
