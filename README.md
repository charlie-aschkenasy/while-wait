# while-wait ("Standby")

A Cursor/VS Code extension that shows a small game panel (Trivia, 2048, Snake)
while Claude Code works, and hides it the instant the agent finishes.

Full docs land in M7. For now:

## Trivia setup

Trivia questions come from a Supabase project. Add these to your **user**
settings (Cursor → Settings → search "standby", or `settings.json`):

```json
{
  "standby.supabase.url": "https://<project-ref>.supabase.co",
  "standby.supabase.key": "sb_publishable_..."
}
```

Find both in the Supabase dashboard under **Project Settings → API**: the
Project URL, and the **publishable** key (safe for client-side use — row-level
security limits it to reading verified questions). Never use the secret /
service-role key here.

Questions are fetched once and cached for 24 h, so trivia works offline after
the first fetch. If the fetch fails and no cache exists, the Trivia tab hides
itself.
