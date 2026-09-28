import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configExists, createConfigFile, createConfigFileFromData, deleteEntity, mergeConfigYaml, mergeSelectedEntities, normalizeConfigPath, readConfig, sanitizeConfig, saveConfig, setCurrentContext, upsertEntity, upsertRawEntity, type KubeConfig } from './kubeconfig.js';

const folders: string[] = [];

async function temporaryFile() {
  const folder = await mkdtemp(join(tmpdir(), 'kubeconfig-manager-'));
  folders.push(folder);
  return { folder, file: join(folder, 'config') };
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

function fixture(): KubeConfig {
  return {
    apiVersion: 'v1',
    kind: 'Config',
    clusters: [{ name: 'prod', cluster: { server: 'https://prod.example.test', 'certificate-authority-data': 'private-ca' } }],
    users: [{ name: 'operator', user: { token: 'very-secret-token' } }],
    contexts: [{ name: 'prod-admin', context: { cluster: 'prod', user: 'operator', namespace: 'operations' } }],
    'current-context': 'prod-admin',
  };
}

describe('kubeconfig entity operations', () => {
  it('sanitizes credentials while preserving usable entity metadata', () => {
    const result = JSON.stringify(sanitizeConfig(fixture()));
    expect(result).toContain('prod');
    expect(result).toContain('certificateAuthorityPresent');
    expect(result).not.toContain('very-secret-token');
    expect(result).not.toContain('private-ca');
  });

  it('does not expose exec-plugin commands or arguments', () => {
    const config = fixture();
    config.users[0].user = { exec: { command: 'cluster-auth', args: ['--token', 'exec-secret'] } };
    const result = JSON.stringify(sanitizeConfig(config));
    expect(result).toContain('"authType":"exec"');
    expect(result).not.toContain('cluster-auth');
    expect(result).not.toContain('exec-secret');
    expect(result).not.toContain('--token');
  });

  it('preserves existing exec arguments when edit fields are blank', () => {
    const config = fixture();
    config.users[0].user = { exec: { command: 'cluster-auth', args: ['--token', 'exec-secret'] } };
    upsertEntity(config, 'users', 'operator', { originalName: 'operator', authType: 'exec', command: '', args: [] });
    expect(config.users[0].user.exec).toMatchObject({ command: 'cluster-auth', args: ['--token', 'exec-secret'] });
  });

  it('renames an entity and updates dependent references', () => {
    const config = fixture();
    upsertEntity(config, 'clusters', 'production', { originalName: 'prod', server: 'https://prod.example.test', updateReferences: true });
    expect(config.contexts[0].context.cluster).toBe('production');
    expect(() => deleteEntity(config, 'clusters', 'production')).toThrow(/Used by context/);
  });

  it('rejects referenced renames when automatic context updates are declined', () => {
    const config = fixture();
    config.contexts.push({ name: 'prod-readonly', context: { cluster: 'prod', user: 'operator' } });
    expect(() => upsertEntity(config, 'clusters', 'production', {
      originalName: 'prod',
      server: 'https://prod.example.test',
      updateReferences: false,
    })).toThrow(/prod-admin, prod-readonly/);
    expect(config.clusters[0].name).toBe('prod');
    expect(config.contexts.every((context: any) => context.context.cluster === 'prod')).toBe(true);
  });

  it('updates only contexts that reference a renamed user', () => {
    const config = fixture();
    config.contexts.push({ name: 'staging-admin', context: { cluster: 'prod', user: 'other-user' } });
    upsertEntity(config, 'users', 'operator-v2', {
      originalName: 'operator',
      authType: 'token',
      token: '',
      updateReferences: true,
    });
    expect(config.contexts[0].context.user).toBe('operator-v2');
    expect(config.contexts[1].context.user).toBe('other-user');
  });

  it('preserves an existing token when an edit leaves the write-only field blank', () => {
    const config = fixture();
    upsertEntity(config, 'users', 'operator', { originalName: 'operator', authType: 'token', token: '' });
    expect(config.users[0].user.token).toBe('very-secret-token');
  });

  it('preserves certificate data and basic credentials on blank edits', () => {
    const config = fixture();
    config.users = [
      { name: 'certificate-user', user: { 'client-certificate-data': 'private-cert', 'client-key-data': 'private-key' } },
      { name: 'basic-user', user: { username: 'private-user', password: 'private-password' } },
    ];
    upsertEntity(config, 'users', 'certificate-user', { originalName: 'certificate-user', authType: 'certificate' });
    upsertEntity(config, 'users', 'basic-user', { originalName: 'basic-user', authType: 'basic' });
    expect(config.users[0].user['client-certificate-data']).toBe('private-cert');
    expect(config.users[0].user['client-key-data']).toBe('private-key');
    expect(config.users[1].user).toMatchObject({ username: 'private-user', password: 'private-password' });
    const result = JSON.stringify(sanitizeConfig(config));
    expect(result).not.toContain('private-cert');
    expect(result).not.toContain('private-key');
    expect(result).not.toContain('private-password');
  });

  it('preserves auth-provider data when renaming a user', () => {
    const config = fixture();
    config.users = [{ name: 'oidc-user', user: { 'auth-provider': { name: 'oidc', config: { 'client-secret': 'provider-secret' } } } }];
    upsertEntity(config, 'users', 'renamed-oidc-user', { originalName: 'oidc-user', authType: 'auth-provider' });
    expect(config.users[0].name).toBe('renamed-oidc-user');
    expect(config.users[0].user['auth-provider'].config['client-secret']).toBe('provider-secret');
    expect(JSON.stringify(sanitizeConfig(config))).not.toContain('provider-secret');
  });

  it('requires existing cluster and user references when creating a context', () => {
    expect(() => upsertEntity(fixture(), 'contexts', 'broken', { cluster: 'missing', user: 'operator' })).toThrow(/existing cluster/);
  });

  it('clears the current context when that context is deleted', () => {
    const config = fixture();
    deleteEntity(config, 'contexts', 'prod-admin');
    expect(config['current-context']).toBe('');
  });

  it('sets only an existing context as current', () => {
    const config = fixture();
    setCurrentContext(config, 'prod-admin');
    expect(config['current-context']).toBe('prod-admin');
    expect(() => setCurrentContext(config, 'missing')).toThrow(/Context not found/);
  });

  it('merges only selected entities and preserves their full kubeconfig data', () => {
    const target: KubeConfig = { kind: 'Config', clusters: [], users: [], contexts: [] };
    mergeSelectedEntities(target, [{ config: fixture(), clusters: ['prod'], users: [], contexts: [] }]);
    expect(target.clusters).toEqual(fixture().clusters);
    expect(target.users).toEqual([]);
    expect(target.contexts).toEqual([]);
  });

  it('requires selected context dependencies and rejects conflicting entity names', () => {
    const source = fixture();
    const target: KubeConfig = { kind: 'Config', clusters: [], users: [], contexts: [] };
    expect(() => mergeSelectedEntities(target, [{ config: source, clusters: [], users: [], contexts: ['prod-admin'] }])).toThrow(/select its cluster/);
    target.clusters = [{ name: 'prod', cluster: { server: 'https://other.example.test' } }];
    expect(() => mergeSelectedEntities(target, [{ config: source, clusters: ['prod'], users: [], contexts: [] }])).toThrow(/different entity/);
  });

  it('accepts full raw entity mappings while sanitizing their credentials', () => {
    const config = fixture();
    upsertRawEntity(config, 'users', `name: raw-user\nuser:\n  token: raw-secret\n  auth-provider:\n    name: custom\n    config:\n      client-secret: provider-secret\n`);
    expect(config.users.find((entry: any) => entry.name === 'raw-user').user['auth-provider'].config['client-secret']).toBe('provider-secret');
    const summary = JSON.stringify(sanitizeConfig(config));
    expect(summary).not.toContain('raw-secret');
    expect(summary).not.toContain('provider-secret');
  });

  it('validates raw entity shapes, context references, and rename propagation', () => {
    const config = fixture();
    expect(() => upsertRawEntity(config, 'clusters', 'name: incomplete\ncluster: {}')).toThrow(/HTTP or HTTPS/);
    expect(() => upsertRawEntity(config, 'contexts', 'name: broken\ncontext:\n  cluster: missing\n  user: operator')).toThrow(/existing cluster/);
    expect(() => upsertRawEntity(config, 'clusters', 'name: renamed-prod\ncluster:\n  server: https://prod.example.test', 'prod')).toThrow(/Rename affects contexts/);
    upsertRawEntity(config, 'clusters', 'name: renamed-prod\ncluster:\n  server: https://prod.example.test', 'prod', true);
    expect(config.contexts[0].context.cluster).toBe('renamed-prod');
  });

  it('pastes a complete kubeconfig into the target without exposing secrets', () => {
    const target: KubeConfig = { kind: 'Config', clusters: [], users: [], contexts: [], 'current-context': '' };
    const source = `apiVersion: v1\nkind: Config\nclusters:\n  - name: pasted-cluster\n    cluster:\n      server: https://pasted.example.test\nusers:\n  - name: pasted-user\n    user:\n      token: pasted-secret\ncontexts:\n  - name: pasted-context\n    context:\n      cluster: pasted-cluster\n      user: pasted-user\n`;
    mergeConfigYaml(target, source);
    expect(target.contexts[0].name).toBe('pasted-context');
    expect(target.users[0].user.token).toBe('pasted-secret');
    expect(JSON.stringify(sanitizeConfig(target))).not.toContain('pasted-secret');
  });

  it('rejects malformed full configs and duplicate pasted names without echoing source data', () => {
    const target: KubeConfig = { kind: 'Config', clusters: [], users: [], contexts: [] };
    expect(() => mergeConfigYaml(target, 'kind: Config\nusers: [')).toThrow('Enter a valid kubeconfig YAML document.');
    const duplicate = `kind: Config\nclusters:\n  - name: duplicate\n    cluster:\n      server: https://one.example.test\n  - name: duplicate\n    cluster:\n      server: https://two.example.test\n`;
    expect(() => mergeConfigYaml(target, duplicate)).toThrow(/duplicate cluster names/);
  });
});

describe('kubeconfig persistence', () => {
  it('loads a missing file as an empty config', async () => {
    const { file } = await temporaryFile();
    await expect(readConfig(file)).resolves.toMatchObject({ kind: 'Config', clusters: [], users: [], contexts: [] });
    await expect(configExists(file)).resolves.toBe(false);
  });

  it('accepts ~/ paths and rejects relative paths', async () => {
    await expect(normalizeConfigPath('~/some-kubeconfig')).resolves.toBe(join(process.env.HOME ?? '', 'some-kubeconfig'));
    await expect(normalizeConfigPath('relative-config')).rejects.toThrow(/absolute path/);
  });

  it('rejects invalid YAML instead of treating it as an empty config', async () => {
    const { file } = await temporaryFile();
    await writeFile(file, 'clusters: [\n');
    await expect(readConfig(file)).rejects.toThrow(/Invalid kubeconfig YAML/);
  });

  it('backs up the previous file and keeps the kubeconfig private', async () => {
    const { folder, file } = await temporaryFile();
    await saveConfig(file, fixture());
    await saveConfig(file, { ...fixture(), 'current-context': '' });
    const files = await readdir(folder);
    expect(files.some((name) => name.startsWith('config.backup-'))).toBe(true);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await readFile(file, 'utf8'))).toContain('kind: Config');
  });

  it('creates a missing config only on save and does not report a nonexistent backup', async () => {
    const { folder } = await temporaryFile();
    const file = join(folder, 'new', 'config');
    const initial = await readConfig(file);
    expect(await configExists(file)).toBe(false);
    await expect(saveConfig(file, initial)).resolves.toBeUndefined();
    expect(await configExists(file)).toBe(true);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readConfig(file)).toMatchObject({ kind: 'Config', clusters: [] });
  });

  it('creates a valid empty kubeconfig from scratch and refuses to overwrite', async () => {
    const { folder } = await temporaryFile();
    const file = join(folder, 'created', 'config');
    await createConfigFile(file);
    expect(await readConfig(file)).toMatchObject({ kind: 'Config', clusters: [], users: [], contexts: [] });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await expect(createConfigFile(file)).rejects.toThrow(/already exists/);
    expect(await readConfig(file)).toMatchObject({ clusters: [] });
  });

  it('duplicates a validated kubeconfig to a private, new file without overwriting', async () => {
    const { folder } = await temporaryFile();
    const copy = join(folder, 'copies', 'config');
    await createConfigFileFromData(copy, fixture());
    expect((await readConfig(copy)).users[0].user.token).toBe('very-secret-token');
    expect((await stat(copy)).mode & 0o777).toBe(0o600);
    await expect(createConfigFileFromData(copy, fixture())).rejects.toThrow(/already exists/);
  });

  it('keeps two config files independent when one is saved', async () => {
    const { folder } = await temporaryFile();
    const first = join(folder, 'first', 'config');
    const second = join(folder, 'second', 'config');
    const firstConfig = fixture();
    const secondConfig = { ...fixture(), clusters: [{ name: 'staging', cluster: { server: 'https://staging.example.test' } }] };
    await saveConfig(first, firstConfig);
    await saveConfig(second, secondConfig);
    firstConfig['current-context'] = '';
    await saveConfig(first, firstConfig);
    expect((await readConfig(first))['current-context']).toBe('');
    expect((await readConfig(second))['current-context']).toBe('prod-admin');
    expect((await readConfig(second)).clusters[0].name).toBe('staging');
  });
});
