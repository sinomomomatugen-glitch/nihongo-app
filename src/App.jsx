import { useState, useRef, useEffect, useCallback } from "react";

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
  { id: "cafe", emoji: "☕", title: "Café", titleJa: "カフェで注文", color: "#FF6B6B", minLv: 1,
    desc: "Order drinks and snacks",
    goals: ["コーヒーをください", "いくらですか？", "〜をひとつください"],
    character: { name: "店員さん (Mika)", mood: "friendly", style: "polite" },
    events: ["The café gets busy", "They're out of your item", "Special discount offered"] },
  { id: "station", emoji: "🚃", title: "Station", titleJa: "駅で案内", color: "#4ECDC4", minLv: 2,
    desc: "Navigate trains and ask directions",
    goals: ["〜はどこですか？", "〜まで一枚ください", "次の電車は何時ですか？"],
    character: { name: "駅員さん (Kenji)", mood: "cold", style: "formal" },
    events: ["Train is delayed", "Platform change", "Kenji gets impatient"] },
  { id: "shopping", emoji: "🛍️", title: "Shopping", titleJa: "買い物", color: "#FFE66D", minLv: 1,
    desc: "Shop and bargain in Japanese",
    goals: ["これはいくらですか？", "試着してもいいですか？", "少し安くなりますか？"],
    character: { name: "店員さん (Yuki)", mood: "helpful", style: "casual-polite" },
    events: ["Item goes on sale", "Another customer interrupts", "Store closing soon"] },
  { id: "friend", emoji: "🤝", title: "New Friend", titleJa: "友達を作る", color: "#A8E6CF", minLv: 1,
    desc: "Introduce yourself and make friends",
    goals: ["はじめまして、〜です", "どこから来ましたか？", "趣味は何ですか？"],
    character: { name: "Hana (friendly local)", mood: "cheerful", style: "casual" },
    events: ["Hana invites you somewhere", "Common interest discovered", "Exchange contacts"] },
  { id: "business", emoji: "💼", title: "Business", titleJa: "ビジネス会話", color: "#B8C0FF", minLv: 7,
    desc: "Professional keigo and office talk",
    goals: ["よろしくお願いいたします", "ご確認いただけますか？", "失礼いたします"],
    character: { name: "田中部長 (Manager Tanaka)", mood: "serious", style: "keigo" },
    events: ["Meeting starts late", "Asked to present", "Boss compliments your Japanese"] },
];

const STORAGE_KEY = "nihongo_v4";
const FREE_LIMIT = 3;

function getLv(xp) { return [...LEVELS].reverse().find(l => xp >= l.xpRequired) || LEVELS[0]; }
function getNextLv(xp) { return LEVELS.find(l => l.xpRequired > xp) || LEVELS[LEVELS.length - 1]; }
function lvPct(xp) { const c = getLv(xp), n = getNextLv(xp); return c.lv === 10 ? 100 : Math.round(((xp - c.xpRequired) / (n.xpRequired - c.xpRequired)) * 100); }

function cleanForTTS(raw) {
  return raw
    .replace(/\(([^)]*[a-zA-Z][^)]*)\)/g, "")
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
Rules: Stay in character. Speak mostly Japanese. Gently model corrections. After 3rd exchange, introduce: ${sc.events[0]}. Keep messages 2-4 sentences. After 5+ exchanges, end naturally and output "📊 SUMMARY:" block with: 習得フレーズ / ミス / スコア X/100 / コメント. Output summary once only. Begin naturally.`;
             }function useTTS() {
  const [speaking, setSpeaking] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [voices, setVoices] = useState([]);
  const [hasJa, setHasJa] = useState(false);
  const keepAliveRef = useRef(null);

  useEffect(() => {
    const load = () => {
      const v = window.speechSynthesis?.getVoices() || [];
      if (v.length) { setVoices(v); setHasJa(v.some(x => x.lang.startsWith("ja"))); }
    };
    load();
    window.speechSynthesis?.addEventListener("voiceschanged", load);
    const t = setInterval(() => {
      const v = window.speechSynthesis?.getVoices() || [];
      if (v.length) { load(); clearInterval(t); }
    }, 200);
    return () => {
      window.speechSynthesis?.removeEventListener("voiceschanged", load);
      clearInterval(t);
    };
  }, []);

  const speak = useCallback((text, id) => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (activeId === id && speaking) {
      synth.cancel();
      clearInterval(keepAliveRef.current);
      setSpeaking(false); setActiveId(null);
      return;
    }
    synth.cancel();
    clearInterval(keepAliveRef.current);
    const clean = cleanForTTS(text);
    if (!clean) return;
    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang = "ja-JP"; utter.rate = 0.82; utter.pitch = 1.05;
    const jaVoice =
      voices.find(v => v.lang === "ja-JP" && v.localService) ||
      voices.find(v => v.lang === "ja-JP") ||
      voices.find(v => v.lang.startsWith("ja")) || null;
    if (jaVoice) utter.voice = jaVoice;
    const done = () => { clearInterval(keepAliveRef.current); setSpeaking(false); setActiveId(null); };
    utter.onend = done; utter.onerror = done;
    setSpeaking(true); setActiveId(id);
    synth.speak(utter);
    keepAliveRef.current = setInterval(() => {
      if (!synth.speaking) { clearInterval(keepAliveRef.current); return; }
      synth.pause(); synth.resume();
    }, 10000);
  }, [voices, speaking, activeId]);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    clearInterval(keepAliveRef.current);
    setSpeaking(false); setActiveId(null);
  }, []);

  return { speak, stop, speaking, activeId, hasJa };
}

export default function App() {
  const [screen, setScreen] = useState("home");
  const [scenario, setScenario] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [lvUp, setLvUp] = useState(null);
  const [proModal, setProModal] = useState(false);
  const [xp, setXp] = useState(0);
  const [streak, setStreak] = useState(0);
  const [sessions, setSessions] = useState(0);
  const [missions, setMissions] = useState([]);
  const [scStats, setScStats] = useState({});
  const [listenCount, setListenCount] = useState(0);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const tts = useTTS();
  const bottomRef = useRef(null);
  const msgCount = useRef(0);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const s = JSON.parse(raw);
        setXp(s.xp || 0); setStreak(s.streak || 0); setMissions(s.missions || []);
        setScStats(s.scStats || {});
        const today = new Date().toDateString();
        setSessions(s.lastDate === today ? (s.sessions || 0) : 0);
      } catch {}
    }
    return () => tts.stop();
  }, []);

  const save = useCallback((patch = {}) => {
    const base = { xp, streak, missions, scStats, sessions, lastDate: new Date().toDateString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...base, ...patch }));
  }, [xp, streak, missions, scStats, sessions]);

  const addXP = useCallback((n) => {
    const prev = getLv(xp).lv;
    const nx = xp + n;
    setXp(nx);
    if (getLv(nx).lv > prev) setLvUp(getLv(nx).lv);
    save({ xp: nx });
    return nx;
  }, [xp, save]);

  const callAPI = async (messages, sc) => {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 700,
        system: buildPrompt(sc, getLv(xp).lv),
        messages,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "API error");
    return data.content?.[0]?.text || "";
  };

  const startScenario = async (sc) => {
    if (sessions >= FREE_LIMIT) { setProModal(true); return; }
    if (sc.minLv > getLv(xp).lv) return;
    setScenario(sc); setMsgs([]); setSummary(null);
    msgCount.current = 0; setScreen("chat"); setLoading(true); tts.stop();
    const ns = sessions + 1; setSessions(ns); save({ sessions: ns });
    try {
      const text = await callAPI([{ role: "user", content: "Start the scene!" }], sc);
      const id = Date.now();
      setMsgs([{ role: "assistant", content: text, id }]);
      if (autoSpeak) tts.speak(text, id);
    } catch {
      setMsgs([{ role: "assistant", content: "接続エラーです。", id: Date.now() }]);
    }
    setLoading(false);
  };

  const send = async () => {
    if (!input.trim() || loading) return;
    const txt = input.trim(); setInput("");
    const uid = Date.now();
    const next = [...msgs, { role: "user", content: txt, id: uid }];
    setMsgs(next); setLoading(true); tts.stop();
    msgCount.current++;
    addXP(10);
    if (msgCount.current >= 5 && !missions.includes("m2")) {
      const nm = [...missions, "m2"]; setMissions(nm); save({ missions: nm });
    }
    try {
      const text = await callAPI(next.map(m => ({ role: m.role, content: m.content })), scenario);
      if (text.includes("📊 SUMMARY:")) {
        const [chat, sum] = text.split("📊 SUMMARY:");
        const chatTrim = chat.trim();
        const aid = Date.now();
        setMsgs([...next, { role: "assistant", content: chatTrim, id: aid }]);
        setSummary(sum.trim());
        if (autoSpeak) tts.speak(chatTrim, aid);
        addXP(40);
        const ss = { ...scStats, [scenario.id]: { completions: (scStats[scenario.id]?.completions || 0) + 1 } };
        setScStats(ss);
        const nm = [...missions];
        if (scenario.id === "cafe" && !nm.includes("m1")) nm.push("m1");
        setMissions(nm); save({ scStats: ss, missions: nm });
        setTimeout(() => setScreen("summary"), 1800);
      } else {
        const aid = Date.now();
        setMsgs([...next, { role: "assistant", content: text, id: aid }]);
        if (autoSpeak) tts.speak(text, aid);
      }
    } catch {
      setMsgs([...next, { role: "assistant", content: "エラーが発生しました。", id: Date.now() }]);
    }
    setLoading(false);
  };

  const handleSpeak = (text, id) => {
    tts.speak(text, id);
    const next = listenCount + 1;
    setListenCount(next);
  };

  const level = getLv(xp);
  const remaining = Math.max(0, FREE_LIMIT - sessions);
  const bgChars = "日本語学習話文字音声練習会話文法漢字ひらがなカタカナ";const Bubble = ({ msg }) => {
    const isA = msg.role === "assistant";
    let main = msg.content, tip = "";
    if (isA && msg.content.includes("💡")) {
      const [a, b] = msg.content.split("💡");
      main = a.trim(); tip = b?.trim();
    }
    const active = tts.activeId === msg.id && tts.speaking;
    return (
      <div className="msg" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={css.role(isA)}>{isA ? (scenario?.character?.name || "先生") : "You"}</div>
        {main && (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flexDirection: isA ? "row" : "row-reverse" }}>
            <div style={css.bubble(isA)}>{main}</div>
            {isA && (
              <button style={css.speakBtn(active)} onClick={() => handleSpeak(main, msg.id)}>
                {active ? "⏹" : "🔊"}
              </button>
            )}
          </div>
        )}
        {tip && <div style={css.tip}>💡 {tip}</div>}
      </div>
    );
  };

  return (
    <div style={css.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0f0c29; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: rgba(167,139,250,.3); border-radius: 4px; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        @keyframes bounce { 0%,100%{transform:translateY(0);opacity:.4} 50%{transform:translateY(-5px);opacity:1} }
        @keyframes pop { 0%{transform:scale(.5);opacity:0} 70%{transform:scale(1.08)} 100%{transform:scale(1);opacity:1} }
        @keyframes pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.2)} }
        .msg { animation: fadeUp .22s ease forwards; }
        .card:hover { transform: translateY(-2px) scale(1.01) !important; }
        button { font-family: 'Noto Sans JP', sans-serif; cursor: pointer; }
        textarea:focus { border-color: rgba(167,139,250,.6) !important; outline: none; }
      `}</style>
      <div style={css.bg}>{bgChars.repeat(12).split("").map((c, i) => <span key={i}>{c}</span>)}</div>
      {lvUp && (
        <div style={css.overlay} onClick={() => setLvUp(null)}>
          <div style={{ animation: "pop .4s ease forwards", textAlign: "center" }}>
            <div style={{ fontSize: 64 }}>🎉</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: "#ffd166", marginTop: 8 }}>レベルアップ！</div>
            <div style={{ fontSize: 22, color: "#f0e6ff", marginTop: 4 }}>Lv {lvUp} — {LEVELS.find(l => l.lv === lvUp)?.titleJa}</div>
            <div style={{ fontSize: 12, color: "rgba(240,230,255,.4)", marginTop: 16 }}>タップして続ける</div>
          </div>
        </div>
      )}
      {proModal && (
        <div style={css.overlay} onClick={() => setProModal(false)}>
          <div style={{ ...css.modal, animation: "pop .3s ease" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 40, textAlign: "center" }}>⭐</div>
            <div style={{ fontSize: 20, fontWeight: 900, textAlign: "center", marginTop: 8 }}>Go Pro</div>
            <div style={{ fontSize: 13, color: "rgba(240,230,255,.6)", textAlign: "center", marginTop: 6, lineHeight: 1.7 }}>
              本日の無料セッション（3回）を使い切りました。
            </div>
            {[{ p: "Monthly", v: "¥980/月" }, { p: "Annual", v: "¥7,800/年", s: "33% OFF" }].map(x => (
              <div key={x.p} style={css.planRow}>
                <div><div style={{ fontWeight: 700 }}>{x.p}</div>{x.s && <span style={css.save}>{x.s}</span>}</div>
                <div style={{ fontWeight: 900, color: "#ffd166" }}>{x.v}</div>
              </div>
            ))}
            <button style={css.primaryBtn} onClick={() => setProModal(false)}>無料トライアル開始</button>
            <button style={css.ghostBtn} onClick={() => setProModal(false)}>後で</button>
          </div>
        </div>
      )}
      <header style={css.header}>
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
          <button style={css.autoBtn(autoSpeak)} onClick={() => { setAutoSpeak(v => !v); if (autoSpeak) tts.stop(); }}>
            {autoSpeak ? "🔊" : "🔇"}
          </button>
          <div style={css.chip}>🔥 {streak}</div>
          <div style={css.chip}>⭐ {xp}</div>
          <div style={{ ...css.chip, background: remaining === 0 ? "rgba(255,80,80,.2)" : "rgba(78,205,196,.15)", color: remaining === 0 ? "#ff8888" : "#4ecdc4", cursor: "pointer" }}
            onClick={() => remaining === 0 && setProModal(true)}>
            {remaining}/3
          </div>
        </div>
      </header>
      <div style={css.xpWrap}>
        <div style={{ ...css.xpFill, width: lvPct(xp) + "%" }} />
        <div style={css.xpLabel}>Lv {level.lv} · {level.title} · {xp} XP</div>
      </div>
      {screen === "home" && (
        <div style={css.scroll}>
          <div style={css.hero}>
            <div style={css.heroTitle}>AI日本語<br />会話トレーニング</div>
            <div style={css.heroSub}>Real conversations. Real improvement.</div>
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {tts.hasJa && <span style={css.pill}>🔊 日本語音声対応</span>}
              <span style={css.pill}>🤖 AIロールプレイ</span>
              <span style={css.pill}>📊 成長記録</span>
            </div>
          </div>
          <div style={{ padding: "0 16px" }}>
            <div style={css.label}>シナリオ</div>
            {SCENARIOS.map(sc => {
              const locked = sc.minLv > level.lv;
              const done = scStats[sc.id]?.completions || 0;
              return (
                <div key={sc.id} className={locked ? "" : "card"} style={css.scCard(sc.color, locked)} onClick={() => !locked && startScenario(sc)}>
                  <div style={css.scEmoji(locked)}>{locked ? "🔒" : sc.emoji}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, opacity: locked ? .4 : 1 }}>{sc.title}</span>
                      {done > 0 && <span style={css.doneBadge}>✓ {done}×</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(240,230,255,.45)", marginTop: 1 }}>{sc.titleJa} · {sc.desc}</div>
                    <div style={{ display: "flex", gap: 5, marginTop: 6, flexWrap: "wrap" }}>
                      <span style={css.lvBadge(locked)}>Lv {sc.minLv}+</span>
                      {sc.goals.slice(0, 2).map((g, i) => <span key={i} style={css.gChip}>{g}</span>)}
                    </div>
                  </div>
                  {!locked && <span style={{ color: "rgba(255,255,255,.2)", fontSize: 20 }}>›</span>}
                </div>
              );
            })}
          </div>
          <div style={{ padding: "20px 16px 48px" }}>
            <div style={css.label}>レベル進捗</div>
            <div style={css.progressCard}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 900 }}>Lv {level.lv} — {level.titleJa}</div>
                  <div style={{ fontSize: 11, color: "rgba(240,230,255,.4)", marginTop: 2 }}>{xp} / {getNextLv(xp).xpRequired} XP</div>
                </div>
                <div style={{ textAlign: "right", fontSize: 11, color: "rgba(240,230,255,.4)" }}>
                  Next: Lv {getNextLv(xp).lv}<br />{getNextLv(xp).unlock}
                </div>
              </div>
              <div style={css.pBar}><div style={{ ...css.pFill, width: lvPct(xp) + "%" }} /></div>
              <div style={{ display: "flex", gap: 4, marginTop: 12, flexWrap: "wrap" }}>
                {LEVELS.map(l => <div key={l.lv} style={css.lvDot(l.lv <= level.lv)}>{l.lv}</div>)}
              </div>
            </div>
          </div>
        </div>
      )}
      {screen === "chat" && (
        <>
          {scenario && (
            <div style={css.goalsBar}>
              <span style={{ fontSize: 9, color: "rgba(240,230,255,.3)", fontWeight: 700, letterSpacing: 1, flexShrink: 0 }}>目標</span>
              {scenario.goals.map((g, i) => <div key={i} style={css.gPill}>{g}</div>)}
            </div>
          )}
          <div style={css.chatBox}>
            {msgs.map(m => <Bubble key={m.id} msg={m} />)}
            {loading && (
              <div>
                <div style={css.role(true)}>{scenario?.character?.name}</div>
                <div style={{ ...css.bubble(true), display: "flex", gap: 4, alignItems: "center" }}>
                  {[0, .2, .4].map((d, i) => <span key={i} style={{ ...css.dotSm, animationDelay: `${d}s` }} />)}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <div style={css.hints}>
            <span style={{ fontSize: 9, color: "rgba(240,230,255,.3)", flexShrink: 0, alignSelf: "center" }}>Try:</span>
            {scenario?.goals.map((g, i) => (
              <div key={i} style={css.hint} onClick={() => setInput(g)}>{g}</div>
            ))}
          </div>
          <div style={css.inputRow}>
            <textarea style={css.ta} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="日本語または英語で入力…" rows={1} />
            <button style={{ ...css.sendBtn, opacity: loading ? .5 : 1 }} onClick={send} disabled={loading}>➤</button>
          </div>
        </>
      )}
      {screen === "summary" && (
        <div style={css.scroll}>
          <div style={{ padding: "28px 18px 48px" }}>
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ fontSize: 56 }}>🎊</div>
              <div style={{ fontSize: 24, fontWeight: 900, marginTop: 10 }}>会話完了！</div>
            </div>
            <div style={css.sumCard}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#ffd166", marginBottom: 12 }}>📊 セッション結果</div>
              <div style={{ whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.9, color: "rgba(240,230,255,.85)" }}>{summary}</div>
            </div>
            <div style={{ background: "rgba(255,209,102,.12)", border: "1px solid rgba(255,209,102,.2)", borderRadius: 12, padding: 14, textAlign: "center", fontSize: 18, fontWeight: 900, color: "#ffd166", marginTop: 16 }}>+40 XP 獲得！</div>
            <button style={css.primaryBtn} onClick={() => setScreen("home")}>シナリオ選択へ</button>
            <button style={css.ghostBtn} onClick={() => scenario && startScenario(scenario)}>もう一度練習</button>
          </div>
        </div>
      )}
    </div>
  );
          }const css = {
  app: { fontFamily: "'Noto Sans JP','Hiragino Sans',sans-serif", minHeight: "100vh", background: "linear-gradient(160deg,#0f0c29 0%,#1a0533 40%,#0d2137 100%)", color: "#f0e6ff", display: "flex", flexDirection: "column", maxWidth: 480, margin: "0 auto", position: "relative", overflow: "hidden" },
  bg: { position: "fixed", inset: 0, display: "flex", flexWrap: "wrap", gap: 18, padding: 10, opacity: 0.03, fontSize: 42, pointerEvents: "none", zIndex: 0, lineHeight: 1.1, letterSpacing: 5 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 },
  modal: { background: "linear-gradient(160deg,#1e0a3c,#0d1b2a)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 20, padding: 26, width: "100%", maxWidth: 340 },
  planRow: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,.05)", borderRadius: 12, padding: "12px 14px", marginTop: 10 },
  save: { fontSize: 10, background: "rgba(78,205,196,.2)", color: "#4ecdc4", padding: "2px 6px", borderRadius: 6, display: "inline-block", marginTop: 3 },
  header: { background: "rgba(255,255,255,.04)", backdropFilter: "blur(16px)", padding: "12px 14px", display: "flex", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,.07)", zIndex: 10, flexShrink: 0, gap: 6 },
  logo: { fontSize: 19, fontWeight: 900, flexShrink: 0, background: "linear-gradient(90deg,#ff6ec7,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" },
  backBtn: { background: "none", border: "none", color: "#a78bfa", fontSize: 20, padding: "4px 6px", flexShrink: 0 },
  autoBtn: on => ({ background: on ? "rgba(167,139,250,.22)" : "rgba(255,255,255,.06)", border: `1px solid ${on ? "rgba(167,139,250,.4)" : "rgba(255,255,255,.12)"}`, borderRadius: 10, padding: "4px 9px", fontSize: 14, color: "#f0e6ff", transition: "all .2s", flexShrink: 0 }),
  chip: { background: "rgba(255,209,102,.12)", border: "1px solid rgba(255,209,102,.2)", borderRadius: 20, padding: "3px 9px", fontSize: 12, fontWeight: 700, color: "#ffd166", flexShrink: 0 },
  xpWrap: { height: 24, background: "rgba(255,255,255,.04)", position: "relative", flexShrink: 0, borderBottom: "1px solid rgba(255,255,255,.05)", overflow: "hidden" },
  xpFill: { height: "100%", background: "linear-gradient(90deg,#7c3aed,#ec4899,#f97316)", transition: "width .7s ease" },
  xpLabel: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,.5)", pointerEvents: "none" },
  scroll: { flex: 1, overflowY: "auto", zIndex: 1, position: "relative" },
  hero: { textAlign: "center", padding: "24px 18px 16px" },
  heroTitle: { fontSize: 30, fontWeight: 900, lineHeight: 1.18, marginBottom: 8, background: "linear-gradient(135deg,#fff 0%,#c4b5fd 55%,#ff6ec7 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" },
  heroSub: { fontSize: 13, color: "rgba(240,230,255,.5)" },
  pill: { background: "rgba(167,139,250,.12)", border: "1px solid rgba(167,139,250,.22)", borderRadius: 20, padding: "3px 10px", fontSize: 11, color: "#c4b5fd" },
  label: { fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "rgba(240,230,255,.35)", textTransform: "uppercase", marginBottom: 10 },
  scCard: (color, locked) => ({ background: locked ? "rgba(255,255,255,.02)" : `linear-gradient(135deg,${color}18,${color}08)`, border: `1.5px solid ${locked ? "rgba(255,255,255,.05)" : color + "33"}`, borderRadius: 16, padding: "14px 13px", marginBottom: 10, display: "flex", alignItems: "flex-start", gap: 12, transition: "all .2s", cursor: locked ? "default" : "pointer" }),
  scEmoji: locked => ({ fontSize: 24, width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,.07)", borderRadius: 12, flexShrink: 0, opacity: locked ? .35 : 1 }),
  doneBadge: { fontSize: 9, background: "rgba(78,205,196,.18)", color: "#4ecdc4", padding: "2px 6px", borderRadius: 6, fontWeight: 700 },
  lvBadge: locked => ({ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 8, background: locked ? "rgba(255,255,255,.05)" : "rgba(167,139,250,.15)", color: locked ? "rgba(240,230,255,.25)" : "#a78bfa", border: `1px solid ${locked ? "rgba(255,255,255,.07)" : "rgba(167,139,250,.25)"}` }),
  gChip: { fontSize: 9, background: "rgba(255,255,255,.06)", borderRadius: 6, padding: "2px 6px", color: "rgba(240,230,255,.45)" },
  progressCard: { background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 16, padding: 16 },
  pBar: { height: 5, background: "rgba(255,255,255,.08)", borderRadius: 10, overflow: "hidden" },
  pFill: { height: "100%", background: "linear-gradient(90deg,#7c3aed,#ec4899)", borderRadius: 10, transition: "width .7s" },
  lvDot: a => ({ width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, background: a ? "linear-gradient(135deg,#7c3aed,#ec4899)" : "rgba(255,255,255,.07)", color: a ? "#fff" : "rgba(240,230,255,.3)" }),
  goalsBar: { display: "flex", gap: 6, padding: "8px 14px", overflowX: "auto", background: "rgba(255,255,255,.03)", borderBottom: "1px solid rgba(255,255,255,.06)", alignItems: "center", flexShrink: 0 },
  gPill: { fontSize: 10, background: "rgba(167,139,250,.12)", borderRadius: 10, padding: "3px 9px", color: "#c4b5fd", whiteSpace: "nowrap", flexShrink: 0 },
  chatBox: { flex: 1, overflowY: "auto", padding: "16px 14px", display: "flex", flexDirection: "column", gap: 14, zIndex: 1 },
  role: isA => ({ fontSize: 9, fontWeight: 700, color: "rgba(240,230,255,.3)", marginBottom: 3, textAlign: isA ? "left" : "right" }),
  bubble: isA => ({ maxWidth: "76%", background: isA ? "rgba(255,255,255,.07)" : "linear-gradient(135deg,#7c3aed,#a855f7)", border: isA ? "1px solid rgba(255,255,255,.09)" : "none", borderRadius: isA ? "4px 18px 18px 18px" : "18px 4px 18px 18px", padding: "11px 15px", fontSize: 14, lineHeight: 1.7, color: "#f0e6ff", whiteSpace: "pre-wrap", wordBreak: "break-word" }),
  speakBtn: active => ({ width: 34, height: 34, borderRadius: 10, flexShrink: 0, alignSelf: "flex-end", border: `1px solid ${active ? "rgba(167,139,250,.6)" : "rgba(255,255,255,.14)"}`, background: active ? "rgba(167,139,250,.3)" : "rgba(255,255,255,.07)", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", animation: active ? "pulse 1s infinite" : "none", transition: "all .2s" }),
  tip: { background: "rgba(255,209,102,.08)", border: "1px solid rgba(255,209,102,.2)", borderRadius: 12, padding: "8px 13px", fontSize: 12.5, color: "#ffd166", maxWidth: "82%" },
  dotSm: { display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#a78bfa", margin: "0 2px", animation: "bounce 1s infinite" },
  hints: { display: "flex", gap: 6, padding: "6px 14px 8px", overflowX: "auto", alignItems: "center", flexShrink: 0 },
  hint: { background: "rgba(167,139,250,.1)", border: "1px solid rgba(167,139,250,.22)", borderRadius: 20, padding: "5px 11px", fontSize: 11, color: "#c4b5fd", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 },
  inputRow: { padding: "10px 12px", background: "rgba(255,255,255,.03)", borderTop: "1px solid rgba(255,255,255,.07)", display: "flex", gap: 8, alignItems: "flex-end", flexShrink: 0, zIndex: 10 },
  ta: { flex: 1, background: "rgba(255,255,255,.07)", border: "1.5px solid rgba(255,255,255,.1)", borderRadius: 14, padding: "10px 14px", fontSize: 14.5, color: "#f0e6ff", outline: "none", resize: "none", fontFamily: "'Noto Sans JP',sans-serif", lineHeight: 1.4, minHeight: 44, maxHeight: 100 },
  sendBtn: { width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#7c3aed,#a855f7)", border: "none", fontSize: 18, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "white" },
  sumCard: { background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, padding: 20 },
  primaryBtn: { width: "100%", padding: "13px", marginTop: 16, borderRadius: 14, background: "linear-gradient(135deg,#7c3aed,#a855f7)", border: "none", color: "white", fontSize: 15, fontWeight: 700 },
  ghostBtn: { width: "100%", padding: "12px", marginTop: 10, borderRadius: 14, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", color: "rgba(240,230,255,.55)", fontSize: 14 },
};
