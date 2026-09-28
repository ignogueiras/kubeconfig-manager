import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startServer } from './index.js';

describe('local API server lifecycle', () => {
  it('serves the UI, delegates file browsing, and closes on an assigned port', async () => {
    const assetsDirectory = await mkdtemp(join(tmpdir(), 'kubeconfig-manager-assets-'));
    await writeFile(join(assetsDirectory, 'index.html'), 'desktop-ready');
    const dialogModes: string[] = [];
    const server = await startServer({
      port: 0,
      assetsDirectory,
      fileDialog: async (mode) => {
        dialogModes.push(mode);
        return null;
      },
    });

    try {
      expect(new URL(server.url).port).not.toBe('');
      const page = await fetch(server.url);
      expect(await page.text()).toBe('desktop-ready');

      const browse = await fetch(`${server.url}/api/files/browse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: server.url },
        body: JSON.stringify({ mode: 'open' }),
      });
      expect(await browse.json()).toEqual({ cancelled: true });
      expect(dialogModes).toEqual(['open']);
    } finally {
      await server.close();
      await rm(assetsDirectory, { recursive: true, force: true });
    }
  });
});