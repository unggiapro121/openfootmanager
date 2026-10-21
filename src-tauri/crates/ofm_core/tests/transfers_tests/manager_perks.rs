//! A purchase's wage carries the user's reputation (phase 2 lane M, M-5).

use super::*;

fn previewed_and_paid_at(reputation: u32) -> (i64, i64) {
    // Priced so his wage is far above the thousand a wage is rounded up to,
    // which would otherwise swallow the discount.
    let mut player = make_player("player-perk");
    player.market_value = 30_000_000;
    player.ovr = 82;
    let mut game = make_game_with_player(player, vec![], 200_000_000, 80_000_000);
    game.manager.reputation = reputation;

    let projection = ofm_core::transfers::project_transfer_bid_financial_impact(
        &game,
        "player-perk",
        60_000_000,
    )
    .expect("the preview is informational");
    make_transfer_bid(&mut game, "player-perk", 60_000_000).expect("the bid goes through");
    let paid = i64::from(
        game.players
            .iter()
            .find(|p| p.id == "player-perk")
            .unwrap()
            .wage(),
    );
    (projection.incoming_player_weekly_wage, paid)
}

/// Given the user's club buys a player,
/// When the user's reputation is 900 rather than 500,
/// Then he is paid less, and the preview showed exactly what the deal pays:
/// the preview, the board's check and the deal read one discounted wage.
#[test]
fn a_reputed_manager_buys_a_player_on_a_lower_wage_the_preview_already_showed() {
    let (previewed_at_start, paid_at_start) = previewed_and_paid_at(500);
    let (previewed_reputed, paid_reputed) = previewed_and_paid_at(900);

    assert!(
        paid_reputed < paid_at_start,
        "{paid_reputed} vs {paid_at_start}"
    );
    assert_eq!(previewed_reputed, paid_reputed);
    assert_eq!(previewed_at_start, paid_at_start);
}
