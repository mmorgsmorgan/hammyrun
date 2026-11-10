import fs from "node:fs";
import {
  encodeDeployData,
  encodeFunctionData,
  keccak256,
  parseUnits,
} from "viem";
import { client, same, assertBlock } from "./chain.mjs";
import { gameContract, gameArtifact } from "./game-chain.mjs";
import { getSetting, setSetting } from "./store.mjs";

const artifact = JSON.parse(
  fs.readFileSync("src/generated/HamsStakingPool.json", "utf8"),
);
export const poolAddress = () => getSetting("hamsPool") || null;
const rd = (address, functionName, args, blockNumber) =>
  client.readContract({
    address,
    abi: artifact.abi,
    functionName,
    args,
    blockNumber,
  });
const tokenRead = (address, functionName, args, blockNumber) =>
  client.readContract({
    address,
    abi: gameArtifact.abi,
    functionName,
    args,
    blockNumber,
  });

async function verifyPool(address, blockNumber) {
  const token = await gameContract(blockNumber);
  const code = await client.getCode({ address, blockNumber });
  if (!code || keccak256(code) !== keccak256(artifact.runtime))
    throw new Error("HAMS pool code does not match the tested contract.");
  const [binding, owner] = await Promise.all([
    rd(address, "stakingToken", [], blockNumber),
    rd(address, "owner", [], blockNumber),
  ]);
  if (!same(binding, token))
    throw new Error("HAMS pool is bound to a different token.");
  return { token, owner };
}

export async function poolSnapshot(account, admin) {
  const address = poolAddress();
  if (!address) return { active: false, canDeploy: same(account, admin) };
  const blockNumber = (await client.getBlockNumber()) - 2n;
  const block = await client.getBlock({ blockNumber });
  const { token, owner } = await verifyPool(address, blockNumber);
  const [
    balance,
    staked,
    earned,
    totalStaked,
    remainingRewards,
    remainingSeconds,
    funded,
    paid,
  ] = await Promise.all([
    tokenRead(token, "balanceOf", [account], blockNumber),
    ...[
      ["balanceOf", [account]],
      ["earned", [account]],
      ["totalStaked", []],
      ["remainingRewards", []],
      ["remainingSeconds", []],
      ["totalRewardsFunded", []],
      ["totalRewardsPaid", []],
    ].map(([f, a]) => rd(address, f, a, blockNumber)),
  ]);
  await assertBlock(block);
  return {
    active: true,
    address,
    token,
    owner,
    canFund: same(owner, account),
    balance,
    staked,
    earned,
    totalStaked,
    remainingRewards,
    remainingSeconds,
    funded,
    paid,
    blockNumber,
    blockHash: block.hash,
  };
}

function amountValue(text) {
  if (
    typeof text !== "string" ||
    text.length > 80 ||
    !/^\d+(\.\d{1,18})?$/.test(text)
  )
    throw new Error("Enter a positive HAMS amount with at most 18 decimals.");
  const amount = parseUnits(text, 18);
  if (amount <= 0n) throw new Error("Amount must be positive.");
  return amount;
}

export async function preparePool(account, action, amountText, durationText) {
  const address = poolAddress();
  if (!address) throw new Error("The HAMS pool has not been deployed yet.");
  const blockNumber = await client.getBlockNumber(),
    block = await client.getBlock({ blockNumber });
  const { token, owner } = await verifyPool(address, blockNumber);
  let to = address,
    abi = artifact.abi,
    functionName = action,
    args = [],
    details = {};
  if (action === "claim") {
    const payout = await rd(address, "earned", [account], blockNumber);
    if (payout === 0n)
      throw new Error("No HAMS pool rewards are ready to claim.");
    details = { payout };
  } else if (["stake", "withdraw", "fundRewards"].includes(action)) {
    const amount = amountValue(amountText);
    args = [amount];
    details = { amount };
    if (action === "withdraw") {
      if (amount > (await rd(address, "balanceOf", [account], blockNumber)))
        throw new Error("That amount exceeds your staked HAMS.");
    } else {
      if (action === "fundRewards") {
        if (!same(owner, account))
          throw new Error(
            "Only the current pool owner may fund the reward stream.",
          );
        if (typeof durationText !== "string" || !/^\d{1,7}$/.test(durationText))
          throw new Error(
            "Choose a reward duration from 60 seconds to 30 days.",
          );
        const duration = BigInt(durationText);
        if (duration < 60n || duration > 2592000n)
          throw new Error(
            "Choose a reward duration from 60 seconds to 30 days.",
          );
        args = [amount, duration];
        details.duration = duration;
      }
      const [balance, allowance] = await Promise.all([
        tokenRead(token, "balanceOf", [account], blockNumber),
        tokenRead(token, "allowance", [account, address], blockNumber),
      ]);
      if (amount > balance)
        throw new Error(
          "Your wallet does not hold that much HAMS. Claim your matured point rewards first.",
        );
      if (allowance < amount) {
        to = token;
        abi = gameArtifact.abi;
        functionName = "approve";
        args = [address, amount];
        details = { ...details, approval: true, spender: address };
      }
    }
  } else throw new Error("Unsupported HAMS pool action.");
  const simulation = await client.simulateContract({
    address: to,
    abi,
    functionName,
    args,
    account,
    blockNumber,
  });
  await assertBlock(block);
  return {
    to,
    data: encodeFunctionData({ abi, functionName, args }),
    action: functionName,
    details,
    blockNumber,
    blockHash: block.hash,
    result: simulation.result ?? null,
  };
}

export async function preparePoolDeployment(account, admin) {
  if (!same(account, admin))
    throw new Error("Only the game administrator may deploy its HAMS pool.");
  if (poolAddress()) throw new Error("The HAMS pool is already registered.");
  const blockNumber = await client.getBlockNumber(),
    block = await client.getBlock({ blockNumber });
  const token = await gameContract(blockNumber);
  const data = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [token],
  });
  const simulation = await client.call({ account, data, blockNumber });
  if (
    !simulation.data ||
    keccak256(simulation.data) !== keccak256(artifact.runtime)
  )
    throw new Error(
      "HAMS pool deployment simulation returned unexpected code.",
    );
  await assertBlock(block);
  return { data, token, blockNumber, blockHash: block.hash };
}

export async function registerPool(account, admin, hash) {
  if (!same(account, admin))
    throw new Error("Only the game administrator may register its HAMS pool.");
  if (!/^0x[a-fA-F0-9]{64}$/.test(hash || ""))
    throw new Error("Enter the confirmed pool deployment transaction hash.");
  const [receipt, tx] = await Promise.all([
    client.getTransactionReceipt({ hash }),
    client.getTransaction({ hash }),
  ]);
  if (
    receipt.status !== "success" ||
    !receipt.contractAddress ||
    tx.to !== null ||
    !same(tx.from, admin)
  )
    throw new Error("This is not a successful administrator deployment.");
  const tip = await client.getBlockNumber();
  if (tip < receipt.blockNumber + 2n)
    throw new Error("Wait for two confirmations before linking the pool.");
  const blockNumber = tip - 2n,
    block = await client.getBlock({ blockNumber });
  if (
    (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !==
    receipt.blockHash
  )
    throw new Error(
      "Deployment receipt was reorganized. Check the transaction again.",
    );
  const { token, owner } = await verifyPool(
    receipt.contractAddress,
    blockNumber,
  );
  if (!same(owner, admin))
    throw new Error("Pool owner does not match the administrator.");
  if (
    tx.input !==
    encodeDeployData({
      abi: artifact.abi,
      bytecode: artifact.bytecode,
      args: [token],
    })
  )
    throw new Error(
      "Pool deployment input does not match the reviewed contract.",
    );
  await assertBlock(block);
  // Check after async verification too: concurrent requests cannot replace a pool.
  const existing = poolAddress();
  if (existing && !same(existing, receipt.contractAddress))
    throw new Error("A different HAMS pool is already registered.");
  setSetting("hamsPool", receipt.contractAddress);
  setSetting("hamsPoolDeployment", hash);
  return { address: receipt.contractAddress };
}
