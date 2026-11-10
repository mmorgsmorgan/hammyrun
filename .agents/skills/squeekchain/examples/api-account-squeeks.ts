// api-account-squeeks.ts
import { apiGet, required } from "./api";

type Page =
  | { schemaVersion: 3; status: "unavailable"; reason: string }
  | {
      schemaVersion: 3;
      status: "available";
      rewards: { claimableBaseUnits: string } | null;
      tokens: { tokenId: string; custody: "staking" | "wallet"; level: number }[];
      nextCursor: string | null;
    };

const account = required("ACCOUNT_ADDRESS");
const tokens: Extract<Page, { status: "available" }>["tokens"] = [];
let claimable: string | null = null;
let cursor: string | null = null;
do {
  const query: URLSearchParams = new URLSearchParams({ limit: "100", ...(cursor ? { cursor } : {}) });
  const page: Page = await apiGet<Page>(`/v1/accounts/${account}?${query}`);
  if (page.schemaVersion !== 3) throw new Error("Unsupported account schema version");
  if (page.status !== "available") throw new Error(`Account data unavailable: ${page.reason}`);
  claimable ??= page.rewards?.claimableBaseUnits ?? null;
  tokens.push(...page.tokens);
  cursor = page.nextCursor;
} while (cursor !== null);
console.log({ account, squeeks: tokens.length, claimableSqkBaseUnits: claimable });
