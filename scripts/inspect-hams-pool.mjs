import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { encodeDeployData, keccak256 } from "viem";
import { client, same, assertBlock } from "../server/chain.mjs";

const db = new DatabaseSync(path.join(process.env.DATA_DIR || "data", "hammy.sqlite"), {readOnly:true});
const setting = key => db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value;
const address = setting("hamsPool"), transactionHash = setting("hamsPoolDeployment");
const token = setting("rewardContract") || JSON.parse(fs.readFileSync("deployments/hammy-sepolia.json", "utf8")).address;
db.close();
assert.ok(address && transactionHash, "The pool deployment is not registered yet.");
const admin = process.env.ADMIN_ADDRESS || "0xB804d506d5446b1A3BeBEfC903D84F754973C2D2";
const pool = JSON.parse(fs.readFileSync("src/generated/HamsStakingPool.json", "utf8"));
const game = JSON.parse(fs.readFileSync("src/generated/HammyRewards.json", "utf8"));
assert.equal(await client.getChainId(), 11155111);
const blockNumber = (await client.getBlockNumber()) - 2n;
const block = await client.getBlock({blockNumber});
const [code, tokenCode, receipt, tx] = await Promise.all([
  client.getCode({address,blockNumber}), client.getCode({address:token,blockNumber}),
  client.getTransactionReceipt({hash:transactionHash}), client.getTransaction({hash:transactionHash}),
]);
assert.equal(keccak256(code), keccak256(pool.runtime), "Pool runtime mismatch");
assert.equal(keccak256(tokenCode), keccak256(game.runtime), "HAMS token runtime mismatch");
assert.equal(receipt.status,"success");
assert.ok(same(receipt.contractAddress,address) && same(tx.from,admin) && tx.to === null);
assert.ok(receipt.blockNumber <= blockNumber);
assert.equal((await client.getBlock({blockNumber:receipt.blockNumber})).hash,receipt.blockHash);
assert.equal(tx.input, encodeDeployData({abi:pool.abi,bytecode:pool.bytecode,args:[token]}));
const read = (functionName,args=[]) => client.readContract({address,abi:pool.abi,functionName,args,blockNumber});
const [owner,binding,totalStaked,funded,paid,remainingRewards,remainingSeconds,ownerStaked,ownerEarned,ownerBalance,poolBalance] = await Promise.all([
  ...["owner","stakingToken","totalStaked","totalRewardsFunded","totalRewardsPaid","remainingRewards","remainingSeconds"].map(name=>read(name)),
  read("balanceOf",[admin]), read("earned",[admin]),
  ...[admin,address].map(account=>client.readContract({address:token,abi:game.abi,functionName:"balanceOf",args:[account],blockNumber})),
]);
assert.ok(same(owner,admin),"Pool ownership changed");
assert.ok(same(binding,token),"Pool token binding mismatch");
assert.ok(poolBalance >= totalStaked + funded - paid,"Pool balance does not cover principal and funded rewards");
await assertBlock(block);
console.log(JSON.stringify({chainId:11155111,address,token,owner,transactionHash,deploymentBlock:receipt.blockNumber,runtimeHash:keccak256(code),verifiedBlock:blockNumber,blockHash:block.hash,totalStaked,funded,paid,remainingRewards,remainingSeconds,ownerStaked,ownerEarned,ownerBalance,poolBalance},(_,value)=>typeof value==="bigint"?value.toString():value));
