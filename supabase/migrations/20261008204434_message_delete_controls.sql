alter table public.messages
  add column deleted_at timestamptz;

create table public.message_user_deletions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  deleted_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index message_user_deletions_user_message_idx
  on public.message_user_deletions (user_id, message_id);

alter table public.message_user_deletions enable row level security;
revoke all on table public.message_user_deletions from public, anon, authenticated;
grant select, insert on table public.message_user_deletions to authenticated;

create policy "Users view their own hidden messages"
  on public.message_user_deletions for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Conversation members hide messages for themselves"
  on public.message_user_deletions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.messages m
      where m.id = message_id
        and private.can_access_conversation(m.conversation_id)
    )
  );

grant update on table public.messages to authenticated;

create policy "Senders can unsend their messages"
  on public.messages for update to authenticated
  using (
    sender_id = (select auth.uid())
    and deleted_at is null
    and private.can_access_conversation(conversation_id)
  )
  with check (
    sender_id = (select auth.uid())
    and deleted_at is not null
    and private.can_access_conversation(conversation_id)
  );

grant delete on table public.conversation_members to authenticated;

create policy "Users can delete conversations from their inbox"
  on public.conversation_members for delete to authenticated
  using (
    user_id = (select auth.uid())
    and private.can_access_conversation(conversation_id)
  );
