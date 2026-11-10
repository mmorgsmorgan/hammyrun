import fs from "node:fs";
import { keccak256 } from "viem";
import { client } from "./chain.mjs";
import { getSetting } from "./store.mjs";

export const gameArtifact = JSON.parse(
  fs.readFileSync("src/generated/HammyRewards.json", "utf8"),
);
const deployment = JSON.parse(
  fs.readFileSync("deployments/hammy-sepolia.json", "utf8"),
);
export const gameAddress = () =>
  getSetting("rewardContract") ||
  (process.env.REWARD_CONTRACT !== undefined
    ? process.env.REWARD_CONTRACT || null
    : deployment.address);

export async function gameContract(blockNumber) {
  const address = gameAddress();
  if (!address)
    throw new Error(
      "HAMS rewards are awaiting the administrator’s Sepolia deployment.",
    );
  if ((await client.getChainId()) !== 11155111)
    throw new Error("Sepolia chain mismatch.");
  const code = await client.getCode({ address, blockNumber });
  if (!code || keccak256(code) !== keccak256(gameArtifact.runtime))
    throw new Error("HAMS reward contract code does not match this game.");
  return address;
}
