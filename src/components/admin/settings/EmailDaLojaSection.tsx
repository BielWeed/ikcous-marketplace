import { useEmailDaLoja } from "@/hooks/useEmailDaLoja";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Lock,
  Mail,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import {
  ESPERA_DEPOIS_DE_SALVAR_SEGUNDOS,
  MENSAGEM_DO_TESTE_OK,
  MENSAGEM_SEM_COFRE,
  MENSAGEM_SEM_INTERNET,
  PASSOS_DO_EMAIL,
  RECADO_DE_SEGURANCA,
  type SeloDoEmail,
  normalizarSenhaDeApp,
  seloDoEmail,
  textoDaContagem,
  textoDaSaudeDoEnvio,
  validarGmailDaLoja,
} from "./email-da-loja-conteudo";
import { CARTAO_AJUSTES, IconeDeAjustes } from "./visual-ajustes";

/**
 * Seção "E-mail da loja" da tela de Ajustes (14/10/2026, pedido do dono): a
 * lojista cadastra o Gmail da loja — que envia o e-mail do pedido e o código
 * de login — com o PASSO A PASSO inteiro dentro da tela, uma etapa por vez.
 *
 * SEGURANÇA (a senha de app dá acesso à conta de e-mail):
 * - A senha passa só pelo servidor (edge `credenciais-email`, via
 *   `useEmailDaLoja`) e lá dorme cifrada. NUNCA volta para esta tela: o campo
 *   nasce vazio, depois de salvo mostra "Senha guardada • Trocar" e é LIMPO.
 * - O campo é `type=password`, `autoComplete="new-password"`, sem correção
 *   automática; a senha só vive no estado deste componente, entre digitar e
 *   salvar. Nenhum log, nenhum evento de analytics.
 * - Texto de erro do servidor nunca aparece: o hook devolve frases da casa.
 *
 * HONESTIDADE DO SELO: "Funcionando" quer dizer "o Google aceitou o login".
 * Que o e-mail CHEGA só o botão "Enviar e-mail de teste" prova — a tela diz.
 */

const CLASSE_DO_SELO = new Map<SeloDoEmail["tipo"], string>([
  ["funcionando", "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"],
  ["salvo_sem_teste", "border-orange-500/30 bg-orange-500/10 text-orange-300"],
  ["problema", "border-red-500/30 bg-red-500/10 text-red-300"],
  ["nao_configurado", "border-red-500/30 bg-red-500/10 text-red-300"],
  ["servidor", "border-sky-500/30 bg-sky-500/10 text-sky-300"],
]);

const CLASSE_DO_CAMPO =
  "h-11 w-full min-w-0 rounded-2xl border border-white/15 bg-[#17171c] px-3 text-sm text-white placeholder-zinc-400 focus:border-teal-300 focus:outline-none disabled:cursor-not-allowed aria-[invalid=true]:border-red-400";
const CLASSE_DO_ROTULO = "block text-xs font-medium text-zinc-400";
const CLASSE_BOTAO_DOURADO = "ajustes-secundario min-h-11";
const CLASSE_BOTAO_CONTORNO = "ajustes-secundario min-h-11";
const CLASSE_BOTAO_NEUTRO = "ajustes-secundario min-h-11";

const TOTAL_DE_PASSOS = PASSOS_DO_EMAIL.length;
const PASSO_DE_COLAR = 4;
const PASSO_DO_TESTE = 5;

interface Aviso {
  readonly ok: boolean;
  readonly texto: string;
}

export const EmailDaLojaSection = memo(function EmailDaLojaSection({
  onDirtyMudou,
}: {
  /** Avisa o pai para BLOQUEAR o fecho da seção enquanto houver coisa digitada e não salva. */
  readonly onDirtyMudou?: (dirty: boolean) => void;
}) {
  const isOffline = useOnlineStatus();
  const {
    carga,
    mensagemDeCarga,
    status,
    ocupado,
    recarregar,
    salvar,
    testar,
    remover,
  } = useEmailDaLoja();

  // O que a lojista digitou. `null` = não mexeu: o campo mostra o Gmail salvo.
  const [usuarioDigitado, setUsuarioDigitado] = useState<string | null>(null);
  const [senha, setSenha] = useState("");
  const [trocandoSenha, setTrocandoSenha] = useState(false);
  const [erroDoUsuario, setErroDoUsuario] = useState<string | null>(null);
  const [erroDaSenha, setErroDaSenha] = useState<string | null>(null);

  const [etapa, setEtapa] = useState(1);
  const [verPassos, setVerPassos] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false);

  // O servidor divide 1 tentativa por minuto entre salvar e testar. Quem salva e
  // toca em "Enviar e-mail de teste" na hora leva 429: a tela segura o botão com
  // contagem regressiva (e usa o `espere_segundos` do servidor quando ele manda).
  const [liberaTesteEm, setLiberaTesteEm] = useState<number | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const segurarTeste = (segundos: number) => {
    const inicio = Date.now();
    setAgora(inicio);
    setLiberaTesteEm(inicio + segundos * 1000);
  };
  useEffect(() => {
    if (liberaTesteEm === null) return;
    const relogio = setInterval(() => {
      const instante = Date.now();
      setAgora(instante);
      if (instante >= liberaTesteEm) setLiberaTesteEm(null);
    }, 1000);
    return () => clearInterval(relogio);
  }, [liberaTesteEm]);
  const segundosParaTestar =
    liberaTesteEm === null ? 0 : Math.ceil((liberaTesteEm - agora) / 1000);

  // O foco acompanha a etapa: quem usa leitor de tela (ou teclado) cai no título novo.
  const tituloDoPasso = useRef<HTMLHeadingElement | null>(null);
  const jaMontou = useRef(false);
  useEffect(() => {
    if (!jaMontou.current) {
      jaMontou.current = true;
      return;
    }
    tituloDoPasso.current?.focus();
  }, [etapa, verPassos]);

  const salvoNoServidor = status?.usuario ?? "";
  const usuario = usuarioDigitado ?? salvoNoServidor;
  const usuarioMudou =
    usuarioDigitado !== null &&
    usuarioDigitado.trim().toLowerCase() !== salvoNoServidor;
  // Algo na tela que ainda não é verdade no servidor.
  const dirty = senha !== "" || usuarioMudou;
  useEffect(() => {
    onDirtyMudou?.(dirty);
  }, [dirty, onDirtyMudou]);

  if (carga === "carregando") {
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-xs text-zinc-400"
      >
        <Loader2 className="size-3.5 animate-spin" /> Lendo o e-mail da loja…
      </p>
    );
  }
  if (carga === "indisponivel" || carga === "erro" || !status) {
    return (
      <div
        role={carga === "indisponivel" ? "status" : "alert"}
        data-estado={carga}
        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-zinc-900/60 p-3 text-xs text-zinc-300"
      >
        <span className="flex min-w-0 items-start gap-2">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">{mensagemDeCarga}</span>
        </span>
        {carga === "erro" && (
          <button
            type="button"
            onClick={recarregar}
            className={CLASSE_BOTAO_CONTORNO}
          >
            Tentar de novo
          </button>
        )}
      </div>
    );
  }

  const selo = seloDoEmail(status);
  const saude = textoDaSaudeDoEnvio(status);
  // Senha guardada E em uso. Guardada mas ilegível (cofre trocado, registro
  // quebrado) não conta: a lojista tem de salvar de novo.
  const senhaUtil = status.senhaGuardada && status.origem === "painel";
  const mostrarPassos = status.cofrePronto && (!senhaUtil || verPassos);
  const mostrarResumo = status.cofrePronto && senhaUtil && !verPassos;
  const campoDaSenhaVisivel = !senhaUtil || trocandoSenha || usuarioMudou;
  const emAndamento = ocupado !== null;
  const testeLiberado =
    senhaUtil &&
    !dirty &&
    !emAndamento &&
    !isOffline &&
    segundosParaTestar <= 0;

  const irParaEtapa = (n: number) => {
    setAviso(null);
    setEtapa(Math.min(TOTAL_DE_PASSOS, Math.max(1, n)));
  };

  const aoSalvar = async () => {
    setAviso(null);
    const gmail = validarGmailDaLoja(usuario);
    const chave = normalizarSenhaDeApp(senha);
    setErroDoUsuario(gmail.ok ? null : gmail.erro);
    setErroDaSenha(chave.ok ? null : chave.erro);
    if (!gmail.ok || !chave.ok) return;

    const resultado = await salvar(gmail.usuario, chave.senha);
    if (resultado.ok) {
      // A senha some DA TELA assim que o servidor a guardou.
      setSenha("");
      setUsuarioDigitado(null);
      setTrocandoSenha(false);
      setVerPassos(true);
      setEtapa(PASSO_DO_TESTE);
      setAviso({
        ok: true,
        texto:
          "Gmail salvo. Senha guardada com segurança. Espere 1 minuto antes de testar: o Google bloqueia a conta quando recebe tentativas demais. Depois envie o e-mail de teste.",
      });
      segurarTeste(ESPERA_DEPOIS_DE_SALVAR_SEGUNDOS);
    } else {
      setAviso({ ok: false, texto: resultado.mensagem });
      if (resultado.espereSegundos) segurarTeste(resultado.espereSegundos);
    }
  };

  const aoTestar = async () => {
    setAviso(null);
    const resultado = await testar();
    setAviso(
      resultado.ok
        ? { ok: true, texto: MENSAGEM_DO_TESTE_OK }
        : { ok: false, texto: resultado.mensagem },
    );
    if (!resultado.ok && resultado.espereSegundos) {
      segurarTeste(resultado.espereSegundos);
    }
  };

  const aoRemover = async () => {
    setConfirmandoRemocao(false);
    setAviso(null);
    const resultado = await remover();
    if (resultado.ok) {
      setSenha("");
      setUsuarioDigitado(null);
      setTrocandoSenha(false);
      setVerPassos(false);
      setEtapa(1);
      setAviso({
        ok: true,
        texto:
          "Gmail removido. Se o servidor da loja tiver uma conta de e-mail própria, os e-mails voltam a sair por ela; se não, o cliente não recebe e-mail do pedido até você cadastrar outro Gmail.",
      });
    } else {
      setAviso({ ok: false, texto: resultado.mensagem });
    }
  };

  const botaoDeTeste = (
    <div className="space-y-1.5">
      <button
        type="button"
        disabled={!testeLiberado}
        onClick={aoTestar}
        className="ajustes-primario flex min-h-11 items-center gap-2"
      >
        {ocupado === "testando" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Send className="size-3.5" />
        )}
        <span>Enviar e-mail de teste</span>
      </button>
      {!senhaUtil && (
        <p className="text-[11px] leading-relaxed text-zinc-500">
          Salve o Gmail e a senha de app no passo {PASSO_DE_COLAR} antes de
          testar.
        </p>
      )}
      {senhaUtil && !dirty && segundosParaTestar > 0 && (
        <p
          data-contagem=""
          className="text-[11px] font-bold uppercase tracking-widest text-orange-400"
        >
          Pode testar em {textoDaContagem(segundosParaTestar)}
        </p>
      )}
      {senhaUtil && dirty && (
        <p className="text-[11px] font-bold uppercase tracking-widest text-orange-400">
          Salve para testar
        </p>
      )}
    </div>
  );

  const avisoDaAcao = aviso && (
    <p
      data-resultado=""
      role={aviso.ok ? "status" : "alert"}
      className={cn(
        "flex items-start gap-1.5 rounded-lg border p-2.5 text-xs leading-relaxed",
        aviso.ok
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-red-500/30 bg-red-500/10 text-red-300",
      )}
    >
      {aviso.ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
      ) : (
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
      )}
      <span className="min-w-0">{aviso.texto}</span>
    </p>
  );

  const passo = PASSOS_DO_EMAIL[etapa - 1];

  return (
    <div className="min-w-0 space-y-7" data-secao="email-da-loja">
      {/* ── O selo: o estado de relance ─────────────────────────────── */}
      <div
        role="status"
        data-selo={selo.tipo}
        className={cn(
          "space-y-1 rounded-xl border p-3",
          CLASSE_DO_SELO.get(selo.tipo),
        )}
      >
        <p className="flex items-center gap-2 text-sm font-black">
          {selo.tipo === "funcionando" ? (
            <CheckCircle2 className="size-4 shrink-0" />
          ) : (
            <AlertCircle className="size-4 shrink-0" />
          )}
          <span className="min-w-0">{selo.titulo}</span>
        </p>
        <p className="text-[11px] leading-relaxed">{selo.detalhe}</p>
      </div>

      {saude && (
        <p
          data-saude=""
          role="alert"
          className="flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs font-bold leading-relaxed text-red-300"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">{saude}</span>
        </p>
      )}

      {status.registroIlegivel && (
        <p className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-2.5 text-xs leading-relaxed text-orange-300">
          Não consegui ler o Gmail e a senha que estavam guardados. Salve os
          dois de novo, pelo passo a passo abaixo.
        </p>
      )}

      {/* ── Loja sem cofre: avisa ANTES de qualquer passo ─────────────── */}
      {!status.cofrePronto && (
        <div
          data-cofre-falso=""
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 p-3 text-xs leading-relaxed text-orange-300"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">{MENSAGEM_SEM_COFRE}</span>
        </div>
      )}

      {/* ── Resumo, quando já está salvo ────────────────────────────── */}
      {mostrarResumo && (
        <div className={`${CARTAO_AJUSTES} space-y-4`}>
          <div className="flex items-center gap-3">
            <IconeDeAjustes icone={Mail} matiz="verde" />
            <h3 className="text-base font-bold text-white">Gmail da loja</h3>
          </div>
          <p className="text-sm text-zinc-300">
            Gmail da loja:{" "}
            <strong className="break-all font-bold text-white">
              {status.usuario}
            </strong>
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-300">
            <Lock className="size-3 shrink-0 text-zinc-500" />
            <span>Senha guardada •</span>
            <button
              type="button"
              onClick={() => {
                setAviso(null);
                setTrocandoSenha(true);
                setVerPassos(true);
                setEtapa(PASSO_DE_COLAR);
              }}
              className="min-h-11 font-bold text-sky-300 underline underline-offset-2"
            >
              Trocar
            </button>
          </p>
          {botaoDeTeste}
          {avisoDaAcao}
          <button
            type="button"
            onClick={() => {
              setAviso(null);
              setVerPassos(true);
              setEtapa(1);
            }}
            className={CLASSE_BOTAO_NEUTRO}
          >
            Ver o passo a passo
          </button>
        </div>
      )}

      {/* ── Passo a passo: UMA etapa por vez ─────────────────────────── */}
      {mostrarPassos && (
        <section
          aria-labelledby="email-loja-titulo-do-passo"
          data-passo={etapa}
          className={`${CARTAO_AJUSTES} space-y-4`}
        >
          <div className="space-y-1.5">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500">
              Passo {etapa} de {TOTAL_DE_PASSOS}
            </p>
            <div aria-hidden="true" className="flex gap-1">
              {PASSOS_DO_EMAIL.map((p, i) => (
                <span
                  key={p.titulo}
                  className={cn(
                    "h-1 flex-1 rounded-full",
                    i < etapa ? "bg-teal-300" : "bg-white/10",
                  )}
                />
              ))}
            </div>
          </div>

          <h3
            id="email-loja-titulo-do-passo"
            ref={tituloDoPasso}
            tabIndex={-1}
            data-titulo-do-passo=""
            className="text-sm font-bold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold"
          >
            {etapa}. {passo.titulo}
          </h3>

          <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-zinc-300">
            {passo.fazer.map((linha) => (
              <li key={linha}>{linha}</li>
            ))}
          </ol>

          {passo.link && (
            <a
              href={passo.link.href}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(CLASSE_BOTAO_CONTORNO, "w-fit")}
            >
              <ExternalLink className="size-3.5" />
              <span>{passo.link.rotulo}</span>
            </a>
          )}

          <div className="space-y-1.5 text-[11px] leading-relaxed text-zinc-400">
            <p>
              <strong className="text-zinc-200">O que vai aparecer: </strong>
              {passo.aparece}
            </p>
            <p>
              <strong className="text-zinc-200">Deu certo quando: </strong>
              {passo.deuCerto}
            </p>
            <p>
              <strong className="text-zinc-200">Se aparecer diferente: </strong>
              {passo.seDiferente}
            </p>
          </div>

          {etapa === PASSO_DE_COLAR && (
            <div className="space-y-3 border-t border-white/5 pt-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="email-loja-usuario"
                  className={CLASSE_DO_ROTULO}
                >
                  Gmail da loja
                </label>
                <input
                  id="email-loja-usuario"
                  type="email"
                  inputMode="email"
                  value={usuario}
                  onChange={(e) => {
                    setUsuarioDigitado(e.target.value);
                    setErroDoUsuario(null);
                  }}
                  placeholder="nomedaloja@gmail.com"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={emAndamento}
                  aria-invalid={erroDoUsuario ? true : undefined}
                  aria-describedby={
                    erroDoUsuario ? "email-loja-usuario-erro" : undefined
                  }
                  className={CLASSE_DO_CAMPO}
                />
                {erroDoUsuario && (
                  <p
                    id="email-loja-usuario-erro"
                    role="alert"
                    className="text-[11px] leading-relaxed text-red-300"
                  >
                    {erroDoUsuario}
                  </p>
                )}
              </div>

              {campoDaSenhaVisivel ? (
                <div className="space-y-1.5">
                  <label
                    htmlFor="email-loja-senha"
                    className={CLASSE_DO_ROTULO}
                  >
                    Senha de app do Google (16 letras)
                  </label>
                  <input
                    id="email-loja-senha"
                    type="password"
                    value={senha}
                    onChange={(e) => {
                      setSenha(e.target.value);
                      setErroDaSenha(null);
                    }}
                    placeholder="Cole aqui as 16 letras"
                    autoComplete="new-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={emAndamento}
                    aria-invalid={erroDaSenha ? true : undefined}
                    aria-describedby={
                      erroDaSenha
                        ? "email-loja-senha-erro"
                        : "email-loja-senha-dica"
                    }
                    className={cn(CLASSE_DO_CAMPO, "font-mono")}
                  />
                  <p
                    id="email-loja-senha-dica"
                    className="text-[11px] leading-relaxed text-zinc-500"
                  >
                    Pode colar com ou sem os espaços que o Google mostra.
                  </p>
                  {erroDaSenha && (
                    <p
                      id="email-loja-senha-erro"
                      role="alert"
                      className="text-[11px] leading-relaxed text-red-300"
                    >
                      {erroDaSenha}
                    </p>
                  )}
                </div>
              ) : (
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-300">
                  <Lock className="size-3 shrink-0 text-zinc-500" />
                  <span>Senha guardada •</span>
                  <button
                    type="button"
                    onClick={() => setTrocandoSenha(true)}
                    className="min-h-11 font-bold text-sky-300 underline underline-offset-2"
                  >
                    trocar
                  </button>
                </p>
              )}

              {campoDaSenhaVisivel && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={emAndamento || isOffline}
                    onClick={aoSalvar}
                    className={CLASSE_BOTAO_DOURADO}
                  >
                    {ocupado === "salvando" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Save className="size-3.5" />
                    )}
                    <span>Salvar</span>
                  </button>
                  {ocupado === "salvando" && (
                    <span role="status" className="text-[11px] text-zinc-400">
                      Conferindo com o Google, leva alguns segundos…
                    </span>
                  )}
                </div>
              )}
              {isOffline && (
                <p className="text-[11px] font-bold text-orange-400">
                  {MENSAGEM_SEM_INTERNET}
                </p>
              )}
              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-500">
                <Lock className="mt-0.5 size-3 shrink-0" />{" "}
                {RECADO_DE_SEGURANCA}
              </p>
            </div>
          )}

          {etapa === PASSO_DO_TESTE && (
            <div className="border-t border-white/5 pt-3">{botaoDeTeste}</div>
          )}

          {avisoDaAcao}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              disabled={etapa === 1}
              onClick={() => irParaEtapa(etapa - 1)}
              className={CLASSE_BOTAO_NEUTRO}
            >
              Voltar
            </button>
            {etapa < TOTAL_DE_PASSOS ? (
              <button
                type="button"
                onClick={() => irParaEtapa(etapa + 1)}
                className={CLASSE_BOTAO_NEUTRO}
              >
                Já fiz, próximo passo
              </button>
            ) : (
              senhaUtil && (
                <button
                  type="button"
                  onClick={() => {
                    setAviso(null);
                    setVerPassos(false);
                  }}
                  className={CLASSE_BOTAO_NEUTRO}
                >
                  Concluir
                </button>
              )
            )}
          </div>
        </section>
      )}

      {/* ── Remover ─────────────────────────────────────────────────── */}
      {status.senhaGuardada && (
        <div className="space-y-2">
          {confirmandoRemocao ? (
            <div
              role="alert"
              className="space-y-4 rounded-3xl border border-white/15 bg-gradient-to-br from-[#24242e] to-[#101013] p-4"
            >
              <p className="text-xs font-bold leading-relaxed text-orange-300">
                Remover o Gmail da loja?
              </p>
              <p className="text-[11px] leading-relaxed text-orange-200/90">
                A senha guardada é apagada. Se o servidor não tiver outra conta
                de e-mail, seus clientes deixam de receber e-mail do pedido até
                você cadastrar outro Gmail.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmandoRemocao(false)}
                  className={CLASSE_BOTAO_NEUTRO}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={emAndamento || isOffline}
                  onClick={aoRemover}
                  className="ajustes-secundario min-h-11 !text-red-300"
                >
                  Sim, remover
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={emAndamento}
              onClick={() => setConfirmandoRemocao(true)}
              className={cn(
                CLASSE_BOTAO_NEUTRO,
                "!justify-between !text-red-300",
              )}
            >
              {ocupado === "removendo" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              <span>Remover o Gmail</span>
            </button>
          )}
          {!mostrarResumo && !mostrarPassos && avisoDaAcao}
        </div>
      )}
      {!status.senhaGuardada && !mostrarPassos && !mostrarResumo && avisoDaAcao}
    </div>
  );
});
