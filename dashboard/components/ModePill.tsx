"use client";

import { Pill } from "./Page";
import { useLocale, useTranslations } from "next-intl";

/**
 * Shared paper/live badge.
 *
 * One visual language for trading-mode across the console:
 * ``LIVE``  → danger red (real money — must read as "hot")
 * ``PAPER`` → brand violet (simulated — calm)
 *
 * ``PAPER``/``LIVE`` are deliberately NOT translated: they are trading
 * terms (like ticker symbols) that operators scan for, in either locale.
 * The explicitly Chinese competition edition localizes the display only;
 * underlying mode values and live-danger colors are unchanged.
 */
export type TradingMode = "paper" | "live";

export function modeTone(mode: string | undefined | null) {
  return mode === "live" ? "danger" : "brand";
}

export function ModePill({ mode }: { mode: string | undefined | null }) {
  const zh = useLocale().startsWith("zh");
  const t = useTranslations("workflowExperience");
  const competitionChinese = process.env.NEXT_PUBLIC_NERYA_COMPETITION === "avalanche" && zh;
  if (mode !== "paper" && mode !== "live") return null;
  return (
    <Pill tone={mode === "live" ? "danger" : "brand"}>{competitionChinese ? t(mode === "live" ? "competitionLiveMode" : "competitionPaperMode") : mode === "live" ? "LIVE" : "PAPER"}</Pill>
  );
}
