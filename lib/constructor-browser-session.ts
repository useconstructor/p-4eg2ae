export async function withBrowserSession<T>(initialize: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks || typeof locks.request !== 'function') {
    throw new Error('No se pudo coordinar tu espacio privado. Actualiza el navegador y vuelve a intentarlo.');
  }
  return locks.request('constructor:visitor-session', { mode: 'exclusive' }, initialize);
}
