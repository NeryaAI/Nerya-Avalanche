import {Contract,JsonRpcProvider,formatUnits,parseEther} from 'ethers';
import {FUJI,LfjFuji} from '../lib/fuji.mjs';

const client=new LfjFuji();
const snapshot=await client.snapshot();
const provider=new JsonRpcProvider(FUJI.rpc,undefined,{batchMaxCount:1,cacheTimeout:-1});
try {
  const quoter=new Contract(FUJI.quoter,[
    'function findBestPathFromAmountIn(address[] route,uint128 amountIn) view returns ((address[] route,address[] pairs,uint256[] binSteps,uint8[] versions,uint128[] amounts,uint128[] virtualAmountsWithoutSlippage,uint128[] fees) quote)'
  ],provider);
  const quote=await quoter.findBestPathFromAmountIn([snapshot.tokenOut,FUJI.usdc],parseEther('0.15'));
  console.log(JSON.stringify({
    route:quote.route,pairs:quote.pairs,binSteps:quote.binSteps.map(String),versions:quote.versions.map(String),
    amounts:quote.amounts.map(String),amountOutUsdc:formatUnits(quote.amounts.at(-1),6),fees:quote.fees.map(String)
  },null,2));
} finally { provider.destroy(); }
