# Local Computer — Mac app

Niccolò wants a real Mac app, packaged as a DMG, that feels like Grok Bot but runs only on this computer.

## What it is
A dark sidebar of small bots. Each row is a name, one line of what it last did, and a time. Opening a bot shows only that bot's job and its answer. The first bots are the budget crew already specified in src/lib/crew/CONTRACT.md:

- Ledger reads the loaded CSV and reports only rows that are in the file.
- Clerk logs one spend against a category that already exists.
- Watcher names a line only when spent is greater than approved. That comparison is code, never the model.
- Remainder states the approved total, spent total, and remaining. Approved never changes when a spend is logged.
- Note asks local Gemma, through Ollama at 127.0.0.1:11434, to say one sentence. If the sentence names the wrong item or a number that is not in the tool result, withhold it.

Sample numbers stay labeled SAMPLE DATA. Do not invent Paola's real budget. Do not send data off this Mac. English UI. Same near-black, white type, thin rules, square controls as the current dashboard.

## Who owns what
Codex builds the app shell, the five bots, and the DMG. Claude owns src/lib/crew/ground.ts, ground.test.ts, and prompts.ts. Do not edit those three. Do not commit. Do not push. Do not revert the English redesign.

## Done when
A DMG exists at /Users/nick/Desktop/Local-Computer.dmg. Opening it shows an app the user can drag to Applications. Launching that app shows the sidebar and can run the five bots against the sample CSV on this Mac. Tests for the crew math pass.

## Reuse the Vibefy companion

A reference copy of the shipped Mac companion is at /Users/nick/friend-practice/vibefy-desktop-ref (from /Users/nick/Workspace/mascarock/vibefy on the MacBook Pro, Vibefy 1.3.8, the app that is installed as Vibefy.app). Read COMPANION_ARCHITECTURE.md, desktop/main.js, desktop/preload.js, desktop/index.html, desktop/styles.css, and scripts/build-desktop.js. Reuse that Electron shell and the `desktop:dmg` packaging. Do not copy phone pairing, SSH, or provider credentials. This app stays on one Mac: a sidebar of the five local budget bots, sample data only.

## Overnight, due 9:00 AM Malta Sunday 4 Oct 2026

Finish a real working demo. Screenshots of the sidebar and of one bot answer are required. Also render one walkthrough video to a file. Do not play that video or any audio on this Mac. Save the video under /Users/nick/friend-practice-video/ and the screenshots beside it. The DMG stays at /Users/nick/Desktop/Local-Computer.dmg. Claude and Codex stay in this checkout and use each other's files.

## Design pass from Niccolò, 1:15 AM
Rounded corners, liquid glass (frosted panels, soft blur, thin light edge), mostly near-black, one quiet accent only. Rebuild the DMG and refresh screenshots. Do not play audio.

## Conversational chat, Sunday 4 Oct 2026, 10:23 AM

Niccolò wants this to feel like typing to one of the five local offline assistants, not a Run Ledger button panel. Select a bot in the sidebar, then a chat thread: she types a message and that assistant replies in the thread. Examples: Ledger "what's approved for Meta Ads?"; Clerk "log 200 on Meta Ads for the sample stand"; Watcher "anything over?"; Remainder "how much is left?"; Note "one sentence for Paola". Replies stay grounded in the existing tools. Liquid glass stays. Claude still owns ground.ts, ground.test.ts, and prompts.ts. No commit.

## Colour and joy, Sunday 4 Oct 2026, about 11:10 AM Malta

Niccolò asked for a bit more colour and joy, like animated Grok bots. Each of the five assistants now has its own saturated accent and a small original idle shape, with animation disabled for reduced motion. No Grok logo.
