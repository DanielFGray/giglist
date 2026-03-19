/* eslint-disable no-console,vars-on-top,block-scoped-var,no-var */

const express = require('express')
const path = require('path')
const bodyParser = require('body-parser')
const morgan = require('morgan')

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
app.use(morgan('dev'))

if (process.env.NODE_ENV !== 'production') {
  const webpack = require('webpack') // eslint-disable-line import/no-extraneous-dependencies,global-require
  const webpackDevMiddleware = require('webpack-dev-middleware') // eslint-disable-line import/no-extraneous-dependencies,global-require
  const webpackConfig = require('./webpack.config.babel') // eslint-disable-line import/no-extraneous-dependencies,global-require
  var compiler = webpack(webpackConfig)

  app.use(webpackDevMiddleware(compiler, {
    compress: true,
    overlay: {
      warnings: true,
      errors: true,
    },
    publicPath: '/',
    stats: 'minimal',
  }))
}

function renderLogErrors(e, res) {
  console.log(e)
  res.json({ message: 'fail', body: e })
}

app.use(express.static(path.join(__dirname, 'dist')))
app.use(bodyParser.urlencoded({ extended: true }))

app.get('/api/v1/list', (req, res) => {
  getAllLists()
    .catch(e => renderLogErrors(e, res))
    .then(data => res.json({ message: 'success', body: data }))
})

app.post('/api/v1/list', (req, res) => {
  const { list } = req.body
  if (! list) {
    renderLogErrors('missing list property trying to create', res)
  } else {
    newList({ list })
      .catch(e => renderLogErrors(e, res))
      .then(id => res.json({ message: 'success', body: { id: id[0] } }))
  }
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
  if (! list) {
    renderLogErrors(`missing list property trying to update ${id}`, res)
  } else {
    updateList({ id, list })
      .catch(e => renderLogErrors(e, res))
      .then(() => res.json({ message: 'success' }))
  }
})

if (process.env.NODE_ENV !== 'production') {
  app.use('/*', (req, res, next) => {
    const filename = path.join(compiler.outputPath, 'index.html')
    compiler.outputFileSystem.readFile(filename, (err, result) => {
      if (err) {
        next(err)
        return
      }
      res.set('content-type', 'text/html')
      res.send(result)
      res.end()
    })
  })
} else {
  app.get('/*', (req, res) => {
    res.sendFile('index.html')
  })
}

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
