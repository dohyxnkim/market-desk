/* 종목 차트 — 공개 사이트(app.js)와 로컬 Streamlit(views/stock.py 가 iframe 에 넣는다)이 같이 쓴다.
 *
 *   MDChart.render(el, data, opts) → { chart, missing }
 *   data: { d: [YYYYMMDD 정수], o, h, l, c, v, a: 같은 길이 배열 (수정주가, 거래대금은 억원),
 *           rs: [RS 점수] (d 와 같은 길이, 없으면 null), bench: { d: ["YYYY-MM-DD"], v: [지수] }, benchName,
 *           live: { date: "YYYYMMDD", c, o, h, l, v, a, rs, b } | null — d 마지막 날보다 새로운 오늘 시세 }
 *   opts: { interval: "일"|"주"|"월", window: "3개월"|"6개월"|"1년"|"3년"|"5년", ma: [5,20,…], bb: bool, panels: [...] }
 *
 * 처음엔 window 만큼만 보이고, 차트 위에서 마우스 휠을 내리면 더 긴 기간(가진 이력 전부, 최대 5년)으로 넓어진다.
 * 끌면 좌우로 이동, 아래 막대로도 범위를 바꿀 수 있다. 가격 축은 보이는 구간에 맞춰 다시 잡힌다.
 */
(function () {
  "use strict";
  const C = {
    up: "#e5383b", down: "#1e6fd9", ink: "#1f2328", ink2: "#4b5563", grid: "#eef0f3", axis: "#d5d9e0",
    series: ["#1e6fd9", "#f08c00", "#12a37f", "#7048e8", "#d6336c"],
    ma: { 5: "#f08c00", 20: "#12a37f", 60: "#7048e8", 120: "#495057" },
  };
  const FONT = "Pretendard, system-ui, -apple-system, 'Segoe UI', 'Malgun Gothic', sans-serif";
  const isNum = (v) => typeof v === "number" && isFinite(v);
  const fmt = (v, d = 0) => (isNum(v) ? v.toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
  const dash = (x) => { const s = String(x); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };

  // ---- 지표 ----------------------------------------------------------------------
  const sma = (a, n) => {
    const out = Array(a.length).fill(null); let sum = 0, cnt = 0;
    for (let i = 0; i < a.length; i++) {
      if (isNum(a[i])) { sum += a[i]; cnt++; }
      if (i >= n && isNum(a[i - n])) { sum -= a[i - n]; cnt--; }
      if (i >= n - 1 && cnt === n) out[i] = sum / n;
    }
    return out;
  };
  function ema(a, n) { const k = 2 / (n + 1); const out = []; a.forEach((x, i) => out.push(i ? x * k + out[i - 1] * (1 - k) : x)); return out; }
  function rsi(a, n = 14) {
    const out = Array(a.length).fill(null); let up = 0, dn = 0;
    for (let i = 1; i < a.length; i++) {
      const d = a[i] - a[i - 1], u = Math.max(d, 0), w = Math.max(-d, 0);
      if (i <= n) { up += u / n; dn += w / n; if (i === n) out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn); continue; }
      up = (up * (n - 1) + u) / n; dn = (dn * (n - 1) + w) / n; out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
    }
    return out;
  }
  function boll(a, n = 20, k = 2) {
    const mid = sma(a, n);
    return a.map((_, i) => { if (mid[i] == null) return [null, null]; const s = a.slice(i - n + 1, i + 1); const sd = Math.sqrt(s.reduce((t, x) => t + (x - mid[i]) ** 2, 0) / n); return [mid[i] + k * sd, mid[i] - k * sd]; });
  }

  /** 날짜 범주축 눈금: 보이는 기간에 따라 주·월·분기·연 단위 */
  function dateTicks(dates) {
    const span = dates.length > 1 ? (new Date(dates[dates.length - 1].slice(0, 10)) - new Date(dates[0].slice(0, 10))) / 864e5 : 0;
    const key = (d) => (span <= 100 ? Math.floor(new Date(d.slice(0, 10)) / (7 * 864e5)) : span <= 800 ? d.slice(0, 7) : span <= 1500 ? d.slice(0, 4) + Math.floor((+d.slice(5, 7) - 1) / 3) : d.slice(0, 4));
    const marks = dates.map((d, i) => i > 0 && key(d) !== key(dates[i - 1]));
    return { interval: (i) => marks[i], formatter: (d) => (span <= 100 ? d.slice(5, 10).replace("-", "/") : d.slice(2, 7).replace("-", ".")), hideOverlap: true };
  }

  // ---- 일봉 → 주봉·월봉 -------------------------------------------------------------
  function resample(rows, interval) {
    if (interval === "일") return rows;
    const key = (d) => {
      if (interval === "월") return d.slice(0, 7);
      const t = new Date(d + "T00:00:00Z"); const back = (t.getUTCDay() + 6) % 7;  // 그 주 월요일
      return new Date(t - back * 864e5).toISOString().slice(0, 10);
    };
    const out = [];
    for (const r of rows) {
      const k = key(r.d), last = out[out.length - 1];
      const hi = isNum(r.h) ? r.h : r.c, lo = isNum(r.l) ? r.l : r.c;
      if (!last || last.k !== k) {
        out.push({ k, d: r.d, o: isNum(r.o) ? r.o : r.c, h: hi, l: lo, c: r.c, v: r.v || 0, a: r.a || 0, rs: r.rs, b: r.b, live: r.live });
      } else {
        Object.assign(last, { d: r.d, h: Math.max(last.h, hi), l: Math.min(last.l, lo), c: r.c, v: last.v + (r.v || 0), a: last.a + (r.a || 0),
          rs: isNum(r.rs) ? r.rs : last.rs, b: isNum(r.b) ? r.b : last.b, live: last.live || r.live });
      }
    }
    return out;
  }

  const WINDOW_DAYS = { "3개월": 63, "6개월": 126, "1년": 252, "3년": 756, "5년": 1e9 };
  const BARS_PER = { "일": 1, "주": 5, "월": 21 };
  const MANSFIELD_N = { "일": 252, "주": 52, "월": 12 };
  const PRICE_H = 330, PAN_H = 110, GAP = 26, TOP0 = 30, SLIDER = 40;
  /** 차트 높이 — views/stock.py 의 iframe 높이도 이 식을 따른다 */
  const height = (nPanels) => TOP0 + PRICE_H + nPanels * (PAN_H + GAP) + 30 + SLIDER;

  function render(el, data, opts) {
    const iv = opts.interval || "일", unit = iv;
    const panels = opts.panels || [], P = panels.length;
    // 1) 일봉 행 + 지수 (전일 값으로 채움) + 오늘 실시간
    const bd = data.bench?.d || [], bv = data.bench?.v || [];
    let rows = data.d.map((x, i) => ({ d: dash(x), o: data.o[i], h: data.h[i], l: data.l[i], c: data.c[i], v: data.v[i], a: data.a[i], rs: data.rs ? data.rs[i] : null }));
    const L = data.live;
    if (L && isNum(L.c) && (!rows.length || L.date > String(data.d[data.d.length - 1]))) {
      rows.push({ d: dash(L.date), o: L.o, h: L.h, l: L.l, c: L.c, v: L.v, a: L.a, rs: L.rs, b: L.b, live: true, noOHL: !isNum(L.o) });
    }
    let j = 0, lastB = null;
    for (const r of rows) {
      while (j < bd.length && bd[j] <= r.d) { if (isNum(bv[j])) lastB = bv[j]; j++; }
      if (!isNum(r.b)) r.b = lastB;
    }
    // 2) 주봉·월봉
    rows = resample(rows, iv);
    const N = rows.length;
    const close = rows.map((r) => r.c);
    const X = rows.map((r) => (r.live && iv === "일" ? `${r.d} (오늘)` : r.d));
    const bars = Math.ceil((WINDOW_DAYS[opts.window] || 126) / BARS_PER[iv]);
    const start = Math.max(0, N - bars);

    // 3) 격자·축
    const grids = [{ left: 8, right: 76, top: TOP0, height: PRICE_H }];
    panels.forEach((_, i) => grids.push({ left: 8, right: 76, top: TOP0 + PRICE_H + GAP + i * (PAN_H + GAP), height: PAN_H }));
    const all = grids.map((_, i) => i);
    const xAxes = grids.map((_, i) => ({ type: "category", data: X, gridIndex: i, boundaryGap: true, axisLine: { lineStyle: { color: C.axis } }, axisTick: { show: false },
      axisLabel: { show: i === grids.length - 1, color: C.ink2, fontSize: 11, ...dateTicks(X) } }));
    const yAxes = grids.map((_, i) => ({ type: "value", scale: true, position: "right", gridIndex: i, splitNumber: i ? 2 : 5, splitLine: { lineStyle: { color: C.grid, type: [2, 3] } },
      axisLabel: { color: C.ink2, fontSize: 11, formatter: (x) => (i && Math.abs(x) >= 1e6 ? (x / 1e6).toFixed(0) + "M" : fmt(x, Math.abs(x) < 10 && x % 1 ? 2 : 0)) } }));

    // 4) 가격 패널
    const series = [];
    if (opts.bb) {
      const b = boll(close);
      series.push({ name: "BB 상단", type: "line", data: b.map((x) => x[0]), showSymbol: false, lineStyle: { color: "#adb5bd", width: 1 } });
      series.push({ name: "볼린저(20,2)", type: "line", data: b.map((x) => x[1]), showSymbol: false, lineStyle: { color: "#adb5bd", width: 1 } });
    }
    series.push({ name: `${unit}봉`, type: "candlestick",
      data: rows.map((r) => (r.noOHL && iv === "일" ? ["-", "-", "-", "-"] : [isNum(r.o) ? r.o : r.c, r.c, isNum(r.l) ? r.l : r.c, isNum(r.h) ? r.h : r.c])),
      itemStyle: { color: C.up, color0: C.down, borderColor: C.up, borderColor0: C.down } });
    for (const n of opts.ma || []) series.push({ name: `${n}${unit}선`, type: "line", data: sma(close, n), showSymbol: false, lineStyle: { color: C.ma[n], width: 1.6 }, color: C.ma[n] });
    const last = rows[N - 1], prev = rows[N - 2];
    if (last?.noOHL && iv === "일") {
      series.push({ name: "현재가", type: "scatter", data: X.map((_, i) => (i === N - 1 ? last.c : null)), symbolSize: 9, itemStyle: { color: !prev || last.c >= prev.c ? C.up : C.down },
        label: { show: true, position: "left", formatter: () => `현재 ${fmt(last.c)}`, color: C.ink, fontSize: 11, fontWeight: 600 } });
    }
    if (last) {
      series.push({ type: "line", data: [], markLine: { silent: true, symbol: "none", label: { position: "end", formatter: fmt(last.c), color: "#fff",
        backgroundColor: prev && last.c < prev.c ? C.down : C.up, padding: [2, 5], borderRadius: 3 }, lineStyle: { color: "#adb5bd", type: "dashed" }, data: [{ yAxis: last.c }] } });
    }

    // 5) 하단 지표
    const barColor = rows.map((r) => (r.c >= (isNum(r.o) ? r.o : r.c) ? "rgba(229,56,59,.5)" : "rgba(30,111,217,.5)"));
    const rp = rows.map((r) => (isNum(r.c) && isNum(r.b) ? r.c / r.b : null));
    const mN = MANSFIELD_N[iv], rpMA = sma(rp, mN);
    const mansfield = rp.map((x, i) => (isNum(x) && isNum(rpMA[i]) ? +((x / rpMA[i] - 1) * 100).toFixed(2) : null));
    const rsLine = rows.map((r) => (isNum(r.rs) ? r.rs : null));
    panels.forEach((p, k) => {
      const gi = k + 1, base = { xAxisIndex: gi, yAxisIndex: gi };
      if (p === "거래량" || p === "거래대금") {
        const src = rows.map((r) => (p === "거래량" ? r.v : r.a));
        series.push({ ...base, name: p, type: "bar", data: src.map((x, i) => (x == null ? null : { value: x, itemStyle: { color: barColor[i] } })) });
        series.push({ ...base, name: `${p} 20${unit} 평균`, type: "line", data: sma(src, 20), showSymbol: false, lineStyle: { color: C.ink2, width: 1.2 } });
      } else if (p === "RSI") {
        series.push({ ...base, name: "RSI(14)", type: "line", data: rsi(close), showSymbol: false, lineStyle: { color: C.series[3], width: 1.6 },
          markLine: { silent: true, symbol: "none", lineStyle: { color: "#adb5bd", type: "dotted" }, label: { show: false }, data: [{ yAxis: 70 }, { yAxis: 30 }] } });
        Object.assign(yAxes[gi], { min: 0, max: 100, interval: 30, scale: false });
      } else if (p === "MACD") {
        const e12 = ema(close, 12), e26 = ema(close, 26), m = e12.map((x, i) => x - e26[i]), sg = ema(m, 9);
        series.push({ ...base, name: "히스토그램", type: "bar", data: m.map((x, i) => ({ value: +(x - sg[i]).toFixed(2), itemStyle: { color: x - sg[i] >= 0 ? "rgba(229,56,59,.45)" : "rgba(30,111,217,.45)" } })) });
        series.push({ ...base, name: "MACD", type: "line", data: m, showSymbol: false, lineStyle: { color: C.series[0], width: 1.5 } });
        series.push({ ...base, name: "시그널", type: "line", data: sg, showSymbol: false, lineStyle: { color: C.series[1], width: 1.5 } });
      } else if (p === "RS 점수") {
        series.push({ ...base, name: "RS 점수", type: "line", step: "end", data: rsLine, showSymbol: false, lineStyle: { color: C.series[2], width: 1.8 },
          markArea: { silent: true, itemStyle: { color: "rgba(229,56,59,.06)" }, data: [[{ yAxis: 80 }, { yAxis: 100 }]] },
          markLine: { silent: true, symbol: "none", lineStyle: { color: "#adb5bd", type: "dotted" }, label: { show: false }, data: [{ yAxis: 80 }] } });
        Object.assign(yAxes[gi], { min: 0, max: 100, interval: 20, scale: false });
      } else if (p === "Mansfield RS") {
        series.push({ ...base, name: `Mansfield RS (${data.benchName || "지수"} 대비)`, type: "bar",
          data: mansfield.map((x) => (x == null ? null : { value: x, itemStyle: { color: x >= 0 ? "rgba(229,56,59,.55)" : "rgba(30,111,217,.55)" } })),
          markLine: { silent: true, symbol: "none", lineStyle: { color: C.axis }, label: { show: false }, data: [{ yAxis: 0 }] } });
        yAxes[gi].axisLabel.formatter = (x) => x + "%";
      }
    });
    const titles = panels.map((p, k) => ({ text: p === "Mansfield RS" ? `Mansfield RS (${data.benchName || "지수"} 대비, ${mN}${unit} 평균 기준)` : p,
      left: 10, top: grids[k + 1].top - 18, textStyle: { fontSize: 12, color: C.ink2, fontWeight: 500 } }));

    // 6) 그리기 — 휠: 확대·축소 (아래로 굴리면 더 긴 기간), 끌기: 이동, 아래 막대: 범위
    const H = height(P);
    el.style.height = H + "px";
    const chart = echarts.init(el, null, { renderer: "canvas" });
    chart.setOption({
      textStyle: { fontFamily: FONT, color: C.ink }, animation: false,
      grid: grids, xAxis: xAxes, yAxis: yAxes, series, title: titles,
      legend: { top: 0, left: 0, data: [`${unit}봉`, ...(opts.ma || []).map((n) => `${n}${unit}선`), ...(opts.bb ? ["볼린저(20,2)"] : [])], textStyle: { color: C.ink2 } },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      tooltip: { trigger: "axis", backgroundColor: "rgba(255,255,255,.97)", borderColor: "#e3e5e8", borderRadius: 8, padding: [8, 11], extraCssText: "box-shadow:0 6px 18px rgba(15,23,41,.10);", textStyle: { color: C.ink, fontSize: 12 },
        axisPointer: { type: "cross", label: { backgroundColor: "#4b5563" } }, valueFormatter: (x) => (isNum(x) ? fmt(x, Math.abs(x) < 100 ? 2 : 0) : x) },
      dataZoom: [
        { type: "inside", xAxisIndex: all, startValue: start, endValue: N - 1, minValueSpan: 10, zoomOnMouseWheel: true, moveOnMouseMove: true },
        { type: "slider", xAxisIndex: all, startValue: start, endValue: N - 1, height: 18, bottom: 8, showDetail: false, brushSelect: false,
          borderColor: C.axis, fillerColor: "rgba(30,111,217,.12)", handleStyle: { color: "#fff", borderColor: "#9aa0a6" }, textStyle: { color: C.ink2 } },
      ],
    });
    if (!window.__mdResize) { window.__mdResize = true; window.addEventListener("resize", () => document.querySelectorAll("[_echarts_instance_]").forEach((n) => echarts.getInstanceByDom(n)?.resize())); }
    const missing = [];
    if (panels.includes("RS 점수") && !rsLine.some(isNum)) missing.push("RS 점수");
    if (panels.includes("Mansfield RS") && !mansfield.some(isNum)) missing.push("Mansfield RS");
    return { chart, missing, bars: N, first: rows[0]?.d };
  }

  window.MDChart = { render, height, ind: { sma, ema, rsi, boll } };
})();
