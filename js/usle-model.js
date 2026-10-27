/*
 * USLE model: A = R * K * LS * C * P
 * Pure calculation code with no page code, so a RUSLE model can sit beside it
 * later and share the same inputs. Lookup tables come from data/*.json
 * (built by tools/extract_workbook.py from spreadsheet calculator and the
 * general tables of the NRCS Iowa FOTG USLE section, 2002).
 *
 * Works in the browser (window.USLE) and in Node (require / import).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.USLE = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TONS_ACRE_TO_T_HA = 2.2417; // 1 short ton/acre = 2.2417 metric t/ha

  /**
   * Parts shared by every land use: R (NOAA map grid), K and T (soils), LS, and
   * checks on those inputs. Agricultural and urban models build on this.
   */
  function createCore(data) {
    const { soils, rfactor, lsfactor } = data;
    const soilById = new Map(soils.soils.map((s) => [s.id, s]));

    // ---------------------------------------------------------------- R
    // Continuous R from NOAA's AH 703 grid (data/rfactor.json, built by
    // tools/build_rfactor.py): an Albers grid of integer R at cell centers,
    // read with bilinear interpolation. The map image shares the grid's
    // projection; map.affine converts Albers metres to map pixels.
    const map = rfactor.map;
    const grid = rfactor.grid;
    const gridValues = new Float32Array(grid.cols * grid.rows);
    grid.rows_delta.forEach((row, r) => {
      let v = 0;
      row.forEach((d, c) => { v += d; gridValues[r * grid.cols + c] = v; });
    });
    const [[a11, a12], [a21, a22], [tx, ty]] = map.affine; // [X, Y, 1] . M = [px, py]
    const det = a11 * a22 - a12 * a21;

    // USGS Albers equal-area conic on GRS80 (Snyder 1987, eqs. 3-12, 14-1 to 14-6)
    const proj = rfactor.projection;
    const RAD = Math.PI / 180;
    const fl = 1 / proj.invf, e2 = 2 * fl - fl * fl, e = Math.sqrt(e2);
    const qOf = (phi) => {
      const s = Math.sin(phi);
      return (1 - e2) * (s / (1 - e2 * s * s) - (1 / (2 * e)) * Math.log((1 - e * s) / (1 + e * s)));
    };
    const mOf = (phi) => Math.cos(phi) / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    const m1 = mOf(proj.lat1 * RAD), m2 = mOf(proj.lat2 * RAD);
    const q1 = qOf(proj.lat1 * RAD), q2 = qOf(proj.lat2 * RAD), q0 = qOf(proj.lat0 * RAD);
    const nCone = (m1 * m1 - m2 * m2) / (q2 - q1);
    const Ccone = m1 * m1 + nCone * q1;
    const rho0 = (proj.a * Math.sqrt(Ccone - nCone * q0)) / nCone;
    /** NAD83 latitude/longitude (degrees) -> Albers metres. */
    function toAlbers(lat, lon) {
      const rho = (proj.a * Math.sqrt(Ccone - nCone * qOf(lat * RAD))) / nCone;
      const theta = nCone * (lon - proj.lon0) * RAD;
      return [rho * Math.sin(theta), rho0 - rho * Math.cos(theta)];
    }
    const albersToMap = (X, Y) => [X * a11 + Y * a21 + tx, X * a12 + Y * a22 + ty];
    const mapToAlbers = (px, py) => {
      const u = px - tx, v = py - ty;
      return [(u * a22 - v * a21) / det, (v * a11 - u * a12) / det];
    };
    /** Is a map pixel inside the Kansas outline? (ray casting) */
    function insideKansas(px, py) {
      const poly = map.outline;
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }
    function gridR(X, Y) {
      const c = (X - grid.x0) / grid.cell - 0.5, r = (grid.y0 - Y) / grid.cell - 0.5;
      const c0 = Math.floor(c), r0 = Math.floor(r);
      if (c0 < 0 || r0 < 0 || c0 + 1 >= grid.cols || r0 + 1 >= grid.rows) return null;
      const fx = c - c0, fy = r - r0, at = (rr, cc) => gridValues[rr * grid.cols + cc];
      return at(r0, c0) * (1 - fx) * (1 - fy) + at(r0, c0 + 1) * fx * (1 - fy)
        + at(r0 + 1, c0) * (1 - fx) * fy + at(r0 + 1, c0 + 1) * fx * fy;
    }
    /** R at a map pixel (map units: map.width x map.height); null outside Kansas. */
    function rFromMap(px, py) {
      if (!insideKansas(px, py)) return null;
      const [X, Y] = mapToAlbers(px, py);
      return gridR(X, Y);
    }
    // County lookup (U.S. Census boundaries, in map units), with bounding boxes
    const counties = (map.counties || []).map((c) => {
      const xs = c.rings.flat().map((p) => p[0]), ys = c.rings.flat().map((p) => p[1]);
      return { ...c, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
    });
    const inRing = (ring, px, py) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    /** County name at a map pixel, or null. */
    function countyAt(px, py) {
      for (const c of counties) {
        const [x0, y0, x1, y1] = c.box;
        if (px < x0 || px > x1 || py < y0 || py > y1) continue;
        if (c.rings.some((r) => inRing(r, px, py))) return c.name;
      }
      return null;
    }
    /** R and county at a latitude/longitude, with its map position; R is null outside Kansas. */
    function rAt(lat, lon) {
      const [X, Y] = toAlbers(lat, lon);
      const [px, py] = albersToMap(X, Y);
      const inside = insideKansas(px, py);
      return { R: inside ? gridR(X, Y) : null, county: inside ? countyAt(px, py) : null, x: px, y: py };
    }

    // ---------------------------------------------------------------- K, T
    function k(soilId) {
      const soil = soilById.get(Number(soilId));
      if (!soil) throw new Error(`Unknown soil id ${soilId}`);
      return { K: soil.K, T: soil.T, soil };
    }

    // ---------------------------------------------------------------- LS
    // "nrcs": AH 537 equation, reproduces NRCS FOTG Table II.
    // "workbook": the K-State workbook's LSfactor!H13 and B45.
    function lsMethod(name) {
      const key = name || lsfactor.method;
      const m = lsfactor.methods[key];
      if (!m) throw new Error(`Unknown LS method ${name}`);
      return { key, ...m };
    }
    function slopeExponent(slopePct, method) {
      const exps = lsMethod(method).exponent;
      for (const e of exps) {
        if (e.greaterThan != null ? slopePct > e.greaterThan : slopePct >= e.minSlope) return e.m;
      }
      return exps[exps.length - 1].m;
    }
    function ls(lengthFt, slopePct, method) {
      const meth = lsMethod(method);
      const m = slopeExponent(slopePct, meth.key);
      // steepness variable: sin(theta) for the AH 537 form, slope % for the workbook form
      const x = meth.steepness === "sine" ? Math.sin(Math.atan(slopePct / 100)) : slopePct;
      const steep = meth.a * x * x + meth.b * x + meth.c;
      const lengthTerm = Math.pow(lengthFt / meth.unitPlotLength, m);
      return { LS: lengthTerm * steep, m, lengthTerm, steepnessTerm: steep, method: meth };
    }

    // ---------------------------------------------------------------- inputs
    function baseDefaults() {
      return {
        R: rfactor.default,
        soilId: soils.defaultId,
        lengthFt: lsfactor.defaults.lengthFt,
        slopePct: lsfactor.defaults.slopePct,
        lsMethod: lsfactor.method,
      };
    }
    /** Errors for R, slope, soil and LS method (keys match the input names). */
    function validateBase(inp) {
      const errors = {};
      const [rMin, rMax] = rfactor.limits;
      const [lMin, lMax] = lsfactor.limits.lengthFt;
      const [sMin, sMax] = lsfactor.limits.slopePct;
      const num = (v) => typeof v === "number" && Number.isFinite(v);
      if (!num(inp.R) || inp.R < rMin || inp.R > rMax) errors.R = `Enter an R value from ${rMin} to ${rMax}.`;
      if (!num(inp.lengthFt) || inp.lengthFt < lMin || inp.lengthFt > lMax) errors.lengthFt = `Enter a slope length from ${lMin} to ${lMax} ft.`;
      if (!num(inp.slopePct) || inp.slopePct < sMin || inp.slopePct > sMax) errors.slopePct = `Enter a slope from ${sMin} to ${sMax}%.`;
      if (!soilById.has(Number(inp.soilId))) errors.soilId = "Select a soil.";
      if (!lsfactor.methods[inp.lsMethod]) errors.lsMethod = "Unknown LS method.";
      return errors;
    }
    /** Fill inputs missing from older links or saved scenarios. */
    function completeWith(defaults, inp) {
      const out = { ...inp };
      for (const key of Object.keys(defaults)) {
        if (out[key] === undefined || out[key] === null || out[key] === "") out[key] = defaults[key];
      }
      return out;
    }
    /** A = R K LS C P, given functions that return {C} and {P}. */
    function computeWith(inp, errors, cFn, pFn) {
      if (Object.keys(errors).length) return { ok: false, errors };
      const kk = k(inp.soilId);
      const l = ls(inp.lengthFt, inp.slopePct, inp.lsMethod);
      const cc = cFn(inp);
      const pp = pFn(inp);
      const A = inp.R * kk.K * l.LS * cc.C * pp.P;
      return {
        ok: true,
        A, T: kk.T,
        ratio: A / kk.T,
        exceedsT: A > kk.T, // workbook Results!C16 uses A > T
        factors: { R: inp.R, K: kk.K, LS: l.LS, C: cc.C, P: pp.P },
        detail: { k: kk, ls: l, c: cc, p: pp },
      };
    }

    return {
      rFromMap, rAt, countyAt, toAlbers, insideKansas, k, ls, lsMethod, slopeExponent,
      baseDefaults, validateBase, completeWith, computeWith,
      soils: soils.soils,
    };
  }

  function createModel(data) {
    const { cfactor, pfactor } = data;
    const core = createCore(data);
    const { rFromMap, k, ls, lsMethod, slopeExponent } = core;
    const byId = (list) => new Map(list.map((o) => [o.id, o]));
    const crops = byId(cfactor.crops);
    const tillage = byId(cfactor.tillage);
    const yieldAdj = byId(cfactor.yield);
    const prevCrop = byId(cfactor.previousCrop);
    const practices = byId(pfactor.practices);
    const terraces = byId(pfactor.terraces);
    const intervals = byId(pfactor.terraceIntervals);
    const pasture = cfactor.pasture;

    // ---------------------------------------------------------------- inputs
    function defaults() {
      const cd = cfactor.defaults, pd = pfactor.defaults;
      return {
        ...core.baseDefaults(),
        crop: cd.crop,
        coverPct: cfactor.coverPct[cd.coverIndex - 1],
        tillage: cd.tillage,
        yield: cd.yield,
        previousCrop: cd.previousCrop,
        // pasture, idle land, grazed woodland (NRCS Table IVg)
        pastureCanopy: "none",
        pastureCanopyPct: 50,
        pastureSurface: "G",
        pastureGround: 60,
        pastureForestOM: 0,
        // practices (NRCS Tables IIIa-IIId)
        practice: pd.practice,
        meadowPct: pfactor.stripMeadow.default,
        bufferGrassPct: pfactor.bufferStrips.default,
        limitAdjust: 1,
        terrace: pd.terrace,
        interval: pd.interval,
        channelGrade: pfactor.channelGrades.default,
      };
    }
    /** Fill inputs missing from older links or saved scenarios. */
    function complete(inp) {
      return core.completeWith(defaults(), inp);
    }

    // ---------------------------------------------------------------- C
    function coverIndex(coverPct) {
      const i = cfactor.coverPct.indexOf(Number(coverPct));
      if (i < 0) throw new Error(`Residue cover must be one of ${cfactor.coverPct.join(", ")}%`);
      return i;
    }
    /** NRCS Table IVg: permanent pasture, idle land, or grazed woodland. */
    function pastureC(inp) {
      const canopy = pasture.canopies.find((x) => x.key === inp.pastureCanopy);
      if (!canopy) throw new Error(`Unknown canopy type ${inp.pastureCanopy}`);
      const rowKey = canopy.key === "none" ? "any" : String(inp.pastureCanopyPct);
      const row = canopy.rows[rowKey];
      if (!row) throw new Error(`Canopy cover must be ${canopy.canopyCoverPct.join(", ")}%`);
      const values = row[inp.pastureSurface];
      if (!values) throw new Error(`Unknown surface cover type ${inp.pastureSurface}`);
      const gi = pasture.groundCoverPct.indexOf(Number(inp.pastureGround));
      if (gi < 0) throw new Error(`Ground cover must be one of ${pasture.groundCoverPct.join(", ")}%`);
      const omFactor = Number(inp.pastureForestOM) ? pasture.forestOrganicMatterFactor : 1;
      return {
        base: values[gi], omFactor, canopy,
        canopyPct: canopy.key === "none" ? null : Number(inp.pastureCanopyPct),
        surface: pasture.surfaceTypes.find((s) => s.key === inp.pastureSurface),
        groundLabel: pasture.groundCoverLabels[gi],
      };
    }
    // Cropland: workbook Cfactor!G16:G22 = base(crop, cover) * tillage * yield * previous crop
    function c(input) {
      const inp = complete(input);
      const crop = crops.get(Number(inp.crop));
      if (!crop) throw new Error(`Unknown crop ${inp.crop}`);
      if (crop.pasture) {
        const pc = pastureC(inp);
        return { C: pc.base * pc.omFactor, base: pc.base, crop, pasture: pc };
      }
      let base;
      if (crop.fixedC != null) base = crop.fixedC; // NRCS meadow / forest values
      else {
        const values = cfactor.tables[crop.table].values;
        base = crop.coverIndependent ? values[0] : values[coverIndex(inp.coverPct)];
      }
      const till = tillage.get(Number(inp.tillage));
      const yld = yieldAdj.get(Number(inp.yield));
      const prev = prevCrop.get(Number(inp.previousCrop));
      if (!till || !yld || !prev) throw new Error("Unknown tillage, yield, or previous crop option");
      return {
        C: base * till.factor * yld.factor * prev.factor,
        base, crop,
        tillage: till, yield: yld, previousCrop: prev,
      };
    }
    /** Residue cover after planting that counts for the NRCS slope-length bonus. */
    function residueCover(inp) {
      const crop = crops.get(Number(inp.crop));
      return crop && !crop.pasture && !crop.coverIndependent ? Number(inp.coverPct) : 0;
    }

    // ---------------------------------------------------------------- P
    // Workbook Practices!H101 slope classes (contour P values)
    function slopeClass(slopePct) {
      for (const sc of pfactor.slopeClasses) {
        if (sc.maxSlope == null || slopePct <= sc.maxSlope) return sc;
      }
      return pfactor.slopeClasses[pfactor.slopeClasses.length - 1];
    }
    // NRCS Table IIIa slope-length limit classes
    function limitClass(slopePct) {
      const list = pfactor.slopeLengthLimits.classes;
      for (const lc of list) if (lc.maxSlope == null || slopePct <= lc.maxSlope) return lc;
      return list[list.length - 1];
    }
    function optionFactor(table, pct) {
      const o = table.options.find((x) => x.pct === Number(pct));
      if (!o) throw new Error(`${table.label} must be one of ${table.options.map((x) => x.pct).join(", ")}%`);
      return o.factor;
    }
    /** Practice P before any slope-length adjustment (NRCS Tables IIIb, IIIc). */
    function practiceBase(input, practiceId) {
      const inp = complete(input);
      const practice = practices.get(Number(practiceId ?? inp.practice));
      if (!practice) throw new Error("Unknown practice option");
      const sc = slopeClass(inp.slopePct);
      let subfactor = 1;
      if (practice.key === "strip") subfactor = optionFactor(pfactor.stripMeadow, inp.meadowPct);
      if (practice.key === "buffer") subfactor = optionFactor(pfactor.bufferStrips, inp.bufferGrassPct);
      const factor = practice.key === "none" ? 1 : sc.contour * subfactor;
      return { practice, slopeClass: sc, contour: sc.contour, subfactor, factor };
    }
    /** Terrace subfactor (NRCS Table IIId). */
    function terraceFactor(input, terraceId) {
      const inp = complete(input);
      const terrace = terraces.get(Number(terraceId ?? inp.terrace));
      if (!terrace) throw new Error("Unknown terrace option");
      if (terrace.key === "none") return { terrace, factor: 1, interval: null };
      const interval = intervals.get(Number(inp.interval));
      if (!interval) throw new Error(`Unknown terrace interval ${inp.interval}`);
      let factor = interval.closed;
      if (terrace.key === "open") {
        factor = interval.openByGrade[inp.channelGrade];
        if (factor == null) throw new Error(`Unknown channel grade ${inp.channelGrade}`);
      }
      return { terrace, factor, interval };
    }
    function p(input) {
      const inp = complete(input);
      const pb = practiceBase(inp);
      // NRCS Table IIIa: P moves toward 1 for the slope length beyond the limit
      let limit = null, practiceFactor = pb.factor;
      if (pb.practice.key !== "none") {
        const lc = limitClass(inp.slopePct);
        const baseFt = pb.practice.key === "contour" ? lc.contourFt : lc.totalFt;
        const bonus = residueCover(inp) >= pfactor.slopeLengthLimits.residueBonus.minCoverPct
          ? pfactor.slopeLengthLimits.residueBonus.factor : 1;
        const allowFt = baseFt * bonus;
        const L = Number(inp.lengthFt);
        const exceeded = L > allowFt;
        const applied = exceeded && !!Number(inp.limitAdjust);
        if (applied) practiceFactor = (allowFt * pb.factor + (L - allowFt) * 1) / L;
        limit = { cls: lc, baseFt, bonus, allowFt, exceeded, applied, stripWidthFt: lc.stripWidthFt };
      }
      const tf = terraceFactor(inp);
      return {
        P: practiceFactor * tf.factor,
        practice: pb.practice, slopeClass: pb.slopeClass, contour: pb.contour, subfactor: pb.subfactor,
        practiceBaseFactor: pb.factor, practiceFactor, limit,
        terrace: tf.terrace, terraceFactor: tf.factor, interval: tf.interval,
      };
    }

    // ---------------------------------------------------------------- checks
    function validate(input) {
      const inp = complete(input);
      const errors = core.validateBase(inp);
      try { c(inp); } catch (e) { errors.crop = e.message; }
      if (!errors.slopePct && !errors.lengthFt) {
        try { p(inp); } catch (e) { errors.practice = e.message; }
      }
      return errors;
    }

    // ---------------------------------------------------------------- A
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
        const next = { ...inp, ...change };
        const r = compute(next);
        if (!r.ok) return;
        out.push({ group, label, change, inputs: next, A: r.A, pctChange: (r.A - base.A) / base.A * 100 });
      };
      const crop = crops.get(Number(inp.crop));
      if (crop.pasture) {
        const gc = pasture.groundCoverPct, i = gc.indexOf(Number(inp.pastureGround));
        for (const j of [i + 1, i + 2]) {
          if (j < gc.length) add("Ground cover", `${pasture.groundCoverLabels[j]} ground cover`, { pastureGround: gc[j] });
        }
      } else {
        for (const t of cfactor.tillage) if (t.id !== Number(inp.tillage)) add("Tillage", t.label, { tillage: t.id });
        if (!crop.coverIndependent) {
          for (const cp of cfactor.coverPct) {
            if (cp > inp.coverPct && (cp - inp.coverPct) % 20 === 0 && cp - inp.coverPct <= 40) {
              add("Residue cover", `${cp}% residue cover`, { coverPct: cp });
            }
          }
        }
      }
      const practiceLabel = (pr, x) => (pr.key === "strip" ? `${pr.label}, ${x.meadowPct}% meadow`
        : pr.key === "buffer" ? `${pr.label}, ${x.bufferGrassPct}% in grass` : pr.label);
      for (const pr of pfactor.practices) if (pr.id !== Number(inp.practice)) add("Practice", practiceLabel(pr, inp), { practice: pr.id });
      const current = practices.get(Number(inp.practice));
      if (current.key === "strip") {
        for (const o of pfactor.stripMeadow.options) if (o.pct > inp.meadowPct) add("Practice", practiceLabel(current, { meadowPct: o.pct }), { meadowPct: o.pct });
      }
      if (current.key === "buffer") {
        for (const o of pfactor.bufferStrips.options) if (o.pct > inp.bufferGrassPct) add("Practice", practiceLabel(current, { bufferGrassPct: o.pct }), { bufferGrassPct: o.pct });
      }
      const interval = Number(inp.terrace) === 3 || !inp.interval ? 2 : inp.interval;
      for (const te of pfactor.terraces) {
        if (te.id === Number(inp.terrace)) continue;
        const label = te.key === "none" ? te.label : `${te.label}, ${intervals.get(interval).label.replace(/\s*\(.*\)$/, "")} apart`;
        add("Terraces", label, { terrace: te.id, interval });
      }
      return out.sort((a, b) => a.A - b.A);
    }

    return {
      data, defaults, complete, validate, compute, alternatives,
      rFromMap, rAt: core.rAt, countyAt: core.countyAt, toAlbers: core.toAlbers, k, ls, lsMethod, c, p, practiceBase, terraceFactor,
      slopeClass, limitClass, slopeExponent, residueCover,
      soils: core.soils,
    };
  }

  return { createCore, createModel, TONS_ACRE_TO_T_HA };
});
