import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { client } from "../server/chain.mjs";

const deployment = JSON.parse(
  fs.readFileSync("deployments/hammy-sepolia.json", "utf8"),
);
const { abi } = JSON.parse(
  fs.readFileSync("src/generated/HammyRewards.json", "utf8"),
);
const blockNumber = (await client.getBlockNumber()) - 2n;
const [owner, root] = await Promise.all(
  ["owner", "pointsRoot"].map((functionName) =>
    client.readContract({
      address: deployment.address,
      abi,
      functionName,
      blockNumber,
    }),
  ),
);
const db = new DatabaseSync("data/hammy.sqlite", { readOnly: true });
const row = db.prepare("SELECT tree FROM roots WHERE root=?").get(root);
const published = row ? StandardMerkleTree.load(JSON.parse(row.tree)) : null;
const byWallet = new Map(
  published
    ? [...published.entries()].map(([, v]) => [v[0].toLowerCase(), v[1]])
    : [],
);
const players = db
  .prepare(
    "SELECT address,coins FROM players WHERE coins>0 ORDER BY coins DESC LIMIT 10",
  )
  .all();
const states = await Promise.all(
  players.map(async (p) => {
    const used = await client.readContract({
      address: deployment.address,
      abi,
      functionName: "usedPoints",
      args: [p.address],
      blockNumber,
    });
    return {
      wallet: p.address,
      collected: p.coins,
      published: byWallet.get(p.address) || "0",
      used: used.toString(),
      isOwner: p.address === owner.toLowerCase(),
    };
  }),
);
console.log(
  JSON.stringify({
    block: blockNumber.toString(),
    owner,
    root,
    proofTreeAvailable: !!published,
    players: states,
  }),
);
db.close();
