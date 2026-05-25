export type TradeSide = "Buy" | "Sell" | "BuyStop" | "SellStop" | "BuyLimit" | "SellLimit";

export interface Trade {
  ticket: string;
  openTime: Date;
  openPrice: number;
  closeTime: Date;
  closePrice: number;
  reason: string;
  comment: string;
  symbol: string;
  side: TradeSide;
  volume: number;
  sl: number;
  tp: number;
  swaps: number;
  profit: number;
  total: number;
  holdMinutes: number;
  isClosed: boolean;
  isPending: boolean;
  isHedgeClose: boolean;
  isStopOut: boolean;
  isMarginCallTagged: boolean;
}

export interface AccountMeta {
  label: string;
  mt4Number: string;
  crmLink: string;
}

export interface Anomaly {
  ticket: string;
  category:
    | "dealer_fill"
    | "rapid_profit"
    | "stop_out_cascade"
    | "martingale_escalation"
    | "hedge_event"
    | "stop_modified_post_entry"
    | "unusually_long_hold"
    | "outsized_position"
    | "weekend_fill"
    | "post_drawdown_streak";
  severity: "info" | "warn" | "high";
  summary: string;
  trade: Trade;
}

export interface Filters {
  includeDealer: boolean;
  includePending: boolean;
  symbols: string[];
  dateFrom?: Date;
  dateTo?: Date;
}
