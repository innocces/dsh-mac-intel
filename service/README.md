# DSH Intel managed service

This package runs the official DeepSeek Harness web application as an always-on Linux x86_64 service
and installs Our Free Model as the default plugin.

## Requirements

- Linux `x86_64`
- `bash`, `curl`, `tar`, `systemctl --user`, and `sha256sum`
- outbound HTTPS access to `nodejs.org` and `registry.npmjs.org`
- enough disk space for isolated Node.js, pnpm, and two DSH runtime versions

## Install

```bash
tar -xzf dsh-mac-intel-service.tar.gz
cd service
./install.sh
```

The installer downloads Node.js 24.9.0, verifies its published SHA-256, and keeps it under
`~/.local/share/dsh-mac-intel/node`. pnpm 11.28.5 is installed under the same prefix. It does not
modify the user's global Node.js or npm installation.

The default Our Free Model plugin comes from the integrity-checked tarball in `plugins/`. If the
source tree is used directly without a release bundle, the installer falls back to the version
recorded in `plugins.lock.json`.

## Operations

```bash
PREFIX="$HOME/.local/share/dsh-mac-intel"

"$PREFIX/bin/dsh-mac-intel-service" status
"$PREFIX/bin/dsh-mac-intel-service" update-plugin
"$PREFIX/bin/dsh-mac-intel-service" update-harness
"$PREFIX/bin/dsh-mac-intel-service" update-all

systemctl --user status dsh-mac-intel.service
journalctl --user -u dsh-mac-intel.service -f
```

Harness updates are installed into `versions/dsh-<version>` and selected only after the web service
passes a health check. Plugin updates snapshot the web profile before changing it and restore the
snapshot if installation or the health check fails.

## Uninstall

```bash
./uninstall.sh          # keep runtime data
./uninstall.sh --purge  # remove runtime data and backups
```

If the installer could not enable lingering, run:

```bash
sudo loginctl enable-linger "$USER"
```

## Security

The service binds `127.0.0.1:3080` by default. Put authentication and TLS in front of it before
exposing it outside the host. The desktop update channel uses a fixed allow-list of service
subcommands and never accepts a remote shell command from the desktop application.

## Licenses and sources

The service installs official `@deepseek-ai/dsh` and `@ebony-vinyl/dsh-our-free-model` npm packages
under their own licenses. See the repository's `THIRD_PARTY_NOTICES.md` for complete source links
and asset notices.
