// Crypto-free constant so the edge middleware can import it without pulling
// node:crypto (which auth.ts uses) into the middleware bundle.
export const SESSION_COOKIE = 'hp_session';
