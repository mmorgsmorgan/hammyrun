import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import assert from "node:assert/strict";
const base =
  process.env.TEST_URL ||
  "https://limited-facilitate-bracelet-proven.trycloudflare.com";
const anvil = spawn(
  "/home/chief/.foundry/bin/anvil",
  ["--silent", "--port", "9547", "--chain-id", "11155111"],
  { stdio: "ignore" },
);
let browser;
try {
  await wait(400);
  browser = await chromium.launch({
    headless: true,
    executablePath:
      "/home/chief/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction("walletRequest", async ({ method, params }) => {
    if (method === "eth_requestAccounts") method = "eth_accounts";
    const r = await fetch("http://127.0.0.1:9547", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: params || [],
      }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  });
  await page.addInitScript(() => {
    window.ethereum = {
      isMetaMask: true,
      request: (r) => window.walletRequest(r),
      on: () => {},
      removeListener: () => {},
    };
  });
  const response = await page.goto(base);
  assert.equal(response.status(), 200);
  assert.ok(response.headers()["content-security-policy"]);
  await page
    .getByRole("heading", { name: "Small paws. Big adventures." })
    .waitFor();
  await page.evaluate(() => document.fonts.ready);
  const dimensions = await page.evaluate(() => ({
    frame: document.querySelector(".game-card").getBoundingClientRect().width,
    scene: document.querySelector(".game-scene").getBoundingClientRect().width,
    intro: document.querySelector(".game-intro").getBoundingClientRect().width,
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  assert.ok(dimensions.scene <= dimensions.frame);
  assert.ok(dimensions.intro <= dimensions.frame);
  assert.equal(dimensions.overflow, false);
  await page.screenshot({
    path: "test-results/public-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Connect wallet to play" }).click();
  await page.getByRole("button", { name: "MetaMask", exact: true }).click();
  await page
    .getByRole("button", { name: "Let’s run", exact: true })
    .waitFor({ timeout: 30000 });
  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === "hammy_session");
  assert.ok(
    session?.httpOnly && session.secure && session.sameSite === "Strict",
  );
  const config = await page.evaluate(
    async () => await (await fetch("/api/config")).json(),
  );
  assert.equal(config.admin, "0xB804d506d5446b1A3BeBEfC903D84F754973C2D2");
  assert.equal(
    config.rewardContract.toLowerCase(),
    "0x90efd23244e00a991c0f28a059858718fa04ee0e",
  );
  assert.equal(
    await page.getByRole("button", { name: /^(Reward setup|Setup)$/ }).count(),
    0,
  );
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Rewards", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Your seeds. Your rewards." })
    .waitFor();
  await page
    .getByText("Checking your rewards", { exact: true })
    .waitFor({ state: "hidden", timeout: 30000 });
  const rewards = await page.evaluate(
    async () => await (await fetch("/api/rewards")).json(),
  );
  assert.equal(rewards.active, true, JSON.stringify(rewards));
  assert.equal(
    rewards.address.toLowerCase(),
    config.rewardContract.toLowerCase(),
  );
  assert.equal(await page.getByText("Rewards are getting ready").count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Review points publication" })
      .count(),
    0,
  );
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Staking pools", exact: true })
    .click();
  if (config.hamsPool) {
    await page.getByText(/HAMS pool verified at Sepolia block/).waitFor({timeout:30000});
    const pool = await page.evaluate(async () => await (await fetch("/api/hams-pool")).json());
    assert.equal(pool.active,true,JSON.stringify(pool));
    assert.equal(pool.address.toLowerCase(),config.hamsPool.toLowerCase());
    assert.equal(pool.canFund,false);
    assert.equal(await page.getByRole("heading",{name:"Fund the HAMS rewards",exact:true}).count(),0);
  } else {
    await page.getByRole("heading", { name: "The HAMS pool is not live yet" }).waitFor();
  }
  assert.equal(
    await page.getByRole("button", { name: "Review pool deployment" }).count(),
    0,
  );
  await page.screenshot({
    path: "test-results/public-hams-pool.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "SQK · Squeekchain", exact: true })
    .click();
  await Promise.race([
    page
      .getByText(/Deployment verified at Sepolia block/)
      .waitFor({ timeout: 60000 }),
    page
      .getByText("Live SQK data is unavailable")
      .waitFor({ timeout: 60000 })
      .then(async () => {
        throw new Error(await page.locator(".notice.error").innerText());
      }),
  ]);
  await page.screenshot({
    path: "test-results/public-squeek.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Disconnect wallet" }).click();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Play", exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: "test-results/public-desktop.png",
    fullPage: true,
  });
  assert.equal(
    await page.getByRole("button", { name: /^(Reward setup|Setup)$/ }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      publicURL: base,
      status: response.status(),
      secureWalletSignIn: true,
      mobileCanvasFits: dimensions,
      squeekLiveVerification: true,
      owner: config.admin,
      rewardDeployment: config.rewardContract,
      rewardsActive: rewards.active,
      setupRemoved: true,
      pageErrors: errors,
    }),
  );
} finally {
  await browser?.close();
  anvil.kill();
}
