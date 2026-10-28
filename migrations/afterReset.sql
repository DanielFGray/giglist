begin;
grant connect on database :DATABASE_NAME to :DATABASE_OWNER;
grant connect on database :DATABASE_NAME to :DATABASE_AUTHENTICATOR;
grant all on database :DATABASE_NAME to :DATABASE_OWNER;
alter schema public owner to :DATABASE_OWNER;
-- Extensions come from the cartridge via `ops dev db`, not from this file.
commit;
