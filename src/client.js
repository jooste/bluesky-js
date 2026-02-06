import ss, { ActionType } from './sharedstate.js';
import { SubscriptionEvent, SubscriptionType, Subscription } from './common.js';
import { encode, decode, ExtensionCodec } from "@msgpack/msgpack";

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
        this.addEventListener('NODE-ADDED', (event) => {
            // Filter for simulation nodes, and add to client and sharedstate lists
            const simnodes = event.data.filter((nodeId) => nodeId.startsWith('S'));
            this.simnodes.push(...simnodes);
            for (const nodeId of simnodes) {
                ss.reset(nodeId);
            }
            // If we don't have an active node yet set it to the first node
            if (this.actId === null && this.simnodes.length > 0) {
                this.actId = this.simnodes[0];
                ss.setActNode(this.actId);
                console.log('Setting active node ID to', this.actId);
            }

            // Request full state sync from this client
            const topics = this.subscriptions.values().filter(t =>
                t.subscriptionType === SubscriptionType.SharedState ||
                t.subscriptionType === SubscriptionType.Unknown).map(t => t.topic);

            for (const nodeId of simnodes) {
                this.send('REQUEST', topics, nodeId);
            }
        });

        this.addEventListener('ACTNODE-CHANGED', (event) => {
            console.log('Setting active node ID to', this.actId);
            const actId = event.data;
            this.actId = actId;
            ss.setActNode(actId);
        });

        this.extensionCodec = new ExtensionCodec();

        // Set<T>
        const NDARRAY_EXT_TYPE = 42 // Any in 0-127
        this.extensionCodec.register({
            type: NDARRAY_EXT_TYPE,
            decode: (data) => {
                // We have an array with: [dtype, shape, bytes]
                const decoded = decode(data, { extensionCodec: this.extensionCodec });
                const ua = Uint8Array.from(decoded[2]);
                switch (decoded[0]) {
                    case '<f8':
                        // NumPy double array
                        const fa = new Float64Array(ua.buffer);
                        const aa = Array.from(fa);
                        return aa;
                    case '<i8':
                        // NumPy long int array
                        const ia = new BigInt64Array(ua.buffer);
                        return Array.from(ia);
                    case '|b1':
                        return Array.from(ua).map((val) => val == 1);
                }
            },
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
                const decoded = decode(new Uint8Array(event.data), { extensionCodec: this.extensionCodec });
                const [toGroup, topic, senderId, data] = decoded;
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
    }

    isConnected() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    // publish/send to server: encodes as [toGroup, topic, senderId, data]
    send(topic, data, toGroup = '') {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('WebSocket not open, cannot send');
            return;
        }
        try {
            const payload = encode([toGroup || this.actId, topic.toUpperCase(), data]);
            this.ws.send(payload);
        } catch (e) {
            console.error('Error encoding/sending message', e);
        }
    }

    subscribe(topic, func, broadcast = true, raw = false, actonly = null, fromGroup = '', toGroup = '') {
        const utopic = topic.toUpperCase();
        let sub = this.subscriptions.get(utopic);
        if (sub === undefined) {
            sub = new Subscription(utopic, actonly);
            this.subscriptions.set(utopic, sub);

            // Assume we don't know the message type yet. 
            // Connect detect type on first message to find out
            this.addEventListener(utopic, this._detectType.bind(this), {once: true});
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
