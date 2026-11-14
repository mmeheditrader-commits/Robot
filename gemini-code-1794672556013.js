// ==UserScript==
// @name         ZENOVA AI v4.0 - Auto Win/Loss Detector & Auto Trade Bot
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Quotex Balance & History Auto Win/Loss Detection, Martingale & Voice Bot
// @match        *://*.qxbroker.com/*
// @match        *://*.market-qx.info/*
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @connect      api1.api.cbtradersbd.com
// @connect      api.allorigins.win
// ==/UserScript==

(function () {
  if (document.getElementById("zenova-orb-host")) {
    document.getElementById("zenova-orb-host").remove();
  }

  const CB_BASE_URL = "https://api1.api.cbtradersbd.com";
  const CB_AUTH_KEY = "cbt_live_42b4548e986439d8619615dcee9436ee";

  let state = {
    pair: "EURUSD_otc",
    baseInvest: 2,
    currentInvest: 2,
    targetProfit: 10.00,
    totalProfit: 0.00,
    wins: 0,
    losses: 0,
    tradeCount: 0,
    autoMode: false,
    voiceOn: true,
    lastMinuteTraded: -1,
    activeTrade: null // { preBalance, investAmount, openedAt, direction }
  };

  const host = document.createElement("div");
  host.id = "zenova-orb-host";
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, sans-serif; }

      .orb-wrapper {
        position: fixed; top: 34%; right: 14px; width: 114px; height: 114px;
        border-radius: 50%; pointer-events: auto; cursor: grab;
        touch-action: none; user-select: none; display: grid; place-items: center;
        z-index: 99999; filter: drop-shadow(0 6px 20px rgba(0, 0, 0, 0.85));
      }
      .orb-wrapper:active { cursor: grabbing; }

      .orb-ring {
        position: absolute; inset: 0; border-radius: 50%; padding: 3.5px;
        background: conic-gradient(from 0deg, #ff2a5f, #ffd700, #00e676, #00f0ff, #a855f7, #ff2a5f);
        animation: spinRing 3s linear infinite;
        -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
        -webkit-mask-composite: xor; mask-composite: exclude;
      }
      @keyframes spinRing { to { transform: rotate(360deg); } }

      .orb-core {
        width: 105px; height: 105px; border-radius: 50%;
        background: radial-gradient(circle at 30% 25%, #16223b, #060a14 88%);
        display: flex; flex-direction: column; align-items: center;
        justify-content: space-between; padding: 10px 6px 8px; text-align: center;
      }

      .orb-time { font-size: 10.5px; font-weight: 800; color: #cbd5e1; font-family: monospace; }
      .bot-face { font-size: 14px; line-height: 1; }
      .orb-signal {
        font-size: 14.5px; font-weight: 900; color: #00f0ff;
        text-shadow: 0 0 10px rgba(0, 240, 255, 0.7);
      }
      .orb-signal.UP { color: #00e676; text-shadow: 0 0 14px rgba(0, 230, 118, 0.9); }
      .orb-signal.DOWN { color: #ff2a5f; text-shadow: 0 0 14px rgba(255, 42, 95, 0.9); }
      .orb-signal.WIN { color: #ffd700; text-shadow: 0 0 14px rgba(255, 215, 0, 0.95); }
      .orb-invest {
        background: rgba(0, 240, 255, 0.18); border: 1px solid rgba(0, 240, 255, 0.45);
        color: #fff; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 999px;
      }

      .drawer {
        position: fixed; top: calc(34% + 122px); right: 14px; width: 280px;
        background: rgba(8, 13, 26, 0.97); border: 1px solid rgba(0, 240, 255, 0.4);
        border-radius: 16px; padding: 12px; color: #e2e8f0; pointer-events: auto;
        box-shadow: 0 12px 35px rgba(0, 0, 0, 0.9); display: flex; flex-direction: column; gap: 8px;
        z-index: 99998;
      }
      .drawer.hidden { display: none; }

      .d-head {
        display: flex; justify-content: space-between; align-items: center;
        font-size: 11px; font-weight: 800; color: #00f0ff;
        border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px;
      }

      .bal-bar {
        display: flex; justify-content: space-between; font-size: 10px;
        background: rgba(0, 240, 255, 0.08); padding: 5px 8px; border-radius: 7px;
        color: #94a3b8; font-family: monospace;
      }

      .stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; text-align: center; }
      .st-box { background: #0f172a; padding: 5px 2px; border-radius: 8px; border: 1px solid rgba(0,240,255,0.15); }
      .st-box small { display: block; font-size: 8.5px; color: #94a3b8; }
      .st-box strong { font-size: 11px; color: #fff; }

      .sel-pair {
        width: 100%; background: #0f172a; color: #00f0ff; border: 1px solid rgba(0,240,255,0.35);
        padding: 6px 8px; border-radius: 8px; font-size: 11px; font-weight: 700; outline: none;
      }

      .btn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
      .btn {
        border: none; border-radius: 8px; padding: 8px 6px; font-size: 10.5px;
        font-weight: 800; cursor: pointer; transition: 0.2s;
      }
      .btn-auto {
        grid-column: span 2; background: #1e293b; color: #94a3b8; border: 1px solid #475569;
      }
      .btn-auto.active {
        background: linear-gradient(135deg, #00e676, #00b0ff); color: #020617;
        border: none; box-shadow: 0 0 15px rgba(0, 230, 118, 0.5);
      }
      .btn-sig { background: linear-gradient(135deg, #00f0ff, #2979ff); color: #020617; grid-column: span 2; }
      .btn-win { background: rgba(0, 230, 118, 0.18); border: 1px solid #00e676; color: #00e676; }
      .btn-loss { background: rgba(255, 42, 95, 0.18); border: 1px solid #ff2a5f; color: #ff2a5f; }

      .bot-msg {
        font-size: 10.5px; color: #cbd5e1; background: rgba(0, 240, 255, 0.08);
        padding: 7px 8px; border-radius: 8px; line-height: 1.4;
      }
    </style>

    <div class="orb-wrapper" id="orb">
      <div class="orb-ring"></div>
      <div class="orb-core">
        <div class="orb-time" id="orbTime">00:00:00</div>
        <div>
          <div class="bot-face" id="botFace">🤖</div>
          <div class="orb-signal" id="orbSignal">START</div>
        </div>
        <div class="orb-invest" id="orbInvest">2 $</div>
      </div>
    </div>

    <div class="drawer" id="drawer">
      <div class="d-head">
        <span>ZENOVA AUTO TRACKER v4</span>
        <div style="display:flex;gap:8px;">
          <span id="muteToggle" style="cursor:pointer;">🔊</span>
          <span id="closeDrawer" style="cursor:pointer;">✕</span>
        </div>
      </div>

      <div class="bal-bar">
        <span>DETECTED BAL:</span>
        <strong id="detectedBalText" style="color:#00f0ff;">SCANNING...</strong>
      </div>

      <div class="stats-row">
        <div class="st-box"><small>PROFIT</small><strong id="stProfit" style="color:#00e676;">$0.00</strong></div>
        <div class="st-box"><small>WIN/LOSS</small><strong id="stWL">0W / 0L</strong></div>
        <div class="st-box"><small>TO TARGET</small><strong id="stLeft" style="color:#ffd700;">$10.00</strong></div>
      </div>

      <select class="sel-pair" id="pairSel">
        <option value="EURUSD_otc">EURUSD_otc</option>
        <option value="GBPUSD_otc">GBPUSD_otc</option>
        <option value="USDJPY_otc">USDJPY_otc</option>
        <option value="AUDCAD_otc">AUDCAD_otc</option>
        <option value="NZDUSD_otc">NZDUSD_otc</option>
        <option value="BTCUSD_otc">BTCUSD_otc</option>
      </select>

      <div class="btn-grid">
        <button class="btn btn-auto" id="autoToggleBtn">⚪ AUTO SIGNAL &amp; TRADE: OFF</button>
        <button class="btn btn-sig" id="analyzeBtn">⚡ NOW SIGNAL + AUTO TRADE</button>
        <button class="btn btn-win" id="markWinBtn">✓ MANUAL WIN</button>
        <button class="btn btn-loss" id="markLossBtn">✕ MANUAL LOSS</button>
      </div>

      <div class="bot-msg" id="botMsg">ব্যালেন্স এবং ট্রেড হিস্ট্রি অটো-ট্র্যাকিং সক্রিয় আছে।</div>
    </div>
  `;

  const orb = shadow.getElementById("orb");
  const drawer = shadow.getElementById("drawer");
  const orbTime = shadow.getElementById("orbTime");
  const orbSignal = shadow.getElementById("orbSignal");
  const orbInvest = shadow.getElementById("orbInvest");
  const botFace = shadow.getElementById("botFace");
  const botMsg = shadow.getElementById("botMsg");
  const pairSel = shadow.getElementById("pairSel");
  const autoToggleBtn = shadow.getElementById("autoToggleBtn");
  const detectedBalText = shadow.getElementById("detectedBalText");
  const stProfit = shadow.getElementById("stProfit");
  const stWL = shadow.getElementById("stWL");
  const stLeft = shadow.getElementById("stLeft");

  // Unlock Mobile Audio
  function unlockAudio() {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    }
  }
  window.addEventListener("touchstart", unlockAudio, { once: true });
  window.addEventListener("click", unlockAudio, { once: true });

  function speakBengali(text) {
    botMsg.textContent = text;
    if (!state.voiceOn || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "bn-BD";
      u.pitch = 0.92;
      u.rate = 1.03;
      u.onstart = () => (botFace.textContent = "🗣️");
      u.onend = () => (botFace.textContent = "🤖");
      window.speechSynthesis.speak(u);
    } catch (_) {}
  }

  // Draggable Orb
  let dragging = false, moved = false, ox = 0, oy = 0;
  function down(x, y) {
    dragging = true; moved = false;
    const r = orb.getBoundingClientRect();
    ox = x - r.left; oy = y - r.top;
  }
  function move(x, y) {
    if (!dragging) return;
    moved = true;
    orb.style.left = Math.max(6, Math.min(window.innerWidth - 118, x - ox)) + "px";
    orb.style.top = Math.max(6, Math.min(window.innerHeight - 118, y - oy)) + "px";
    orb.style.right = "auto";
  }
  function up() {
    if (dragging && !moved) drawer.classList.toggle("hidden");
    dragging = false;
  }
  orb.addEventListener("mousedown", e => down(e.clientX, e.clientY));
  window.addEventListener("mousemove", e => move(e.clientX, e.clientY));
  window.addEventListener("mouseup", up);
  orb.addEventListener("touchstart", e => down(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  window.addEventListener("touchmove", e => { if (dragging) move(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
  window.addEventListener("touchend", up);

  shadow.getElementById("closeDrawer").addEventListener("click", () => drawer.classList.add("hidden"));
  shadow.getElementById("muteToggle").addEventListener("click", e => {
    state.voiceOn = !state.voiceOn;
    e.target.textContent = state.voiceOn ? "🔊" : "🔇";
  });

  // ========== 1. LIVE QUOTEX BALANCE READER ==========
  function readQuotexBalance() {
    const selectors = [
      ".usermenu__info-balance",
      "[class*='balance']",
      ".header__balance",
      "[data-test='balance']"
    ];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const raw = (el.innerText || "").replace(/,/g, "");
        const match = raw.match(/\$?\s*(\d+\.\d{2})/);
        if (match) {
          const val = parseFloat(match[1]);
          if (!isNaN(val)) return val;
        }
      }
    }
    return null;
  }

  // ========== 2. AUTO-SET QUOTEX INVESTMENT INPUT ==========
  function setQuotexInvestment(amount) {
    const inputSelectors = [
      ".input-control--investment input",
      "[class*='investment'] input",
      "input[type='number']"
    ];
    for (const sel of inputSelectors) {
      const inp = document.querySelector(sel);
      if (inp) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        nativeSetter.call(inp, String(amount));
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  // ========== 3. PROCESS WIN OR LOSS RESULT ==========
  function handleTradeOutcome(isWin, actualProfit = null) {
    if (isWin) {
      const profit = actualProfit !== null ? +actualProfit.toFixed(2) : +(state.currentInvest * 0.82).toFixed(2);
      state.totalProfit = +(state.totalProfit + profit).toFixed(2);
      state.wins++;
      state.currentInvest = state.baseInvest;

      orbSignal.textContent = "WIN ✅";
      orbSignal.className = "orb-signal WIN";
      setQuotexInvestment(state.currentInvest);
      updateStatsUI();

      const left = Math.max(0, state.targetProfit - state.totalProfit).toFixed(2);
      if (state.totalProfit >= state.targetProfit) {
        speakBengali(`আলহামদুলিল্লাহ দাদা! ট্রেড উইন হয়েছে, লাভ ${profit} ডলার। আপনার ${state.targetProfit} ডলার টার্গেট পূর্ণ হয়েছে!`);
      } else {
        speakBengali(`আলহামদুলিল্লাহ দাদা! ট্রেড প্রফিট হয়েছে ${profit} ডলার। এখন পর্যন্ত ${state.wins} উইন, ${state.losses} লস, মোট লাভ ${state.totalProfit} ডলার। টার্গেট পূর্ণ হতে আর ${left} ডলার লাগবে।`);
      }
    } else {
      const lostAmt = state.currentInvest;
      state.totalProfit = +(state.totalProfit - lostAmt).toFixed(2);
      state.losses++;
      // Martingale step: 2$ -> 5$ -> 11$ -> 24$
      state.currentInvest = state.currentInvest === 2 ? 5 : Math.round(state.currentInvest * 2.2);

      orbSignal.textContent = "LOSS ✕";
      orbSignal.className = "orb-signal DOWN";
      setQuotexInvestment(state.currentInvest);
      updateStatsUI();

      speakBengali(`ট্রেডটি লস হয়েছে দাদা। ম্যানেজমেন্ট প্ল্যান অনুযায়ী পরবর্তী ট্রেডে ${state.currentInvest} ডলার সেট করা হয়েছে।`);
    }
  }

  // ========== 4. AUTO-CHECK CLOSED TRADE RESULT ==========
  function checkClosedTradeResult() {
    if (!state.activeTrade) return;

    const elapsedSec = (Date.now() - state.activeTrade.openedAt) / 1000;
    // Wait at least 61 seconds for 1-minute trade to expire
    if (elapsedSec < 61) return;

    const currentBal = readQuotexBalance();
    const { preBalance, investAmount } = state.activeTrade;

    if (currentBal !== null && preBalance !== null) {
      // If balance after expiry is greater than balance before opening trade => WIN!
      if (currentBal > preBalance + 0.05) {
        const netGain = currentBal - preBalance;
        state.activeTrade = null;
        handleTradeOutcome(true, netGain);
        return;
      }
      // If balance after expiry dropped by roughly investAmount => LOSS!
      if (Math.abs((preBalance - currentBal) - investAmount) < 0.25 && elapsedSec >= 63) {
        state.activeTrade = null;
        handleTradeOutcome(false);
        return;
      }
    }

    // Fallback: Check Quotex Trade History Panel top item if balance selector changed
    const historyRows = document.querySelectorAll(".deals-list__item, [class*='trade-history'] [class*='item']");
    if (historyRows.length > 0 && elapsedSec >= 63) {
      const topRowText = (historyRows[0].innerText || "").trim();
      const moneyMatches = topRowText.match(/\$(\d+\.\d{2})/g);
      if (moneyMatches && moneyMatches.length >= 2) {
        const payout = parseFloat(moneyMatches[moneyMatches.length - 1].replace("$", ""));
        state.activeTrade = null;
        if (payout > investAmount) {
          handleTradeOutcome(true, payout - investAmount);
        } else {
          handleTradeOutcome(false);
        }
      }
    }
  }

  // Auto-Detect Pair from Quotex Screen
  function detectQuotexPair() {
    const pairEl = document.querySelector(".current-symbol, .pair-name, [class*='asset-select'] span");
    if (pairEl && pairEl.textContent) {
      const raw = pairEl.textContent.trim().replace("/", "").replace(/\s*\(OTC\)/i, "_otc").replace(/\s+OTC/i, "_otc");
      const matched = [...pairSel.options].find(o => o.value.toLowerCase() === raw.toLowerCase());
      if (matched) {
        pairSel.value = matched.value;
        state.pair = matched.value;
      }
    }
  }

  // Click Real Quotex UP / DOWN Button
  function clickBrokerTradeButton(direction) {
    const upSelectors = ["button.call-btn", ".deal-button--up", "[class*='call-btn']", "button[class*='up']"];
    const downSelectors = ["button.put-btn", ".deal-button--down", "[class*='put-btn']", "button[class*='down']"];
    const list = direction === "UP" ? upSelectors : downSelectors;

    for (const sel of list) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled) {
        btn.click();
        return true;
      }
    }
    const allBtns = Array.from(document.querySelectorAll("button"));
    const words = direction === "UP" ? ["up", "higher", "call"] : ["down", "lower", "put"];
    const found = allBtns.find(b => {
      const t = (b.innerText || "").trim().toLowerCase();
      return words.some(w => t === w || t.startsWith(w + " "));
    });
    if (found && !found.disabled) {
      found.click();
      return true;
    }
    return false;
  }

  function fetchCandles(symbol) {
    const url = `${CB_BASE_URL}/candles?symbol=${encodeURIComponent(symbol)}&timeframe=60`;
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "undefined") {
        GM_xmlhttpRequest({
          method: "GET",
          url: url,
          headers: { "X-BOT-AUTH-KEY": CB_AUTH_KEY },
          onload: res => {
            try { resolve(JSON.parse(res.responseText)); } catch (e) { reject(e); }
          },
          onerror: () => fallbackFetch(url, resolve, reject)
        });
      } else {
        fallbackFetch(url, resolve, reject);
      }
    });
  }

  function fallbackFetch(url, resolve, reject) {
    fetch(url, { headers: { "X-BOT-AUTH-KEY": CB_AUTH_KEY } })
      .then(r => r.json())
      .then(resolve)
      .catch(() => {
        fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url + "&api_key=" + CB_AUTH_KEY)}`)
          .then(r => r.json())
          .then(resolve)
          .catch(reject);
      });
  }

  async function runSignalAndTrade() {
    detectQuotexPair();
    const sym = pairSel.value;
    orbSignal.textContent = "SCAN...";
    orbSignal.className = "orb-signal";

    try {
      const json = await fetchCandles(sym);
      const raw = Array.isArray(json) ? json : (json.data || json.candles || []);
      const candles = raw.map(c => ({
        time: Number(c.timestamp ?? c.time ?? 0),
        open: parseFloat(c.open ?? c.o ?? 0),
        close: parseFloat(c.close ?? c.c ?? 0)
      })).filter(c => c.close > 0);

      if (!candles.length) throw new Error("Empty data");
      if (candles.length > 1 && candles[0].time && candles[1].time) {
        candles.sort((a, b) => a.time - b.time);
      }

      const recent = candles.slice(-10);
      let score = 0;
      recent.forEach((c, i) => {
        score += (c.close >= c.open ? 1 : -1) * (i + 1);
      });

      const dir = score >= 0 ? "UP" : "DOWN";
      state.tradeCount++;

      // Record pre-trade balance & set investment amount before clicking
      const preBalance = readQuotexBalance();
      setQuotexInvestment(state.currentInvest);

      orbSignal.textContent = dir === "UP" ? "UP ⬆️" : "DOWN ⬇️";
      orbSignal.className = `orb-signal ${dir}`;
      orbInvest.textContent = `${state.currentInvest} $`;

      const clicked = clickBrokerTradeButton(dir);
      if (clicked) {
        state.activeTrade = {
          preBalance: preBalance,
          investAmount: state.currentInvest,
          openedAt: Date.now(),
          direction: dir
        };
      }

      speakBengali(`${state.tradeCount} নম্বর ট্রেডে ${state.currentInvest} ডলার। সিগন্যাল ${dir === "UP" ? "আপ অর্থাৎ বাই" : "ডাউন অর্থাৎ সেল"}।`);
    } catch (err) {
      orbSignal.textContent = "RETRY";
      speakBengali("মার্কেট ডাটা লোড হতে সমস্যা হচ্ছে।");
    }
  }

  autoToggleBtn.addEventListener("click", () => {
    state.autoMode = !state.autoMode;
    if (state.autoMode) {
      autoToggleBtn.classList.add("active");
      autoToggleBtn.textContent = "🟢 AUTO SIGNAL & TRADE: ON";
      speakBengali("অটো সিগন্যাল এবং অটো উইন-লস ট্র্যাকিং চালু করা হয়েছে।");
      runSignalAndTrade();
    } else {
      autoToggleBtn.classList.remove("active");
      autoToggleBtn.textContent = "⚪ AUTO SIGNAL & TRADE: OFF";
      speakBengali("অটো ট্রেড বন্ধ করা হয়েছে।");
    }
  });

  shadow.getElementById("analyzeBtn").addEventListener("click", runSignalAndTrade);
  shadow.getElementById("markWinBtn").addEventListener("click", () => handleTradeOutcome(true));
  shadow.getElementById("markLossBtn").addEventListener("click", () => handleTradeOutcome(false));

  function updateStatsUI() {
    stProfit.textContent = `$${state.totalProfit.toFixed(2)}`;
    stProfit.style.color = state.totalProfit >= 0 ? "#00e676" : "#ff2a5f";
    stWL.textContent = `${state.wins}W / ${state.losses}L`;
    const left = Math.max(0, state.targetProfit - state.totalProfit);
    stLeft.textContent = `$${left.toFixed(2)}`;
    orbInvest.textContent = `${state.currentInvest} $`;
  }

  // Main Heartbeat Loop (Clock + Balance Monitor + Auto Trade Trigger)
  setInterval(() => {
    const now = new Date();
    orbTime.textContent = now.toLocaleTimeString("en-GB", { hour12: false });

    // Update live detected balance display
    const bal = readQuotexBalance();
    if (bal !== null) {
      detectedBalText.textContent = `$${bal.toFixed(2)}`;
    }

    // Check if an active 1M trade just finished (WIN or LOSS)
    checkClosedTradeResult();

    // Auto-enter trade at 58s of every minute if no trade is currently open
    const sec = now.getSeconds();
    const min = now.getMinutes();
    if (state.autoMode && !state.activeTrade && sec === 58 && state.lastMinuteTraded !== min) {
      state.lastMinuteTraded = min;
      runSignalAndTrade();
    }
  }, 500);

  updateStatsUI();
})();