"use client";

import {useState} from "react";
import {useLocale} from "next-intl";
import {GlobeIcon} from "../icons";
import {contentValue,record} from "../../lib/agentConversation";
import {liveEventsToBlocks,type AssistantMessage} from "../../lib/chat";

type Quote = {inputUsdc:number;outputWavax:number;feeInputUsdc:number;feeBps:number;effectiveUsdcPerWavax:number;completelyFillable:boolean;version:string};
export type LfjMarket = {kind:"avalanche_lfj_market_research";chainId:43114;readOnly:true;newTransactionSubmitted:false;blockNumber:number;blockHash:string;observedAt:string;quotes:Quote[]};

export function isLfjMarket(value:unknown): value is LfjMarket {
  const data=record(value);
  return data.kind==="avalanche_lfj_market_research"&&data.chainId===43114&&data.readOnly===true&&data.newTransactionSubmitted===false
    &&Number.isSafeInteger(data.blockNumber)&&Number(data.blockNumber)>0&&typeof data.blockHash==="string"&&/^0x[0-9a-f]{64}$/i.test(data.blockHash)
    &&typeof data.observedAt==="string"&&Number.isFinite(Date.parse(data.observedAt))&&Array.isArray(data.quotes)&&data.quotes.length>0&&data.quotes.length<=12
    &&data.quotes.every(value=>{const row=record(value);return Number.isFinite(row.inputUsdc)&&Number(row.inputUsdc)>0&&typeof row.completelyFillable==="boolean"
      &&(!row.completelyFillable||[row.outputWavax,row.feeInputUsdc,row.feeBps,row.effectiveUsdcPerWavax].every(v=>typeof v==="number"&&Number.isFinite(v)&&v>=0));});
}

export function lfjMarkets(message:AssistantMessage):LfjMarket[] {
  const found=new Map<string,LfjMarket>();
  const accept=(value:unknown)=>{const row=record(value);if(row.action!=="avalanche_lfj_market"||row.ok===false)return;
    const data=contentValue(row.result);if(isLfjMarket(data))found.set(data.blockHash,data);};
  for(const row of message.turn?.tool_trace||[])accept(row);
  for(const envelope of [...(message.turn?.blocks||[]),...liveEventsToBlocks(message.live_events||[])]){const row=record(envelope.block||envelope);if(row.kind==="tool_result")accept(row);}
  return [...found.values()];
}

export function LfjReplyCards({message}:{message:AssistantMessage}) {
  if(process.env.NEXT_PUBLIC_NERYA_COMPETITION!=="avalanche")return null;
  return <>{lfjMarkets(message).map(market=><AvalancheLfjMarketCard key={market.blockHash} market={market}/>)}</>;
}

/** A read-only quote comparison in the original chat. Selecting a size never places an order. */
export function AvalancheLfjMarketCard({market}:{market:LfjMarket}) {
  const zh=useLocale().startsWith("zh");const [selected,setSelected]=useState(0);
  if(!isLfjMarket(market))return null;
  const quote=market.quotes[Math.min(selected,market.quotes.length-1)];
  const number=(value:number,digits=4)=>new Intl.NumberFormat(zh?"zh-CN":"en-US",{maximumFractionDigits:digits}).format(value);
  const at=new Date(market.observedAt).toISOString().replace("T"," ").replace(/\.\d{3}Z$/," UTC");
  return <section data-testid="avalanche-lfj-market-card" className="my-4 overflow-hidden rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] text-[color:var(--text-base)]">
    <header className="flex flex-wrap items-center gap-2 border-b border-[color:var(--line)] px-5 py-3 text-xs text-[color:var(--text-muted)]"><GlobeIcon size={16}/><span>Avalanche · LFJ</span><span className="ml-auto">{zh?"现货报价":"Spot quote"} · USDC / WAVAX</span></header>
    <div className="px-5 py-4">
      <div role="group" aria-label={zh?"比较订单金额":"Compare order sizes"} className="flex flex-wrap gap-2">{market.quotes.map((row,index)=><button key={row.inputUsdc} type="button" aria-pressed={index===selected} onClick={()=>setSelected(index)} className={"rounded-lg border px-3 py-2 text-sm tabular-nums "+(index===selected?"border-[color:var(--text-muted)] bg-[color:var(--panel-bg)] font-semibold":"border-[color:var(--line)] text-[color:var(--text-muted)]")}>{number(row.inputUsdc,0)} USDC</button>)}</div>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs text-[color:var(--text-muted)]">{zh?"预计收到":"Estimated output"}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{quote.completelyFillable?number(quote.outputWavax,6):"—"} <span className="text-base font-normal text-[color:var(--text-muted)]">WAVAX</span></p></div><p className="text-xs text-[color:var(--text-muted)]">{quote.version||"LFJ"} · {quote.completelyFillable?(zh?"该规模报价可填满":"Full-size quote available"):(zh?"流动性不足":"Insufficient liquidity")}</p></div>
      <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-[color:var(--line)] pt-4 text-sm"><div><dt className="text-xs text-[color:var(--text-muted)]">{zh?"输入币手续费":"Input-token fee"}</dt><dd className="mt-1 tabular-nums">{quote.completelyFillable?number(quote.feeInputUsdc,6):"—"} USDC</dd></div><div><dt className="text-xs text-[color:var(--text-muted)]">{zh?"报价均价":"Quoted average price"}</dt><dd className="mt-1 tabular-nums">{quote.completelyFillable?number(quote.effectiveUsdcPerWavax,4):"—"} USDC / WAVAX</dd></div></dl>
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-[color:var(--text-muted)]"><tr><th className="py-2 font-normal">USDC</th><th className="py-2 text-right font-normal">WAVAX</th><th className="py-2 text-right font-normal">{zh?"手续费率（bps）":"Fee (bps)"}</th></tr></thead><tbody>{market.quotes.map(row=><tr key={row.inputUsdc} className="border-t border-[color:var(--line)] tabular-nums"><td className="py-2">{number(row.inputUsdc,0)}</td><td className="py-2 text-right">{row.completelyFillable?number(row.outputWavax,6):"—"}</td><td className="py-2 text-right">{row.completelyFillable?number(row.feeBps,3):"—"}</td></tr>)}</tbody></table></div>
    </div>
    <footer className="border-t border-[color:var(--line)] px-5 py-3 text-xs leading-5 text-[color:var(--text-muted)]"><p>{at} · {zh?"区块":"Block"} {market.blockNumber}</p><p>{zh?"只读报价，尚未成交；下单前需重新询价。":"Read-only quote, not a fill. Refresh before trading."}</p></footer>
  </section>;
}
