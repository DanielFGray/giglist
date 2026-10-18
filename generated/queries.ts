import type { KyselyDB } from "../src/server/db.js";
import type { Selectable, Updateable, Insertable } from "kysely";

import type {
  AppPublicBandMemberships,
  AppPublicBands,
  AppPublicSetlistEntries,
  AppPublicSetlistSections,
  AppPublicSetlists,
  AppPublicSongs,
  AppPublicUserAuthentications,
  AppPublicUserEmails,
  AppPublicUsers,
} from "./DB.js";

import { sql } from "kysely";

export const bandMembershipFindById =
  (db: KyselyDB) =>
  ({ id }: Pick<Selectable<AppPublicBandMemberships>, "id">) =>
    db
      .selectFrom("app_public.band_memberships")
      .select(["id", "band_id", "user_id", "is_owner", "created_at"])
      .where("id", "=", id);

export const bandMembershipFindByUserId =
  (db: KyselyDB) =>
  ({ user_id }: Pick<Selectable<AppPublicBandMemberships>, "user_id">) =>
    db
      .selectFrom("app_public.band_memberships")
      .select(["id", "band_id", "user_id", "is_owner", "created_at"])
      .where("user_id", "=", user_id);

export const bandFindById =
  (db: KyselyDB) =>
  ({ id }: Pick<Selectable<AppPublicBands>, "id">) =>
    db
      .selectFrom("app_public.bands")
      .select(["id", "slug", "name", "description", "created_at"])
      .where("id", "=", id)
      .select((eb) =>
        eb
          .fn<boolean>("app_public.bands_current_user_is_owner", [sql.ref("app_public.bands")])
          .as("currentUserIsOwner"),
      );

export const bandUpdate =
  (db: KyselyDB) =>
  ({
    id,
    ...data
  }: Pick<Selectable<AppPublicBands>, "id"> & Omit<Updateable<AppPublicBands>, "id">) =>
    db.updateTable("app_public.bands").set(data).where("id", "=", id).returningAll();

export const bandFindBySlug =
  (db: KyselyDB) =>
  ({ slug }: Pick<Selectable<AppPublicBands>, "slug">) =>
    db
      .selectFrom("app_public.bands")
      .select(["id", "slug", "name", "description", "created_at"])
      .where("slug", "=", slug)
      .select((eb) =>
        eb
          .fn<boolean>("app_public.bands_current_user_is_owner", [sql.ref("app_public.bands")])
          .as("currentUserIsOwner"),
      );

export const setlistEntryFindById =
  (db: KyselyDB) =>
  ({ id }: Pick<Selectable<AppPublicSetlistEntries>, "id">) =>
    db
      .selectFrom("app_public.setlist_entries")
      .select([
        "id",
        "setlist_id",
        "section_id",
        "song_id",
        "key_override",
        "tempo_override",
        "notes_override",
        "created_at",
        "updated_at",
      ])
      .where("id", "=", id);

export const setlistEntryCreate = (db: KyselyDB) => (data: Insertable<AppPublicSetlistEntries>) =>
  db.insertInto("app_public.setlist_entries").values(data).returningAll();

export const setlistEntryUpdate =
  (db: KyselyDB) =>
  ({
    id,
    ...data
  }: Pick<Selectable<AppPublicSetlistEntries>, "id"> &
    Omit<Updateable<AppPublicSetlistEntries>, "id">) =>
    db.updateTable("app_public.setlist_entries").set(data).where("id", "=", id).returningAll();

export const setlistEntryDelete =
  (db: KyselyDB) =>
  ({ id }: Pick<Selectable<AppPublicSetlistEntries>, "id">) =>
    db.deleteFrom("app_public.setlist_entries").where("id", "=", id);

export const setlistEntryFindBySongId =
  (db: KyselyDB) =>
  ({ song_id }: Pick<Selectable<AppPublicSetlistEntries>, "song_id">) =>
    db
      .selectFrom("app_public.setlist_entries")
      .select([
        "id",
        "setlist_id",
        "section_id",
        "song_id",
        "key_override",
        "tempo_override",
        "notes_override",
        "created_at",
        "updated_at",
      ])
      .where("song_id", "=", song_id);

export const setlistSectionFindById =
  (db: KyselyDB) =>
  ({ id }: Pick<Selectable<AppPublicSetlistSections>, "id">) =>
    db
      .selectFrom("app_public.setlist_sections")
      .select(["id", "setlist_id", "name", "created_at", "updated_at"])
      .where("id", "=", id);

export const setlistSectionCreate =
  (db: KyselyDB) => (data: Insertable<AppPublicSetlistSections>) =>
    db.insertInto("app_public.setlist_sections").values(data).returningAll();

export const setlistSectionUpdate =
  (db: KyselyDB) =>
  ({
    id,
    ...data
  }: Pick<Selectable<AppPublicSetlistSections>, "id"> &
    Omit<Updateable<AppPublicSetlistSections>, "id">) =>
    db.updateTable("app_public.setlist_sections").set(data).where("id", "=", id).returningAll();

export const setlistSectionDelete =
  (db: KyselyDB) =>
  ({ id }: Pick<Selectable<AppPublicSetlistSections>, "id">) =>
    db.deleteFrom("app_public.setlist_sections").where("id", "=", id);

export const setlistFindById =
  (db: KyselyDB) =>
  ({ id }: Pick<Selectable<AppPublicSetlists>, "id">) =>
    db
      .selectFrom("app_public.setlists")
      .select([
        "id",
        "band_id",
        "name",
        "description",
        "gig_date",
        "status",
        "created_by",
        "created_at",
        "updated_at",
      ])
      .where("id", "=", id);

export const setlistCreate = (db: KyselyDB) => (data: Insertable<AppPublicSetlists>) =>
  db.insertInto("app_public.setlists").values(data).returningAll();

export const setlistUpdate =
  (db: KyselyDB) =>
  ({
    id,
    ...data
  }: Pick<Selectable<AppPublicSetlists>, "id"> & Omit<Updateable<AppPublicSetlists>, "id">) =>
    db.updateTable("app_public.setlists").set(data).where("id", "=", id).returningAll();

export const setlistDelete =
  (db: KyselyDB) =>
  ({ id }: Pick<Selectable<AppPublicSetlists>, "id">) =>
    db.deleteFrom("app_public.setlists").where("id", "=", id);

export const setlistFindByBandId =
  (db: KyselyDB) =>
  ({ band_id }: Pick<Selectable<AppPublicSetlists>, "band_id">) =>
    db
      .selectFrom("app_public.setlists")
      .select([
        "id",
        "band_id",
        "name",
        "description",
        "gig_date",
        "status",
        "created_by",
        "created_at",
        "updated_at",
      ])
      .where("band_id", "=", band_id);

export const songFindById =
  (db: KyselyDB) =>
  ({ id }: Pick<Selectable<AppPublicSongs>, "id">) =>
    db
      .selectFrom("app_public.songs")
      .select([
        "id",
        "band_id",
        "title",
        "artist",
        "key",
        "tempo_bpm",
        "duration_seconds",
        "capo",
        "notes",
        "created_by",
        "created_at",
        "updated_at",
      ])
      .where("id", "=", id);

export const songCreate = (db: KyselyDB) => (data: Insertable<AppPublicSongs>) =>
  db.insertInto("app_public.songs").values(data).returningAll();

export const songUpdate =
  (db: KyselyDB) =>
  ({
    id,
    ...data
  }: Pick<Selectable<AppPublicSongs>, "id"> & Omit<Updateable<AppPublicSongs>, "id">) =>
    db.updateTable("app_public.songs").set(data).where("id", "=", id).returningAll();

export const songDelete =
  (db: KyselyDB) =>
  ({ id }: Pick<Selectable<AppPublicSongs>, "id">) =>
    db.deleteFrom("app_public.songs").where("id", "=", id);

export const songFindByBandId =
  (db: KyselyDB) =>
  ({ band_id }: Pick<Selectable<AppPublicSongs>, "band_id">) =>
    db
      .selectFrom("app_public.songs")
      .select([
        "id",
        "band_id",
        "title",
        "artist",
        "key",
        "tempo_bpm",
        "duration_seconds",
        "capo",
        "notes",
        "created_by",
        "created_at",
        "updated_at",
      ])
      .where("band_id", "=", band_id);

export const userAuthenticationFindById =
  (db: KyselyDB) =>
  ({ id }: Pick<Selectable<AppPublicUserAuthentications>, "id">) =>
    db
      .selectFrom("app_public.user_authentications")
      .select(["id", "user_id", "service", "identifier", "details", "created_at", "updated_at"])
      .where("id", "=", id);

export const userAuthenticationDelete =
  (db: KyselyDB) =>
  ({ id }: Pick<Selectable<AppPublicUserAuthentications>, "id">) =>
    db.deleteFrom("app_public.user_authentications").where("id", "=", id);

export const userAuthenticationFindByUserId =
  (db: KyselyDB) =>
  ({ user_id }: Pick<Selectable<AppPublicUserAuthentications>, "user_id">) =>
    db
      .selectFrom("app_public.user_authentications")
      .select(["id", "user_id", "service", "identifier", "details", "created_at", "updated_at"])
      .where("user_id", "=", user_id);

export const userEmailFindById =
  (db: KyselyDB) =>
  ({ id }: Pick<Selectable<AppPublicUserEmails>, "id">) =>
    db
      .selectFrom("app_public.user_emails")
      .select(["id", "user_id", "email", "is_verified", "is_primary", "created_at", "updated_at"])
      .where("id", "=", id);

export const userEmailCreate = (db: KyselyDB) => (data: Insertable<AppPublicUserEmails>) =>
  db.insertInto("app_public.user_emails").values(data).returningAll();

export const userEmailDelete =
  (db: KyselyDB) =>
  ({ id }: Pick<Selectable<AppPublicUserEmails>, "id">) =>
    db.deleteFrom("app_public.user_emails").where("id", "=", id);

export const userEmailFindByUserId =
  (db: KyselyDB) =>
  ({ user_id }: Pick<Selectable<AppPublicUserEmails>, "user_id">) =>
    db
      .selectFrom("app_public.user_emails")
      .select(["id", "user_id", "email", "is_verified", "is_primary", "created_at", "updated_at"])
      .where("user_id", "=", user_id);

export const userFindById =
  (db: KyselyDB) =>
  ({ id }: Pick<Selectable<AppPublicUsers>, "id">) =>
    db
      .selectFrom("app_public.users")
      .select([
        "id",
        "username",
        "name",
        "avatar_url",
        "bio",
        "role",
        "is_verified",
        "created_at",
        "updated_at",
      ])
      .where("id", "=", id)
      .select((eb) =>
        eb
          .fn<boolean>("app_public.users_has_password", [sql.ref("app_public.users")])
          .as("hasPassword"),
      );

export const userUpdate =
  (db: KyselyDB) =>
  ({
    id,
    ...data
  }: Pick<Selectable<AppPublicUsers>, "id"> & Omit<Updateable<AppPublicUsers>, "id">) =>
    db.updateTable("app_public.users").set(data).where("id", "=", id).returningAll();

export const userFindByUsername =
  (db: KyselyDB) =>
  ({ username }: Pick<Selectable<AppPublicUsers>, "username">) =>
    db
      .selectFrom("app_public.users")
      .select([
        "id",
        "username",
        "name",
        "avatar_url",
        "bio",
        "role",
        "is_verified",
        "created_at",
        "updated_at",
      ])
      .where("username", "=", username)
      .select((eb) =>
        eb
          .fn<boolean>("app_public.users_has_password", [sql.ref("app_public.users")])
          .as("hasPassword"),
      );

export const acceptInvitationToBand = (db: KyselyDB) => (invitationId: string, code: string) =>
  db.selectNoFrom((eb) =>
    eb
      .fn<void>("app_public.accept_invitation_to_band", [eb.val(invitationId), eb.val(code)])
      .as("accept_invitation_to_band"),
  );

export const bandForInvitation = (db: KyselyDB) => (invitationId: string, code: string) =>
  db.selectNoFrom((eb) =>
    eb
      .fn<AppPublicBands>("app_public.band_for_invitation", [eb.val(invitationId), eb.val(code)])
      .as("band_for_invitation"),
  );

export const changePassword = (db: KyselyDB) => (oldPassword: string, newPassword: string) =>
  db.selectNoFrom((eb) =>
    eb
      .fn<boolean>("app_public.change_password", [eb.val(oldPassword), eb.val(newPassword)])
      .as("change_password"),
  );

export const confirmAccountDeletion = (db: KyselyDB) => (token: string) =>
  db.selectNoFrom((eb) =>
    eb
      .fn<boolean>("app_public.confirm_account_deletion", [eb.val(token)])
      .as("confirm_account_deletion"),
  );

export const createBand = (db: KyselyDB) => (slug: string, name: string) =>
  db.selectNoFrom((eb) =>
    eb.fn<AppPublicBands>("app_public.create_band", [eb.val(slug), eb.val(name)]).as("create_band"),
  );

export const currentSessionId = (db: KyselyDB) => () =>
  db.selectNoFrom((eb) =>
    eb.fn<string>("app_public.current_session_id", []).as("current_session_id"),
  );

export const currentUser = (db: KyselyDB) => () =>
  db.selectNoFrom((eb) => eb.fn<AppPublicUsers>("app_public.current_user", []).as("current_user"));

export const currentUserId = (db: KyselyDB) => () =>
  db.selectNoFrom((eb) => eb.fn<string>("app_public.current_user_id", []).as("current_user_id"));

export const currentUserInvitedBandIds = (db: KyselyDB) => () =>
  db
    .selectFrom((eb) =>
      eb
        .fn<string>("app_public.current_user_invited_band_ids", [])
        .as("current_user_invited_band_ids"),
    )
    .selectAll();

export const currentUserMemberBandIds = (db: KyselyDB) => () =>
  db
    .selectFrom((eb) =>
      eb
        .fn<string>("app_public.current_user_member_band_ids", [])
        .as("current_user_member_band_ids"),
    )
    .selectAll();

export const deleteBand = (db: KyselyDB) => (bandId: string) =>
  db.selectNoFrom((eb) =>
    eb.fn<void>("app_public.delete_band", [eb.val(bandId)]).as("delete_band"),
  );

export const forgotPassword = (db: KyselyDB) => (email: string) =>
  db.selectNoFrom((eb) =>
    eb.fn<void>("app_public.forgot_password", [eb.val(email)]).as("forgot_password"),
  );

export const inviteToBand = (db: KyselyDB) => (bandId: string, username: string, email: string) =>
  db.selectNoFrom((eb) =>
    eb
      .fn<void>("app_public.invite_to_band", [eb.val(bandId), eb.val(username), eb.val(email)])
      .as("invite_to_band"),
  );

export const logout = (db: KyselyDB) => () =>
  db.selectNoFrom((eb) => eb.fn<void>("app_public.logout", []).as("logout"));

export const makeEmailPrimary = (db: KyselyDB) => (emailId: string) =>
  db.selectNoFrom((eb) =>
    eb
      .fn<AppPublicUserEmails>("app_public.make_email_primary", [eb.val(emailId)])
      .as("make_email_primary"),
  );

export const removeFromBand = (db: KyselyDB) => (bandId: string, userId: string) =>
  db.selectNoFrom((eb) =>
    eb
      .fn<void>("app_public.remove_from_band", [eb.val(bandId), eb.val(userId)])
      .as("remove_from_band"),
  );

export const requestAccountDeletion = (db: KyselyDB) => () =>
  db.selectNoFrom((eb) =>
    eb.fn<boolean>("app_public.request_account_deletion", []).as("request_account_deletion"),
  );

export const resendEmailVerificationCode = (db: KyselyDB) => (emailId: string) =>
  db.selectNoFrom((eb) =>
    eb
      .fn<boolean>("app_public.resend_email_verification_code", [eb.val(emailId)])
      .as("resend_email_verification_code"),
  );

export const transferBandOwnership = (db: KyselyDB) => (bandId: string, userId: string) =>
  db.selectNoFrom((eb) =>
    eb
      .fn<AppPublicBands>("app_public.transfer_band_ownership", [eb.val(bandId), eb.val(userId)])
      .as("transfer_band_ownership"),
  );

export const verifyEmail = (db: KyselyDB) => (userEmailId: string, token: string) =>
  db.selectNoFrom((eb) =>
    eb
      .fn<boolean>("app_public.verify_email", [eb.val(userEmailId), eb.val(token)])
      .as("verify_email"),
  );

