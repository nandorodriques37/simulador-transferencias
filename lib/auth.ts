import { NextRequest } from "next/server";

/**
 * Identidade do usuário. Stub pronto para SSO corporativo: em produção,
 * substituir pela leitura do token/sessão do provedor (ex.: Azure AD via
 * NextAuth, cabeçalhos do proxy SSO). Hoje lê `x-user-email` ou usa um padrão,
 * mantendo a trilha de auditoria funcional ponta a ponta.
 */
export function getUsuario(req: NextRequest): string {
  const h = req.headers.get("x-user-email");
  return h && h.trim() ? h.trim() : "demo@empresa.com";
}
