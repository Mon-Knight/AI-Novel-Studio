import base from '../../tests/browser/wdio.conf';

async function waitForVite(): Promise<void> {
  const deadline = Date.now() + 20_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:4173/', { redirect: 'manual' });
      if (response.ok) return;
      lastError = new Error(`Vite returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Local Vite fixture did not become ready: ${String(lastError ?? 'timeout')}`);
}

export const config = {
  ...base,
  async onPrepare() {
    await waitForVite();
  },
  async onComplete() {
    // The local Vite server is managed by the caller.
  },
};
