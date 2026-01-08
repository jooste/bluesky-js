import client from './client.js';
import { Signal } from './signal.js';
import ss, { ActionType } from './sharedstate.js';


export class SubscriptionType {
    static Regular = 'Regular';
    static SharedState = 'SharedState';
    static Unknown = 'Unknown';
}


class Subscription {
    static signal = new Signal('Subscription');
    static _subscriptions = new Set();

    constructor(topic) {
        if (topic in Subscription._subscriptions) {
            return Subscription._subscriptions[topic];
        }
        Subscription._subscriptions[topic] = this;
        this.topic = topic;
        this.subs = new Set();
        this.requested = new Array();
        this.actonly = false;
        this.deferred_subs = new Array();
        if (ss.isSharedState(topic)) {
            this.subscription_type = SubscriptionType.SharedState;
            Subscription.signal.connect(topic, ss.onSharedStateReceived.bind(ss));
        } else {
            this.subscription_type = SubscriptionType.Unknown;
            // Connect detect type on first message
            Subscription.signal.connect(topic, this._detectType.bind(this), once=true );
        }
    }

    setActOnly(actonly) {
        this.actonly = actonly;
    }

    _detectType(event) {
        if (ActionType.isaction(event.data[0])) {
            this.subscription_type = SubscriptionType.SharedState;
            ss.addtopic(this.topic.toLowerCase());
            // Connect collected callbacks to sharedstate signal
            while (this.deferred_subs.length) ss.signal.connect(this.topic, this.deferred_subs.shift());
            // Connect sharedstate handler to raw subscription signal
            Subscription.signal.connect(this.topic, ss.onSharedStateReceived);
            // Propagate first message to sharedstate subscribers
            ss.onSharedStateReceived(event);
        } else {
            this.subscription_type = SubscriptionType.Regular;
            while (this.deferred_subs.length) {
                const cb = this.deferred_subs.shift();
                cb(event);
                Subscription.signal.connect(this.topic, cb);
            }
        }
    }

    connect(fn, raw=false) {
        // TODO: this.subscribe_all();
        if (raw || this.subscription_type === SubscriptionType.Regular) {
            Subscription.signal.connect(this.topic, fn);
        } else if (this.subscription_type === SubscriptionType.Unknown) {
            this.deferred_subs.push(fn);
        } else { // SharedState
            Subscription.signal.connect('state-changed' + this.topic, fn);
        }
    }

    subscribe(from_group='S', to_group='') {
        if (this.subs.has(`${from_group}|${to_group}`)) return;
        this.subs.add(`${from_group}|${to_group}`);
        if (client.is_connected()) {
            client.send('SUBSCRIBE', {topic:this.topic, from_group:from_group, to_group:to_group, actonly:this.actonly });
        } else {
            this.requested.push([from_group, to_group]);
        }
    }

    subscribe_all() {
        if (!client.is_connected()) return;
        while (this.requested.length) this.subscribe(...this.requested.shift());
    }

    unsubscribe(from_group='S', to_group='') {
        if (!this.subs.has(`${from_group}|${to_group}`)) return;
        this.subs.delete(`${from_group}|${to_group}`);
        if (client.is_connected()) {
            client.send('UNSUBSCRIBE', {topic:this.topic, from_group:from_group, to_group:to_group});
        }
    }
}

function subscribe(topic, func, broadcast=true, raw=false, actonly=null, from_group='S', to_group='') {
    const sub = new Subscription(topic, actonly);
    if (actonly !== null) sub.setActOnly(actonly);
    if (broadcast) sub.subscribe(from_group, to_group);

    sub.connect(func);
    return sub;
}

// Connect internal client handlers
subscribe('reset', (event) => {
    const remote_id = event.data.sender_id;
    ss.reset(remote_id);
});

subscribe('node-added', (event) => {
    const remote_id = event.data.sender_id;
    ss.reset(remote_id);

    // Request full state sync from this client
    if (client.is_connected() && remote_id !== client.client_id) {
        const topics = Subscription._subscriptions.filter(t => 
            t.subscription_type === SubscriptionType.SharedState || 
            t.subscription_type === SubscriptionType.Unknown).map(t => t.topic);
        client.send('request', topics, to_group=remote_id);
    }
});

export default { subscribe };