// Tests run against the owner-only file store unless a test opts into the native store: a developer's
// real Keychain / Secret Service / Credential Manager must never collect entries from temp data homes.
process.env.COGNATE_SECRET_STORE ??= "file";
