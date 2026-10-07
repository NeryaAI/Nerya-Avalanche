const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');

for (const ext of ['.ts','.tsx']) require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
}).outputText,f);
const {fieldLabel,readableResult,agentDisplayName}=require('../lib/agentConversation.ts');
const {avalancheReceipts}=require('../components/chat/AvalancheReceiptCard.tsx');
const {isLfjMarket,lfjMarkets}=require('../components/chat/AvalancheLfjMarketCard.tsx');
const {backtestDisplayLabel}=require('../lib/backtestPresentation.ts');

test('known chart labels are Chinese without changing custom names or market symbols',()=>{
  assert.equal(backtestDisplayLabel('Equity vs B&H',true),'策略净值与买入持有基准');
  assert.equal(backtestDisplayLabel('equity',true),'策略净值');
  assert.equal(backtestDisplayLabel('benchmark',true),'买入持有基准');
  assert.equal(backtestDisplayLabel('BINANCE:AVAXUSDT',true),'BINANCE:AVAXUSDT');
  assert.equal(backtestDisplayLabel('Custom research comparison',true),'Custom research comparison');
  assert.equal(backtestDisplayLabel('equity',false),'equity');
});

test('Chinese cards separate execution status from research verdict and preserve risk warnings',()=>{
  const chat=JSON.parse(fs.readFileSync(require.resolve('../messages/zh/chat.json'),'utf8'));
  const strategy=JSON.parse(fs.readFileSync(require.resolve('../messages/zh/strategies.json'),'utf8'));
  assert.equal(chat.copy.components_chat_BacktestReplyCards.completed,'回测已完成');
  assert.ok(chat.copy.components_chat_BacktestReplyCards.researchVerdict.includes('不代表执行失败'));
  assert.ok(strategy.strategyProposal.backtestEvaluation.FAIL.includes('未达标'));
});

function settingsFor(competition,language='en-US',stored) {
  const source=ts.transpileModule(fs.readFileSync(require.resolve('../lib/settings.ts'),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  const module={exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports,require:()=>({}),
    process:{env:{NEXT_PUBLIC_NERYA_COMPETITION:competition}},navigator:{languages:[language],language},
    window:{localStorage:{getItem:()=>stored?JSON.stringify(stored):null}}});
  return module.exports;
}

test('isolated competition starts in Chinese even in an English browser',()=>{
  const s=settingsFor('avalanche');
  assert.equal(s.DEFAULT_SETTINGS.language,'zh');
  assert.equal(s.detectBrowserLanguage(),'zh');
  assert.equal(s.loadSettings().language,'zh');
});
test('normal edition and explicit saved preferences retain original semantics',()=>{
  assert.equal(settingsFor(undefined).loadSettings().language,'en');
  assert.equal(settingsFor(undefined,'zh-CN').loadSettings().language,'zh');
  assert.equal(settingsFor('avalanche','zh-CN',{language:'en'}).loadSettings().language,'en');
});
test('Chinese metadata translates labels, not numeric results or source content',()=>{
  const value={signal:'neutral',confidence:0.8,source:'https://example.test/evidence',data_gaps:['尚未取得运营数据'],orders_placed:false};
  const before=JSON.stringify(value);const text=readableResult(value,true);
  for(const part of ['方向判断','中性','置信度','0.8','证据来源','https://example.test/evidence','数据缺口','尚未取得运营数据','是否已下单','否'])assert.ok(text.includes(part),part);
  assert.equal(JSON.stringify(value),before);
  assert.equal(fieldLabel('provider_specific_field',true),'provider specific field');
  assert.equal(readableResult('Keep the source statement exactly as written.',true),'Keep the source statement exactly as written.');
});
test('research role aliases are presentation-only and competition-scoped',()=>{
  const old=process.env.NEXT_PUBLIC_NERYA_COMPETITION;
  try {
    delete process.env.NEXT_PUBLIC_NERYA_COMPETITION;assert.equal(agentDisplayName('technical',true),'technical');
    process.env.NEXT_PUBLIC_NERYA_COMPETITION='avalanche';
    assert.equal(agentDisplayName('technical',true),'技术分析师');
    assert.equal(agentDisplayName('ecosystem',true),'生态研究员');
    assert.equal(agentDisplayName('risk',true),'风险审查员');
    assert.equal(agentDisplayName('technical',false),'technical');
    assert.equal(agentDisplayName('user-custom-role',true),'user-custom-role');
  } finally {if(old===undefined)delete process.env.NEXT_PUBLIC_NERYA_COMPETITION;else process.env.NEXT_PUBLIC_NERYA_COMPETITION=old;}
});

// Renderer fixtures only. These tests never mount their data into the demo app.
function receiptFixture(overrides={}){
  return {kind:'avalanche_execution_receipt',chainId:43113,status:'verified',testnetOnly:true,
    referenceExecution:true,newTransactionSubmitted:false,signatureVerified:true,evidenceEventVerified:true,
    transactionHash:'0x'+'a'.repeat(64),...overrides};
}
test('native completed events and persisted blocks share one receipt collector',()=>{
  const receipt=receiptFixture();const event={kind:'tool.complete',seq:1,ts:1,call_id:'read-only-proof',action:'avalanche_verify_receipt',ok:true,result:receipt};
  const message={id:'fixture',role:'assistant',ts:1,live_events:[event],turn:{blocks:[{block:{...event,kind:'tool_result'}}],tool_trace:[event]}};
  assert.equal(avalancheReceipts(message).length,1);
  assert.equal(avalancheReceipts(message)[0].transactionHash,receipt.transactionHash);
});
test('receipt-shaped user input, failed calls and unrelated tools are not promoted',()=>{
  const receipt=receiptFixture();const collect=block=>avalancheReceipts({id:'fixture',role:'assistant',ts:1,turn:{blocks:[{block}]}});
  assert.equal(collect({kind:'tool_use',action:'avalanche_verify_receipt',payload:receipt}).length,0);
  assert.equal(collect({kind:'tool_result',action:'avalanche_verify_receipt',ok:false,result:receipt}).length,0);
  assert.equal(collect({kind:'tool_result',action:'read_file',ok:true,result:receipt}).length,0);
  assert.equal(collect({kind:'tool_result',action:'avalanche_verify_receipt',ok:true,result:receiptFixture({signatureVerified:false})}).length,0);
  assert.equal(collect({kind:'tool_result',action:'avalanche_verify_receipt',ok:true,result:receiptFixture({chainId:43114})}).length,0);
});

function lfjFixture(overrides={}){
  return {kind:'avalanche_lfj_market_research',chainId:43114,readOnly:true,newTransactionSubmitted:false,
    blockNumber:100,blockHash:'0x'+'b'.repeat(64),observedAt:'2026-10-07T00:00:00Z',
    quotes:[{inputUsdc:100,outputWavax:10,feeInputUsdc:.05,feeBps:5,effectiveUsdcPerWavax:10,completelyFillable:true,version:'LFJ V2.2'}],...overrides};
}
test('LFJ card requires a timestamped read-only mainnet quote, never a claimed fill',()=>{
  assert.equal(isLfjMarket(lfjFixture()),true);
  for(const change of [{chainId:43113},{newTransactionSubmitted:true},{readOnly:false},{observedAt:'invalid'},{blockHash:'fake'},{quotes:[]}])
    assert.equal(isLfjMarket(lfjFixture(change)),false);
});
test('LFJ numeric display rejects malformed prices and negative quantities',()=>{
  for(const change of [{inputUsdc:-1},{outputWavax:NaN},{feeInputUsdc:-1},{feeBps:Infinity},{effectiveUsdcPerWavax:'10'}])
    assert.equal(isLfjMarket(lfjFixture({quotes:[{...lfjFixture().quotes[0],...change}]})),false);
});
test('LFJ card collector preserves source numbers and deduplicates native events',()=>{
  const quote=lfjFixture();const event={kind:'tool.complete',seq:1,ts:1,action:'avalanche_lfj_market',ok:true,result:quote};
  const message={id:'fixture',role:'assistant',ts:1,live_events:[event],turn:{tool_trace:[event],blocks:[{block:{...event,kind:'tool_result'}}]}};
  const before=JSON.stringify(message);assert.equal(lfjMarkets(message).length,1);assert.equal(lfjMarkets(message)[0].quotes[0].outputWavax,10);assert.equal(JSON.stringify(message),before);
});
test('LFJ-shaped input and failed or unrelated calls do not become market cards',()=>{
  const collect=block=>lfjMarkets({id:'fixture',role:'assistant',ts:1,turn:{blocks:[{block}]}});
  assert.equal(collect({kind:'tool_use',action:'avalanche_lfj_market',payload:lfjFixture()}).length,0);
  assert.equal(collect({kind:'tool_result',action:'avalanche_lfj_market',ok:false,result:lfjFixture()}).length,0);
  assert.equal(collect({kind:'tool_result',action:'read_file',ok:true,result:lfjFixture()}).length,0);
});
