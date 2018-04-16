import json
from flask import Flask, request
from flask_socketio import SocketIO, emit
from socketIO_client import SocketIO as SocketIO_client
import node_discovery
import eventlet
eventlet.monkey_patch()

nodes = [
    # List of nodes to updates and receive updates from
]
node_sockets = [SocketIO_client(node) for node in nodes]

app = Flask(__name__)
socket = SocketIO(app)
# List of connected clients by query {query: [socket ids...]...}
socket_collection = {}
socket_ids = []

"""
Adds an array of web sockets to the signal network
"""
@socket.on("socket_broadcast", namespace="/api/1")
def socket_broadcast(socket_data):
    print("socket_broadcast")
    """
    socket_data_example = [{
        "query": data query,
        "id": socket_id
    }]
    """
    new = False
    for sock in socket_data:
        print(sock)
        query = json.dumps(sock["query"])
        # create key if not exists
        if not query in socket_collection:
            socket_collection[query] = []
        # append value if we don't already have it
        if sock["id"] not in socket_collection[query]:
            socket_collection[query].append(sock["id"])
            socket_ids.append(sock["id"])
            new = True
            # update all the socket subscribers that match this query
            for query in socket_subscribers:
                relevancy = node_discovery.match_queries(json.loads(query),
                                                         sock["query"])
                if relevancy:
                    for socket_id in socket_subscribers[query]:
                        emit("socket_broadcast", {
                            "id": sock["id"],
                            "query": sock["query"],
                            "relevancy": relevancy
                        }, room=socket_id)
            # update the other signaller nodes
            for node_socket in node_sockets:
                node_socket.emit("socket_broadcast", [sock])
    return 1

"""
sends a message to a specified socket
"""
messages_received = []
@socket.on("send_message", namespace="/api/1")
def answer_broadcast(message_data):
    print("send_message")
    """
    message_data_example = {
        "data": data to be sent to the recipient,
        "to_id": socket id of the recipient,
        "from_id": origin socket id of the sender,
        "nonce": an nonce value to make your message unique
    }
    """
    # only accept each message once
    if json.dumps(message_data) in messages_received:
        return False
    else:
        messages_received.append(json.dumps(message_data))
    if message_data["to_id"] in socket_ids:
        # the recipient is a child of this node
        print(message_data)
        emit("message", message_data, room=message_data["to_id"][7:])
    else:
        # we don't have the recipient as a child, rebroadcast to other nodes
        for node_socket in node_sockets:
            node_socket.emit("send_message", message_data)
    return 1

"""
Subscribes to sockets responding to a subset of the given query
"""
socket_subscribers = {}
@socket.on("get_sockets", namespace="/api/1")
def get_sockets(request_data):
    print("get_sockets")
    """
    request_data_example = {
        "query": query to match
    }
    """
    # subscribe the socket to future updates
    if not json.dumps(request_data["query"]) in socket_subscribers:
        socket_subscribers[json.dumps(request_data["query"])] = []
    socket_subscribers[json.dumps(request_data["query"])].append(request.sid)
    # send the socket all the existing matching connections we have
    """
    for query in socket_collection:
        relevancy = node_discovery.match_queries(request_data["query"],
                                                    json.loads(query))
        if relevancy:
            sockets = socket_collection[query]
            for socket in sockets:
                emit("socket_broadcast", {
                    "id": socket,
                    "query": query,
                    "relevancy": relevancy
                });
    """
    return 1

def remove_socket(sid):
    for query in socket_collection:
        for socket_id in socket_collection[query]:
            if socket_id == sid:
                socket_collection[query].remove(socket_id)

    for query in socket_subscribers:
        for socket_id in socket_subscribers[query]:
            if socket_id == sid:
                socket_subscribers[query].remove(socket_id)

@socket.on('disconnect', namespace="/api/1")
def disconnect():
    print("@@@@@@@ client disconnected @@@@@@@@@@@")
    # remove all the references to this socket
    remove_socket(request.sid)

if __name__ == '__main__':
    socket.run(app, debug=False, host="0.0.0.0")
