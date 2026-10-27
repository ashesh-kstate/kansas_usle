/*
 * USLE model for urban and construction sites: A = R * K * LS * C * P
 * R, K, LS come from the shared core in usle-model.js. C and P follow
 * spreadsheet calculator (data/urban/*.json, built by tools/extract_urban.py):
 *   C = ground-cover C (cover type, % cover) * site-disturbance multiplier
 *   P = detachment factor (number of practices) * deposition factor (number of practices)
 *
 * Load after usle-model.js in the browser (adds USLE.createUrbanModel);
 * in Node, require this file directly.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./usle-model.js"));
  else root.USLE.createUrbanModel = factory(root.USLE).createUrbanModel;
})(typeof self !== "undefined" ? self : this, function (USLE) {
  "use strict";

  function createUrbanModel(data) {
    const { cfactor, pfactor } = data;
    const core = USLE.createCore(data);
    const covers = new Map(cfactor.covers.map((c) => [c.id, c]));
    const disturbance = new Map(cfactor.disturbance.map((d) => [d.id, d]));
    const practiceIds = (kind) => new Set(pfactor[kind].groups.flatMap((g) => g.practices.map((x) => x.id)));
    const validIds = { detachment: practiceIds("detachment"), deposition: practiceIds("deposition") };
    const practiceById = (kind) => new Map(pfactor[kind].groups.flatMap((g) => g.practices.map((x) => [x.id, { ...x, group: g }])));
    const practiceMaps = { detachment: practiceById("detachment"), deposition: practiceById("deposition") };

    // ---------------------------------------------------------------- inputs
    function defaults() {
      const cd = cfactor.defaults, pd = pfactor.defaults;
      return {
        ...core.baseDefaults(),
        ...cfactor.siteDefaults,
        cover: cd.cover,
        coverPct: cd.coverPct,
        disturbance: cd.disturbance,
        detachment: [...pd.detachment],
        deposition: [...pd.deposition],
      };
    }
    /** Practice lists may arrive as arrays, "1,4" strings (links) or be missing. */
    function idList(v, kind) {
      const raw = Array.isArray(v) ? v : String(v ?? "").split(",");
      const ids = raw.map((x) => Number(String(x).trim())).filter((x) => validIds[kind].has(x));
      return [...new Set(ids)].sort((a, b) => a - b);
    }
    function complete(inp) {
      const out = core.completeWith(defaults(), inp);
      out.detachment = idList(inp.detachment ?? defaults().detachment, "detachment");
      out.deposition = idList(inp.deposition ?? defaults().deposition, "deposition");
      return out;
    }

    // ---------------------------------------------------------------- C
    // Workbook Cfactor!G16:G20 = ground-cover C * disturbance
    function c(input) {
      const inp = complete(input);
      const cover = covers.get(Number(inp.cover));
      if (!cover) throw new Error(`Unknown ground cover ${inp.cover}`);
      let base;
      if (cover.coverIndependent) base = cover.values[0];
      else {
        const i = cfactor.coverPct.indexOf(Number(inp.coverPct));
        if (i < 0) throw new Error(`Ground cover must be one of ${cfactor.coverPct.join(", ")}%`);
        base = cover.values[i];
      }
      const dist = disturbance.get(Number(inp.disturbance));
      if (!dist) throw new Error(`Unknown site disturbance ${inp.disturbance}`);
      return { C: base * dist.factor, base, cover, disturbance: dist };
    }

    // ---------------------------------------------------------------- P
    // Workbook Pfactor!H19:H21 (counts of checked practices, capped at 3)
    function groupFactor(kind, ids) {
      const factors = pfactor[kind].factors;
      const n = ids.length;
      return { n, factor: factors[Math.min(n, factors.length - 1)], practices: ids.map((id) => practiceMaps[kind].get(id)) };
    }
    function p(input) {
      const inp = complete(input);
      const det = groupFactor("detachment", inp.detachment);
      const dep = groupFactor("deposition", inp.deposition);
      return { P: det.factor * dep.factor, detachment: det, deposition: dep };
    }

    // ---------------------------------------------------------------- A
    function validate(input) {
      const inp = complete(input);
      const errors = core.validateBase(inp);
      try { c(inp); } catch (e) { errors.cover = e.message; }
      return errors;
    }
    function compute(input) {
      const inp = complete(input);
      return core.computeWith(inp, validate(inp), c, p);
    }

    // ---------------------------------------------------------------- BMPs
    /** Single-change "what if" scenarios built from the current inputs. */
    function alternatives(input) {
      const inp = complete(input);
      const base = compute(inp);
      if (!base.ok) return [];
      const out = [];
      const add = (group, label, change) => {
        const r = compute({ ...inp, ...change });
        if (!r.ok) return;
        out.push({ group, label, change, A: r.A, pctChange: (r.A - base.A) / base.A * 100 });
      };
      const cover = covers.get(Number(inp.cover));
      // more of the same cover
      if (!cover.coverIndependent) {
        for (const cp of cfactor.coverPct) {
          if (cp > inp.coverPct && (cp - inp.coverPct) % 20 === 0 && cp - inp.coverPct <= 40) add("Ground cover", `${cp}% ${cover.label.toLowerCase()}`, { coverPct: cp });
        }
      }
      // a different protective cover (not land uses such as pavement or housing)
      const notBmp = new Set(["Bare Surface", "Pavement", "High Density Housing"]);
      for (const other of cfactor.covers) {
        if (other.id === cover.id || notBmp.has(other.label)) continue;
        add("Ground cover", other.coverIndependent ? other.label : `${other.label} at ${inp.coverPct}%`, { cover: other.id });
      }
      // gentler site activity (one option per multiplier: "None" and compaction are both x1.0)
      const current = disturbance.get(Number(inp.disturbance));
      const seen = new Set([current.factor]);
      for (const d of cfactor.disturbance) {
        if (seen.has(d.factor)) continue;
        seen.add(d.factor);
        add("Disturbance", d.label, { disturbance: d.id });
      }
      // one more practice in each group (no credit past three)
      for (const kind of ["detachment", "deposition"]) {
        const ids = inp[kind];
        if (ids.length >= pfactor[kind].factors.length - 1) continue;
        const next = pfactor[kind].groups.flatMap((g) => g.practices).find((x) => !ids.includes(x.id));
        if (next) add(pfactor[kind].label, `Add ${next.label.toLowerCase()}`, { [kind]: [...ids, next.id].sort((a, b) => a - b) });
      }
      return out.sort((a, b) => a.A - b.A);
    }

    return {
      data, defaults, complete, validate, compute, alternatives,
      rFromMap: core.rFromMap, rAt: core.rAt, countyAt: core.countyAt, k: core.k, ls: core.ls, lsMethod: core.lsMethod, slopeExponent: core.slopeExponent,
      c, p, soils: core.soils,
    };
  }

  return { createUrbanModel };
});
