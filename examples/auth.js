  // detect isSystemRequest, shouldCache
  var fs = require('fs');
  var demoUser = { username: 'demo'};
    var isSystemRequest = false, isProxyAsset = path.match(/^\/__wm\/.*$/) !== null;

    if (request_url.port == GLOBAL.config.AUTH_PORT || (request_url.hostname || '').match(GLOBAL.config.NOCACHE_REGEX)) {
      isSystemRequest = true; // don't cache
      browser_request.headers['X-Forwarded-For'] = browser_request.connection.remoteAddress;
    } else if (GLOBAL.config.doAuth !== false && (!GLOBAL.authed[browser_request.connection.remoteAddress])) {
      sendLocalContent(browser_request, browser_response, 'You must <a href="' + request_url.hostname + '.' + GLOBAL.config.DOMAIN + ':' + GLOBAL.config.AUTH_PORT + '/login">login</a>');
      return;
    } else {
      if (GLOBAL.config.doAuth) {
        browser_request.psMember = GLOBAL.authed[browser_request.connection.remoteAddress];
      } else {
        browser_request.psMember = demoUser;
        GLOBAL.authed[browser_request.connection.remoteAddress] = demoUser;
      }
    }

    browser_request.headers['Access-Control-Allow-Origin'] = GLOBAL.config.domain;
    browser_request.headers['Access-Control-Allow-Methods'] = 'GET,POST';
    browser_request.headers['Access-Control-Allow-Headers'] = 'Content-Type';

    if (isProxyAsset) {
      try {
        var asset = fs.readFileSync('./static/' + path);
        sendLocalContent(browser_request, browser_response, asset, path.replace(/.*\./, ''));
      } catch (e) { // fall through
        sendLocalContent(browser_request, browser_response, 'proxyAsset failed for "' + path + '": ' + e);
        console.log('proxyAsset failed', e);
      }
      return;
    }
