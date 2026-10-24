import { createServerFn } from "@tanstack/react-start";
import { assertMarketRequest, loadMarket, loadSymbols } from "@/lib/vision-load";

export const getKlines = createServerFn({ method: "GET" })
  .validator(assertMarketRequest)
  .handler(async ({ data }) => loadMarket(data.symbol, data.interval));

export const getSymbols = createServerFn({ method: "GET" }).handler(async () => {
  const symbols = await loadSymbols();
  return { symbols };
});
