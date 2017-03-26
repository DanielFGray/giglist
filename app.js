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

const getFrom = (obj, ...args) => args.map(key => obj[key])

app.use(express.static(path.join(__dirname, 'dist')))
app.use(bodyParser.urlencoded({ extended: true }))

app.get('/', (req, res) => {
  res.render('index.html')
})

app.get('/api/v1/all', (req, res) => {
  getAllLists()
    .catch(e => renderLogErrors(e, res))
    .then(data => res.json({ message: 'success', body: data }))
})

app.get('/api/v1/list/:id', (req, res) => {
  getList(req.params.id)
    .catch(e => renderLogErrors(e, res))
    .then(data => res.json({ message: 'success', body: data[0] }))
})

app.post('/api/v1/new', (req, res) => {
  newList({ list: req.body.markdown })
    .catch(e => renderLogErrors(e, res))
    .then(() => res.json({ message: 'success' }))
})

app.del('/api/v1/del/:id', (req, res) => {
  delList(req.params.id)
    .catch(e => renderLogErrors(e, res))
    .then(() => res.json({ message: 'success' }))
})

app.put('/api/v1/edit/:id', (req, res) => {
  updateList(getFrom(req.params, 'id', 'markdown'))
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
