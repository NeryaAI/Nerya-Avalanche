import {Interface,keccak256,formatUnits,isAddress} from 'ethers';

export const FUJI = Object.freeze({
  chainId:43113, rpc:'https://api.avax-test.network/ext/bc/C/rpc',
  explorer:'https://testnet.snowtrace.io',
  router:'0x18556DA13313f3532c54711497A8FedAC273220E',
  quoter:'0x9A550a522BBaDFB69019b0432800Ed17855A51C3',
  usdc:'0xB6076C93701D6a07266c31066B298AeC6dd65c2d',
  pair:'0x099deb72844417148E8ee4aA6752d138BedE0c39',
  binStep:20, version:2,
  source:'https://developers.lfj.gg/deployment-addresses/fuji',
  warning:'LFJ test USDC is NOT Circle or the generic Avalanche-faucet USDC.'
});
const abi = new Interface([
  'function getWNATIVE() view returns (address)',
  'function getTokenX() view returns (address)',
  'function getTokenY() view returns (address)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function getReserves() view returns (uint128,uint128)',
  'function getSwapOut(address,uint128,bool) view returns (uint128,uint128,uint128)',
  'function findBestPathFromAmountIn(address[] route,uint128 amountIn) view returns ((address[] route,address[] pairs,uint256[] binSteps,uint8[] versions,uint128[] amounts,uint128[] virtualAmountsWithoutSlippage,uint128[] fees) quote)',
  'function getFactory() view returns(address)',
  'function getFactoryV2_1() view returns(address)',
  'function getAllLBPairs(address,address) view returns((uint16 binStep,address LBPair,bool createdByOwner,bool ignoredForRouting)[])',
]);
export class LfjFuji {
  constructor(transport) {this.transport=transport;this.id=0;}
  async rpc(method,params=[]) {
    if(this.transport) return this.transport(method,params);
    const response=await fetch(FUJI.rpc,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:++this.id,method,params}),signal:AbortSignal.timeout(12000)});
    if(!response.ok) throw new Error(`Fuji RPC HTTP ${response.status}`);
    const data=await response.json();
    if(data.error) throw new Error(`Fuji RPC ${method}: ${data.error.message}`);
    if(data.result===undefined) throw new Error('Missing RPC result');
    return data.result;
  }
  async assertChain() {
    const actual=Number(BigInt(await this.rpc('eth_chainId')));
    if(actual!==FUJI.chainId) throw new Error(`Wrong chain ${actual}; only Fuji 43113 is allowed`);
  }
  async read(address,name,args=[],block='latest') {
    const raw=await this.rpc('eth_call',[{to:address,data:abi.encodeFunctionData(name,args)},block]);
    return abi.decodeFunctionResult(name,raw);
  }
  async snapshot() {
    await this.assertChain();
    const blockHex=await this.rpc('eth_blockNumber');
    const [routerCode,tokenCode,pairCode,block]=await Promise.all([
      this.rpc('eth_getCode',[FUJI.router,blockHex]),this.rpc('eth_getCode',[FUJI.usdc,blockHex]),
      this.rpc('eth_getCode',[FUJI.pair,blockHex]),this.rpc('eth_getBlockByNumber',[blockHex,false])]);
    if([routerCode,tokenCode,pairCode].some(code=>code==='0x'||code==='0x0')) throw new Error('Configured LFJ deployment is missing bytecode');
    const [wrapped,x,y,decimalsIn]=await Promise.all([
      this.read(FUJI.router,'getWNATIVE',[],blockHex),this.read(FUJI.pair,'getTokenX',[],blockHex),
      this.read(FUJI.pair,'getTokenY',[],blockHex),this.read(FUJI.usdc,'decimals',[],blockHex)]);
    const set=[x[0].toLowerCase(),y[0].toLowerCase()];
    if(!set.includes(FUJI.usdc.toLowerCase())||!set.includes(wrapped[0].toLowerCase())) throw new Error('LFJ pool token identity mismatch');
    const [decimalsOut,reserves]=await Promise.all([
      this.read(wrapped[0],'decimals',[],blockHex),this.read(FUJI.pair,'getReserves',[],blockHex)]);
    return {status:'verified',network:'Avalanche Fuji',chainId:43113,readOnly:true,
      blockNumber:Number(BigInt(blockHex)),blockHash:block.hash,blockTime:new Date(Number(BigInt(block.timestamp))*1000).toISOString(),
      observedAt:new Date().toISOString(),router:FUJI.router,pair:FUJI.pair,tokenIn:FUJI.usdc,tokenOut:wrapped[0],
      decimalsIn:Number(decimalsIn[0]),decimalsOut:Number(decimalsOut[0]),tokenX:x[0],tokenY:y[0],
      reserves:reserves.map(value=>value.toString()),routerCodeHash:keccak256(routerCode),
      binStep:FUJI.binStep,version:FUJI.version,source:FUJI.source,rpc:FUJI.rpc,warning:FUJI.warning};
  }
  async quote(rawAmount,snapshot) {
    const amount=BigInt(rawAmount);
    if(amount<=0n||amount>=2n**128n) throw new Error('Quote amount outside uint128 range');
    await this.assertChain();
    const s=snapshot||await this.snapshot();
    const block='0x'+s.blockNumber.toString(16);
    const [left,out,fee]=await this.read(FUJI.router,'getSwapOut',[FUJI.pair,amount,s.tokenX.toLowerCase()===FUJI.usdc.toLowerCase()],block);
    if(left!==0n||out<=0n) throw new Error('LFJ Fuji liquidity cannot fill this input amount');
    return {amountIn:amount.toString(),amountOut:out.toString(),amountInHuman:formatUnits(amount,s.decimalsIn),
      amountOutHuman:formatUnits(out,s.decimalsOut),fee:fee.toString(),amountInLeft:left.toString(),
      blockNumber:s.blockNumber,blockHash:s.blockHash,chainId:43113,readOnly:true,
      note:'Historical-block quote; must be refreshed and simulated before broadcast.'};
  }
  async bestQuote(rawAmount,snapshot) {
    const amount=BigInt(rawAmount);
    if(amount<=0n||amount>=2n**128n) throw new Error('Quote amount outside uint128 range');
    await this.assertChain();
    const s=snapshot||await this.snapshot();
    const block='0x'+s.blockNumber.toString(16);
    const [quote]=await this.read(FUJI.quoter,'findBestPathFromAmountIn',[[FUJI.usdc,s.tokenOut],amount],block);
    if(quote.route.length!==2||quote.pairs.length!==1||quote.binSteps.length!==1||quote.versions.length!==1||quote.amounts.length!==2)
      throw new Error('LFJ quoter did not return a one-hop Fuji route');
    if(quote.amounts[1]<=0n) throw new Error('LFJ Fuji quoter returned zero output');
    return {amountIn:amount.toString(),amountOut:quote.amounts[1].toString(),amountInHuman:formatUnits(amount,s.decimalsIn),
      amountOutHuman:formatUnits(quote.amounts[1],s.decimalsOut),pair:quote.pairs[0],binStep:Number(quote.binSteps[0]),
      version:Number(quote.versions[0]),route:[...quote.route],fee:quote.fees[0].toString(),blockNumber:s.blockNumber,
      blockHash:s.blockHash,chainId:43113,readOnly:true,note:'LFJ Quoter best one-hop route at the referenced block.'};
  }
  async supportedQuote(rawAmount,snapshot) {
    const amount=BigInt(rawAmount);
    if(amount<=0n||amount>=2n**128n) throw new Error('Quote amount outside uint128 range');
    await this.assertChain();
    const s=snapshot||await this.snapshot();
    const block='0x'+s.blockNumber.toString(16);
    const [factoryV2_1]=await this.read(FUJI.router,'getFactoryV2_1',[],block);
    const [factoryV2_2]=await this.read(FUJI.router,'getFactory',[],block);
    let best=null;
    for(const candidate of [{factory:factoryV2_1,version:2},{factory:factoryV2_2,version:3}]) {
      const [pairs]=await this.read(candidate.factory,'getAllLBPairs',[FUJI.usdc,s.tokenOut],block);
      for(const info of pairs) {
        if(info.ignoredForRouting) continue;
        const pair=info.LBPair;
        const [tokenX]=await this.read(pair,'getTokenX',[],block);
        const swapForY=tokenX.toLowerCase()===FUJI.usdc.toLowerCase();
        try {
          const [left,out,fee]=await this.read(FUJI.router,'getSwapOut',[pair,amount,swapForY],block);
          if(left===0n&&out>0n&&(!best||out>best.amountOut)) best={pair,binStep:Number(info.binStep),version:candidate.version,amountOut:out,fee};
        } catch {}
      }
    }
    if(!best) throw new Error('No LFJ V2.1/V2.2 Fuji route can fill this amount');
    return {amountIn:amount.toString(),amountOut:best.amountOut.toString(),amountInHuman:formatUnits(amount,s.decimalsIn),
      amountOutHuman:formatUnits(best.amountOut,s.decimalsOut),pair:best.pair,binStep:best.binStep,version:best.version,
      route:[FUJI.usdc,s.tokenOut],fee:best.fee.toString(),blockNumber:s.blockNumber,blockHash:s.blockHash,
      chainId:43113,readOnly:true,note:'Best route constrained to PolicyVault-supported LFJ V2.1/V2.2 markets.'};
  }
  async receipt(hash) {
    if(!/^0x[a-fA-F0-9]{64}$/.test(hash)) throw new Error('Invalid transaction hash');
    await this.assertChain();
    const receipt=await this.rpc('eth_getTransactionReceipt',[hash]);
    if(!receipt) return {status:'pending',chainId:43113,transactionHash:hash};
    return {...receipt,status:receipt.status==='0x1'?'confirmed':'reverted',chainId:43113,
      explorerUrl:`${FUJI.explorer}/tx/${hash}`};
  }
  async balance(address) {
    if(!isAddress(address)) throw new Error('Invalid wallet address');
    await this.assertChain();
    return {native:await this.rpc('eth_getBalance',[address,'latest']),
      usdc:(await this.read(FUJI.usdc,'balanceOf',[address]))[0].toString()};
  }
}
