// setup.ts
import { createPublicClient, http } from "viem";

export const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Supply ${name}`);
  return value;
};
export const client = createPublicClient({ transport: http(required("RPC_URL")) });
if (BigInt(await client.getChainId()) !== BigInt(required("EXPECTED_CHAIN_ID"))) {
  throw new Error("Chain mismatch");
}
export const blockNumber = BigInt(required("ETHEREUM_BLOCK"));
export const block = await client.getBlock({ blockNumber });
