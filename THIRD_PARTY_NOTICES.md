# Third-Party Notices

DSH Intel redistributes or depends on the following third-party projects. This file is a
source-level summary, not a substitute for the complete license text shipped by each project.

| Component                                          | Use in DSH Intel                                              | Upstream                                          | License                              |
| -------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------ |
| DeepSeek Harness (`@deepseek-ai/dsh`)              | Official Harness runtime, web UI, plugin manager and profiles | https://github.com/deepseek-ai/deepseek-harness   | MIT                                  |
| Our Free Model (`@ebony-vinyl/dsh-our-free-model`) | Default built-in DSH plugin and provider/channel registry     | https://github.com/Ebony-Vinyl/dsh-our-free-model | MIT                                  |
| Deno Runtime / Deno Desktop                        | JavaScript/TypeScript runtime and native desktop shell        | https://github.com/denoland/deno                  | MIT                                  |
| Laufey                                             | Native window, menu and CEF backend used by Deno Desktop      | https://github.com/littledivy/laufey              | Apache-2.0                           |
| Chromium Embedded Framework (CEF)                  | HTML/CSS renderer embedded by Laufey                          | https://github.com/chromiumembedded/cef           | BSD-style and other upstream notices |
| Node.js                                            | Runtime used only by the remote Linux service                 | https://github.com/nodejs/node                    | MIT                                  |
| pnpm                                               | Package manager used by the DSH profile/plugin layer          | https://github.com/pnpm/pnpm                      | MIT                                  |
| Montserrat                                         | Brand typeface in the local control center                    | https://fonts.google.com/specimen/Montserrat      | SIL Open Font License 1.1            |
| models.dev metadata                                | Provider/model metadata included by Our Free Model            | https://github.com/anomalyco/models.dev           | MIT                                  |
| Magpie engine                                      | Optional local routing engine included by Our Free Model      | https://github.com/yetone/magpie                  | MIT                                  |
| OFM channel pack                                   | Optional account/channel helpers included by Our Free Model   | https://github.com/Ebony-Vinyl/dsh-our-free-model | MIT                                  |

## Asset notices

- `assets/dsh-mark.svg` is derived from the DeepSeek Harness web favicon. Source:
  https://github.com/deepseek-ai/deepseek-harness/blob/main/apps/web/public/favicon.svg
- `assets/DSH-Intel-icon.svg` and `assets/DSH-Intel.icns` are derived from that mark and use a
  project-specific blue background. They are not official DeepSeek artwork and do not imply
  endorsement.
- `assets/ofm-icon.svg` comes from the Our Free Model plugin package. Source:
  https://github.com/Ebony-Vinyl/dsh-our-free-model/blob/main/icon.svg
- `docs/screenshots/ofm-plugin-update.png` comes from the upstream plugin's verification
  documentation. Source:
  https://github.com/Ebony-Vinyl/dsh-our-free-model/blob/main/docs/verification/images/desktop-update-available.png
- `docs/screenshots/control-center.png` is generated from this repository's real control-center
  interface by `deno task screenshot`.

The Montserrat font files and `Montserrat-OFL.txt` in `assets/fonts/` are redistributed under the
SIL Open Font License 1.1.

## Plugin package notices

The release workflow downloads the npm tarball recorded in `service/plugins.lock.json` and verifies
its SHA-512 integrity before adding it to the managed-service bundle. That tarball contains its own
`LICENSE`, `NOTICE.md`, channel-pack license, and Magpie license files. Those files remain
applicable when the plugin is installed or updated.

## CEF notices

A compiled Deno Desktop application contains Chromium Embedded Framework and its helper binaries.
Chromium and CEF are distributed under their respective BSD-style licenses and additional notices.
The authoritative notices are available at:

- https://chromium.googlesource.com/chromium/src/+/main/LICENSE
- https://github.com/chromiumembedded/cef/blob/master/LICENSE.txt
- https://github.com/chromiumembedded/cef/blob/master/README.md

No source-code changes are made to those components by DSH Intel.

## Source and version policy

The desktop application records source versions in `deno.json` and `service/plugins.lock.json`.
Release artifacts include SHA-256 checksum files and an update manifest. Users should compare those
checksums with the release page and review the linked upstream source before enabling unattended
updates.
