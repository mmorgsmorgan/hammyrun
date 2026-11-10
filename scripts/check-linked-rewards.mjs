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
const { address } = deployment,
  blockNumber = await client.getBlockNumber();
const block=await client.getBlock({blockNumber});
const root=await client.readContract({address,abi,functionName:'pointsRoot',blockNumber});
const db = new DatabaseSync("data/hammy.sqlite", { readOnly: true });
const row = db.prepare("SELECT tree FROM roots WHERE root=?").get(root);
if (!row) throw new Error("The live points root has no saved proof tree.");
const tree = StandardMerkleTree.load(JSON.parse(row.tree));
let available = 0n,
  simulated = false;
for (const [index, value] of tree.entries()) {
  const used=await client.readContract({address,abi,functionName:'usedPoints',args:[value[0]],blockNumber});
  available = BigInt(value[1]) - used;
  if (available > 0n) {
    await client.simulateContract({
      address,
      abi,
      functionName: "stakePoints",
      args: [available, BigInt(value[1]), tree.getProof(index)],
      account: value[0],
      blockNumber,
    });
    simulated = true;
    break;
  }
}
if((await client.getBlock({blockNumber})).hash!==block.hash)throw new Error('Block changed during proof verification.');
console.log(
  JSON.stringify({
    contract: address,
    block: blockNumber.toString(),
    publishedRoot: root,
    availablePlayerPoints: available.toString(),
    pointStakeSimulationPassed: simulated,
    transactionsSent: 0,
  }),
);
db.close();
