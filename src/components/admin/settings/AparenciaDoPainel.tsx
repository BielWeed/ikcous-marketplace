import { useState } from "react";

import "./aparencia-do-painel.css";

const TEMAS = [
  ["escuro", "Escuro", "Fundo preto, o padrão"],
  ["claro", "Claro", "Fundo claro, bom ao ar livre"],
  ["confortavel", "Confortável", "Tons quentes, cansa menos a vista"],
] as const;

/**
 * Escolha do tema do painel, só neste aparelho (a loja dos clientes não muda).
 * Grava `admin_tema_do_painel` e liga `data-admin-tema` na <html> (Escuro = sem
 * atributo), o mesmo contrato de src/components/admin/temaDoPainel.ts, que
 * aplica a escolha ao entrar no painel. Não importa esse módulo de propósito
 * (chunk à parte custa bytes no pacote do painel, que está no teto); um teste
 * confere que os dois combinam. O desenho da opção, a amostra de cor e o
 * "Em uso" moram no CSS (`.tema-opcao`).
 */
export function AparenciaDoPainel() {
  const raiz = document.documentElement;
  const [atual, setAtual] = useState(raiz.dataset.adminTema ?? "escuro");
  return (
    <div
      role="radiogroup"
      aria-label="Aparência do painel"
      className="space-y-2"
    >
      {TEMAS.map(([id, nome, dica]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={atual === id}
          data-tema-opcao={id}
          onClick={() => {
            if (id === "escuro") delete raiz.dataset.adminTema;
            else raiz.dataset.adminTema = id;
            try {
              localStorage.setItem("admin_tema_do_painel", id);
            } catch {
              // Sem storage (modo privado, cota cheia): vale só nesta sessão.
            }
            setAtual(id);
          }}
          className="tema-opcao"
        >
          <span className="tema-amostra" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="tema-nome">{nome}</span>
            <span className="tema-dica">{dica}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
