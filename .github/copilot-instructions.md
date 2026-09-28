# Project Instructions

- Keep the API bound to localhost and limit file operations to the default kubeconfig plus additional kubeconfig files explicitly added by the user.
- Never include token values, private keys, certificate data, passwords, or exec environment values in API responses or logs.
- Validate YAML before writes and create a timestamped backup before replacing an existing kubeconfig.
- Keep every read, edit, and save scoped to the selected config file; never merge independent files.
- Run `npm test` and `npm run build` after changes to data operations or UI/API contracts.
