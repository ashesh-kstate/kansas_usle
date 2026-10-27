/*
 * Agricultural fields: steps 4 (C) and 5 (P) of the USLE page.
 * Registers window.USLE_UI.ag for usle-app.js (load before usle-app.js).
 */
(function () {
  "use strict";
  const UI = (window.USLE_UI = window.USLE_UI || {});

  UI.ag = {
    key: "ag",
    storeKey: "usle-ks-scenarios-v1",
    files: { cfactor: "data/cfactor.json", pfactor: "data/pfactor.json", text: "data/text.json" },
    createModel: (data) => window.USLE.createModel(data),
    title: "USLE Soil Loss Calculator for Kansas",
    subtitle: "Estimate average annual sheet and rill erosion for a field and see how management and conservation practices change it.",
    factorLabels: { C: "Crop &amp; cover management", P: "Conservation practice" },
    scenarioExample: '"Current practice", "No-till + terraces"',
    hashKeys: {
      crop: "cr", coverPct: "cv", tillage: "ti", yield: "y", previousCrop: "pc",
      pastureCanopy: "gk", pastureCanopyPct: "gc", pastureSurface: "gs", pastureGround: "gg", pastureForestOM: "go",
      practice: "pr", meadowPct: "mp", bufferGrassPct: "bg", limitAdjust: "la",
      terrace: "te", interval: "in", channelGrade: "cg",
    },
    stringKeys: ["pastureCanopy", "pastureSurface", "channelGrade"],
    listKeys: [],

    // ------------------------------------------------------------ markup
    stepsHtml(h) {
      const { cfactor, pfactor } = h.data;
      const { esc, fmt, about, opts, seg } = h;
      return `
        <section class="usle-card" aria-labelledby="usle-h-c">
          <div class="usle-step-head"><span class="usle-step-no">4</span>
            <h3 id="usle-h-c">Crop &amp; management<small>C factor: crops, residue, tillage, or pasture cover</small></h3>
            <span class="usle-chip" id="usle-chip-c"></span></div>
          <div class="usle-grid2">
            <div class="usle-field"><label for="usle-crop">Cropping sequence or land use</label>
              <select class="usle-select" id="usle-crop">
                <optgroup label="Cropland and meadow">${cfactor.crops.filter((c) => !c.pasture).map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join("")}</optgroup>
                <optgroup label="Pasture and woodland (NRCS)">${cfactor.crops.filter((c) => c.pasture).map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join("")}</optgroup>
              </select></div>
          </div>
          <div class="usle-grid2 usle-sub" id="usle-cropland-fields">
            <div class="usle-field"><label for="usle-cover">Residue cover after planting: <span id="usle-cover-out" class="usle-num"></span></label>
              <input id="usle-cover" type="range" min="0" max="${cfactor.coverPct.length - 1}" step="1" list="usle-cover-ticks">
              <datalist id="usle-cover-ticks">${cfactor.coverPct.map((_, i) => `<option value="${i}"></option>`).join("")}</datalist></div>
            <div class="usle-field"><label for="usle-till">Tillage</label><select class="usle-select" id="usle-till">${opts(cfactor.tillage)}</select></div>
            <div class="usle-field"><label for="usle-yield">Expected yield</label><select class="usle-select" id="usle-yield">${opts(cfactor.yield)}</select></div>
            <div class="usle-field"><label for="usle-prev">Previous crop</label><select class="usle-select" id="usle-prev">${opts(cfactor.previousCrop)}</select></div>
          </div>
          <div class="usle-grid2 usle-sub" id="usle-pasture-fields" hidden>
            <div class="usle-field"><label for="usle-gk">Canopy (plants above the surface)</label>
              <select class="usle-select" id="usle-gk">${cfactor.pasture.canopies.map((k) => `<option value="${k.key}">${esc(k.label)}</option>`).join("")}</select></div>
            <div class="usle-field"><label for="usle-gc">Canopy cover (area shaded, seen from above)</label>
              <select class="usle-select" id="usle-gc">${[25, 50, 75].map((p) => `<option value="${p}">${p}%</option>`).join("")}</select></div>
            <div class="usle-field"><label for="usle-gg">Ground cover touching the soil</label>
              <select class="usle-select" id="usle-gg">${cfactor.pasture.groundCoverPct.map((p, i) => `<option value="${p}">${esc(cfactor.pasture.groundCoverLabels[i])}</option>`).join("")}</select></div>
            <fieldset class="usle-seg usle-seg-half"><legend class="usle-legend">Ground cover is mostly</legend>${cfactor.pasture.surfaceTypes.map((s) => `<label><input type="radio" name="usle-gs" value="${s.key}"><span>${esc(s.label)}</span><small></small></label>`).join("")}</fieldset>
            <label class="usle-check usle-full"><input type="checkbox" id="usle-go"><span>Grazed woodland with high organic matter in the topsoil (C × ${cfactor.pasture.forestOrganicMatterFactor})</span></label>
          </div>
          <div class="usle-calc" id="usle-c-calc"></div>
          <p class="usle-note" id="usle-c-note"></p>
          ${about(cfactor.about + " " + cfactor.theory)}
        </section>

        <section class="usle-card" aria-labelledby="usle-h-p">
          <div class="usle-step-head"><span class="usle-step-no">5</span>
            <h3 id="usle-h-p">Conservation practices<small>P factor: contouring, strips, buffers, terraces</small></h3>
            <span class="usle-chip" id="usle-chip-p"></span></div>
          <div class="usle-grid2">
            <fieldset class="usle-seg"><legend class="usle-legend">Practice</legend>${seg("usle-practice", pfactor.practices)}</fieldset>
            <div class="usle-field" id="usle-meadow-field"><label for="usle-meadow">${esc(pfactor.stripMeadow.label)}</label>
              <select class="usle-select" id="usle-meadow">${pfactor.stripMeadow.options.map((o) => `<option value="${o.pct}">${o.pct}% meadow (×${fmt(o.factor, 2)})</option>`).join("")}</select></div>
            <div class="usle-field" id="usle-buffer-field"><label for="usle-buffer">${esc(pfactor.bufferStrips.label)}</label>
              <select class="usle-select" id="usle-buffer">${pfactor.bufferStrips.options.map((o) => `<option value="${o.pct}">${o.pct}% of slope in grass (×${fmt(o.factor, 2)})</option>`).join("")}</select></div>
            <div class="usle-limit usle-full" id="usle-limit-box">
              <label class="usle-check"><input type="checkbox" id="usle-limit"><span>Apply NRCS slope-length limits</span></label>
              <p id="usle-limit-msg"></p>
            </div>
            <fieldset class="usle-seg"><legend class="usle-legend">Terraces</legend>${seg("usle-terrace", pfactor.terraces)}</fieldset>
            <div class="usle-field"><label for="usle-interval">Terrace interval (spacing between terraces)</label>
              <select class="usle-select" id="usle-interval">${pfactor.terraceIntervals.map((o) => `<option value="${o.id}">${esc(o.label)}</option>`).join("")}</select></div>
            <div class="usle-field" id="usle-grade-field"><label for="usle-grade">Channel grade near the outlet</label>
              <select class="usle-select" id="usle-grade">${pfactor.channelGrades.options.map((o) => `<option value="${o.key}">${esc(o.label)}</option>`).join("")}</select></div>
          </div>
          <div class="usle-calc" id="usle-p-calc"></div>
          ${about(pfactor.about)}
        </section>`;
    },

    notesHtml(h) {
      const { cfactor, pfactor, lsfactor } = h.data;
      const { esc } = h;
      const notes = [
        ...cfactor.crops.filter((c) => c.note).map((c) => `<b>${esc(c.label)}:</b> ${esc(c.note)}`),
        ...cfactor.pasture.notes.map((n) => `<b>Pasture C:</b> ${esc(n)}`),
        `<b>LS factor:</b> Defaults to the Agriculture Handbook 537 equation, which reproduces NRCS Table II. The original workbook formula is available in step 3: ${esc(lsfactor.methods.workbook.note)}`,
        ...pfactor.notes.map((n) => `<b>P factor:</b> ${esc(n)}`),
      ];
      return `<p style="margin-top:8px">Tables come from the K-State USLE workbook (USLE_Agriculture_KS08.xlsm) and the general tables of the <a href="${esc(pfactor.sourceUrl)}" target="_blank" rel="noopener">NRCS Field Office Technical Guide, Section I, USLE Erosion Prediction</a> (Iowa, 2002): LS (Table II), meadow, pasture and woodland C (IVf-IVh), and practice subfactors and limits (IIIa-IIId). Notes and differences from the workbook:</p>
        <ul>${notes.map((n) => `<li>${n}</li>`).join("")}</ul>`;
    },

    hintsHtml(h) {
      const { text } = h.data;
      const { esc, tidy } = h;
      const [hC1, hC2, hC3, ...hCrest] = text.cHints.map(tidy);
      return `
          <p class="usle-hints-h">Lower the C factor</p>
          <ul class="usle-hints">
            <li>${esc(hC1)}</li>
            <li>${esc(hC2)}<ol>${text.cCropOrder.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></li>
            <li>${esc(hC3)}<ol>${text.cTillageOrder.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></li>
            ${hCrest.map((x) => `<li>${esc(x)}</li>`).join("")}
          </ul>
          <p class="usle-hints-h">Lower the P factor</p>
          <ul class="usle-hints">${text.pHints.map((x) => `<li>${esc(tidy(x))}</li>`).join("")}</ul>`;
    },

    // ------------------------------------------------------------ behavior
    bind(ctx) {
      const { $, $$, setInput, data } = ctx;
      const { cfactor } = data;
      $("#usle-crop").addEventListener("change", (e) => setInput("crop", Number(e.target.value)));
      $("#usle-cover").addEventListener("input", (e) => setInput("coverPct", cfactor.coverPct[Number(e.target.value)]));
      for (const [id, key] of [["#usle-till", "tillage"], ["#usle-yield", "yield"], ["#usle-prev", "previousCrop"],
        ["#usle-gc", "pastureCanopyPct"], ["#usle-gg", "pastureGround"]]) {
        $(id).addEventListener("change", (e) => setInput(key, Number(e.target.value)));
      }
      $("#usle-gk").addEventListener("change", (e) => setInput("pastureCanopy", e.target.value));
      $$('input[name="usle-gs"]').forEach((r) => r.addEventListener("change", () => setInput("pastureSurface", r.value)));
      $("#usle-go").addEventListener("change", (e) => setInput("pastureForestOM", e.target.checked ? 1 : 0));

      $$('input[name="usle-practice"]').forEach((r) => r.addEventListener("change", () => setInput("practice", Number(r.value))));
      $$('input[name="usle-terrace"]').forEach((r) => r.addEventListener("change", () => setInput("terrace", Number(r.value))));
      $("#usle-interval").addEventListener("change", (e) => setInput("interval", Number(e.target.value)));
      $("#usle-meadow").addEventListener("change", (e) => setInput("meadowPct", Number(e.target.value)));
      $("#usle-buffer").addEventListener("change", (e) => setInput("bufferGrassPct", Number(e.target.value)));
      $("#usle-limit").addEventListener("change", (e) => setInput("limitAdjust", e.target.checked ? 1 : 0));
      $("#usle-grade").addEventListener("change", (e) => setInput("channelGrade", e.target.value));
    },

    sync(ctx) {
      const { $, $$, state, data } = ctx;
      const i = state.inputs;
      $("#usle-crop").value = i.crop;
      $("#usle-cover").value = Math.max(0, data.cfactor.coverPct.indexOf(i.coverPct));
      $("#usle-till").value = i.tillage;
      $("#usle-yield").value = i.yield;
      $("#usle-prev").value = i.previousCrop;
      $("#usle-gk").value = i.pastureCanopy;
      $("#usle-gc").value = i.pastureCanopyPct;
      $("#usle-gg").value = i.pastureGround;
      $$('input[name="usle-gs"]').forEach((r) => { r.checked = r.value === i.pastureSurface; });
      $("#usle-go").checked = !!Number(i.pastureForestOM);
      $$('input[name="usle-practice"]').forEach((r) => { r.checked = Number(r.value) === i.practice; });
      $("#usle-meadow").value = i.meadowPct;
      $("#usle-buffer").value = i.bufferGrassPct;
      $("#usle-limit").checked = !!Number(i.limitAdjust);
      $$('input[name="usle-terrace"]').forEach((r) => { r.checked = Number(r.value) === i.terrace; });
      $("#usle-interval").value = i.interval;
      $("#usle-grade").value = i.channelGrade;
    },

    update(ctx, inp) {
      const { $, $$, model, data, h } = ctx;
      const { cfactor } = data;
      const { esc, fmt, fmtC } = h;

      // Step 4: C
      const cc = model.c(inp);
      const isPasture = !!cc.crop.pasture;
      $("#usle-cropland-fields").hidden = isPasture;
      $("#usle-pasture-fields").hidden = !isPasture;
      $("#usle-chip-c").textContent = `C = ${fmtC(cc.C)}`;
      if (isPasture) {
        const pc = cc.pasture;
        $("#usle-gc").disabled = pc.canopy.key === "none";
        $$('input[name="usle-gs"]').forEach((r) => {
          const vals = pc.canopy.rows[pc.canopy.key === "none" ? "any" : String(inp.pastureCanopyPct)][r.value];
          r.closest("label").querySelector("small").textContent = `C ${fmtC(vals[cfactor.pasture.groundCoverPct.indexOf(Number(inp.pastureGround))])}`;
        });
        $("#usle-c-calc").innerHTML =
          `NRCS Table IVg: ${esc(pc.canopy.label.toLowerCase())}${pc.canopyPct ? `, ${pc.canopyPct}% canopy` : ""}, ${esc(pc.groundLabel)} ${esc(pc.surface.label.toLowerCase())} → ${fmtC(pc.base)}` +
          `${pc.omFactor !== 1 ? ` × ${pc.omFactor} forest topsoil` : ""} = <b>C ${fmtC(cc.C)}</b>`;
      } else {
        const fixedCover = !!cc.crop.coverIndependent;
        $("#usle-cover").disabled = fixedCover;
        $("#usle-cover-out").textContent = fixedCover ? "not used for this crop" : `${inp.coverPct}%`;
        $("#usle-c-calc").innerHTML =
          `Base C ${fmtC(cc.base)} × tillage ${cc.tillage.factor} × yield ${cc.yield.factor} × previous crop ${cc.previousCrop.factor} = <b>C ${fmtC(cc.C)}</b>`;
      }
      $("#usle-c-note").textContent = cc.crop.note ? `Note: ${cc.crop.note}` : "";

      // Step 5: P (uses 0% slope / 1 ft while those inputs are invalid)
      const pin = { ...inp, slopePct: Number.isFinite(inp.slopePct) ? inp.slopePct : 0, lengthFt: Number.isFinite(inp.lengthFt) ? inp.lengthFt : 1 };
      $$('input[name="usle-practice"]').forEach((r) => {
        r.closest("label").querySelector("small").textContent = `×${fmt(model.practiceBase(pin, Number(r.value)).factor, 2)}`;
      });
      $$('input[name="usle-terrace"]').forEach((r) => {
        r.closest("label").querySelector("small").textContent = `×${fmt(model.terraceFactor(pin, Number(r.value)).factor, 2)}`;
      });
      const pp = model.p(pin);
      const pkey = pp.practice.key;
      $("#usle-meadow-field").hidden = pkey !== "strip";
      $("#usle-buffer-field").hidden = pkey !== "buffer";
      $("#usle-grade-field").hidden = pp.terrace.key !== "open";
      $("#usle-interval").disabled = pp.terrace.key === "none";
      $("#usle-limit-box").hidden = pkey === "none";
      if (pp.limit) {
        const lm = pp.limit;
        const what = pkey === "contour" ? "contouring" : "total slope with strips or buffers";
        const bonus = lm.bonus !== 1 ? " (25% longer because residue cover is at least 50%)" : "";
        let msg = lm.exceeded
          ? `Slope length ${pin.lengthFt} ft is over the NRCS limit of ${fmt(lm.allowFt, 0)} ft for ${what} on ${lm.cls.label} slopes${bonus}. ` +
            (lm.applied ? `P for the practice rises from ${fmt(pp.practiceBaseFactor, 2)} to ${fmt(pp.practiceFactor, 2)}, since the extra length gets no protection.`
              : "Limits are off, so P is not adjusted.")
          : `Within the NRCS limit of ${fmt(lm.allowFt, 0)} ft for ${what} on ${lm.cls.label} slopes${bonus}.`;
        if (pkey !== "contour") msg += ` Keep row-crop strips no wider than ${lm.stripWidthFt} ft.`;
        $("#usle-limit-msg").textContent = msg;
        $("#usle-limit-box").classList.toggle("is-warn", lm.exceeded);
      }
      const parts = [];
      if (pkey === "none") parts.push("no practice 1.00");
      else {
        parts.push(`contour ${fmt(pp.contour, 2)} (${esc(pp.slopeClass.label)} slope)`);
        if (pkey === "strip") parts.push(`× meadow ${fmt(pp.subfactor, 2)}`);
        if (pkey === "buffer") parts.push(`× buffers ${fmt(pp.subfactor, 2)}`);
        if (pp.limit && pp.limit.applied) parts.push(`→ ${fmt(pp.practiceFactor, 2)} with length limit`);
      }
      $("#usle-chip-p").textContent = `P = ${fmt(pp.P, 2)}`;
      $("#usle-p-calc").innerHTML = `Practice: ${parts.join(" ")} × terraces ${fmt(pp.terraceFactor, 2)} = <b>P ${fmt(pp.P, 2)}</b>`;
    },
  };
})();
