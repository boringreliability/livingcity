//! User interventions as tick-keyed commands (the replay log).

use crate::network::LinkId;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommandKind {
    CloseLink(LinkId),
    OpenLink(LinkId),
}

/// Applied in tick step 1 of `tick`, in acceptance order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Command {
    pub tick: u64,
    pub kind: CommandKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommandError {
    /// `tick` is before the world's current tick.
    InPast,
    UnknownLink(LinkId),
}
