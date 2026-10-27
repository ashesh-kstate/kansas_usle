/*
 * USLE calculator page shell. Renders into
 *   <div id="usle-app" data-base="..." data-landuse="ag|urban"></div>
 * data-base: folder holding data/ and img/ (default: same folder as the page).
 * data-landuse: which land-use module to use (default "ag"). The module
 *   (usle-ui-ag.js or usle-ui-urban.js) must load before this file and
 *   supplies steps 4-5 (C and P); this file handles everything shared:
 *   R, K, LS, results, what-if bars, scenarios, links.
 * data-href-ag / data-href-urban: optional links between the two tools.
 * All math lives in usle-model.js / usle-urban-model.js.
 */
(function () {
  "use strict";

  const SHARED_FILES = { soils: "data/soils.json", rfactor: "data/rfactor.json", lsfactor: "data/lsfactor.json" };
  const CORE_HASH = { R: "R", soilId: "s", lengthFt: "L", slopePct: "S", lsMethod: "lm" };
  const T_HA = window.USLE.TONS_ACRE_TO_T_HA;
  const TOOLS = [
    { key: "ag", label: "Agricultural fields", href: "index.html" },
    { key: "urban", label: "Urban & construction sites", href: "urban.html" },
  ];

  const root = document.getElementById("usle-app");
  if (!root) return;
  const base = (root.dataset.base || "./").replace(/\/?$/, "/");
  const ui = (window.USLE_UI || {})[root.dataset.landuse || "ag"];

  // ---------------------------------------------------------------- helpers
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tidy = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => Array.from(root.querySelectorAll(sel));
  const fmt = (v, d) => Number(v).toFixed(d);
  const fmtA = (v) => (v >= 100 ? fmt(v, 0) : v >= 10 ? fmt(v, 1) : fmt(v, 2));
  const fmtC = (v) => (v < 0.01 ? fmt(v, 4) : fmt(v, 3));
  const pct = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(0)}%`;
  const ICON_OK = '<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor"/><path d="M5.5 10.5l3 3 6-6.5" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_BAD = '<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5l9 16H1z" fill="currentColor"/><path d="M10 7v5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="10" cy="14.8" r="1.2" fill="#fff"/></svg>';

  if (!ui) {
    root.innerHTML = `<p class="usle-error">Unknown calculator type "${esc(root.dataset.landuse)}". Load usle-ui-ag.js or usle-ui-urban.js before usle-app.js.</p>`;
    return;
  }
  const HASH_KEYS = { ...CORE_HASH, ...ui.hashKeys };
  const STRING_KEYS = new Set(["lsMethod", ...ui.stringKeys]);
  const LIST_KEYS = new Set(ui.listKeys);
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(ui.storeKey)) || []; } catch { return []; } },
    set(v) { try { localStorage.setItem(ui.storeKey, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };

  root.innerHTML = '<p class="usle-empty">Loading the USLE calculator…</p>';
  const files = { ...SHARED_FILES, ...ui.files };
  Promise.all(Object.entries(files).map(([key, path]) => fetch(base + path).then((r) => {
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json().then((json) => [key, json]);
  })))
    .then((list) => start(Object.fromEntries(list)))
    .catch((err) => {
      root.innerHTML = `<p class="usle-error">The calculator could not load its data (${esc(err.message)}). If you opened this file directly from disk, serve the folder through a web server instead.</p>`;
    });

  // ================================================================ app
  function start(data) {
    const model = ui.createModel(data);
    const { rfactor, soils } = data;
    const h = makeHelpers(data);
    const state = {
      inputs: readHash() || model.defaults(),
      unit: "ac",
      marker: readMarker(),  // {x, y, how} in map units
      showAllAlts: false,
      scenarios: store.get(),
    };

    root.innerHTML = template(data, h);
    const tooltip = document.createElement("div");
    tooltip.className = "usle-tooltip";
    tooltip.hidden = true;
    document.body.appendChild(tooltip);

    const setInput = (key, value) => { state.inputs[key] = value; update(); };
    const ctx = { $, $$, state, setInput, model, data, h };
    const numberOrNaN = (v) => (v === "" ? NaN : Number(v));

    syncControls();
    renderSoilList("");
    update();

    // ---------------------------------------------------------- events
    // R: type it, click the map, enter coordinates, or use the device location
    $("#usle-r").addEventListener("input", (e) => { state.marker = null; setInput("R", numberOrNaN(e.target.value)); });
    const mapPoint = (e) => {
      const rect = $(".usle-map img").getBoundingClientRect();
      return [(e.clientX - rect.left) * (rfactor.map.width / rect.width), (e.clientY - rect.top) * (rfactor.map.height / rect.height)];
    };
    const placeMarker = (x, y, R, how) => {
      state.marker = { x, y, how };
      $("#usle-ll-err").textContent = "";
      $("#usle-r").value = Math.round(R);
      setInput("R", Math.round(R));
    };
    $(".usle-map").addEventListener("click", (e) => {
      const [x, y] = mapPoint(e);
      const R = model.rFromMap(x, y);
      if (R != null) placeMarker(x, y, R, "map");
    });
    const namesToggle = $("#usle-county-names");
    if (namesToggle) {
      try { namesToggle.checked = localStorage.getItem("usle-county-names") === "1"; } catch { /* storage unavailable */ }
      const apply = () => $(".usle-map").classList.toggle("show-county-names", namesToggle.checked);
      apply();
      namesToggle.addEventListener("change", () => {
        apply();
        try { localStorage.setItem("usle-county-names", namesToggle.checked ? "1" : "0"); } catch { /* storage unavailable */ }
      });
    }
    const findLatLon = (lat, lon, how) => {
      const r = model.rAt(lat, lon);
      if (r.R == null) { $("#usle-ll-err").textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)} is outside Kansas. Check the coordinates (longitude is negative in Kansas).`; return; }
      placeMarker(r.x, r.y, r.R, how);
    };
    $("#usle-ll-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const nums = ($("#usle-ll").value.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      if (nums.length !== 2) { $("#usle-ll-err").textContent = "Enter latitude and longitude in decimal degrees, e.g. 38.84, -97.61."; return; }
      let [lat, lon] = nums;
      if (Math.abs(lat) > 90 || (lat < 0 && lon > 0)) [lat, lon] = [lon, lat]; // accept "lon, lat" too
      if (lon > 0) lon = -lon;                                                 // Kansas is west of Greenwich
      findLatLon(lat, lon, "those coordinates");
    });
    $("#usle-geo").addEventListener("click", () => {
      const msg = $("#usle-ll-err");
      if (!navigator.geolocation) { msg.textContent = "This browser can't share its location."; return; }
      msg.textContent = "Finding your location…";
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          $("#usle-ll").value = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
          msg.textContent = "";
          findLatLon(latitude, longitude, "your location");
        },
        (err) => { msg.textContent = err.code === 1 ? "Location access was declined. Enter coordinates or click the map instead." : "Your location could not be found. Enter coordinates or click the map instead."; },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
      );
    });

    // Soil
    $("#usle-soil-filter").addEventListener("input", (e) => renderSoilList(e.target.value));
    $("#usle-soil").addEventListener("change", (e) => setInput("soilId", Number(e.target.value)));

    // Slope: number box and slider stay in sync
    for (const [key, numId, rangeId] of [["lengthFt", "#usle-len", "#usle-len-r"], ["slopePct", "#usle-slope", "#usle-slope-r"]]) {
      $(numId).addEventListener("input", (e) => { $(rangeId).value = e.target.value; setInput(key, numberOrNaN(e.target.value)); });
      $(rangeId).addEventListener("input", (e) => { $(numId).value = e.target.value; setInput(key, Number(e.target.value)); });
    }
    $("#usle-lsm").addEventListener("change", (e) => setInput("lsMethod", e.target.value));

    // C and P (land-use module)
    ui.bind(ctx);

    // Results
    $$(".usle-units button").forEach((b) => b.addEventListener("click", () => { state.unit = b.dataset.unit; update(); }));
    $("#usle-alts").addEventListener("click", (e) => {
      const apply = e.target.closest("[data-apply]");
      if (apply) { Object.assign(state.inputs, JSON.parse(apply.dataset.apply)); syncControls(); update(); return; }
      if (e.target.closest("[data-toggle-alts]")) { state.showAllAlts = !state.showAllAlts; update(); }
    });
    $("#usle-save-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = tidy($("#usle-save-name").value) || `Scenario ${state.scenarios.length + 1}`;
      state.scenarios.push({ id: Date.now(), name, inputs: JSON.parse(JSON.stringify(state.inputs)) });
      store.set(state.scenarios);
      $("#usle-save-name").value = "";
      update();
    });
    $("#usle-scenarios").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-load], [data-remove]");
      if (!btn) return;
      const id = Number(btn.dataset.load || btn.dataset.remove);
      if (btn.dataset.load) {
        const sc = state.scenarios.find((s) => s.id === id);
        if (sc) { state.inputs = model.complete(sc.inputs); state.marker = null; syncControls(); update(); }
      } else {
        state.scenarios = state.scenarios.filter((s) => s.id !== id);
        store.set(state.scenarios);
        update();
      }
    });
    $("#usle-print").addEventListener("click", () => window.print());
    $("#usle-copy").addEventListener("click", (e) => {
      const btn = e.currentTarget;
      const done = (msg) => { btn.textContent = msg; setTimeout(() => { btn.textContent = "Copy link"; }, 1800); };
      if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(() => done("Link copied"), () => done("Copy failed"));
      else done("Copy failed");
    });
    $("#usle-reset").addEventListener("click", () => {
      state.inputs = model.defaults(); state.marker = null; $("#usle-soil-filter").value = "";
      renderSoilList(""); syncControls(); update();
    });
    $(".usle-mobilebar button").addEventListener("click", () => $(".usle-results").scrollIntoView({ behavior: "smooth" }));

    // Tooltips: R under the cursor on the map, details on bars
    root.addEventListener("pointermove", (e) => {
      let html = null;
      if (e.target.closest(".usle-map")) {
        const [x, y] = mapPoint(e);
        const R = model.rFromMap(x, y);
        const county = R != null ? model.countyAt(x, y) : null;
        if (R != null) html = `${county ? `${esc(county)} County<br>` : ""}R ≈ <b>${Math.round(R)}</b> · click to use`;
      } else {
        const row = e.target.closest("[data-tip]");
        if (row) html = row.dataset.tip;
      }
      if (!html) { tooltip.hidden = true; return; }
      tooltip.innerHTML = html;
      tooltip.hidden = false;
      const pad = 14, w = tooltip.offsetWidth, ht = tooltip.offsetHeight;
      let x = e.clientX + pad, y = e.clientY + pad;
      if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
      if (y + ht > window.innerHeight - 8) y = e.clientY - ht - pad;
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
    });
    root.addEventListener("pointerleave", () => { tooltip.hidden = true; });

    // ---------------------------------------------------------- controls
    function syncControls() {
      const i = state.inputs;
      $("#usle-r").value = Number.isFinite(i.R) ? i.R : "";
      $("#usle-soil").value = i.soilId;
      $("#usle-len").value = $("#usle-len-r").value = Number.isFinite(i.lengthFt) ? i.lengthFt : "";
      $("#usle-slope").value = $("#usle-slope-r").value = Number.isFinite(i.slopePct) ? i.slopePct : "";
      $("#usle-lsm").value = i.lsMethod;
      ui.sync(ctx);
    }

    function renderSoilList(filter) {
      const q = tidy(filter).toLowerCase();
      const sel = $("#usle-soil");
      const match = (s) => !q || `${s.name} ${s.textureName}`.toLowerCase().includes(q);
      const list = soils.soils.filter((s) => match(s) || s.id === state.inputs.soilId);
      sel.innerHTML = list.map((s) => `<option value="${s.id}">${esc(s.series)}, ${esc(s.texture)} — K ${fmt(s.K, 2)}, T ${s.T}</option>`).join("");
      sel.value = state.inputs.soilId;
      $("#usle-soil-count").textContent = q ? `${list.length} of ${soils.soils.length} soils match` : `${soils.soils.length} Kansas soils`;
    }

    // ---------------------------------------------------------- update
    function update() {
      const inp = state.inputs;
      const res = model.compute(inp);
      writeHash(inp);
      const errors = res.ok ? {} : res.errors;
      for (const [key, id] of [["R", "r"], ["lengthFt", "len"], ["slopePct", "slope"]]) {
        $(`#usle-${id}`).setAttribute("aria-invalid", errors[key] ? "true" : "false");
        $(`#usle-${id}-err`).textContent = errors[key] || "";
      }

      // Step 1: R
      $("#usle-chip-r").textContent = Number.isFinite(inp.R) ? `R = ${inp.R}` : "R = –";
      const mk = $(".usle-marker");
      const markerR = state.marker ? model.rFromMap(state.marker.x, state.marker.y) : null;
      if (markerR != null) {
        mk.hidden = false;
        mk.style.left = `${(state.marker.x / rfactor.map.width) * 100}%`;
        mk.style.top = `${(state.marker.y / rfactor.map.height) * 100}%`;
        const from = state.marker.how === "map" ? "the point you clicked" : state.marker.how === "link" ? "the marked point" : state.marker.how;
        const county = model.countyAt(state.marker.x, state.marker.y);
        $("#usle-r-note").textContent = `R at ${from}${county ? ` (${county} County)` : ""}: ${fmt(markerR, 1)} (used as ${Math.round(markerR)}). Type a different value to override it.`;
      } else {
        mk.hidden = true;
        $("#usle-r-note").textContent = "Click your site on the map (hover to read R), enter its coordinates, or type an R value.";
      }

      // Step 2: K, T
      const kk = model.k(inp.soilId);
      $("#usle-chip-k").textContent = `K = ${fmt(kk.K, 2)}`;
      $("#usle-soil-meta").innerHTML =
        `<span>Soil: <b>${esc(kk.soil.series)}</b> ${esc(kk.soil.textureName || kk.soil.texture)}</span>` +
        `<span>K factor: <b>${fmt(kk.K, 2)}</b></span>` +
        `<span>Tolerable loss T: <b>${kk.T}</b> t/ac/yr</span>`;

      // Step 3: LS
      if (!errors.lengthFt && !errors.slopePct) {
        const l = model.ls(inp.lengthFt, inp.slopePct, inp.lsMethod);
        $("#usle-chip-ls").textContent = `LS = ${fmt(l.LS, 3)}`;
        const lenPart = `(${inp.lengthFt} / 72.6)<sup>${l.m}</sup>`;
        if (l.method.steepness === "sine") {
          const deg = (Math.atan(inp.slopePct / 100) * 180) / Math.PI;
          $("#usle-ls-calc").innerHTML = `LS = ${lenPart} × (65.41 sin²θ + 4.56 sinθ + 0.065), θ = ${fmt(deg, 2)}° = <b>${fmt(l.LS, 3)}</b>`;
        } else {
          $("#usle-ls-calc").innerHTML = `LS = ${lenPart} × (0.0065·${inp.slopePct}² + 0.045·${inp.slopePct} + 0.065) = <b>${fmt(l.LS, 3)}</b>`;
        }
      } else {
        $("#usle-chip-ls").textContent = "LS = –";
        $("#usle-ls-calc").textContent = "Enter a valid slope length and steepness.";
      }

      // Steps 4-5: C and P
      ui.update(ctx, inp, res);

      renderResults(res);
      renderAlternatives(res);
      renderScenarios(res);
    }

    function unitLabel() { return state.unit === "ha" ? "t/ha/yr" : "tons/acre/yr"; }
    function conv(v) { return state.unit === "ha" ? v * T_HA : v; }

    function renderResults(res) {
      $$(".usle-units button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.unit === state.unit)));
      const out = $("#usle-result-body");
      const mobile = $(".usle-mobilebar span");
      if (!res.ok) {
        out.innerHTML = `<p class="usle-error">${Object.values(res.errors).map(esc).join("<br>")}</p>`;
        $("#usle-a").textContent = "–";
        mobile.innerHTML = "Check the highlighted inputs.";
        return;
      }
      const { A, T, factors: f } = res;
      $("#usle-a").textContent = fmtA(conv(A));
      $("#usle-a-unit").textContent = unitLabel();
      const good = !res.exceedsT;
      const status = good
        ? `<b>At or below tolerable loss</b>A is ${fmtA(conv(A))} vs. T = ${fmtA(conv(T))} ${unitLabel()}. This is a soil-conserving system.`
        : `<b>Exceeds tolerable loss by ${fmt(res.ratio, 1)}×</b>A is ${fmtA(conv(A))} vs. T = ${fmtA(conv(T))} ${unitLabel()}. Try the conservation options below.`;
      const max = Math.max(A, T) * 1.15;
      const pos = (v) => `${Math.min(100, (v / max) * 100)}%`;
      out.innerHTML = `
        <div class="usle-status ${good ? "is-good" : "is-bad"}" role="status">${good ? ICON_OK : ICON_BAD}<span>${status}</span></div>
        <div class="usle-meter" aria-hidden="true">
          <div class="usle-meter-track">
            <div class="usle-meter-fill ${good ? "is-good" : "is-bad"}" style="width:${pos(A)}"></div>
            <div class="usle-meter-t" style="left:${pos(T)}"></div>
          </div>
          <div class="usle-meter-labels"><span style="left:${pos(T)};${T / max < 0.12 ? "transform:none;margin-left:-1px" : ""}">T = ${fmtA(conv(T))}</span></div>
        </div>
        <table class="usle-factors">
          <caption class="usle-sr">USLE factors</caption>
          <tr><th scope="row">R</th><td class="usle-d">Rainfall &amp; runoff</td><td class="usle-v">${fmt(f.R, 0)}</td></tr>
          <tr><th scope="row">K</th><td class="usle-d">Soil erodibility</td><td class="usle-v">${fmt(f.K, 2)}</td></tr>
          <tr><th scope="row">LS</th><td class="usle-d">Slope length &amp; steepness</td><td class="usle-v">${fmt(f.LS, 3)}</td></tr>
          <tr><th scope="row">C</th><td class="usle-d">${ui.factorLabels.C}</td><td class="usle-v">${fmtC(f.C)}</td></tr>
          <tr><th scope="row">P</th><td class="usle-d">${ui.factorLabels.P}</td><td class="usle-v">${fmt(f.P, f.P < 0.1 ? 3 : 2)}</td></tr>
          <tr><th scope="row">A</th><td class="usle-d">Predicted soil loss (t/ac/yr)</td><td class="usle-v">${fmtA(A)}</td></tr>
        </table>`;
      mobile.innerHTML = `A = <b>${fmtA(conv(A))}</b> ${unitLabel()} · <span class="${good ? "is-good" : "is-bad"}">${good ? "✓ at/below T" : "▲ above T"}</span>`;
      $("#usle-hints-card").hidden = good;
    }

    function barRows(rows, T, opts = {}) {
      const max = Math.max(T, ...rows.map((r) => r.A)) * 1.08;
      const w = (v) => `${(v / max) * 100}%`;
      return rows.map((r) => `
        <div class="usle-bar-row ${r.current ? "is-current" : ""}" data-tip="${esc(r.tip)}">
          <div class="usle-bar-label">
            ${r.tag ? `<span class="usle-tag">${esc(r.tag)}</span>` : ""}
            <span class="usle-name">${esc(r.label)}</span>
            ${r.action || ""}
          </div>
          <div class="usle-bar-track" aria-hidden="true">
            <div class="usle-bar" style="width:${w(r.A)}"></div>
            ${opts.noT ? "" : `<div class="usle-bar-t" style="left:${w(T)}"></div>`}
          </div>
          <div class="usle-bar-value"><b>${fmtA(conv(r.A))}</b>${r.sub ? `<small>${r.sub}</small>` : ""}</div>
        </div>`).join("");
    }

    function renderAlternatives(res) {
      const box = $("#usle-alts");
      if (!res.ok) { box.innerHTML = '<p class="usle-empty">Fix the inputs to see options.</p>'; return; }
      const alts = model.alternatives(state.inputs);
      const better = alts.filter((a) => a.A < res.A - 1e-12);
      // Short list: best reductions, at most two per group so different kinds of fixes show up
      const perGroup = {};
      const top = better.filter((a) => (perGroup[a.group] = (perGroup[a.group] || 0) + 1) <= 2).slice(0, 6);
      const shown = state.showAllAlts ? alts : top;
      const tipFor = (a) => `<b>${esc(a.label)}</b><br>A = ${fmtA(conv(a.A))} ${unitLabel()}<br>${pct(a.pctChange)} vs. current`;
      const rows = [{ label: "Current system", A: res.A, current: true, tip: `<b>Current system</b><br>A = ${fmtA(conv(res.A))} ${unitLabel()}` }]
        .concat(shown.map((a) => ({
          label: a.label, tag: a.group, A: a.A, sub: pct(a.pctChange), tip: tipFor(a),
          action: `<button type="button" class="usle-linkbtn" data-apply='${esc(JSON.stringify(a.change))}'>Apply</button>`,
        })));
      const more = alts.length > top.length;
      box.innerHTML = `
        ${better.length ? "" : '<p class="usle-empty">No single change below lowers soil loss further.</p>'}
        <div class="usle-bars">${barRows(rows, res.T)}</div>
        <div class="usle-bars-foot">
          <span class="usle-legend-t">T = ${fmtA(conv(res.T))} ${unitLabel()}</span>
          ${more ? `<button type="button" class="usle-linkbtn" data-toggle-alts>${state.showAllAlts ? "Show top reductions" : `Show all ${alts.length} options`}</button>` : ""}
        </div>`;
    }

    function renderScenarios(res) {
      const box = $("#usle-scenarios");
      if (!state.scenarios.length) {
        box.innerHTML = `<p class="usle-empty">Save the current inputs as a scenario (e.g. ${esc(ui.scenarioExample)}) to compare them side by side. Scenarios are kept in this browser only.</p>`;
        return;
      }
      const rows = state.scenarios.map((s) => {
        const r = model.compute(model.complete(s.inputs));
        const A = r.ok ? r.A : 0;
        const delta = res.ok && r.ok ? pct((A - res.A) / res.A * 100) + " vs. now" : "";
        return {
          label: s.name, A, sub: r.ok && A > r.T ? "above T" : "≤ T",
          tip: `<b>${esc(s.name)}</b><br>A = ${fmtA(conv(A))} ${unitLabel()} · T = ${r.ok ? fmtA(conv(r.T)) : "–"}<br>${delta}`,
          action: `<span><button type="button" class="usle-linkbtn" data-load="${s.id}">Load</button> · <button type="button" class="usle-linkbtn" data-remove="${s.id}" aria-label="Delete ${esc(s.name)}">Delete</button></span>`,
        };
      });
      // Scenarios can be on different soils (different T), so no single T line here.
      box.innerHTML = `<div class="usle-bars">${barRows(rows, 0, { noT: true })}</div>
        <div class="usle-bars-foot"><span>${unitLabel()} · "≤ T" / "above T" uses each scenario's own soil</span></div>`;
    }

    // ---------------------------------------------------------- URL state
    function writeHash(inp) {
      const parts = Object.entries(HASH_KEYS).map(([k, short]) => {
        const v = LIST_KEYS.has(k) ? (inp[k] || []).join(",") : inp[k];
        return `${short}=${encodeURIComponent(v)}`;
      });
      if (state && state.marker) parts.push(`mk=${encodeURIComponent(`${state.marker.x.toFixed(1)},${state.marker.y.toFixed(1)}`)}`);
      try { history.replaceState(null, "", `#${parts.join("&")}`); } catch { /* sandboxed */ }
    }
    /** Map marker from a shared link (map units), if it is inside Kansas. */
    function readMarker() {
      const v = new URLSearchParams(location.hash.slice(1)).get("mk");
      if (!v) return null;
      const [x, y] = v.split(",").map(Number);
      return Number.isFinite(x) && Number.isFinite(y) && model.rFromMap(x, y) != null ? { x, y, how: "link" } : null;
    }
    function readHash() {
      if (!location.hash.includes("=")) return null;
      const q = new URLSearchParams(location.hash.slice(1));
      const inp = model.defaults();
      for (const [k, short] of Object.entries(HASH_KEYS)) {
        if (!q.has(short)) continue;
        const v = q.get(short);
        if (LIST_KEYS.has(k)) inp[k] = v.split(",").filter(Boolean).map(Number);
        else if (v !== "") inp[k] = STRING_KEYS.has(k) ? v : Number(v);
      }
      try {
        model.k(inp.soilId); model.lsMethod(inp.lsMethod); model.c(inp);
        model.p({ ...inp, slopePct: Number.isFinite(inp.slopePct) ? inp.slopePct : 0, lengthFt: Number.isFinite(inp.lengthFt) ? inp.lengthFt : 1 });
        return model.complete(inp);
      } catch { return null; }
    }
  }

  // ================================================================ markup
  function makeHelpers(data) {
    return {
      data, base, esc, tidy, fmt, fmtC,
      opts: (list) => list.map((o) => `<option value="${o.id}">${esc(o.label)}${o.factor != null ? ` (×${o.factor})` : ""}</option>`).join(""),
      about: (body) => `<details class="usle-about"><summary>About this factor</summary><p>${esc(tidy(body))}</p></details>`,
      seg: (name, list) => list.map((o) => `<label><input type="radio" name="${name}" value="${o.id}"><span>${esc(o.label)}</span><small></small></label>`).join(""),
    };
  }

  /** SVG layer over the shaded map: R contours with labels, Kansas outline, towns (map units). */
  function mapOverlay(m) {
    const d = (pts) => "M" + pts.map((p) => `${p[0]},${p[1]}`).join("L");
    const outline = d(m.outline) + "Z";
    const contours = m.contours.map((c) => c.paths.map((p) => `<path class="usle-ctr" d="${d(p)}"/>`).join("")).join("");
    const labels = m.contours.map((c) => `<text class="usle-ctr-label" x="${c.label[0]}" y="${c.label[1]}" dy="0.35em">${c.R}</text>`).join("");
    const towns = m.towns.map((t) => {
      const left = t.side === "l";
      return `<g class="usle-town"><circle cx="${t.x}" cy="${t.y}" r="2.6"/><text x="${t.x + (left ? -5 : 5)}" y="${t.y}" dy="0.35em" text-anchor="${left ? "end" : "start"}">${esc(t.name)}</text></g>`;
    }).join("");
    const counties = m.counties || [];
    const countyLines = counties.map((c) => c.rings.map((r) => d(r) + "Z").join("")).join("");
    const countyNames = counties.map((c) => `<text x="${c.label[0]}" y="${c.label[1]}" dy="0.35em">${esc(c.name)}</text>`).join("");
    return `<svg class="usle-map-svg" viewBox="0 0 ${m.width} ${m.height}" aria-hidden="true">
      <defs><clipPath id="usle-ks-clip"><path d="${outline}"/></clipPath></defs>
      ${countyLines ? `<path class="usle-counties" d="${countyLines}" clip-path="url(#usle-ks-clip)"/>` : ""}
      <g clip-path="url(#usle-ks-clip)">${contours}</g>
      <path class="usle-ks-outline" d="${outline}"/>
      ${labels}
      <g class="usle-towns">${towns}</g>
      <g class="usle-county-names">${countyNames}</g>
    </svg>`;
  }

  /** Colour bar for the map, with ticks at the contour values. */
  function mapLegend(rf) {
    const [lo, hi] = rf.range;
    const stops = rf.map.ramp.map((c, i) => `${c} ${(i / (rf.map.ramp.length - 1)) * 100}%`).join(",");
    const ticks = rf.map.contours.map((c) => `<span style="left:${((c.R - lo) / (hi - lo)) * 100}%">${c.R}</span>`).join("");
    return `<div class="usle-legend">
      <span class="usle-legend-title" aria-hidden="true">R</span>
      <div class="usle-legend-scale" aria-hidden="true"><div class="usle-legend-bar" style="background:linear-gradient(90deg,${stops})"></div><div class="usle-legend-ticks">${ticks}</div></div>
      ${rf.map.counties ? '<label class="usle-check usle-names-toggle"><input type="checkbox" id="usle-county-names"><span>County names</span></label>' : ""}
    </div>`;
  }

  function template(data, h) {
    const { rfactor, lsfactor, soils, text } = data;
    const { about } = h;
    const tools = TOOLS.map((t) => {
      const href = root.dataset[`href${t.key[0].toUpperCase()}${t.key.slice(1)}`] || t.href;
      return t.key === ui.key
        ? `<span aria-current="page">${esc(t.label)}</span>`
        : `<a href="${esc(href)}">${esc(t.label)}</a>`;
    }).join("");
    const note = tidy(text.intro).split("Note:")[1];
    return `
    <nav class="usle-tools" aria-label="Calculator type">${tools}</nav>
    <header class="usle-header">
      <div>
        <h2>${esc(ui.title)}</h2>
        <p class="usle-sub">${esc(ui.subtitle)}</p>
      </div>
      <div class="usle-eq" aria-label="A equals R times K times LS times C times P">A = R × K × LS × C × P</div>
    </header>

    <div class="usle-layout">
      <div class="usle-steps">

        <section class="usle-card" aria-labelledby="usle-h-r">
          <div class="usle-step-head"><span class="usle-step-no">1</span>
            <h3 id="usle-h-r">Location &amp; rainfall<small>R factor: erosive power of rainfall</small></h3>
            <span class="usle-chip" id="usle-chip-r"></span></div>
          <div class="usle-map">
            <img src="${base}${esc(rfactor.map.image)}" width="${rfactor.map.width}" height="${rfactor.map.height}" alt="Map of Kansas rainfall erosivity (R), rising smoothly from about ${Math.round(rfactor.range[0] / 5) * 5} in the northwest to about ${Math.round(rfactor.range[1] / 5) * 5} in the southeast" draggable="false">
            ${mapOverlay(rfactor.map)}
            <span class="usle-marker" hidden></span>
          </div>
          ${mapLegend(rfactor)}
          <div class="usle-grid2" style="margin-top:12px">
            <div class="usle-field">
              <label for="usle-r">R value</label>
              <div class="usle-inline"><input class="usle-input usle-num" id="usle-r" type="number" min="${rfactor.limits[0]}" max="${rfactor.limits[1]}" step="1" inputmode="decimal"><span class="usle-unit">range ${rfactor.limits[0]}–${rfactor.limits[1]}</span></div>
              <p class="usle-error" id="usle-r-err"></p>
            </div>
            <form class="usle-field" id="usle-ll-form">
              <label for="usle-ll">Or find R at a location (latitude, longitude)</label>
              <div class="usle-inline usle-ll"><input class="usle-input" id="usle-ll" placeholder="38.84, -97.61" inputmode="decimal" autocomplete="off">
                <button type="submit" class="usle-btn usle-ghost">Find</button>
                <button type="button" class="usle-btn usle-ghost" id="usle-geo">Use my location</button></div>
              <p class="usle-error" id="usle-ll-err"></p>
            </form>
          </div>
          <p class="usle-hint" id="usle-r-note"></p>
          ${about(rfactor.about + " " + (rfactor.instructions || ""))}
          <p class="usle-source">R values: <a href="${esc(rfactor.sourceUrl)}" target="_blank" rel="noopener">NOAA R-Factor for the Conterminous U.S.</a>, from the isoerodent maps in USDA Agriculture Handbook 703 (Renard et al., 1997).${rfactor.map.counties ? " County lines: U.S. Census Bureau, 2023 cartographic boundaries." : ""}</p>
        </section>

        <section class="usle-card" aria-labelledby="usle-h-k">
          <div class="usle-step-head"><span class="usle-step-no">2</span>
            <h3 id="usle-h-k">Soil<small>K factor and tolerable loss T</small></h3>
            <span class="usle-chip" id="usle-chip-k"></span></div>
          <div class="usle-field">
            <label for="usle-soil-filter">Search soil series or texture</label>
            <input class="usle-input" id="usle-soil-filter" type="search" placeholder="e.g. Harney, silt loam" autocomplete="off">
            <label class="usle-sr" for="usle-soil">Soil</label>
            <select class="usle-select" id="usle-soil" size="7"></select>
            <p class="usle-hint" id="usle-soil-count"></p>
          </div>
          <div class="usle-soil-meta" id="usle-soil-meta"></div>
          ${about(soils.about)}
        </section>

        <section class="usle-card" aria-labelledby="usle-h-ls">
          <div class="usle-step-head"><span class="usle-step-no">3</span>
            <h3 id="usle-h-ls">Slope<small>LS factor: slope length and steepness</small></h3>
            <span class="usle-chip" id="usle-chip-ls"></span></div>
          <div class="usle-grid2">
            <div class="usle-field">
              <label for="usle-len">Slope length (ft)</label>
              <div class="usle-inline"><input class="usle-input usle-num" id="usle-len" type="number" min="${lsfactor.limits.lengthFt[0]}" max="${lsfactor.limits.lengthFt[1]}" step="1" inputmode="decimal">
              <input id="usle-len-r" type="range" min="${lsfactor.limits.lengthFt[0]}" max="${lsfactor.limits.lengthFt[1]}" step="1" aria-label="Slope length slider"></div>
              <p class="usle-error" id="usle-len-err"></p>
            </div>
            <div class="usle-field">
              <label for="usle-slope">Slope steepness (%)</label>
              <div class="usle-inline"><input class="usle-input usle-num" id="usle-slope" type="number" min="${lsfactor.limits.slopePct[0]}" max="${lsfactor.limits.slopePct[1]}" step="0.1" inputmode="decimal">
              <input id="usle-slope-r" type="range" min="${lsfactor.limits.slopePct[0]}" max="${lsfactor.limits.slopePct[1]}" step="0.1" aria-label="Slope steepness slider"></div>
              <p class="usle-error" id="usle-slope-err"></p>
            </div>
            <div class="usle-field"><label for="usle-lsm">LS calculation</label>
              <select class="usle-select" id="usle-lsm">${Object.entries(lsfactor.methods).map(([k, m]) => `<option value="${k}">${esc(m.label)}</option>`).join("")}</select></div>
          </div>
          <div class="usle-calc" id="usle-ls-calc"></div>
          ${about(lsfactor.about + " Soil loss is more sensitive to changes in slope steepness than to slope length.")}
        </section>

        ${ui.stepsHtml(h)}

        <details class="usle-card usle-notes">
          <summary>Data notes and items to review</summary>
          ${ui.notesHtml(h)}
        </details>
      </div>

      <aside class="usle-results" aria-label="Results">
        <section class="usle-card">
          <div class="usle-hero-label"><span>Predicted soil loss, A</span>
            <span class="usle-units" role="group" aria-label="Units"><button type="button" data-unit="ac" aria-pressed="true">t/ac</button><button type="button" data-unit="ha" aria-pressed="false">t/ha</button></span></div>
          <div class="usle-hero" aria-live="polite"><span class="usle-a" id="usle-a">–</span><span class="usle-a-unit" id="usle-a-unit"></span></div>
          <div id="usle-result-body"></div>
          <div class="usle-actions" style="margin-top:14px">
            <button type="button" class="usle-btn usle-ghost" id="usle-print">Print</button>
            <button type="button" class="usle-btn usle-ghost" id="usle-copy">Copy link</button>
            <button type="button" class="usle-btn usle-ghost" id="usle-reset">Reset</button>
          </div>
        </section>

        <section class="usle-card" aria-labelledby="usle-h-alts">
          <h4 id="usle-h-alts">What if you change one practice?</h4>
          <div id="usle-alts"></div>
        </section>

        <section class="usle-card" aria-labelledby="usle-h-sc">
          <h4 id="usle-h-sc">Compare scenarios</h4>
          <form class="usle-save" id="usle-save-form">
            <label class="usle-sr" for="usle-save-name">Scenario name</label>
            <input class="usle-input" id="usle-save-name" placeholder="Name this scenario" maxlength="60">
            <button class="usle-btn" type="submit">Save</button>
          </form>
          <div id="usle-scenarios"></div>
        </section>

        <section class="usle-card" id="usle-hints-card" hidden aria-labelledby="usle-h-hints">
          <h4 id="usle-h-hints">How to lower soil loss</h4>
          ${ui.hintsHtml(h)}
        </section>
      </aside>
    </div>

    <p class="usle-credit">Based on the Kansas USLE workbook by ${esc(tidy(text.credit))}. ${note ? esc("Note: " + note.trim()) : ""}</p>

    <div class="usle-mobilebar"><span></span><button type="button" class="usle-btn">Results</button></div>`;
  }
})();
