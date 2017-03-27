const path = require('path')
const knex = require('knex')({
  client: 'sqlite3',
  connection: { filename: path.join(__dirname, 'data.sqlite3') },
  useNullAsDefault: true,
})

const newList = rows =>
  knex('lists')
    .insert(rows)

const getAllLists = () =>
  knex('lists')
    .select('*')
    .then(data => data.map(e => {
      const list = e.list.split('\n').slice(0, 10).join('\n')
      return { ...e, list }
    }))

const delList = id =>
  knex('lists')
    .where({ id })
    .del()

const getList = id =>
  knex('lists')
    .where({ id })
    .select('*')
    .limit(1)

const updateList = ({ id, list }) =>
  knex('lists')
    .update({ list })
    .where({ id })

const schema = () =>
  knex.schema.createTableIfNotExists('lists', table => {
    table.increments('id').primary()
    table.string('list')
  }).then(() => knex('lists').select('*'))
    .then(data => {
      if (data.length < 1) {
        console.log('adding dummy data') // eslint-disable-line no-console
        newList([
          { list: '# first list' },
          { list: '# second list' },
        ]).then()
      }
    })

module.exports = {
  delList,
  newList,
  getAllLists,
  getList,
  updateList,
  schema,
}
