import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Transferências entre CDs — Otimização de Excesso",
  description: "Planejamento de transferências de excesso do CD10 para abater pedidos projetados (DRP) dos demais CDs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="flex min-h-screen">
          <Nav />
          <main className="flex-1 min-w-0 px-6 py-6 lg:px-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
