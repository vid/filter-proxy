
var userMap = {
  test: { hostRegex: '.*something.com'}
};

var qs = require('querystring');


// edit POST data (searches)
var postWhitelist = [

  '{"facets":{"0":{"date_histogram":{"field":"@timestamp","interval":"1d"},"facet_filter":{"fquery":{"query":{"filtered":{"query":{"query_string":{"query":"*"}},"filter":{"bool":{"must":[{"match_all":{}},{"terms":{"_type":["data"]}},{"range":{"@timestamp":{"from":NUM,"to":NUM}}},{"bool":{"must":[{"match_all":{}}]}}]}}}}}}}},"size":0}' ,

  '{"facets":{"map":{"terms":{"field":"country_code","size":100,"exclude":[]},"facet_filter":{"fquery":{"query":{"filtered":{"query":{"bool":{"should":[{"query_string":{"query":"*"}}]}},"filter":{"bool":{"must":[{"match_all":{}},{"terms":{"_type":["data"]}},{"range":{"@timestamp":{"from":NUM,"to":NUM}}},{"bool":{"must":[{"match_all":{}}]}}]}}}}}}}},"size":0}' ,

  '{"query":{"filtered":{"query":{"bool":{"should":[{"query_string":{"query":"*"}}]}},"filter":{"bool":{"must":[{"match_all":{}},{"terms":{"_type":["data"]}},{"range":{"@timestamp":{"from":NUM,"to":NUM}}},{"bool":{"must":[{"match_all":{}}]}}]}}}},"highlight":{"fields":{},"fragment_size":NUM,"pre_tags":["@start-highlight@"],"post_tags":["@end-highlight@"]},"size":500,"sort":[{"_id":{"order":"desc"}}]}'

];

exports.editPost = function(browser_request, data) {
  if (data) {
console.log('DATA', data);
    try {
      postWhitelist.forEach(function(wli) {
        wli = wli.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&").replace(/NUM/g, '\\d+');
console.log(wli, '::', data);
        if (data.match(wli)) {
          return data;
        }
      });
      console.log('BLOCKING', data);
    } catch (e) {
      dumpError(e);
    }
  }
  return '';
}; 

// process received data before sending it back to the browser
exports.process = function(pageBuffer, browser_request, browser_response, sendPage) {
  var url = browser_request.url, json = null;
  if (url == '/favicon.ico') {
    return;
  }

  var response = 'Unrecognized request';

  // metadata requests
  if (url == '/_all/_mapping' || url == '/kibana-int/dashboard/_search' || url.match(/\/kibana-int\/dashboard\/[a-z]*?$/)) {
    console.log(url, browser_request.proxy_received.headers['content-type'], 'metadata');
    response = pageBuffer;
  // process hits
  } else if (url.match(/^\/[^\/]*?\/_search$/)) {
    try {
      json = JSON.parse(pageBuffer);

      if (json.facets) {
        if (json.facets[0] && json.facets[0]._type == 'date_histogram') { 
        } else if (json.facets.map && json.facets.map._type == 'terms') {
        } else {
          throw 'Unknown facets';
        }

      } else if (json.hits.hits) {
        if (json.hits.total > 0) {
          // test validity
          json.hits.hits[0]._source['@fields'];
          console.log(url, browser_request.proxy_received.headers['content-type'], 'search');
          var user = userMap[browser_request.headers['x-forwarded-user']], doAnon, source;
          if (user) {
            var regex = new RegExp(user.hostRegex),
              len = json.hits.hits.length,
              source;
            
            for (k = 0; k < len; k++) {
              source = json.hits.hits[k]._source;
              // presume we are anonymizing
              doAnon = true;
              if (source['@fields'].host.match(regex)) {
                doAnon = false;
              }
              if (doAnon) {
                delete source['@fields'].ip;
                delete source['@fields'].host;
                delete source['@fields'].request;
                delete source['@message'];
              }
            }
          } else {
            console.log('no usermap for', user, userMap);
          }
        }
      } else {
        throw "not hits or facets";
      }
  //      pageBuffer = pageBuffer.replace(/([0-9]{1,3}\.){3}[0-9]{1,3}/g, '<REDACTED>');
    } catch (e) {
      dumpError(e);
      console.log(url, browser_request.proxy_received.headers['content-type'], 'invalid', e); //, JSON.stringify(json, null, 2));
      json = {response: "Unrecognized request"};
    }
    response = JSON.stringify(json);
  } else {
    console.log(url, browser_request.proxy_received.headers['content-type'], 'unrecognized');
    pageBuffer = '{ message: "Unrecognized request"}';
  }

  sendPage(response, browser_request, browser_response);
};

function dumpError(err) {
  if (typeof err === 'object') {
    if (err.message) {
      console.log('\nMessage: ' + err.message)
    }
    if (err.stack) {
      console.log('\nStacktrace:')
      console.log('====================')
      console.log(err.stack);
    }
  } else {
    console.log('dumpError :: argument is not an object');
  }
}
