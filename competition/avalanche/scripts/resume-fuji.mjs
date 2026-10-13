/** Resume a competition Fuji vault after a pre-execution policy failure. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Contract,JsonRpcProvider,NonceManager,Wallet,formatUnits,isAddress,parseUnits,ZeroHash} from 'ethers';
import {ROOT,compile} from '../lib/compile.mjs';
import {FUJI,LfjFuji} from '../lib/fuji.mjs';
import {POLICY_TYPES,domainFor,evidenceHash,toJSON} from '../lib/policy.mjs';

const args=process.argv.slice(2);
const flag=name=>args.includes(name);
const value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
if(process.env.NERYA_COMPETITION!=='avalanche'||process.env.NERYA_COMPETITION_ALLOW_FUJI!=='1'||!flag('--confirm-fuji'))
  throw new Error('Resume disabled without competition mode + explicit Fuji confirmation');

const vaultAddress=value('--vault');
if(!isAddress(vaultAddress||'')) throw new Error('Explicit existing Fuji vault address is required');
const evidenceFile=path.resolve(value('--evidence')||'');
if(!evidenceFile.startsWith(path.join(ROOT,'.runtime','runs')+path.sep)) throw new Error('Evidence must be from this isolated competition run');
const bundle=JSON.parse(fs.readFileSync(evidenceFile,'utf8'));
const {hash,...unsigned}=bundle; const digest=evidenceHash(unsigned);
if(hash!==digest||!bundle.strategy) throw new Error('Evidence bundle digest or strategy binding is invalid');

const recordPath=path.join(ROOT,'artifacts','fuji',`${vaultAddress}.json`);
const record=JSON.parse(fs.readFileSync(recordPath,'utf8'));
if(record.chainId!==43113||record.vault.toLowerCase()!==vaultAddress.toLowerCase()||record.evidenceHash!==digest)
  throw new Error('Existing vault record is not bound to this Fuji evidence run');

const password=execFileSync('security',[
  'find-generic-password','-a','Nerya Avalanche Fuji Competition',
  '-s','nerya-avalanche-fuji-competition','-w'
],{encoding:'utf8'}).trim();
if(password.length<16) throw new Error('Competition keystore password unavailable from macOS Keychain');

const provider=new JsonRpcProvider(FUJI.rpc,undefined,{batchMaxCount:1,cacheTimeout:-1});
try {
  if((await provider.getNetwork()).chainId!==43113n) throw new Error('Wrong chain');
  const ownerWallet=(await Wallet.fromEncryptedJson(fs.readFileSync(path.join(ROOT,'.runtime','keys','fuji-owner.json'),'utf8'),password)).connect(provider);
  const agentWallet=(await Wallet.fromEncryptedJson(fs.readFileSync(path.join(ROOT,'.runtime','keys','fuji-agent.json'),'utf8'),password)).connect(provider);
  if(ownerWallet.address.toLowerCase()!==record.owner.toLowerCase()||agentWallet.address.toLowerCase()!==record.agent.toLowerCase())
    throw new Error('Keystores do not match the recorded Fuji vault');
  const owner=new NonceManager(ownerWallet),agent=new NonceManager(agentWallet);
  const artifact=compile().NeryaPolicyVault;
  const vault=new Contract(vaultAddress,artifact.abi,owner);
  if((await vault.owner()).toLowerCase()!==ownerWallet.address.toLowerCase()||(await vault.router()).toLowerCase()!==FUJI.router.toLowerCase())
    throw new Error('On-chain vault ownership/router mismatch');
  if(await vault.policyNonce()!==0n||await vault.executionNonce()!==0n||await vault.activePolicyHash()!==ZeroHash)
    throw new Error('Vault is not in the expected clean pre-policy recovery state');

  const amount=parseUnits('1',6);
  const token=new Contract(FUJI.usdc,['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)'],provider);
  if(await token.balanceOf(vaultAddress)<amount) throw new Error('Recovered vault does not hold the expected 1 LFJ test USDC');

  const client=new LfjFuji(); let snapshot=await client.snapshot(); let quote=await client.supportedQuote(amount,snapshot);
  const now=(await provider.getBlock('latest')).timestamp;
  const policy={agent:agentWallet.address,tokenIn:FUJI.usdc,tokenOut:snapshot.tokenOut,strategyHash:evidenceHash(bundle.strategy),
    maxSingle:parseUnits('10',6),maxDaily:parseUnits('30',6),maxTotal:parseUnits('50',6),
    minRateWad:BigInt(quote.amountOut)*10n**18n*9750n/(amount*10000n),expiry:BigInt(now+1200),
    nonce:await vault.policyNonce(),binStep:quote.binStep,version:quote.version};
  const domain=domainFor(43113,vaultAddress); const signature=await ownerWallet.signTypedData(domain,POLICY_TYPES,policy);
  const authorization=await (await vault.activatePolicy(policy,signature)).wait();
  if(authorization.status!==1) throw new Error('Policy activation reverted');
  record.transactions.push({name:'activate_policy',hash:authorization.hash,blockNumber:authorization.blockNumber});
  record.policy=toJSON({domain,policy,signature,policyHash:await vault.activePolicyHash(),routePair:quote.pair});
  record.status='policy_active'; fs.writeFileSync(recordPath,JSON.stringify(record,null,2)+'\n',{mode:0o600});

  snapshot=await client.snapshot(); quote=await client.supportedQuote(amount,snapshot);
  if(Number(record.policy.policy.binStep)!==quote.binStep||Number(record.policy.policy.version)!==quote.version)
    throw new Error('Supported LFJ route changed after policy signing');
  const policyFloor=(amount*BigInt(record.policy.policy.minRateWad)+10n**18n-1n)/10n**18n;
  const minOut=BigInt(quote.amountOut)*9900n/10000n;
  if(minOut<policyFloor) throw new Error('Fresh quote fell below the signed policy floor');
  const deadline=BigInt((await provider.getBlock('latest')).timestamp+120);
  const params=[record.policy.policyHash,amount,minOut,digest,await vault.executionNonce(),deadline];
  await vault.connect(agent).execute.staticCall(...params);
  const receipt=await (await vault.connect(agent).execute(...params)).wait();
  if(receipt.status!==1) throw new Error('Fuji swap reverted');
  const event=receipt.logs.map(log=>{try{return vault.interface.parseLog(log);}catch{return null;}}).find(e=>e?.name==='Executed');
  if(!event||event.args.evidenceHash!==digest) throw new Error('Missing expected execution evidence event');
  record.status='confirmed'; record.transactions.push({name:'swap',hash:receipt.hash,blockNumber:receipt.blockNumber});
  record.executionEvidence={transactionHash:receipt.hash,blockNumber:receipt.blockNumber,intentHash:event.args.intentHash,
    evidenceHash:event.args.evidenceHash,amountIn:formatUnits(event.args.amountIn,6),amountOut:formatUnits(event.args.amountOut,snapshot.decimalsOut),
    routePair:quote.pair,binStep:quote.binStep,version:quote.version,routerAllowance:await token.allowance(vaultAddress,FUJI.router),
    explorerUrl:`${FUJI.explorer}/tx/${receipt.hash}`};
  fs.writeFileSync(recordPath,JSON.stringify(toJSON(record),null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(toJSON(record),null,2));
} finally { provider.destroy(); }
