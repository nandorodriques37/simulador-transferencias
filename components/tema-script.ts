/**
 * Módulo compartilhado (sem "use client"): a chave do localStorage e o script
 * inline que o layout (Server Component) injeta no <head>. Fica fora de
 * `Tema.tsx` para o layout nunca importar de um módulo de cliente.
 */
export const CHAVE_TEMA = "pgm-tema";

/**
 * Script que roda antes da hidratação: aplica o tema salvo ao <html> para a
 * página não piscar em claro antes de virar escuro. Mesma lógica de `aplicar`
 * em `Tema.tsx`, escrita sem dependências porque vai inline no layout.
 */
export const SCRIPT_TEMA = `(function(){try{var t=localStorage.getItem("${CHAVE_TEMA}");var e=t==="escuro"||(t!=="claro"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=e?"escuro":"claro";}catch(err){document.documentElement.dataset.theme="claro";}})();`;
