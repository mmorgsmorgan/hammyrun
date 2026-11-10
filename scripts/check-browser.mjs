import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import fs from "node:fs";
const base = process.env.TEST_URL || "http://127.0.0.1:4187";
const anvil = spawn(
  "/home/chief/.foundry/bin/anvil",
  ["--silent", "--port", "9546", "--chain-id", "11155111"],
  { stdio: "ignore" },
);
let browser;
try {
  await wait(600);
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_BIN ||
      "/home/chief/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.exposeFunction("walletRequest", async ({ method, params }) => {
    if (method === "eth_requestAccounts") method = "eth_accounts";
    const r = await fetch("http://127.0.0.1:9546", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: params || [],
      }),
    });
    const body = await r.json();
    if (body.error) throw new Error(body.error.message);
    return body.result;
  });
  await page.addInitScript(() => {
    window.ethereum = {
      isMetaMask: true,
      request: (r) => window.walletRequest(r),
      on: () => {},
      removeListener: () => {},
    };
  });
  await page.goto(base);
  await page
    .getByRole("heading", { name: "Small paws. Big adventures." })
    .waitFor();
  await page.getByRole("button", { name: "Connect wallet to play" }).click();
  await page.getByRole("button", { name: "MetaMask", exact: true }).click();
  await page
    .getByRole("button", { name: "Let’s run", exact: true })
    .waitFor({ timeout: 20000 });
  const me0 = await page.evaluate(
    async () => await (await fetch("/api/me")).json(),
  );
  await page.getByRole("button", { name: "Let’s run", exact: true }).click();
  await page.getByRole("button", { name: "Pause game", exact: true }).waitFor();
  await page.waitForTimeout(700);
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  await page.keyboard.press("KeyP");
  await page.getByRole("heading", { name: "Paws for a moment." }).waitFor();
  await page.getByRole("button", { name: "Keep running" }).click();
  // A tab change must preserve and pause an existing run.
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "My rewards" })
    .click();
  await page
    .getByRole("heading", { name: "Your seeds. Your rewards." })
    .waitFor();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Play", exact: true })
    .click();
  await page.getByRole("heading", { name: "Paws for a moment." }).waitFor();
  await page.getByRole("button", { name: "Finish & bank seeds" }).click();
  await page.getByText(/seeds banked\. Nice run!/).waitFor({ timeout: 15000 });
  const me1 = await page.evaluate(
    async () => await (await fetch("/api/me")).json(),
  );
  assert.equal(me1.runs, me0.runs + 1);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Leaderboard" })
    .click();
  await page.getByRole("heading", { name: "Big runs. Tiny paws." }).waitFor();
  assert.ok(await page.locator(".leader-row.is-you").count());
  assert.equal(
    await page
      .getByRole("button", { name: "Reward setup", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "My rewards" })
    .click();
  await page
    .getByRole("heading", { name: "Your seeds. Your rewards.", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Review points publication" })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Disconnect wallet" }).click();
  assert.ok(
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .first()
      .isVisible(),
  );
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Play", exact: true })
    .click();
  await page
    .getByRole("button", { name: "How to play", exact: true })
    .first()
    .click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  fs.mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/verified-desktop.png",
    fullPage: true,
  });
  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [320, 700],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(150);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `Overflow at ${width}px`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/verified-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Rewards", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Your seeds. Your rewards." })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "test-results/mobile-rewards.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: real wallet signature, keyboard controls, pause/navigation, server score save, leaderboard, administrator isolation, disconnect, dialogs and 4 responsive viewports.",
  );
} finally {
  await browser?.close();
  anvil.kill();
}
