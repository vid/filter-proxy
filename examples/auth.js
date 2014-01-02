module.exports = function(browser_request, browser_response) {
  var response = { 'continue' : true, isSystemRequest : false, content: null};
  var request_url = url.parse(browser_request.url);

  if (request_url.port == GLOBAL.config.AUTH_PORT || (request_url.hostname || '').match(GLOBAL.config.NOCACHE_REGEX)) {
    browser_request.headers['X-Forwarded-For'] = browser_request.connection.remoteAddress;
    response.isSystemRequest = true;
  } else if (GLOBAL.config.doAuth !== false && (!GLOBAL.authed[browser_request.connection.remoteAddress])) {
    response.content = 'You must <a href="' + request_url.hostname + '.' + GLOBAL.config.DOMAIN + ':' + GLOBAL.config.AUTH_PORT + '/login">login</a>';
    response.continue = false;
  } else {
    if (GLOBAL.config.doAuth) {
      browser_request.psMember = GLOBAL.authed[browser_request.connection.remoteAddress];
    } else {
      browser_request.psMember = demoUser;
      GLOBAL.authed[browser_request.connection.remoteAddress] = demoUser;
    }
  }
  return response;
};
