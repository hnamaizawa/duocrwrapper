var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');

var smartreadRouter = require('./routes/smartread.js');
var msRouter = require('./routes/msread.js');
var elocrRouter = require('./routes/el_ocr.js');
var mscloudRouter = require('./routes/msread_cloud.js');
var clovaRouter = require('./routes/clova.js');
var indexRouter = require('./routes/index.js');
var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(express.json({limit: '10mb'}));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/smartread', smartreadRouter);
app.use('/ms', msRouter);
app.use('/el_ocr', elocrRouter);
app.use('/mscloud', mscloudRouter);
app.use('/clova', clovaRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
