# TaiiNet
Fully decentralized peer to peer mesh networking for the browser. Currently
WebRTC applications are not decentralized as they require a central signal
server with access to all the nodes. There is also the scaling problem: When an
application has enough peer connections in series, there comes a point where
sending one message to the whole network becomes expensive and slow.

## Decentralized Signalling
TaiiNet uses a normal SocketIO-based signal server, with the exception that the
signallers pool together in a mesh network to spread access to clients across
multiple entry points.

## Mesh Networking
Mesh networking does not reduce total network bandwidth usage, but it spreads it
across the network so distribution forks off and resolves in parallel.
![mesh vs trad](https://tucu.ca/wp-content/uploads/2014/02/traditional-WiFI-vs-mesh-WiFI-network.png)

## Simple to Use
TaiiNet can be used just like a database, only it scales automatically.

```javascript
// connect to the signallers
var taiinet = new TaiiNet();

// get updates to data that matches a query
var sub = taiinet.subscribe({
  key: "value", // only data where data[key] == "value"
  age: {$gt: 4}, // smart queries, that's right!
  $and: [
    $or: [
      name: {$contains: "b"},
      name: {$contains: "a"}
    ],
    type: {$in: [1, 4, 5]}
  ]
});

// when anyone on the network sends data that matches our query
sub.on("data", function(e) {
  console.log(e.data);
})

// send some data to the whole network (proxying through other peers)
sub.send({
  key: "value",
  age: 5,
  name: "aaa",
  type: 4
});
```
