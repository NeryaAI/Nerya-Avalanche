import {test,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,ZeroHash,parseUnits,verifyTypedData} from 'ethers';
import {LocalProof,errorName} from '../lib/local-proof.mjs';
import {POLICY_TYPES,domainFor,evidenceHash,canonicalJSON} from '../lib/policy.mjs';

let ctx, snapshot;
before(async()=>{ctx=await LocalProof.create({price:25});});
after(async()=>{await ctx?.close();});
beforeEach(async()=>{snapshot=await ctx.provider.send('evm_snapshot',[]);ctx.policy=null;ctx.hash=null;});
afterEach(async()=>{await ctx.provider.send('evm_revert',[snapshot]);});
const rejects = (fn,name) => assert.rejects(fn,error=>errorName(error,ctx.vault.interface)===name);

test('owner-signed EIP-712 policy matches Solidity digest and real execution receipt',async()=>{
  const authorization=await ctx.activate();
  assert.equal(verifyTypedData(authorization.domain,POLICY_TYPES,authorization.policy,authorization.signature),ctx.ownerAddress);
  assert.equal(await ctx.vault.hashPolicy(ctx.policy),authorization.policyHash);
  const receipt=await ctx.execute();
  assert.equal(receipt.chainId,31337);assert.equal(receipt.status,'confirmed');
  assert.equal(receipt.amountIn,'10.0');assert.equal(receipt.remainingAllowance,'0');
  assert.equal(receipt.evidenceHash,evidenceHash({purpose:'contract-test'}));
});
test('an unrelated signer cannot authorize a policy',async()=>{
  const p=await ctx.makePolicy();
  const s=await Wallet.createRandom().signTypedData(domainFor(31337,await ctx.vault.getAddress()),POLICY_TYPES,p);
  await rejects(()=>ctx.vault.activatePolicy.staticCall(p,s),'InvalidSignature');
});
test('a signature from another chain cannot be replayed',async()=>{
  const p=await ctx.makePolicy();
  const s=await ctx.ownerWallet.signTypedData(domainFor(43113,await ctx.vault.getAddress()),POLICY_TYPES,p);
  await rejects(()=>ctx.vault.activatePolicy.staticCall(p,s),'InvalidSignature');
});
test('a signature for another vault cannot be replayed',async()=>{
  const p=await ctx.makePolicy();
  const s=await ctx.ownerWallet.signTypedData(domainFor(31337,await ctx.router.getAddress()),POLICY_TYPES,p);
  await rejects(()=>ctx.vault.activatePolicy.staticCall(p,s),'InvalidSignature');
});
test('tampering with signed limits is rejected',async()=>{
  const p=await ctx.makePolicy();
  const s=await ctx.ownerWallet.signTypedData(domainFor(31337,await ctx.vault.getAddress()),POLICY_TYPES,p);
  await rejects(()=>ctx.vault.activatePolicy.staticCall({...p,maxSingle:parseUnits('11',6)},s),'InvalidSignature');
});
test('an authorization cannot be activated twice',async()=>{
  await ctx.activate();
  await rejects(()=>ctx.vault.activatePolicy.staticCall(ctx.policy,ctx.signature),'PolicyReplay');
});
test('only the delegated agent can execute',async()=>{
  await ctx.activate();const args=await ctx.args();
  await rejects(()=>ctx.vault.connect(ctx.signers[2]).execute.staticCall(...args),'AgentOnly');
});
test('over-budget intent produces a real reverted transaction with no token movement',async()=>{
  await ctx.activate();const receipt=await ctx.attack(evidenceHash({attack:'overspend'}));
  assert.equal(receipt.reason,'SingleTradeCap');assert.equal(receipt.receiptStatus,0);
  assert.equal(receipt.tokenBalanceUnchanged,true);assert.equal(receipt.executionNonceUnchanged,true);
});
test('daily input-token spend accumulates across executions',async()=>{
  await ctx.activate({maxDaily:parseUnits('15',6)});await ctx.execute();
  const args=await ctx.args();
  await rejects(()=>ctx.vault.connect(ctx.signers[1]).execute.staticCall(...args),'DailyBudgetCap');
});
test('total input-token budget accumulates across executions',async()=>{
  await ctx.activate({maxTotal:parseUnits('15',6)});await ctx.execute();const args=await ctx.args();
  await rejects(()=>ctx.vault.connect(ctx.signers[1]).execute.staticCall(...args),'TotalBudgetCap');
});
test('execution nonce prevents duplicate intents',async()=>{
  await ctx.activate();await ctx.execute();const args=await ctx.args({nonce:0});
  await rejects(()=>ctx.vault.connect(ctx.signers[1]).execute.staticCall(...args),'IntentReplay');
});
test('owner revocation is immediate and invalidates active policy',async()=>{
  await ctx.activate();await (await ctx.vault.revoke()).wait();const args=await ctx.args();
  await rejects(()=>ctx.vault.connect(ctx.signers[1]).execute.staticCall(...args),'PolicyInactive');
});
test('an agent cannot revoke or withdraw',async()=>{
  await ctx.activate();
  await rejects(()=>ctx.vault.connect(ctx.signers[1]).revoke.staticCall(),'OwnerOnly');
  await rejects(()=>ctx.vault.connect(ctx.signers[1]).withdraw.staticCall(ctx.policy.tokenIn,1),'OwnerOnly');
});
test('expired policy cannot execute',async()=>{
  // Authorize while comfortably valid, then explicitly move the EVM clock.
  // A five-second wall-clock expiry could elapse during signing/mining under
  // CPU load and test activation instead of the intended execution guard.
  await ctx.activate({expiry:BigInt(await ctx.now()+3600)});
  await ctx.provider.send('evm_increaseTime',[3601]);await ctx.provider.send('evm_mine',[]);
  const args=await ctx.args();await rejects(()=>ctx.vault.connect(ctx.signers[1]).execute.staticCall(...args),'PolicyExpired');
});
test('a quote cannot weaken the signed minimum exchange rate',async()=>{
  await ctx.activate();const args=await ctx.args({minOut:1n});
  await rejects(()=>ctx.vault.connect(ctx.signers[1]).execute.staticCall(...args),'PriceFloor');
});
test('a router that underpays is caught by actual balance-delta validation',async()=>{
  await ctx.activate();await (await ctx.router.setUnderpay(true)).wait();const args=await ctx.args();
  await rejects(()=>ctx.vault.connect(ctx.signers[1]).execute.staticCall(...args),'PriceFloor');
  assert.equal(await ctx.vault.executionNonce(),0n);assert.equal(await ctx.vault.totalSpent(ctx.hash),0n);
});
test('empty evidence is rejected',async()=>{
  await ctx.activate();const args=await ctx.args({evidence:ZeroHash});
  await rejects(()=>ctx.vault.connect(ctx.signers[1]).execute.staticCall(...args),'InvalidEvidence');
});
test('unbounded quote deadline is rejected',async()=>{
  await ctx.activate();const args=await ctx.args({deadline:BigInt(await ctx.now()+600)});
  await rejects(()=>ctx.vault.connect(ctx.signers[1]).execute.staticCall(...args),'InvalidDeadline');
});
test('canonical evidence is stable across object-key order and detects tampering',()=>{
  assert.equal(evidenceHash({a:1,b:[2,3]}),evidenceHash({b:[2,3],a:1}));
  assert.notEqual(evidenceHash({a:1}),evidenceHash({a:2}));
  assert.throws(()=>canonicalJSON({a:NaN}));
});
