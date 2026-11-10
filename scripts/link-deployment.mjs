import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { getAddress, keccak256 } from "viem";
import { client, same } from "../server/chain.mjs";

const db = new DatabaseSync("data/hammy.sqlite", { readOnly: true });
const registered = db
  .prepare("SELECT value FROM settings WHERE key=?")
  .get("rewardContract")?.value;
if (!registered)
  throw new Error("No owner-registered HAMS deployment was found.");
const address = getAddress(registered),
  expectedOwner = getAddress("0xB804d506d5446b1A3BeBEfC903D84F754973C2D2");
const artifact = JSON.parse(
  fs.readFileSync("src/generated/HammyRewards.json", "utf8"),
);
const chainId = await client.getChainId();
if (chainId !== 11155111) throw new Error("Sepolia chain mismatch.");
const blockNumber = (await client.getBlockNumber()) - 12n,
  block = await client.getBlock({ blockNumber });
const read = (functionName, args = []) =>
  client.readContract({
    address,
    abi: artifact.abi,
    functionName,
    args,
    blockNumber,
  });
const [
  code,
  owner,
  root,
  lock,
  rate,
  cap,
  supply,
  reserved,
  used,
  balance,
  positions,
] = await Promise.all([
  client.getCode({ address, blockNumber }),
  read("owner"),
  read("pointsRoot"),
  read("LOCK_SECONDS"),
  read("TOKEN_PER_POINT"),
  read("CAP"),
  read("totalSupply"),
  read("reservedRewards"),
  read("usedPoints", [expectedOwner]),
  read("balanceOf", [expectedOwner]),
  read("positionCount", [expectedOwner]),
]);
if (!code || keccak256(code) !== keccak256(artifact.runtime))
  throw new Error(
    "Registered HAMS runtime does not match the compiled contract.",
  );
if (
  !same(owner, expectedOwner) ||
  lock !== 600n ||
  rate !== 10n ** 16n ||
  cap !== 10000000n * 10n ** 18n ||
  supply + reserved > cap
)
  throw new Error("HAMS ownership, reward rules or cap verification failed.");
if ((await client.getBlock({ blockNumber })).hash !== block.hash)
  throw new Error("Block changed during deployment verification.");
const manifest = {
  chainId,
  contract: "HammyRewards",
  address,
  owner: getAddress(owner),
  runtimeHash: keccak256(code),
  lockSeconds: Number(lock),
  tokenPerPoint: rate.toString(),
  cap: cap.toString(),
  verifiedAtBlock: blockNumber.toString(),
  verifiedBlockHash: block.hash,
};
fs.mkdirSync("deployments", { recursive: true });
fs.writeFileSync(
  "deployments/hammy-sepolia.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
const rootSaved = !!db.prepare("SELECT root FROM roots WHERE root=?").get(root);
console.log(
  JSON.stringify({
    ...manifest,
    pointsRoot: root,
    proofTreeAvailable: rootSaved,
    totalSupply: supply.toString(),
    reservedRewards: reserved.toString(),
    administrator: {
      usedPoints: used.toString(),
      balance: balance.toString(),
      positions: positions.toString(),
    },
  }),
);
db.close();
