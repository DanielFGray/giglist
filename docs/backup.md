# Back up and restore the GigList database

`scripts/backupDb.sh` takes a nightly compressed dump of the production
database. A backup counts only after `scripts/restoreCheck.sh` has restored
that dump into a scratch database and proved it holds data; a dump file on
its own is unverified.

Both scripts take every credential from the environment. No secret belongs
in either script, in the systemd units, or in this document.

## What the backup does

- `pg_dump --format=custom` of the database in `DATABASE_URL` (the table
  owner, as `/etc/giglist.env` supplies it) into `$BACKUP_DIR` (default
  `/var/backups/giglist`) as `giglist-YYYYMMDD-HHMMSS.dump`. The dump is
  written to a partial name first and renamed only on success, so a failed
  dump leaves no partial `*.dump` file and exits non-zero.
- Dumps older than 14 days in `$BACKUP_DIR` are deleted.
- When `BACKUP_COPY_CMD` is set, it runs with the new dump's path as its
  only added argument, so the dump can be copied off the host.

Roles are not in the dump: `pg_dump` dumps one database, not the cluster
roles. The restore procedure below provisions the roles first.

## Install the nightly backup

1. Install the PostgreSQL 17 client tools (`pg_dump`, `pg_restore`, `psql`)
   on the host; see `docs/deploy.md` for the rest of the host setup.
2. Create the backup directory and give it to the service account:

   ```bash
   sudo install -d -o giglist -g giglist -m 0700 /var/backups/giglist
   ```

   To use another directory, set `BACKUP_DIR` in `/etc/giglist.env` and
   create that directory with the same ownership.
3. Copy the units and enable the timer:

   ```bash
   sudo cp deploy/giglist-backup.service deploy/giglist-backup.timer \
     /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now giglist-backup.timer
   systemctl list-timers giglist-backup.timer
   ```

   The timer runs daily at 02:30. `Persistent=true` means a run missed
   while the host was off happens at the next boot.
4. Run one backup by hand, then verify it (see the restore check below)
   before relying on the schedule:

   ```bash
   sudo systemctl start giglist-backup.service
   journalctl -u giglist-backup.service
   ```

## Copy the dump off the host

Set `BACKUP_COPY_CMD` in `/etc/giglist.env` to a wrapper command. The
script appends the new dump's path as the command's only added argument,
so the wrapper receives the file as `$1`:

```bash
#!/usr/bin/env bash
set -euo pipefail
exec rclone copyto "$1" "remote:giglist-backups/$(basename "$1")"
```

An `rsync` wrapper works the same way (`rsync -a "$1" host:/backups/`).
Keep the remote's own credentials in the `giglist` user's configuration
for that tool (for example `~giglist/.config/rclone/rclone.conf`), never
in this repository or in `BACKUP_COPY_CMD` itself, and make sure the copy
is encrypted in transit and at rest. A failed copy fails the backup unit,
even though the local dump remains.

## Restore check

The check restores the newest dump in `$BACKUP_DIR` (or the dump file
given as an argument) into a scratch database named
`giglist_restore_check`, created through the admin URL in
`ROOT_DATABASE_URL`. It asserts that `app_public.users`,
`app_public.bands` and `app_public.songs` exist, prints their row counts,
and drops the scratch database on exit, whether the check passed or not.
It refuses to run if the database in `DATABASE_URL` is the scratch name.

```bash
set -a; . /etc/giglist.env; set +a
bash scripts/restoreCheck.sh
# or: bash scripts/restoreCheck.sh /var/backups/giglist/giglist-20261020-023000.dump
```

Expected output ends with the three row counts and
`Restore check passed: …`. Run it after the first hand-run backup, after
any change to the backup setup, and on a regular schedule (weekly is a
reasonable cadence) so every retained backup generation gets verified
while a known-good one is still on disk.

## Restore for real

Roles and extensions are not in the dump, so provision them in the empty
target database first, as a database superuser:

1. Stop the API and worker so nothing writes during the restore.
2. Create the owner, authenticator and visitor roles if they do not exist
   (passwords come from your production environment, never from a file in
   this repository): the owner and authenticator are `LOGIN` roles, the
   authenticator is `NOINHERIT`, the visitor has no login, and the visitor
   is granted to the authenticator:

   ```sql
   CREATE ROLE <owner> LOGIN PASSWORD '<owner password>';
   CREATE ROLE <authenticator> LOGIN PASSWORD '<authenticator password>' NOINHERIT;
   CREATE ROLE <visitor>;
   GRANT <visitor> TO <authenticator>;
   ```

3. Create the empty database owned by the owner, then apply
   `migrations/afterReset.sql` to it as superuser. That file grants the
   owner and authenticator access, hands schema `public` to the owner,
   and creates the extensions the schema needs (`plpgsql`, `uuid-ossp`,
   `citext`, `pgcrypto`). Its `:DATABASE_NAME`, `:DATABASE_OWNER` and
   `:DATABASE_AUTHENTICATOR` placeholders take the real names:

   ```bash
   psql "$ROOT_DATABASE_URL" -v ON_ERROR_STOP=1 \
     -c 'CREATE DATABASE giglist OWNER <owner>'
   psql "postgres://…/giglist" -v ON_ERROR_STOP=1 \
     -v DATABASE_NAME=giglist -v DATABASE_OWNER=<owner> \
     -v DATABASE_AUTHENTICATOR=<authenticator> \
     -f migrations/afterReset.sql
   ```

4. Restore the dump into the empty database. `--no-owner
   --no-privileges` makes the connecting owner own everything, so the
   restore does not depend on the original host's role names or grants:

   ```bash
   pg_restore --no-owner --no-privileges --dbname="$DATABASE_URL" \
     /var/backups/giglist/giglist-YYYYMMDD-HHMMSS.dump
   ```

5. Run the restore check's queries (or the check itself against a second
   restore), start the API and worker, and run
   `bun run check:production https://YOUR_DOMAIN`.

To rehearse this without touching production, restore into a scratch
database on another host or a local Docker database instead, following
the same steps.

## Alert

Alert on the unit failing: monitor `systemctl is-failed
giglist-backup.service` (and that `giglist-backup.timer` is active), or
attach a notification with an `OnFailure=` drop-in. Read the failure with
`journalctl -u giglist-backup.service`. A failed unit means that night
produced no verified backup: the dump failed, the retention sweep failed,
or the offsite copy failed. Also alert when the restore check fails —
until it passes, the newest backup is only a file, not a recovery path.
