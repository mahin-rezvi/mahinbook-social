# MahinBook

MahinBook is a responsive social-network MVP built with Next.js App Router, TypeScript, Tailwind CSS, and Supabase Auth/Postgres/Realtime/Storage.

## Run locally

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` if needed and set `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the project publishable key (or legacy anon key). The project URL is preconfigured in the example.
3. In Supabase SQL Editor, apply `supabase/migrations/202610070001_initial_schema.sql` on a fresh project, followed by `supabase/migrations/202610070002_social_features.sql` and `supabase/migrations/20261008204434_message_delete_controls.sql`. The initial migration is already installed on the connected project. The second adds reactions, friend workflows, notification triggers, secure realtime presence, and media uploads; the third adds per-message and per-conversation deletion controls.
4. Enable email auth and any desired OAuth providers in Supabase Auth. Set the local and production Site URL / redirect URLs in the Auth URL configuration.
5. Start the app with `npm run dev`.

All client-side database access uses the authenticated Supabase client and relies on database RLS. Never use a secret or `service_role` key in a `NEXT_PUBLIC_` variable.

## Included MVP features

- Email/password sign-up and sign-in, plus Google and GitHub OAuth entry points.
- Supabase-backed feed with text/image posts, visibility settings, seven reactions, comments, and author controls for editing/deleting posts and deleting comments.
- Profile editing, public/private profile settings, and profile/cover/post image uploads to the `mahinbook-media` bucket.
- Friend requests, accept/decline, blocking/unblocking, people search, and suggestions.
- One-to-one and group conversations with persisted messages, Supabase Realtime message updates, and participant-authorized presence.
- Stored notifications for friend requests/acceptance, post reactions/comments, and messages.
- Self-service account deletion with associated database rows removed through foreign-key cascades.

For Realtime messages and presence, ensure the tables and private-channel policies from the second migration are installed. Test with at least two authenticated accounts; the local preview feed is intentionally not persisted.

## Scope and architecture

This MVP uses Supabase Auth instead of NextAuth, the Supabase client directly from the browser under RLS instead of routing every request through Next.js API handlers, and Supabase Realtime rather than a separately hosted WebSocket server. Supabase Storage handles uploaded media. Redis caching, push notifications, data export, email verification customization, and broader Facebook-scale surfaces (groups, pages, stories, etc.) are not included.

The second migration adds database functions and policies used by the new features. Review it before applying it to any production database, and apply migrations through the Supabase SQL Editor or the project’s established migration workflow.
