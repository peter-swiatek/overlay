# ADR 0001: Release 1 architecture

Date: 2026-10-30. Status: accepted by Peter.

Full proposal: https://claude.ai/artifact/XpDkaw2RYgqeEx2cvgAMKA

## Decisions
1. Electron + TypeScript + React (Vite), pnpm monorepo, strict TypeScript.
2. One small transparent, click-through, non-activating, always-on-top window per overlay.
3. Sim access in an isolated Electron utility process producing one normalised `SimState` model. iRacing via its SDK shared memory; LMU via native `LMU_Data` shared memory plus undocumented local REST behind a feature flag.
4. Installers published to a separate public releases-only repo so electron-updater works without an embedded token; source stays private.
5. Unsigned builds for the pilot.
6. Peter approves each milestone's PRs together after the milestone build passes his checklist.
7. Peter records fixture sessions in both sims with a capture tool shipped in M0.
8. Colours: theme tokens (editable), locked meaning colours (outside the theme schema), and a few per-overlay functional colours that default to the theme accent.
