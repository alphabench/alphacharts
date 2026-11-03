//! Raw kernels over linear memory for the hot loops of a charting/indicator
//! library. Every function is `extern "C"`, takes pointers into the module's
//! memory plus lengths, and writes results through output pointers. The JS
//! side (`src/wasm.ts`) owns all allocation: the module has no allocator.
//!
//! Contract shared by all kernels
//! - Input columns are dense `f64` without NaN (except where a kernel says
//!   otherwise: the LOD and volume-profile kernels define their own holes).
//! - Outputs have the same length `n` as the input; warm-up slots are NaN.
//! - Pointers must be 8-byte aligned (the JS arena aligns to 16), input and
//!   output ranges must not overlap, and `n`, `p` are validated by the caller.
//!   Nothing here bounds-checks: that is the point of a raw kernel.
//!
//! Exactness contract: the floating-point operations of each kernel are the
//! same operations, in the same order, as the matching JS function in
//! `src/js.ts` (and as the study engine's graph nodes), so the results are
//! equal bit for bit. Therefore:
//! - SIMD is used only where lanes are independent (neighbouring outputs of a
//!   window scan, rows of a bucket reduced with compare+select, linreg windows
//!   side by side). A reduction is never reassociated.
//! - Max/min use compare+bitselect, never `f64x2.max`, because the latter
//!   orders -0 below +0 while the engine keeps the first of equal values.
//! - No fused multiply-add: Rust does not contract, and wasm has none outside
//!   relaxed-simd, which is not enabled.
#![no_std]
#![allow(clippy::missing_safety_doc)]

use core::arch::wasm32::*;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

const NAN: f64 = f64::NAN;

#[inline(always)]
unsafe fn sqrt(x: f64) -> f64 {
    f64x2_extract_lane::<0>(f64x2_sqrt(f64x2_splat(x)))
}

// ---- rolling sum / mean / variance -------------------------------------------

/// Running-sum window: add the new element, subtract the one leaving.
/// `out[i]` is NaN for i < p-1. `state` (nullable) receives the running sum at
/// every i, warm-up included (the engine's aux column).
#[no_mangle]
pub unsafe extern "C" fn k_sum(x: *const f64, n: usize, p: usize, out: *mut f64, state: *mut f64) {
    let mut t = 0.0f64;
    for i in 0..n {
        let mut r = t + *x.add(i);
        if i + 1 > p {
            r -= *x.add(i - p);
        }
        t = r;
        if !state.is_null() {
            *state.add(i) = r;
        }
        // p == 1 returns x itself: t + x - x' would otherwise leak rounding into a window of one.
        *out.add(i) = if p == 1 { *x.add(i) } else if i + 1 >= p { r } else { NAN };
    }
}

/// Rolling mean = running sum / p.
#[no_mangle]
pub unsafe extern "C" fn k_mean(x: *const f64, n: usize, p: usize, out: *mut f64) {
    let pf = p as f64;
    let mut t = 0.0f64;
    for i in 0..n {
        let mut r = t + *x.add(i);
        if i + 1 > p {
            r -= *x.add(i - p);
        }
        t = r;
        *out.add(i) = if p == 1 { *x.add(i) / pf } else if i + 1 >= p { r / pf } else { NAN };
    }
}

/// Population variance, mean-centred two-pass over each window (running sums
/// of squares lose ~1e-8 relative on price series): mean = rolling mean, then
/// sum of (x - mean)^2 over the window in order, / p. `root` != 0 writes the
/// standard deviation instead. Windows are independent, so four of them run
/// side by side as SIMD lanes; each window's sum keeps its sequential order.
#[no_mangle]
pub unsafe extern "C" fn k_variance(x: *const f64, n: usize, p: usize, out: *mut f64, root: u32) {
    k_mean(x, n, p, out); // pass 1: the means (NaN in warm-up) land in `out`
    let pf = p as f64;
    let pv = f64x2_splat(pf);
    let mut i = p - 1;
    while i + 4 <= n {
        let base = x.add(i + 1 - p);
        let m01 = v128_load(out.add(i) as *const v128);
        let m23 = v128_load(out.add(i + 2) as *const v128);
        let mut a = f64x2_splat(0.0);
        let mut b = f64x2_splat(0.0);
        for j in 0..p {
            let d01 = f64x2_sub(v128_load(base.add(j) as *const v128), m01);
            let d23 = f64x2_sub(v128_load(base.add(j + 2) as *const v128), m23);
            a = f64x2_add(a, f64x2_mul(d01, d01));
            b = f64x2_add(b, f64x2_mul(d23, d23));
        }
        a = f64x2_div(a, pv);
        b = f64x2_div(b, pv);
        if root != 0 {
            a = f64x2_sqrt(a);
            b = f64x2_sqrt(b);
        }
        v128_store(out.add(i) as *mut v128, a);
        v128_store(out.add(i + 2) as *mut v128, b);
        i += 4;
    }
    while i < n {
        let mean = *out.add(i);
        let base = x.add(i + 1 - p);
        let mut t = 0.0f64;
        for j in 0..p {
            let d = *base.add(j) - mean;
            t += d * d;
        }
        let v = t / pf;
        *out.add(i) = if root != 0 { sqrt(v) } else { v };
        i += 1;
    }
}

// ---- recursive smoothing -----------------------------------------------------

/// y = y' + alpha (x - y'), seeded with the simple mean of the first p values.
/// A NaN result (non-finite input) re-seeds from the next full window, as the
/// engine does.
#[no_mangle]
pub unsafe extern "C" fn k_smooth(x: *const f64, n: usize, p: usize, alpha: f64, out: *mut f64) {
    let pf = p as f64;
    let mut prev = NAN;
    for i in 0..n {
        let v = if prev == prev {
            prev + alpha * (*x.add(i) - prev)
        } else if i + 1 >= p {
            let mut t = 0.0f64;
            for j in (i + 1 - p)..=i {
                t += *x.add(j);
            }
            t / pf
        } else {
            NAN
        };
        *out.add(i) = v;
        prev = v;
    }
}

/// Linearly weighted mean, newest bar weighted p.
#[no_mangle]
pub unsafe extern "C" fn k_wma(x: *const f64, n: usize, p: usize, out: *mut f64) {
    let pf = p as f64;
    let den = (pf * (pf + 1.0)) / 2.0;
    let mut s = 0.0f64; // sum of the window
    let mut w = 0.0f64; // sum of (weight * value)
    for i in 0..n {
        let x1 = *x.add(i);
        let k = i + 1;
        if k <= p {
            // filling: weights 1..k; at k == p the same update gives the full window
            s += x1;
            w += (k as f64) * x1;
            *out.add(i) = if k == p { w / den } else { NAN };
        } else {
            let s0 = s;
            w = w - s0 + pf * x1;
            s = s0 - *x.add(i - p) + x1;
            *out.add(i) = w / den;
        }
    }
}

// ---- rolling extremes --------------------------------------------------------

/// Windows up to this length use the SIMD brute-force scan; longer ones the
/// van Herk / Gil-Werman block scan (3 passes, O(n) for any p). Chosen by
/// `pnpm bench`; exported so the JS side sizes the scratch it must provide.
const BRUTE_MAX: usize = 16;

#[no_mangle]
pub extern "C" fn k_brute_max() -> usize {
    BRUTE_MAX
}

/// Highest/lowest over the last p values (`max` != 0 for highest), or with
/// `bars` != 0 the bars since that extreme (0 = this bar, ties pick the most
/// recent). `scratch` must hold 2n u32 when p > BRUTE_MAX (unused otherwise).
#[no_mangle]
pub unsafe extern "C" fn k_extreme(
    x: *const f64,
    n: usize,
    p: usize,
    out: *mut f64,
    scratch: *mut u32,
    max: u32,
    bars: u32,
) {
    match (p <= BRUTE_MAX, max != 0, bars != 0) {
        (true, true, true) => brute::<true, true>(x, n, p, out),
        (true, true, false) => brute::<true, false>(x, n, p, out),
        (true, false, true) => brute::<false, true>(x, n, p, out),
        (true, false, false) => brute::<false, false>(x, n, p, out),
        (false, true, true) => block::<true, true>(x, n, p, out, scratch),
        (false, true, false) => block::<true, false>(x, n, p, out, scratch),
        (false, false, true) => block::<false, true>(x, n, p, out, scratch),
        (false, false, false) => block::<false, false>(x, n, p, out, scratch),
    }
}

/// van Herk / Gil-Werman: split the series into blocks of p; a window is a
/// suffix of one block plus a prefix of the next. `pre[i]` / `suf[i]` hold the
/// INDEX of the extreme of the block's prefix up to i / suffix from i. Equal
/// values: the newer index wins everywhere (>= in the forward scan, strict > in
/// the backward one), which is the engine's tie rule.
unsafe fn block<const MAX: bool, const BARS: bool>(x: *const f64, n: usize, p: usize, out: *mut f64, scratch: *mut u32) {
    let pre = scratch;
    let suf = scratch.add(n);
    let mut run = 0usize;
    for i in 0..n {
        if i % p == 0 {
            run = i;
        } else {
            let v = *x.add(i);
            let b = *x.add(run);
            if (MAX && v >= b) || (!MAX && v <= b) {
                run = i;
            }
        }
        *pre.add(i) = run as u32;
    }
    let mut run = n.wrapping_sub(1);
    for i in (0..n).rev() {
        if i == n - 1 || (i + 1) % p == 0 {
            run = i;
        } else {
            let v = *x.add(i);
            let b = *x.add(run);
            if (MAX && v > b) || (!MAX && v < b) {
                run = i;
            }
        }
        *suf.add(i) = run as u32;
    }
    let warm = if n < p - 1 { n } else { p - 1 };
    for i in 0..warm {
        *out.add(i) = NAN;
    }
    for i in (p - 1)..n {
        let a = *pre.add(i) as usize;
        let b = *suf.add(i + 1 - p) as usize;
        let (va, vb) = (*x.add(a), *x.add(b));
        let pick_a = (MAX && va >= vb) || (!MAX && va <= vb);
        let at = if pick_a { a } else { b };
        *out.add(i) = if BARS { (i - at) as f64 } else { *x.add(at) };
    }
}

/// Two adjacent outputs per step (lane = output), scanning the windows from
/// the newest element back with compare+select: exact, including -0/+0.
/// With BARS a second vector tracks the offset j of the winner.
unsafe fn brute<const MAX: bool, const BARS: bool>(x: *const f64, n: usize, p: usize, out: *mut f64) {
    let warm = if n < p - 1 { n } else { p - 1 };
    for i in 0..warm {
        *out.add(i) = NAN;
    }
    let mut i = p - 1;
    while i + 1 < n {
        let mut best = v128_load(x.add(i) as *const v128);
        let mut at = f64x2_splat(0.0);
        for j in 1..p {
            let y = v128_load(x.add(i - j) as *const v128);
            let better = if MAX { f64x2_gt(y, best) } else { f64x2_lt(y, best) };
            best = v128_bitselect(y, best, better);
            if BARS {
                at = v128_bitselect(f64x2_splat(j as f64), at, better);
            }
        }
        v128_store(out.add(i) as *mut v128, if BARS { at } else { best });
        i += 2;
    }
    if i < n {
        let mut best = *x.add(i);
        let mut at = 0usize;
        for j in 1..p {
            let y = *x.add(i - j);
            if (MAX && y > best) || (!MAX && y < best) {
                best = y;
                at = j;
            }
        }
        *out.add(i) = if BARS { at as f64 } else { best };
    }
}

// ---- linear regression -------------------------------------------------------

/// Least-squares line over each window of p (>= 2) bars against 0..p-1. Each
/// window's sums run in the engine's order j = 0..p-1; four neighbouring
/// windows share the loop as SIMD lanes, so nothing is reordered.
#[no_mangle]
pub unsafe extern "C" fn k_linreg(
    x: *const f64,
    n: usize,
    p: usize,
    value: *mut f64,
    slope: *mut f64,
    icpt: *mut f64,
) {
    let pf = p as f64;
    let sum_x = (pf * (pf - 1.0)) / 2.0;
    let sum_x_sqr = (pf * (pf - 1.0) * (2.0 * pf - 1.0)) / 6.0;
    let div = pf * sum_x_sqr - sum_x * sum_x;
    let warm = if n < p - 1 { n } else { p - 1 };
    for i in 0..warm {
        *value.add(i) = NAN;
        *slope.add(i) = NAN;
        *icpt.add(i) = NAN;
    }
    let finish = |i: usize, sy: f64, sxy: f64| {
        let m = (pf * sxy - sum_x * sy) / div;
        let bb = (sy - m * sum_x) / pf;
        *slope.add(i) = m;
        *icpt.add(i) = bb;
        *value.add(i) = bb + m * (pf - 1.0);
    };
    let mut i = p - 1;
    while i + 4 <= n {
        let base = x.add(i + 1 - p);
        let mut sy01 = f64x2_splat(0.0);
        let mut sy23 = f64x2_splat(0.0);
        let mut sxy01 = f64x2_splat(0.0);
        let mut sxy23 = f64x2_splat(0.0);
        for j in 0..p {
            let jv = f64x2_splat(j as f64);
            let y01 = v128_load(base.add(j) as *const v128);
            let y23 = v128_load(base.add(j + 2) as *const v128);
            sy01 = f64x2_add(sy01, y01);
            sy23 = f64x2_add(sy23, y23);
            sxy01 = f64x2_add(sxy01, f64x2_mul(jv, y01));
            sxy23 = f64x2_add(sxy23, f64x2_mul(jv, y23));
        }
        finish(i, f64x2_extract_lane::<0>(sy01), f64x2_extract_lane::<0>(sxy01));
        finish(i + 1, f64x2_extract_lane::<1>(sy01), f64x2_extract_lane::<1>(sxy01));
        finish(i + 2, f64x2_extract_lane::<0>(sy23), f64x2_extract_lane::<0>(sxy23));
        finish(i + 3, f64x2_extract_lane::<1>(sy23), f64x2_extract_lane::<1>(sxy23));
        i += 4;
    }
    while i < n {
        let base = x.add(i + 1 - p);
        let (mut sy, mut sxy) = (0.0f64, 0.0f64);
        for j in 0..p {
            let y = *base.add(j);
            sy += y;
            sxy += (j as f64) * y;
        }
        finish(i, sy, sxy);
        i += 1;
    }
}

// ---- LOD bucket aggregation --------------------------------------------------

/// Open-first / high-max / low-min / close-last per bucket of 2^k rows aligned
/// to absolute row index (row r of the input is absolute row first + r), as
/// packages/core/src/data/lod.ts `fromRows`. A row whose open is NaN is a hole
/// and is skipped; an all-hole bucket is NaN in all four outputs. Outputs are
/// f32 (round to nearest). `color_in`/`color_out` (both nullable) carry the
/// colour of the row that made the high (the first on ties; 0 for empty).
/// Bucket count = ((first + n - 1) >> k) - (first >> k) + 1.
#[no_mangle]
pub unsafe extern "C" fn k_lod_rows(
    o: *const f64,
    h: *const f64,
    l: *const f64,
    c: *const f64,
    n: usize,
    k: u32,
    first: usize,
    oo: *mut f32,
    oh: *mut f32,
    ol: *mut f32,
    oc: *mut f32,
    color_in: *const u32,
    color_out: *mut u32,
) {
    if n == 0 {
        return;
    }
    let b0 = (first as u64) >> k;
    let b1 = ((first + n - 1) as u64) >> k;
    for b in b0..=b1 {
        let abs0 = b << k;
        let r0 = if abs0 > first as u64 { (abs0 - first as u64) as usize } else { 0 };
        let abs1 = (b + 1) << k;
        let r1 = if abs1 - (first as u64) < n as u64 { (abs1 - first as u64) as usize } else { n };
        let slot = (b - b0) as usize;
        if color_in.is_null() && (r1 - r0) >= 2 && (r1 - r0) % 2 == 0 {
            if let Some((ro, rh, rl, rc)) = lod_fast(o, h, l, c, r0, r1) {
                *oo.add(slot) = ro as f32;
                *oh.add(slot) = rh as f32;
                *ol.add(slot) = rl as f32;
                *oc.add(slot) = rc as f32;
                continue;
            }
        }
        let mut ro = NAN;
        let mut rh = f64::NEG_INFINITY;
        let mut rl = f64::INFINITY;
        let mut rc = NAN;
        let mut col = 0u32;
        for r in r0..r1 {
            let vo = *o.add(r);
            if vo != vo {
                continue;
            }
            if ro != ro {
                ro = vo;
            }
            let vh = *h.add(r);
            if vh > rh {
                rh = vh;
                if !color_in.is_null() {
                    col = *color_in.add(r);
                }
            }
            let vl = *l.add(r);
            if vl < rl {
                rl = vl;
            }
            rc = *c.add(r);
        }
        let empty = ro != ro;
        *oo.add(slot) = ro as f32;
        *oh.add(slot) = if empty { NAN as f32 } else { rh as f32 };
        *ol.add(slot) = if empty { NAN as f32 } else { rl as f32 };
        *oc.add(slot) = rc as f32;
        if !color_out.is_null() {
            *color_out.add(slot) = col;
        }
    }
}

/// Bucket without holes and with an even row count: rows r0..r1 reduced two at
/// a time (lane = row parity). Returns None (caller falls back to the scalar
/// loop) when any open is NaN, or when the two lanes tie on a value of
/// different sign of zero, where "first row wins" cannot be told from lanes.
#[inline(always)]
unsafe fn lod_fast(
    o: *const f64,
    h: *const f64,
    l: *const f64,
    c: *const f64,
    r0: usize,
    r1: usize,
) -> Option<(f64, f64, f64, f64)> {
    let mut hv = f64x2_splat(f64::NEG_INFINITY);
    let mut lv = f64x2_splat(f64::INFINITY);
    let mut hole = f64x2_splat(0.0);
    let mut r = r0;
    while r < r1 {
        let ov = v128_load(o.add(r) as *const v128);
        hole = v128_or(hole, f64x2_ne(ov, ov));
        let vh = v128_load(h.add(r) as *const v128);
        hv = v128_bitselect(vh, hv, f64x2_gt(vh, hv));
        let vl = v128_load(l.add(r) as *const v128);
        lv = v128_bitselect(vl, lv, f64x2_lt(vl, lv));
        r += 2;
    }
    if v128_any_true(hole) {
        return None;
    }
    let (h0, h1) = (f64x2_extract_lane::<0>(hv), f64x2_extract_lane::<1>(hv));
    let (l0, l1) = (f64x2_extract_lane::<0>(lv), f64x2_extract_lane::<1>(lv));
    if (h0 == h1 && h0.to_bits() != h1.to_bits()) || (l0 == l1 && l0.to_bits() != l1.to_bits()) {
        return None;
    }
    let rh = if h1 > h0 { h1 } else { h0 };
    let rl = if l1 < l0 { l1 } else { l0 };
    Some((*o.add(r0), rh, rl, *c.add(r1 - 1)))
}

// ---- volume profile ----------------------------------------------------------

/// Add each volume into one of `bins` equal price bins over [lo, hi]
/// (`scale` = bins / (hi - lo), computed once by the caller). Prices outside
/// [lo, hi] and NaN prices are skipped; price == hi falls in the last bin.
/// `up`/`down` are accumulated by `side` (non-zero = up); with `side` null all
/// volume goes to `up`. Bins are accumulated in row order.
#[no_mangle]
pub unsafe extern "C" fn k_volume_profile(
    price: *const f64,
    volume: *const f64,
    side: *const u8,
    n: usize,
    lo: f64,
    hi: f64,
    scale: f64,
    bins: usize,
    up: *mut f64,
    down: *mut f64,
) {
    for i in 0..n {
        let p = *price.add(i);
        if p >= lo && p <= hi {
            let mut b = ((p - lo) * scale) as i32 as usize;
            if b >= bins {
                b = bins - 1;
            }
            if side.is_null() || *side.add(i) != 0 {
                *up.add(b) += *volume.add(i);
            } else {
                *down.add(b) += *volume.add(i);
            }
        }
    }
}
