var http = require('http');
var url  = require('url');
var zlib = require('zlib');

// Cortex proxy
//
// prefrontal makes the first decisions on request, it may end the request or pass on shouldProcess details.
// consolidate is for caching/indexing actions.
// processor is where content changes can be made.
// editPost to edit post requests before they're sent to an origin


exports.start = function(config) {

// the first layer, browser_request
  var server = http.createServer(function(browser_request, browser_response) {
    var request_url = url.parse(browser_request.url),
      path = url.parse(browser_request.url).pathname,
      isSystemRequest = false;

    if (config.prefrontal) {
      var res = config.prefrontal(browser_request, browser_response);
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
      try {
        config.pageCache.get(browser_request.url, function(headers, pageBuffer) {
          browser_request.proxy_received = headers;
          browser_request.is_html = browser_request.proxy_received.headers['content-type'] && browser_request.proxy_received.headers['content-type'].indexOf('text\/html') > -1;

        // process cached content
          if (config.processor) {
            config.processor.process(pageBuffer, browser_request, browser_response, sendPage);
          } else {
            sendPage(pageBuffer, browser_request, browser_response);
          }
        });
        return; 
        // fall through to uncached
      } catch (e) { 
        console.log('doCache failed', e);
      }
    }
    
    var proxy_options = { headers : browser_request.headers, path : request_url.path, method : browser_request.method, host : request_url.hostname, port : request_url.port || 80, encoding : null};

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
    var proxy_request = http.request(proxy_options , function(proxy_received) {
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
        var gunzip = zlib.createGunzip();
        proxy_received.pipe(gunzip);
        console.log('GZIPPED!');
      }
      var pageBuffer = '';

      proxy_received.on('error', function(err, data) {
        console.log('ERROR', pageBuffer, browser_request.url, proxy_received.headers);
        browser_response.write('proxy received an error' + err + ";"+ JSON.stringify(proxy_received.headers, null, 4)+"\n\n::"+data+'::', browser_request.encoding);
        browser_response.end();
      });
      proxy_received.on('data', function(chunk) {
        // FIXME
        pageBuffer += chunk.toString(browser_request.encoding);
      });

      proxy_received.on('end', function() {
        // cache and index everything for analysis
        if (!isSystemRequest) {  
          var saveHeaders = {},
          // FIXME
            uri = browser_request.url.toString().replace(/#.*$/, ''), 
            contentType = browser_request.proxy_received.headers['content-type'],
            referer = browser_request.headers.referer;
            if (!contentType) {
              console.log('WTF', browser_request.proxy_received.headers);
            }

          saveHeaders.statusCode = browser_request.proxy_received.statusCode;
          saveHeaders.headers = browser_request.proxy_received.headers;

          if (config.consolidate) {
            try {
              config.consolidate.process(uri, referer, browser_request.is_html, pageBuffer, contentType, saveHeaders, browser_request);
            } catch (e) {
              console.log('cache EXCEPTION', e);
            }
          }
        }
        // process uncached content
        if (config.processor) {
          config.processor.process(pageBuffer, browser_request, browser_response, sendPage);
        } else {
          sendPage(pageBuffer, browser_request, browser_response);
        }
      });

    }).on('error' , function(e){
      }).on('close' , function() {
      if (proxy_request ) {
        proxy_request.end(); 
      }
    }).on('end' , function() {
      console.log('sent post data');
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
    });
    browser_request.on('end', function() {
      proxy_request.write(config.editPost ? config.editPost.editPost(browser_request, postData) : postData);
      proxy_request.end(); 
    });
    browser_request.on('close', function() {
      //proxy_request.end(); 
    });
  }).listen(
    config.PROXY_PORT || 8089
  ).on('error',  function(e) {
    console.log('got server error' + e.message ); 
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
    var via = 'cortexProxy';
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

