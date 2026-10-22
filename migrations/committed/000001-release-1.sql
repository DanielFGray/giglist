--! Previous: -
--! Hash: sha1:a74fdf8bdd8c08e9cf8069affcad2103eb43360c
--! Message: release 1

--! split: 0001-reset.sql
/*
 * Graphile Migrate will run our `current/...` migrations in one batch. Since
 * this is our first migration it's defining the entire database, so we first
 * drop anything that may have previously been created
 * (app_public/app_hidden/app_private) so that we can start from scratch.
 */

drop schema if exists app_public cascade;
drop schema if exists app_hidden cascade;
drop schema if exists app_private cascade;

--! split: 0010-public-permissions.sql
/*
 * The `public` *schema* contains things like PostgreSQL extensions. We
 * deliberately do not install application logic into the public schema
 * (instead storing it to app_public/app_hidden/app_private as appropriate),
 * but none the less we don't want untrusted roles to be able to install or
 * modify things into the public schema.
 *
 * The `public` *role* is automatically inherited by all other roles; we only
 * want specific roles to be able to access our database so we must revoke
 * access to the `public` role.
 */

revoke all on schema public from public;

alter default privileges revoke all on sequences from public;
alter default privileges revoke all on functions from public;

-- Of course we want our database owner to be able to do anything inside the
-- database, so we grant access to the `public` schema:
grant all on schema public to :DATABASE_OWNER;

--! split: 0020-schemas.sql
/*
 * Read about our app_public/app_hidden/app_private schemas here:
 * https://www.graphile.org/postgraphile/namespaces/#advice
 *
 * Note this pattern is not required to use PostGraphile, it's merely the
 * preference of the author of this package.
 */

create schema app_public;
create schema app_hidden;
create schema app_private;

-- The 'visitor' role (used by PostGraphile to represent an end user) may
-- access the public, app_public and app_hidden schemas (but _NOT_ the
-- app_private schema).
grant usage on schema public, app_public, app_hidden to :DATABASE_VISITOR;

-- We want the `visitor` role to be able to insert rows (`serial` data type
-- creates sequences, so we need to grant access to that).
alter default privileges in schema public, app_public, app_hidden
  grant usage, select on sequences to :DATABASE_VISITOR;

-- And the `visitor` role should be able to call functions too.
alter default privileges in schema public, app_public, app_hidden
  grant execute on functions to :DATABASE_VISITOR;

--! split: 0030-common-triggers.sql
/*
 * These triggers are commonly used across many tables.
 */

-- Used for queueing jobs easily; relies on the fact that every table we have
-- has a primary key 'id' column; this won't work if you rename your primary
-- key columns.
create function app_private.tg__add_job() returns trigger as $$
begin
  perform graphile_worker.add_job(tg_argv[0], json_build_object('id', NEW.id));
  return NEW;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;
comment on function app_private.tg__add_job() is
  E'Useful shortcut to create a job on insert/update. Pass the task name as the first trigger argument, and optionally the queue name as the second argument. The record id will automatically be available on the JSON payload.';

-- This trigger is used to queue a job to inform a user that a significant
-- security change has been made to their account (e.g. adding a new email
-- address, linking a new social login).
create function app_private.tg__add_audit_job() returns trigger as $$
declare
  v_user_id uuid;
  v_type text = TG_ARGV[0];
  v_user_id_attribute text = TG_ARGV[1];
  v_extra_attribute1 text = TG_ARGV[2];
  v_extra_attribute2 text = TG_ARGV[3];
  v_extra_attribute3 text = TG_ARGV[4];
  v_extra1 text;
  v_extra2 text;
  v_extra3 text;
begin
  if v_user_id_attribute is null then
    raise exception 'Invalid tg__add_audit_job call';
  end if;

  execute 'select ($1.' || quote_ident(v_user_id_attribute) || ')::uuid'
    using (case when TG_OP = 'INSERT' then NEW else OLD end)
    into v_user_id;

  if v_extra_attribute1 is not null then
    execute 'select ($1.' || quote_ident(v_extra_attribute1) || ')::text'
      using (case when TG_OP = 'DELETE' then OLD else NEW end)
      into v_extra1;
  end if;
  if v_extra_attribute2 is not null then
    execute 'select ($1.' || quote_ident(v_extra_attribute2) || ')::text'
      using (case when TG_OP = 'DELETE' then OLD else NEW end)
      into v_extra2;
  end if;
  if v_extra_attribute3 is not null then
    execute 'select ($1.' || quote_ident(v_extra_attribute3) || ')::text'
      using (case when TG_OP = 'DELETE' then OLD else NEW end)
      into v_extra3;
  end if;

  if v_user_id is not null then
    perform graphile_worker.add_job(
      'user__audit',
      json_build_object(
        'type', v_type,
        'user_id', v_user_id,
        'extra1', v_extra1,
        'extra2', v_extra2,
        'extra3', v_extra3,
        'current_user_id', app_public.current_user_id(),
        'schema', TG_TABLE_SCHEMA,
        'table', TG_TABLE_NAME
      ));
  end if;

  return NEW;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;
comment on function app_private.tg__add_audit_job() is
  E'For notifying a user that an auditable action has taken place. Call with audit event name, user ID attribute name, and optionally another value to be included (e.g. the PK of the table, or some other relevant information). e.g. `tg__add_audit_job(''added_email'', ''user_id'', ''email'')`';

/*
 * This trigger is used on tables with created_at and updated_at to ensure that
 * these timestamps are kept valid (namely: `created_at` cannot be changed, and
 * `updated_at` must be monotonically increasing).
 */
create function app_private.tg__timestamps() returns trigger as $$
begin
  NEW.created_at = (case when TG_OP = 'INSERT' then NOW() else OLD.created_at end);
  NEW.updated_at = (case when TG_OP = 'UPDATE' and OLD.updated_at >= NOW() then OLD.updated_at + interval '1 millisecond' else NOW() end);
  return NEW;
end;
$$ language plpgsql volatile set search_path to pg_catalog, public, pg_temp;
comment on function app_private.tg__timestamps() is
  E'This trigger should be called on all tables with created_at, updated_at - it ensures that they cannot be manipulated and that updated_at will always be larger than the previous updated_at.';

/*
 * This trigger is useful for adding realtime features to our GraphQL schema
 * with minimal effort in the database. It's a very generic trigger function;
 * you're intended to pass three arguments when you call it:
 *
 * 1. The "event" name to include, this is an arbitrary string.
 * 2. The "topic" template that we'll be publishing the event to. A `$1` in
 *    this may be added as a placeholder which will be replaced by the
 *    "subject" value.
 * 3. The "subject" column, we'll read the value of this column from the NEW
 *    (for insert/update) or OLD (for delete) record and include it in the
 *    event payload.
 *
 * A PostgreSQL `NOTIFY` will be issued to the topic (or "channel") generated
 * from arguments 2 and 3, the body of the notification will be a stringified
 * JSON object containing `event`, `sub` (the subject specified by argument 3)
 * and `id` (the record id).
 *
 * Example:
 *
 *     create trigger _500_gql_update
 *       after update on app_public.users
 *       for each row
 *       execute procedure app_public.tg__graphql_subscription(
 *         'userChanged', -- the "event" string, useful for the client to know what happened
 *         'graphql:user:$1', -- the "topic" the event will be published to, as a template
 *         'id' -- If specified, `$1` above will be replaced with NEW.id or OLD.id from the trigger.
 *       );
 */
create function app_public.tg__graphql_subscription() returns trigger as $$
declare
  v_process_new bool = (TG_OP = 'INSERT' OR TG_OP = 'UPDATE');
  v_process_old bool = (TG_OP = 'UPDATE' OR TG_OP = 'DELETE');
  v_event text = TG_ARGV[0];
  v_topic_template text = TG_ARGV[1];
  v_attribute text = TG_ARGV[2];
  v_record record;
  v_sub text;
  v_topic text;
  v_i int = 0;
  v_last_topic text;
begin
  for v_i in 0..1 loop
    if (v_i = 0) and v_process_new is true then
      v_record = new;
    elsif (v_i = 1) and v_process_old is true then
      v_record = old;
    else
      continue;
    end if;
     if v_attribute is not null then
      execute 'select $1.' || quote_ident(v_attribute)
        using v_record
        into v_sub;
    end if;
    if v_sub is not null then
      v_topic = replace(v_topic_template, '$1', v_sub);
    else
      v_topic = v_topic_template;
    end if;
    if v_topic is distinct from v_last_topic then
      -- This if statement prevents us from triggering the same notification twice
      v_last_topic = v_topic;
      perform pg_notify(v_topic, json_build_object(
        'event', v_event,
        'subject', v_sub,
        'id', v_record.id
      )::text);
    end if;
  end loop;
  return v_record;
end;
$$ language plpgsql volatile;
comment on function app_public.tg__graphql_subscription() is
  E'This function enables the creation of simple focussed GraphQL subscriptions using database triggers. Read more here: https://www.graphile.org/postgraphile/subscriptions/#custom-subscriptions';

--! split: 0100-sessions.sql
/*
 * This table is used (only) by `connect-pg-simple` (see `installSession.ts`)
 * to track cookie session information at the webserver (`express`) level if
 * you don't have a redis server. If you're using redis everywhere (including
 * development) then you don't need this table.
 *
 * Do not confuse this with the `app_private.sessions` table.
 */

create table app_private.connect_pg_simple_sessions (
  sid uuid primary key default gen_random_uuid(),
  sess jsonb not null,
  expire timestamptz not null
);
alter table app_private.connect_pg_simple_sessions
  enable row level security;

/*
 * The sessions table is used to track who is logged in, if there are any
 * restrictions on that session, when it was last active (so we know if it's
 * still valid), etc.
 *
 * In Starter we only have an extremely limited implementation of this, but you
 * could add things like "last_auth_at" to it so that you could track when they
 * last officially authenticated; that way if you have particularly dangerous
 * actions you could require them to log back in to allow them to perform those
 * actions. (GitHub does this when you attempt to change the settings on a
 * repository, for example.)
 *
 * The primary key is a cryptographically secure random uuid; the value of this
 * primary key should be secret, and only shared with the user themself. We
 * currently wrap this session in a webserver-level session (either using
 * redis, or using `connect-pg-simple` which uses the
 * `connect_pg_simple_sessions` table which we defined previously) so that we
 * don't even send the raw session id to the end user, but you might want to
 * consider exposing it for things such as mobile apps or command line
 * utilities that may not want to implement cookies to maintain a cookie
 * session.
 */

create table app_private.sessions (
  uuid uuid not null default gen_random_uuid() primary key,
  user_id uuid not null,
  -- You could add access restriction columns here if you want, e.g. for OAuth scopes.
  created_at timestamptz not null default now(),
  last_active timestamptz not null default now()
);
alter table app_private.sessions enable row level security;

-- To allow us to efficiently see what sessions are open for a particular user.
create index on app_private.sessions (user_id);

/*
 * This function is responsible for reading the `my.session_id`
 * transaction setting (set from the `pgSettings` function within
 * `installPostGraphile.ts`). Defining this inside a function means we can
 * modify it in future to allow additional ways of defining the session.
 */

-- Note we have this in `app_public` but it doesn't show up in the GraphQL
-- schema because we've used `postgraphile.tags.jsonc` to omit it. We could
-- have put it in app_hidden to get the same effect more easily, but it's often
-- useful to un-omit it to ease debugging auth issues.
create function app_public.current_session_id() returns uuid as $$
  select nullif(pg_catalog.current_setting('my.session_id', true), '')::uuid;
$$ language sql stable;
comment on function app_public.current_session_id() is
  E'Handy method to get the current session ID.';


/*
 * We can figure out who the current user is by looking up their session in the
 * sessions table using the `current_session_id()` function.
 *
 * A less secure but more performant version of this function might contain only:
 *
 *   select nullif(pg_catalog.current_setting('jwt.claims.user_id', true), '')::uuid;
 *
 * The increased security of this implementation is because even if someone gets
 * the ability to run SQL within this transaction they cannot impersonate
 * another user without knowing their session_id (which should be closely
 * guarded).
 *
 * The below implementation is more secure than simply indicating the user_id
 * directly: even if an SQL injection vulnerability were to allow a user to set
 * their `my.session_id` to another value, it would take them many
 * millenia to be able to correctly guess someone else's session id (since it's
 * a cryptographically secure random value that is kept secret). This makes
 * impersonating another user virtually impossible.
 */
create function app_public.current_user_id() returns uuid as $$
  select user_id from app_private.sessions where uuid = app_public.current_session_id();
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;
comment on function app_public.current_user_id() is
  E'Handy method to get the current user ID for use in RLS policies, etc; in GraphQL, use `currentUser{id}` instead.';

--! split: 0120-users.sql
/*
 * The users table stores (unsurprisingly) the users of our application. You'll
 * notice that it does NOT contain private information such as the user's
 * password or their email address; that's because the users table is seen as
 * public - anyone who can "see" the user can see this information.
 *
 * The author sees `role` and `is_verified` as public information; if you
 * disagree then you should relocate these attributes to another table, such as
 * `user_secrets`.
 */
create type app_public.user_role as enum('admin', 'moderator', 'user');
create domain app_public.username as citext check(length(value) >= 2 and length(value) <= 64 and value ~ '^[a-zA-Z][a-zA-Z0-9_-]+$');
create domain app_public.url as text check(value ~ '^https?://\S+');

create table app_public.users (
  id uuid primary key default gen_random_uuid(),
  username app_public.username not null unique,
  name text,
  avatar_url app_public.url,
  bio text check(length(bio) <= 4000),
  role app_public.user_role not null default 'user',
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table app_public.users enable row level security;
create index idx_users_username on app_public.users (username);
-- create index idx_users_username_trgm on app_public.users using gin(username gin_trgm_ops);

-- We couldn't implement this relationship on the sessions table until the users table existed!
alter table app_private.sessions
  add constraint sessions_user_id_fkey
  foreign key ("user_id") references app_public.users on delete cascade;

-- Users are publicly visible, like on GitHub, Twitter, Facebook, Trello, etc.
create policy select_all on app_public.users for select using (true);
-- You can only update yourself.
create policy update_self on app_public.users for update using (id = app_public.current_user_id());
grant select on app_public.users to :DATABASE_VISITOR;
-- NOTE: `insert` is not granted, because we'll handle that separately
grant update(username, name, bio, avatar_url) on app_public.users to :DATABASE_VISITOR;
-- NOTE: `delete` is not granted, because we require confirmation via request_account_deletion/confirm_account_deletion

comment on table app_public.users is
  E'A user who can log in to the application.';

comment on column app_public.users.id is
  E'Unique identifier for the user.';
comment on column app_public.users.username is
  E'Public-facing username (or ''handle'') of the user.';
comment on column app_public.users.name is
  E'Public-facing name (or pseudonym) of the user.';
comment on column app_public.users.avatar_url is
  E'Optional avatar URL.';

create trigger _100_timestamps
  before insert or update on app_public.users
  for each row
  execute procedure app_private.tg__timestamps();

/**********/

-- Returns the current user; this is a "custom query" function; see:
-- https://www.graphile.org/postgraphile/custom-queries/
-- So this will be queryable via GraphQL as `{ currentUser { ... } }`
create function app_public.current_user() returns app_public.users as $$
  select users.* from app_public.users where id = app_public.current_user_id();
$$ language sql stable;
comment on function app_public.current_user() is
  E'The currently logged in user (or null if not logged in).';

/**********/

-- The users table contains all the public information, but we need somewhere
-- to store private information. In fact, this data is so private that we don't
-- want the user themselves to be able to see it - things like the bcrypted
-- password hash, timestamps of recent login attempts (to allow us to
-- auto-protect user accounts that are under attack), etc.
create table app_private.user_secrets (
  user_id uuid not null primary key references app_public.users on delete cascade,
  password_hash text,
  last_login_at timestamptz not null default now(),
  failed_password_attempts int not null default 0,
  first_failed_password_attempt timestamptz,
  reset_password_token text,
  reset_password_token_generated timestamptz,
  failed_reset_password_attempts int not null default 0,
  first_failed_reset_password_attempt timestamptz,
  delete_account_token text,
  delete_account_token_generated timestamptz
);
alter table app_private.user_secrets enable row level security;
comment on table app_private.user_secrets is
  E'The contents of this table should never be visible to the user. Contains data mostly related to authentication.';

/*
 * When we insert into `users` we _always_ want there to be a matching
 * `user_secrets` entry, so we have a trigger to enforce this:
 */
create function app_private.tg_user_secrets__insert_with_user() returns trigger as $$
begin
  insert into app_private.user_secrets(user_id) values(NEW.id);
  return NEW;
end;
$$ language plpgsql volatile set search_path to pg_catalog, public, pg_temp;
create trigger _500_insert_secrets
  after insert on app_public.users
  for each row
  execute procedure app_private.tg_user_secrets__insert_with_user();
comment on function app_private.tg_user_secrets__insert_with_user() is
  E'Ensures that every user record has an associated user_secret record.';

/*
 * Because you can register with username/password or using OAuth (social
 * login), we need a way to tell the user whether or not they have a
 * password. This is to help the UI display the right interface: change
 * password or set password.
 */
create function app_public.users_has_password(u app_public.users) returns boolean as $$
  select (password_hash is not null) from app_private.user_secrets where user_secrets.user_id = u.id and u.id = app_public.current_user_id();
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;

/*
 * When the user validates their email address we want the UI to be notified
 * immediately, so we'll issue a notification to the `graphql:user:*` topic
 * which GraphQL users can subscribe to via the `currentUserUpdated`
 * subscription field.
 */
create trigger _500_gql_update
  after update on app_public.users
  for each row
  execute procedure app_public.tg__graphql_subscription(
    'userChanged', -- the "event" string, useful for the client to know what happened
    'graphql:user:$1', -- the "topic" the event will be published to, as a template
    'id' -- If specified, `$1` above will be replaced with NEW.id or OLD.id from the trigger.
  );

--! split: 0130-user_emails.sql
/*
 * A user may have more than one email address; this is useful when letting the
 * user change their email so that they can verify the new one before deleting
 * the old one, but is also generally useful as they might want to use
 * different emails to log in versus where to send notifications. Therefore we
 * track user emails in a separate table.
 */
create table app_public.user_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default app_public.current_user_id() references app_public.users on delete cascade,
  email citext not null check (email ~ '[^@]+@[^@]+\.[^@]+'),
  is_verified boolean not null default false,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Each user can only have an email once.
  constraint user_emails_user_id_email_key unique(user_id, email),
  -- An unverified email cannot be set as the primary email.
  constraint user_emails_must_be_verified_to_be_primary check(is_primary is false or is_verified is true)
);
alter table app_public.user_emails enable row level security;

-- Once an email is verified, it may only be used by one user. (We can't
-- enforce this before an email is verified otherwise it could be used to
-- prevent a legitimate user from signing up.)
create unique index uniq_user_emails_verified_email on app_public.user_emails(email) where (is_verified is true);
-- Only one primary email per user.
create unique index uniq_user_emails_primary_email on app_public.user_emails (user_id) where (is_primary is true);
-- Allow efficient retrieval of all the emails owned by a particular user.
create index idx_user_emails_user on app_public.user_emails (user_id);
-- For the user settings page sorting
create index idx_user_emails_primary on app_public.user_emails (is_primary, user_id);

-- Keep created_at and updated_at up to date.
create trigger _100_timestamps
  before insert or update on app_public.user_emails
  for each row
  execute procedure app_private.tg__timestamps();

-- When an email address is added to a user, notify them (in case their account was compromised).
create trigger _500_audit_added
  after insert on app_public.user_emails
  for each row
  execute procedure app_private.tg__add_audit_job(
    'added_email',
    'user_id',
    'id',
    'email'
  );

-- When an email address is removed from a user, notify them (in case their account was compromised).
create trigger _500_audit_removed
  after delete on app_public.user_emails
  for each row
  execute procedure app_private.tg__add_audit_job(
    'removed_email',
    'user_id',
    'id',
    'email'
  );

-- You can't verify an email address that someone else has already verified. (Email is taken.)
create function app_public.tg_user_emails__forbid_if_verified() returns trigger as $$
begin
  if exists(select 1 from app_public.user_emails where email = NEW.email and is_verified is true) then
    raise exception 'An account using that email address has already been created.' using errcode='EMTKN';
  end if;
  return NEW;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;
create trigger _200_forbid_existing_email before insert on app_public.user_emails for each row execute procedure app_public.tg_user_emails__forbid_if_verified();

-- If the email wasn't already verified (e.g. via a social login provider) then
-- queue up the verification email to be sent.
create trigger _900_send_verification_email
  after insert on app_public.user_emails
  for each row
  when (NEW.is_verified is false)
  execute procedure app_private.tg__add_job('user_emails__send_verification');

comment on table app_public.user_emails is
  E'Information about a user''s email address.';
comment on column app_public.user_emails.email is
  E'The users email address, in `a@b.c` format.';
comment on column app_public.user_emails.is_verified is
  E'True if the user has is_verified their email address (by clicking the link in the email we sent them, or logging in with a social login provider), false otherwise.';

-- Users may only manage their own emails.
create policy select_own on app_public.user_emails for select using (user_id = app_public.current_user_id());
create policy insert_own on app_public.user_emails for insert with check (user_id = app_public.current_user_id());
-- NOTE: we don't allow emails to be updated, instead add a new email and delete the old one.
create policy delete_own on app_public.user_emails for delete using (user_id = app_public.current_user_id());

grant select on app_public.user_emails to :DATABASE_VISITOR;
grant insert (email) on app_public.user_emails to :DATABASE_VISITOR;
-- No update
grant delete on app_public.user_emails to :DATABASE_VISITOR;

-- Prevent deleting the user's last email, otherwise they can't access password reset/etc.
create function app_public.tg_user_emails__prevent_delete_last_email() returns trigger as $$
begin
  if exists (
    with remaining as (
      select user_emails.user_id
      from app_public.user_emails
      inner join deleted
      on user_emails.user_id = deleted.user_id
      -- Don't delete last verified email
      where (user_emails.is_verified is true or not exists (
        select 1
        from deleted d2
        where d2.user_id = user_emails.user_id
        and d2.is_verified is true
      ))
      order by user_emails.id asc

      /*
       * Lock this table to prevent race conditions; see:
       * https://www.cybertec-postgresql.com/en/triggers-to-enforce-constraints/
       */
      for update of user_emails
    )
    select 1
    from app_public.users
    where id in (
      select user_id from deleted
      except
      select user_id from remaining
    )
  )
  then
    raise exception 'You must have at least one (verified) email address' using errcode = 'CDLEA';
  end if;

  return null;
end;
$$
language plpgsql
-- Security definer is required for 'FOR UPDATE OF' since we don't grant UPDATE privileges.
security definer
set search_path = pg_catalog, public, pg_temp;

-- Note this check runs AFTER the email was deleted. If the user was deleted
-- then their emails will also be deleted (thanks to the foreign key on delete
-- cascade) and this is desirable; we only want to prevent the deletion if
-- the user still exists so we check after the statement completes.
create trigger _500_prevent_delete_last
  after delete on app_public.user_emails
  referencing old table as deleted
  for each statement
  execute procedure app_public.tg_user_emails__prevent_delete_last_email();

/**********/

/*
 * Just like with users and user_secrets, there are secrets for emails that we
 * don't want the user to be able to see - for example the verification token.
 * Like with user_secrets we automatically create a record in this table
 * whenever a record is added to user_emails.
 */
create table app_private.user_email_secrets (
  user_email_id uuid primary key references app_public.user_emails on delete cascade,
  verification_token text,
  verification_email_sent_at timestamptz,
  password_reset_email_sent_at timestamptz
);
alter table app_private.user_email_secrets enable row level security;

comment on table app_private.user_email_secrets is
  E'The contents of this table should never be visible to the user. Contains data mostly related to email verification and avoiding spamming users.';
comment on column app_private.user_email_secrets.password_reset_email_sent_at is
  E'We store the time the last password reset was sent to this email to prevent the email getting flooded.';

create function app_private.tg_user_email_secrets__insert_with_user_email() returns trigger as $$
declare
  v_verification_token text;
begin
  if NEW.is_verified is false then
    v_verification_token = encode(gen_random_bytes(7), 'hex');
  end if;
  insert into app_private.user_email_secrets(user_email_id, verification_token) values(NEW.id, v_verification_token);
  return NEW;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;
create trigger _500_insert_secrets
  after insert on app_public.user_emails
  for each row
  execute procedure app_private.tg_user_email_secrets__insert_with_user_email();
comment on function app_private.tg_user_email_secrets__insert_with_user_email() is
  E'Ensures that every user_email record has an associated user_email_secret record.';

/**********/

/*
 * When the user receives the email verification message it will contain the
 * token; this function is responsible for checking the token and marking the
 * email as verified if it matches. Note it is a `SECURITY DEFINER` function,
 * which means it runs with the security of the user that defined the function
 * (which is the database owner) - i.e. it can do anything the database owner
 * can do. This means we have to be very careful what we put in the function,
 * and make sure that it checks that the user is allowed to do what they're
 * trying to do - in this case, we do that check by ensuring the token matches.
 */
create function app_public.verify_email(user_email_id uuid, token text) returns boolean as $$
begin
  update app_public.user_emails
  set
    is_verified = true,
    is_primary = is_primary or not exists(
      select 1 from app_public.user_emails other_email where other_email.user_id = user_emails.user_id and other_email.is_primary is true
    )
  where id = user_email_id
  and exists(
    select 1 from app_private.user_email_secrets where user_email_secrets.user_email_id = user_emails.id and verification_token = token
  );
  return found;
end;
$$ language plpgsql strict volatile security definer set search_path to pg_catalog, public, pg_temp;
comment on function app_public.verify_email(user_email_id uuid, token text) is
  E'Once you have received a verification token for your email, you may call this mutation with that token to make your email verified.';

/*
 * When the users first email address is verified we will mark their account as
 * verified, which can unlock additional features that were gated behind an
 * `isVerified` check.
 */

create function app_public.tg_user_emails__verify_account_on_verified() returns trigger as $$
begin
  update app_public.users set is_verified = true where id = new.user_id and is_verified is false;
  return new;
end;
$$ language plpgsql strict volatile security definer set search_path to pg_catalog, public, pg_temp;

create trigger _500_verify_account_on_verified
  after insert or update of is_verified
  on app_public.user_emails
  for each row
  when (new.is_verified is true)
  execute procedure app_public.tg_user_emails__verify_account_on_verified();

--! split: 0150-user_auth.sql
/*
 * In addition to logging in with username/email and password, users may use
 * other authentication methods, such as "social login" (OAuth) with GitHub,
 * Twitter, Facebook, etc. We store details of these logins to the
 * user_authentications and user_authentication_secrets tables.
 *
 * The user is allowed to delete entries in this table (which will unlink them
 * from that service), but adding records to the table requires elevated
 * privileges (it's managed by the `installPassportStrategy.ts` middleware,
 * which calls out to the `app_private.link_or_register_user` database
 * function).
 */
create table app_public.user_authentications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_public.users on delete cascade,
  service text not null,
  identifier text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uniq_user_authentications unique(service, identifier)
);

alter table app_public.user_authentications enable row level security;

-- Make it efficient to find all the authentications for a particular user.
create index on app_public.user_authentications(user_id);

-- Keep created_at and updated_at up to date.
create trigger _100_timestamps
  before insert or update on app_public.user_authentications
  for each row
  execute procedure app_private.tg__timestamps();

comment on table app_public.user_authentications is
  E'Contains information about the login providers this user has used, so that they may disconnect them should they wish.';
comment on column app_public.user_authentications.service is
  E'The login service used, e.g. `twitter` or `github`.';
comment on column app_public.user_authentications.identifier is
  E'A unique identifier for the user within the login service.';
comment on column app_public.user_authentications.details is
  E'Additional profile details extracted from this login method';

-- Users may view and delete their social logins.
create policy select_own on app_public.user_authentications for select using (user_id = app_public.current_user_id());
create policy delete_own on app_public.user_authentications for delete using (user_id = app_public.current_user_id());
-- TODO: on delete, check this isn't the last one, or that they have a verified
-- email address or password. For now we're not worrying about that since all
-- the OAuth providers we use verify the email address.

-- Notify the user if a social login is removed.
create trigger _500_audit_removed
  after delete on app_public.user_authentications
  for each row
  execute procedure app_private.tg__add_audit_job(
    'unlinked_account',
    'user_id',
    'service',
    'identifier'
  );
-- NOTE: we don't need to notify when a linked account is added here because
-- that's handled in the link_or_register_user function.

grant select on app_public.user_authentications to :DATABASE_VISITOR;
grant delete on app_public.user_authentications to :DATABASE_VISITOR;

/**********/

-- This table contains secret information for each user_authentication; could
-- be things like access tokens, refresh tokens, profile information. Whatever
-- the passport strategy deems necessary.
create table app_private.user_authentication_secrets (
  user_authentication_id uuid not null primary key references app_public.user_authentications on delete cascade,
  details jsonb not null default '{}'::jsonb
);
alter table app_private.user_authentication_secrets enable row level security;

-- NOTE: user_authentication_secrets doesn't need an auto-inserter as we handle
-- that everywhere that can create a user_authentication row.
/*
 * This function handles logging in a user with their username (or email
 * address) and password.
 *
 * Note that it is not in app_public; this function is intended to be called
 * with elevated privileges (namely from `PassportLoginPlugin.ts`). The reason
 * for this is because we want to be able to track failed login attempts (to
 * help protect user accounts). If this were callable by a user, they could
 * roll back the transaction when a login fails and no failed attempts would be
 * logged, effectively giving them infinite retries. We want to disallow this,
 * so we only let code call into `login` that we trust to not roll back the
 * transaction afterwards.
 */
create function app_private.login(username citext, password text) returns app_private.sessions as $$
declare
  v_user app_public.users;
  v_user_secret app_private.user_secrets;
  v_login_attempt_window_duration interval = interval '5 minutes';
  v_session app_private.sessions;
begin
  if username like '%@%' then
    -- It's an email
    select users.* into v_user
    from app_public.users
    inner join app_public.user_emails
    on (user_emails.user_id = users.id)
    where user_emails.email = login.username
    order by
      user_emails.is_verified desc, -- Prefer verified email
      user_emails.created_at asc -- Failing that, prefer the first registered (unverified users _should_ verify before logging in)
    limit 1;
  else
    -- It's a username
    select users.* into v_user
    from app_public.users
    where users.username = login.username;
  end if;

  if v_user is null then
    -- No user with that email/username was found
    return null;
  end if;

  -- Load their secrets
  select * into v_user_secret from app_private.user_secrets
  where user_secrets.user_id = v_user.id;

  -- Have there been too many login attempts?
  if (
    v_user_secret.first_failed_password_attempt is not null
  and
    v_user_secret.first_failed_password_attempt > NOW() - v_login_attempt_window_duration
  and
    v_user_secret.failed_password_attempts >= 3
  ) then
    raise exception 'User account locked - too many login attempts. Try again after 5 minutes.' using errcode = 'LOCKD';
  end if;

  -- Not too many login attempts, let's check the password.
  -- NOTE: `password_hash` could be null, this is fine since `NULL = NULL` is null, and null is falsy.
  if v_user_secret.password_hash != crypt(password, v_user_secret.password_hash) then
    -- Wrong password, bump all the attempt tracking figures
    update app_private.user_secrets
    set
      failed_password_attempts = (case when first_failed_password_attempt is null or first_failed_password_attempt < now() - v_login_attempt_window_duration then 1 else failed_password_attempts + 1 end),
      first_failed_password_attempt = (case when first_failed_password_attempt is null or first_failed_password_attempt < now() - v_login_attempt_window_duration then now() else first_failed_password_attempt end)
    where user_id = v_user.id;
    return null; -- Must not throw otherwise transaction will be aborted and attempts won't be recorded
  end if;

  -- Excellent - they're logged in! Let's reset the attempt tracking
  update app_private.user_secrets
  set failed_password_attempts = 0, first_failed_password_attempt = null, last_login_at = now()
  where user_id = v_user.id;
  -- Create a session for the user
  insert into app_private.sessions (user_id) values (v_user.id) returning * into v_session;
  -- And finally return the session
  return v_session;
end;
$$ language plpgsql strict volatile;

comment on function app_private.login(username citext, password text) is
  E'Returns a user that matches the username/password combo, or null on failure.';
/*
 * Logging out deletes the session, and clears the session_id in the
 * transaction. This is a `SECURITY DEFINER` function, so we check that the
 * user is allowed to do it by matching the current_session_id().
 */
create function app_public.logout() returns void as $$
begin
  -- Delete the session
  delete from app_private.sessions where uuid = app_public.current_session_id();
  -- Clear the identifier from the transaction
  perform set_config('my.session_id', '', true);
end;
$$ language plpgsql security definer volatile set search_path to pg_catalog, public, pg_temp;
/*
 * When a user forgets their password we want to let them set a new one; but we
 * need to be very careful with this. We don't want to reveal whether or not an
 * account exists by the email address, so we email the entered email address
 * whether or not it's registered. If it's not registered, we track these
 * attempts in `unregistered_email_password_resets` to ensure that we don't
 * allow spamming the address; otherwise we store it to `user_email_secrets`.
 *
 * `app_public.forgot_password` is responsible for checking these things and
 * queueing a reset password token to be emailed to the user. For what happens
 * after the user receives this email, see instead `app_private.reset_password`.
 *
 * NOTE: unlike app_private.login and app_private.reset_password, rolling back
 * the results of this function will not cause any security issues so we do not
 * need to call it indirectly as we do for those other functions. (Rolling back
 * will undo the tracking of when we sent the email but it will also prevent
 * the email being sent, so it's harmless.)
 */

create table app_private.unregistered_email_password_resets (
  email citext constraint unregistered_email_pkey primary key,
  attempts int not null default 1,
  latest_attempt timestamptz not null
);
comment on table app_private.unregistered_email_password_resets is
  E'If someone tries to recover the password for an email that is not registered in our system, this table enables us to rate-limit outgoing emails to avoid spamming.';
comment on column app_private.unregistered_email_password_resets.attempts is
  E'We store the number of attempts to help us detect accounts being attacked.';
comment on column app_private.unregistered_email_password_resets.latest_attempt is
  E'We store the time the last password reset was sent to this email to prevent the email getting flooded.';

/**********/

create function app_public.forgot_password(email citext) returns void as $$
declare
  v_user_email app_public.user_emails;
  v_token text;
  v_token_min_duration_between_emails interval = interval '3 minutes';
  v_token_max_duration interval = interval '3 days';
  v_now timestamptz = clock_timestamp(); -- Function can be called multiple during transaction
  v_latest_attempt timestamptz;
begin
  -- Find the matching user_email:
  select user_emails.* into v_user_email
  from app_public.user_emails
  where user_emails.email = forgot_password.email
  order by is_verified desc, id desc;

  -- If there is no match:
  if v_user_email is null then
    -- This email doesn't exist in the system; trigger an email stating as much.

    -- We do not allow this email to be triggered more than once every 15
    -- minutes, so we need to track it:
    insert into app_private.unregistered_email_password_resets (email, latest_attempt)
      values (forgot_password.email, v_now)
      on conflict on constraint unregistered_email_pkey
      do update
        set latest_attempt = v_now, attempts = unregistered_email_password_resets.attempts + 1
        where unregistered_email_password_resets.latest_attempt < v_now - interval '15 minutes'
      returning latest_attempt into v_latest_attempt;

    if v_latest_attempt = v_now then
      perform graphile_worker.add_job(
        'user__forgot_password_unregistered_email',
        json_build_object('email', forgot_password.email::text)
      );
    end if;

    -- TODO: we should clear out the unregistered_email_password_resets table periodically.

    return;
  end if;

  -- There was a match.
  -- See if we've triggered a reset recently:
  if exists(
    select 1
    from app_private.user_email_secrets
    where user_email_id = v_user_email.id
    and password_reset_email_sent_at is not null
    and password_reset_email_sent_at > v_now - v_token_min_duration_between_emails
  ) then
    -- If so, take no action.
    return;
  end if;

  -- Fetch or generate reset token:
  update app_private.user_secrets
  set
    reset_password_token = (
      case
      when reset_password_token is null or reset_password_token_generated < v_now - v_token_max_duration
      then encode(gen_random_bytes(7), 'hex')
      else reset_password_token
      end
    ),
    reset_password_token_generated = (
      case
      when reset_password_token is null or reset_password_token_generated < v_now - v_token_max_duration
      then v_now
      else reset_password_token_generated
      end
    )
  where user_id = v_user_email.user_id
  returning reset_password_token into v_token;

  -- Don't allow spamming an email:
  update app_private.user_email_secrets
  set password_reset_email_sent_at = v_now
  where user_email_id = v_user_email.id;

  -- Trigger email send:
  perform graphile_worker.add_job(
    'user__forgot_password',
    json_build_object('id', v_user_email.user_id, 'email', v_user_email.email::text, 'token', v_token)
  );

end;
$$ language plpgsql strict security definer volatile set search_path to pg_catalog, public, pg_temp;

comment on function app_public.forgot_password(email public.citext) is
  E'If you''ve forgotten your password, give us one of your email addresses and we''ll send you a reset token. Note this only works if you have added an email address!';
/*
 * This is the second half of resetting a users password, please see
 * `app_public.forgot_password` for the first half.
 *
 * The `app_private.reset_password` function checks the reset token is correct
 * and sets the user's password to be the newly provided password, assuming
 * `assert_valid_password` is happy with it. If the attempt fails, this is
 * logged to avoid a brute force attack. Since we cannot risk this tracking
 * being lost (e.g. by a later error rolling back the transaction), we put this
 * function into app_private and explicitly call it from the `resetPassword`
 * field in `PassportLoginPlugin.ts`.
 */

create function app_private.assert_valid_password(new_password text) returns void as $$
begin
  -- TODO: add better assertions!
  if length(new_password) < 8 then
    raise exception 'Password is too weak' using errcode = 'WEAKP';
  end if;
end;
$$ language plpgsql volatile;

create function app_private.reset_password(user_id uuid, reset_token text, new_password text) returns app_private.sessions as $$
declare
  v_user app_public.users;
  v_user_secret app_private.user_secrets;
  v_token_max_duration interval = interval '3 days';
  v_session app_private.sessions;
begin
  select users.* into v_user
  from app_public.users
  where id = user_id;

  if v_user is null then
    return null;
  end if;

  -- Load their secrets
  select * into v_user_secret from app_private.user_secrets
  where user_secrets.user_id = v_user.id;

  -- Have there been too many reset attempts?
  if (
    v_user_secret.first_failed_reset_password_attempt is not null
  and
    v_user_secret.first_failed_reset_password_attempt > NOW() - v_token_max_duration
  and
    v_user_secret.failed_reset_password_attempts >= 20
  ) then
    raise exception 'Password reset locked - too many reset attempts' using errcode = 'LOCKD';
  end if;

  -- Not too many reset attempts, let's check the token
  if v_user_secret.reset_password_token != reset_token then
    -- Wrong token, bump all the attempt tracking figures
    update app_private.user_secrets
    set
      failed_reset_password_attempts = (case when first_failed_reset_password_attempt is null or first_failed_reset_password_attempt < now() - v_token_max_duration then 1 else failed_reset_password_attempts + 1 end),
      first_failed_reset_password_attempt = (case when first_failed_reset_password_attempt is null or first_failed_reset_password_attempt < now() - v_token_max_duration then now() else first_failed_reset_password_attempt end)
    where user_secrets.user_id = v_user.id;
    return null;
  end if;

  -- Excellent - they're legit
  -- perform app_private.assert_valid_password(new_password);

  -- Let's reset the password as requested
  update app_private.user_secrets
  set
    password_hash = crypt(new_password, gen_salt('bf')),
    failed_password_attempts = 0,
    first_failed_password_attempt = null,
    reset_password_token = null,
    reset_password_token_generated = null,
    failed_reset_password_attempts = 0,
    first_failed_reset_password_attempt = null
  where user_secrets.user_id = v_user.id;

  -- Revoke the users' sessions
  delete from app_private.sessions
  where sessions.user_id = v_user.id;

  -- Notify user their password was reset
  perform graphile_worker.add_job(
    'user__audit',
    json_build_object(
      'type', 'reset_password',
      'user_id', v_user.id,
      'current_user_id', app_public.current_user_id()
    ));

  -- Create a new session for the user
  insert into app_private.sessions (user_id) values (v_user.id) returning * into v_session;
  return v_session;
end;
$$ language plpgsql strict volatile;
/*
 * For security reasons we don't want to allow a user to just delete their user
 * account without confirmation; so we have them request deletion, receive an
 * email, and then click the link in the email and press a button to confirm
 * deletion. This function handles the first step in this process; see
 * `app_public.confirm_account_deletion` for the second half.
 */

create function app_public.request_account_deletion() returns boolean as $$
declare
  v_user_email app_public.user_emails;
  v_token text;
  v_token_max_duration interval = interval '3 days';
begin
  if app_public.current_user_id() is null then
    raise exception 'You must log in to delete your account' using errcode = 'LOGIN';
  end if;

  -- Get the email to send account deletion token to
  select * into v_user_email
    from app_public.user_emails
    where user_id = app_public.current_user_id()
    order by is_primary desc, is_verified desc, id desc
    limit 1;

  -- Fetch or generate token
  update app_private.user_secrets
  set
    delete_account_token = (
      case
      when delete_account_token is null or delete_account_token_generated < NOW() - v_token_max_duration
      then encode(gen_random_bytes(7), 'hex')
      else delete_account_token
      end
    ),
    delete_account_token_generated = (
      case
      when delete_account_token is null or delete_account_token_generated < NOW() - v_token_max_duration
      then now()
      else delete_account_token_generated
      end
    )
  where user_id = app_public.current_user_id()
  returning delete_account_token into v_token;

  -- Trigger email send
  perform graphile_worker.add_job('user__send_delete_account_email', json_build_object('email', v_user_email.email::text, 'token', v_token));
  return true;
end;
$$ language plpgsql strict security definer volatile set search_path to pg_catalog, public, pg_temp;

comment on function app_public.request_account_deletion() is
  E'Begin the account deletion flow by requesting the confirmation email';
/*
 * This is the second half of the account deletion process, for the first half
 * see `app_public.request_account_deletion`.
 */
create function app_public.confirm_account_deletion(token text) returns boolean as $$
declare
  v_user_secret app_private.user_secrets;
  v_token_max_duration interval = interval '3 days';
begin
  if app_public.current_user_id() is null then
    raise exception 'You must log in to delete your account' using errcode = 'LOGIN';
  end if;

  select * into v_user_secret
    from app_private.user_secrets
    where user_secrets.user_id = app_public.current_user_id();

  if v_user_secret is null then
    -- Success: they're already deleted
    return true;
  end if;

  -- Check the token
  if (
    -- token is still valid
    v_user_secret.delete_account_token_generated > now() - v_token_max_duration
  and
    -- token matches
    v_user_secret.delete_account_token = token
  ) then
    -- Token passes; delete their account :(
    delete from app_public.users where id = app_public.current_user_id();
    return true;
  end if;

  raise exception 'The supplied token was incorrect - perhaps you''re logged in to the wrong account, or the token has expired?' using errcode = 'DNIED';
end;
$$ language plpgsql strict volatile security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.confirm_account_deletion(token text) is
  E'If you''re certain you want to delete your account, use `requestAccountDeletion` to request an account deletion token, and then supply the token through this mutation to complete account deletion.';
/*
 * To change your password you must specify your previous password. The form in
 * the web UI may confirm that the new password was typed correctly by making
 * the user type it twice, but that isn't necessary in the API.
 */

create function app_public.change_password(old_password text, new_password text) returns boolean as $$
declare
  v_user app_public.users;
  v_user_secret app_private.user_secrets;
begin
  select users.* into v_user
  from app_public.users
  where id = app_public.current_user_id();

  if v_user is null then
    raise exception 'You must log in to change your password' using errcode = 'LOGIN';
  end if;

  -- Load their secrets
  select * into v_user_secret from app_private.user_secrets
  where user_secrets.user_id = v_user.id;

  if v_user_secret.password_hash != crypt(old_password, v_user_secret.password_hash) then
    raise exception 'Incorrect password' using errcode = 'CREDS';
  end if;
  -- perform app_private.assert_valid_password(new_password);

  -- Reset the password as requested
  update app_private.user_secrets
  set
    password_hash = crypt(new_password, gen_salt('bf'))
  where user_secrets.user_id = v_user.id;

  -- Revoke all other sessions
  delete from app_private.sessions
  where sessions.user_id = v_user.id
  and sessions.uuid <> app_public.current_session_id();

  -- Notify user their password was changed
  perform graphile_worker.add_job(
    'user__audit',
    json_build_object(
      'type', 'change_password',
      'user_id', v_user.id,
      'current_user_id', app_public.current_user_id()
    ));

  return true;
end;
$$ language plpgsql strict volatile security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.change_password(old_password text, new_password text) is
  E'Enter your old password and a new password to change your password.';

grant execute on function app_public.change_password(text, text) to :DATABASE_VISITOR;
/*
 * A user account may be created explicitly via the GraphQL `register` mutation
 * (which calls `really_create_user` below), or via OAuth (which, via
 * `installPassportStrategy.ts`, calls link_or_register_user below, which may
 * then call really_create_user). Ultimately `really_create_user` is called in
 * all cases to create a user account within our system, so it must do
 * everything we'd expect in this case including validating username/password,
 * setting the password (if any), storing the email address, etc.
 */

create function app_private.really_create_user(
  username citext,
  name text,
  avatar_url text,
  email_is_verified bool,
  email text default null,
  password text default null
) returns app_public.users as $$
declare
  v_user app_public.users;
  v_username citext = username;
begin
  -- if password is not null then
  --   perform app_private.assert_valid_password(password);
  -- end if;
  -- if email is null then
  --   raise exception 'Email is required' using errcode = 'MODAT';
  -- end if;

  -- Insert the new user
  insert into app_public.users (username, name, avatar_url) values
    (v_username, name, avatar_url)
    returning * into v_user;

  -- Add the user's email
  if email is not null then
    insert into app_public.user_emails (user_id, email, is_verified, is_primary) values
      (v_user.id, email, email_is_verified, email_is_verified);
  end if;

  -- Store the password
  if password is not null then
    update app_private.user_secrets
    set password_hash = crypt(password, gen_salt('bf'))
    where user_id = v_user.id;
  end if;

  -- Refresh the user
  select * into v_user from app_public.users where id = v_user.id;

  return v_user;
end;
$$ language plpgsql volatile set search_path to pg_catalog, public, pg_temp;

comment on function app_private.really_create_user(username citext, name text, avatar_url text, email_is_verified bool, email text, password text) is
  E'Creates a user account. All arguments are optional, it trusts the calling method to perform sanitisation.';

/**********/

/*
 * The `register_user` function is called by `link_or_register_user` when there
 * is no matching user to link the login to, so we want to register the user
 * using OAuth or similar credentials.
 */

create function app_private.register_user(
  f_service character varying,
  f_identifier character varying,
  f_profile json,
  f_auth_details json,
  f_email_is_verified boolean default false
) returns app_public.users as $$
declare
  v_user app_public.users;
  v_email citext;
  v_name text;
  v_username citext;
  v_avatar_url text;
  v_user_authentication_id uuid;
begin
  -- Extract data from the user’s OAuth profile data.
  v_email := f_profile ->> 'email';
  v_name := f_profile ->> 'name';
  v_username := f_profile ->> 'username';
  v_avatar_url := f_profile ->> 'avatar_url';

  -- Sanitise the username, and make it unique if necessary.
  if v_username is null then
    v_username = coalesce(v_name, 'user');
  end if;
  v_username = regexp_replace(v_username, '^[^a-z]+', '', 'gi');
  v_username = regexp_replace(v_username, '[^a-z0-9]+', '_', 'gi');
  if v_username is null or length(v_username) < 3 then
    v_username = 'user';
  end if;
  select (
    case
    when i = 0 then v_username
    else v_username || i::text
    end
  ) into v_username from generate_series(0, 1000) i
  where not exists(
    select 1
    from app_public.users
    where users.username = (
      case
      when i = 0 then v_username
      else v_username || i::text
      end
    )
  )
  limit 1;

  -- Create the user account
  v_user = app_private.really_create_user(
    username => v_username,
    email => v_email,
    email_is_verified => f_email_is_verified,
    name => v_name,
    avatar_url => v_avatar_url
  );

  -- Insert the user’s private account data (e.g. OAuth tokens)
  insert into app_public.user_authentications (user_id, service, identifier, details) values
    (v_user.id, f_service, f_identifier, f_profile) returning id into v_user_authentication_id;
  insert into app_private.user_authentication_secrets (user_authentication_id, details) values
    (v_user_authentication_id, f_auth_details);

  return v_user;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_private.register_user(f_service character varying, f_identifier character varying, f_profile json, f_auth_details json, f_email_is_verified boolean) is
  E'Used to register a user from information gleaned from OAuth. Primarily used by link_or_register_user';

/**********/

/*
 * The `link_or_register_user` function is called from
 * `installPassportStrategy.ts` when a user logs in with a social login
 * provider (OAuth), e.g. GitHub, Facebook, etc. If the user is already logged
 * in then the new provider will be linked to the users account, otherwise we
 * will try to retrieve an existing account using these details (matching the
 * service/identifier or the email address), and failing that we will register
 * a new user account linked to this service via the `register_user` function.
 *
 * This function is also responsible for keeping details in sync with the login
 * provider whenever the user logs in; you'll see this in the `update`
 * statemets towards the bottom of the function.
 */

create function app_private.link_or_register_user(
  f_user_id uuid,
  f_service character varying,
  f_identifier character varying,
  f_profile json,
  f_auth_details json
) returns app_public.users as $$
declare
  v_matched_user_id uuid;
  v_matched_authentication_id uuid;
  v_email citext;
  v_name text;
  v_avatar_url text;
  v_user app_public.users;
  v_user_email app_public.user_emails;
begin
  -- See if a user account already matches these details
  select id, user_id
    into v_matched_authentication_id, v_matched_user_id
    from app_public.user_authentications
    where service = f_service
    and identifier = f_identifier
    limit 1;

  if v_matched_user_id is not null and f_user_id is not null and v_matched_user_id <> f_user_id then
    raise exception 'A different user already has this account linked.' using errcode = 'TAKEN';
  end if;

  v_email = f_profile ->> 'email';
  v_name := f_profile ->> 'name';
  v_avatar_url := f_profile ->> 'avatar_url';

  if v_matched_authentication_id is null then
    if f_user_id is not null then
      -- Link new account to logged in user account
      insert into app_public.user_authentications (user_id, service, identifier, details) values
        (f_user_id, f_service, f_identifier, f_profile) returning id, user_id into v_matched_authentication_id, v_matched_user_id;
      insert into app_private.user_authentication_secrets (user_authentication_id, details) values
        (v_matched_authentication_id, f_auth_details);
      perform graphile_worker.add_job(
        'user__audit',
        json_build_object(
          'type', 'linked_account',
          'user_id', f_user_id,
          'extra1', f_service,
          'extra2', f_identifier,
          'current_user_id', app_public.current_user_id()
        ));
    elsif v_email is not null then
      -- See if the email is registered
      select * into v_user_email from app_public.user_emails where email = v_email and is_verified is true;
      if v_user_email is not null then
        -- User exists!
        insert into app_public.user_authentications (user_id, service, identifier, details) values
          (v_user_email.user_id, f_service, f_identifier, f_profile) returning id, user_id into v_matched_authentication_id, v_matched_user_id;
        insert into app_private.user_authentication_secrets (user_authentication_id, details) values
          (v_matched_authentication_id, f_auth_details);
        perform graphile_worker.add_job(
          'user__audit',
          json_build_object(
            'type', 'linked_account',
            'user_id', f_user_id,
            'extra1', f_service,
            'extra2', f_identifier,
            'current_user_id', app_public.current_user_id()
          ));
      end if;
    end if;
  end if;

  if v_matched_user_id is null and f_user_id is null and v_matched_authentication_id is null then
    -- Create and return a new user account
    return app_private.register_user(f_service, f_identifier, f_profile, f_auth_details, true);
  end if;

  if v_matched_authentication_id is null then
    -- v_matched_authentication_id is null
    -- -> v_matched_user_id is null (they're paired)
    -- -> f_user_id is not null (because the if clause above)
    -- -> v_matched_authentication_id is not null (because of the separate if block above creating a user_authentications)
    -- -> contradiction.
    raise exception 'This should not occur';
  end if;

  update app_public.user_authentications
    set details = f_profile
    where id = v_matched_authentication_id;
  update app_private.user_authentication_secrets
    set details = f_auth_details
    where user_authentication_id = v_matched_authentication_id;
  update app_public.users
    set
      name = coalesce(users.name, v_name),
      avatar_url = coalesce(users.avatar_url, v_avatar_url)
    where id = v_matched_user_id
    returning  * into v_user;
  return v_user;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_private.link_or_register_user(f_user_id uuid, f_service character varying, f_identifier character varying, f_profile json, f_auth_details json) is
  E'If you''re logged in, this will link an additional OAuth login to your account if necessary. If you''re logged out it may find if an account already exists (based on OAuth details or email address) and return that, or create a new user account if necessary.';
/*
 * The user is only allowed to have one primary email, and that email must be
 * verified. This function lets the user change which of their verified emails
 * is the primary email.
 */

create function app_public.make_email_primary(email_id uuid) returns app_public.user_emails as $$
declare
  v_user_email app_public.user_emails;
begin
  select * into v_user_email from app_public.user_emails where id = email_id and user_id = app_public.current_user_id();
  if v_user_email is null then
    raise exception 'That''s not your email' using errcode = 'DNIED';
    return null;
  end if;
  if v_user_email.is_verified is false then
    raise exception 'You may not make an unverified email primary' using errcode = 'VRFY1';
  end if;
  update app_public.user_emails set is_primary = false where user_id = app_public.current_user_id() and is_primary is true and id <> email_id;
  update app_public.user_emails set is_primary = true where user_id = app_public.current_user_id() and is_primary is not true and id = email_id returning * into v_user_email;
  return v_user_email;
end;
$$ language plpgsql strict volatile security definer set search_path to pg_catalog, public, pg_temp;
comment on function app_public.make_email_primary(email_id uuid) is
  E'Your primary email is where we''ll notify of account events; other emails may be used for discovery or login. Use this when you''re changing your email address.';
/*
 * If you don't receive the email verification email, you can trigger a resend
 * with this function.
 */
create function app_public.resend_email_verification_code(email_id uuid) returns boolean as $$
begin
  if exists(
    select 1
    from app_public.user_emails
    where user_emails.id = email_id
    and user_id = app_public.current_user_id()
    and is_verified is false
  ) then
    perform graphile_worker.add_job('user_emails__send_verification', json_build_object('id', email_id));
    return true;
  end if;
  return false;
end;
$$ language plpgsql strict volatile security definer set search_path to pg_catalog, public, pg_temp;
comment on function app_public.resend_email_verification_code(email_id uuid) is
  E'If you didn''t receive the verification code for this email, we can resend it. We silently cap the rate of resends on the backend, so calls to this function may not result in another email being sent if it has been called recently.';

--! split: 0180-bands.sql
drop function if exists app_public.transfer_band_ownership(uuid, uuid);
drop function if exists app_public.delete_band(uuid);
drop function if exists app_public.remove_from_band(uuid, uuid);
drop function if exists app_public.bands_current_user_is_owner(app_public.bands);
drop function if exists app_public.decline_invitation_to_band(uuid) cascade;
drop function if exists app_public.my_band_invitations() cascade;
drop function if exists app_public.accept_invitation_to_band(uuid, text) cascade;
drop function if exists app_public.get_band_for_invitation(uuid, text) cascade;
drop function if exists app_public.band_for_invitation(uuid, text) cascade;
drop function if exists app_public.invite_user_to_band(uuid, uuid) cascade;
drop function if exists app_public.invite_to_band(uuid, citext, citext) cascade;
drop function if exists app_public.current_user_invited_band_ids() cascade;
drop function if exists app_public.current_user_member_band_ids() cascade;
drop table if exists app_public.band_invitations;
drop table if exists app_public.band_memberships;
drop table if exists app_public.bands cascade;

--------------------------------------------------------------------------------

create table app_public.bands (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);
alter table app_public.bands enable row level security;

grant select on app_public.bands to :DATABASE_VISITOR;
grant update(name, slug) on app_public.bands to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create table app_public.band_memberships (
  id uuid primary key default gen_random_uuid(),
  band_id uuid not null references app_public.bands on delete cascade,
  user_id uuid not null references app_public.users on delete cascade,
  is_owner boolean not null default false,
  created_at timestamptz not null default now(),
  unique (band_id, user_id)
);
alter table app_public.band_memberships enable row level security;

create index on app_public.band_memberships (user_id);

grant select on app_public.band_memberships to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create table app_public.band_invitations (
  id uuid primary key default gen_random_uuid(),
  band_id uuid not null references app_public.bands on delete cascade,
  code text,
  user_id uuid references app_public.users on delete cascade,
  email citext,
  check ((user_id is null) <> (email is null)),
  check ((code is null) = (email is null)),
  unique (band_id, user_id),
  unique (band_id, email)
);
alter table app_public.band_invitations enable row level security;

create index on app_public.band_invitations(user_id);
-- grant select on app_public.band_invitations to :DATABASE_VISITOR;

--------------------------------------------------------------------------------
create function app_public.current_user_member_band_ids() returns setof uuid as $$
  select band_id from app_public.band_memberships
    where user_id = app_public.current_user_id();
$$ language sql stable security definer set search_path = pg_catalog, public, pg_temp;

create function app_public.current_user_invited_band_ids() returns setof uuid as $$
  select band_id from app_public.band_invitations
    where user_id = app_public.current_user_id();
$$ language sql stable security definer set search_path = pg_catalog, public, pg_temp;

create policy select_member on app_public.bands
  for select using (id in (select app_public.current_user_member_band_ids()));

create policy select_invited on app_public.bands
  for select using (id in (select app_public.current_user_invited_band_ids()));

create policy select_member on app_public.band_memberships
  for select using (band_id in (select app_public.current_user_member_band_ids()));

create policy select_invited on app_public.band_memberships
  for select using (band_id in (select app_public.current_user_invited_band_ids()));

--------------------------------------------------------------------------------
create function app_public.create_band(slug citext, name text) returns app_public.bands as $$
declare
  v_band app_public.bands;
begin
  insert into app_public.bands (slug, name) values (slug, name) returning * into v_band;
  insert into app_public.band_memberships (band_id, user_id, is_owner)
    values(v_band.id, app_public.current_user_id(), true);
  return v_band;
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp;

create function app_public.invite_to_band(band_id uuid, username citext = null, email citext = null)
  returns void as $$
declare
  v_code text;
  v_user app_public.users;
begin
  -- Are we allowed to add this person
  -- Are we logged in
  if app_public.current_user_id() is null then
    raise exception 'You must log in to invite a user' using errcode = 'LOGIN';
  end if;

  select * into v_user from app_public.users where users.username = invite_to_band.username;

  -- Are we the owner of this band
  if not exists(
    select 1 from app_public.band_memberships
      where band_memberships.band_id = invite_to_band.band_id
      and band_memberships.user_id = app_public.current_user_id()
      and is_owner is true
  ) then
    raise exception 'You''re not the owner of this band' using errcode = 'DNIED';
  end if;

  if v_user.id is not null and exists(
    select 1 from app_public.band_memberships
      where band_memberships.band_id = invite_to_band.band_id
      and band_memberships.user_id = v_user.id
  ) then
    raise exception 'Cannot invite someone who is already a member' using errcode = 'ISMBR';
  end if;

  if email is not null then
    v_code = encode(gen_random_bytes(7), 'hex');
  end if;

  if v_user.id is not null and not v_user.is_verified then
    raise exception 'The user you attempted to invite has not verified their account' using errcode = 'VRFY2';
  end if;

  if v_user.id is null and email is null then
    raise exception 'Could not find person to invite' using errcode = 'NTFND';
  end if;

  -- Invite the user
  insert into app_public.band_invitations(band_id, user_id, email, code)
    values (invite_to_band.band_id, v_user.id, email, v_code);
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp;

create function app_public.band_for_invitation(invitation_id uuid, code text = null)
  returns app_public.bands as $$
declare
  v_invitation app_public.band_invitations;
  v_band app_public.bands;
begin
  if app_public.current_user_id() is null then
    raise exception 'You must log in to accept an invitation' using errcode = 'LOGIN';
  end if;

  select * into v_invitation from app_public.band_invitations where id = invitation_id;

  if v_invitation is null then
    raise exception 'We could not find that invitation' using errcode = 'NTFND';
  end if;

  if v_invitation.user_id is not null then
    if v_invitation.user_id is distinct from app_public.current_user_id() then
      raise exception 'That invitation is not for you' using errcode = 'DNIED';
    end if;
  else
    if v_invitation.code is distinct from code then
      raise exception 'Incorrect invitation code' using errcode = 'DNIED';
    end if;
  end if;

  select * into v_band from app_public.bands where id = v_invitation.band_id;

  return v_band;
end;
$$ language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp;

create function app_public.accept_invitation_to_band(invitation_id uuid, code text = null)
  returns void as $$
declare
  v_band app_public.bands;
begin
  v_band = app_public.band_for_invitation(invitation_id, code);

  -- Accept the user into the band
  insert into app_public.band_memberships (band_id, user_id)
    values(v_band.id, app_public.current_user_id())
    on conflict do nothing;

  -- Delete the invitation
  delete from app_public.band_invitations where id = invitation_id;
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp;

-- The invitations addressed to the current user. The visitor role cannot select
-- band_invitations (an invitation by email carries a secret code), so the user
-- reads their own through this function, which never returns the code.
create function app_public.my_band_invitations()
  returns table (id uuid, band_id uuid, band_name text) as $$
  select invitation.id, invitation.band_id, band.name
  from app_public.band_invitations as invitation
  join app_public.bands as band on band.id = invitation.band_id
  where invitation.user_id = app_public.current_user_id()
  order by band.name
$$ language sql stable security definer set search_path = pg_catalog, public, pg_temp;

create function app_public.decline_invitation_to_band(invitation_id uuid)
  returns void as $$
  delete from app_public.band_invitations
    where id = invitation_id and user_id = app_public.current_user_id();
$$ language sql volatile security definer set search_path = pg_catalog, public, pg_temp;

--------------------------------------------------------------------------------

create trigger _500_send_email after insert on app_public.band_invitations
  for each row execute procedure app_private.tg__add_job('band_invitations__send_invite');

--------------------------------------------------------------------------------

create function app_public.bands_current_user_is_owner(
  band app_public.bands
) returns boolean as $$
  select exists(
    select 1
    from app_public.band_memberships
    where band_id = band.id
    and user_id = app_public.current_user_id()
    and is_owner is true
  )
$$ language sql stable;

create policy update_owner on app_public.bands for update using (exists(
  select 1
  from app_public.band_memberships
  where band_id = bands.id
  and user_id = app_public.current_user_id()
  and is_owner is true
));

create function app_public.remove_from_band(
  band_id uuid,
  user_id uuid
) returns void as $$
declare
  v_my_membership app_public.band_memberships;
begin
  select * into v_my_membership
    from app_public.band_memberships
    where band_memberships.band_id = remove_from_band.band_id
    and band_memberships.user_id = app_public.current_user_id();

  if (v_my_membership is null) then
    -- I'm not a member of that band
    return;
  elsif v_my_membership.is_owner then
    if remove_from_band.user_id <> app_public.current_user_id() then
      -- Delete it
    else
      -- Need to transfer ownership before I can leave
      return;
    end if;
  elsif v_my_membership.user_id = user_id then
    -- Delete it
  else
    -- Not allowed to delete it
    return;
  end if;

  delete from app_public.band_memberships
    where band_memberships.band_id = remove_from_band.band_id
    and band_memberships.user_id = remove_from_band.user_id;

end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

--------------------------------------------------------------------------------

create function app_public.tg_users__deletion_band_checks_and_actions() returns trigger as $$
begin
  -- Check they're not a band owner
  if exists(
    select 1
    from app_public.band_memberships
    where user_id = app_public.current_user_id()
    and is_owner is true
  ) then
    raise exception 'You cannot delete your account until you are not the owner of any bands.' using errcode = 'OWNER';
  end if;

  return old;
end;
$$ language plpgsql;

create trigger _500_deletion_band_checks_and_actions
  before delete
  on app_public.users
  for each row
  when (app_public.current_user_id() is not null)
  execute procedure app_public.tg_users__deletion_band_checks_and_actions();

create function app_public.delete_band(band_id uuid) returns void as $$
begin
  if exists(
    select 1
    from app_public.band_memberships
    where user_id = app_public.current_user_id()
    and band_memberships.band_id = delete_band.band_id
    and is_owner is true
  ) then
    delete from app_public.bands where id = band_id;
  end if;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

create function app_public.transfer_band_ownership(band_id uuid, user_id uuid) returns app_public.bands as $$
declare
 v_band app_public.bands;
begin
  if exists(
    select 1
    from app_public.band_memberships
    where band_memberships.user_id = app_public.current_user_id()
    and band_memberships.band_id = transfer_band_ownership.band_id
    and is_owner is true
  ) then
    update app_public.band_memberships
      set is_owner = true
      where band_memberships.band_id = transfer_band_ownership.band_id
      and band_memberships.user_id = transfer_band_ownership.user_id;
    if found then
      update app_public.band_memberships
        set is_owner = false
        where band_memberships.band_id = transfer_band_ownership.band_id
        and band_memberships.user_id = app_public.current_user_id();

      select * into v_band from app_public.bands where id = band_id;
      return v_band;
    end if;
  end if;
  return null;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

--! split: 0200-songs.sql
/*
 * Songs belong to a band. Each song has rich metadata that
 * can be overridden per-setlist entry.
 *
 * Musical keys use a text type with a check constraint rather than an enum,
 * since enums are painful to extend in PostgreSQL.
 */

create domain app_public.musical_key as text check (
  value in (
    'C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb',
    'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B',
    'Cm', 'C#m', 'Dbm', 'Dm', 'D#m', 'Ebm', 'Em', 'Fm', 'F#m', 'Gbm',
    'Gm', 'G#m', 'Abm', 'Am', 'A#m', 'Bbm', 'Bm'
  )
);
comment on domain app_public.musical_key is
  E'A musical key, e.g. ''C'', ''F#m'', ''Bb''. Major keys are bare, minor keys have an ''m'' suffix.';

create table app_public.songs (
  id uuid primary key default gen_random_uuid(),
  band_id uuid not null references app_public.bands on delete cascade,
  title text not null check (length(title) > 0 and length(title) <= 500),
  artist text check (length(artist) <= 500),
  key app_public.musical_key,
  tempo_bpm int check (tempo_bpm > 0 and tempo_bpm <= 999),
  duration_seconds int check (duration_seconds > 0 and duration_seconds <= 86400),
  capo int check (capo >= 0 and capo <= 12),
  notes text check (length(notes) <= 10000),
  created_by uuid default app_public.current_user_id() references app_public.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table app_public.songs enable row level security;

create index idx_songs_band on app_public.songs (band_id);
create index idx_songs_title on app_public.songs (band_id, title);

create trigger _100_timestamps
  before insert or update on app_public.songs
  for each row
  execute procedure app_private.tg__timestamps();

comment on table app_public.songs is
  E'A song in a band''s catalog. Contains default metadata that can be overridden per-setlist.';
comment on column app_public.songs.key is
  E'Default musical key for this song.';
comment on column app_public.songs.tempo_bpm is
  E'Default tempo in beats per minute.';
comment on column app_public.songs.duration_seconds is
  E'Estimated duration in seconds.';
comment on column app_public.songs.capo is
  E'Default capo position (0 = no capo).';
comment on column app_public.songs.notes is
  E'Freeform notes about the song (chords, arrangement, etc).';

-- Songs are visible to all members of the band.
create policy select_member on app_public.songs
  for select using (band_id in (select app_public.current_user_member_band_ids()));

-- Any member can create songs.
create policy insert_member on app_public.songs
  for insert with check (band_id in (select app_public.current_user_member_band_ids()));

-- Any member can update songs.
create policy update_member on app_public.songs
  for update using (band_id in (select app_public.current_user_member_band_ids()));

-- Any member can delete songs.
create policy delete_member on app_public.songs
  for delete using (band_id in (select app_public.current_user_member_band_ids()));

grant select on app_public.songs to :DATABASE_VISITOR;
grant insert (band_id, title, artist, key, tempo_bpm, duration_seconds, capo, notes, created_by) on app_public.songs to :DATABASE_VISITOR;
grant update (title, artist, key, tempo_bpm, duration_seconds, capo, notes) on app_public.songs to :DATABASE_VISITOR;
grant delete on app_public.songs to :DATABASE_VISITOR;

--! split: 0210-setlists.sql
/*
 * A setlist is a named, ordered list of songs ("Standard 60", "Acoustic").
 * It belongs to a band. A gig plays one or more setlists in order (see
 * 0220-gigs.sql), and one setlist can serve many gigs, so the setlist holds
 * no venue or date of its own.
 *
 * Workflow: draft → rehearsal → final
 *   - draft: being built, not ready
 *   - rehearsal: locked in for practice
 *   - final: the version the band plays
 */

create type app_public.setlist_status as enum ('draft', 'rehearsal', 'final');

create table app_public.setlists (
  id uuid primary key default gen_random_uuid(),
  band_id uuid not null references app_public.bands on delete cascade,
  name text not null check (length(name) between 1 and 200),
  status app_public.setlist_status not null default 'draft',
  created_by uuid references app_public.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The target of gig_setlists' foreign key, which keeps a gig and its setlists in one band.
  unique (band_id, id)
);
alter table app_public.setlists enable row level security;

create index idx_setlists_band on app_public.setlists (band_id, name);

create trigger _100_timestamps
  before insert or update on app_public.setlists
  for each row
  execute procedure app_private.tg__timestamps();

comment on table app_public.setlists is
  E'A named, ordered list of songs. Gigs play setlists; one setlist can serve many gigs.';
comment on column app_public.setlists.status is
  E'Workflow status: draft → rehearsal → final.';

create policy select_member on app_public.setlists
  for select using (band_id in (select app_public.current_user_member_band_ids()));
create policy insert_member on app_public.setlists
  for insert with check (band_id in (select app_public.current_user_member_band_ids()));
create policy update_member on app_public.setlists
  for update using (band_id in (select app_public.current_user_member_band_ids()));
create policy delete_member on app_public.setlists
  for delete using (band_id in (select app_public.current_user_member_band_ids()));

grant select on app_public.setlists to :DATABASE_VISITOR;
grant insert (band_id, name, status) on app_public.setlists to :DATABASE_VISITOR;
grant update (name, status) on app_public.setlists to :DATABASE_VISITOR;
grant delete on app_public.setlists to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

/*
 * Setlist entries are the songs in a setlist, in order. An entry can override
 * the song's key, tempo and notes for this setlist only.
 *
 * `position_key` is a sortable text key (base-62, collation "C"), so moving
 * one entry writes one row: the server picks a key between the new
 * neighbours' keys, and renumbers the setlist when a key grows long.
 */

create table app_public.setlist_entries (
  id uuid primary key default gen_random_uuid(),
  setlist_id uuid not null references app_public.setlists on delete cascade,
  song_id uuid not null references app_public.songs on delete cascade,
  position_key text collate "C" not null,
  -- Per-entry overrides (null = inherit from song)
  key_override app_public.musical_key,
  tempo_override int check (tempo_override > 0 and tempo_override <= 999),
  notes_override text check (length(notes_override) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table app_public.setlist_entries enable row level security;

create index idx_setlist_entries_setlist on app_public.setlist_entries (setlist_id, position_key);
create index idx_setlist_entries_song on app_public.setlist_entries (song_id);

create trigger _100_timestamps
  before insert or update on app_public.setlist_entries
  for each row
  execute procedure app_private.tg__timestamps();

comment on table app_public.setlist_entries is
  E'A song placed in a setlist. May override the song''s default key, tempo, and notes for this setlist.';
comment on column app_public.setlist_entries.key_override is
  E'Override the song''s default key for this setlist. Null = use song default.';
comment on column app_public.setlist_entries.tempo_override is
  E'Override the song''s default tempo for this setlist. Null = use song default.';
comment on column app_public.setlist_entries.notes_override is
  E'Override the song''s default notes for this setlist. Null = use song default.';
comment on column app_public.setlist_entries.position_key is
  E'Sortable key for the entry''s place in the setlist; read in order of (position_key, id).';

-- RLS: accessible if the parent setlist is accessible.
create policy select_member on app_public.setlist_entries
  for select using (exists (
    select 1 from app_public.setlists
    where setlists.id = setlist_entries.setlist_id
    and setlists.band_id in (select app_public.current_user_member_band_ids())
  ));
create policy insert_member on app_public.setlist_entries
  for insert with check (exists (
    select 1 from app_public.setlists
    where setlists.id = setlist_entries.setlist_id
    and setlists.band_id in (select app_public.current_user_member_band_ids())
  ));
create policy update_member on app_public.setlist_entries
  for update using (exists (
    select 1 from app_public.setlists
    where setlists.id = setlist_entries.setlist_id
    and setlists.band_id in (select app_public.current_user_member_band_ids())
  ));
create policy delete_member on app_public.setlist_entries
  for delete using (exists (
    select 1 from app_public.setlists
    where setlists.id = setlist_entries.setlist_id
    and setlists.band_id in (select app_public.current_user_member_band_ids())
  ));

grant select on app_public.setlist_entries to :DATABASE_VISITOR;
grant insert (setlist_id, song_id, position_key, key_override, tempo_override, notes_override) on app_public.setlist_entries to :DATABASE_VISITOR;
grant update (position_key, key_override, tempo_override, notes_override) on app_public.setlist_entries to :DATABASE_VISITOR;
grant delete on app_public.setlist_entries to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

/*
 * Convenience view: setlist entries with inherited song data + overrides applied.
 * Use this for reading setlists — it resolves inheritance so the client
 * doesn't have to.
 */

create view app_public.setlist_entries_resolved as
  select
    e.id,
    e.setlist_id,
    e.song_id,
    e.position_key,
    s.title,
    s.artist,
    coalesce(e.key_override, s.key) as key,
    coalesce(e.tempo_override, s.tempo_bpm) as tempo_bpm,
    coalesce(e.notes_override, s.notes) as notes,
    s.duration_seconds,
    s.capo,
    e.key_override is not null as key_overridden,
    e.tempo_override is not null as tempo_overridden,
    e.notes_override is not null as notes_overridden,
    e.created_at,
    e.updated_at
  from app_public.setlist_entries e
  join app_public.songs s on s.id = e.song_id;

-- A view runs with its owner's rights, which skips RLS on the tables it reads.
-- With security_invoker the caller's policies on setlist_entries and songs apply.
alter view app_public.setlist_entries_resolved set (security_invoker = true);

comment on view app_public.setlist_entries_resolved is
  E'Setlist entries with song defaults resolved — overrides take precedence, nulls fall through to the song''s values.';

grant select on app_public.setlist_entries_resolved to :DATABASE_VISITOR;

--! split: 0220-gigs.sql
/*
 * A gig is one performance: where, when, and which setlists the band plays,
 * in order (Set 1, Set 2, Encore). A gig has no name: the app labels it by its
 * venue, or by its date when it has none, so a band never keeps a title in
 * step with the gig.
 *
 * The venue and date are public on the band's page when it lists gig dates.
 * The address, the times and the notes stay private to the band. The times
 * are wall-clock times at the venue on the gig date (`time` without a time
 * zone, read with `gig_date`), so no time zone is stored.
 */

create table app_public.gigs (
  id uuid primary key default gen_random_uuid(),
  band_id uuid not null references app_public.bands on delete cascade,
  venue text check (length(venue) between 1 and 200),
  gig_date date,
  address text check (length(address) <= 1000),
  load_in_time time,
  performance_time time,
  notes text check (length(notes) <= 5000),
  created_by uuid references app_public.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The target of gig_setlists' foreign key, which keeps a gig and its setlists in one band.
  unique (band_id, id)
);
alter table app_public.gigs enable row level security;

create index idx_gigs_band_date on app_public.gigs (band_id, gig_date desc nulls last);

create trigger _100_timestamps
  before insert or update on app_public.gigs
  for each row
  execute procedure app_private.tg__timestamps();

comment on table app_public.gigs is
  E'One performance by a band: venue, date, times, and the setlists it plays in order.';
comment on column app_public.gigs.venue is
  E'Where the gig is; the gig''s label, and public with the date.';
comment on column app_public.gigs.address is
  E'The venue address, as the band would paste into a map.';
comment on column app_public.gigs.load_in_time is
  E'When the band must arrive and load in, as a wall-clock time at the venue on the gig date.';
comment on column app_public.gigs.performance_time is
  E'When the performance starts, as a wall-clock time at the venue on the gig date.';
comment on column app_public.gigs.notes is
  E'Notes for the band only.';

create policy select_member on app_public.gigs
  for select using (band_id in (select app_public.current_user_member_band_ids()));
create policy insert_member on app_public.gigs
  for insert with check (band_id in (select app_public.current_user_member_band_ids()));
create policy update_member on app_public.gigs
  for update using (band_id in (select app_public.current_user_member_band_ids()));
create policy delete_member on app_public.gigs
  for delete using (band_id in (select app_public.current_user_member_band_ids()));

grant select on app_public.gigs to :DATABASE_VISITOR;
grant insert (band_id, venue, gig_date, address, load_in_time, performance_time, notes) on app_public.gigs to :DATABASE_VISITOR;
grant update (venue, gig_date, address, load_in_time, performance_time, notes) on app_public.gigs to :DATABASE_VISITOR;
grant delete on app_public.gigs to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

/*
 * The setlists a gig plays, in order. A gig plays a setlist at most once.
 * `band_id` is in both foreign keys, so a gig can only play its own band's
 * setlists, and a row that changes its `setlist_id` (a gig that plays its own
 * copy in the original's place) stays in the band. Deleting a gig or a
 * setlist removes the row; the other side stays.
 */

create table app_public.gig_setlists (
  band_id uuid not null,
  gig_id uuid not null,
  setlist_id uuid not null,
  position_key text collate "C" not null,
  primary key (gig_id, setlist_id),
  foreign key (band_id, gig_id) references app_public.gigs (band_id, id) on delete cascade,
  foreign key (band_id, setlist_id) references app_public.setlists (band_id, id) on delete cascade
);
alter table app_public.gig_setlists enable row level security;

create index idx_gig_setlists_order on app_public.gig_setlists (gig_id, position_key);
create index idx_gig_setlists_setlist on app_public.gig_setlists (setlist_id);

comment on table app_public.gig_setlists is
  E'The setlists a gig plays, ordered by position_key (then setlist_id).';

create policy select_member on app_public.gig_setlists
  for select using (band_id in (select app_public.current_user_member_band_ids()));
create policy insert_member on app_public.gig_setlists
  for insert with check (band_id in (select app_public.current_user_member_band_ids()));
create policy update_member on app_public.gig_setlists
  for update using (band_id in (select app_public.current_user_member_band_ids()));
create policy delete_member on app_public.gig_setlists
  for delete using (band_id in (select app_public.current_user_member_band_ids()));

grant select on app_public.gig_setlists to :DATABASE_VISITOR;
grant insert (band_id, gig_id, setlist_id, position_key) on app_public.gig_setlists to :DATABASE_VISITOR;
grant update (setlist_id, position_key) on app_public.gig_setlists to :DATABASE_VISITOR;
grant delete on app_public.gig_setlists to :DATABASE_VISITOR;

--! split: 0230-charts.sql
/*
 * A song has many charts (a lyrics chart, a Guitar Pro score, ...). A chart is
 * a chain of immutable revisions. A mark belongs to one user and is anchored to
 * a range in the revision it was made on; the app maps that range to later
 * revisions through each revision's change set (docs/adr/0001, 0002).
 */

create table app_public.charts (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references app_public.songs on delete cascade,
  kind text not null check (kind in ('lyrics', 'score')),
  name text not null check (length(name) between 1 and 200),
  written_key app_public.musical_key,
  created_by uuid default app_public.current_user_id() references app_public.users on delete set null,
  created_at timestamptz not null default now()
);
alter table app_public.charts enable row level security;
create index idx_charts_song on app_public.charts (song_id);

comment on table app_public.charts is
  E'One way to read a song: a lyrics chart or a score. Its content lives in chart_revisions.';
comment on column app_public.charts.written_key is
  E'The key a lyrics chart is written in. Display-time transposition starts here.';

-- A chart is visible and editable wherever its song is: the subquery runs under the songs policies.
create policy select_song_visible on app_public.charts
  for select using (exists (select 1 from app_public.songs s where s.id = song_id));
create policy insert_song_visible on app_public.charts
  for insert with check (exists (select 1 from app_public.songs s where s.id = song_id));
create policy update_song_visible on app_public.charts
  for update using (exists (select 1 from app_public.songs s where s.id = song_id));
create policy delete_song_visible on app_public.charts
  for delete using (exists (select 1 from app_public.songs s where s.id = song_id));

grant select, delete on app_public.charts to :DATABASE_VISITOR;
grant insert (song_id, kind, name, written_key) on app_public.charts to :DATABASE_VISITOR;
grant update (name, written_key) on app_public.charts to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

/*
 * Revisions are never updated: marks anchored to one must find the same
 * content forever. The current revision of a chart is its newest one.
 */
create table app_public.chart_revisions (
  id uuid primary key default gen_random_uuid(),
  chart_id uuid not null references app_public.charts on delete cascade,
  parent_id uuid references app_public.chart_revisions,
  source text check (length(source) <= 200000),
  file_key text,
  file_sha256 bytea,
  changes jsonb,
  created_by uuid default app_public.current_user_id() references app_public.users on delete set null,
  created_at timestamptz not null default now(),
  check ((source is null) <> (file_key is null)),
  check ((file_key is null) = (file_sha256 is null)),
  check (parent_id is not null or changes is null)
);
alter table app_public.chart_revisions enable row level security;
create index idx_chart_revisions_chart on app_public.chart_revisions (chart_id, created_at desc);

comment on table app_public.chart_revisions is
  E'One saved version of a chart. Immutable: an edit inserts a new revision.';
comment on column app_public.chart_revisions.source is
  E'ChordPro text of a lyrics chart. Players edit it as chords over lyrics; directives and alphaTex pass through as written.';
comment on column app_public.chart_revisions.file_key is
  E'Storage key of the uploaded Guitar Pro file of a score, kept byte for byte.';
comment on column app_public.chart_revisions.changes is
  E'The change set the editor recorded against the parent revision. Null when the revision came from outside the editor; the app then derives it by diffing.';

create policy select_chart_visible on app_public.chart_revisions
  for select using (exists (select 1 from app_public.charts c where c.id = chart_id));
create policy insert_chart_visible on app_public.chart_revisions
  for insert with check (exists (select 1 from app_public.charts c where c.id = chart_id));

grant select on app_public.chart_revisions to :DATABASE_VISITOR;
grant insert (chart_id, parent_id, source, file_key, file_sha256, changes)
  on app_public.chart_revisions to :DATABASE_VISITOR;

/*
 * Two rules that span tables, so a CHECK cannot state them: a revision holds
 * the content its chart's kind needs, and its parent is a revision of the same
 * chart.
 */
create function app_private.tg__chart_revision_matches_chart() returns trigger as $$
declare
  chart_kind text;
begin
  select kind into chart_kind from app_public.charts where id = new.chart_id;
  if (chart_kind = 'lyrics') <> (new.source is not null) then
    raise exception 'a % chart revision needs %', chart_kind,
      case chart_kind when 'lyrics' then 'source text' else 'a file' end
      using errcode = 'check_violation';
  end if;
  if new.parent_id is not null and not exists (
    select 1 from app_public.chart_revisions where id = new.parent_id and chart_id = new.chart_id
  ) then
    raise exception 'the parent revision belongs to another chart' using errcode = 'check_violation';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger _100_matches_chart
  before insert on app_public.chart_revisions
  for each row
  execute procedure app_private.tg__chart_revision_matches_chart();

--------------------------------------------------------------------------------

/*
 * A player's mark. `scope` names what the range counts: characters of the
 * lyrics chart's anchor text ({"kind":"chart"}) or beats of one voice
 * ({"kind":"voice","track":0,"staff":0,"voice":0}). Placement offsets and
 * scale are in em, so marks follow the chart's font size.
 */
create table app_public.marks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default app_public.current_user_id() references app_public.users on delete cascade,
  revision_id uuid not null references app_public.chart_revisions on delete cascade,
  scope jsonb not null,
  range_start int not null check (range_start >= 0),
  range_end int not null check (range_end > range_start),
  side text not null check (side in ('inline', 'margin')),
  dx real not null,
  dy real not null,
  scale real not null check (scale > 0),
  body jsonb not null,
  visibility text not null default 'private' check (visibility in ('private', 'band')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table app_public.marks enable row level security;
create index idx_marks_revision_user on app_public.marks (revision_id, user_id);
create index idx_marks_user on app_public.marks (user_id);

create trigger _100_timestamps
  before insert or update on app_public.marks
  for each row
  execute procedure app_private.tg__timestamps();

comment on table app_public.marks is
  E'A player''s ink, text or stamp copy, anchored to a range of one chart revision. Private unless visibility is band.';
comment on column app_public.marks.visibility is
  E'private: only the author sees it. band: bandmates can read it but not change it.';

-- Your own marks, plus marks bandmates chose to share, on charts you can see.
create policy select_own_or_shared on app_public.marks
  for select using (
    (user_id = app_public.current_user_id() or visibility = 'band')
    and exists (select 1 from app_public.chart_revisions r where r.id = revision_id)
  );
create policy insert_own on app_public.marks
  for insert with check (
    user_id = app_public.current_user_id()
    and exists (select 1 from app_public.chart_revisions r where r.id = revision_id)
  );
create policy update_own on app_public.marks
  for update using (user_id = app_public.current_user_id())
  with check (exists (select 1 from app_public.chart_revisions r where r.id = revision_id));
create policy delete_own on app_public.marks
  for delete using (user_id = app_public.current_user_id());

grant select, delete on app_public.marks to :DATABASE_VISITOR;
grant insert (revision_id, scope, range_start, range_end, side, dx, dy, scale, body, visibility)
  on app_public.marks to :DATABASE_VISITOR;
-- Moving a mark re-anchors it to the revision it was dropped on.
grant update (revision_id, scope, range_start, range_end, side, dx, dy, scale, body, visibility)
  on app_public.marks to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create table app_public.stamps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default app_public.current_user_id() references app_public.users on delete cascade,
  name text not null check (length(name) between 1 and 200),
  body jsonb not null,
  created_at timestamptz not null default now()
);
alter table app_public.stamps enable row level security;
create index idx_stamps_user on app_public.stamps (user_id);

comment on table app_public.stamps is
  E'A player''s saved mark body. Pasting a stamp copies its body into a new mark.';

create policy all_own on app_public.stamps
  for all using (user_id = app_public.current_user_id())
  with check (user_id = app_public.current_user_id());

grant select, delete on app_public.stamps to :DATABASE_VISITOR;
grant insert (name, body) on app_public.stamps to :DATABASE_VISITOR;
grant update (name, body) on app_public.stamps to :DATABASE_VISITOR;

--! split: 0240-scores.sql
/*
 * The bytes of a score revision: the Guitar Pro file a player uploaded, kept
 * unchanged (docs/adr/0002). They live in the database so one backup, one set
 * of row-level security policies and one transaction cover a score and its
 * revision. Revisions are immutable, so a file row is inserted once and never
 * updated.
 */

create table app_public.score_files (
  revision_id uuid primary key references app_public.chart_revisions on delete cascade,
  bytes bytea not null check (length(bytes) between 1 and 20971520)
);
alter table app_public.score_files enable row level security;

comment on table app_public.score_files is
  E'The uploaded Guitar Pro file of a score revision, byte for byte. Never re-exported.';
comment on column app_public.chart_revisions.file_key is
  E'Name of the uploaded Guitar Pro file of a score. The bytes are in score_files.';

-- A file is visible and insertable wherever its revision is.
create policy select_revision_visible on app_public.score_files
  for select using (exists (select 1 from app_public.chart_revisions r where r.id = revision_id));
create policy insert_revision_visible on app_public.score_files
  for insert with check (exists (select 1 from app_public.chart_revisions r where r.id = revision_id));

grant select on app_public.score_files to :DATABASE_VISITOR;
grant insert (revision_id, bytes) on app_public.score_files to :DATABASE_VISITOR;

/*
 * The stored bytes must be the bytes the revision's hash names, so a client
 * cannot attach a different file to a revision after the fact.
 */
create function app_private.tg__score_file_matches_revision() returns trigger as $$
declare
  expected bytea;
begin
  select file_sha256 into expected from app_public.chart_revisions where id = new.revision_id;
  if expected is null then
    raise exception 'no file revision with that id is visible to you' using errcode = 'check_violation';
  end if;
  if sha256(new.bytes) <> expected then
    raise exception 'the file does not match the revision''s sha256' using errcode = 'check_violation';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger _100_matches_revision
  before insert on app_public.score_files
  for each row
  execute procedure app_private.tg__score_file_matches_revision();

/*
 * The other direction: a revision that names a file must get its bytes before
 * the transaction commits. Deferred, because the revision is inserted first.
 */
create function app_private.tg__file_revision_has_bytes() returns trigger as $$
begin
  if not exists (select 1 from app_public.score_files where revision_id = new.id) then
    raise exception 'a file revision needs its bytes in score_files' using errcode = 'check_violation';
  end if;
  return null;
end;
$$ language plpgsql;

create constraint trigger _200_has_bytes
  after insert on app_public.chart_revisions
  deferrable initially deferred
  for each row
  when (new.file_key is not null)
  execute procedure app_private.tg__file_revision_has_bytes();

--! split: 0260-band-public-profile.sql
/*
 * A band's owner can turn on a public page at /b/:slug; it is off until they do.
 * The bands table stays member-scoped: signed-out visitors and other users read
 * a band only through the security definer functions below, which return
 * exactly the public fields and the lists the owner has turned on. An open
 * select policy on bands would let every query that trusts RLS (such as "my
 * bands") return every band.
 *
 * The page's look is a theme the band writes: one HTML document with theme
 * tags, plus the values the band chose for the options the theme declares
 * (docs/adr/0006). The browser fills the tags in and shows the result in a
 * sandboxed frame, so the database stores the theme as text and never runs it.
 */

drop function if exists app_public.public_band(citext);
drop function if exists app_public.public_band_members(citext);
drop function if exists app_public.public_band_gig_dates(citext);
drop function if exists app_public.public_band_songs(citext);

alter table app_public.bands
  add column if not exists is_public boolean not null default false,
  add column if not exists show_members_publicly boolean not null default false,
  add column if not exists show_gig_dates_publicly boolean not null default false,
  add column if not exists show_songs_publicly boolean not null default false,
  add column if not exists page_theme text
    check (length(page_theme) <= 200000),
  add column if not exists page_options jsonb not null default '{}'
    check (jsonb_typeof(page_options) = 'object');

comment on column app_public.bands.is_public is
  E'When true, anyone can open the band''s public page; when false, /b/:slug answers not found.';
comment on column app_public.bands.show_members_publicly is
  E'When true, the public band page lists members (username, name, avatar).';
comment on column app_public.bands.show_gig_dates_publicly is
  E'When true, the public band page lists upcoming gigs (venue + date only).';
comment on column app_public.bands.show_songs_publicly is
  E'When true, the public band page lists the band''s songs (title + artist only).';
comment on column app_public.bands.page_theme is
  E'The public page''s theme: an HTML document with theme tags. Null means the built-in Classic theme.';
comment on column app_public.bands.page_options is
  E'Values for the options the theme declares, keyed like "color:Accent"; an option with no value uses the theme''s default.';

grant update(
  description,
  is_public,
  show_members_publicly,
  show_gig_dates_publicly,
  show_songs_publicly,
  page_theme,
  page_options
) on app_public.bands to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create or replace function app_public.public_band(band_slug citext)
returns table (
  slug citext,
  name text,
  description text,
  page_theme text,
  page_options jsonb
) as $$
  select
    bands.slug,
    bands.name,
    bands.description,
    bands.page_theme,
    bands.page_options
  from app_public.bands
  where bands.slug = public_band.band_slug
    and bands.is_public;
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.public_band(citext) is
  E'The public fields of one band, for its public page; no row when the slug is unknown or the page is off.';

grant execute on function app_public.public_band(citext) to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create or replace function app_public.public_band_members(band_slug citext)
returns table (
  username app_public.username,
  name text,
  avatar_url text,
  is_owner boolean
) as $$
  select
    users.username,
    users.name,
    users.avatar_url::text,
    band_memberships.is_owner
  from app_public.band_memberships
  inner join app_public.users on users.id = band_memberships.user_id
  inner join app_public.bands on bands.id = band_memberships.band_id
  where bands.slug = public_band_members.band_slug
    and bands.is_public
    and bands.show_members_publicly
  order by band_memberships.is_owner desc, users.username asc;
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.public_band_members(citext) is
  E'Members of a band for its public page, or empty when the owner has not enabled that.';

grant execute on function app_public.public_band_members(citext) to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create or replace function app_public.public_band_gig_dates(band_slug citext)
returns table (
  venue text,
  gig_date date
) as $$
  select gigs.venue, gigs.gig_date
  from app_public.gigs
  inner join app_public.bands on bands.id = gigs.band_id
  where bands.slug = public_band_gig_dates.band_slug
    and bands.is_public
    and bands.show_gig_dates_publicly
    and gigs.gig_date >= current_date
  order by gigs.gig_date asc, gigs.venue asc nulls last;
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.public_band_gig_dates(citext) is
  E'Upcoming gig venues and dates for a band public page, or empty when disabled.';

grant execute on function app_public.public_band_gig_dates(citext) to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create or replace function app_public.public_band_songs(band_slug citext)
returns table (
  title text,
  artist text
) as $$
  select songs.title, songs.artist
  from app_public.songs
  inner join app_public.bands on bands.id = songs.band_id
  where bands.slug = public_band_songs.band_slug
    and bands.is_public
    and bands.show_songs_publicly
  order by lower(songs.title) asc, songs.id asc;
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.public_band_songs(citext) is
  E'Song titles and artists for a band public page, or empty when the owner has not enabled that.';

grant execute on function app_public.public_band_songs(citext) to :DATABASE_VISITOR;

--! split: 0270-user-public-profile.sql
/*
 * A user can turn on a public profile at /u/:username; it is off until they do
 * (docs/adr/0011). Signed-out visitors read a profile only through the security
 * definer functions below, which return exactly the public fields, and only
 * while the profile is on. The bio is Markdown (docs/adr/0010), sized like a
 * band's description so it has room for prose and pasted embed code.
 */

alter table app_public.users
  add column if not exists is_public boolean not null default false;

alter table app_public.users
  drop constraint if exists users_bio_check,
  add constraint users_bio_check check (length(bio) <= 10000);

comment on column app_public.users.is_public is
  E'When true, anyone can open the user''s public profile; when false, /u/:username answers not found.';
comment on column app_public.users.bio is
  E'A short public note about the user, written as Markdown; shown on the public profile while it is on.';

grant update(is_public) on app_public.users to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create or replace function app_public.public_user(handle citext)
returns table (
  username app_public.username,
  name text,
  bio text,
  avatar_url text
) as $$
  select
    users.username,
    users.name,
    users.bio,
    users.avatar_url::text
  from app_public.users
  where users.username = public_user.handle
    and users.is_public;
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.public_user(citext) is
  E'The public fields of one user, for their public profile; no row when the username is unknown or the profile is off.';

grant execute on function app_public.public_user(citext) to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create or replace function app_public.public_user_bands(handle citext)
returns table (
  slug citext,
  name text
) as $$
  select bands.slug, bands.name
  from app_public.band_memberships
  inner join app_public.users on users.id = band_memberships.user_id
  inner join app_public.bands on bands.id = band_memberships.band_id
  where users.username = public_user_bands.handle
    and users.is_public
    and bands.is_public
  order by bands.name asc;
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.public_user_bands(citext) is
  E'The bands with public pages that a user belongs to, for their public profile; empty while the profile is off.';

grant execute on function app_public.public_user_bands(citext) to :DATABASE_VISITOR;

--! split: 0280-user-profile-theme.sql
/*
 * A user's public profile is a theme the user writes, like a band's page
 * (docs/adr/0012): one HTML document with theme tags, plus the values the
 * user chose for the options the theme declares. There are no starter themes
 * for profiles; a NULL theme means the built-in default. `public_user` gains
 * the theme columns, so its return type changes and it is dropped first.
 */

alter table app_public.users
  add column if not exists page_theme text
    check (length(page_theme) <= 200000),
  add column if not exists page_options jsonb not null default '{}'
    check (jsonb_typeof(page_options) = 'object');

comment on column app_public.users.page_theme is
  E'The public profile''s theme: an HTML document with theme tags. Null means the built-in default theme.';
comment on column app_public.users.page_options is
  E'Values for the options the profile theme declares, keyed like "color:Accent"; an option with no value uses the theme''s default.';

grant update(page_theme, page_options) on app_public.users to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

drop function if exists app_public.public_user(citext);

create function app_public.public_user(handle citext)
returns table (
  username app_public.username,
  name text,
  bio text,
  avatar_url text,
  page_theme text,
  page_options jsonb
) as $$
  select
    users.username,
    users.name,
    users.bio,
    users.avatar_url::text,
    users.page_theme,
    users.page_options
  from app_public.users
  where users.username = public_user.handle
    and users.is_public;
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.public_user(citext) is
  E'The public fields of one user, for their public profile; no row when the username is unknown or the profile is off.';

grant execute on function app_public.public_user(citext) to :DATABASE_VISITOR;
