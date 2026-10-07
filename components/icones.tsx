import type { ReactNode } from "react";

/**
 * Ícones de traço arredondado de 2 px, desenhados inline. O design system não
 * tem biblioteca de ícones; este é o conjunto registrado para o app.
 */
const TRACOS: Record<string, ReactNode> = {
  dashboard: (<><rect x="3" y="3" width="7" height="9" rx="2" /><rect x="14" y="3" width="7" height="5" rx="2" /><rect x="14" y="12" width="7" height="9" rx="2" /><rect x="3" y="16" width="7" height="5" rx="2" /></>),
  analise: (<><path d="M4 6h8M16 6h4M4 12h2M10 12h10M4 18h10M18 18h2" /><circle cx="14" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="16" cy="18" r="2" /></>),
  plano: (<><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 8h8M8 12h8M8 16h5" /></>),
  carteira: (<><path d="M5 7V6a2 2 0 012-2h10a1 1 0 011 1v2" /><rect x="3" y="7" width="18" height="13" rx="3" /><path d="M16 13.5h2" /></>),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  fechar: <path d="M6 6l12 12M18 6L6 18" />,
  seta: <path d="M5 12h14M13 6l6 6-6 6" />,
  cima: <path d="M6 15l6-6 6 6" />,
  baixo: <path d="M6 9l6 6 6-6" />,
  info: (<><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></>),
  atencao: (<><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5M12 18v.01" /></>),
  erro: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.01" /></>),
  ok: (<><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></>),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  upload: (<><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" /></>),
  busca: (<><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>),
  recarregar: (<><path d="M20 12a8 8 0 10-2.3 5.6" /><path d="M20 20v-5h-5" /></>),
  semRede: (<><path d="M5 12.5a7 7 0 0114 0" /><path d="M8.5 15.5a3.5 3.5 0 017 0" /><path d="M12 19v.01" /><path d="M3 3l18 18" /></>),
  banco: (<><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>),
  filtro: <path d="M4 6h16M7 12h10M10 18h4" />,
  tabela: (<><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 10h18M9 4v16" /></>),
};

export type NomeIcone = keyof typeof TRACOS;

export function Icone({ nome, tamanho = 20, espessura = 2, className }: { nome: NomeIcone; tamanho?: number; espessura?: number; className?: string }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={espessura} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {TRACOS[nome]}
    </svg>
  );
}
