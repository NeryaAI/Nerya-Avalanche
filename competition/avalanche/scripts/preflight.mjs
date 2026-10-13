import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from '../lib/compile.mjs';
import {LfjFuji} from '../lib/fuji.mjs';
const client=new LfjFuji();
const snapshot=await client.snapshot();
let quote;
try{quote=await client.quote(10n**BigInt(snapshot.decimalsIn),snapshot);}
catch(error){quote={status:'blocked',reason:error.message};}
const result={snapshot,quote,publicBroadcastPerformed:false};
fs.mkdirSync(path.join(ROOT,'artifacts'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'artifacts','fuji-preflight.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
