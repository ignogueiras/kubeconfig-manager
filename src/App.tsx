import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { AlertCircle, Boxes, Check, ChevronDown, CircleHelp, Command, Copy, Database, FileKey2, FilePlus2, FolderOpen, GitMerge, Layers3, LoaderCircle, Plus, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react';

type Cluster = { name: string; server: string; tlsServerName: string; insecureSkipTlsVerify: boolean; certificateAuthorityPresent: boolean };
type User = { name: string; authType: string };
type Context = { name: string; cluster: string; user: string; namespace: string; current: boolean };
type ConfigState = { currentContext: string; clusters: Cluster[]; users: User[]; contexts: Context[]; configPath: string; exists: boolean; isDefault: boolean; backupCreated?: boolean };
type ConfigFile = { path: string; exists: boolean; isDefault: boolean };
type MergeSourceSelection = { path: string; clusters: string[]; users: string[]; contexts: string[] };
type Kind = 'clusters' | 'contexts' | 'users';
type Tab = Kind;

const empty: ConfigState = { currentContext: '', clusters: [], users: [], contexts: [], configPath: '', exists: false, isDefault: false };
const labels: Record<Kind, string> = { clusters: 'Clusters', contexts: 'Contexts', users: 'Users' };
const mergePalette = ['#397350', '#547a8b', '#b28642', '#806b87', '#66866f', '#ad6554', '#54749a', '#8a8050'];

function mergeGroupColor(index: number) {
  return mergePalette[index] ?? `hsl(${Math.round((index * 137.508) % 360)} 30% 40%)`;
}

function fileName(path: string) {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? path;
}

function fileDirectory(path: string) {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return `/${segments.slice(0, -1).join('/')}`;
}

async function api<T = ConfigState>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Request failed.');
  return body as T;
}

export default function App() {
  const [config, setConfig] = useState<ConfigState>(empty);
  const [files, setFiles] = useState<ConfigFile[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [tab, setTab] = useState<Tab>('contexts');
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<{ kind: Kind; entity?: Cluster | User | Context } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [fileDialog, setFileDialog] = useState<'open' | 'create' | 'duplicate' | null>(null);
  const [mergeDialog, setMergeDialog] = useState(false);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    if (!selectedPath) return;
    setLoading(true);
    try {
      const next = await api(`/config?path=${encodeURIComponent(selectedPath)}`);
      setConfig(next);
      persistFiles(files.map((file) => file.path === selectedPath ? { ...file, exists: next.exists } : file));
    }
    catch (error) { setNotice({ text: (error as Error).message, error: true }); }
    finally { setLoading(false); }
  }

  function persistFiles(next: ConfigFile[]) {
    setFiles(next);
    window.localStorage.setItem('kubeconfig-manager-files', JSON.stringify(next.map((file) => file.path)));
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const listed = await api<{ files: ConfigFile[] }>('/files');
        const stored = JSON.parse(window.localStorage.getItem('kubeconfig-manager-files') ?? '[]') as string[];
        const paths = [...new Set([...listed.files.map((file) => file.path), ...stored])];
        const registered = [...listed.files];
        for (const path of paths) {
          if (!registered.some((file) => file.path === path)) {
            const file = await api<ConfigState>('/files', { method: 'POST', body: JSON.stringify({ path }) });
            registered.push({ path: file.configPath, exists: file.exists, isDefault: file.isDefault });
          }
        }
        if (!active) return;
        persistFiles(registered);
        const savedSelection = window.localStorage.getItem('kubeconfig-manager-selected-file');
        const path = registered.find((file) => file.path === savedSelection)?.path ?? registered[0]?.path ?? '';
        setSelectedPath(path);
        if (path) setConfig(await api(`/config?path=${encodeURIComponent(path)}`));
      } catch (error) {
        if (active) setNotice({ text: (error as Error).message, error: true });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  async function selectFile(path: string) {
    setSelectedPath(path);
    window.localStorage.setItem('kubeconfig-manager-selected-file', path);
    setLoading(true);
    setQuery('');
    try {
      const next = await api(`/config?path=${encodeURIComponent(path)}`);
      setConfig(next);
      persistFiles(files.map((file) => file.path === path ? { ...file, exists: next.exists } : file));
    }
    catch (error) { setNotice({ text: (error as Error).message, error: true }); }
    finally { setLoading(false); }
  }

  async function addFile(path: string) {
    setBusy(true);
    try {
      const next = await api<ConfigState>('/files', { method: 'POST', body: JSON.stringify({ path }) });
      const nextFiles = [...files.filter((file) => file.path !== next.configPath), { path: next.configPath, exists: next.exists, isDefault: next.isDefault }];
      persistFiles(nextFiles);
      setSelectedPath(next.configPath);
      window.localStorage.setItem('kubeconfig-manager-selected-file', next.configPath);
      setConfig(next);
      setFileDialog(null);
      setNotice({ text: next.exists ? 'Kubeconfig added.' : 'Missing file added. It will be created when you save an entity.' });
    } catch (error) { setNotice({ text: (error as Error).message, error: true }); }
    finally { setBusy(false); }
  }

  async function browsePath(mode: 'open' | 'save'): Promise<string | undefined> {
    setBusy(true);
    try {
      const result = await api<{ cancelled: boolean; path?: string }>('/files/browse', { method: 'POST', body: JSON.stringify({ mode }) });
      return result.cancelled ? undefined : result.path;
    } catch (error) {
      setNotice({ text: (error as Error).message, error: true });
      return undefined;
    } finally { setBusy(false); }
  }

  async function submitNewFile(path: string) {
    setBusy(true);
    try {
      const next = await api<ConfigState>('/files/create', { method: 'POST', body: JSON.stringify({ path }) });
      const nextFiles = [...files.filter((file) => file.path !== next.configPath), { path: next.configPath, exists: true, isDefault: next.isDefault }];
      persistFiles(nextFiles);
      setSelectedPath(next.configPath);
      window.localStorage.setItem('kubeconfig-manager-selected-file', next.configPath);
      setConfig(next);
      setFileDialog(null);
      setNotice({ text: 'New empty kubeconfig created. Add its first cluster, user, or context.' });
    } catch (error) { setNotice({ text: (error as Error).message, error: true }); }
    finally { setBusy(false); }
  }

  async function submitDuplicateFile(path: string) {
    setBusy(true);
    try {
      const next = await api<ConfigState>('/files/duplicate', { method: 'POST', body: JSON.stringify({ sourcePath: selectedPath, targetPath: path }) });
      persistFiles([...files.filter((file) => file.path !== next.configPath), { path: next.configPath, exists: true, isDefault: next.isDefault }]);
      setSelectedPath(next.configPath);
      window.localStorage.setItem('kubeconfig-manager-selected-file', next.configPath);
      setConfig(next);
      setFileDialog(null);
      setNotice({ text: 'Config duplicated to a new file. The original was not changed.' });
    } catch (error) { setNotice({ text: (error as Error).message, error: true }); }
    finally { setBusy(false); }
  }

  async function mergeConfigs(sources: MergeSourceSelection[]) {
    setBusy(true);
    try {
      const next = await api<ConfigState>('/files/merge', { method: 'POST', body: JSON.stringify({ targetPath: selectedPath, sources }) });
      setConfig(next);
      persistFiles(files.map((file) => file.path === selectedPath ? { ...file, exists: true } : file));
      setMergeDialog(false);
      setNotice({ text: `Selected entities merged into ${fileName(selectedPath)}.${next.backupCreated ? ' A backup was saved.' : ' The new file was created.'}` });
    } finally { setBusy(false); }
  }

  async function removeFile(path: string) {
    if (!window.confirm(`Remove ${path} from this manager? The file on disk will not be deleted.`)) return;
    setBusy(true);
    try {
      await api('/files', { method: 'DELETE', body: JSON.stringify({ path }) });
      const nextFiles = files.filter((file) => file.path !== path);
      persistFiles(nextFiles);
      if (selectedPath === path) {
        const fallback = nextFiles[0]?.path ?? '';
        setSelectedPath(fallback);
        window.localStorage.setItem('kubeconfig-manager-selected-file', fallback);
        if (fallback) setConfig(await api(`/config?path=${encodeURIComponent(fallback)}`));
        else setConfig(empty);
      }
    } catch (error) { setNotice({ text: (error as Error).message, error: true }); }
    finally { setBusy(false); }
  }

  async function copyKubectlCommand() {
    const quotedPath = selectedPath.replace(/'/g, `'"'"'`);
    await navigator.clipboard.writeText(`export KUBECONFIG='${quotedPath}'`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function saveEntity(kind: Kind, values: Record<string, unknown>, originalName?: string) {
    setBusy(true);
    try {
      const endpoint = originalName ? `/entities/${kind}/${encodeURIComponent(originalName)}` : `/entities/${kind}`;
      const path = `${endpoint}?path=${encodeURIComponent(selectedPath)}`;
      const next = await api(path, { method: originalName ? 'PATCH' : 'POST', body: JSON.stringify(values) });
      setConfig(next);
      persistFiles(files.map((file) => file.path === selectedPath ? { ...file, exists: true } : file));
      setDialog(null);
      setNotice({ text: `${labels[kind].slice(0, -1)} ${originalName ? 'updated' : 'created'} in selected file.${next.backupCreated ? ' A backup was saved.' : ' The new file was created.'}` });
    } catch (error) { setNotice({ text: (error as Error).message, error: true }); }
    finally { setBusy(false); }
  }

  async function removeEntity(kind: Kind, name: string) {
    if (!window.confirm(`Remove ${name}? A backup will be created before saving.`)) return;
    setBusy(true);
    try {
      const next = await api(`/entities/${kind}/${encodeURIComponent(name)}?path=${encodeURIComponent(selectedPath)}`, { method: 'DELETE' });
      setConfig(next);
      setNotice({ text: `${labels[kind].slice(0, -1)} removed from selected file.${next.backupCreated ? ' A backup was saved.' : ''}` });
    } catch (error) { setNotice({ text: (error as Error).message, error: true }); }
    finally { setBusy(false); }
  }

  async function activate(name: string) {
    setBusy(true);
    try {
      setConfig(await api(`/current-context?path=${encodeURIComponent(selectedPath)}`, { method: 'PUT', body: JSON.stringify({ name }) }));
      setNotice({ text: `Current context set to ${name || 'none'}.` });
    } catch (error) { setNotice({ text: (error as Error).message, error: true }); }
    finally { setBusy(false); }
  }

  const current = config.contexts.find((item) => item.name === config.currentContext);
  const tableTab = tab;
  const filtered = (config[tableTab] as Array<Cluster | Context | User>).filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));
  const tabs: Array<{ id: Tab; label: string; icon: typeof Layers3 }> = [
    { id: 'clusters', label: 'Clusters', icon: Boxes },
    { id: 'contexts', label: 'Contexts', icon: Layers3 },
    { id: 'users', label: 'Users', icon: FileKey2 },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#contexts" onClick={() => setTab('contexts')} aria-label="Kubeconfig Manager home">
          <span className="brand-mark"><Command size={19} strokeWidth={2.4} /></span>
          <span><strong>kubectl</strong><small>CONFIG DESK</small></span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${tab === id ? 'selected' : ''}`} onClick={() => { setTab(id); setQuery(''); }}>
              <Icon size={17} /><span>{label}</span><span className="nav-count">{config[id].length}</span>
            </button>
          ))}
        </nav>
        <section className="sidebar-files" aria-label="Kubeconfig files">
          <div className="sidebar-files-heading"><span>CONFIG FILES</span><span className="file-total">{files.length.toString().padStart(2, '0')}</span></div>
          <div className="sidebar-file-list">
            {files.map((file) => <div className={`sidebar-file-row ${file.path === selectedPath ? 'selected' : ''}`} key={file.path}>
              <button className="sidebar-file-choice" onClick={() => void selectFile(file.path)} title={file.path} aria-current={file.path === selectedPath ? 'page' : undefined}>
                <Database size={15} className={!file.exists ? 'file-icon-missing' : ''} />
                <span className="sidebar-file-copy"><strong>{fileName(file.path)}</strong><small>{fileDirectory(file.path)}</small></span>
                {!file.exists && <span className="missing-file-dot" title="File does not exist yet" />}
              </button>
              {!file.isDefault && <button className="sidebar-file-remove" onClick={() => void removeFile(file.path)} disabled={busy} title="Remove from list; keep file on disk" aria-label={`Remove ${file.path} from manager`}><X size={13} /></button>}
            </div>)}
            {files.length === 0 && <p className="no-files">No config files loaded.</p>}
          </div>
          <div className="sidebar-file-actions">
            <button onClick={() => setFileDialog('open')} disabled={busy} aria-label="Open config" title="Open config"><FolderOpen size={14} /><span>Open config</span></button>
            <button onClick={() => setFileDialog('duplicate')} disabled={busy || !selectedPath} aria-label="Duplicate config" title="Duplicate selected config"><Copy size={14} /><span>Duplicate config</span></button>
            <button onClick={() => setFileDialog('create')} disabled={busy} aria-label="New config" title="New config"><FilePlus2 size={14} /><span>New config</span></button>
            <button onClick={() => setMergeDialog(true)} disabled={busy || files.length < 2} aria-label="Merge configs" title="Merge configs"><GitMerge size={14} /><span>Merge configs</span></button>
          </div>
        </section>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="slash">/</span><strong>{tabs.find((item) => item.id === tab)?.label}</strong></div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Refresh kubeconfig" title="Refresh" onClick={() => void refresh()} disabled={loading || busy}><RefreshCw size={16} /></button>
          </div>
        </header>

        <div className="content-wrap">
          <section className="page-heading">
            <div>
              <div className="eyebrow">KUBERNETES CONNECTIONS</div>
              <h1>{labels[tab]}</h1>
              <p className="subtitle">Manage the clusters, identities, and contexts in one place.</p>
            </div>
            <button className="primary-button" onClick={() => setDialog({ kind: tab })}>
              <Plus size={16} /> Add {tab.slice(0, -1)}
            </button>
          </section>

          <section className="summary-grid" aria-label="Kubeconfig summary">
            <Summary icon={Boxes} label="Clusters" value={config.clusters.length} tone="green" onClick={() => setTab('clusters')} />
            <Summary icon={Layers3} label="Contexts" value={config.contexts.length} tone="blue" onClick={() => setTab('contexts')} />
            <Summary icon={FileKey2} label="Users" value={config.users.length} tone="amber" onClick={() => setTab('users')} />
            <div className="current-summary">
              <div className="current-kicker"><span className="current-icon"><Check size={14} /></span>CURRENT CONTEXT</div>
              <div className="current-name" title={current?.name ?? 'Not set'}>{current?.name ?? 'Not set'}</div>
              <div className="current-detail">{current ? `${current.cluster} · ${current.namespace || 'default'}` : 'Choose a context to get started'}</div>
              {config.contexts.length > 0 && <button className="current-select" onClick={() => setTab('contexts')}>Manage contexts <ChevronDown size={13} /></button>}
            </div>
          </section>

          {!config.exists && selectedPath && <div className="missing-file-notice"><AlertCircle size={16} /><div><strong>This config file does not exist yet.</strong><span>It will be created with owner-only permissions when you save your first entity.</span></div></div>}
          {selectedPath && <div className="kubectl-callout"><div><strong>Use this file with kubectl</strong><span>kubectl uses its default config unless you set <code>KUBECONFIG</code> in the shell where you run it.</span><code className="env-command">export KUBECONFIG='{selectedPath.replace(/'/g, `'"'"'`)}'</code></div><button className="secondary-button" onClick={() => void copyKubectlCommand()}><Copy size={14} />{copied ? 'Copied' : 'Copy command'}</button></div>}

          <section className="entity-section">
            <div className="section-header">
              <div><h2>{labels[tab]}</h2><p>{`${filtered.length} ${tableTab} configured`}</p></div>
              <label className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${tableTab}...`} aria-label={`Search ${tableTab}`} /><kbd>/</kbd></label>
            </div>
            {loading ? <div className="loading-state"><LoaderCircle className="spin" size={20} /> Loading kubeconfig</div> : filtered.length === 0 ? (
              <div className="empty-state"><span className="empty-icon"><Layers3 size={22} /></span><strong>{query ? 'No matches found' : `No ${tableTab} yet`}</strong><span>{query ? 'Try a different search.' : 'Add an entity to start organizing your Kubernetes access.'}</span>{!query && <button className="text-button" onClick={() => setDialog({ kind: tableTab })}><Plus size={15} /> Add {tableTab.slice(0, -1)}</button>}</div>
            ) : <div className="table-scroll"><table><thead><tr>{tableTab === 'clusters' ? <><th>CLUSTER</th><th>API SERVER</th><th>SECURITY</th><th className="actions-head">ACTIONS</th></> : tableTab === 'users' ? <><th>IDENTITY</th><th>AUTHENTICATION</th><th className="actions-head">ACTIONS</th></> : <><th>CONTEXT</th><th>CLUSTER</th><th>USER / NAMESPACE</th><th className="actions-head">ACTIONS</th></>}</tr></thead><tbody>{filtered.map((item: any) => <tr key={item.name} className={item.current ? 'active-row' : ''}>
              {tableTab === 'clusters' ? <><td><EntityName name={item.name} type="cluster" /></td><td><span className="server-value">{item.server}</span></td><td><span className={`security-tag ${item.insecureSkipTlsVerify ? 'warning' : ''}`}>{item.insecureSkipTlsVerify ? 'TLS verification off' : 'TLS enabled'}</span>{item.certificateAuthorityPresent && <span className="security-tag ca-tag">CA cert</span>}</td><td><RowActions onEdit={() => setDialog({ kind: 'clusters', entity: item })} onDelete={() => void removeEntity('clusters', item.name)} disabled={busy} /></td></>
              : tableTab === 'users' ? <><td><EntityName name={item.name} type="user" /></td><td><span className="auth-tag">{item.authType}</span></td><td><RowActions onEdit={() => setDialog({ kind: 'users', entity: item })} onDelete={() => void removeEntity('users', item.name)} disabled={busy} /></td></>
              : <><td><div className="context-cell"><span className={`context-indicator ${item.current ? 'is-current' : ''}`} /> <EntityName name={item.name} type="context" />{item.current && <span className="active-tag">ACTIVE</span>}</div></td><td><span className="linked-name">{item.cluster}</span></td><td><span className="linked-name">{item.user}</span><span className="namespace-note"> · {item.namespace || 'default'}</span></td><td>{item.current ? <span className="active-action"><Check size={14} /> Current</span> : <div className="row-actions"><button className="set-current" disabled={busy} onClick={() => void activate(item.name)}>Use context</button><RowActions onEdit={() => setDialog({ kind: 'contexts', entity: item })} onDelete={() => void removeEntity('contexts', item.name)} disabled={busy} /></div>}</td></>}
            </tr>)}</tbody></table></div>}
            <div className="table-footer"><span className="footer-secure"><ShieldCheck size={13} /> Existing files are backed up before changes</span></div>
          </section>

          <footer className="page-footer"><span>Kubeconfig Manager</span><span className="footer-separator">·</span><span>Local workspace</span><button className="help-button" title="About kubeconfig security" onClick={() => setNotice({ text: 'Only entity metadata is displayed. User credentials are kept in the local kubeconfig and are never sent back to this interface.' })}><CircleHelp size={14} /> Security</button></footer>
        </div>
      </main>

      {notice && <div className={`toast ${notice.error ? 'toast-error' : ''}`} role="status"><span className="toast-icon">{notice.error ? <AlertCircle size={16} /> : <Check size={16} />}</span>{notice.text}<button onClick={() => setNotice(null)} aria-label="Dismiss"><X size={15} /></button></div>}
      {fileDialog && <AddFileDialog initialMode={fileDialog} busy={busy} sourceName={fileName(selectedPath)} onClose={() => setFileDialog(null)} onAdd={(path) => void addFile(path)} onCreate={(path) => void submitNewFile(path)} onDuplicate={(path) => void submitDuplicateFile(path)} onBrowse={browsePath} />}
      {mergeDialog && <MergeDialog files={files} targetPath={selectedPath} busy={busy} onClose={() => setMergeDialog(false)} onMerge={mergeConfigs} />}
      {dialog && <EntityDialog kind={dialog.kind} entity={dialog.entity} config={config} busy={busy} onClose={() => setDialog(null)} onSave={(values) => void saveEntity(dialog.kind, values, (dialog.entity as any)?.name)} />}
    </div>
  );
}

function AddFileDialog({ initialMode, busy, sourceName, onClose, onAdd, onCreate, onDuplicate, onBrowse }: { initialMode: 'open' | 'create' | 'duplicate'; busy: boolean; sourceName: string; onClose: () => void; onAdd: (path: string) => void; onCreate: (path: string) => void; onDuplicate: (path: string) => void; onBrowse: (mode: 'open' | 'save') => Promise<string | undefined> }) {
  const [path, setPath] = useState('');
  const [mode, setMode] = useState<'open' | 'create' | 'duplicate'>(initialMode);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === 'open') onAdd(path.trim());
    else if (mode === 'create') onCreate(path.trim());
    else onDuplicate(path.trim());
  }
  async function browse() {
    const selected = await onBrowse(mode === 'open' ? 'open' : 'save');
    if (selected) setPath(selected);
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="entity-dialog file-dialog" role="dialog" aria-modal="true" aria-labelledby="file-dialog-title">
    <header className="dialog-header"><span className="dialog-icon"><FilePlus2 size={18} /></span><div><h2 id="file-dialog-title">Kubeconfig file</h2><p>Open, create, or duplicate an independent file.</p></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={17} /></button></header>
    <div className="file-mode-tabs" role="tablist" aria-label="File action"><button type="button" role="tab" aria-selected={mode === 'open'} className={mode === 'open' ? 'active' : ''} onClick={() => setMode('open')}>Open existing</button><button type="button" role="tab" aria-selected={mode === 'create'} className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>Create new</button><button type="button" role="tab" aria-selected={mode === 'duplicate'} className={mode === 'duplicate' ? 'active' : ''} onClick={() => setMode('duplicate')}>Duplicate selected</button></div>
    <form onSubmit={submit} className="dialog-form"><label className="field-label">{mode === 'open' ? 'Kubeconfig path' : 'New config path'}<span className="path-entry"><input required autoFocus value={path} onChange={(event) => setPath(event.target.value)} placeholder={mode === 'open' ? '/home/user/.kube/staging-config' : '/home/user/.kube/new-config'} /><button type="button" className="secondary-button browse-button" onClick={() => void browse()} disabled={busy}><FolderOpen size={14} /> Browse</button></span></label><p className="secret-notice"><ShieldCheck size={15} />{mode === 'open' ? 'The selected existing file is validated and managed independently.' : mode === 'create' ? 'Creates a valid empty kubeconfig and will not overwrite an existing file.' : `Copies all entities from ${sourceName} to a new file. The source is unchanged; the destination must not exist.`}</p><div className="dialog-footer"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={busy || !path.trim()}>{busy ? <LoaderCircle className="spin" size={15} /> : mode === 'open' ? <FilePlus2 size={15} /> : mode === 'create' ? <Plus size={15} /> : <Copy size={15} />}{mode === 'open' ? 'Open file' : mode === 'create' ? 'Create config' : 'Duplicate config'}</button></div></form>
  </section></div>;
}

function MergeDialog({ files, targetPath, busy, onClose, onMerge }: { files: ConfigFile[]; targetPath: string; busy: boolean; onClose: () => void; onMerge: (sources: MergeSourceSelection[]) => Promise<void> }) {
  const [sources, setSources] = useState<Array<{ file: ConfigFile; config?: ConfigState; error?: string }>>([]);
  const [selections, setSelections] = useState<Record<string, Omit<MergeSourceSelection, 'path'>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeKind, setActiveKind] = useState<Kind>('contexts');
  const sourceFiles = files.filter((file) => file.path !== targetPath);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all(sourceFiles.map(async (file) => {
      try { return { file, config: await api<ConfigState>(`/config?path=${encodeURIComponent(file.path)}`) }; }
      catch (loadError) { return { file, error: (loadError as Error).message }; }
    })).then((loaded) => { if (active) setSources(loaded); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [targetPath, files]);

  function toggle(path: string, kind: Kind, name: string, checked: boolean) {
    setSelections((current) => {
      const next = { ...(current[path] ?? { clusters: [], users: [], contexts: [] }) };
      const values = new Set(next[kind]);
      if (kind === 'contexts' && checked) {
        values.add(name);
        const context = sources.find((source) => source.file.path === path)?.config?.contexts.find((item) => item.name === name);
        if (context) {
          if (context.cluster) next.clusters = [...new Set([...next.clusters, context.cluster])];
          if (context.user) next.users = [...new Set([...next.users, context.user])];
        }
      } else if (checked) values.add(name);
      else values.delete(name);
      next[kind] = [...values];
      return { ...current, [path]: next };
    });
    setError('');
  }

  const selectedCount = Object.values(selections).reduce((count, selection) => count + selection.clusters.length + selection.users.length + selection.contexts.length, 0);
  const groupColors = new Map<string, string>();
  for (const source of sources) {
    for (const context of source.config?.contexts ?? []) {
      const key = JSON.stringify([source.file.path, context.cluster, context.user]);
      if (!groupColors.has(key)) groupColors.set(key, mergeGroupColor(groupColors.size));
    }
  }
  const selectedGroupColors: Record<string, Record<Kind, Record<string, string[]>>> = {};
  for (const source of sources) {
    const sourceSelections = selections[source.file.path];
    if (!sourceSelections) continue;
    const entityColors: Record<Kind, Record<string, string[]>> = { clusters: {}, users: {}, contexts: {} };
    for (const context of source.config?.contexts ?? []) {
      if (!sourceSelections.contexts.includes(context.name)) continue;
      const color = groupColors.get(JSON.stringify([source.file.path, context.cluster, context.user]));
      if (!color) continue;
      for (const [kind, name] of [['contexts', context.name], ['clusters', context.cluster], ['users', context.user]] as const) {
        entityColors[kind][name] = [...new Set([...(entityColors[kind][name] ?? []), color])];
      }
    }
    selectedGroupColors[source.file.path] = entityColors;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const selectedSources = sourceFiles.map((file) => ({ path: file.path, ...(selections[file.path] ?? { clusters: [], users: [], contexts: [] }) }))
      .filter((selection) => selection.clusters.length || selection.users.length || selection.contexts.length);
    if (!selectedSources.length) {
      setError('Select at least one entity to merge.');
      return;
    }
    try { await onMerge(selectedSources); }
    catch (mergeError) { setError((mergeError as Error).message); }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="entity-dialog merge-dialog" role="dialog" aria-modal="true" aria-labelledby="merge-dialog-title">
    <header className="dialog-header"><span className="dialog-icon"><GitMerge size={18} /></span><div><h2 id="merge-dialog-title">Merge configs</h2><p>Choose entities to add to {fileName(targetPath)}.</p></div><button className="icon-button" onClick={onClose} aria-label="Close dialog" disabled={busy}><X size={17} /></button></header>
    <p className="merge-guidance">Source files stay unchanged. Selecting a context also selects its cluster and user. Matching color markers identify each context group; same-name conflicts are rejected.</p>
    <form className="merge-form" onSubmit={(event) => void submit(event)}>
      <div className="merge-kind-tabs" role="tablist" aria-label="Entity type to merge">
        {(['contexts', 'clusters', 'users'] as Kind[]).map((kind) => {
          const count = sources.reduce((total, source) => total + (source.config?.[kind].length ?? 0), 0);
          return <button type="button" role="tab" aria-selected={activeKind === kind} className={activeKind === kind ? 'active' : ''} key={kind} onClick={() => setActiveKind(kind)}>{labels[kind]} <span>{count}</span></button>;
        })}
      </div>
      <div className="merge-source-list">
        {loading ? <div className="loading-state"><LoaderCircle className="spin" size={18} /> Loading source configs</div> : sources.map(({ file, config: sourceConfig, error: loadError }) => <section className="merge-source" key={file.path}>
          <div className="merge-source-heading"><Database size={14} /><div><strong>{fileName(file.path)}</strong><span>{file.path}</span></div></div>
          {loadError ? <p className="merge-error">{loadError}</p> : (() => {
            const entities = sourceConfig?.[activeKind] ?? [];
            return <div className="merge-category">{entities.length ? entities.map((entity: any) => {
              const colors = selectedGroupColors[file.path]?.[activeKind][entity.name] ?? [];
              const rowStyle = colors.length ? { '--merge-group-color': colors[0] } as CSSProperties : undefined;
              return <label className={`merge-item ${colors.length ? 'has-merge-group' : ''}`} key={entity.name} style={rowStyle}><input type="checkbox" checked={(selections[file.path]?.[activeKind] ?? []).includes(entity.name)} onChange={(event) => toggle(file.path, activeKind, entity.name, event.target.checked)} /><span><strong>{entity.name}</strong>{activeKind === 'contexts' ? <small>{entity.cluster} · {entity.user}</small> : activeKind === 'clusters' ? <small>{entity.server}</small> : <small>{entity.authType}</small>}</span>{colors.length > 0 && <span className="merge-color-markers" aria-label={`${colors.length} context group${colors.length === 1 ? '' : 's'}`} title={`${colors.length} context group${colors.length === 1 ? '' : 's'}`}>{colors.map((color) => <i key={color} style={{ backgroundColor: color }} />)}</span>}</label>;
            }) : <p className="merge-empty">No {labels[activeKind].toLowerCase()} in this file.</p>}</div>;
          })()}
        </section>)}
        {!loading && !sources.length && <p className="merge-empty">Open another kubeconfig before merging.</p>}
      </div>
      {error && <p className="merge-error" role="alert">{error}</p>}
      <div className="dialog-footer"><span className="merge-selected-count">{selectedCount} selected</span><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="primary-button" disabled={busy || loading || selectedCount === 0}>{busy ? <LoaderCircle className="spin" size={15} /> : <GitMerge size={15} />}Merge into destination</button></div>
    </form>
  </section></div>;
}

function Summary({ icon: Icon, label, value, tone, onClick }: { icon: typeof Boxes; label: string; value: number; tone: string; onClick: () => void }) {
  return <button className="summary-card" onClick={onClick}><span className={`summary-icon ${tone}`}><Icon size={18} /></span><span className="summary-copy"><span>{label}</span><strong>{value.toString().padStart(2, '0')}</strong></span><span className="summary-arrow">↗</span></button>;
}

function EntityName({ name, type }: { name: string; type: 'cluster' | 'context' | 'user' }) {
  return <div className="entity-name"><span className={`entity-dot ${type}`} /> <strong>{name}</strong></div>;
}

function RowActions({ onEdit, onDelete, disabled }: { onEdit: () => void; onDelete: () => void; disabled: boolean }) {
  return <div className="row-actions"><button className="edit-action" onClick={onEdit} disabled={disabled}>Edit</button><button className="delete-action" onClick={onDelete} disabled={disabled} aria-label="Delete" title="Delete"><Trash2 size={15} /></button></div>;
}

function EntityDialog({ kind, entity, config, busy, onClose, onSave }: { kind: Kind; entity?: Cluster | User | Context; config: ConfigState; busy: boolean; onClose: () => void; onSave: (values: Record<string, unknown>) => void }) {
  const editing = Boolean(entity);
  const [name, setName] = useState(entity?.name ?? '');
  const [updateReferences, setUpdateReferences] = useState(true);
  const [server, setServer] = useState((entity as Cluster)?.server ?? '');
  const [tlsServerName, setTlsServerName] = useState((entity as Cluster)?.tlsServerName ?? '');
  const [insecure, setInsecure] = useState((entity as Cluster)?.insecureSkipTlsVerify ?? false);
  const [authType, setAuthType] = useState((entity as User)?.authType ?? 'token');
  const [token, setToken] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [clientCertificate, setClientCertificate] = useState('');
  const [clientKey, setClientKey] = useState('');
  const [cluster, setCluster] = useState((entity as Context)?.cluster ?? config.clusters[0]?.name ?? '');
  const [user, setUser] = useState((entity as Context)?.user ?? config.users[0]?.name ?? '');
  const [namespace, setNamespace] = useState((entity as Context)?.namespace ?? 'default');
  const referenceKey = kind === 'clusters' ? 'cluster' : 'user';
  const affectedContexts = editing && (kind === 'clusters' || kind === 'users') && name !== entity?.name
    ? config.contexts.filter((context) => context[referenceKey] === entity?.name)
    : [];

  function submit(event: FormEvent) {
    event.preventDefault();
    const common = { name, originalName: entity?.name, updateReferences };
    if (kind === 'clusters') onSave({ ...common, server, tlsServerName, insecureSkipTlsVerify: insecure });
    else if (kind === 'users') onSave({ ...common, authType, token, command, args: args.split(/\s+/).filter(Boolean), username, password, clientCertificate, clientKey });
    else onSave({ ...common, cluster, user, namespace });
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="entity-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
    <header className="dialog-header"><span className="dialog-icon">{kind === 'clusters' ? <Boxes size={18} /> : kind === 'users' ? <FileKey2 size={18} /> : <Layers3 size={18} />}</span><div><h2 id="dialog-title">{editing ? 'Edit' : 'Add'} {labels[kind].slice(0, -1).toLowerCase()}</h2><p>Changes are validated and backed up before saving.</p></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={17} /></button></header>
    <form onSubmit={submit} className="dialog-form"><label className="field-label">Name<input required maxLength={253} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. production-eu" /></label>
      {affectedContexts.length > 0 && <div className="reference-update"><div><strong>Used by {affectedContexts.length} {affectedContexts.length === 1 ? 'context' : 'contexts'}</strong><span>{affectedContexts.map((context) => context.name).join(', ')}</span></div><label><input type="checkbox" checked={updateReferences} onChange={(event) => setUpdateReferences(event.target.checked)} /><span>Update these references to the new name</span></label>{!updateReferences && <small>Saving is blocked to prevent these contexts from pointing to a missing name.</small>}</div>}
      {kind === 'clusters' && <><label className="field-label">API server<input type="url" required value={server} onChange={(event) => setServer(event.target.value)} placeholder="https://api.example.com:6443" /></label><label className="field-label">TLS server name <span className="optional">OPTIONAL</span><input value={tlsServerName} onChange={(event) => setTlsServerName(event.target.value)} placeholder="Override certificate hostname" /></label><label className="toggle-field"><span><strong>Skip TLS verification</strong><small>Use only for clusters with a trusted network boundary.</small></span><input type="checkbox" checked={insecure} onChange={(event) => setInsecure(event.target.checked)} /></label></>}
      {kind === 'users' && <><label className="field-label">Authentication method<select value={authType} onChange={(event) => setAuthType(event.target.value)}><option value="token">Bearer token</option><option value="exec">Exec plugin</option><option value="certificate">Client certificate</option><option value="basic">Username and password</option>{authType === 'auth-provider' && <option value="auth-provider" disabled>Auth provider (preserved)</option>}</select></label>{authType === 'token' ? <label className="field-label">Bearer token <span className="optional">WRITE ONLY</span><input type="password" autoComplete="new-password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={editing ? 'Leave blank to keep existing credential' : 'Paste token'} /></label> : authType === 'exec' ? <><label className="field-label">Command<input required={!editing} value={command} onChange={(event) => setCommand(event.target.value)} placeholder={editing ? 'Leave blank to keep existing command' : 'e.g. aws'} /></label><label className="field-label">Arguments <span className="optional">SPACE SEPARATED</span><input value={args} onChange={(event) => setArgs(event.target.value)} placeholder={editing ? 'Leave blank to keep existing arguments' : 'eks get-token --cluster-name ...'} /></label></> : authType === 'certificate' ? <><label className="field-label">Client certificate path<input value={clientCertificate} onChange={(event) => setClientCertificate(event.target.value)} placeholder={editing ? 'Leave blank to keep existing certificate' : '/path/to/client.crt'} /></label><label className="field-label">Client key path<input type="password" autoComplete="new-password" value={clientKey} onChange={(event) => setClientKey(event.target.value)} placeholder={editing ? 'Leave blank to keep existing key' : '/path/to/client.key'} /></label></> : authType === 'basic' ? <><label className="field-label">Username<input value={username} onChange={(event) => setUsername(event.target.value)} placeholder={editing ? 'Leave blank to keep existing username' : 'Username'} /></label><label className="field-label">Password <span className="optional">WRITE ONLY</span><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={editing ? 'Leave blank to keep existing password' : 'Password'} /></label></> : <p className="secret-notice"><ShieldCheck size={15} /> This auth-provider configuration is preserved as-is. You can rename this user without exposing provider credentials.</p>}<p className="secret-notice"><ShieldCheck size={15} /> Stored credentials and exec arguments are never displayed. Leave fields blank to preserve them.</p></>}
      {kind === 'contexts' && <><label className="field-label">Cluster<select required value={cluster} onChange={(event) => setCluster(event.target.value)}><option value="" disabled>Select cluster</option>{config.clusters.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label><label className="field-label">User<select required value={user} onChange={(event) => setUser(event.target.value)}><option value="" disabled>Select user</option>{config.users.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label><label className="field-label">Namespace<input value={namespace} onChange={(event) => setNamespace(event.target.value)} placeholder="default" /></label>{(config.clusters.length === 0 || config.users.length === 0) && <p className="form-warning">Add at least one cluster and one user before creating a context.</p>}</>}
      <div className="dialog-footer"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={busy || (kind === 'contexts' && (!config.clusters.length || !config.users.length))}>{busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{editing ? 'Save changes' : 'Create'} </button></div>
    </form>
  </section></div>;
}
