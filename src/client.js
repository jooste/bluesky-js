import { Signal } from './signal.js';
import {encode, decode } from '@msgpack/msgpack';

function genid(groupid='C', length=8, seqidx=1) {
    let id = groupid.charCodeAt(0).toString(16).padStart(2, '0');
    // wildcard is forbidden
    let forbidden = '*'.charCodeAt(0);
    for (let i = 0; i < length - groupid.length - 1; i++) {
        let cur;
        do {
            cur = Math.floor(Math.random() * 256);
        } while (cur === forbidden);
        id += cur.toString(16).padStart(2, '0');
    }
    // Hexadecimal sequence index
    id += seqidx.toString(16).padStart(2, '0');
    return id;
}

class Client {
    constructor(clientId = null) {
        this.clientId = clientId || genid('C', 8, 1);
        // Use the singal handler for regular/raw subscriptions
        this._emitter = new Signal('Subscription');
        this.ws = null;
        this.actId = null;
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

        this.ws.onopen = () => {
            console.log('WebSocket connection opened');
        };

        this.ws.onmessage = (event) => {
            try {
                // expect: [toGroup, topic, senderId, data]
                const decoded = decode(new Uint8Array(event.data));
                const [toGroup, topic, senderId, data] = decoded;
                this._emitter.emit(topic, data, senderId, toGroup);
            } catch (e) {
                console.error('Error parsing WebSocket message:', e);
            }
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.ws.onclose = () => {
            console.log('WebSocket connection closed');
        };
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
            const payload = encode([toGroup, topic, data]);
            this.ws.send(payload);
        } catch (e) {
            console.error('Error encoding/sending message', e);
        }
    }
}

// Export singleton instance
export default new Client();
