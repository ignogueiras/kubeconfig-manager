import { startServer } from './index.js';

try {
  const server = await startServer();
  console.log(`Kubeconfig Manager API listening on ${server.url}`);
} catch {
  console.error('Kubeconfig Manager API could not start.');
  process.exitCode = 1;
}