import {
  CAMPO,
  FOCO,
  INTERRUPTOR,
  PRIMARIO,
  SECUNDARIO,
} from "@/components/admin/coupons/apresentacao";
import { FolhaDoPainel } from "@/components/admin/primitivos/FolhaDoPainel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  type DadosDoFornecedor,
  type ErrosDoFornecedor,
  type FormularioDoFornecedor,
  type Fornecedor,
  LIMITE_DAS_OBSERVACOES,
  UFS,
  validarFornecedor,
} from "@/lib/fornecedores";
import { Factory } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

const SELECT = `${CAMPO} border px-3 ${FOCO}`;

function formularioInicial(f: Fornecedor | null): FormularioDoFornecedor {
  return {
    nome: f?.nome ?? "",
    whatsapp: f?.whatsapp ?? "",
    instagram: f?.instagram ?? "",
    site: f?.site ?? "",
    cidade: f?.cidade ?? "",
    uf: f?.uf ?? "",
    observacoes: f?.observacoes ?? "",
    favorito: f?.favorito ?? false,
  };
}

/**
 * A folha de cadastro e edição de fornecedor. Quem decide se ela está aberta e
 * qual fornecedor edita é a tela (`fornecedor === null` = cadastro novo).
 *
 * - Valida ANTES de ir ao banco (mesmas regras dos CHECKs, `validarFornecedor`).
 * - Salvar é uma gravação por vez: o segundo toque enquanto a primeira não voltou
 *   é ignorado (guarda por `ref`, que vale já no mesmo instante do toque).
 * - Falha ao gravar: a folha FICA aberta, o que foi digitado fica, e a frase do
 *   hook aparece na folha. Tentar de novo regrava no mesmo id (o hook faz upsert).
 * - Sem internet: Salvar desliga e a folha diz por quê, sem perder o texto.
 * - Fechar com algo mudado pergunta antes de descartar; `aoMudarSujo` avisa o
 *   painel (guarda de saída) enquanto há texto não salvo.
 */
export function FolhaDoFornecedor({
  aberta,
  fornecedor,
  offline,
  aoFechar,
  aoSalvar,
  aoMudarSujo,
}: {
  readonly aberta: boolean;
  readonly fornecedor: Fornecedor | null;
  readonly offline: boolean;
  readonly aoFechar: () => void;
  readonly aoSalvar: (dados: DadosDoFornecedor) => Promise<unknown>;
  readonly aoMudarSujo: (sujo: boolean) => void;
}) {
  const idBase = useId();
  const [form, setForm] = useState<FormularioDoFornecedor>(() =>
    formularioInicial(fornecedor),
  );
  const [erros, setErros] = useState<ErrosDoFornecedor>({});
  const [erroDoServidor, setErroDoServidor] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [perguntandoDescarte, setPerguntandoDescarte] = useState(false);
  const gravandoRef = useRef(false);
  const inicial = useRef(JSON.stringify(formularioInicial(fornecedor)));

  // Cada abertura começa do zero (cadastro novo) ou do fornecedor escolhido.
  useEffect(() => {
    if (!aberta) return;
    const base = formularioInicial(fornecedor);
    setForm(base);
    setErros({});
    setErroDoServidor(null);
    setSalvando(false);
    setPerguntandoDescarte(false);
    gravandoRef.current = false;
    inicial.current = JSON.stringify(base);
  }, [aberta, fornecedor]);

  const sujo = aberta && JSON.stringify(form) !== inicial.current;
  useEffect(() => {
    aoMudarSujo(sujo);
  }, [sujo, aoMudarSujo]);
  useEffect(() => () => aoMudarSujo(false), [aoMudarSujo]);

  const id = (campo: string) => `${idBase}-${campo}`;
  const mudar = <K extends keyof FormularioDoFornecedor>(
    campo: K,
    valor: FormularioDoFornecedor[K],
  ) => {
    setForm((atual) => ({ ...atual, [campo]: valor }));
    setErros((atuais) => {
      if (!(campo in atuais)) return atuais;
      const { [campo as keyof ErrosDoFornecedor]: _tirado, ...resto } = atuais;
      return resto;
    });
  };

  const pedirParaFechar = () => {
    if (salvando) return;
    if (sujo) setPerguntandoDescarte(true);
    else aoFechar();
  };

  const salvar = async () => {
    if (gravandoRef.current || offline) return;
    const resultado = validarFornecedor(form);
    if (!resultado.ok) {
      setErros(resultado.erros);
      setErroDoServidor(null);
      const primeiro = (
        [
          "nome",
          "whatsapp",
          "instagram",
          "site",
          "cidade",
          "uf",
          "observacoes",
        ] as const
      ).find(
        // eslint-disable-next-line security/detect-object-injection -- c vem so da lista literal acima.
        (c) => resultado.erros[c],
      );
      if (primeiro) document.getElementById(id(primeiro))?.focus();
      return;
    }
    gravandoRef.current = true;
    setSalvando(true);
    setErroDoServidor(null);
    try {
      await aoSalvar(resultado.dados);
    } catch (e) {
      setErroDoServidor(
        e instanceof Error
          ? e.message
          : "Não deu certo agora. Tente de novo em instantes.",
      );
    } finally {
      gravandoRef.current = false;
      setSalvando(false);
    }
  };

  const campoDeTexto = (
    campo: "nome" | "whatsapp" | "instagram" | "site" | "cidade",
    rotulo: string,
    extra: {
      inputMode?: "tel" | "url" | "text";
      dica?: string;
      placeholder?: string;
    } = {},
  ) => {
    // eslint-disable-next-line security/detect-object-injection -- campo vem so da uniao literal dos tipos acima, nunca de texto digitado.
    const valor = form[campo];
    // eslint-disable-next-line security/detect-object-injection -- idem.
    const erro = erros[campo];
    return (
      <div className="space-y-1.5">
        <Label
          htmlFor={id(campo)}
          className="text-sm font-semibold text-zinc-200"
        >
          {rotulo}
        </Label>
        <Input
          id={id(campo)}
          value={valor}
          onChange={(e) => mudar(campo, e.target.value)}
          inputMode={extra.inputMode}
          placeholder={extra.placeholder}
          autoComplete="off"
          aria-invalid={erro ? true : undefined}
          aria-describedby={
            erro
              ? id(`${campo}-erro`)
              : extra.dica
                ? id(`${campo}-dica`)
                : undefined
          }
          className={CAMPO}
        />
        {extra.dica && !erro && (
          <p id={id(`${campo}-dica`)} className="text-xs text-zinc-400">
            {extra.dica}
          </p>
        )}
        {erro && (
          <p
            id={id(`${campo}-erro`)}
            role="alert"
            className="text-sm font-semibold text-red-300"
          >
            {erro}
          </p>
        )}
      </div>
    );
  };

  return (
    <>
      <FolhaDoPainel
        aberta={aberta}
        onFechar={pedirParaFechar}
        titulo={fornecedor ? "Editar fornecedor" : "Novo fornecedor"}
        icone={Factory}
        rodape={
          <button
            type="button"
            onClick={salvar}
            disabled={offline || salvando}
            className={`${PRIMARIO} w-full sm:w-auto sm:min-w-48`}
          >
            {salvando ? "Salvando…" : "Salvar fornecedor"}
          </button>
        }
      >
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void salvar();
          }}
          className="space-y-5"
        >
          {offline && (
            <p
              role="status"
              className="rounded-2xl border border-admin-border-strong bg-admin-raised p-3 text-sm text-zinc-200"
            >
              Sem internet. Para salvar, conecte-se de novo. O que você escreveu
              fica aqui.
            </p>
          )}
          {erroDoServidor && (
            <p
              role="alert"
              className="rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm font-semibold text-red-300"
            >
              {erroDoServidor}
            </p>
          )}
          {campoDeTexto("nome", "Nome do fornecedor")}
          {campoDeTexto("whatsapp", "WhatsApp", {
            inputMode: "tel",
            dica: "Com DDD, só números. Ex.: (11) 90000-0000",
          })}
          {campoDeTexto("instagram", "Instagram", {
            dica: "O @usuario ou o link do perfil.",
          })}
          {campoDeTexto("site", "Site", {
            inputMode: "url",
            dica: "Ex.: www.exemplo.com.br",
          })}
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            {campoDeTexto("cidade", "Cidade (opcional)")}
            <div className="space-y-1.5">
              <Label
                htmlFor={id("uf")}
                className="text-sm font-semibold text-zinc-200"
              >
                Estado
              </Label>
              <select
                id={id("uf")}
                value={form.uf}
                onChange={(e) => mudar("uf", e.target.value)}
                aria-invalid={erros.uf ? true : undefined}
                aria-describedby={erros.uf ? id("uf-erro") : undefined}
                className={SELECT}
              >
                <option value="">—</option>
                {UFS.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </select>
              {erros.uf && (
                <p
                  id={id("uf-erro")}
                  role="alert"
                  className="text-sm font-semibold text-red-300"
                >
                  {erros.uf}
                </p>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor={id("observacoes")}
              className="text-sm font-semibold text-zinc-200"
            >
              Observações
            </Label>
            <Textarea
              id={id("observacoes")}
              value={form.observacoes}
              onChange={(e) => mudar("observacoes", e.target.value)}
              rows={3}
              aria-invalid={erros.observacoes ? true : undefined}
              aria-describedby={
                erros.observacoes
                  ? id("observacoes-erro")
                  : id("observacoes-dica")
              }
              className="min-h-24 w-full rounded-2xl border-admin-border-strong bg-admin-raised text-base text-zinc-50 placeholder:text-zinc-400"
            />
            <p id={id("observacoes-dica")} className="text-xs text-zinc-400">
              Pedido mínimo, prazo, forma de pagamento... até{" "}
              {LIMITE_DAS_OBSERVACOES} caracteres.
            </p>
            {erros.observacoes && (
              <p
                id={id("observacoes-erro")}
                role="alert"
                className="text-sm font-semibold text-red-300"
              >
                {erros.observacoes}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-admin-border bg-admin-surface p-3">
            <Label
              htmlFor={id("favorito")}
              className="min-w-0 text-sm font-semibold text-zinc-200"
            >
              Favorito
              <span className="block text-xs font-normal text-zinc-400">
                Fica no topo da lista.
              </span>
            </Label>
            <Switch
              id={id("favorito")}
              checked={form.favorito}
              onCheckedChange={(v) => mudar("favorito", v)}
              className={INTERRUPTOR}
            />
          </div>
        </form>
      </FolhaDoPainel>

      <AlertDialog
        open={perguntandoDescarte}
        onOpenChange={setPerguntandoDescarte}
      >
        <AlertDialogContent className="max-w-md rounded-3xl border border-admin-border bg-zinc-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-2xl font-bold text-zinc-50">
              Descartar o que você escreveu?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-zinc-400">
              O fornecedor ainda não foi salvo. Se sair agora, o que você
              escreveu se perde.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className={SECUNDARIO}>
              Continuar editando
            </AlertDialogCancel>
            <AlertDialogAction
              className={SECUNDARIO}
              onClick={() => {
                setPerguntandoDescarte(false);
                aoFechar();
              }}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
