const WebSocketServer = require('ws').Server
 
const wss = new WebSocketServer({ port: 9090 })

let client

wss.on("connection", ws => {
  console.log("Client connected!")
  client = ws
});

console.log("WS server listening on :9090")

const broadcast = (message) => {
  console.log(`Broadcasting: ${message}`)
  client.send(message)
}

module.exports.broadcast = broadcast
