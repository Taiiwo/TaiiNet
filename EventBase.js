// add callback funcitonality
export class EventBase {
    constructor() {
        this.callbacks = [];
    }

    on(event, callback) {
        if (this.callbacks[event] == undefined) {
            this.callbacks[event] = [];
        }
        this.callbacks[event].push(callback);
    }

    off(event, callback) {
        if (this.callbacks[event] == undefined) {
            return;
        }
        this.callbacks[event] = this.callbacks[event].filter(function (handler) {
            return handler != callback;
        });
    }

    trigger(event, ...data) {
        if (this.callbacks[event] == undefined) {
            return;
        }
        for (var i in this.callbacks[event]) {
            this.callbacks[event][i](...data);
        }
    }
}
