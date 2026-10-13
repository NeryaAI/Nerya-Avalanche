import {TypedDataEncoder, keccak256, toUtf8Bytes} from 'ethers';

export const POLICY_TYPES = {Policy: [
  {name:'agent',type:'address'}, {name:'tokenIn',type:'address'}, {name:'tokenOut',type:'address'},
  {name:'strategyHash',type:'bytes32'}, {name:'maxSingle',type:'uint256'},
  {name:'maxDaily',type:'uint256'}, {name:'maxTotal',type:'uint256'},
  {name:'minRateWad',type:'uint256'}, {name:'expiry',type:'uint256'}, {name:'nonce',type:'uint256'},
  {name:'binStep',type:'uint16'}, {name:'version',type:'uint8'}
]};
export const domainFor = (chainId, verifyingContract) => ({name:'NeryaPolicyVault',version:'1',chainId,verifyingContract});
export const policyHash = (domain, policy) => TypedDataEncoder.hash(domain, POLICY_TYPES, policy);
export const toJSON = value => JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v));

// A documented deterministic encoding, not an assertion of source truth.
// Object keys are sorted recursively; arrays preserve order; non-finite values
// are rejected. JSON strings are UTF-8, hashed with Ethereum keccak256.
export function canonicalJSON(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Evidence contains non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  if (typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJSON(value[k])).join(',') + '}';
  throw new Error('Evidence contains unsupported value');
}
export const evidenceHash = value => keccak256(toUtf8Bytes(canonicalJSON(value)));
