import ss, { ActionType } from './sharedstate.js';
import { SubscriptionEvent, SubscriptionType, Subscription } from './common.js';
import {encode, decode } from '@msgpack/msgpack';


class Client extends EventTarget {
    constructor() {
        super();
        this.clientId = '';
        this.ws = null;
        this.actId = null;
        // List of sim node ids
        this.simnodes = [];
        // Map of subscriptions
        this.subscriptions = new Map();

        // Connect join and leave signals
        this.addEventListener('JOINED', (event) => {
            this.simnodes.push(event.data);
            console.log(`BlueSky client received JOIN event, nodes = ${this.simnodes}`)
        });
    };

    setClientId(clientId) {
        this.clientId = clientId;
    }

    connect(hostname = '127.0.0.1', port = 5000, clientId = null) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.warn('WebSocket already connected');
            return;
        }
        this.clientId = clientId || this.clientId;
        this.ws = new WebSocket(`ws://${hostname}:${port}/ws/${this.clientId}`);
        this.ws.binaryType = "arraybuffer";

        this.ws.addEventListener('open', (event) => {
            console.log('WebSocket connection opened');
            // Send all pending subscriptions
            for (const sub of this.subscriptions.values()) {
                while (sub.requested.length) {
                    let [fromGroup, toGroup] = sub.requested.shift();
                    sub.subs.add(`${fromGroup}|${toGroup}`);
                    this.send('SUBSCRIBE', { topic: sub.topic, from_group: fromGroup, to_group: toGroup, actonly: sub.actonly });
                }
            }
        });

        this.ws.addEventListener('message', (event) => {
            try {
                // expect: [toGroup, topic, senderId, data]
                const decoded = decode(new Uint8Array(event.data));
                const [toGroup, topic, senderId, data] = decoded;
                console.log(`Incoming WS message: ${topic}, ${data}, ${senderId}, ${toGroup}`)
                this.dispatchEvent(
                    new SubscriptionEvent(topic, data, senderId, toGroup)
                );
            } catch (e) {
                console.error('Error parsing WebSocket message:', e);
            }
        });

        this.ws.addEventListener('error', (error) => {
            console.error('WebSocket error:', error);
        });

        this.ws.addEventListener('close', () => {
            console.log('WebSocket connection closed');
        });

        // Connect internal client handlers
        this.subscribe('reset', (event) => {
            const remoteId = event.senderId;
            ss.reset(remoteId);
        });

        this.subscribe('actnode-changed', (event) => {
            const actId = event.data;
            ss.setActNode(actId);
        });

        this.subscribe('node-added', (event) => {
            const remoteIds = event.data;
            for (const remoteId of remoteIds) {
                ss.reset(remoteId);
            }

            // Request full state sync from this client
            const topics = this.subscriptions.values().filter(t =>
                t.subscriptionType === SubscriptionType.SharedState ||
                t.subscriptionType === SubscriptionType.Unknown).map(t => t.topic);

            for (const remoteId of remoteIds) {
                this.send('REQUEST', topics, toGroup = remoteId);
            }
        });
    }

    isConnected() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    // publish/send to server: encodes as [toGroup, topic, senderId, data]
    send(topic, data, toGroup = '*') {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('WebSocket not open, cannot send');
            return;
        }
        try {
            const payload = encode([toGroup, topic.toUpperCase(), data]);
            this.ws.send(payload);
        } catch (e) {
            console.error('Error encoding/sending message', e);
        }
    }

    subscribe(topic, func, broadcast = true, raw = false, actonly = null, fromGroup = '', toGroup = '') {
        const utopic = topic.toUpperCase();
        let sub = this.subscriptions.get(utopic);
        if (sub === undefined) {
            sub = new Subscription(topic, actonly);
            this.subscriptions.set(utopic, sub);

            // Assume we don't know the message type yet. 
            // Connect detect type on first message to find out
            this.addEventListener(utopic, this._detectType.bind(this), true);
        }

        // Connect passed function to appropriate event
        if (raw || sub.subscriptionType === SubscriptionType.Regular) {
            this.addEventListener(utopic, func);
        } else if (this.subscriptionType === SubscriptionType.Unknown) {
            // Defer connection of subscriber function to _detectType
            this.deferredSubs.push(func);
        } else { // SharedState
            ss.addEventListener(utopic, func);
        }

        // Update settings if needed
        if (actonly !== null) sub.actonly = actonly;
        if (broadcast) {
            if (sub.subs.has(`${fromGroup}|${toGroup}`)) return;
            if (this.isConnected()) {
                sub.subs.add(`${fromGroup}|${toGroup}`);
                this.send('SUBSCRIBE', { topic: sub.topic, from_group: fromGroup, to_group: toGroup, actonly: sub.actonly });
            } else {
                sub.requested.push([fromGroup, toGroup]);
            }
        }

        return sub;
    }

    unsubscribe(topic, fromGroup = '', toGroup = '') {
        const utopic = topic.toUpperCase();
        const sub = this.subscriptions.get(utopic);
        if (!sub.subs.has(`${fromGroup}|${toGroup}`)) return;
        sub.subs.delete(`${fromGroup}|${toGroup}`);
        if (this.isConnected()) {
            this.send('UNSUBSCRIBE', { topic: utopic, from_group: fromGroup, to_group: toGroup });
        }
    }

    _detectType(event) {
        // Get corresponding subscription object
        const sub = this.subscriptions.get(event.type);
        if (sub === undefined) {
            console.error('Received message for unknown subscription', event)
        }
        if (ActionType.isaction(event.data[0])) {
            sub.subscriptionType = SubscriptionType.SharedState;
            ss.addtopic(sub.topic);
            // Connect collected callbacks to sharedstate signal
            while (sub.deferredSubs.length) ss.addEventListener(sub.topic, sub.deferredSubs.shift());

            // Connect sharedstate handler to raw subscription signal
            this.addEventListener(sub.topic, ss.onSharedStateReceived.bind(ss));
            // Propagate first message to sharedstate subscribers
            ss.onSharedStateReceived(event);
        } else {
            sub.subscriptionType = SubscriptionType.Regular;
            while (sub.deferredSubs.length) {
                const cb = sub.deferredSubs.shift();
                cb(event);
                this.addEventListener(sub.topic, cb);
            }
        }
    }
}


// Export singleton instance
export default new Client();
