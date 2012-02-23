// config file, you might want to exclude this file in .gitignore to keep confidential data
var config = require('./config.js');

// include required node modules
var url     = require('url'),
    https   = require('https'),
    // a customized faye module for Salesforce
    // an addition of single line in faye-node.js at line 2805
    faye    = require('./faye'), 
    request = require('request');

// fayeServer - a Bayeux server - is mounted at /cometd
var fayeServer = new faye.NodeAdapter({mount: '/cometd', timeout: 60 });

// Handle non-Bayeux requests
var server = http.createServer(function(request, response) {
  response.writeHead(200, {'Content-Type': 'text/plain'});
  response.write('Welcome to QuizVille Cometd server. It is mounted at /cometd.');
  response.end();
});

fayeServer.attach(server);
server.listen(config.PORT);

// get Salesforce OAuth Token for access to APIs
function getOAuthToken(callback) {
	var token_request = 'grant_type=password&client_id=' + config.CLIENT_ID + 
	'&client_secret=' + config.CLIENT_SECRET + '&username=' + config.USERNAME + 
	'&password=' + config.PASSWORD;
	
	if(config.DEBUG) console.log('Sending token request '+ token_request);
	
  request.post({
      uri: config.LOGIN_SERVER + '/services/oauth2/token', 
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded' 
      }, 
      body: token_request
  }, function (error, response, body) {
    // callback function after the post call
		if ( response.statusCode == 200 ) {
	    callback(JSON.parse(body));
		} else {
		  if(config.DEBUG) console.log('Error '+response.statusCode+' '+body+' '+error);
		}
  });	
}

// Get an OAuth token - after receiving subscribe upstream from Salesforce
// upon receiving messages from upstream, push messages downstream
getOAuthToken(function(oauth) {
  if(config.DEBUG) console.log('Got token '+ oauth.access_token);
  
  var salesforce_endpoint = oauth.instance_url +'/cometd/24.0';

  if(config.DEBUG) console.log("Creating a client for "+ salesforce_endpoint);
  var upstreamClient = new faye.Client(salesforce_endpoint);

  // Pass on access_token to be added to header, and debug I/O
  upstreamClient.addExtension({
    outgoing: function(message, callback) {   
      if(config.DEBUG) console.log('OUT >>> '+ JSON.stringify(message));
       
      message.access_token = oauth.access_token;

      callback(message);            
    },
    incoming: function(message, callback) {   
      if(config.DEBUG) console.log('IN >>>> '+ JSON.stringify(message));
      
      callback(message);            
    }            
  });
  
  // start downstreamClient to publish messages
  var downstreamClient = fayeServer.getClient();
  
  if(config.DEBUG) console.log('Subscribing to '+ config.PUSH_TOPIC);
  var upstreamSub = upstreamClient.subscribe(config.PUSH_TOPIC, function(message) {
    if(config.DEBUG) console.log("Received upstream message: " + JSON.stringify(message));
    
    // publish back to downstream - organized by Quick_Quiz__c.Name
    downstreamClient.publish('/q/'+ message.Name, message);    
  });
  
  upstreamSub.callback(function() {
    if(config.DEBUG) console.log('Upstream subscription is now active');    
  });
  
  upstreamSub.errback(function(error) {
    if(config.DEBUG) console.error("ERROR ON Upstream subscription Attempt: " + error.message);
  });  
}); // end getOAuthToken