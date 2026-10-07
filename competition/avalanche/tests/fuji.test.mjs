import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LfjFuji,FUJI} from '../lib/fuji.mjs';
test('Fuji adapter rejects mainnet before requesting any state',async()=>{
  const calls=[];const client=new LfjFuji(async(method)=>{calls.push(method);return '0xa86a';});
  await assert.rejects(()=>client.snapshot(),/Wrong chain 43114/);
  assert.deepEqual(calls,['eth_chainId']);
});
test('Fuji quote rejects zero or overflowing token quantities',async()=>{
  const client=new LfjFuji(()=>{throw new Error('No network in unit tests');});
  await assert.rejects(()=>client.quote(0),/uint128/);await assert.rejects(()=>client.quote(2n**128n),/uint128/);
});
test('adapter never mistakes pending/reverted receipts for success',async()=>{
  const hash='0x'+'a'.repeat(64);let mined=false;
  const client=new LfjFuji(async(method)=>method==='eth_chainId'?'0xa869':mined?{status:'0x0',transactionHash:hash}:null);
  assert.equal((await client.receipt(hash)).status,'pending');mined=true;
  assert.equal((await client.receipt(hash)).status,'reverted');
});
test('Fuji deployment metadata is fixed to the official LFJ test token',()=>{
  assert.equal(FUJI.chainId,43113);assert.equal(FUJI.version,2);
  assert.equal(FUJI.usdc,'0xB6076C93701D6a07266c31066B298AeC6dd65c2d');
});
