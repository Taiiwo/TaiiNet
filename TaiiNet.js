import { Swarm } from './Swarm.js';
import { EventBase } from './EventBase.js';
import { Subscription } from './Subscription.js';

var signallers = [
    //"ws://167.160.189.251:5000/api/1",
    "ws://localhost:5000/api/1"
];

// represents a connection to the signal server
export class TaiiNet extends EventBase {
    constructor() {
        super();
        // pass the default subscription types through for convenience
        this.Subscription = Subscription;
        // connect to a random signaller
        this.get_signaller();

        // handle messages from signal network
        this.signaller.on("message", function (message) {
            console.log(message);
            // we could handle other message types from the signaller here
            if (message.type == "signal") {
                this.trigger("signal", message);
            }
        }.bind(this));

        // when another client wants to initiate a connection with us, trigger an event
        this.signaller.on("socket_broadcast", function (socket) {
            console.log("got socket broadcast");
            this.trigger("socket", socket);
        }.bind(this));

        // create a swarm for connections made using this object
        this.swarm = new Swarm(this);
    }

    // creates a subscription object
    new(type, query, options) {
        return new type(this, this.swarm, query, options);
    }

    get_signaller(callbacks) {
        // select random signaller
        var host = signallers[Math.floor(Math.random() * signallers.length)];
        this.signaller = io(host);
        // add all the callbacks from the previous signaller
        if (callbacks) {
            this.signaller._callbacks = callbacks;
        }
        this.signaller.on("disconnect", function () {
            var callbacks = this.signaller._callbacks;
            setTimeout(function () {
                this.get_signaller(callbacks);
            }.bind(this), 1000);
        }.bind(this));
    }

    // sends a signal to the server to pass on to a specific client
    signal(to_id, data, type) {
        console.log("sending message");
        this.signaller.emit("send_message", {
            to_id: to_id,
            data: data,
            type: type
        });
    }
}

// does query match data
export function query_match_data(query, data) {
    return new mingo.Query(query).test(data);
}

function match_smart_query(q1, q2) {
    var relevancy = 1.0;
    // there were too many variables in this function to name them all, sorry :\
    // iterate the keys in the first query
    for (var k1 in q1) {
        var v1 = q1[k1];
        // iterate keys in the second query
        for (var k2 in q2) {
            var v2 = q2[k2];
            // make an array of tests to do
            var a = [
                [k1, v1, v2],
                [k2, v2, v1]
            ]
            var r = [];
            // interate the test array
            for (var i in a) {
                var d = a[i];
                // if it works with this method
                var compatible_keys;
                compatible_keys = ["$lt", "$gt", "$ne", "$eq"];
                if (compatible_keys.indexOf(d[0]) >= 0) {
                    var k = d[0];
                    r.push(query_match_data({ k: d[1] }, d[2]));
                }
            }
            if (r[0]) {
                if (r[1]) {
                    continue
                }
                relevancy /= 2;
                continue
            }
            return 0.0;
        }
    }
    return relevancy;
}

// is query1 encompassed by query2
export function match_queries(q1, q2) {
    var relevancy = 1.0
    for (var k1 in q1) {
        var v1 = q1[k1];
        if (q2[k1] != undefined) {
            // this key is in both queries
            if (typeof (q1[k1]) == "object") {
                if (typeof (q2[k1]) == "object") {
                    // both values are smart queries
                    relevancy *= match_smart_query(q1[k1], q2[k1]);
                }
                else {
                    // v1 is a query but v2 is data
                    if (query_match_data(q1[k1], q2[k1])) {
                        relevancy /= 2;
                        continue;
                    }
                    return 0.0;
                }
            }
            else {
                if (typeof (q2[k1]) == "object") {
                    // v1 is data but v2 is a query
                    if (!query_match_data(q2[k1], q1[k1])) {
                        return 0.0;
                    }
                    continue;
                }
                else {
                    // both values are data
                    if (q1[k1] != q2[k1]) {
                        return 0.0;
                    }
                    continue;
                }
            }
        }
    }
    // for each key q2 has that q1 doesn't, lower relevancy
    for (var k2 in q2) {
        if (q1[k2] == undefined) {
            relevancy /= 2;
        }
    }
    return relevancy;
}
