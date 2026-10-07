import fs from 'node:fs';
import path from 'node:path';
import {compile, ROOT} from '../lib/compile.mjs';
fs.mkdirSync(path.join(ROOT, 'build'), {recursive:true});
for (const [name, value] of Object.entries(compile())) {
  fs.writeFileSync(path.join(ROOT, 'build', `${name}.json`), JSON.stringify(value, null, 2));
  console.log(`${name}: ${(value.bytecode.length - 2) / 2} deployment bytes`);
}
