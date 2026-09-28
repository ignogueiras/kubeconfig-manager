# Files and Security

## File boundaries

The manager starts with `~/.kube/config`. Additional paths are made available only after you explicitly open or create them. Every screen and entity action is scoped to the selected kubeconfig; the manager does not merge, copy, or synchronize entities between files.

The selected path list and last selection are saved in the browser's local storage. The server keeps the currently registered paths in memory while it runs. Removing a path from the interface unregisters it but leaves the file and its backups on disk.

A missing path is not created just by selecting or viewing it. It is created on the first successful entity save. **New config** is different: it creates an empty kubeconfig immediately. New-file creation uses exclusive file creation, so it fails instead of overwriting an existing path.

## Credentials and API responses

The API binds to `127.0.0.1` and accepts state-changing requests only from a local browser origin. The interface receives entity metadata rather than raw kubeconfig objects. It does not return token values, certificate or key data, passwords, or exec-plugin arguments. Credential inputs are write-only; blank inputs preserve existing credentials when the selected authentication mode supports that behavior.

The manager does not log request bodies or raw operation errors. Treat the machine and browser profile as trusted: the tool edits local credential files, and browser extensions or other local processes are outside its protection boundary.

## Validation and writes

Existing kubeconfig YAML is parsed and checked before editing. Invalid YAML is rejected rather than treated as an empty config. The serialized document is validated before saving.

Before replacing an existing config, the manager creates a timestamped sibling backup. A first write to a path that does not yet exist has no prior contents to back up. Config and backup files are written with owner-only permissions (`0600`); newly created parent directories use owner-only permissions (`0700`).

The manager does not delete backups, inspect cluster reachability, run `kubectl`, or change a running shell's environment. Set `KUBECONFIG` in the shell that launches `kubectl` when you need it to use a non-default file.

## Native file chooser

The packaged Electron app opens the operating system's native file chooser and passes only the selected path to its localhost server. In browser-based development or production-server mode, Linux uses `zenity` or `kdialog` when available; if neither is installed, enter a path manually. In both modes, file contents are read and written by the local server rather than uploaded through the browser.
