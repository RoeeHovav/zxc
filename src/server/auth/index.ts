import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUser, type SessionUser } from "./session";

export type Permission = "customers" | "sales" | "production" | "inventory" | "finance" | "settings" | "export";

/** Role → permissions. STAFF is prepared for future employee accounts. */
const ROLE_PERMISSIONS: Record<SessionUser["role"], Permission[]> = {
  OWNER: ["customers", "sales", "production", "inventory", "finance", "settings", "export"],
  STAFF: ["customers", "sales", "production", "inventory"],
};

export function can(user: SessionUser, permission: Permission) {
  return ROLE_PERMISSIONS[user.role].includes(permission);
}

export class AuthError extends Error {
  constructor(
    message: string,
    public status: 401 | 403,
  ) {
    super(message);
  }
}

/** For pages and server actions: redirects to login when there is no valid session. */
export async function requireUser(permission?: Permission): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (permission && !can(user, permission)) throw new AuthError("You do not have permission to do this.", 403);
  return user;
}

/** For route handlers: throws AuthError (401/403) instead of redirecting. */
export async function requireApiUser(permission?: Permission): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Authentication required.", 401);
  if (permission && !can(user, permission)) throw new AuthError("Forbidden.", 403);
  return user;
}

/** Rejects cross-site state-changing requests to route handlers. */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return; // same-origin fetches from older browsers / non-browser clients carry the cookie only if same-site
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AuthError("Invalid origin.", 403);
  }
  if (originHost !== host) throw new AuthError("Cross-origin request rejected.", 403);
}

export { getCurrentUser, type SessionUser };
