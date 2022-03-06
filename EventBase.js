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

    trigger(event, ...data) {
        for (var i in this.callbacks[event]) {
            this.callbacks[event][i](...data);
        }
    }
}
