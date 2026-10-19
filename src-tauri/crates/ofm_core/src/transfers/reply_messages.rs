//! The mail that answers a proposal the manager sent days earlier.
//!
//! Buying and selling share their words ("{{club}} agreed to {{fee}} for
//! {{player}}"), as do borrowing and lending, so the answers read the same
//! whichever side of the deal the manager is on.

use std::collections::HashMap;

use domain::message::{
    ActionType, InboxMessage, MessageAction, MessageCategory, MessageContext, MessagePriority,
};

use super::replies::{AwaitedReply, ProposalOutcome, ReplyNames, UserProposal};
use super::{LoanOfferDecision, TransferNegotiationDecision};
use crate::contracts::RenewalDecision;

fn money(amount: u64) -> String {
    crate::currency::format_compact_money(amount, crate::currency::DEFAULT_CURRENCY_CODE)
        .unwrap_or_else(|| format!("{}{}", crate::currency::default_currency_symbol(), amount))
}

/// What the answer says: its verdict (for the subject) and its body.
struct Answer {
    verdict: &'static str,
    body: &'static str,
    params: Vec<(&'static str, String)>,
}

impl Answer {
    fn new(verdict: &'static str, body: &'static str) -> Self {
        Self {
            verdict,
            body,
            params: Vec::new(),
        }
    }

    fn with(mut self, key: &'static str, value: String) -> Self {
        self.params.push((key, value));
        self
    }
}

/// The fee the manager put to the other side: his bid, or what he asked of a
/// club bidding for his player. An agreed deal is agreed at it.
fn proposed_fee(proposal: &UserProposal) -> Option<u64> {
    match proposal {
        UserProposal::TransferBid { fee, .. } => Some(*fee),
        UserProposal::SaleCounter { requested_fee, .. } => Some(*requested_fee),
        _ => None,
    }
}

fn answer(proposal: &UserProposal, outcome: Option<ProposalOutcome>) -> Answer {
    match outcome {
        None => Answer::new("lapsed", "lapsed"),
        Some(ProposalOutcome::Transfer(outcome)) => match outcome.decision {
            TransferNegotiationDecision::Accepted => match outcome.registration_date {
                Some(date) => Answer::new("accepted", "dealScheduled").with("date", date),
                None => Answer::new("accepted", "dealAccepted")
                    .with("fee", money(proposed_fee(proposal).unwrap_or_default())),
            },
            TransferNegotiationDecision::CounterOffer => Answer::new("counter", "dealCounter")
                .with("fee", money(outcome.suggested_fee.unwrap_or_default())),
            TransferNegotiationDecision::Rejected => Answer::new("rejected", "dealRejected"),
        },
        Some(ProposalOutcome::Loan(outcome)) => match outcome.decision {
            LoanOfferDecision::Accepted => Answer::new("accepted", "loanAccepted"),
            LoanOfferDecision::CounterOffer => Answer::new("counter", "loanCounter")
                .with(
                    "wage",
                    outcome
                        .suggested_wage_contribution_pct
                        .unwrap_or_default()
                        .to_string(),
                )
                .with("date", outcome.suggested_end_date.unwrap_or_default()),
            LoanOfferDecision::Rejected => Answer::new("rejected", "loanRejected"),
        },
        Some(ProposalOutcome::FreeAgent(outcome)) => match outcome.decision {
            RenewalDecision::Accepted => Answer::new("accepted", "freeAgentAccepted"),
            RenewalDecision::CounterOffer => Answer::new("counter", "freeAgentCounter")
                .with(
                    "wage",
                    money(u64::from(outcome.suggested_wage.unwrap_or_default())),
                )
                .with(
                    "years",
                    outcome.suggested_years.unwrap_or_default().to_string(),
                ),
            RenewalDecision::Rejected => Answer::new("rejected", "freeAgentRejected"),
        },
    }
}

/// The mail answering `reply`, decided as `outcome` (`None`: it had lapsed).
pub(super) fn reply_message(
    reply: &AwaitedReply,
    names: &ReplyNames,
    outcome: Option<ProposalOutcome>,
    date: &str,
) -> InboxMessage {
    let answer = answer(&reply.proposal, outcome);
    let mut params = HashMap::from([
        ("player".to_string(), names.player.clone()),
        ("club".to_string(), names.club.clone()),
    ]);
    params.extend(
        answer
            .params
            .into_iter()
            .map(|(key, value)| (key.to_string(), value)),
    );
    let priority = if answer.verdict == "accepted" {
        MessagePriority::High
    } else {
        MessagePriority::Normal
    };

    InboxMessage::new(
        format!("offer_reply_{}", reply.id),
        String::new(),
        String::new(),
        String::new(),
        date.to_string(),
    )
    .with_category(MessageCategory::Transfer)
    .with_priority(priority)
    .with_sender_role("")
    .with_action(MessageAction {
        id: "view_transfers".to_string(),
        label: String::new(),
        action_type: ActionType::NavigateTo {
            route: "/dashboard?tab=Transfers".to_string(),
        },
        resolved: false,
        label_key: Some("be.msg.transferOffer.actionReview".to_string()),
    })
    .with_context(MessageContext {
        player_id: Some(reply.proposal.player_id().to_string()),
        ..Default::default()
    })
    .with_i18n(
        &format!("be.msg.offerReply.{}.subject", answer.verdict),
        &format!("be.msg.offerReply.body.{}", answer.body),
        params,
    )
    .with_sender_i18n("be.sender.directorOfFootball", "be.role.directorOfFootball")
}
