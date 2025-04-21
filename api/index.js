app.get('/', (req, res) => {
    res.render('index', {
      title: 'Vercel EJS App',
      roomID: null // or whatever default value makes sense
    });
  });