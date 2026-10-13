/** Translate engine-owned labels only; recorded prices, traces and custom names stay unchanged. */
export function backtestDisplayLabel(value: string | undefined, zh: boolean): string | undefined {
  if (!zh || !value) return value;
  const labels: Record<string, string> = {
    "equity vs b&h": "策略净值与买入持有基准",
    "equity / benchmark": "策略净值与买入持有基准",
    "equity": "策略净值",
    "benchmark": "买入持有基准",
    "buy & hold": "买入持有",
    "drawdown": "回撤",
    "price": "价格",
    "volume": "成交量",
  };
  return labels[value.trim().toLowerCase()] ?? value;
}
