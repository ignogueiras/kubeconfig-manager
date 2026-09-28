# Kubeconfig Manager

A local interface for organizing Kubernetes clusters, users, and contexts across independent kubeconfig files.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm run dev
```

Open the Vite URL printed in the terminal (normally `http://127.0.0.1:5173`). The interface and API bind to localhost. To run a production build, use `npm run build` and then `npm start`; the server serves the built interface on `http://127.0.0.1:4174`.

## Linux desktop app

Build an AppImage on Linux with:

```sh
npm install
npm run package:linux
```

The executable is written to `release/`. The build script removes generated intermediate files after packaging, including if the build fails, and leaves the AppImage in place. It bundles Electron and the application, so end users do not need Node.js installed. Launch the AppImage from any working directory. The desktop app uses the operating system's native file chooser; it does not require `zenity` or `kdialog`. AppImage runtime support, including FUSE on distributions that require it, must be available on the target system.

This first package target is Linux x64 AppImage. Debian packages and other distributions are not produced yet. Build and test release artifacts on Linux; local browser development still requires Node.js 20 or newer.

## Features

- Browse and search contexts, clusters, and users.
- Switch between kubeconfig files, open another file through the native file chooser, or enter an absolute path or `~/` path manually.
- Create a new, valid empty kubeconfig directly from the manager; existing files are never overwritten by this action.
- Manage each file independently; selecting or editing a file never merges or changes another file.
- Use a missing default or added file as an empty config; it is created with owner-only permissions on its first save.
- Set the current context and create, edit, or remove entities.
- Create contexts by linking an existing cluster and user.
- Configure cluster API endpoints, TLS settings, bearer-token users, and exec authentication.
- Keep existing token credentials when editing without entering a replacement.
- Reject deletion of clusters and users that are referenced by contexts.
- Create a timestamped backup before every successful write.

## Security notes

The service binds to `127.0.0.1`. On Linux, the native file chooser uses `zenity` or `kdialog`; if neither is available, enter a path manually. It starts with `~/.kube/config` and can access additional paths only after you explicitly add them in the interface. It does not expose kubeconfig contents to other interfaces: the frontend receives entity metadata, never token values, certificate/key data, passwords, or exec environment credentials. Tokens are accepted through write-only form fields. Config and backup files are written with owner-only permissions (`0600`); missing parent directories are created with owner-only permissions when needed.

Each file is managed separately. Removing a file from the manager unregisters it but does not delete it from disk. A missing config file added as a path is created only on its first save; choosing “Create new” creates a valid empty config immediately and refuses to overwrite an existing file. The interface shows the selected path and a copyable shell command such as `export KUBECONFIG='/path/to/config'`; run that in the shell where you invoke `kubectl` to make kubectl use the selected file. `KUBECONFIG` is shell-process configuration and is not changed automatically by this app. The tool does not merge kubeconfig files, run `kubectl`, or validate whether a cluster is reachable. As with any local credential tool, use it only on a trusted machine and stop the process when you are finished.

## Checks

```sh
npm test
npm run build
```

## Documentation

- [Usage guide](docs/usage.md): file selection, entity management, context switching, and using the selected config with `kubectl`.
- [Files and security](docs/security-and-files.md): file boundaries, credentials, validation, backups, and native file chooser behavior.
