const path = require('path');
const knex = require('knex')({
  client: 'sqlite3',
  connection: { filename: path.join(__dirname, 'data.sqlite3') },
  useNullAsDefault: true,
});

const schema = () =>
  knex.schema.createTableIfNotExists('lists', table => {
    table.increments('id').primary();
    table.string('list');
  }).then(() =>
    knex('lists').select('*')
      .then(data => {
        if (data.length < 1) {
          console.log('adding dummy data');
          knex('lists').insert({ list: '# first list' })
            .then(() => knex('lists').insert({ list: '# second list' }))
            .then();
        }
      })
  );

const getAllLists = () =>
  knex('lists')
    .select('*');

const getList = id =>
  knex('lists')
    .where({ id })
    .select('*')
    .limit(1);

const saveList = (id, list) =>
  knex('lists')
    .where({ id })
    .update({ list });

module.exports = {
  schema,
  getAllLists,
  getList,
  saveList,
};
