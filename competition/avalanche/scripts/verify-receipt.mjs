/** Public read-only verification; never opens keystores or broadcasts. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Contract,Interface,JsonRpcProvider,formatUnits,verifyTypedData} from 'ethers';
import {ROOT,compile} from '../lib/compile.mjs';
import {FUJI} from '../lib/fuji.mjs';
import {POLICY_TYPES} from '../lib/policy.mjs';

const record=JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts/fuji/0x1fdb183Fa955efdc38aEdccfAB9387D281c8c7D9.json'),'utf8'));
const provider=new JsonRpcProvider(FUJI.rpc,undefined,{batchMaxCount:1,cacheTimeout:-1});
try {
  assert.equal((await provider.getNetwork()).chainId,43113n);
  const hash=record.executionEvidence.transactionHash;
  const [tx,receipt]=await Promise.all([provider.getTransaction(hash),provider.getTransactionReceipt(hash)]);
  assert.ok(tx&&receipt);assert.equal(receipt.status,1);
  assert.equal(tx.from.toLowerCase(),record.agent.toLowerCase());
  assert.equal(tx.to.toLowerCase(),record.vault.toLowerCase());
  const iface=new Interface(compile().NeryaPolicyVault.abi);
  const parsed=receipt.logs.filter(l=>l.address.toLowerCase()===record.vault.toLowerCase())
    .map(l=>{try{return iface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='Executed');
  assert.ok(parsed);
  assert.equal(parsed.args.evidenceHash,record.evidenceHash);
  assert.equal(parsed.args.policyHash,record.policy.policyHash);
  assert.equal(parsed.args.strategyHash,record.policy.policy.strategyHash);
  assert.equal(verifyTypedData(record.policy.domain,POLICY_TYPES,record.policy.policy,record.policy.signature).toLowerCase(),record.owner.toLowerCase());
  const token=new Contract(FUJI.usdc,['function allowance(address,address) view returns(uint256)'],provider);
  const allowance=await token.allowance(record.vault,FUJI.router,{blockTag:receipt.blockNumber});
  assert.equal(allowance,0n);
  const block=await provider.getBlock(receipt.blockNumber);
  console.log(JSON.stringify({kind:'avalanche_execution_receipt',status:'verified',chainId:43113,
    network:'Avalanche Fuji',testnetOnly:true,referenceExecution:true,newTransactionSubmitted:false,
    transactionHash:hash,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,
    executedAt:new Date(block.timestamp*1000).toISOString(),verifiedAt:new Date().toISOString(),
    amountIn:formatUnits(parsed.args.amountIn,6),tokenIn:'LFJ test USDC',
    amountOut:formatUnits(parsed.args.amountOut,18),tokenOut:'WAVAX',
    owner:record.owner,agent:record.agent,vault:record.vault,router:record.router,
    route:'LFJ V2.1',policyHash:record.policy.policyHash,evidenceHash:parsed.args.evidenceHash,
    strategyHash:parsed.args.strategyHash,routerAllowanceAtExecution:'0',
    signatureVerified:true,evidenceEventVerified:true,gasUsed:receipt.gasUsed.toString(),
    explorerUrl:`${FUJI.explorer}/tx/${hash}`,
    summary:'The earlier dedicated Fuji testnet execution is verified against public RPC and the signed policy. No new order has been placed for this conversation or its strategy.',
    limitations:['Reference proof belongs to its original strategy/evidence hash, not the newly authored strategy.',
      'Historical CEX backtest returns are not LFJ execution P&L.','Testnet prototype; no mainnet funds and no contract security audit.']}));
} finally {provider.destroy();}
