import json
from flask import Flask, request
from flask_socketio import SocketIO, emit
from socketIO_client import SocketIO as SocketIO_client
from socketIO_client import BaseNamespace
import node_discovery
import eventlet
import sys

# eventlet.monkey_patch()
our_url = "£.ga:5000"  # if connecting to other nodes, write your hostname here
nodes = [
    # List of nodes to updates and receive updates from
]


class ThisIsDumb(BaseNamespace):
    pass


app = Flask(__name__)
socket = SocketIO(app, cors_allowed_origins="*")
# List of connected clients by query {query: [socket ids...]...}
socket_ids = []

print(nodes)

node_sockets = []
for node in nodes:
    print("connecting to " + node[0])
    node_socket = SocketIO_client(node[0], node[1])
    print("done")
    api_namespace = node_socket.define(ThisIsDumb, "/api/1")
    node_socket.emit("add_signaller", {"host": our_url})
    node_sockets.append(api_namespace)


@socket.on("add_signaller")
def add_signaller(signaller):
    print("adding signaller")
    node_socket = SocketIO_client(signaller["host"])
    print("a")
    api_namespace = node_socket.define(ThisIsDumb, "/api/1")
    node_sockets.append(api_namespace)


"""
Adds an array of web sockets to the signal network
"""


@socket.on("socket_broadcast", namespace="/api/1")
def socket_broadcast(socket_data):
    print("socket_broadcast")
    """
    socket_data_example = [{
        "query": data query
    }]
    """
    for sock in socket_data:
        print(sock)
        # subscribe the socket to future updates
        query_uid = json.dumps(sock["query"])
        if not query_uid in socket_subscribers:
            socket_subscribers[query_uid] = []
        socket_ids.append(request.sid)
        # append value if we don't already have it
        if request.sid not in socket_subscribers[query_uid]:
            # update all the socket subscribers that match this query
            for query in socket_subscribers:
                relevancy = node_discovery.match_queries(
                    json.loads(query), sock["query"]
                )
                if relevancy:
                    for socket_id in socket_subscribers[query]:
                        if socket_id == request.sid:
                            continue
                        emit(
                            "socket_broadcast",
                            {
                                "id": request.sid,
                                "query": sock["query"],
                                "relevancy": relevancy,
                            },
                            room=socket_id,
                        )
            socket_subscribers[query_uid].append(request.sid)
            # update the other signaller nodes
            for node_socket in node_sockets:
                node_socket.emit("socket_broadcast", [sock])
    return "1"


"""
sends a message to a specified socket
"""
messages_received = []


@socket.on("send_message", namespace="/api/1")
def answer_broadcast(message_data):
    """
    message_data_example = {
        "data": data to be sent to the recipient,
        "to_id": socket id of the recipient,
        "nonce": an nonce value to make your message unique
    }
    """
    # only accept each message once
    if json.dumps(message_data) in messages_received:
        return False
    else:
        messages_received.append(json.dumps(message_data))
    message_data["from_id"] = request.sid
    print(message_data)
    print(socket_subscribers)
    if message_data["to_id"] in socket_ids:
        # the recipient is a child of this node
        emit("message", message_data, room=message_data["to_id"])
    else:
        # we don't have the recipient as a child, rebroadcast to other nodes
        for node_socket in node_sockets:
            print("sending messages to peers")
            node_socket.emit("send_message", message_data)
    return 1


"""
Subscribes to sockets responding to a subset of the given query
"""
socket_subscribers = {}


def remove_socket(sid):
    for query in socket_subscribers:
        for socket_id in socket_subscribers[query]:
            if socket_id == sid:
                socket_subscribers[query].remove(socket_id)


@socket.on("disconnect", namespace="/api/1")
def disconnect():
    print("@@@@@@@ client disconnected @@@@@@@@@@@")
    # remove all the references to this socket
    remove_socket(request.sid)


if __name__ == "__main__":
    socket.run(app, debug=True, host="0.0.0.0")
