# Listo — product spec

**From:** the founder · **To:** the dev shop · **Status:** what I want built; open to your advice on how.

I want a real todo product called **Listo**, which people pay for. If this repository already holds a small todo app (a command line and a web page that keep todos on one device), build on it; the requirements that mention "the existing CLI" or "the current local file" are about that app. If the repository is empty, start from nothing and skip those. This document is everything I have in my head. Where I am unsure I say so; the open questions at the end are the ones I know I have not answered.

Every requirement has an id (`F-12`, `S-03`…) so we can talk about it and check it off.

## 1. Why

Todo apps are either toys (one list, no sync) or project-management tools that want you to plan sprints for your groceries. I want the middle: the thing you open twenty times a day to capture something, see what is due, and get it out of your head, on every device, shared with the two or three people you live or work with.

**One line:** *Listo: capture it in two seconds, find it when it matters, share it with the people it involves.*

**Who it is for**

| Persona | Who | What they need most |
| --- | --- | --- |
| Ana, freelancer | Designer, 31, juggles 4 clients, works from laptop and phone | Capture fast, due dates she trusts, a view of "today" across all clients |
| Luis & Carmen, household | Couple with two kids, shared groceries and chores | One shared list both can edit at the store, seeing each other's changes live |
| Diego, developer | Lives in the terminal | The CLI, synced with his phone; scripts that add todos |
| Small team lead | 3–5 people, not ready for Jira | Shared lists with assignees, nothing more |

Not for: companies wanting projects, sprints, Gantt charts, time tracking or approval workflows.

## 2. Use cases

These are the stories I would demo to an investor. If these work, the product works.

- **UC-1 Capture on the go.** Ana is walking; she opens Listo on her phone and types "send invoice to Acme friday #acme". In under two seconds it is saved with a due date on the coming Friday and the tag `acme`, even with no signal in the elevator.
- **UC-2 Morning plan.** At 8:30 Ana opens the web app on her laptop and sees *Today*: everything due today or overdue, across all her lists, the overdue ones first. The invoice she captured on her phone is there.
- **UC-3 Shopping together.** Luis is at the supermarket ticking off items on the shared "Groceries" list. Carmen, at home, adds "milk" and Luis sees it appear within a few seconds without refreshing.
- **UC-4 Offline conflict.** Luis edits "milk" to "milk ×2" with no signal; meanwhile Carmen completes "milk". When Luis is back online neither change is silently lost and he understands what happened.
- **UC-5 Recurring chores.** Carmen creates "take out the trash" every Tuesday and Friday. Completing it schedules the next one automatically.
- **UC-6 Terminal.** Diego runs `listo add "review PR #42" --due tomorrow` from his terminal; it shows up on his phone. `listo today` prints his day.
- **UC-7 Leaving.** Someone decides to stop using Listo. They export everything as a file they can open elsewhere and delete their account; their data is gone.
- **UC-8 First minute.** A stranger lands on the website from a tweet, understands what Listo is in five seconds, signs up, and has their first todo within one minute, without a tutorial.

## 3. Brand

- **B-01 Name:** Listo (Spanish for both "ready" and "clever"). The command is `listo`. Domain to be decided (see open questions).
- **B-02 Personality:** calm, quick, a bit witty; never cutesy, never productivity-guru. It never guilts you about overdue tasks.
- **B-03 Voice examples:** empty Today → *"Nothing due. Go outside."*; all done → *"Listo."*; an error → says what happened and what to do, never blames the user.
- **B-04 Logo:** a simple checkmark that also reads as the letter "L". Must work as a 16px favicon, an app icon and in one color.
- **B-05 Colors:** one warm accent (I like a terracotta or a marigold), neutral greys, and a dark mode that is designed, not inverted.
- **B-06 Languages:** English and Spanish (Mexico) from day one, in the app and on the website. The user's language is detected and can be changed.
- **B-07** A one-page brand guide the team and anyone we hire later can follow: logo, colors, type, voice, do's and don'ts.

## 4. Features

### Todos

- **F-01** Create a todo with a title (required), optional notes, due date, optional due time, tags and a list.
- **F-02** Quick add parses natural language in English and Spanish: "tomorrow", "friday", "next week", "mañana", "el viernes", "in 3 days", a time like "5pm" / "17:00", `#tag` and `@list`. What was understood is shown before saving and can be undone.
- **F-03** Complete, reopen, edit, archive and delete a todo. Deleting asks for confirmation or can be undone for a few seconds.
- **F-04** Recurring todos: daily, weekly on chosen days, monthly on a day, every N days. Completing one creates the next occurrence; skipping one is possible.
- **F-05** Subtasks: a todo can have a checklist of steps. Not nested deeper than one level.
- **F-06** Priority: none or high. Nothing more; three levels of priority is how lists become lies.
- **F-07** Reorder todos by hand inside a list.

### Lists and views

- **F-08** Lists: create, rename, color, archive, delete. Every account starts with an "Inbox".
- **F-09** *Today* view: due today plus overdue, across all lists, overdue first.
- **F-10** *Upcoming* view: the next 14 days, grouped by day.
- **F-11** Filter by tag, list, priority and status; save a filter as a smart list.
- **F-12** Search across titles, notes and tags, including completed todos, fast enough to feel instant on 10,000 todos.

### Reminders

- **F-13** A todo with a due time can remind me at that time or a chosen time before.
- **F-14** Reminders arrive as a push notification on phone and desktop browser, and by email if I turn it on.
- **F-15** A daily digest email at a time I pick, listing today's todos. Off by default.

### Sharing

- **F-16** Share a list with other people by email invitation. They need an account (free is fine).
- **F-17** Roles on a shared list: owner and editor. Only the owner can delete the list or remove people.
- **F-18** Assign a todo in a shared list to one member; *Today* can show "assigned to me" only.
- **F-19** Changes made by others on a shared list appear on my screen within a few seconds while I have it open.
- **F-20** A simple activity line on shared todos: who created, completed or changed it, and when.

### Clients

- **F-21** Web app, usable on desktop and mobile browsers, installable as an app (PWA).
- **F-22** Mobile apps for iOS and Android. A good PWA first is acceptable if you think native is not worth it yet; tell me.
- **F-23** The existing CLI becomes `listo`, signs in to the account, and syncs. It keeps working offline with the local file and syncs when it can. Every current command keeps working.
- **F-24** Keyboard shortcuts on the web app for everything frequent (new todo, complete, search, switch view).

### Import and export

- **F-25** Import from the current local file (the existing `todos.json` or SQLite) the first time someone signs in from the CLI or the web page that already has data.
- **F-26** Import from a CSV, and from Todoist and Microsoft To Do exports if that is reasonable.
- **F-27** Export everything as JSON and CSV at any time, free plan included.

## 5. Accounts and sync

- **S-01** Sign up and sign in with email and password, magic link, and Google. Apple sign-in when there is an iOS app.
- **S-02** Everything works offline on every client: create, edit, complete, reorder. Nothing I do offline is lost.
- **S-03** Changes sync automatically across all my devices when online, in the background, without a sync button.
- **S-04** Conflicts: when two devices change the same todo, different fields merge (one changed the title, the other the due date → both kept). The same field changed on both: the latest change wins, and the losing value is visible in the todo's history for a while so nothing is silently lost (UC-4).
- **S-05** A deleted todo that was edited on another device offline stays deleted, but the edit is not an error.
- **S-06** The app shows clearly when it is offline and when it has changes not yet synced.
- **S-07** Sessions: I can see my signed-in devices and sign one out.
- **S-08** Delete my account: all my data is removed within 30 days, shared lists I own are offered to another member first or deleted.
- **S-09** Ids shown to the user are stable per list; the CLI keeps short numbers like `#3` that make sense on that device.

## 6. Money

- **M-01** Two plans. **Free:** up to 5 lists, sharing with 1 other person, no reminders by email, sync on up to 2 devices. **Plus:** unlimited lists, devices and sharing, email reminders, digest, smart lists, attachments later.
- **M-02** Plus costs USD 4/month or USD 36/year; MXN prices for Mexico (around MXN 69/month). 14-day trial of Plus without a card.
- **M-03** Payments by card through a provider that handles taxes and invoices for me. In Mexico people expect to request a CFDI; tell me what that takes.
- **M-04** Downgrading never deletes data: over-limit lists become read-only until removed or Plus is back.
- **M-05** Cancel from the app in two clicks. No dark patterns.

## 7. Marketing and launch

- **K-01** A landing page at the product's domain: what Listo is in one sentence, three use cases with real screenshots, pricing, FAQ, sign-up. English and Spanish.
- **K-02** A changelog page that users can read.
- **K-03** Meta tags and a social preview image so a shared link looks good.
- **K-04** A waitlist before launch, with an email to everyone on it on launch day.
- **K-05** Launch plan: Product Hunt, a post on my blog, two communities in Mexico. You do not have to run the launch; I need the materials ready (copy, screenshots, a 30-second video if it is cheap).
- **K-06** Privacy-respecting analytics on the website only: visits, sign-ups, conversion to Plus. No third-party trackers inside the app.
- **K-07** A help page with the ten questions people will ask.

## 8. Quality, privacy and operations

- **Q-01** Fast: the web app shows my lists in under a second on a normal connection after the first load; adding a todo feels instant.
- **Q-02** Accessible: usable with keyboard only and a screen reader; contrast meets WCAG AA in both themes.
- **Q-03** Privacy: data encrypted in transit and at rest; we never sell or read user data; a plain-language privacy policy and terms of service.
- **Q-04** Backups every day, and a restore that has actually been tried once before launch.
- **Q-05** I hear about errors before users tell me: error tracking and an uptime check, with an alert to me.
- **Q-06** Abuse: rate limits on sign-up, sign-in and invitations; invitation emails cannot be used to spam strangers.
- **Q-07** Runs on infrastructure that costs me under USD 50/month until we have 1,000 paying users.

## 9. What success looks like

- 1,000 sign-ups in the first month after launch, 5% of active users on Plus after three months.
- People capture on one device and complete on another: at least 40% of active users use two or more clients.
- Fewer than 1 in 1,000 syncs end with a user-visible conflict.

## 10. Order I would like

I trust you on the exact plan, but this is my instinct:

1. **Accounts and sync** for the web app and CLI, with the existing features. If sync is wrong, nothing else matters.
2. **Brand and the new web app**: lists, Today, Upcoming, quick add, search, both languages.
3. **Sharing** and live updates.
4. **Reminders**, recurring todos, subtasks.
5. **Money** and the landing page; then launch.
6. Mobile apps, imports from other apps.

## 11. Not now

Attachments, comments on todos, calendar integration, Slack or email-to-todo, AI features, teams larger than 10, a public API. Any of them comes back when paying users ask for it twice.

## 12. Open questions

- Domain: `listo.app` is probably taken. Is `getlisto.com` fine, or do you have a better idea?
- Native mobile apps now, or a PWA until people complain?
- Do we keep the free plan's limits, or is it better to launch with no free plan at all?
- Who answers support emails at the beginning? (I assume me.)
- CFDI invoices for Mexico: required on day one or after launch?
