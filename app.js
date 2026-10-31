/* Market Desk — 정적 사이트. 데이터는 data/*.json (publish/build.py 가 생성). */
"use strict";

// ---- 색 · 공통 ------------------------------------------------------------------
const C = {
  up: "#e5383b", down: "#1e6fd9", flat: "#8b8f97", ink: "#1f2328", ink2: "#4b5563", muted: "#8b8f97",
  grid: "#eef0f3", axis: "#d5d9e0",
  series: ["#1e6fd9", "#f08c00", "#12a37f", "#7048e8", "#d6336c"],
  ma: { 5: "#f08c00", 20: "#12a37f", 60: "#7048e8", 120: "#495057" },
  inv: { "개인": "#1e6fd9", "외국인": "#f08c00", "기관계": "#12a37f" },
};
const FONT = "Pretendard, system-ui, -apple-system, 'Segoe UI', 'Malgun Gothic', sans-serif";
// 섹터 색: 하락 파랑 · 0 회색 · 상승 빨강
// 트레이딩뷰 히트맵 톤 (0 = 회색, 범위의 27% · 64% · 100% 에서 단계적으로 진해짐) — 방향은 한국식.
// 로컬 views/sector.py 의 SCALE 과 같은 값: [위치(-1~1), 색]
const HEAT = [[-1, "#163f8c"], [-0.64, "#2f6fe8"], [-0.27, "#7aa7f5"], [0, "#c1c4cd"], [0.27, "#f77c80"], [0.64, "#f23645"], [1, "#991f29"]];
const PERIODS = ["1일", "1주", "1개월", "3개월", "6개월", "1년"];
const COLOR_CAP = { "1일": 3, "1주": 6, "1개월": 10, "3개월": 20, "6개월": 30, "1년": 60 };
const INVESTORS = ["개인", "외국인", "기관계", "금융투자", "투신", "연기금", "사모펀드", "보험", "은행", "기타법인"];

const $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}
const isNum = (v) => typeof v === "number" && isFinite(v);
const sgn = (v) => (!isNum(v) || v === 0 ? "flat" : v > 0 ? "up" : "down");
const arrow = (v) => (!isNum(v) || v === 0 ? "–" : v > 0 ? "▲" : "▼");
const fmt = (v, d = 0) => (isNum(v) ? v.toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
const pct = (v, d = 2) => (isNum(v) ? (v > 0 ? "+" : "") + v.toFixed(d) + "%" : "–");
const signed = (v, d = 0) => (isNum(v) ? (v > 0 ? "+" : "") + fmt(v, d) : "–");
const eok = (v) => (!isNum(v) ? "–" : Math.abs(v) >= 1e4 ? (v > 0 ? "+" : "") + (v / 1e4).toFixed(2) + "조" : signed(v) + "억");
const jo = (won) => (isNum(won) ? fmt(won / 1e12, 2) : "–");
const eokWon = (won) => (isNum(won) ? fmt(won / 1e8) : "–");
const ymd = (s) => (s && s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s || "");

// ---- 데이터 ---------------------------------------------------------------------
let META = null;
const cache = {};
async function get(name) {
  if (!cache[name]) {
    const ver = META ? encodeURIComponent(META.generated) : Date.now();
    cache[name] = fetch(`data/${name}?v=${ver}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((d) => (name === "stocks.json" ? applyRS(d) : d));
  }
  return cache[name];
}
// RS 기간 (1·3·6개월). stocks.json 에 세 기간 값(RS_21 · RS_63 · RS_126 …)이 다 있고, 고른 기간을 RS 열로 쓴다.
const RS_PERIODS = [["21", "1개월"], ["63", "3개월"], ["126", "6개월"]];
const rsPeriod = () => { const p = UI.get("rs.p", "63"); return RS_PERIODS.some((x) => x[0] === p) ? p : "63"; };
const rsLabel = () => RS_PERIODS.find((x) => x[0] === rsPeriod())[1];
function applyRS(rows) {
  const n = rsPeriod();
  for (const r of rows || []) {
    if (!(`RS_${n}` in r)) continue;
    r.RS = r[`RS_${n}`]; r["1주전 RS"] = r[`RS1w_${n}`]; r["4주전 RS"] = r[`RS4w_${n}`];
    r["RS변화1주"] = isNum(r.RS) && isNum(r["1주전 RS"]) ? r.RS - r["1주전 RS"] : null;
  }
  return rows;
}
function setRSPeriod(p) { UI.set("rs.p", p); (cache["stocks.json"] || Promise.resolve(null)).then(applyRS).then(route); }

const chartCache = {};
/** 종목 차트 자료. long=true 면 과거 파일(작년 1월 1일 이전, 최대 5년)까지 이어 붙인다.
 *  과거 파일은 그 구간 마지막 날 기준 수정주가라 최근 파일의 k 로 맞춘다 (가격 × k, 거래량 ÷ k). */
async function getChart(code, long = false) {
  const key = code + (long ? ":long" : "");
  if (!chartCache[key]) {
    chartCache[key] = (async () => {
      const recent = await fetch(`data/charts/${code}.json?v=${META ? META.krx_dd : ""}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!recent || !long || !recent.arch) return recent;
      const old = await fetch(`data/charts_arch/${code}.json?v=${META ? META.arch : ""}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!old) return recent;
      const k = recent.k || 1, pad = Array(old.d.length).fill(null), px = (a) => a.map((x) => (x == null ? null : +(x * k).toFixed(2)));
      const out = { ...recent, d: old.d.concat(recent.d), o: px(old.o).concat(recent.o), h: px(old.h).concat(recent.h), l: px(old.l).concat(recent.l),
        c: px(old.c).concat(recent.c), v: old.v.map((x) => (x == null ? null : Math.round(x / k))).concat(recent.v), a: old.a.concat(recent.a) };
      for (const n of ["21", "63", "126"]) out[`rs${n}`] = recent[`rs${n}`]?.length ? pad.concat(recent[`rs${n}`]) : [];
      return out;
    })();
  }
  return chartCache[key];
}
async function stockMap() {
  const [stocks, snap, etfs] = await Promise.all([get("stocks.json"), get("snapshot.json"), get("etfs.json")]);
  const m = new Map();
  for (const e of etfs || []) m.set(e["종목코드"], { code: e["종목코드"], ...e, 시장: "ETF" });
  for (const s of snap || []) m.set(s["종목코드"], { code: s["종목코드"], ...s });
  for (const s of stocks || []) m.set(s.code, { ...(m.get(s.code) || {}), ...s, code: s.code });
  return m;
}

// ---- 관심종목 (이 브라우저에만 저장) -----------------------------------------------------
const WL = {
  key: "md.watchlist",
  all() { try { return JSON.parse(localStorage.getItem(this.key) || "[]"); } catch { return []; } },
  save(a) { try { localStorage.setItem(this.key, JSON.stringify(a)); } catch { /* 저장 불가 환경 */ } },
  has(code) { return this.all().some((x) => x.code === code); },
  toggle(code, name, price) {
    const a = this.all();
    const i = a.findIndex((x) => x.code === code);
    if (i >= 0) a.splice(i, 1); else a.push({ code, name, price, added: new Date().toISOString().slice(0, 10) });
    this.save(a);
    return i < 0;
  },
};
const UI = { get(k, d) { try { return JSON.parse(sessionStorage.getItem("md." + k)) ?? d; } catch { return d; } },
             set(k, v) { try { sessionStorage.setItem("md." + k, JSON.stringify(v)); } catch { /* */ } } };

// ---- 차트 -----------------------------------------------------------------------
let charts = [];
function disposeCharts() { charts.forEach((c) => c.dispose()); charts = []; }
window.addEventListener("resize", () => charts.forEach((c) => c.resize()));
function chart(el, option, height) {
  el.style.height = height + "px";
  const c = echarts.init(el, null, { renderer: "canvas" });
  c.setOption({
    textStyle: { fontFamily: FONT, color: C.ink },
    animation: false,
    tooltip: { trigger: "axis", backgroundColor: "rgba(255,255,255,.97)", borderColor: "#e3e5e8", borderRadius: 8, padding: [8, 11],
               extraCssText: "box-shadow:0 6px 18px rgba(15,23,41,.10);", textStyle: { color: C.ink, fontSize: 12 },
               axisPointer: { type: "line", lineStyle: { color: "#9aa0a6", type: "dashed" } } },
    ...option,
  });
  charts.push(c);
  return c;
}
const axisX = (extra = {}) => ({ type: "category", boundaryGap: false, axisLine: { lineStyle: { color: C.axis } },
  axisTick: { show: false }, axisLabel: { color: C.muted, fontSize: 11.5, hideOverlap: true }, ...extra });
const axisY = (extra = {}) => ({ type: "value", scale: true, position: "right", splitLine: { lineStyle: { color: C.grid, type: [2, 3] } },
  axisLabel: { color: C.muted, fontSize: 11.5 }, ...extra });
const alpha = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
/** 선 아래 옅은 그라데이션 면 */
const areaFill = (color) => ({ origin: "start", color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: alpha(color, 0.18) }, { offset: 1, color: alpha(color, 0) }]) });
/** 값 축 범위를 자료 최저·최고에 딱 맞춤 (여백 4%) */
const tightMin = (r) => +(r.min - (r.max - r.min) * 0.04).toPrecision(6);
const tightMax = (r) => +(r.max + (r.max - r.min) * 0.04).toPrecision(6);
const shortDate = (d) => (d.length >= 10 ? d.slice(2, 7).replace("-", ".") : d);
/** 날짜 범주축 눈금: 기간이 짧으면 주 단위(월/일), 길면 달이 바뀌는 첫 거래일에만 (yy.mm) */
function dateTicks(dates) {
  const span = dates.length > 1 ? (new Date(dates[dates.length - 1].slice(0, 10)) - new Date(dates[0].slice(0, 10))) / 864e5 : 0;
  const key = (d) => (span <= 100 ? Math.floor(new Date(d.slice(0, 10)) / (7 * 864e5)) : d.slice(0, 7));
  const every = span > 800 ? 3 : 1;  // 3년이면 분기마다
  let shown = 0;
  const marks = dates.map((d, i) => i > 0 && key(d) !== key(dates[i - 1]) && (span > 800 ? shown++ % every === 0 : true));
  return { interval: (i) => marks[i], formatter: (d) => (span <= 100 ? d.slice(5, 10).replace("-", "/") : shortDate(d)), hideOverlap: true };
}

/** 날짜 선 그래프. 선이 하나면 아래에 그라데이션 면. left=true 면 축을 왼쪽에 두고 끝값 라벨·오른쪽 여백 없이 꽉 차게. */
function lineChart(el, seriesMap, { height = 300, unit = "", digits = 2, colors = {}, zero = false, ref = null, left = false, area = null } = {}) {
  const names = Object.keys(seriesMap);
  const dates = names.length === 1 ? seriesMap[names[0]].d : [...new Set(names.flatMap((n) => seriesMap[n].d))].sort();
  const align = (s) => { if (names.length === 1) return s.v; const m = new Map(s.d.map((d, i) => [d, s.v[i]])); return dates.map((d) => (m.has(d) ? m.get(d) : null)); };
  const fill = area ?? names.length === 1;
  const series = names.map((n, i) => {
    const color = colors[n] || C.series[i % C.series.length];
    return {
      name: n, type: "line", showSymbol: false, connectNulls: true, data: align(seriesMap[n]), lineStyle: { width: 2 }, color,
      areaStyle: fill ? areaFill(color) : undefined,
      endLabel: left ? undefined : { show: true, formatter: (p) => fmt(p.value, digits) + unit, color: "#fff", backgroundColor: color, padding: [2, 5], borderRadius: 3, fontSize: 11 },
      markLine: i === 0 && (zero || ref != null) ? { silent: true, symbol: "none", label: { show: ref != null && !left, formatter: ref != null ? `${ref}${unit}` : "", color: C.ink2 },
                                                    lineStyle: { color: zero ? C.axis : C.muted, type: zero ? "solid" : "dotted" }, data: [{ yAxis: zero ? 0 : ref }] } : undefined,
    };
  });
  const yLabel = { color: C.muted, fontSize: 11.5, formatter: (v) => (+v.toFixed(4)).toLocaleString("ko-KR", { maximumFractionDigits: 4 }) + unit };
  return chart(el, {
    grid: left ? { left: 4, right: 10, top: names.length > 1 ? 30 : 8, bottom: 4, containLabel: true }
               : { left: 8, right: 76, top: names.length > 1 ? 32 : 14, bottom: 24 },
    legend: names.length > 1 ? { top: 0, left: 0, icon: "roundRect", itemWidth: 14, itemHeight: 4, textStyle: { color: C.ink2 } } : undefined,
    xAxis: axisX({ data: dates, axisLabel: { color: C.muted, fontSize: 11.5, ...dateTicks(dates) } }),
    yAxis: axisY({ position: left ? "left" : "right", axisLabel: { ...yLabel, showMinLabel: !left, showMaxLabel: !left }, ...(left ? { min: tightMin, max: tightMax } : {}) }),
    tooltip: { trigger: "axis", valueFormatter: (v) => fmt(v, digits) + unit },
    series,
  }, height);
}

/** 장중 시간 축 선 그래프. curve = { day: "YYYYMMDD"?, t: ["09:01", …], 이름: [값, …] } · 15:30 장 마감 점선. */
function intradayChart(el, curve, names, { day, height = 300, colors = {}, unit = "억" } = {}) {
  const d = ymd(day);
  const ts = curve.t.map((t) => new Date(`${d}T${t}:00`).getTime());
  const start = new Date(`${d}T09:00:00`).getTime(), close = new Date(`${d}T15:30:00`).getTime();
  const end = Math.max(ts[ts.length - 1], close);
  const series = names.map((n, i) => ({
    name: n, type: "line", showSymbol: false, data: ts.map((t, j) => [t, curve[n][j]]), lineStyle: { width: 2 },
    color: colors[n] || C.series[i % C.series.length],
    endLabel: { show: true, formatter: (p) => eok(p.value[1]), color: "#fff", backgroundColor: colors[n] || C.series[i % C.series.length], padding: [2, 5], borderRadius: 3, fontSize: 11 },
    markLine: i === 0 ? { silent: true, symbol: "none", label: { show: false },
      data: [{ yAxis: 0, lineStyle: { color: C.axis, type: "solid" } }, ...(ts[ts.length - 1] > close ? [{ xAxis: close, lineStyle: { color: C.muted, type: "dotted" }, label: { show: true, formatter: "장 마감", position: "insideEndTop", color: C.muted, fontSize: 11 } }] : [])] } : undefined,
  }));
  const hm = (v) => { const x = new Date(v); return `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`; };
  return chart(el, {
    grid: { left: 8, right: 76, top: 32, bottom: 24 },
    legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 14, itemHeight: 4, textStyle: { color: C.ink2 } },
    xAxis: { type: "time", min: start, max: end, interval: 3600e3, axisLine: { lineStyle: { color: C.axis } }, axisTick: { show: false }, splitLine: { show: false },
             axisLabel: { color: C.muted, fontSize: 11.5, formatter: hm, hideOverlap: true } },
    yAxis: axisY({ scale: false, axisLabel: { color: C.muted, fontSize: 11.5, formatter: (v) => fmt(v) + unit } }),
    tooltip: { trigger: "axis", formatter: (ps) => `${hm(ps[0].value[0])}<br>` + ps.map((p) => `${p.marker}${p.seriesName} <b>${eok(p.value[1])}</b>`).join("<br>") },
    series,
  }, height);
}

function divergeColor(v, cap) {
  if (!isNum(v)) return "#c1c4cd";
  const t = Math.max(-1, Math.min(1, v / cap));
  const i = Math.max(0, HEAT.findIndex((s) => s[0] >= t) - 1), [p0, a] = HEAT[i], [p1, b] = HEAT[i + 1], f = (t - p0) / (p1 - p0);
  const mix = (p) => Math.round(parseInt(a.substr(p, 2), 16) * (1 - f) + parseInt(b.substr(p, 2), 16) * f);
  return `rgb(${mix(1)},${mix(3)},${mix(5)})`;
}
const textOn = () => "#fff";  // 트레이딩뷰처럼 칸 글자는 늘 흰색

// ---- UI 조각 --------------------------------------------------------------------
function card(title, sub, src) {
  const body = h("div");
  const el = h("section", { class: "card" }, title ? h("div", { class: "card-h" }, h("span", { class: "t" }, title), sub ? h("span", { class: "s" }, sub) : null) : null, body,
    src ? h("div", { class: "src" }, src) : null);
  return { el, body };
}
function kpi(label, value, { delta = null, dtext = "", sub = "", tone = null, small = false } = {}) {
  const v = h("div", { class: "v" + (small ? " sm" : "") + (tone != null ? " " + sgn(tone) : "") }, value);
  return h("div", { class: "kpi" }, h("div", { class: "k" }, label), v,
    h("div", { class: "d " + sgn(delta) }, delta == null ? "" : `${arrow(delta)} ${dtext}`), h("div", { class: "s" }, sub));
}
function seg(options, value, onChange) {
  const el = h("div", { class: "seg" });
  for (const o of options) {
    const [val, label] = Array.isArray(o) ? o : [o, o];
    el.append(h("button", { class: val === value ? "on" : "", onclick: () => onChange(val) }, label));
  }
  return el;
}
function chips(options, selected, onChange) {
  const el = h("div", { class: "chips" });
  for (const o of options) {
    const [val, label] = Array.isArray(o) ? o : [o, o];
    el.append(h("button", { class: "chip" + (selected.includes(val) ? " on" : ""),
      onclick: () => onChange(selected.includes(val) ? selected.filter((x) => x !== val) : [...selected, val]) }, label));
  }
  return el;
}
const ctl = (label, el) => h("div", { class: "ctl" }, h("span", { class: "lbl" }, label), el);
const ph = (title, sub) => h("div", { class: "ph" }, h("h1", {}, title), h("div", { class: "sub" }, sub));
const basisLabel = () => (META ? `${ymd(META.bas_dd)} · ${META.live ? META.basis : "KRX 공식 종가"} · ${META.generated} 업데이트` : "");

/** 정렬되는 표. cols: {k, t, f(row), cls(row), l(왼쪽 정렬), v(row)=정렬값} */
function table(rows, cols, { sortKey = null, desc = true, onRow = null, star = false, limit = 300, maxH = 620, hint = null } = {}) {
  const wrap = h("div");
  let key = sortKey, dir = desc;
  const draw = () => {
    wrap.innerHTML = "";
    const val = (r, c) => (c.v ? c.v(r) : r[c.k]);
    const sorted = key ? [...rows].sort((a, b) => {
      const c = cols.find((x) => x.k === key), x = val(a, c), y = val(b, c);
      if (x == null) return 1; if (y == null) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * (dir ? -1 : 1);
    }) : rows;
    // 첫 칸(종목 이름)과 ★ 칸은 가로 스크롤 때 왼쪽에 고정 (style.css .pin)
    const pinCls = (i) => (i === 0 ? ` pin edge ${star ? "pin1" : "pin0"}` : "");
    const thead = h("tr", {}, star ? h("th", { class: "l pin pin0 starcol", style: { cursor: "default" } }, "") : null,
      cols.map((c, i) => h("th", { class: (c.l ? "l" : "") + pinCls(i), onclick: () => { if (key === c.k) dir = !dir; else { key = c.k; dir = !c.l; } draw(); } },
        c.t, key === c.k ? h("span", { class: "arrow" }, dir ? "▼" : "▲") : null)));
    const body = sorted.slice(0, limit).map((r) => {
      const tr = h("tr", { class: onRow ? "click" : "", onclick: onRow ? () => onRow(r) : null });
      if (star) {
        const on = WL.has(r.code);
        tr.append(h("td", { class: "l pin pin0 starcol" }, h("button", { class: "star" + (on ? " on" : ""), title: on ? "관심종목에서 빼기" : "관심종목에 추가",
          onclick: (e) => { e.stopPropagation(); const added = WL.toggle(r.code, r["종목명"], r["종가"]); e.target.classList.toggle("on", added); toast(added ? `${r["종목명"]} 관심종목 추가` : `${r["종목명"]} 관심종목에서 뺌`); } }, "★")));
      }
      for (const [i, c] of cols.entries()) {
        const td = h("td", { class: (c.l ? "l " : "") + (c.cls ? c.cls(r) : "") + pinCls(i) });
        const out = c.f ? c.f(r) : r[c.k];
        td.append(out?.nodeType ? out : document.createTextNode(out ?? "–"));
        tr.append(td);
      }
      return tr;
    });
    wrap.append(h("div", { class: "tbl-wrap", style: { maxHeight: maxH + "px" } }, h("table", { class: "tbl" }, h("thead", {}, thead), h("tbody", {}, body))));
    wrap.append(h("div", { class: "tbl-foot" }, h("span", {}, rows.length > limit ? `상위 ${limit}개 표시 / 전체 ${fmt(rows.length)}개` : `${fmt(rows.length)}개`),
      h("span", {}, hint ?? (onRow ? "행을 누르면 종목 분석 · ★ 관심종목" : ""))));
  };
  draw();
  return wrap;
}
const nameCol = { k: "종목명", t: "종목", l: true, f: (r) => h("span", {}, h("span", { class: "name" }, r["종목명"] || r.name), h("span", { class: "code" }, r.code || r["종목코드"])) };
const pctCol = (k, t = k, d = 1) => ({ k, t, f: (r) => pct(r[k], d), cls: (r) => sgn(r[k]) });
const rsCol = { k: "RS", t: "RS", f: (r) => (isNum(r.RS) ? h("span", {}, h("span", { class: "bar" }, h("i", { style: { width: r.RS + "%" } })), String(r.RS)) : "–") };
const openStock = (r) => { location.hash = `#stock/${r.code || r["종목코드"]}`; };

let toastTimer;
function toast(msg) {
  let el = $("#toast");
  if (!el) { el = h("div", { id: "toast", style: { position: "fixed", bottom: "22px", left: "50%", transform: "translateX(-50%)", background: "#0f1729",
    color: "#fff", padding: "9px 16px", borderRadius: "10px", fontSize: "13px", zIndex: 50, boxShadow: "0 4px 14px rgba(0,0,0,.18)" } }); document.body.append(el); }
  el.textContent = msg; el.style.display = "block";
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.style.display = "none"), 2200);
}

// ---- 섹터 계산 (시총 가중) ---------------------------------------------------------
function sectorAgg(stocks, period, market, order) {
  const groups = new Map();
  for (const s of stocks) {
    if (!s["중분류"] || (market !== "전체" && s["시장"] !== market)) continue;
    if (!groups.has(s["중분류"])) groups.set(s["중분류"], []);
    groups.get(s["중분류"]).push(s);
  }
  const out = [];
  for (const [name, g] of groups) {
    const row = { 중분류: name, 대분류: g[0]["대분류"], 종목수: g.length, 시가총액: g.reduce((a, s) => a + (s["시가총액"] || 0), 0), members: g };
    for (const p of PERIODS) {
      let end = 0, start = 0;
      for (const s of g) if (isNum(s[p]) && isNum(s["시가총액"])) { end += s["시가총액"]; start += s["시가총액"] / (1 + s[p] / 100); }
      row[p] = start > 0 ? (end / start - 1) * 100 : null;
    }
    row["상승비율"] = g.filter((s) => isNum(s["1일"]) && s["1일"] > 0).length / g.length * 100;
    out.push(row);
  }
  const idx = new Map(order.map((n, i) => [n, i]));
  return out.sort((a, b) => (idx.get(a["중분류"]) ?? 99) - (idx.get(b["중분류"]) ?? 99));
}

// =================================================================================
// 페이지
// =================================================================================
async function renderMarket(v) {
  const [market, sector, stocks, snap] = await Promise.all([get("market.json"), get("sector.json"), get("stocks.json"), get("snapshot.json")]);
  v.append(ph("시장 개요", basisLabel()));
  const period = UI.get("mk.period", "6개월");
  const days = { "1개월": 31, "3개월": 92, "6개월": 183, "1년": 366, "3년": 1100 }[period];
  v.append(h("div", { class: "stack" }, seg(["1개월", "3개월", "6개월", "1년", "3년"], period, (p) => { UI.set("mk.period", p); route(); })));
  const g = h("div", { class: "grid g2 stack" });
  for (const [key, label] of [["KOSPI", "코스피"], ["KOSDAQ", "코스닥"]]) {
    const s = market?.index?.[key];
    if (!s || !s.d.length) continue;
    const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const i0 = s.d.findIndex((d) => d >= cutoff);
    const d = s.d.slice(i0), val = s.v.slice(i0);
    const chg = (val[val.length - 1] / val[0] - 1) * 100;
    const c = card(label, `${period} ${pct(chg, 1)}`, "출처 한국은행 ECOS" + (META?.live ? " · 오늘은 키움 실시간" : ""));
    g.append(c.el);
    requestAnimationFrame(() => lineChart(c.body.appendChild(h("div", { class: "chart" })), { [label]: { d, v: val } }, { height: 290, colors: { [label]: C.series[0] } }));
  }
  v.append(g);

  // 상승·하락
  const b = market?.breadth || {};
  const c1 = card("상승·하락 종목 수", "거래가 있었던 종목 기준", `출처 ${META?.live ? "키움 실시간 (KRX)" : "KRX"} · ${basisLabel()}`);
  v.append(c1.el);
  const mk = ["KOSPI", "KOSDAQ"].filter((m) => b[m]);
  const tot = (m) => b[m]["상승"] + b[m]["보합"] + b[m]["하락"];
  const bar = (k, color) => ({ name: k, type: "bar", stack: "a", barWidth: 30, itemStyle: { color, borderColor: "#fff", borderWidth: 2 },
    label: { show: true, color: "#fff", fontSize: 13, formatter: (p) => (b[p.name][k] / tot(p.name) > 0.07 ? `${k} ${fmt(b[p.name][k])}` : "") },
    data: mk.map((m) => b[m][k]) });
  chart(c1.body.appendChild(h("div", { class: "chart" })), {
    grid: { left: 70, right: 16, top: 26, bottom: 6 }, legend: { top: 0, left: 0, textStyle: { color: C.ink2 } },
    tooltip: { trigger: "item", formatter: (p) => `${p.name} ${p.seriesName} ${fmt(p.value)}종목 (${(p.value / tot(p.name) * 100).toFixed(1)}%)` },
    xAxis: { type: "value", show: false }, yAxis: { type: "category", data: mk, inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: C.ink, fontSize: 13 } },
    series: [bar("상승", C.up), bar("보합", C.flat), bar("하락", C.down)],
  }, 130);

  renderHealth(v, market);

  // 섹터 등락
  const order = (sector?.rows || []).map((r) => r["중분류"]);
  const sec = sectorAgg(stocks || [], "1일", "전체", order).sort((a, b) => (b["1일"] ?? -99) - (a["1일"] ?? -99));
  const c2 = card("섹터 등락", "1일 · WICS 중분류 27개 · 시가총액 가중", "자세히는 섹터 메뉴에서");
  v.append(c2.el);
  if (window.innerWidth < 900) {  // 좁은 화면: 이름이 겹치지 않게 가로 막대
    const asc = sec.slice().reverse();
    chart(c2.body.appendChild(h("div", { class: "chart" })), {
      grid: { left: 4, right: 46, top: 4, bottom: 4, containLabel: true }, tooltip: { trigger: "item", formatter: (p) => `${p.name}: ${pct(p.value)}` },
      xAxis: { type: "value", show: false }, yAxis: { type: "category", data: asc.map((s) => s["중분류"]), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: C.ink, fontSize: 11.5 } },
      series: [{ type: "bar", data: asc.map((s) => ({ value: s["1일"] == null ? null : +s["1일"].toFixed(2), itemStyle: { color: s["1일"] >= 0 ? C.up : C.down, borderRadius: 3 } })),
                 label: { show: true, position: "right", formatter: (p) => pct(p.value, 1), color: C.ink2, fontSize: 10.5 } }],
    }, 22 * asc.length + 16);
  } else chart(c2.body.appendChild(h("div", { class: "chart" })), {
    grid: { left: 8, right: 8, top: 20, bottom: 8, containLabel: true }, tooltip: { trigger: "item", formatter: (p) => `${p.name}: ${pct(p.value)}` },
    xAxis: { type: "category", data: sec.map((s) => s["중분류"]), axisLabel: { rotate: 40, color: C.ink, fontSize: 11.5, interval: 0 }, axisTick: { show: false }, axisLine: { lineStyle: { color: C.axis } } },
    yAxis: { type: "value", axisLabel: { formatter: (x) => x + "%", color: C.ink2 }, splitLine: { lineStyle: { color: C.grid } } },
    series: [{ type: "bar", data: sec.map((s) => ({ value: s["1일"] == null ? null : +s["1일"].toFixed(2), itemStyle: { color: s["1일"] >= 0 ? C.up : C.down, borderRadius: 3 } })),
               label: { show: true, position: "top", formatter: (p) => (p.value > 0 ? "+" : "") + p.value.toFixed(1), color: C.ink2, fontSize: 10.5 } }],
  }, 330);

  // 섹터·테마 ETF
  const etf = await get("etf.json");
  if (etf?.length) {
    const ce = card("섹터·테마 ETF 등락률", `대표 ETF ${etf.length}종`, `출처 KRX ETF 일별 시세${META?.live ? " · 오늘은 키움 실시간" : ""} · ${basisLabel()} · 기간 등락률은 종가 기준 (분배금 미반영)`);
    v.append(ce.el);
    const EP = ["1일", "1주", "1개월", "3개월", "6개월"];
    const ep = EP.includes(UI.get("mk.etf", "1일")) ? UI.get("mk.etf", "1일") : "1일";
    ce.body.append(h("div", { class: "controls stack" }, ctl("기간", seg(EP, ep, (x) => { UI.set("mk.etf", x); route(); }))));
    const grid = h("div", { class: "grid g-2-3" });
    const chartBox = h("div", { class: "chart" });
    grid.append(chartBox, table(etf, [{ k: "테마", t: "테마", l: true }, { k: "종목명", t: "종목명", l: true, f: (r) => h("span", {}, h("span", { class: "name" }, r["종목명"]), h("span", { class: "code" }, r["종목코드"])) },
      { k: "현재가", t: META?.live ? "현재가" : "종가", f: (r) => fmt(r["현재가"]) }, ...EP.map((k) => pctCol(k, k, 2)),
      { k: "거래대금", t: "거래대금(억)", f: (r) => eokWon(r["거래대금"]) }], { sortKey: ep, maxH: 900, limit: 100 }));
    ce.body.append(grid);
    const asc = etf.filter((r) => isNum(r[ep])).sort((a, b) => a[ep] - b[ep]);
    requestAnimationFrame(() => chart(chartBox, {
      grid: { left: 4, right: 58, top: 4, bottom: 4, containLabel: true }, tooltip: { trigger: "item", formatter: (p) => `${p.name} · ${asc[p.dataIndex]["종목명"]}: ${pct(p.value)}` },
      xAxis: { type: "value", show: false }, yAxis: { type: "category", data: asc.map((r) => r["테마"]), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: C.ink, fontSize: 12 } },
      series: [{ type: "bar", data: asc.map((r) => ({ value: +r[ep].toFixed(2), itemStyle: { color: r[ep] >= 0 ? C.up : C.down, borderRadius: 3 } })),
                 label: { show: true, position: "right", formatter: (p) => pct(p.value), color: C.ink2, fontSize: 11 } }],
    }, 26 * asc.length + 16));
  }

  // 종목 순위
  const c3 = card("종목 순위", "", `출처 ${META?.live ? "키움 실시간 (KRX)" : "KRX"} · 행을 누르면 종목 분석, ★ 로 관심종목 추가`);
  v.append(c3.el);
  const st = { m: UI.get("mk.m", "전체"), kind: UI.get("mk.kind", "거래대금"), minv: UI.get("mk.minv", 10) };
  const box = h("div");
  const draw = () => {
    box.innerHTML = "";
    const [k, desc] = { "상승률": ["등락률", true], "하락률": ["등락률", false], "거래대금": ["거래대금", true], "시가총액": ["시가총액", true] }[st.kind];
    let rows = (snap || []).filter((r) => r["거래량"] > 0 && (st.m === "전체" || r["시장"] === st.m) && r["거래대금"] >= st.minv * 1e8)
      .map((r) => ({ ...r, code: r["종목코드"] }));
    rows.sort((a, b) => (desc ? b[k] - a[k] : a[k] - b[k]));
    rows = rows.slice(0, 30);
    box.append(h("div", { class: "controls stack" },
      ctl("시장", seg(["전체", "KOSPI", "KOSDAQ"], st.m, (x) => { st.m = x; UI.set("mk.m", x); draw(); })),
      ctl("순위", seg(["상승률", "하락률", "거래대금", "시가총액"], st.kind, (x) => { st.kind = x; UI.set("mk.kind", x); draw(); })),
      ctl("최소 거래대금", seg([[0, "제한 없음"], [10, "10억"], [100, "100억"]], st.minv, (x) => { st.minv = x; UI.set("mk.minv", x); draw(); }))));
    box.append(table(rows, [nameCol, { k: "시장", t: "시장", l: true }, { k: "종가", t: META?.live ? "현재가" : "종가", f: (r) => fmt(r["종가"]) },
      pctCol("등락률", "등락률", 2), { k: "거래대금", t: "거래대금(억)", f: (r) => eokWon(r["거래대금"]) }, { k: "시가총액", t: "시총(조)", f: (r) => jo(r["시가총액"]) }],
      { onRow: openStock, star: true, maxH: 560 }));
  };
  draw();
  c3.body.append(box);
}

/** 시장 체력 — 이평선 위 종목 비율 · 52주 신고가/신저가 · 등락 누적선 (보통주 전 종목, 로컬 views/market.py 와 같은 계산) */
function renderHealth(v, market) {
  const H = market?.health;
  if (!H?.["전체"]?.d?.length) return;
  const m = ["전체", "KOSPI", "KOSDAQ"].includes(UI.get("mk.hm", "전체")) ? UI.get("mk.hm", "전체") : "전체";
  const s = H[m], L = s.d.length - 1, P = Math.max(0, L - 5);
  const label = (x) => (x >= 60 ? "강세" : x < 40 ? "약세" : "중립");
  const c = card("시장 체력", "보통주 전 종목 기준 · 지수가 아니라 종목 대다수가 어떤 상태인지",
    `출처 KRX (수정주가 계산) · ${basisLabel()} · 체력 점수 = 20·50·200일선 위 종목 비율의 평균, 60 이상 강세 · 40 미만 약세`);
  v.append(c.el);
  c.body.append(h("div", { class: "controls stack" }, ctl("시장", seg(["전체", "KOSPI", "KOSDAQ"], m, (x) => { UI.set("mk.hm", x); route(); }))));
  const d1 = (k) => s[k][L] - s[k][P];
  const net = s["신고가"][L] - s["신저가"][L];
  c.body.append(h("div", { class: "grid g5 stack" },
    kpi(`체력 점수 · ${label(s["체력점수"][L])}`, fmt(s["체력점수"][L]), { delta: d1("체력점수"), dtext: signed(d1("체력점수")), sub: "1주 전 대비" }),
    ...["20일선 위", "50일선 위", "200일선 위"].map((k) => kpi(`${k} 종목`, fmt(s[k][L]) + "%", { delta: d1(k), dtext: signed(d1(k)) + "%p", sub: "1주 전 대비" })),
    kpi("52주 신고가 / 신저가", `${fmt(s["신고가"][L])} / ${fmt(s["신저가"][L])}`, { tone: net, sub: `차이 ${signed(net)}종목` })));
  const g = h("div", { class: "grid g2 stack" });
  c.body.append(g);
  const b1 = h("div", {}, h("div", { class: "sub-h" }, "이평선 위 종목 비율")), ch1 = b1.appendChild(h("div", { class: "chart" }));
  const b2 = h("div", {}, h("div", { class: "sub-h" }, "52주 신고가 · 신저가 종목 수")), ch2 = b2.appendChild(h("div", { class: "chart" }));
  g.append(b1, b2);
  const b3 = h("div", {}, h("div", { class: "sub-h" }, "등락 누적선 (ADL)"),
    h("div", { class: "src", style: { marginTop: "0" } }, "매일 (상승 종목 수 − 하락 종목 수) 를 더한 선. 지수는 오르는데 이 선이 내려가면 소수 대형주만 오르는 '속 빈 상승'입니다."));
  const ch3 = b3.appendChild(h("div", { class: "chart" }));
  c.body.append(b3);
  const HC = { "20일선 위": C.series[1], "50일선 위": C.series[2], "200일선 위": C.series[0] };
  requestAnimationFrame(() => {
    const lc = lineChart(ch1, Object.fromEntries(Object.keys(HC).map((k) => [k, { d: s.d, v: s[k] }])), { height: 300, unit: "%", digits: 0, colors: HC, ref: 50 });
    lc.setOption({ yAxis: { min: 0, max: 100 } });
    const i0 = s["신고가"].findIndex((x) => x != null), dd = s.d.slice(i0);
    chart(ch2, {
      grid: { left: 8, right: 56, top: 30, bottom: 24 }, legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 14, itemHeight: 4, textStyle: { color: C.ink2 } },
      xAxis: axisX({ data: dd, boundaryGap: true, axisLabel: { color: C.muted, fontSize: 11.5, ...dateTicks(dd) } }),
      yAxis: axisY({ scale: false, axisLabel: { color: C.muted, fontSize: 11.5, formatter: (x) => fmt(Math.abs(x)) } }),
      tooltip: { trigger: "axis", valueFormatter: (x) => fmt(Math.abs(x)) + "종목" },
      series: [{ name: "신고가", type: "bar", stack: "hl", data: s["신고가"].slice(i0), itemStyle: { color: C.up, borderRadius: 2 } },
               { name: "신저가", type: "bar", stack: "hl", data: s["신저가"].slice(i0).map((x) => (x == null ? null : -x)), itemStyle: { color: C.down, borderRadius: 2 } }],
    }, 300);
    const ix = market?.index?.[m === "KOSDAQ" ? "KOSDAQ" : "KOSPI"], im = new Map((ix?.d || []).map((d, i) => [d, ix.v[i]]));
    const iname = m === "KOSDAQ" ? "코스닥" : "코스피";
    chart(ch3, {
      grid: { left: 8, right: 8, top: 30, bottom: 24, containLabel: true }, legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 14, itemHeight: 4, textStyle: { color: C.ink2 } },
      xAxis: axisX({ data: s.d, axisLabel: { color: C.muted, fontSize: 11.5, ...dateTicks(s.d) } }),
      yAxis: [axisY({ position: "left", axisLabel: { color: C.muted, fontSize: 11.5, formatter: (x) => fmt(x) } }),
              axisY({ position: "right", splitLine: { show: false }, axisLabel: { color: C.muted, fontSize: 11.5, formatter: (x) => fmt(x) } })],
      tooltip: { trigger: "axis", valueFormatter: (x) => fmt(x, 0) },
      series: [{ name: "등락 누적선", type: "line", showSymbol: false, data: s["ADL"], color: C.series[3], lineStyle: { width: 2 } },
               { name: iname, type: "line", showSymbol: false, yAxisIndex: 1, connectNulls: true, data: s.d.map((d) => im.get(d) ?? null), color: C.muted, lineStyle: { width: 1.6, type: "dotted" } }],
    }, 280);
  });
}

/** 업종 로테이션 맵 (RRG 방식) — sector.json 의 rotation (build.py, analytics.sector_rotation 과 같은 계산) */
const QUAD = { 주도: [C.up, "rgba(229,56,59,.06)", "시장보다 강하고 더 강해지는 중"], 약화: [C.series[1], "rgba(240,140,0,.06)", "아직 강하지만 힘이 빠지는 중"],
  소외: [C.down, "rgba(30,111,217,.06)", "시장보다 약하고 더 약해지는 중"], 개선: [C.series[2], "rgba(18,163,127,.06)", "아직 약하지만 좋아지는 중"] };
/** 겹치는 번호 배지를 화면 픽셀 기준 minPx 이상 떨어지게 조금씩 밀어낸 위치 (축 0~100, 그림 w×h px).
 *  로컬 ui.spread_points 와 같은 계산. */
function spreadPoints(pts, w, h, minPx = 23) {
  const sx = w / 100, sy = h / 100, pad = minPx / 2;
  const p = pts.map(([x, y]) => [x * sx, y * sy]);
  for (let it = 0; it < 300; it++) {
    let moved = false;
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
      let dx = p[j][0] - p[i][0], dy = p[j][1] - p[i][1], d = Math.hypot(dx, dy);
      if (d >= minPx) continue;
      if (d < 1e-6) { const a = ((i * 7 + j * 13) % 360) * Math.PI / 180; dx = Math.cos(a); dy = Math.sin(a); d = 1; }
      const push = (minPx - d) / 2 + 0.1, ux = dx / d, uy = dy / d;
      p[i][0] -= ux * push; p[i][1] -= uy * push; p[j][0] += ux * push; p[j][1] += uy * push; moved = true;
    }
    for (const q of p) { q[0] = Math.min(Math.max(q[0], pad), 100 * sx - pad); q[1] = Math.min(Math.max(q[1], pad), 100 * sy - pad); }
    if (!moved) break;
  }
  return p.map(([x, y]) => [x / sx, y / sy]);
}

/** 업종 로테이션 맵 (RRG) — 두 축 0~100, 50 = 시장과 같음. 점 위에 이름 대신 번호 배지, 옆(휴대폰은 아래)에 번호 목록. */
function renderRotation(v, R, rows, onPick, membersBox) {
  if (!R?.sectors) return;
  const L = R.d.length - 1, md = R.d[L].slice(5).replace("-", "/");
  const tails = UI.get("sec.tail", false);
  const names = Object.keys(R.sectors).sort((a, b) => R.sectors[b].ratio[L] - R.sectors[a].ratio[L]);  // 번호 = RS-Ratio 높은 순
  const num = new Map(names.map((n, i) => [n, i + 1]));
  const c = card("업종 로테이션 맵 (RRG)", `WICS 중분류 · 두 축 0~100, 50 = 시장과 같음 · ${md} 기준`,
    `KRX 수정주가로 계산한 업종 시가총액 가중 지수 ÷ 분류된 전 종목 지수 · 원 RS-Ratio = 100 × 상대강도 ÷ ${R.n}일 평균, 원 RS-Momentum = 100 × 원 RS-Ratio ÷ ${R.m}일 전 값 (RRG 공개 근사식) · 0~100 점수 = 원점수를 최근 1년 표준편차로 표준화해 정규분포 누적확률로 바꾼 값, 50 = 시장과 같음 · 업종은 보통 주도 → 약화 → 소외 → 개선 → 주도 순서로 시계 방향으로 돕니다`);
  v.append(c.el);
  c.body.append(h("div", { class: "controls stack" }, ctl("꼬리 (최근 4주 궤적, 5거래일 간격)", seg([[false, "끄기"], [true, "켜기"]], tails, (x) => { UI.set("sec.tail", x); route(); })),
    h("div", { class: "src", style: { marginTop: 0, paddingBottom: "8px" } }, "점의 번호는 목록·표의 번호와 같습니다. 점·목록·표를 누르면 맵 바로 아래에 그 업종 구성 종목이 나옵니다. 겹치는 점은 조금 떨어뜨려 그리고 실제 위치를 가는 선으로 잇습니다.")));
  const g = h("div", { class: "grid g-3-2" });
  c.body.append(g);
  const box = h("div", { class: "chart" }), list = h("div", { class: "rrg-list" });
  g.append(box, list);
  // 번호 목록 — 구역별
  for (const q of ["주도", "개선", "약화", "소외"]) {
    const items = names.filter((n) => R.sectors[n].q[L] === q);
    if (!items.length) continue;
    list.append(h("div", { class: "rrg-q", style: { color: QUAD[q][0] } }, q, h("span", {}, ` ${QUAD[q][2]} · ${items.length}`)));
    for (const n of items) list.append(h("div", { class: "rrg-i", style: { cursor: "pointer" }, onclick: () => onPick?.(n, "목록") }, h("b", { style: { background: QUAD[q][0] } }, String(num.get(n))), h("span", { class: "nm" }, n),
      h("span", { class: "sc" }, `${fmt(R.sectors[n].ratio[L])} · ${fmt(R.sectors[n].momentum[L])}`)));
  }
  const H = Math.min(620, Math.max(400, window.innerWidth * 0.42));
  requestAnimationFrame(() => {
    const W = box.clientWidth, grid = { left: 44, right: 14, top: 10, bottom: 46 };
    const spread = spreadPoints(names.map((n) => [R.sectors[n].ratio[L], R.sectors[n].momentum[L]]), W - grid.left - grid.right, H - grid.top - grid.bottom, W < 500 ? 21 : 23);
    const area = (name, x0, x1, y0, y1) => [{ coord: [x0, y0], itemStyle: { color: QUAD[name][1] }, label: { show: true, formatter: name, color: QUAD[name][0], fontWeight: 700, fontSize: 13,
      position: x1 > 50 ? (y1 > 50 ? "insideTopRight" : "insideBottomRight") : (y1 > 50 ? "insideTopLeft" : "insideBottomLeft") } }, { coord: [x1, y1] }];
    const series = [{ type: "line", data: [], markArea: { silent: true, data: [area("주도", 50, 100, 50, 100), area("약화", 50, 100, 0, 50), area("소외", 0, 50, 0, 50), area("개선", 0, 50, 50, 100)] },
      markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: C.axis, type: "solid" }, data: [{ xAxis: 50 }, { yAxis: 50 }] } }];
    names.forEach((n, i) => {
      const s = R.sectors[n], col = QUAD[s.q[L]][0], x = s.ratio[L], y = s.momentum[L], [bx, by] = spread[i];
      if (tails) series.push({ type: "line", silent: true, data: s.ratio.map((r, k) => [r, s.momentum[k]]), color: col, lineStyle: { width: 1.2, opacity: 0.55 }, symbolSize: 4, itemStyle: { opacity: 0.55 } });
      if (Math.abs(bx - x) + Math.abs(by - y) > 0.3) {
        series.push({ type: "line", silent: true, data: [[x, y], [bx, by]], color: col, lineStyle: { width: 1 }, symbol: "none" });
        series.push({ type: "scatter", silent: true, data: [[x, y]], symbolSize: 5, itemStyle: { color: col } });
      }
      series.push({ name: n, type: "scatter", data: [{ value: [bx, by], real: [x, y], raw: s.raw?.[L] }], symbolSize: W < 500 ? 19 : 21, z: 5,
        itemStyle: { color: col, borderColor: "#fff", borderWidth: 1.5 }, label: { show: true, formatter: String(num.get(n)), color: "#fff", fontSize: 10.5, fontWeight: 700 } });
    });
    chart(box, {
      grid: { ...grid, containLabel: false },
      xAxis: { type: "value", min: 0, max: 100, interval: 10, name: "RS-Ratio (시장 대비 강도) →", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: C.ink2 },
               axisLabel: { color: C.muted, formatter: (x) => fmt(x) }, splitLine: { lineStyle: { color: C.grid, type: [2, 3] } } },
      yAxis: { type: "value", min: 0, max: 100, interval: 10, name: "RS-Momentum (강도 변화) →", nameLocation: "middle", nameGap: 30, nameTextStyle: { color: C.ink2 },
               axisLabel: { color: C.muted, formatter: (x) => fmt(x) }, splitLine: { lineStyle: { color: C.grid, type: [2, 3] } } },
      tooltip: { trigger: "item", formatter: (p) => (p.data?.real ? `<b>${num.get(p.seriesName)}. ${p.seriesName}</b><br>RS-Ratio ${p.data.real[0].toFixed(1)} · RS-Momentum ${p.data.real[1].toFixed(1)}${p.data.raw ? `<br>원점수 ${p.data.raw[0]} · ${p.data.raw[1]}` : ""}` : "") },
      series,
    }, H).on("click", (p) => { if (p.seriesType === "scatter" && p.data?.real) onPick?.(p.seriesName, "맵"); });
    list.style.maxHeight = W < 500 ? "" : H + "px";
  });
  const ret = new Map((rows || []).map((r) => [r["중분류"], r]));
  const order = { 주도: 0, 개선: 1, 약화: 2, 소외: 3 };
  const trows = names.map((n) => ({ no: num.get(n), 업종: n, 구역: R.sectors[n].q[L], 전: R.sectors[n].q[0], ratio: R.sectors[n].ratio[L], momentum: R.sectors[n].momentum[L],
    "1주": ret.get(n)?.["1주"], "1개월": ret.get(n)?.["1개월"], ord: order[R.sectors[n].q[L]] * 1000 - R.sectors[n].ratio[L] }));
  if (membersBox) v.append(membersBox);  // RRG 바로 아래에 구성 종목
  const tc = card("업종 RRG 표", "행을 누르면 위에 구성 종목이 나옵니다 · # = 맵의 번호");
  v.append(tc.el);
  tc.body.append(h("div", {}, table(trows, [{ k: "no", t: "#", f: (r) => String(r.no) }, { k: "업종", t: "업종", l: true }, { k: "구역", t: "구역", l: true, f: (r) => h("b", { style: { color: QUAD[r.구역][0] } }, r.구역) },
    { k: "전", t: "4주 전", l: true }, { k: "ratio", t: "RS-Ratio (0~100)", f: (r) => r.ratio.toFixed(1) }, { k: "momentum", t: "RS-Momentum (0~100)", f: (r) => r.momentum.toFixed(1) },
    pctCol("1주", "1주"), pctCol("1개월", "1개월"), { k: "ord", t: "설명", l: true, f: (r) => QUAD[r.구역][2] }], { sortKey: "ord", desc: false, maxH: 34 * names.length + 60, onRow: (r) => onPick?.(r.업종, "RRG 표"), hint: "행을 누르면 맵 아래에 구성 종목" })));
  return names[0];
}

async function renderSector(v) {
  const [stocks, sector] = await Promise.all([get("stocks.json"), get("sector.json")]);
  v.append(ph("섹터", `WICS 중분류 27개 · 시가총액 가중 수익률 · 수정주가 · ${basisLabel()}`));
  const st = { p: UI.get("sec.p", "1일"), m: UI.get("sec.m", "전체"), size: UI.get("sec.size", "제곱근"), n: UI.get("sec.n", 15) };
  const set = (k, x) => { st[k] = x; UI.set("sec." + k, x); route(); };
  v.append(h("section", { class: "card" }, h("div", { class: "controls" },
    ctl("기간", seg(PERIODS, st.p, (x) => set("p", x))), ctl("시장", seg(["전체", "KOSPI", "KOSDAQ"], st.m, (x) => set("m", x))),
    ctl("칸 크기", seg(["제곱근", "시가총액"], st.size, (x) => set("size", x))),
    ctl("섹터별 종목 수", seg([5, 10, 15, 25], st.n, (x) => set("n", x))))));
  const order = (sector?.rows || []).map((r) => r["중분류"]);
  const rows = sectorAgg(stocks || [], st.p, st.m, order);
  const valid = rows.filter((r) => isNum(r[st.p]));
  const best = valid.reduce((a, b) => (b[st.p] > a[st.p] ? b : a), valid[0]);
  const worst = valid.reduce((a, b) => (b[st.p] < a[st.p] ? b : a), valid[0]);
  v.append(h("div", { class: "grid g4 stack" },
    kpi(`강한 섹터 · ${st.p}`, best?.["중분류"] ?? "–", { delta: best?.[st.p], dtext: pct(best?.[st.p]), sub: best?.["대분류"] }),
    kpi(`약한 섹터 · ${st.p}`, worst?.["중분류"] ?? "–", { delta: worst?.[st.p], dtext: pct(worst?.[st.p]), sub: worst?.["대분류"] }),
    kpi("상승 섹터", `${valid.filter((r) => r[st.p] > 0).length} / ${rows.length}`, { sub: `${st.p} 시총 가중 수익률 기준` }),
    kpi("분류 기준일", ymd(sector?.asof), { sub: `${fmt(rows.reduce((a, r) => a + r["종목수"], 0))}종목 · 우선주·스팩 등 미분류 제외` })));

  // 트리맵
  const cap = COLOR_CAP[st.p];
  const size = (x) => (st.size === "제곱근" ? Math.sqrt(x) : x);
  const tm = card("시가총액 맵", `크기 = ${st.size === "제곱근" ? "시가총액 제곱근" : "시가총액"} · 색 = ${st.p} 수익률 · 섹터를 누르면 확대`,
    `출처 KRX · 키움 · WICS 분류 FnGuide (${ymd(sector?.asof)}) · 색 범위 ±${cap}%`);
  v.append(tm.el);
  const data = rows.map((r) => ({
    name: r["중분류"], value: r.members.slice().sort((a, b) => b["시가총액"] - a["시가총액"]).slice(0, st.n).reduce((a, s) => a + size(s["시가총액"] || 0), 0),
    // 섹터 = 흰 바탕 머리띠 + 이름 · 섹터 등락 (트레이딩뷰처럼). 종목 칸만 등락 색.
    ret: r[st.p], itemStyle: { color: "#fff", borderColor: "#fff" },
    upperLabel: { show: true, height: 22, color: C.ink, fontSize: 12.5, fontWeight: 700, padding: [0, 4],
      formatter: `{n|${r["중분류"]} ›}  {${sgn(r[st.p])}|${pct(r[st.p])}}`,
      rich: { n: { color: C.ink, fontWeight: 700, fontSize: 12.5 }, up: { color: C.up, fontWeight: 700 }, down: { color: C.down, fontWeight: 700 }, flat: { color: C.ink2, fontWeight: 700 } } },
    children: r.members.slice().sort((a, b) => b["시가총액"] - a["시가총액"]).slice(0, st.n).map((s) => ({
      name: s["종목명"], code: s.code, value: size(s["시가총액"] || 0), ret: s[st.p], cap: s["시가총액"], price: s["종가"],
      itemStyle: { color: divergeColor(s[st.p], cap) },
      label: { color: textOn(s[st.p], cap) },
    })),
  }));
  const tmc = chart(tm.body.appendChild(h("div", { class: "chart" })), {
    tooltip: { trigger: "item", formatter: (p) => p.data.code ? `<b>${p.name}</b> ${p.data.code}<br>${st.p} ${pct(p.data.ret)}<br>현재가 ${fmt(p.data.price)}원 · 시총 ${jo(p.data.cap)}조`
      : `<b>${p.name}</b><br>${st.p} ${pct(p.data.ret)} · 시총 가중` },
    series: [{ type: "treemap", name: "전체", data, roam: false, nodeClick: "zoomToNode", breadcrumb: { show: true, bottom: 4, itemStyle: { color: "#eef0f3", textStyle: { color: C.ink } } },
      top: 4, left: 2, right: 2, bottom: 34, visibleMin: 300, leafDepth: 2,
      label: { show: true, fontFamily: FONT, fontSize: 12.5, fontWeight: 600, formatter: (p) => (p.data && "ret" in p.data ? `{n|${p.name}}\n${pct(p.data.ret)}` : ""), rich: { n: { fontWeight: 700, fontSize: 12.5 } } },
      upperLabel: { show: true, height: 22 },
      levels: [{ itemStyle: { borderWidth: 0, gapWidth: 6 } }, { itemStyle: { borderColor: "#fff", borderWidth: 2, gapWidth: 1 }, upperLabel: { show: true } }] }],
  }, Math.min(720, Math.max(460, window.innerWidth * 0.5)));
  tmc.on("dblclick", (p) => p.data?.code && openStock(p.data));

  // 히트맵 + 표
  const g = h("div", { class: "grid g-2-3 stack" });
  const hm = card("기간별 섹터 수익률", "색 진하기는 기간별 범위에 맞춤");
  const tb = card("섹터 표", "행을 누르면 아래에 구성 종목");
  g.append(hm.el, tb.el); v.append(g);
  const ys = rows.map((r) => r["중분류"]);
  chart(hm.body.appendChild(h("div", { class: "chart" })), {
    grid: { left: 8, right: 8, top: 26, bottom: 4, containLabel: true }, tooltip: { trigger: "item", formatter: (p) => `${ys[p.value[1]]} · ${PERIODS[p.value[0]]}: ${pct(p.data.raw)}` },
    xAxis: { type: "category", data: PERIODS, position: "top", axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: C.ink, fontSize: 12 } },
    yAxis: { type: "category", data: ys, inverse: true, axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: C.ink, fontSize: 12 } },
    series: [{ type: "heatmap", data: rows.flatMap((r, y) => PERIODS.map((p, x) => ({ value: [x, y, r[p]], raw: r[p],
      itemStyle: { color: divergeColor(r[p], COLOR_CAP[p]), borderColor: "#fff", borderWidth: 2 },
      label: { show: true, formatter: () => (isNum(r[p]) ? (r[p] > 0 ? "+" : "") + r[p].toFixed(1) + "%" : "–"), color: textOn(r[p], COLOR_CAP[p]), fontSize: 11.5, fontWeight: 600 } }))) }],
  }, 30 * rows.length + 40);
  const membersBox = h("div");
  const showMembers = (r, how = "", scroll = false) => {
    membersBox.innerHTML = "";
    const c = card(`${r["중분류"]} 구성 종목`, `${r["대분류"]} · ${r["종목수"]}종목 · 시가총액 순${how ? ` · ${how}에서 고름` : " · 맵의 점이나 표의 행을 누르면 바뀝니다"}`);
    c.body.append(table(r.members, [nameCol, { k: "시장", t: "시장", l: true }, { k: "종가", t: META?.live ? "현재가" : "종가", f: (x) => fmt(x["종가"]) },
      ...PERIODS.map((p) => pctCol(p, p)), rsCol, { k: "시가총액", t: "시총(조)", f: (x) => jo(x["시가총액"]) }], { sortKey: "시가총액", onRow: openStock, star: true, maxH: 480 }));
    membersBox.append(c.el);
    if (scroll) membersBox.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  tb.body.append(table(rows, [{ k: "중분류", t: "섹터", l: true, f: (r) => h("span", { class: "name" }, r["중분류"]) }, { k: "종목수", t: "종목" },
    { k: "시가총액", t: "시총(조)", f: (r) => fmt(r["시가총액"] / 1e12, 1) }, ...PERIODS.slice(0, 5).map((p) => pctCol(p, p)),
    { k: "상승비율", t: "당일 상승", f: (r) => fmt(r["상승비율"]) + "%" }], { onRow: (r) => showMembers(r, "섹터 표", true), maxH: 30 * rows.length + 60, hint: "행을 누르면 RRG 아래에 구성 종목" }));
  // 구성 종목은 RRG 맵 바로 아래 — 맵의 점 · RRG 표의 행 · 위 섹터 표의 행 어느 것을 눌러도 바뀐다
  const byName = new Map(rows.map((r) => [r["중분류"], r]));
  const pick = (name, how) => { const r = byName.get(name); if (r) showMembers(r, how, true); };
  const first = renderRotation(v, sector?.rotation, rows, pick, membersBox);
  if (byName.has(first)) showMembers(byName.get(first)); else if (best) showMembers(best);
}

async function renderFlow(v) {
  const [flow, stocks] = await Promise.all([get("flow.json"), get("stocks.json")]);
  v.append(ph("수급", `투자자별 순매수 · 키움 · KRX 거래분 · 단위 억원 · ${basisLabel()}`));
  const st = { m: UI.get("fl.m", "KOSPI"), n: UI.get("fl.n", 20), inv: UI.get("fl.inv", "외국인"), w: UI.get("fl.w", "5"), rk: UI.get("fl.rk", "5"), tm: UI.get("fl.tm", "KOSPI") };
  const set = (k, x) => { st[k] = x; UI.set("fl." + k, x); route(); };
  renderFlowToday(v, flow?.today, stocks, st, set);
  renderSurge(v, flow?.surge, stocks);
  v.append(h("div", { class: "controls stack" }, ctl("시장", seg(["KOSPI", "KOSDAQ"], st.m, (x) => set("m", x))),
    ctl("기간", seg([[20, "20일"], [60, "60일"]], st.n, (x) => set("n", x)))));
  const f = flow?.[st.m];
  if (!f?.daily) { v.append(h("div", { class: "note" }, "수급 데이터가 없습니다.")); return; }
  const n = st.n, d = f.daily.d.slice(-n), col = (k) => f.daily[k].slice(-n), last = d.length - 1;
  v.append(h("div", { class: "grid g4 stack" }, ["개인", "외국인", "기관계", "연기금"].map((k) => {
    const s = col(k), sum = s.reduce((a, x) => a + x, 0);
    return kpi(`${k} · ${d[last].slice(5).replace("-", "/")}`, eok(s[last]), { tone: s[last], sub: `${n}거래일 누적 ${eok(sum)}` });
  })));
  const g = h("div", { class: "grid g-3-2 stack" });
  const c1 = card(`${st.m} 누적 순매수`, `최근 ${n}거래일`, `출처 키움 ka10051 · ${d[0]} ~ ${d[last]}`);
  const c2 = card("일별 순매수", "억원");
  g.append(c1.el, c2.el); v.append(g);
  const cum = (k) => col(k).reduce((a, x) => (a.push((a.length ? a[a.length - 1] : 0) + x), a), []);
  requestAnimationFrame(() => {
    lineChart(c1.body.appendChild(h("div", { class: "chart" })), Object.fromEntries(["개인", "외국인", "기관계"].map((k) => [k, { d, v: cum(k) }])),
      { height: 360, unit: "억", digits: 0, colors: C.inv, zero: true });
    const grids = ["개인", "외국인", "기관계"];
    chart(c2.body.appendChild(h("div", { class: "chart" })), {
      grid: grids.map((_, i) => ({ left: 8, right: 64, top: 18 + i * 115, height: 88 })),
      title: grids.map((k, i) => ({ text: k, left: 4, top: i * 115, textStyle: { fontSize: 12, color: C.ink2, fontWeight: 500 } })),
      xAxis: grids.map((_, i) => axisX({ gridIndex: i, data: d, boundaryGap: true, axisLabel: { show: i === 2, color: C.ink2, fontSize: 11, ...dateTicks(d) } })),
      yAxis: grids.map((_, i) => axisY({ gridIndex: i, scale: false, splitNumber: 2, axisLabel: { color: C.ink2, fontSize: 10.5, formatter: (x) => fmt(x) } })),
      tooltip: { trigger: "axis", valueFormatter: (x) => eok(x) },
      series: grids.map((k, i) => ({ name: k, type: "bar", xAxisIndex: i, yAxisIndex: i, data: col(k).map((x) => ({ value: x, itemStyle: { color: x >= 0 ? C.up : C.down, borderRadius: 3 } })) })),
    }, 370);
  });

  renderSpotFutures(v, flow?.spotfut, n);

  // 프로그램 매매 — 시간대별(오늘, 장 전이면 직전 거래일) · 최근 n거래일 누적
  const PG = ["차익", "비차익", "합계"], PGC = { 차익: C.series[3], 비차익: C.series[1], 합계: C.ink };
  const pg = f.program || {};
  const gp = h("div", { class: "grid g-3-2 stack" });
  v.append(gp);
  if (pg.tm?.t?.length) {
    const L = pg.tm.t.length - 1, pd = pg.tm.day, wd = "일월화수목금토"[new Date(`${ymd(pd)}T00:00:00`).getDay()];
    const cp = card(`${st.m} 프로그램 매매 · ${pd.slice(4, 6)}/${pd.slice(6)} (${wd})`, `시간대별 누적 순매수 · ${pg.tm.t[L]} 기준`,
      "출처 키움 ka90005 (1분 단위) · 차익 = 선물·현물 가격차를 노린 바스켓 매매, 비차익 = 그 밖의 바스켓 매매 (주로 외국인·기관의 대량 주문) · 단위 억원");
    gp.append(cp.el);
    cp.body.append(h("div", { class: "grid g3 stack" }, PG.map((k) => kpi(k, eok(pg.tm[k][L]), { tone: pg.tm[k][L], small: true }))));
    const box = cp.body.appendChild(h("div", { class: "chart" }));
    requestAnimationFrame(() => intradayChart(box, pg.tm, PG, { day: pd, height: 330, colors: PGC }));
  } else gp.append(card(`${st.m} 프로그램 매매`, "데이터 없음").el);
  if (pg.daily?.d?.length) {
    const dn = pg.daily.d.slice(-n), cumP = (k) => pg.daily[k].slice(-n).reduce((a, x) => (a.push((a.length ? a[a.length - 1] : 0) + x), a), []);
    const cd = card("프로그램 매매 누적", `최근 ${n}거래일`, `출처 키움 ka90010 · ${dn[0]} ~ ${dn[dn.length - 1]}`);
    gp.append(cd.el);
    const box = cd.body.appendChild(h("div", { class: "chart" }));
    requestAnimationFrame(() => lineChart(box, Object.fromEntries(PG.map((k) => [k, { d: dn, v: cumP(k) }])), { height: 404, unit: "억", digits: 0, colors: PGC, zero: true }));
  }

  // 업종별
  const c3 = card("업종별 순매수", "", "출처 키움 ka10051 · 키움 업종 분류 · 겹치는 집계 업종 제외");
  v.append(c3.el);
  c3.body.append(h("div", { class: "controls stack" }, ctl("투자자", seg(["외국인", "기관계", "개인", "연기금", "투신", "금융투자"], st.inv, (x) => set("inv", x))),
    ctl("합산 기간", seg([["1", "1일"], ["5", "5일"], ["20", "20일"]], st.w, (x) => set("w", x)))));
  const sec = f.sector?.[st.w];
  if (sec) {
    const pairs = sec["업종"].map((u, i) => [u, sec[st.inv][i]]).sort((a, b) => a[1] - b[1]);
    chart(c3.body.appendChild(h("div", { class: "chart" })), {
      grid: { left: 8, right: 70, top: 4, bottom: 4, containLabel: true }, tooltip: { trigger: "item", formatter: (p) => `${p.name}: ${eok(p.value)}` },
      xAxis: { type: "value", show: false }, yAxis: { type: "category", data: pairs.map((p) => p[0]), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: C.ink, fontSize: 12 } },
      series: [{ type: "bar", data: pairs.map((p) => ({ value: p[1], itemStyle: { color: p[1] >= 0 ? C.up : C.down, borderRadius: 3 } })),
                 label: { show: true, position: "right", formatter: (p) => eok(p.value), color: C.ink2, fontSize: 11 } }],
    }, 24 * pairs.length + 20);
  }

  // 순매수 상위
  const c4 = card("기관·외국인 순매수 상위", "합산 순매수 순 · ETF 제외", "출처 키움 ka10131 · 연속은 연속 순매수 일수 (음수는 연속 순매도)");
  v.append(c4.el);
  c4.body.append(h("div", { class: "controls stack" }, ctl("기간", seg([["1", "1일"], ["5", "5일"], ["20", "20일"]], st.rk, (x) => set("rk", x)))));
  const known = new Map((stocks || []).map((s) => [s.code, s]));
  const rows = (f.rank?.[st.rk] || []).filter((r) => known.has(r["종목코드"])).map((r) => ({ ...r, code: r["종목코드"], RS: known.get(r["종목코드"]).RS, 종가: known.get(r["종목코드"])["종가"] }));
  c4.body.append(table(rows.slice(0, 30), [nameCol, pctCol("기간등락률", "기간 등락률", 2),
    { k: "합계", t: "합계(억)", f: (r) => signed(r["합계"]), cls: (r) => sgn(r["합계"]) }, { k: "외국인", t: "외국인(억)", f: (r) => signed(r["외국인"]), cls: (r) => sgn(r["외국인"]) },
    { k: "기관", t: "기관(억)", f: (r) => signed(r["기관"]), cls: (r) => sgn(r["기관"]) },
    { k: "외국인연속", t: "외국인 연속", f: (r) => `${fmt(r["외국인연속"])}일`, cls: (r) => sgn(r["외국인연속"]) },
    { k: "기관연속", t: "기관 연속", f: (r) => `${fmt(r["기관연속"])}일`, cls: (r) => sgn(r["기관연속"]) }, rsCol],
    { sortKey: "합계", onRow: openStock, star: true }));
}

/** 장중 수급 급변 — 프로그램·외국인·기관계 순매수가 최근 약 30분 사이 크게 늘거나 줄어든 종목 (build.py build_surge) */
function renderSurge(v, S, stocks) {
  if (!S) return;
  const st = { m: UI.get("fl.sgm", "KOSPI"), k: UI.get("fl.sgk", "프로그램") };
  const c = card("장중 수급 급변 종목", "최근 약 30분 사이 순매수가 크게 늘거나 줄어든 종목 · 단위 억원",
    "출처 키움 ka90003 (프로그램 순매수 상위) · ka10065 (장중 외국인·기관계 잠정 순매수 상위) · 업데이트 때마다 상위·하위 목록을 기록해 비교 · 외국인·기관계는 증권사 잠정 집계라 확정치와 다를 수 있음");
  v.append(c.el);
  c.body.append(h("div", { class: "controls stack" }, ctl("시장", seg(["KOSPI", "KOSDAQ"], st.m, (x) => { UI.set("fl.sgm", x); route(); })),
    ctl("주체", seg(["프로그램", "외국인", "기관계"], st.k, (x) => { UI.set("fl.sgk", x); route(); }))));
  const d = S[st.m]?.[st.k];
  if (!d) { c.body.append(h("div", { class: "empty" }, "데이터가 없습니다.")); return; }
  const hasChg = d.rows.some((r) => isNum(r.chg)), key = hasChg ? "chg" : "net";
  c.body.append(h("div", { class: "src", style: { marginTop: 0 } }, hasChg ? `${d.t0} → ${d.t} 사이 변화` : d.t ? `${d.t} 기록 1회뿐 — 다음 업데이트부터 변화가 나옵니다.` : "오늘 장중 기록이 없어 '변화' 없이 마지막 누적 순매수 순위만 보여 줍니다."));
  const known = new Map((stocks || []).map((s) => [s.code, s]));
  const rows = d.rows.map((r) => ({ ...r, 등락률: known.get(r.code)?.["등락률"], 종가: known.get(r.code)?.["종가"] }));
  const g = h("div", { class: "grid g2" });
  c.body.append(g);
  for (const [up, label] of [[true, hasChg ? "순매수 급증" : "누적 순매수 상위"], [false, hasChg ? "순매도 급증" : "누적 순매도 상위"]]) {
    const top = rows.filter((r) => isNum(r[key]) && (up ? r[key] > 0 : r[key] < 0)).sort((a, b) => (up ? b[key] - a[key] : a[key] - b[key])).slice(0, 15);
    g.append(h("div", {}, h("div", { class: "sub-h" }, label), table(top, [nameCol, pctCol("등락률", "등락률", 2),
      { k: "chg", t: "30분 변화(억)", f: (r) => (isNum(r.chg) ? signed(r.chg, 1) : "–"), cls: (r) => sgn(r.chg) },
      { k: "net", t: "당일 누적(억)", f: (r) => signed(r.net, 1), cls: (r) => sgn(r.net) }], { sortKey: key, desc: up, onRow: openStock, star: true, maxH: 600 })));
  }
}

/** 현물 · 선물 수급 — 같은 투자자의 현물(코스피·코스닥)과 코스피200 선물 순매수 (build.py build_spot_futures, 다음 금융) */
function renderSpotFutures(v, S, n) {
  if (!S?.times) return;
  const inv = ["외국인", "기관계", "개인"].includes(UI.get("fl.sfi", "외국인")) ? UI.get("fl.sfi", "외국인") : "외국인";
  const COL = { "코스피 현물": C.series[0], "코스닥 현물": C.series[2], "코스피200 선물": C.series[4] };
  const md = `${S.day.slice(4, 6)}/${S.day.slice(6)}`;
  const c = card("현물 · 선물 수급", "같은 투자자의 현물(코스피·코스닥)과 코스피200 선물 순매수 · 단위 억원",
    "출처 다음 금융 투자주체별 매매동향 (KRX 집계, 공식 API 아님) · 선물은 코스피200 선물 (코스닥150 선물 투자자별 자료는 공개 출처 없음) · 선물 금액 = 약정대금 기준 순매수 · 현물·선물을 같은 방향으로 사면 방향성 베팅, 반대로 하면 헤지(위험 상쇄) 성격이 강합니다");
  v.append(c.el);
  c.body.append(h("div", { class: "controls stack" }, ctl("투자자", seg(["외국인", "기관계", "개인"], inv, (x) => { UI.set("fl.sfi", x); route(); }))));
  const last = (k) => { const s = S.times[k]; return s ? s[inv][s[inv].length - 1] : null; };
  const lt = (k) => (S.times[k] ? S.times[k].t[S.times[k].t.length - 1] + " 기준" : "자료 없음");
  const ks = last("코스피 현물"), kf = last("코스피200 선물");
  const both = isNum(ks) && isNum(kf) ? ks + kf : null;
  c.body.append(h("div", { class: "grid g4 stack" }, ...Object.keys(COL).map((k) => kpi(`${inv} ${k} · ${md}`, eok(last(k)), { tone: last(k), sub: lt(k) })),
    kpi(`${inv} 코스피 현물 + 선물`, eok(both), { tone: both, sub: both == null ? "" : (ks > 0) === (kf > 0) ? "현물·선물 같은 방향 (방향성)" : "현물·선물 반대 방향 (헤지 성격)" })));
  const g = h("div", { class: "grid g-3-2 stack" });
  c.body.append(g);
  const b1 = h("div", {}, h("div", { class: "sub-h" }, `${inv} 당일 시간대별 누적 순매수`)), ch1 = b1.appendChild(h("div", { class: "chart" }));
  const b2 = h("div", {}, h("div", { class: "sub-h" }, `${inv} 최근 ${n}거래일 누적 순매수 (코스피 현물 vs 코스피200 선물)`)), ch2 = b2.appendChild(h("div", { class: "chart" }));
  g.append(b1, b2);
  // 시간대별: 세 시계열의 시각이 달라(현물 2분 · 선물 1분) 시각 합집합 위에 각자 마지막 값으로 잇는다
  const names = Object.keys(COL).filter((k) => S.times[k]);
  const ts = [...new Set(names.flatMap((k) => S.times[k].t))].sort();
  const curve = { t: ts };
  for (const k of names) { const m = new Map(S.times[k].t.map((t, i) => [t, S.times[k][inv][i]])); let prev = null; curve[k] = ts.map((t) => (m.has(t) ? (prev = m.get(t)) : (t <= S.times[k].t[S.times[k].t.length - 1] ? prev : null))); }
  const D = S.days;
  requestAnimationFrame(() => {
    intradayChart(ch1, curve, names, { day: S.day, height: 340, colors: COL });
    if (D?.d?.length) {
      const dn = D.d.slice(-n), cum = (a) => a.slice(-n).reduce((x, y) => (x.push((x.length ? x[x.length - 1] : 0) + y), x), []);
      lineChart(ch2, { "코스피 현물": { d: dn, v: cum(D[`${inv}_s`]) }, "코스피200 선물": { d: dn, v: cum(D[`${inv}_f`]) } }, { height: 340, unit: "억", digits: 0, colors: COL, zero: true });
    }
  });
  if (D?.d?.length) {
    const rows = D.d.map((d, i) => ({ d, s: D[`${inv}_s`][i], f: D[`${inv}_f`][i], sum: D[`${inv}_s`][i] + D[`${inv}_f`][i] })).reverse().slice(0, 10);
    const money = (k, t) => ({ k, t, f: (r) => signed(r[k]), cls: (r) => sgn(r[k]) });
    c.body.append(table(rows, [{ k: "d", t: "일자", l: true, f: (r) => r.d.slice(5).replace("-", "/") }, money("s", "코스피 현물(억)"), money("f", "코스피200 선물(억)"), money("sum", "현물+선물(억)")], { sortKey: "d", maxH: 420 }));
  }
}

function renderFlowToday(v, t, stocks, st, set) {
  if (!t?.day) return;
  const shown = t.shown || t.day;
  const dd = new Date(`${ymd(shown)}T00:00:00`), md = `${shown.slice(4, 6)}/${shown.slice(6)}`, wd = "일월화수목금토"[dd.getDay()];
  const lastT = Object.values(t.intraday || {}).map((x) => x.t[x.t.length - 1]).sort().pop();
  const c = card(t.live ? `당일 수급 · ${md} (${wd}) · ${lastT} 기준` : `${t.is_today ? "당일" : "직전 거래일"} 수급 · ${md} (${wd})`,
    t.live ? "장중 잠정치 · 장 마감 후 확정" : t.is_today ? "장 마감 후 키움 집계" : "장중에는 이 자리에 오늘 수급 추이가 표시됩니다",
    "출처 키움 ka10051 (시장 전체 투자자별, 장중엔 주기적으로 받아 추이로 쌓음) · ka10131 (외국인+기관 합산 순매수·순매도 상위, ETF 제외) · KRX 거래분 · 단위 억원");
  v.append(c.el);
  const g = h("div", { class: "grid g2" });
  c.body.append(g);
  for (const m of ["KOSPI", "KOSDAQ"]) {
    const inv = t.investors?.[m];
    if (!inv) continue;
    const box = h("div");
    box.append(h("div", { class: "grid g3 stack" }, ["개인", "외국인", "기관계"].map((k) => kpi(`${m} ${k}`, eok(inv[k]), { tone: inv[k], small: true }))));
    const chartBox = h("div", { class: "chart" });
    box.append(chartBox);
    g.append(box);
    const curve = t.intraday?.[m];
    if (curve?.t?.length >= 2) {
      requestAnimationFrame(() => intradayChart(chartBox, curve, ["개인", "외국인", "기관계"], { day: shown, height: 300, colors: C.inv }));
      continue;
    }
    box.append(h("div", { class: "src" }, "장중 추이 그래프는 PC가 켜져 있는 장중(09:00~15:30)에 기록한 날만 나옵니다."));
    const pairs = INVESTORS.filter((k) => isNum(inv[k])).map((k) => [k, inv[k]]).sort((a, b) => a[1] - b[1]);
    const lo = Math.min(0, ...pairs.map((p) => p[1])), hi = Math.max(0, ...pairs.map((p) => p[1])), pad = (hi - lo) * 0.22 || 1;
    requestAnimationFrame(() => chart(chartBox, {
      grid: { left: 4, right: 8, top: 4, bottom: 4, containLabel: true }, tooltip: { trigger: "item", formatter: (p) => `${m} ${p.name}: ${eok(p.value)}` },
      xAxis: { type: "value", show: false, min: lo < 0 ? lo - pad : 0, max: hi > 0 ? hi + pad : 0 },
      yAxis: { type: "category", data: pairs.map((p) => p[0]), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: C.ink, fontSize: 12 } },
      series: [{ type: "bar", data: pairs.map((p) => ({ value: p[1], itemStyle: { color: p[1] >= 0 ? C.up : C.down, borderRadius: 3 }, label: { position: p[1] >= 0 ? "right" : "left" } })),
                 label: { show: true, formatter: (p) => eok(p.value), color: C.ink2, fontSize: 11 } }],
    }, 24 * pairs.length + 16));
  }
  if (t.live) c.body.append(h("div", { class: "src", style: { marginTop: "10px" } }, `아래 순위는 직전 거래일(${t.day.slice(4, 6)}/${t.day.slice(6)}) 확정 기준입니다.`));
  c.body.append(h("div", { class: "controls stack", style: { marginTop: "12px" } }, ctl("순위 시장", seg(["KOSPI", "KOSDAQ"], st.tm, (x) => set("tm", x)))));
  const known = new Map((stocks || []).map((s) => [s.code, s]));
  const g2 = h("div", { class: "grid g2" });
  c.body.append(g2);
  for (const [side, label] of [["buy", "외국인+기관 순매수 상위"], ["sell", "외국인+기관 순매도 상위"]]) {
    const rows = (t[side]?.[st.tm] || []).filter((r) => known.has(r["종목코드"])).slice(0, 10)
      .map((r) => ({ ...r, code: r["종목코드"], 종가: known.get(r["종목코드"])["종가"] }));
    const money = (k, title) => ({ k, t: title, f: (r) => signed(r[k]), cls: (r) => sgn(r[k]) });
    g2.append(h("div", {}, h("div", { class: "sub-h" }, label), table(rows, [nameCol, pctCol("기간등락률", "등락률", 2), money("합계", "합계(억)"),
      money("외국인", "외국인(억)"), money("기관", "기관(억)")], { sortKey: "합계", desc: side === "buy", onRow: openStock, star: true, maxH: 460 })));
  }
}

/** 하이퍼스케일러 분기 FCF·설비투자 — macro.json hyperscalers (build.py, SEC EDGAR) */
function renderHyperscalers(v, H) {
  if (!H || !Object.keys(H).length) return;
  const COL = { MSFT: C.series[0], AMZN: C.series[1], GOOGL: C.series[2], META: C.series[3], ORCL: C.series[4] };
  const ts = Object.keys(H);
  v.append(h("div", { class: "sub-h", style: { marginTop: "18px" } }, "하이퍼스케일러 분기 현금흐름 · SEC 공시"));
  const usd = (x, sign = false) => (isNum(x) ? `${sign && x > 0 ? "+" : x < 0 ? "-" : ""}$${fmt(Math.abs(x), 1)}B` : "–");
  v.append(h("div", { class: "grid g5 stack" }, ts.map((t) => {
    const e = H[t], L = e.q.length - 1, ttm = e.FCF.slice(-4).reduce((a, x) => a + x, 0);
    const yoy = L >= 4 ? (e["설비투자"][L] / e["설비투자"][L - 4] - 1) * 100 : null;
    return kpi(`${e.name} · ${e.q[L]}`, usd(e.FCF[L], true), { tone: e.FCF[L], sub: `최근 4분기 FCF ${usd(ttm, true)} · 설비투자 ${usd(e["설비투자"][L])}${isNum(yoy) ? ` (${pct(yoy, 0)} YoY)` : ""}` });
  })));
  const qs = [...new Set(ts.flatMap((t) => H[t].q))].sort().slice(-12);
  const at = (t, k) => { const m = new Map(H[t].q.map((q, i) => [q, H[t][k][i]])); return qs.map((q) => (m.has(q) ? m.get(q) : null)); };
  const g = h("div", { class: "grid g2 stack" }); v.append(g);
  const c1 = card("분기 설비투자 (5개사 합계)", "십억 달러 · 쌓은 막대 · 숫자는 5개사가 모두 공시한 분기의 합계"), c2 = card("분기 FCF", "영업현금흐름 − 설비투자 · 십억 달러");
  g.append(c1.el, c2.el);
  const totals = qs.map((_, i) => ts.reduce((a, t) => a + (at(t, "설비투자")[i] || 0), 0));
  const full = qs.map((_, i) => ts.every((t) => isNum(at(t, "설비투자")[i])));  // 5개사가 다 공시한 분기만 합계
  const base = { grid: { left: 8, right: 8, top: 30, bottom: 24, containLabel: true }, legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 14, itemHeight: 6, textStyle: { color: C.ink2 } },
    xAxis: { type: "category", data: qs, axisTick: { show: false }, axisLine: { lineStyle: { color: C.axis } }, axisLabel: { color: C.muted, fontSize: 11 } },
    tooltip: { trigger: "axis", valueFormatter: (x) => usd(x, true) } };
  requestAnimationFrame(() => {
    chart(c1.body.appendChild(h("div", { class: "chart" })), { ...base, legend: { ...base.legend, data: ts.map((t) => H[t].name) }, tooltip: { trigger: "axis", valueFormatter: (x) => usd(x) },
      yAxis: axisY({ position: "right", scale: false, axisLabel: { color: C.muted, formatter: (x) => `$${x}B` } }),
      series: [...ts.map((t) => ({ name: H[t].name, type: "bar", stack: "c", data: at(t, "설비투자"), color: COL[t], barWidth: "55%" })),
        { name: "합계", type: "scatter", symbolSize: 0, data: totals, label: { show: true, position: "top", formatter: (p) => (full[p.dataIndex] ? `$${fmt(p.value)}B` : "일부 공시"), color: C.ink2, fontSize: 11 }, tooltip: { show: false } }] }, 360);
    chart(c2.body.appendChild(h("div", { class: "chart" })), { ...base,
      yAxis: axisY({ position: "right", scale: false, axisLabel: { color: C.muted, formatter: (x) => `$${x}B` } }),
      series: ts.map((t, i) => ({ name: H[t].name, type: "line", data: at(t, "FCF"), color: COL[t], lineStyle: { width: 2 }, symbolSize: 5,
        markLine: i === 0 ? { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: C.axis, type: "solid" }, data: [{ yAxis: 0 }] } : undefined })) }, 360);
  });
  const pick = ts.includes(UI.get("mc.hs", ts[0])) ? UI.get("mc.hs", ts[0]) : ts[0];
  const e = H[pick];
  const rows = e.q.map((q, i) => ({ q, end: e.end[i], ocf: e["영업현금흐름"][i], capex: e["설비투자"][i], fcf: e.FCF[i] })).reverse().slice(0, 8);
  const tc = card(`${e.name} 분기 현금흐름`, "십억 달러");
  v.append(tc.el);
  tc.body.append(h("div", { class: "controls stack" }, seg(ts.map((t) => [t, H[t].name]), pick, (x) => { UI.set("mc.hs", x); route(); })),
    table(rows, [{ k: "q", t: "분기", l: true }, { k: "end", t: "분기말", l: true }, { k: "ocf", t: "영업현금흐름", f: (r) => usd(r.ocf) },
      { k: "capex", t: "설비투자", f: (r) => usd(r.capex) }, { k: "fcf", t: "FCF", f: (r) => usd(r.fcf, true), cls: (r) => sgn(r.fcf) }], { sortKey: "end", maxH: 380 }));
  v.append(h("div", { class: "src" }, "출처 미국 SEC EDGAR (10-Q·10-K XBRL) · 분기 값은 누적 공시값의 차이 (4분기 = 연간 − 9개월) · 설비투자 = 유형자산 취득 현금지출 (아마존은 PaymentsToAcquireProductiveAssets, 금융리스는 제외 — 회사 발표 FCF 와 다를 수 있음) · 회계연도가 달라 분기는 그 분기가 끝난 달력 분기로 맞춤 (MSFT 6월 결산, ORCL 5월 결산이라 한 달 어긋남)"));
}

async function renderMacro(v) {
  const macro = await get("macro.json");
  v.append(ph("매크로", "금리 · 환율 · 미국 지표 · 물가 (일·월 단위 공개 자료)"));
  const st = { tab: UI.get("mc.tab", "국내 금리"), p: UI.get("mc.p", "1년") };
  const set = (k, x) => { st[k] = x; UI.set("mc." + k, x); route(); };
  if (!["국내 금리", "환율", "미국", "물가"].includes(st.tab)) st.tab = "국내 금리";
  v.append(h("div", { class: "controls stack" }, ctl("구분", seg(["국내 금리", "환율", "미국", "물가"], st.tab, (x) => set("tab", x))),
    st.tab !== "물가" ? ctl("기간", seg(["3개월", "6개월", "1년", "3년"], st.p, (x) => set("p", x))) : null));
  const days = { "3개월": 92, "6개월": 183, "1년": 366, "3년": 1100 }[st.p];
  const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const cut = (s) => { if (!s?.d?.length) return null; const i = s.d.findIndex((d) => d >= cutoff); return { d: s.d.slice(i), v: s.v.slice(i) }; };
  const draw = (box, title, sub, map, opts, src) => {
    const ok = Object.fromEntries(Object.entries(map).filter(([, s]) => s && s.d.length));
    const c = card(title, sub, src); box.append(c.el);
    if (!Object.keys(ok).length) { c.body.append(h("div", { class: "empty" }, "데이터 없음")); return; }
    requestAnimationFrame(() => lineChart(c.body.appendChild(h("div", { class: "chart" })), ok, opts));
  };
  if (st.tab === "국내 금리") {
    const e = macro?.ecos || {};
    draw(v, "국내 금리", "연 %", { 기준금리: cut(e["기준금리"]), "국고채 3년": cut(e["국고채 3년"]), "국고채 10년": cut(e["국고채 10년"]) }, { height: 330, unit: "%", digits: 2 }, "출처 한국은행 ECOS");
  } else if (st.tab === "환율") {
    const fx = macro?.fx || {};
    const KRW = ["달러/원", "100엔/원", "유로/원", "위안/원", "파운드/원"], GLB = ["달러/엔", "달러/위안", "유로/달러", "파운드/달러"];
    const UNIT = { "달러/원": ["1달러", "원"], "100엔/원": ["100엔", "원"], "유로/원": ["1유로", "원"], "위안/원": ["1위안", "원"], "파운드/원": ["1파운드", "원"],
      "달러/엔": ["1달러", "엔"], "달러/위안": ["1달러", "위안"], "유로/달러": ["1유로", "달러"], "파운드/달러": ["1파운드", "달러"] };
    const dg = (n) => (["유로/달러", "파운드/달러", "달러/위안"].includes(n) ? 4 : 2);
    const note = (n) => { const s = fx[n]; return s?.v?.length ? `${UNIT[n][0]} = ${fmt(s.v[s.v.length - 1], dg(n))}${UNIT[n][1]}` : ""; };
    for (const group of [KRW, GLB]) {
      v.append(h("div", { class: "grid g5 stack" }, group.map((n) => {
        const s = fx[n];
        if (!s?.v?.length) return kpi(n, "–");
        const L = s.v.length - 1, chg = (s.v[L] / s.v[L - 1] - 1) * 100;
        return kpi(`${n} · ${s.d[L].slice(5).replace("-", "/")}`, fmt(s.v[L], dg(n)), { delta: chg, dtext: pct(chg), sub: note(n) });
      })));
    }
    const idx = Object.fromEntries(KRW.map((n) => { const s = cut(fx[n]); return [n, s && s.v.length ? { d: s.d, v: s.v.map((x) => +(x / s.v[0] * 100).toFixed(2)) } : null]; }));
    draw(v, "원화 대비 주요 통화", `${st.p} 시작 = 100 · 오르면 그 통화 대비 원화 약세`, idx, { height: 340, digits: 1, ref: 100, left: true }, "출처 한국은행 ECOS (서울외국환중개 매매기준율)");
    for (const group of [KRW, GLB]) {
      const g = h("div", { class: `grid ${group.length === 5 ? "g5" : "g4"} stack` }); v.append(g);
      for (const n of group) draw(g, n, note(n), { [n]: cut(fx[n]) }, { height: 250, digits: dg(n), left: true },
        "출처 한국은행 ECOS" + (n === "달러/위안" ? " · 달러/원 ÷ 위안/원" : ""));
    }
  } else if (st.tab === "미국") {
    const f = macro?.fred || {};
    draw(v, "미국 금리", "연 %", { "미 국채 10년": cut(f["미 국채 10년"]), "미 기준금리(실효)": cut(f["미 기준금리(실효)"]) }, { height: 320, unit: "%", digits: 2 }, "출처 FRED");
    const g = h("div", { class: "grid g3" }); v.append(g);
    for (const n of ["S&P 500", "나스닥 종합", "VIX"]) draw(g, n, "", { [n]: cut(f[n]) }, { height: 250, digits: 2 }, "출처 FRED");
    const E = macro?.us_etf || {};
    if (Object.keys(E).length) {
      const asof = Object.values(E)[0].asof;
      v.append(h("div", { class: "sub-h", style: { marginTop: "18px" } }, "지수 추종 ETF · 키움"),
        h("div", { class: "src", style: { marginTop: 0, marginBottom: "10px" } }, `키움 REST API 에는 미국 지수 시세가 없어 지수를 따라가는 ETF 로 보여 줍니다. SPY = S&P 500, QQQ = 나스닥100 (나스닥 종합과 다름), DIA = 다우존스 산업. 단위 USD · 현재가는 ${asof} 업데이트 기준`));
      const ge = h("div", { class: "grid g3 stack" }); v.append(ge);
      for (const [code, e] of Object.entries(E)) {
        const q = e.quote || {};
        const box = h("div");
        box.append(kpi(`${code} · ${e.label}`, isNum(q["현재가"]) ? "$" + fmt(q["현재가"], 2) : "–", { delta: q["등락률"], dtext: pct(q["등락률"]),
          sub: isNum(q["52주고가대비"]) ? `52주 고가 대비 ${pct(q["52주고가대비"], 1)} · 당일 ${fmt(q["저가"], 2)}–${fmt(q["고가"], 2)}` : "" }));
        ge.append(box);
        draw(box, `${code} 일봉 종가`, q["이름"] || e.label, { [code]: cut(e.daily) }, { height: 240, digits: 2, left: true }, "출처 키움 usa06012 (미국주식 일 차트, 수정주가)");
      }
    }
    renderHyperscalers(v, macro?.hyperscalers);
  } else {
    const cpi = macro?.cpi;
    if (!cpi?.v?.length) { v.append(h("div", { class: "note" }, "물가 데이터가 없습니다.")); return; }
    const last = cpi.v.length - 1, rate = macro?.ecos?.["기준금리"];
    const g = h("div", { class: "grid g-2-3" }); v.append(g);
    const left = h("div", { class: "grid" });
    left.append(kpi(`소비자물가 상승률 · ${cpi.d[last].slice(0, 7)}`, `${cpi.v[last].toFixed(1)}%`, { delta: cpi.v[last] - cpi.v[last - 1], dtext: `${(cpi.v[last] - cpi.v[last - 1]).toFixed(1)}%p`, sub: "전년동월비" }));
    if (rate?.v?.length) {
      const real = rate.v[rate.v.length - 1] - cpi.v[last];
      left.append(kpi("실질 기준금리", `${real > 0 ? "+" : ""}${real.toFixed(2)}%p`, { sub: "기준금리 − 물가 · 양수면 긴축적" }));
    }
    g.append(left);
    draw(g, "소비자물가 상승률", "전년동월비, 전국", { 소비자물가: cpi }, { height: 320, unit: "%", digits: 1, ref: 2 }, "출처 KOSIS · 점선 = 물가안정목표 2%");
  }
}

// ---- 스크리너 ----------------------------------------------------------------------
const gt = (a, b) => isNum(a) && isNum(b) && a > b;
const ge = (a, b) => isNum(a) && a >= b, le = (a, b) => isNum(a) && a <= b;  // 값이 없으면(null) 탈락
const PRESETS = {
  "트렌드 템플릿 (미너비니)": ["장기 상승 추세가 확인된 주도주 후보. 마크 미너비니의 8가지 조건.", [
    ["종가 > 150일선, 200일선", (d) => d["MA150이격"] > 0 && d["MA200이격"] > 0], ["150일선 > 200일선", (d) => gt(d._ma150, d._ma200)],
    ["200일선 1개월 이상 상승", (d) => d["MA200상승"] === true], ["50일선 > 150일선, 200일선", (d) => gt(d._ma50, d._ma150) && gt(d._ma50, d._ma200)],
    ["종가 > 50일선", (d) => d["MA50이격"] > 0], ["52주 저점 대비 +30% 이상", (d) => d["52주저점대비"] >= 30],
    ["52주 고점 대비 -25% 이내", (d) => d["52주고점대비"] >= -25], ["RS 70 이상", (d) => d.RS >= 70]]],
  "52주 신고가 근접 강세주": ["1년 고점 부근에서 버티는 상대강도 상위 종목.", [
    ["52주 고점 대비 -5% 이내", (d) => d["52주고점대비"] >= -5], ["RS 80 이상", (d) => d.RS >= 80], ["종가 > 50일선", (d) => d["MA50이격"] > 0]]],
  "거래량 급증 돌파": ["평소의 2배 넘는 거래량으로 20일 고점을 넘어선 종목.", [
    ["거래량 20일 평균의 2배 이상", (d) => d["거래량배수"] >= 2], ["20일 신고가", (d) => d["20일신고가"] === true], ["당일 상승", (d) => d["등락률"] > 0]]],
  "상승 추세 속 눌림목": ["이평선 정배열 상승 추세에서 20일선 부근까지 쉬어 간 종목.", [
    ["정배열 (20일 > 60일 > 120일)", (d) => gt(d._ma20, d._ma60) && gt(d._ma60, d._ma120)], ["RS 70 이상", (d) => d.RS >= 70],
    ["20일선 대비 -2% ~ +3%", (d) => d["MA20이격"] >= -2 && d["MA20이격"] <= 3], ["RSI 40 ~ 60", (d) => d.RSI >= 40 && d.RSI <= 60]]],
  "장기 상승 중 과매도": ["200일선 위 장기 추세는 살아 있는데 단기로 과하게 밀린 종목.", [
    ["종가 > 200일선", (d) => d["MA200이격"] > 0], ["RSI 30 이하", (d) => d.RSI <= 30]]],
  "실적 성장 주도주 (CAN SLIM 근사)": ["이익이 크게 늘면서 주가도 시장을 이끄는 종목. 윌리엄 오닐의 CAN SLIM 중 실적(C·A)과 주도주(L) 조건.", [
    ["최근 분기 영업이익 전년 대비 +25% 이상", (d) => ge(d["영업이익YoY"], 25)], ["최근 분기 매출 전년 대비 +10% 이상", (d) => ge(d["매출YoY"], 10)],
    ["ROE 10% 이상", (d) => ge(d.ROE, 10)], ["RS 80 이상", (d) => d.RS >= 80], ["52주 고점 대비 -15% 이내", (d) => d["52주고점대비"] >= -15]]],
  "저평가 우량주": ["이익을 잘 내는데(ROE) 이익·자산 대비 주가가 싼 종목. 하락 추세는 거른다.", [
    ["PER 12 이하 (흑자)", (d) => le(d.PER, 12)], ["PBR 1.5 이하", (d) => le(d.PBR, 1.5)], ["ROE 10% 이상", (d) => ge(d.ROE, 10)],
    ["최근 분기 영업이익 전년 대비 증가", (d) => gt(d["영업이익YoY"], 0)], ["종가 > 200일선", (d) => d["MA200이격"] > 0]]],
};
const MA_RULES = {
  "종가 > 20일선": (d) => d["MA20이격"] > 0, "종가 > 50일선": (d) => d["MA50이격"] > 0, "종가 > 200일선": (d) => d["MA200이격"] > 0,
  "정배열 (20>60>120)": (d) => gt(d._ma20, d._ma60) && gt(d._ma60, d._ma120), "200일선 상승 중": (d) => d["MA200상승"] === true,
};
const STOCK_COLS = () => [nameCol, { k: "시장", t: "시장", l: true }, { k: "종가", t: META?.live ? "현재가" : "종가", f: (r) => fmt(r["종가"]) },
  pctCol("등락률", "등락률", 2), rsCol, { k: "RS변화1주", t: "RS 1주", f: (r) => signed(r["RS변화1주"]), cls: (r) => sgn(r["RS변화1주"]) },
  pctCol("52주고점대비", "52주 고점비"), pctCol("MA20이격", "20일선 이격"), pctCol("MA200이격", "200일선 이격"),
  { k: "거래량배수", t: "거래량 배수", f: (r) => (isNum(r["거래량배수"]) ? r["거래량배수"].toFixed(1) + "배" : "–") }, { k: "RSI", t: "RSI", f: (r) => fmt(r.RSI) },
  pctCol("20일", "20일"), pctCol("영업이익YoY", "영업익 YoY", 0), { k: "ROE", t: "ROE", f: (r) => (isNum(r.ROE) ? fmt(r.ROE, 1) + "%" : "–") },
  { k: "PER", t: "PER", f: (r) => (isNum(r.PER) ? fmt(r.PER, 1) : "–") },
  { k: "평균거래대금20", t: "평균 거래대금(억)", f: (r) => eokWon(r["평균거래대금20"]) }, { k: "시가총액", t: "시총(조)", f: (r) => jo(r["시가총액"]) }];

async function renderScreener(v) {
  const [stocks, flow] = await Promise.all([get("stocks.json"), get("flow.json")]);
  v.append(ph("스크리너", `보통주 전 종목 · ${basisLabel()} · 수정주가`));
  const st = { mode: UI.get("sc.mode", "프리셋 전략"), m: UI.get("sc.m", "전체"), val: UI.get("sc.val", 10), cap: UI.get("sc.cap", 1000),
               preset: UI.get("sc.preset", Object.keys(PRESETS)[0]), rs: UI.get("sc.rs", 70), dd: UI.get("sc.dd", 25),
               rsiLo: UI.get("sc.rsiLo", 0), rsiHi: UI.get("sc.rsiHi", 100), ma: UI.get("sc.ma", ["종가 > 50일선"]), vol: UI.get("sc.vol", 0),
               nh: UI.get("sc.nh", false), flow: UI.get("sc.flow", false), opg: UI.get("sc.opg", null), roe: UI.get("sc.roe", null), per: UI.get("sc.per", null) };
  const set = (k, x) => { st[k] = x; UI.set("sc." + k, x); route(); };
  const c = card();
  v.append(c.el);
  c.body.append(h("div", { class: "controls stack" }, ctl("방식", seg(["프리셋 전략", "직접 설정"], st.mode, (x) => set("mode", x))),
    ctl("시장", seg(["전체", "KOSPI", "KOSDAQ"], st.m, (x) => set("m", x))),
    ctl("20일 평균 거래대금", seg([[0, "제한 없음"], [10, "10억+"], [30, "30억+"], [100, "100억+"]], st.val, (x) => set("val", x))),
    ctl("시가총액", seg([[0, "제한 없음"], [1000, "1천억+"], [3000, "3천억+"], [10000, "1조+"]], st.cap, (x) => set("cap", x)))));
  let rules = [];
  if (st.mode === "프리셋 전략") {
    c.body.append(ctl("전략", seg(Object.keys(PRESETS), st.preset, (x) => set("preset", x))));
    c.body.append(h("div", { class: "src", style: { fontSize: "12.5px" } }, PRESETS[st.preset][0]));
    rules = PRESETS[st.preset][1];
  } else {
    const range = (label, k, min, max, suffix, help) => {
      const out = h("b", {}, `${st[k]}${suffix}`);
      const input = h("input", { type: "range", min, max, value: st[k], oninput: (e) => (out.textContent = e.target.value + suffix), onchange: (e) => set(k, +e.target.value) });
      return ctl(`${label} `, h("div", {}, input, " ", out, help ? h("div", { class: "src" }, help) : null));
    };
    c.body.append(h("div", { class: "controls stack" }, range("RS 최소", "rs", 0, 99, "", "0 이면 조건 없음"),
      range("52주 고점 대비 최대 하락폭", "dd", 0, 100, "%", "100 이면 조건 없음"),
      range("RSI 하한", "rsiLo", 0, 100, ""), range("RSI 상한", "rsiHi", 0, 100, ""),
      ctl("거래량 (20일 평균 대비)", seg([[0, "조건 없음"], [1.5, "1.5배+"], [2, "2배+"], [3, "3배+"]], st.vol, (x) => set("vol", x)))));
    c.body.append(h("div", { class: "controls" }, ctl("이동평균 조건", chips(Object.keys(MA_RULES), st.ma, (x) => set("ma", x))),
      ctl("기타", chips([["nh", "20일 신고가"], ["flow", "5일 기관·외국인 순매수 상위"]], [st.nh ? "nh" : null, st.flow ? "flow" : null].filter(Boolean),
        (x) => { st.nh = x.includes("nh"); st.flow = x.includes("flow"); UI.set("sc.nh", st.nh); UI.set("sc.flow", st.flow); route(); }))));
    c.body.append(h("div", { class: "controls stack" },
      ctl("최근 분기 영업이익 (전년 대비)", seg([[null, "조건 없음"], [0, "증가"], [25, "+25%+"], [50, "+50%+"], [100, "+100%+"]], st.opg, (x) => set("opg", x))),
      ctl("ROE (최근 4분기)", seg([[null, "조건 없음"], [5, "5%+"], [10, "10%+"], [15, "15%+"], [20, "20%+"]], st.roe, (x) => set("roe", x))),
      ctl("PER (흑자만)", seg([[null, "조건 없음"], [8, "8 이하"], [12, "12 이하"], [20, "20 이하"], [30, "30 이하"]], st.per, (x) => set("per", x)))));
    if (st.opg != null) rules.push([st.opg ? `영업이익 YoY +${st.opg}% 이상` : "영업이익 YoY 증가", (d) => (st.opg ? ge(d["영업이익YoY"], st.opg) : gt(d["영업이익YoY"], 0))]);
    if (st.roe != null) rules.push([`ROE ${st.roe}% 이상`, (d) => ge(d.ROE, st.roe)]);
    if (st.per != null) rules.push([`PER ${st.per} 이하`, (d) => le(d.PER, st.per)]);
    if (st.rs) rules.push([`RS ${st.rs} 이상`, (d) => d.RS >= st.rs]);
    if (st.dd < 100) rules.push([`52주 고점 대비 -${st.dd}% 이내`, (d) => d["52주고점대비"] >= -st.dd]);
    if (st.rsiLo > 0 || st.rsiHi < 100) rules.push([`RSI ${st.rsiLo}~${st.rsiHi}`, (d) => d.RSI >= st.rsiLo && d.RSI <= st.rsiHi]);
    for (const k of st.ma) rules.push([k, MA_RULES[k]]);
    if (st.vol) rules.push([`거래량 ${st.vol}배 이상`, (d) => d["거래량배수"] >= st.vol]);
    if (st.nh) rules.push(["20일 신고가", (d) => d["20일신고가"] === true]);
    if (st.flow) {
      const top = new Set([...(flow?.KOSPI?.rank?.["5"] || []), ...(flow?.KOSDAQ?.rank?.["5"] || [])].map((r) => r["종목코드"]));
      rules.push(["5일 기관·외국인 순매수 상위", (d) => top.has(d.code)]);
    }
  }
  let pool = (stocks || []).filter((d) => (st.m === "전체" || d["시장"] === st.m) && (d["평균거래대금20"] || 0) >= st.val * 1e8 && (d["시가총액"] || 0) >= st.cap * 1e8);
  const funnel = [["기본 필터", pool.length]];
  for (const [label, fn] of rules) { pool = pool.filter((d) => { try { return fn(d); } catch { return false; } }); funnel.push([label, pool.length]); }
  v.append(h("div", { class: "funnel", html: funnel.map(([l, n]) => `${l} <b>${fmt(n)}</b>`).join(" → ") }));
  const r = card(`결과 ${fmt(pool.length)}종목`, "RS 높은 순", `KRX 일별 시세 + 키움 당일 시세로 계산 · ${basisLabel()} · 보통주(우선주·스팩 제외)`);
  v.append(r.el);
  r.body.append(pool.length ? table(pool, STOCK_COLS(), { sortKey: "RS", onRow: openStock, star: true }) : h("div", { class: "empty" }, "조건에 맞는 종목이 없습니다. 조건을 완화해 보세요."));
}

async function renderRS(v) {
  const stocks = await get("stocks.json");
  v.append(ph("RS 점수", `고른 기간의 주가 흐름을 전 종목과 비교한 백분위(1~99) · 기간을 4등분해 최근 구간에 2배 가중 (0.4×최근 1/4 + 0.2×2/4 + 0.2×3/4 + 0.2×전체 기간 수익률) · 수정주가 · 보통주(상장 기간이 RS 기간보다 짧으면 제외) · ${basisLabel()}`));
  v.append(h("div", { class: "controls stack" }, ctl("RS 기간", seg(RS_PERIODS, rsPeriod(), setRSPeriod)),
    h("span", { class: "hint" }, "고른 기간은 스크리너·수급·종목 분석·관심종목의 RS 에도 똑같이 쓰입니다.")));
  const st = { m: UI.get("rs.m", "전체"), min: UI.get("rs.min", 80), val: UI.get("rs.val", 10), cap: UI.get("rs.cap", 0), tab: UI.get("rs.tab", "상위"), q: "" };
  const set = (k, x) => { st[k] = x; UI.set("rs." + k, x); route(); };
  const q = h("input", { type: "search", placeholder: "종목명 검색", value: UI.get("rs.q", ""), onchange: (e) => set("q", e.target.value) });
  st.q = UI.get("rs.q", "");
  const minOut = h("b", {}, String(st.min));
  v.append(h("section", { class: "card" }, h("div", { class: "controls" }, ctl("시장", seg(["전체", "KOSPI", "KOSDAQ"], st.m, (x) => set("m", x))),
    ctl("최소 RS ", h("div", {}, h("input", { type: "range", min: 1, max: 99, value: st.min, oninput: (e) => (minOut.textContent = e.target.value), onchange: (e) => set("min", +e.target.value) }), " ", minOut)),
    ctl("20일 평균 거래대금", seg([[0, "제한 없음"], [10, "10억+"], [50, "50억+"], [100, "100억+"]], st.val, (x) => set("val", x))),
    ctl("시가총액", seg([[0, "제한 없음"], [1000, "1천억+"], [3000, "3천억+"], [10000, "1조+"], [50000, "5조+"]], st.cap, (x) => set("cap", x))), ctl("검색", q))));
  const pool = (stocks || []).filter((d) => isNum(d.RS) && (st.m === "전체" || d["시장"] === st.m) && (d["평균거래대금20"] || 0) >= st.val * 1e8 && (d["시가총액"] || 0) >= st.cap * 1e8);
  const news = pool.filter((d) => d.RS >= 80 && isNum(d["1주전 RS"]) && d["1주전 RS"] < 80);
  v.append(h("div", { class: "grid g4 stack" }, kpi("분석 대상", `${fmt(pool.length)}종목`, { sub: `${st.m} · 거래대금·시총 조건 적용 · RS ${rsLabel()}` }),
    kpi("RS 80 이상", `${fmt(pool.filter((d) => d.RS >= 80).length)}종목`, { sub: "상위 약 20%" }),
    kpi("이번 주 RS 80 신규 진입", `${fmt(news.length)}종목`, { sub: "1주 전 80 미만 → 현재 80 이상" }),
    kpi("기준일", ymd(META?.bas_dd), { sub: `RS ${rsLabel()} · ${META?.live ? META.basis : "KRX 공식 종가"}` })));
  const view = st.q ? pool.filter((d) => (d["종목명"] || "").includes(st.q)) : pool.filter((d) => d.RS >= st.min);
  v.append(h("div", { class: "stack" }, seg([["상위", st.q ? `검색 결과 · ${view.length}` : `RS ${st.min} 이상 · ${fmt(view.length)}`], ["신규", `신규 진입 · ${news.length}`]], st.tab, (x) => set("tab", x))));
  const cols = [nameCol, { k: "시장", t: "시장", l: true }, rsCol, { k: "RS변화1주", t: "RS 1주", f: (r) => signed(r["RS변화1주"]), cls: (r) => sgn(r["RS변화1주"]) },
    { k: "RS변화4주", t: "RS 4주", v: (r) => (isNum(r["4주전 RS"]) ? r.RS - r["4주전 RS"] : null), f: (r) => (isNum(r["4주전 RS"]) ? signed(r.RS - r["4주전 RS"]) : "–"), cls: (r) => sgn(r.RS - r["4주전 RS"]) },
    { k: "종가", t: META?.live ? "현재가" : "종가", f: (r) => fmt(r["종가"]) }, pctCol("1개월"), pctCol("3개월"), pctCol("6개월"), pctCol("1년", "12개월"),
    pctCol("52주고점대비", "52주 고점비"), { k: "평균거래대금20", t: "평균 거래대금(억)", f: (r) => eokWon(r["평균거래대금20"]) }, { k: "시가총액", t: "시총(조)", f: (r) => jo(r["시가총액"]) }];
  v.append(table(st.tab === "신규" ? news : view, cols, { sortKey: st.tab === "신규" ? "RS변화1주" : "RS", onRow: openStock, star: true }));
}

// ---- 관심종목 ---------------------------------------------------------------------
function sparkline(values) {
  if (!values?.length) return h("span", { class: "flat" }, "–");
  const w = 110, hh = 26, min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((x, i) => `${(i / (values.length - 1)) * w},${hh - ((x - min) / span) * (hh - 4) - 2}`).join(" ");
  const color = values[values.length - 1] >= values[0] ? C.up : C.down;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", w); svg.setAttribute("height", hh); svg.innerHTML = `<polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts}"/>`;
  return svg;
}
async function renderWatch(v) {
  const map = await stockMap();
  v.append(ph("관심종목", "이 브라우저에만 저장됩니다 · 다른 기기나 다른 사람과 공유되지 않습니다"));
  const list = WL.all();
  const input = h("input", { type: "search", list: "stock-list", placeholder: "종목명·ETF 이름이나 코드 입력" });
  const add = () => {
    const code = (input.value.match(/\((\d{6}|[0-9A-Z]{6})\)\s*$/) || [])[1] || input.value.trim();
    const s = map.get(code);
    if (!s) { toast("목록에서 종목을 고르세요"); return; }
    if (!WL.has(code)) WL.toggle(code, s["종목명"], s["종가"]);
    route();
  };
  v.append(h("section", { class: "card" }, h("div", { class: "search-row" }, input, h("button", { class: "btn primary", onclick: add }, "추가"),
    h("span", { class: "src" }, "목록·검색 결과의 ★ 로도 추가할 수 있습니다"))));
  if (!list.length) { v.append(h("div", { class: "empty" }, "관심종목이 없습니다.")); return; }
  const rows = list.map((w) => {
    const s = map.get(w.code) || {};
    return { ...s, code: w.code, 종목명: w.name, added: w.added, addPrice: w.price, 추가후: isNum(s["종가"]) && isNum(w.price) ? (s["종가"] / w.price - 1) * 100 : null };
  });
  const up = rows.filter((r) => r["등락률"] > 0).length, down = rows.filter((r) => r["등락률"] < 0).length;
  const avg = rows.reduce((a, r) => a + (r["등락률"] || 0), 0) / rows.length;
  v.append(h("div", { class: "grid g3 stack" }, kpi("관심종목", `${rows.length}종목`, { sub: `상승 ${up} · 하락 ${down}` }),
    kpi("평균 등락률", pct(avg), { tone: avg, sub: "단순 평균" }), kpi("시세 기준", META?.live ? META.basis : "KRX 종가", { sub: `${META?.generated ?? ""} 업데이트`, small: true })));
  const sparks = {};
  const c = card("관심종목 시세", "행을 누르면 종목 분석", "현재가·등락률은 마지막 업데이트 기준 (10분 간격) · 추이는 KRX 일별 수정주가 60일");
  v.append(c.el);
  const tableEl = () => table(rows, [nameCol, { k: "시장", t: "시장", l: true }, { k: "종가", t: META?.live ? "현재가" : "종가", f: (r) => fmt(r["종가"]) },
    pctCol("등락률", "등락률", 2), { k: "spark", t: "60일 추이", f: (r) => sparkline(sparks[r.code]) }, { k: "거래대금", t: "거래대금(억)", f: (r) => eokWon(r["거래대금"]) },
    rsCol, pctCol("MA20이격", "20일선 이격"), pctCol("52주고점대비", "52주 고점비"), pctCol("추가후", "추가 후"), { k: "added", t: "추가일" }],
    { onRow: openStock, star: true });
  c.body.append(tableEl());
  await Promise.all(rows.map(async (r) => { const ch = await getChart(r.code); if (ch) sparks[r.code] = ch.c.slice(-60); }));
  c.body.innerHTML = ""; c.body.append(tableEl());
}

// ---- 종목 분석 --------------------------------------------------------------------
// 차트 아래 '지표 설명' — 지금 켠 지표만
const GUIDE = {
  "이동평균": ["최근 N개 봉 종가의 평균선 (일봉이면 5·20·60·120일, 주봉이면 주, 월봉이면 월).", "추세 방향을 봅니다. 주가가 선 위면 상승 추세, 아래면 하락 추세. 짧은 선이 긴 선 위로 차례로 놓이면(정배열) 강한 상승 추세입니다."],
  "볼린저밴드": ["20일 평균선 ± 2 표준편차의 띠. 주가의 약 95%가 이 안에서 움직입니다.", "띠가 좁아지면 큰 움직임이 다가온다는 신호, 상단을 뚫고 머물면 강한 상승, 하단 근처는 과매도 구간으로 봅니다."],
  "거래량": ["하루 동안 거래된 주식 수. 회색 선은 20일 평균.", "가격 움직임의 신뢰도를 봅니다. 평균보다 큰 거래량을 동반한 돌파는 믿을 만하고, 거래량 없는 상승은 약합니다."],
  "거래대금": ["하루 거래된 금액 (억원). 회색 선은 20일 평균.", "거래량보다 종목 간 비교가 쉽습니다. 돈이 몰리는 종목(관심 집중)을 찾을 때 씁니다."],
  "RSI": ["최근 14일 상승폭과 하락폭의 비율을 0~100으로 나타낸 값 (Wilder 방식).", "70 이상은 과열(과매수), 30 이하는 침체(과매도)로 봅니다. 강한 상승장에서는 70 이상이 오래 유지되기도 합니다."],
  "MACD": ["12일·26일 지수이동평균의 차이(MACD선)와 그 9일 평균(시그널선). 막대는 둘의 차이.", "MACD선이 시그널선을 위로 뚫으면 매수 신호, 아래로 뚫으면 매도 신호로 봅니다. 막대가 커지면 추세에 힘이 붙는 중입니다."],
  "RS 점수": ["RS 점수 페이지와 같은 점수(1~99)를 날짜별로 다시 계산한 추이. 기간은 RS 점수 페이지에서 고른 값을 씁니다.", "전 종목 중 이 종목 주가 흐름의 순위입니다. 80 이상(음영)이면 상위 20% 주도주, 점수가 오르는 중이면 시장 내 위상이 좋아지는 중입니다."],
  "Mansfield RS": ["(종목 주가 ÷ 시장 지수)를 그 1년(252거래일) 평균과 비교한 값, %. 지수는 소속 시장(KOSPI/KOSDAQ).", "0 위(빨강)면 지난 1년 평균보다 시장 대비 강하고, 0 아래(파랑)면 약합니다. 0선을 아래에서 위로 뚫는 시점을 강세 전환 신호로 봅니다 (스탠 와인스타인)."],
};
function guideTable(keys) {
  const rows = keys.filter((k) => GUIDE[k]).map((k) => h("tr", {}, h("th", {}, k), h("td", {}, GUIDE[k][0]), h("td", {}, GUIDE[k][1])));
  if (!rows.length) return h("div");
  return h("div", { class: "guide" }, h("div", { class: "guide-h" }, "지표 설명 — 지금 차트에 켠 지표"),
    h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "지표"), h("th", {}, "무엇인가"), h("th", {}, "어떻게 보나"))), h("tbody", {}, rows)),
    h("div", { class: "guide-f" }, "지표는 참고 도구일 뿐 단독으로 매매 신호가 되지는 않습니다. 여러 지표가 같은 방향을 가리킬 때 신뢰도가 높아집니다."));
}

async function renderStock(v, param) {
  const [map, market, dart] = await Promise.all([stockMap(), get("market.json"), get("dart.json")]);
  const code = param || UI.get("stock.last", "005930");
  UI.set("stock.last", code);
  const s = map.get(code);
  const input = h("input", { type: "search", list: "stock-list", placeholder: "종목명·ETF 이름이나 코드 입력", value: s ? `${s["종목명"]} (${code})` : code });
  const go = () => { const m = input.value.match(/\(([0-9A-Z]{6})\)/); const c = m ? m[1] : input.value.trim(); if (map.has(c)) location.hash = `#stock/${c}`; else toast("목록에서 종목을 고르세요"); };
  input.addEventListener("change", go);
  const star = h("button", { class: "btn" + (WL.has(code) ? "" : " primary"), onclick: () => { const on = WL.toggle(code, s?.["종목명"], s?.["종가"]); toast(on ? "관심종목에 추가" : "관심종목에서 뺌"); route(); } },
    WL.has(code) ? "★ 관심종목" : "☆ 관심종목 추가");
  v.append(h("section", { class: "card" }, h("div", { class: "search-row" }, input, h("button", { class: "btn", onclick: go }, "보기"), star)));
  if (!s) { v.append(h("div", { class: "note" }, "종목을 찾을 수 없습니다.")); return; }
  v.append(ph(s["종목명"], `${code} · ${s["시장"] ?? ""}${s["중분류"] ? " · " + s["중분류"] : ""} · ${basisLabel()}`));
  const isETF = s["시장"] === "ETF";
  const rank = [...map.values()].filter((x) => x["시장"] !== "ETF" && isNum(x["시가총액"]) && x["시가총액"] > s["시가총액"]).length + 1;
  const ch = await getChart(code, true);
  if (isETF && ch) {  // ETF 는 지표 파일이 없어 차트에서 52주 고점 대비를 계산
    const c252 = ch.c.slice(-252).filter(isNum), last = META?.live ? s["종가"] : ch.c[ch.c.length - 1];
    s["52주고점대비"] = c252.length ? (last / Math.max(...c252, last) - 1) * 100 : null;
  }
  v.append(h("div", { class: "grid g5 stack" },
    kpi(META?.live ? "현재가" : "종가", `${fmt(s["종가"])}원`, { delta: s["등락률"], dtext: pct(s["등락률"]), sub: META?.live ? META.basis : "KRX 공식 종가" }),
    kpi("시가총액", `${jo(s["시가총액"])}조원`, { sub: isETF ? `ETF · ${s["기초지수"] || ""}` : `전체 ${fmt(rank)}위` }),
    kpi("거래대금", `${eokWon(s["거래대금"])}억원`, { sub: `거래량 ${fmt(s["거래량"])}주` }),
    kpi("52주 고점 대비", pct(s["52주고점대비"], 1), { tone: s["52주고점대비"], sub: isETF ? "최근 252거래일 종가 기준" : `20일선 이격 ${pct(s["MA20이격"], 1)}` }),
    kpi(`RS 점수 · ${rsLabel()}`, isNum(s.RS) ? String(s.RS) : "–", { delta: s["RS변화1주"], dtext: signed(s["RS변화1주"]), sub: isNum(s.RS) ? "1주 전 대비 · 1~99" : isETF ? "ETF 는 RS 점수 없음" : `보통주·상장 ${rsLabel()} 이상만` })));

  const c = card();
  v.append(c.el);
  if (!ch) { c.body.append(h("div", { class: "empty" }, "이 종목은 차트 자료가 없습니다 (우선주·스팩 등은 보통주 차트만 제공).")); }
  else {
    const PANELS = ["거래량", "거래대금", "RSI", "MACD", "RS 점수", "Mansfield RS"];
    const st = { iv: UI.get("ta.iv", "일"), p: UI.get("ta.p2", "6개월"), ma: UI.get("ta.ma", [20, 60, 120]), bb: UI.get("ta.bb", false),
                 panels: UI.get("ta.panels2", ["거래량", "RS 점수"]).filter((x) => PANELS.includes(x)) };
    const KEY = { iv: "ta.iv", p: "ta.p2", ma: "ta.ma", bb: "ta.bb", panels: "ta.panels2" };
    const set = (k, x) => { st[k] = x; UI.set(KEY[k], x); route(); };
    c.body.append(h("div", { class: "controls stack" }, ctl("봉", seg([["일", "일봉"], ["주", "주봉"], ["월", "월봉"]], st.iv, (x) => set("iv", x))),
      ctl("처음 보이는 기간", seg(["3개월", "6개월", "1년", "3년", "5년"], st.p, (x) => set("p", x))),
      ctl("이동평균", chips([5, 20, 60, 120].map((n) => [n, `${n}${st.iv}`]), st.ma, (x) => set("ma", x.sort((a, b) => a - b)))),
      ctl("밴드", chips([["bb", "볼린저 (20, 2σ)"]], st.bb ? ["bb"] : [], (x) => set("bb", x.includes("bb")))),
      ctl("하단 지표", chips(PANELS, st.panels, (x) => set("panels", x)))));
    c.body.append(h("div", { class: "hint-row" }, "차트 위에서 마우스 휠을 아래로 굴리면 더 긴 기간(최대 5년), 위로 굴리면 확대 · 끌면 좌우 이동 · 아래 막대로도 범위 조절"));
    const bmk = s["시장"] === "KOSDAQ" ? "KOSDAQ" : "KOSPI";
    const liveToday = META?.live && META.bas_dd > String(ch.d[ch.d.length - 1]);
    const data = { ...ch, rs: ch[`rs${rsPeriod()}`]?.length ? ch[`rs${rsPeriod()}`] : null, bench: market?.index?.[bmk], benchName: bmk,
      live: liveToday ? { date: META.bas_dd, c: s["종가"], v: s["거래량"], a: isNum(s["거래대금"]) ? s["거래대금"] / 1e8 : null, rs: isNum(s.RS) ? s.RS : null } : null };
    const box = c.body.appendChild(h("div", { class: "chart" }));
    const res = MDChart.render(box, data, { interval: st.iv, window: st.p, ma: st.ma, bb: st.bb, panels: st.panels });
    charts.push(res.chart);
    const missing = [];
    if (res.missing.includes("RS 점수")) missing.push(isETF ? "RS 점수 (ETF 제외)" : `RS 점수 (보통주·상장 ${rsLabel()} 이상)`);
    if (res.missing.includes("Mansfield RS")) missing.push("Mansfield RS (상장 1년 이상)");
    if (missing.length) c.body.append(h("div", { class: "note" }, `이력이 부족해 표시할 수 없음: ${missing.join(" · ")}`));
    c.body.append(guideTable([...(st.ma.length ? ["이동평균"] : []), ...(st.bb ? ["볼린저밴드"] : []), ...st.panels]));
    c.el.append(h("div", { class: "src" }, `출처 KRX 공식 일별 시세 · 수정주가 · 이력 ${res.first || ""}부터 · RS 점수 추이는 최근 약 1년 반 · 지표는 표시 구간 이전 이력까지 포함해 계산${liveToday ? " · 마지막 봉은 오늘 현재가 (시가·고가·저가 없음)" : ""}`));
  }
  if (!isETF) await renderEarnings(v, code, s);
  await renderSupply(v, code, s);
  const mine = (dart || []).filter((r) => r["종목코드"] === code);
  const dc = card("최근 공시", `${mine.length}건`, "출처 OpenDART");
  v.append(dc.el);
  dc.body.append(mine.length ? table(mine.map((r) => ({ ...r })), [{ k: "접수일", t: "접수일", l: true }, { k: "보고서", t: "보고서", l: true },
    { k: "제출인", t: "제출인", l: true }, { k: "rcept_no", t: "원문", f: (r) => h("a", { href: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${r.rcept_no}`, target: "_blank", rel: "noopener" }, "열기") }],
    { sortKey: "접수일" }) : h("div", { class: "empty" }, "최근 공시가 없습니다."));
}

/** 실적 · 밸류에이션 — data/fin.json (분기 실적, 억원) + stocks.json 의 PER·PBR·ROE 등 (build.py, analytics.valuation) */
async function renderEarnings(v, code, s) {
  const fin = await get("fin.json");
  const c = card("실적 · 밸류에이션", "분기 실적 · 연결 우선",
    "출처 OpenDART 주요계정 (분기·반기·사업보고서, 4분기 = 연간 − 1~3분기) · PER·ROE 는 최근 4분기 순이익 합 (지배·비지배 합계라 근사치) · PBR 은 최근 분기말 자본총계");
  v.append(c.el);
  const f = fin?.[code];
  if (!f) { c.body.append(h("div", { class: "empty" }, "DART 실적이 없습니다 (금융사처럼 계정 이름이 다르거나 최근 상장 등).")); return; }
  const n1 = (x, d = 1, suf = "") => (isNum(x) ? fmt(x, d) + suf : "–");
  c.body.append(h("div", { class: "grid g6 stack" },
    kpi("PER", n1(s.PER, 1, "배"), { sub: isNum(s.PER) ? "최근 4분기 순이익" : "적자 또는 자료 없음" }),
    kpi("PBR", n1(s.PBR, 2, "배"), { sub: `${s["최근분기"] || ""} 자본 기준` }),
    kpi("ROE", n1(s.ROE, 1, "%"), { sub: "최근 4분기" }), kpi("영업이익률", n1(s["영업이익률"], 1, "%"), { sub: "최근 4분기" }),
    kpi(`매출 YoY · ${s["최근분기"] || ""}`, isNum(s["매출YoY"]) ? pct(s["매출YoY"], 1) : "–", { tone: s["매출YoY"], sub: "전년 같은 분기 대비" }),
    kpi(`영업이익 YoY · ${s["최근분기"] || ""}`, isNum(s["영업이익YoY"]) ? pct(s["영업이익YoY"], 1) : "–", { tone: s["영업이익YoY"],
      sub: s["영업이익연속증가"] ? `${s["영업이익연속증가"]}분기 연속 증가` : "전년 같은 분기 대비" })));
  const box = c.body.appendChild(h("div", { class: "chart" }));
  const margin = f.q.map((_, i) => (isNum(f["영업이익"][i]) && f["매출액"][i] ? +(f["영업이익"][i] / f["매출액"][i] * 100).toFixed(1) : null));
  requestAnimationFrame(() => chart(box, {
    grid: { left: 8, right: 8, top: 30, bottom: 24, containLabel: true }, legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 14, itemHeight: 6, textStyle: { color: C.ink2 } },
    xAxis: { type: "category", data: f.q, axisTick: { show: false }, axisLine: { lineStyle: { color: C.axis } }, axisLabel: { color: C.muted, fontSize: 11.5 } },
    yAxis: [axisY({ position: "left", scale: false, axisLabel: { color: C.muted, fontSize: 11.5, formatter: (x) => fmt(x) + "억" } }),
            axisY({ position: "right", scale: false, splitLine: { show: false }, axisLabel: { color: C.muted, fontSize: 11.5, formatter: (x) => x + "%" } })],
    tooltip: { trigger: "axis", formatter: (ps) => `${ps[0].axisValue}<br>` + ps.map((p) => `${p.marker}${p.seriesName} <b>${p.seriesName === "영업이익률" ? n1(p.value, 1, "%") : n1(p.value, 0, "억")}</b>`).join("<br>") },
    series: [{ name: "매출액", type: "bar", data: f["매출액"], itemStyle: { color: "#c9d6ea", borderRadius: 3 } },
             { name: "영업이익", type: "bar", color: C.up, data: f["영업이익"].map((x) => ({ value: x, itemStyle: { color: (x ?? 0) >= 0 ? C.up : C.down, borderRadius: 3 } })) },
             { name: "영업이익률", type: "line", yAxisIndex: 1, data: margin, color: C.ink, lineStyle: { width: 1.8 }, symbolSize: 6 }],
  }, 330));
}

/** 공매도 · 신용 · 대차 (시가총액 상위 종목만, 하루 한 번 생성 — build.py build_supply) */
async function renderSupply(v, code, s) {
  const c = card("공매도 · 신용 · 대차", "최근 약 6개월 · 일별",
    "출처 키움 ka10014 (공매도) · ka10013 (신용융자, 결제일 기준이라 하루 늦음) · ka20068 (대차거래) · 기준값은 경험칙 (신용잔고율 5%, 공매도 비중 10%, 대차잔고 20일 ±10%) · 하루 한 번 갱신");
  v.append(c.el);
  const d = await fetch(`data/supply/${code}.json?v=${META ? META.bas_dd : ""}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!d) { c.body.append(h("div", { class: "empty" }, "공개 사이트에서는 시가총액 상위 200종목만 제공합니다.")); return; }
  const m = d.m, f1 = (x, dd = 1, suf = "") => (isNum(x) ? fmt(x, dd) + suf : "–");
  const vsAvg = isNum(m["공매도평균가20"]) && isNum(s["종가"]) ? (s["종가"] / m["공매도평균가20"] - 1) * 100 : null;
  c.body.append(h("div", { class: "grid g4 stack" },
    kpi("공매도 비중 · 최근일", f1(m["공매도비중"], 1, "%"), { sub: `20일 평균 ${f1(m["공매도비중20"], 1, "%")} · 거래량 대비` }),
    kpi("20일 공매도 평균단가", f1(m["공매도평균가20"], 0, "원"), { sub: vsAvg != null ? `현재가는 ${pct(vsAvg, 1)}` : "" }),
    kpi("신용잔고율", f1(m["신용잔고율"], 2, "%"), { sub: `잔고 ${eok(m["신용잔고금액"]).replace("+", "")} · 20일 ${isNum(m["신용변화20"]) ? pct(m["신용변화20"], 0) : "–"}` }),
    kpi("대차잔고", isNum(m["대차잔고금액"]) ? eok(m["대차잔고금액"]).replace("+", "") : "–",
      { sub: `${isNum(m["대차비율"]) ? `상장주식의 ${fmt(m["대차비율"], 1)}% · ` : ""}20일 ${isNum(m["대차변화20"]) ? pct(m["대차변화20"], 0) : "–"}` })));
  const ST = { warn: ["주의", C.up, "#fff1f1"], good: ["우호", C.down, "#eef5ff"], info: ["참고", C.ink2, "#f3f4f6"] };
  for (const [lv, text] of d.signals || []) c.body.append(h("div", { style: { background: ST[lv][2], borderRadius: "8px", padding: "7px 11px", margin: "6px 0", fontSize: "13.5px" } },
    h("b", { style: { color: ST[lv][1] } }, ST[lv][0]), "  " + text));
  const box = c.body.appendChild(h("div", { class: "chart" }));
  const avg20 = d["공매도비중"].map((_, i, a) => { const w = a.slice(Math.max(0, i - 19), i + 1).filter(isNum); return w.length >= 5 ? +(w.reduce((x, y) => x + y, 0) / w.length).toFixed(2) : null; });
  const rows = [["공매도 비중 (%)", [{ name: "공매도 비중", type: "bar", data: d["공매도비중"], itemStyle: { color: C.series[4], borderRadius: 2 } },
                                  { name: "20일 평균", type: "line", showSymbol: false, data: avg20, color: C.ink2, lineStyle: { width: 1.4 } }], (x) => fmt(x, 2) + "%"],
    ["신용잔고 (억원)", [{ name: "신용잔고", type: "line", showSymbol: false, connectNulls: true, data: d["신용잔고금액"] || [], color: C.series[1], lineStyle: { width: 2 } }], (x) => fmt(x) + "억"],
    ["대차잔고 (만주)", [{ name: "대차잔고", type: "line", showSymbol: false, connectNulls: true, data: (d["대차잔고"] || []).map((x) => (isNum(x) ? Math.round(x / 1e4) : null)), color: C.series[0], lineStyle: { width: 2 } }], (x) => fmt(x) + "만주"]];
  const H = 140, G = 30;
  requestAnimationFrame(() => chart(box, {
    title: rows.map(([t], i) => ({ text: t, left: 4, top: i * (H + G), textStyle: { fontSize: 12, color: C.ink2, fontWeight: 500 } })),
    grid: rows.map((_, i) => ({ left: 8, right: 64, top: 20 + i * (H + G), height: H - 24 })),
    xAxis: rows.map((_, i) => axisX({ gridIndex: i, data: d.d, boundaryGap: true, axisLabel: { show: i === rows.length - 1, color: C.muted, fontSize: 11, ...dateTicks(d.d) } })),
    yAxis: rows.map((_, i) => axisY({ gridIndex: i, splitNumber: 2, axisLabel: { color: C.muted, fontSize: 10.5, formatter: (x) => fmt(x) } })),
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    tooltip: { trigger: "axis" },
    series: rows.flatMap(([, ss, vf], i) => ss.map((x) => ({ ...x, xAxisIndex: i, yAxisIndex: i, tooltip: { valueFormatter: vf } }))),
  }, rows.length * (H + G) + 10));
}

// ---- 내 투자 (매매 일지 · 포지션 관리) — 계산은 journal.js, 로컬 views/journal_page.py 와 같은 형식 ------------
async function renderJournal(v) {
  const J = window.MDJournal, map = await stockMap();
  const doc = J.store.load(), acc = doc.account;
  const prices = {}; for (const [k, s] of map) if (isNum(s["종가"])) prices[k] = s["종가"];
  const save = () => { if (!J.store.save(doc)) toast("이 브라우저에 저장할 수 없습니다 (사생활 보호 모드 등)"); route(); };
  const won = (x, sg = false) => (isNum(x) ? (sg && x > 0 ? "+" : "") + fmt(x) + "원" : "–");
  v.append(ph("내 투자", `매매 일지 · 포지션 관리 · 이 브라우저에만 저장 · 시세 ${basisLabel()}`));
  const pos = J.positions(doc, prices), perf = J.performance(doc);
  const value = pos.reduce((a, p) => a + (isNum(p.value) ? p.value : 0), 0), cost = pos.reduce((a, p) => a + p.qty * p.avg, 0), pnl = value - cost;
  const risk = pos.reduce((a, p) => a + (isNum(p.risk) ? p.risk : 0), 0), noStop = pos.filter((p) => !p.stop).length;
  v.append(h("div", { class: "grid g5 stack" },
    kpi("보유 평가금액", won(value), { sub: `${pos.length}종목 · 투자금의 ${fmt(value / acc.capital * 100)}%` }),
    kpi("평가손익", won(pnl, true), { tone: pnl, sub: cost ? `${pct(pnl / cost * 100)} (매수원가 대비)` : "" }),
    kpi("실현손익 누계", won(perf.realized, true), { tone: perf.realized, sub: `청산 ${perf.n}건` }),
    kpi("손절 시 총 손실", risk ? won(-risk, true) : "–", { tone: risk ? -risk : null, sub: `투자금의 ${fmt(risk / acc.capital * 100, 1)}%${noStop ? ` · 손절가 없는 종목 ${noStop}` : ""}` }),
    kpi("승률 · 손익비", isNum(perf.win_rate) ? `${fmt(perf.win_rate)}%${isNum(perf.payoff) ? " · " + perf.payoff.toFixed(2) : ""}` : "–", { sub: "청산한 매매 기준" })));
  const TABS = ["보유 포지션", "포지션 크기 계산", "매매 기록", "성과", "설정 · 백업"];
  const tab = TABS.includes(UI.get("jr.tab", TABS[0])) ? UI.get("jr.tab", TABS[0]) : TABS[0];
  v.append(h("div", { class: "stack" }, seg(TABS, tab, (x) => { UI.set("jr.tab", x); route(); })));
  const c = card(); v.append(c.el);
  const B = c.body;
  const picker = (onPick) => {
    const input = h("input", { type: "search", list: "stock-list", placeholder: "종목명·ETF 이름이나 코드 입력" });
    input.addEventListener("change", () => { const code = (input.value.match(/\(([0-9A-Z]{6})\)/) || [])[1] || input.value.trim(); if (map.has(code)) onPick(code, map.get(code)); });
    return input;
  };
  const numIn = (val, attrs = {}) => h("input", { type: "number", value: val ?? "", step: "any", min: "0", style: { width: "140px" }, ...attrs });
  const field = (label, el) => h("label", { class: "ctl" }, h("span", { class: "lbl" }, label), el);
  const nameOf = { k: "name", t: "종목", l: true, f: (r) => h("span", {}, h("span", { class: "name" }, r.name), h("span", { class: "code" }, r.code)) };

  if (tab === "보유 포지션") {
    if (!pos.length) B.append(h("div", { class: "empty" }, "보유 종목이 없습니다. '매매 기록' 탭에서 매수를 기록하세요."));
    for (const p of pos.filter((x) => x.below_stop)) B.append(h("div", { class: "note" }, `${p.name} 현재가 ${fmt(p.price)}원이 손절가 ${fmt(p.stop)}원 이하입니다.`));
    if (pos.length) {
      B.append(table(pos, [nameOf, { k: "qty", t: "수량", f: (r) => fmt(r.qty) }, { k: "avg", t: "평균단가", f: (r) => fmt(r.avg) }, { k: "price", t: "현재가", f: (r) => fmt(r.price) },
        { k: "value", t: "평가금액", f: (r) => fmt(r.value) }, { k: "pnl", t: "손익", f: (r) => signed(r.pnl), cls: (r) => sgn(r.pnl) }, pctCol("pnl_pct", "수익률", 2),
        { k: "weight", t: "비중", f: (r) => fmt(r.weight, 1) + "%" }, { k: "stop", t: "손절가", f: (r) => (r.stop ? fmt(r.stop) : "–") }, pctCol("to_stop", "손절까지", 1),
        { k: "risk", t: "손절 시 손실", f: (r) => (isNum(r.risk) ? signed(-r.risk) : "–"), cls: (r) => sgn(-r.risk) }, { k: "target", t: "목표가", f: (r) => (r.target ? fmt(r.target) : "–") },
        pctCol("to_target", "목표까지", 1), { k: "days", t: "보유일", f: (r) => r.days + "일" }], { sortKey: "value", onRow: openStock }));
      B.append(h("div", { class: "src" }, "손절 시 손실 = 지금 손절가에 모두 팔면 현재 평가금액에서 줄어드는 금액 · 비중·위험은 '설정' 탭의 투자금 기준"));
      const sel = h("select", {}, pos.map((p) => h("option", { value: p.code }, `${p.name} (${p.code})`)));
      const sIn = numIn(doc.meta[pos[0].code]?.stop), tIn = numIn(doc.meta[pos[0].code]?.target);
      sel.addEventListener("change", () => { sIn.value = doc.meta[sel.value]?.stop ?? ""; tIn.value = doc.meta[sel.value]?.target ?? ""; });
      B.append(h("div", { class: "sub-h", style: { marginTop: "14px" } }, "손절가 · 목표가 설정"),
        h("div", { class: "controls" }, field("종목", sel), field("손절가 (원, 비우면 없음)", sIn), field("목표가 (원, 비우면 없음)", tIn),
          h("button", { class: "btn primary", onclick: () => { const m = {}; if (+sIn.value > 0) m.stop = +sIn.value; if (+tIn.value > 0) m.target = +tIn.value; doc.meta[sel.value] = m; save(); } }, "저장")));
    }
  } else if (tab === "포지션 크기 계산") {
    B.append(h("div", { class: "src", style: { fontSize: "13px", marginBottom: "10px" } }, "매수가와 손절가를 정하면, 손절됐을 때 투자금의 몇 %까지만 잃을지에 맞춰 살 수량을 계산합니다. (수량 = 투자금 × 허용 손실% ÷ (매수가 − 손절가), 종목당 최대 비중을 넘으면 줄임)"));
    const st = UI.get("jr.size", {});
    const s = map.get(st.code) || map.get("005930");
    const entry = numIn(st.entry ?? s?.["종가"]), stop = numIn(st.stop ?? Math.round((s?.["종가"] || 0) * 0.92 / 10) * 10);
    const rk = numIn(st.risk ?? acc.risk_pct, { max: "10" }), mw = numIn(st.maxw ?? acc.max_weight, { max: "100" });
    const out = h("div");
    const calc = () => {
      UI.set("jr.size", { code: s?.code, entry: +entry.value, stop: +stop.value, risk: +rk.value, maxw: +mw.value });
      const r = J.positionSize(acc.capital, +rk.value, +entry.value, +stop.value, +mw.value);
      out.replaceChildren();
      if (!r.ok) { out.append(h("div", { class: "note" }, "손절가는 0보다 크고 매수가보다 낮아야 합니다.")); return; }
      out.append(h("div", { class: "grid g4 stack" }, kpi("살 수량", `${fmt(r.qty)}주`, { sub: `투자금 ${fmt(acc.capital)}원 기준` }),
        kpi("매수 금액", won(r.amount), { sub: `투자금의 ${fmt(r.weight, 1)}%${r.capped ? " · 비중 한도로 줄임" : ""}` }),
        kpi("손절 시 손실", won(-r.loss, true), { tone: -r.loss, sub: `투자금의 ${fmt(r.loss_pct, 2)}%` }), kpi("손절폭", `${fmt(r.stop_pct, 1)}%`, { sub: "매수가 대비" })),
        h("button", { class: "btn primary", disabled: r.qty <= 0 || !s, onclick: () => {
          doc.trades.push(J.newTrade(s.code, s["종목명"], "buy", J.today(), +entry.value, r.qty)); doc.meta[s.code] = { ...(doc.meta[s.code] || {}), stop: +stop.value };
          UI.set("jr.tab", "매매 기록"); save(); toast("매매 기록에 추가했습니다"); } }, `${s?.["종목명"] ?? ""} ${fmt(r.qty)}주 매수로 기록`));
    };
    [entry, stop, rk, mw].forEach((x) => x.addEventListener("input", calc));
    B.append(h("div", { class: "controls stack" }, field("종목", picker((code, x) => { UI.set("jr.size", { code, entry: x["종가"], stop: Math.round(x["종가"] * 0.92 / 10) * 10 }); route(); })),
      h("div", { class: "src" }, s ? `${s["종목명"]} (${s.code}) · 현재 ${fmt(s["종가"])}원` : "")),
      h("div", { class: "controls stack" }, field("매수가 (원)", entry), field("손절가 (원)", stop), field("1회 허용 손실 (%)", rk), field("종목당 최대 비중 (%)", mw)), out);
    calc();
  } else if (tab === "매매 기록") {
    let pick = null;
    const name = h("span", { class: "src" }, "종목을 고르세요");
    const side = { v: "buy" }, sideSeg = h("div");
    const drawSide = () => sideSeg.replaceChildren(seg([["buy", "매수"], ["sell", "매도"]], side.v, (x) => { side.v = x; drawSide(); }));
    drawSide();
    const date = h("input", { type: "date", value: J.today(), max: J.today() }), price = numIn(""), qty = numIn(""), fee = numIn(0), stop = numIn("");
    const memo = h("input", { type: "text", maxlength: "200", placeholder: "매매 이유 (선택)", style: { width: "320px" } });
    B.append(h("div", { class: "controls stack" }, field("종목", picker((code, x) => { pick = { code, name: x["종목명"] }; name.textContent = `${x["종목명"]} (${code}) · 현재 ${fmt(x["종가"])}원`; price.value = x["종가"]; })), name),
      h("div", { class: "controls stack" }, field("구분", sideSeg), field("날짜", date), field("가격 (원)", price), field("수량 (주)", qty), field("수수료·세금 (원)", fee)),
      h("div", { class: "controls stack" }, field("손절가 (매수 때, 선택)", stop), field("메모", memo),
        h("button", { class: "btn primary", onclick: () => {
          if (!pick) return toast("종목을 고르세요");
          if (!(+price.value > 0 && +qty.value > 0)) return toast("가격과 수량을 입력하세요");
          doc.trades.push(J.newTrade(pick.code, pick.name, side.v, date.value || J.today(), +price.value, +qty.value, +fee.value || 0, memo.value));
          if (side.v === "buy" && +stop.value > 0) doc.meta[pick.code] = { ...(doc.meta[pick.code] || {}), stop: +stop.value };
          save(); } }, "기록 추가")));
    if (!doc.trades.length) B.append(h("div", { class: "empty" }, "아직 기록이 없습니다."));
    else B.append(table(doc.trades.slice().reverse(), [{ k: "date", t: "날짜", l: true }, { k: "name", t: "종목", l: true }, { k: "side", t: "구분", f: (r) => (r.side === "buy" ? "매수" : "매도"), cls: (r) => (r.side === "buy" ? "up" : "down") },
      { k: "price", t: "가격", f: (r) => fmt(r.price) }, { k: "qty", t: "수량", f: (r) => fmt(r.qty) }, { k: "amt", t: "금액", v: (r) => r.price * r.qty, f: (r) => fmt(r.price * r.qty) },
      { k: "fee", t: "수수료", f: (r) => fmt(r.fee) }, { k: "memo", t: "메모", l: true }, { k: "del", t: "", f: (r) => h("button", { class: "btn", onclick: (e) => { e.stopPropagation(); if (confirm(`${r.date} ${r.name} ${r.side === "buy" ? "매수" : "매도"} 기록을 지울까요?`)) { doc.trades = doc.trades.filter((x) => x.id !== r.id); save(); } } }, "삭제") }],
      { limit: 1000 }));
  } else if (tab === "성과") {
    if (!perf.n) B.append(h("div", { class: "empty" }, "청산(매도)한 매매가 아직 없습니다."));
    else {
      B.append(h("div", { class: "grid g4 stack" }, kpi("평균 이익", isNum(perf.avg_win) ? pct(perf.avg_win, 1) : "–", { sub: "이긴 매매 평균" }),
        kpi("평균 손실", isNum(perf.avg_loss) ? pct(perf.avg_loss, 1) : "–", { sub: "진 매매 평균" }), kpi("기대값", pct(perf.expectancy), { tone: perf.expectancy, sub: "1회 매매 평균 수익률" }),
        kpi("평균 보유", `${fmt(perf.avg_days)}일`, { sub: "첫 매수 ~ 매도" })));
      const byDay = new Map(); for (const x of perf.closed) byDay.set(x.date, (byDay.get(x.date) || 0) + x.pnl);
      const ds = [...byDay.keys()].sort(); let run = 0; const cum = ds.map((d) => (run += byDay.get(d)));
      if (ds.length >= 2) { const box = B.appendChild(h("div", { class: "chart" })); requestAnimationFrame(() => lineChart(box, { 실현손익: { d: ds, v: cum } }, { height: 260, unit: "원", digits: 0, zero: true })); }
      B.append(table(perf.closed.slice().reverse(), [{ k: "date", t: "매도일", l: true }, { k: "name", t: "종목", l: true }, { k: "qty", t: "수량", f: (r) => fmt(r.qty) },
        { k: "buy", t: "평균 매수가", f: (r) => fmt(r.buy) }, { k: "sell", t: "매도가", f: (r) => fmt(r.sell) }, { k: "pnl", t: "손익", f: (r) => signed(r.pnl), cls: (r) => sgn(r.pnl) },
        pctCol("pnl_pct", "수익률", 2), { k: "days", t: "보유일", f: (r) => r.days + "일" }], { limit: 1000 }));
    }
  } else {
    const cap = numIn(acc.capital, { step: "1000000" }), rk = numIn(acc.risk_pct, { max: "10" }), mw = numIn(acc.max_weight, { max: "100" });
    B.append(h("div", { class: "controls stack" }, field("투자금 (원)", cap), field("1회 허용 손실 (%) · 보통 0.5~2", rk), field("종목당 최대 비중 (%)", mw),
      h("button", { class: "btn primary", onclick: () => { doc.account = { capital: +cap.value || acc.capital, risk_pct: +rk.value || acc.risk_pct, max_weight: +mw.value || acc.max_weight }; save(); toast("저장했습니다"); } }, "저장")));
    const file = h("input", { type: "file", accept: "application/json,.json", style: { display: "none" } });
    file.addEventListener("change", async () => {
      try { const d = J.normalize(JSON.parse(await file.files[0].text())); if (confirm(`매매 기록 ${d.trades.length}건으로 지금 기록을 바꿀까요?`)) { J.store.save(d); route(); toast("가져왔습니다"); } }
      catch { toast("JSON 파일을 읽지 못했습니다"); }
    });
    const exp = () => { const blob = new Blob([JSON.stringify(J.normalize(doc), null, 1)], { type: "application/json" }); const a = h("a", { href: URL.createObjectURL(blob), download: `market-desk-journal-${J.today().replace(/-/g, "")}.json` }); a.click(); URL.revokeObjectURL(a.href); };
    B.append(h("div", { class: "sub-h", style: { marginTop: "8px" } }, "백업 · 옮기기"),
      h("div", { class: "src", style: { fontSize: "13px" } }, "기록은 이 브라우저에만 있습니다. 브라우저 데이터를 지우면 사라지니 가끔 내보내 두세요. 로컬 대시보드의 '내 투자'와 같은 형식이고, 나중에 로그인 사이트로 옮길 때도 이 파일을 씁니다."),
      h("div", { class: "controls", style: { marginTop: "8px" } }, h("button", { class: "btn", onclick: exp }, "내보내기 (JSON)"), h("button", { class: "btn", onclick: () => file.click() }, "가져오기 (지금 기록을 바꿔치기)"), file));
  }
  v.append(h("div", { class: "src" }, "이 기능은 기록·계산 도구이며 투자 권유가 아닙니다. 현재가는 마지막 업데이트 시세입니다."));
}

// ---- 포트폴리오 제안 — 계산은 portfolio.py (publish/build.py → data/portfolio.json), 로컬 views/portfolio_page.py 와 같은 내용 ----
async function renderPortfolio(v) {
  const P = await get("portfolio.json");
  v.append(ph("포트폴리오 제안", `버핏(품질·가치) + 미너비니(추세·실적 가속) · 운용 가이드라인 한도 · ${basisLabel()}`));
  if (!P) { v.append(h("div", { class: "empty" }, "포트폴리오 자료가 아직 없습니다.")); return; }
  const R = P.regime, Q = P.proposal, M = P.model || {}, S = M.summary;
  v.append(h("div", { class: "grid g4 stack" },
    kpi("시장 국면", R.label, { sub: `조건 ${R.n}/3 충족` }),
    kpi("목표 주식 비중", `${fmt(Q.stock, 1)}%`, { sub: `국면 기준 ${fmt(R.equity)}% · ${Q.rows.length}종목` }),
    kpi("목표 현금", `${fmt(Q.cash, 1)}%`, { sub: "10~50%, 가급적 낮게" }),
    kpi("모델 수익률", S ? pct(S.ret) : "–", { tone: S ? S.ret : null, sub: S ? `코스피 ${pct(S.kospi)} · 초과 ${isNum(S.excess) ? (S.excess > 0 ? "+" : "") + S.excess.toFixed(2) + "%p" : "–"}` : "기록 시작 전" })));
  // 매매 시간 안내 (한국 시간 기준)
  const kst = new Date(Date.now() + (new Date().getTimezoneOffset() + 540) * 60000), hm = kst.getHours() * 60 + kst.getMinutes();
  const win = P.rules.windows.map(([a, b]) => [a, b, +a.slice(0, 2) * 60 + +a.slice(3), +b.slice(0, 2) * 60 + +b.slice(3)]);
  const market = await get("market.json");
  const extreme = (market?.ticker || []).some((t) => t.fmt === "idx" && Math.abs(t.chg) >= P.rules.extreme);
  const inWin = kst.getDay() > 0 && kst.getDay() < 6 && win.some((w) => hm >= w[2] && hm < w[3]);
  const wins = win.map((w) => `${w[0]}–${w[1]}`).join(" · ");
  v.append(h("div", { class: "note stack" }, extreme ? `오늘은 코스피·코스닥 중 하나가 ±${P.rules.extreme}% 이상 움직였습니다 → 가이드라인상 언제든 매매 가능합니다.`
    : inWin ? `지금은 매매 권장 시간입니다 (${wins}).` : `매매 권장 시간: ${wins} (코스피·코스닥 하루 ±${P.rules.extreme}% 이상이면 언제든).`));

  const TABS = ["제안 비중", "후보 점수", "모델 포트폴리오", "백테스트", "규칙"];
  const tab = TABS.includes(UI.get("pf.tab", TABS[0])) ? UI.get("pf.tab", TABS[0]) : TABS[0];
  v.append(h("div", { class: "stack" }, seg(TABS, tab, (x) => { UI.set("pf.tab", x); route(); })));
  const n0 = (x) => (isNum(x) ? fmt(x) : "–");
  const scoreCols = [{ k: "점수", t: "점수", f: (r) => n0(r["점수"]) }, { k: "품질", t: "품질", f: (r) => n0(r["품질"]) }, { k: "가치", t: "가치", f: (r) => n0(r["가치"]) },
    { k: "성장", t: "성장", f: (r) => n0(r["성장"]) }, { k: "추세", t: "추세", f: (r) => n0(r["추세"]) }, { k: "트렌드", t: "트렌드 템플릿", f: (r) => `${r["트렌드"] ?? "–"}/8` },
    { k: "RS", t: "RS", f: (r) => n0(r.RS) }, { k: "ROE", t: "ROE", f: (r) => (isNum(r.ROE) ? fmt(r.ROE, 1) + "%" : "–") }, { k: "PER", t: "PER", f: (r) => (isNum(r.PER) ? fmt(r.PER, 1) : "–") },
    pctCol("영업이익YoY", "영업이익 YoY", 0)];

  if (tab === "제안 비중") {
    const c = card("목표 비중", `점수 상위 종목 · 한도 안에서 점수 비례 · 현금 ${fmt(Q.cash, 1)}%`, "삼성전자·SK하이닉스는 시장 비중 × 점수 기울기(0.5~1.5배) × 주식 비중 · 나머지는 점수 비례, 한도에 막힌 몫은 다음 순위 종목 → 현금");
    v.append(c.el);
    if (!Q.rows.length) c.body.append(h("div", { class: "empty" }, "관문을 모두 통과한 종목이 없어 이번엔 전부 현금입니다."));
    else c.body.append(table(Q.rows, [nameCol, { k: "대분류", t: "업종", l: true },
      { k: "비중", t: "목표 비중", f: (r) => h("span", {}, h("span", { class: "bar" }, h("i", { style: { width: Math.min(100, r["비중"] / 15 * 100) + "%" } })), fmt(r["비중"], 1) + "%") },
      { k: "한도", t: "한도", f: (r) => fmt(r["한도"]) + "%" }, ...scoreCols, { k: "근거", t: "근거", l: true }], { sortKey: "비중", onRow: openStock, maxH: 520 }));
    const g = h("div", { class: "grid g-3-2 stack" });
    v.append(g);
    const sc = card("업종 비중과 상한", "WICS 대분류 · 시장 비중은 코스피+코스닥 시가총액 기준");
    sc.body.append(table(Q.sectors, [{ k: "업종", t: "업종", l: true }, { k: "시장비중", t: "시장 비중", f: (r) => fmt(r["시장비중"], 1) + "%" },
      { k: "상한", t: "포트폴리오 상한", f: (r) => fmt(r["상한"], 1) + "%" },
      { k: "포트폴리오", t: "포트폴리오", f: (r) => h("span", {}, h("span", { class: "bar" }, h("i", { style: { width: Math.min(100, r["포트폴리오"] / Math.max(r["상한"], 1) * 100) + "%" } })), fmt(r["포트폴리오"], 1) + "%") }],
      { sortKey: "시장비중", maxH: 420, hint: "막대 = 상한 대비 사용량" }));
    const ck = card("가이드라인 점검");
    for (const x of Q.checks) ck.body.append(h("div", { class: "pf-check" }, h("b", { class: x["지킴"] ? "ok" : "bad" }, x["지킴"] ? "지킴" : "위반"), h("span", {}, x["규칙"]), h("span", { class: "v" }, x["값"])));
    ck.body.append(h("div", { class: "pf-sub" }, `시장 국면: ${R.label} → 주식 ${fmt(R.equity)}% · 현금 ${fmt(R.cash)}%`));
    for (const x of R.checks) ck.body.append(h("div", { class: "pf-check" }, h("b", { class: x["충족"] ? "ok" : "bad" }, x["충족"] ? "충족" : "미충족"), h("span", {}, x["조건"]), h("span", { class: "v" }, x["값"])));
    g.append(sc.el, ck.el);
  } else if (tab === "후보 점수") {
    const gates = P.gates || {};
    const c = card("관문 통과 종목 점수 상위 40", ["통과", "추세", "실적", "유동성"].map((k) => `${k} ${fmt(gates[k] || 0)}`).join(" · "),
      `관문: 유동성(시총 ${fmt(P.rules.min_cap / 1e8)}억·거래대금 ${fmt(P.rules.min_value / 1e8)}억) → 실적(순이익 흑자·ROE 8%·부채비율 200%) → 추세(200일선 위·52주 고점 −35% 이내) · 점수는 관문 통과 종목끼리 백분위`);
    v.append(c.el);
    c.body.append(table(P.candidates, [nameCol, { k: "대분류", t: "업종", l: true }, { k: "시가총액", t: "시총(조)", f: (r) => jo(r["시가총액"]) }, ...scoreCols,
      { k: "PBR", t: "PBR", f: (r) => (isNum(r.PBR) ? fmt(r.PBR, 2) : "–") }, { k: "부채비율", t: "부채비율", f: (r) => (isNum(r["부채비율"]) ? fmt(r["부채비율"]) + "%" : "–") }],
      { sortKey: "점수", onRow: openStock, star: true }));
    const mc = card("삼성전자 · SK하이닉스", "예외 한도 40% · 30% — 관문을 통과할 때만 시장 비중 기준으로 담습니다");
    v.append(mc.el);
    mc.body.append(table(P.mega, [nameCol, { k: "관문", t: "관문", l: true }, { k: "점수", t: "점수", f: (r) => n0(r["점수"]) },
      pctCol("MA200이격", "200일선 대비"), pctCol("52주고점대비", "52주 고점 대비"), { k: "트렌드", t: "트렌드 템플릿", f: (r) => `${r["트렌드"] ?? "–"}/8` },
      { k: "RS", t: "RS", f: (r) => n0(r.RS) }, { k: "ROE", t: "ROE", f: (r) => (isNum(r.ROE) ? fmt(r.ROE, 1) + "%" : "–") }], { onRow: openStock }));
  } else if (tab === "모델 포트폴리오") {
    if (!S) { v.append(h("div", { class: "empty" }, "모델 포트폴리오 기록이 아직 없습니다. 장 마감 뒤 첫 업데이트에서 시작합니다.")); return; }
    v.append(h("div", { class: "grid g5 stack" },
      kpi("모델 수익률", pct(S.ret), { tone: S.ret, sub: `${ymd(S.start)} 시작 · 1억 원 기준` }),
      kpi("코스피", pct(S.kospi), { tone: S.kospi, sub: "같은 기간" }),
      kpi("초과 수익", isNum(S.excess) ? (S.excess > 0 ? "+" : "") + S.excess.toFixed(2) + "%p" : "–", { tone: S.excess, sub: "모델 − 코스피" }),
      kpi("최대 낙폭", `${S.mdd.toFixed(2)}%`, { tone: S.mdd < 0 ? S.mdd : null, sub: "고점 대비" }),
      kpi("현금 비중", `${fmt(S.cash, 1)}%`, { sub: `매매 ${S.n_trades}건` })));
    const nc = card("누적 수익률 — 모델 vs 지수", "%, 시작일 = 0", `모델: ${P.rules.rebalance === "month" ? "월간" : "주간"} 리밸런싱(다음 거래일 시가 체결) · 손절 −8% · 수수료·세금 근사 반영`);
    v.append(nc.el);
    if (S.series.d.length >= 2) {
      const box = h("div", { class: "chart" }); nc.body.append(box);
      const ser = {}; for (const k of ["모델", "코스피", "코스닥"]) ser[k] = { d: S.series.d, v: S.series[k] };
      requestAnimationFrame(() => lineChart(box, ser, { height: 300, unit: "%", digits: 2, zero: true, colors: { 모델: "#e5383b", 코스피: "#1e6fd9", 코스닥: "#8b8f97" } }));
    } else nc.body.append(h("div", { class: "empty" }, "이틀 이상 쌓이면 그립니다."));
    if (M.holdings?.length) {
      const hc = card("보유 종목"); v.append(hc.el);
      hc.body.append(table(M.holdings, [nameCol, { k: "비중", t: "비중", f: (r) => fmt(r["비중"], 1) + "%" }, { k: "매수가", t: "매수가", f: (r) => fmt(r["매수가"]) },
        { k: "현재가", t: "현재가", f: (r) => fmt(r["현재가"]) }, pctCol("수익률", "수익률", 2), { k: "편입일", t: "편입일", l: true, f: (r) => ymd(r["편입일"]) }], { sortKey: "비중", onRow: openStock }));
    }
    if (M.pending?.orders?.length) {
      const pc = card("다음 거래일 시가 주문", `${ymd(M.pending.from)} 장 마감 기준`); v.append(pc.el);
      pc.body.append(table(M.pending.orders, [{ k: "name", t: "종목", l: true, f: (r) => h("span", { class: "name" }, r.name) },
        { k: "side", t: "구분", l: true, f: (r) => h("b", { class: r.side === "buy" ? "up" : "down" }, r.side === "buy" ? "매수" : "매도") },
        { k: "pct", t: "규모", f: (r) => (r.side === "buy" ? `${fmt(r.pct, 1)}%` : `보유의 ${fmt(r.frac * 100)}%`) }, { k: "why", t: "이유", l: true }], { hint: "" }));
    }
    if (M.trades?.length) {
      const tc = card("매매 기록", "최근 60건"); v.append(tc.el);
      tc.body.append(table(M.trades, [{ k: "date", t: "날짜", l: true, f: (r) => ymd(r.date) }, { k: "name", t: "종목", l: true, f: (r) => h("span", { class: "name" }, r.name) },
        { k: "side", t: "구분", l: true, f: (r) => h("b", { class: r.side === "매수" ? "up" : "down" }, r.side) }, { k: "price", t: "가격", f: (r) => fmt(r.price) },
        { k: "amount", t: "금액", f: (r) => fmt(r.amount) }, { k: "why", t: "이유", l: true }], { hint: "" }));
    }
  } else if (tab === "백테스트") {
    const B = P.backtest;
    if (!B) { v.append(h("div", { class: "empty" }, "백테스트 결과가 아직 없습니다.")); return; }
    const m = B.stats["모델"], k = B.stats["코스피"];
    v.append(h("div", { class: "src stack" }, `${B.start} ~ ${B.end} · 같은 규칙(관문·점수·한도·국면·손절·리밸런싱 주기)을 그날 알 수 있던 자료로 다시 계산 · ${B.generated} 계산`));
    v.append(h("div", { class: "grid g5 stack" },
      kpi("모델 누적", pct(m.total, 1), { tone: m.total, sub: `연 ${pct(m.cagr, 1)}` }),
      kpi("코스피 누적", pct(k.total, 1), { tone: k.total, sub: `연 ${pct(k.cagr, 1)}` }),
      kpi("연 초과 수익", (m.cagr - k.cagr > 0 ? "+" : "") + (m.cagr - k.cagr).toFixed(1) + "%p", { tone: m.cagr - k.cagr, sub: `코스피보다 앞선 날 ${fmt(B.beat_kospi_days)}%` }),
      kpi("최대 낙폭", `${m.mdd.toFixed(1)}%`, { tone: m.mdd, sub: `코스피 ${k.mdd.toFixed(1)}%` }),
      kpi("샤프 지수", m.sharpe.toFixed(2), { sub: `코스피 ${k.sharpe.toFixed(2)} · 평균 현금 ${fmt(B.avg_cash)}%` })));
    const nc = card("누적 수익률 — 모델 vs 지수", "%, 시작일 = 0", "체결은 다음 날 시가 · 수수료·세금 근사 · 코스피는 배당 제외 가격 지수");
    v.append(nc.el);
    const box = h("div", { class: "chart" }); nc.body.append(box);
    const ser = {}; for (const n of ["모델", "코스피", "코스닥"]) ser[n] = { d: B.series.d, v: B.series[n] };
    requestAnimationFrame(() => lineChart(box, ser, { height: 340, unit: "%", digits: 1, zero: true, colors: { 모델: "#e5383b", 코스피: "#1e6fd9", 코스닥: "#8b8f97" } }));
    const g = h("div", { class: "grid g-3-2 stack" }); v.append(g);
    const yc = card("연도별 수익률", "%");
    yc.body.append(table(B.yearly.map((r) => ({ ...r, 초과: r["모델"] - r["코스피"] })), [{ k: "연도", t: "연도", l: true }, pctCol("모델", "모델"), pctCol("코스피", "코스피"),
      pctCol("코스닥", "코스닥"), { k: "초과", t: "초과(코스피)", f: (r) => (r["초과"] > 0 ? "+" : "") + r["초과"].toFixed(1) + "%p", cls: (r) => sgn(r["초과"]) }], { sortKey: "연도", desc: false, hint: "" }));
    const T = B.trades, tc = card("매매", `매매 ${fmt(T.n)}건 · 매도 ${fmt(T.sells)}건`);
    if (isNum(T.win_rate)) tc.body.append(h("div", { class: "pf-sub" }, `승률 ${fmt(T.win_rate)}% · 평균 이익 ${pct(T.avg_win, 1)} · 평균 손실 ${pct(T.avg_loss, 1)}`));
    for (const [why, n] of Object.entries(T.reasons || {})) tc.body.append(h("div", { class: "pf-check" }, h("span", {}, why), h("span", { class: "v" }, `${fmt(n)}건`)));
    g.append(yc.el, tc.el);
    if (B.variants?.length) {
      const years = Object.keys(B.variants[0]).filter((k) => /^\d{4}$/.test(k));
      const vc = card("규칙 비교 — 같은 자료로 7가지", "연수익률 · 최대 낙폭 · 연도별 수익률 % · 채택: G",
        "A 처음 규칙(주간) → B 보유 30위 안 유지 → C 월간 리밸런싱 (D~G 는 모두 월간) → D 시총 5,000억·거래대금 50억 → E 삼성전자·SK하이닉스 추세 관문 예외 → F 손절 −12% / G 추세 점수 45% · 같은 자료에서 가장 좋은 것을 골랐으므로 실제 기대치는 이보다 낮게 볼 것");
      v.append(vc.el);
      vc.body.append(table(B.variants, [{ k: "규칙", t: "규칙", l: true, f: (r) => h("b", {}, r["규칙"]) }, pctCol("연수익률", "연수익률"),
        { k: "최대낙폭", t: "최대 낙폭", f: (r) => fmt(r["최대낙폭"], 1) + "%" }, { k: "샤프", t: "샤프", f: (r) => (isNum(r["샤프"]) ? r["샤프"].toFixed(2) : "–") },
        ...years.map((y) => pctCol(y, y, 0))], { hint: "" }));
    }
    v.append(h("div", { class: "src" }, "한계: WICS 업종 분류는 현재 것 · 그 사이 상장폐지된 회사는 DART 실적을 찾지 못해 후보에서 빠짐(결과가 다소 좋게 나올 수 있음) · 과거 성과가 미래 수익을 보장하지 않습니다."));
  } else {
    const c = card("규칙"); v.append(c.el);
    const W = P.rules.weights;
    c.body.append(h("div", { class: "pf-rules", html: `
<h4>운용 가이드라인 (사용자 지정)</h4><ul>
<li>종목당 15% 이하 · 예외: 삼성전자 40%, SK하이닉스 30% (2026-07-01부터). 두 종목은 <b>시장 비중 × 점수 기울기(0.5~1.5배) × 주식 비중</b>으로만 담아 근거 없는 큰 비중을 피함</li>
<li>WICS 대분류 업종 비중 ≤ 시장 비중 × 3 · 시장 비중 5% 이하 업종은 10%까지</li>
<li>시가총액 1조 미만 합계 30% 이하 · 1,000억 미만 편입 금지</li>
<li>현금 10~50% (가급적 낮게) · 매매는 ${wins} (지수 ±${P.rules.extreme}% 날은 언제든)</li>
<li>투자전략·기업분석 리포트는 참고만 하고, 리포트만 보고 매매하지 않음 (리포트 메모는 운영자 PC 에만 두고 이 사이트엔 올리지 않음)</li></ul>
<h4>시장 국면 → 주식 비중</h4><ul><li>코스피 &gt; 200일선 · 50일선 상승 · 시장 체력 50 이상 — 3개 충족 90%, 2개 75%, 1개 60%, 0개 50%</li></ul>
<h4>G 규칙 (2026-10-21 백테스트 7종 비교 후 채택 — '백테스트' 탭)</h4>
<h4>관문 (하나라도 걸리면 신규 편입 안 함)</h4><ol>
<li>유동성 — 시가총액 ${fmt(P.rules.min_cap / 1e8)}억 이상, 20일 평균 거래대금 ${fmt(P.rules.min_value / 1e8)}억 이상, 관리·투자주의환기·스팩 제외 (가이드라인 1,000억보다 엄격)</li>
<li>실적(버핏) — 최근 4분기 순이익 흑자, ROE 8% 이상, 금융 외에는 영업이익 흑자·부채비율 200% 이하</li>
<li>추세(미너비니) — 종가 &gt; 200일선, 52주 고점 대비 −35% 이내${P.rules.mega_trend ? "" : " · 삼성전자·SK하이닉스는 이 관문 예외 (실적만 맞으면 시장 비중 근처로)"}</li></ol>
<h4>점수 (0~100, 관문 통과 종목끼리 백분위)</h4><ul>
<li>품질 ${Math.round(W["품질"] * 100)}% (ROE · 영업이익률 · 영업이익 연속 증가) · 가치 ${Math.round(W["가치"] * 100)}% (이익수익률 · 1/PBR)</li>
<li>성장 ${Math.round(W["성장"] * 100)}% (분기 영업이익·매출 전년 대비) · 추세 ${Math.round(W["추세"] * 100)}% (트렌드 템플릿 충족 수 · RS)</li>
<li>비중: 점수 상위 12종목에 점수 비례 (이미 보유한 종목은 ${P.rules.hold_rank}위 안이면 유지), 한도에 막힌 몫은 다음 순위 → 현금</li></ul>
<h4>모델 포트폴리오 매매 규칙 (1억 원으로 시작한 것으로 기록)</h4><ul>
<li>${P.rules.rebalance === "month" ? "월간" : "주간"} 리밸런싱: 그 ${P.rules.rebalance === "month" ? "달" : "주"} 첫 장 마감 뒤 목표를 정하고 다음 거래일 시가에 체결, 목표와 ${P.rules.band}%p 넘게 다를 때만 · 현금이 55%를 넘으면 바로 다시 채움</li>
<li>손절: 매수가 −${P.rules.stop}% · 추세 이탈: 50일선 아래 + 거래량 1.5배 · 관문(유동성·실적) 탈락 → 다음 날 시가 매도</li>
<li>이익 실현: +${P.rules.trim}%에서 1/3 (한 번) · 수수료·세금 근사 반영</li></ul>
<h4>다음 단계</h4><ul><li>현금흐름(영업현금흐름·설비투자·FCF) 관문과 5년 ROE 안정성 — DART 전체 재무제표를 모아 붙일 예정</li></ul>` }));
  }
  v.append(h("div", { class: "src" }, "공개된 투자 원칙을 규칙으로 옮긴 계산이며 투자 권유가 아닙니다. 최종 판단과 주문은 직접 하세요."));
}

async function renderDart(v) {
  const dart = await get("dart.json");
  v.append(ph("공시", "OpenDART 최근 공시"));
  const st = { m: UI.get("dt.m", ["유가", "코스닥"]), q: UI.get("dt.q", "") };
  const set = (k, x) => { st[k] = x; UI.set("dt." + k, x); route(); };
  v.append(h("section", { class: "card" }, h("div", { class: "controls" }, ctl("시장", chips(["유가", "코스닥", "코넥스", "기타"], st.m, (x) => set("m", x))),
    ctl("검색", h("input", { type: "search", placeholder: "회사명 또는 보고서명 (예: 유상증자, 자기주식)", value: st.q, style: { width: "320px" }, onchange: (e) => set("q", e.target.value) })))));
  const rows = (dart || []).filter((r) => (!st.m.length || st.m.includes(r["시장"])) && (!st.q || (r["회사"] + r["보고서"]).includes(st.q)));
  const c = card(`${fmt(rows.length)}건`, `전체 ${fmt((dart || []).length)}건 중`, "출처 OpenDART");
  v.append(c.el);
  c.body.append(table(rows, [{ k: "접수일", t: "접수일", l: true }, { k: "시장", t: "시장", l: true }, { k: "회사", t: "회사", l: true, f: (r) => h("span", { class: "name" }, r["회사"]) },
    { k: "종목코드", t: "코드", l: true }, { k: "보고서", t: "보고서", l: true }, { k: "제출인", t: "제출인", l: true },
    { k: "rcept_no", t: "원문", f: (r) => h("a", { href: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${r.rcept_no}`, target: "_blank", rel: "noopener", onclick: (e) => e.stopPropagation() }, "열기") }],
    { onRow: (r) => r["종목코드"] && openStock({ code: r["종목코드"] }), limit: 500 }));
}

// =================================================================================
// 뼈대: 메뉴 · 시세 띠 · 라우팅 · 자동 갱신
// =================================================================================
const PAGES = [["market", "시장 개요", renderMarket], ["sector", "섹터", renderSector], ["flow", "수급", renderFlow], ["macro", "매크로", renderMacro],
  ["screener", "스크리너", renderScreener], ["rs", "RS 점수", renderRS], ["watch", "관심종목", renderWatch], ["portfolio", "포트폴리오", renderPortfolio], ["journal", "내 투자", renderJournal], ["stock", "종목 분석", renderStock], ["dart", "공시", renderDart]];

async function renderTicker() {
  const market = await get("market.json");
  const el = $("#ticker"); el.innerHTML = "";
  for (const t of market?.ticker || []) {
    const val = t.fmt === "idx" ? fmt(t.value, 2) : t.fmt === "fx" ? fmt(t.value, 1) : fmt(t.value, t.name.includes("3년") ? 3 : 2) + "%";
    const d = t.fmt === "idx" ? pct(t.chg) : t.fmt === "fx" ? signed(t.chg, 1) : signed(t.chg, t.name.includes("3년") ? 3 : 2);
    el.append(h("div", { class: "it" }, h("div", { class: "k" }, t.name), h("div", { class: "v" }, val, h("span", { class: "d " + sgn(t.chg) }, `${arrow(t.chg)} ${d}`))));
  }
  el.append(h("div", { class: "it" }, h("div", { class: "k" }, "기준"), h("div", { class: "basis" }, META ? `${ymd(META.bas_dd)} · ${META.live ? META.basis : "KRX 공식 종가"}` : "")));
  renderUpdated();
}

/** 오른쪽 위 '마지막 업데이트' — 실제 시각과 경과 시간. 자동 갱신은 운영자 PC 가 켜져 있는 평일에만 돌아서
 *  고정된 '10분마다' 대신 지금 데이터가 얼마나 지났는지를 보여 준다 (20분 이내 초록 · 2시간 이내 노랑 · 그 이상 회색). */
function renderUpdated() {
  const el = $("#updated");
  if (!META) { el.innerHTML = ""; return; }
  const t = new Date(META.generated.replace(" ", "T") + ":00+09:00");  // 생성 시각은 한국 시간
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  const ago = min < 1 ? "방금" : min < 60 ? `${min}분 전` : min < 1440 ? `${Math.floor(min / 60)}시간 ${min % 60 ? (min % 60) + "분 " : ""}전` : `${Math.floor(min / 1440)}일 전`;
  const state = min <= 20 ? "fresh" : min <= 120 ? "aging" : "stale";
  el.title = "평일 장중(운영자 PC가 켜져 있을 때) 약 10분마다 갱신됩니다. PC가 꺼져 있으면 마지막 업데이트 시점의 데이터가 보입니다.";
  el.innerHTML = `<span class="dot ${state}"></span><b>${META.generated.slice(5).replace("-", "/")}</b> 업데이트 · ${ago}`;
  $("#foot-meta").textContent = `업데이트 ${META.generated} (${ago}) · WICS ${ymd(META.wics_dd)}`;  // 휴대폰은 위 표시가 숨겨져 여기서 본다
}

async function stockDatalist() {
  if ($("#stock-list")) return;
  const map = await stockMap();
  const dl = h("datalist", { id: "stock-list" });
  [...map.values()].sort((a, b) => (b["시가총액"] || 0) - (a["시가총액"] || 0)).forEach((s) => dl.append(h("option", { value: `${s["종목명"]} (${s.code})${s["시장"] === "ETF" ? " · ETF" : ""}` })));
  document.body.append(dl);
}

let routing = 0;
async function route() {
  const token = ++routing;
  const [page, param] = (location.hash.slice(1) || "market").split("/");
  const entry = PAGES.find((p) => p[0] === page) || PAGES[0];
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.page === entry[0]));
  const view = $("#view");
  const scroll = window.scrollY;
  disposeCharts();
  // 차트가 제 너비를 잡도록 페이지 영역을 먼저 화면에 붙이고 그린다
  const fresh = h("div", { style: { minHeight: view.offsetHeight + "px" } });
  view.replaceChildren(fresh);
  try { await entry[2](fresh, param); } catch (e) { console.error(e); fresh.append(h("div", { class: "note" }, "화면을 그리는 중 오류가 났습니다: " + e.message)); }
  if (token !== routing) return;
  fresh.style.minHeight = "";
  charts.forEach((c) => c.resize());
  if (route.keepScroll) window.scrollTo(0, scroll);
  route.keepScroll = true;
  document.title = `${entry[1]} · Market Desk`;
}
window.addEventListener("hashchange", () => { route.keepScroll = false; route(); window.scrollTo(0, 0); });

async function loadMeta() {
  try { const r = await fetch(`data/meta.json?t=${Date.now()}`, { cache: "no-store" }); return r.ok ? await r.json() : null; } catch { return null; }
}
async function boot() {
  $("#nav").append(...PAGES.map(([id, label]) => h("a", { href: `#${id}`, "data-page": id }, label)));
  META = await loadMeta();
  if (!META) { $("#view").innerHTML = '<div class="note">데이터를 불러오지 못했습니다.</div>'; return; }
  await renderTicker();
  route.keepScroll = false;
  await route();
  stockDatalist();
  // 1분마다 새 데이터가 올라왔는지 확인 → 있으면 다시 그린다
  setInterval(async () => {
    renderUpdated();
    const m = await loadMeta();
    if (m && m.generated !== META.generated) {
      if (m.krx_dd !== META.krx_dd) for (const k of Object.keys(chartCache)) delete chartCache[k];  // 차트는 KRX 기준일이 바뀔 때만
      META = m;
      for (const k of Object.keys(cache)) delete cache[k];
      await renderTicker();
      await route();
      toast(`새 데이터 반영 (${m.generated})`);
    }
  }, 60000);
}
boot();
