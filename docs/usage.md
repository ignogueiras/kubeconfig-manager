# Usage Guide

## Start the manager

Install Node.js 20 or newer, then run the development server from the project root:

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite, normally `http://127.0.0.1:5173`. Keep the terminal process running while using the manager. For production-style local use, build and start the API server:

```sh
npm run build
npm start
```

The built interface is served at `http://127.0.0.1:4174`.

## Choose a kubeconfig file

The default `~/.kube/config` is loaded automatically and appears in the **Config Files** list in the left sidebar. Select a listed file to view and manage its entities.

Use **Open config** to add an existing file. On Linux, **Browse** opens the native file chooser when `zenity` or `kdialog` is installed. You can also enter an absolute path or a path beginning with `~/` manually. The manager validates an existing file as a kubeconfig before loading it.

Use **New config** to create an empty kubeconfig. Choose a path with **Browse** or type one. The manager creates the parent directory if necessary, writes a valid empty kubeconfig, and refuses to replace a file that already exists at that path.

Use **Duplicate selected** to copy every entity from the currently selected config into a new file. The original remains unchanged, and the destination must not already exist. Credentials are copied directly between local files and are not returned to the interface.

Use **Merge configs** to choose individual clusters, users, and contexts from the other loaded files and add them to the currently selected destination. The source files remain unchanged, and a backup is made when the destination already exists. Same-name entities with different definitions are rejected. When importing a context, include its cluster and user unless they already exist in the destination.

Use **Paste config** to add every cluster, user, and context in a pasted full kubeconfig to the selected file. The same conflict checks and backup behavior apply. In the cluster, user, or context editor, switch to **Raw YAML** to paste one complete entity mapping instead of filling in individual fields. Raw entity edits replace the full entity, including credentials and less common Kubernetes fields; context references are validated before saving.

A missing file can also be added through **Open config** by entering its intended path. It appears as an empty config and is created only when you save the first entity. A missing-file marker appears beside its name in the sidebar.

Removing a non-default file from the sidebar only removes it from the manager. It does not delete the file from disk. The default config cannot be removed from the list.

## Manage entities

Use the **Contexts**, **Clusters**, and **Users** sections in the main navigation to browse and search the selected file. Counts and the current-context summary also refer only to that selected file.

- **Clusters** describe an API server and TLS settings. Add or edit a cluster with an HTTP or HTTPS server URL. The TLS verification toggle should only be disabled for a trusted network.
- **Users** represent authentication identities. The editor supports bearer tokens, exec plugins, client certificate paths, and basic username/password credentials. Secret inputs are write-only: stored values are not loaded into the form. Leave a credential field blank while editing to preserve its existing value where supported.
- **Contexts** connect one cluster and one user, with an optional namespace. Both references must already exist in the selected kubeconfig.

Choose **Use context** to update `current-context` in the selected file. Cluster and user entries cannot be deleted while contexts still reference them. Removing the active context clears that file's `current-context` value. Entity changes are validated and saved to the selected file only.

## Use the selected file with kubectl

Selecting a file in the manager does not change the environment of an existing terminal or cause `kubectl` to use it. Use the **Use this file with kubectl** command shown in the main view. For example:

```sh
export KUBECONFIG="$HOME/.kube/staging-config"
kubectl config current-context
```

Run the export in the same shell where you run `kubectl`. It applies to commands started by that shell. To make the choice persistent for future shells, add the export to the appropriate shell startup file, or set `KUBECONFIG` in the environment that launches your terminal or tooling.

The manager edits one kubeconfig at a time. Its explicit merge action copies only the entities you select; it does not implement kubectl's automatic multi-file merge behavior for `KUBECONFIG` lists.

## Refresh external changes

If another tool changes a file while the manager is open, select **Refresh** in the top bar to reload the currently selected file from disk.
