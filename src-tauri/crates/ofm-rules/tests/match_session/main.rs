//! The match session (phase 3, E3-3): its generators, controllers, log and minute hash, the shared
//! command check, and the golden matches played through it. One test crate, so the synthetic
//! sides in `support` are written once.

mod balance;
mod check;
mod golden;
mod replay;
mod session;
mod support;
