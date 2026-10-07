import ganache from 'ganache';
import {BrowserProvider, ContractFactory, Wallet, ZeroHash, parseUnits, formatUnits} from 'ethers';
import {compile} from './compile.mjs';
import {POLICY_TYPES, domainFor, evidenceHash, toJSON} from './policy.mjs';

export function errorName(error, iface) {
  const candidates = [error?.data, error?.info?.error?.data?.result,
    error?.info?.error?.data, error?.error?.data];
  for (const value of candidates) {
    if (typeof value === 'string') { try { return iface.parseError(value)?.name || error.shortMessage; } catch {} }
  }
  return error?.revert?.name || error?.shortMessage || 'ExecutionRejected';
}

export class LocalProof {
  static async create({price = 25} = {}) {
    if (!(Number.isFinite(price) && price > 0)) throw new Error('A positive reference price is required');
    const rpc = ganache.provider({logging:{quiet:true}, chain:{chainId:31337,hardfork:'shanghai'},
      wallet:{totalAccounts:3}, miner:{blockGasLimit:15_000_000}});
    const provider = new BrowserProvider(rpc, undefined, {cacheTimeout:-1});
    provider.pollingInterval = 20;
    const signers = await Promise.all([0,1,2].map(i => provider.getSigner(i)));
    const accounts = rpc.getInitialAccounts();
    const ownerAddress = await signers[0].getAddress();
    // Ephemeral LOCAL accounts only. Never serialized or sent to the UI.
    const ownerWallet = new Wallet(accounts[ownerAddress.toLowerCase()].secretKey);
    const contracts = compile();
    async function deploy(name, args) {
      const artifact = contracts[name];
      const instance = await new ContractFactory(artifact.abi, artifact.bytecode, signers[0]).deploy(...args);
      await instance.waitForDeployment();
      return instance;
    }
    const input = await deploy('LocalToken',['Local Test USDC','tUSDC',6]);
    const output = await deploy('LocalToken',['Local Test WAVAX','tWAVAX',18]);
    const rateWad = 10n ** 38n / BigInt(Math.round(price * 1e8));
    const router = await deploy('LocalRouterFixture',[rateWad]);
    const vault = await deploy('NeryaPolicyVault',[ownerAddress, await router.getAddress()]);
    await (await input.mint(ownerAddress, parseUnits('100',6))).wait();
    await (await output.mint(await router.getAddress(), parseUnits('10000',18))).wait();
    await (await input.approve(await vault.getAddress(), parseUnits('100',6))).wait();
    await (await vault.deposit(await input.getAddress(), parseUnits('100',6))).wait();
    return Object.assign(new LocalProof(), {rpc,provider,signers,ownerWallet,ownerAddress,
      input,output,router,vault,rateWad,price,policy:null,signature:null});
  }

  async now() { return (await this.provider.getBlock('latest')).timestamp; }
  async makePolicy(overrides = {}) {
    return {
      agent:await this.signers[1].getAddress(), tokenIn:await this.input.getAddress(),
      tokenOut:await this.output.getAddress(), strategyHash:evidenceHash({strategy:'avax-trend-v1'}),
      maxSingle:parseUnits('10',6), maxDaily:parseUnits('30',6), maxTotal:parseUnits('50',6),
      minRateWad:this.rateWad * 9920n / 10000n, expiry:BigInt(await this.now() + 7200),
      nonce:await this.vault.policyNonce(), binStep:20, version:2, ...overrides,
    };
  }
  async activate(overrides = {}) {
    this.policy = await this.makePolicy(overrides);
    const domain = domainFor(31337, await this.vault.getAddress());
    this.signature = await this.ownerWallet.signTypedData(domain, POLICY_TYPES, this.policy);
    const receipt = await (await this.vault.activatePolicy(this.policy, this.signature)).wait();
    this.hash = await this.vault.activePolicyHash();
    return toJSON({domain, policy:this.policy, signature:this.signature, policyHash:this.hash,
      network:'Local EVM',chainId:31337,transactionHash:receipt.hash,blockNumber:receipt.blockNumber,
      authorization:'ephemeral local test owner', priceFloorNote:'Owner-signed reference rate; not a live oracle'});
  }
  async args({amount = '10', minOut, evidence, nonce, deadline} = {}) {
    const amountIn = parseUnits(amount,6);
    return [this.hash || ZeroHash,amountIn,minOut ?? amountIn * this.rateWad * 9925n / (10000n * 10n**18n),
      evidence ?? evidenceHash({purpose:'contract-test'}), nonce ?? await this.vault.executionNonce(),
      deadline ?? BigInt(await this.now() + 120)];
  }
  async execute(options = {}) {
    const args = await this.args(options);
    const tx = await this.vault.connect(this.signers[1]).execute(...args);
    const receipt = await tx.wait();
    const event = receipt.logs.map(log => {try{return this.vault.interface.parseLog(log);}catch{return null;}})
      .find(event => event?.name === 'Executed');
    if (!event || receipt.status !== 1) throw new Error('Missing successful execution evidence');
    return toJSON({status:'confirmed',network:'Local EVM',chainId:31337,fixture:true,
      venue:'Local LFJ-ABI fixture (not an LFJ deployment)',contract:await this.vault.getAddress(),
      transactionHash:receipt.hash,blockNumber:receipt.blockNumber,gasUsed:receipt.gasUsed,
      policyHash:event.args.policyHash,intentHash:event.args.intentHash,evidenceHash:event.args.evidenceHash,
      strategyHash:event.args.strategyHash,amountIn:formatUnits(event.args.amountIn,6),
      amountOut:formatUnits(event.args.amountOut,18),executionNonce:event.args.nonce,
      remainingAllowance:await this.input.allowance(await this.vault.getAddress(),await this.router.getAddress()),
      balances:{usdc:formatUnits(await this.input.balanceOf(await this.vault.getAddress()),6),
        wavax:formatUnits(await this.output.balanceOf(await this.vault.getAddress()),18)},
      logs:receipt.logs.map(log=>({address:log.address,topics:log.topics,data:log.data}))});
  }
  async attack(evidence) {
    const args = await this.args({amount:'500',evidence});
    let reason;
    try { await this.vault.connect(this.signers[1]).execute.staticCall(...args); }
    catch (error) { reason = errorName(error,this.vault.interface); }
    if (reason !== 'SingleTradeCap') throw new Error('Over-budget attempt was not rejected as expected');
    const before = await this.input.balanceOf(await this.vault.getAddress());
    const nonceBefore = await this.vault.executionNonce();
    let receipt;
    const tx = await this.vault.connect(this.signers[1]).execute(...args,{gasLimit:400000});
    try { receipt = await tx.wait(); } catch (error) { receipt = error.receipt; }
    if (!receipt || receipt.status !== 0) throw new Error('Expected a real reverted local-EVM transaction');
    const after = await this.input.balanceOf(await this.vault.getAddress());
    if (before !== after || nonceBefore !== await this.vault.executionNonce()) throw new Error('Revert was not atomic');
    return toJSON({status:'blocked',reason,attemptedAmount:'500',limit:'10',chainId:31337,
      network:'Local EVM',fixture:true,transactionHash:receipt.hash,blockNumber:receipt.blockNumber,
      receiptStatus:receipt.status,tokenBalanceUnchanged:true,executionNonceUnchanged:true,
      note:'Expected safety rejection; not a failed strategy or failed backtest.'});
  }
  async close() { this.provider.destroy(); await this.rpc.disconnect(); }
}
