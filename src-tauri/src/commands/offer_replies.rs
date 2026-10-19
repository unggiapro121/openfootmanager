//! Sending an offer whose answer comes by mail (`ofm_core::transfers::replies`).
//!
//! Every command that makes an offer to another club or a free agent sends it
//! through here first. In the last days of an open window the other side
//! answers at once and the command settles the offer as it always has;
//! otherwise the offer now waits for its reply day, and the command reports
//! that instead of an answer.

use std::collections::HashMap;

use domain::negotiation::{NegotiationFeedback, NegotiationMood};
use ofm_core::contracts::RenewalDecision;
use ofm_core::game::Game;
use ofm_core::transfers::{
    submit_proposal, LoanOfferDecision, Submission, TransferNegotiationDecision, UserProposal,
};
use serde::Serialize;

/// What a negotiation command reports: the other side's answer, or that the
/// offer was sent and the answer comes by mail.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OfferDecision {
    Accepted,
    Rejected,
    CounterOffer,
    AwaitingReply,
}

impl From<TransferNegotiationDecision> for OfferDecision {
    fn from(decision: TransferNegotiationDecision) -> Self {
        match decision {
            TransferNegotiationDecision::Accepted => Self::Accepted,
            TransferNegotiationDecision::Rejected => Self::Rejected,
            TransferNegotiationDecision::CounterOffer => Self::CounterOffer,
        }
    }
}

impl From<LoanOfferDecision> for OfferDecision {
    fn from(decision: LoanOfferDecision) -> Self {
        match decision {
            LoanOfferDecision::Accepted => Self::Accepted,
            LoanOfferDecision::Rejected => Self::Rejected,
            LoanOfferDecision::CounterOffer => Self::CounterOffer,
        }
    }
}

impl From<RenewalDecision> for OfferDecision {
    fn from(decision: RenewalDecision) -> Self {
        match decision {
            RenewalDecision::Accepted => Self::Accepted,
            RenewalDecision::Rejected => Self::Rejected,
            RenewalDecision::CounterOffer => Self::CounterOffer,
        }
    }
}

/// Send `proposal`: `Some(reply_on)` when it now waits for its answer, `None`
/// when the other side answers today and the caller settles it as before.
pub(crate) fn send(game: &mut Game, proposal: UserProposal) -> Result<Option<String>, String> {
    match submit_proposal(game, proposal)? {
        Submission::Now => Ok(None),
        Submission::Awaiting { reply_on } => Ok(Some(reply_on)),
    }
}

/// The negotiation panel's note for an offer now waiting: when the answer comes.
pub(crate) fn awaiting_feedback(reply_on: &str) -> NegotiationFeedback {
    NegotiationFeedback {
        mood: NegotiationMood::Calm,
        headline_key: "transfers.awaitingReplyHeadline".to_string(),
        detail_key: Some("transfers.awaitingReplyDetail".to_string()),
        tension: 50,
        patience: 50,
        round: 1,
        params: HashMap::from([("date".to_string(), reply_on.to_string())]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Given the answers the rules give, then the command reports each by the
    /// same name the frontend already reads.
    #[test]
    fn decisions_keep_their_names_and_add_awaiting_reply() {
        let names: Vec<String> = [
            OfferDecision::from(TransferNegotiationDecision::Accepted),
            OfferDecision::from(LoanOfferDecision::CounterOffer),
            OfferDecision::from(RenewalDecision::Rejected),
            OfferDecision::AwaitingReply,
        ]
        .iter()
        .map(|decision| {
            serde_json::to_value(decision)
                .unwrap()
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect();

        assert_eq!(
            names,
            ["accepted", "counter_offer", "rejected", "awaiting_reply"]
        );
    }
}
