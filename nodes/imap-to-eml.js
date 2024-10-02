module.exports = function(RED) {
    "use strict";

    var fs = require('fs'), fileStream;
    var Imap = require('imap'),
    inspect = require('util').inspect;

    // The main node definition
    function EmapToEmlNode(n) {
        // Create a RED node
        RED.nodes.createNode(this,n);

        // Store local copies of the node configuration
        this.options = {
            useTLS: n.useTLS || true,
            server: n.server,
            port: n.port,
            box: n.box,
            disposition: n.disposition,
            criteria: n.criteria,
            openReadOnly: n.disposition == 'Read' ? false : true 
        };

        console.log(this.options);

        // copy "this" object
        var node = this;
        var busy = false;
        var startTime;

        var imap;

        function connect(){
          if(checkBusy()){
            node.status({fill:"yellow",shape:"dot",text:"busy"});
            return;
          }
          node.status({fill:"yellow",shape:"dot",text:"connecting..."});
          setBusy();
          imap = new Imap({
            user: node.credentials.userid,
            password: node.credentials.password,
            host: node.options.server,
            tlsOptions: {'servername': node.options.server},
            port: node.options.port,
            tls: node.options.useTLS
            });
  
          imap.once('ready', function() {
            console.log('Connection ready');
            readFromImap();
            node.status({fill:"green",shape:"dot",text:"connected"});
          });
            
          imap.once('error', function(err) {
            console.log('Connection error');
            console.log(err);
            endConnection();
            node.status({fill:"green",shape:"dot",text:"error"});
          });
            
          imap.once('end', function() {
            console.log('Connection ended');
            node.status({});
          });

          imap.connect();
        }

        function setBusy(){
          busy = true;
          startTime = Date.now();
        }

        function checkBusy(){
          var checkTime = Date.now();
          if((checkTime - startTime) > (1000 * 60 * 5)){
            busy = false;
          }
          return busy;
        }

        function endConnection(){
          busy = false;
          imap.end();
        }

        function openInbox(cb) {
            imap.openBox(node.options.box, node.options.openReadOnly, cb);
        }

        function readFromImap(){
          
          if(imap.state != 'authenticated'){
            node.status({fill:"red",shape:"dot",text:"not authenticated: " + imap.state});
            return;
          }
          
          node.status({fill:"green",shape:"dot",text:"reading..."});
          openInbox(function(err, box) {
            if (err) {
              endConnection();
              throw err;
            }

            var criteria = [ node.options.criteria ];
            if(criteria == '_msg_'){
              var criteria = node.savedMsg.criteria || [];
            }

            imap.search(criteria, function(err, results) {

              var count = results? results.length : 0;
              node.status({fill:"green",shape:"dot",text:"email found: " + count});

              if(results == null || results.length == 0) {
                endConnection();
                return;
              }

              var f = imap.fetch(results, { bodies: '' , markSeen: true});
              f.on('message', function(msg, seqno) {
                  console.log('Message #%d', seqno);
                  
                  var prefix = '(#' + seqno + ') ';
                  msg.on('body', function(stream, info) {
                    console.log(prefix + 'Body');
  
                    let fileContent = '';
  
                    // Evento che gestisce i chunks di dati
                    stream.on('data', chunk => {
                        fileContent += chunk; // Concatenare i chunks
                    });
  
                    // Evento che viene emesso quando lo stream è finito
                    stream.on('end', () => {
                        node.savedMsg.payload = fileContent;
                        node.send(node.savedMsg);
                    });
  
                    // stream.pipe(fs.createWriteStream('msg-' + seqno + '-body.eml'));
                  });
                  msg.once('attributes', function(attrs) {
                    console.log(prefix + 'Attributes: %s', inspect(attrs, false, 8));
                  });
                  msg.once('end', function() {
                    console.log(prefix + 'Finished');
                  });
                });
                f.once('error', function(err) {
                  endConnection();
                  console.log('Fetch error: ' + err);
                });
                f.once('end', function() {
                  console.log('Done fetching all messages!');
                  endConnection();
                });
            });
            
            
          });
        }
        
        // Respond to inputs...
        this.on('input', function (msg) {
            node.savedMsg = msg;
            connect()
        });

        // Called when the node is shutdown - eg on redeploy.
        // Allows ports to be closed, connections dropped etc.
        this.on("close", function() {
            node.status({});
            endConnection();
        });
    }

    // Register the node
    RED.nodes.registerType("imap-to-eml",EmapToEmlNode, {
      credentials: {
        userid: {type:"text"},
        password: {type: "password"}
      }
  });

};