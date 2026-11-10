import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  keccak256,
} from "viem";
import { sepolia } from "viem/chains";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { createRun, step } from "../shared/engine.mjs";
const artifact = JSON.parse(
  fs.readFileSync("src/generated/HammyRewards.json", "utf8"),
);
test(
  "full reward path: wallet authentication, verified run, publication, point lock and HAMS claim",
  { timeout: 60000 },
  async (t) => {
    const rpc = "http://127.0.0.1:9545",
      base = "http://127.0.0.1:4312";
    // Local ephemeral accounts remain in Anvil. The tests never read or handle private keys.
    const anvil = spawn(
      process.env.ANVIL_BIN || "/home/chief/.foundry/bin/anvil",
      ["--silent", "--port", "9545", "--chain-id", "11155111"],
      { stdio: "ignore" },
    );
    t.after(() => anvil.kill());
    const pc = createPublicClient({ chain: sepolia, transport: http(rpc) });
    let accounts;
    for (let i = 0; i < 40; i++) {
      try {
        accounts = await pc.request({ method: "eth_accounts" });
        break;
      } catch {
        await wait(150);
      }
    }
    assert.ok(accounts?.length);
    const [owner, other] = accounts,
      wc = createWalletClient({
        account: owner,
        chain: sepolia,
        transport: http(rpc),
      }),
      oc = createWalletClient({
        account: other,
        chain: sepolia,
        transport: http(rpc),
      });
    async function mustRevert(send) {
      let hash;
      try {
        hash = await send();
      } catch {
        return;
      }
      const receipt = await pc.waitForTransactionReceipt({ hash });
      assert.equal(
        receipt.status,
        "reverted",
        "Invalid transaction must revert onchain.",
      );
    }
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hammy-test-"));
    const server = spawn(process.execPath, ["server/index.mjs"], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: "4312",
        DATA_DIR: dataDir,
        ADMIN_ADDRESS: owner,
        RPC_URL: rpc,
        REWARD_CONTRACT: "",
      },
      stdio: "ignore",
    });
    t.after(() => server.kill());
    for (let i = 0; i < 40; i++) {
      try {
        if ((await fetch(base + "/api/health")).ok) break;
      } catch {}
      await wait(150);
    }
    let cookie = "";
    async function api(route, body, expected = 200) {
      const r = await fetch(base + "/api" + route, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const j = await r.json();
      assert.equal(r.status, expected, JSON.stringify(j));
      if (r.headers.get("set-cookie"))
        cookie = r.headers.get("set-cookie").split(";")[0];
      return j;
    }
    await api("/runs", {}, 401);
    const challenge = await api("/auth/challenge", { address: owner });
    const signature = await wc.signMessage({ message: challenge.message });
    await api("/auth/verify", { id: challenge.id, signature });
    await api("/auth/verify", { id: challenge.id, signature }, 401);
    const run = await api("/runs", {}),
      s = createRun(run.seed),
      jumps = [];
    while (!s.dead && s.tick < 600) {
      const jump =
        s.jumps === 0 &&
        s.objects.some((o) => o.kind !== "seed" && o.x > 150 && o.x < 275);
      if (jump) jumps.push(s.tick);
      step(s, jump);
    }
    await api(`/runs/${run.id}/finish`, { jumps, ticks: s.tick }, 400); // Too fast, even with a valid transcript.
    await wait((s.tick / 60) * 1000);
    const result = await api(`/runs/${run.id}/finish`, {
      jumps,
      ticks: s.tick,
    });
    assert.ok(result.coins > 0);
    await api(`/runs/${run.id}/finish`, { jumps, ticks: s.tick });
    const me = await api("/me");
    assert.equal(me.runs, 1);
    assert.equal(me.coins, result.coins);
    const tx = await wc.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode,
    });
    const receipt = await pc.waitForTransactionReceipt({ hash: tx });
    const address = receipt.contractAddress;
    assert.equal(
      keccak256(await pc.getCode({ address })),
      keccak256(artifact.runtime),
    );
    await pc.request({ method: "anvil_mine", params: ["0x3"] });
    await api("/admin/register", { hash: tx });
    const snapshot = await api("/admin/snapshot");
    assert.equal(snapshot.newPoints, String(me.coins));
    assert.equal(snapshot.changedPlayers, 1);
    await mustRevert(() =>
      oc.writeContract({
        address,
        abi: artifact.abi,
        functionName: "publishPoints",
        args: [snapshot.root],
      }),
    );
    await wc.writeContract({
      address,
      abi: artifact.abi,
      functionName: "publishPoints",
      args: [snapshot.root],
    });
    await pc.request({ method: "anvil_mine", params: ["0x3"] });
    await api("/admin/snapshot", undefined, 409);
    const rewards = await api("/rewards");
    assert.equal(rewards.canPublish, true);
    assert.equal(rewards.publishedRoot, snapshot.root);
    assert.equal(rewards.proof.cumulativePoints, String(me.coins));
    const args = [BigInt(me.coins), BigInt(me.coins), rewards.proof.proof];
    await mustRevert(() =>
      oc.writeContract({
        address,
        abi: artifact.abi,
        functionName: "stakePoints",
        args,
      }),
    ); // Proof binds the wallet.
    await wc.writeContract({
      address,
      abi: artifact.abi,
      functionName: "stakePoints",
      args,
    });
    await mustRevert(() =>
      wc.writeContract({
        address,
        abi: artifact.abi,
        functionName: "stakePoints",
        args,
      }),
    ); // Prevent double spending.
    await mustRevert(() =>
      wc.writeContract({
        address,
        abi: artifact.abi,
        functionName: "claim",
        args: [0n],
      }),
    ); // Lock enforced onchain.
    await pc.request({ method: "evm_increaseTime", params: [601] });
    await pc.request({ method: "evm_mine" });
    await wc.writeContract({
      address,
      abi: artifact.abi,
      functionName: "claim",
      args: [0n],
    });
    const balance = await pc.readContract({
      address,
      abi: artifact.abi,
      functionName: "balanceOf",
      args: [owner],
    });
    assert.equal(balance, BigInt(me.coins) * 10n ** 16n);
    await mustRevert(() =>
      wc.writeContract({
        address,
        abi: artifact.abi,
        functionName: "claim",
        args: [0n],
      }),
    ); // Cannot claim twice.
    const fakeTree = StandardMerkleTree.of(
      [[owner, "2000000000"]],
      ["address", "uint256"],
    );
    await wc.writeContract({
      address,
      abi: artifact.abi,
      functionName: "publishPoints",
      args: [fakeTree.root],
    });
    await mustRevert(() =>
      wc.writeContract({
        address,
        abi: artifact.abi,
        functionName: "stakePoints",
        args: [1000000001n, 2000000000n, fakeTree.getProof(0)],
      }),
    ); // Lifetime reward cap.
    const otherChallenge = await api("/auth/challenge", { address: other });
    await api("/auth/verify", {
      id: otherChallenge.id,
      signature: await oc.signMessage({ message: otherChallenge.message }),
    });
    await api("/admin/snapshot", undefined, 403);
    const forgery = await api("/auth/challenge", { address: owner });
    await api(
      "/auth/verify",
      {
        id: forgery.id,
        signature: await oc.signMessage({ message: forgery.message }),
      },
      401,
    );
  },
);
