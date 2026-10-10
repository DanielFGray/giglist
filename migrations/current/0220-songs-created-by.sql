/*
 * The visitor role can insert a song but not the column that records who
 * inserted it: the column grants in 0200 cover the song's own fields only, and
 * no trigger or function sets `created_by` (it has no default).
 *
 * Granting it keeps attribution working. The RLS insert policy restricts which
 * bands a row may go into, and the column is nulled when the user goes away, so
 * the handler reading the value from the session is safe.
 */
grant insert (created_by) on app_public.songs to :DATABASE_VISITOR;
