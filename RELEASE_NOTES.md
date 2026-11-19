## DSH Intel

- macOS Intel (`x86_64`) Deno Desktop shell for the official DeepSeek Harness web UI.
- SSH tunnel or HTTPS connection profiles with an always-on Linux x86_64 service.
- Our Free Model bundled as the default plugin with a SHA-512-verified npm tarball.
- Separate update and rollback paths for Our Free Model, DeepSeek Harness, and the desktop shell.
- Native macOS shortcut menu and a local custom control center.

### Installation notes

The macOS archive is ad-hoc signed and is not notarized by Apple. Verify its SHA-256 checksum and
review the source links in `THIRD_PARTY_NOTICES.md` before opening it.

The managed service targets Linux x86_64. It installs an isolated, checksum- verified Node.js
runtime and does not require a global Node.js installation.

DSH Intel is an unofficial project and is not affiliated with or endorsed by DeepSeek AI or
Ebony-Vinyl. Third-party model providers, accounts, quotas, privacy terms, and charges are governed
by their respective providers.
