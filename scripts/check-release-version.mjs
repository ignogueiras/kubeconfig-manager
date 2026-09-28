import { readFile } from 'node:fs/promises';

const tag = process.argv[2];
if (!tag) {
  console.error('Pass the release tag, for example: v0.1.0');
  process.exitCode = 1;
} else {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const expectedTag = `v${packageJson.version}`;
  if (tag !== expectedTag) {
    console.error(`Release tag ${tag} does not match app version ${packageJson.version} (expected ${expectedTag}).`);
    process.exitCode = 1;
  } else {
    console.log(`Release tag ${tag} matches app version ${packageJson.version}.`);
  }
}