import { useEffect, useRef, useState } from "react";
import {
  Gamepad2,
  Leaf,
  Trophy,
  ArrowUpRight,
  ArrowRight,
  BookOpen,
  Wallet,
  ExternalLink,
  ChevronRight,
  Coins,
  ShieldCheck,
  Sprout,
  LogOut,
  X,
  Check,
  LoaderCircle,
  Link as LinkIcon,
  MousePointer2,
  Keyboard,
  Smartphone,
  Sun,
  Flag,
  Target,
} from "lucide-react";
import { type Address, type Hex } from "viem";
import Game from "./game/Game";
import { Rewards } from "./Rewards";
import { Pools } from "./Pools";
import {
  api,
  ensureSepolia,
  publicClient,
  short,
  wallet,
  type Transaction,
} from "./lib";
type Provider = { name: string; id: string; provider: any };
const tabs = [
  { id: "play", label: "Play", icon: Gamepad2 },
  { id: "rewards", label: "My rewards", icon: Leaf },
  { id: "leaderboard", label: "Leaderboard", icon: Trophy },
  { id: "squeek", label: "Staking pools", icon: Sprout },
];
export default function App() {
  const [page, setPage] = useState("play"),
    [account, setAccount] = useState<string | null>(null),
    [me, setMe] = useState<any>(null),
    [config, setConfig] = useState<any>({}),
    [providers, setProviders] = useState<Provider[]>([]),
    [walletOpen, setWalletOpen] = useState(false),
    [guide, setGuide] = useState(false),
    [connecting, setConnecting] = useState(false),
    [toast, setToast] = useState(""),
    [leaderboard, setLeaderboard] = useState<any[]>([]),
    [leaderError, setLeaderError] = useState(""),
    [tx, setTx] = useState<Transaction | null>(null),
    [txBusy, setTxBusy] = useState(false),
    [txHash, setTxHash] = useState<Hex | null>(null),
    [uncertain, setUncertain] = useState(false);
  const provider = useRef<any>(null),
    noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    identity = useRef<string | null>(null);
  function notify(message: string) {
    setToast(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setToast(""), 8500);
  }
  const refresh = async () => {
    try {
      setConfig(await api("/config"));
    } catch (e) {
      notify((e as Error).message);
    }
    if (identity.current) {
      try {
        const user = await api("/me");
        if (user.address.toLowerCase() === identity.current.toLowerCase())
          setMe(user);
      } catch (e) {
        notify((e as Error).message);
      }
    }
  };
  useEffect(() => {
    void refresh();
    const injected = (window as any).ethereum;
    const initial: Provider[] = injected
      ? [
          {
            name: injected.isMetaMask
              ? "MetaMask"
              : injected.isCoinbaseWallet
                ? "Coinbase Wallet"
                : "Browser wallet",
            id: "injected",
            provider: injected,
          },
        ]
      : [];
    setProviders(initial);
    const announced = (e: any) =>
      setProviders((prev) =>
        prev.some((p) => p.provider === e.detail.provider)
          ? prev
          : [
              ...prev,
              {
                name: e.detail.info.name,
                id: e.detail.info.uuid,
                provider: e.detail.provider,
              },
            ],
      );
    window.addEventListener("eip6963:announceProvider", announced);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const pending = sessionStorage.getItem("hammy-pending-tx");
    if (pending) setTxHash(pending as Hex);
    return () =>
      window.removeEventListener("eip6963:announceProvider", announced);
  }, []);
  useEffect(() => {
    if (page === "leaderboard") {
      setLeaderError("");
      api("/leaderboard")
        .then(setLeaderboard)
        .catch((e) => setLeaderError(e.message));
    }
  }, [page]);
  useEffect(() => {
    if (!account || !provider.current) return;
    const p = provider.current;
    const clear = () => {
      identity.current = null;
      setAccount(null);
      setMe(null);
      setTx(null);
      void api("/auth/logout", {}).catch(() => {});
      notify("Wallet changed. Reconnect to continue with that account.");
    };
    p.on?.("accountsChanged", clear);
    p.on?.("chainChanged", clear);
    p.on?.("disconnect", clear);
    return () => {
      p.removeListener?.("accountsChanged", clear);
      p.removeListener?.("chainChanged", clear);
      p.removeListener?.("disconnect", clear);
    };
  }, [account]);
  useEffect(() => {
    if (!tx && !walletOpen && !guide) return;
    const old = document.activeElement as HTMLElement;
    const frame = requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('[role="dialog"] button')?.focus(),
    );
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !txBusy) {
        setWalletOpen(false);
        setGuide(false);
        setTx(null);
      }
      if (e.key === "Tab") {
        const modal = document.querySelector('[role="dialog"]');
        const focusables = Array.from(
          modal?.querySelectorAll<HTMLElement>(
            "button:not([disabled]),a,input",
          ) || [],
        );
        if (!focusables.length) return;
        const first = focusables[0],
          last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handler);
      old?.focus();
    };
  }, [tx, walletOpen, guide, txBusy]);
  async function connect(p: Provider) {
    setConnecting(true);
    try {
      await ensureSepolia(p.provider);
      const accounts = await p.provider.request({
        method: "eth_requestAccounts",
      });
      const address = accounts[0];
      if (!address) throw new Error("No wallet account was selected.");
      const challenge = await api("/auth/challenge", { address });
      const signature = await wallet(p.provider, address).signMessage({
        message: challenge.message,
      });
      const result = await api("/auth/verify", { id: challenge.id, signature });
      const current = await p.provider.request({ method: "eth_accounts" });
      if (current[0]?.toLowerCase() !== address.toLowerCase())
        throw new Error("Wallet changed during sign-in. Connect again.");
      provider.current = p.provider;
      identity.current = result.address;
      setAccount(result.address);
      setWalletOpen(false);
      setMe(await api("/me"));
      notify("Wallet connected. The garden is yours.");
    } catch (e: any) {
      notify(e.shortMessage || e.message);
    } finally {
      setConnecting(false);
    }
  }
  async function disconnect() {
    try {
      await api("/auth/logout", {});
    } catch {}
    identity.current = null;
    setAccount(null);
    setMe(null);
    setTx(null);
    provider.current = null;
  }
  function review(t: Transaction) {
    if (txHash || uncertain) {
      notify("Check your pending wallet transaction before preparing another.");
      return;
    }
    setTx(t);
  }
  async function checkReceipt(h: Hex, submitted?: Transaction) {
    setTxBusy(true);
    try {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: h,
        confirmations: 3,
        timeout: 120000,
      });
      if (receipt.status !== "success")
        throw new Error("The transaction reverted. No success was recorded.");
      sessionStorage.removeItem("hammy-pending-tx");
      setTxHash(null);
      setTx(null);
      notify("Transaction confirmed on Sepolia.");
      if (submitted?.onConfirmed) await submitted.onConfirmed(h);
      await refresh();
    } catch (e: any) {
      if (e.message?.includes("reverted")) {
        sessionStorage.removeItem("hammy-pending-tx");
        setTxHash(null);
      }
      notify(
        e.shortMessage ||
          e.message ||
          "Transaction is pending. Check again before sending another.",
      );
    } finally {
      setTxBusy(false);
    }
  }
  async function send() {
    if (!tx || !account || !provider.current || txBusy || txHash || uncertain)
      return;
    const submitted = tx,
      from = account;
    setTxBusy(true);
    let sent = false;
    try {
      await ensureSepolia(provider.current);
      const current = await provider.current.request({
        method: "eth_accounts",
      });
      if (
        current[0]?.toLowerCase() !== from.toLowerCase() ||
        identity.current !== from
      )
        throw new Error("Wallet changed. Reconnect and review again.");
      await submitted.recheck?.();
      await publicClient.call({
        account: from as Address,
        to: submitted.to,
        data: submitted.data,
      });
      const hash = await wallet(provider.current, from).sendTransaction({
        to: submitted.to,
        data: submitted.data,
        value: 0n,
      });
      sent = true;
      sessionStorage.setItem("hammy-pending-tx", hash);
      setTxHash(hash);
      submitted.onSubmitted?.(hash);
      await checkReceipt(hash, submitted);
    } catch (e: any) {
      const code = e.code ?? e.cause?.code;
      if (
        !sent &&
        (code === -32603 || code === -32000 || code === "UNKNOWN_ERROR")
      ) {
        setUncertain(true);
        notify(
          "The wallet did not report a clear outcome. Check wallet activity before reconnecting and trying again.",
        );
      } else notify(e.shortMessage || e.message);
    } finally {
      setTxBusy(false);
    }
  }
  const props = {
    account,
    config,
    me,
    connect: () => setWalletOpen(true),
    notify,
    review,
    refresh,
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="wordmark"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("play");
          }}
        >
          hammy<span>run</span>
          <span className="wordmark-dot">.</span>
        </a>
        <div className="sidebar-label">YOUR LITTLE ESCAPE</div>
        <nav aria-label="Main navigation">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={"nav-item " + (page === t.id ? "active" : "")}
              onClick={() => setPage(t.id)}
            >
              <t.icon size={20} />
              <span>{t.label}</span>
              {page === t.id && <span className="nav-dot" />}
              {t.id === "squeek" && (
                <ArrowUpRight className="nav-arrow" size={14} />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-garden">
            <span className="garden-icon">
              <Sprout size={27} />
            </span>
            <h3>
              Small paws.
              <br />
              Big possibilities.
            </h3>
            <p>A little play, every day.</p>
            <span className="pill">
              <span className="live-dot" /> Sepolia testnet
            </span>
          </div>
          <button className="nav-item" onClick={() => setGuide(true)}>
            <BookOpen size={18} /> How to play{" "}
            <ArrowUpRight size={14} className="nav-arrow" />
          </button>
          <div className="sidebar-footer">
            Made for the joy of the run. <Leaf size={12} />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumb">
            The burrow <ChevronRight size={13} />{" "}
            <strong>{tabs.find((t) => t.id === page)?.label || "Play"}</strong>
          </span>
          <a
            className="wordmark mobile-wordmark"
            href="#"
            onClick={() => setPage("play")}
          >
            hammy<span>run</span>.
          </a>
          <div className="topbar-actions">
            <span className="network-label">
              <span className="live-dot" /> Sepolia{" "}
              <span className="testnet-tag">TESTNET</span>
            </span>
            {account ? (
              <>
                <button
                  className="wallet-button connected"
                  onClick={() => setWalletOpen(true)}
                >
                  <span className="wallet-avatar" />
                  {short(account)}
                </button>
                <button
                  className="icon-button logout"
                  title="Disconnect wallet"
                  aria-label="Disconnect wallet"
                  onClick={disconnect}
                >
                  <LogOut size={17} />
                </button>
              </>
            ) : (
              <button
                className="wallet-button"
                onClick={() => setWalletOpen(true)}
              >
                <Wallet size={16} />
                <span>Connect wallet</span>
              </button>
            )}
          </div>
        </header>
        <main>
          <div hidden={page !== "play"}>
            <div className="page-title">
              <div>
                <span className="eyebrow">
                  <Sun size={13} /> A GOOD DAY FOR A LITTLE ADVENTURE
                </span>
                <h1>Small paws. Big adventures.</h1>
                <p>Run a little. Collect a lot. Welcome to your happy place.</p>
              </div>
              <button
                className="text-button how-button"
                onClick={() => setGuide(true)}
              >
                <BookOpen size={16} /> How to play <ArrowUpRight size={15} />
              </button>
            </div>
            <div className="play-layout">
              <div className="play-main">
                <Game
                  active={page === "play"}
                  connected={!!account}
                  connect={() => setWalletOpen(true)}
                  onSaved={refresh}
                  notify={notify}
                />
                <div className="steps-strip">
                  <div>
                    <span className="step-circle">
                      <Gamepad2 size={19} />
                    </span>
                    <div>
                      <strong>A little adventure</strong>
                      <small>Jump, dodge & collect seeds</small>
                    </div>
                  </div>
                  <ChevronRight size={17} />
                  <div>
                    <span className="step-circle seed-circle">
                      <Leaf size={19} />
                    </span>
                    <div>
                      <strong>Put down roots</strong>
                      <small>Stake your verified points</small>
                    </div>
                  </div>
                  <ChevronRight size={17} />
                  <div>
                    <span className="step-circle token-circle">
                      <Coins size={19} />
                    </span>
                    <div>
                      <strong>Watch them grow</strong>
                      <small>Claim HAMS on Sepolia</small>
                    </div>
                  </div>
                </div>
              </div>
              <aside className="play-stats">
                <section className="personal-best">
                  <div className="section-heading">
                    <span className="label">YOUR PERSONAL BEST</span>
                    <Trophy size={17} />
                  </div>
                  <div className="big-stat">
                    {me?.best || 0}
                    <small>m</small>
                  </div>
                  <p>
                    {me?.runs
                      ? "A little further next time."
                      : "Every great run starts somewhere."}
                  </p>
                  <div className="stat-divider" />
                  <div className="small-stat">
                    <span>Total runs</span>
                    <strong>{me?.runs || 0}</strong>
                  </div>
                </section>
                <section className="seed-pocket">
                  <div className="section-heading">
                    <span className="label">YOUR SEED POCKET</span>
                    <Leaf size={17} />
                  </div>
                  <div className="big-stat">
                    {me?.coins || 0}
                    <small>pts</small>
                  </div>
                  <p>Little seeds, future rewards.</p>
                  <button
                    className="button light wide"
                    onClick={() => setPage("rewards")}
                  >
                    My rewards <ArrowRight size={16} />
                  </button>
                  <span className="pocket-note">100 points = 1 HAMS</span>
                </section>
              </aside>
            </div>
            <section className="milestones">
              <div className="section-heading">
                <h2>Little milestones</h2>
                <span>One hop at a time</span>
              </div>
              <div className="milestone-grid">
                {[
                  {
                    icon: Flag,
                    title: "The first little leap",
                    description: "Complete your first run",
                    value: me?.runs || 0,
                    total: 1,
                    tone: "green",
                  },
                  {
                    icon: Leaf,
                    title: "A pocket full of sunshine",
                    description: "Collect 25 seeds",
                    value: me?.coins || 0,
                    total: 25,
                    tone: "yellow",
                  },
                  {
                    icon: Target,
                    title: "Getting the hang of it",
                    description: "Head out on 5 adventures",
                    value: me?.runs || 0,
                    total: 5,
                    tone: "purple",
                  },
                ].map((m) => (
                  <div className="milestone" key={m.title}>
                    <span className={"square-icon " + m.tone}>
                      <m.icon size={21} />
                    </span>
                    <div className="milestone-content">
                      <h3>{m.title}</h3>
                      <p>{m.description}</p>
                      <div className="progress-track">
                        <div
                          style={{
                            width:
                              Math.min(100, (m.value / m.total) * 100) + "%",
                          }}
                        />
                      </div>
                    </div>
                    <span className="milestone-count">
                      {m.value >= m.total ? (
                        <Check size={16} />
                      ) : (
                        `${Math.min(m.value, m.total)}/${m.total}`
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </section>
            <div className="play-note">
              <ShieldCheck size={15} />
              <span>
                A real little game. Testnet-only tokens. Play for the fun of it.
              </span>
              <a
                href="https://docs.squeekchain.com/"
                target="_blank"
                rel="noreferrer"
              >
                Explore Squeekchain <ArrowUpRight size={13} />
              </a>
            </div>
          </div>
          {page === "rewards" && (
            <Rewards key={account || "guest"} {...props} />
          )}
          {page === "squeek" && <Pools key={account || "guest"} {...props} />}
          {page === "leaderboard" && (
            <>
              <div className="page-title">
                <div>
                  <span className="eyebrow">A FRIENDLY LITTLE COMPETITION</span>
                  <h1>Big runs. Tiny paws.</h1>
                  <p>
                    The longest verified garden adventures, ranked by distance.
                  </p>
                </div>
                <span className="pill">
                  <Trophy size={15} /> All time
                </span>
              </div>
              <section className="panel leaderboard-panel">
                {leaderError ? (
                  <div className="notice error">{leaderError}</div>
                ) : !leaderboard.length ? (
                  <div className="empty-state">
                    <span className="empty-icon yellow">
                      <Trophy size={36} />
                    </span>
                    <h2>The garden is yours to explore</h2>
                    <p>No finished runs yet. Take the first spot.</p>
                    <button
                      className="button primary"
                      onClick={() => setPage("play")}
                    >
                      Go for a run <ArrowRight size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="leaderboard">
                    <div className="leader-row table-head">
                      <span>Rank</span>
                      <span>Runner</span>
                      <span>Best run</span>
                      <span>Seeds</span>
                    </div>
                    {leaderboard.map((p, i) => (
                      <div
                        className={
                          "leader-row " +
                          (p.address === account ? "is-you" : "")
                        }
                        key={p.address}
                      >
                        <span className="rank">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="runner-address">
                          <span className="wallet-avatar" />
                          {short(p.address)}{" "}
                          {p.address === account && <small>You</small>}
                        </span>
                        <strong>{p.best.toLocaleString()} m</strong>
                        <span>{p.coins.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </main>
        <footer className="main-footer">
          <span>© {new Date().getFullYear()} Hammy Run</span>
          <span>A little world worth running through.</span>
          <a
            href="https://docs.squeekchain.com/"
            target="_blank"
            rel="noreferrer"
          >
            Squeekchain docs <ArrowUpRight size={12} />
          </a>
        </footer>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={page === t.id ? "active" : ""}
            onClick={() => setPage(t.id)}
          >
            <t.icon size={20} />
            <span>{t.id === "rewards" ? "Rewards" : t.label}</span>
          </button>
        ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {txHash && !tx && (
        <div className="pending-banner">
          <span>Sepolia transaction pending</span>
          <a
            href={`https://eth-sepolia.blockscout.com/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
          >
            View <ExternalLink size={13} />
          </a>
          <button disabled={txBusy} onClick={() => checkReceipt(txHash)}>
            Check confirmation
          </button>
        </div>
      )}
      {walletOpen && (
        <div
          className="modal-backdrop"
          onClick={() => !connecting && setWalletOpen(false)}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close wallet selection"
              onClick={() => setWalletOpen(false)}
            >
              <X size={20} />
            </button>
            <span className="empty-icon">
              <Wallet size={28} />
            </span>
            <h2 id="wallet-title">Your wallet. Your little world.</h2>
            <p>
              Connect on Sepolia and sign a free message to save your runs and
              collect points.
            </p>
            {providers.map((p) => (
              <button
                className="provider-button"
                key={p.id}
                disabled={connecting}
                onClick={() => connect(p)}
              >
                <Wallet size={21} />
                <span>{p.name}</span>
                {connecting ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <ArrowRight size={18} />
                )}
              </button>
            ))}
            {!providers.length && (
              <div className="notice">
                <div>
                  <strong>Open in your wallet browser</strong>
                  <p>
                    On mobile, open this game inside MetaMask or Coinbase
                    Wallet. On desktop, install a browser wallet, then refresh.
                  </p>
                </div>
              </div>
            )}
            <div className="wallet-links">
              <a
                href={`https://metamask.app.link/dapp/${location.host}${location.pathname}`}
                target="_blank"
                rel="noreferrer"
              >
                Open in MetaMask <ArrowUpRight size={14} />
              </a>
              <a
                href="https://www.coinbase.com/wallet/downloads"
                target="_blank"
                rel="noreferrer"
              >
                Get Coinbase Wallet <ArrowUpRight size={14} />
              </a>
            </div>
            <p className="fine-print">
              Connecting is free. Sepolia ETH is only needed for onchain
              rewards. Never share a seed phrase.
            </p>
          </section>
        </div>
      )}
      {guide && (
        <div className="modal-backdrop" onClick={() => setGuide(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close how to play"
              onClick={() => setGuide(false)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">MEET YOUR NEW LITTLE HOBBY</span>
            <h2 id="guide-title">A hop, a skip, a squeak.</h2>
            <p>
              Your hamster runs automatically. It’s your job to time the jumps.
            </p>
            <div className="guide-row">
              <Keyboard size={24} />
              <div>
                <h3>On your computer</h3>
                <p>
                  Press Space, ↑ or W to jump. Press again in the air for a
                  double jump. P pauses your run.
                </p>
              </div>
            </div>
            <div className="guide-row">
              <Smartphone size={24} />
              <div>
                <h3>On your phone or tablet</h3>
                <p>
                  Tap anywhere in the garden to jump. Tap again for a double
                  jump. Use your wallet’s browser to connect.
                </p>
              </div>
            </div>
            <div className="guide-row">
              <Leaf size={24} />
              <div>
                <h3>Bring home the seeds</h3>
                <p>
                  Dodge pots and rocks. Each seed is one point. Your run is
                  checked and banked after a collision or when you finish from
                  the pause menu.
                </p>
              </div>
            </div>
            <div className="guide-row">
              <Coins size={24} />
              <div>
                <h3>Grow your rewards</h3>
                <p>
                  After the administrator publishes your points, stake them for
                  10 minutes and claim HAMS. SQK staking is a separate feature.
                </p>
              </div>
            </div>
            <button
              className="button primary wide"
              onClick={() => {
                setGuide(false);
                setPage("play");
              }}
            >
              Let’s find an adventure <ArrowRight size={16} />
            </button>
          </section>
        </div>
      )}
      {tx && (
        <div className="modal-backdrop">
          <section
            className="modal transaction-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tx-title"
          >
            <button
              className="modal-close icon-button"
              disabled={txBusy}
              aria-label="Close transaction review"
              onClick={() => setTx(null)}
            >
              <X size={20} />
            </button>
            <span className="pill">
              <ShieldCheck size={14} /> Simulation passed · Sepolia
            </span>
            <h2 id="tx-title">{tx.title}</h2>
            <p>{tx.description}</p>
            <div className="tx-detail">
              <span>Signing wallet</span>
              <code>{account}</code>
            </div>
            <div className="tx-detail">
              <span>{tx.to ? "Contract" : "Action"}</span>
              <code>{tx.to || "Deploy the HAMS staking pool"}</code>
            </div>
            {Object.entries(tx.details || {}).map(([k, v]) => (
              <div className="tx-detail" key={k}>
                <span>{k}</span>
                <code>{v}</code>
              </div>
            ))}
            <p className="fine-print">
              Your wallet shows the gas cost in Sepolia ETH. All tokens are for
              testing and have no monetary value.
            </p>
            {txHash ? (
              <>
                <a
                  className="text-button"
                  href={`https://eth-sepolia.blockscout.com/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction <ExternalLink size={14} />
                </a>
                <button
                  className="button primary wide"
                  disabled={txBusy}
                  onClick={() => checkReceipt(txHash, tx)}
                >
                  {txBusy ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Check size={17} />
                  )}{" "}
                  {txBusy ? "Waiting for confirmations…" : "Check transaction"}
                </button>
              </>
            ) : (
              <button
                className="button primary wide"
                disabled={txBusy || uncertain}
                onClick={send}
              >
                {txBusy ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <Wallet size={17} />
                )}{" "}
                {txBusy ? "Checking with your wallet…" : "Confirm in wallet"}
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
