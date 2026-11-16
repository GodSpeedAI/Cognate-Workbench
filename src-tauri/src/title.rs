// The window-title contract (desktop-native-completion B3). The web app owns the title
// (`src/ui/titleStatus.ts`); the shell reads it for the attention cue and notification
// triggers only — never the close guard. This parser mirrors the web grammar exactly and is
// strict: a full match parses, anything else is unknown. The grammar is a versioned,
// test-pinned contract on both sides; changing the wording is a two-sided bump.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TitleState {
    Idle,
    Running,
    Waiting,
    Reconciliation,
    Approval(u32),
}

pub const TITLE_BASE: &str = "Cognate Workbench";

/// Strict v1 parser: full match or nothing. Any other string — including an older or newer
/// format — is unknown, and the shell treats unknown as "no cue".
///
/// The B4 consumers (attention cue, notification triggers) call this; until they land the
/// parser is contract-and-test only.
#[allow(dead_code)]
pub fn parse_title(text: &str) -> Option<TitleState> {
    if text == TITLE_BASE {
        return Some(TitleState::Idle);
    }
    let suffix = text.strip_prefix(&format!("{TITLE_BASE} — "))?;
    match suffix {
        "running" => Some(TitleState::Running),
        "waiting for you" => Some(TitleState::Waiting),
        "needs reconciliation" => Some(TitleState::Reconciliation),
        "1 approval waiting" => Some(TitleState::Approval(1)),
        _ => {
            // N approvals waiting, N ≥ 2 (the singular form is exact above).
            let count = suffix.strip_suffix(" approvals waiting")?;
            let n: u32 = count.parse().ok()?;
            (n >= 2).then_some(TitleState::Approval(n))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_grammar_form() {
        assert_eq!(parse_title("Cognate Workbench"), Some(TitleState::Idle));
        assert_eq!(
            parse_title("Cognate Workbench — running"),
            Some(TitleState::Running)
        );
        assert_eq!(
            parse_title("Cognate Workbench — waiting for you"),
            Some(TitleState::Waiting)
        );
        assert_eq!(
            parse_title("Cognate Workbench — needs reconciliation"),
            Some(TitleState::Reconciliation)
        );
        assert_eq!(
            parse_title("Cognate Workbench — 1 approval waiting"),
            Some(TitleState::Approval(1))
        );
        assert_eq!(
            parse_title("Cognate Workbench — 3 approvals waiting"),
            Some(TitleState::Approval(3))
        );
    }

    #[test]
    fn refuses_everything_else() {
        assert_eq!(parse_title(""), None);
        assert_eq!(parse_title("Cognate Console"), None);
        assert_eq!(parse_title("Cognate Workbench "), None);
        assert_eq!(parse_title("Cognate Workbench —"), None);
        assert_eq!(parse_title("Cognate Workbench — 1 approvals waiting"), None);
        assert_eq!(parse_title("Cognate Workbench — 0 approvals waiting"), None);
        assert_eq!(parse_title("Cognate Workbench — approval waiting"), None);
        // A page title carrying content must never parse as a cue.
        assert_eq!(
            parse_title("Cognate Workbench — Acme repo · fix the login bug"),
            None
        );
        // The pre-page builder title is the idle form by design (the web app composes the
        // same string at mount); anything the web layer writes that is not the grammar is
        // unknown, never a state.
        assert_eq!(parse_title("https://example.com — just visited"), None);
    }
}
