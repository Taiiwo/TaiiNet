# TaiiNet
Fully decentralized peer to peer mesh networking for the browser. Currently
WebRTC applications are not decentralized as they require a central signal
server with access to all the nodes. There is also the scaling problem: When an
application has enough peer connections in series, there comes a point where
sending one message to the whole network becomes expensive and slow.

TaiiNet solves these problems by using mesh networking for the signalling nodes
and WebRTC data channels. Imagine a database that could handle more traffic
the more people used it. Totally trustless, everyone that uses the database
becomes a part of the distribution network.

## Decentralized Signalling
TaiiNet uses a normal SocketIO-based signal server, with the exception that the
signallers pool together in a mesh network to spread access to clients across
multiple interchangeable entry points.

## Mesh Networking
Instead of having each client connected to each other client, mesh networking
reduces the number of client connections to just a handful.
When you want to send a message to any number of clients across the network,
simply tell all the client's you're connected to, and they'll pass the message
on around the network to everyone who's interested.

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

// send some data to interested clients (proxying through other peers)
sub.send({
  key: "value",
  age: 5,
  name: "aaa",
  type: 4
});
```

## Video/Audio Streaming (Yes, like decentralized Twitch)

> Note: this feature is not implemented at all, but I wanted to outline it
> because I think it really brings up the value of the project.

This network communicates via RTCDataChannels, which are optimised for video
and audio streaming. Using this network, it's possible to create a daisy chain
of datachannels, allowing theoretically infinite users to view the same live
video and audio feed with small gradually increasing delay. Peers that offer the
most uplinks would receive the video first, (Peers that don't have any uplinks
will be removed for DoS prevention), and distribute the video down the chain,
again (recommending high uplink peers to it's parent peer for consideration).

This could also be used for group conferencing of larger numbers than standard
WebRTC connections due to the more efficient distribution of stream uploading.

## ToDo:
- Improve mesh networking algorithm
- Create a script for people to seed data outside of the browser
- Test network stability
- Implement public-private key encryption
- Test network security
- Create demo application for showcasing
- Implement video/audio streaming

## Getting Started

To install and run the TaiiNet demo run:

```bash
sudo pip install -r requirements.txt
python signaler.py
```
Then open one of the demo html files!

## Disclaimer
TaiiNet is in active development. Everything is subject to change until release.
This is quite an ambitious project, and I'm only one person, so pull requests
are welcome
