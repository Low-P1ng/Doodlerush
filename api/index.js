const express = require('express');
const path = require('path');
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// Home route
app.get('/', (req, res) => {
  res.render('index', { title: 'Home Page' });
});

module.exports = app;