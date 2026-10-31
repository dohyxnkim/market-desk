/* 매매 일지 — 로컬 journal.py 와 같은 형식·같은 계산 (매매 기록만 저장하고 포지션·성과는 계산).
 *
 *   { schema: 1, user, account: { capital, risk_pct, max_weight },
 *     trades: [{ id, code, name, side: "buy"|"sell", date: "YYYY-MM-DD", price, qty, fee, memo }],
 *     meta: { 종목코드: { stop, target } } }
 *
 * 저장소는 MDJournal.store 하나 — 지금은 이 브라우저의 localStorage. 로그인 사이트로 바꿀 때는
 * load()/save(doc) 를 같은 모양으로 계정 저장소(예: Firestore 사용자 문서)에 연결하면 된다.
 */
(function () {
  "use strict";
  const SCHEMA = 1;
  const DEFAULT_ACCOUNT = { capital: 10000000, risk_pct: 1.0, max_weight: 25.0 };
  const KEY = "md.journal.v1";
  const num = (v) => (typeof v === "number" ? v : parseFloat(v));
  const ok = (v) => typeof v === "number" && isFinite(v);
  const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Date.now().toString(16) + Math.random().toString(16).slice(2));
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);

  function empty(user = "local") { return { schema: SCHEMA, user, account: { ...DEFAULT_ACCOUNT }, trades: [], meta: {} }; }

  /** 가져온 문서를 현재 형식으로 정리 (journal.normalize 와 같은 규칙) */
  function normalize(doc) {
    const out = empty(String(doc?.user || "local"));
    for (const [k, v] of Object.entries(doc?.account || {})) if (k in DEFAULT_ACCOUNT && ok(num(v))) out.account[k] = num(v);
    for (const t of doc?.trades || []) {
      const price = num(t?.price), qty = num(t?.qty);
      if (!t?.code || !t?.date || !ok(price) || !ok(qty)) continue;
      out.trades.push({ id: String(t.id || uid()), code: String(t.code), name: String(t.name || t.code), side: t.side === "sell" ? "sell" : "buy",
        date: String(t.date).slice(0, 10), price, qty, fee: ok(num(t.fee)) ? num(t.fee) : 0, memo: String(t.memo || "") });
    }
    for (const [code, m] of Object.entries(doc?.meta || {})) {
      if (!m || typeof m !== "object") continue;
      const x = {};
      for (const k of ["stop", "target"]) if (ok(num(m[k]))) x[k] = num(m[k]);
      out.meta[String(code)] = x;
    }
    return out;
  }

  const store = {
    load() { try { const raw = localStorage.getItem(KEY); return raw ? normalize(JSON.parse(raw)) : empty(); } catch { return empty(); } },
    save(doc) { try { localStorage.setItem(KEY, JSON.stringify(normalize(doc))); return true; } catch { return false; } },
  };

  function newTrade(code, name, side, date, price, qty, fee = 0, memo = "") {
    return { id: uid(), code, name, side, date: String(date).slice(0, 10), price: +price, qty: +qty, fee: +fee || 0, memo };
  }

  /** 날짜순(같은 날은 입력 순) 선입선출 — 매수 수수료는 원가에, 매도 수수료는 실현 손익에서 */
  function replay(trades) {
    const order = trades.map((_, i) => i).sort((a, b) => (trades[a].date < trades[b].date ? -1 : trades[a].date > trades[b].date ? 1 : a - b));
    const lots = {}, closed = [];
    for (const i of order) {
      const t = trades[i], q = t.qty;
      if (t.side === "buy") { (lots[t.code] ||= []).push({ qty: q, cost: q ? t.price + t.fee / q : t.price, date: t.date, name: t.name }); continue; }
      const book = lots[t.code] || [];
      let left = q, cost = 0, first = null;
      while (left > 1e-9 && book.length) {
        const lot = book[0], take = Math.min(left, lot.qty);
        cost += take * lot.cost; first = first || lot.date; lot.qty -= take; left -= take;
        if (lot.qty <= 1e-9) book.shift();
      }
      const sold = q - left;
      if (sold <= 0) continue;
      const proceeds = sold * t.price - t.fee * sold / q;
      closed.push({ id: t.id, code: t.code, name: t.name, date: t.date, qty: sold, buy: cost / sold, sell: t.price, pnl: proceeds - cost,
        pnl_pct: cost ? (proceeds / cost - 1) * 100 : null, days: days(first, t.date) });
    }
    for (const k of Object.keys(lots)) if (!lots[k].length) delete lots[k];
    return { lots, closed };
  }

  function positions(doc, prices) {
    const { lots } = replay(doc.trades), cap = doc.account.capital || NaN, out = [];
    for (const [code, book] of Object.entries(lots)) {
      const qty = book.reduce((a, l) => a + l.qty, 0), avg = book.reduce((a, l) => a + l.qty * l.cost, 0) / qty;
      const px = ok(prices[code]) ? prices[code] : NaN, m = doc.meta[code] || {}, stop = m.stop ?? null, target = m.target ?? null;
      const value = qty * px, risk = stop && ok(px) ? qty * Math.max(px - stop, 0) : NaN;
      out.push({ code, name: book[book.length - 1].name, qty, avg, price: px, value, pnl: value - qty * avg, pnl_pct: (px / avg - 1) * 100, stop, target,
        to_stop: stop && ok(px) ? (stop / px - 1) * 100 : NaN, to_target: target && ok(px) ? (target / px - 1) * 100 : NaN,
        risk, risk_pct: risk / cap * 100, weight: value / cap * 100, since: book[0].date, days: days(book[0].date, today()),
        below_stop: !!(stop && ok(px) && px <= stop) });
    }
    return out.sort((a, b) => (ok(b.value) ? b.value : 0) - (ok(a.value) ? a.value : 0));
  }

  function performance(doc) {
    const { closed } = replay(doc.trades);
    const wins = closed.filter((c) => c.pnl > 0), losses = closed.filter((c) => c.pnl <= 0);
    const avg = (xs, k) => (xs.length ? xs.reduce((a, x) => a + x[k], 0) / xs.length : NaN);
    const aw = avg(wins, "pnl_pct"), al = avg(losses, "pnl_pct");
    return { closed, n: closed.length, realized: closed.reduce((a, c) => a + c.pnl, 0), win_rate: closed.length ? wins.length / closed.length * 100 : NaN,
      avg_win: aw, avg_loss: al, payoff: ok(aw) && ok(al) && al ? aw / Math.abs(al) : NaN, expectancy: avg(closed, "pnl_pct"), avg_days: avg(closed, "days") };
  }

  /** 수량 = 투자금 × 허용손실% ÷ (매수가 − 손절가), 종목당 최대 비중을 넘으면 줄임 */
  function positionSize(capital, riskPct, entry, stop, maxWeight = 100) {
    if (!(entry > 0 && stop > 0 && stop < entry && capital > 0)) return { ok: false };
    const per = entry - stop, byRisk = Math.floor(capital * riskPct / 100 / per), byWeight = Math.floor(capital * maxWeight / 100 / entry);
    const qty = Math.max(0, Math.min(byRisk, byWeight));
    return { ok: true, qty, amount: qty * entry, weight: qty * entry / capital * 100, loss: qty * per, loss_pct: qty * per / capital * 100,
      stop_pct: (stop / entry - 1) * 100, capped: byWeight < byRisk };
  }

  window.MDJournal = { SCHEMA, empty, normalize, store, newTrade, replay, positions, performance, positionSize, today };
})();
