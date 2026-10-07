import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {ROOT,compile} from './lib/compile.mjs';
import {LfjFuji,FUJI} from './lib/fuji.mjs';
import {downloadMarket} from './lib/market.mjs';
import {evidenceHash,toJSON} from './lib/policy.mjs';

if(process.env.NERYA_COMPETITION!=='avalanche') throw new Error('Competition service is disabled; use the isolated launcher');
const TOKEN=process.env.NERYA_COMPETITION_TOKEN||'';
if(TOKEN.length<32) throw new Error('A dedicated competition API token is required');
const PORT=Number(process.env.NERYA_COMPETITION_API_PORT||18417);
if(!Number.isInteger(PORT)||PORT<1024||[18317,18380].includes(PORT)) throw new Error('Refusing a normal-service or invalid port');
const runtime=path.join(ROOT,'.runtime');fs.mkdirSync(runtime,{recursive:true,mode:0o700});
const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex');
const runDir=path.join(runtime,'runs',runId);fs.mkdirSync(runDir,{recursive:true,mode:0o700});
const PYTHON=process.env.NERYA_COMPETITION_PYTHON||'python3';
const chain=new LfjFuji();let proof;let busy=false;
const state={runId,stage:'idle',busy:false,network:'Local EVM / execution rehearsal',chainId:31337,
  publicBroadcastPerformed:false,fuji:null,market:null,backtest:null,policy:null,execution:null,attack:null,
  review:null,evidence:null,events:[],error:null,
  disclosure:'Live public market data and Fuji reads; contract execution uses a local EVM and DEX fixture. No LLM call or public-chain swap is implied.'};
const save=(name,value)=>fs.writeFileSync(path.join(runDir,name),JSON.stringify(toJSON(value),null,2)+'\n',{mode:0o600});
function latestFujiExecution() {
  const directory=path.join(ROOT,'artifacts','fuji');
  if(!fs.existsSync(directory)) return null;
  const rows=fs.readdirSync(directory).filter(name=>/^0x[a-fA-F0-9]{40}\.json$/.test(name)).map(name=>{
    try{return JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));}catch{return null;}
  }).filter(Boolean).filter(row=>row.chainId===43113&&row.publicBroadcastPerformed===true);
  return rows.findLast(row=>row.status==='confirmed')||rows.at(-1)||null;
}
function event(kind,payload={}) {
  const row={sequence:state.events.length+1,time:new Date().toISOString(),kind,payload,
    previousHash:state.events.at(-1)?.hash||'0x'+'0'.repeat(64)};
  row.hash=evidenceHash(row);state.events.push(row);save('state.json',state);
  fs.appendFileSync(path.join(runDir,'events.jsonl'),JSON.stringify(row)+'\n',{mode:0o600});
}
function requireState(condition,message){if(!condition){const e=new Error(message);e.status=409;throw e;}}
function subprocess(command,args) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd:ROOT,env:{...process.env,PYTHONPATH:path.resolve(ROOT,'../..'),PYTHONNOUSERSITE:'1'},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';const timer=setTimeout(()=>child.kill('SIGTERM'),70000);
    child.stdout.on('data',data=>{stdout+=data;if(stdout.length>2e6)child.kill('SIGTERM');});
    child.stderr.on('data',data=>{stderr+=data;if(stderr.length>2e6)child.kill('SIGTERM');});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{clearTimeout(timer);code===0?resolve(stdout):reject(new Error(`Backtest process exited ${code}: ${stderr.slice(-1800)}`));});
  });
}
const actions={
  async research() {
    requireState(!state.market,'Research already captured for this run. Start a new isolated run to refresh it.');
    state.stage='research';event('research.started',{sources:['public AVAX OHLCV','Avalanche Fuji RPC']});
    const [market,fuji]=await Promise.allSettled([downloadMarket(),chain.snapshot()]);
    if(market.status==='rejected') throw market.reason;
    state.market=market.value;save('market.json',state.market);
    if(fuji.status==='fulfilled') {
      state.fuji=fuji.value;
      try{state.fuji.quote=await chain.quote(10n**BigInt(state.fuji.decimalsIn),state.fuji);}
      catch(error){state.fuji.quote={status:'blocked',reason:error.message};}
    }else state.fuji={status:'unavailable',reason:fuji.reason.message,chainId:43113,readOnly:true};
    save('fuji.json',state.fuji);
    event('research.completed',{closedBars:state.market.closedBars,source:state.market.source,dataHash:state.market.dataHash,
      fujiStatus:state.fuji.status,fujiBlock:state.fuji.blockNumber||null});
  },
  async backtest() {
    requireState(state.market&&!state.backtest,'Capture research first; a replay can only be run once per session.');
    state.stage='backtest';event('backtest.started',{engine:'Nerya original bar-by-bar engine'});
    await subprocess(PYTHON,[path.join(ROOT,'scripts/backtest.py'),'--input',path.join(runDir,'market.json'),'--output',path.join(runDir,'backtest.json')]);
    state.backtest=JSON.parse(fs.readFileSync(path.join(runDir,'backtest.json'),'utf8'));
    state.evidence={schema:'nerya.avalanche.evidence.v1',runId,research:{marketHash:state.market.dataHash,
      source:state.market.sourceUrl,downloadedAt:state.market.downloadedAt,coverage:[state.market.start,state.market.end]},
      fujiSnapshot:state.fuji,strategy:state.backtest.strategy,backtestHash:evidenceHash(state.backtest),
      selectedHistoricalIntent:state.backtest.trades.findLast(t=>t.side==='buy'),
      executionScope:'local_evm_rehearsal_of_historical_buy_intent',historyHead:state.events.at(-1).hash};
    state.evidence.hash=evidenceHash(state.evidence);save('evidence.json',state.evidence);
    event('backtest.completed',{fills:state.backtest.trades.length,returnPct:state.backtest.metrics.total_return_pct,
      benchmarkPct:state.backtest.metrics.benchmark_buy_hold_return_pct,evidenceHash:state.evidence.hash});
  },
  async policy() {
    requireState(state.backtest&&!state.policy,'Run the backtest before authorizing a local test policy.');
    state.stage='policy';event('policy.preparing',{chainId:31337,authorization:'ephemeral local test owner'});
    const {LocalProof}=await import('./lib/local-proof.mjs');
    proof=await LocalProof.create({price:state.market.lastClose});
    state.policy=await proof.activate({strategyHash:evidenceHash(state.backtest.strategy)});
    save('policy.json',state.policy);event('policy.activated',{policyHash:state.policy.policyHash,chainId:31337});
  },
  async execute() {
    requireState(state.policy&&!state.execution&&proof,'Authorize the local policy first; duplicate execution is refused.');
    state.stage='execution';event('execution.submitted',{scope:'local_historical_intent_rehearsal',amount:'10 tUSDC'});
    state.execution=await proof.execute({evidence:state.evidence.hash});
    const {hash,...bundle}=state.evidence;
    state.execution.evidenceVerified=hash===evidenceHash(bundle)&&state.execution.evidenceHash===hash;
    if(!state.execution.evidenceVerified) throw new Error('Execution evidence digest mismatch');
    save('execution.json',state.execution);event('execution.confirmed',{transactionHash:state.execution.transactionHash,
      blockNumber:state.execution.blockNumber,chainId:31337,evidenceVerified:true});
  },
  async attack() {
    requireState(state.execution&&!state.attack&&proof,'Complete the valid local execution before the negative test.');
    state.stage='safety';state.attack=await proof.attack(state.evidence.hash);save('safety-rejection.json',state.attack);
    event('safety.blocked',{reason:state.attack.reason,amount:'500 tUSDC',transactionHash:state.attack.transactionHash});
  },
  async review() {
    requireState(state.execution&&!state.review,'A confirmed execution is required before building the review.');
    state.stage='review';const m=state.backtest.metrics;
    state.review={status:'plan_ready',source:'deterministic evidence summary; review agent has not been invoked',
      strategyId:state.backtest.strategy.id,version:1,policyHash:state.policy.policyHash,
      executionHash:state.execution.transactionHash,evidenceHash:state.evidence.hash,
      trigger:{primary:'after_execution_confirmed',fallback:'daily 00:15 UTC'},
      nodes:[{id:'execution_metrics',type:'script',status:'completed',label:'Collect execution + replay evidence'},
        {id:'review_agent',type:'agent',status:'awaiting_model_configuration',label:'Propose strategy revision'}],
      findings:[`Historical return ${m.total_return_pct.toFixed(2)}%; buy-and-hold ${m.benchmark_buy_hold_return_pct.toFixed(2)}%.`,
        `Maximum historical drawdown ${m.max_drawdown_pct.toFixed(2)}%; ${state.backtest.trades.length} recorded fills.`,
        'Local execution matched the signed policy; token approval returned to zero.',
        state.attack?'The deliberate 500 tUSDC request reverted atomically.':'The over-budget negative test has not been run.'],
      proposal:{status:'draft_not_promoted',suggestion:m.alpha_vs_benchmark_pct<0?
        'Investigate missed upside and turnover; evaluate a 0.5% regime hysteresis on a separate holdout window.':
        'Test robustness on a separate holdout window before considering promotion.',
        requires:['fresh backtest','operator review','new owner policy for any strategy/authority change']},
      limitations:'Review plan and deterministic findings are real. No model-generated proposal or automated scheduler execution is claimed.'};
    save('review-plan.json',state.review);event('review.plan_ready',{nodes:2,autoPromotion:false,modelInvoked:false});
  },
};
function authorized(header) {
  const value=typeof header==='string'?header:'';
  const expected='Bearer '+TOKEN;
  return value.length===expected.length&&crypto.timingSafeEqual(Buffer.from(value),Buffer.from(expected));
}
const server=http.createServer(async(req,res)=>{
  const reply=(status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff'});res.end(JSON.stringify(toJSON(data)));};
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/health'&&req.method==='GET') return reply(200,{service:'nerya-avalanche-competition',runId,chainId:31337});
  if(!authorized(req.headers.authorization)) return reply(401,{error:'Competition token required'});
  try {
    if(req.method==='GET'&&url.pathname==='/state') return reply(200,{...state,busy});
    if(req.method==='GET'&&url.pathname==='/bundle') return reply(200,{...state,busy,provenance:JSON.parse(fs.readFileSync(path.join(ROOT,'provenance.json'),'utf8'))});
    if(req.method==='GET'&&url.pathname==='/fuji/wallet') {
      const file=path.join(ROOT,'artifacts','fuji','testnet-wallet-addresses.json');
      if(!fs.existsSync(file))return reply(404,{error:'Competition testnet wallet addresses are not initialized'});
      const {addresses}=JSON.parse(fs.readFileSync(file,'utf8'));
      const [owner,agent]=await Promise.all([chain.balance(addresses.owner),chain.balance(addresses.agent)]);
      return reply(200,{chainId:43113,network:'Avalanche Fuji',testnetOnly:true,addresses,balances:{owner,agent},observedAt:new Date().toISOString()});
    }
    if(req.method==='GET'&&url.pathname==='/fuji/execution') {
      const execution=latestFujiExecution();
      if(!execution)return reply(404,{error:'No public Fuji execution artifact recorded'});
      return reply(200,execution);
    }
    if(req.method==='GET'&&url.pathname==='/fuji/artifact') return reply(200,{contract:compile().NeryaPolicyVault,network:FUJI,
      note:'Unsigned deployment artifact only. No Fuji deployment is claimed.'});
    if(req.method!=='POST') return reply(404,{error:'Not found'});
    if((req.headers['content-type']||'').split(';')[0]!=='application/json') return reply(415,{error:'JSON required'});
    let body='';for await(const chunk of req){body+=chunk;if(body.length>16384){return reply(413,{error:'Request too large'});}}
    if(body)JSON.parse(body);
    const key=url.pathname.slice(1);
    if(!Object.hasOwn(actions,key))return reply(404,{error:'Unknown competition action'});
    const action=actions[key];
    if(busy)return reply(409,{error:'An operation is already in progress'});
    busy=true;state.error=null;
    try{await action();save('state.json',state);return reply(200,state);}
    finally{busy=false;}
  }catch(error){state.error=error.message;event('operation.error',{message:error.message});return reply(error.status||422,{error:error.message,state});}
});
server.requestTimeout=20000;server.headersTimeout=10000;
server.listen(PORT,'127.0.0.1',()=>console.log(JSON.stringify({service:'nerya-avalanche-competition',port:PORT,runId,scope:'isolated-local-test'})));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{await proof?.close();process.exit(0);}));
