# claude-office

**English** · [한국어](README.ko.md)

A tray-resident app that shows your local Claude Code sessions as a pixel office.
One working directory = one room, one session = one Clawd working in it.

![The office — each room a different type, some Clawds working, some wandering](docs/images/office.png)

While a session works, its Clawd sits and types. With nothing to do it gets up, wanders the
room, mutters to itself and occasionally chats with a neighbour. A white bubble (blue stripe on
the left) is text actually read from the session; a dark one is flavour.

*(The screenshots on this page are of the Korean UI.)*

| Session state | In the office |
|---|---|
| working | Sits and hammers the keyboard, code scrolling on the monitor |
| **waiting on you** | Gets up, raises both claws and holds a ❗ — see below |
| done | Walks out to the floor holding a ✓ and goes for a stroll |
| failed · stopped | Slumped in the chair (✗ / zZ) |
| idle | Mills about the room; now and then everyone gathers on the rug |

If a subagent is running, an **aide** stands beside the desk with a clipboard and reports
progress. The bar under the name tag is that session's **context usage** (60% yellow · 85% red).

App text and character lines come in **English and Korean** — it follows your OS language by
default, and you can switch it in [Settings](docs/settings.md) in the top bar or under
tray menu > Language. No restart needed.

## It will not let you miss a session waiting on you

The reason this app exists. When a permission prompt, a set of choices, or a plan approval
leaves a session **waiting for your answer** —

![Waiting on you — up from the desk, holding an exclamation mark](docs/images/waiting.png)

- The crab steps out in front of its desk holding a ❗ and says what it is waiting for
- A **yellow dot** goes on the tray icon and an **OS notification** fires (Windows toast · macOS
  notification) — clicking it opens the window with that desk selected
- The top bar keeps a running count like `1 waiting on you · longest 3m`
- Leave it unanswered and it **calls again at 5 · 15 · 30 · 60 minutes**, and past 5 minutes the
  **tray icon starts blinking** — a toast slides past (you were in a meeting, or full-screen)
  but the tray stays where it is

Sessions merely resting at the prompt (`idle`) are told apart from this, so you do not get a
notification for every session that finishes. How the call is made:
[What the characters do](docs/characters.md#선택지가-뜨면-산책하지-않는다) (Korean).

For terminal sessions it cannot tell **what** is being asked — nothing is written to the
transcript while the choices are on screen. Turn on the
[Notification hook](docs/notify-hook.md) (Korean) from the tray menu and the **actual wording**
lands in the panel and the notification.

## The right-hand panel

<img src="docs/images/panel.png" width="345" alt="Session panel — context gauge, subagents, timeline, reattach command" align="right" />

Click a desk to see what that session is really up to.

- **Context gauge** — tokens · window size · model
- That session's **model · context window · effort · Fast** (per-session values, not account ones)
- Attached **subagents** and the instruction each was given
- **Right now · latest instruction · linked MRs**
- **Timeline** — instructions received (yellow) ↔ things said (blue)
- **Open in terminal** at the bottom — launches a terminal in that session's working directory
  running `claude attach <id>` (or `claude --resume <sessionId>` for terminal sessions).
  If Windows Terminal is present it attaches as a new tab in the open window. The **copy button**
  next to it hands you just the command

With nothing selected, the default view is a clock and your **account usage** (5-hour session ·
7-day week). Usage only appears once a tap is installed in your statusline — see
[the panel](docs/panel.md#사용량은-왜-tap이-필요한가) (Korean). The **question mark** in the bottom
right explains how to read the bubbles.

<br clear="right" />

## Attendance

The **Attendance** button in the top bar. The office shows you how many are waiting right now,
but **without a record there is no way to know how many minutes you left them waiting today.**

- Today · last 7 days — session count · time working · **time spent waiting on me** · peak context
- A per-room breakdown and the **longest waits** (only those over a minute)
- What gets recorded stops at state transitions and room names. Session names, paths and
  instructions are not kept, and entries are retained for 14 days. You can turn it off or clear
  it from the tray menu

Full rules: [Attendance](docs/attendance.md) (Korean).

## Install and update

**Windows** — grab `Claude-Office-Setup-x.y.z.exe` from
[Releases](https://github.com/when630/claude-office/releases/latest) and run it. There is no code
signing, so if SmartScreen warns you: `More info > Run anyway`. The installed build checks for a
new release every four hours and downloads it in the background — you get a notification when it
is ready, and either apply it right away via **tray menu > Install update and restart** or leave
it and it installs quietly the next time you quit.

**macOS** — from the same place take `Claude-Office-x.y.z-arm64.dmg` (Apple Silicon) or
`-x64.dmg` (Intel) and drag the app into Applications. It is neither signed nor notarized, so
macOS will claim it "is damaged and can't be opened"; clear that once from a terminal:

```bash
xattr -cr "/Applications/Claude Office.app"
```

Automatic installation is blocked for unsigned macOS builds (Squirrel.Mac verifies the
signature), so a new version gets you **a notification only** — clicking it opens Releases.

## Development

```powershell
npm install       # postinstall bakes the icons
npm start         # run from source
npm test          # notification thresholds, attach commands, language switching (node --test, no deps)
npm run usage-tap # add one line to your statusline so the app can read session/weekly usage (optional)
npm run build     # Windows installer (NSIS) into dist/
npm run build:mac # dmg + zip, on a Mac (cannot be built on Windows)
```

Releases are cut by CI when you push a tag — it builds Windows and macOS and puts them in a
**draft** release, so once [Actions](https://github.com/when630/claude-office/actions) is done you
write the release notes and hit Publish.

```powershell
git tag v0.4.0; git push origin v0.4.0
```

Electron 43, with exactly one runtime dependency (electron-updater, for auto-update).
It reads the same `~/.claude` files `claude agents` uses, so nothing beyond Claude Code is needed.

## Living in the tray

- Closing the window does not quit — it drops to the tray (menu bar on macOS). To really quit:
  **tray icon > Quit**
- The tray icon carries the state — Clawd normally, a yellow dot when something is waiting on
  you, a red dot when something failed. Hover for `5 in office · 3 working · 1 waiting on you
  (longest 12m)`
- **Notifications** in the tray menu turns each kind on and off — waiting on you · repeat nudges ·
  **context running out** (85 · 95%) · **account usage running out** (80 · 95%). The context one
  is there to warn you before auto-compaction trims the session's memory; the usage one only
  appears when the statusline tap is in place
- **Language** (Auto · English · 한국어), **Start at login** (comes up in the tray only, no
  window), **Usage feed (statusline)**,
  **[Find out what it is waiting for](docs/notify-hook.md)** (Notification hook) and the
  **Attendance log** ([Attendance](docs/attendance.md)) are all in the tray menu too — including
  the item that clears the log you have collected
- Settings live in `%APPDATA%\claude-office\settings.json`
  (`~/Library/Application Support/claude-office/settings.json` on macOS) — the tray menu and
  [Settings](docs/settings.md) in the top bar write the same file

## Further reading

The documents under `docs/` are in Korean.

| Document | Contents |
|---|---|
| [What it reads](docs/data-sources.md) | Which `~/.claude` files and how · spare slots · parsing terminal-session transcripts |
| [Room types](docs/rooms.md) | The 8 rooms and their props · why the meeting room is laid out differently |
| [What the characters do](docs/characters.md) | The 16×12 pixel rules · transition animations · how "waiting" is decided · bubbles · aides |
| [The right-hand panel](docs/panel.md) | Panel layout · the pixel font · how the usage tap works |
| [What it is waiting for](docs/notify-hook.md) | Installing the Notification hook to capture permission and choice prompts |
| [Attendance](docs/attendance.md) | What is recorded · how time is counted · turning it off and clearing it |
| [Settings](docs/settings.md) | Language · masking names · picking room types |
| [Architecture](docs/architecture.md) | File map · what is worth touching · debug entry points |

## Limits

- **Local only.** Sessions run from `claude.ai/code` (web) or the desktop app leave nothing in
  these files, so they do not show up
- **It cannot answer or stop a session for you.** That would mean writing to someone else's
  terminal stdin, so it does not — when you spot one waiting, it takes you as far as
  [Open in terminal](docs/panel.md#터미널에서-열기) and no further
- Account usage depends on the statusline tap. A Claude Code session has to paint its statusline
  once before there is a value, and anything older than 30 minutes is marked stale
- When the window is covered or on another virtual desktop, Chromium stops
  `requestAnimationFrame` — the canvas not drawing is normal, and it picks up where it left off
  once the window is visible again
- Attendance is only recorded **while the app is running.** Whatever happened between quitting
  and starting again is not there
- The app speaks **English and Korean only**, and text read from a session (titles, instructions,
  activity) is not translated — those are the session's own words. The documents under `docs/`
  are Korean only
- The `~/.claude` layout is Claude Code's internal arrangement and can change between versions
  (checked against v2.1.220)
- Builds are not code signed — on Windows that means the SmartScreen warning
  (`More info > Run anyway`), and on macOS one `xattr -cr` before first launch plus manual updates
- Installing the usage tap automatically only works when your statusline is PowerShell (`.ps1`).
  For bash and friends, add the one line by hand as the tray menu's guide shows and it behaves
  identically. On Korean Windows the stdin encoding has to be fixed too, or payloads containing
  non-ASCII text break ([why](docs/panel.md#stdin-인코딩을-왜-맞추나)) — taps installed by older
  versions get that added on startup

---

The pixel font inside the office is the 12px Korean variant of
[Mona](https://github.com/MonadABXY/mona-font) (SIL OFL 1.1).
The screenshots were baked by running the real renderer headless — see
[debug entry points](docs/architecture.md#디버그-입구).
