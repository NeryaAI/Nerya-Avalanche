/** Opt-in Fuji operator harness. Does not use normal Nerya accounts or keys. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {JsonRpcProvider,Wallet,Contract,ContractFactory,NonceManager,parseUnits,formatUnits,isAddress} from 'ethers';
import {ROOT,compile} from '../lib/compile.mjs';
import {FUJI,LfjFuji} from '../lib/fuji.mjs';
import {POLICY_TYPES,domainFor,evidenceHash,toJSON} from '../lib/policy.mjs';

const args=process.argv.slice(2),command=args.shift()||'help';
const flag=name=>args.includes(name);
const value=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
const write=(filename,data)=>{fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,JSON.stringify(toJSON(data),null,2)+'\n',{mode:0o600});};
const publicOut=path.join(ROOT,'artifacts','fuji');

function guardBroadcast() {
  if(process.env.NERYA_COMPETITION!=='avalanche'||process.env.NERYA_COMPETITION_ALLOW_FUJI!=='1'||!flag('--confirm-fuji'))
    throw new Error('Broadcast disabled. Requires competition mode, explicit Fuji opt-in and --confirm-fuji.');
}
async function passphrase() {
  if(flag('--keychain')) {
    const result=execFileSync('security',[
      'find-generic-password','-a','Nerya Avalanche Fuji Competition',
      '-s','nerya-avalanche-fuji-competition','-w'
    ],{encoding:'utf8'}).trim();
    if(result.length<16)throw new Error('Competition keystore password unavailable from macOS Keychain.');
    return result;
  }
  // stdin, not a CLI argument, prevents shell-history/process-list disclosure.
  let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>4096)throw new Error('Passphrase input too large');}
  const result=input.replace(/[\r\n]+$/,'');
  if(result.length<16)throw new Error('Provide a passphrase of at least 16 characters on stdin.');
  return result;
}
function keyPath(input) {
  const keys=path.join(ROOT,'.runtime','keys');
  const file=path.resolve(input||'');
  if(!file.startsWith(keys+path.sep)||path.extname(file)!=='.json')throw new Error('Only this worktree’s .runtime/keys/*.json keystores are accepted.');
  if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw new Error('Keystore symlinks are not accepted.');
  if(fs.existsSync(file)&&!fs.realpathSync(file).startsWith(fs.realpathSync(keys)+path.sep))throw new Error('Keystore path escaped the isolated directory.');
  return file;
}

if(command==='help') {
  console.log(`Fuji-only competition harness (mainnet is unsupported)

  node scripts/fuji.mjs preflight
  node scripts/fuji.mjs prepare --owner 0x... --agent 0x...
  node scripts/fuji.mjs new-wallets < passphrase-from-secure-input
  NERYA_COMPETITION=avalanche NERYA_COMPETITION_ALLOW_FUJI=1 node scripts/fuji.mjs run \\
    --owner-keystore .runtime/keys/fuji-owner.json --agent-keystore .runtime/keys/fuji-agent.json \\
    --evidence .runtime/runs/<run>/evidence.json --amount 1 --confirm-fuji < secure-stdin

No command loads your normal workspace, exchange accounts, browser wallet or private keys.
new-wallets creates encrypted TESTNET-ONLY keys; fund them yourself with test assets.
run spends test AVAX gas and up to the explicit --amount (maximum 10) LFJ test USDC.
It creates a fresh isolated vault, deposits only that amount and sends one bounded swap.
The contract is a prototype, not audited. Keep mainnet funds away from these keys.`);
} else if(command==='preflight') {
  const client=new LfjFuji();const snapshot=await client.snapshot();const quote=await client.quote(1000000n,snapshot);
  console.log(JSON.stringify(toJSON({snapshot,quote,publicBroadcastPerformed:false}),null,2));
} else if(command==='new-wallets') {
  if(process.env.NERYA_COMPETITION!=='avalanche')throw new Error('Competition mode is required');
  const password=await passphrase();const directory=path.join(ROOT,'.runtime','keys');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});const addresses={};
  for(const role of ['owner','agent']) {
    const target=path.join(directory,`fuji-${role}.json`);
    if(fs.existsSync(target))throw new Error(`Refusing to overwrite ${role} keystore`);
    const wallet=Wallet.createRandom();const encrypted=await wallet.encrypt(password);
    fs.writeFileSync(target,encrypted,{mode:0o600,flag:'wx'});addresses[role]=wallet.address;
  }
  write(path.join(publicOut,'testnet-wallet-addresses.json'),{chainId:43113,testnetOnly:true,addresses});
  console.log(JSON.stringify({chainId:43113,testnetOnly:true,addresses,notice:'Unfunded. No transaction broadcast.'},null,2));
} else if(command==='prepare') {
  const owner=value('--owner'),agent=value('--agent');
  if(!isAddress(owner||'')||!isAddress(agent||''))throw new Error('Both explicit owner and agent addresses are required');
  const client=new LfjFuji();const snapshot=await client.snapshot();const artifact=compile().NeryaPolicyVault;
  const transaction=await new ContractFactory(artifact.abi,artifact.bytecode).getDeployTransaction(owner,FUJI.router);
  const plan={chainId:43113,publicBroadcastPerformed:false,owner,agent,transaction:toJSON({...transaction,chainId:43113,value:0}),
    snapshot,requirements:['Dedicated testnet owner + agent','Test AVAX in both wallets','LFJ-specific test USDC in owner wallet','Explicit signed policy'],
    note:'Unsigned deployment transaction. This is not a deployed contract or a verified swap.'};
  write(path.join(publicOut,'unsigned-deployment.json'),plan);console.log(JSON.stringify(plan,null,2));
} else if(command==='run') {
  guardBroadcast();
  const amountText=value('--amount')||'1';
  if(!/^\d+(\.\d{1,6})?$/.test(amountText))throw new Error('Amount must be a positive test-USDC decimal with at most 6 decimal places');
  const amount=parseUnits(amountText,6);if(amount<=0n||amount>parseUnits('10',6))throw new Error('Fuji rehearsal amount must be >0 and <=10 LFJ test USDC');
  const evidenceFile=path.resolve(value('--evidence')||'');
  if(!evidenceFile.startsWith(path.join(ROOT,'.runtime','runs')+path.sep))throw new Error('Evidence must be from this isolated competition run');
  const bundle=JSON.parse(fs.readFileSync(evidenceFile,'utf8'));
  const {hash,...unsigned}=bundle;const digest=evidenceHash(unsigned);
  if(hash!==digest||!bundle.strategy)throw new Error('Evidence bundle digest or strategy binding is invalid');
  const password=await passphrase();
  const client=new LfjFuji();let snapshot=await client.snapshot();
  const provider=new JsonRpcProvider(FUJI.rpc,undefined,{cacheTimeout:-1,batchMaxCount:1});
  try {
    if((await provider.getNetwork()).chainId!==43113n)throw new Error('Wrong chain');
    const ownerWallet=(await Wallet.fromEncryptedJson(fs.readFileSync(keyPath(value('--owner-keystore')),'utf8'),password)).connect(provider);
    const agentWallet=(await Wallet.fromEncryptedJson(fs.readFileSync(keyPath(value('--agent-keystore')),'utf8'),password)).connect(provider);
    if(ownerWallet.address===agentWallet.address)throw new Error('Use distinct owner and delegated-agent accounts');
    const owner=new NonceManager(ownerWallet),agent=new NonceManager(agentWallet);
    const ownerBalance=await client.balance(ownerWallet.address),agentBalance=await client.balance(agentWallet.address);
    if(BigInt(ownerBalance.native)<parseUnits('0.1',18)||BigInt(agentBalance.native)<parseUnits('0.01',18)||BigInt(ownerBalance.usdc)<amount)
      throw new Error('Insufficient dedicated testnet funds: owner needs >=0.1 test AVAX + requested LFJ test USDC; agent >=0.01 test AVAX. Nothing broadcast.');
    const artifact=compile().NeryaPolicyVault;
    const vault=await new ContractFactory(artifact.abi,artifact.bytecode,owner).deploy(ownerWallet.address,FUJI.router);
    const deployment=await vault.deploymentTransaction().wait();
    if(deployment.status!==1)throw new Error('Deployment reverted');
    const address=await vault.getAddress();
    const record={chainId:43113,network:'Avalanche Fuji',owner:ownerWallet.address,agent:agentWallet.address,
      vault:address,deploymentHash:deployment.hash,router:FUJI.router,transactions:[],status:'deployed',
      evidenceHash:digest,executionEvidence:null,publicBroadcastPerformed:true};
    const output=path.join(publicOut,`${address}.json`);write(output,record);
    try {
      const token=new Contract(FUJI.usdc,['function approve(address,uint256) returns(bool)','function allowance(address,address) view returns(uint256)','function balanceOf(address) view returns(uint256)'],owner);
      for(const [name,send] of [['approve',()=>token.approve(address,amount)],['deposit',()=>vault.deposit(FUJI.usdc,amount)]]) {
        const receipt=await (await send()).wait();if(receipt.status!==1)throw new Error(`${name} reverted`);
        record.transactions.push({name,hash:receipt.hash,blockNumber:receipt.blockNumber});write(output,record);
      }
      snapshot=await client.snapshot();let quote=await client.supportedQuote(amount,snapshot);
      const now=(await provider.getBlock('latest')).timestamp;
      const policy={agent:agentWallet.address,tokenIn:FUJI.usdc,tokenOut:snapshot.tokenOut,strategyHash:evidenceHash(bundle.strategy),
        maxSingle:parseUnits('10',6),maxDaily:parseUnits('30',6),maxTotal:parseUnits('50',6),
        minRateWad:BigInt(quote.amountOut)*10n**18n*9920n/(amount*10000n),expiry:BigInt(now+1200),
        nonce:await vault.policyNonce(),binStep:quote.binStep,version:quote.version};
      const domain=domainFor(43113,address);const signature=await ownerWallet.signTypedData(domain,POLICY_TYPES,policy);
      const authorization=await (await vault.activatePolicy(policy,signature)).wait();
      if(authorization.status!==1)throw new Error('Policy activation reverted');
      record.transactions.push({name:'activate_policy',hash:authorization.hash,blockNumber:authorization.blockNumber});
      record.policy=toJSON({domain,policy,signature,policyHash:await vault.activePolicyHash()});write(output,record);
      // Re-quote after setup. A changed price cannot weaken the signed rate floor.
      snapshot=await client.snapshot();quote=await client.supportedQuote(amount,snapshot);
      if(Number(record.policy.policy.binStep)!==quote.binStep||Number(record.policy.policy.version)!==quote.version)
        throw new Error('LFJ best route changed after policy signing; refusing to weaken signed routing constraints');
      const minOut=(BigInt(quote.amountOut)*9920n+9999n)/10000n;
      const deadline=BigInt((await provider.getBlock('latest')).timestamp+120);
      const params=[record.policy.policyHash,amount,minOut,digest,await vault.executionNonce(),deadline];
      await vault.connect(agent).execute.staticCall(...params);
      const receipt=await (await vault.connect(agent).execute(...params)).wait();
      if(receipt.status!==1)throw new Error('Fuji swap reverted');
      const event=receipt.logs.map(log=>{try{return vault.interface.parseLog(log);}catch{return null;}}).find(e=>e?.name==='Executed');
      if(!event||event.args.evidenceHash!==digest)throw new Error('Missing expected execution evidence event');
      record.status='confirmed';record.transactions.push({name:'swap',hash:receipt.hash,blockNumber:receipt.blockNumber});
      record.executionEvidence={transactionHash:receipt.hash,blockNumber:receipt.blockNumber,intentHash:event.args.intentHash,
        evidenceHash:event.args.evidenceHash,amountIn:formatUnits(event.args.amountIn,6),amountOut:formatUnits(event.args.amountOut,snapshot.decimalsOut),
        routerAllowance:await token.allowance(address,FUJI.router),explorerUrl:`${FUJI.explorer}/tx/${receipt.hash}`};
      write(output,record);console.log(JSON.stringify(toJSON(record),null,2));
    }catch(error){record.status='needs_attention';record.error=error.shortMessage||error.message;
      record.recovery='Funds remain in the owner-controlled vault. Use the owner to revoke and withdraw; do not blindly repeat deployment.';
      write(output,record);throw error;}
  }finally{provider.destroy();}
}else throw new Error('Unknown command; use help');
