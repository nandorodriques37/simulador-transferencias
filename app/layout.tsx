import type { Metadata } from "next";
import "./globals.css";
import { Casca } from "@/components/Nav";
import { SCRIPT_TEMA } from "@/components/Tema";

export const metadata: Metadata = {
  title: "Pague Menos — Transferências entre CDs",
  description: "Análise de transferências em rede: uma base com todos os CDs, sequência de origens e destinos, carteira aprovada e baixa por faturamento.",
  icons: {
    icon: "/pague-menos-icon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="claro" suppressHydrationWarning>
      <head>
        {/* Aplica o tema salvo antes da hidratação: sem piscar claro → escuro. */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body>
        <Casca>{children}</Casca>
      </body>
    </html>
  );
}
