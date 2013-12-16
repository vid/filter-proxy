var cp = require('./index.js');
var censor = require('./kibana-es-filter.js');
cp.start({ editPost : filter, processor: filter, reverseProxyRoutes : { 'pubaddress' : { host: 'privaddress', port : 9200}}});

