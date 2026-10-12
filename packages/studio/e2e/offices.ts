const local = Number(process.env.SKYNOT_E2E_PORT ?? 4799);

// The first office answers on this machine with no session; the second asks for one and takes the first's console as its studio.
export const LOCAL_OFFICE = `http://127.0.0.1:${local}`;
export const SESSION_OFFICE = `http://127.0.0.1:${local - 1}`;
export const PAIRING_SECRET = "the-e2e-pairing-secret";
