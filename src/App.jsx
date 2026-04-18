import { useState, useRef, useEffect, useCallback } from "react";

// ─── DATA ────────────────────────────────────────────────────────────────────
const LEVELS = [
  { lv: 1,  xpRequired: 0,    title: "Beginner",    titleJa: "初心者",   unlock: "Basic scenarios" },
  { lv: 2,  xpRequired: 100,  title: "Explorer",    titleJa: "探索者",   unlock: "Station scenario" },
  { lv: 3,  xpRequired: 250,  title: "Conversant",  titleJa: "会話者",   unlock: "Intermediate scenarios" },
  { lv: 4,  xpRequired: 450,  title: "Fluent",      titleJa: "流暢",     unlock: "Date scenario" },
  { lv: 5,  xpRequired: 700,  title: "Advanced",    titleJa: "上級者",   unlock: "Fast-talk mode" },
  { lv: 7,  xpRequired: 1400, title: "Expert",      titleJa: "専門家",   unlock: "Business Japanese" },
  { lv: 10, xpRequired: 3200, title: "Sensei",      titleJa: "先生",     unlock: "Full access" },
];

const SCENARIOS = [
  { id: "cafe",     emoji: "☕", title: "Café",       titleJa: "カフェで注文",  color: "#FF6B6B", minLv: 1,
    desc: "Order drinks and snacks",
    goals: ["コーヒーをください", "いくらですか？", "〜をひとつください"],
    character: { name: "店員さん (Mika)", mood: "friendly", style: "polite" },
    events: ["The café gets busy", "They're out of your item", "Special discount offered"] },
  { id: "station",  emoji: "🚃", title: "Station",    titleJa: "駅で案内",     color: "#4ECDC4", minLv: 2,
    desc: "Navigate trains and ask directions",
    goals: ["〜はどこですか？", "〜まで一枚ください", "次の電車は何時ですか？"],
    character: { name: "駅員さん (Kenji)", mood: "cold", style: "formal" },
    events: ["Train is delayed", "Platform change", "Kenji gets impatient"] },
  { id: "shopping", emoji: "🛍️", title: "Shopping",  titleJa: "買い物",        color: "#FFE66D", minLv: 1,
    desc: "Shop and bargain in Japanese",
    goals: ["これはいくらですか？", "試着してもいいですか？", "少し安くなりますか？"],
    character: { name: "店員さん (Yuki)", mood: "helpful", style: "casual-polite" },
    events: ["Item goes on sale", "Another customer interrupts", "Store closing soon"] },
  { id: "friend",   emoji: "🤝", title: "New Friend", titleJa: "友達を作る",   color: "#A8E6CF", minLv: 1,
    desc: "Introduce yourself and make friends",
    goals: ["はじめまして、〜です", "どこから来ましたか？", "趣味は何ですか？"],
    character: { name: "Hana (friendly local)", mood: "cheerful", style: "casual" },
    events: ["Hana invites you somewhere", "Common interest discovered", "Exchange contacts"] },
  { id: "business", emoji: "💼", title: "Business",   titleJa: "ビジネス会話",  color: "#B8C0FF", minLv: 7,
    desc: "Professional keigo and office talk",
    goals: ["よろしくお願いいたします", "ご確認いただけますか？", "失礼いたします"],
    character: { name: "田中部長 (Manager Tanaka)", mood: "serious", style: "keigo" },
    events: ["Meeting starts late", "Asked to present", "Boss compliments your Japanese"] },
];

const STORAGE_KEY = "nihongo_v4";
const FREE_LIMIT   = 3;

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getLv(xp)     { return [...LEVELS].reverse().find(l => xp >= l.xpRequired) || LEVELS[0]; }
function getNextLv(xp) { return LEVELS.find(l => l.xpRequired > xp) || LEVELS[LEVELS.length - 1]; }
function lvPct(xp)     { const c = getLv(xp), n = getNextLv(xp); return c.lv === 10 ? 100 : Math.round(((xp - c.xpRequired) / (n.xpRequired - c.xpRequired)) * 100); }

function cleanForTTS(raw) {
  return raw
    .replace(/\(([^)]*[a-zA-Z][^)]*)\)/g, "")   // remove (English)
    .replace(/💡[\s\S]*$/m, "")
    .replace(/📊[\s\S]*$/m, "")
    .replace(/[#*_`>•]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPrompt(sc, lv) {
  return `You are roleplaying as "${sc.character.name}" in a Japanese learning app. Style: ${sc.character.style}, mood: ${sc.character.mood}.
Scenario: ${sc.titleJa} — ${sc.desc}. Student level: Lv${lv}${lv >= 7 ? " (native mode, minimal English)" : " (add English hints in parentheses)"}.
Target phrases: ${sc.goals.join(" / ")}.
Rules: Stay in character. Speak mostly Japanese. Gently model corrections. After 3rd exchange, introduce: ${sc.events[0]}. Keep messages 2–4 sentences. After 5+ exchanges, end naturally and output "📊 SUMMARY:" block with: 習得フレーズ / ミス / スコア X/100 / コメント. Output summary once only. Begin naturally.`;
}

// ─── TTS HOOK ────────────────────────────────────────────────────────────────
// Key insight: SpeechSynthesis MUST be called synchronously inside a user gesture
// handler (click). We queue the text and fire immediately on button press.
function useTTS() {
  const [speaking, setSpeaking]   = useState(false);
  const [activeId, setActiveId]   = useState(null);
  const [voices, setVoices]       = useState([]);
  const [hasJa, setHasJa]         = useState(false);
  const utterRef = useRef(null);

  // Load voices — some browsers fire voiceschanged, others populate immediately
  useEffect(() => {
    function loadVoices() {
      const v = window.speechSynthesis?.getVoices() || [];
      if (v.length) {
        setVoices(v);
        setHasJa(v.some(x => x.lang.startsWith("ja")));
      }
    }
    loadVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", loadVoices);
    // Polling fallback (Firefox / some mobile)
    const t = setInterval(() => {
      const v = window.speechSynthesis?.getVoices() || [];
      if (v.length) { loadVoices(); clearInterval(t); }
    }, 300);
    return () => {
      window.speechSynthesis?.removeEventListener("voiceschanged", loadVoices);
      clearInterval(t);
    };
  }, []);

  // Speak — call DIRECTLY inside onClick, no setTimeout
  const speak = useCallback((text, id) => {
    const synth = window.speechSynthesis;
    if (!synth) return;

    // Toggle: tap same bubble → stop
    if (activeId === id && speaking) {
      synth.cancel();
      setSpeaking(false);
      setActiveId(null);
      return;
    }

    synth.cancel(); // stop any current speech

    const clean = cleanForTTS(text);
    if (!clean) return;

    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang  = "ja-JP";
    utter.rate  = 0.82;
    utter.pitch = 1.05;

    // Pick best Japanese voice
    const jaVoice =
      voices.find(v => v.lang === "ja-JP" && v.localService) ||
      voices.find(v => v.lang === "ja-JP") ||
      voices.find(v => v.lang.startsWith("ja")) ||
      null;
    if (jaVoice) utter.voice = jaVoice;

    utter.onstart  = () => { setSpeaking(true);  setActiveId(id); };
    utter.onend    = () => { setSpeaking(false); setActiveId(null); };
    utter.onerror  = () => { setSpeaking(false); setActiveId(null); };
    utterRef.current = utter;

    // Chromium bug: synth stops after ~15s without this workaround
    const keepAlive = setInterval(() => {
      if (!synth.speaking) { clearInterval(keepAlive); return; }
      synth.pause(); synth.resume();
    }, 10000);
    utter.onend = () => { setSpeaking(false); setActiveId(null); clearInterval(keepAlive); };

    synth.speak(utter);
    // Immediately reflect state (onstart may fire async)
    setSpeaking(true);
    setActiveId(id);
  }, [voices, speaking, activeId]);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    setActiveId(null);
  }, []);

  return { speak, stop, speaking, activeId, hasJa, voices };
}

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen,   setScreen]   = useState("home");
  const [scenario, setScenario] = useState(null);
  const [msgs,     setMsgs]     = useState([]);
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [summary,  setSummary]  = useState(null);
  const [lvUp,     setLvUp]     = useState(null);
  const [proModal, setProModal] = useState(false);

  // Persistent
  const [xp,         setXp]         = useState(0);
  const [streak,     setStreak]     = useState(0);
  const [sessions,   setSessions]   = useState(0);
  const [missions,   setMissions]   = useState([]);
  const [scStats,    setScStats]    = useState({});
  const [autoSpeak,  setAutoSpeak]  = useState(false); // OFF by default — user must opt in

  const tts = useTTS();
  const bottomRef  = useRef(null);
  const msgCount   = useRef(0);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  // Storage
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(STORAGE_KEY);
        if (r?.value) {
          const s = JSON.parse(r.value);
          setXp(s.xp || 0); setStreak(s.streak || 0); setMissions(s.missions || []);
          setScStats(s.scStats || {});
          setSessions(s.lastDate === new Date().toDateString() ? (s.sessions || 0) : 0);
        }
      } catch {}
    })();
    return () => tts.stop();
  }, []);

  const save = useCallback(async (patch) => {
    try {
      const base = { xp, streak, missions, scStats, sessions, lastDate: new Date().toDateString() };
      await window.storage.set(STORAGE_KEY, JSON.stringify({ ...base, ...patch }));
    } catch {}
  }, [xp, streak, missions, scStats, sessions]);

  const addXP = useCallback(async (n) => {
    const prev = getLv(xp).lv;
    const nx = xp + n;
    setXp(nx);
    if (getLv(nx).lv > prev) setLvUp(getLv(nx).lv);
    await save({ xp: nx });
  }, [xp, save]);

  // Start scenario
  const start = async (sc) => {
    if (sessions >= FREE_LIMIT) { setProModal(true); return; }
    if (sc.minLv > getLv(xp).lv) return;
    setScenario(sc); setMsgs([]); setSummary(null);
    msgCount.current = 0; setScreen("chat"); setLoading(true); tts.stop();
    const ns = sessions + 1; setSessions(ns); await save({ sessions: ns });
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 600,
          system: buildPrompt(sc, getLv(xp).lv),
          messages: [{ role: "user", content: "Start!" }] }),
      });
      const d = await r.json();
      const text = d.content?.[0]?.text || "こんにちは！";
      const id = Date.now();
      setMsgs([{ role: "assistant", content: text, id }]);
      // Auto-speak: only if user enabled it (requires prior user gesture)
      if (autoSpeak) tts.speak(text, id);
    } catch { setMsgs([{ role: "assistant", content: "接続エラーです。", id: Date.now() }]); }
    setLoading(false);
  };

  // Send
  const send = async () => {
    if (!input.trim() || loading) return;
    const txt = input.trim(); setInput("");
    const uid = Date.now();
    const next = [...msgs, { role: "user", content: txt, id: uid }];
    setMsgs(next); setLoading(true); tts.stop();
    msgCount.current++;
    await addXP(10);
    if (msgCount.current >= 5 && !missions.includes("m2")) {
      const nm = [...missions, "m2"]; setMissions(nm); await save({ missions: nm });
    }
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 600,
          system: buildPrompt(scenario, getLv(xp).lv),
          messages: next.map(m => ({ role: m.role, content: m.content })) }),
      });
      const d = await r.json();
      const text = d.content?.[0]?.text || "すみません。";
      if (text.includes("📊 SUMMARY:")) {
        const [chat, sum] = text.split("📊 SUMMARY:");
        const aid = Date.now();
        setMsgs([...next, { role: "assistant", content: chat.trim(), id: aid }]);
        setSummary(sum.trim());
        if (autoSpeak) tts.speak(chat.trim(), aid);
        await addXP(40);
        const ss = { ...scStats, [scenario.id]: { completions: (scStats[scenario.id]?.completions || 0) + 1 } };
        setScStats(ss); await save({ scStats: ss });
        setTimeout(() => setScreen("summary"), 1800);
      } else {
        const aid = Date.now();
        setMsgs([...next, { role: "assistant", content: text, id: aid }]);
        if (autoSpeak) tts.speak(text, aid);
      }
    } catch { setMsgs([...next, { role: "assistant", content: "エラーが発生しました。", id: Date.now() }]); }
    setLoading(false);
  };

  const level = getLv(xp);
  const bgChars = "日本語学習話文字音声練習会話文法漢字ひらがなカタカナ";

  // ─── Bubble ───────────────────────────────────────────────────────────────
  const Bubble = ({ msg }) => {
    const isA = msg.role === "assistant";
    let main = msg.content, tip = "";
    if (isA && msg.content.includes("💡")) {
      const [a, b] = msg.content.split("💡");
      main = a.trim(); tip = b?.trim();
    }
    const active = tts.activeId === msg.id && tts.speaking;
    return (
      <div className="msg-enter" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={css.role(isA)}>{isA ? (scenario?.character?.name || "先生") : "You"}</div>
        {main && (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flexDirection: isA ? "row" : "row-reverse" }}>
            <div style={css.bubble(isA)}>{main}</div>
            {isA && (
              <button
                style={css.speakBtn(active)}
                onClick={() => tts.speak(main, msg.id)}
                title={active ? "読み上げを停止" : "読み上げ"}
              >
                {active ? "⏹" : "🔊"}
              </button>
            )}
          </div>
        )}
        {tip && <div style={css.tip}>💡 {tip}</div>}
      </div>
    );
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div style={css.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:rgba(167,139,250,.3);border-radius:4px}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes bounce{0%,100%{transform:translateY(0);opacity:.4}50%{transform:translateY(-5px);opacity:1}}
        @keyframes pop{0%{transform:scale(.5);opacity:0}70%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
        @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}
        .msg-enter{animation:fadeUp .22s ease forwards}
        .card:hover{transform:translateY(-2px) scale(1.01)!important}
        button{font-family:'Noto Sans JP',sans-serif;cursor:pointer}
        textarea:focus{border-color:rgba(167,139,250,.6)!important;outline:none}
      `}</style>

      {/* BG */}
      <div style={css.bg}>{bgChars.repeat(12).split("").map((c, i) => <span key={i}>{c}</span>)}</div>

      {/* Overlays */}
      {lvUp && (
        <div style={css.overlay} onClick={() => setLvUp(null)}>
          <div style={{ animation: "pop .4s ease forwards", textAlign: "center" }}>
            <div style={{ fontSize: 60 }}>🎉</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: "#ffd166", marginTop: 8 }}>Level Up!</div>
            <div style={{ fontSize: 20, color: "#f0e6ff", marginTop: 4 }}>Lv {lvUp} — {LEVELS.find(l => l.lv === lvUp)?.titleJa}</div>
            <div style={{ fontSize: 11, color: "rgba(240,230,255,.4)", marginTop: 16 }}>タップして続ける</div>
          </div>
        </div>
      )}
      {proModal && (
        <div style={css.overlay} onClick={() => setProModal(false)}>
          <div style={{ ...css.modal, animation: "pop .3s ease" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 36, textAlign: "center" }}>⭐</div>
            <div style={{ fontSize: 20, fontWeight: 900, textAlign: "center", marginTop: 8 }}>Go Pro</div>
            <div style={{ fontSize: 13, color: "rgba(240,230,255,.6)", textAlign: "center", marginTop: 6, lineHeight: 1.7 }}>
              本日の無料セッション（3回）を使い切りました。<br />アップグレードで無制限に練習できます。
            </div>
            {[{ p: "Monthly", v: "¥980/月" }, { p: "Annual", v: "¥7,800/年", s: "33% OFF" }].map(x => (
              <div key={x.p} style={css.planRow}>
                <div><div style={{ fontWeight: 700 }}>{x.p}</div>{x.s && <span style={css.save}>{x.s}</span>}</div>
                <div style={{ fontWeight: 900, color: "#ffd166" }}>{x.v}</div>
              </div>
            ))}
            <button style={css.primaryBtn} onClick={() => setProModal(false)}>無料トライアル開始</button>
            <button style={css.ghostBtn}   onClick={() => setProModal(false)}>後で</button>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div style={css.header}>
        {screen !== "home"
          ? <button style={css.backBtn} onClick={() => { setScreen("home"); tts.stop(); }}>←</button>
          : <div style={css.logo}>にほんご<span style={{ color: "#ffd166", fontSize: 10, marginLeft: 3 }}>AI</span></div>
        }
        {screen === "chat" && scenario && (
          <div style={{ display: "flex", alignItems: "center", gap: 7, flex: 1, paddingLeft: 8 }}>
            <span style={{ fontSize: 18 }}>{scenario.emoji}</span>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{scenario.titleJa}</div>
          </div>
        )}
        <div style={{ display: "flex", gap: 7, alignItems: "center", flexShrink: 0 }}>
          {/* Auto-speak toggle */}
          <button
            style={css.toggleBtn(autoSpeak)}
            onClick={() => { setAutoSpeak(v => !v); if (autoSpeak) tts.stop(); }}
            title={autoSpeak ? "自動読み上げ ON" : "自動読み上げ OFF"}
          >
            {autoSpeak ? "🔊 AUTO" : "🔇 AUTO"}
          </button>
          <div style={css.chip}>🔥 {streak}</div>
          <div style={css.chip}>⭐ {xp}</div>
        </div>
      </div>

      {/* XP bar */}
      <div style={css.xpWrap}>
        <div style={{ ...css.xpFill, width: lvPct(xp) + "%" }} />
        <div style={css.xpLabel}>Lv {level.lv} · {level.title} · {xp} XP</div>
      </div>

      {/* ══ HOME ═══════════════════════════════════════ */}
      {screen === "home" && (
        <div style={css.scroll}>
          <div style={css.hero}>
            <div style={css.heroTitle}>AI日本語<br />会話トレーニング</div>
            <div style={css.heroSub}>Real conversations. Real improvement.</div>
          </div>

          {/* TTS info banner */}
          <div style={{ margin: "0 16px 16px", borderRadius: 14, padding: "12px 16px", background: "rgba(167,139,250,.08)", border: "1px solid rgba(167,139,250,.2)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#c4b5fd", marginBottom: 4 }}>🔊 読み上げ機能の使い方</div>
            <div style={{ fontSize: 12, color: "rgba(240,230,255,.55)", lineHeight: 1.7 }}>
              会話画面でAIのメッセージ横の <strong style={{ color: "#f0e6ff" }}>🔊 ボタン</strong>をタップすると読み上げます。<br />
              ヘッダーの <strong style={{ color: "#f0e6ff" }}>AUTO</strong> をONにすると返答を自動再生します。<br />
              {tts.hasJa ? "✅ 日本語音声が利用可能です" : "⚠️ 日本語音声を読み込み中…"}
            </div>
          </div>

          {/* Voice test button */}
          <div style={{ margin: "0 16px 20px" }}>
            <button
              style={{ ...css.primaryBtn, background: "rgba(167,139,250,.15)", border: "1px solid rgba(167,139,250,.3)", color: "#c4b5fd", padding: "10px" }}
              onClick={() => tts.speak("こんにちは！日本語の読み上げテストです。", "test")}
            >
              🔊 読み上げテスト — タップして確認
            </button>
          </div>

          <div style={{ padding: "0 16px" }}>
            <div style={css.label}>シナリオを選ぶ</div>
            {SCENARIOS.map(sc => {
              const locked = sc.minLv > level.lv;
              const done   = scStats[sc.id]?.completions || 0;
              return (
                <div key={sc.id} className={locked ? "" : "card"} style={css.scCard(sc.color, locked)} onClick={() => !locked && start(sc)}>
                  <div style={css.scEmoji(locked)}>{locked ? "🔒" : sc.emoji}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, opacity: locked ? .4 : 1 }}
