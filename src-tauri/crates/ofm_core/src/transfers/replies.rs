//! Offers the manager sends are answered days later, by mail.
//!
//! A bid, a loan offer, a counter to a club bidding for one of his players and a
//! contract for a free agent used to be decided the moment they were sent. Real
//! clubs and players take a few days. Now a proposal is checked when it is sent
//! — anything the other side could not even consider (no money, no window, no
//! such player) is still refused on the spot — and then waits, as an
//! `AwaitedReply`, until its reply day. On that day the same rules that used to
//! answer at once answer it against the world as it is then, and the answer is
//! mailed. In the last two days of an open window clubs answer the same day,
//! as on deadline day, and the caller settles the proposal at once.

use super::*;
use crate::contracts::{RenewalOffer, RenewalOutcome, offer_free_agent_contract};
use crate::stable_hash::stable_hash;

/// A second offer for a player whose first is still waiting for its answer.
pub const ERR_AWAITING_REPLY: &str = "be.error.transfers.awaitingReply";

/// From this market value up a deal is weighed for an extra day.
const WEIGHTY_DEAL_VALUE: u64 = 20_000_000;
/// How many days before the window shuts clubs answer the same day.
const DEADLINE_DAYS: i64 = 1;

/// What the manager proposed, kept as sent until the answer is due.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum UserProposal {
    /// A bid for another club's player.
    TransferBid { player_id: String, fee: u64 },
    /// An offer to borrow another club's player.
    LoanBid {
        player_id: String,
        end_date: String,
        wage_contribution_pct: u8,
        buy_option_fee: Option<u64>,
    },
    /// The fee the manager asks of a club bidding for one of his players.
    SaleCounter {
        player_id: String,
        offer_id: String,
        requested_fee: u64,
    },
    /// The terms the manager asks of a club wanting to borrow one of his players.
    LoanCounter {
        player_id: String,
        offer_id: String,
        end_date: String,
        wage_contribution_pct: u8,
        buy_option_fee: Option<u64>,
    },
    /// A contract for a free agent.
    FreeAgentContract {
        player_id: String,
        weekly_wage: u32,
        contract_years: u32,
    },
}

impl UserProposal {
    pub fn player_id(&self) -> &str {
        match self {
            Self::TransferBid { player_id, .. }
            | Self::LoanBid { player_id, .. }
            | Self::SaleCounter { player_id, .. }
            | Self::LoanCounter { player_id, .. }
            | Self::FreeAgentContract { player_id, .. } => player_id,
        }
    }

    fn kind(&self) -> &'static str {
        match self {
            Self::TransferBid { .. } => "transfer",
            Self::LoanBid { .. } => "loan",
            Self::SaleCounter { .. } => "sale",
            Self::LoanCounter { .. } => "loan_out",
            Self::FreeAgentContract { .. } => "free_agent",
        }
    }
}

/// A proposal waiting for its answer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AwaitedReply {
    pub id: String,
    pub proposal: UserProposal,
    /// `YYYY-MM-DD`.
    pub sent_on: String,
    /// The day the answer comes, `YYYY-MM-DD`.
    pub reply_on: String,
}

/// What became of a proposal when it was sent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Submission {
    /// The other side answers today: the caller settles the proposal now.
    Now,
    /// The answer comes by mail on `reply_on`.
    Awaiting { reply_on: String },
}

/// The answer to a proposal, from the rules that decide it.
#[derive(Debug, Clone)]
pub enum ProposalOutcome {
    Transfer(TransferNegotiationOutcome),
    Loan(LoanOfferOutcome),
    FreeAgent(RenewalOutcome),
}

/// The proposal the manager is waiting on for `player_id`, if any.
pub fn awaited_reply_for<'a>(game: &'a Game, player_id: &str) -> Option<&'a AwaitedReply> {
    game.awaited_replies
        .iter()
        .find(|reply| reply.proposal.player_id() == player_id)
}

/// Send `proposal`: refused now if it could not stand, otherwise either for the
/// caller to settle today or queued for its reply day.
pub fn submit_proposal(game: &mut Game, proposal: UserProposal) -> Result<Submission, String> {
    if awaited_reply_for(game, proposal.player_id()).is_some() {
        return Err(ERR_AWAITING_REPLY.to_string());
    }
    let days = reply_delay_days(game, &proposal);
    if days == 0 {
        return Ok(Submission::Now);
    }
    // Decided on a copy, so what the other side would refuse outright is
    // refused while the manager is still looking at the offer, and nothing of
    // the decision leaks before its day.
    run_proposal(&mut game.clone(), &proposal)?;

    let today = game.clock.current_date.date_naive();
    let reply_on = (today + Duration::days(days))
        .format("%Y-%m-%d")
        .to_string();
    game.awaited_replies.push(AwaitedReply {
        id: format!("reply_{}", Uuid::new_v4()),
        proposal,
        sent_on: today.format("%Y-%m-%d").to_string(),
        reply_on: reply_on.clone(),
    });
    Ok(Submission::Awaiting { reply_on })
}

/// Decide `proposal` with the rules that answer it.
pub fn run_proposal(game: &mut Game, proposal: &UserProposal) -> Result<ProposalOutcome, String> {
    match proposal {
        UserProposal::TransferBid { player_id, fee } => {
            make_transfer_bid(game, player_id, *fee).map(ProposalOutcome::Transfer)
        }
        UserProposal::LoanBid {
            player_id,
            end_date,
            wage_contribution_pct,
            buy_option_fee,
        } => make_loan_offer(
            game,
            player_id,
            end_date,
            *wage_contribution_pct,
            *buy_option_fee,
        )
        .map(ProposalOutcome::Loan),
        UserProposal::SaleCounter {
            player_id,
            offer_id,
            requested_fee,
        } => {
            counter_offer(game, player_id, offer_id, *requested_fee).map(ProposalOutcome::Transfer)
        }
        UserProposal::LoanCounter {
            player_id,
            offer_id,
            end_date,
            wage_contribution_pct,
            buy_option_fee,
        } => counter_loan_offer(
            game,
            player_id,
            offer_id,
            end_date,
            *wage_contribution_pct,
            *buy_option_fee,
        )
        .map(ProposalOutcome::Loan),
        UserProposal::FreeAgentContract {
            player_id,
            weekly_wage,
            contract_years,
        } => offer_free_agent_contract(
            game,
            player_id,
            RenewalOffer {
                weekly_wage: *weekly_wage,
                contract_years: *contract_years,
            },
        )
        .map(ProposalOutcome::FreeAgent),
    }
}

/// Answer every proposal whose reply day has come, by mail. Run once a day.
pub fn deliver_due_replies(game: &mut Game) {
    let today = game.clock.current_date.format("%Y-%m-%d").to_string();
    let (due, waiting): (Vec<AwaitedReply>, Vec<AwaitedReply>) =
        std::mem::take(&mut game.awaited_replies)
            .into_iter()
            .partition(|reply| reply.reply_on <= today);
    game.awaited_replies = waiting;
    for reply in due {
        // Named before the rules run: an accepted deal moves the player.
        let names = ReplyNames::of(game, &reply.proposal);
        let outcome = run_proposal(game, &reply.proposal);
        let message = super::reply_messages::reply_message(&reply, &names, outcome.ok(), &today);
        game.messages.push(message);
    }
}

/// The names a reply speaks of, as they were before it was decided.
pub(super) struct ReplyNames {
    pub player: String,
    /// The club that answers; for a free agent, nobody but the player.
    pub club: String,
}

impl ReplyNames {
    fn of(game: &Game, proposal: &UserProposal) -> Self {
        let player = game
            .players
            .iter()
            .find(|player| player.id == proposal.player_id());
        let club_id = player.and_then(|player| match proposal {
            UserProposal::TransferBid { .. } | UserProposal::LoanBid { .. } => {
                player.team_id.clone()
            }
            UserProposal::SaleCounter { offer_id, .. } => player
                .transfer_offers
                .iter()
                .find(|offer| &offer.id == offer_id)
                .map(|offer| offer.from_team_id.clone()),
            UserProposal::LoanCounter { offer_id, .. } => player
                .loan_offers
                .iter()
                .find(|offer| &offer.id == offer_id)
                .map(|offer| offer.from_team_id.clone()),
            UserProposal::FreeAgentContract { .. } => None,
        });
        let club = club_id
            .and_then(|id| game.teams.iter().find(|team| team.id == id))
            .map(|team| team.name.clone())
            .unwrap_or_default();
        Self {
            player: player
                .map(|player| player.full_name.clone())
                .unwrap_or_default(),
            club,
        }
    }
}

/// How long the other side takes over `proposal`: one or two days, a day more
/// for a weighty deal; nothing in the last days of an open window.
fn reply_delay_days(game: &Game, proposal: &UserProposal) -> i64 {
    let today = game.clock.current_date.date_naive();
    if deadline_is_near(game, today) {
        return 0;
    }
    let seed = format!("{}{}{}", proposal.kind(), proposal.player_id(), today);
    let base = 1 + (stable_hash(seed.as_bytes(), 0) % 2) as i64;
    let weighty = game
        .players
        .iter()
        .find(|player| player.id == proposal.player_id())
        .is_some_and(|player| player.market_value >= WEIGHTY_DEAL_VALUE);
    base + i64::from(weighty)
}

fn deadline_is_near(game: &Game, today: NaiveDate) -> bool {
    let window = &game.season_context.transfer_window;
    match window.status {
        TransferWindowStatus::DeadlineDay => true,
        TransferWindowStatus::Open => window
            .closes_on
            .as_deref()
            .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
            .is_some_and(|closes| (closes - today).num_days() <= DEADLINE_DAYS),
        _ => false,
    }
}
