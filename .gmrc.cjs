// graphile-migrate settings. A JavaScript file, because the owner role differs per instance
// (dev, staged, live). cartridge.json names it with a database role entry: the platform sets
// it in the migrate task, and `ops dev db up` writes the dev role name to .env.
const databaseOwner = process.env.DATABASE_OWNER;
if (!databaseOwner) throw new Error("DATABASE_OWNER is not set; run `ops dev db up`");

module.exports = {
  databaseOwner,
  pgSettings: {
    search_path: "app_public,app_private,app_hidden,public",
  },
  placeholders: {
    ":DATABASE_AUTHENTICATOR": "!ENV",
    ":DATABASE_VISITOR": "!ENV",
  },
  afterReset: [
    // graphile-migrate recreates the shadow database empty; ops rebuilds it from the cartridge.
    { _: "command", shadow: true, command: 'ops dev db reset "$GM_DBNAME"' },
    // The ! runs it on the root database connection.
    "!afterReset.sql",
  ],
};
