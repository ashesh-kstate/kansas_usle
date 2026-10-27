/*
 * Urban and construction sites: steps 4 (C) and 5 (P) of the USLE page.
 * Registers window.USLE_UI.urban for usle-app.js (load before usle-app.js,
 * after usle-urban-model.js).
 */
(function () {
  "use strict";
  const UI = (window.USLE_UI = window.USLE_UI || {});
  const KINDS = ["detachment", "deposition"];
  const SHORT = { detachment: "det", deposition: "dep" };

  UI.urban = {
    key: "urban",
    storeKey: "usle-ks-urban-scenarios-v1",
    files: { cfactor: "data/urban/cfactor.json", pfactor: "data/urban/pfactor.json", text: "data/urban/text.json" },
    createModel: (data) => window.USLE.createUrbanModel(data),
    title: "USLE Soil Loss Calculator for Kansas Urban and Construction Sites",
    subtitle: "Estimate average annual sheet and rill erosion for a building lot, construction site or landscaped area, and see how ground cover and erosion-control practices change it.",
    factorLabels: { C: "Ground cover &amp; site disturbance", P: "Erosion-control practices" },
    scenarioExample: '"During construction", "After landscaping"',
    hashKeys: { cover: "gc", coverPct: "cv", disturbance: "sd", detachment: "dt", deposition: "dp" },
    stringKeys: [],
    listKeys: ["detachment", "deposition"],

    // ------------------------------------------------------------ markup
    stepsHtml(h) {
      const { cfactor, pfactor } = h.data;
      const { esc, fmt, about } = h;
      const checklist = (kind) => {
        const g = pfactor[kind];
        return `
          <fieldset class="usle-practices" id="usle-${SHORT[kind]}-box">
            <legend class="usle-legend">${esc(g.label)} <span class="usle-pfac" id="usle-${SHORT[kind]}-fac"></span></legend>
            <p class="usle-hint">${esc(g.help)} Each practice multiplies P by ${fmt(g.factors[1], 2)}, up to three practices (×${g.factors[g.factors.length - 1]}).</p>
            <div class="usle-checkcols">
              ${g.groups.map((gr) => `
                <div><p class="usle-checkhead">${esc(gr.label)}</p>
                  ${gr.practices.map((x) => `<label class="usle-check"><input type="checkbox" data-kind="${kind}" value="${x.id}"><span>${esc(x.label)}</span></label>`).join("")}
                </div>`).join("")}
            </div>
          </fieldset>`;
      };
      return `
        <section class="usle-card" aria-labelledby="usle-h-c">
          <div class="usle-step-head"><span class="usle-step-no">4</span>
            <h3 id="usle-h-c">Ground cover &amp; site activity<small>C factor: what covers the soil and how much it is disturbed</small></h3>
            <span class="usle-chip" id="usle-chip-c"></span></div>
          <div class="usle-grid2">
            <div class="usle-field"><label for="usle-uc">Ground cover</label>
              <select class="usle-select" id="usle-uc">${cfactor.covers.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join("")}</select></div>
            <div class="usle-field"><label for="usle-upct">Share of the surface covered: <span id="usle-upct-out" class="usle-num"></span></label>
              <input id="usle-upct" type="range" min="0" max="${cfactor.coverPct.length - 1}" step="1" list="usle-upct-ticks">
              <datalist id="usle-upct-ticks">${cfactor.coverPct.map((_, i) => `<option value="${i}"></option>`).join("")}</datalist></div>
            <fieldset class="usle-seg"><legend class="usle-legend">Site activity (soil disturbance)</legend>
              ${cfactor.disturbance.map((d) => `<label><input type="radio" name="usle-sd" value="${d.id}"><span>${esc(d.label)}</span><small>${esc(d.detail)} · ×${fmt(d.factor, 1)}</small></label>`).join("")}
            </fieldset>
          </div>
          <div class="usle-calc" id="usle-c-calc"></div>
          ${about(cfactor.about + " " + cfactor.theory)}
        </section>

        <section class="usle-card" aria-labelledby="usle-h-p">
          <div class="usle-step-head"><span class="usle-step-no">5</span>
            <h3 id="usle-h-p">Erosion-control practices<small>P factor: detachment and deposition control</small></h3>
            <span class="usle-chip" id="usle-chip-p"></span></div>
          ${KINDS.map(checklist).join("")}
          <div class="usle-calc" id="usle-p-calc"></div>
          ${about(pfactor.about + " " + pfactor.theory)}
        </section>`;
    },

    notesHtml(h) {
      const { cfactor, pfactor, lsfactor } = h.data;
      const { esc } = h;
      const notes = [
        ...cfactor.notes.map((n) => `<b>C factor:</b> ${esc(n)}`),
        ...pfactor.notes.map((n) => `<b>P factor:</b> ${esc(n)}`),
        `<b>LS factor:</b> Defaults to the Agriculture Handbook 537 equation, which reproduces NRCS Table II (same as the agricultural tool). The urban workbook's formula is available in step 3: ${esc(lsfactor.methods.workbook.note)}`,
        "<b>R, K and T:</b> The urban workbook uses the same six-zone R map and the same 324-soil table as the agricultural workbook. Both tools now read R from the continuous NOAA map (USDA Agriculture Handbook 703) and share the soil table.",
      ];
      return `<p style="margin-top:8px">Tables come from the K-State urban USLE workbook (USLE_Urban_KS08.xlsm). With the "Original K-State workbook" LS option, results match the workbook's formulas. Notes:</p>
        <ul>${notes.map((n) => `<li>${n}</li>`).join("")}</ul>`;
    },

    hintsHtml(h) {
      const { text } = h.data;
      const { esc } = h;
      const list = (hints) => `<ul class="usle-hints">${hints.map((x) => `<li>${esc(x.text)}${x.items.length ? `<ol>${x.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ol>` : ""}</li>`).join("")}</ul>`;
      return `<p class="usle-hints-h">Lower the C factor</p>${list(text.cHints)}
        <p class="usle-hints-h">Lower the P factor</p>${list(text.pHints)}`;
    },

    // ------------------------------------------------------------ behavior
    bind(ctx) {
      const { $, $$, setInput, state, data } = ctx;
      $("#usle-uc").addEventListener("change", (e) => setInput("cover", Number(e.target.value)));
      $("#usle-upct").addEventListener("input", (e) => setInput("coverPct", data.cfactor.coverPct[Number(e.target.value)]));
      $$('input[name="usle-sd"]').forEach((r) => r.addEventListener("change", () => setInput("disturbance", Number(r.value))));
      $$("input[data-kind]").forEach((box) => box.addEventListener("change", () => {
        const kind = box.dataset.kind;
        const ids = new Set(state.inputs[kind] || []);
        if (box.checked) ids.add(Number(box.value)); else ids.delete(Number(box.value));
        setInput(kind, [...ids].sort((a, b) => a - b));
      }));
    },

    sync(ctx) {
      const { $, $$, state, data } = ctx;
      const i = state.inputs;
      $("#usle-uc").value = i.cover;
      $("#usle-upct").value = Math.max(0, data.cfactor.coverPct.indexOf(i.coverPct));
      $$('input[name="usle-sd"]').forEach((r) => { r.checked = Number(r.value) === i.disturbance; });
      $$("input[data-kind]").forEach((box) => { box.checked = (i[box.dataset.kind] || []).includes(Number(box.value)); });
    },

    update(ctx, inp) {
      const { $, model, data, h } = ctx;
      const { esc, fmt, fmtC } = h;

      // Step 4: C
      const cc = model.c(inp);
      const fixed = !!cc.cover.coverIndependent;
      $("#usle-upct").disabled = fixed;
      $("#usle-upct-out").textContent = fixed ? "not used for this cover" : `${inp.coverPct}%`;
      $("#usle-chip-c").textContent = `C = ${fmtC(cc.C)}`;
      $("#usle-c-calc").innerHTML =
        `Ground cover C ${fmtC(cc.base)} (${esc(cc.cover.label.toLowerCase())}${fixed ? "" : `, ${inp.coverPct}%`}) × site activity ${fmt(cc.disturbance.factor, 1)} (${esc(cc.disturbance.label.toLowerCase())}) = <b>C ${fmtC(cc.C)}</b>`;

      // Step 5: P
      const pp = model.p(inp);
      const describe = (g) => `${g.n} practice${g.n === 1 ? "" : "s"} ×${fmt(g.factor, g.factor === 0.125 ? 3 : 2)}`;
      for (const kind of KINDS) {
        const g = pp[kind];
        const max = data.pfactor[kind].factors.length - 1;
        $(`#usle-${SHORT[kind]}-fac`).textContent = `${describe(g)}${g.n > max ? " (no extra credit past three)" : ""}`;
      }
      $("#usle-chip-p").textContent = `P = ${fmt(pp.P, 2)}`;
      $("#usle-p-calc").innerHTML = `Detachment ${describe(pp.detachment)} × deposition ${describe(pp.deposition)} = <b>P ${fmt(pp.P, 3)}</b>`;
    },
  };
})();
