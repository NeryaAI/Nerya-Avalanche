/** Public Avalanche market reads ONLY. No signer, keystore, approval or send. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Interface,formatUnits,keccak256,parseUnits} from 'ethers';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const OUT=path.join(ROOT,'research','2026-10-07','lfj-mainnet.json');
const RPC='https://api.avax.network/ext/bc/C/rpc';
const ROUTER='0x18556DA13313f3532c54711497A8FedAC273220E';
const USDC='0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';
const WAVAX='0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7';
const allowed=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getCode','eth_call','eth_gasPrice']);
let seq=0;
async function rpc(method,params=[]) {
  if(!allowed.has(method))throw new Error('Research adapter refuses all transaction and signing methods');
  const response=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++seq,method,params}),signal:AbortSignal.timeout(18000)});
  if(!response.ok)throw new Error(`RPC HTTP ${response.status}`);
  const row=await response.json();if(row.error)throw new Error(row.error.message);
  if(row.result===undefined)throw new Error('Missing RPC result');return row.result;
}
const abi=new Interface([
 'function getWNATIVE() view returns(address)',
 'function getFactory() view returns(address)',
 'function getFactoryV2_1() view returns(address)',
 'function decimals() view returns(uint8)',
 'function symbol() view returns(string)',
 'function getAllLBPairs(address,address) view returns((uint16 binStep,address LBPair,bool createdByOwner,bool ignoredForRouting)[])',
 'function getTokenX() view returns(address)',
 'function getTokenY() view returns(address)',
 'function getReserves() view returns(uint128,uint128)',
 'function getActiveId() view returns(uint24)',
 'function getPriceFromId(uint24) view returns(uint256)',
 'function getSwapOut(address,uint128,bool) view returns(uint128,uint128,uint128)',
]);
async function read(address,name,args=[],block='latest') {
 return abi.decodeFunctionResult(name,await rpc('eth_call',[{to:address,data:abi.encodeFunctionData(name,args)},block]));
}

async function main() {
 const actual=Number(BigInt(await rpc('eth_chainId')));
 if(actual!==43114)throw new Error('Expected Avalanche mainnet for READ-ONLY market research');
 const block=await rpc('eth_blockNumber');
 const [info,code,wrapped,decimalsU,decimalsW,gasPrice,f21,f22]=await Promise.all([
  rpc('eth_getBlockByNumber',[block,false]),rpc('eth_getCode',[ROUTER,block]),read(ROUTER,'getWNATIVE',[],block),
  read(USDC,'decimals',[],block),read(WAVAX,'decimals',[],block),rpc('eth_gasPrice'),
  read(ROUTER,'getFactoryV2_1',[],block),read(ROUTER,'getFactory',[],block),
 ]);
 if(code==='0x'||wrapped[0].toLowerCase()!==WAVAX.toLowerCase()||Number(decimalsU[0])!==6||Number(decimalsW[0])!==18)
  throw new Error('Avalanche/LFJ/token identity verification failed');
 const pools=[],skipped=[];
 for(const [factory,version] of [[f21[0],2],[f22[0],3]]) {
  const [pairs]=await read(factory,'getAllLBPairs',[WAVAX,USDC],block);
  for(const pair of pairs) {
   if(pair.ignoredForRouting){skipped.push({pair:pair.LBPair,reason:'ignored_for_routing'});continue;}
   try{
    const [x,y,reserves,active]=await Promise.all([
      read(pair.LBPair,'getTokenX',[],block),read(pair.LBPair,'getTokenY',[],block),
      read(pair.LBPair,'getReserves',[],block),read(pair.LBPair,'getActiveId',[],block)]);
    const identities=[x[0].toLowerCase(),y[0].toLowerCase()];
    if(!identities.includes(USDC.toLowerCase())||!identities.includes(WAVAX.toLowerCase()))throw new Error('Pool token mismatch');
    const [rawPrice]=await read(pair.LBPair,'getPriceFromId',[active[0]],block);
    const xIsWavax=x[0].toLowerCase()===WAVAX.toLowerCase();
    const tokenYPerX=Number(rawPrice)/2**128*10**(xIsWavax?12:-12);
    const priceUsdc=xIsWavax?tokenYPerX:1/tokenYPerX;
    const reserveW=Number(formatUnits(reserves[xIsWavax?0:1],18));
    const reserveU=Number(formatUnits(reserves[xIsWavax?1:0],6));
    const quotes=[];
    for(const size of ['100','1000','8500']) {
     const amount=parseUnits(size,6);
     const [left,out,fee]=await read(ROUTER,'getSwapOut',[pair.LBPair,amount,!xIsWavax],block);
     const outHuman=Number(formatUnits(out,18));
     quotes.push({inputUsdc:Number(size),amountOutRaw:out.toString(),outputWavax:outHuman,unfilledInputRaw:left.toString(),
       feeInputUsdc:Number(formatUnits(fee,6)),feeBps:Number(fee)*10000/Number(amount),
       effectiveUsdcPerWavax:outHuman>0?Number(size)/outHuman:null,
       priceLossVsActiveBinBps:outHuman>0?((Number(size)/outHuman)/priceUsdc-1)*10000:null,
       completelyFillable:left===0n&&out>0n});
    }
    pools.push({factory,version:version===2?'LFJ V2.1':'LFJ V2.2',routerVersion:version,pair:pair.LBPair,
     binStep:Number(pair.binStep),binStepIsNotFee:true,activeBin:Number(active[0]),tokenX:x[0],tokenY:y[0],
     spotUsdcPerWavax:priceUsdc,reserveWavax:reserveW,reserveUsdc:reserveU,
     estimatedPoolValueUsdc:reserveU+reserveW*priceUsdc,quotes});
   }catch(e){skipped.push({pair:pair.LBPair,reason:e.message});}
  }
 }
 const bestBySize=['100','1000','8500'].map(size=>{
   const choices=pools.flatMap(pool=>pool.quotes.filter(q=>q.inputUsdc===Number(size)&&q.completelyFillable)
      .map(q=>({...q,pair:pool.pair,version:pool.version,binStep:pool.binStep,
                estimatedPoolValueUsdc:pool.estimatedPoolValueUsdc,activeBinPrice:pool.spotUsdcPerWavax})));
   choices.sort((a,b)=>b.outputWavax-a.outputWavax);return choices[0]||{inputUsdc:Number(size),completelyFillable:false};
 });
 const result={kind:'avalanche_lfj_market_research',status:pools.length?'verified':'no_fillable_pools',chainId:43114,
   network:'Avalanche C-Chain',readOnly:true,newTransactionSubmitted:false,signerLoaded:false,
   rpc:RPC,observedAt:new Date().toISOString(),blockNumber:Number(BigInt(block)),blockHash:info.hash,
   blockTimestamp:new Date(Number(BigInt(info.timestamp))*1000).toISOString(),
   router:ROUTER,routerCodeHash:keccak256(code),nativeUsdc:USDC,wrappedAvax:WAVAX,
   gasPriceWei:BigInt(gasPrice).toString(),
   sources:['https://developers.lfj.gg/deployment-addresses/avalanche',
            'https://developers.lfj.gg/concepts/fees','https://developers.circle.com/stablecoins/usdc-contract-addresses'],
   pools,bestBySize,skipped,
   limitations:['All quotes share one historical block; a new quote is required before any signing.',
    'Bin step is price-bin spacing, NOT the current fee rate. Fees include variable components.',
    'Pool value is an active-bin-mark estimate, not guaranteed immediately available depth.',
    'No simulated successful trade, mainnet approval, signer or transaction broadcast.',
    'Current quotes do not reconstruct historical LFJ fees, bins, MEV or strategy P&L.']};
 if(!process.argv.includes('--no-save')) {
  fs.mkdirSync(path.dirname(OUT),{recursive:true});
  fs.writeFileSync(OUT,JSON.stringify(result,null,2)+'\n');
 }
 console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
