"use client";

import {useLocale} from "next-intl";
import {copy as i18nCopy} from "../../lib/i18n";
import {CheckIcon,GlobeIcon} from "../icons";
import {contentValue,record} from "../../lib/agentConversation";
import {liveEventsToBlocks,type AssistantMessage} from "../../lib/chat";

export function isAvalancheReceipt(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return row.kind === "avalanche_execution_receipt" && row.chainId === 43113 && row.status === "verified"
    && row.testnetOnly === true && row.referenceExecution === true && row.newTransactionSubmitted === false
    && row.signatureVerified === true && row.evidenceEventVerified === true
    && typeof row.transactionHash === "string" && /^0x[a-fA-F0-9]{64}$/.test(row.transactionHash);
}

export function avalancheReceipts(message: AssistantMessage): Record<string, any>[] {
  const rows = new Map<string, Record<string, any>>();
  const accept = (value: unknown) => {
    const entry = record(value);
    if (entry.action !== "avalanche_verify_receipt" || entry.ok === false) return;
    const decoded = contentValue(entry.result);
    if (isAvalancheReceipt(decoded)) rows.set(decoded.transactionHash, decoded);
  };
  for (const entry of message.turn?.tool_trace || []) accept(entry);
  for (const envelope of [...(message.turn?.blocks || []), ...liveEventsToBlocks(message.live_events || [])]) {
    const block = record(envelope.block || envelope);
    if (block.kind === "tool_result") accept(block);
  }
  return [...rows.values()];
}

export function AvalancheReplyCards({message}: {message: AssistantMessage}) {
  if (process.env.NEXT_PUBLIC_NERYA_COMPETITION !== "avalanche") return null;
  return <>{avalancheReceipts(message).map(receipt=><AvalancheReceiptCard key={receipt.transactionHash} receipt={receipt}/>)}</>;
}

/** The original conversation tool-output surface. No standalone workspace. */
export function AvalancheReceiptCard({receipt}: {receipt: Record<string, any>}) {
  const zh = useLocale().startsWith("zh");
  const text = (key: string) => i18nCopy(zh, `copy.avalancheReceipt.${key}`);
  if (!isAvalancheReceipt(receipt)) return null;
  const explorer = `https://testnet.snowtrace.io/tx/${receipt.transactionHash}`;
  return <section className="my-3 rounded-xl border border-[color:var(--line)] bg-[color:var(--card)] p-4" data-testid="avalanche-receipt-card">
    <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--text-muted)]">
      <GlobeIcon size={16}/><span>Avalanche Fuji · 43113</span>
      <span className="ml-auto inline-flex items-center gap-1"><CheckIcon size={14}/>{text("verified")}</span>
    </div>
    <h3 className="mt-3 text-base font-semibold text-[color:var(--text-base)]">{receipt.amountIn} {text("inputAsset")} → {Number(receipt.amountOut).toFixed(6)} WAVAX</h3>
    <p className="mt-1 text-xs leading-5 text-[color:var(--text-muted)]">{text("reference")}</p>
    <dl className="mt-3 grid gap-2 text-xs">
      {[[text("route"),receipt.route],[text("block"),String(receipt.blockNumber)],
        [text("allowance"),receipt.routerAllowanceAtExecution],
        [text("executedAt"),receipt.executedAt]].map(([label,value])=><div className="flex justify-between gap-4" key={label}><dt className="text-[color:var(--text-muted)]">{label}</dt><dd>{value}</dd></div>)}
    </dl>
    <details className="mt-3 border-t border-[color:var(--line)] pt-3 text-xs">
      <summary className="cursor-pointer text-[color:var(--text-muted)]">{text("details")}</summary>
      <dl className="mt-3 space-y-2">{[[text("transaction"),receipt.transactionHash],[text("vault"),receipt.vault],
        [text("policy"),receipt.policyHash],[text("evidence"),receipt.evidenceHash],[text("strategy"),receipt.strategyHash]].map(([label,value])=><div key={label}><dt className="text-[color:var(--text-muted)]">{label}</dt><dd className="break-all font-mono leading-5">{value}</dd></div>)}</dl>
    </details>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
      <span className="text-[color:var(--text-muted)]">{text("scope")}</span>
      <a href={explorer} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-4">{text("explorer")}</a>
    </div>
  </section>;
}
