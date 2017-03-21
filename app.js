/*******************************************************************************
* boilerplate code                                                             *
*******************************************************************************/

// express
var express = require('express');
var app = express();

// filesystem
var fs = require('fs');

// middleware
// app.use(express.static('public'));
app.use(require('body-parser')());

// set up handlebars view engine
var handlebars = require('express-handlebars').create({ defaultLayout:'main' });
app.engine('handlebars', handlebars.engine);
app.set('view engine', 'handlebars');

/*******************************************************************************
* actual things
*******************************************************************************/

// marked
var marked = require('marked');

// views
app.get('/', function(req, res) {
    var markdown = marked(fs.readFileSync('setlist.md').toString());
    
    res.render('main', { markdown: markdown });
});

app.get('/edit', function(req, res) {
    var editablemarkdown = fs.readFileSync('setlist.md').toString();
    res.render('edit', { markdown: editablemarkdown })
});

app.post('/save', function(req, res) {
    fs.writeFile('setlist.md', req.body.markdown, function(err) {
	if(err)
	    return console.log(err);
	console.log('saved markdown');
    });
    
    res.redirect(303, '/');
});

/*******************************************************************************
* boring stuff                                                                 *
*******************************************************************************/

// custom 404 page
app.use(function(req, res) {
    res.type('text/plain');
    res.status(404);
    res.send('404 - Not Found');
});

// custom 500 page
app.use(function(err, req, res, next) {
    console.error(err.stack);
    res.type('text/plain');
    res.status(500);
    res.send('500 - Server Error');
});

app.set('port', process.env.PORT || 3000);

app.listen(app.get('port'), function() {
    console.log( 'Express started on http://localhost:' + app.get('port') + '; press Ctrl+C to terminate.' );
});
