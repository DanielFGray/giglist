const express = require('express');
const marked = require('marked');
const fs = require('fs');
const bodyParser = require('body-parser');
const handlebars = require('express-handlebars');

const app = express();
// app.use(express.static('public'));
const urlencodedParser = bodyParser.urlencoded({ extended: false });
app.engine('handlebars', handlebars.create({ defaultLayout: 'main' }).engine);
app.set('view engine', 'handlebars');

app.get('/', (req, res) => {
  fs.readFile('setlist.md', (err, data) => {
    if (err) throw new Error(err);
    const markdown = marked(data.toString());
    res.render('main', { markdown });
  });
});

app.get('/edit', (req, res) => {
  fs.readFile('setlist.md', (err, data) => {
    if (err) throw new Error(err);
    res.render('edit', { markdown: data.toString() });
  });
});

app.post('/save', urlencodedParser, (req, res) => {
  fs.writeFile('setlist.md', req.body.markdown, err => {
    if (err) throw new Error(err);
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
