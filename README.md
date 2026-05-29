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

## React Hook API
TaiiNet is now consumed through the `useTaiiNet` React hook.

```tsx
import { useEffect } from "react";
import { useTaiiNet } from "taiinet";

export function Feed() {
  const { subscribe, signals, connectedPeers } = useTaiiNet({
    signallers: ["ws://localhost:5000/api/1"],
  });

  useEffect(() => {
    const { subscription, unsubscribe } = subscribe(
      {
        type: "tweet",
        age: { $gt: 4 },
      },
      { backlog: true },
      {
        onData: (payload) => {
          console.log("Received", payload);
        },
      },
    );

    subscription.send({
      type: "tweet",
      age: 5,
      body: "hello network",
    });

    return unsubscribe;
  }, [subscribe]);

  return (
    <div>
      <p>Signals seen: {signals.length}</p>
      <p>Connected peers: {connectedPeers.length}</p>
    </div>
  );
}
```

### Hook return values

- `client`: underlying `TaiiNet` client instance
- `signals`: all incoming signal messages from the signaller
- `sockets`: all received socket broadcasts
- `connectedPeers`: currently connected swarm peers
- `signal(toId, data, type)`: send raw signaller message
- `createSubscription(query, options)`: create a subscription instance
- `subscribe(query, options, handlers)`: create a subscription with event handlers and an `unsubscribe` callback
- `send(data, subscription?)`: send using a subscription (or directly to the swarm when no subscription is passed)

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

## TypeScript module

TaiiNet now ships as a TypeScript package with typed ESM exports.

### Install dependencies

```bash
npm install
```

### Build the library

```bash
npm run build
```

### Run the test suite

```bash
npm test
```

The compiled module is written to `dist/` and exports `useTaiiNet`,
`TaiiNet`, `Subscription`, `BacklogSubscription`, `Swarm`,
`EventBase`, `query_match_data`, and `match_queries`.

## Legacy demo signal server

To install and run the bundled signalling demo:

```bash
pip install -r requirements.txt
python signaler.py
```

Then open one of the demo html files.

## Disclaimer
TaiiNet is in active development. Everything is subject to change until release.
This is quite an ambitious project, and I'm only one person, so pull requests
are welcome
