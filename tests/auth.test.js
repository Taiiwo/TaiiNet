import test from 'node:test';
import assert from 'node:assert/strict';

function get_path(object, path) {
    var parts = path.split(".");
    var current = object;
    for (var i = 0; i < parts.length; i++) {
        if (current == undefined) {
            return undefined;
        }
        current = current[parts[i]];
    }
    return current;
}

function matches(query, data) {
    for (var key in query) {
        var expected = query[key];
        var actual = key.indexOf(".") >= 0 ? get_path(data, key) : data[key];
        if (expected != null && typeof (expected) == "object" && Array.isArray(expected) == false) {
            if (expected.$eq != undefined && actual != expected.$eq) {
                return false;
            }
            if (expected.$ne != undefined && actual == expected.$ne) {
                return false;
            }
            if (expected.$gt != undefined && !(actual > expected.$gt)) {
                return false;
            }
            if (expected.$lt != undefined && !(actual < expected.$lt)) {
                return false;
            }
            continue;
        }
        if (actual != expected) {
            return false;
        }
    }
    return true;
}

globalThis.mingo = {
    Query: class {
        constructor(query) {
            this.query = query;
        }

        test(data) {
            return matches(this.query, data);
        }
    }
};

const { TaiiNetAuth } = await import('/tmp/workspace/Taiiwo/TaiiNet/Auth.js');
const { createTaiiNetAuthHooks } = await import('/tmp/workspace/Taiiwo/TaiiNet/TaiiNetAuthReact.js');
const { query_match_data } = await import('/tmp/workspace/Taiiwo/TaiiNet/TaiiNet.js');
const { Subscription } = await import('/tmp/workspace/Taiiwo/TaiiNet/Subscription.js');

function create_stub_signaller() {
    return {
        emit() { },
        on() { }
    };
}

function create_stub_swarm() {
    return {
        all_peers: {},
        on() { },
        send_calls: [],
        send(data) {
            this.send_calls.push(data);
        }
    };
}

test('createIdentity registers username lookups', async function () {
    var auth = new TaiiNetAuth();
    var state = await auth.createIdentity("alice");

    assert.equal(state.username, "alice");
    assert.equal(auth.lookupUsernameByPublicKey(state.identity.publicKeys.signing), "alice");
    assert.deepEqual(auth.lookupPublicKeysByUsername("alice"), {
        owner: state.identity.publicKeys.signing,
        ownerEncryption: state.identity.publicKeys.encryption,
        primary: state.device.publicKeys.signing,
        primaryEncryption: state.device.publicKeys.encryption
    });
});

test('sealMessage and openMessage preserve signed payloads', async function () {
    var auth = new TaiiNetAuth();
    await auth.createIdentity("alice");

    var envelope = await auth.sealMessage({ text: "hello" }, { sign: true });
    var opened = await auth.openMessage(envelope);

    assert.equal(opened.authenticated, true);
    assert.equal(opened.verified, true);
    assert.deepEqual(opened.data, { text: "hello" });
    assert.equal(opened.username, "alice");
});

test('encrypted messages can be filtered by public key and decrypted by recipients', async function () {
    var alice = new TaiiNetAuth();
    var bob = new TaiiNetAuth();
    await alice.createIdentity("alice");
    await bob.createIdentity("bob");

    var bob_public_keys = bob.getState().identity.publicKeys;
    var envelope = await alice.sealMessage({ text: "secret" }, {
        encryptFor: [bob_public_keys.encryption]
    });
    var alice_public_key = alice.getState().identity.publicKeys.signing;

    assert.equal(query_match_data({
        "auth.publicKeys.owner": alice_public_key
    }, envelope), true);

    var opened = await bob.openMessage(envelope);
    assert.equal(opened.encrypted, true);
    assert.deepEqual(opened.data, { text: "secret" });
});

test('device transfer tokens import signed sub keys on another device', async function () {
    var primary = new TaiiNetAuth();
    await primary.createIdentity("alice");

    var token = await primary.createDeviceToken({ name: "phone" });
    var secondary = new TaiiNetAuth();
    var state = await secondary.importDeviceToken(token);

    assert.equal(state.username, "alice");
    assert.notEqual(state.device.publicKeys.signing, state.identity.publicKeys.signing);
    assert.equal(secondary.lookupUsernameByPublicKey(state.device.publicKeys.signing), "alice");
});

test('tampered device tokens are rejected', async function () {
    var primary = new TaiiNetAuth();
    await primary.createIdentity("alice");
    var token = await primary.createDeviceToken({ name: "tablet" });
    var tampered = JSON.parse(Buffer.from(token.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    tampered.payload.deviceName = "attacker";
    var tampered_token = Buffer.from(JSON.stringify(tampered), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

    var secondary = new TaiiNetAuth();
    await assert.rejects(function () {
        return secondary.importDeviceToken(tampered_token);
    }, /invalid/);
});

test('Subscription.sendSecure wraps outgoing payloads in auth envelopes', async function () {
    var auth = new TaiiNetAuth();
    await auth.createIdentity("alice");
    var swarm = create_stub_swarm();
    var subscription = new Subscription({
        auth: auth,
        signaller: create_stub_signaller()
    }, swarm, { room: "general" }, {});

    var envelope = await subscription.sendSecure({ text: "hello" }, { sign: true });

    assert.equal(swarm.send_calls.length, 1);
    assert.deepEqual(swarm.send_calls[0], envelope);
    assert.equal(envelope.auth.publicKeys.owner, auth.getState().identity.publicKeys.signing);
});

test('Subscription.handle_data emits decrypted auth payloads', async function () {
    var alice = new TaiiNetAuth();
    var bob = new TaiiNetAuth();
    await alice.createIdentity("alice");
    await bob.createIdentity("bob");
    var subscription = new Subscription({
        auth: bob,
        signaller: create_stub_signaller()
    }, create_stub_swarm(), {}, {});
    var envelope = await alice.sealMessage({ text: "for bob" }, {
        encryptFor: [bob.getState().identity.publicKeys.encryption]
    });
    var received_payload = null;
    var received_auth = null;
    subscription.on("data", function (data, e, auth_message) {
        received_payload = data;
        received_auth = auth_message;
    });

    await subscription.handle_data({ data: envelope }, {});

    assert.deepEqual(received_payload, { text: "for bob" });
    assert.equal(received_auth.verified, true);
    assert.equal(received_auth.username, "alice");
});

test('createTaiiNetAuthHooks exposes auth state and actions', async function () {
    var auth = new TaiiNetAuth();
    await auth.createIdentity("alice");
    var subscribers = [];
    var React = {
        useSyncExternalStore(subscribe, get_snapshot) {
            subscribers.push(subscribe);
            return get_snapshot();
        },
        useMemo(factory) {
            return factory();
        }
    };

    var hooks = createTaiiNetAuthHooks(React, auth);
    var result = hooks.useTaiiNetAuth();

    assert.equal(result.username, "alice");
    assert.equal(typeof (result.createDeviceToken), "function");
    assert.equal(typeof (subscribers[0](function () { })), "function");
});

