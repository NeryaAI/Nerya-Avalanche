import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import solc from 'solc';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let cached;
export function compile() {
  if (cached) return cached;
  const names = ['contracts/NeryaPolicyVault.sol', 'contracts/test/LocalFixtures.sol'];
  const sources = Object.fromEntries(names.map(name => [name, {content: fs.readFileSync(path.join(ROOT, name), 'utf8')} ]));
  const input = {language: 'Solidity', sources, settings: {
    optimizer: {enabled: true, runs: 200}, viaIR: true, evmVersion: 'paris',
    outputSelection: {'*': {'*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object']}}
  }};
  const output = JSON.parse(solc.compile(JSON.stringify(input), {import: name => {
    const resolved = path.resolve(ROOT, 'node_modules', name);
    if (!resolved.startsWith(path.join(ROOT, 'node_modules') + path.sep)) return {error: 'Invalid import'};
    try { return {contents: fs.readFileSync(resolved, 'utf8')}; } catch { return {error: `Missing import: ${name}`}; }
  }}));
  const errors = (output.errors || []).filter(item => item.severity === 'error');
  if (errors.length) throw new Error(errors.map(item => item.formattedMessage).join('\n'));
  cached = {};
  for (const name of names) for (const [contract, result] of Object.entries(output.contracts[name])) {
    if (result.evm.bytecode.object) cached[contract] = {
      abi: result.abi, bytecode: `0x${result.evm.bytecode.object}`,
      deployedBytecode: `0x${result.evm.deployedBytecode.object}`, compiler: solc.version(),
    };
  }
  return cached;
}
