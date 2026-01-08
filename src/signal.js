class SignalEvent extends Event {
    constructor(type, data, sender_id = null, to_group = '*') {
        super(type);
        this.data = data;
        this.sender_id = sender_id;
        this.to_group = to_group;
    }
};

class Signal {
    static _signals = new Map();
    constructor(name) {
        if (Signal._signals.has(name)) return Signal._signals.get(name);
        this.name = name;
        this._emitter = new EventTarget();
        Signal._signals.set(name, this);
    }

    connect(topic, callback, once = false) {
        this._emitter.addEventListener(topic, callback, { once: once });
    }

    disconnect(topic, callback) {
        this._emitter.removeEventListener(topic, callback);
    }

    emit(topic, data, sender_id = null, to_group = '*') {
        const event = new SignalEvent(topic, data, sender_id, to_group);
        this._emitter.dispatchEvent(event);
    }
};

export { Signal };