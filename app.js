const express = require('express');
const marked = require('marked');
const bodyParser = require('body-parser');
const handlebars = require('express-handlebars');

const {
  getAllLists,
  getList,
  newList,
  saveList,
  schema,
} = require('./data');

schema();

marked.setOptions({
  gfm: true,
  tables: true,
  breaks: true,
  pedantic: false,
  sanitize: true,
  smartLists: true,
  smartypants: false,
});


const app = express();
app.use(express.static('public'));
app.use('/bootstrap', express.static(`${__dirname}/node_modules/bootstrap/dist`)); // redirect CSS bootstrap

const urlencodedParser = bodyParser.urlencoded({ extended: false });
app.engine('handlebars', handlebars.create({ defaultLayout: 'main' }).engine);
app.set('view engine', 'handlebars');

app.get('/', (req, res) => {
  getAllLists()
    .catch(console.log)
    .then(data => {
      const markdown = data.map(e => ({ ...e, list: marked(e.list) }));
      res.render('main', { data: markdown });
    });
});

app.get('/edit/:id', (req, res) => {
  getList(req.params.id)
    .catch(console.log)
    .then(data => {
      res.render('edit', { data: data[0] });
    });
});

app.post('/save/:id', urlencodedParser, (req, res) => {
  saveList(req.params.id, req.body.markdown)
    .catch(console.log)
    .then(() => {
      res.redirect(303, '/');
    });
});

// custom 404 page
app.use((req, res) => {
  res.type('text/plain');
  res.status(404);
  res.send('404 - Not Found');
});

// custom 500 page
app.use((err, req, res) => {
  console.error(err.stack);
  res.type('text/plain');
  res.status(500);
  res.send('500 - Server Error');
});

app.set('port', process.env.PORT || 3000);

app.listen(app.get('port'), () => {
  console.log(`Express started on http://localhost:${app.get('port')}; press Ctrl+C to terminate.`);
});

process.on('uncaughtException', console.log);
