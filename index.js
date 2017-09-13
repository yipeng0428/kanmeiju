var express = require('express');
var compression = require('compression');
var request = require('request');
var path = require('path');
var parser = require('body-parser');
var md5 = require('md5')
var redis = require('redis')
var mongoose = require('mongoose')
var app = express();
var client = redis.createClient(process.env.REDIS_URL);


/**
 * Configuration
 */
app.set('port', (process.env.PORT || 5000));
app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});
app.use(function(req, res, next) {
    if (req.headers['x-forwarded-proto'] !== 'https') {
        return res.redirect('https://' + req.hostname + req.url);
    }
    next();
});
app.use(compression());
app.use(express.static(__dirname + '/frontend/build'));
app.use(parser.json());
app.use(parser.urlencoded({ extended: true }));


/**
 * Constant Variable
 */
SERVER = "http://api.rr.tv";
SECRET_KEY = "clientSecret=08a30ffbc8004c9a916110683aab0060";
TOKENS = [
    '5e0fdfd57dda41c3910136d83a5f6b20',
    'bb84a1b8717a4ac28d68b6a287a9d8aa',
    'f7584e56034c4b92bf8fb69b13e1f31b',
    '92311c495681424bb7e1293aca12c762',
    '0e6e0e5fcd6340c5a5dfb0310cfe44fb',
    '97c2aac3fe524b00b602a9b4c6a739b4',
    'e8135ccc93764981aeebe41922ff1503',
    'ae02f47222254efb997436e27c8523d3',
    '19632a0d4a10464ca38526bcfbe1b872',
    'a7e8cb5a6ee949689c48bef9c0cc20dc',
    '9fde69224f95485896d3f2efe93af896',
    '1e4db225f13f4486bf9def61cdbf71be'
];

Token_iterator = 0;
FAKE_HEADERS = {
    "clientType": "android_%E8%B1%8C%E8%B1%86%E8%8D%9A",
    "clientVersion": "3.5.3.1",
    "deviceId": "861134030056126",
    "token": "ed475779da3f42ba9f133bd45913c92b",
    "signature": "643c184f77372e364550e77adc0360cd",
    "t": "1491433993933"
};


/**
 * Serve index
 */
app.get('/', function(req, res) {
    res.sendfile('index.html')
});



/**
 * getJSON as client
 *
 * url - url of api
 * body - from body data
 * callback - callback function with returning json
 * headers - headers if necessary
 */
function getJSON(url, body, callback, headers=FAKE_HEADERS) {
    
    var options = {
        url : url,
        headers : headers,
        method: 'POST',
        form: body
    };

    var buffer = "";
    var req = request(options).on('error', function(err) {
        console.log(err);
        buffer = {code:'5000', 'msg': err};
    }).on('response', function(res) {
        var buffer = "";
        res.on('data', function(data) {
            buffer += data;
        }).on('end', function() {     
            callback(buffer);
        });
    });  
}

/**
 * cacheAndGet
 * 
 * cache is redis, if not try to get from remote
 *
 */
function cacheAndGet(key, api, body, getter, callback) {
    client.exists(key, function(err, reply) {
        if (reply === 1) {
            client.get(key, function(err, reply) {
                callback(reply);
            });
        } else {
            // Fetch remote data and set k,v in callback
            getter(api, body, function(json) {
                callback(json);
                client.set(key, json);
                // Expire after half hours
                client.expire(key, 3600);
            });
        }
    });
}


/**
 * API: Search
 *
 * {'title' : 'bigbang'}
 */
app.get('/api/search/:title', function(req, res) {
    var api = SERVER + '/v3plus/video/search'
    var body = {'title': req.params.title };
    console.log('/api/search/');

    // Check Redis and get from remote
    var key = api + JSON.stringify(req.params.title);
    cacheAndGet(key, api, body, getJSON, function(json){
        res.send(json);
    })
    
});

/**
 * API: Detail
 *
 * {'seasonId' : 1888}
 */
app.get('/api/detail/:seasonId', function(req, res) {
    var api = SERVER + '/v3plus/season/detail'
    var body = {'seasonId': req.params.seasonId}
    console.log('/api/detail/', req.params.seasonId)
   
    // Check Redis and get from remote
    var key = api + JSON.stringify(req.params.seasonId);
    cacheAndGet(key, api, body, getJSON, function(json){
        res.send(json);
    })
});


/*
 * Saving m3u8 in mongodb
 * Because rr limit requests 30times per minute.
 */
var m3u8Schema = mongoose.Schema({
    episodeSid: String,
    json: Object
});
var M3u8 = mongoose.model('m3u8', m3u8Schema);
/**
 * API: M3u8
 *
 * {'episodeSid' : 25005, 'quality' : 'super'}
 */
app.get('/api/m3u8/:episodeSid', function(req, res) {
    var api = SERVER + '/video/findM3u8ByEpisodeSid'
    
    // round-robin tokens to avoid ban
    FAKE_HEADERS['token'] = TOKENS[(Token_iterator++)%TOKENS.length];
    console.log(FAKE_HEADERS['token']);

    // calculate signature
    var headers = FAKE_HEADERS;
    var body = {}
    body['episodeSid'] = req.params.episodeSid;
    body['quality'] = 'super';
    key = 'episodeSid=' + req.params.episodeSid;
    key += 'quality=' + 'super';
    key += 'clientType=' + FAKE_HEADERS['clientType'];
    key += 'clientVersion=' + FAKE_HEADERS['clientVersion'];
    key += 't=' + FAKE_HEADERS['t'];
    key += SECRET_KEY;
    headers['signature'] = md5(key);
    body['token'] = FAKE_HEADERS['token'];
    body['seasonId'] = 0;

    // logging to debug
    console.log(md5(key))
    console.log('/api/m3u8/', req.params.episodeSid)

    // Check Redis cache first
    var key = api + JSON.stringify(req.params.episodeSid);
    console.log(key);

    client.exists(key, function(err, reply) {
        if (reply === 1) {
            client.get(key, function(err, reply) {
                res.send(reply);
            });
        } else {
            
            // Fetch remote data and set k,v in callback
            getJSON(api, body, function(json) {
                res.send(json);
                client.set(key, json);
                client.expire(key, 3500);
            }, headers); 
        }
    });

});

/**
 * API: Index
 *
 */
 app.get('/api/index', function(req, res) {
    var api = SERVER + '/v3plus/video/indexInfo'
    var body = {}
    console.log('/api/index');

    // Check Redis and get from remote
    var key = api;
    cacheAndGet(key, api, body, getJSON, function(json){
        res.send(json);
    })
 });

 /**
 * API: hot
 *
 */
 app.get('/api/hot', function(req, res) {
    var api = SERVER + '/video/seasonRankingList'
    var body = {}
    console.log('/api/hot');

    // Check Redis and get from remote
    var key = api;
    cacheAndGet(key, api, body, getJSON, function(json){
        res.send(json);
    })
 });

 /**
 * API: top
 *
 */
 app.get('/api/top', function(req, res) {
    var api = SERVER + '/v3plus/season/topList'
    var body = {}
    console.log('/api/top');

    // Check Redis and get from remote
    var key = api;
    cacheAndGet(key, api, body, getJSON, function(json){
        res.send(json);
    });
 });

 /**
 * API: album
 *
 */
 app.get('/api/album/:albumId', function(req, res) {
    var api = SERVER + '/v3plus/video/album'
    var body = {'albumId': req.params.albumId}
    console.log('/api/album');

    // Check Redis and get from remote
    var key = api + JSON.stringify(req.params.albumId);
    cacheAndGet(key, api, body, getJSON, function(json){
        res.send(json);
    });
 });

 /**
 * API: category
 *
 */
 app.get('/api/category/:categoryType/:pages', function(req, res) {
    var api = SERVER + '/v3plus/video/search'
    var body = {'name': 'cat_list', 
                       'cat': req.params.categoryType, 
                       'page': req.params.pages};
    console.log('/api/category');

    // Check Redis and get from remote
    var key = api + JSON.stringify(req.params.categoryType) + JSON.stringify(req.params.pages) ;
    cacheAndGet(key, api, body, getJSON, function(json){
        res.send(json);
    });
 });

/**
 * wildcard
 */
app.get('*', function (request, response){
  console.log(path.resolve(__dirname, 'frontend/build', 'index.html'));
  response.sendFile(path.resolve(__dirname, 'frontend/build', 'index.html'))
})


app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});


