import { useEffect, useRef, useState } from "react";
import {
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  ArrowUp,
  Wallet,
  Maximize,
  Flag,
  LoaderCircle,
} from "lucide-react";
import { createRun, step, RULES } from "../../shared/engine.mjs";
import { draw } from "./draw";
import { api } from "../lib";
type Props = {
  connected: boolean;
  active: boolean;
  connect: () => void;
  onSaved: () => void;
  notify: (s: string) => void;
};
export default function Game({
  connected,
  active,
  connect,
  onSaved,
  notify,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null),
    container = useRef<HTMLDivElement>(null),
    sim = useRef<any>(createRun(1)),
    modeRef = useRef("ready"),
    jump = useRef(false),
    jumps = useRef<number[]>([]),
    runId = useRef(""),
    timer = useRef(0),
    busy = useRef(false),
    pendingSave = useRef<any>(null);
  const [mode, setModeState] = useState("ready"),
    [hud, setHud] = useState({ distance: 0, coins: 0 }),
    [muted, setMuted] = useState(true),
    [saveStatus, setSaveStatus] = useState("");
  const setMode = (m: string) => {
    modeRef.current = m;
    setModeState(m);
  };
  const audio = useRef<AudioContext | null>(null),
    mutedRef = useRef(true);
  const activeRef = useRef(active),
    connectedRef = useRef(connected);
  activeRef.current = active;
  connectedRef.current = connected;
  function sound(freq: number) {
    if (mutedRef.current) return;
    try {
      audio.current ??= new AudioContext();
      const a = audio.current,
        o = a.createOscillator(),
        g = a.createGain();
      o.connect(g);
      g.connect(a.destination);
      o.frequency.setValueAtTime(freq, a.currentTime);
      o.frequency.exponentialRampToValueAtTime(
        freq * 0.5,
        a.currentTime + 0.12,
      );
      g.gain.setValueAtTime(0.035, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.15);
      o.start();
      o.stop(a.currentTime + 0.15);
    } catch {}
  }
  async function save() {
    const pending = pendingSave.current;
    if (!pending) return;
    setSaveStatus("Checking your run…");
    try {
      const result = await api(`/runs/${pending.id}/finish`, pending.body);
      setSaveStatus(`${result.coins} seeds banked. Nice run!`);
      pendingSave.current = null;
      onSaved();
    } catch (e) {
      setSaveStatus("Score not saved. Retry when you’re online.");
      notify((e as Error).message);
    }
  }
  const endRef = useRef(() => {});
  endRef.current = () => {
    if (modeRef.current !== "running" && modeRef.current !== "paused") return;
    setMode("over");
    sound(150);
    pendingSave.current = {
      id: runId.current,
      body: { jumps: [...jumps.current], ticks: sim.current.tick },
    };
    void save();
  };
  async function start() {
    if (!connected) return connect();
    if (busy.current) return;
    if (pendingSave.current) {
      notify("Save this run before starting another.");
      return;
    }
    busy.current = true;
    setMode("loading");
    try {
      const session = await api("/runs", {});
      if (!connectedRef.current) return;
      runId.current = session.id;
      sim.current = createRun(session.seed);
      jumps.current = [];
      jump.current = false;
      setHud({ distance: 0, coins: 0 });
      setSaveStatus("");
      setMode(activeRef.current ? "running" : "paused");
      if (activeRef.current) canvas.current?.focus();
    } catch (e) {
      notify((e as Error).message);
      setMode("ready");
    } finally {
      busy.current = false;
    }
  }
  function pause() {
    if (!activeRef.current) return;
    if (modeRef.current === "running") setMode("paused");
    else if (modeRef.current === "paused") setMode("running");
  }
  useEffect(() => {
    if (!connected) {
      modeRef.current = "ready";
      setModeState("ready");
      pendingSave.current = null;
      sim.current = createRun(1);
      setHud({ distance: 0, coins: 0 });
    }
  }, [connected]);
  useEffect(() => {
    if (!active && modeRef.current === "running") setMode("paused");
  }, [active]);
  useEffect(() => {
    let frame = 0,
      last = performance.now(),
      acc = 0;
    const c = canvas.current!,
      ctx = c.getContext("2d")!;
    const resize = () => {
      const box = c.getBoundingClientRect(),
        dpr = Math.min(devicePixelRatio || 1, 2);
      c.width = Math.round(box.width * dpr);
      c.height = Math.round(box.height * dpr);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(c);
    resize();
    const animate = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      timer.current += dt / 16.67;
      if (modeRef.current === "running") {
        acc += dt;
        while (acc >= 1000 / 60 && modeRef.current === "running") {
          const wasCoins = sim.current.coins;
          if (jump.current) {
            jumps.current.push(sim.current.tick);
            sound(470);
          }
          step(sim.current, jump.current);
          jump.current = false;
          acc -= 1000 / 60;
          if (sim.current.coins > wasCoins) sound(890);
          if (sim.current.tick % 6 === 0)
            setHud({
              distance: Math.floor(sim.current.distance),
              coins: sim.current.coins,
            });
          if (sim.current.dead || sim.current.tick >= RULES.maxTicks) {
            setHud({
              distance: Math.floor(sim.current.distance),
              coins: sim.current.coins,
            });
            endRef.current();
          }
        }
      } else acc = 0;
      if (c.width && c.height)
        draw(
          ctx,
          c.width,
          c.height,
          sim.current,
          modeRef.current,
          matchMedia("(prefers-reduced-motion: reduce)").matches
            ? 0
            : timer.current,
        );
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    const keys = (e: KeyboardEvent) => {
      if (!activeRef.current || document.querySelector('[role="dialog"]')) return;
      if (
        (e.target as HTMLElement).closest(
          'input,button,textarea,[role="dialog"]',
        )
      )
        return;
      if (
        ["Space", "ArrowUp", "KeyW"].includes(e.code) &&
        modeRef.current === "running"
      ) {
        e.preventDefault();
        if (!e.repeat) jump.current = true;
      }
      if (["Escape", "KeyP"].includes(e.code)) pause();
    };
    const hidden = () => {
      if (document.hidden && modeRef.current === "running") setMode("paused");
    };
    document.addEventListener("keydown", keys);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      document.removeEventListener("keydown", keys);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  return (
    <section
      className="game-card"
      ref={container}
      aria-label="Hamster runner game"
    >
      <div className="game-top">
        <span>
          <i className="live-dot" /> THE GARDEN RUN{" "}
          <span className="level-label">Endless adventure</span>
        </span>
        <div>
          <button
            className="icon-button"
            aria-label={muted ? "Turn sound on" : "Mute sound"}
            onClick={() => {
              mutedRef.current = !muted;
              setMuted(!muted);
            }}
          >
            {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
          <button
            className="icon-button fullscreen"
            aria-label="Fullscreen game"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else
                void container.current
                  ?.requestFullscreen()
                  .catch(() =>
                    notify("Fullscreen is not supported in this browser."),
                  );
            }}
          >
            <Maximize size={16} />
          </button>
        </div>
      </div>
      <div className={"game-scene " + (mode === "running" ? "playing" : "")}>
        <canvas
          ref={canvas}
          tabIndex={0}
          aria-label="Hamster runner. Press Space or Up arrow to jump, twice to double jump. P to pause."
          onPointerDown={(e) => {
            if (modeRef.current === "running") {
              e.preventDefault();
              jump.current = true;
            }
          }}
        />
        {["ready", "loading"].includes(mode) && (
          <div className="game-intro">
            <span className="scene-pill">A LITTLE RUN GOES A LONG WAY</span>
            <h2>
              Ready, set, <em>squeak!</em>
            </h2>
            <p>
              Hop over obstacles. Gather seeds.
              <br />
              Make every little leap count.
            </p>
            <button
              className="button primary"
              onClick={start}
              disabled={mode === "loading"}
            >
              {mode === "loading" ? (
                <LoaderCircle className="spin" size={18} />
              ) : connected ? (
                <Play size={17} fill="currentColor" />
              ) : (
                <Wallet size={17} />
              )}{" "}
              {mode === "loading"
                ? "Preparing your run…"
                : connected
                  ? "Let’s run"
                  : "Connect wallet to play"}
            </button>
            <span className="scene-note">Free to play · Sepolia testnet</span>
          </div>
        )}
        {mode === "running" && (
          <div className="game-hud">
            <span>
              {String(hud.distance).padStart(5, "0")} <small>m</small>
            </span>
            <span>✦ {hud.coins}</span>
            <button
              className="icon-button"
              aria-label="Pause game"
              onClick={pause}
            >
              <Pause size={20} />
            </button>
          </div>
        )}
        {(mode === "paused" || mode === "over") && (
          <div className="game-end">
            <span className="scene-pill">
              {mode === "paused"
                ? "TAKE A BREATHER"
                : "THAT WAS A GOOD LITTLE ADVENTURE"}
            </span>
            <h2>
              {mode === "paused" ? "Paws for a moment." : "One more run?"}
            </h2>
            {mode === "over" && (
              <>
                <div className="run-result">
                  <span>
                    <strong>{hud.distance}</strong>meters
                  </span>
                  <span>
                    <strong>{hud.coins}</strong>seeds collected
                  </span>
                </div>
                <p className="save-status" role="status">
                  {saveStatus}
                </p>
              </>
            )}
            <button
              className="button primary"
              onClick={() =>
                mode === "paused"
                  ? setMode("running")
                  : pendingSave.current
                    ? void save()
                    : void start()
              }
            >
              {mode === "paused" ? <Play size={17} /> : <RotateCcw size={17} />}{" "}
              {mode === "paused"
                ? "Keep running"
                : pendingSave.current
                  ? "Retry saving run"
                  : "Run again"}
            </button>
            {mode === "paused" && (
              <button className="text-button" onClick={() => endRef.current()}>
                Finish & bank seeds <Flag size={14} />
              </button>
            )}
          </div>
        )}
      </div>
      <div className="game-controls">
        <span className="desktop-control">
          <kbd>space</kbd> or <kbd>↑</kbd> to jump{" "}
          <span className="control-divider" /> Twice for a double jump
        </span>
        <span className="touch-control">
          <ArrowUp size={15} /> Tap the garden to jump · Tap twice to double
          jump
        </span>
        <span className="desktop-control">
          <kbd>P</kbd> pause
        </span>
      </div>
    </section>
  );
}
