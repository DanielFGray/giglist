const path = require('path');
const knex = require('knex')({
  client: 'sqlite3',
  connection: { filename: path.join(__dirname, 'data.sqlite3') },
  useNullAsDefault: true,
});

const newList = list =>
  knex('lists')
    .insert({ list });

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

const insertList = contents =>
  newList(contents).then();

const schema = () =>
  knex.schema.createTableIfNotExists('lists', table => {
    table.increments('id').primary();
    table.string('list');
  }).then(() =>
    knex('lists').select('*')
      .then(data => {
        if (data.length < 1) {
          console.log('adding dummy data');
          newList('# first list')
            .then(() => newList('# second list'))
            .then();
        }
      })
  );

module.exports = {
  getAllLists,
  getList,
  insertList,
  saveList,
  schema,
};
