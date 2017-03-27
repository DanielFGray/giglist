/* eslint-disable no-console */

const express = require('express')
const path = require('path')
const bodyParser = require('body-parser')

const {
  delList,
  getList,
  getAllLists,
  newList,
  updateList,
  schema,
} = require('./data')

schema()

const app = express()

if (process.env.NODE_ENV !== 'production') {
  const webpack = require('webpack'); // eslint-disable-line
  const webpackDevMiddleware = require('webpack-dev-middleware'); // eslint-disable-line
  const webpackConfig = require('./webpack.config'); // eslint-disable-line
  const compiler = webpack(webpackConfig)

  app.use(webpackDevMiddleware(compiler, {
    compress: true,
    overlay: {
      warnings: true,
      errors: true,
    },
    publicPath: '/',
    progress: true,
    stats: 'minimal',
  }))
}

function renderLogErrors(e, res) {
  console.log(e)
  res.json({ message: 'fail', body: e })
}

app.use(express.static(path.join(__dirname, 'dist')))
app.use(bodyParser.urlencoded({ extended: true }))

app.get('/', (req, res) => {
  res.render('index.html')
})

app.get('/api/v1/list', (req, res) => {
  getAllLists()
    .catch(e => renderLogErrors(e, res))
    .then(data => res.json({ message: 'success', body: data }))
})

app.post('/api/v1/list', (req, res) => {
  // FIXME: should return an id
  const { list } = req.body
  newList({ list })
    .catch(e => renderLogErrors(e, res))
    .then(() => res.json({ message: 'success' }))
})

app.get('/api/v1/list/:id', (req, res) => {
  getList(req.params.id)
    .catch(e => renderLogErrors(e, res))
    .then(data => res.json({ message: 'success', body: data[0] }))
})

app.delete('/api/v1/list/:id', (req, res) => {
  delList(req.params.id)
    .catch(e => renderLogErrors(e, res))
    .then(() => res.json({ message: 'success' }))
})

app.put('/api/v1/list/:id', (req, res) => {
  const { id } = req.params
  const { list } = req.body
  updateList({ id, list })
    .catch(e => renderLogErrors(e, res))
    .then(() => res.json({ message: 'success' }))
})

// custom 404 page
app.use((req, res) => {
  res.type('text/plain')
  res.status(404)
  res.send('404 - Not Found')
})

// custom 500 page
app.use((err, req, res) => {
  console.error(err.stack)
  res.type('text/plain')
  res.status(500)
  res.send('500 - Server Error')
})

const port = process.env.PORT || 3000

app.listen(port, () => {
  console.log(`Express started on http://localhost:${port}\npress Ctrl+C to terminate.`)
})

process.on('uncaughtException', console.log)
