# claude-office

**English** · [한국어](README.ko.md)

A tray-resident app that shows your local Claude Code sessions as a pixel office.
One working directory = one room, one session = one Clawd working in it.

![The office — each room a different type, some Clawds working, some wandering](docs/images/en/office.png)

You leave a session running, go do something else, and come back to find it has been sitting
there for twenty minutes waiting for you to answer a permission prompt. This app is the office
you can glance at instead — and the nudge that arrives when someone is waiting.

## What you are looking at

While a session works, its Clawd sits and types. With nothing to do it gets up, wanders the
room, mutters to itself and occasionally chats with a neighbour. It stops by the vending machine
or the water cooler and comes away holding a cup; the printer spits out a sheet and the arcade
cabinet blinks to itself.

| Session state | In the office |
|---|---|
| working | Sits and hammers the keyboard, code scrolling on the monitor |
| going in circles | Still at the desk but the claws stop — a slow scratch of the head, and a ❓ |
| **waiting on you** | Gets up, raises both claws and holds a ❗ — see below |
| done | Walks out to the floor holding a ✓ and goes for a stroll |
| failed · stopped | Slumped in the chair (✗ / zZ) |
| idle | Mills about the room; now and then everyone gathers on the rug (more often at lunch) |

A white speech bubble (blue stripe on the left) is text actually read from the session; a dark
one is a flavour line we wrote. If a subagent is running, an **aide** stands beside the desk with
a clipboard and reports progress. The bar under the name tag is that session's **context usage**
(60% yellow · 85% red). As the context fills, **paper piles up on the desk**, and once the desk is full it starts
**littering the floor** with sheets at every angle, crumpled paper and the odd empty can — you can spot the desk that is about to compact by glancing at the
office rather than reading the bar.

A room that just appeared gets a **stack of moving boxes** for a few seconds, and a room whose
work is all finished has **its lights turned down.**

**After 22:00 the office dims.** Room colours still tell the rooms apart, and whoever is still
around in the small hours hums to itself with a ♪.

App text and character lines come in **English and Korean** — it follows your OS language by
default, and you can switch it in the panel's **Settings** tab or under tray menu > Language.
No restart needed.

## It will not let you miss a session waiting on you

When a permission prompt, a set of choices, or a plan approval leaves a session **waiting for
your answer** —

![Waiting on you — up from the desk, holding an exclamation mark](docs/images/en/waiting.png)

- The crab steps out in front of its desk holding a ❗ and says what it is waiting for
- If a background job left a suggested reply, the panel gives you a one-click **copy** for it
  (you still paste it yourself)
- A **yellow dot** goes on the tray icon and an **OS notification** fires (Windows toast · macOS
  notification) — clicking it opens the window with that desk selected
- The top bar shows a **`2 waiting on you · longest 3m` chip** — the only filled thing on the
  screen. Click it and the one **waiting longest** opens. It also stands as the top group in the
  left-hand session list, counting up every second. Answer, and the chip and the group **vanish
  entirely**
- Leave it unanswered and it **calls again at 5 · 15 · 30 · 60 minutes**, and past 5 minutes the
  **tray icon starts blinking** — a toast slides past (you were in a meeting, or full-screen)
  but the tray stays where it is

Sessions merely resting at the prompt are told apart from this, so you do not get a notification
for every session that finishes. **If you do want a nudge when work finishes**, turn it on under
tray menu > Notifications — it only fires for jobs that took over three minutes, so short
exchanges stay quiet.

For sessions you run in a terminal, the app cannot tell **what** is being asked — nothing is
written to the session's transcript while the choices are on screen. Turn on the
[Notification hook](docs/notify-hook.md) (Korean) from the tray menu and the **actual wording**
lands in the panel and the notification.

## The right-hand panel

<img src="docs/images/en/panel.png" width="345" alt="Session panel — waiting card, context gauge, subagents, to-dos, timeline" align="right" />

The panel has three tabs — **Session · Attendance · Settings**. Clicking a desk brings you back
to Session from wherever you were.

Click a desk to see what that session is really up to. **The reading order is the urgency order.**

- If it is waiting on you, a **yellow card sits right under the name** — what it is asking, how
  long it has been, and a copy button when there is a suggested reply
- **Context gauge** — tokens · window size · model
- **Right now**
- Attached **subagents** and the instruction each was given
- One line — `Terminal · Up 47m · Updated 1m ago` — plus **Details**, which unfolds the values you
  do not read every time: model · context window · effort · Fast · PID · mode (per-session values,
  not account ones)
- **Latest instruction · first instruction · linked MRs**
- The **plan it got approved** in plan mode — its title, and a button that opens the plan file
- The session's own **to-do list** — `2/6` with a progress bar and whatever is still open. Only
  the item in progress is bright; ones waiting their turn are marked `waits on #3`. Sessions that
  never wrote a list get no block at all
- **Timeline** — instructions received (yellow) ↔ things said (blue)
- **Open in terminal, pinned to the bottom** — it never scrolls out of reach, however long the
  rest gets. Launches a terminal in that session's working directory and reattaches to it. If Windows Terminal is present it comes up as a new tab in the open
  window. The **copy button** next to it hands you just the command

With nothing selected, the default view is an **office summary** and your **account usage**
(5-hour session · 7-day week). Usage only appears once a tap is installed in your statusline — the tray menu's
**Usage feed (statusline)** sets that up for you. The **question mark** in the bottom right
explains how to read the bubbles.

<br clear="right" />

## Attendance

The panel's **Attendance** tab. The office shows you how many are waiting right now,
but **without a record there is no way to know how many minutes you left them waiting today.**

<img src="docs/images/en/attendance.png" width="330" alt="Attendance — today and the last 7 days, by room, longest waits" align="right" />

- Today · last 7 days — session count · time working · **time spent waiting on me** · peak context
- A per-room breakdown and the **longest waits** (only those over a minute)
- A **7-day trend** of that waiting time, so you can see whether it is getting better. Days the
  app was closed are left blank with a dashed baseline rather than drawn as a zero
- What gets recorded stops at state transitions and room names. Session names, paths and
  instructions are not kept, and entries are retained for 14 days. You can turn it off or clear
  it from the tray menu

<br clear="right" />

## Install

**Windows** — grab `Claude-Office-Setup-x.y.z.exe` from
[Releases](https://github.com/when630/claude-office/releases/latest) and run it. There is no code
signing, so if SmartScreen warns you: `More info > Run anyway`.

**macOS** — from the same place take `Claude-Office-x.y.z-arm64.dmg` (Apple Silicon) or
`-x64.dmg` (Intel) and drag the app into Applications. It is neither signed nor notarized, so
macOS will claim it "is damaged and can't be opened"; clear that once from a terminal:

```bash
xattr -cr "/Applications/Claude Office.app"
```

Nothing else to install. The app reads the same `~/.claude` files Claude Code already keeps, so
if Claude Code runs on this machine you are done.

**Updates.** The Windows build checks for a new release every four hours and downloads it in the
background — you get a notification when it is ready, and either apply it right away via **tray
menu > Install update and restart** or leave it and it installs quietly the next time you quit.
Automatic installation is blocked for unsigned macOS builds, so there a new version gets you
**a notification only** — clicking it opens Releases.

## Living in the tray

- Closing the window does not quit — it drops to the tray (menu bar on macOS). To really quit:
  **tray icon > Quit**
- When one repo spreads over several working directories, Settings lets you **⊞ group everything
  under a parent into one room** and give a cryptic name like `src` an **alias**. Attendance is
  not grouped — it keeps recording the working-directory name, so changing the rule never breaks
  continuity with past records
- The left-hand **session list** groups everything by state — waiting on you · going in circles ·
  failed · working · resting · clocked out. The urgent group is always on top, so twenty rooms
  need no scanning. Click a row to open that desk; click a desk in the office and the row
  highlights to match
- Once you have a lot of rooms, **filter them by name** in the box above the list. Pin the ones you
  watch with `☆` in Settings and collapse the rest — all three change the view only,
  so a collapsed room still nudges you. A `3 hidden` badge appears while anything is out of
  sight, and clicking it clears the lot
- **Either side column folds away** — the two buttons in the top bar, or `Ctrl+[` · `Ctrl+]`.
  Fold both and the window is all office. It stays folded across restarts
- **Pull the office around by hand** — `Ctrl+wheel` (or pinch on a trackpad) zooms, `Space+drag`
  (or a middle-button drag) moves it, the wheel scrolls it vertically and `Shift+wheel`
  horizontally. Whatever sat under the cursor **stays** under it, and zooming never re-wraps the
  rooms, so you don't lose the one you were watching
- **Tap Space and the office comes back to the middle** — the same reflex as the spacebar in
  StarCraft. Dragging isn't pinned to the top-left corner, so any room can be brought to the
  centre of the screen, and it stops there: the office can never be dragged off-screen.
  `Ctrl+0` restores the window-width scale and the centre in one go (`Ctrl+=` · `Ctrl+-` step the
  scale). Steps go in halves from 2× to 8× — as fine as stays crisp — and the zoom is **not** saved
- **Shrink to a corner** — the `▭` button in the top bar (or the tray menu) drops the office
  into a small frameless window that stays **always on top**. No rooms here — just the crabs,
  **gathered in one place**. The front row is whoever is waiting on you, stuck or failed, with a
  name and how long it has been like that; the back row is everyone working, unnamed. No waiting,
  no front row. Nobody wanders in this window — there is no reason to chase a moving target in a
  view you only glance at. **Hover a crab and the one-line header tells you which room it is in and
  how full its context is**; click it and the window grows back with that session selected. The
  right end of that line carries the session (5h) and weekly usage — it folds away first on a narrow
  window so the waiting count never gets clipped. Size, position and mode are remembered, so it
  comes back the way you left it
- **Waiting on you** in the tray menu lists whatever is waiting, longest first — click one and
  **its terminal opens right there.** No need to open the window and hunt for the desk
- Three **global shortcuts** (rebind them in Settings) — `Ctrl+Alt+O` shows and hides the window,
  `Ctrl+Alt+W` opens the terminal of the longest wait, `Ctrl+Alt+M` toggles the mini window
  (`⌥⌘O` · `⌥⌘W` · `⌥⌘M` on macOS). A combination another app already holds is **marked in red
  in Settings**, rather than leaving you with a shortcut that quietly does nothing
- The tray icon carries the state — Clawd normally, a yellow dot when something is waiting on
  you, a red dot when something failed. Hover for `5 in office · 3 working · 1 waiting on you
  (longest 12m)`
- **Notifications** in the tray menu turns each kind on and off — waiting on you · repeat nudges ·
  **context running out** (85 · 95%) · **account usage running out** (80 · 95%) · **work
  finished**. The context one is there to warn you before auto-compaction trims the session's
  memory; the usage one only appears when the statusline tap is in place. Work finished is off by
  default and only fires for jobs over **three minutes** — it carries how long it took and where
  the session left off
- **Play a sound too** adds an audible alert to the toast. It is off by default, and it **never
  fires on a repeat nudge** (a sound every 5 · 15 · 30 · 60 minutes is torture). Quiet hours and
  rooms you muted stay silent for free — there is no toast to make a sound for
- **Looks stuck** is off by default too. It fires when a session is busy but going nowhere — tools
  failing three times in a row, or ten minutes without a single line written to its transcript.
  Long builds are legitimately quiet, which is exactly why the threshold sits where it does
- Each room gets its own **alert level** in Settings — `No alerts` for a scratch folder you never
  want to hear from, `Keen` for one you cannot miss (repeat nudges move in to 1 · 3 · 10 · 30 min)
- Set **quiet hours** in Settings (`22:00 ~ 09:00` and other ranges crossing midnight are fine)
  and no toast comes through while they last. To go quiet for a short while right now, use tray
  menu > Notifications > **Silence from now** (30 min · 1 hour · rest of today). While quiet, the
  **tray icon and the top-bar count stay exactly as they are** — it goes silent, it does not let
  you miss anything
- **Language** (Auto · English · 한국어), **Start at login** (comes up in the tray only, no
  window), **Usage feed (statusline)**,
  **[Find out what it is waiting for](docs/notify-hook.md)** (Notification hook) and the
  **Attendance log** ([Attendance](docs/attendance.md)) are all in the tray menu too — including
  the item that clears the log you have collected
- Settings live in `%APPDATA%\claude-office\settings.json`
  (`~/Library/Application Support/claude-office/settings.json` on macOS) — the tray menu and the
  panel's **Settings** tab write the same file

## What it does not do

- **Local sessions only.** Sessions run from `claude.ai/code` (web) or the desktop app leave
  nothing in these files, so they do not show up
- **It cannot answer or stop a session for you.** That would mean writing to someone else's
  terminal stdin, so it does not — when you spot one waiting, it takes you as far as
  **Open in terminal** and no further
- **It does not send your work anywhere.** Everything on screen is read from files already on
  your machine; the only thing that leaves it is the check for a new release
- Account usage depends on the statusline tap. A Claude Code session has to paint its statusline
  once before there is a value, and anything older than 30 minutes is marked stale
- Attendance is only recorded **while the app is running.** Whatever happened between quitting
  and starting again is not there
- The app speaks **English and Korean only**, and text read from a session (titles, instructions,
  activity) is not translated — those are the session's own words. The documents under `docs/`
  are Korean only
- When the window is covered or on another virtual desktop the animation stops and picks up where
  it left off once the window is visible again — that is the browser engine saving your battery,
  not a hang
- Builds are not code signed — on Windows that means the SmartScreen warning
  (`More info > Run anyway`), and on macOS one `xattr -cr` before first launch plus manual updates
- The `~/.claude` layout is Claude Code's internal arrangement and can change between versions
  (checked against v2.1.220)
- Installing the usage tap automatically only works when your statusline is PowerShell (`.ps1`).
  For bash and friends, add the one line by hand as the tray menu's guide shows and it behaves
  identically

## Further reading

The documents under `docs/` are in Korean.

| Document | Contents |
|---|---|
| [What it is waiting for](docs/notify-hook.md) | Installing the Notification hook to capture permission and choice prompts |
| [Attendance](docs/attendance.md) | What is recorded · how time is counted · turning it off and clearing it |
| [Settings](docs/settings.md) | Language · masking names · picking room types |
| [The right-hand panel](docs/panel.md) | Panel layout · opening a terminal · how the usage tap works |
| [Room types](docs/rooms.md) | The 8 rooms and their props |
| [What the characters do](docs/characters.md) | How "waiting" is decided · bubbles · aides · the pixel rules |
| [What it reads](docs/data-sources.md) | Which `~/.claude` files and how |

---

MIT. The pixel font inside the office is the 12px Korean variant of
[Mona](https://github.com/MonadABXY/mona-font) (SIL OFL 1.1).
