import { EventBase } from './EventBase.js';

var text_encoder = new TextEncoder();
var text_decoder = new TextDecoder();

function ensure_crypto() {
    if (globalThis.crypto == undefined || globalThis.crypto.subtle == undefined) {
        throw new Error("Web Crypto support is required for TaiiNet authentication");
    }
    return globalThis.crypto.subtle;
}

function is_plain_object(value) {
    return value != null && typeof (value) == "object" && Array.isArray(value) == false;
}

function sort_value(value) {
    if (Array.isArray(value)) {
        return value.map(sort_value);
    }
    if (is_plain_object(value)) {
        var sorted = {};
        Object.keys(value).sort().forEach(function (key) {
            sorted[key] = sort_value(value[key]);
        });
        return sorted;
    }
    return value;
}

function stable_stringify(value) {
    return JSON.stringify(sort_value(value));
}

function array_buffer_to_base64url(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = "";
    for (var i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    if (typeof (btoa) == "function") {
        return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    }
    return Buffer.from(binary, "binary").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64url_to_uint8array(value) {
    var padded = value.replace(/-/g, "+").replace(/_/g, "/");
    while (padded.length % 4 != 0) {
        padded += "=";
    }
    var binary;
    if (typeof (atob) == "function") {
        binary = atob(padded);
    }
    else {
        binary = Buffer.from(padded, "base64").toString("binary");
    }
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function utf8_bytes(value) {
    return text_encoder.encode(value);
}

function clone_json(value) {
    return JSON.parse(JSON.stringify(value));
}

async function generate_signing_keys() {
    return ensure_crypto().generateKey({
        name: "ECDSA",
        namedCurve: "P-256"
    }, true, ["sign", "verify"]);
}

async function generate_encryption_keys() {
    return ensure_crypto().generateKey({
        name: "ECDH",
        namedCurve: "P-256"
    }, true, ["deriveBits"]);
}

async function export_public_key(key) {
    return array_buffer_to_base64url(await ensure_crypto().exportKey("spki", key));
}

async function export_private_key(key) {
    return array_buffer_to_base64url(await ensure_crypto().exportKey("pkcs8", key));
}

async function import_signing_public_key(serialized_key) {
    return ensure_crypto().importKey("spki", base64url_to_uint8array(serialized_key), {
        name: "ECDSA",
        namedCurve: "P-256"
    }, true, ["verify"]);
}

async function import_signing_private_key(serialized_key) {
    return ensure_crypto().importKey("pkcs8", base64url_to_uint8array(serialized_key), {
        name: "ECDSA",
        namedCurve: "P-256"
    }, true, ["sign"]);
}

async function import_encryption_public_key(serialized_key) {
    return ensure_crypto().importKey("spki", base64url_to_uint8array(serialized_key), {
        name: "ECDH",
        namedCurve: "P-256"
    }, true, []);
}

async function import_encryption_private_key(serialized_key) {
    return ensure_crypto().importKey("pkcs8", base64url_to_uint8array(serialized_key), {
        name: "ECDH",
        namedCurve: "P-256"
    }, true, ["deriveBits"]);
}

async function export_key_pair(key_pair) {
    return {
        publicKey: await export_public_key(key_pair.publicKey),
        privateKey: await export_private_key(key_pair.privateKey)
    };
}

async function serialize_key_material(signing_keys, encryption_keys) {
    return {
        signing: await export_key_pair(signing_keys),
        encryption: await export_key_pair(encryption_keys)
    };
}

async function import_key_material(serialized_keys) {
    return {
        signing: {
            publicKey: await import_signing_public_key(serialized_keys.signing.publicKey),
            privateKey: await import_signing_private_key(serialized_keys.signing.privateKey)
        },
        encryption: {
            publicKey: await import_encryption_public_key(serialized_keys.encryption.publicKey),
            privateKey: await import_encryption_private_key(serialized_keys.encryption.privateKey)
        }
    };
}

async function sign_value(private_key, value) {
    var payload = utf8_bytes(stable_stringify(value));
    var signature = await ensure_crypto().sign({
        name: "ECDSA",
        hash: "SHA-256"
    }, private_key, payload);
    return array_buffer_to_base64url(signature);
}

async function verify_value(public_key, value, signature) {
    return ensure_crypto().verify({
        name: "ECDSA",
        hash: "SHA-256"
    }, public_key, base64url_to_uint8array(signature), utf8_bytes(stable_stringify(value)));
}

async function derive_shared_key(private_key, public_key) {
    var shared_secret = await ensure_crypto().deriveBits({
        name: "ECDH",
        public: public_key
    }, private_key, 256);
    return ensure_crypto().importKey("raw", shared_secret, {
        name: "AES-GCM"
    }, false, ["encrypt", "decrypt"]);
}

function random_iv() {
    return globalThis.crypto.getRandomValues(new Uint8Array(12));
}

async function encrypt_bytes(key, value) {
    var iv = random_iv();
    var encrypted = await ensure_crypto().encrypt({
        name: "AES-GCM",
        iv: iv
    }, key, value);
    return {
        iv: array_buffer_to_base64url(iv),
        data: array_buffer_to_base64url(encrypted)
    };
}

async function decrypt_bytes(key, payload) {
    return new Uint8Array(await ensure_crypto().decrypt({
        name: "AES-GCM",
        iv: base64url_to_uint8array(payload.iv)
    }, key, base64url_to_uint8array(payload.data)));
}

async function create_content_key() {
    var value = globalThis.crypto.getRandomValues(new Uint8Array(32));
    return {
        bytes: value,
        cryptoKey: await ensure_crypto().importKey("raw", value, {
            name: "AES-GCM"
        }, false, ["encrypt", "decrypt"])
    };
}

async function encrypt_payload(payload, sender_keys, recipient_public_keys) {
    var content_key = await create_content_key();
    var encrypted_payload = await encrypt_bytes(content_key.cryptoKey, utf8_bytes(JSON.stringify(payload)));
    var wrapped_keys = [];

    for (var i = 0; i < recipient_public_keys.length; i++) {
        var recipient = recipient_public_keys[i];
        var public_key = recipient.publicKey || recipient;
        var imported_public_key = await import_encryption_public_key(public_key);
        var wrapping_key = await derive_shared_key(sender_keys.privateKey, imported_public_key);
        wrapped_keys.push({
            publicKey: public_key,
            wrappedKey: await encrypt_bytes(wrapping_key, content_key.bytes)
        });
    }

    return {
        senderPublicKey: await export_public_key(sender_keys.publicKey),
        recipients: wrapped_keys,
        payload: encrypted_payload
    };
}

async function decrypt_payload(payload, recipient_keys) {
    var recipient_public_key = await export_public_key(recipient_keys.publicKey);
    var wrapped_key = null;
    for (var i = 0; i < payload.recipients.length; i++) {
        if (payload.recipients[i].publicKey == recipient_public_key) {
            wrapped_key = payload.recipients[i].wrappedKey;
            break;
        }
    }
    if (wrapped_key == null) {
        throw new Error("Message was not encrypted for this device");
    }

    var sender_public_key = await import_encryption_public_key(payload.senderPublicKey);
    var wrapping_key = await derive_shared_key(recipient_keys.privateKey, sender_public_key);
    var content_key_bytes = await decrypt_bytes(wrapping_key, wrapped_key);
    var content_key = await ensure_crypto().importKey("raw", content_key_bytes, {
        name: "AES-GCM"
    }, false, ["decrypt"]);
    var decrypted_payload = await decrypt_bytes(content_key, payload.payload);
    return JSON.parse(text_decoder.decode(decrypted_payload));
}

function build_state(auth) {
    return {
        username: auth.username,
        identity: auth.identity == null ? null : clone_json(auth.identity),
        device: auth.device == null ? null : clone_json(auth.device),
        registry: clone_json(auth.registry)
    };
}

export function is_auth_envelope(value) {
    return is_plain_object(value) && is_plain_object(value.auth) && value.auth.version == 1;
}

export class TaiiNetAuth extends EventBase {
    constructor() {
        super();
        this.registry = {
            usernames: {},
            publicKeys: {}
        };
        this.username = null;
        this.identity = null;
        this.device = null;
    }

    emit_change() {
        this.trigger("change", this.getState());
    }

    getState() {
        return build_state(this);
    }

    registerUsername(username, registration) {
        var record = clone_json(registration);
        record.username = username;
        this.registry.usernames[username] = record;
        for (var i in record.publicKeys) {
            this.registry.publicKeys[record.publicKeys[i]] = username;
        }
        this.emit_change();
        return clone_json(record);
    }

    lookupUsernameByPublicKey(public_key) {
        return this.registry.publicKeys[public_key] || null;
    }

    lookupPublicKeysByUsername(username) {
        if (this.registry.usernames[username] == undefined) {
            return null;
        }
        return clone_json(this.registry.usernames[username].publicKeys);
    }

    async createIdentity(username) {
        var signing_keys = await generate_signing_keys();
        var encryption_keys = await generate_encryption_keys();
        var serialized_keys = await serialize_key_material(signing_keys, encryption_keys);

        this.username = username;
        this.identity = {
            username: username,
            publicKeys: {
                signing: serialized_keys.signing.publicKey,
                encryption: serialized_keys.encryption.publicKey
            }
        };
        this.device = {
            name: "primary",
            ownerPublicKey: serialized_keys.signing.publicKey,
            publicKeys: {
                signing: serialized_keys.signing.publicKey,
                encryption: serialized_keys.encryption.publicKey
            },
            keys: {
                signing: signing_keys,
                encryption: encryption_keys
            }
        };
        this.registerUsername(username, {
            publicKeys: {
                owner: serialized_keys.signing.publicKey,
                ownerEncryption: serialized_keys.encryption.publicKey,
                primary: serialized_keys.signing.publicKey,
                primaryEncryption: serialized_keys.encryption.publicKey
            }
        });
        this.emit_change();
        return this.getState();
    }

    async createDeviceToken(options) {
        if (this.identity == null || this.device == null) {
            throw new Error("Create an identity before generating device tokens");
        }
        var device_name = options && options.name ? options.name : "device";
        var expires_in_ms = options && options.expiresInMs ? options.expiresInMs : 5 * 60 * 1000;
        var device_signing_keys = await generate_signing_keys();
        var device_encryption_keys = await generate_encryption_keys();
        var serialized_keys = await serialize_key_material(device_signing_keys, device_encryption_keys);
        var issued_at = new Date().toISOString();
        var expires_at = new Date(Date.now() + expires_in_ms).toISOString();
        var payload = {
            version: 1,
            username: this.username,
            ownerPublicKey: this.identity.publicKeys.signing,
            ownerEncryptionPublicKey: this.identity.publicKeys.encryption,
            deviceName: device_name,
            devicePublicKeys: {
                signing: serialized_keys.signing.publicKey,
                encryption: serialized_keys.encryption.publicKey
            },
            issuedAt: issued_at,
            expiresAt: expires_at
        };
        var signature = await sign_value(this.device.keys.signing.privateKey, payload);
        return array_buffer_to_base64url(utf8_bytes(JSON.stringify({
            payload: payload,
            signature: signature,
            privateKeys: {
                signing: serialized_keys.signing.privateKey,
                encryption: serialized_keys.encryption.privateKey
            }
        })));
    }

    async importDeviceToken(token) {
        var bundle = JSON.parse(text_decoder.decode(base64url_to_uint8array(token)));
        if (Date.parse(bundle.payload.expiresAt) < Date.now()) {
            throw new Error("Authentication token has expired");
        }
        var owner_public_key = await import_signing_public_key(bundle.payload.ownerPublicKey);
        if (!await verify_value(owner_public_key, bundle.payload, bundle.signature)) {
            throw new Error("Authentication token signature is invalid");
        }

        var serialized_keys = {
            signing: {
                publicKey: bundle.payload.devicePublicKeys.signing,
                privateKey: bundle.privateKeys.signing
            },
            encryption: {
                publicKey: bundle.payload.devicePublicKeys.encryption,
                privateKey: bundle.privateKeys.encryption
            }
        };
        var imported_keys = await import_key_material(serialized_keys);
        if (await export_public_key(imported_keys.signing.publicKey) != bundle.payload.devicePublicKeys.signing) {
            throw new Error("Authentication token signing key does not match the public key");
        }
        if (await export_public_key(imported_keys.encryption.publicKey) != bundle.payload.devicePublicKeys.encryption) {
            throw new Error("Authentication token encryption key does not match the public key");
        }

        this.username = bundle.payload.username;
        this.identity = {
            username: bundle.payload.username,
            publicKeys: {
                signing: bundle.payload.ownerPublicKey,
                encryption: bundle.payload.ownerEncryptionPublicKey
            }
        };
        this.device = {
            name: bundle.payload.deviceName,
            ownerPublicKey: bundle.payload.ownerPublicKey,
            publicKeys: clone_json(bundle.payload.devicePublicKeys),
            keys: imported_keys
        };
        this.registerUsername(bundle.payload.username, {
            publicKeys: {
                owner: bundle.payload.ownerPublicKey,
                ownerEncryption: bundle.payload.ownerEncryptionPublicKey,
                device: bundle.payload.devicePublicKeys.signing,
                deviceEncryption: bundle.payload.devicePublicKeys.encryption
            }
        });
        this.emit_change();
        return this.getState();
    }

    async sealMessage(payload, options) {
        if (this.device == null) {
            throw new Error("Create or import an identity before sealing messages");
        }
        var normalized_options = options || {};
        var should_sign = normalized_options.sign !== false;
        var recipients = normalized_options.encryptFor || normalized_options.recipientPublicKeys || [];
        var encrypted = recipients.length > 0;
        var auth = {
            version: 1,
            username: this.username,
            signed: should_sign,
            encrypted: encrypted,
            publicKeys: {
                owner: this.identity.publicKeys.signing,
                ownerEncryption: this.identity.publicKeys.encryption,
                device: this.device.publicKeys.signing,
                deviceEncryption: this.device.publicKeys.encryption
            },
            createdAt: new Date().toISOString()
        };
        var sealed_payload = payload;
        if (encrypted) {
            sealed_payload = await encrypt_payload(payload, this.device.keys.encryption, recipients);
            auth.recipientPublicKeys = sealed_payload.recipients.map(function (recipient) {
                return recipient.publicKey;
            });
        }
        var signature_payload = {
            auth: auth,
            payload: sealed_payload
        };
        return {
            auth: auth,
            payload: sealed_payload,
            signature: should_sign ? await sign_value(this.device.keys.signing.privateKey, signature_payload) : null
        };
    }

    async openMessage(message) {
        if (!is_auth_envelope(message)) {
            return {
                authenticated: false,
                verified: false,
                encrypted: false,
                data: message,
                envelope: message,
                username: null
            };
        }

        var verified = false;
        if (message.auth.signed && message.signature != null) {
            var signing_public_key = await import_signing_public_key(message.auth.publicKeys.device);
            verified = await verify_value(signing_public_key, {
                auth: message.auth,
                payload: message.payload
            }, message.signature);
            if (!verified) {
                throw new Error("Authenticated message signature is invalid");
            }
        }

        var opened_payload = message.payload;
        if (message.auth.encrypted) {
            if (this.device == null) {
                throw new Error("Cannot decrypt an authenticated message without a device key");
            }
            opened_payload = await decrypt_payload(message.payload, this.device.keys.encryption);
        }

        return {
            authenticated: true,
            verified: verified,
            encrypted: message.auth.encrypted,
            data: opened_payload,
            envelope: message,
            username: this.lookupUsernameByPublicKey(message.auth.publicKeys.owner) || message.auth.username || null
        };
    }
}

