import { validaCorDaLoja } from "@/config/cor-da-loja";
import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/hooks/useAuth";
import {
  type IdentityAdminOptions,
  type StoreIdentityIntent,
  readAdminStoreIdentity,
  saveAdminStoreIdentity,
} from "@/lib/adminStoreIdentity";
import { lerChaveSupabase, lerSupabaseUrl } from "@/lib/env-valores";
import type { VerifiedPublicIdentityAsset } from "@/lib/publicStoreIdentity";
import {
  type IdentityAssetRole,
  normalizeSupabaseOrigin,
} from "@/lib/storeIdentity";
import {
  type IdentityDraftChange,
  type IdentityDraftFields,
  type IdentityEditorDraft,
  buildIdentityEditorIntent,
  changeIdentityEditorDraft,
  createIdentityEditorDraft,
  identityEditorDraftIsDirty,
  reconcileIdentityEditorDraft,
} from "@/lib/storeIdentityDraft";
import {
  type StoreIdentitySnapshot,
  sameRawStoreIdentity,
} from "@/lib/storeIdentitySnapshot";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Phase =
  | "idle"
  | "loading"
  | "error"
  | "incomplete"
  | "editing"
  | "preparing"
  | "uploading"
  | "verifying"
  | "saving"
  | "checking"
  | "pending"
  | "conflict";
interface EditorState {
  scope: string;
  phase: Phase;
  draft?: IdentityEditorDraft;
  intent?: StoreIdentityIntent;
  current?: StoreIdentitySnapshot;
  message?: string;
  progress?: { uploadedBytes: number; totalBytes: number };
}
export type IdentityUploadTarget =
  | { kind: "asset"; roles: readonly IdentityAssetRole[] }
  | { kind: "source-add" }
  | { kind: "source-replace"; index: number };
const pendingMessage =
  "A confirmação está pendente. A gravação pode ter ocorrido. Confira novamente antes de salvar.";
const conflictMessage =
  "Outra configuração foi encontrada. Seu rascunho está preservado.";
const savedMessage =
  "Identidade salva no cadastro. A abertura, os ícones e o compartilhamento acompanham a próxima atualização do aplicativo.";
const busyPhases: readonly Phase[] = [
  "loading",
  "preparing",
  "uploading",
  "verifying",
  "saving",
  "checking",
];

export function useStoreIdentityEditor(active = true) {
  const auth = useAuth();
  const { refresh } = useStore();
  let origin = "";
  try {
    origin = normalizeSupabaseOrigin(lerSupabaseUrl());
  } catch {
    /* invalid environment is not an editable store */
  }
  const userId = auth.user?.id ?? "";
  const allowed =
    auth.isAdmin &&
    auth.adminStatus === "admin" &&
    !!userId &&
    auth.session?.user.id === userId;
  const scope = `${origin}|${userId}|${allowed}`;
  const latest = useRef({ auth, origin, userId, allowed, active, refresh });
  const mounted = useRef(false);
  const operation = useRef<{
    controller: AbortController;
    kind: Phase;
    id: number;
  } | null>(null);
  const generation = useRef({ value: 0 });
  const model = useRef<EditorState>({ scope, phase: "idle" });
  const [rendered, setRendered] = useState(model.current);

  // Commit-time context is checked again by every transport and final UI continuation.
  useLayoutEffect(() => {
    latest.current = { auth, origin, userId, allowed, active, refresh };
  });
  useLayoutEffect(() => {
    mounted.current = true;
    if (model.current.scope !== scope) model.current = { scope, phase: "idle" };
    setRendered(model.current);
    const clock = generation.current;
    return () => {
      mounted.current = false;
      const previous = operation.current;
      operation.current = null;
      clock.value++;
      previous?.controller.abort();
      if (previous) {
        const old = model.current;
        model.current =
          previous.kind === "saving" ||
          (previous.kind === "checking" && old.intent)
            ? { ...old, phase: "pending", message: pendingMessage }
            : {
                ...old,
                phase: old.draft
                  ? old.current
                    ? "conflict"
                    : "editing"
                  : "idle",
                progress: undefined,
              };
      }
    };
  }, [scope, active]);

  function publish(next: EditorState) {
    model.current = next;
    if (mounted.current) setRendered(next);
  }
  function start(kind: Phase) {
    const context = latest.current;
    if (
      !mounted.current ||
      !context.active ||
      !context.allowed ||
      !context.origin ||
      operation.current
    )
      return null;
    const op = {
      controller: new AbortController(),
      kind,
      id: ++generation.current.value,
    };
    operation.current = op;
    const isCurrent = () => {
      const now = latest.current;
      return (
        mounted.current &&
        operation.current === op &&
        generation.current.value === op.id &&
        !op.controller.signal.aborted &&
        now.active &&
        now.allowed &&
        now.userId === context.userId &&
        now.origin === context.origin &&
        now.auth.session?.user.id === context.userId
      );
    };
    const options: IdentityAdminOptions = {
      supabaseUrl: context.origin,
      publicKey: lerChaveSupabase(),
      userId: context.userId,
      signal: op.controller.signal,
      isCurrent,
      authorize: async () => {
        const session = latest.current.auth.session;
        if (!isCurrent() || !session || session.user.id !== context.userId)
          throw new Error("IDENTITY_EDITOR_SESSION");
        return { userId: session.user.id, accessToken: session.access_token };
      },
    };
    publish({
      ...model.current,
      phase: kind,
      message: undefined,
      progress: undefined,
    });
    return { options, isCurrent, origin: context.origin };
  }
  function finish(next: EditorState) {
    operation.current = null;
    publish(next);
  }
  function confirmed(
    snapshot: StoreIdentitySnapshot,
    readback: boolean,
    operationOrigin: string,
  ) {
    const draft = createIdentityEditorDraft(snapshot, operationOrigin);
    finish({
      scope: model.current.scope,
      phase: "editing",
      draft,
      message: readback
        ? `Esta identidade está salva no cadastro. ${savedMessage.split(". ").slice(1).join(". ")}`
        : savedMessage,
    });
    // Refresh only presents the already confirmed write; its result is not proof.
    try {
      void Promise.resolve(latest.current.refresh({ onlyConfig: true })).catch(
        () => undefined,
      );
    } catch {
      /* saved state remains confirmed */
    }
  }
  async function read() {
    const before = model.current;
    const checking = before.phase === "pending" || before.phase === "conflict";
    const op = start(checking ? "checking" : "loading");
    if (!op) return;
    try {
      const current = await readAdminStoreIdentity(op.options);
      if (!op.isCurrent()) return;
      if (checking) {
        if (
          before.intent &&
          sameRawStoreIdentity(current.identity, before.intent.desired)
        )
          confirmed(current, true, op.origin);
        else
          finish({
            ...before,
            phase: "conflict",
            current,
            message: conflictMessage,
          });
      } else {
        let draft: IdentityEditorDraft;
        try {
          draft = createIdentityEditorDraft(current, op.origin);
        } catch {
          finish({
            scope: before.scope,
            phase: "incomplete",
            message: "A identidade desta loja precisa da preparação inicial.",
          });
          return;
        }
        finish({ scope: before.scope, phase: "editing", draft });
      }
    } catch {
      if (!op.isCurrent()) return;
      finish({
        ...before,
        phase: checking ? before.phase : "error",
        message: checking
          ? `${before.phase === "pending" ? pendingMessage : conflictMessage} Não foi possível conferir agora.`
          : "Não foi possível carregar a identidade da loja.",
      });
    }
  }
  useEffect(() => {
    if (active && allowed && origin && model.current.phase === "idle")
      void read();
    // The operation reads the latest committed session, not a captured access token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, allowed, origin, scope]);

  function editable() {
    return (
      mounted.current &&
      latest.current.active &&
      latest.current.allowed &&
      !operation.current &&
      model.current.phase === "editing" &&
      !!model.current.draft
    );
  }
  function change(change: IdentityDraftChange) {
    if (!editable()) return;
    try {
      publish({
        ...model.current,
        draft: changeIdentityEditorDraft(
          model.current.draft!,
          change,
          latest.current.origin,
        ),
        message: undefined,
      });
    } catch {
      publish({
        ...model.current,
        message:
          "Não foi possível aplicar esta escolha. Confira o formato, as dimensões e as fontes guardadas.",
      });
    }
  }
  function setField(key: keyof IdentityDraftFields, value: string) {
    const draft = model.current.draft;
    if (draft)
      change({ kind: "fields", fields: { ...draft.fields, [key]: value } });
  }
  async function upload(file: File, target: IdentityUploadTarget) {
    if (!editable()) return;
    const before = model.current;
    const op = start("preparing");
    if (!op) return;
    try {
      const { prepareIdentityImage } = await import(
        "@/lib/prepareIdentityImage"
      );
      if (!op.isCurrent()) return;
      const prepared = await prepareIdentityImage(file, {
        signal: op.options.signal,
      });
      if (!op.isCurrent()) return;
      const candidate = {
        asset: prepared.asset,
        url: `${op.origin}/storage/v1/object/public/branding/${prepared.asset.path}`,
      };
      // Validation only. No candidate is stored before the real public byte check.
      changeIdentityEditorDraft(
        before.draft!,
        { ...target, uploaded: candidate },
        op.origin,
      );
      const { uploadIdentityImage } = await import("@/lib/uploadIdentityImage");
      if (!op.isCurrent()) return;
      publish({ ...model.current, phase: "uploading" });
      const uploaded = await uploadIdentityImage(prepared, {
        ...op.options,
        onProgress: (progress) => {
          if (op.isCurrent())
            publish({
              ...model.current,
              phase: progress.stage === "verifying" ? "verifying" : "uploading",
              progress,
            });
        },
      });
      if (!op.isCurrent()) return;
      finish({
        ...before,
        phase: "editing",
        draft: changeIdentityEditorDraft(
          before.draft!,
          { ...target, uploaded },
          op.origin,
        ),
        message:
          "Imagem conferida no rascunho. Salve a identidade para usar esta escolha.",
      });
    } catch {
      if (!op.isCurrent()) return;
      const isOg = target.kind === "asset" && target.roles.includes("og");
      finish({
        ...before,
        phase: "editing",
        message:
          isOg && file.type !== "image/png"
            ? "A arte de compartilhamento precisa ser PNG, 1200 x 630."
            : "Não foi possível conferir esta imagem. Confira o formato e as dimensões e tente novamente.",
      });
    }
  }
  function cancelUpload() {
    const op = operation.current;
    if (!op || op.kind !== "preparing") return;
    operation.current = null;
    generation.current.value++;
    op.controller.abort();
    publish({
      ...model.current,
      phase: "editing",
      progress: undefined,
      message: "Envio cancelado. A imagem anterior permanece no rascunho.",
    });
  }
  async function save() {
    if (!editable()) return;
    const before = model.current;
    const color = validaCorDaLoja(before.draft!.fields.primaryColor);
    if (!color.ok) {
      publish({
        ...before,
        message:
          color.motivo === "preto"
            ? "Preto não pode ser a cor da loja. Escolha outro tom para a cor principal."
            : "Use o formato #RRGGBB nas cores.",
      });
      return;
    }
    let intent: StoreIdentityIntent;
    try {
      intent = buildIdentityEditorIntent(before.draft!, latest.current.origin);
    } catch {
      publish({
        ...before,
        message:
          "Confira nome, cidade, estado e cores no formato #RRGGBB antes de salvar.",
      });
      return;
    }
    const op = start("saving");
    if (!op) return;
    publish({ ...model.current, intent });
    try {
      const result = await saveAdminStoreIdentity(intent, op.options);
      if (!op.isCurrent()) return;
      switch (result.status) {
        case "confirmed":
          confirmed(result.snapshot, result.source === "readback", op.origin);
          break;
        case "pending":
          finish({
            ...before,
            intent,
            phase: "pending",
            message: pendingMessage,
          });
          break;
        case "conflict":
          finish({
            ...before,
            intent,
            phase: "conflict",
            current: result.source === "readback" ? result.current : undefined,
            message: conflictMessage,
          });
          break;
        case "rejected":
          finish({
            ...before,
            phase: "editing",
            message:
              "A identidade não foi gravada. Confira os dados e o acesso de administrador antes de tentar novamente.",
          });
          break;
      }
    } catch {
      if (!op.isCurrent()) return;
      // Unexpected failures are conservative: only a fresh read can disambiguate.
      finish({ ...before, intent, phase: "pending", message: pendingMessage });
    }
  }
  function resolveConflict(keepDraft: boolean) {
    const before = model.current;
    if (
      !mounted.current ||
      !latest.current.active ||
      !latest.current.allowed ||
      operation.current ||
      before.phase !== "conflict" ||
      !before.current ||
      !before.draft
    )
      return;
    try {
      const draft = keepDraft
        ? reconcileIdentityEditorDraft(
            before.draft,
            before.current,
            latest.current.origin,
          )
        : createIdentityEditorDraft(before.current, latest.current.origin);
      finish({
        scope: before.scope,
        phase: "editing",
        draft,
        message: keepDraft
          ? "Rascunho revisado. Confira as prévias e salve novamente."
          : "Configuração atual carregada. O rascunho anterior foi descartado.",
      });
    } catch {
      publish({
        ...before,
        message:
          "A configuração atual precisa da preparação inicial. Seu rascunho está preservado.",
      });
    }
  }
  function discard() {
    if (editable())
      publish({
        scope: model.current.scope,
        phase: "editing",
        draft: createIdentityEditorDraft(
          model.current.draft!.expected,
          latest.current.origin,
        ),
      });
  }
  function keepSource(uploaded: VerifiedPublicIdentityAsset) {
    change({ kind: "source-add", uploaded });
  }

  const state =
    rendered.scope === scope && allowed && origin
      ? rendered
      : { scope, phase: "idle" as const };
  const busy = busyPhases.includes(state.phase);
  const dirty =
    !!state.draft &&
    (busy ||
      state.phase === "pending" ||
      state.phase === "conflict" ||
      identityEditorDraftIsDirty(state.draft, origin));
  return {
    ...state,
    origin,
    allowed,
    active,
    busy,
    dirty,
    locked: busy || !active || !allowed || state.phase !== "editing",
    read,
    setField,
    upload,
    cancelUpload,
    save,
    resolveConflict,
    discard,
    keepSource,
    removeSource: (index: number) => change({ kind: "source-remove", index }),
  };
}
