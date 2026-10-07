//! A generated player's height and weight, and the attributes a body shapes.
//!
//! Height is drawn from the player's position, weight from his height through a
//! body-mass index, both from real players (EA Sports FC 24, 18,350 men across
//! every league; cross-checked against CIES and Bloomfield et al. 2005). The
//! attributes a body shapes — `aerial`, `strength`, `agility`, `pace` — are then
//! drawn *correlated* with that body through a Gaussian copula: each keeps the
//! exact range and spread it always had, so average attributes, ratings, values
//! and wages do not move; only which players get the high numbers does.
//!
//! The figures and the reasoning live in
//! `fm-document/game-engine/player-physique-duel-formulas.md` (§3–4).

use domain::player::Position;
use rand::{Rng, RngExt};

/// Real players span 156–206 cm; the generator keeps to 160–205.
const HEIGHT_MIN_CM: f64 = 160.0;
const HEIGHT_MAX_CM: f64 = 205.0;
/// Real players span 49–105 kg.
const WEIGHT_MIN_KG: f64 = 50.0;
const WEIGHT_MAX_KG: f64 = 105.0;
/// Body-mass index barely moves between positions (22.4–23.0), so one
/// distribution serves all of them, held to its real 1st–99th percentiles.
const BMI_MEAN: f64 = 22.8;
const BMI_SD: f64 = 1.35;
const BMI_MIN: f64 = 19.5;
const BMI_MAX: f64 = 26.2;

/// A player's body as generated, with how far it sits from his position's
/// average in standard deviations — the input the correlated draws read.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Physique {
    pub height_cm: u16,
    pub weight_kg: u8,
    pub z_height: f64,
    pub z_weight: f64,
}

/// How strongly each body-shaped attribute follows the body, as a correlation
/// of normal scores within a position. Measured on real players of the same
/// position; zero means "independent of the body".
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct BodyLinks {
    /// Follows height.
    pub aerial: f64,
    /// Follows weight.
    pub strength: f64,
    /// Follows height (negatively: tall players turn slower).
    pub agility: f64,
    /// Follows height (weakly negative).
    pub pace: f64,
}

impl BodyLinks {
    pub(crate) fn for_position(position: &Position) -> Self {
        if matches!(position.to_group_position(), Position::Goalkeeper) {
            // A keeper's height barely predicts his handling or reflexes
            // (r ≈ 0.11–0.13), so only the air and the strength follow it.
            Self {
                aerial: 0.25,
                strength: 0.40,
                agility: 0.0,
                pace: 0.0,
            }
        } else {
            Self {
                aerial: 0.30,
                strength: 0.60,
                agility: -0.40,
                pace: -0.15,
            }
        }
    }
}

/// Mean and spread of height for a position, in cm.
///
/// Generated players only know their group when they are drawn (the detailed
/// position is inferred later, from attributes), so the four groups pool the
/// detailed positions they contain. Authored players can carry a detailed one.
fn height_params(position: &Position) -> (f64, f64) {
    match position {
        Position::Goalkeeper => (188.9, 4.7),
        Position::Defender => (183.0, 6.3),
        Position::Midfielder => (178.4, 5.9),
        Position::Forward => (181.6, 7.0),
        Position::CenterBack => (186.9, 4.6),
        Position::Striker => (183.4, 6.1),
        Position::DefensiveMidfielder => (180.8, 5.9),
        Position::RightWingBack | Position::LeftWingBack => (179.3, 5.3),
        Position::CentralMidfielder => (178.8, 5.6),
        Position::RightBack | Position::LeftBack => (178.5, 5.0),
        Position::AttackingMidfielder => (177.1, 5.7),
        Position::RightWinger | Position::LeftWinger => (177.0, 5.6),
        Position::RightMidfielder | Position::LeftMidfielder => (176.7, 5.5),
    }
}

/// Draw a body for `position`, keeping any measurement the author fixed.
///
/// Both normals are drawn whether or not they are used, so an authored height
/// does not shift the random numbers every later draw sees.
pub(crate) fn sample_physique(
    position: &Position,
    authored_height_cm: Option<u16>,
    authored_weight_kg: Option<u8>,
    rng: &mut impl Rng,
) -> Physique {
    let (mean, sd) = height_params(position);
    let height_draw = standard_normal(rng);
    let bmi_draw = standard_normal(rng);

    let height_cm = authored_height_cm.unwrap_or_else(|| {
        (mean + sd * height_draw)
            .clamp(HEIGHT_MIN_CM, HEIGHT_MAX_CM)
            .round() as u16
    });
    let metres = f64::from(height_cm) / 100.0;
    let weight_kg = authored_weight_kg.unwrap_or_else(|| {
        let bmi = (BMI_MEAN + BMI_SD * bmi_draw).clamp(BMI_MIN, BMI_MAX);
        (bmi * metres * metres)
            .clamp(WEIGHT_MIN_KG, WEIGHT_MAX_KG)
            .round() as u8
    });

    // Weight = BMI × height², so its spread combines both: relative variances add.
    let typical_weight = BMI_MEAN * (mean / 100.0) * (mean / 100.0);
    let weight_sd =
        typical_weight * ((BMI_SD / BMI_MEAN).powi(2) + (2.0 * sd / mean).powi(2)).sqrt();
    Physique {
        height_cm,
        weight_kg,
        z_height: (f64::from(height_cm) - mean) / sd,
        z_weight: (f64::from(weight_kg) - typical_weight) / weight_sd,
    }
}

/// A uniform number in (0, 1) that follows `z` with normal-score correlation
/// `r`: `Φ(r·z + √(1−r²)·Φ⁻¹(u))`. With `r = 0` it is the plain uniform draw.
pub(crate) fn correlated_unit(z: f64, r: f64, rng: &mut impl Rng) -> f64 {
    let u = open_unit(rng);
    if r == 0.0 {
        return u;
    }
    let mixed = r * z + (1.0 - r * r).sqrt() * norm_inv(u);
    norm_cdf(mixed).clamp(f64::EPSILON, 1.0 - f64::EPSILON)
}

/// `rng.random_range(lo..hi)` with the draw tied to the body: every value in
/// `lo..hi` stays equally likely, but which player lands where follows `z`.
pub(crate) fn correlated_range(lo: u8, hi: u8, z: f64, r: f64, rng: &mut impl Rng) -> u8 {
    let span = f64::from(hi.saturating_sub(lo));
    let step = (correlated_unit(z, r, rng) * span).floor();
    lo.saturating_add(step.min(span - 1.0).max(0.0) as u8)
}

/// The generator's `jitter` (`base ± spread`, clamped to `lo..=hi`) with the
/// offset tied to the body the same way.
pub(crate) fn correlated_jitter(
    base: i32,
    spread: i32,
    bounds: (u8, u8),
    z: f64,
    r: f64,
    rng: &mut impl Rng,
) -> u8 {
    let width = f64::from(2 * spread + 1);
    let step = (correlated_unit(z, r, rng) * width)
        .floor()
        .min(width - 1.0) as i32;
    (base - spread + step).clamp(i32::from(bounds.0), i32::from(bounds.1)) as u8
}

/// A uniform draw in the open interval (0, 1), safe for `ln` and `Φ⁻¹`.
fn open_unit(rng: &mut impl Rng) -> f64 {
    let u: f64 = rng.random();
    u.clamp(f64::EPSILON, 1.0 - f64::EPSILON)
}

/// A standard normal draw (Box–Muller). The project carries no distribution
/// crate, and two uniforms per draw is cheap next to everything else a player costs.
pub(crate) fn standard_normal(rng: &mut impl Rng) -> f64 {
    let u1 = open_unit(rng);
    let u2 = open_unit(rng);
    (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
}

/// Standard normal CDF Φ, from the Abramowitz–Stegun 7.1.26 error function
/// (absolute error below 1.5e-7, far finer than an integer attribute).
pub(crate) fn norm_cdf(x: f64) -> f64 {
    0.5 * (1.0 + erf(x / std::f64::consts::SQRT_2))
}

fn erf(x: f64) -> f64 {
    const A1: f64 = 0.254_829_592;
    const A2: f64 = -0.284_496_736;
    const A3: f64 = 1.421_413_741;
    const A4: f64 = -1.453_152_027;
    const A5: f64 = 1.061_405_429;
    const P: f64 = 0.327_591_1;
    let sign = if x < 0.0 { -1.0 } else { 1.0 };
    let x = x.abs();
    let t = 1.0 / (1.0 + P * x);
    let poly = ((((A5 * t + A4) * t + A3) * t + A2) * t + A1) * t;
    sign * (1.0 - poly * (-x * x).exp())
}

/// Inverse standard normal CDF Φ⁻¹ (Acklam's rational approximation, relative
/// error below 1.2e-9). `p` must lie in (0, 1).
pub(crate) fn norm_inv(p: f64) -> f64 {
    const A: [f64; 6] = [
        -3.969_683_028_665_376e1,
        2.209_460_984_245_205e2,
        -2.759_285_104_469_687e2,
        1.383_577_518_672_69e2,
        -3.066_479_806_614_716e1,
        2.506_628_277_459_239,
    ];
    const B: [f64; 5] = [
        -5.447_609_879_822_406e1,
        1.615_858_368_580_409e2,
        -1.556_989_798_598_866e2,
        6.680_131_188_771_972e1,
        -1.328_068_155_288_572e1,
    ];
    const C: [f64; 6] = [
        -7.784_894_002_430_293e-3,
        -3.223_964_580_411_365e-1,
        -2.400_758_277_161_838,
        -2.549_732_539_343_734,
        4.374_664_141_464_968,
        2.938_163_982_698_783,
    ];
    const D: [f64; 4] = [
        7.784_695_709_041_462e-3,
        3.224_671_290_700_398e-1,
        2.445_134_137_142_996,
        3.754_408_661_907_416,
    ];
    const P_LOW: f64 = 0.024_25;
    let p = p.clamp(f64::EPSILON, 1.0 - f64::EPSILON);
    let tail = |q: f64| {
        (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
            / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    };
    if p < P_LOW {
        tail((-2.0 * p.ln()).sqrt())
    } else if p > 1.0 - P_LOW {
        -tail((-2.0 * (1.0 - p).ln()).sqrt())
    } else {
        let q = p - 0.5;
        let r = q * q;
        (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q
            / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    fn pearson(xs: &[f64], ys: &[f64]) -> f64 {
        let n = xs.len() as f64;
        let mx = xs.iter().sum::<f64>() / n;
        let my = ys.iter().sum::<f64>() / n;
        let cov: f64 = xs.iter().zip(ys).map(|(x, y)| (x - mx) * (y - my)).sum();
        let vx: f64 = xs.iter().map(|x| (x - mx).powi(2)).sum();
        let vy: f64 = ys.iter().map(|y| (y - my).powi(2)).sum();
        cov / (vx * vy).sqrt()
    }

    /// Given probabilities across the range, when inverted and mapped back,
    /// then Φ(Φ⁻¹(p)) returns p.
    #[test]
    fn the_normal_cdf_and_its_inverse_round_trip() {
        for p in [0.001, 0.02, 0.1, 0.25, 0.5, 0.75, 0.9, 0.98, 0.999] {
            assert!((norm_cdf(norm_inv(p)) - p).abs() < 1e-6, "p = {p}");
        }
        assert!(norm_inv(0.5).abs() < 1e-9);
        assert!((norm_inv(0.975) - 1.959_964).abs() < 1e-5);
    }

    /// Given many draws, when a body attribute is drawn correlated with a body,
    /// then every value in its range stays as likely as before.
    #[test]
    fn a_correlated_range_keeps_every_value_equally_likely() {
        let mut rng = StdRng::seed_from_u64(7);
        let mut counts = [0u32; 5];
        let draws = 50_000;
        for _ in 0..draws {
            let z = standard_normal(&mut rng);
            let value = correlated_range(10, 15, z, 0.6, &mut rng);
            counts[usize::from(value - 10)] += 1;
        }
        for count in counts {
            let share = f64::from(count) / f64::from(draws);
            assert!((share - 0.2).abs() < 0.01, "share {share}");
        }
    }

    /// Given generated defenders, when their aerial ability and strength are
    /// drawn, then each follows height and weight about as strongly as in real
    /// football, and the body itself sits on the real averages.
    #[test]
    fn bodies_and_the_attributes_they_shape_follow_real_players() {
        let mut rng = StdRng::seed_from_u64(11);
        let links = BodyLinks::for_position(&Position::Defender);
        let (mut heights, mut weights, mut aerials, mut strengths, mut agilities) =
            (vec![], vec![], vec![], vec![], vec![]);
        for _ in 0..20_000 {
            let body = sample_physique(&Position::Defender, None, None, &mut rng);
            heights.push(f64::from(body.height_cm));
            weights.push(f64::from(body.weight_kg));
            aerials.push(f64::from(correlated_range(
                45,
                90,
                body.z_height,
                links.aerial,
                &mut rng,
            )));
            strengths.push(f64::from(correlated_range(
                40,
                95,
                body.z_weight,
                links.strength,
                &mut rng,
            )));
            agilities.push(f64::from(correlated_range(
                40,
                95,
                body.z_height,
                links.agility,
                &mut rng,
            )));
        }
        let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len() as f64;
        assert!((mean(&heights) - 183.0).abs() < 0.5);
        assert!((mean(&weights) - 76.4).abs() < 1.0);
        assert!((pearson(&heights, &aerials) - 0.30).abs() < 0.05);
        assert!((pearson(&weights, &strengths) - 0.60).abs() < 0.08);
        assert!((pearson(&heights, &agilities) + 0.40).abs() < 0.05);
        // Defenders pool centre-backs and full-backs, so height and weight move
        // together a little more than within one real position (0.65).
        let height_weight = pearson(&heights, &weights);
        assert!((0.6..0.8).contains(&height_weight), "r = {height_weight}");
        // The attribute's own average is untouched: uniform 45..90 averages 67.
        assert!((mean(&aerials) - 67.0).abs() < 0.5);
    }

    /// Given an author who fixed a height, when a body is drawn, then that
    /// height stands and the weight is drawn around it.
    #[test]
    fn an_authored_height_and_weight_are_kept() {
        let mut rng = StdRng::seed_from_u64(3);
        let body = sample_physique(&Position::Striker, Some(170), Some(64), &mut rng);
        assert_eq!((body.height_cm, body.weight_kg), (170, 64));
        assert!(body.z_height < 0.0);
    }

    /// Given a jitter tied to the body, when the body is far above average,
    /// then the offset leans high but stays within `base ± spread`.
    #[test]
    fn a_correlated_jitter_stays_within_its_spread() {
        let mut rng = StdRng::seed_from_u64(5);
        let mut total = 0i64;
        for _ in 0..5_000 {
            let value = correlated_jitter(60, 8, (30, 97), 2.0, 0.6, &mut rng);
            assert!((52..=68).contains(&value));
            total += i64::from(value);
        }
        assert!(total as f64 / 5_000.0 > 63.0);
    }
}
