import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = resolve('backends/ridu/generated/ridu.generated.ts');
const target = resolve('apps/web/src/lib/ridu.generated.ts');
const generated = await readFile(source, 'utf8');
if (process.argv.includes('--check')) {
  if (generated !== await readFile(target, 'utf8')) {
    throw new Error('The frontend Ridu client has drifted. Run bun run generate.');
  }
  console.log('Frontend Ridu contract matches executable Go generation.');
} else {
  await writeFile(target, generated);
  console.log('Updated frontend Ridu contract from backend generation.');
}
