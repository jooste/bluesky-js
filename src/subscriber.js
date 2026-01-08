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
        this.deferredSubs = new Array();
        if (ss.isSharedState(topic)) {
            this.subscriptionType = SubscriptionType.SharedState;
            Subscription.signal.connect(topic, ss.onSharedStateReceived.bind(ss));
        } else {
            this.subscriptionType = SubscriptionType.Unknown;
            // Connect detect type on first message
            Subscription.signal.connect(topic, this._detectType.bind(this), true );
        }
    }

    setActOnly(actonly) {
        this.actonly = actonly;
    }

    _detectType(event) {
        if (ActionType.isaction(event.data[0])) {
            this.subscriptionType = SubscriptionType.SharedState;
            ss.addtopic(this.topic.toLowerCase());
            // Connect collected callbacks to sharedstate signal
            while (this.deferredSubs.length) ss.signal.connect(this.topic, this.deferredSubs.shift());
            // Connect sharedstate handler to raw subscription signal
            Subscription.signal.connect(this.topic, ss.onSharedStateReceived);
            // Propagate first message to sharedstate subscribers
            ss.onSharedStateReceived(event);
        } else {
            this.subscriptionType = SubscriptionType.Regular;
            while (this.deferredSubs.length) {
                const cb = this.deferredSubs.shift();
                cb(event);
                Subscription.signal.connect(this.topic, cb);
            }
        }
    }

    connect(fn, raw=false) {
        // TODO: this.subscribeAll();
        if (raw || this.subscriptionType === SubscriptionType.Regular) {
            Subscription.signal.connect(this.topic, fn);
        } else if (this.subscriptionType === SubscriptionType.Unknown) {
            this.deferredSubs.push(fn);
        } else { // SharedState
            Subscription.signal.connect('state-changed' + this.topic, fn);
        }
    }

    subscribe(fromGroup='S', toGroup='') {
        if (this.subs.has(`${fromGroup}|${toGroup}`)) return;
        this.subs.add(`${fromGroup}|${toGroup}`);
        if (client.isConnected()) {
            client.send('SUBSCRIBE', {topic:this.topic, fromGroup:fromGroup, toGroup:toGroup, actonly:this.actonly });
        } else {
            this.requested.push([fromGroup, toGroup]);
        }
    }

    subscribeAll() {
        if (!client.isConnected()) return;
        while (this.requested.length) this.subscribe(...this.requested.shift());
    }

    unsubscribe(fromGroup='S', toGroup='') {
        if (!this.subs.has(`${fromGroup}|${toGroup}`)) return;
        this.subs.delete(`${fromGroup}|${toGroup}`);
        if (client.isConnected()) {
            client.send('UNSUBSCRIBE', {topic:this.topic, fromGroup:fromGroup, toGroup:toGroup});
        }
    }
}

function subscribe(topic, func, broadcast=true, raw=false, actonly=null, fromGroup='S', toGroup='') {
    const sub = new Subscription(topic, actonly);
    if (actonly !== null) sub.setActOnly(actonly);
    if (broadcast) sub.subscribe(fromGroup, toGroup);

    sub.connect(func);
    return sub;
}

// Connect internal client handlers
subscribe('reset', (event) => {
    const remoteId = event.data.senderId;
    ss.reset(remoteId);
});

subscribe('node-added', (event) => {
    const remoteId = event.data.senderId;
    ss.reset(remoteId);

    // Request full state sync from this client
    if (client.isConnected() && remoteId !== client.clientId) {
        const topics = Subscription._subscriptions.filter(t => 
            t.subscriptionType === SubscriptionType.SharedState || 
            t.subscriptionType === SubscriptionType.Unknown).map(t => t.topic);
        client.send('request', topics, toGroup=remoteId);
    }
});

export default { subscribe };