import express from 'express';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { ApiError, configExists, createConfigFile, createConfigFileFromData, deleteEntity, mergeSelectedEntities, normalizeConfigPath, readConfig, sanitizeConfig, saveConfig, setCurrentContext, upsertEntity, type EntityKind } from './kubeconfig.js';

const app = express();
const port = Number(process.env.PORT ?? 4174);
const configPath = join(homedir(), '.kube', 'config');
let defaultConfigPath = '';
const registeredPaths = new Set<string>();
const entityKinds = new Set<EntityKind>(['clusters', 'users', 'contexts']);
const runFileDialog = promisify(execFile);

async function nativeFileDialog(mode: 'open' | 'save'): Promise<string | null> {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new ApiError(501, 'A desktop file chooser is unavailable. Enter the config path manually.');
  }
  const title = mode === 'open' ? 'Select an existing kubeconfig' : 'Create a new kubeconfig';
  const zenityArgs = mode === 'open'
    ? ['--file-selection', `--title=${title}`, '--file-filter=Kubeconfig files | *config*', '--file-filter=All files | *']
    : ['--file-selection', '--save', `--title=${title}`, `--filename=${join(homedir(), 'kubeconfig-new')}`];
  const kdialogArgs = mode === 'open'
    ? ['--getopenfilename', homedir(), 'Kubeconfig files (*config)']
    : ['--getsavefilename', join(homedir(), 'config'), 'Kubeconfig files (*config)'];

  for (const [command, args] of [['zenity', zenityArgs], ['kdialog', kdialogArgs]] as const) {
    try {
      await access(`/usr/bin/${command}`);
      const { stdout } = await runFileDialog(command, args, { timeout: 120_000, maxBuffer: 4096 });
      const path = stdout.trim();
      return path || null;
    } catch (error: any) {
      if (error.code === 1 || error.code === 'ABORT_ERR') return null;
      if (error.code === 'ENOENT') continue;
      if (error.killed) throw new ApiError(408, 'File chooser timed out.');
      throw new ApiError(500, 'The native file chooser could not be opened.');
    }
  }
  throw new ApiError(501, 'No supported desktop file chooser is installed. Enter the config path manually.');
}

async function selectedPath(value: unknown): Promise<string> {
  const path = await normalizeConfigPath(value);
  if (!registeredPaths.has(path)) throw new ApiError(403, 'Add this config file before managing it.');
  return path;
}

async function configPayload(path: string) {
  const config = await readConfig(path);
  return { ...sanitizeConfig(config), configPath: path, exists: await configExists(path), isDefault: path === defaultConfigPath };
}

app.disable('x-powered-by');
app.use((request, response, next) => {
  const host = request.headers.host?.replace(/:\d+$/, '');
  if (!host || !['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) {
    response.status(403).json({ error: 'Localhost requests only.' });
    return;
  }
  next();
});
app.use((request, response, next) => {
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
    try {
      const origin = request.headers.origin ? new URL(request.headers.origin) : undefined;
      if (!origin || !['localhost', '127.0.0.1', '::1'].includes(origin.hostname)) {
        response.status(403).json({ error: 'Local browser origin required.' });
        return;
      }
    } catch {
      response.status(403).json({ error: 'Local browser origin required.' });
      return;
    }
  }
  next();
});
app.use(express.json({ limit: '1mb' }));

async function mutate(path: string, action: (config: any) => unknown, response: express.Response) {
  const config = await readConfig(path);
  const result = action(config);
  const backupPath = await saveConfig(path, config);
  response.json({ ...result as object, ...(await configPayload(path)), backupCreated: Boolean(backupPath) });
}

app.get('/api/files', async (_request, response) => {
  const files = await Promise.all([...registeredPaths].map(async (path) => ({ path, exists: await configExists(path), isDefault: path === defaultConfigPath })));
  response.json({ files });
});

app.post('/api/files', async (request, response, next) => {
  try {
    const path = await normalizeConfigPath(request.body.path);
    await readConfig(path);
    registeredPaths.add(path);
    response.json(await configPayload(path));
  } catch (error) { next(error); }
});

app.post('/api/files/browse', async (request, response, next) => {
  try {
    const mode = request.body.mode === 'save' ? 'save' : 'open';
    const selected = await nativeFileDialog(mode);
    if (!selected) {
      response.json({ cancelled: true });
      return;
    }
    const path = await normalizeConfigPath(selected);
    if (mode === 'open') await readConfig(path);
    response.json({ cancelled: false, path });
  } catch (error) { next(error); }
});

app.post('/api/files/create', async (request, response, next) => {
  try {
    const path = await normalizeConfigPath(request.body.path);
    await createConfigFile(path);
    registeredPaths.add(path);
    response.json(await configPayload(path));
  } catch (error) { next(error); }
});

app.post('/api/files/duplicate', async (request, response, next) => {
  try {
    const sourcePath = await selectedPath(request.body.sourcePath);
    const targetPath = await normalizeConfigPath(request.body.targetPath);
    if (sourcePath === targetPath) throw new ApiError(400, 'Choose a different path for the duplicate.');
    const source = await readConfig(sourcePath);
    await createConfigFileFromData(targetPath, source);
    registeredPaths.add(targetPath);
    response.json(await configPayload(targetPath));
  } catch (error) { next(error); }
});

app.post('/api/files/merge', async (request, response, next) => {
  try {
    const targetPath = await selectedPath(request.body.targetPath);
    if (!Array.isArray(request.body.sources) || request.body.sources.length === 0) throw new ApiError(400, 'Select at least one source config and entity.');
    const sourcePaths = new Set<string>();
    const selections = [];
    for (const source of request.body.sources) {
      const path = await selectedPath(source.path);
      if (path === targetPath) throw new ApiError(400, 'The destination config cannot also be a source.');
      if (sourcePaths.has(path)) throw new ApiError(400, 'A source config can only be selected once.');
      sourcePaths.add(path);
      selections.push({
        config: await readConfig(path),
        clusters: Array.isArray(source.clusters) ? source.clusters.filter((name: unknown) => typeof name === 'string') : [],
        users: Array.isArray(source.users) ? source.users.filter((name: unknown) => typeof name === 'string') : [],
        contexts: Array.isArray(source.contexts) ? source.contexts.filter((name: unknown) => typeof name === 'string') : [],
      });
    }
    if (selections.every((selection) => !selection.clusters.length && !selection.users.length && !selection.contexts.length)) {
      throw new ApiError(400, 'Select at least one entity to merge.');
    }
    const target = await readConfig(targetPath);
    mergeSelectedEntities(target, selections);
    const backupPath = await saveConfig(targetPath, target);
    response.json({ ...(await configPayload(targetPath)), backupCreated: Boolean(backupPath) });
  } catch (error) { next(error); }
});

app.delete('/api/files', async (request, response, next) => {
  try {
    const path = await selectedPath(request.body.path);
    if (path === await normalizeConfigPath(configPath)) throw new ApiError(400, 'The default kubeconfig cannot be removed from the file list.');
    registeredPaths.delete(path);
    response.json({ removed: path });
  } catch (error) { next(error); }
});

app.get('/api/config', async (request, response, next) => {
  try {
    const path = await selectedPath(request.query.path);
    response.json(await configPayload(path));
  } catch (error) { next(error); }
});

app.post('/api/entities/:kind', async (request, response, next) => {
  try {
    const kind = request.params.kind as EntityKind;
    if (!entityKinds.has(kind)) throw new ApiError(404, 'Unknown entity type.');
    const path = await selectedPath(request.query.path);
    await mutate(path, (config) => upsertEntity(config, kind, String(request.body.name ?? ''), request.body), response);
  } catch (error) { next(error); }
});

app.patch('/api/entities/:kind/:name', async (request, response, next) => {
  try {
    const kind = request.params.kind as EntityKind;
    if (!entityKinds.has(kind)) throw new ApiError(404, 'Unknown entity type.');
    const name = String(request.body.name ?? request.params.name);
    const path = await selectedPath(request.query.path);
    await mutate(path, (config) => upsertEntity(config, kind, name, { ...request.body, originalName: request.params.name }), response);
  } catch (error) { next(error); }
});

app.delete('/api/entities/:kind/:name', async (request, response, next) => {
  try {
    const kind = request.params.kind as EntityKind;
    if (!entityKinds.has(kind)) throw new ApiError(404, 'Unknown entity type.');
    const path = await selectedPath(request.query.path);
    await mutate(path, (config) => deleteEntity(config, kind, request.params.name), response);
  } catch (error) { next(error); }
});

app.put('/api/current-context', async (request, response, next) => {
  try {
    const path = await selectedPath(request.query.path);
    await mutate(path, (config) => setCurrentContext(config, String(request.body.name ?? '')), response);
  } catch (error) { next(error); }
});

app.use(express.static(resolve(process.cwd(), 'dist')));

app.use((error: any, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const status = error instanceof ApiError ? error.status : 500;
  if (status === 500) console.error('Kubeconfig operation failed.');
  response.status(status).json({ error: status === 500 ? 'Kubeconfig operation failed.' : error.message });
});

void normalizeConfigPath(configPath).then((defaultPath) => {
  defaultConfigPath = defaultPath;
  registeredPaths.add(defaultConfigPath);
  app.listen(port, '127.0.0.1', () => {
  console.log(`Kubeconfig Manager API listening on http://127.0.0.1:${port}`);
  });
});
