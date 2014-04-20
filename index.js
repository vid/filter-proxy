var http = require('http');
var url  = require('url');
var zlib = require('zlib');

// filter-proxy 
//
// onRequest makes the first decisions on request, it may end the request or pass on shouldProcess details.
// onRetrieve is for caching/indexing actions.
// processor is where content changes can be made.
// onPost to edit post requests before they're sent to an origin

// FIXME don't use global debug
// FIXME problem with binary content
//
var config;

exports.start = function(config) {
  this.config = config;

// the first layer, browser_request
  var server = http.createServer(function(browser_request, browser_response) {
    var request_url = url.parse(browser_request.url),
      path = url.parse(browser_request.url).pathname,
      isSystemRequest = false;

    if (config.onRequest) {
      var res = config.onRequest(browser_request, browser_response);
      if (res.content) {
        sendLocalContent(browser_request, browser_response, res.content);
      }
      if (!res.continue) { 
        return;
      }
      isSystemRequest = res.isSystemRequest;
    }
      
    // Retrieve from cache if configured & present
    if (config.pageCache && config.doCache && !isSystemRequest && config.pageCache.isCached(browser_request.url)) {
      config.pageCache.get(browser_request.url, function(err, headers, pageBuffer) {
        if (err || !headers) {
          getNonCached();
        } else {
          browser_request.proxy_received = headers;
          browser_request.is_html = browser_request.proxy_received.headers['content-type'] && browser_request.proxy_received.headers['content-type'].indexOf('text\/html') > -1;

        // process cached content
          if (config.processor) {
            config.processor.process(pageBuffer, browser_request, browser_response, sendPage);
          } else {
            sendPage(pageBuffer, browser_request, browser_response);
          }
          return; 
        }
      });
    } else {
      getNonCached();
    }

    function getNonCached() {
      var proxy_options = { encoding: null, headers : browser_request.headers, path : request_url.path, method : browser_request.method, host : request_url.hostname, port : request_url.port || 80};

      // avoid gzip
      delete proxy_options.headers['accept-encoding']; 
      // FIXME
      delete proxy_options.headers['if-modified-since']; 

      // Handle reverse proxy routing
      if (config.reverseProxyRoutes) {
        var pHost = proxy_options.headers['x-forwarded-host'];
        if (pHost && config.reverseProxyRoutes[pHost]) {
          proxy_options.host = config.reverseProxyRoutes[pHost].host;
          proxy_options.port = config.reverseProxyRoutes[pHost].port || 80;
          proxy_options.headers.host = config.reverseProxyRoutes[pHost].host;
        }
      }

      // request from origin
      var proxy_request = http.request(proxy_options, function(proxy_received) {
        // for convenient passing around
        browser_request.proxy_received = proxy_received;  
        var gzipped = proxy_received.headers['content-encoding'] === 'gzip';
        var content_type =  proxy_received.headers['content-type'] || "" ; 
        browser_request.is_html = content_type.indexOf('text\/html') > -1;
        if (browser_request.url.match(/\.(ico|xml|css|js|jpg|gif|png)$/i) ){
          browser_request.is_html = 0; 
        }  
        browser_request.encoding = 'binary';
        if (browser_request.is_html) {
          // FIXME
          browser_request.encoding = 'UTF-8'; 
          proxy_received.setEncoding(browser_request.encoding);
        } 

        if (gzipped) {
          var gunzip = zlib.createUnzip();
          proxy_received.pipe(gunzip);
          browser_request.encoding = 'binary';
          GLOBAL.debug('GZIPPED!');
  // FIXME better decoding
          gunzip.on('error', function(err, data) {
            proxy_received.emit('error', err);
          });
        }
        var pageBuffer = '';

        proxy_received.on('error', function(err, data) {
          GLOBAL.debug('filter-proxy request error', err, pageBuffer, browser_request.url, proxy_received.headers);
          browser_response.write('proxy received an error' + err + ";"+ JSON.stringify(proxy_received.headers, null, 4)+"\n\n::"+data+'::', browser_request.encoding);
          browser_response.end();
        }).on('data', function(chunk) {
          // FIXME
          pageBuffer += chunk.toString(browser_request.encoding);
        }).on('end', function() {
          // cache and index everything for analysis
          if (!isSystemRequest) {  
            var saveHeaders = {},
            // FIXME
              uri = browser_request.url.toString().replace(/#.*$/, ''), 
              contentType = browser_request.proxy_received.headers['content-type'],
              referer = browser_request.headers.referer;
  // FIXME
              if (!contentType) {
                GLOBAL.debug('WTF', browser_request.proxy_received.headers);
              }

            saveHeaders.statusCode = browser_request.proxy_received.statusCode;
            saveHeaders.headers = browser_request.proxy_received.headers;

            if (config.onRetrieve) {
              config.onRetrieve.process(uri, referer, browser_request.is_html, pageBuffer, contentType, saveHeaders, browser_request);
            }
          }
          // process uncached content
          if (config.processor) {
            config.processor.process(pageBuffer, browser_request, browser_response, sendPage);
          } else {
            sendPage(pageBuffer, browser_request, browser_response);
          }
        });

      }).on('error' , function(e) {
        GLOBAL.debug('filter-proxy origin requst error', e);
      }).on('end' , function() {
        GLOBAL.debug('sent post data');
        proxy_request.end(); 
      }).on('close' , function() {
        proxy_request.end(); 
      });

      var postData = '';
      browser_request.on('data', function(chunk) {
  //      proxy_request.write(chunk);
        if (postData.length > 1e6) {
          // flood attack or faulty client, nuke request
          request.connection.destroy();
        }
        postData += chunk;
      }).on('end', function() {
        proxy_request.write(config.editPost ? config.editPost.editPost(browser_request, postData) : postData);
        proxy_request.end(); 
      }).on('close', function() {
        //proxy_request.end(); 
      }).on('error', function(error) {
        GLOBAL.debug('filter-proxy post error', error);
      });
    }
  }).listen(
    config.PROXY_PORT || 8089
  ).on('error',  function(e) {
    GLOBAL.debug('got server error' + e.message ); 
  }); 

  var mimeTypes = {
    js : 'application/x-javascript',
    gif : 'image/gif',
    png : 'image/png',
    jpg : 'image/jpeg',
    css : 'text/css',
    html : 'text/html'
  };

  function sendLocalContent(browser_request, browser_response, content, type) {
    browser_request.wasCached = true;
    browser_request.proxy_received = {};
    browser_request.proxy_received.headers = browser_request.proxy_received.headers || 
      { Expires: '1 Apr 1070 00:00:00 GMT', Pragma : 'no-cache', 'Cache-Control' : 'no-cache, no-store, max-age=0, must-revalidate'};

    var mimeType = mimeTypes[type] || 'text/html';
    
    browser_request.proxy_received.headers['Content-Type'] = mimeType;
    browser_request.proxy_received.statusCode = 200;
    sendPage(content, browser_request, browser_response);
  }

  function sendPage(content, browser_request, browser_response) {
    if (config.inject) {
      content = config.inject(content);
    }
    var via = 'filter-proxy';
    if (browser_request.wasCached) {
      via += "; cached";
    } else {
      // gzip
      delete browser_request.proxy_received.headers['content-encoding']; 
    }

    browser_request.proxy_received.headers['content-length'] = content.length;
    browser_request.proxy_received.headers['Access-Control-Allow-Origin'] = '*';
    browser_request.proxy_received.headers.Via = via;
    browser_response.writeHead(browser_request.proxy_received.statusCode, browser_request.proxy_received.headers);

    browser_response.write(content , browser_request.encoding);
    browser_response.end();
  }
};

