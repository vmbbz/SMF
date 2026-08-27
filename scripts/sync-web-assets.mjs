import { cp, copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(projectRoot, 'www');

const rootFiles = [
  'favicon.ico',
  'index.html',
  'leaderboard.js',
  'manifest.json',
  'share-fight.js',
  'wallet-connect.js',
];
const directories = ['assets', 'src'];

await mkdir(outputRoot, { recursive: true });
for (const file of rootFiles) {
  await copyFile(resolve(projectRoot, file), resolve(outputRoot, file));
}
for (const directory of directories) {
  await cp(resolve(projectRoot, directory), resolve(outputRoot, directory), {
    recursive: true,
    force: true,
  });
}

console.log(`Synced ${rootFiles.length} root files and ${directories.length} directories into www/.`);
