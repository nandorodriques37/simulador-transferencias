"use client";

import { useEffect, useState } from "react";

export type Tema = "claro" | "escuro" | "sistema";
const CHAVE = "pgm-tema";

/** Lê a preferência salva; "sistema" quando não há nada guardado. */
function lerTema(): Tema {
  if (typeof window === "undefined") return "sistema";
  const v = window.localStorage.getItem(CHAVE);
  return v === "claro" || v === "escuro" ? v : "sistema";
}

function resolver(t: Tema): "claro" | "escuro" {
  if (t !== "sistema") return t;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro";
}

function aplicar(t: Tema) {
  document.documentElement.dataset.theme = resolver(t);
}

/**
 * Script que roda antes da hidratação: aplica o tema salvo ao <html> para a
 * página não piscar em claro antes de virar escuro. Mesma lógica de `aplicar`,
 * escrita sem dependências porque vai inline no layout.
 */
export const SCRIPT_TEMA = `(function(){try{var t=localStorage.getItem("${CHAVE}");var e=t==="escuro"||(t!=="claro"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=e?"escuro":"claro";}catch(err){document.documentElement.dataset.theme="claro";}})();`;

const OPCOES: { valor: Tema; rotulo: string }[] = [
  { valor: "claro", rotulo: "Claro" },
  { valor: "escuro", rotulo: "Escuro" },
  { valor: "sistema", rotulo: "Sistema" },
];

/** Controle Claro · Escuro · Sistema. Persiste em localStorage e segue o SO em "Sistema". */
export function SeletorTema({ className = "" }: { className?: string }) {
  const [tema, setTema] = useState<Tema>("sistema");

  useEffect(() => {
    setTema(lerTema());
  }, []);

  useEffect(() => {
    if (tema !== "sistema") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => aplicar("sistema");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [tema]);

  const escolher = (t: Tema) => {
    setTema(t);
    if (t === "sistema") window.localStorage.removeItem(CHAVE);
    else window.localStorage.setItem(CHAVE, t);
    aplicar(t);
  };

  return (
    <div className={`app-tema ${className}`} role="group" aria-label="Tema">
      {OPCOES.map((o) => (
        <button key={o.valor} type="button" aria-pressed={tema === o.valor} onClick={() => escolher(o.valor)}>
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}
