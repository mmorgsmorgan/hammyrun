import {
  createPublicClient,
  http,
  createWalletClient,
  custom,
  type Address,
  type Hex,
} from "viem";
import { sepolia } from "viem/chains";
export async function api(path: string, body?: unknown) {
  const r = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Request failed.");
  return j;
}
export const short = (s: string) => s.slice(0, 6) + "…" + s.slice(-4);
export const publicClient = createPublicClient({
  chain: sepolia,
  transport: http("https://ethereum-sepolia-rpc.publicnode.com", {
    timeout: 15000,
  }),
});
export function wallet(provider: any, account: string) {
  return createWalletClient({
    account: account as Address,
    chain: sepolia,
    transport: custom(provider),
  });
}
export async function ensureSepolia(provider: any) {
  const chain = await provider.request({ method: "eth_chainId" });
  if (chain !== "0xaa36a7") {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xaa36a7" }],
      });
    } catch (e: any) {
      if (e.code !== 4902) throw e;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0xaa36a7",
            chainName: "Sepolia",
            nativeCurrency: {
              name: "Sepolia ETH",
              symbol: "ETH",
              decimals: 18,
            },
            rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
            blockExplorerUrls: ["https://eth-sepolia.blockscout.com"],
          },
        ],
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xaa36a7" }],
      });
    }
  }
  if ((await provider.request({ method: "eth_chainId" })) !== "0xaa36a7")
    throw new Error("Switch your wallet to Sepolia to continue.");
}
export const fmt = (s: unknown) => {
  if (s === undefined || s === null) return "—";
  const n = BigInt(String(s)),
    unit = 10n ** 18n;
  return (
    `${n / unit}.${((n % unit) / 10n ** 14n).toString().padStart(4, "0")}`.replace(
      /\.?0+$/,
      "",
    ) || "0"
  );
};
export type Transaction = {
  title: string;
  description: string;
  to?: Address;
  data: Hex;
  details?: Record<string, string>;
  onSubmitted?: (hash: Hex) => void;
  onConfirmed?: (hash: Hex) => Promise<void>;
  recheck?: () => Promise<void>;
};
