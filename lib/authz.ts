// Authorization helpers for household roles. Pure — no I/O.
import type { SessionUser } from './session';

export function isAdmin(user: Pick<SessionUser, 'role'> | null | undefined): boolean {
  return !!user && user.role === 'admin';
}
