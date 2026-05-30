export function createTaiiNetAuthHooks(React, auth) {
    if (React == undefined || typeof (React.useSyncExternalStore) != "function" || typeof (React.useMemo) != "function") {
        throw new Error("createTaiiNetAuthHooks requires React.useSyncExternalStore and React.useMemo");
    }

    var subscribe = function (on_store_change) {
        auth.on("change", on_store_change);
        return function () {
            auth.off("change", on_store_change);
        };
    };

    var get_snapshot = function () {
        return auth.getState();
    };

    function useTaiiNetAuth() {
        var state = React.useSyncExternalStore(subscribe, get_snapshot, get_snapshot);
        return React.useMemo(function () {
            return {
                state: state,
                username: state.username,
                identity: state.identity,
                device: state.device,
                registry: state.registry,
                createIdentity: auth.createIdentity.bind(auth),
                registerUsername: auth.registerUsername.bind(auth),
                lookupUsernameByPublicKey: auth.lookupUsernameByPublicKey.bind(auth),
                lookupPublicKeysByUsername: auth.lookupPublicKeysByUsername.bind(auth),
                createDeviceToken: auth.createDeviceToken.bind(auth),
                importDeviceToken: auth.importDeviceToken.bind(auth),
                sealMessage: auth.sealMessage.bind(auth),
                openMessage: auth.openMessage.bind(auth)
            };
        }, [state]);
    }

    return {
        useTaiiNetAuth: useTaiiNetAuth
    };
}

