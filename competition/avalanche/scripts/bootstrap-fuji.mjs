/** Competition-only Fuji bootstrap: fund delegated agent and acquire LFJ test USDC. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {
  Contract,JsonRpcProvider,NonceManager,Wallet,formatEther,formatUnits,parseEther
} from 'ethers';
import {ROOT} from '../lib/compile.mjs';
import {FUJI,LfjFuji} from '../lib/fuji.mjs';

const args=process.argv.slice(2);
const flag=name=>args.includes(name);
if(process.env.NERYA_COMPETITION!=='avalanche'||process.env.NERYA_COMPETITION_ALLOW_FUJI!=='1'||!flag('--confirm-fuji')) {
  throw new Error('Fuji bootstrap disabled without competition mode + explicit --confirm-fuji.');
}

const keys=path.join(ROOT,'.runtime','keys');
const ownerFile=path.join(keys,'fuji-owner.json');
const addresses=JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts','fuji','testnet-wallet-addresses.json'),'utf8')).addresses;
const password=execFileSync('security',[
  'find-generic-password','-a','Nerya Avalanche Fuji Competition',
  '-s','nerya-avalanche-fuji-competition','-w'
],{encoding:'utf8'}).trim();
if(password.length<16) throw new Error('Competition keystore password unavailable from macOS Keychain');

const provider=new JsonRpcProvider(FUJI.rpc,undefined,{batchMaxCount:1,cacheTimeout:-1});
try {
  if((await provider.getNetwork()).chainId!==43113n) throw new Error('Wrong chain');
  const rawOwner=await Wallet.fromEncryptedJson(fs.readFileSync(ownerFile,'utf8'),password);
  if(rawOwner.address.toLowerCase()!==addresses.owner.toLowerCase()) throw new Error('Owner address mismatch');
  const owner=new NonceManager(rawOwner.connect(provider));
  const client=new LfjFuji();
  const before={owner:await client.balance(addresses.owner),agent:await client.balance(addresses.agent)};

  const txs=[];
  if(BigInt(before.agent.native)<parseEther('0.03')) {
    const receipt=await (await owner.sendTransaction({to:addresses.agent,value:parseEther('0.05')})).wait();
    if(receipt.status!==1) throw new Error('Agent gas transfer reverted');
    txs.push({name:'fund_agent_gas',hash:receipt.hash,blockNumber:receipt.blockNumber,amountAvax:'0.05'});
  }

  const snapshot=await client.snapshot();
  const wavax=new Contract(snapshot.tokenOut,[
    'function deposit() payable',
    'function approve(address,uint256) returns(bool)',
    'function balanceOf(address) view returns(uint256)'
  ],owner);
  const usdc=new Contract(FUJI.usdc,['function balanceOf(address) view returns(uint256)'],provider);
  const router=new Contract(FUJI.router,[
    'function getSwapOut(address,uint128,bool) view returns(uint128,uint128,uint128)',
    'function swapExactTokensForTokens(uint256,uint256,(uint256[],uint8[],address[]),address,uint256) returns(uint256)'
  ],owner);
  const quoter=new Contract(FUJI.quoter,[
    'function findBestPathFromAmountIn(address[] route,uint128 amountIn) view returns ((address[] route,address[] pairs,uint256[] binSteps,uint8[] versions,uint128[] amounts,uint128[] virtualAmountsWithoutSlippage,uint128[] fees) quote)'
  ],provider);
  const amountIn=parseEther('0.15');
  const existingWavax=await wavax.balanceOf(addresses.owner);
  const agentNeedsFunding=BigInt(before.agent.native)<parseEther('0.03');
  const nativeNeeded=(agentNeedsFunding?parseEther('0.05'):0n)+(existingWavax<amountIn?amountIn-existingWavax:0n)+parseEther('0.03');
  if(BigInt(before.owner.native)<nativeNeeded) throw new Error('Insufficient Fuji AVAX for remaining bootstrap steps');
  if(existingWavax<amountIn) {
    const missing=amountIn-existingWavax;
    const wrapReceipt=await (await wavax.deposit({value:missing})).wait();
    if(wrapReceipt.status!==1) throw new Error('WAVAX wrap reverted');
    txs.push({name:'wrap_avax',hash:wrapReceipt.hash,blockNumber:wrapReceipt.blockNumber,amountAvax:formatEther(missing)});
  }

  const approveReceipt=await (await wavax.approve(FUJI.router,amountIn)).wait();
  if(approveReceipt.status!==1) throw new Error('WAVAX approval reverted');
  txs.push({name:'approve_router',hash:approveReceipt.hash,blockNumber:approveReceipt.blockNumber});

  const quote=await quoter.findBestPathFromAmountIn([snapshot.tokenOut,FUJI.usdc],amountIn);
  const out=quote.amounts.at(-1);
  if(out<=0n||quote.pairs.length!==1||quote.binSteps.length!==1||quote.versions.length!==1)
    throw new Error('LFJ quoter did not return a one-hop Fuji route');
  const minOut=out*9900n/10000n;
  const latest=await provider.getBlock('latest');
  const route=[[quote.binSteps[0]],[quote.versions[0]],[snapshot.tokenOut,FUJI.usdc]];
  await router.swapExactTokensForTokens.staticCall(amountIn,minOut,route,addresses.owner,BigInt(latest.timestamp+180));
  const swapReceipt=await (await router.swapExactTokensForTokens(amountIn,minOut,route,addresses.owner,BigInt(latest.timestamp+180))).wait();
  if(swapReceipt.status!==1) throw new Error('LFJ bootstrap swap reverted');
  txs.push({name:'lfj_wavax_to_test_usdc',hash:swapReceipt.hash,blockNumber:swapReceipt.blockNumber,
    pair:quote.pairs[0],binStep:quote.binSteps[0].toString(),version:quote.versions[0].toString(),
    quotedUsdc:formatUnits(out,6),minUsdc:formatUnits(minOut,6)});

  const after={owner:await client.balance(addresses.owner),agent:await client.balance(addresses.agent)};
  const record={chainId:43113,network:'Avalanche Fuji',testnetOnly:true,owner:addresses.owner,agent:addresses.agent,
    before:{ownerAvax:formatEther(BigInt(before.owner.native)),agentAvax:formatEther(BigInt(before.agent.native)),ownerLfjUsdc:formatUnits(BigInt(before.owner.usdc),6)},
    after:{ownerAvax:formatEther(BigInt(after.owner.native)),agentAvax:formatEther(BigInt(after.agent.native)),ownerLfjUsdc:formatUnits(BigInt(after.owner.usdc),6)},
    router:FUJI.router,lfjTestUsdc:FUJI.usdc,transactions:txs,completedAt:new Date().toISOString()};
  const output=path.join(ROOT,'artifacts','fuji','bootstrap.json');
  fs.writeFileSync(output,JSON.stringify(record,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(record,null,2));
} finally {
  provider.destroy();
}
