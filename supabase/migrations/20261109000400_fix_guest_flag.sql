-- 20261109000400_fix_guest_flag.sql — profiles.is_guest must follow auth.users.is_anonymous.
--
-- handle_new_user() read raw_user_meta_data ->> 'is_guest', but anonymous sign-in
-- never sets that key: GoTrue records anonymity in the is_anonymous column. Every
-- guest therefore got is_guest = false. That matters for money, not just display —
-- a guest has no email address, so it can never be a PayPal payout recipient, and
-- settlement needs to be able to tell the two apart.
--
-- This is a new migration rather than an edit to 20261109000200_functions.sql:
-- that one has already been applied, and editing an applied migration silently
-- leaves every existing environment on the old behaviour.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, is_guest)
  values (new.id, coalesce(new.is_anonymous, false))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Backfill the profiles already created with the wrong flag.
update public.profiles p
   set is_guest = true
  from auth.users u
 where u.id = p.user_id
   and u.is_anonymous = true
   and p.is_guest = false;
