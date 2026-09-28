import { readFile, writeFile, mkdir, copyFile, chmod, rename, realpath, stat, open } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { stringify, parseDocument } from 'yaml';

export type EntityKind = 'clusters' | 'users' | 'contexts';
export type KubeConfig = Record<string, any>;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function normalizeConfigPath(input: unknown): Promise<string> {
  if (typeof input !== 'string' || !input) throw new ApiError(400, 'Enter an absolute kubeconfig file path.');
  const expanded = input === '~' ? homedir() : input.startsWith('~/') ? join(homedir(), input.slice(2)) : input;
  if (!isAbsolute(expanded)) throw new ApiError(400, 'Enter an absolute path or a path under your home directory.');
  const path = resolve(expanded);
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) throw new ApiError(400, 'The selected path is not a file.');
    return await realpath(path);
  } catch (error: any) {
    if (error instanceof ApiError) throw error;
    if (error.code !== 'ENOENT') throw error;
    return path;
  }
}

export async function configExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error: any) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function createConfigFile(path: string): Promise<void> {
  const config: KubeConfig = { apiVersion: 'v1', kind: 'Config', clusters: [], users: [], contexts: [], 'current-context': '' };
  const content = stringify(config);
  const document = parseDocument(content, { uniqueKeys: true });
  if (document.errors.length) throw new ApiError(400, 'Refusing to create invalid YAML.');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
  } catch (error: any) {
    if (error.code === 'EEXIST') throw new ApiError(409, 'A file already exists at this path. Add the existing file instead.');
    throw error;
  }
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function sanitizeConfig(config: KubeConfig) {
  const clusters = (config.clusters ?? []).map(({ name, cluster = {} }: any) => ({
    name,
    server: cluster.server ?? '',
    tlsServerName: cluster['tls-server-name'] ?? '',
    insecureSkipTlsVerify: Boolean(cluster['insecure-skip-tls-verify']),
    certificateAuthorityPresent: Boolean(cluster['certificate-authority'] || cluster['certificate-authority-data']),
  }));
  const users = (config.users ?? []).map(({ name, user = {} }: any) => ({
    name,
    authType: getAuthType(user),
  }));
  const currentContext = config['current-context'] ?? '';
  const contexts = (config.contexts ?? []).map(({ name, context = {} }: any) => ({
    name,
    cluster: context.cluster ?? '',
    user: context.user ?? '',
    namespace: context.namespace ?? 'default',
    current: name === currentContext,
  }));
  return { currentContext, clusters, users, contexts };
}

function getAuthType(user: Record<string, any>): string {
  if (user.exec) return 'exec';
  if (user['client-certificate'] || user['client-certificate-data']) return 'certificate';
  if (user.token || user['tokenFile']) return 'token';
  if (user['auth-provider']) return 'auth-provider';
  if (user.username || user.password) return 'basic';
  return 'none';
}

export function upsertEntity(config: KubeConfig, kind: EntityKind, name: string, input: Record<string, any>) {
  validateName(name);
  const entries: any[] = config[kind] ?? [];
  const index = entries.findIndex((entry) => entry.name === input.originalName || entry.name === name);
  const prior = index >= 0 ? entries[index] : undefined;
  const previousName = prior?.name;
  const value = makeEntity(kind, name, input, prior, config);

  if (previousName && previousName !== name) {
    if (kind === 'clusters' || kind === 'users') {
      for (const item of config.contexts ?? []) {
        const refKey = kind === 'clusters' ? 'cluster' : 'user';
        if (item.context?.[refKey] === previousName) item.context[refKey] = name;
      }
    } else if (config['current-context'] === previousName) {
      config['current-context'] = name;
    }
  }

  if (index >= 0) entries[index] = value;
  else entries.push(value);
  config[kind] = entries;
  return sanitizeConfig(config);
}

function makeEntity(kind: EntityKind, name: string, input: Record<string, any>, prior: any, config: KubeConfig) {
  if (kind === 'clusters') {
    const server = String(input.server ?? '').trim();
    if (!server || !/^https?:\/\//i.test(server)) throw new ApiError(400, 'Cluster server must be an HTTP or HTTPS URL.');
    const cluster = { ...(prior?.cluster ?? {}) };
    cluster.server = server;
    if (input.tlsServerName) cluster['tls-server-name'] = String(input.tlsServerName).trim();
    else delete cluster['tls-server-name'];
    if (input.insecureSkipTlsVerify) cluster['insecure-skip-tls-verify'] = true;
    else delete cluster['insecure-skip-tls-verify'];
    if (input.certificateAuthority) {
      cluster['certificate-authority'] = String(input.certificateAuthority).trim();
      delete cluster['certificate-authority-data'];
    }
    return { name, cluster };
  }

  if (kind === 'users') {
    const user = { ...(prior?.user ?? {}) };
    const authType = String(input.authType ?? 'token');
    if (authType === 'token') {
      const token = String(input.token ?? '');
      if (token) user.token = token;
      if (!user.token && !user['tokenFile']) throw new ApiError(400, 'Enter a token for this user.');
      delete user.exec;
      delete user['client-certificate'];
      delete user['client-certificate-data'];
      delete user['client-key'];
      delete user['client-key-data'];
      delete user['auth-provider'];
      delete user.username;
      delete user.password;
    } else if (authType === 'exec') {
      const oldExec = user.exec ?? {};
      const command = String(input.command ?? '').trim() || oldExec.command;
      if (!command) throw new ApiError(400, 'Enter an executable command.');
      const args = Array.isArray(input.args) && input.args.length ? input.args.map(String) : oldExec.args ?? [];
      user.exec = { ...oldExec, apiVersion: oldExec.apiVersion ?? 'client.authentication.k8s.io/v1', command, args, interactiveMode: oldExec.interactiveMode ?? 'IfAvailable' };
      delete user.token;
      delete user['tokenFile'];
      delete user['client-certificate'];
      delete user['client-certificate-data'];
      delete user['client-key'];
      delete user['client-key-data'];
      delete user['auth-provider'];
      delete user.username;
      delete user.password;
    } else if (authType === 'certificate') {
      const certificate = String(input.clientCertificate ?? '').trim();
      const key = String(input.clientKey ?? '').trim();
      if (certificate) {
        user['client-certificate'] = certificate;
        delete user['client-certificate-data'];
      }
      if (key) {
        user['client-key'] = key;
        delete user['client-key-data'];
      }
      if (!(user['client-certificate'] || user['client-certificate-data']) || !(user['client-key'] || user['client-key-data'])) {
        throw new ApiError(400, 'A client certificate and key are required.');
      }
      delete user.exec;
      delete user.token;
      delete user['tokenFile'];
      delete user['auth-provider'];
      delete user.username;
      delete user.password;
    } else if (authType === 'basic') {
      const username = String(input.username ?? '').trim() || user.username;
      const password = String(input.password ?? '') || user.password;
      if (!username || !password) throw new ApiError(400, 'A username and password are required.');
      user.username = username;
      user.password = password;
      delete user.exec;
      delete user.token;
      delete user['tokenFile'];
      delete user['client-certificate'];
      delete user['client-certificate-data'];
      delete user['client-key'];
      delete user['client-key-data'];
      delete user['auth-provider'];
    } else if (authType === 'auth-provider' && user['auth-provider']) {
      return { name, user };
    } else {
      throw new ApiError(400, 'Choose a supported authentication method.');
    }
    return { name, user };
  }

  const cluster = String(input.cluster ?? '').trim();
  const user = String(input.user ?? '').trim();
  if (!cluster || !user) throw new ApiError(400, 'A context needs both a cluster and a user.');
  if (!(config.clusters ?? []).some((entry: any) => entry.name === cluster)) throw new ApiError(400, 'Select an existing cluster.');
  if (!(config.users ?? []).some((entry: any) => entry.name === user)) throw new ApiError(400, 'Select an existing user.');
  const context = { ...(prior?.context ?? {}), cluster, user };
  if (input.namespace) context.namespace = String(input.namespace).trim();
  else delete context.namespace;
  return { name, context };
}

export function deleteEntity(config: KubeConfig, kind: EntityKind, name: string) {
  const entries: any[] = config[kind] ?? [];
  if (!entries.some((entry) => entry.name === name)) throw new ApiError(404, 'Entity not found.');
  if (kind === 'clusters' || kind === 'users') {
    const refKey = kind === 'clusters' ? 'cluster' : 'user';
    const references = (config.contexts ?? []).filter((entry: any) => entry.context?.[refKey] === name).map((entry: any) => entry.name);
    if (references.length) throw new ApiError(409, `Used by context${references.length > 1 ? 's' : ''}: ${references.join(', ')}.`);
  }
  config[kind] = entries.filter((entry) => entry.name !== name);
  if (kind === 'contexts' && config['current-context'] === name) config['current-context'] = '';
  return sanitizeConfig(config);
}

export function setCurrentContext(config: KubeConfig, name: string) {
  if (name && !(config.contexts ?? []).some((entry: any) => entry.name === name)) throw new ApiError(404, 'Context not found.');
  config['current-context'] = name;
  return sanitizeConfig(config);
}

function validateName(name: string) {
  if (!name || name.length > 253 || /[\u0000-\u001f]/.test(name)) throw new ApiError(400, 'Enter a valid name (1 to 253 characters).');
}

export async function readConfig(path: string): Promise<KubeConfig> {
  try {
    const source = await readFile(path, 'utf8');
    const document = parseDocument(source, { uniqueKeys: true });
    if (document.errors.length) throw new ApiError(400, 'Invalid kubeconfig YAML. Check the file syntax and try again.');
    const value = document.toJS() as KubeConfig;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'Kubeconfig must be a YAML mapping.');
    if (value.kind !== 'Config') throw new ApiError(400, 'The selected file is not a Kubernetes kubeconfig.');
    for (const key of ['clusters', 'users', 'contexts']) {
      if (value[key] !== undefined && !Array.isArray(value[key])) throw new ApiError(400, `Kubeconfig ${key} must be a list.`);
    }
    return value;
  } catch (error: any) {
    if (error instanceof ApiError) throw error;
    if (error.code === 'ENOENT') return { apiVersion: 'v1', kind: 'Config', clusters: [], users: [], contexts: [], 'current-context': '' };
    throw error;
  }
}

export async function saveConfig(path: string, config: KubeConfig): Promise<string | undefined> {
  if (!config || typeof config !== 'object' || config.kind !== 'Config') throw new ApiError(400, 'Refusing to save a non-kubeconfig document.');
  const serialized = stringify(config);
  const parsed = parseDocument(serialized, { uniqueKeys: true });
  if (parsed.errors.length) throw new ApiError(400, 'Refusing to save invalid YAML.');
  let targetPath = path;
  try { targetPath = await realpath(path); }
  catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  const directory = dirname(targetPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  let backupPath: string | undefined;
  try {
    backupPath = `${targetPath}.backup-${timestamp}`;
    await copyFile(targetPath, backupPath);
    await chmod(backupPath, 0o600);
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
    backupPath = undefined;
  }
  const tempPath = `${targetPath}.tmp-${process.pid}`;
  await writeFile(tempPath, serialized, { encoding: 'utf8', mode: 0o600 });
  await rename(tempPath, targetPath);
  await chmod(targetPath, 0o600);
  return backupPath;
}
