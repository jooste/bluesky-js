class SignalEvent extends Event {
    constructor(type, data, senderId = null, toGroup = '*') {
        super(type);
        this.data = data;
        this.senderId = senderId;
        this.toGroup = toGroup;
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

    emit(topic, data, senderId = null, toGroup = '*') {
        const event = new SignalEvent(topic, data, senderId, toGroup);
        this._emitter.dispatchEvent(event);
    }
};

export { Signal };